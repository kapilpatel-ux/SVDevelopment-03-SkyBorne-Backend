import { CartController } from "./Cart.controller"; 

const _cartController = new CartController();

export const CartRoute = [
  /**
   * Get my cart
   * GET /cart
   */
  {
    path: "/cart",
    request: null,
    action: _cartController.getMyCart,
    method: "get",
  },

  /**
   * Add item to cart
   * POST /cart
   */
  {
    path: "/cart",
    request: null,
    action: _cartController.addToCart,
    method: "post",
  },

  /**
   * Update item quantity
   * PATCH /cart/:productId
   */
  {
    path: "/cart/:productId",
    request: null,
    action: _cartController.updateCartItem,
    method: "patch",
  },

  /**
   * Remove single item from cart
   * DELETE /cart/:productId
   */
  {
    path: "/cart/:productId",
    request: null,
    action: _cartController.removeFromCart,
    method: "delete",
  },

  /**
   * Clear entire cart
   * DELETE /cart
   */
  {
    path: "/cart/clear",
    request: null,
    action: _cartController.clearCart,
    method: "delete",
  },
];