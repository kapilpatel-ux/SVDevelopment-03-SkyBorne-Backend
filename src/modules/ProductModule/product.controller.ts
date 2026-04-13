import { Request, Response, NextFunction } from "express";
import ProductRepository from "./product.repository";
import productModels, { IProduct } from "./product.models";
import mongoose from "mongoose";
import { s3 } from "../../utils/s3";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import Order from "../OrderModule/order.model";
import User from "../UserModule/models/User";

const productRepository = new ProductRepository();

const parseJsonArray = (value: any): any[] | undefined => {
  if (!value) return undefined;
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      return undefined;
    }
  }
  return undefined;
};

const parseStringArray = (value: any): string[] | undefined => {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) {
    return value
      .map((item) => (item === null || item === undefined ? "" : String(item)))
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
  if (typeof value === "string") {
    const parsed = parseJsonArray(value);
    if (parsed) {
      return parsed
        .map((item) => (item === null || item === undefined ? "" : String(item)))
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
    }
    return value.trim() ? [value.trim()] : [];
  }
  return undefined;
};

const PRODUCT_MASTER_FIELDS = [
  "productCategory",
  "productSubCategory",
  "productSubtype",
  "partnerSkuUniqueCode",
  "modelNumber",
  "gtinUpc",
  "brand",
  "productTitle",
  "colourName",
  "setIncludes",
  "featureBullet1",
  "featureBullet2",
  "featureBullet3",
  "featureBullet4",
  "featureBullet5",
  "whatIsInTheBox",
  "longDescription",
  "countryOfOrigin",
  "colourFamily",
  "size",
  "sizeUnit",
  "secondaryMaterial",
  "materialFinish",
  "careInstructions",
  "itemCondition",
  "grade",
  "productLength",
  "productLengthUnit",
  "productHeight",
  "productHeightUnit",
  "productWidthDepth",
  "productWidthDepthUnit",
  "productWeight",
  "productWeightUnit",
  "numberOfPieces",
  "shippingLength",
  "shippingLengthUnit",
  "shippingHeight",
  "shippingHeightUnit",
  "shippingWidthDepth",
  "shippingWidthDepthUnit",
  "shippingWeight",
  "shippingWeightUnit",
  "recommendedRetailPrice",
  "recommendedRetailPriceAEUnit",
  "hsCode",
] as const;

const assignMasterFields = (target: Partial<IProduct>, source: any) => {
  PRODUCT_MASTER_FIELDS.forEach((key) => {
    if (source[key] !== undefined) {
      target[key] = String(source[key]).trim();
    }
  });
};

const uploadBase64Image = async (imageBase64: string): Promise<string> => {
  const matches = imageBase64.match(/^data:(.+);base64,(.+)$/);
  if (!matches) {
    throw new Error("Invalid imageBase64 format");
  }

  const mimeType = matches[1];
  const base64Data = matches[2];
  const buffer = Buffer.from(base64Data, "base64");
  const ext = mimeType.split("/")[1] || "jpg";
  const key = `products/${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}.${ext}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET!,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
    })
  );

  return `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
};

export class ProductController {
  /**
   * Get all products with pagination and search
   */
async getAllProducts(req: Request, res: Response, next: NextFunction) {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const search = (req.query.search as string) || "";
    const categoryId = (req.query.categoryId as string) || "";
    const status = (req.query.status as string) || "";

    const skip = (page - 1) * limit;

    if (categoryId && !mongoose.Types.ObjectId.isValid(categoryId)) {
      return res.status(400).json({ success: false, message: "Invalid category ID format" });
    }

    if (status && !["active", "inactive"].includes(status)) {
      return res.status(400).json({ success: false, message: "Status must be 'active' or 'inactive'" });
    }

    // ✅ Pass status to searchModels so DB filters it
    const products = await productRepository.searchModels({
      search,
      skip,
      limit,
      categoryId,
      status, // ← was missing before
    });

    const totalCount = await productRepository.countDocuments({
      ...(search && { $or: [{ name: { $regex: search, $options: "i" } }, { description: { $regex: search, $options: "i" } }] }),
      ...(categoryId && { category: new mongoose.Types.ObjectId(categoryId) }),
      ...(status && { status }),
    });

    const totalPages = Math.ceil(totalCount / limit);

    return res.json({
      success: true,
      data: {
        products,
        pagination: { currentPage: page, totalPages, totalCount, limit, hasNextPage: page < totalPages, hasPrevPage: page > 1 },
      },
    });
  } catch (error) {
    next(error);
  }
}
  /**
   * Get all active products (for storefront)
   */
// In product.controller.ts — replace getAllPublishedProducts:

async getAllPublishedProducts(req: Request, res: Response, next: NextFunction) {
  try {
    const search = (req.query.search as string) || "";
    const categoryId = (req.query.categoryId as string) || "";
    const sortBy = (req.query.sortBy as string) || "newest";

    if (categoryId && !mongoose.Types.ObjectId.isValid(categoryId)) {
      return res.status(400).json({ success: false, message: "Invalid category ID format" });
    }

    const filter: any = { status: "active" };

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
      ];
    }

    if (categoryId) {
      filter.category = new mongoose.Types.ObjectId(categoryId);
    }

    const sortOption: any =
      sortBy === "price-low"
        ? { price: 1 }
        : sortBy === "price-high"
        ? { price: -1 }
        : { createdAt: -1 }; // newest (default)

    const products = await productModels.find(filter)
      .sort(sortOption)
      .populate({ path: "category", select: "name _id" })
      .exec();

    return res.json({ success: true, data: products });
  } catch (error) {
    next(error);
  }
}

  /**
   * Get product by ID
   */
  async getProductById(req: Request, res: Response, next: NextFunction) {
    try {
      const { productId } = req.params;

      if (!mongoose.Types.ObjectId.isValid(productId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid product ID format",
        });
      }

      const product = await productRepository.getOneModel(productId);

      if (!product) {
        return res.status(404).json({
          success: false,
          message: "Product not found",
        });
      }

      const productData: any =
        typeof (product as any).toObject === "function"
          ? (product as any).toObject()
          : product;

      const categoryName =
        typeof productData.category === "object" && productData.category !== null
          ? productData.category.name || productData.category.title || ""
          : "";

      const specifications = Array.isArray(productData.specifications)
        ? productData.specifications
        : [];

      const shippingInfo = (productData.shippingInfo || "").trim();

      const reviews = Array.isArray(productData.reviews) ? productData.reviews : [];

      return res.json({
        success: true,
        data: {
          ...productData,
          specifications,
          shippingInfo,
          reviews,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Add review to a product (only after delivered order)
   */
  async addProductReview(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: "User not authenticated",
        });
      }

      const { productId } = req.params;
      const { rating, comment } = req.body;

      if (!mongoose.Types.ObjectId.isValid(productId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid product ID format",
        });
      }

      const parsedRating =
        rating === undefined || rating === null ? undefined : Number(rating);

      if (parsedRating === undefined || Number.isNaN(parsedRating)) {
        return res.status(400).json({
          success: false,
          message: "Rating is required",
        });
      }

      if (parsedRating < 1 || parsedRating > 5) {
        return res.status(400).json({
          success: false,
          message: "Rating must be between 1 and 5",
        });
      }

      if (comment !== undefined && typeof comment !== "string") {
        return res.status(400).json({
          success: false,
          message: "Comment must be a string",
        });
      }

      const userId = (req.user as any)?.id || (req.user as any)?._id;

      const deliveredOrder = await Order.findOne({
        userId,
        orderStatus: "Delivered",
        "items.product": productId,
      }).exec();

      if (!deliveredOrder) {
        return res.status(403).json({
          success: false,
          message: "You can review products only after delivery",
        });
      }

      const user = await User.findById(userId)
        .select("firstName lastName")
        .exec();

      const name = `${user?.firstName || ""} ${user?.lastName || ""}`
        .trim()
        .slice(0, 120);

      const review = {
        name: name || undefined,
        rating: parsedRating,
        comment: typeof comment === "string" ? comment.trim() : undefined,
        createdAt: new Date(),
      };

      const updatedProduct = await productModels
        .findByIdAndUpdate(
          productId,
          {
            $push: { reviews: review },
          },
          { new: true, runValidators: true }
        )
        .populate({ path: "category", select: "name _id" })
        .exec();

      if (!updatedProduct) {
        return res.status(404).json({
          success: false,
          message: "Product not found",
        });
      }

      return res.status(201).json({
        success: true,
        message: "Review added successfully",
        data: updatedProduct,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Create new product
   */
async createProduct(req: Request, res: Response, next: NextFunction) {
  try {
    console.log("=== createProduct START ===");
    console.log("REQ BODY keys:", Object.keys(req.body));
    console.log("REQ BODY (minus imageBase64):", { ...req.body, imageBase64: req.body.imageBase64 ? `[base64 length: ${req.body.imageBase64.length}]` : undefined });

    const {
      name,
      category,
      price,
      stock,
      status = "inactive",
      description = "",
      imageBase64,
      imageBase64s,
      specifications,
      shippingInfo,
      reviews,
    } = req.body;

    console.log("=== PARSED FIELDS ===");
    console.log("name:", name);
    console.log("category:", category);
    console.log("price:", price, "| type:", typeof price);
    console.log("status:", status);
    console.log("description:", description);
    console.log("imageBase64 present:", !!imageBase64);
    console.log("imageBase64s present:", Array.isArray(imageBase64s));

    // ── Required field validation ──────────────────────────────────
    if (!name || !name.trim()) {
      console.log("FAILED: name validation");
      return res.status(400).json({ success: false, message: "Product name is required" });
    }
    console.log("PASSED: name validation");

    if (price === undefined || price === null) {
      console.log("FAILED: price presence check");
      return res.status(400).json({ success: false, message: "Price is required" });
    }
    console.log("PASSED: price presence check");

    const parsedPrice = Number(price);
    console.log("parsedPrice:", parsedPrice, "| isNaN:", isNaN(parsedPrice));
    if (isNaN(parsedPrice) || parsedPrice < 1) {
      console.log("FAILED: price value validation");
      return res.status(400).json({ success: false, message: "Price must be at least $1" });
    }
    console.log("PASSED: price value validation");

    if (!["active", "inactive"].includes(status)) {
      console.log("FAILED: status validation, got:", status);
      return res.status(400).json({
        success: false,
        message: "Status must be 'active' or 'inactive'",
      });
    }
    console.log("PASSED: status validation");

    if (stock !== undefined) {
      const parsedStock = Number(stock);
      if (!Number.isInteger(parsedStock) || parsedStock < 0) {
        return res.status(400).json({
          success: false,
          message: "Stock must be a non-negative integer",
        });
      }
    }

    const imageBase64List =
      parseStringArray(imageBase64s) ?? parseStringArray(imageBase64);
    if (!imageBase64List || imageBase64List.length === 0) {
      console.log("FAILED: imageBase64 missing");
      return res.status(400).json({ success: false, message: "Product image is required" });
    }
    if (imageBase64List.length > 5) {
      return res.status(400).json({ success: false, message: "Maximum 5 images allowed" });
    }
    console.log("PASSED: imageBase64 present");

    for (const base64 of imageBase64List) {
      if (!/^data:(.+);base64,(.+)$/.test(base64)) {
        return res.status(400).json({ success: false, message: "Invalid imageBase64 format" });
      }
    }

    // ── Category validation (optional) ────────────────────────────
    if (category && !mongoose.Types.ObjectId.isValid(category)) {
      console.log("FAILED: invalid category ID:", category);
      return res.status(400).json({ success: false, message: "Invalid category ID format" });
    }
    console.log("PASSED: category validation");

    // ── Upload images to S3 ───────────────────────────────────────
    console.log("=== S3 UPLOAD START ===");
    console.log("AWS_S3_BUCKET:", process.env.AWS_S3_BUCKET);
    console.log("AWS_REGION:", process.env.AWS_REGION);
    console.log("AWS_ACCESS_KEY_ID present:", !!process.env.AWS_ACCESS_KEY_ID);
    console.log("AWS_ACCESS_KEY_ID length:", process.env.AWS_ACCESS_KEY_ID?.length);
    console.log("AWS_SECRET_ACCESS_KEY present:", !!process.env.AWS_SECRET_ACCESS_KEY);
    console.log("AWS_SECRET_ACCESS_KEY length:", process.env.AWS_SECRET_ACCESS_KEY?.length);

    const imageUrls: string[] = [];
    try {
      for (const base64 of imageBase64List) {
        const url = await uploadBase64Image(base64);
        imageUrls.push(url);
      }
      console.log("PASSED: S3 upload success");
    } catch (s3Error: any) {
      console.error("FAILED: S3 upload error");
      console.error("S3 error name:", s3Error?.name);
      console.error("S3 error message:", s3Error?.message);
      console.error("S3 error code:", s3Error?.Code);
      console.error("S3 error stack:", s3Error?.stack);
      throw s3Error;
    }

    // ── Build product data ────────────────────────────────────────
    const productData: Partial<IProduct> = {
      name: name.trim(),
      price: parsedPrice,
      status: status as "active" | "inactive",
      image: imageUrls[0],
      images: imageUrls,
      description: description.trim(),
    };

    if (stock !== undefined) {
      productData.stock = Number(stock);
    }

    if (category) {
      productData.category = new mongoose.Types.ObjectId(category);
    }

    assignMasterFields(productData, req.body);

    const parsedSpecs = parseJsonArray(specifications);
    if (parsedSpecs) {
      productData.specifications = parsedSpecs;
    }
    if (shippingInfo !== undefined) {
      productData.shippingInfo = String(shippingInfo).trim();
    }
    const parsedReviews = parseJsonArray(reviews);
    if (parsedReviews) {
      productData.reviews = parsedReviews;
    }

    console.log("productData:", productData);
    console.log("Attempting productRepository.createModel...");

    const product = await productRepository.createModel(productData);
    console.log("PASSED: product created, id:", product._id);

    const populatedProduct = await productRepository.getOneModel(product._id.toString());
    console.log("PASSED: product populated:", !!populatedProduct);

    console.log("=== createProduct SUCCESS ===");
    return res.status(201).json({
      success: true,
      message: "Product created successfully",
      data: populatedProduct,
    });
  } catch (error: any) {
    console.error("=== createProduct CAUGHT ERROR ===");
    console.error("error name:", error?.name);
    console.error("error message:", error?.message);
    console.error("error stack:", error?.stack);
    next(error);
  }
}

  /**
   * Update product
   */
  async updateProduct(req: Request, res: Response, next: NextFunction) {
    try {
      const { productId } = req.params;
      const {
        name,
        category,
        price,
        stock,
        status,
        imageBase64,
        imageBase64s,
        description,
        specifications,
        shippingInfo,
        reviews,
      } = req.body;

      if (!mongoose.Types.ObjectId.isValid(productId)) {
        return res.status(400).json({ success: false, message: "Invalid product ID format" });
      }

      // At least one field required
      if (
        !name &&
        !category &&
        price === undefined &&
        stock === undefined &&
        !status &&
        !imageBase64 &&
        !imageBase64s &&
        req.body.imageUrls === undefined &&
        req.body.images === undefined &&
        description === undefined &&
        specifications === undefined &&
        shippingInfo === undefined &&
        reviews === undefined
      ) {
        return res.status(400).json({
          success: false,
          message: "At least one field is required for update",
        });
      }

      const currentProduct = await productRepository.getOneModel(productId);
      if (!currentProduct) {
        return res.status(404).json({ success: false, message: "Product not found" });
      }

      // ── Field validations ─────────────────────────────────────────
      if (price !== undefined) {
        const parsedPrice = Number(price);
        if (isNaN(parsedPrice) || parsedPrice < 1) {
          return res.status(400).json({ success: false, message: "Price must be at least $1" });
        }
      }

      if (stock !== undefined) {
        const parsedStock = Number(stock);
        if (!Number.isInteger(parsedStock) || parsedStock < 0) {
          return res.status(400).json({
            success: false,
            message: "Stock must be a non-negative integer",
          });
        }
      }

      if (status && !["active", "inactive"].includes(status)) {
        return res.status(400).json({
          success: false,
          message: "Status must be 'active' or 'inactive'",
        });
      }

      if (category && !mongoose.Types.ObjectId.isValid(category)) {
        return res.status(400).json({ success: false, message: "Invalid category ID format" });
      }

      const updateData: Partial<IProduct> = {};

      // ── Handle image upload if provided ───────────────────────────
      const imageBase64List =
        parseStringArray(imageBase64s) ?? parseStringArray(imageBase64);
      const imageUrls = parseStringArray(req.body.imageUrls ?? req.body.images);
      if (imageBase64List || imageUrls !== undefined) {
        if (imageBase64List) {
          for (const base64 of imageBase64List) {
            if (!/^data:(.+);base64,(.+)$/.test(base64)) {
              return res.status(400).json({ success: false, message: "Invalid imageBase64 format" });
            }
          }
        }

        const uploadedUrls: string[] = [];
        if (imageBase64List) {
          for (const base64 of imageBase64List) {
            const url = await uploadBase64Image(base64);
            uploadedUrls.push(url);
          }
        }

        const finalUrls = [...(imageUrls ?? []), ...uploadedUrls];
        if (finalUrls.length === 0) {
          return res.status(400).json({ success: false, message: "Product image is required" });
        }
        if (finalUrls.length > 5) {
          return res.status(400).json({ success: false, message: "Maximum 5 images allowed" });
        }

        const updateImages: Partial<IProduct> = {
          image: finalUrls[0],
          images: finalUrls,
        };
        Object.assign(updateData, updateImages);
      }

      // ── Build update payload ──────────────────────────────────────
      if (name) updateData.name = name.trim();
      if (category) updateData.category = new mongoose.Types.ObjectId(category);
      if (price !== undefined) updateData.price = Number(price);
      if (stock !== undefined) updateData.stock = Number(stock);
      if (status) updateData.status = status as "active" | "inactive";
      if (description !== undefined) updateData.description = description.trim();
      assignMasterFields(updateData, req.body);
      const parsedSpecs = parseJsonArray(specifications);
      if (parsedSpecs) updateData.specifications = parsedSpecs;
      if (shippingInfo !== undefined) updateData.shippingInfo = String(shippingInfo).trim();
      const parsedReviews = parseJsonArray(reviews);
      if (parsedReviews) updateData.reviews = parsedReviews;

      const updatedProduct = await productRepository.updateModel(productId, updateData);

      return res.json({
        success: true,
        message: "Product updated successfully",
        data: updatedProduct,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update product status only
   */
  async updateProductStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const { productId } = req.params;
      const { status } = req.body;

      if (!mongoose.Types.ObjectId.isValid(productId)) {
        return res.status(400).json({ success: false, message: "Invalid product ID format" });
      }

      if (!status) {
        return res.status(400).json({ success: false, message: "Status is required" });
      }

      if (!["active", "inactive"].includes(status)) {
        return res.status(400).json({
          success: false,
          message: "Status must be 'active' or 'inactive'",
        });
      }

      const product = await productRepository.updateModel(productId, {
        status: status as "active" | "inactive",
      } as Partial<IProduct>);

      if (!product) {
        return res.status(404).json({ success: false, message: "Product not found" });
      }

      return res.json({
        success: true,
        message: `Product status updated to ${status}`,
        data: product,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Delete product
   */
  async deleteProduct(req: Request, res: Response, next: NextFunction) {
    try {
      const { productId } = req.params;

      if (!mongoose.Types.ObjectId.isValid(productId)) {
        return res.status(400).json({ success: false, message: "Invalid product ID format" });
      }

      const product = await productRepository.getOneModel(productId);
      if (!product) {
        return res.status(404).json({ success: false, message: "Product not found" });
      }

      await productRepository.deleteModel(productId);

      return res.json({ success: true, message: "Product deleted successfully" });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get products by category ID
   */
  async getProductsByCategory(req: Request, res: Response, next: NextFunction) {
    try {
      const { categoryId } = req.params;

      if (!mongoose.Types.ObjectId.isValid(categoryId)) {
        return res.status(400).json({ success: false, message: "Invalid category ID format" });
      }

      const products = await productRepository.getByCategory(categoryId);
      return res.json({ success: true, data: products });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get products by status
   */
  async getProductsByStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const { status } = req.params;

      if (!["active", "inactive"].includes(status)) {
        return res.status(400).json({
          success: false,
          message: "Status must be 'active' or 'inactive'",
        });
      }

      const products = await productRepository.getByStatus(status as "active" | "inactive");
      return res.json({ success: true, data: products });
    } catch (error) {
      next(error);
    }
  }
}
