import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import dotenv from "dotenv";

dotenv.config();

interface DecryptOptions {
  subject?: string | undefined;
  fromEmail?: string | undefined;
  filename?: string | undefined;
}

const VENDOR_PASSWORDS_FILE = path.resolve(process.cwd(), "data/vendor_passwords.json");

/**
 * Load saved vendor passwords from data/vendor_passwords.json
 */
function getSavedPasswords(): string[] {
  try {
    if (fs.existsSync(VENDOR_PASSWORDS_FILE)) {
      const content = fs.readFileSync(VENDOR_PASSWORDS_FILE, "utf8");
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) return parsed;
      if (Array.isArray(parsed.passwords)) return parsed.passwords;
    }
  } catch (e: any) {
    console.warn("⚠️ Could not load data/vendor_passwords.json:", e.message);
  }
  return [];
}

/**
 * Save a newly discovered password to data/vendor_passwords.json
 */
export function saveVendorPassword(password: string) {
  try {
    const dir = path.dirname(VENDOR_PASSWORDS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    let passwords = getSavedPasswords();
    if (!passwords.includes(password)) {
      passwords.push(password);
      fs.writeFileSync(VENDOR_PASSWORDS_FILE, JSON.stringify({ passwords }, null, 2), "utf8");
      console.log(`💾 Saved password to vendor registry: ${password}`);
    }
  } catch (e: any) {
    console.warn("⚠️ Failed to save password to registry:", e.message);
  }
}

/**
 * Checks if a PDF buffer or file is encrypted.
 */
export function isPDFEncrypted(filePath: string): boolean {
  try {
    const buffer = fs.readFileSync(filePath);
    // Check for standard PDF encryption markers in binary structure
    const head = buffer.slice(0, 10000).toString("binary");
    const tail = buffer.slice(-10000).toString("binary");
    
    if (head.includes("/Encrypt") || tail.includes("/Encrypt")) {
      return true;
    }
  } catch (err) {
    // Ignore read errors
  }
  return false;
}

/**
 * Generate a list of candidate passwords based on environment, filename, subject, and saved registry.
 */
function generateCandidatePasswords(options: DecryptOptions): string[] {
  const candidates: Set<string> = new Set();

  // 1. Saved passwords in data/vendor_passwords.json
  getSavedPasswords().forEach(p => candidates.add(p));

  // 2. Organization GSTIN & PAN from environment
  const orgGst = process.env.ZOHO_ORG_GST?.trim();
  if (orgGst) {
    candidates.add(orgGst);
    candidates.add(orgGst.toUpperCase());
    candidates.add(orgGst.toLowerCase());

    // PAN is characters 3..12 of GSTIN (e.g. 27AAPFP8092C1ZU -> AAPFP8092C)
    if (orgGst.length >= 12) {
      const pan = orgGst.substring(2, 12);
      candidates.add(pan);
      candidates.add(pan.toUpperCase());
      candidates.add(pan.toLowerCase());
    }
  }

  const orgPan = process.env.ZOHO_ORG_PAN?.trim();
  if (orgPan) {
    candidates.add(orgPan);
    candidates.add(orgPan.toUpperCase());
    candidates.add(orgPan.toLowerCase());
  }

  // 3. Extract numbers from Subject (e.g. Account ID "900592763708")
  if (options.subject) {
    const digitsMatch = options.subject.match(/\b\d{6,16}\b/g);
    if (digitsMatch) {
      digitsMatch.forEach(d => candidates.add(d));
    }
  }

  // 4. Extract numbers from Filename (e.g. I_900592763708_527500389741_20261001.pdf)
  if (options.filename) {
    const filenameDigits = options.filename.match(/\b\d{6,16}\b/g);
    if (filenameDigits) {
      filenameDigits.forEach(d => candidates.add(d));
    }
    // Also split by underscores / hyphens
    const parts = options.filename.split(/[^a-zA-Z0-9]/);
    parts.forEach(part => {
      if (/^\d{6,16}$/.test(part)) {
        candidates.add(part);
      }
    });
  }

  // 5. Common bank statement & vendor defaults
  candidates.add("5253078611");
  candidates.add("995496846");
  if (process.env.BANK_ACCOUNT_NO) candidates.add(process.env.BANK_ACCOUNT_NO.trim());
  if (process.env.BANK_CRN) candidates.add(process.env.BANK_CRN.trim());
  candidates.add("123456");
  candidates.add("bitkraft");
  candidates.add("BITKRAFT");

  return Array.from(candidates).filter(Boolean);
}

/**
 * Attempts to decrypt a PDF file using qpdf or CLI fallback.
 * Returns the path to the decrypted PDF file (or the original file if not encrypted/successfully decrypted).
 */
export async function ensureUnlockedPDF(
  filePath: string,
  options: DecryptOptions = {}
): Promise<{ decryptedPath: string; wasEncrypted: boolean; unlockedWith?: string }> {
  if (!isPDFEncrypted(filePath)) {
    return { decryptedPath: filePath, wasEncrypted: false };
  }

  console.log(`🔒 PDF is encrypted: ${path.basename(filePath)}`);
  
  const candidates = generateCandidatePasswords(options);
  console.log(`🔑 Testing ${candidates.length} candidate password(s)...`);

  const decryptedTempPath = filePath.replace(/\.pdf$/i, "_unlocked.pdf");

  for (const password of candidates) {
    try {
      // Execute qpdf to decrypt
      execFileSync("qpdf", [
        `--password=${password}`,
        "--decrypt",
        filePath,
        decryptedTempPath
      ], { stdio: "ignore" });

      if (fs.existsSync(decryptedTempPath) && fs.statSync(decryptedTempPath).size > 0) {
        console.log(`✅ Decrypted PDF using password: "${password}"`);
        saveVendorPassword(password);
        
        // Overwrite original file with unlocked file
        fs.renameSync(decryptedTempPath, filePath);
        return { decryptedPath: filePath, wasEncrypted: true, unlockedWith: password };
      }
    } catch (e) {
      // Password failed, continue to next candidate
      if (fs.existsSync(decryptedTempPath)) {
        try { fs.unlinkSync(decryptedTempPath); } catch (err) {}
      }
    }
  }

  console.warn(`❌ Could not unlock PDF "${path.basename(filePath)}" with available candidate passwords.`);
  return { decryptedPath: filePath, wasEncrypted: true };
}
