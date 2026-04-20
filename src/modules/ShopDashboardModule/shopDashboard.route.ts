import { ShopDashboardController } from "./shopDashboard.controller";

const _shopDashboardController = new ShopDashboardController();

export const ShopDashboardRoute = [
  {
    path: "/shop-dashboard/overview",
    request: null,
    action: _shopDashboardController.getOverviewStats,
    method: "get",
    roles: ["admin"],
  },
  {
    path: "/shop-dashboard/revenue-trend",
    request: null,
    action: _shopDashboardController.getRevenueTrend,
    method: "get",
    roles: ["admin"],
  },
  {
    path: "/shop-dashboard/order-trend",
    request: null,
    action: _shopDashboardController.getOrderTrend,
    method: "get",
    roles: ["admin"],
  },
  {
    path: "/shop-dashboard/top-products",
    request: null,
    action: _shopDashboardController.getTopProducts,
    method: "get",
    roles: ["admin"],
  },
  {
    path: "/shop-dashboard/recent-activities",
    request: null,
    action: _shopDashboardController.getRecentActivities,
    method: "get",
    roles: ["admin"],
  },
];
