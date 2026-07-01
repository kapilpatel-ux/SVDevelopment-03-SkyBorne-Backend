import { ProductController } from "./product.controller";
import {
  CreateProductSchema,
  UpdateProductSchema,
  UpdateProductStatusSchema,
} from "./requests/product.validation";

const _productController = new ProductController();

export const ProductRoute = [
  // =============================
  // GET ROUTES
  // =============================

  {
    path: "/products",
    request: null,
    action: _productController.getAllProducts,
    method: "get",
  },

  {
    path: "/products/published",
    request: null,
    action: _productController.getAllPublishedProducts,
    method: "get",
  },

  {
    path: "/products/category/:categoryId",
    request: null,
    action: _productController.getProductsByCategory,
    method: "get",
  },

  {
    path: "/products/status/:status",
    request: null,
    action: _productController.getProductsByStatus,
    method: "get",
  },

  {
    path: "/products/:productId",
    request: null,
    action: _productController.getProductById,
    method: "get",
  },

  {
    path: "/products/:productId/reviews",
    request: null,
    action: _productController.addProductReview,
    method: "post",
  },

  // =============================
  // POST ROUTES
  // =============================

  {
    path: "/create-product",
    request: CreateProductSchema,
    action: _productController.createProduct,
    method: "post",
  },

  // =============================
  // PUT / PATCH ROUTES
  // =============================

  {
    path: "/update-product/:productId",
    request: UpdateProductSchema,
    action: _productController.updateProduct,
    method: "put",
  },

  {
    path: "/update-product-status/:productId",
    request: UpdateProductStatusSchema,
    action: _productController.updateProductStatus,
    method: "patch",
  },

  // =============================
  // DELETE ROUTES
  // =============================

  {
    path: "/delete-product/:productId",
    request: null,
    action: _productController.deleteProduct,
    method: "delete",
  },
];
