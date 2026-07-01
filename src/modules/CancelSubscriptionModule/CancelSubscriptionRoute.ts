import CancelSubscriptionController from "./CancelSubscriptionController";

export const CancelSubscriptionRoute = [
  {
    path: "/subscription/getAll",
    request: null,
    action: CancelSubscriptionController.getAll,
    method: "get",
  },
  {
    path: "/subscription/admin/export",
    request: null,
    action: CancelSubscriptionController.exportCancelSubscriptionsCSV,
    method: "get",
  },
  {
    path: "/subscription/cancel-subscription",
    request: null,
    action: CancelSubscriptionController.create,
    method: "post",
  },
];
