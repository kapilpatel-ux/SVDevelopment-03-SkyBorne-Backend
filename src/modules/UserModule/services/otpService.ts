import redisClient from '../../../config/redis';
import nodemailer from 'nodemailer';
import { logger } from '../../../utils/winston.utils';
import { SendEmailCommand } from "@aws-sdk/client-ses";
import sesClient from '../../../config/ses';
import sgMail from "@sendgrid/mail";

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || "";
const canUseSendGrid = Boolean(SENDGRID_API_KEY && SENDGRID_API_KEY.startsWith("SG."));

if (canUseSendGrid) {
  sgMail.setApiKey(SENDGRID_API_KEY);
} else if (SENDGRID_API_KEY) {
  logger.warn("SendGrid key is present but does not start with SG.; falling back to SMTP/SES for OTP emails");
}


export class OTPService {
  private static readonly OTP_PREFIX = 'otp:';
  private static readonly OTP_EXPIRY = 3600; // 1 hour
  private static readonly memoryOtpStore = new Map<
    string,
    { otp: string; expiresAt: number }
  >();

  private static canUseRedis(): boolean {
    // Avoid hard failures when Redis is unavailable in local/dev environments.
    return Boolean((redisClient as any)?.isReady);
  }

  private static memoryKey(email: string): string {
    return `${this.OTP_PREFIX}${email}`;
  }

  private static setInMemory(email: string, otp: string): void {
    const key = this.memoryKey(email);
    this.memoryOtpStore.set(key, {
      otp,
      expiresAt: Date.now() + this.OTP_EXPIRY * 1000,
    });
  }

  private static getFromMemory(email: string): string | null {
    const key = this.memoryKey(email);
    const record = this.memoryOtpStore.get(key);
    if (!record) return null;
    if (Date.now() > record.expiresAt) {
      this.memoryOtpStore.delete(key);
      return null;
    }
    return record.otp;
  }

  private static delFromMemory(email: string): void {
    this.memoryOtpStore.delete(this.memoryKey(email));
  }

  private static ttlFromMemory(email: string): number {
    const key = this.memoryKey(email);
    const record = this.memoryOtpStore.get(key);
    if (!record) return 0;
    const remainingMs = record.expiresAt - Date.now();
    if (remainingMs <= 0) {
      this.memoryOtpStore.delete(key);
      return 0;
    }
    return Math.ceil(remainingMs / 1000);
  }

  /**
   * Generate and store OTP
   */
  static async generateAndStoreOTP(email: string): Promise<string> {
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const key = this.memoryKey(email);

    if (this.canUseRedis()) {
      try {
        await redisClient.setEx(key, this.OTP_EXPIRY, otp);
      } catch (err: any) {
        logger.error(
          `Redis setEx failed for ${this.maskEmail(email)} | Falling back to memory | Error: ${err?.message || err}`
        );
        this.setInMemory(email, otp);
      }
    } else {
      this.setInMemory(email, otp);
    }

    logger.info(`OTP generated for email: ${this.maskEmail(email)}`);
    return otp;
  }



static async sendEmailOTP(email: string, otp: string): Promise<void> {
  try {
    const msg = {
      to: email,
      from: {
        email: "info@skybornedrop.com",
        name: "Skyborne",
      },
      subject: "Your Skyborne Verification Code",
      html: `
        <html>
  <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
    <div style="max-width: 500px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
      <h2 style="color: #2c3e50;">🔐 Email Verification Required</h2>

      <p>Greetings from our team,</p>

      <p>
        Thank you for registering with us. To complete your verification process,
        please use the One-Time Password (OTP) provided below:
      </p>

      <p style="font-size: 20px; font-weight: bold; color: #000;">
        Your OTP: <span style="color: #007BFF;">${otp}</span>
      </p>

      <p>
        This OTP will remain valid for <b>60 minutes</b>.  
        For your security, please do not share this code with anyone. Our team will never ask for your OTP.
      </p>

      <p>If you did not request this verification, kindly ignore this email.</p>

      <hr style="margin: 20px 0;">
            <p style="font-size: 12px; color: #888;">
      
      </p>

      <p style="font-size: 12px; color: #888;">
        This is an automated message. Please do not reply.
      </p>
    </div>
  </body>
</html>

      `,
    };

    if (canUseSendGrid) {
      const response = await sgMail.send(msg);

      logger.info(
        `OTP Email sent to: ${this.maskEmail(email)} | MessageID: ${response[0].headers["x-message-id"]}`
      );
      return;
    }

    await this.transporter.sendMail({
      from: "Skyborne <info@skybornedrop.com>",
      to: email,
      subject: "Your Skyborne Verification Code",
      html: msg.html,
    });

    logger.info(`OTP Email sent via SMTP to: ${this.maskEmail(email)}`);

  } catch (err: any) {
    logger.error(
      `Email OTP sending failed for ${this.maskEmail(email)} | Error: ${err.message}`
    );

    // Fallback — show OTP only in development
    if (process.env.NODE_ENV === "development") {
      console.log(`
      📩 Email OTP (development mode)
      Email: ${email}
      OTP: ${otp}
      `);
    }
  }
}




  /**
   * Verify OTP
   */
  static async verifyOTP(email: string, otp: string): Promise<boolean> {
    const key = this.memoryKey(email);
    let storedOTP: string | null = null;

    if (this.canUseRedis()) {
      try {
        storedOTP = await redisClient.get(key);
      } catch (err: any) {
        logger.error(
          `Redis get failed for ${this.maskEmail(email)} | Falling back to memory | Error: ${err?.message || err}`
        );
        storedOTP = this.getFromMemory(email);
      }
    } else {
      storedOTP = this.getFromMemory(email);
    }

    if (!storedOTP) {
      logger.warn(`OTP expired or not found for: ${this.maskEmail(email)}`);
      return false;
    }

    if (storedOTP === otp) {
      if (this.canUseRedis()) {
        try {
          await redisClient.del(key);
        } catch (err: any) {
          logger.error(
            `Redis del failed for ${this.maskEmail(email)} | Error: ${err?.message || err}`
          );
        }
      }
      this.delFromMemory(email);
      logger.info(`OTP verified for: ${this.maskEmail(email)}`);
      return true;
    }

    logger.warn(`Invalid OTP attempt for: ${this.maskEmail(email)}`);
    return false;
  }

  /**
   * Resend OTP
   */
  static async resendOTP(email: string): Promise<string> {
    const key = this.memoryKey(email);
    if (this.canUseRedis()) {
      try {
        await redisClient.del(key);
      } catch (err: any) {
        logger.error(
          `Redis del failed for ${this.maskEmail(email)} | Error: ${err?.message || err}`
        );
      }
    }
    this.delFromMemory(email);

    const otp = await this.generateAndStoreOTP(email);
    await this.sendEmailOTP(email, otp);

    logger.info(`OTP resent to email: ${this.maskEmail(email)}`);
    return otp;
  }

  /** Remaining time */
  static async getOTPRemainingTime(email: string): Promise<number> {
    const key = this.memoryKey(email);
    if (this.canUseRedis()) {
      try {
        const ttl = await redisClient.ttl(key);
        return ttl > 0 ? ttl : 0;
      } catch (err: any) {
        logger.error(
          `Redis ttl failed for ${this.maskEmail(email)} | Falling back to memory | Error: ${err?.message || err}`
        );
        return this.ttlFromMemory(email);
      }
    }

    return this.ttlFromMemory(email);
  }

  private static maskEmail(email: string): string {
    const [name, domain] = email.split('@');
    const maskName = name[0] + '*'.repeat(name.length - 1);
    return `${maskName}@${domain}`;
  }

   private static transporter: nodemailer.Transporter;

  static {
    // Initialize transporter once when class loads
    this.transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    });
  }



  // Test the connection
  static async verifyConnection(): Promise<boolean> {
    try {
      await this.transporter.verify();
      logger.info("SMTP connection verified successfully");
      return true;
    } catch (err: any) {
      logger.error(`SMTP connection failed: ${err.message}`);
      return false;
    }
  }

}
