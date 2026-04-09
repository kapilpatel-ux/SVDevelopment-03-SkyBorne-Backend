// src/services/invoiceService.ts
import PDFDocument from "pdfkit";
import { Readable } from "stream";
import sgMail from "@sendgrid/mail";
import { calculateVatFromTotal } from "../utils/vat";

export interface InvoiceData {
  invoiceId: string;
  orderRef: string;
  userId: string;
  userEmail: string;
  userName: string;
  plan: string;
  amount: number;
  currency: string;
  transactionId?: string;
  date: Date;
  subscriptionEndDate: Date;
  paymentMethod: string;
  taxRate?: number;
}

export const generateInvoicePDF = (invoiceData: InvoiceData): Promise<Buffer> => {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const buffers: Buffer[] = [];

    doc.on("data", buffers.push.bind(buffers));
    doc.on("end", () => resolve(Buffer.concat(buffers)));
    doc.on("error", reject);

    const PAGE_WIDTH = 545;
    const displayCurrency = "USD";
    const taxRate = Number.isFinite(invoiceData.taxRate) ? invoiceData.taxRate! : 0;
    const totals = calculateVatFromTotal(invoiceData.amount, taxRate);
    const taxLabel = taxRate > 0 ? `VAT (${Math.round(taxRate * 100)}%)` : "Tax (0%)";

    doc.font("Helvetica-Bold").fontSize(24).text("INVOICE");
    doc.moveDown(0.8);

    doc.font("Helvetica").fontSize(10)
      .text(`Invoice ID: ${invoiceData.invoiceId}`)
      .text(`Order Reference: ${invoiceData.orderRef}`)
      .text(`Transaction ID: ${invoiceData.transactionId || "N/A"}`)
      .text(`Date: ${invoiceData.date.toLocaleDateString()}`)
      .text(`User ID: ${invoiceData.userId}`);

    doc.moveDown(1.2);

    const startY = doc.y;
    const leftX = 50;
    const rightX = 320;

    doc.font("Helvetica-Bold").fontSize(11).text("From:", leftX, startY);
    doc.font("Helvetica").fontSize(10)
      .text("SKYBORNE", leftX)
      .text("Skyborne Drop and Tech Investments LLC", leftX)
      .text("Meydan Freezone, Dubai, UAE", leftX)
      .text("info@skybornedrop.com", leftX);

    doc.font("Helvetica-Bold").fontSize(11).text("Bill To:", rightX, startY);
    doc.font("Helvetica").fontSize(10)
      .text(invoiceData.userName, rightX)
      .text(invoiceData.userEmail, rightX);

    doc.moveDown(4);

    doc.moveTo(50, doc.y).lineTo(PAGE_WIDTH, doc.y).stroke();
    doc.moveDown(1);

    const tableY = doc.y;

    const col = {
      desc: 50,
      plan: 250,
      amt: 370,
      total: 460,
    };

    doc.font("Helvetica-Bold").fontSize(11)
      .text("Description", col.desc, tableY)
      .text("Plan", col.plan, tableY)
      .text("Amount", col.amt, tableY)
      .text("Total", col.total, tableY);

    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(PAGE_WIDTH, doc.y).stroke();
    doc.moveDown(0.7);

    const rowY = doc.y;

    doc.font("Helvetica").fontSize(10)
      .text("Subscription Plan", col.desc, rowY)
      .text(invoiceData.plan, col.plan, rowY)
      .text(`${displayCurrency} ${totals.subtotal.toFixed(2)}`, col.amt, rowY)
      .text(`${displayCurrency} ${totals.subtotal.toFixed(2)}`, col.total, rowY);

    doc.moveDown(2);

    const sumX = 350;

    doc.font("Helvetica-Bold").fontSize(11).text("Subtotal:", sumX);
    doc.font("Helvetica").fontSize(10).text(`${displayCurrency} ${totals.subtotal.toFixed(2)}`, sumX);

    doc.moveDown(0.3);
    doc.font("Helvetica-Bold").fontSize(11).text(`${taxLabel}:`, sumX);
    doc.font("Helvetica").fontSize(10).text(`${displayCurrency} ${totals.vatAmount.toFixed(2)}`, sumX);

    doc.moveDown(0.3);
    doc.font("Helvetica-Bold").fontSize(12).text("Total:", sumX);
    doc.font("Helvetica-Bold").fontSize(12).text(`${displayCurrency} ${totals.total.toFixed(2)}`, sumX);

    doc.moveDown(2);

    doc.font("Helvetica-Bold").fontSize(11).text("Subscription Details:");
    doc.font("Helvetica").fontSize(10)
      .text(`Plan: ${invoiceData.plan}`)
      .text(`Subscription End Date: ${invoiceData.subscriptionEndDate.toLocaleDateString()}`)
      .text(`Payment Method: ${invoiceData.paymentMethod}`)
      .text(`Transaction ID: ${invoiceData.transactionId || "N/A"}`);

    doc.moveDown(3);
    doc.fontSize(8).font("Helvetica")
      .text("This invoice is automatically generated. Thank you for your purchase.", {
        align: "center",
      });

    doc.end();
  });
};



export const sendInvoiceEmail = async (
  invoiceData: InvoiceData,
  invoicePDF: Buffer
): Promise<void> => {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY!);

  const fileName = `invoice-${invoiceData.invoiceId}.pdf`;
  const taxRate = Number.isFinite(invoiceData.taxRate) ? invoiceData.taxRate! : 0;
  const totals = calculateVatFromTotal(invoiceData.amount, taxRate);
  const taxLabel = taxRate > 0 ? `VAT (${Math.round(taxRate * 100)}%)` : "Tax (0%)";

  const msg = {
    to: invoiceData.userEmail,
    from: process.env.SENDGRID_FROM_EMAIL as string,
    subject: `Invoice #${invoiceData.invoiceId} - ${invoiceData.plan} Plan`,
    html: `
      <h2>Invoice Received</h2>
      <p>Dear ${invoiceData.userName},</p>
      <p>Thank you for your payment. Your invoice is attached below.</p>
      <hr />
      <table style="width: 100%; margin: 20px 0;">
        <tr>
          <td><strong>Invoice ID:</strong></td>
          <td>${invoiceData.invoiceId}</td>
        </tr>
        <tr>
          <td><strong>Order Reference:</strong></td>
          <td>${invoiceData.orderRef}</td>
        </tr>
        <tr>
          <td><strong>Date:</strong></td>
          <td>${invoiceData.date.toLocaleDateString()}</td>
        </tr>
        <tr>
          <td><strong>Transaction ID:</strong></td>
          <td>${invoiceData.transactionId || "N/A"}</td>
        </tr>
        <tr>
          <td><strong>Plan:</strong></td>
          <td>${invoiceData.plan}</td>
        </tr>
        <tr>
          <td><strong>Amount:</strong></td>
          <td>${invoiceData.currency} ${invoiceData.amount.toFixed(2)}</td>
        </tr>
        <tr>
          <td><strong>Subscription Ends:</strong></td>
          <td>${invoiceData.subscriptionEndDate.toLocaleDateString()}</td>
        </tr>
      </table>
      <table style="width: 100%; margin: 20px 0;">
        <tr>
          <td><strong>Subtotal:</strong></td>
          <td>${invoiceData.currency} ${totals.subtotal.toFixed(2)}</td>
        </tr>
        <tr>
          <td><strong>${taxLabel}:</strong></td>
          <td>${invoiceData.currency} ${totals.vatAmount.toFixed(2)}</td>
        </tr>
        <tr>
          <td><strong>Total:</strong></td>
          <td>${invoiceData.currency} ${totals.total.toFixed(2)}</td>
        </tr>
      </table>
      <hr />
      <p>If you have any questions, please contact our support team.</p>
      <p>Best regards,<br/>SKYBORNE TEAM</p>
    `,
    attachments: [
      {
        content: invoicePDF.toString("base64"),
        filename: fileName,
        type: "application/pdf",
        disposition: "attachment",
      },
    ],
  };

  try {
    await sgMail.send(msg as any);
  } catch (error) {
    console.error("❌ Failed to send invoice email:", error);
    throw error;
  }
};
