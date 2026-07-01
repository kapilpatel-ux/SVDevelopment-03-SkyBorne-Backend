import mongoose from "mongoose";

export interface IInventory {
  _id: mongoose.Types.ObjectId;
  sku: string;
  code: string;
  name: string;
  quantity: number;
  reorderLevel: number;
  status: "active" | "inactive";
  supplier?: string;
  costPrice?: number;
  lastRestockDate?: Date;
  expiryDate?: Date;
  batchNumber?: string;
  location?: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}

const inventorySchema = new mongoose.Schema(
  {
    sku: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      index: true,
      match: /^[A-Z0-9\-]+$/,
      minlength: 3,
      maxlength: 20,
    },
    code: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      index: true,
      minlength: 2,
      maxlength: 10,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
      validate: {
        validator: (v: number) => Number.isInteger(v) && v >= 0,
        message: "Quantity must be a non-negative integer",
      },
    },
    reorderLevel: {
      type: Number,
      required: true,
      min: 0,
      default: 10,
      validate: {
        validator: (v: number) => Number.isInteger(v) && v >= 0,
        message: "Reorder level must be a non-negative integer",
      },
    },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
      index: true,
    },
    supplier: {
      type: String,
      trim: true,
      default: "",
    },
    costPrice: {
      type: Number,
      min: 0,
      default: 0,
      validate: {
        validator: (v: number) => !isNaN(v) && v >= 0,
        message: "Cost price must be a valid positive number",
      },
    },
    lastRestockDate: {
      type: Date,
      default: null,
    },
    expiryDate: {
      type: Date,
      default: null,
    },
    batchNumber: {
      type: String,
      trim: true,
      default: "",
    },
    location: {
      type: String,
      trim: true,
      default: "",
      // e.g., "Warehouse A - Shelf 3"
    },
    description: {
      type: String,
      trim: true,
      default: "",
    },
  },
  {
    timestamps: true,
  }
);

// Index for low stock queries
inventorySchema.index({ quantity: 1, reorderLevel: 1 });

// Index for searching by name or SKU
inventorySchema.index({ name: "text", sku: "text", code: "text" });

// Virtual for checking if item is low on stock
inventorySchema.virtual("isLowStock").get(function (this: any) {
  return this.quantity < this.reorderLevel;
});

// Pre-save validation
inventorySchema.pre("save", function (next) {
  // Ensure quantity doesn't go negative
  if (this.quantity < 0) {
    this.quantity = 0;
  }

  // Ensure costPrice is valid
  if (this.costPrice && this.costPrice < 0) {
    this.costPrice = 0;
  }

  next();
});

export default mongoose.model<IInventory>("Inventory", inventorySchema);