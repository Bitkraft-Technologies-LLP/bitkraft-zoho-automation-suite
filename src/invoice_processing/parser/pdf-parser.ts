import fs from 'fs';
import pdf from 'pdf-parse';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
const model = genAI.getGenerativeModel({ 
    model: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
    generationConfig: {
        responseMimeType: 'application/json',
    }
});

export async function extractTextFromPDF(filePath: string): Promise<string> {
  const dataBuffer = fs.readFileSync(filePath);
  const data = await pdf(dataBuffer);
  return data.text;
}

export async function parseInvoiceWithAI(
  text: string, 
  options: { accounts: any[], taxes: any[], orgState?: string | undefined, pdfBuffer?: Buffer, orgGst?: string | undefined, orgName?: string }
) {
  const accountsContext = options.accounts.length > 0 
    ? `Available Chart of Accounts (use the exact account_id for mapping):
       ${JSON.stringify(options.accounts.map(a => ({ account_name: a.account_name, account_id: a.account_id })), null, 2)}`
    : "";

  const taxesContext = options.taxes.length > 0
    ? `Available Taxes (use the exact tax_id for mapping):
       ${JSON.stringify(options.taxes.map(t => ({ 
           tax_name: t.tax_name, 
           tax_id: t.tax_id, 
           percentage: t.tax_percentage, 
           type: t.tax_specification 
       })), null, 2)}`
    : "";

  const orgStateContext = options.orgState 
    ? `The organization is based in ${options.orgState}.`
    : (process.env.ZOHO_ORG_STATE ? `The organization is based in ${process.env.ZOHO_ORG_STATE}.` : "The organization is based in Maharashtra (GST State Code 27).");

  const orgGstContext = options.orgGst
    ? `IMPORTANT: Our organization is "${options.orgName || 'Your Organization'}" and our GST is ${options.orgGst}. 
       DO NOT extract these as the vendor_name or vendor_gst. 
       The vendor is the SENDER of the invoice (usually at the top, or labeled as 'From' or 'Seller'). 
       Your organization is the RECIPIENT/BUYER (usually labeled as 'Bill To').`
    : "";

  const mappingLogic = `
       Mapping logic:
       1. Match each line item to the most appropriate account. 
          - If it's a sales resource/marketing, use "Sales & Marketing".
          - If it's a salary/wage, use "Salaries and Employee Wages".
          - If it's rent or license fee for premises, use "Rent Expense" or similar.
          - If unsure, use the "Uncategorized" account.
       2. Match the tax mentioned on the invoice to the best available tax_id.
          - CRITICAL: Check the transaction type by comparing the vendor's GSTIN/State with the organization's state.
          - Use 'intra' specification taxes (e.g., GST18) if the vendor is in the SAME state as the organization.
          - Use 'inter' specification taxes (e.g., IGST18) if the vendor is in a DIFFERENT state.
          - The vendor's GSTIN starts with a 2-digit state code (e.g., '27' for Maharashtra).`;

  const prompt = `
    Extract structured data from the following invoice. 
    Return ONLY a JSON object that matches the Zoho Books Bill API format.
    
    ${accountsContext}
    ${taxesContext}
    ${orgStateContext}
    ${orgGstContext}
    ${mappingLogic}

    Required fields for each line item in 'line_items':
    - name (Item name)
    - rate (Price/Rate as number)
    - quantity (Quantity as number)
    - description (Full description from invoice)
    - account_id (The ID from the Chart of Accounts provided above)
    - tax_id (The ID from the Taxes provided above)

    Required header fields:
    - vendor_name (STRICT: This must be the seller, NOT ${options.orgName || 'Your Organization'})
    - vendor_gst (STRICT: This must be the seller's GST, NOT ${options.orgGst || ""})
    - vendor_pan (PAN Number if available)
    - vendor_email (Email address of the vendor)
    - vendor_phone (Phone number of the vendor)
    - vendor_address (Full address string or object with street, city, state, zip)
    - vendor_bank_details (Object with account_number, ifsc_code, bank_name, branch if available)
    - bill_number (Invoice/Bill number)
    - date (YYYY-MM-DD)
    - due_date (YYYY-MM-DD, if missing assume 30 days from date)
    
    Processing instructions:
    IDENTIFY THE SENDER: Look for the company logo or name at the top or labeled as "From". 
    DO NOT CONFUSE THE BUYER (your organization) WITH THE SELLER.
    The vendor_name and vendor_gst MUST belong to the company that IS CHARGING for the service/items.
    
    Extracted text:
    """
    ${text}
    """
  `;

  const requestParts: any[] = [prompt];
  
  if (options.pdfBuffer) {
    requestParts.push({
      inlineData: {
        data: options.pdfBuffer.toString('base64'),
        mimeType: 'application/pdf'
      }
    });
  }

  const result = await model.generateContent(requestParts);
  const response = await result.response;
  const content = response.text();
  
  if (!content) throw new Error('AI failed to parse invoice');
  
  const jsonContent = content.replace(/```json\n?|\n?```/g, '').trim();
  
  return JSON.parse(jsonContent);
}
