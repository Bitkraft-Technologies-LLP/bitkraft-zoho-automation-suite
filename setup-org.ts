import { ZohoClient } from './src/zoho/zoho-client';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

async function setup() {
    const zoho = new ZohoClient();
    try {
        console.log('Fetching organization details from Zoho...');
        const org = await zoho.getOrganization();
        
        const orgName = org.name;
        const orgGst = org.tax_settings?.tax_reg_no || "";
        const orgState = org.address?.state || "";

        console.log(`Organization Found: ${orgName}`);
        console.log(`GST Number: ${orgGst}`);
        console.log(`State: ${orgState}`);

        const envPath = path.resolve(process.cwd(), '.env');
        let envContent = fs.readFileSync(envPath, 'utf8');

        // Update or add ZOHO_ORG_NAME
        if (envContent.includes('ZOHO_ORG_NAME=')) {
            envContent = envContent.replace(/ZOHO_ORG_NAME=.*/, `ZOHO_ORG_NAME="${orgName}"`);
        } else {
            envContent += `\nZOHO_ORG_NAME="${orgName}"`;
        }

        // Update or add ZOHO_ORG_GST
        if (envContent.includes('ZOHO_ORG_GST=')) {
            envContent = envContent.replace(/ZOHO_ORG_GST=.*/, `ZOHO_ORG_GST="${orgGst}"`);
        } else {
            envContent += `\nZOHO_ORG_GST="${orgGst}"`;
        }

        // Update or add ZOHO_ORG_STATE
        if (envContent.includes('ZOHO_ORG_STATE=')) {
            envContent = envContent.replace(/ZOHO_ORG_STATE=.*/, `ZOHO_ORG_STATE="${orgState}"`);
        } else {
            envContent += `\nZOHO_ORG_STATE="${orgState}"`;
        }

        fs.writeFileSync(envPath, envContent.trim() + '\n');
        console.log('\n✅ .env file updated with organization details!');
    } catch (e: any) {
        console.error('Failed to setup organization:', e.response?.data || e.message);
    }
}

setup();
