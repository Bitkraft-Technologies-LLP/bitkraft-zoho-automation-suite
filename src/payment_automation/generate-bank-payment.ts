import { ZohoClient } from '../invoice_processing/zoho/zoho-client';
import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import dotenv from 'dotenv';

dotenv.config();

async function generateBankPayment() {
    const zoho = new ZohoClient();
    
    // Get month-year suffix
    const now = new Date();
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const suffix = `${months[now.getMonth()]}-${now.getFullYear()}`;
    
    const csvFileName = `unpaid_bills_${suffix}.csv`;
    const xlsxFileName = `bank_payment_${suffix}.xlsx`;
    
    // Use configurable paths from .env
    const paymentsSummaryDir = path.resolve(process.cwd(), process.env.PAYMENTS_SUMMARY_DIR || './payments_summary');
    const bankPaymentUploadDir = path.resolve(process.cwd(), process.env.BANK_PAYMENT_UPLOAD_DIR || './bank_payment_upload');
    
    // Ensure directories exist
    if (!fs.existsSync(paymentsSummaryDir)) {
        fs.mkdirSync(paymentsSummaryDir, { recursive: true });
    }
    if (!fs.existsSync(bankPaymentUploadDir)) {
        fs.mkdirSync(bankPaymentUploadDir, { recursive: true });
    }

    const csvPath = path.join(paymentsSummaryDir, csvFileName);
    const xlsxPath = path.join(bankPaymentUploadDir, xlsxFileName);
    
    try {
        console.log('Fetching unpaid bills from Zoho Books...');
        const unpaidBills = await zoho.getBills({ status: 'unpaid' });
        const partiallyPaidBills = await zoho.getBills({ status: 'partially_paid' });
        const allUnpaid = [...unpaidBills, ...partiallyPaidBills];

        console.log(`Found ${allUnpaid.length} unpaid/partially paid bills.`);

        const vendorCache: Record<string, any> = {};
        const csvRows = [
            ['Bill Number', 'Amount Payable (Net of TDS)', 'Bill Date', 'Bank IFSC Code', 'Bank Account Number', 'Vendor Name']
        ];
        
        // Header for XLSX (based on sample inspection)
        const xlsxRows: any[][] = [];

        const todayFormatted = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;

        for (const billSummary of allUnpaid) {
            const vendorId = billSummary.vendor_id;
            
            if (!vendorCache[vendorId]) {
                vendorCache[vendorId] = await zoho.getVendor(vendorId);
            }
            const vendor = vendorCache[vendorId];
            const vendorName = vendor.vendor_name || vendor.contact_name || 'Unknown Vendor';
            const bankAccount = vendor.bank_accounts?.[0];

            if (!bankAccount) {
                console.warn(`⚠️  Skipping bill ${billSummary.bill_number}: No bank account for ${vendorName}`);
                continue;
            }

            const token = await (zoho as any).getAccessToken();
            const url = `https://www.zohoapis.${(zoho as any).region}/books/v3/bills/${billSummary.bill_id}?organization_id=${(zoho as any).orgId}`;
            const axios = require('axios');
            const response = await axios.get(url, {
                headers: { Authorization: `Zoho-oauthtoken ${token}` }
            });
            const fullBill = response.data.bill;
            
            // Zoho's balance field already represents net payable after TDS deduction
            const netPayable = fullBill.balance;

            if (netPayable <= 0) {
                console.log(`ℹ️  Skipping bill ${fullBill.bill_number}: Net payable is 0.`);
                continue;
            }

            // CSV Row
            csvRows.push([
                fullBill.bill_number,
                netPayable.toFixed(2),
                fullBill.date,
                bankAccount.routing_number || 'N/A',
                bankAccount.account_number || 'N/A',
                vendorName
            ]);

            // Clean invoice number (remove spaces and special chars)
            const cleanedInvoiceNumber = fullBill.bill_number.replace(/[^a-zA-Z0-9]/g, '');

            // Get advice format from env or use default
            const adviceFormat = process.env.BANK_ADVICE_FORMAT || 'Inv pay {invoice_number}';
            const adviceText = adviceFormat.replace('{invoice_number}', cleanedInvoiceNumber);

            // XLSX Row (25 columns minimum based on sample)
            const row = new Array(25).fill(null);
            row[0] = 'BI6846PAY';
            row[1] = 'VPAY';
            row[2] = (bankAccount.routing_number || '').startsWith('KKBK') ? 'IFT' : 'NEFT';
            row[4] = todayFormatted;
            row[6] = '5253078611'; // Debit Account from sample
            row[7] = Number(netPayable.toFixed(2));
            row[8] = 'M';
            row[10] = vendorName;
            row[12] = bankAccount.routing_number || '';
            row[13] = bankAccount.account_number || '';
            row[23] = adviceText; // Column X - Credit Advice
            row[24] = adviceText; // Column Y - Debit Advice
            
            xlsxRows.push(row);
        }

        // Write CSV
        const csvContent = csvRows.map(row => row.join(',')).join('\n');
        fs.writeFileSync(csvPath, csvContent);
        console.log(`✅ CSV generated: ${csvPath}`);

        // Write XLSX
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(xlsxRows);
        XLSX.utils.book_append_sheet(wb, ws, 'Data');
        XLSX.writeFile(wb, xlsxPath);
        console.log(`✅ XLSX generated: ${xlsxPath}`);

    } catch (error: any) {
        console.error('Error:', error.response?.data || error.message);
    }
}

generateBankPayment();
