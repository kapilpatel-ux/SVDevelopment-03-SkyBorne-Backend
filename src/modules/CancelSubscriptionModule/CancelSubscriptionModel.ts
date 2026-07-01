import { Document } from "mongoose";

export type CancelSubscriptionStatus = "pending" | "retained" | "cancelled";

export interface ICancelSubscription extends Document {
  subscriptionId: string;
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber?: string;
  country?: string;
  subscribedAt?: Date;
  userId: string;
  status: CancelSubscriptionStatus;
  cancelledAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
  description: string;
  adminDescription?: string;
  plan?: string;
}


import mongoose, { Schema } from "mongoose";

// 2️⃣ Create Schema with Generics
const cancelSubscriptionSchema = new Schema<ICancelSubscription>(
  {
    subscriptionId: {
      type: String,
      required: true,
      trim: true,
    },
    firstName: {
      type: String,
      required: true,
      trim: true,
    },
    plan: {
      type: String,
      required: false,
      trim: true,
    },
    lastName: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    phoneNumber: {
      type: String,
      required: false,
      trim: true,
    },
    country: {
      type: String,
      required: false,
      trim: true,
    },
    subscribedAt: {
      type: Date,
      required: false,
    },
    userId: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ["pending", "retained", "cancelled"],
      required: true,
      default: "pending",
    },
    cancelledAt: {
      type: Date,
      required: false,
    },
    description: {
      type: String,
      required: false,
      trim: true,
    },
    adminDescription: {
      type: String,
      required: false,
      trim: true,
      default: "",
    },
  },
  { timestamps: true }
);


// 3️⃣ Export Model
export default mongoose.model<ICancelSubscription>(
  "CancelSubscription",
  cancelSubscriptionSchema
);
