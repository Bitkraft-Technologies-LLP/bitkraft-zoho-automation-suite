import fs from "fs";
import path from "path";

export interface NotificationRecord {
  payment_id: string;
  email_sent: boolean;
  sent_at?: string;
  recipient_email: string;
  subject: string;
  error_message?: string;
}

const STORE_PATH = path.resolve(process.cwd(), "data", "vendor_payment_notifications.json");

export class NotificationStore {
  private static ensureStoreExists() {
    const dir = path.dirname(STORE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(STORE_PATH)) {
      fs.writeFileSync(STORE_PATH, JSON.stringify({}), "utf8");
    }
  }

  public static getAll(): Record<string, NotificationRecord> {
    try {
      this.ensureStoreExists();
      const content = fs.readFileSync(STORE_PATH, "utf8");
      return JSON.parse(content || "{}");
    } catch (error) {
      console.error("Failed to read notification store:", error);
      return {};
    }
  }

  public static get(paymentId: string): NotificationRecord | null {
    const store = this.getAll();
    return store[paymentId] || null;
  }

  public static save(record: NotificationRecord) {
    try {
      this.ensureStoreExists();
      const store = this.getAll();
      store[record.payment_id] = record;
      fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
    } catch (error) {
      console.error(`Failed to save notification record for payment ${record.payment_id}:`, error);
    }
  }
}
