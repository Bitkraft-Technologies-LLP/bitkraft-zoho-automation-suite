import fs from "fs";
import path from "path";
import crypto from "crypto";
import dotenv from "dotenv";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { EmailClient } from "./email-client";
import { ZohoClient } from "./zoho/zoho-client";
import { PaymentMatcher, TransactionInput } from "../payment_automation/payment-matcher";
import { NotificationService } from "../payment_automation/notification-service";
import { ensureUnlockedPDF } from "./parser/pdf-decryptor";
import { extractTextFromPDF } from "./parser/pdf-parser";

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const model = genAI.getGenerativeModel({
  model: process.env.GEMINI_MODEL || "gemini-1.5-flash",
  generationConfig: { responseMimeType: "application/json" }
});

export interface EmailPaymentSyncSummary {
  scanned: number;
  paymentEmailsFound: number;
  vendorPaymentsRecorded: number;
  customerPaymentsRecorded: number;
  failures: number;
}

export interface ExtractedPaymentDetail {
  isPaymentConfirmation: boolean;
  paymentType?: "debit" | "credit" | undefined;
  amount?: number | undefined;
  reference?: string | undefined;
  partyName?: string | undefined;
  docNumber?: string | undefined;
  date?: string | undefined;
}

interface ExtractionResponse {
  isPaymentConfirmation: boolean;
  payments?: ExtractedPaymentDetail[] | undefined;
  paymentType?: "debit" | "credit" | undefined;
  amount?: number | undefined;
  reference?: string | undefined;
  partyName?: string | undefined;
  docNumber?: string | undefined;
  date?: string | undefined;
}

/**
 * AI-assisted extraction of payment details (Debit or Credit) from email text and/or attached PDF
 */
async function extractPaymentDetails(
  subject: string,
  bodyText: string,
  pdfOptions?: {
    pdfBuffer?: Buffer;
    pdfText?: string;
    filename?: string;
  }
): Promise<ExtractedPaymentDetail[]> {
  const prompt = `
    Analyze the following email subject, body text, and/or attached PDF document (e.g. payment advice, remittance slip, debit/credit confirmation, NEFT/RTGS transfer receipt, or bank advice).
    
    CRITICAL RULES:
    1. Determine if this document/email represents a COMPLETED PAYMENT CONFIRMATION or PAYMENT ADVICE (Debit outflow OR Credit inflow).
    2. If this is an unpaid INVOICE or BILL requesting future payment (and NOT a confirmation that money has already been transferred/paid), return:
       { "isPaymentConfirmation": false, "payments": [] }
    3. If it IS a payment confirmation:
       - paymentType: "debit" if our organization paid money to a vendor/beneficiary, OR "credit" if a customer/remitter paid money to us / money was credited to our account.
       - amount: The transaction amount as a positive number.
       - reference: UTR, Transaction ID, Cheque Number, NEFT/RTGS Ref, or Confirmation Reference.
       - partyName: The vendor/beneficiary name (if debit) OR customer/remitter name (if credit).
       - docNumber: Bill number or Invoice number mentioned in the payment details/remarks.
       - date: Payment date in YYYY-MM-DD format (or today's date if missing).

    If multiple bills/invoices were settled in this advice, return all distinct payments in the "payments" array.

    Return JSON format:
    {
      "isPaymentConfirmation": true,
      "payments": [
        {
          "paymentType": "debit" | "credit",
          "amount": number,
          "reference": "string",
          "partyName": "string",
          "docNumber": "string",
          "date": "YYYY-MM-DD"
        }
      ]
    }

    Subject: "${subject}"
    ${pdfOptions?.filename ? `Attachment Filename: "${pdfOptions.filename}"` : ""}
    
    Email Body:
    """
    ${bodyText.slice(0, 3000)}
    """
    ${pdfOptions?.pdfText ? `\nPDF Document Text:\n"""\n${pdfOptions.pdfText.slice(0, 4000)}\n"""` : ""}
  `;

  try {
    const parts: any[] = [prompt];
    if (pdfOptions?.pdfBuffer) {
      parts.push({
        inlineData: {
          data: pdfOptions.pdfBuffer.toString("base64"),
          mimeType: "application/pdf"
        }
      });
    }

    const result = await model.generateContent(parts);
    const responseText = result.response.text();
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed: ExtractionResponse = JSON.parse(jsonMatch[0]);
      if (!parsed.isPaymentConfirmation) {
        return [];
      }
      if (Array.isArray(parsed.payments) && parsed.payments.length > 0) {
        return parsed.payments.filter(p => p.amount && p.amount > 0);
      }
      if (parsed.amount && parsed.amount > 0) {
        return [{
          isPaymentConfirmation: true,
          paymentType: parsed.paymentType || "debit",
          amount: parsed.amount,
          reference: parsed.reference || "",
          partyName: parsed.partyName || "",
          docNumber: parsed.docNumber || "",
          date: parsed.date || (new Date().toISOString().split("T")[0] as string)
        }];
      }
    }
  } catch (err: any) {
    console.warn("⚠️ AI payment extraction warning:", err.message);
  }

  return [];
}

export async function runPaymentEmailSync(
  zoho: ZohoClient,
  bankAccountId: string,
  options: { dryRun: boolean }
): Promise<EmailPaymentSyncSummary> {
  const summary: EmailPaymentSyncSummary = {
    scanned: 0,
    paymentEmailsFound: 0,
    vendorPaymentsRecorded: 0,
    customerPaymentsRecorded: 0,
    failures: 0
  };

  console.log(`\n=============================================================`);
  console.log(`🚀 Scanning Inbox for Payment Advices & Debit/Credit Confirmations (${options.dryRun ? "DRY-RUN" : "LIVE"})`);
  console.log(`=============================================================\n`);

  const emailClient = new EmailClient();
  const messages = await emailClient.getUnreadMessages();
  summary.scanned = messages.length;

  if (messages.length === 0) {
    console.log("No unread messages found in inbox.");
    return summary;
  }

  // Temp folder for downloaded payment advice PDFs
  const tempDir = path.resolve(process.cwd(), "data/payments/temp_email");
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  // Fetch unpaid bills (Payables) & unpaid invoices (Receivables)
  const [unpaidBills, unpaidInvoices] = await Promise.all([
    zoho.getBills({ status: "unpaid" }).then(b => [...b, ...(zoho.getBills({ status: "partially_paid" }) as any)]),
    zoho.getInvoices({ status: "unpaid" }).then(i => [...i, ...(zoho.getInvoices({ status: "partially_paid" }) as any)])
  ]);

  const debitTxns: TransactionInput[] = [];
  const creditTxns: TransactionInput[] = [];
  const debitMessageMap = new Map<number, string>();
  const creditMessageMap = new Map<number, string>();

  for (let idx = 0; idx < messages.length; idx++) {
    const msg = messages[idx];
    if (!msg) continue;

    const subject = msg.subject || "";
    const body = msg.bodyPreview || msg.body?.content || "";
    const fromEmail = msg.from?.emailAddress?.address || "";

    const keywords = [
      "payment advice", "debit confirmation", "credit alert", "credited to", "received from", 
      "utr", "remittance", "transfer successful", "paid to", "payment confirmed", "transaction alert",
      "neft", "rtgs", "imps", "receipt", "advice", "statement", "paid"
    ];
    const isCandidate = keywords.some(k => subject.toLowerCase().includes(k) || body.toLowerCase().includes(k));

    let extractedList: ExtractedPaymentDetail[] = [];

    // 1. Check for PDF attachments (Payment Advice, Remittance Advice, Receipts, Bank Alerts)
    if (msg.hasAttachments) {
      try {
        const attachments = await emailClient.getMessageAttachments(msg.id);
        const pdfs = attachments.filter(a => 
          (a.name && a.name.toLowerCase().endsWith(".pdf")) ||
          (a.contentType && a.contentType.toLowerCase().includes("pdf"))
        );

        for (const pdf of pdfs) {
          if (!pdf.contentBytes) continue;
          console.log(`📎 Found Payment PDF Attachment: "${pdf.name}" (${(pdf.size / 1024).toFixed(1)} KB)`);

          const msgHash = crypto.createHash("md5").update(msg.id).digest("hex");
          const safeName = (pdf.name || "payment_advice.pdf").replace(/[^a-zA-Z0-9.-]/g, "_");
          const tempPath = path.join(tempDir, `${msgHash}_${safeName}`);

          try {
            fs.writeFileSync(tempPath, Buffer.from(pdf.contentBytes, "base64"));
            
            // Decrypt if password-protected
            await ensureUnlockedPDF(tempPath, {
              subject,
              fromEmail,
              filename: pdf.name
            });

            // Extract raw text
            let pdfText = "";
            try {
              pdfText = await extractTextFromPDF(tempPath);
            } catch (err: any) {
              console.warn(`Could not extract raw text from ${pdf.name}:`, err.message);
            }

            const pdfBuffer = fs.readFileSync(tempPath);
            const pdfExtracted = await extractPaymentDetails(subject, body, {
              pdfBuffer,
              pdfText,
              filename: pdf.name
            });

            if (pdfExtracted.length > 0) {
              console.log(`✅ Extracted ${pdfExtracted.length} payment record(s) from PDF "${pdf.name}"`);
              extractedList.push(...pdfExtracted);
            }
          } finally {
            if (fs.existsSync(tempPath)) {
              try { fs.unlinkSync(tempPath); } catch {}
            }
          }
        }
      } catch (err: any) {
        console.warn(`⚠️ Error reading attachments for message "${subject}":`, err.message);
      }
    }

    // 2. If no PDF attachments or PDFs didn't yield payments, extract directly from email text
    if (extractedList.length === 0 && isCandidate) {
      console.log(`🔍 Examining Email text: "${subject}"...`);
      extractedList = await extractPaymentDetails(subject, body);
    }

    // 3. Map extracted payments to debit/credit transactions
    if (extractedList.length > 0) {
      summary.paymentEmailsFound++;

      for (const extracted of extractedList) {
        if (!extracted.amount || extracted.amount <= 0) continue;

        const isCredit = extracted.paymentType === "credit";
        console.log(`✅ ${isCredit ? "Credit (Receivable)" : "Debit (Payable)"} Payment Detected: Amount ₹${extracted.amount}, Party: "${extracted.partyName || 'N/A'}", Doc #: "${extracted.docNumber || 'N/A'}", Ref: "${extracted.reference || 'N/A'}"`);

        const txn: TransactionInput = {
          date: extracted.date || new Date().toISOString().split("T")[0]!,
          amount: extracted.amount,
          narration: `${subject} - ${extracted.partyName || ''} - Ref: ${extracted.reference || ''}`,
          reference: extracted.reference || "",
          vendorName: isCredit ? undefined : extracted.partyName,
          customerName: isCredit ? extracted.partyName : undefined,
          billNumber: isCredit ? undefined : extracted.docNumber,
          invoiceNumber: isCredit ? extracted.docNumber : undefined,
          type: extracted.paymentType,
          source: "email"
        };

        if (isCredit) {
          creditTxns.push(txn);
          creditMessageMap.set(creditTxns.length - 1, msg.id);
        } else {
          debitTxns.push(txn);
          debitMessageMap.set(debitTxns.length - 1, msg.id);
        }
      }
    }
  }

  // 1. Process Debit Matches (Vendor Payments Made)
  if (debitTxns.length > 0) {
    const { matches } = PaymentMatcher.matchTransactions(debitTxns, unpaidBills);
    console.log(`\nFound ${matches.length} matching vendor bill(s) out of ${debitTxns.length} debit payment record(s).`);

    if (!options.dryRun) {
      for (let i = 0; i < matches.length; i++) {
        const match = matches[i];
        if (!match) continue;

        const res = await PaymentMatcher.applyPayments(zoho, bankAccountId, [match]);
        if (res.successCount > 0) {
          summary.vendorPaymentsRecorded++;
          console.log(`🎉 Recorded vendor payment of ₹${match.transaction.amount} for Bill ${match.bill.bill_number} (${match.bill.vendor_name})`);

          const paymentId = res.results[0]?.paymentId;
          if (paymentId) {
            try {
              await NotificationService.sendNotification(zoho, paymentId);
            } catch (e: any) {}
          }

          const msgId = debitMessageMap.get(i);
          if (msgId) try { await emailClient.markAsProcessed(msgId); } catch (e) {}
        } else {
          summary.failures++;
        }
      }
    }
  }

  // 2. Process Credit Matches (Customer Payments Received)
  if (creditTxns.length > 0) {
    const { matches } = PaymentMatcher.matchCustomerInvoices(creditTxns, unpaidInvoices);
    console.log(`\nFound ${matches.length} matching customer invoice(s) out of ${creditTxns.length} credit payment record(s).`);

    if (!options.dryRun) {
      for (let i = 0; i < matches.length; i++) {
        const match = matches[i];
        if (!match) continue;

        const res = await PaymentMatcher.applyCustomerPayments(zoho, bankAccountId, [match]);
        if (res.successCount > 0) {
          summary.customerPaymentsRecorded++;
          console.log(`🎉 Recorded customer payment received of ₹${match.transaction.amount} for Invoice ${match.invoice.invoice_number} (${match.invoice.customer_name})`);

          const msgId = creditMessageMap.get(i);
          if (msgId) try { await emailClient.markAsProcessed(msgId); } catch (e) {}
        } else {
          summary.failures++;
        }
      }
    }
  }

  return summary;
}
