import mongoose, { Document, Schema } from "mongoose";

export interface IRecurringPaymentFailure extends Document {
  userId?: mongoose.Types.ObjectId;
  email: string;
  subscriptionId?: string;
  invoiceId?: string;
  failedAt: Date;
}

const RecurringPaymentFailureSchema = new Schema<IRecurringPaymentFailure>(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
      index: true,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    subscriptionId: {
      type: String,
      required: false,
      trim: true,
      index: true,
    },
    invoiceId: {
      type: String,
      required: false,
      trim: true,
      index: true,
      sparse: true,
    },
    failedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  },
);

RecurringPaymentFailureSchema.index({ invoiceId: 1 }, { unique: true, sparse: true });

export default mongoose.model<IRecurringPaymentFailure>(
  "RecurringPaymentFailure",
  RecurringPaymentFailureSchema,
);
