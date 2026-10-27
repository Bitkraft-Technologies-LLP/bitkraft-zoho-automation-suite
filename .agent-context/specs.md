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
│   │   │   ├── pdf-parser.ts # Gemini extraction client
│   │   │   └── pdf-decryptor.ts # PDF auto-decryption candidate engine
│   │   ├── zoho/
│   │   │   └── zoho-client.ts# Resilient Zoho Books REST Client (OAuth retry)
│   │   ├── email-processor.ts# Office 365 invoice email polling
│   │   ├── payment-email-processor.ts # Office 365 payment advice & confirmation ingestion
│   │   └── index.ts          # Invoice Processor CLI entrypoint
│   ├── currency_exchange/    # Module 2: ICEGATE rate scaper & Zoho Books update
│   │   ├── fetch_icegate_rates.py   # ICEGATE circular scraper
│   │   ├── update_zoho_rates.py     # Zoho exchange rate updater
│   │   ├── run_automation.py        # Python orchestrator
│   │   └── run_daily.sh             # Cron execution shell wrapper
│   ├── payment_automation/   # Module 3: Bank advice generation & reconciliation
│   │   ├── generate-bank-payment.ts # Kotak Bank xlsx spreadsheet generator
│   │   ├── generate-payments-csv.ts # CSV reports generator
│   │   ├── statement-parser.ts      # Multimodal PDF, CSV & XLSX bank statement parser
│   │   ├── payment-matcher.ts       # Bidirectional AP/AR transaction matcher
│   │   ├── notification-service.ts  # Vendor payment email dispatch service
│   │   ├── notification-store.ts    # JSON notification database store
│   │   ├── sync-notifications.ts    # CLI batch notification script
│   │   └── reconcile-statement.ts   # Bank statement matching & payment recorder
│   └── dashboard/            # Module 4: SPA Express server & review UI
│       ├── public/           # Frontend SPA client (HTML, CSS, JS)
│       └── server.ts         # Dashboard Express API server & SSE log streamer
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
* **Entrypoints:** 
  - `src/payment_automation/generate-bank-payment.ts`: Kotak Mahindra bulk transfer spreadsheet generator
  - `src/payment_automation/reconcile-statement.ts`: CLI statement reconciliation & payment recorder
  - `src/invoice_processing/payment-email-processor.ts`: Office 365 payment advice / confirmation crawler
* **Bank Statement Ingestion (`statement-parser.ts`):**
  - **Formats Supported:** PDF, CSV, XLSX, XLS.
  - **PDF Multimodal Ingestion:** Multi-page PDF bank statements are sent directly to Gemini AI as inline parts, extracting a structured transaction array (`date`, `narration`, `amount`, `reference`, `type`, `billNumber`, `vendorName`, `customerName`).
  - **Auto-Decryption (`pdf-decryptor.ts`):** Decrypts encrypted Kotak, HDFC, ICICI, and SBI statements using candidate passwords (Account Number, CRN, PAN, GSTIN, subject/filename digits, and `data/vendor_passwords.json`).
* **Bidirectional Transaction Matching (`payment-matcher.ts`):**
  - **AP (Debit):** Matches against unpaid vendor bills (`/bills?status=unpaid`) via bill number, cleaned alphanumeric bill number, narration substring, reference number, or vendor name + exact balance match.
  - **AR (Credit):** Matches incoming customer payments against unpaid sales invoices (`/invoices?status=unpaid`) via invoice number, customer name, and exact balance.
* **Kotak Advice format:** Generates spreadsheet rows conforming to Kotak Mahindra Bank bulk transfer parameters:
  - Debit Account, Beneficiary Name, Account Number, IFSC, Net Payable (Bill Amount minus TDS deduction), and Narration.
* **Payment Email Crawler (`payment-email-processor.ts`):**
  - Scans shared mailbox for debit confirmations and credit receipts.
  - Auto-decrypts and parses attached PDF payment advice documents.
  - Records payments directly in Zoho Books with audit logging.

---

### 4. Interactive Dashboard Web Control Center
* **Entrypoint:** `src/dashboard/server.ts`
* **Features:**
  - **Status Endpoint:** `/api/status` returns configurations and authentication status.
  - **Invoice Upload Ingestion:** `/api/upload` handles multi-part PDF imports directly to `INVOICES_DIR`.
  - **Universal Statement Upload:** `/api/payment/upload-statement` accepts `.pdf`, `.csv`, `.xlsx`, `.xls` statements and returns match analysis against unpaid bills.
  - **Bill & Customer Payment Reconciliation:** `/api/payment/reconcile` (AP vendor payments) and `/api/payment/reconcile-customer-payments` (AR customer payments).
  - **Payment Email Scan:** `/api/payment/scan-email-payments` scans mailbox for payment confirmations and records matches.
  - **Real-time Scraper & Sync Logs:** `/api/logs` and `/api/invoices/email-sync` stream command outputs directly to the client console using Server-Sent Events (SSE).
  - **Vendor Payment Notifications:** Endpoints `/api/payment-notifications` to fetch logs, preview HTML payment receipts in a sandboxed modal, and re-dispatch emails.
  - **Credentials caching:** Shares access tokens between Node processes and Python child executors via cached system files/environment updates.

