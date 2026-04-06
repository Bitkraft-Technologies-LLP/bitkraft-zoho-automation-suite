# Bitkraft Zoho Automation Suite

A comprehensive automation suite for Zoho Books that streamlines invoice processing, currency exchange rate management, and payment file generation using AI-powered data extraction and official ICEGATE integration.

## 📖 Case Studies

Explore our detailed journey of building this suite using Gen AI, including technical challenges, system architectures, and business impact:

- [**Master Case Study Overview**](./Zoho%20Automation%20Case%20Study/zoho_automation_case_study.md)
- [📄 AI-Powered Invoice Processing](./Zoho%20Automation%20Case%20Study/case_study_invoice_processing.md)
- [💱 ICEGATE Currency Automation](./Zoho%20Automation%20Case%20Study/case_study_currency_automation.md)
- [🏦 Bank Payment Generation](./Zoho%20Automation%20Case%20Study/case_study_payment_automation.md)
- [🛠️ Visual Assets &amp; Architecture Guide](./Zoho%20Automation%20Case%20Study/visual_assets_guide.md)

_See the [Case Study Package Guide](./Zoho%20Automation%20Case%20Study/case_study_package_guide.md) for a complete index of all documentation._

## Features

### 📄 Invoice Processing

- 🤖 **AI-Powered Invoice Parsing**: Automatically extracts vendor details, line items, taxes, and amounts from PDF invoices using Google Gemini AI
- 📄 **Multimodal Support**: Handles both text-based and image-based (scanned) invoices
- 🔍 **Smart Vendor Matching**: Matches vendors by GST number or name from your Zoho Books database
- ✨ **Interactive Vendor Creation**: If a vendor is not found, the system prompts you to create it automatically with comprehensive details:
  - Vendor Name & Company Name
  - GST Number & PAN
  - Contact Information (Email, Phone)
  - Full Address (Street, City, State, ZIP)
  - Bank Details (Account Number, IFSC, Bank Name) - stored in notes
- 💰 **TDS Automation**: Automatically applies TDS deductions based on vendor settings
- 📊 **State-Aware Tax Mapping**: Intelligently selects between GST and IGST based on transaction location
- 📁 **Batch Processing**: Process multiple invoices at once from a directory
- 🗄️ **Auto-Archival**: Automatically archives processed invoices to prevent reprocessing

### 💱 Currency Exchange Rate Automation

- 💱 **ICEGATE Integration**: Automatically fetches official exchange rates from ICEGATE (CBIC)
- 📅 **Date-Specific Rates**: Fetch rates applicable for any specific date (past or future)
- 🔄 **Smart Circular Discovery**: Automatically finds the latest or date-appropriate circular
- 🎯 **Configurable Currencies**: Update only the currencies you specify via `.env`
- 🛡️ **Feed Safety**: Automatically detects and disables conflicting Exchange Rate Feeds in Zoho
- ⏰ **Scheduled Updates**: Can be configured to run daily via cron

### 🏦 Payment Processing

- 🏦 **Bank Payment File Generation**: Creates bank-ready XLSX and CSV files for bulk payments
- 💼 **TDS-Aware Calculations**: Accurately calculates net payable amounts considering TDS deductions
- ⚙️ **Configurable Paths**: All input/output directories are customizable via environment variables
- 📊 **Payment Summaries**: Generates detailed payment summary reports in CSV format

## Prerequisites

- Node.js (v14 or higher)
- Python 3.x (for currency exchange automation)
- TypeScript
- Zoho Books account with API access
- Google Gemini API key

## Installation

1. Clone the repository:

```bash
git clone https://github.com/YOUR_USERNAME/bitkraft-zoho-automation-suite.git
cd bitkraft-zoho-automation-suite
```

2. Install dependencies:

```bash
npm install
```

3. Copy `.env.example` to `.env` and configure your credentials:

```bash
cp .env.example .env
```

4. Edit `.env` with your actual credentials:

   - Zoho Books API credentials
   - Google Gemini API key
   - Organization details (GST, Name, State)
   - Directory paths (optional, defaults provided)
5. Run the organization setup (first time only):

```bash
npx ts-node setup-org.ts
```

## Usage

### Process a Single Invoice

```bash
npx ts-node src/invoice_processing/index.ts path/to/invoice.pdf
```

### Batch Process All Invoices

Place PDF invoices in the configured `INVOICES_DIR` (default: `./data/invoices`), then run:

```bash
npx ts-node src/invoice_processing/index.ts
```

Successfully processed invoices are automatically moved to `INVOICES_ARCHIVE_DIR`.

### Dry Run (Extract Data Only)

```bash
npx ts-node src/invoice_processing/index.ts path/to/invoice.pdf --dry-run
```

### Generate Bank Payment Files

```bash
npx ts-node src/payment_automation/generate-bank-payment.ts
```

This generates:

- **Payment Summary CSV**: `payments_summary/unpaid_bills_MMM-YYYY.csv`
- **Bank Upload XLSX**: `bank_payment_upload/bank_payment_MMM-YYYY.xlsx`

### Currency Exchange Rate Automation

#### Manual Run (Latest Rates)

```bash
./src/currency_exchange/run_daily.sh
```

Or directly:

```bash
python3 src/currency_exchange/run_automation.py
```

#### Run for Specific Date

To fetch rates applicable as of a specific date:

```bash
python3 src/currency_exchange/run_automation.py --date 2026-02-05
```

#### Schedule Daily Updates (Cron)

To run automatically every day at 9:00 AM:

```bash
crontab -e
```

Add this line:

```
0 9 * * * /path/to/bitkraft-zoho-automation-suite/src/currency_exchange/run_daily.sh >> /tmp/zoho_cron.log 2>&1
```

## Configuration

All paths and formats are configurable via `.env`:

| Variable                    | Description                            | Default                        |
| --------------------------- | -------------------------------------- | ------------------------------ |
| `INVOICES_DIR`            | Directory to scan for invoice PDFs     | `./data/invoices`            |
| `INVOICES_ARCHIVE_DIR`    | Archive for processed invoices         | `./data/invoices/archive`    |
| `PAYMENTS_SUMMARY_DIR`    | Payment summary CSV location           | `./data/payments_summary`    |
| `BANK_PAYMENT_UPLOAD_DIR` | Bank upload XLSX location              | `./data/bank_payment_upload` |
| `BANK_ADVICE_FORMAT`      | Credit/Debit advice text format        | `Inv pay {invoice_number}`   |
| `TARGET_CURRENCIES`       | Currencies to update (comma-separated) | `USD,AUD,EUR,GBP`            |
| `GEMINI_MODEL`            | Google Gemini model to use             | `gemini-2.5-flash`           |

## How It Works

1. **Invoice Upload**: Place PDF invoices in the `invoices` directory
2. **AI Extraction**: Gemini AI extracts vendor details, amounts, taxes, and line items
3. **Smart Mapping**:
   - Matches vendor by GST or name
   - Maps line items to appropriate expense accounts
   - Applies correct tax IDs (GST/IGST) based on location
   - Applies TDS if configured for the vendor
4. **Draft Creation**: Creates a draft bill in Zoho Books with the original PDF attached
5. **Archival**: Moves processed invoice to archive folder
6. **Payment Files**: Generate bank-ready payment files for all unpaid bills

## Project Structure

```
.
├── src/
│   ├── invoice_processing/
│   │   ├── index.ts          # Main invoice processing script
│   │   ├── parser/
│   │   │   └── pdf-parser.ts # AI-powered PDF extraction
│   │   └── zoho/
│   │       └── zoho-client.ts # Zoho Books API client
│   ├── currency_exchange/
│   │   ├── fetch_icegate_rates.py   # ICEGATE rate fetcher
│   │   ├── update_zoho_rates.py     # Zoho Books rate updater
│   │   ├── run_automation.py        # Orchestrator
│   │   ├── run_daily.sh             # Shell wrapper for cron
│   │   └── icegate_rates.json       # Latest fetched rates (auto-generated)
│   └── payment_automation/
│       ├── generate-bank-payment.ts # Bank payment file generator
│       └── generate-payments-csv.ts # Payment summary CSV generator
├── Zoho Automation Case Study/ # Documentation package
│   ├── zoho_automation_case_study.md
│   ├── case_study_invoice_processing.md
│   ├── case_study_currency_automation.md
│   ├── case_study_payment_automation.md
│   ├── case_study_package_guide.md
│   ├── visual_assets_guide.md
│   └── visuals/              # Infographics & charts
├── data/                     # Runtime data (gitignored)
│   ├── invoices/             # PDF invoices to process
│   ├── payments/             # Payment records
│   ├── payments_summary/     # Generated payment summaries
│   └── bank_payment_upload/  # Bank upload files
├── setup-org.ts              # Organization setup utility
├── .env.example              # Environment variables template
├── README.md
└── package.json
```

## Troubleshooting

### "Vendor not found"

- The system will now **automatically prompt** you to create the vendor if not found
- Review the extracted details (Name, GST, PAN, Email, Phone, Address) before confirming
- Type `y` to create the vendor automatically, or `n` to skip
- Bank details are saved in the vendor's notes field for reference

### TDS Not Applied

- Verify TDS settings are configured in the vendor's Zoho Books profile
- Check `tds_tax_id` and `tds_tax_percentage` fields

### AI Extraction Issues

- For scanned/image invoices, ensure they are clear and readable
- Try switching to a different Gemini model via `GEMINI_MODEL` in `.env`
- Use `--dry-run` to debug extraction issues

## Security

⚠️ **Important**: Never commit your `.env` file to version control. It contains sensitive credentials.

The `.gitignore` file is already configured to exclude:

- `.env` files
- API keys
- Generated output files
- Temporary files

## License

MIT

## Support

For issues and feature requests, please use the GitHub issue tracker.
