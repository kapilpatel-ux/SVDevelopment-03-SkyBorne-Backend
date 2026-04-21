import { EcomPaymentController } from "./Ecompayment.controller"; 

const _ecomPaymentController = new EcomPaymentController();

export const EcomPaymentRoute = [
  /**
   * Create Stripe checkout session from current cart
   * POST /ecom-payments/create-checkout-session
   * Body: { shippingAddress: { firstName, lastName, address, city, zip } }
   */
  {
    path: "/ecom-payments/create-checkout-session",
    request: null,
    action: _ecomPaymentController.createCheckoutSession,
    method: "post",
  },
  /**
   * Create Stripe checkout session from previous order
   * POST /ecom-payments/reorder/:orderId
   */
  {
    path: "/ecom-payments/reorder/:orderId",
    request: null,
    action: _ecomPaymentController.reorderCheckoutSession,
    method: "post",
  },

  /**
   * Get session details (used on success page)
   * GET /ecom-payments/session/:sessionId
   */
  {
    path: "/ecom-payments/session/:sessionId",
    request: null,
    action: _ecomPaymentController.getSessionDetails,
    method: "get",
  },

  /**
   * Get my payment history
   * GET /ecom-payments/my
   */
  {
    path: "/ecom-payments/my",
    request: null,
    action: _ecomPaymentController.getMyPayments,
    method: "get",
  },

  /**
   * Admin: Get all ecom payments
   * GET /ecom-payments
   */
  {
    path: "/ecom-payments",
    request: null,
    action: _ecomPaymentController.getAllPayments,
    method: "get",
    roles: ["admin"],
  },

  /**
   * Admin: Get ecom payment stats
   * GET /ecom-payments/admin/stats
   */
  {
    path: "/ecom-payments/admin/stats",
    request: null,
    action: _ecomPaymentController.getAdminPaymentStats,
    method: "get",
    roles: ["admin"],
  },

  /**
   * Admin: Download receipt
   * GET /ecom-payments/:paymentId/receipt
   */
  {
    path: "/ecom-payments/:paymentId/receipt",
    request: null,
    action: _ecomPaymentController.downloadReceipt,
    method: "get",
    roles: ["admin"],
  },
];
