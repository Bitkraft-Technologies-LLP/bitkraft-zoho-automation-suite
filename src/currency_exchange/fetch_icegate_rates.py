
import json
import requests
import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed

def fetch_rate_for_id(session, not_num):
    url = "https://foservices.icegate.gov.in/cbu/icegateapi/igexratepublishnot"
    headers = {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Origin': 'https://foservices.icegate.gov.in',
        'Referer': 'https://foservices.icegate.gov.in/'
    }
    try:
        resp = session.post(url, json={"notNum": not_num}, headers=headers)
        if resp.status_code == 200:
            data = resp.json()
            if data.get("currencyDetail"): # Valid response has details
                return data
    except:
        pass
    return None

def get_latest_icegate_rates():
    session = requests.Session()
    # Init Session
    print("Initializing session...")
    session.get("https://foservices.icegate.gov.in")
    
    current_year = datetime.datetime.now().year
    
    # Check IDs from 1 to 30 (Customs notifications usually don't exceed ~20-30 for exchange rates in a year... 
    # well actually they might, usually 2 per month = 24. Let's try 1 to 50 to be safe but optimized).
    # Since we want the LATEST, maybe we can search binary or just all.
    # Parallel fetch is fast.
    
    print(f"Scanning for notifications in {current_year}...")
    
    candidates = []
    # Generate IDs "01/2026", "02/2026" ...
    ids_to_check = [f"{i:02d}/{current_year}" for i in range(1, 40)]
    
    valid_data = []
    
    with ThreadPoolExecutor(max_workers=5) as executor:
        future_to_id = {executor.submit(fetch_rate_for_id, session, i): i for i in ids_to_check}
        for future in as_completed(future_to_id):
            res = future.result()
            if res:
                valid_data.append(res)
                
    if not valid_data:
        raise Exception("No valid notifications found.")
        
    print(f"Found {len(valid_data)} valid notifications.")
    
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", help="Target date (YYYY-MM-DD)", default=None)
    args, unknown = parser.parse_known_args()
    
    target_date = datetime.datetime.now()
    if args.date:
        target_date = datetime.datetime.strptime(args.date, "%Y-%m-%d")
        
    print(f"Searching for circular effective on or before: {target_date.strftime('%Y-%m-%d')}")
    
    # Sort by date descending
    def parse_date(d):
        return datetime.datetime.strptime(d['notPublishDate'], "%d-%m-%Y")
        
    valid_data.sort(key=parse_date, reverse=True)
    
    selected_notification = None
    for notif in valid_data:
        notif_date = parse_date(notif)
        # We need the first one that is <= target_date
        # Since sorted desc, the first one <= target is the effective one.
        if notif_date <= target_date:
            selected_notification = notif
            break
            
    if not selected_notification:
        # If none found <= target (e.g. target is very old), warn or fail?
        # Fallback to oldest? Or Fail.
        print("No circular found effective before target date. Using oldest found.")
        selected_notification = valid_data[-1] 
        
    print(f"Selected Notification: {selected_notification['notificationNumber']} ({selected_notification['notPublishDate']})")
    
    return selected_notification

if __name__ == "__main__":
    try:
        data = get_latest_icegate_rates()
        print(json.dumps(data, indent=2))
        with open("icegate_rates.json", "w") as f:
            json.dump(data, f, indent=2)
            print("Saved to icegate_rates.json")
    except Exception as e:
        print(f"Error: {e}")
