import { ZohoClient } from "../invoice_processing/zoho/zoho-client";
import { NotificationStore, NotificationRecord } from "./notification-store";

export class NotificationService {
  /**
   * Fetches the payment email template from Zoho, sends the email via Zoho API, 
   * and saves the delivery state in the local NotificationStore.
   */
  public static async sendNotification(zoho: ZohoClient, paymentId: string): Promise<NotificationRecord> {
    let recipientEmail = "";
    let subject = "";

    try {
      console.log(`[Notification] Fetching email content for payment: ${paymentId}`);
      const template = await zoho.getVendorPaymentEmailContent(paymentId);
      
      subject = template.subject || `Payment Confirmation (ID: ${paymentId})`;
      const body = template.body || "";

      // Extract to_mail_ids
      let toMailIds: string[] = [];
      if (Array.isArray(template.to_mail_ids)) {
        toMailIds = template.to_mail_ids;
      } else if (Array.isArray(template.to_contacts)) {
        const selected = template.to_contacts.filter((c: any) => c.selected);
        const contactsToUse = selected.length > 0 ? selected : template.to_contacts;
        toMailIds = contactsToUse.map((c: any) => c.email).filter(Boolean);
      }

      if (toMailIds.length === 0) {
        throw new Error("No recipient email address found for vendor payment.");
      }

      recipientEmail = toMailIds.join(", ");

      console.log(`[Notification] Sending email to ${recipientEmail} with subject: "${subject}"`);
      
      await zoho.sendVendorPaymentEmailViaZoho(paymentId, {
        send_from_org_email_id: false,
        to_mail_ids: toMailIds,
        subject,
        body
      });

      console.log(`[Notification] Email sent successfully via Zoho for payment: ${paymentId}`);

      const record: NotificationRecord = {
        payment_id: paymentId,
        email_sent: true,
        sent_at: new Date().toISOString(),
        recipient_email: recipientEmail,
        subject
      };
      NotificationStore.save(record);
      return record;

    } catch (error: any) {
      const errMsg = error.response?.data?.message || error.message || "Unknown error";
      console.error(`[Notification] Failed to send payment confirmation for payment ID ${paymentId}:`, errMsg);

      const record: NotificationRecord = {
        payment_id: paymentId,
        email_sent: false,
        recipient_email: recipientEmail || "Unknown",
        subject: subject || "Payment Confirmation",
        error_message: errMsg
      };
      NotificationStore.save(record);
      return record;
    }
  }
}
