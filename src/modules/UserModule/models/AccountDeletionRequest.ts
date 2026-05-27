import mongoose, { Schema, Document, Types } from "mongoose";

export interface IAccountDeletionRequest extends Document {
  userId: Types.ObjectId;
  email: string;
  fullName: string;
  reason?: string;
  status: "requested" | "processed";
  requestedAt: Date;
  processedAt?: Date | null;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

const accountDeletionRequestSchema = new Schema<IAccountDeletionRequest>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    email: {
      type: String,
      required: true,
      index: true,
    },
    fullName: {
      type: String,
      required: true,
      index: true,
    },
    reason: {
      type: String,
      default: "User requested account deletion",
      trim: true,
    },
    status: {
      type: String,
      enum: ["requested", "processed"],
      default: "requested",
      index: true,
    },
    requestedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    processedAt: {
      type: Date,
      default: null,
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true },
);

accountDeletionRequestSchema.index({ status: 1, requestedAt: -1 });

export default mongoose.models.AccountDeletionRequest ||
  mongoose.model<IAccountDeletionRequest>(
    "AccountDeletionRequest",
    accountDeletionRequestSchema,
  );
