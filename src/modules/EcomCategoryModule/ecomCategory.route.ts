import { EcomCategoryController } from "./ecomCategory.controller";

const _ecomCategoryController = new EcomCategoryController();

export const EcomCategoryRoute = [
  {
    path: "/ecom-categories",
    request: null,
    action: _ecomCategoryController.getAllCategories,
    method: "get",
  },
  {
    path: "/ecom-categories/active",
    request: null,
    action: _ecomCategoryController.getAllActiveCategories,
    method: "get",
  },
  {
    path: "/ecom-categories/:categoryId",
    request: null,
    action: _ecomCategoryController.getCategoryById,
    method: "get",
  },
  {
    path: "/create-ecom-category",
    request: null,
    action: _ecomCategoryController.createCategory,
    method: "post",
  },
  {
    path: "/update-ecom-category/:categoryId",
    request: null,
    action: _ecomCategoryController.updateCategory,
    method: "put",
  },
  {
    path: "/update-ecom-category-status/:categoryId",
    request: null,
    action: _ecomCategoryController.updateCategoryStatus,
    method: "patch",
  },
  {
    path: "/delete-ecom-category/:categoryId",
    request: null,
    action: _ecomCategoryController.deleteCategory,
    method: "delete",
  },
];
