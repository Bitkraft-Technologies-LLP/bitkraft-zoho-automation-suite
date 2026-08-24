import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { EmailClient } from "./email-client";
import { ZohoClient } from "./zoho/zoho-client";
import { processInvoice } from "./index";

dotenv.config();

// Registry to keep track of processed message IDs
class ProcessedEmailRegistry {
  private filePath: string;
  private processedIds: Set<string>;

  constructor() {
    this.filePath = path.resolve(process.cwd(), "data/processed_emails.json");
    this.processedIds = new Set();
    this.load();
  }

  private load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const content = fs.readFileSync(this.filePath, "utf8");
        const list = JSON.parse(content);
        if (Array.isArray(list)) {
          list.forEach(id => this.processedIds.add(id));
        }
      }
    } catch (e: any) {
      console.warn("[Registry] Error loading processed emails database:", e.message);
    }
  }

  public has(id: string): boolean {
    return this.processedIds.has(id);
  }

  public add(id: string) {
    this.processedIds.add(id);
    this.save();
  }

  private save() {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.filePath, JSON.stringify(Array.from(this.processedIds), null, 2), "utf8");
    } catch (e: any) {
      console.error("[Registry] Error saving processed emails registry:", e.message);
    }
  }
}

// Global logger hook for SSE log streaming
let syncLoggerCallback: ((line: string) => void) | null = null;

export function setSyncLogger(callback: ((line: string) => void) | null) {
  syncLoggerCallback = callback;
}

function syncLog(msg: string, ...args: any[]) {
  const formattedArgs = args.map(a => typeof a === "object" ? JSON.stringify(a) : a).join(" ");
  const line = formattedArgs ? `${msg} ${formattedArgs}` : msg;
  console.log(line);
  if (syncLoggerCallback) {
    syncLoggerCallback(line);
  }
}

export interface SyncSummary {
  scanned: number;
  processed: number;
  billsCreated: number;
  skipped: number;
  failures: number;
}

export async function runEmailSync(zoho: ZohoClient, options: { dryRun: boolean }): Promise<SyncSummary> {
  const summary: SyncSummary = {
    scanned: 0,
    processed: 0,
    billsCreated: 0,
    skipped: 0,
    failures: 0
  };

  syncLog(`\n=============================================================`);
  syncLog(`🚀 Starting Office 365 Shared Inbox Ingestion (${options.dryRun ? "DRY-RUN" : "LIVE"})`);
  syncLog(`=============================================================\n`);

  let emailClient: EmailClient;
  try {
    emailClient = new EmailClient();
  } catch (error: any) {
    syncLog(`❌ Init Error: ${error.message}`);
    summary.failures++;
    return summary;
  }

  const registry = new ProcessedEmailRegistry();
  const orgGst = process.env.ZOHO_ORG_GST;
  const orgName = process.env.ZOHO_ORG_NAME || "Your Organization";
  const orgState = process.env.ZOHO_ORG_STATE;

  // Temp folder to write downloaded invoices
  const tempDir = path.resolve(process.cwd(), "data/invoices/temp_email");
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  try {
    syncLog(`[O365 Sync] Fetching unread emails from accounts@bitkraft.co.in...`);
    const messages = await emailClient.getUnreadMessages();
    summary.scanned = messages.length;
    syncLog(`[O365 Sync] Found ${messages.length} unread message(s) with attachments.`);

    for (const msg of messages) {
      const messageId = msg.id;
      const subject = msg.subject || "No Subject";
      const fromEmail = msg.from?.emailAddress?.address || "unknown";

      syncLog(`\n📬 Examining Email: "${subject}" from <${fromEmail}>`);

      if (registry.has(messageId)) {
        syncLog(`⏭️  Skipping message (already processed in registry).`);
        summary.skipped++;
        continue;
      }

      syncLog(`🔍 Fetching attachments for message...`);
      const attachments = await emailClient.getMessageAttachments(messageId);
      const pdfs = attachments.filter(att => 
        att.contentType === "application/pdf" || 
        att.name?.toLowerCase().endsWith(".pdf")
      );

      if (pdfs.length === 0) {
        syncLog(`ℹ️  No PDF attachments found in this email. Skipping.`);
        summary.skipped++;
        // Optionally mark as read to prevent endless scans of non-invoice emails
        if (!options.dryRun) {
          await emailClient.markAsProcessed(messageId);
          registry.add(messageId);
        }
        continue;
      }

      syncLog(`📄 Found ${pdfs.length} PDF invoice attachment(s).`);
      let messageAllSucceeded = true;

      for (const pdf of pdfs) {
        syncLog(`📥 Downloading attachment: ${pdf.name} (${(pdf.size / 1024).toFixed(1)} KB)`);
        
        if (!pdf.contentBytes) {
          syncLog(`❌ Attachment body contentBytes missing!`);
          messageAllSucceeded = false;
          continue;
        }

        const crypto = require("crypto");
        const messageHash = crypto.createHash("md5").update(messageId).digest("hex");
        const cleanPdfName = pdf.name.replace(/[^a-zA-Z0-9.-]/g, "_");
        const maxPdfNameLength = 100 - (messageHash.length + 1) - 10; // extra safety buffer
        const pdfBase = path.basename(cleanPdfName, path.extname(cleanPdfName)).slice(0, maxPdfNameLength);
        const pdfExt = path.extname(cleanPdfName);
        const safeFileName = `${messageHash}_${pdfBase}${pdfExt}`;
        const tempFilePath = path.join(tempDir, safeFileName);
        
        try {
          const buffer = Buffer.from(pdf.contentBytes, "base64");
          fs.writeFileSync(tempFilePath, buffer);
          
          syncLog(`🤖 Passing invoice to Gemini AI and Zoho client...`);
          // autoCreateVendor is set to true
          const success = await processInvoice(tempFilePath, zoho, orgGst, orgName, orgState, options.dryRun, true);
          
          if (success) {
            syncLog(`✅ Successfully recorded invoice: ${pdf.name}`);
            summary.billsCreated++;
          } else {
            syncLog(`❌ Failed to process invoice: ${pdf.name}`);
            messageAllSucceeded = false;
          }
        } catch (e: any) {
          syncLog(`❌ Exception processing attachment ${pdf.name}: ${e.message}`);
          messageAllSucceeded = false;
        } finally {
          // Clean up local temp file
          if (fs.existsSync(tempFilePath)) {
            try {
              fs.unlinkSync(tempFilePath);
            } catch (err: any) {
              console.warn(`[Temp Clean] Failed to remove: ${tempFilePath}`, err.message);
            }
          }
        }
      }

      if (messageAllSucceeded) {
        summary.processed++;
        if (!options.dryRun) {
          syncLog(`💾 Flagging email message in Office 365 as processed...`);
          await emailClient.markAsProcessed(messageId);
          registry.add(messageId);
        }
      } else {
        summary.failures++;
        syncLog(`⚠️  Some attachments failed. Email left unread for retry.`);
      }
    }
  } catch (error: any) {
    syncLog(`❌ Ingestion Loop Error: ${error.message}`);
    summary.failures++;
  }

  syncLog(`\n=============================================================`);
  syncLog(`📊 INGESTION SUMMARY:`);
  syncLog(`- Emails Scanned: ${summary.scanned}`);
  syncLog(`- Emails Processed: ${summary.processed}`);
  syncLog(`- Zoho Bills Created: ${summary.billsCreated}`);
  syncLog(`- Skipped: ${summary.skipped}`);
  syncLog(`- Failed: ${summary.failures}`);
  syncLog(`=============================================================\n`);

  return summary;
}

// Execute directly if run via CLI
if (require.main === module) {
  async function runDirectly() {
    const zoho = new ZohoClient();
    const dryRun = process.argv.includes("--dry-run") || process.argv.includes("-d");
    await runEmailSync(zoho, { dryRun });
    process.exit(0);
  }
  runDirectly().catch(e => {
    console.error("CLI Run Error:", e);
    process.exit(1);
  });
}
