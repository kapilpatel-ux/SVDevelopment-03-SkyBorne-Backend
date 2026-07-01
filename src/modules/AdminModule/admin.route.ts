import { AdminController } from "./admin.controller";
import { UserController } from "../UserModule/controllers/userController";

const _adminController = new AdminController();

export const AdminRoutes = [
  // Get overview statistics
  {
    path: "/stats/overview",
    request: null,
    action: _adminController.getOverviewStats,
    method: "get",
  },

  // Get user growth data
  {
    path: "/stats/user-growth",
    request: null,
    action: _adminController.getUserGrowth,
    method: "get",
  },

  // Get monthly revenue
  {
    path: "/stats/monthly-revenue",
    request: null,
    action: _adminController.getMonthlyRevenue,
    method: "get",
  },

  // Get recent activities
  {
    path: "/stats/recent-activities",
    request: null,
    action: _adminController.getRecentActivities,
    method: "get",
  },

  // Get top performing services
  {
    path: "/stats/top-services",
    request: null,
    action: _adminController.getTopServices,
    method: "get",
  },

  // Get pending payment approvals
  {
    path: "/stats/pending-approvals",
    request: null,
    action: _adminController.getPendingApprovals,
    method: "get",
  },

  {
    path: "/stats/revenue-by-country",
    request: null,
    action: _adminController.getRevenueByCountry,
    method: "get",
  },
  {
    path: "/purge-deleted-users",
    request: null,
    action: _adminController.purgeDeletedUsers,
    method: "post",
    roles: ["admin"],
  },
  {
    path: "/account-deletion-requests",
    request: null,
    action: _adminController.getAccountDeletionRequests,
    method: "get",
    roles: ["admin"],
  },
  {
    path: "/account-deletion-requests/:requestId/approve",
    request: null,
    action: UserController.approveDeletionRequest,
    method: "post",
    roles: ["admin"],
  },
  {
    path: "/account-deletion-requests/:requestId/reject",
    request: null,
    action: UserController.rejectDeletionRequest,
    method: "post",
    roles: ["admin"],
  },
  {
    path: "/account-deletion-requests/:requestId",
    request: null,
    action: UserController.deleteDeletionRequest,
    method: "delete",
    roles: ["admin"],
  },
];
