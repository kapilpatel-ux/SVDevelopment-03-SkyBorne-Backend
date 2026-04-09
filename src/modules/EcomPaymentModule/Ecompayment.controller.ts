import { Request, Response } from "express";
import { generateInvoicePDF } from "../../services/invoiceService";
import { EcomStripeService } from "../../services/EcomStripe.service";
import User from "../UserModule/models/User";
import EcomPayment from "./Ecompayment.model";
import Cart from "../ServiceModule/CartModule/Cart.model";
export class EcomPaymentController {
  /**
   * POST /ecom-payments/create-checkout-session
   * Creates a Stripe Checkout session for the user's current cart.
   * Frontend redirects to session.checkoutUrl.
   */
  createCheckoutSession = async (req: Request, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }

      const userId = req.user.id;
      const {
        shippingAddress,
        source = "web",
        successUrl,
        cancelUrl,
      } = req.body as {
        shippingAddress: any;
        source?: "app" | "web";
        successUrl?: string;
        cancelUrl?: string;
      };

      if (
        !shippingAddress?.firstName ||
        !shippingAddress?.lastName ||
        !shippingAddress?.address ||
        !shippingAddress?.city ||
        !shippingAddress?.zip
      ) {
        return res.status(400).json({
          success: false,
          message: "Complete shipping address is required",
        });
      }

      // Load cart
      const cart = await Cart.findOne({ userId }).lean();
      if (!cart || cart.items.length === 0) {
        return res.status(400).json({ success: false, message: "Cart is empty" });
      }

      // Get user email
      const user = await User.findById(userId).lean();
      if (!user) {
        return res.status(404).json({ success: false, message: "User not found" });
      }

      const result = await EcomStripeService.createEcomCheckoutSession(
        userId,
        cart.items.map((item: any) => ({
          name: item.name,
          price: item.price,
          quantity: item.quantity,
          image: item.image,
        })),
        shippingAddress,
        (user as any).email,
        source,
        successUrl,
        cancelUrl
      );

      console.log("✅ [EcomPayment] Checkout session created:", result.orderRef);

      return res.status(200).json({
        success: true,
        message: "Checkout session created",
        data: {
          checkoutUrl: result.checkoutUrl,
          sessionId: result.sessionId,
          orderRef: result.orderRef,
        },
      });
    } catch (error: any) {
      console.error("❌ [EcomPayment] createCheckoutSession error:", error.message);
      return res.status(500).json({ success: false, message: error.message });
    }
  };

  /**
   * GET /ecom-payments/session/:sessionId
   * Returns session details for the success page.
   */
  getSessionDetails = async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      const session = await EcomStripeService.getSessionDetails(sessionId);

      return res.status(200).json({
        success: true,
        data: {
          paymentStatus: session.payment_status,
          amountTotal: (session.amount_total ?? 0) / 100,
          currency: session.currency,
          customerEmail: session.customer_email,
          orderRef: session.metadata?.orderRef,
        },
      });
    } catch (error: any) {
      console.error("❌ [EcomPayment] getSessionDetails error:", error.message);
      return res.status(500).json({ success: false, message: error.message });
    }
  };

  /**
   * GET /ecom-payments/my
   * Returns logged-in user's ecom payment history.
   */
  getMyPayments = async (req: Request, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }

      const payments = await EcomPayment.find({ userId: req.user.id })
        .populate("orderId", "orderNumber totalAmount orderStatus")
        .sort({ createdAt: -1 })
        .lean();

      return res.status(200).json({ success: true, data: payments });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  };

  /**
   * GET /ecom-payments (Admin)
   * Returns all ecom payments with pagination, search, and status filter.
   * Query params: page, limit, search (orderRef / email), status
   */
  getAllPayments = async (req: Request, res: Response) => {
    try {
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 10;
      const skip = (page - 1) * limit;
      const search = (req.query.search as string)?.trim() || "";
      const status = (req.query.status as string)?.trim() || "";

      // ── Build filter ──────────────────────────────────────────────
      const filter: Record<string, any> = {};

      // Status filter — exact match against the enum
      if (status) {
        filter.status = status;
      }

      // Search filter — match orderRef directly on the payment document.
      // For email/name we need a two-step lookup since userId is a ref.
      if (search) {
        // Find matching user IDs first
        const matchingUsers = await User.find({
          $or: [
            { firstName: { $regex: search, $options: "i" } },
            { lastName:  { $regex: search, $options: "i" } },
            { email:     { $regex: search, $options: "i" } },
          ],
        })
          .select("_id")
          .lean();

        const userIds = matchingUsers.map((u) => u._id);

        filter.$or = [
          { orderRef:             { $regex: search, $options: "i" } },
          { stripePaymentIntentId:{ $regex: search, $options: "i" } },
          ...(userIds.length ? [{ userId: { $in: userIds } }] : []),
        ];
      }

      const [payments, total] = await Promise.all([
        EcomPayment.find(filter)
          .populate("userId", "firstName lastName email")
          .populate("orderId", "orderNumber totalAmount orderStatus")
          .populate("customerId")
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        EcomPayment.countDocuments(filter),
      ]);

      return res.status(200).json({
        success: true,
        data: payments,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          hasNextPage: page < Math.ceil(total / limit),
          hasPrevPage: page > 1,
        },
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  };

  /**
   * GET /ecom-payments/admin/stats
   * Returns ecom payment stats for admin dashboard cards.
   */
  getAdminPaymentStats = async (_req: Request, res: Response) => {
    try {
      const payments = await EcomPayment.find().lean();

      if (!payments || payments.length === 0) {
        return res.status(200).json({
          success: true,
          stats: {
            totalRevenue: 0,
            thisMonth: 0,
            totalTransactions: 0,
          },
        });
      }

      const succeededPayments = payments.filter((p) => p.status === "succeeded");
      const totalRevenue = succeededPayments.reduce((sum, p) => sum + (p.amount || 0), 0);

      const now = new Date();
      const currentMonth = now.getMonth();
      const currentYear = now.getFullYear();

      const thisMonth = succeededPayments
        .filter((p) => {
          const d = new Date(p.createdAt);
          return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
        })
        .reduce((sum, p) => sum + (p.amount || 0), 0);

      return res.status(200).json({
        success: true,
        stats: {
          totalRevenue: Number(totalRevenue.toFixed(2)),
          thisMonth: Number(thisMonth.toFixed(2)),
          totalTransactions: payments.length,
        },
      });
    } catch (error: any) {
      console.error("❌ [EcomPayment] getAdminPaymentStats error:", error.message);
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to fetch ecom payment stats",
      });
    }
  };

  /**
   * GET /ecom-payments/:paymentId/receipt
   * Admin: Download receipt file (proxy from Stripe).
   */
  downloadReceipt = async (req: Request, res: Response) => {
    try {
      const { paymentId } = req.params;
      const payment = await EcomPayment.findById(paymentId)
        .populate("orderId", "orderNumber totalAmount orderStatus")
        .lean();

      if (!payment) {
        return res.status(404).json({ success: false, message: "Payment not found" });
      }

      const user = await User.findById(payment.userId).lean();

      if (!user) {
        return res.status(404).json({ success: false, message: "User not found" });
      }

      const orderRef =
        (payment.orderId as any)?.orderNumber ||
        payment.orderRef ||
        payment.stripePaymentIntentId ||
        payment._id.toString();

      const receiptPDF = await generateInvoicePDF({
        invoiceId: payment._id.toString(),
        orderRef,
        transactionId: payment.stripePaymentIntentId,
        userId: user._id.toString(),
        userEmail: user.email,
        userName: `${user.firstName} ${user.lastName}`,
        plan: "Ecom Order",
        amount: payment.amount,
        currency: payment.currency || "USD",
        date: payment.createdAt,
        subscriptionEndDate: payment.createdAt,
        paymentMethod: "Stripe",
      });

      const safeRef = orderRef.replace(/[^a-zA-Z0-9_-]/g, "_");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=\"receipt-${safeRef}.pdf\"`
      );

      return res.status(200).send(receiptPDF);
    } catch (error: any) {
      console.error("❌ [EcomPayment] downloadReceipt error:", error.message);
      return res.status(500).json({ success: false, message: "Failed to download receipt" });
    }
  };
}
