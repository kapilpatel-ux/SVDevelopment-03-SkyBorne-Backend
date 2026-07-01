import mongoose from "mongoose";

export interface IProductInterest extends mongoose.Document {
  product: mongoose.Types.ObjectId;
  user: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const productInterestSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
  },
  { timestamps: true }
);

productInterestSchema.index({ product: 1, user: 1 }, { unique: true });

export default mongoose.model<IProductInterest>(
  "ProductInterest",
  productInterestSchema
);
