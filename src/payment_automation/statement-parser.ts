import fs from "fs";
import path from "path";
import * as XLSX from "xlsx";
import dotenv from "dotenv";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { extractTextFromPDF } from "../invoice_processing/parser/pdf-parser";
import { ensureUnlockedPDF } from "../invoice_processing/parser/pdf-decryptor";

dotenv.config();

export interface StatementTransaction {
  date: string;
  narration: string;
  amount: number;
  reference?: string | undefined;
  type?: "debit" | "credit" | undefined;
  vendorName?: string | undefined;
  customerName?: string | undefined;
  billNumber?: string | undefined;
  invoiceNumber?: string | undefined;
  source: "statement";
}

/**
 * Format any spreadsheet date value into standard YYYY-MM-DD
 */
export function formatDate(val: any): string {
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
  const ymdMatch = str.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (ymdMatch && ymdMatch[1] && ymdMatch[2] && ymdMatch[3]) {
    const year = ymdMatch[1];
    const month = ymdMatch[2].padStart(2, "0");
    const day = ymdMatch[3].padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  // Native Date parsing fallback
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return (parsed.toISOString().split("T")[0]) as string;
  }

  return today;
}

/**
 * Parse standard CSV or Excel bank statements
 */
export function parseSpreadsheetBankStatement(filePath: string): StatementTransaction[] {
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
          tempMap.type = j;
        } else {
          tempMap.debit = j;
        }
      } else if (creditKeywords.some(k => cellVal === k || cellVal.includes(k)) && tempMap.credit === -1) {
        if (cellVal.includes("dr") && (cellVal.includes("cr") || cellVal.includes("type") || cellVal.includes("/"))) {
          tempMap.type = j;
        } else {
          tempMap.credit = j;
        }
      } else if (amountKeywords.some(k => cellVal === k || cellVal.includes(k)) && tempMap.amount === -1) {
        tempMap.amount = j;
      } else if (refKeywords.some(k => cellVal === k || cellVal.includes(k)) && tempMap.ref === -1) {
        tempMap.ref = j;
      }
    }

    if (tempMap.date !== -1 && tempMap.narration !== -1) {
      headerIndex = i;
      colMap = tempMap;
      break;
    }
  }

  if (headerIndex === -1) {
    throw new Error("Could not automatically identify header columns (Date and Narration) in the bank statement.");
  }

  const transactions: StatementTransaction[] = [];
  for (let i = headerIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    const dateVal = colMap.date !== -1 ? row[colMap.date] : null;
    const narrationVal = colMap.narration !== -1 ? row[colMap.narration] : "";
    const refVal = colMap.ref !== -1 ? row[colMap.ref] : "";

    let amount = 0;
    let isDebit = false;
    let isCredit = false;

    // Check separate debit column
    if (colMap.debit !== -1 && row[colMap.debit] !== undefined && row[colMap.debit] !== null && row[colMap.debit] !== "") {
      const dVal = parseFloat(String(row[colMap.debit]).replace(/[^0-9.-]/g, ""));
      if (!isNaN(dVal) && dVal > 0) {
        amount = dVal;
        isDebit = true;
      }
    }

    // Check separate credit column
    if (colMap.credit !== -1 && row[colMap.credit] !== undefined && row[colMap.credit] !== null && row[colMap.credit] !== "") {
      const cVal = parseFloat(String(row[colMap.credit]).replace(/[^0-9.-]/g, ""));
      if (!isNaN(cVal) && cVal > 0) {
        amount = cVal;
        isCredit = true;
      }
    }

    // Check single amount column with type indicator
    if (!isDebit && !isCredit && colMap.amount !== -1 && row[colMap.amount] !== undefined && row[colMap.amount] !== null && row[colMap.amount] !== "") {
      const aVal = parseFloat(String(row[colMap.amount]).replace(/[^0-9.-]/g, ""));
      if (!isNaN(aVal)) {
        amount = Math.abs(aVal);
        if (aVal < 0) {
          isDebit = true;
        } else if (colMap.type !== -1 && row[colMap.type] !== undefined && row[colMap.type] !== null) {
          const typeStr = String(row[colMap.type]).trim().toLowerCase();
          if (typeStr.includes("dr") || typeStr.includes("debit") || typeStr === "d") {
            isDebit = true;
          } else if (typeStr.includes("cr") || typeStr.includes("credit") || typeStr === "c") {
            isCredit = true;
          }
        }
      }
    }

    if (narrationVal && (isDebit || isCredit) && amount > 0) {
      transactions.push({
        date: formatDate(dateVal),
        narration: String(narrationVal).trim(),
        amount,
        reference: refVal ? String(refVal).trim() : "",
        type: isCredit ? "credit" : "debit",
        source: "statement"
      });
    }
  }

  return transactions;
}

/**
 * AI-assisted parsing for PDF bank statements with auto-decryption
 */
export async function parsePDFBankStatement(filePath: string): Promise<StatementTransaction[]> {
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
      Extract all individual bank account debit and credit transactions from this bank statement into a structured JSON list.
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
          type: t.type === "credit" ? "credit" : "debit",
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

/**
 * Universal bank statement loader: dispatches to PDF or Spreadsheet parser based on file extension
 */
export async function loadBankStatement(filePath: string): Promise<StatementTransaction[]> {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".pdf") {
    return await parsePDFBankStatement(filePath);
  }
  return parseSpreadsheetBankStatement(filePath);
}
