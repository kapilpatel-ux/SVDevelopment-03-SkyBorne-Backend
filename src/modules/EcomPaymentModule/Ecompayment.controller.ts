import { Request, Response } from "express";
import { generateInvoicePDF } from "../../services/invoiceService";
import { EcomStripeService } from "../../services/EcomStripe.service";
import User from "../UserModule/models/User";
import EcomPayment from "./Ecompayment.model";
import Cart from "../ServiceModule/CartModule/Cart.model";
import Order from "../OrderModule/order.model";
export class EcomPaymentController {
  private splitName(fullName?: string): { firstName: string; lastName: string } {
    const safe = String(fullName || "").trim();
    if (!safe) return { firstName: "Customer", lastName: "" };

    const parts = safe.split(/\s+/);
    if (parts.length === 1) return { firstName: parts[0], lastName: "" };

    return {
      firstName: parts[0],
      lastName: parts.slice(1).join(" "),
    };
  }

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

      const checkoutEmail =
        String(shippingAddress?.email || "").trim().toLowerCase() ||
        String((user as any).email || "").trim().toLowerCase();

      const result = await EcomStripeService.createEcomCheckoutSession(
        userId,
        cart.items.map((item: any) => ({
          productId: item.product?.toString?.() || String(item.product),
          name: item.name,
          price: item.price,
          quantity: item.quantity,
          image: item.image,
        })),
        shippingAddress,
        checkoutEmail,
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
   * POST /ecom-payments/reorder/:orderId
   * Creates Stripe checkout session from a previous order (skip checkout form/cart).
   */
  reorderCheckoutSession = async (req: Request, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }

      const userId = req.user.id;
      const { orderId } = req.params;

      const order = await Order.findOne({ _id: orderId, userId }).lean();
      if (!order) {
        return res.status(404).json({
          success: false,
          message: "Order not found",
        });
      }

      const orderStatus = String((order as any).orderStatus || "").toLowerCase();
      const allowedStatuses = ["delivered", "cancelled", "refunded"];
      if (!allowedStatuses.includes(orderStatus)) {
        return res.status(400).json({
          success: false,
          message: "Reorder is only available for completed or past orders",
        });
      }

      const items = Array.isArray((order as any).items) ? (order as any).items : [];
      if (!items.length) {
        return res.status(400).json({
          success: false,
          message: "No items available for reorder",
        });
      }

      const user = await User.findById(userId).lean();
      if (!user) {
        return res.status(404).json({ success: false, message: "User not found" });
      }

      const shipping = (order as any).shippingAddress || {};
      const split = this.splitName(shipping.fullName);
      const shippingAddress = {
        firstName: split.firstName || (user as any).firstName || "Customer",
        lastName: split.lastName || (user as any).lastName || "",
        address: shipping.addressLine1 || "",
        city: shipping.city || (user as any).city || "",
        zip: shipping.postalCode || "",
        phone: shipping.phone || "",
        email: (user as any).email || "",
        state: shipping.state || "",
        country: shipping.country || "",
      };

      const cartItems = items
        .map((item: any) => ({
          productId:
            item?.product?.toString?.() || String(item?.product || "").trim(),
          name: item?.name || "Item",
          price: Number(item?.price || 0),
          quantity: Number(item?.quantity || 0),
          image: item?.image || undefined,
        }))
        .filter((item: any) => item.productId && item.price > 0 && item.quantity > 0);

      if (!cartItems.length) {
        return res.status(400).json({
          success: false,
          message: "Order items are invalid for reorder",
        });
      }

      const checkoutEmail = String((user as any).email || "").trim().toLowerCase();

      const result = await EcomStripeService.createEcomCheckoutSession(
        userId,
        cartItems,
        shippingAddress,
        checkoutEmail,
        "web"
      );

      return res.status(200).json({
        success: true,
        message: "Reorder checkout session created",
        data: {
          checkoutUrl: result.checkoutUrl,
          sessionId: result.sessionId,
          orderRef: result.orderRef,
        },
      });
    } catch (error: any) {
      console.error("❌ [EcomPayment] reorderCheckoutSession error:", error.message);
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
