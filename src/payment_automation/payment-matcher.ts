import { ZohoClient } from "../invoice_processing/zoho/zoho-client";

export interface TransactionInput {
  date: string;
  amount: number;
  narration: string;
  reference?: string | undefined;
  vendorName?: string | undefined;
  customerName?: string | undefined;
  billNumber?: string | undefined;
  invoiceNumber?: string | undefined;
  type?: "debit" | "credit" | undefined;
  source: "statement" | "email";
}

export interface MatchResult {
  transaction: TransactionInput;
  bill: {
    bill_id: string;
    bill_number: string;
    vendor_name: string;
    vendor_id: string;
    total: number;
    balance: number;
    date: string;
    due_date: string;
  };
  confidence: "EXACT" | "HIGH" | "AMOUNT_MISMATCH";
  reason: string;
}

export interface CustomerMatchResult {
  transaction: TransactionInput;
  invoice: {
    invoice_id: string;
    invoice_number: string;
    customer_name: string;
    customer_id: string;
    total: number;
    balance: number;
    date: string;
    due_date: string;
  };
  confidence: "EXACT" | "HIGH" | "AMOUNT_MISMATCH";
  reason: string;
}

export class PaymentMatcher {
  /**
   * Matches raw statement or email transaction records against unpaid Zoho Books vendor bills.
   */
  public static matchTransactions(transactions: TransactionInput[], unpaidBills: any[]): { matches: MatchResult[]; unmatched: TransactionInput[] } {
    // De-duplicate unpaid bills
    const seenIds = new Set<string>();
    const uniqueBills = unpaidBills.filter((b: any) => {
      if (seenIds.has(b.bill_id)) return false;
      seenIds.add(b.bill_id);
      return true;
    });

    const matches: MatchResult[] = [];
    const unmatched: TransactionInput[] = [];

    for (const txn of transactions) {
      let bestMatch: any = null;
      let confidence: "EXACT" | "HIGH" | "AMOUNT_MISMATCH" = "EXACT";
      let reason = "";

      const narrationLower = (txn.narration || "").toLowerCase();
      const refLower = (txn.reference || "").toLowerCase();
      const vendorLower = (txn.vendorName || "").toLowerCase();
      const explicitBillNum = (txn.billNumber || "").toLowerCase();

      for (const bill of uniqueBills) {
        const billNumLower = (bill.bill_number || "").toLowerCase();
        const cleanedBillNum = (bill.bill_number || "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
        const billVendorLower = (bill.vendor_name || "").toLowerCase();

        // 1. Direct Bill Number match (if provided or present in narration / reference)
        const hasBillNumMatch = 
          (explicitBillNum && explicitBillNum === billNumLower) ||
          (billNumLower.length >= 3 && (narrationLower.includes(billNumLower) || narrationLower.includes(cleanedBillNum) || refLower.includes(billNumLower)));

        if (hasBillNumMatch) {
          bestMatch = bill;
          const diff = Math.abs(txn.amount - bill.balance);
          if (diff < 0.05) {
            confidence = "EXACT";
            reason = `Matched bill number "${bill.bill_number}" with exact amount ₹${txn.amount}`;
          } else {
            confidence = "AMOUNT_MISMATCH";
            reason = `Matched bill number "${bill.bill_number}" (Balance: ₹${bill.balance}, Paid: ₹${txn.amount})`;
          }
          break;
        }

        // 2. Vendor Name + Exact Amount match fallback
        if (!bestMatch && billVendorLower.length >= 3) {
          const isVendorMatch = narrationLower.includes(billVendorLower) || (vendorLower && vendorLower.includes(billVendorLower));
          const isExactAmount = Math.abs(txn.amount - bill.balance) < 0.05;

          if (isVendorMatch && isExactAmount) {
            bestMatch = bill;
            confidence = "HIGH";
            reason = `Matched vendor "${bill.vendor_name}" and exact amount ₹${txn.amount}`;
            break;
          }
        }
      }

      if (bestMatch) {
        matches.push({
          transaction: txn,
          bill: {
            bill_id: bestMatch.bill_id,
            bill_number: bestMatch.bill_number,
            vendor_name: bestMatch.vendor_name,
            vendor_id: bestMatch.vendor_id,
            total: Number(bestMatch.total),
            balance: Number(bestMatch.balance),
            date: bestMatch.date,
            due_date: bestMatch.due_date
          },
          confidence,
          reason
        });
      } else {
        unmatched.push(txn);
      }
    }

    return { matches, unmatched };
  }

  /**
   * Matches credit transaction records (payments received) against unpaid Customer Invoices (sales invoices).
   */
  public static matchCustomerInvoices(transactions: TransactionInput[], unpaidInvoices: any[]): { matches: CustomerMatchResult[]; unmatched: TransactionInput[] } {
    const seenIds = new Set<string>();
    const uniqueInvoices = unpaidInvoices.filter((inv: any) => {
      if (seenIds.has(inv.invoice_id)) return false;
      seenIds.add(inv.invoice_id);
      return true;
    });

    const matches: CustomerMatchResult[] = [];
    const unmatched: TransactionInput[] = [];

    for (const txn of transactions) {
      let bestMatch: any = null;
      let confidence: "EXACT" | "HIGH" | "AMOUNT_MISMATCH" = "EXACT";
      let reason = "";

      const narrationLower = (txn.narration || "").toLowerCase();
      const refLower = (txn.reference || "").toLowerCase();
      const customerLower = (txn.customerName || "").toLowerCase();
      const explicitInvNum = (txn.invoiceNumber || txn.billNumber || "").toLowerCase();

      for (const inv of uniqueInvoices) {
        const invNumLower = (inv.invoice_number || "").toLowerCase();
        const cleanedInvNum = (inv.invoice_number || "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
        const invCustomerLower = (inv.customer_name || "").toLowerCase();

        // 1. Direct Customer Invoice Number match
        const hasInvNumMatch = 
          (explicitInvNum && explicitInvNum === invNumLower) ||
          (invNumLower.length >= 3 && (narrationLower.includes(invNumLower) || narrationLower.includes(cleanedInvNum) || refLower.includes(invNumLower)));

        if (hasInvNumMatch) {
          bestMatch = inv;
          const diff = Math.abs(txn.amount - inv.balance);
          if (diff < 0.05) {
            confidence = "EXACT";
            reason = `Matched customer invoice "${inv.invoice_number}" with exact amount ₹${txn.amount}`;
          } else {
            confidence = "AMOUNT_MISMATCH";
            reason = `Matched customer invoice "${inv.invoice_number}" (Balance: ₹${inv.balance}, Received: ₹${txn.amount})`;
          }
          break;
        }

        // 2. Customer Name + Exact Amount match fallback
        if (!bestMatch && invCustomerLower.length >= 3) {
          const isCustomerMatch = narrationLower.includes(invCustomerLower) || (customerLower && customerLower.includes(invCustomerLower));
          const isExactAmount = Math.abs(txn.amount - inv.balance) < 0.05;

          if (isCustomerMatch && isExactAmount) {
            bestMatch = inv;
            confidence = "HIGH";
            reason = `Matched customer "${inv.customer_name}" and exact amount ₹${txn.amount}`;
            break;
          }
        }
      }

      if (bestMatch) {
        matches.push({
          transaction: txn,
          invoice: {
            invoice_id: bestMatch.invoice_id,
            invoice_number: bestMatch.invoice_number,
            customer_name: bestMatch.customer_name,
            customer_id: bestMatch.customer_id,
            total: Number(bestMatch.total),
            balance: Number(bestMatch.balance),
            date: bestMatch.date,
            due_date: bestMatch.due_date
          },
          confidence,
          reason
        });
      } else {
        unmatched.push(txn);
      }
    }

    return { matches, unmatched };
  }

  /**
   * Applies matched vendor payments directly to Zoho Books.
   */
  public static async applyPayments(
    zoho: ZohoClient,
    paidThroughAccountId: string,
    matches: MatchResult[]
  ): Promise<{ successCount: number; failureCount: number; results: any[] }> {
    let successCount = 0;
    let failureCount = 0;
    const results: any[] = [];

    for (const m of matches) {
      try {
        const payload = {
          vendor_id: m.bill.vendor_id,
          date: m.transaction.date,
          amount: m.transaction.amount,
          paid_through_account_id: paidThroughAccountId,
          payment_mode: "Bank Transfer",
          reference_number: m.transaction.reference || "",
          description: `Payment recorded automatically via ${m.transaction.source.toUpperCase()} match (${m.reason})`,
          bills: [
            {
              bill_id: m.bill.bill_id,
              amount_applied: m.transaction.amount
            }
          ]
        };

        const response = await zoho.createVendorPayment(payload);
        const paymentId = response.vendorpayment?.payment_id;

        results.push({
          billNumber: m.bill.bill_number,
          vendorName: m.bill.vendor_name,
          amount: m.transaction.amount,
          paymentId,
          success: true
        });
        successCount++;

      } catch (err: any) {
        console.error(`Failed to record payment for Bill ${m.bill.bill_number}:`, err.response?.data?.message || err.message);
        results.push({
          billNumber: m.bill.bill_number,
          vendorName: m.bill.vendor_name,
          amount: m.transaction.amount,
          error: err.response?.data?.message || err.message,
          success: false
        });
        failureCount++;
      }
    }

    return { successCount, failureCount, results };
  }

  /**
   * Applies matched customer payments (received payments) directly to Zoho Books.
   */
  public static async applyCustomerPayments(
    zoho: ZohoClient,
    depositAccountId: string,
    matches: CustomerMatchResult[]
  ): Promise<{ successCount: number; failureCount: number; results: any[] }> {
    let successCount = 0;
    let failureCount = 0;
    const results: any[] = [];

    for (const m of matches) {
      try {
        const payload = {
          customer_id: m.invoice.customer_id,
          date: m.transaction.date,
          amount: m.transaction.amount,
          account_id: depositAccountId,
          payment_mode: "Bank Transfer",
          reference_number: m.transaction.reference || "",
          description: `Customer payment received via ${m.transaction.source.toUpperCase()} match (${m.reason})`,
          invoices: [
            {
              invoice_id: m.invoice.invoice_id,
              amount_applied: m.transaction.amount
            }
          ]
        };

        const response = await zoho.createCustomerPayment(payload);
        const paymentId = response.payment?.payment_id || response.customerpayment?.payment_id;

        results.push({
          invoiceNumber: m.invoice.invoice_number,
          customerName: m.invoice.customer_name,
          amount: m.transaction.amount,
          paymentId,
          success: true
        });
        successCount++;

      } catch (err: any) {
        console.error(`Failed to record customer payment for Invoice ${m.invoice.invoice_number}:`, err.response?.data?.message || err.message);
        results.push({
          invoiceNumber: m.invoice.invoice_number,
          customerName: m.invoice.customer_name,
          amount: m.transaction.amount,
          error: err.response?.data?.message || err.message,
          success: false
        });
        failureCount++;
      }
    }

    return { successCount, failureCount, results };
  }
}
