import express from "express";
import cors from "cors";
import multer from "multer";
import path from "path";
import fs from "fs";
import { spawn } from "child_process";
import dotenv from "dotenv";
import * as XLSX from "xlsx";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { ZohoClient } from "../invoice_processing/zoho/zoho-client";
import { extractTextFromPDF, parseInvoiceWithAI } from "../invoice_processing/parser/pdf-parser";
import { ensureUnlockedPDF } from "../invoice_processing/parser/pdf-decryptor";
import { runEmailSync, setSyncLogger } from "../invoice_processing/email-processor";
import { runPaymentEmailSync } from "../invoice_processing/payment-email-processor";
import { NotificationStore } from "../payment_automation/notification-store";
import { NotificationService } from "../payment_automation/notification-service";
import { loadBankStatement } from "../payment_automation/statement-parser";
import { PaymentMatcher } from "../payment_automation/payment-matcher";

// Load environment variables
dotenv.config();

let zohoInstance: ZohoClient | null = null;
function getZoho(): ZohoClient {
  if (!zohoInstance) {
    zohoInstance = new ZohoClient();
  }
  return zohoInstance;
}

const app = express();
const PORT = process.env.DASHBOARD_PORT || 3000;

app.use(cors());
app.use(express.json());

// Set up server static files to serve the frontend SPA
app.use(express.static(path.join(__dirname, "public")));

function cleanEnvPath(envVal: string | undefined, defaultVal: string): string {
  if (!envVal) return path.resolve(process.cwd(), defaultVal);
  const cleaned = envVal.replace(/^["']|["']$/g, "").trim();
  return path.resolve(process.cwd(), cleaned);
}

// Read workflow paths from .env dynamically
function getPaths() {
  const invoicesDir = cleanEnvPath(process.env.INVOICES_DIR, "./data/invoices");
  let archiveDir = "";
  const rawArchive = process.env.INVOICES_ARCHIVE_DIR ? process.env.INVOICES_ARCHIVE_DIR.replace(/^["']|["']$/g, "").trim() : "";
  if (rawArchive && path.isAbsolute(rawArchive)) {
    archiveDir = rawArchive;
  } else {
    archiveDir = path.join(invoicesDir, "archive");
  }
  const paymentsSummaryDir = cleanEnvPath(process.env.PAYMENTS_SUMMARY_DIR, "./data/payments_summary");
  const bankPaymentUploadDir = cleanEnvPath(process.env.BANK_PAYMENT_UPLOAD_DIR, "./data/bank_payment_upload");
  const bankStatementsDir = cleanEnvPath(process.env.BANK_STATEMENTS_DIR, "./data/bank_statements");

  return {
    invoicesDir,
    archiveDir,
    paymentsSummaryDir,
    bankPaymentUploadDir,
    bankStatementsDir,
  };
}

// Ensure essential directories exist
function ensureDirectories() {
  const paths = getPaths();
  Object.values(paths).forEach((p) => {
    if (!fs.existsSync(p)) {
      fs.mkdirSync(p, { recursive: true });
    }
  });
}

// Setup multer for multi-part file uploads directly into INVOICES_DIR
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    ensureDirectories();
    cb(null, getPaths().invoicesDir);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const cleanName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, "_");
    cb(null, `${timestamp}_${cleanName}`);
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/pdf" || file.originalname.toLowerCase().endsWith(".pdf")) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF files are allowed"));
    }
  },
});

// Favicon handler
app.get("/favicon.ico", (req, res) => res.status(204).end());

// ============================================================================
// 1. SYSTEM STATUS API
// ============================================================================
app.get("/api/status", async (req, res) => {
  try {
    const geminiKeyExists = !!process.env.GEMINI_API_KEY;
    const geminiModel = process.env.GEMINI_MODEL || "gemini-1.5-flash";
    
    let zohoConnected = false;
    let orgName = "Not Connected";
    let orgGst = "N/A";
    let orgState = "N/A";

    try {
      const zoho = getZoho();
      const org = await zoho.getOrganization();
      if (org) {
        zohoConnected = true;
        orgName = org.name || "Your Organization";
        orgGst = org.tax_settings?.tax_reg_no || "";
        orgState = org.address?.state || "";
      }
    } catch (e: any) {
      console.warn("Zoho status check failed:", e.message);
    }

    res.json({
      status: "online",
      zoho: {
        connected: zohoConnected,
        organizationName: orgName,
        gstNumber: orgGst,
        state: orgState,
      },
      gemini: {
        keyConfigured: geminiKeyExists,
        model: geminiModel,
      },
      paths: {
        invoicesDir: process.env.INVOICES_DIR || "./data/invoices",
        archiveDir: process.env.INVOICES_ARCHIVE_DIR || "./data/invoices/archive",
        paymentsSummaryDir: process.env.PAYMENTS_SUMMARY_DIR || "./data/payments_summary",
        bankPaymentUploadDir: process.env.BANK_PAYMENT_UPLOAD_DIR || "./data/bank_payment_upload",
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// 2. CONFIGURATION API
// ============================================================================
app.get("/api/config", (req, res) => {
  try {
    // Redact secret variables for security
    const secureEnv: Record<string, string> = {};
    const allowedKeys = [
      "ZOHO_ORG_GST",
      "ZOHO_ORG_NAME",
      "ZOHO_ORG_STATE",
      "INVOICES_DIR",
      "INVOICES_ARCHIVE_DIR",
      "PAYMENTS_SUMMARY_DIR",
      "BANK_PAYMENT_UPLOAD_DIR",
      "BANK_ADVICE_FORMAT",
      "TARGET_CURRENCIES",
      "GEMINI_MODEL",
      "ZOHO_REGION"
    ];

    allowedKeys.forEach((key) => {
      secureEnv[key] = process.env[key] || "";
    });

    res.json(secureEnv);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/config", (req, res) => {
  try {
    const configData = req.body;
    const envPath = path.resolve(process.cwd(), ".env");
    
    if (!fs.existsSync(envPath)) {
      return res.status(404).json({ error: ".env file not found in project root" });
    }

    let envContent = fs.readFileSync(envPath, "utf8");

    // Overwrite or append variables
    Object.keys(configData).forEach((key) => {
      const val = configData[key];
      // Skip if key is empty and not standard editable configs
      const regex = new RegExp(`^${key}=.*$`, "m");
      if (envContent.match(regex)) {
        envContent = envContent.replace(regex, `${key}="${val}"`);
      } else {
        envContent += `\n${key}="${val}"`;
      }
      
      // Dynamically update process.env for runtime immediate effect
      process.env[key] = val;
    });

    fs.writeFileSync(envPath, envContent.trim() + "\n");
    zohoInstance = null; // Clear cached instance so new env values are loaded
    ensureDirectories(); // make sure folders exist if they were changed
    
    res.json({ success: true, message: "Configuration updated successfully in .env" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// 3. INVOICE MANAGER APIS
// ============================================================================

// Serves the PDF file so frontend iframe can view it
app.get("/api/invoices/file/:filename", (req, res) => {
  try {
    const filename = req.params.filename;
    const isArchived = req.query.archived === "true";
    const { invoicesDir, archiveDir } = getPaths();
    
    const targetDir = isArchived ? archiveDir : invoicesDir;
    const filePath = path.join(targetDir, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "File not found" });
    }

    res.contentType("application/pdf");
    res.sendFile(filePath, { dotfiles: "allow" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/invoices", (req, res) => {
  try {
    ensureDirectories();
    const { invoicesDir, archiveDir } = getPaths();

    // Read pending PDFs
    const pendingFiles = fs.readdirSync(invoicesDir)
      .filter((file) => file.toLowerCase().endsWith(".pdf"))
      .map((file) => {
        const stats = fs.statSync(path.join(invoicesDir, file));
        return {
          filename: file,
          sizeBytes: stats.size,
          createdAt: stats.mtime,
          isArchived: false,
        };
      });

    // Read archived PDFs
    let archivedFiles: any[] = [];
    if (fs.existsSync(archiveDir)) {
      archivedFiles = fs.readdirSync(archiveDir)
        .filter((file) => file.toLowerCase().endsWith(".pdf"))
        .map((file) => {
          const stats = fs.statSync(path.join(archiveDir, file));
          return {
            filename: file,
            sizeBytes: stats.size,
            createdAt: stats.mtime,
            isArchived: true,
          };
        });
    }

    res.json({
      pending: pendingFiles.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
      archived: archivedFiles.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/invoices/upload", upload.array("invoices"), (req, res) => {
  try {
    res.json({ success: true, message: "Files uploaded successfully" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.delete("/api/invoices/:filename", (req, res) => {
  try {
    const { invoicesDir } = getPaths();
    const filePath = path.join(invoicesDir, req.params.filename);

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return res.json({ success: true, message: "File deleted successfully" });
    }

    res.status(404).json({ error: "File not found" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// AI Dry-run Parsing Endpoint
// AI Dry-run Parsing Endpoint
app.post("/api/invoices/extract", async (req, res) => {
  try {
    const { filename } = req.body;
    if (!filename) {
      return res.status(400).json({ error: "Filename is required" });
    }

    const { invoicesDir } = getPaths();
    const filePath = path.join(invoicesDir, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "File not found" });
    }

    // Set headers for streaming NDJSON
    res.setHeader("Content-Type", "application/x-ndjson");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    res.write(JSON.stringify({ step: "text_extract", message: "Extracting text structure from PDF..." }) + "\n");

    const zoho = getZoho();
    zoho.clearVendorsCache();
    const orgGst = process.env.ZOHO_ORG_GST;
    const orgName = process.env.ZOHO_ORG_NAME || "Your Organization";
    const orgState = process.env.ZOHO_ORG_STATE;

    console.log(`[Dashboard] AI Extraction triggered for: ${filename}`);

    let text = "";
    try {
      text = await extractTextFromPDF(filePath);
    } catch (e) {
      console.warn("Text extraction failed, falling back to vision.");
    }

    res.write(JSON.stringify({ step: "zoho_config", message: "Fetching active Zoho Chart of Accounts, Taxes, and Contacts..." }) + "\n");

    const pdfBuffer = fs.readFileSync(filePath);

    // Get Configuration
    const [accounts, taxes, vendors] = await Promise.all([
      zoho.getAccounts(),
      zoho.getTaxes(),
      zoho.getVendors(),
    ]);

    res.write(JSON.stringify({ step: "gemini_parse", message: "Sending content to Gemini AI for schema layout mapping..." }) + "\n");

    // AI parse (dry-run, extracts details)
    const billData = await parseInvoiceWithAI(text, { accounts, taxes, pdfBuffer, orgGst, orgName, orgState });

    res.write(JSON.stringify({ step: "vendor_match", message: "Verifying extracted GSTIN and vendor profile in Zoho..." }) + "\n");

    // Validate/Match Vendor in database
    let vendorMatch = null;
    if (billData.vendor_gst) {
      const normalizedGst = billData.vendor_gst.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
      vendorMatch = vendors.find((v: any) => {
        const vGst = (v.gst_no || "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
        return vGst && vGst === normalizedGst;
      });
    }

    if (!vendorMatch && billData.vendor_name) {
      vendorMatch = vendors.find((v: any) =>
        v.company_name.toLowerCase().includes(billData.vendor_name.toLowerCase())
      );
    }

    res.write(JSON.stringify({
      step: "complete",
      data: {
        billData,
        accounts: accounts.map((a: any) => ({ id: a.account_id, name: a.account_name })),
        taxes: taxes.map((t: any) => ({ id: t.tax_id, name: t.tax_name, rate: t.tax_percentage, spec: t.tax_specification })),
        vendorStatus: {
          matched: !!vendorMatch,
          vendor: vendorMatch || null,
          suggestedVendor: vendorMatch ? null : {
            name: billData.vendor_name,
            gst: billData.vendor_gst || "",
            pan: billData.vendor_pan || "",
            phone: billData.vendor_phone || "",
            email: billData.vendor_email || "",
            address: typeof billData.vendor_address === "string" ? billData.vendor_address : (billData.vendor_address?.street || ""),
            city: billData.vendor_address?.city || "",
            state: billData.vendor_address?.state || "",
            zip: billData.vendor_address?.zip || "",
            country: (typeof billData.vendor_address !== "string" && billData.vendor_address?.country) || "",
            bankDetails: billData.vendor_bank_details || null,
          }
        }
      }
    }) + "\n");
    res.end();

  } catch (error: any) {
    console.error("[Dashboard] Extraction Error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || "Failed to extract invoice data" });
    } else {
      res.write(JSON.stringify({ step: "error", message: error.message || "Failed to extract invoice data" }) + "\n");
      res.end();
    }
  }
});

// Sync Invoices from Email API (SSE Stream)
app.get("/api/invoices/email-sync", async (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
  });

  const sendSSE = (data: string) => {
    if (!data) return;
    const lines = String(data).split(/\r?\n/);
    for (const l of lines) {
      if (l.trim().length > 0) {
        res.write(`data: ${l}\n`);
      }
    }
    res.write("\n");
  };

  sendSSE("Connecting to Microsoft Graph API...");

  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;

  const formatArg = (arg: any) => {
    if (typeof arg === "object") {
      try {
        return JSON.stringify(arg, null, 2);
      } catch {
        return String(arg);
      }
    }
    return String(arg);
  };

  console.log = function (...args: any[]) {
    const msg = args.map(formatArg).join(" ");
    originalLog.apply(console, args);
    sendSSE(msg);
  };

  console.error = function (...args: any[]) {
    const msg = args.map(formatArg).join(" ");
    originalError.apply(console, args);
    sendSSE(`❌ ERROR: ${msg}`);
  };

  console.warn = function (...args: any[]) {
    const msg = args.map(formatArg).join(" ");
    originalWarn.apply(console, args);
    sendSSE(`⚠️ WARNING: ${msg}`);
  };

  try {
    const zoho = getZoho();
    const isDryRun = req.query.dryRun === "true";

    const summary = await runEmailSync(zoho, { dryRun: isDryRun });
    
    sendSSE(`SUCCESS: Email sync finished. Ingested: ${summary.processed}, Bills Recorded: ${summary.billsCreated}, Failed: ${summary.failures}`);
    res.write("event: end\ndata: \n\n");
  } catch (error: any) {
    sendSSE(`ERROR: ${error.message}`);
    res.write("event: end\ndata: \n\n");
  } finally {
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
    setSyncLogger(null);
    res.end();
  }
});

// Create Vendor API
app.post("/api/invoices/create-vendor", async (req, res) => {
  try {
    const vendorData = req.body;
    const zoho = getZoho();

    console.log(`[Dashboard] Creating vendor in Zoho: ${vendorData.name}`);

    // Reconstruct address for Zoho
    const billingAddress = {
      address: vendorData.address || "",
      city: vendorData.city || "",
      state: vendorData.state || "",
      zip: vendorData.zip || "",
      country: vendorData.country || "India",
    };

    // Contacts
    const contactPersons = [];
    if (vendorData.email || vendorData.phone) {
      contactPersons.push({
        first_name: vendorData.name,
        email: vendorData.email || "",
        phone: vendorData.phone || "",
        is_primary: true,
      });
    }

    // Bank Notes
    let notes = "";
    if (vendorData.bankDetails) {
      const b = vendorData.bankDetails;
      notes = `Bank Details:\nAccount: ${b.account_number || "N/A"}\nIFSC: ${b.ifsc_code || "N/A"}\nBank: ${b.bank_name || "N/A"}`;
    }

    const country = billingAddress.country;
    const isOverseas = (country && country.toLowerCase() !== "india" && country.toLowerCase() !== "in") ||
                       (vendorData.gst && vendorData.gst.startsWith("99"));
    let gstTreatment = "business_none";
    if (isOverseas) {
      gstTreatment = "overseas";
    } else if (vendorData.gst) {
      gstTreatment = "business_gst";
    }

    const newVendorPayload = {
      contact_name: vendorData.name,
      company_name: vendorData.name,
      gst_no: vendorData.gst,
      gst_treatment: gstTreatment,
      pan_no: vendorData.pan || "",
      billing_address: billingAddress,
      contact_persons: contactPersons,
      notes: notes.trim(),
    };

    const createdVendor = await zoho.createVendor(newVendorPayload);
    res.json({ success: true, vendor: createdVendor });
  } catch (error: any) {
    console.error("[Dashboard] Vendor Creation Error:", error.response?.data || error.message);
    res.status(500).json({ error: error.response?.data?.message || error.message });
  }
});
// Approve & Push Bill API
app.post("/api/invoices/approve", async (req, res) => {
  try {
    const { filename, billPayload } = req.body;
    if (!filename || !billPayload) {
      return res.status(400).json({ error: "Filename and billPayload are required" });
    }

    const { invoicesDir, archiveDir } = getPaths();
    const filePath = path.join(invoicesDir, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "Invoice file not found" });
    }

    const zoho = getZoho();
    console.log(`[Dashboard] Creating bill in Zoho for vendor ID: ${billPayload.vendor_id}`);

    // Fetch full vendor details to check GST treatment and TDS settings
    let fullVendor: any = null;
    try {
      fullVendor = await zoho.getVendor(billPayload.vendor_id);
    } catch (err) {
      console.warn("⚠️ Failed to fetch detailed vendor profile. Using defaults.");
    }

    const gstTreatment = fullVendor?.gst_treatment || (billPayload.vendor_gst ? "business_gst" : "business_none");
    const isComposition = gstTreatment === "business_registered_composition";
    const isTaxable = gstTreatment === "business_gst" || gstTreatment === "overseas";

    // Modify line items based on GST treatment
    const processedLineItems = billPayload.line_items.map((item: any) => {
      if (isComposition || !isTaxable) {
        const { tax_id, ...itemWithoutTax } = item;
        return itemWithoutTax;
      }
      // If vendor is overseas (import of services), map tax_id to reverse_charge_tax_id
      if (gstTreatment === "overseas" && item.tax_id) {
        return {
          ...item,
          reverse_charge_tax_id: item.tax_id
        };
      }
      return item;
    });

    const finalBillData: any = {
      vendor_id: billPayload.vendor_id,
      bill_number: billPayload.bill_number,
      date: billPayload.date,
      due_date: billPayload.due_date,
      line_items: processedLineItems,
      is_reverse_charge_applied: gstTreatment === "overseas",
      status: "draft"
    };

    if (billPayload.currency_code && billPayload.currency_code.toUpperCase() !== "INR") {
      finalBillData.currency_code = billPayload.currency_code.toUpperCase();
      finalBillData.exchange_rate = getExchangeRate(billPayload.currency_code);
    }

    // Apply TDS Deduction if configured
    if (fullVendor?.tds_tax_id && fullVendor?.tds_tax_percentage) {
      const subTotal = billPayload.line_items.reduce(
        (sum: number, item: any) => sum + Number(item.rate) * (Number(item.quantity) || 1),
        0
      );
      const tdsAmount = (subTotal * Number(fullVendor.tds_tax_percentage)) / 100;
      finalBillData.tds_tax_id = fullVendor.tds_tax_id;
      finalBillData.tds_amount = tdsAmount;
      console.log(`[Dashboard] Applied TDS Amount: ₹${tdsAmount}`);
    }

    // Create Draft Bill
    let result: any;
    try {
      result = await zoho.createBill(finalBillData);
    } catch (err: any) {
      if (err.response?.data?.code === 1016) {
        console.warn(`[Dashboard] Zoho Error 1016: Invalid TDS date. Retrying WITHOUT TDS...`);
        const { tds_tax_id, tds_amount, ...dataWithoutTDS } = finalBillData;
        result = await zoho.createBill(dataWithoutTDS);
      } else {
        throw err;
      }
    }

    const billId = result.bill.bill_id;
    console.log(`[Dashboard] Zoho Draft Bill created: ${billId}`);

    // Upload attachment
    await zoho.uploadAttachment(billId, filePath);
    console.log("[Dashboard] File attached successfully");

    // Archive file
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").split("T")[0];
    const archivePath = path.join(archiveDir, `${timestamp}_${filename}`);
    fs.renameSync(filePath, archivePath);
    console.log(`[Dashboard] Archived invoice to: ${archivePath}`);

    res.json({ success: true, bill: result.bill });
  } catch (error: any) {
    console.error("[Dashboard] Push Bill Error:", error.response?.data || error.message);
    res.status(500).json({ error: error.response?.data?.message || error.message });
  }
});

// ============================================================================
// 4. ICEGATE CURRENCY SCALER APIS
// ============================================================================
app.get("/api/currency/rates", (req, res) => {
  try {
    const ratesPath = path.resolve(process.cwd(), "src/currency_exchange/icegate_rates.json");
    if (fs.existsSync(ratesPath)) {
      const data = JSON.parse(fs.readFileSync(ratesPath, "utf8"));
      return res.json(data);
    }
    res.status(404).json({ error: "No rates found. Run the scraper first." });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Streams process log output back to the frontend in real time using EventSource
app.get("/api/currency/run", async (req, res) => {
  const date = req.query.date as string;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  res.write("data: Starting ICEGATE Currency update...\n\n");

  let accessToken = "";
  try {
    const zoho = getZoho();
    accessToken = await zoho.getAccessToken();
    res.write("data: Successfully acquired pre-fetched Zoho access token.\n\n");
  } catch (err: any) {
    res.write(`data: Warning: Failed to pre-fetch Zoho access token: ${err.message}. Will fall back to standard Python OAuth flow.\n\n`);
  }

  const args = ["src/currency_exchange/run_automation.py"];
  if (date) {
    args.push("--date", date);
    res.write(`data: Target Date specified: ${date}\n\n`);
  }

  const pythonProcess = spawn("python3", args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ZOHO_ACCESS_TOKEN: accessToken,
    },
  });

  pythonProcess.stdout.on("data", (data) => {
    const lines = data.toString().split("\n");
    lines.forEach((line: string) => {
      if (line.trim()) {
        res.write(`data: ${line}\n\n`);
      }
    });
  });

  pythonProcess.stderr.on("data", (data) => {
    const lines = data.toString().split("\n");
    lines.forEach((line: string) => {
      if (line.trim()) {
        res.write(`data: stderr: ${line}\n\n`);
      }
    });
  });

  pythonProcess.on("close", (code) => {
    res.write(`data: SUCCESS: Exchange Rates process finished with status code ${code}.\n\n`);
    res.write("event: end\ndata: \n\n");
    res.end();
  });
});

// ============================================================================
// 5. PAYMENT AUTOMATION APIS
// ============================================================================
app.get("/api/payment/files", (req, res) => {
  try {
    ensureDirectories();
    const { paymentsSummaryDir, bankPaymentUploadDir } = getPaths();

    const summaries = fs.existsSync(paymentsSummaryDir)
      ? fs.readdirSync(paymentsSummaryDir)
          .filter((f) => f.endsWith(".csv"))
          .map((f) => {
            const stats = fs.statSync(path.join(paymentsSummaryDir, f));
            return { filename: f, sizeBytes: stats.size, createdAt: stats.mtime };
          })
      : [];

    const uploads = fs.existsSync(bankPaymentUploadDir)
      ? fs.readdirSync(bankPaymentUploadDir)
          .filter((f) => f.endsWith(".xlsx"))
          .map((f) => {
            const stats = fs.statSync(path.join(bankPaymentUploadDir, f));
            return { filename: f, sizeBytes: stats.size, createdAt: stats.mtime };
          })
      : [];

    res.json({
      summaries: summaries.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
      uploads: uploads.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint to run the payment generator
app.get("/api/payment/generate", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  res.write("data: Fetching unpaid invoices and generating bank files...\n\n");

  const args = ["src/payment_automation/generate-bank-payment.ts"];
  const nodeProcess = spawn("npx", ["ts-node", ...args], { cwd: process.cwd() });

  nodeProcess.stdout.on("data", (data) => {
    const lines = data.toString().split("\n");
    lines.forEach((line: string) => {
      if (line.trim()) {
        res.write(`data: ${line}\n\n`);
      }
    });
  });

  nodeProcess.stderr.on("data", (data) => {
    const lines = data.toString().split("\n");
    lines.forEach((line: string) => {
      if (line.trim()) {
        res.write(`data: stderr: ${line}\n\n`);
      }
    });
  });

  nodeProcess.on("close", (code) => {
    res.write(`data: SUCCESS: Bank Payments sheets generated successfully (Exit code ${code}).\n\n`);
    res.write("event: end\ndata: \n\n");
    res.end();
  });
});

// File download handler
app.get("/api/payment/download/:type/:filename", (req, res) => {
  try {
    const { type, filename } = req.params;
    const { paymentsSummaryDir, bankPaymentUploadDir } = getPaths();
    
    let targetDir = "";
    if (type === "summary") {
      targetDir = paymentsSummaryDir;
    } else if (type === "upload") {
      targetDir = bankPaymentUploadDir;
    } else {
      return res.status(400).json({ error: "Invalid type requested" });
    }

    const filePath = path.join(targetDir, filename);
    console.log(`[Download Diagnostic] Type: ${type}, Filename: ${filename}, TargetDir: ${targetDir}, FullPath: ${filePath}`);
    if (!fs.existsSync(filePath)) {
      console.warn(`[Download Diagnostic] File DOES NOT exist at: ${filePath}`);
      return res.status(404).json({ error: "File not found" });
    }

    console.log(`[Download Diagnostic] File exists at: ${filePath}. Initiating res.download...`);
    res.download(filePath, filename, { dotfiles: "allow" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// 6. BANK STATEMENT RECONCILIATION & PAYMENT AUTOMATION APIS
// ============================================================================

// Multer storage for bank statements
const statementStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    ensureDirectories();
    cb(null, getPaths().bankStatementsDir);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const cleanName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, "_");
    cb(null, `statement_${timestamp}_${cleanName}`);
  },
});

const uploadStatement = multer({
  storage: statementStorage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === ".csv" || ext === ".xlsx" || ext === ".xls" || ext === ".pdf") {
      cb(null, true);
    } else {
      cb(new Error("Only CSV, Excel (.xlsx, .xls), and PDF bank statement files are allowed"));
    }
  },
});

// Parse dates dynamically from spreadsheet cells
function formatDate(val: any): string {
  const today = (new Date().toISOString().split("T")[0]) as string;
  if (!val) return today;
  
  if (val instanceof Date) {
    return (val.toISOString().split("T")[0]) as string;
  }

  // Excel serial date number
  if (typeof val === "number") {
    try {
      const dateObj = XLSX.SSF.parse_date_code(val);
      if (dateObj) {
        const year = dateObj.y;
        const month = String(dateObj.m).padStart(2, "0");
        const day = String(dateObj.d).padStart(2, "0");
        return `${year}-${month}-${day}`;
      }
    } catch (e) {
      // Fallback
    }
  }

  let str = String(val).trim();
  if (str.includes(" ")) {
    str = (str.split(" ")[0]) as string;
  }

  // Match DD/MM/YYYY or DD-MM-YYYY
  const dmyMatch = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmyMatch && dmyMatch[1] && dmyMatch[2] && dmyMatch[3]) {
    const day = dmyMatch[1].padStart(2, "0");
    const month = dmyMatch[2].padStart(2, "0");
    const year = dmyMatch[3];
    return `${year}-${month}-${day}`;
  }

  // Match YYYY/MM/DD or YYYY-MM-DD
  const ymdMatch = str.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (ymdMatch && ymdMatch[1] && ymdMatch[2] && ymdMatch[3]) {
    const year = ymdMatch[1];
    const month = ymdMatch[2].padStart(2, "0");
    const day = ymdMatch[3].padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  // Try parsing with native Date
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return (parsed.toISOString().split("T")[0]) as string;
  }

  return today;
}

// Dynamically parses and maps columns in bank statements
function parseBankStatement(filePath: string): any[] {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error("The uploaded bank statement file is empty.");
  }
  const worksheet = workbook.Sheets[sheetName];
  if (!worksheet) {
    throw new Error(`The sheet "${sheetName}" could not be loaded.`);
  }
  const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

  let headerIndex = -1;
  let colMap = {
    date: -1,
    narration: -1,
    amount: -1,
    debit: -1,
    credit: -1,
    ref: -1,
    type: -1
  };

  const narrationKeywords = ["narration", "description", "particular", "remark", "details", "memo", "naration"];
  const dateKeywords = ["date", "dt"];
  const amountKeywords = ["amount", "value", "transaction amount"];
  const debitKeywords = ["debit", "withdrawal", "dr", "outflow", "payment"];
  const creditKeywords = ["credit", "deposit", "cr", "inflow"];
  const refKeywords = ["utr", "ref", "chq", "cheque", "reference", "txn id", "transaction id"];
  const typeKeywords = ["dr/cr", "dr / cr", "type", "d/c", "transaction type"];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;

    const tempMap = { date: -1, narration: -1, amount: -1, debit: -1, credit: -1, ref: -1, type: -1 };

    for (let j = 0; j < row.length; j++) {
      const cellVal = String(row[j] || "").trim().toLowerCase();
      if (!cellVal) continue;

      const isDateCol = cellVal.includes("date") || cellVal === "dt";

      if (isDateCol) {
        if (tempMap.date === -1) {
          tempMap.date = j;
        }
        continue;
      }

      if (narrationKeywords.some(k => cellVal.includes(k)) && tempMap.narration === -1) {
        tempMap.narration = j;
      } else if (typeKeywords.some(k => cellVal === k || cellVal.includes(k)) && tempMap.type === -1) {
        tempMap.type = j;
      } else if (debitKeywords.some(k => cellVal === k || cellVal.includes(k)) && tempMap.debit === -1) {
        if (cellVal.includes("dr") && (cellVal.includes("cr") || cellVal.includes("type") || cellVal.includes("/"))) {
          continue;
        }
        tempMap.debit = j;
      } else if (creditKeywords.some(k => cellVal === k || cellVal.includes(k)) && tempMap.credit === -1) {
        if (cellVal.includes("cr") && (cellVal.includes("dr") || cellVal.includes("type") || cellVal.includes("/"))) {
          continue;
        }
        tempMap.credit = j;
      } else if (amountKeywords.some(k => cellVal === k || cellVal.includes(k)) && tempMap.amount === -1) {
        tempMap.amount = j;
      } else if (refKeywords.some(k => cellVal === k || cellVal.includes(k)) && tempMap.ref === -1) {
        tempMap.ref = j;
      }
    }

    // Match at least date and narration
    if (tempMap.date !== -1 && tempMap.narration !== -1) {
      headerIndex = i;
      colMap = tempMap;
      break;
    }
  }

  if (headerIndex === -1) {
    throw new Error("Could not automatically identify header columns (Date and Narration) in the bank statement.");
  }

  const transactions: any[] = [];
  for (let i = headerIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    const dateVal = colMap.date !== -1 ? row[colMap.date] : null;
    const narrationVal = colMap.narration !== -1 ? row[colMap.narration] : "";
    const refVal = colMap.ref !== -1 ? row[colMap.ref] : "";

    let amount = 0;
    let isDebit = false;

    // Check debit column
    if (colMap.debit !== -1 && row[colMap.debit] !== undefined && row[colMap.debit] !== null && row[colMap.debit] !== "") {
      const dVal = parseFloat(String(row[colMap.debit]).replace(/[^0-9.-]/g, ""));
      if (!isNaN(dVal) && dVal > 0) {
        amount = dVal;
        isDebit = true;
      }
    }

    // Check amount column if debit not resolved
    if (!isDebit && colMap.amount !== -1 && row[colMap.amount] !== undefined && row[colMap.amount] !== null && row[colMap.amount] !== "") {
      const aVal = parseFloat(String(row[colMap.amount]).replace(/[^0-9.-]/g, ""));
      if (!isNaN(aVal)) {
        amount = Math.abs(aVal);
        
        if (aVal < 0) {
          isDebit = true;
        } else if (colMap.type !== -1 && row[colMap.type] !== undefined && row[colMap.type] !== null) {
          const typeVal = String(row[colMap.type]).trim().toUpperCase();
          if (typeVal === "DR" || typeVal === "DEBIT") {
            isDebit = true;
          } else {
            isDebit = false;
          }
        } else {
          let hasCreditVal = false;
          if (colMap.credit !== -1 && row[colMap.credit] !== undefined && row[colMap.credit] !== null && row[colMap.credit] !== "") {
            const cVal = parseFloat(String(row[colMap.credit]).replace(/[^0-9.-]/g, ""));
            if (!isNaN(cVal) && cVal > 0) {
              hasCreditVal = true;
            }
          }
          if (!hasCreditVal) {
            isDebit = true;
          }
        }
      }
    }

    if (narrationVal && isDebit && amount > 0) {
      transactions.push({
        date: formatDate(dateVal),
        narration: String(narrationVal).trim(),
        amount: amount,
        reference: refVal ? String(refVal).trim() : ""
      });
    }
  }

  return transactions;
}

// Fetch active Bank and Cash accounts from Zoho
app.get("/api/payment/bank-accounts", async (req, res) => {
  try {
    const zoho = getZoho();
    const accounts = await zoho.getAccounts();
    const bankAccounts = accounts
      .filter((acc: any) => acc.account_type === "bank" || acc.account_type === "cash")
      .map((acc: any) => ({
        id: acc.account_id,
        name: acc.account_name,
        code: acc.account_code,
        type: acc.account_type
      }));
    res.json(bankAccounts);
  } catch (error: any) {
    console.error("Failed to fetch bank accounts:", error);
    res.status(500).json({ error: error.message });
  }
});

// Fetch unpaid/partially paid bills for manual entry marking
app.get("/api/payment/unpaid-bills", async (req, res) => {
  try {
    const zoho = getZoho();
    const unpaidBills = await zoho.getBills({ status: "unpaid" });
    const partiallyPaidBills = await zoho.getBills({ status: "partially_paid" });
    const allUnpaid = [...unpaidBills, ...partiallyPaidBills];
    
    // De-duplicate by bill_id
    const seenIds = new Set<string>();
    const uniqueBills = allUnpaid.filter((bill: any) => {
      if (seenIds.has(bill.bill_id)) return false;
      seenIds.add(bill.bill_id);
      return true;
    });
    
    uniqueBills.sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime());
    
    res.json(uniqueBills.map((bill: any) => ({
      bill_id: bill.bill_id,
      bill_number: bill.bill_number,
      vendor_name: bill.vendor_name,
      vendor_id: bill.vendor_id,
      total: bill.total,
      balance: bill.balance,
      date: bill.date,
      due_date: bill.due_date
    })));
  } catch (error: any) {
    console.error("Failed to fetch unpaid bills:", error);
    res.status(500).json({ error: error.message });
  }
});

// Fetch unpaid/partially paid Customer Invoices (sales invoices)
app.get("/api/payment/unpaid-customer-invoices", async (req, res) => {
  try {
    const zoho = getZoho();
    const unpaidInvoices = await zoho.getInvoices({ status: "unpaid" });
    const partiallyPaidInvoices = await zoho.getInvoices({ status: "partially_paid" });
    const allUnpaid = [...unpaidInvoices, ...partiallyPaidInvoices];
    
    const seenIds = new Set<string>();
    const uniqueInvoices = allUnpaid.filter((inv: any) => {
      if (seenIds.has(inv.invoice_id)) return false;
      seenIds.add(inv.invoice_id);
      return true;
    });
    
    uniqueInvoices.sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime());
    
    res.json(uniqueInvoices.map((inv: any) => ({
      invoice_id: inv.invoice_id,
      invoice_number: inv.invoice_number,
      customer_name: inv.customer_name,
      customer_id: inv.customer_id,
      total: inv.total,
      balance: inv.balance,
      date: inv.date,
      due_date: inv.due_date
    })));
  } catch (error: any) {
    console.error("Failed to fetch unpaid customer invoices:", error);
    res.status(500).json({ error: error.message });
  }
});

// AI-assisted parsing for PDF bank statements
async function parsePDFBankStatement(filePath: string): Promise<any[]> {
  try {
    // 1. Auto-unlock if password-protected
    await ensureUnlockedPDF(filePath, { filename: path.basename(filePath) });

    // 2. Extract text from PDF
    let text = "";
    try {
      text = await extractTextFromPDF(filePath);
    } catch (e: any) {
      console.warn("Raw PDF text extraction failed:", e.message);
    }

    const buffer = fs.readFileSync(filePath);
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
    const model = genAI.getGenerativeModel({
      model: process.env.GEMINI_MODEL || "gemini-1.5-flash",
      generationConfig: { responseMimeType: "application/json" }
    });

    const prompt = `
      Extract all bank account debit and credit transactions from this bank statement into a structured JSON list.
      For each transaction, determine:
      - date: YYYY-MM-DD
      - narration: Full transaction description / particulars
      - amount: Absolute positive amount as a number
      - type: "debit" (withdrawal/payment) or "credit" (deposit/inflow)
      - reference: UTR number, cheque number, or transaction ID if available
      - vendorName: Payee / vendor name if identified from narration
      - customerName: Remitter / customer name if identified from narration
      - billNumber: Bill or invoice number if identified from narration

      Return JSON format:
      {
        "transactions": [
          {
            "date": "YYYY-MM-DD",
            "narration": "...",
            "amount": 1000.0,
            "type": "debit" | "credit",
            "reference": "...",
            "vendorName": "...",
            "customerName": "...",
            "billNumber": "..."
          }
        ]
      }
      ${text ? `\nExtracted Text Content:\n"""\n${text.slice(0, 10000)}\n"""` : ""}
    `;

    const parts: any[] = [prompt];
    if (buffer) {
      parts.push({
        inlineData: {
          data: buffer.toString("base64"),
          mimeType: "application/pdf"
        }
      });
    }

    const result = await model.generateContent(parts);
    const resText = result.response.text();
    const match = resText.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed.transactions)) {
        return parsed.transactions.map((t: any) => ({
          date: t.date || (new Date().toISOString().split("T")[0] as string),
          narration: t.narration || "",
          amount: Math.abs(Number(t.amount) || 0),
          reference: t.reference || "",
          type: t.type || "debit",
          vendorName: t.vendorName || undefined,
          customerName: t.customerName || undefined,
          billNumber: t.billNumber || undefined,
          source: "statement"
        }));
      }
    }
  } catch (err: any) {
    console.error("Failed to parse PDF bank statement:", err.message);
  }
  return [];
}

// Upload and match bank statement transactions against unpaid bills
app.post("/api/payment/upload-statement", uploadStatement.single("statement"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No statement file uploaded" });
    }

    const filePath = req.file.path;
    const allTransactions = await loadBankStatement(filePath);
    const transactions = allTransactions.filter(t => t.type !== "credit");

    const zoho = getZoho();
    const unpaidBills = await zoho.getBills({ status: "unpaid" });
    const partiallyPaid = await zoho.getBills({ status: "partially_paid" });
    const allUnpaid = [...unpaidBills, ...partiallyPaid];

    const { matches: rawMatches, unmatched } = PaymentMatcher.matchTransactions(transactions, allUnpaid);

    const matches = rawMatches.map(m => ({
      transaction: m.transaction,
      bill: m.bill,
      matchStatus: (m.confidence === "EXACT" || m.confidence === "HIGH") ? "exact" : "amount_mismatch",
      reason: m.reason
    }));

    res.json({
      success: true,
      filename: req.file.originalname,
      matches,
      unmatchedCount: unmatched.length,
      unmatched
    });
  } catch (error: any) {
    console.error("Statement upload error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Reconcile and record multiple vendor payments in Zoho Books
app.post("/api/payment/reconcile", async (req, res) => {
  try {
    const { paidThroughAccountId, payments } = req.body;
    
    if (!paidThroughAccountId) {
      return res.status(400).json({ error: "Missing paidThroughAccountId parameter" });
    }
    if (!payments || !Array.isArray(payments) || payments.length === 0) {
      return res.status(400).json({ error: "Missing or empty payments array" });
    }

    const zoho = getZoho();
    const results: any[] = [];

    for (const payment of payments) {
      const { billId, vendorId, amount, date, referenceNumber, description } = payment;
      
      try {
        const payload = {
          vendor_id: vendorId,
          date: date,
          amount: amount,
          paid_through_account_id: paidThroughAccountId,
          payment_mode: "Bank Transfer",
          reference_number: referenceNumber || "",
          description: description || "Reconciled via statement match",
          bills: [
            {
              bill_id: billId,
              amount_applied: amount
            }
          ]
        };

        const result = await zoho.createVendorPayment(payload);
        const paymentId = result.vendorpayment?.payment_id;
        let emailSent = false;
        let recipientEmail = "";

        if (paymentId) {
          try {
            console.log(`[Reconcile] Triggering automatic email notification for payment ID: ${paymentId}`);
            const notif = await NotificationService.sendNotification(zoho, paymentId);
            emailSent = notif.email_sent;
            recipientEmail = notif.recipient_email;
          } catch (e: any) {
            console.error(`[Reconcile] Notification trigger failed:`, e.message);
          }
        }

        results.push({
          billId,
          success: true,
          paymentId: paymentId || "N/A",
          message: "Payment recorded successfully",
          emailSent,
          recipientEmail
        });
      } catch (err: any) {
        console.error(`Reconciliation failed for bill ID ${billId}:`, err.response?.data || err.message);
        results.push({
          billId,
          success: false,
          error: err.response?.data?.message || err.message
        });
      }
    }

    res.json({ success: true, results });
  } catch (error: any) {
    console.error("Reconciliation execution error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Reconcile and record multiple Customer Payments Received in Zoho Books
app.post("/api/payment/reconcile-customer-payments", async (req, res) => {
  try {
    const { depositAccountId, payments } = req.body;
    
    if (!depositAccountId) {
      return res.status(400).json({ error: "Missing depositAccountId parameter" });
    }
    if (!payments || !Array.isArray(payments) || payments.length === 0) {
      return res.status(400).json({ error: "Missing or empty payments array" });
    }

    const zoho = getZoho();
    const results: any[] = [];

    for (const payment of payments) {
      const { invoiceId, customerId, amount, date, referenceNumber, description } = payment;
      
      try {
        const payload = {
          customer_id: customerId,
          date: date,
          amount: amount,
          account_id: depositAccountId,
          payment_mode: "Bank Transfer",
          reference_number: referenceNumber || "",
          description: description || "Customer payment received via statement/email match",
          invoices: [
            {
              invoice_id: invoiceId,
              amount_applied: amount
            }
          ]
        };

        const result = await zoho.createCustomerPayment(payload);
        const paymentId = result.payment?.payment_id || result.customerpayment?.payment_id;

        results.push({
          invoiceId,
          success: true,
          paymentId: paymentId || "N/A",
          message: "Customer payment recorded successfully"
        });
      } catch (err: any) {
        console.error(`Customer payment reconciliation failed for invoice ID ${invoiceId}:`, err.response?.data || err.message);
        results.push({
          invoiceId,
          success: false,
          error: err.response?.data?.message || err.message
        });
      }
    }

    res.json({ success: true, results });
  } catch (error: any) {
    console.error("Customer payment reconciliation execution error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Scan inbox for payment confirmation/debit emails and auto-record payments
app.post("/api/payment/scan-email-payments", async (req, res) => {
  try {
    const { paidThroughAccountId, dryRun } = req.body;
    const zoho = getZoho();

    let accountId = paidThroughAccountId;
    if (!accountId) {
      const accounts = await zoho.getAccounts();
      const resolved = accounts.find((acc: any) => 
        (acc.account_type === "bank" || acc.account_type === "cash") &&
        (acc.account_name.toLowerCase().includes("kotak") || acc.account_name.includes("5253078611"))
      );
      if (resolved) accountId = resolved.account_id;
    }

    if (!accountId) {
      return res.status(400).json({ error: "Could not resolve bank account ID. Please provide paidThroughAccountId." });
    }

    const summary = await runPaymentEmailSync(zoho, accountId, { dryRun: !!dryRun });
    res.json({ success: true, summary });
  } catch (error: any) {
    console.error("Email payment scan error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// 6. VENDOR PAYMENT EMAIL NOTIFICATIONS API
// ============================================================================

app.get("/api/payment-notifications", async (req, res) => {
  try {
    const { date_start, date_end } = req.query;
    const zoho = getZoho();

    let start = date_start as string;
    if (!start) {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      start = d.toISOString().split("T")[0]!;
    }

    let end = date_end as string;
    if (!end) {
      end = new Date().toISOString().split("T")[0]!;
    }

    const payments = await zoho.getVendorPayments({
      date_start: start,
      date_end: end
    });

    const store = NotificationStore.getAll();

    const records = payments.map((p: any) => {
      const stored = store[p.payment_id] || null;
      return {
        payment_id: p.payment_id,
        payment_number: p.payment_number || p.reference_number || "N/A",
        vendor_name: p.vendor_name,
        vendor_id: p.vendor_id,
        amount: p.amount,
        date: p.date,
        reference_number: p.reference_number || "",
        email_sent: stored ? stored.email_sent : false,
        sent_at: stored?.sent_at || null,
        recipient_email: stored ? stored.recipient_email : (p.vendor_email || "N/A"),
        subject: stored?.subject || "",
        error_message: stored?.error_message || null
      };
    });

    res.json({ success: true, records, schedulerActive: false });
  } catch (error: any) {
    console.error("Failed to fetch payment notifications:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/payment-notifications/send", async (req, res) => {
  try {
    const { paymentId } = req.body;
    if (!paymentId) {
      return res.status(400).json({ error: "Missing paymentId parameter" });
    }

    const zoho = getZoho();
    console.log(`[Dashboard] Manual email notification triggered for payment ID: ${paymentId}`);
    const record = await NotificationService.sendNotification(zoho, paymentId);
    
    res.json({ success: record.email_sent, record });
  } catch (error: any) {
    console.error("Manual send error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/payment-notifications/:paymentId/preview", async (req, res) => {
  try {
    const { paymentId } = req.params;
    if (!paymentId) {
      return res.status(400).json({ error: "Missing paymentId parameter" });
    }

    const zoho = getZoho();
    console.log(`[Dashboard] Fetching email preview for payment ID: ${paymentId}`);
    const template = await zoho.getVendorPaymentEmailContent(paymentId);
    
    // Extract recipient emails
    let toMailIds: string[] = [];
    if (Array.isArray(template.to_mail_ids)) {
      toMailIds = template.to_mail_ids;
    } else if (Array.isArray(template.to_contacts)) {
      const selected = template.to_contacts.filter((c: any) => c.selected);
      const contactsToUse = selected.length > 0 ? selected : template.to_contacts;
      toMailIds = contactsToUse.map((c: any) => c.email).filter(Boolean);
    }
    
    res.json({
      success: true,
      subject: template.subject || "",
      body: template.body || "",
      to_mail_ids: toMailIds
    });
  } catch (error: any) {
    console.error("Preview error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Global error handling middleware (e.g. for Multer file type or size errors)
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error("API Error:", err.message || err);
  res.status(err.status || 400).json({
    error: err.message || "An unexpected error occurred"
  });
});

// ============================================================================
// START SERVER
// ============================================================================
app.listen(PORT, () => {
  console.log(`\n=============================================================`);
  console.log(`🤖 Zoho Books Automation Dashboard running at:`);
  console.log(`   👉 http://localhost:${PORT}`);
  console.log(`=============================================================\n`);
  ensureDirectories();
});

function getExchangeRate(currencyCode: string): number {
  if (!currencyCode || currencyCode.toUpperCase() === "INR") {
    return 1.0;
  }
  try {
    const ratesPath = path.resolve(process.cwd(), "icegate_rates.json");
    if (fs.existsSync(ratesPath)) {
      const data = JSON.parse(fs.readFileSync(ratesPath, "utf8"));
      const detail = data.currencyDetail?.find(
        (c: any) => c.currencyCode?.toUpperCase() === currencyCode.toUpperCase()
      );
      if (detail && detail.cbicImport) {
        return parseFloat(detail.cbicImport);
      }
    }
  } catch (err: any) {
    console.warn("⚠️ Failed to load exchange rate from icegate_rates.json:", err.message);
  }
  
  // Fallback defaults
  if (currencyCode.toUpperCase() === "USD") return 83.5;
  if (currencyCode.toUpperCase() === "EUR") return 91.0;
  if (currencyCode.toUpperCase() === "GBP") return 106.0;
  return 1.0;
}
