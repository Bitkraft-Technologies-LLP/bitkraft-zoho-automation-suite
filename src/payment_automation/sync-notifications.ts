import { ZohoClient } from "../invoice_processing/zoho/zoho-client";
import { NotificationStore } from "./notification-store";
import { NotificationService } from "./notification-service";
import dotenv from "dotenv";

dotenv.config();

async function runCLI() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run") || args.includes("-d");
  
  let hours = 24;
  const hoursIndex = args.findIndex(arg => arg === "--hours" || arg === "-h");
  if (hoursIndex !== -1 && args[hoursIndex + 1]) {
    const val = parseInt(args[hoursIndex + 1]!, 10);
    if (!isNaN(val)) hours = val;
  }

  console.log(`\n============================================================`);
  console.log(`📧 Running Vendor Payment Email Notification Sync`);
  console.log(`   Lookback: ${hours} hour(s)`);
  console.log(`   Dry Run:  ${dryRun ? "YES" : "NO"}`);
  console.log(`============================================================\n`);

  try {
    const zoho = new ZohoClient();
    
    // Compute date range
    const today = new Date().toISOString().split("T")[0]!;
    const startDateObj = new Date();
    startDateObj.setHours(startDateObj.getHours() - hours);
    const startDateStr = startDateObj.toISOString().split("T")[0]!;

    console.log(`[Sync CLI] Scanning Zoho payments from ${startDateStr} to ${today}...`);
    
    const payments = await zoho.getVendorPayments({
      date_start: startDateStr,
      date_end: today
    });

    console.log(`[Sync CLI] Found ${payments.length} total payments in Zoho Books.`);
    
    const store = NotificationStore.getAll();
    let sentCount = 0;
    let failCount = 0;
    let skipCount = 0;

    for (const p of payments) {
      const paymentId = p.payment_id;
      const stored = store[paymentId];
      
      if (stored && stored.email_sent) {
        console.log(`[Sync CLI] ⏭️ Skipping payment ${p.payment_number || paymentId} (Already sent to ${stored.recipient_email})`);
        skipCount++;
        continue;
      }

      console.log(`[Sync CLI] ✉️ Payment ${p.payment_number || paymentId} not yet notified.`);
      
      if (dryRun) {
        console.log(`   [Dry Run] Would send payment confirmation email to ${p.vendor_email || "vendor contact"}`);
        sentCount++;
      } else {
        const record = await NotificationService.sendNotification(zoho, paymentId);
        if (record.email_sent) {
          console.log(`   ✅ Email sent successfully to ${record.recipient_email}`);
          sentCount++;
        } else {
          console.log(`   ❌ Failed to send: ${record.error_message}`);
          failCount++;
        }
      }
    }

    console.log(`\n============================================================`);
    console.log(`📊 Sync Summary:`);
    console.log(`   Total Scanned:  ${payments.length}`);
    console.log(`   Notified:       ${sentCount}`);
    console.log(`   Failed:         ${failCount}`);
    console.log(`   Skipped:        ${skipCount}`);
    console.log(`============================================================\n`);

  } catch (error: any) {
    console.error(`[Sync CLI] Critical execution error:`, error.response?.data || error.message);
    process.exit(1);
  }
}

runCLI();
