// modules/PaymentModule/routes/InvoiceRoutes.ts
import InvoiceController from "./InvoiceController";
import type { AppRouteDefinition } from "../../routes/route.types";

export const InvoiceRoutes: AppRouteDefinition[] = [
  {
    path: "/invoice/:invoiceId/download",
    action: InvoiceController.getInvoiceById,
    method: "get",
    request: null,
  },
  {
    path: "/invoice/:invoiceId/details",
    action: InvoiceController.getInvoiceDetails,
    method: "get",
    request: null,
  },
  {
    path: "/invoices/user/:userId",
    action: InvoiceController.getUserInvoices,
    method: "get",
    request: null,
  },
];
