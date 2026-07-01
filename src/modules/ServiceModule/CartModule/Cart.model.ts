import mongoose, { Schema, Document } from "mongoose";

export interface ICartItem {
  product: mongoose.Types.ObjectId;
  name: string;
  price: number;
  quantity: number;
  image: string;
}

export interface ICart extends Document {
  userId: mongoose.Types.ObjectId;
  items: ICartItem[];
  updatedAt: Date;
}

const CartItemSchema = new Schema<ICartItem>(
  {
    product: {
      type: Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    name: { type: String, required: true },
    price: { type: Number, required: true },
    quantity: { type: Number, required: true, min: 1 },
    image: { type: String, default: "" },
  },
  { _id: false }
);

const CartSchema = new Schema<ICart>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    items: { type: [CartItemSchema], default: [] },
  },
  { timestamps: true }
);

export default mongoose.model<ICart>("Cart", CartSchema);