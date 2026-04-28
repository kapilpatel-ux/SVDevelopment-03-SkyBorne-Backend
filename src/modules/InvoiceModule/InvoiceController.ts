// modules/PaymentModule/controllers/InvoiceController.ts
import { Request, Response } from "express";
import { generateInvoicePDF } from "../../services/invoiceService";
import Payment from "../PaymentModule/models/Payment";
import User from "../UserModule/models/User";
import { calculateVatFromTotal, getVatRateForCountry } from "../../utils/vat";

export default class InvoiceController {
  /**
   * GET: Retrieve invoice PDF by invoice ID
   * Admin can view/download any user's invoice
   */
  static async getInvoiceById(req: Request, res: Response) {
    try {
      const { invoiceId } = req.params;

      // Find payment by invoiceId
      const payment = await Payment.findOne({ invoiceId }).populate("userId");

      if (!payment) {
        return res.status(404).json({
          success: false,
          message: "Invoice not found",
        });
      }

      // Get user details
      const user = await User.findById(payment.userId);

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // Calculate subscription end date based on billing type
      const subscriptionDuration =
        payment.billingType === "yearly"
          ? 365 * 24 * 60 * 60 * 1000
          : 30 * 24 * 60 * 60 * 1000;

      const subscriptionEndDate = new Date(
        payment.createdAt.getTime() + subscriptionDuration
      );

      // Generate PDF
      const vatRate = getVatRateForCountry(user.country, user.countryCode);

      const invoicePDF = await generateInvoicePDF({
        invoiceId: payment.invoiceId!,
        orderRef: payment.orderRef,
        transactionId: payment?.transactionId,
        userId: user._id.toString(),
        userEmail: user.email,
        userName: `${user.firstName} ${user.lastName}`,
        plan: payment.plan.charAt(0).toUpperCase() + payment.plan.slice(1),
        amount: payment.amount,
        currency: "USD",
        date: payment.createdAt,
        subscriptionEndDate,
        paymentMethod: `${payment.gateway.toUpperCase()} Payment Gateway`,
        taxRate: vatRate,
      });

      // Set response headers for PDF download
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="invoice-${invoiceId}.pdf"`
      );

      return res.send(invoicePDF);
    } catch (error) {
      console.error("❌ Error retrieving invoice:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to retrieve invoice",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  /**
   * GET: Retrieve invoice details (metadata only, not PDF)
   * Useful for displaying invoice info in admin panel without generating PDF
   */
  static async getInvoiceDetails(req: Request, res: Response) {
    try {
      const { invoiceId } = req.params;

      const payment = await Payment.findOne({ invoiceId }).populate("userId");

      if (!payment) {
        return res.status(404).json({
          success: false,
          message: "Invoice not found",
        });
      }

      const user = await User.findById(payment.userId);

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      const subscriptionDuration =
        payment.billingType === "yearly"
          ? 365 * 24 * 60 * 60 * 1000
          : 30 * 24 * 60 * 60 * 1000;

      const subscriptionEndDate = new Date(
        payment.createdAt.getTime() + subscriptionDuration
      );

      const vatRate = getVatRateForCountry(user.country, user.countryCode);
      const totals = calculateVatFromTotal(payment.amount, vatRate);
      const taxLabel =
        vatRate > 0 ? `VAT (${Math.round(vatRate * 100)}%)` : "Tax (0%)";

      return res.status(200).json({
        success: true,
        invoice: {
          invoiceId: payment.invoiceId,
          orderRef: payment.orderRef,
          transactionId: payment?.transactionId,
          userName: `${user.firstName} ${user.lastName}`,
          userEmail: user.email,
          plan: payment.plan,
          amount: payment.amount,
          currency: "USD",
          status: payment.status,
          paymentMethod: payment.gateway,
          billingType: payment.billingType,
          date: payment.createdAt,
          subscriptionEndDate,
          taxRate: vatRate,
          subtotal: totals.subtotal,
          vatAmount: totals.vatAmount,
          total: totals.total,
          taxLabel,
        },
      });
    } catch (error) {
      console.error("❌ Error retrieving invoice details:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to retrieve invoice details",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  /**
   * GET: Get all invoices for a specific user
   */
  static async getUserInvoices(req: Request, res: Response) {
    try {
      const { userId } = req.params;
      const { limit = 10, page = 1 } = req.query;

      const skip = (Number(page) - 1) * Number(limit);

      // Fetch payments with invoices for this user
      const payments = await Payment.find({
        userId,
        invoiceId: { $exists: true, $ne: null },
        status: "COMPLETED",
      })
        .sort({ createdAt: -1 })
        .limit(Number(limit))
        .skip(skip);

      const total = await Payment.countDocuments({
        userId,
        invoiceId: { $exists: true, $ne: null },
        status: "COMPLETED",
      });

      const invoices = payments.map((payment) => ({
        invoiceId: payment.invoiceId,
        orderRef: payment.orderRef,
        amount: payment.amount,
        currency: "USD",
        plan: payment.plan,
        status: payment.status,
        paymentMethod: payment.gateway,
        billingType: payment.billingType,
        date: payment.createdAt,
      }));

      return res.status(200).json({
        success: true,
        invoices,
        pagination: {
          total,
          page: Number(page),
          limit: Number(limit),
          totalPages: Math.ceil(total / Number(limit)),
        },
      });
    } catch (error) {
      console.error("❌ Error retrieving user invoices:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to retrieve user invoices",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
}
