# System Specification & Architecture

This document details the system design, directory structures, data flows, and configuration schemas of the Zoho Automation Suite.

---

## 🏗️ Directory Layout

```text
.
├── .agent-context/           # Agent workspace, onboarding guides, and sprint tracker
│   ├── README.md             # Context index
│   ├── bootstrapping.md      # Onboarding guide & fresh clone setup
│   ├── harnessing.md         # CLI & dry-run testing guides
│   ├── specs.md              # Technical specifications (this file)
│   ├── wip-tracker.md        # Kanban progress tracker
│   └── wip.js                # WIP CLI tracker helper script
├── data/                     # Runtime inputs and outputs (gitignored)
│   ├── invoices/             # PDF invoices queue
│   │   └── archive/          # Successfully processed invoices archive
│   ├── bank_payment_upload/  # Bank payment upload spreadsheets (xlsx)
│   ├── payments_summary/     # Invoice payments summary reports (csv)
│   └── bank_statements/      # Bank statement spreadsheets for reconciliation
├── src/
│   ├── invoice_processing/   # Module 1: AI Invoice parser & Zoho Books billing
│   │   ├── parser/
│   │   │   └── pdf-parser.ts # Gemini extraction client
│   │   ├── zoho/
│   │   │   └── zoho-client.ts# Zoho Books REST Client
│   │   └── index.ts          # Invoice Processor CLI entrypoint
│   ├── currency_exchange/    # Module 2: ICEGATE rate scaper & Zoho Books update
│   │   ├── fetch_icegate_rates.py   # ICEGATE circular scraper
│   │   ├── update_zoho_rates.py     # Zoho exchange rate updater
│   │   ├── run_automation.py        # Python orchestrator
│   │   └── run_daily.sh             # Cron execution shell wrapper
│   ├── payment_automation/   # Module 3: Bank advice generation & reconciliation
│   │   ├── generate-bank-payment.ts # Kotak Bank xlsx spreadsheet generator
│   │   ├── generate-payments-csv.ts # CSV reports generator
│   │   └── reconcile-statement.ts   # Bank statement matching & payment recorder
│   └── dashboard/            # Module 4: SPA Express server & review UI
│       ├── public/           # Frontend SPA client (HTML, CSS, JS)
│       └── server.ts         # Dashboard Express API server
├── setup-org.ts              # Syncs Zoho Organization metadata with .env
├── package.json              # NPM dependencies & scripts
└── tsconfig.json             # TypeScript configuration
```

---

## 🔄 Core Subsystems

### 1. Invoice Processing & Zoho Bill Creator
* **Entrypoint:** `src/invoice_processing/index.ts`
* **Flow Diagram:**
  ```mermaid
  graph TD
      A[Invoice PDF] --> B[PDF Text Extraction]
      B --> C[Gemini AI Ingestion]
      C --> D[Structured JSON Output]
      D --> E{Vendor Lookup in Zoho}
      E -- Found --> G[State-Aware Tax Mapping]
      E -- Not Found --> F[Interactive Vendor Creation]
      F --> G
      G --> H[Create Draft Bill in Zoho]
      H --> I[Attach Original PDF to Bill]
      I --> J[Move Invoice to Archive Directory]
  ```

#### AI Schema Contract
Gemini is prompted to return structured JSON using a schema definition:
```json
{
  "vendor_name": "Vendor Legal Name",
  "gst_no": "Vendor GST registration number (if present)",
  "bill_number": "Invoice reference number",
  "date": "YYYY-MM-DD",
  "due_date": "YYYY-MM-DD",
  "currency": "USD, AUD, EUR, etc. (Default: INR)",
  "line_items": [
    {
      "description": "Item details",
      "quantity": 1.0,
      "rate": 500.00,
      "tax_percentage": 18.0
    }
  ]
}
```

#### Tax Calculations (CGST/SGST vs IGST)
- **CGST/SGST**: Applied if `vendor_state === organization_state`. Split equally (e.g. 18% total = 9% CGST + 9% SGST).
- **IGST**: Applied if `vendor_state !== organization_state` (Inter-state transactions).

---

### 2. ICEGATE Currency Automation
* **Entrypoint:** `src/currency_exchange/run_automation.py`
* **Purpose:** Scraping exchange rates from the Indian Customs portal (ICEGATE) and updating foreign currency conversion ratios in Zoho Books.
* **Mechanism:**
  - `fetch_icegate_rates.py` fetches the CBIC exchange rate circular and extracts currency rates into `icegate_rates.json`.
  - `update_zoho_rates.py` checks Zoho Books for currency mappings.
  - Automatically disables conflicting Zoho Books system currency exchange rate feeds to prevent overwrite overrides.

---

### 3. Payment Automation & Reconciliation
* **Entrypoint:** `src/payment_automation/generate-bank-payment.ts` / `reconcile-statement.ts`
* **Kotak Advice format:** Generates spreadsheet rows conforming to Kotak Mahindra Bank bulk transfer parameters:
  - Debit Account, Beneficiary Name, Account Number, IFSC, Net Payable (Bill Amount minus TDS deduction), and Narration.
* **Reconciliation Matching Rule:** Matches debit logs from uploaded bank statement spreadsheets against Zoho Books unpaid invoices using the format defined in `BANK_ADVICE_FORMAT` (default: `Inv pay {invoice_number}`).

---

### 4. Interactive Dashboard Web Control Center
* **Entrypoint:** `src/dashboard/server.ts`
* **Features:**
  - **Status Endpoint:** `/api/status` returns configurations and authentication status.
  - **Upload Ingestion:** `/api/upload` handles multi-part PDF imports directly to `INVOICES_DIR`.
  - **Real-time Scraper Log:** `/api/logs` broadcasts scraper command outputs straight to the client console using Server-Sent Events (SSE).
  - **Credentials caching:** Shares access tokens between Node processes and Python child executors via cached system files/environment updates.
