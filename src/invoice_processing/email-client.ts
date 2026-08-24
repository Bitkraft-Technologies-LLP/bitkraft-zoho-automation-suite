import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

export interface EmailAttachment {
  id: string;
  name: string;
  contentType: string;
  size: number;
  contentBytes: string; // Base64 encoded content
}

export class EmailClient {
  private tenantId: string;
  private clientId: string;
  private clientSecret: string;
  private sharedEmail: string;
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor() {
    this.tenantId = process.env.OFFICE365_TENANT_ID || "";
    this.clientId = process.env.OFFICE365_CLIENT_ID || "";
    this.clientSecret = process.env.OFFICE365_CLIENT_SECRET || "";
    this.sharedEmail = process.env.OFFICE365_SHARED_EMAIL || "accounts@bitkraft.co.in";

    if (!this.tenantId || !this.clientId || !this.clientSecret) {
      throw new Error("Missing Microsoft Office 365 credentials in .env file (OFFICE365_TENANT_ID, OFFICE365_CLIENT_ID, OFFICE365_CLIENT_SECRET)");
    }
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    const url = `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`;
    const params = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.clientId,
      client_secret: this.clientSecret,
      scope: "https://graph.microsoft.com/.default",
    });

    try {
      const res = await axios.post(url, params.toString(), {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      this.accessToken = res.data.access_token;
      this.tokenExpiry = Date.now() + (res.data.expires_in - 300) * 1000;
      return this.accessToken!;
    } catch (error: any) {
      console.error("Failed to authenticate with Office 365:", error.response?.data || error.message);
      throw new Error(`Office 365 Authentication Failed: ${error.message}`);
    }
  }

  /**
   * Fetch unread messages from the shared inbox that have attachments
   */
  public async getUnreadMessages(): Promise<any[]> {
    const token = await this.getAccessToken();
    const url = `https://graph.microsoft.com/v1.0/users/${this.sharedEmail}/mailFolders/Inbox/messages`;
    
    try {
      const res = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` },
        params: {
          $filter: "isRead eq false and hasAttachments eq true",
          $select: "id,subject,from,receivedDateTime,hasAttachments",
          $top: 20
        }
      });
      return res.data.value || [];
    } catch (error: any) {
      console.error("Failed to query emails from Graph API:", error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Get attachments for a specific email message
   */
  public async getMessageAttachments(messageId: string): Promise<EmailAttachment[]> {
    const token = await this.getAccessToken();
    const url = `https://graph.microsoft.com/v1.0/users/${this.sharedEmail}/messages/${messageId}/attachments`;

    try {
      const res = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` }
      });
      return res.data.value || [];
    } catch (error: any) {
      console.error(`Failed to get attachments for message ${messageId}:`, error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Mark message as read and add category flag
   */
  public async markAsProcessed(messageId: string): Promise<void> {
    const token = await this.getAccessToken();
    const url = `https://graph.microsoft.com/v1.0/users/${this.sharedEmail}/messages/${messageId}`;

    try {
      await axios.patch(url, {
        isRead: true,
        categories: ["Zoho Ingested"]
      }, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        }
      });
      console.log(`[Email Client] Marked message ${messageId} as read and flagged with category.`);
    } catch (error: any) {
      console.error(`Failed to mark email ${messageId} as processed:`, error.response?.data || error.message);
    }
  }
}
