import mongoose, { Schema, Document } from "mongoose";

export interface IEcomPayment extends Document {
  userId: mongoose.Types.ObjectId;
  orderId: mongoose.Types.ObjectId;
  customerId?: mongoose.Types.ObjectId;
  stripePaymentIntentId: string;
  stripeCustomerId?: string;
  amount: number;        // in dollars
  amountInCents: number; // in cents (what Stripe receives)
  currency: string;
  status: "pending" | "succeeded" | "failed" | "cancelled" | "refunded";
  receiptUrl?: string;
  orderRef: string;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

const EcomPaymentSchema = new Schema<IEcomPayment>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    orderId: {
      type: Schema.Types.ObjectId,
      ref: "Order",
      required: true,
    },
    customerId: {
      type: Schema.Types.ObjectId,
      ref: "Customer",
    },
    stripePaymentIntentId: {
      type: String,
      required: true,
      unique: true,
    },
    stripeCustomerId: {
      type: String,
    },
    amount: {
      type: Number,
      required: true,
    },
    amountInCents: {
      type: Number,
      required: true,
    },
    currency: {
      type: String,
      default: "usd",
    },
    status: {
      type: String,
      enum: ["pending", "succeeded", "failed", "cancelled", "refunded"],
      default: "pending",
    },
    receiptUrl: {
      type: String,
    },
    orderRef: {
      type: String,
      required: true,
      unique: true,
    },
    metadata: {
      type: Schema.Types.Mixed,
    },
  },
  { timestamps: true }
);

export default mongoose.model<IEcomPayment>("EcomPayment", EcomPaymentSchema);