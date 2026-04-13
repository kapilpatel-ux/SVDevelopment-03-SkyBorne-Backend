

// src/workers/invoiceEmailWorker.ts
import dotenv from "dotenv";
dotenv.config();

import { invoiceEmailQueue } from "../services/queues/invoiceEmailQueue"; 
import sgMail from "@sendgrid/mail";
import { calculateVatFromTotal } from "../utils/vat";
import { initConsoleErrorLogger } from "../utils/consoleLogger";

initConsoleErrorLogger();

sgMail.setApiKey(process.env.SENDGRID_API_KEY!);

invoiceEmailQueue.process(async (job:any) => {;

  const { invoiceId, email, userName, plan, amount, currency, date, subscriptionEndDate, orderRef, invoicePDF, taxRate } = job.data;

  try {
    const pdfBuffer = Buffer.from(invoicePDF, "base64");

    const invoiceDate = new Date(date);
    const subEndDate = new Date(subscriptionEndDate);
    const normalizedTaxRate = Number.isFinite(taxRate) ? taxRate : 0;
    const totals = calculateVatFromTotal(amount, normalizedTaxRate);
    const taxLabel = normalizedTaxRate > 0 ? `VAT (${Math.round(normalizedTaxRate * 100)}%)` : "Tax (0%)";

    const msg = {
      to: email,
      from: process.env.SENDGRID_FROM_EMAIL as string,
      subject: `Invoice #${invoiceId} - ${plan} Plan`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Invoice Received</h2>
          <p>Dear ${userName},</p>
          <p>Thank you for your payment. Your invoice is attached below.</p>
          
          <hr style="border: none; border-top: 2px solid #ddd; margin: 20px 0;">
          
          <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
            <tr style="background-color: #f5f5f5;">
              <td style="padding: 10px; font-weight: bold; border: 1px solid #ddd;">Invoice ID</td>
              <td style="padding: 10px; border: 1px solid #ddd;">${invoiceId}</td>
            </tr>
            <tr>
              <td style="padding: 10px; font-weight: bold; border: 1px solid #ddd;">Order Reference</td>
              <td style="padding: 10px; border: 1px solid #ddd;">${orderRef}</td>
            </tr>
            <tr style="background-color: #f5f5f5;">
              <td style="padding: 10px; font-weight: bold; border: 1px solid #ddd;">Date</td>
              <td style="padding: 10px; border: 1px solid #ddd;">${invoiceDate.toLocaleDateString()}</td>
            </tr>
            <tr>
              <td style="padding: 10px; font-weight: bold; border: 1px solid #ddd;">Plan</td>
              <td style="padding: 10px; border: 1px solid #ddd;">${plan.charAt(0).toUpperCase() + plan.slice(1)}</td>
            </tr>
            <tr style="background-color: #f5f5f5;">
              <td style="padding: 10px; font-weight: bold; border: 1px solid #ddd;">Amount</td>
              <td style="padding: 10px; border: 1px solid #ddd;">${currency} ${amount.toFixed(2)}</td>
            </tr>
            <tr>
              <td style="padding: 10px; font-weight: bold; border: 1px solid #ddd;">Subscription Ends</td>
              <td style="padding: 10px; border: 1px solid #ddd;">${subEndDate.toLocaleDateString()}</td>
            </tr>
          </table>

          <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
            <tr style="background-color: #f5f5f5;">
              <td style="padding: 10px; font-weight: bold; border: 1px solid #ddd;">Subtotal</td>
              <td style="padding: 10px; border: 1px solid #ddd;">${currency} ${totals.subtotal.toFixed(2)}</td>
            </tr>
            <tr>
              <td style="padding: 10px; font-weight: bold; border: 1px solid #ddd;">${taxLabel}</td>
              <td style="padding: 10px; border: 1px solid #ddd;">${currency} ${totals.vatAmount.toFixed(2)}</td>
            </tr>
            <tr style="background-color: #f5f5f5;">
              <td style="padding: 10px; font-weight: bold; border: 1px solid #ddd;">Total</td>
              <td style="padding: 10px; border: 1px solid #ddd;">${currency} ${totals.total.toFixed(2)}</td>
            </tr>
          </table>
          
          <hr style="border: none; border-top: 2px solid #ddd; margin: 20px 0;">
          
          <p>If you have any questions about this invoice or your subscription, please contact our support team.</p>
          <p>Best regards,<br/><strong>SKYBORNE TEAM</strong></p>
          
          <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0; padding-top: 20px;">
          <p style="font-size: 12px; color: #999; text-align: center;">
            This is an automated invoice. Please do not reply to this email.
          </p>
        </div>
      `,
      attachments: [
        {
          content: pdfBuffer.toString("base64"),
          filename: `invoice-${invoiceId}.pdf`,
          type: "application/pdf",
          disposition: "attachment",
        },
      ],
    };


    const response = await sgMail.send(msg as any);

    return { success: true, invoiceId };
  } catch (err: any) {
    console.error(`❌ Invoice email send failed for ${email}`);
    console.error("Error Message:", err.message);

    if (err.response?.body) {
      console.error("🔍 SendGrid Error Body:", JSON.stringify(err.response.body, null, 2));
    }

    const errors = err.response?.body?.errors;
    if (errors && errors.length > 0) {
      console.error("🔥 EXACT SENDGRID ERROR:", errors[0].message);
      console.error("📌 FIELD:", errors[0].field);
    }

    throw err;
  }
});

invoiceEmailQueue.on("completed", (job:any) =>
  console.log(`🎉 Invoice job ${job.id} completed`)
);

invoiceEmailQueue.on("failed", (job:any, err:any) =>
  console.error(`🔥 Invoice job ${job.id} failed: ${err.message}`)
);

