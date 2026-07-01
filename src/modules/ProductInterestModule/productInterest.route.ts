import { ProductInterestController } from "./productInterest.controller";

const _productInterestController = new ProductInterestController();

export const ProductInterestRoute = [
  {
    path: "/product-interests",
    request: null,
    action: _productInterestController.getAllInterests,
    method: "get",
  },
  {
    path: "/products/:productId/interested",
    request: null,
    action: _productInterestController.expressInterest,
    method: "post",
  },
];
