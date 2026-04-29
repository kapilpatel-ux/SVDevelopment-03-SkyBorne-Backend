import { Request, Response } from "express";
import mongoose from "mongoose";
import Order from "./order.model";
import Product from "../ProductModule/product.models";
import Customer from "../CustomerModule/customer.model";
import User from "../UserModule/models/User";
import EcomPayment from "../EcomPaymentModule/Ecompayment.model";
import { EcomStripeService } from "../../services/EcomStripe.service";
import {
  sendEcomOrderCancelledEmails,
  sendEcomOrderStatusUpdatedEmails,
} from "../../services/ecomOrderEmail.service";

export class OrderController {
  /* ============================= */
  /* PLACE ORDER */
  /* ============================= */
  placeOrder = async (req: Request, res: Response) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      console.log("🔵 [PlaceOrder] Request received");
      console.log("🔵 [PlaceOrder] User:", req.user);

      if (!req.user) {
        console.warn("🟡 [PlaceOrder] Unauthorized - No user found");
        return res.status(401).json({
          success: false,
          message: "Unauthorized",
        });
      }

      const userId = req.user.id;
      console.log("🔵 [PlaceOrder] User ID:", userId);

      const {
        items,
        shippingAddress,
        paymentMethod,
        tax = 0,
        shippingCharge = 0,
        discount = 0,
      } = req.body;

      console.log("🔵 [PlaceOrder] Order items:", items);
      console.log("🔵 [PlaceOrder] Payment method:", paymentMethod);

      if (!items || items.length === 0) {
        console.warn("🟡 [PlaceOrder] No items in order");
        return res.status(400).json({
          success: false,
          message: "Order items are required",
        });
      }

      /* ============================= */
      /* FIND OR CREATE CUSTOMER */
      /* ============================= */
      console.log("🔵 [PlaceOrder] Finding customer for userId:", userId);
      let customer = await Customer.findOne({ userId }).session(session);

      if (!customer) {
        console.log("🔵 [PlaceOrder] Customer not found, creating new customer");
        customer = await Customer.create(
          [
            {
              userId,
              totalOrders: 0,
              totalSpent: 0,
              lastOrderAt: new Date(),
            },
          ],
          { session }
        ).then((res) => res[0]);
        console.log("✅ [PlaceOrder] Customer created:", customer?._id);
      } else {
        console.log("✅ [PlaceOrder] Customer found:", customer._id);
      }

      if (!customer) {
        console.error("❌ [PlaceOrder] Customer creation failed");
        throw new Error("Customer creation failed");
      }

      /* ============================= */
      /* PREPARE ORDER ITEMS */
      /* ============================= */
      console.log("🔵 [PlaceOrder] Processing order items...");
      let subtotal = 0;
      const orderItems = [];

      for (const item of items) {
        console.log("🔵 [PlaceOrder] Processing item:", item.product);
        const product = await Product.findById(item.product).session(session);

        if (!product) {
          console.error("❌ [PlaceOrder] Product not found:", item.product);
          throw new Error("Product not found");
        }

        if ((product as any).stock < item.quantity) {
          console.warn("🟡 [PlaceOrder] Insufficient stock for:", product.name);
          throw new Error(`Insufficient stock for ${product.name}`);
        }

        (product as any).stock -= item.quantity;
        await product.save({ session });

        const itemTotal = product.price * item.quantity;
        subtotal += itemTotal;

        orderItems.push({
          product: product._id,
          name: product.name,
          price: product.price,
          quantity: item.quantity,
          image: product.image,
        });

        console.log("✅ [PlaceOrder] Item processed:", product.name);
      }

      const totalAmount = subtotal + tax + shippingCharge - discount;
      console.log("🔵 [PlaceOrder] Total amount:", totalAmount);

      /* ============================= */
      /* CREATE ORDER */
      /* ============================= */
      console.log("🔵 [PlaceOrder] Creating order in database...");
      const order = await Order.create(
        [
          {
            orderNumber: `ORD-${Date.now()}`,
            userId,
            customerId: customer.id,
            items: orderItems,
            subtotal,
            tax,
            shippingCharge,
            discount,
            totalAmount,
            paymentMethod,
            paymentStatus:
              paymentMethod === "COD" ? "Pending" : "Pending",
            orderStatus: "Pending",
            shippingAddress,
            isPaid: paymentMethod === "COD" ? false : false,
          },
        ],
        { session }
      ).then((res) => res[0]);

      console.log("✅ [PlaceOrder] Order created successfully:", order?._id);

      /* ============================= */
      /* UPDATE CUSTOMER */
      /* ============================= */
      console.log("🔵 [PlaceOrder] Updating customer stats...");
      customer.totalOrders += 1;
      customer.totalSpent += totalAmount;
      (customer as any).lastOrderAt = new Date();
      await customer.save({ session });
      console.log("✅ [PlaceOrder] Customer updated");

      await session.commitTransaction();
      session.endSession();

      console.log("✅ [PlaceOrder] Transaction committed successfully");
      return res.status(201).json({
        success: true,
        message: "Order placed successfully",
        data: order,
      });
    } catch (error: any) {
      console.error("❌ [PlaceOrder] Error:", error.message);
      console.error("❌ [PlaceOrder] Stack:", error.stack);

      await session.abortTransaction();
      session.endSession();

      return res.status(400).json({
        success: false,
        message: error.message || "Order placement failed",
      });
    }
  };

  /* ============================= */
  /* GET USER ORDERS (PAGINATED) */
  /* ============================= */
  getMyOrders = async (req: Request, res: Response) => {
    try {
      console.log("🔵 [GetMyOrders] Request received");
      console.log("🔵 [GetMyOrders] User:", req.user);

      if (!req.user) {
        console.warn("🟡 [GetMyOrders] Unauthorized - No user found");
        return res.status(401).json({
          success: false,
          message: "Unauthorized",
        });
      }

      const userId = req.user.id;
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 10;
      const search = (req.query.search as string) || "";
      const status = (req.query.status as string) || "";
      const paymentStatus = (req.query.paymentStatus as string) || "";

      const skip = (page - 1) * limit;

      console.log("🔵 [GetMyOrders] Fetching orders for userId:", userId);
      console.log("🔵 [GetMyOrders] Pagination - Page:", page, "Limit:", limit, "Skip:", skip);
      console.log("🔵 [GetMyOrders] Search:", search);
      console.log("🔵 [GetMyOrders] Filters - Status:", status, "PaymentStatus:", paymentStatus);

      // Build query
      const query: any = { userId };

      if (status && status !== "all") {
        query.orderStatus = status;
      }

      if (paymentStatus && paymentStatus !== "all") {
        query.paymentStatus = paymentStatus;
      }

      // Add search filter for order number or shipping address
      if (search) {
        query.$or = [
          { orderNumber: { $regex: search, $options: "i" } },
          { "shippingAddress.fullName": { $regex: search, $options: "i" } },
        ];
      }

      const [orders, total] = await Promise.all([
        Order.find(query)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .populate("userId", "firstName lastName email"),
        Order.countDocuments(query),
      ]);

      console.log("✅ [GetMyOrders] Orders found:", orders.length);
      console.log("✅ [GetMyOrders] Total count:", total);

      return res.status(200).json({
        success: true,
        data: orders,
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
      console.error("❌ [GetMyOrders] Error:", error.message);
      console.error("❌ [GetMyOrders] Stack:", error.stack);

      return res.status(500).json({
        success: false,
        message: error.message || "Failed to fetch orders",
      });
    }
  };

  /* ============================= */
  /* ADMIN: GET ALL ORDERS */
  /* ============================= */
  getAllOrders = async (req: Request, res: Response) => {
    try {
      console.log("🔵 [GetAllOrders] Admin request received");
      console.log("🔵 [GetAllOrders] User role:", req.user?.role);

      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 10;
      const search = ((req.query.search as string) || "").trim();
      const status = (req.query.status as string) || "";
      const paymentStatus = (req.query.paymentStatus as string) || "";

      const skip = (page - 1) * limit;

      console.log("🔵 [GetAllOrders] Pagination - Page:", page, "Limit:", limit, "Skip:", skip);
      console.log("🔵 [GetAllOrders] Search:", search);
      console.log("🔵 [GetAllOrders] Filters - Status:", status, "PaymentStatus:", paymentStatus);

      // Build query
      const filters: any = {};

      if (status && status !== "all") {
        filters.orderStatus = status;
      }

      if (paymentStatus && paymentStatus !== "all") {
        filters.paymentStatus = paymentStatus;
      }

      // Add search filter for order number, shipping info, or user identity
      if (search) {
        const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const searchRegex = new RegExp(escapedSearch, "i");

        const matchedUsers = await User.find({
          $or: [
            { firstName: searchRegex },
            { lastName: searchRegex },
            { email: searchRegex },
          ],
        })
          .select("_id")
          .lean();

        const matchedUserIds = matchedUsers.map((user: any) => user._id);

        const searchFilters: any[] = [
          { orderNumber: searchRegex },
          { "shippingAddress.fullName": searchRegex },
          { "shippingAddress.phone": searchRegex },
        ];

        if (matchedUserIds.length) {
          searchFilters.push({ userId: { $in: matchedUserIds } });
        }

        filters.$or = searchFilters;
      }

      console.log("🔵 [GetAllOrders] Applied filters:", filters);

      const [orders, total] = await Promise.all([
        Order.find(filters)
          .populate("userId", "firstName lastName email")
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Order.countDocuments(filters),
      ]);

      const orderIds = orders.map((order: any) => order._id);
      const payments = orderIds.length
        ? await EcomPayment.find({ orderId: { $in: orderIds } })
            .select("orderId stripePaymentIntentId")
            .lean()
        : [];

      const paymentByOrderId = new Map(
        payments.map((payment: any) => [String(payment.orderId), payment.stripePaymentIntentId])
      );

      const ordersWithStripe = orders.map((order: any) => ({
        ...order,
        stripePaymentIntentId:
          order.stripePaymentIntentId || paymentByOrderId.get(String(order._id)),
      }));

      console.log("✅ [GetAllOrders] Orders found:", orders.length);
      console.log("✅ [GetAllOrders] Total count:", total);

      return res.status(200).json({
        success: true,
        data: ordersWithStripe,
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
      console.error("❌ [GetAllOrders] Error:", error.message);
      console.error("❌ [GetAllOrders] Stack:", error.stack);

      return res.status(500).json({
        success: false,
        message: error.message || "Failed to fetch orders",
      });
    }
  };

  /* ============================= */
  /* UPDATE ORDER STATUS (ADMIN) */
  /* ============================= */
  updateOrderStatus = async (req: Request, res: Response) => {
    try {
      console.log("🔵 [UpdateOrderStatus] Request received");
      console.log("🔵 [UpdateOrderStatus] Order ID:", req.params.orderId);
      console.log("🔵 [UpdateOrderStatus] New status:", req.body.orderStatus);

      const { orderId } = req.params;
      const { orderStatus } = req.body;

      const order = await Order.findById(orderId);

      if (!order) {
        console.warn("🟡 [UpdateOrderStatus] Order not found:", orderId);
        return res.status(404).json({
          success: false,
          message: "Order not found",
        });
      }

      console.log("✅ [UpdateOrderStatus] Order found");
      console.log("🔵 [UpdateOrderStatus] Current status:", order.orderStatus);

      const previousStatus = String(order.orderStatus || "");
      order.orderStatus = orderStatus;

      if (orderStatus === "Delivered") {
        order.deliveredAt = new Date();
        console.log("🔵 [UpdateOrderStatus] Setting deliveredAt:", order.deliveredAt);
      }

      await order.save();
      console.log("✅ [UpdateOrderStatus] Order updated successfully");

      void (async () => {
        try {
          const user = await User.findById(order.userId)
            .select("firstName lastName email")
            .lean();
          const userEmail = String((user as any)?.email || "").trim();

          await sendEcomOrderStatusUpdatedEmails({
            orderNumber: String((order as any).orderNumber || orderId),
            totalAmount: Number((order as any).totalAmount || 0),
            updatedAt: new Date(),
            previousStatus,
            newStatus: String(orderStatus || ""),
            user: {
              id: String(order.userId),
              firstName: (user as any)?.firstName,
              lastName: (user as any)?.lastName,
              email: userEmail || undefined,
            },
          });
        } catch (emailError: any) {
          console.warn(
            "⚠️ [UpdateOrderStatus] Failed to send status update emails:",
            emailError?.message || emailError
          );
        }
      })();

      return res.status(200).json({
        success: true,
        message: "Order status updated",
        data: order,
      });
    } catch (error: any) {
      console.error("❌ [UpdateOrderStatus] Error:", error.message);
      console.error("❌ [UpdateOrderStatus] Stack:", error.stack);

      return res.status(400).json({
        success: false,
        message: error.message || "Failed to update order",
      });
    }
  };

  /* ============================= */
  /* CANCEL ORDER (USER) */
  /* ============================= */
  cancelOrder = async (req: Request, res: Response) => {
    let session: mongoose.ClientSession | null = null;
    const { orderId } = req.params;

    const triggerCancelEmails = (order: any, cancelledBy: "customer" | "admin") => {
      void (async () => {
        try {
          const user = await User.findById(order.userId)
            .select("firstName lastName email")
            .lean();
          const userEmail = String((user as any)?.email || "").trim();

          await sendEcomOrderCancelledEmails({
            orderNumber: String((order as any).orderNumber || orderId),
            totalAmount: Number((order as any).totalAmount || 0),
            cancelledAt: new Date(),
            cancelledBy,
            user: {
              id: String(order.userId),
              firstName: (user as any)?.firstName,
              lastName: (user as any)?.lastName,
              email: userEmail || undefined,
            },
          });
        } catch (emailError: any) {
          console.warn(
            "⚠️ [CancelOrder] Failed to send cancellation emails:",
            emailError?.message || emailError
          );
        }
      })();
    };

    const runCancel = async (activeSession?: mongoose.ClientSession) => {
      const orderQuery = Order.findById(orderId);
      const order: any = activeSession ? await orderQuery.session(activeSession) : await orderQuery;

      if (!order) {
        return { status: 404, message: "Order not found" };
      }

      const userId = req.user?.id;
      if (order.userId?.toString() !== userId && req.user?.role !== "admin") {
        return { status: 403, message: "You don't have permission to cancel this order" };
      }

      if (String(order.orderStatus || "").toLowerCase() !== "pending") {
        return { status: 400, message: "Only pending orders can be cancelled" };
      }

      // Restore stock for each item
      if (Array.isArray(order.items)) {
        for (const item of order.items) {
          const productQuery = Product.findById(item.product);
          const product = activeSession ? await productQuery.session(activeSession) : await productQuery;
          if (product) {
            (product as any).stock = ((product as any).stock || 0) + item.quantity;
            if (activeSession) {
              await product.save({ session: activeSession });
            } else {
              await product.save();
            }
          }
        }
      }

      order.orderStatus = "Cancelled";
      if (activeSession) {
        await order.save({ session: activeSession });
      } else {
        await order.save();
      }

      return { status: 200, order };
    };

    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: "Unauthorized",
        });
      }

      if (!mongoose.Types.ObjectId.isValid(orderId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid order ID format",
        });
      }

      session = await mongoose.startSession();
      session.startTransaction();

      const txnResult = await runCancel(session);
      if (txnResult.status !== 200) {
        await session.abortTransaction();
        session.endSession();
        return res.status(txnResult.status).json({
          success: false,
          message: txnResult.message,
        });
      }

      await session.commitTransaction();
      session.endSession();

      const cancelledBy =
        req.user?.role === "admin" ? "admin" : "customer";

      triggerCancelEmails(txnResult.order, cancelledBy);

      return res.status(200).json({
        success: true,
        message: "Order cancelled successfully",
        data: txnResult.order,
      });
    } catch (error: any) {
      const message = error?.message ?? "";
      const isTxnError =
        /Transaction numbers are only allowed|replica set member|mongos|not running with --replSet/i.test(message);

      if (session) {
        try {
          if (session.inTransaction()) {
            await session.abortTransaction();
          }
        } catch (abortError) {
          console.warn("⚠️ [CancelOrder] Failed to abort transaction:", (abortError as any)?.message);
        }
        session.endSession();
      }

      if (isTxnError) {
        try {
          const fallbackResult = await runCancel();

          if (fallbackResult.status !== 200) {
            return res.status(fallbackResult.status).json({
              success: false,
              message: fallbackResult.message,
            });
          }

          const cancelledBy =
            req.user?.role === "admin" ? "admin" : "customer";
          triggerCancelEmails(fallbackResult.order, cancelledBy);

          return res.status(200).json({
            success: true,
            message: "Order cancelled successfully",
            data: fallbackResult.order,
          });
        } catch (fallbackError: any) {
          return res.status(400).json({
            success: false,
            message: fallbackError.message || "Failed to cancel order",
          });
        }
      }

      return res.status(400).json({
        success: false,
        message: message || "Failed to cancel order",
      });
    }
  };

  /* ============================= */
  /* REFUND ORDER (ADMIN) */
  /* ============================= */
  refundOrder = async (req: Request, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: "Unauthorized",
        });
      }

      const { orderId } = req.params;
      const requestedAmount = Number(req.body?.amount);

      if (!mongoose.Types.ObjectId.isValid(orderId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid order ID format",
        });
      }

      const order: any = await Order.findById(orderId);
      if (!order) {
        return res.status(404).json({
          success: false,
          message: "Order not found",
        });
      }

      if (String(order.orderStatus || "").toLowerCase() !== "cancelled") {
        return res.status(400).json({
          success: false,
          message: "Only cancelled orders can be refunded",
        });
      }

      if (String(order.paymentStatus || "").toLowerCase() === "refunded") {
        return res.status(400).json({
          success: false,
          message: "Order already refunded",
        });
      }

      if (String(order.paymentStatus || "").toLowerCase() !== "paid") {
        return res.status(400).json({
          success: false,
          message: "Only paid orders can be refunded",
        });
      }

      if (String(order.paymentMethod || "").toLowerCase() !== "stripe") {
        return res.status(400).json({
          success: false,
          message: "Refunds are only supported for Stripe payments",
        });
      }

      const payment = await EcomPayment.findOne({ orderId: order._id });
      if (!payment || !payment.stripePaymentIntentId) {
        return res.status(404).json({
          success: false,
          message: "Payment record not found for this order",
        });
      }

      if (String(payment.status || "").toLowerCase() === "refunded") {
        return res.status(400).json({
          success: false,
          message: "Payment already refunded",
        });
      }

      const fallbackCents = Math.round((order.totalAmount || 0) * 100);
      const maxRefundCents =
        typeof payment.amountInCents === "number" && payment.amountInCents > 0
          ? payment.amountInCents
          : fallbackCents;

      let refundAmountCents = maxRefundCents;
      if (Number.isFinite(requestedAmount) && requestedAmount > 0) {
        refundAmountCents = Math.round(requestedAmount * 100);
      }

      if (refundAmountCents > maxRefundCents) {
        return res.status(400).json({
          success: false,
          message: "Refund amount exceeds captured payment amount",
        });
      }

      const refund = await EcomStripeService.refundPaymentIntent(
        payment.stripePaymentIntentId,
        refundAmountCents === maxRefundCents ? undefined : refundAmountCents
      );

      payment.status = "refunded";
      payment.metadata = {
        ...(payment.metadata || {}),
        refundId: refund.id,
        refundedAt: new Date().toISOString(),
        refundAmount: refund.amount,
        refundCurrency: refund.currency,
      };
      await payment.save();

      order.paymentStatus = "Refunded";
      await order.save();

      return res.status(200).json({
        success: true,
        message: "Refund processed successfully",
        data: order,
      });
    } catch (error: any) {
      console.error("❌ [RefundOrder] Error:", error?.message || error);
      return res.status(400).json({
        success: false,
        message: error?.message || "Failed to refund order",
      });
    }
  };

  /**
   * Get single order by ID
   * GET /orders/:orderId
   */
  getOrderById = async (req: Request, res: Response) => {
    try {
      const { orderId } = req.params;

      // Try multiple lookup strategies:
      // 1) treat as ObjectId -> findById
      // 2) exact orderNumber match
      // 3) fuzzy orderNumber match (regex contains)
      let order: any = null;

      if (mongoose.Types.ObjectId.isValid(orderId)) {
        order = await Order.findById(orderId)
          .populate("userId", "firstName lastName email")
          .populate("customerId")
          .lean();
        if (order) console.log("✅ [GetOrderById] Found by ObjectId:", orderId);
      }

      if (!order) {
        order = await Order.findOne({ orderNumber: orderId })
          .populate("userId", "firstName lastName email")
          .populate("customerId")
          .lean();
        if (order) console.log("✅ [GetOrderById] Found by exact orderNumber:", orderId);
      }

      if (!order) {
        // fallback: partial match in orderNumber (useful if client sends numeric id like "123")
        order = await Order.findOne({ orderNumber: { $regex: orderId, $options: "i" } })
          .populate("userId", "firstName lastName email")
          .populate("customerId")
          .lean();
        if (order) console.log("✅ [GetOrderById] Found by fuzzy orderNumber match:", orderId);
      }

      if (!order) {
        return res.status(404).json({
          success: false,
          message: "Order not found",
        });
      }

      if (
        (!order.items || order.items.length === 0) &&
        order.stripePaymentIntentId
      ) {
        try {
          const rebuilt = await EcomStripeService.rebuildOrderItemsFromPaymentIntent(
            order.stripePaymentIntentId
          );
          if (rebuilt?.items?.length) {
            await Order.findByIdAndUpdate(order._id, {
              items: rebuilt.items,
              subtotal: rebuilt.subtotal,
            });
            order.items = rebuilt.items;
            order.subtotal = rebuilt.subtotal;
            console.log("✅ [GetOrderById] Rebuilt order items from Stripe:", order._id);
          }
        } catch (err: any) {
          console.warn("⚠️ [GetOrderById] Failed to rebuild items from Stripe:", {
            orderId: order._id,
            message: err?.message || err,
          });
        }
      }

      console.log("✅ [GetOrderById] Order found:", order._id);

      return res.status(200).json({
        success: true,
        data: order,
      });
    } catch (error: any) {
      console.error("❌ [GetOrderById] Error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to fetch order",
      });
    }
  };
}
