import { Request, Response, NextFunction } from "express";
import EcomCategoryRepository from "./ecomCategory.repository";
import { IEcomCategory } from "./ecomCategory.model";
import ProductRepository from "../ProductModule/product.repository";
import mongoose from "mongoose";

const ecomCategoryRepository = new EcomCategoryRepository();
const productRepository = new ProductRepository();

export class EcomCategoryController {
  /**
   * Get all categories with pagination and search
   */
  async getAllCategories(req: Request, res: Response, next: NextFunction) {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const search = (req.query.search as string) || "";
      const status = (req.query.status as string) || "";

      if (status && !["active", "inactive"].includes(status)) {
        return res.status(400).json({
          success: false,
          message: "Status must be 'active' or 'inactive'",
        });
      }

      const skip = (page - 1) * limit;

      const categories = await ecomCategoryRepository.searchCategories({
        search,
        skip,
        limit,
        status: status ? (status as "active" | "inactive") : undefined,
      });

      const totalCount = await ecomCategoryRepository.countCategories({
        search,
        status: status ? (status as "active" | "inactive") : undefined,
      });

      const totalPages = Math.ceil(totalCount / limit);

      return res.json({
        success: true,
        data: {
          categories,
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

  /**
   * Get all active categories (for dropdowns)
   */
  async getAllActiveCategories(req: Request, res: Response, next: NextFunction) {
    try {
      const categories = await ecomCategoryRepository.getAllActiveCategories();
      return res.json({
        success: true,
        data: categories,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get category by ID
   */
  async getCategoryById(req: Request, res: Response, next: NextFunction) {
    try {
      const { categoryId } = req.params;

      if (!mongoose.Types.ObjectId.isValid(categoryId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid category ID format",
        });
      }

      const category = await ecomCategoryRepository.getOneModel(categoryId);

      return res.json({
        success: true,
        data: category,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Create new category
   */
  async createCategory(req: Request, res: Response, next: NextFunction) {
    try {
      const { name, description = "", status = "active" } = req.body as Partial<IEcomCategory>;

      if (!name || !name.trim()) {
        return res.status(400).json({
          success: false,
          message: "Category name is required",
        });
      }

      if (status && !["active", "inactive"].includes(status)) {
        return res.status(400).json({
          success: false,
          message: "Status must be 'active' or 'inactive'",
        });
      }

      const existing = await ecomCategoryRepository.searchModel({
        name: { $regex: `^${name.trim()}$`, $options: "i" },
      });

      if (existing) {
        return res.status(409).json({
          success: false,
          message: "Category name already exists",
        });
      }

      const categoryData: Partial<IEcomCategory> = {
        name: name.trim(),
        description: description?.trim() || "",
        status: status as "active" | "inactive",
      };

      const category = await ecomCategoryRepository.createModel(categoryData);

      return res.status(201).json({
        success: true,
        message: "Category created successfully",
        data: category,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update category
   */
  async updateCategory(req: Request, res: Response, next: NextFunction) {
    try {
      const { categoryId } = req.params;
      const { name, description, status } = req.body as Partial<IEcomCategory>;

      if (!mongoose.Types.ObjectId.isValid(categoryId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid category ID format",
        });
      }

      if (!name && description === undefined && !status) {
        return res.status(400).json({
          success: false,
          message: "At least one field (name, description, status) is required",
        });
      }

      if (status && !["active", "inactive"].includes(status)) {
        return res.status(400).json({
          success: false,
          message: "Status must be 'active' or 'inactive'",
        });
      }

      const currentCategory = await ecomCategoryRepository.getOneModel(categoryId);

      if (!currentCategory) {
        return res.status(404).json({
          success: false,
          message: "Category not found",
        });
      }

      if (name && name.trim() !== currentCategory.name) {
        const duplicate = await ecomCategoryRepository.searchModel({
          name: { $regex: `^${name.trim()}$`, $options: "i" },
          _id: { $ne: categoryId },
        } as any);

        if (duplicate) {
          return res.status(409).json({
            success: false,
            message: "Category name already exists",
          });
        }
      }

      const updateData: Partial<IEcomCategory> = {};
      if (name) updateData.name = name.trim();
      if (description !== undefined) updateData.description = description?.trim() || "";
      if (status) updateData.status = status as "active" | "inactive";

      const updatedCategory = await ecomCategoryRepository.updateModel(categoryId, updateData);

      return res.json({
        success: true,
        message: "Category updated successfully",
        data: updatedCategory,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update category status only
   */
  async updateCategoryStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const { categoryId } = req.params;
      const { status } = req.body as { status?: "active" | "inactive" };

      if (!mongoose.Types.ObjectId.isValid(categoryId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid category ID format",
        });
      }

      if (!status || !["active", "inactive"].includes(status)) {
        return res.status(400).json({
          success: false,
          message: "Status must be 'active' or 'inactive'",
        });
      }

      const updatedCategory = await ecomCategoryRepository.updateModel(categoryId, {
        status: status as "active" | "inactive",
      });

      return res.json({
        success: true,
        message: "Category status updated successfully",
        data: updatedCategory,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Delete category
   */
  async deleteCategory(req: Request, res: Response, next: NextFunction) {
    try {
      const { categoryId } = req.params;

      if (!mongoose.Types.ObjectId.isValid(categoryId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid category ID format",
        });
      }

      const hasProducts = await productRepository.categoryExists(categoryId);
      if (hasProducts) {
        return res.status(409).json({
          success: false,
          message: "Category has products. Please move or delete products first.",
        });
      }

      await ecomCategoryRepository.deleteModel(categoryId);

      return res.json({
        success: true,
        message: "Category deleted successfully",
      });
    } catch (error) {
      next(error);
    }
  }
}
