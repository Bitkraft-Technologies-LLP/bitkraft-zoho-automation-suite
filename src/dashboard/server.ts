import express from "express";
import cors from "cors";
import multer from "multer";
import path from "path";
import fs from "fs";
import { spawn } from "child_process";
import dotenv from "dotenv";
import { ZohoClient } from "../invoice_processing/zoho/zoho-client";
import { extractTextFromPDF, parseInvoiceWithAI } from "../invoice_processing/parser/pdf-parser";

// Load environment variables
dotenv.config();

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

  return {
    invoicesDir,
    archiveDir,
    paymentsSummaryDir,
    bankPaymentUploadDir,
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
      const zoho = new ZohoClient();
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

    const zoho = new ZohoClient();
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

    const pdfBuffer = fs.readFileSync(filePath);

    // Get Configuration
    const [accounts, taxes, vendors] = await Promise.all([
      zoho.getAccounts(),
      zoho.getTaxes(),
      zoho.getVendors(),
    ]);

    // AI parse (dry-run, extracts details)
    const billData = await parseInvoiceWithAI(text, { accounts, taxes, pdfBuffer, orgGst, orgName, orgState });

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

    res.json({
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
          bankDetails: billData.vendor_bank_details || null,
        }
      }
    });

  } catch (error: any) {
    console.error("[Dashboard] Extraction Error:", error);
    res.status(500).json({ error: error.message || "Failed to extract invoice data" });
  }
});

// Create Vendor API
app.post("/api/invoices/create-vendor", async (req, res) => {
  try {
    const vendorData = req.body;
    const zoho = new ZohoClient();

    console.log(`[Dashboard] Creating vendor in Zoho: ${vendorData.name}`);

    // Reconstruct address for Zoho
    const billingAddress = {
      address: vendorData.address || "",
      city: vendorData.city || "",
      state: vendorData.state || "",
      zip: vendorData.zip || "",
      country: "India",
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

    const newVendorPayload = {
      contact_name: vendorData.name,
      company_name: vendorData.name,
      gst_no: vendorData.gst,
      gst_treatment: vendorData.gst ? "business_gst" : "business_none",
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

    const zoho = new ZohoClient();
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
      return item;
    });

    const finalBillData: any = {
      vendor_id: billPayload.vendor_id,
      bill_number: billPayload.bill_number,
      date: billPayload.date,
      due_date: billPayload.due_date,
      line_items: processedLineItems,
      is_reverse_charge_applied: false,
      status: "draft"
    };

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
    const zoho = new ZohoClient();
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
// START SERVER
// ============================================================================
app.listen(PORT, () => {
  console.log(`\n=============================================================`);
  console.log(`🤖 Zoho Books Automation Dashboard running at:`);
  console.log(`   👉 http://localhost:${PORT}`);
  console.log(`=============================================================\n`);
  ensureDirectories();
});
