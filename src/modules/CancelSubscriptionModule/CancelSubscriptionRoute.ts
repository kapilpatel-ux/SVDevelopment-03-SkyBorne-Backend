import CancelSubscriptionController from "./CancelSubscriptionController";
import type { AppRouteDefinition } from "../../routes/route.types";

export const CancelSubscriptionRoute: AppRouteDefinition[] = [
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
