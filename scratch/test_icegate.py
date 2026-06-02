import requests

session = requests.Session()
session.get("https://foservices.icegate.gov.in")

url = "https://foservices.icegate.gov.in/cbu/icegateapi/igexratepublishnot"
headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    'Origin': 'https://foservices.icegate.gov.in',
    'Referer': 'https://foservices.icegate.gov.in/'
}

for i in range(1, 100):
    not_num = f"{i:02d}/2026"
    resp = session.post(url, json={"notNum": not_num}, headers=headers)
    if resp.status_code == 200:
        data = resp.json()
        if data.get("currencyDetail"):
            print(f"Found: {not_num} - Date: {data.get('notPublishDate')}")
