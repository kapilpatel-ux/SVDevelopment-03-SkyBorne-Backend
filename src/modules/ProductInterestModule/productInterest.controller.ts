import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import ProductInterest from "./productInterest.model";
import productModels from "../ProductModule/product.models";

export class ProductInterestController {
  async getAllInterests(req: Request, res: Response, next: NextFunction) {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const search = (req.query.search as string) || "";

      const skip = (page - 1) * limit;

      const interests = await ProductInterest.find({})
        .populate({ path: "product", select: "name _id" })
        .populate({ path: "user", select: "firstName lastName email _id" })
        .sort({ createdAt: -1 })
        .exec();

      const filtered = search
        ? interests.filter((interest) => {
            const productName =
              (interest as any)?.product?.name?.toLowerCase() || "";
            const userFirst =
              (interest as any)?.user?.firstName?.toLowerCase() || "";
            const userLast =
              (interest as any)?.user?.lastName?.toLowerCase() || "";
            const userEmail =
              (interest as any)?.user?.email?.toLowerCase() || "";
            const term = search.toLowerCase();
            return (
              productName.includes(term) ||
              userFirst.includes(term) ||
              userLast.includes(term) ||
              userEmail.includes(term)
            );
          })
        : interests;

      const totalCount = filtered.length;
      const totalPages = Math.ceil(totalCount / limit) || 1;

      const paginated = filtered.slice(skip, skip + limit);

      return res.json({
        success: true,
        data: {
          interests: paginated,
          pagination: {
            currentPage: page,
            totalPages,
            totalCount,
            limit,
            hasNextPage: page < totalPages,
            hasPrevPage: page > 1,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async expressInterest(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: "User not authenticated",
        });
      }

      const { productId } = req.params;

      if (!mongoose.Types.ObjectId.isValid(productId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid product ID format",
        });
      }

      const product = await productModels.findById(productId).exec();
      if (!product) {
        return res.status(404).json({
          success: false,
          message: "Product not found",
        });
      }

      const userId = (req.user as any)?.id || (req.user as any)?._id;

      const existing = await ProductInterest.findOne({
        product: productId,
        user: userId,
      }).exec();

      if (existing) {
        return res.status(200).json({
          success: true,
          message: "Interest already recorded",
          data: existing,
        });
      }

      const interest = await ProductInterest.create({
        product: productId,
        user: userId,
      });

      return res.status(201).json({
        success: true,
        message: "Interest recorded successfully",
        data: interest,
      });
    } catch (error) {
      next(error);
    }
  }
}
