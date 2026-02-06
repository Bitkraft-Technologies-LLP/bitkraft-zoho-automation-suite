import { ZohoClient } from './src/zoho/zoho-client';
import fs from 'fs';
import path from 'path';

async function generatePaymentsCSV() {
    const zoho = new ZohoClient();
    const csvFilePath = path.resolve(process.cwd(), 'unpaid_bills_payments.csv');
    
    try {
        console.log('Fetching unpaid bills from Zoho Books...');
        // Filter by status=unpaid (includes partially_paid in many Zoho views, but let's be safe)
        const unpaidBills = await zoho.getBills({ status: 'unpaid' });
        const partiallyPaidBills = await zoho.getBills({ status: 'partially_paid' });
        const allUnpaid = [...unpaidBills, ...partiallyPaidBills];

        console.log(`Found ${allUnpaid.length} unpaid/partially paid bills.`);

        const vendorCache: Record<string, any> = {};
        const csvRows = [
            ['Bill Number', 'Amount Payable (Net of TDS)', 'Bill Date', 'Bank IFSC Code', 'Bank Account Number', 'Vendor Name']
        ];

        for (const billSummary of allUnpaid) {
            const vendorId = billSummary.vendor_id;
            
            // Fetch full vendor details for bank info
            if (!vendorCache[vendorId]) {
                console.log(`Fetching bank details for vendor: ${billSummary.vendor_name}...`);
                vendorCache[vendorId] = await zoho.getVendor(vendorId);
            }
            const vendor = vendorCache[vendorId];
            const vendorName = vendor.vendor_name || vendor.contact_name || vendor.company_name || 'Unknown Vendor';
            const bankAccount = vendor.bank_accounts?.[0]; // Taking the first bank account

            if (!bankAccount) {
                console.warn(`⚠️  No bank account found for vendor: ${vendorName}. Skipping bill: ${billSummary.bill_number}`);
                continue;
            }

            // Fetch full bill details for TDS info (summary list doesn't have tds_amount)
            console.log(`Fetching details for bill: ${billSummary.bill_number} (${vendorName})...`);
            const token = await (zoho as any).getAccessToken();
            const url = `https://www.zohoapis.${(zoho as any).region}/books/v3/bills/${billSummary.bill_id}?organization_id=${(zoho as any).orgId}`;
            const axios = require('axios');
            const response = await axios.get(url, {
                headers: { Authorization: `Zoho-oauthtoken ${token}` }
            });
            const fullBill = response.data.bill;

            const total = fullBill.total;
            const balance = fullBill.balance; // Balance remaining
            
            // Net of TDS: Subtract any TDS amount from the balance
            let tdsTotal = 0;
            if (fullBill.tds_summary && Array.isArray(fullBill.tds_summary)) {
                tdsTotal = fullBill.tds_summary.reduce((sum: number, tds: any) => sum + (tds.tds_amount || 0), 0);
            }
            
            const netPayable = balance - tdsTotal;

            csvRows.push([
                fullBill.bill_number,
                netPayable.toFixed(2),
                fullBill.date,
                bankAccount.routing_number || 'N/A', // IFSC in Zoho is usually routing_number
                bankAccount.account_number || 'N/A',
                vendorName
            ]);
        }

        const csvContent = csvRows.map(row => row.join(',')).join('\n');
        fs.writeFileSync(csvFilePath, csvContent);
        
        console.log(`\n✅ Success! Payments CSV generated: ${csvFilePath}`);
        console.log(`Generated export for ${csvRows.length - 1} bills.`);
        
    } catch (error: any) {
        console.error('Failed to generate payments CSV:', error.response?.data || error.message);
    }
}

generatePaymentsCSV();
