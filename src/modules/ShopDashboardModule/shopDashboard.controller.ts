import { Request, Response } from "express";
import Customer from "../CustomerModule/customer.model";
import EcomPayment from "../EcomPaymentModule/Ecompayment.model";
import Order from "../OrderModule/order.model";
import Product from "../ProductModule/product.models";
import ProductInterest from "../ProductInterestModule/productInterest.model";
import ShopDashboardSnapshot from "./shopDashboard.model";

type TrendPeriod = "week" | "month" | "quarter";
type RevenuePeriod = "3months" | "6months" | "1year";

interface TrendPoint {
  dateKey: string;
  label: string;
}

interface ActivityItem {
  text: string;
  time: string;
  type: "success" | "info" | "warning";
  createdAt: Date;
}

const PENDING_ORDER_STATUSES = ["Pending", "Confirmed", "Processing"];

const toPercentChange = (current: number, previous: number): number => {
  if (previous === 0) {
    return current > 0 ? 100 : 0;
  }

  return Number((((current - previous) / previous) * 100).toFixed(1));
};

const getDateKey = (date: Date): string => {
  return date.toISOString().split("T")[0];
};

const getTimeAgo = (date: Date): string => {
  const now = Date.now();
  const diffInSeconds = Math.floor((now - date.getTime()) / 1000);

  const intervals: Array<{ label: string; seconds: number }> = [
    { label: "year", seconds: 31536000 },
    { label: "month", seconds: 2592000 },
    { label: "week", seconds: 604800 },
    { label: "day", seconds: 86400 },
    { label: "hour", seconds: 3600 },
    { label: "minute", seconds: 60 },
  ];

  for (const interval of intervals) {
    const value = Math.floor(diffInSeconds / interval.seconds);

    if (value >= 1) {
      return `${value} ${interval.label}${value > 1 ? "s" : ""} ago`;
    }
  }

  return "just now";
};

const getPeriodDays = (period: TrendPeriod): number => {
  switch (period) {
    case "week":
      return 7;
    case "quarter":
      return 90;
    case "month":
    default:
      return 30;
  }
};

const buildTrendPoints = (period: TrendPeriod): TrendPoint[] => {
  const daysBack = getPeriodDays(period);
  const points: TrendPoint[] = [];

  for (let index = 0; index < daysBack; index += 1) {
    const current = new Date();
    current.setDate(current.getDate() - (daysBack - index - 1));
    current.setHours(0, 0, 0, 0);

    points.push({
      dateKey: getDateKey(current),
      label:
        period === "week"
          ? current.toLocaleDateString("en-US", { weekday: "short" })
          : current.toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            }),
    });
  }

  return points;
};

const getRevenueMonths = (period: RevenuePeriod): number => {
  switch (period) {
    case "3months":
      return 3;
    case "1year":
      return 12;
    case "6months":
    default:
      return 6;
  }
};

const buildMonthlyPoints = (monthsBack: number): TrendPoint[] => {
  const points: TrendPoint[] = [];
  const today = new Date();

  for (let index = monthsBack - 1; index >= 0; index -= 1) {
    const pointDate = new Date(today.getFullYear(), today.getMonth() - index, 1);
    const key = `${pointDate.getFullYear()}-${String(pointDate.getMonth() + 1).padStart(2, "0")}`;

    points.push({
      dateKey: key,
      label: pointDate.toLocaleDateString("en-US", { month: "short" }),
    });
  }

  return points;
};

export class ShopDashboardController {
  getOverviewStats = async (_req: Request, res: Response): Promise<void> => {
    try {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const previousMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const previousMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

      const [
        totalRevenueAgg,
        currentMonthRevenueAgg,
        previousMonthRevenueAgg,
        totalTransactions,
        totalOrders,
        thisMonthOrders,
        previousMonthOrders,
        pendingOrders,
        deliveredOrders,
        previousMonthDeliveredOrders,
        totalCustomers,
        thisMonthCustomers,
        previousMonthCustomers,
        totalProducts,
        activeProducts,
        lowStockProducts,
        totalInterests,
        avgOrderValueAgg,
        previousAvgOrderValueAgg,
      ] = await Promise.all([
        EcomPayment.aggregate([
          { $match: { status: "succeeded" } },
          { $group: { _id: null, total: { $sum: "$amount" } } },
        ]),
        EcomPayment.aggregate([
          { $match: { status: "succeeded", createdAt: { $gte: monthStart } } },
          { $group: { _id: null, total: { $sum: "$amount" } } },
        ]),
        EcomPayment.aggregate([
          {
            $match: {
              status: "succeeded",
              createdAt: { $gte: previousMonthStart, $lte: previousMonthEnd },
            },
          },
          { $group: { _id: null, total: { $sum: "$amount" } } },
        ]),
        EcomPayment.countDocuments({ status: "succeeded" }),
        Order.countDocuments(),
        Order.countDocuments({ createdAt: { $gte: monthStart } }),
        Order.countDocuments({
          createdAt: { $gte: previousMonthStart, $lte: previousMonthEnd },
        }),
        Order.countDocuments({ orderStatus: { $in: PENDING_ORDER_STATUSES } }),
        Order.countDocuments({ orderStatus: "Delivered" }),
        Order.countDocuments({
          orderStatus: "Delivered",
          createdAt: { $gte: previousMonthStart, $lte: previousMonthEnd },
        }),
        Customer.countDocuments(),
        Customer.countDocuments({ createdAt: { $gte: monthStart } }),
        Customer.countDocuments({
          createdAt: { $gte: previousMonthStart, $lte: previousMonthEnd },
        }),
        Product.countDocuments(),
        Product.countDocuments({ status: "active" }),
        Product.countDocuments({ status: "active", stock: { $lte: 5 } }),
        ProductInterest.countDocuments(),
        Order.aggregate([
          { $match: { createdAt: { $gte: monthStart } } },
          { $group: { _id: null, avg: { $avg: "$totalAmount" } } },
        ]),
        Order.aggregate([
          {
            $match: {
              createdAt: { $gte: previousMonthStart, $lte: previousMonthEnd },
            },
          },
          { $group: { _id: null, avg: { $avg: "$totalAmount" } } },
        ]),
      ]);

      const totalRevenue = Number(totalRevenueAgg[0]?.total || 0);
      const thisMonthRevenue = Number(currentMonthRevenueAgg[0]?.total || 0);
      const previousMonthRevenue = Number(previousMonthRevenueAgg[0]?.total || 0);

      const conversionRate = totalOrders > 0 ? (deliveredOrders / totalOrders) * 100 : 0;
      const previousConversionRate =
        previousMonthOrders > 0 ? (previousMonthDeliveredOrders / previousMonthOrders) * 100 : 0;

      const averageOrderValue = Number(avgOrderValueAgg[0]?.avg || 0);
      const previousAverageOrderValue = Number(previousAvgOrderValueAgg[0]?.avg || 0);

      const stats = {
        totalRevenue: {
          value: Number(totalRevenue.toFixed(2)),
          change: toPercentChange(thisMonthRevenue, previousMonthRevenue),
        },
        thisMonthRevenue: {
          value: Number(thisMonthRevenue.toFixed(2)),
          change: toPercentChange(thisMonthRevenue, previousMonthRevenue),
        },
        totalOrders: {
          value: totalOrders,
          change: toPercentChange(thisMonthOrders, previousMonthOrders),
        },
        totalCustomers: {
          value: totalCustomers,
          change: toPercentChange(thisMonthCustomers, previousMonthCustomers),
        },
        activeProducts: {
          value: activeProducts,
          change: 0,
        },
        lowStockProducts: {
          value: lowStockProducts,
          change: 0,
        },
        pendingOrders: {
          value: pendingOrders,
          change: 0,
        },
        conversionRate: {
          value: Number(conversionRate.toFixed(1)),
          change: Number((conversionRate - previousConversionRate).toFixed(1)),
        },
        averageOrderValue: {
          value: Number(averageOrderValue.toFixed(2)),
          change: toPercentChange(averageOrderValue, previousAverageOrderValue),
        },
        totalInterests: {
          value: totalInterests,
          change: 0,
        },
        totalTransactions: {
          value: totalTransactions,
          change: toPercentChange(thisMonthRevenue, previousMonthRevenue),
        },
        totalProducts: {
          value: totalProducts,
          change: 0,
        },
      };

      const snapshotDateKey = getDateKey(now);
      await ShopDashboardSnapshot.findOneAndUpdate(
        { dateKey: snapshotDateKey },
        {
          dateKey: snapshotDateKey,
          generatedAt: now,
          stats,
        },
        {
          upsert: true,
          new: true,
          setDefaultsOnInsert: true,
        }
      );

      res.status(200).json({
        success: true,
        data: stats,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : "Failed to fetch shop overview",
      });
    }
  };

  getRevenueTrend = async (req: Request, res: Response): Promise<void> => {
    try {
      const period = (req.query.period as RevenuePeriod) || "6months";
      const safePeriod: RevenuePeriod = ["3months", "6months", "1year"].includes(period)
        ? period
        : "6months";
      const monthsBack = getRevenueMonths(safePeriod);

      const points = buildMonthlyPoints(monthsBack);
      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - (monthsBack - 1), 1);
      startDate.setHours(0, 0, 0, 0);

      const revenueAgg = await EcomPayment.aggregate([
        {
          $match: {
            status: "succeeded",
            createdAt: { $gte: startDate },
          },
        },
        {
          $group: {
            _id: {
              $dateToString: { format: "%Y-%m", date: "$createdAt" },
            },
            revenue: { $sum: "$amount" },
          },
        },
        { $sort: { _id: 1 } },
      ]);

      const revenueByMonth = new Map<string, number>();
      revenueAgg.forEach((row: { _id: string; revenue: number }) => {
        revenueByMonth.set(row._id, Number(row.revenue || 0));
      });

      const labels: string[] = [];
      const values: number[] = [];

      points.forEach((point) => {
        labels.push(point.label);
        const revenue = revenueByMonth.get(point.dateKey) || 0;
        values.push(Number(revenue.toFixed(2)));
      });

      res.status(200).json({
        success: true,
        data: {
          labels,
          values,
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : "Failed to fetch revenue trend",
      });
    }
  };

  getOrderTrend = async (req: Request, res: Response): Promise<void> => {
    try {
      const period = (req.query.period as TrendPeriod) || "month";
      const safePeriod: TrendPeriod = ["week", "month", "quarter"].includes(period)
        ? period
        : "month";

      const points = buildTrendPoints(safePeriod);
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - (points.length - 1));
      startDate.setHours(0, 0, 0, 0);

      const orderAgg = await Order.aggregate([
        {
          $match: {
            createdAt: { $gte: startDate },
          },
        },
        {
          $group: {
            _id: {
              $dateToString: {
                format: "%Y-%m-%d",
                date: "$createdAt",
              },
            },
            totalOrders: { $sum: 1 },
            delivered: {
              $sum: {
                $cond: [{ $eq: ["$orderStatus", "Delivered"] }, 1, 0],
              },
            },
            cancelled: {
              $sum: {
                $cond: [{ $eq: ["$orderStatus", "Cancelled"] }, 1, 0],
              },
            },
            pending: {
              $sum: {
                $cond: [{ $in: ["$orderStatus", PENDING_ORDER_STATUSES] }, 1, 0],
              },
            },
          },
        },
      ]);

      const statusAgg = await Order.aggregate([
        {
          $group: {
            _id: "$orderStatus",
            count: { $sum: 1 },
          },
        },
        {
          $sort: {
            count: -1,
          },
        },
      ]);

      const orderByDate = new Map<
        string,
        { totalOrders: number; delivered: number; cancelled: number; pending: number }
      >();

      orderAgg.forEach(
        (row: {
          _id: string;
          totalOrders: number;
          delivered: number;
          cancelled: number;
          pending: number;
        }) => {
          orderByDate.set(row._id, {
            totalOrders: row.totalOrders || 0,
            delivered: row.delivered || 0,
            cancelled: row.cancelled || 0,
            pending: row.pending || 0,
          });
        }
      );

      const labels: string[] = [];
      const values: number[] = [];

      points.forEach((point) => {
        labels.push(point.label);
        const value = orderByDate.get(point.dateKey);
        values.push(value?.totalOrders || 0);
      });

      res.status(200).json({
        success: true,
        data: {
          labels,
          values,
          statusBreakdown: statusAgg.map((item: { _id: string; count: number }) => ({
            status: item._id,
            count: item.count,
          })),
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : "Failed to fetch order trend",
      });
    }
  };

  getTopProducts = async (req: Request, res: Response): Promise<void> => {
    try {
      const limit = Number(req.query.limit) || 6;

      const topProducts = await Order.aggregate([
        {
          $unwind: "$items",
        },
        {
          $group: {
            _id: "$items.product",
            name: { $first: "$items.name" },
            quantitySold: { $sum: "$items.quantity" },
            revenue: {
              $sum: {
                $multiply: ["$items.quantity", "$items.price"],
              },
            },
            orders: { $sum: 1 },
            lastSoldAt: { $max: "$createdAt" },
          },
        },
        {
          $sort: {
            quantitySold: -1,
          },
        },
        {
          $limit: limit,
        },
      ]);

      res.status(200).json({
        success: true,
        data: topProducts.map(
          (item: {
            _id: string;
            name: string;
            quantitySold: number;
            revenue: number;
            orders: number;
            lastSoldAt: Date;
          }) => ({
            productId: item._id,
            name: item.name,
            quantitySold: item.quantitySold,
            revenue: Number((item.revenue || 0).toFixed(2)),
            orders: item.orders,
            lastSoldAt: item.lastSoldAt,
          })
        ),
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : "Failed to fetch top products",
      });
    }
  };

  getRecentActivities = async (req: Request, res: Response): Promise<void> => {
    try {
      const limit = Number(req.query.limit) || 8;

      const [orders, payments, interests] = await Promise.all([
        Order.find({})
          .select("orderNumber totalAmount orderStatus createdAt")
          .sort({ createdAt: -1 })
          .limit(limit)
          .lean(),
        EcomPayment.find({})
          .select("orderRef amount status createdAt")
          .sort({ createdAt: -1 })
          .limit(limit)
          .lean(),
        ProductInterest.find({})
          .select("product createdAt")
          .populate("product", "name")
          .sort({ createdAt: -1 })
          .limit(Math.max(4, Math.floor(limit / 2)))
          .lean(),
      ]);

      const orderActivities: ActivityItem[] = orders.map(
        (order: {
          orderNumber: string;
          totalAmount: number;
          orderStatus: string;
          createdAt: Date;
        }) => ({
          text: `Order ${order.orderNumber} is ${order.orderStatus.toLowerCase()} ($${Number(
            order.totalAmount || 0
          ).toFixed(2)})`,
          time: getTimeAgo(new Date(order.createdAt)),
          type: order.orderStatus === "Cancelled" ? "warning" : "info",
          createdAt: new Date(order.createdAt),
        })
      );

      const paymentActivities: ActivityItem[] = payments.map(
        (payment: { orderRef: string; amount: number; status: string; createdAt: Date }) => ({
          text: `Payment ${payment.orderRef} ${payment.status} ($${Number(
            payment.amount || 0
          ).toFixed(2)})`,
          time: getTimeAgo(new Date(payment.createdAt)),
          type: payment.status === "succeeded" ? "success" : "warning",
          createdAt: new Date(payment.createdAt),
        })
      );

      const interestActivities: ActivityItem[] = (
        interests as Array<{ product?: unknown; createdAt: Date }>
      ).map((interest) => {
        const productName =
          typeof interest.product === "object" &&
          interest.product !== null &&
          "name" in interest.product &&
          typeof (interest.product as { name?: string }).name === "string"
            ? (interest.product as { name: string }).name
            : "a product";

        return {
          text: `Interest received for ${productName}`,
          time: getTimeAgo(new Date(interest.createdAt)),
          type: "info",
          createdAt: new Date(interest.createdAt),
        };
      });

      const activities = [...orderActivities, ...paymentActivities, ...interestActivities]
        .sort((first, second) => second.createdAt.getTime() - first.createdAt.getTime())
        .slice(0, limit)
        .map(({ text, time, type }) => ({ text, time, type }));

      res.status(200).json({
        success: true,
        data: activities,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : "Failed to fetch recent activities",
      });
    }
  };
}
