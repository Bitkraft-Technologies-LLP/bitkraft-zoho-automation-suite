import axios from "axios";
import dotenv from "dotenv";
import FormData from "form-data";
import fs from "fs";

dotenv.config();

export class ZohoClient {
  private accessToken: string | null = null;
  private clientId: string;
  private clientSecret: string;
  private refreshToken: string;
  private orgId: string;
  private region: string;

  // Simple in-memory cache to prevent rate-limiting during batch processing
  private cache: {
    accounts: any[] | null;
    taxes: any[] | null;
    vendors: any[] | null;
    vendorDetails: Map<string, any>;
  } = {
    accounts: null,
    taxes: null,
    vendors: null,
    vendorDetails: new Map(),
  };

  constructor() {
    this.clientId = process.env.ZOHO_CLIENT_ID || "";
    this.clientSecret = process.env.ZOHO_CLIENT_SECRET || "";
    this.refreshToken = process.env.ZOHO_REFRESH_TOKEN || "";
    this.orgId = process.env.ZOHO_ORGANIZATION_ID || "";
    this.region = process.env.ZOHO_REGION || "com";

    if (
      !this.clientId ||
      !this.clientSecret ||
      !this.refreshToken ||
      !this.orgId
    ) {
      throw new Error("Missing Zoho credentials in .env file");
    }
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken) return this.accessToken;

    const url = `https://accounts.zoho.${this.region}/oauth/v2/token`;
    const params = new URLSearchParams({
      refresh_token: this.refreshToken,
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_type: "refresh_token",
    });

    try {
      const response = await axios.post(url, params.toString(), {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      this.accessToken = response.data.access_token;

      // Token expires in 1 hour usually, we'll just clear it after 55 mins
      setTimeout(
        () => {
          this.accessToken = null;
        },
        55 * 60 * 1000,
      );

      return this.accessToken!;
    } catch (error: any) {
      console.error(
        "Failed to refresh Zoho token:",
        error.response?.data || error.message,
      );
      throw new Error("Zoho Authentication Failed");
    }
  }

  async getOrganization() {
    const token = await this.getAccessToken();
    const url = `https://www.zohoapis.${this.region}/books/v3/organizations/${this.orgId}?organization_id=${this.orgId}`;
    const response = await axios.get(url, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
    });
    return response.data.organization;
  }

  async createBill(billData: any) {
    const token = await this.getAccessToken();
    const url = `https://www.zohoapis.${this.region}/books/v3/bills?organization_id=${this.orgId}`;

    try {
      const response = await axios.post(url, billData, {
        headers: {
          Authorization: `Zoho-oauthtoken ${token}`,
          "Content-Type": "application/json",
        },
      });
      return response.data;
    } catch (error: any) {
      console.error(
        "Failed to create bill in Zoho:",
        error.response?.data || error.message,
      );
      throw error;
    }
  }

  async getVendors(): Promise<any[]> {
    if (this.cache.vendors) return this.cache.vendors;
    
    const token = await this.getAccessToken();
    const url = `https://www.zohoapis.${this.region}/books/v3/vendors?organization_id=${this.orgId}`;
    const response = await axios.get(url, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
    });
    this.cache.vendors = response.data.contacts || [];
    return this.cache.vendors!;
  }

  async getVendor(vendorId: string) {
    if (this.cache.vendorDetails.has(vendorId)) {
      return this.cache.vendorDetails.get(vendorId);
    }

    const token = await this.getAccessToken();
    const url = `https://www.zohoapis.${this.region}/books/v3/contacts/${vendorId}?organization_id=${this.orgId}`;
    const response = await axios.get(url, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
    });
    const vendor = response.data.contact;
    this.cache.vendorDetails.set(vendorId, vendor);
    return vendor;
  }

  async createVendor(vendorData: any) {
    const token = await this.getAccessToken();
    const url = `https://www.zohoapis.${this.region}/books/v3/contacts?organization_id=${this.orgId}`;
    
    // Ensure contact_type is vendor
    const payload = { ...vendorData, contact_type: "vendor" };

    try {
      const response = await axios.post(url, payload, {
        headers: {
          Authorization: `Zoho-oauthtoken ${token}`,
          "Content-Type": "application/json",
        },
      });
      return response.data.contact;
    } catch (error: any) {
      console.error(
        "Failed to create vendor in Zoho:",
         error.response?.data || error.message,
      );
      throw error;
    }
  }

  async getAccounts(): Promise<any[]> {
    if (this.cache.accounts) return this.cache.accounts;

    const token = await this.getAccessToken();
    const url = `https://www.zohoapis.${this.region}/books/v3/chartofaccounts?organization_id=${this.orgId}`;
    const response = await axios.get(url, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
    });
    this.cache.accounts = response.data.chartofaccounts || [];
    return this.cache.accounts!;
  }

  async getTaxes(): Promise<any[]> {
    if (this.cache.taxes) return this.cache.taxes;

    const token = await this.getAccessToken();
    const url = `https://www.zohoapis.${this.region}/books/v3/settings/taxes?organization_id=${this.orgId}`;
    const response = await axios.get(url, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
    });
    this.cache.taxes = response.data.taxes || [];
    return this.cache.taxes!;
  }

  async uploadAttachment(billId: string, filePath: string) {
    const token = await this.getAccessToken();
    const url = `https://www.zohoapis.${this.region}/books/v3/bills/${billId}/attachment?organization_id=${this.orgId}`;
    
    const form = new FormData();
    form.append("attachment", fs.createReadStream(filePath));

    try {
      const response = await axios.post(url, form, {
        headers: {
          ...form.getHeaders(),
          Authorization: `Zoho-oauthtoken ${token}`,
        },
      });
      return response.data;
    } catch (error: any) {
      console.error(
        "Failed to upload attachment to Zoho:",
        error.response?.data || error.message,
      );
      throw error;
    }
  }

  async getBills(params: any = {}) {
    const token = await this.getAccessToken();
    const url = `https://www.zohoapis.${this.region}/books/v3/bills?organization_id=${this.orgId}`;
    const response = await axios.get(url, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
      params: params
    });
    return response.data.bills || [];
  }
}
