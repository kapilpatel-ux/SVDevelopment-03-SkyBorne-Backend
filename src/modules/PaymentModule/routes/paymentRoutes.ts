import validateData from "../../../utils/validation.utils";
import PaymentController from "../controllers/paymentController";
import { paymentWebhookController } from "../controllers/paymentWebhookController";
import { CreatePaymentOrderSchema } from "../requests/createPayment";
import {
  GetPaymentStatusSchema,
  GetVerifyStatusSchema,
} from "../requests/getPaymentStatus";

export const PaymentApiRoutes = [
  {
    path: "/payment/create-order",
    request: null,
    action: PaymentController.createPaymentOrder,
    method: "post",
  },
  {
    path: "/payment/upgrade-order",
    request: null,
    action: PaymentController.upgradePlanOrder,
    method: "post",
  },
    {
    path: "/payment/verify-mobile",
    requyoest: null,
    action: PaymentController.verifyMobilePayment,
    method: "post",
  },

  {
    path: "/payment/webhook",
    request: null,
    action: paymentWebhookController,
    method: "post",
  },
  {
    path: "/payment/status/:orderRef",
    action: PaymentController.getPaymentStatus,
    request: validateData(GetPaymentStatusSchema),
    method: "get",
  },
  {
    path: "/payment/verify-payment",
    action: PaymentController.verifyPayment,
    request: null,
    method: "post",
  },

  {
    path: "/payment/history/:userId",
    action: PaymentController.getPaymentHistory,
    request: null,
    method: "get",
  },
  {
    path: "/payment/stats/:userId",
    action: PaymentController.getPaymentStats,
    request: null,
    method: "get",
  },

{
    path: "/payment/admin/all",
    action: PaymentController.getAllPayments,
    request: null,
    method: "get",
  },
  {
    path: "/payment/admin/recurring-failures",
    action: PaymentController.getAllRecurringPaymentFailures,
    request: null,
    method: "get",
  },
  {
  path: "/payment/admin/export",
  request: null,
  action: PaymentController.exportPaymentsCSV,
  method: "get",
},
  {
    path: "/subscription/:userId/cancel",
    action: PaymentController.cancelSubscription,
    request: null,
    method: "post",
  },
  {
    path: "/subscription/:userId/status",
    action: PaymentController.updateCancelSubscriptionStatus,
    request: null,
    method: "patch",
  },
  {
    path: "/payment/admin/stats",
    action: PaymentController.getAdminPaymentStats,
    request: null,
    method: "get",
  },
  {
    path: "/payment/card-details",
    action: PaymentController.getCardDetails,
    request: null,
    method: "get",
  },
  {
    path: "/payment/card-portal-session",
    action: PaymentController.createCardPortalSession,
    request: null,
    method: "post",
  },
  {
    path: "/payment/stripe-portal-return",
    action: PaymentController.stripePortalReturn,
    request: null,
    method: "get",
  },
  {
    path: "/payment/stripe-checkout-return",
    action: PaymentController.stripeCheckoutReturn,
    request: null,
    method: "get",
  },
];
