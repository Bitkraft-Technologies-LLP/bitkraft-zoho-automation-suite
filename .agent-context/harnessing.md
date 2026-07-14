# Testing & Execution Harness

This document describes how to safely test, debug, and execute the various modules of the Zoho Automation Suite. Use these harnesses to verify your changes without accidentally writing duplicate or incorrect records to the production Zoho Books instance.

---

## 🛡️ Sandbox & Dry Run Safeguards

### 1. Invoice Processing Dry Runs
The invoice parsing CLI incorporates a `--dry-run` flag. This allows you to verify that Gemini AI successfully extracts text, parses schemas, maps taxes/vendors, and constructs payloads without submitting the final draft bill to Zoho Books.

* **Execute invoice dry-run:**
  ```bash
  npx ts-node src/invoice_processing/index.ts path/to/invoice.pdf --dry-run
  ```
* **Verify:** Ensure the printed JSON structure matches the Zoho Books schema parameters and taxes are calculated appropriately.

### 2. Bank Reconciliation Interactive Matches
Reconciliation does not write payments unless confirmed by the console.
* **Review reconciliation details:**
  ```bash
  npx ts-node src/payment_automation/reconcile-statement.ts path/to/statement.csv
  ```
  By default, this parses the file, matches entries, and prints a tabular summary. It will *not* record payment events in Zoho unless you explicitly approve them at the CLI prompt, OR pass the `--yes` (`-y`) flag.

---

## 🏃 Running Subsystem Components

Use these command invocations to trigger specific system scripts:

### Invoice Processing
- **Process a Single Bill:**
  ```bash
  npx ts-node src/invoice_processing/index.ts path/to/invoice.pdf
  ```
- **Process Folder Batch (data/invoices):**
  ```bash
  npx ts-node src/invoice_processing/index.ts
  ```

### ICEGATE Currency Rates
- **Manual Automation Script Orchestration (Fetches rates + Updates Zoho):**
  ```bash
  python3 src/currency_exchange/run_automation.py
  ```
- **Fetch Rates for a Specific Circular Date:**
  ```bash
  python3 src/currency_exchange/run_automation.py --date 2026-02-05
  ```
- **Direct Rates Fetch Check (Writes to `icegate_rates.json`):**
  ```bash
  python3 src/currency_exchange/fetch_icegate_rates.py
  ```

### Bank Payments
- **Scan Zoho Unpaid Bills & Compute Kotak Mahindra Payment Advice Files:**
  ```bash
  npx ts-node src/payment_automation/generate-bank-payment.ts
  ```
  Check the output files generated in:
  - `payments_summary/unpaid_bills_MMM-YYYY.csv`
  - `bank_payment_upload/bank_payment_MMM-YYYY.xlsx`

- **Record Statement Payments:**
  ```bash
  npx ts-node src/payment_automation/reconcile-statement.ts path/to/statement.csv
  ```

### Dashboard Web Control Center
- **Run the Web Server locally:**
  ```bash
  npm run dashboard
  ```
  This serves a development portal on [http://localhost:3000](http://localhost:3000). The dashboard UI allows drag-and-drop file ingestion, visual configuration edits, and real-time logs streamed via Server-Sent Events (SSE).

---

## 🧪 Mocking Strategies

To write unit tests or run offline diagnostics:

### 1. Mocking Zoho Books API client
If you are testing vendor matching logic or invoice processing structures without internet access, you can mock responses by editing `src/invoice_processing/zoho/zoho-client.ts`.
A sample mock can override `getVendors`, `getTaxes`, and `createBill` with locally stored JSON dumps:
```typescript
// Add mock environment check in constructor
if (process.env.NODE_ENV === "test") {
  this.getVendors = async () => [{ vendor_id: "12345", vendor_name: "Mock Vendor", gst_no: "27AAAAA1111A1Z1" }];
  this.createBill = async (data) => ({ bill: { bill_id: "mock-bill-999" } });
}
```

### 2. Mocking Gemini Extraction
You can bypass Gemini's extraction API entirely for parser testing by creating dummy text files or overriding `parseInvoiceWithAI` in `src/invoice_processing/parser/pdf-parser.ts` to return mock objects matching the expected interface structure.

---

## 📊 File Artifact Verification Checks
Whenever you run generation tools, verify the contents of the following directories:
- **`data/payments_summary/`**: Check that CSV reports correspond to the expected outstanding amounts.
- **`data/bank_payment_upload/`**: Open the bank spreadsheet uploads in Excel or LibreOffice to ensure columns are clean, calculations are exact, and bank details (Account, IFSC) are populated correctly.
