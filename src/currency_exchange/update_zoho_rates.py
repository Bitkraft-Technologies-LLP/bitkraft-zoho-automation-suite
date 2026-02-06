
import os
import json
import requests
from dotenv import load_dotenv
from datetime import datetime

load_dotenv()

ZOHO_CLIENT_ID = os.getenv("ZOHO_CLIENT_ID")
ZOHO_CLIENT_SECRET = os.getenv("ZOHO_CLIENT_SECRET")
ZOHO_REFRESH_TOKEN = os.getenv("ZOHO_REFRESH_TOKEN")
ZOHO_REFRESH_TOKEN = os.getenv("ZOHO_REFRESH_TOKEN")
ZOHO_ORGANIZATION_ID = os.getenv("ZOHO_ORGANIZATION_ID")

target_currencies_env = os.getenv("TARGET_CURRENCIES", "USD,EUR,GBP")
TARGET_CURRENCIES = [c.strip() for c in target_currencies_env.split(",")]
# Zoho domain might vary (com, in, eu). Assuming .com based on typical usage, but should be configurable.
# Defaulting to .com for auth, but the API endpoint might change.
ZOHO_ACCOUNTS_URL = "https://accounts.zoho.com" # or .in
ZOHO_BOOKS_URL = "https://www.zohoapis.com/books/v3"


def get_access_token():
    url = f"{ZOHO_ACCOUNTS_URL}/oauth/v2/token"
    params = {
        "refresh_token": ZOHO_REFRESH_TOKEN,
        "client_id": ZOHO_CLIENT_ID,
        "client_secret": ZOHO_CLIENT_SECRET,
        "grant_type": "refresh_token"
    }
    resp = requests.post(url, params=params)
    if resp.status_code != 200:
        raise Exception(f"Failed to refresh token: {resp.text}")
    return resp.json()["access_token"]

def get_currency_map(access_token):
    headers = {
        "Authorization": f"Zoho-oauthtoken {access_token}"
    }
    params = {"organization_id": ZOHO_ORGANIZATION_ID}
    url = f"{ZOHO_BOOKS_URL}/settings/currencies"
    
    resp = requests.get(url, headers=headers, params=params)
    if resp.status_code != 200:
        raise Exception(f"Failed to get currencies: {resp.text}")
        
    currencies = resp.json().get("currencies", [])
    # Map currency_code -> Currency Object
    return {c["currency_code"]: c for c in currencies}

def disable_feed(access_token, currency_id):
    headers = {
        "Authorization": f"Zoho-oauthtoken {access_token}",
        "Content-Type": "application/json"
    }
    url = f"{ZOHO_BOOKS_URL}/settings/currencies/{currency_id}"
    params = {"organization_id": ZOHO_ORGANIZATION_ID}
    
    # 1. Fetch current details
    resp_get = requests.get(url, headers=headers, params=params)
    if resp_get.status_code != 200:
        print(f"Failed to fetch currency details for disable: {resp_get.text}")
        return False
        
    current_data = resp_get.json().get("currency", {})
    
    # 2. Construct Payload with required fields to avoid 9011 error
    # We keep existing format loop.
    payload = {
        "currency_name": current_data.get("currency_name"),
        "currency_code": current_data.get("currency_code"),
        "currency_symbol": current_data.get("currency_symbol"),
        "price_precision": current_data.get("price_precision"),
        "currency_format": current_data.get("currency_format"),
        "decimal_separator": current_data.get("decimal_separator", "."),
        "thousand_separator": current_data.get("thousand_separator", ","),
        "is_active": True,
        
        # KEY CHANGES:
        "exchange_rate_feed_enabled": False,
        "auto_exchange_rate_enabled": False
    }

    resp = requests.put(url, headers=headers, params=params, json=payload)
    if resp.status_code == 200:
        print(f"Successfully disabled feed for {currency_id}")
        return True
    else:
        print(f"Failed to switch off feed for {currency_id}: {resp.text}")
        return False

def update_exchange_rate(access_token, currency_id, rate, date_str):
    headers = {
        "Authorization": f"Zoho-oauthtoken {access_token}",
        "Content-Type": "application/json"
    }
    # date_str expected format: YYYY-MM-DD
    data = {
        "rate": rate,
        "effective_date": date_str
    }
    url = f"{ZOHO_BOOKS_URL}/settings/currencies/{currency_id}/exchangerates"
    params = {"organization_id": ZOHO_ORGANIZATION_ID}
    
    resp = requests.post(url, headers=headers, params=params, json=data)
    if resp.status_code == 201:
        print(f"Success: Updated rate {rate} for currency {currency_id} on {date_str}")
        return True
    elif resp.status_code == 400 and "36005" in resp.text: 
        # Error 36005: Exchange rate already exists
        print(f"Skipped: Rate already exists for currency {currency_id} on {date_str}")
        return True
    else:
        print(f"Failed to update currency {currency_id}: {resp.text}")
        return False

def main():
    if not os.path.exists("icegate_rates.json"):
        print("icegate_rates.json not found. Run fetch script first.")
        return

    with open("icegate_rates.json", "r") as f:
        data = json.load(f)

    if data.get("error"):
        print(f"Error in data: {data['error']}")
        return

    # Parse Date
    # ICEGATE format usually "DD-MM-YYYY" (e.g. "06-02-2026")
    # Zoho expects "YYYY-MM-DD"
    
    raw_date = data.get("notPublishDate")
    if not raw_date:
        print("No publish date found in data")
        return
        
    try:
        dt = datetime.strptime(raw_date, "%d-%m-%Y")
        zoho_date = dt.strftime("%Y-%m-%d")
        print(f"Effective Date: {zoho_date}")
    except ValueError as e:
        print(f"Date parse error: {e} (Raw: {raw_date})")
        return

    try:
        access_token = get_access_token()
        print("Authenticated with Zoho.")
        
        currency_map = get_currency_map(access_token)
        print(f"Found {len(currency_map)} currencies in Zoho.")
        
        rates = data.get("currencyDetail", [])
        
        print(f"Target Currencies: {TARGET_CURRENCIES}")
        
        for item in rates:
            code = item.get("currencyCode")
            if code not in TARGET_CURRENCIES:
                continue
            
            # User Request: Use Export Rates
            raw_rate = item.get("cbicExport")
            if not raw_rate:
                raw_rate = item.get("cbicImport")
            
            if not raw_rate:
                print(f"No rate found for {code}")
                continue

            units_str = item.get("units", "1.0")
            try:
                units = float(units_str)
            except:
                units = 1.0
                
            rate = raw_rate / units
            rate = round(rate, 6)
            
            if code in currency_map:
                currency_info = currency_map[code]
                c_id = currency_info['currency_id']
                
                print(f"\n--- Checking {code} ---")
                
                # Check for various feed flags (Zoho uses different names in list vs detail)
                # Usually exchange_rate_feed_enabled is safe
                feed_enabled = currency_info.get('exchange_rate_feed_enabled')
                # Also check auto_exchange_rate_enabled if present (seen in debug details)
                if feed_enabled is None:
                    feed_enabled = currency_info.get('auto_exchange_rate_enabled')
                
                print(f"Zoho Config: Feed Enabled={feed_enabled}, Active={currency_info.get('is_active')}, Base={currency_info.get('is_base_currency')}")
                
                if feed_enabled:
                    print(f"WARNING: Feed is enabled for {code}. Attempting to auto-disable it...")
                    disable_feed(access_token, c_id)
                
                print(f"Attempting Update {code} (ID: {c_id}) -> {rate}")
                update_exchange_rate(access_token, c_id, rate, zoho_date)
            else:
                print(f"Skipping {code}: Not found in Zoho.")
                
    except Exception as e:
        print(f"Critical Error: {e}")

if __name__ == "__main__":
    main()
