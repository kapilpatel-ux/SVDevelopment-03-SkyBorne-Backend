import mongoose, { Schema, Document } from "mongoose";

/* =========================
   Address Sub Schema
========================= */
export interface ICustomerAddress {
  _id?: mongoose.Types.ObjectId;
  fullName: string;
  phone?: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
  isDefault: boolean;
}

const addressSchema = new Schema<ICustomerAddress>(
  {
    fullName: { type: String, required: true, trim: true },
    phone: { type: String, trim: true },
    addressLine1: { type: String, required: true, trim: true },
    addressLine2: { type: String, trim: true },
    city: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true },
    country: { type: String, required: true, trim: true },
    postalCode: { type: String, required: true, trim: true },
    isDefault: { type: Boolean, default: false },
  },
  { _id: true }
);

/* =========================
   Customer Interface
========================= */
export interface ICustomer extends Document {
  userId: mongoose.Types.ObjectId;

  addresses: ICustomerAddress[];

  wishlist: mongoose.Types.ObjectId[];

  totalOrders: number;
  totalSpent: number;

  notes?: string;

  createdAt: Date;
  updatedAt: Date;
}

/* =========================
   Customer Schema
========================= */
const customerSchema = new Schema<ICustomer>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },

    addresses: {
      type: [addressSchema],
      default: [],
    },

    wishlist: [
      {
        type: Schema.Types.ObjectId,
        ref: "Product",
      },
    ],

    totalOrders: {
      type: Number,
      default: 0,
      min: 0,
    },

    totalSpent: {
      type: Number,
      default: 0,
      min: 0,
    },

  },
  { timestamps: true }
);

/* =========================
   Indexes
========================= */
customerSchema.index({ userId: 1 });
customerSchema.index({ totalOrders: -1 });

export default mongoose.model<ICustomer>("Customer", customerSchema);
