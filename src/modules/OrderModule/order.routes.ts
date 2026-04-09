import { OrderController } from "./order.controller";

const _orderController = new OrderController();

export const OrderRoute = [
  /**
   * Place new order
   * (logged-in user)
   */
  {
    path: "/orders",
    request: null,
    action: _orderController.placeOrder,
    method: "post",
  },

  /**
   * Get my orders (paginated)
   * (logged-in user)
   */
  {
    path: "/orders/my",
    request: null,
    action: _orderController.getMyOrders,
    method: "get",
  },

  /**
   * Admin: Get all orders (paginated + filters)
   */
  {
    path: "/orders",
    request: null,
    action: _orderController.getAllOrders,
    method: "get",
    roles: ["admin"],
  },

  /**
   * Admin: Update order status
   */
  {
    path: "/orders/:orderId/status",
    request: null,
    action: _orderController.updateOrderStatus,
    method: "patch",
    roles: ["admin"],
  },

  // Get order by id (public for logged-in users / or admin if needed)
  {
    path: "/orders/:orderId",
    request: null,
    action: _orderController.getOrderById,
    method: "get",
  },

  // existing Admin: Update order status
  {
    path: "/orders/:orderId/status",
    request: null,
    action: _orderController.updateOrderStatus,
    method: "patch",
    roles: ["admin"],
  },
];