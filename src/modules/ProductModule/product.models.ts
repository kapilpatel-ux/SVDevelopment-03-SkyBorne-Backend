  import mongoose from "mongoose";

  export interface IProduct {
    _id: mongoose.Types.ObjectId;
    name: string;
    category?: mongoose.Types.ObjectId;
    price: number;
    stock?: number;
    status: "active" | "inactive";
    image: string;
    images?: string[];
    description?: string;
    specifications?: Array<{ label: string; value: string }>;
    shippingInfo?: string;
    reviews?: Array<{
      name?: string;
      rating?: number;
      comment?: string;
      createdAt?: Date;
    }>;
    productCategory?: string;
    productSubCategory?: string;
    productSubtype?: string;
    partnerSkuUniqueCode?: string;
    modelNumber?: string;
    gtinUpc?: string;
    brand?: string;
    productTitle?: string;
    colourName?: string;
    setIncludes?: string;
    featureBullet1?: string;
    featureBullet2?: string;
    featureBullet3?: string;
    featureBullet4?: string;
    featureBullet5?: string;
    whatIsInTheBox?: string;
    longDescription?: string;
    countryOfOrigin?: string;
    colourFamily?: string;
    size?: string;
    sizeUnit?: string;
    secondaryMaterial?: string;
    materialFinish?: string;
    careInstructions?: string;
    itemCondition?: string;
    grade?: string;
    productLength?: string;
    productLengthUnit?: string;
    productHeight?: string;
    productHeightUnit?: string;
    productWidthDepth?: string;
    productWidthDepthUnit?: string;
    productWeight?: string;
    productWeightUnit?: string;
    numberOfPieces?: string;
    shippingLength?: string;
    shippingLengthUnit?: string;
    shippingHeight?: string;
    shippingHeightUnit?: string;
    shippingWidthDepth?: string;
    shippingWidthDepthUnit?: string;
    shippingWeight?: string;
    shippingWeightUnit?: string;
    recommendedRetailPrice?: string;
    recommendedRetailPriceAEUnit?: string;
    hsCode?: string;
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
        ref: "EcomCategory",
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
      stock: {
        type: Number,
        default: 0,
        min: 0,
        validate: {
          validator: (v: number) => Number.isInteger(v) && v >= 0,
          message: "Stock must be a non-negative integer",
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
      images: {
        type: [String],
        default: [],
      },
      description: {
        type: String,
        trim: true,
        default: "",
      },
      specifications: {
        type: [
          {
            label: { type: String, trim: true },
            value: { type: String, trim: true },
          },
        ],
        default: [],
      },
      shippingInfo: {
        type: String,
        trim: true,
        default: "",
      },
      reviews: {
        type: [
          {
            name: { type: String, trim: true },
            rating: { type: Number, min: 0, max: 5 },
            comment: { type: String, trim: true },
            createdAt: { type: Date, default: Date.now },
          },
        ],
        default: [],
      },
      productCategory: { type: String, trim: true, default: "" },
      productSubCategory: { type: String, trim: true, default: "" },
      productSubtype: { type: String, trim: true, default: "" },
      partnerSkuUniqueCode: { type: String, trim: true, default: "" },
      modelNumber: { type: String, trim: true, default: "" },
      gtinUpc: { type: String, trim: true, default: "" },
      brand: { type: String, trim: true, default: "" },
      productTitle: { type: String, trim: true, default: "" },
      colourName: { type: String, trim: true, default: "" },
      setIncludes: { type: String, trim: true, default: "" },
      featureBullet1: { type: String, trim: true, default: "" },
      featureBullet2: { type: String, trim: true, default: "" },
      featureBullet3: { type: String, trim: true, default: "" },
      featureBullet4: { type: String, trim: true, default: "" },
      featureBullet5: { type: String, trim: true, default: "" },
      whatIsInTheBox: { type: String, trim: true, default: "" },
      longDescription: { type: String, trim: true, default: "" },
      countryOfOrigin: { type: String, trim: true, default: "" },
      colourFamily: { type: String, trim: true, default: "" },
      size: { type: String, trim: true, default: "" },
      sizeUnit: { type: String, trim: true, default: "" },
      secondaryMaterial: { type: String, trim: true, default: "" },
      materialFinish: { type: String, trim: true, default: "" },
      careInstructions: { type: String, trim: true, default: "" },
      itemCondition: { type: String, trim: true, default: "" },
      grade: { type: String, trim: true, default: "" },
      productLength: { type: String, trim: true, default: "" },
      productLengthUnit: { type: String, trim: true, default: "" },
      productHeight: { type: String, trim: true, default: "" },
      productHeightUnit: { type: String, trim: true, default: "" },
      productWidthDepth: { type: String, trim: true, default: "" },
      productWidthDepthUnit: { type: String, trim: true, default: "" },
      productWeight: { type: String, trim: true, default: "" },
      productWeightUnit: { type: String, trim: true, default: "" },
      numberOfPieces: { type: String, trim: true, default: "" },
      shippingLength: { type: String, trim: true, default: "" },
      shippingLengthUnit: { type: String, trim: true, default: "" },
      shippingHeight: { type: String, trim: true, default: "" },
      shippingHeightUnit: { type: String, trim: true, default: "" },
      shippingWidthDepth: { type: String, trim: true, default: "" },
      shippingWidthDepthUnit: { type: String, trim: true, default: "" },
      shippingWeight: { type: String, trim: true, default: "" },
      shippingWeightUnit: { type: String, trim: true, default: "" },
      recommendedRetailPrice: { type: String, trim: true, default: "" },
      recommendedRetailPriceAEUnit: { type: String, trim: true, default: "" },
      hsCode: { type: String, trim: true, default: "" },
    },
    { timestamps: true }
  );

  export default mongoose.model<IProduct>("Product", productSchema);
