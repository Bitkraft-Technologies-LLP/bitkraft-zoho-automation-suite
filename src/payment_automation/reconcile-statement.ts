import { ZohoClient } from "../invoice_processing/zoho/zoho-client";
import fs from "fs";
import path from "path";
import * as XLSX from "xlsx";
import dotenv from "dotenv";
import readline from "readline";
import { NotificationService } from "./notification-service";

dotenv.config();

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

async function run() {
  const args = process.argv.slice(2);
  const filePath = args.find(a => !a.startsWith("-"));
  const force = args.includes("--yes") || args.includes("-y");
  const accountIndex = args.indexOf("--account-id");
  let accountId = accountIndex !== -1 ? args[accountIndex + 1] : null;

  if (!filePath) {
    console.log("Usage: npx ts-node src/payment_automation/reconcile-statement.ts <statement_file_path> [--account-id <zoho_account_id>] [--yes]");
    process.exit(1);
  }

  const absolutePath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolutePath)) {
    console.error(`Error: File does not exist at ${absolutePath}`);
    process.exit(1);
  }

  const zoho = new ZohoClient();

  // Resolve Paid Through Account
  if (!accountId) {
    console.log("Fetching bank accounts from Zoho Books...");
    const accounts = await zoho.getAccounts();
    const bankAccounts = accounts.filter((acc: any) => acc.account_type === "bank" || acc.account_type === "cash");
    
    // Auto-resolve using "Kotak" or "5253078611"
    const resolved = bankAccounts.find((acc: any) => 
      acc.account_name.toLowerCase().includes("kotak") || 
      acc.account_name.includes("5253078611")
    );

    if (resolved) {
      accountId = resolved.account_id;
      console.log(`Auto-resolved payment debit account: ${resolved.account_name} (${resolved.account_id})`);
    } else {
      console.error("Error: Could not auto-resolve Kotak/debit account. Please specify using '--account-id <id>'.");
      console.log("\nAvailable Accounts:");
      bankAccounts.forEach((acc: any) => console.log(`- ${acc.account_name}: ${acc.account_id}`));
      process.exit(1);
    }
  }

  console.log(`Parsing bank statement: ${absolutePath}...`);
  const transactions = parseBankStatement(absolutePath);
  console.log(`Found ${transactions.length} debit transactions.`);

  console.log("Fetching unpaid bills from Zoho Books...");
  const unpaid = await zoho.getBills({ status: "unpaid" });
  const partiallyPaid = await zoho.getBills({ status: "partially_paid" });
  const allUnpaid = [...unpaid, ...partiallyPaid];

  // De-duplicate by bill_id
  const seenIds = new Set<string>();
  const uniqueBills = allUnpaid.filter((b: any) => {
    if (seenIds.has(b.bill_id)) return false;
    seenIds.add(b.bill_id);
    return true;
  });

  const matches: any[] = [];
  const unmatched: any[] = [];

  for (const txn of transactions) {
    let matchedBill: any = null;
    let matchStatus = "none";

    for (const bill of uniqueBills) {
      const billNum = bill.bill_number.toLowerCase();
      const cleanedBillNum = bill.bill_number.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
      const narration = txn.narration.toLowerCase();

      if (billNum.length >= 3 && (narration.includes(billNum) || narration.includes(cleanedBillNum))) {
        matchedBill = bill;
        const diff = Math.abs(txn.amount - bill.balance);
        matchStatus = diff < 0.05 ? "EXACT" : "MISMATCH";
        if (matchStatus === "EXACT") break;
      }
    }

    if (matchedBill) {
      matches.push({ txn, bill: matchedBill, status: matchStatus });
    } else {
      unmatched.push(txn);
    }
  }

  console.log(`\nReconciliation Summary:`);
  console.log(`- Matches Found: ${matches.length}`);
  console.log(`- Unmatched: ${unmatched.length}\n`);

  if (matches.length === 0) {
    console.log("No invoice matches found in this bank statement. Exiting.");
    process.exit(0);
  }

  console.log("Matches details:");
  console.log("------------------------------------------------------------------------------------------------------------------");
  console.log(String("Bill Number").padEnd(18) + " | " + String("Vendor").padEnd(25) + " | " + String("Txn Date").padEnd(10) + " | " + String("Amount").padStart(12) + " | " + String("Bill Bal").padStart(12) + " | " + "Status");
  console.log("------------------------------------------------------------------------------------------------------------------");
  for (const m of matches) {
    console.log(
      m.bill.bill_number.padEnd(18) + " | " +
      m.bill.vendor_name.substring(0, 25).padEnd(25) + " | " +
      m.txn.date.padEnd(10) + " | " +
      `₹${m.txn.amount.toFixed(2)}`.padStart(12) + " | " +
      `₹${m.bill.balance.toFixed(2)}`.padStart(12) + " | " +
      m.status
    );
  }
  console.log("------------------------------------------------------------------------------------------------------------------\n");

  const exactMatches = matches.filter(m => m.status === "EXACT");
  if (exactMatches.length === 0) {
    console.log("No EXACT matches found. Skipping automated reconciliation.");
    process.exit(0);
  }

  const applyReconciled = async () => {
    console.log(`Recording ${exactMatches.length} payment(s) in Zoho Books...`);
    for (const m of exactMatches) {
      try {
        const payload = {
          vendor_id: m.bill.vendor_id,
          date: m.txn.date,
          amount: m.txn.amount,
          paid_through_account_id: accountId,
          payment_mode: "Bank Transfer",
          reference_number: m.txn.reference || "",
          description: `Reconciled via CLI statement match for Bill ${m.bill.bill_number}`,
          bills: [
            {
              bill_id: m.bill.bill_id,
              amount_applied: m.txn.amount
            }
          ]
        };

        const result = await zoho.createVendorPayment(payload);
        console.log(`✅ Success: Payment of ₹${m.txn.amount} recorded for Bill ${m.bill.bill_number} (ID: ${result.vendorpayment?.payment_id})`);
        
        const paymentId = result.vendorpayment?.payment_id;
        if (paymentId) {
          console.log(`   Sending payment confirmation email...`);
          const record = await NotificationService.sendNotification(zoho, paymentId);
          if (record.email_sent) {
            console.log(`   📧 Notification email sent to ${record.recipient_email}`);
          } else {
            console.log(`   ⚠️ Failed to send notification: ${record.error_message}`);
          }
        }
      } catch (err: any) {
        console.error(`❌ Failed for Bill ${m.bill.bill_number}:`, err.response?.data?.message || err.message);
      }
    }
    console.log("\nReconciliation execution finished.");
  };

  if (force) {
    await applyReconciled();
  } else {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    rl.question(`Do you want to apply these ${exactMatches.length} EXACT payment matches in Zoho Books? (y/n): `, async (answer) => {
      rl.close();
      if (answer.toLowerCase() === "y" || answer.toLowerCase() === "yes") {
        await applyReconciled();
      } else {
        console.log("Aborted by user.");
      }
    });
  }
}

run().catch(err => console.error("CLI run failed:", err.message));
