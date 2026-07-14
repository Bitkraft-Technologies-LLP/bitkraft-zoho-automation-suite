# Bootstrapping Guide for AI Agents

This document guides you through setting up the repository from scratch—either on your local machine or upon a **fresh clone from git**—and verifying that the environment is fully operational.

---

## 🚀 Fresh Clone onboarding Flow

If this is a fresh checkout of the repository, execute the following steps in sequence:

### Step 1: Install Node.js Dependencies
The core of the automation suite and the dashboard runs on Node.js (v14+ required). Install the npm packages:
```bash
npm install
```
This installs TypeScript, `ts-node`, Express, Axios, Multer, XLSX processing, and the Gemini AI package.

### Step 2: Set Up Python Environment
The Currency Exchange automation module uses Python 3.
1. Check that python is available:
   ```bash
   python3 --version
   ```
2. Create and activate a virtual environment (recommended to prevent global pollution):
   ```bash
   python3 -m venv venv
   source venv/bin/activate
   ```
3. Install the required Python dependencies:
   ```bash
   pip install requests python-dotenv
   ```

### Step 3: Initialize Environment Variables
1. Copy the environment variables template:
   ```bash
   cp .env.example .env
   ```
2. Open `.env` and fill in the placeholders:
   - **Google Gemini API Key**: `GEMINI_API_KEY` (Get one from Google AI Studio).
   - **Zoho Books API Credentials**: Follow the [Zoho Authentication Guide](#zoho-authentication-setup) below to retrieve these.

### Step 4: Run Zoho Organization Setup (First-Time Verification)
Once the credentials are set in `.env`, run the automatic org setup utility. This script verifies connectivity, pulls your Zoho organization profile (Name, GST register, and address state), and saves them back to `.env`:
```bash
npx ts-node setup-org.ts
```
Expected output:
```text
Fetching organization details from Zoho...
Organization Found: Bitkraft Technologies LLP
GST Number: 27AAAAA1111A1Z1
State: Maharashtra

✅ .env file updated with organization details!
```
*If this fails, double check your Zoho API tokens and client credentials in `.env`.*

---

## 🔑 Zoho Authentication Setup

Zoho Books uses OAuth 2.0. To configure API access for a fresh clone:

1. **Register API Client**:
   - Go to [Zoho Developer Console](https://api-console.zoho.com/).
   - Click **Add Client** and select **Server-based Applications**.
   - Set **Client Name** to `Zoho Books Automation Suite`.
   - Set **Homepage URL** to `http://localhost:3000`.
   - Set **Authorized Redirect URIs** to `http://localhost:3000/oauth/callback` or use `https://api-console.zoho.com/`.
   - Copy the generated `ZOHO_CLIENT_ID` and `ZOHO_CLIENT_SECRET`.

2. **Generate Authorization Code**:
   - Paste the following URL into your browser (replace client details and region suffix like `.com` or `.in` depending on your account):
     ```text
     https://accounts.zoho.com/oauth/v2/auth?scope=ZohoBooks.fullaccess.all&client_id=YOUR_CLIENT_ID&state=testing&response_type=code&redirect_uri=YOUR_REDIRECT_URI&access_type=offline&prompt=consent
     ```
   - Approve access and copy the `code=` parameter from the URL you are redirected to.

3. **Get Refresh Token**:
   - Exchange the authorization code for a persistent refresh token using a `POST` request or standard cURL:
     ```bash
     curl -X POST "https://accounts.zoho.com/oauth/v2/token" \
       -d "code=YOUR_AUTHORIZATION_CODE" \
       -d "client_id=YOUR_CLIENT_ID" \
       -d "client_secret=YOUR_CLIENT_SECRET" \
       -d "redirect_uri=YOUR_REDIRECT_URI" \
       -d "grant_type=authorization_code"
     ```
   - Save the `refresh_token` returned in the JSON payload to `ZOHO_REFRESH_TOKEN` in `.env`.

---

## ⚙️ Environment Configuration Reference

The following table documents the properties in your `.env` file:

| Variable | Required? | Purpose / Recommended Value |
| :--- | :--- | :--- |
| `ZOHO_CLIENT_ID` | Yes | OAuth Client ID from Zoho Developer Console |
| `ZOHO_CLIENT_SECRET` | Yes | OAuth Client Secret from Zoho Developer Console |
| `ZOHO_REFRESH_TOKEN` | Yes | Persistent offline token to renew Zoho access tokens |
| `ZOHO_ORGANIZATION_ID`| Yes | Zoho Books Organization ID |
| `ZOHO_REGION` | No | Domain extension: `com` (US), `in` (India), `eu` (Europe). Default `com` |
| `GEMINI_API_KEY` | Yes | Google Gemini API key from AI Studio |
| `GEMINI_MODEL` | No | Gemini Model (e.g., `gemini-2.5-flash` or `gemini-flash-latest`) |
| `ZOHO_ORG_GST` | Auto | GST registration number of your organization |
| `ZOHO_ORG_NAME` | Auto | Organization name |
| `ZOHO_ORG_STATE` | Auto | State (determines IGST vs CGST/SGST matching) |
| `TARGET_CURRENCIES` | No | Comma-separated currencies to sync from ICEGATE (e.g. `USD,AUD,EUR`) |
| `INVOICES_DIR` | No | Directory scanned for raw invoice PDFs (default: `./data/invoices`) |
| `INVOICES_ARCHIVE_DIR`| No | Folder where successfully parsed bills are archived (default: `./data/invoices/archive`) |

---

## 🔍 Initial Sanity Smoke Test

To verify the setup is working without modifying Zoho data, perform a dry run on an invoice:

```bash
# 1. Place a test invoice PDF in the root directory
# 2. Run the processor with the --dry-run flag
npx ts-node src/invoice_processing/index.ts test-invoice.pdf --dry-run
```

If the bootstrapping was successful, you will see the Gemini parsed JSON structure representing the vendor, line items, and taxes, followed by:
```text
[Dry Run] Bill creation skipped.
```
If you see this, your environment is ready to start coding!
