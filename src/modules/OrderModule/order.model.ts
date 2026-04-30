import mongoose from "mongoose";

export type OrderStatus =
  | "Pending"
  | "Confirmed"
  | "Processing"
  | "Shipped"
  | "Delivered"
  | "Cancelled"
  | "Refunded";

export type PaymentStatus =
  | "Pending"
  | "Paid"
  | "Failed"
  | "Refunded";

export interface IOrderItem {
  product: mongoose.Types.ObjectId;
  name: string;          // snapshot (product name at time of order)
  price: number;         // snapshot
  quantity: number;
  image?: string;        // snapshot
}

export interface IOrder {
  _id: mongoose.Types.ObjectId;

  orderNumber: string;
  orderFingerprint?: string;

  userId: mongoose.Types.ObjectId;
  customerId: mongoose.Types.ObjectId;
  stripePaymentIntentId?: string;

  items: IOrderItem[];

  subtotal: number;
  tax: number;
  shippingCharge: number;
  discount: number;
  totalAmount: number;

  paymentMethod: "stripe" | "ngenius";
  paymentStatus: PaymentStatus;

  orderStatus: OrderStatus;
  trackingNumber?: string;

  shippingAddress: {
    fullName: string;
    phone: string;
    addressLine1: string;
    addressLine2?: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };

  isPaid: boolean;
  paidAt?: Date;

  deliveredAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

/* ============================= */
/* ORDER ITEM SCHEMA */
/* ============================= */
const orderItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    name: {
      type: String,
      required: true,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
    image: {
      type: String,
      trim: true,
    },
  },
  { _id: false }
);

/* ============================= */
/* ORDER SCHEMA */
/* ============================= */
const orderSchema = new mongoose.Schema(
  {
    orderNumber: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    orderFingerprint: {
      type: String,
      trim: true,
      index: true,
    },

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
      index: true,
    },

    stripePaymentIntentId: {
      type: String,
      index: true,
    },

    items: {
      type: [orderItemSchema],
      required: true,
      validate: [
        (items: IOrderItem[]) => items.length >= 0,
        "Order must contain at least one item",
      ],
    },

    subtotal: {
      type: Number,
      required: true,
      min: 0,
    },

    tax: {
      type: Number,
      default: 0,
      min: 0,
    },

    shippingCharge: {
      type: Number,
      default: 0,
      min: 0,
    },

    discount: {
      type: Number,
      default: 0,
      min: 0,
    },

    totalAmount: {
      type: Number,
      required: true,
      min: 0,
    },

    paymentMethod: {
      type: String,
      enum: ["stripe", "ngenius"],
      required: true,
    },

    paymentStatus: {
      type: String,
      enum: ["Pending", "Paid", "Failed", "Refunded"],
      default: "Pending",
      index: true,
    },

    orderStatus: {
      type: String,
      enum: [
        "Pending",
        "Confirmed",
        "Processing",
        "Shipped",
        "Delivered",
        "Cancelled",
        "Refunded",
      ],
      default: "Pending",
      index: true,
    },
    trackingNumber: {
      type: String,
      trim: true,
      default: "",
    },

    shippingAddress: {
      fullName: { type: String, required: true },
      phone: { type: String, required: true },
      addressLine1: { type: String, required: true },
      addressLine2: { type: String },
      city: { type: String, required: true },
      state: { type: String, required: true },
      postalCode: { type: String, required: true },
      country: { type: String, required: true },
    },

    isPaid: {
      type: Boolean,
      default: false,
    },

    paidAt: {
      type: Date,
    },

    deliveredAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

/* ============================= */
/* INDEXES (IMPORTANT) */
/* ============================= */
orderSchema.index({ userId: 1, createdAt: -1 });
orderSchema.index({ userId: 1, orderFingerprint: 1, createdAt: -1 });
orderSchema.index({ orderStatus: 1 });
orderSchema.index({ paymentStatus: 1 });

export default mongoose.model<IOrder>("Order", orderSchema);
