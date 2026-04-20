import mongoose, { Document, Schema } from "mongoose";

export interface IShopDashboardSnapshot extends Document {
  dateKey: string;
  generatedAt: Date;
  stats: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const shopDashboardSnapshotSchema = new Schema<IShopDashboardSnapshot>(
  {
    dateKey: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    generatedAt: {
      type: Date,
      required: true,
      default: Date.now,
      index: true,
    },
    stats: {
      type: Schema.Types.Mixed,
      required: true,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model<IShopDashboardSnapshot>(
  "ShopDashboardSnapshot",
  shopDashboardSnapshotSchema
);
