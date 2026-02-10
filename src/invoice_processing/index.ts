import { extractTextFromPDF, parseInvoiceWithAI } from "./parser/pdf-parser";
import { ZohoClient } from "./zoho/zoho-client";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

async function processInvoice(filePath: string, zoho: ZohoClient, orgGst: string | undefined, orgName: string, orgState: string | undefined, dryRun: boolean): Promise<boolean> {
  try {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Processing file: ${filePath}...`);
    console.log("=".repeat(60));
    
    const absolutePath = path.resolve(filePath);
    let text = "";
    
    try {
      text = await extractTextFromPDF(absolutePath);
    } catch (e) {
      console.warn("Text extraction failed, falling back to multimodal vision...");
    }

    const pdfBuffer = fs.readFileSync(absolutePath);

    console.log("Fetching Configuration (Accounts & Taxes) from Zoho...");
    const [accounts, taxes] = await Promise.all([
      zoho.getAccounts(),
      zoho.getTaxes()
    ]);

    console.log("Extracting data with AI (Multimodal support enabled)...");
    const billData = await parseInvoiceWithAI(text, { accounts, taxes, pdfBuffer, orgGst, orgName, orgState });

    console.log("Extracted Bill Data:");
    console.log(JSON.stringify(billData, null, 2));

    if (dryRun) {
      console.log("\n[Dry Run] Bill creation skipped.");
      return true;
    }

    // Zoho requires vendor_id, not just vendor_name.
    console.log(`Looking up vendor: ${billData.vendor_name} (GST: ${billData.vendor_gst || 'Not found in invoice'})...`);
    const vendors = await zoho.getVendors() || [];
    
    // 1. Try matching by GST number if available
    let vendor = null;
    if (billData.vendor_gst) {
      const normalizedGst = billData.vendor_gst.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
      vendor = vendors.find((v: any) => {
        const vGst = (v.gst_no || "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
        return vGst && vGst === normalizedGst;
      });
      if (vendor) console.log(`Found vendor by GST match: ${vendor.vendor_name}`);
    }

    // 2. Fallback to name-based matching if no GST match
    if (!vendor) {
      vendor = vendors.find((v: any) =>
        v.company_name.toLowerCase().includes(billData.vendor_name.toLowerCase()),
      );
      if (vendor) console.log(`Found vendor by Name match: ${vendor.vendor_name}`);
    }

    if (!vendor) {
      console.error(
        `Error: Vendor "${billData.vendor_name}" (GST: ${billData.vendor_gst || 'N/A'}) not found in Zoho Books.`,
      );
      
      // Interactive Prompt
      const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout
      });

      const askQuestion = (query: string) => new Promise<string>(resolve => readline.question(query, resolve));

      console.log("\n⚠️  Vendor not found.");
      console.log(`- Name: ${billData.vendor_name}`);
      console.log(`- GST: ${billData.vendor_gst || 'N/A'}`);
      console.log(`- PAN: ${billData.vendor_pan || 'N/A'}`);
      console.log(`- Phone: ${billData.vendor_phone || 'N/A'}`);
      console.log(`- Email: ${billData.vendor_email || 'N/A'}`);
      
      const answer = await askQuestion("\nDo you want to create this vendor in Zoho Books? (y/N): ");
      
      if (answer.trim().toLowerCase() === 'y') {
        try {
          console.log("Creating vendor...");
          
          // Construct Address
          // AI might return string or object, usually string if not strictly enforced as JSON structure in prompt examples. 
          // For simplicity, we put full address in 'address' field or parse if it's simple.
          // Zoho API: billing_address: { address, city, state, zip, country }
          
          const billingAddress = {
            address: typeof billData.vendor_address === 'string' ? billData.vendor_address : (billData.vendor_address?.street || ""),
            city: billData.vendor_address?.city || "",
            state: billData.vendor_address?.state || "",
            zip: billData.vendor_address?.zip || "",
            country: billData.vendor_address?.country || "India"
          };

          // Construct Contact Persons
          const contactPersons = [];
          if (billData.vendor_email || billData.vendor_phone) {
             contactPersons.push({
                 first_name: billData.vendor_name, // Default to vendor name if no specific contact name
                 email: billData.vendor_email || "",
                 phone: billData.vendor_phone || "",
                 is_primary: true
             });
          }
          
          // Bank Details to Notes (since API doesn't always expose bank fields easily)
          let notes = "";
          if (billData.vendor_bank_details) {
              const b = billData.vendor_bank_details;
              notes += `\nBank Details:\nAccount: ${b.account_number || 'N/A'}\nIFSC: ${b.ifsc_code || 'N/A'}\nBank: ${b.bank_name || 'N/A'}`;
          }
          
          // Complete Payload
          const newVendorData: any = {
            contact_name: billData.vendor_name,
            company_name: billData.vendor_name,
            gst_no: billData.vendor_gst,
            gst_treatment: billData.vendor_gst ? "business_gst" : "business_none",
            pan_no: billData.vendor_pan || "",
            billing_address: billingAddress,
            contact_persons: contactPersons,
            notes: notes.trim()
          };

          const createdVendor = await zoho.createVendor(newVendorData);
          console.log(`✅ Vendor created successfully: ${createdVendor.contact_name} (ID: ${createdVendor.contact_id})`);
          
          vendor = createdVendor;
          // Clean up readline
          readline.close();
        } catch (err: any) {
          console.error("Failed to create vendor.", err.response?.data?.message || err.message);
          readline.close();
          return false;
        }
      } else {
        console.log("Skipping vendor creation.");
        if (vendors.length > 0) {
          console.log(
            "Available vendors (first 10):",
            vendors.slice(0, 10).map((v: any) => v.vendor_name).join(", ")
          );
        }
        readline.close();
        return false;
      }
    }



    // Modify line items for unregistered vendors
    const processedLineItems = billData.line_items.map((item: any) => {
      // Check if vendor has no GST number (unregistered)
      if (!billData.vendor_gst) {
        const { tax_id, tax_exemption_code, tax_exemption_id, ...itemWithoutTax } = item;
        return {
          ...itemWithoutTax
          // No tax_id, no tax_exemption - completely tax-free line item
        };
      }
      return item;
    });

        // Prepare final payload for Zoho
    const finalBillData: any = {
      vendor_id: vendor.contact_id || vendor.vendor_id,
      bill_number: billData.bill_number,
      date: billData.date,
      due_date: billData.due_date,
      line_items: processedLineItems,
      is_reverse_charge_applied: false,
      status: 'draft'
    };

    // TDS Deduction Logic
    console.log("Checking for TDS settings in vendor profile...");
    try {
      const fullVendor = await zoho.getVendor(vendor.contact_id || vendor.vendor_id);
      if (fullVendor?.tds_tax_id && fullVendor?.tds_tax_percentage) {
        console.log(`Found TDS: ${fullVendor.tds_tax_name} (${fullVendor.tds_tax_percentage}%)`);
        const subTotal = billData.line_items.reduce((sum: number, item: any) => sum + (Number(item.rate) * (Number(item.quantity) || 1)), 0);
        const tdsAmount = (subTotal * Number(fullVendor.tds_tax_percentage)) / 100;
        
        finalBillData.tds_tax_id = fullVendor.tds_tax_id;
        finalBillData.tds_amount = tdsAmount;
        console.log(`Applied TDS Amount: ₹${tdsAmount}`);
      } else {
        console.warn(`\n⚠️  TDS settings not found for vendor "${vendor.contact_name || vendor.vendor_name}".`);
        console.warn("Please verify and apply TDS manually in Zoho Books if required.\n");
      }
    } catch (tdsError) {
      console.warn("⚠️  Failed to fetch detailed vendor profile for TDS. Proceeding without TDS.");
    }

    console.log("Creating DRAFT bill in Zoho Books...");
    const result = await zoho.createBill(finalBillData);
    const billId = result.bill.bill_id;
    console.log("Bill created successfully! Bill ID:", billId);

    console.log("Uploading original PDF as attachment...");
    await zoho.uploadAttachment(billId, absolutePath);
    console.log("Attachment uploaded successfully!");
    
    console.log("\n✅ Success! You can review the draft bill in Zoho Books.");
    return true;
  } catch (error: any) {
    console.error(`\n❌ Error processing ${filePath}:`);
    if (error.response?.data) {
      console.error("Error Detail (API Response):", JSON.stringify(error.response.data, null, 2));
    } else if (error.message) {
      console.error("Error Message:", error.message);
    } else {
      console.error("Unknown Error:", error);
    }
    return false;
  }
}

async function main() {
  const filePath = process.argv[2];
  const dryRun = process.argv.includes("--dry-run");

  const zoho = new ZohoClient();
  const orgGst = process.env.ZOHO_ORG_GST;
  const orgName = process.env.ZOHO_ORG_NAME || "Your Organization";
  const orgState = process.env.ZOHO_ORG_STATE;
  
  const invoicesDir = process.env.INVOICES_DIR || "./invoices";
  const archiveDir = process.env.INVOICES_ARCHIVE_DIR || "./invoices/archive";

  try {
    // Ensure archive directory exists
    if (!fs.existsSync(archiveDir)) {
      fs.mkdirSync(archiveDir, { recursive: true });
    }

    if (filePath) {
      // Single file mode
      console.log("Mode: Single file processing");
      const success = await processInvoice(filePath, zoho, orgGst, orgName, orgState, dryRun);
      
      if (success && !dryRun) {
        // Archive the file
        const fileName = path.basename(filePath);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
        const archivePath = path.join(archiveDir, `${timestamp}_${fileName}`);
        fs.renameSync(path.resolve(filePath), archivePath);
        console.log(`\n📦 Archived to: ${archivePath}`);
      }
      
      process.exit(success ? 0 : 1);
    } else {
      // Batch mode
      console.log("Mode: Batch processing");
      console.log(`Scanning directory: ${invoicesDir}`);
      
      if (!fs.existsSync(invoicesDir)) {
        console.error(`Error: Directory ${invoicesDir} does not exist.`);
        console.log("Please create the directory and add PDF invoices to process.");
        process.exit(1);
      }

      const files = fs.readdirSync(invoicesDir)
        .filter(file => file.toLowerCase().endsWith('.pdf'))
        .map(file => path.join(invoicesDir, file));

      if (files.length === 0) {
        console.log("No PDF files found in the invoices directory.");
        process.exit(0);
      }

      console.log(`Found ${files.length} PDF file(s) to process.\n`);

      let successCount = 0;
      let failCount = 0;

      for (const file of files) {
        const success = await processInvoice(file, zoho, orgGst, orgName, orgState, dryRun);
        
        if (success) {
          successCount++;
          
          if (!dryRun) {
            // Archive the file
            const fileName = path.basename(file);
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
            const archivePath = path.join(archiveDir, `${timestamp}_${fileName}`);
            fs.renameSync(file, archivePath);
            console.log(`📦 Archived to: ${archivePath}`);
          }
        } else {
          failCount++;
        }
      }

      console.log("\n" + "=".repeat(60));
      console.log("BATCH PROCESSING COMPLETE");
      console.log("=".repeat(60));
      console.log(`✅ Successful: ${successCount}`);
      console.log(`❌ Failed: ${failCount}`);
      console.log(`📊 Total: ${files.length}`);

      process.exit(failCount > 0 ? 1 : 0);
    }
  } catch (error: any) {
    console.error("Fatal error:", error.message);
    process.exit(1);
  }
}

main();
