  import mongoose from "mongoose";

  export interface IProduct {
    _id: mongoose.Types.ObjectId;
    name: string;
    category?: mongoose.Types.ObjectId;
    price: number;
    status: "active" | "inactive";
    image: string;
    description?: string;
    createdAt: Date;
    updatedAt: Date;
  }

  const productSchema = new mongoose.Schema(
    {
      name: {
        type: String,
        required: true,
        trim: true,
        index: true,
      },
      category: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Service",
        required: false,
        index: true,
      },
      price: {
        type: Number,
        required: true,
        min: 1,
        validate: {
          validator: (v: number) => !isNaN(v) && v >= 1,
          message: "Price must be at least $1",
        },
      },
    
      status: {
        type: String,
        enum: ["active", "inactive"],
        default: "inactive",
        index: true,
      },
      image: {
        type: String,
        required: true,
        trim: true,
      },
      description: {
        type: String,
        trim: true,
        default: "",
      },
    },
    { timestamps: true }
  );

  export default mongoose.model<IProduct>("Product", productSchema);