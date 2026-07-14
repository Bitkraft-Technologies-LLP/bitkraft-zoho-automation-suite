import { ZohoClient } from "../src/invoice_processing/zoho/zoho-client";
import dotenv from "dotenv";
import axios from "axios";

dotenv.config();

async function run() {
  try {
    const zoho = new ZohoClient();
    const token = await zoho.getAccessToken();
    const region = process.env.ZOHO_REGION || "com";
    const orgId = process.env.ZOHO_ORGANIZATION_ID || "";
    
    console.log("Searching for GST: 07AAJCA9880A1ZL across all contacts...");
    let page = 1;
    let hasMore = true;
    let foundContact: any = null;
    let totalContacts = 0;

    while (hasMore) {
      const url = `https://www.zohoapis.${region}/books/v3/contacts?organization_id=${orgId}&page=${page}&per_page=200`;
      const response = await axios.get(url, {
        headers: { Authorization: `Zoho-oauthtoken ${token}` },
      });
      
      const contacts = response.data.contacts || [];
      totalContacts += contacts.length;
      console.log(`Page ${page}: fetched ${contacts.length} contacts.`);

      const match = contacts.find((c: any) => {
        const cGst = (c.gst_no || "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
        return cGst === "07AAJCA9880A1ZL";
      });

      if (match) {
        foundContact = match;
        console.log("Found match!", JSON.stringify(match, null, 2));
        break;
      }

      hasMore = response.data.page_context?.has_more_page || false;
      page++;
    }

    console.log(`Search complete. Total contacts scanned: ${totalContacts}. Found: ${foundContact ? "Yes" : "No"}`);
  } catch (error: any) {
    console.error("Error:", error.response?.data || error.message);
  }
}

run();
