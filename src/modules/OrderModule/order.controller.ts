import { Request, Response } from "express";
import mongoose from "mongoose";
import Order from "./order.model";
import Product from "../ProductModule/product.models";
import Customer from "../CustomerModule/customer.model";
import User from "../UserModule/models/User";

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
          .limit(limit),
        Order.countDocuments(filters),
      ]);

      console.log("✅ [GetAllOrders] Orders found:", orders.length);
      console.log("✅ [GetAllOrders] Total count:", total);

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

      order.orderStatus = orderStatus;

      if (orderStatus === "Delivered") {
        order.deliveredAt = new Date();
        console.log("🔵 [UpdateOrderStatus] Setting deliveredAt:", order.deliveredAt);
      }

      await order.save();
      console.log("✅ [UpdateOrderStatus] Order updated successfully");

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
