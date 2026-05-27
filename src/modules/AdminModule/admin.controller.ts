import { Request, Response } from "express";
import User from "../UserModule/models/User";
import AccountDeletionRequest from "../UserModule/models/AccountDeletionRequest";
import Payment from "../PaymentModule/models/Payment";
import Meeting from "../MeetingModule/MeetingModels/Meeting";
import TrainerModel from "../TrainerModule/TrainerModel";
import ServiceModel from "../ServiceModule/models/Service";

interface IActivity {
  text: string;
  time: string;
  type: "success" | "info" | "warning";
}

interface IServicePerformance {
  service: string;
  users: number;
  revenue: string;
}

interface IOverviewStats {
  activeUsers: {
    value: number;
    change: number;
  };
    totalRevenue: {
    value: number;
    change: number;
  };
  monthlyRevenue: {
    value: number;
    change: number;
  };
  activeTrainers: {
    value: number;
    change: number;
  };
  growthRate: {
    value: string;
    change: number;
  };
  pendingApprovals: {
    value: number;
    change: number;
  };
  sessionsThisMonth: {
    value: number;
    change: number;
  };
}

// Helper function to calculate time difference
function getTimeAgo(date: Date): string {
  const seconds = Math.floor((new Date().getTime() - new Date(date).getTime()) / 1000);
  const intervals: { [key: string]: number } = {
    year: 31536000,
    month: 2592000,
    week: 604800,
    day: 86400,
    hour: 3600,
    minute: 60,
  };

  for (const [name, secondsInInterval] of Object.entries(intervals)) {
    const interval = Math.floor(seconds / secondsInInterval);
    if (interval >= 1) {
      return `${interval} ${name}${interval > 1 ? "s" : ""} ago`;
    }
  }
  return "just now";
}

// Helper function to get month start and end dates
function getMonthDateRange(monthsBack: number): { start: Date; end: Date } {
  const date = new Date();
  date.setMonth(date.getMonth() - monthsBack);
  
  const year = date.getFullYear();
  const month = date.getMonth();
  
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0, 23, 59, 59, 999);
  
  return { start, end };
}

// Helper function to extract minutes from time string
function extractMinutes(timeStr: string): number {
  const match = timeStr.match(/(\d+)\s*(minute|hour|day|week|month|year)/);
  if (!match) return 0;

  const value = parseInt(match[1]);
  const unit = match[2];

  const multipliers: { [key: string]: number } = {
    minute: 1,
    hour: 60,
    day: 60 * 24,
    week: 60 * 24 * 7,
    month: 60 * 24 * 30,
    year: 60 * 24 * 365,
  };

  return value * (multipliers[unit] || 1);
}

export class AdminController {
  /**
   * Get overview statistics
   * Returns: Active users, revenue, trainers, growth rate, pending approvals, sessions
   */
getOverviewStats = async (req: Request, res: Response): Promise<void> => {
    try {
      // ===== ACTIVE USERS =====
      const activeUsers = await User.countDocuments({
        onboardingCompleted: true,
        role: "user"
      });

      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const previousMonthUsers = await User.countDocuments({
        onboardingCompleted: true,
        createdAt: { $lt: thirtyDaysAgo },
      });

      const userGrowthPercent = previousMonthUsers > 0 
        ? parseFloat((((activeUsers - previousMonthUsers) / previousMonthUsers) * 100).toFixed(1))
        : 0;

      // ===== TOTAL REVENUE =====
      const totalRevenueAgg = await Payment.aggregate([
        {
          $match: {
            status: "COMPLETED",
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: "$amount" },
          },
        },
      ]);

      const totalRevenue = totalRevenueAgg[0]?.total || 0;

      // ===== MONTHLY REVENUE =====
      const currentMonth = new Date();
      currentMonth.setDate(1);
      currentMonth.setHours(0, 0, 0, 0);

      const monthlyRevenueAgg = await Payment.aggregate([
        {
          $match: {
            status: "COMPLETED",
            createdAt: { $gte: currentMonth },
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: "$amount" },
          },
        },
      ]);

      const revenue = monthlyRevenueAgg[0]?.total || 0;

      // Previous month revenue
      const previousMonthStart = new Date(currentMonth);
      previousMonthStart.setMonth(previousMonthStart.getMonth() - 1);
      
      const previousMonthEnd = new Date(currentMonth);
      previousMonthEnd.setDate(0);
      previousMonthEnd.setHours(23, 59, 59, 999);

      const previousRevenueAgg = await Payment.aggregate([
        {
          $match: {
            status: "COMPLETED",
            createdAt: { $gte: previousMonthStart, $lte: previousMonthEnd },
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: "$amount" },
          },
        },
      ]);

      const prevRevenue = previousRevenueAgg[0]?.total || 0;
      const revenueGrowthPercent = prevRevenue > 0
        ? parseFloat((((revenue - prevRevenue) / prevRevenue) * 100).toFixed(1))
        : 0;

      // ===== ACTIVE TRAINERS =====
      const activeTrainers = await TrainerModel.countDocuments();

      // ===== PENDING APPROVALS =====
      const pendingApprovals = await Payment.countDocuments({
        status: "PENDING",
      });

      // ===== SESSIONS THIS MONTH =====
      const sessionsThisMonth = await Meeting.countDocuments({
        startDate: { $gte: currentMonth },
      });

      // Sessions growth
      const previousSessionsAgg = await Meeting.countDocuments({
        startDate: {
          $gte: previousMonthStart,
          $lte: previousMonthEnd,
        },
      });

      const sessionsGrowthPercent = previousSessionsAgg > 0
        ? parseFloat((((sessionsThisMonth - previousSessionsAgg) / previousSessionsAgg) * 100).toFixed(1))
        : 0;

      // ===== GROWTH RATE =====
      const totalUsers = activeUsers + previousMonthUsers;
      const growthRate = totalUsers > 0 
        ? ((activeUsers / totalUsers) * 100).toFixed(1)
        : "0";

      const stats: IOverviewStats = {
        activeUsers: {
          value: activeUsers,
          change: userGrowthPercent,
        },
        totalRevenue: {
          value: totalRevenue,
          change: 0,
        },
        monthlyRevenue: {
          value: revenue,
          change: revenueGrowthPercent,
        },
        activeTrainers: {
          value: activeTrainers,
          change: 0,
        },
        growthRate: {
          value: growthRate,
          change: userGrowthPercent,
        },
        pendingApprovals: {
          value: pendingApprovals,
          change: 0,
        },
        sessionsThisMonth: {
          value: sessionsThisMonth,
          change: sessionsGrowthPercent,
        },
      };

      res.status(200).json({
        success: true,
        data: stats,
      });
    } catch (error) {
      console.error("Error in getOverviewStats:", error);
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : "Server error",
      });
    }
  };

  /**
   * Trigger purge of anonymized users older than specified days (admin only)
   */
  purgeDeletedUsers = async (req: Request, res: Response): Promise<void> => {
    try {
      const days = parseInt((req.query.days as string) || "30", 10);
      const { purgeAnonymizedUsers } = await import("../../services/userPurgeService");
      const result = await purgeAnonymizedUsers(days);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      console.error("Error in purgeDeletedUsers:", error);
      res.status(500).json({ success: false, message: error instanceof Error ? error.message : "Server error" });
    }
  };

  /**
   * List recent account deletion requests for admins
   */
  getAccountDeletionRequests = async (req: Request, res: Response): Promise<void> => {
    try {
      const page = parseInt((req.query.page as string) || "1", 10);
      const limit = parseInt((req.query.limit as string) || "10", 10);
      const status = (req.query.status as string) || "all";
      const skip = (page - 1) * limit;

      const query: Record<string, any> = {};
      if (status !== "all") {
        query.status = status;
      }

      const [items, total] = await Promise.all([
        AccountDeletionRequest.find(query)
          .sort({ requestedAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        AccountDeletionRequest.countDocuments(query),
      ]);

      res.status(200).json({
        success: true,
        data: {
          items,
          pagination: {
            currentPage: page,
            totalPages: Math.ceil(total / limit),
            total,
            limit,
          },
        },
      });
    } catch (error) {
      console.error("Error in getAccountDeletionRequests:", error);
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : "Server error",
      });
    }
  };

  /**
   * Get user growth data
   * Supports: week, month, quarter periods
   */
  getUserGrowth = async (req: Request, res: Response): Promise<void> => {
    try {
      const period = (req.query.period as string) || "week";
      let daysBack = 7;

      if (period === "month") daysBack = 30;
      if (period === "quarter") daysBack = 90;

      const startDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
      startDate.setHours(0, 0, 0, 0);

      const userGrowthAgg = await User.aggregate([
        {
          $match: {
            createdAt: { $gte: startDate },
          },
        },
        {
          $group: {
            _id: {
              $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
            },
            count: { $sum: 1 },
          },
        },
        {
          $sort: { _id: 1 },
        },
      ]);

      // Fill missing dates with 0
      const labels: string[] = [];
      const values: number[] = [];
      const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

      for (let i = 0; i < daysBack; i++) {
        const date = new Date(Date.now() - (daysBack - i - 1) * 24 * 60 * 60 * 1000);
        date.setHours(0, 0, 0, 0);
        const dateStr = date.toISOString().split("T")[0];
        
        const found = userGrowthAgg.find((g:any) => g._id === dateStr);

        if (daysBack === 7) {
          labels.push(dayNames[date.getDay()]);
        } else {
          labels.push(
            date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
          );
        }
        values.push(found?.count || 0);
      }

      res.status(200).json({
        success: true,
        data: {
          labels,
          values,
        },
      });
    } catch (error) {
      console.error("Error in getUserGrowth:", error);
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : "Server error",
      });
    }
  };

  /**
   * Get monthly revenue
   * Supports: 3months, 6months, 1year periods
   */
  getMonthlyRevenue = async (req: Request, res: Response): Promise<void> => {
    try {
      const period = (req.query.period as string) || "6months";
      let monthsBack = 6;

      if (period === "3months") monthsBack = 3;
      if (period === "1year") monthsBack = 12;

      const monthLabels: string[] = [];
      const revenueValues: number[] = [];

      for (let i = monthsBack - 1; i >= 0; i--) {
        const { start, end } = getMonthDateRange(i);

        const revenueAgg = await Payment.aggregate([
          {
            $match: {
              status: "COMPLETED",
              createdAt: { $gte: start, $lte: end },
            },
          },
          {
            $group: {
              _id: null,
              total: { $sum: "$amount" },
            },
          },
        ]);

        const monthStr = start.toLocaleDateString("en-US", { month: "short" });
        monthLabels.push(monthStr);
        revenueValues.push(revenueAgg[0]?.total || 0);
      }

      res.status(200).json({
        success: true,
        data: {
          labels: monthLabels,
          values: revenueValues,
        },
      });
    } catch (error) {
      console.error("Error in getMonthlyRevenue:", error);
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : "Server error",
      });
    }
  };

  /**
   * Get recent activities across the platform
   * Combines: new users, payments, trainers, and sessions
   */
  getRecentActivities = async (req: Request, res: Response): Promise<void> => {
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      // Fetch all activities in parallel
      const [newUsers, payments, newTrainers, newSessions, deletionRequests] = await Promise.all([
        User.find(
          { createdAt: { $gte: sevenDaysAgo } },
          { firstName: 1, lastName: 1, createdAt: 1 }
        )
          .sort({ createdAt: -1 })
          .limit(3)
          .lean(),
        
        Payment.find(
          { status: "COMPLETED", createdAt: { $gte: sevenDaysAgo } },
          { amount: 1, createdAt: 1, userId: 1 }
        )
          .populate("userId", "firstName lastName")
          .sort({ createdAt: -1 })
          .limit(3)
          .lean(),
        
        TrainerModel.find(
          { createdAt: { $gte: sevenDaysAgo } },
          { name: 1, createdAt: 1 }
        )
          .sort({ createdAt: -1 })
          .limit(3)
          .lean(),
        
        Meeting.find(
          { startDate: { $gte: sevenDaysAgo } },
          { title: 1, startDate: 1 }
        )
          .sort({ startDate: -1 })
          .limit(3)
          .lean(),

        AccountDeletionRequest.find(
          { requestedAt: { $gte: sevenDaysAgo } },
          { fullName: 1, requestedAt: 1, status: 1 }
        )
          .sort({ requestedAt: -1 })
          .limit(5)
          .lean(),
      ]);

      // Combine and format activities
      const activities: IActivity[] = [];

      // Add user registrations
      newUsers.forEach((user: any) => {
        activities.push({
          text: `New user registration - ${user.firstName} ${user.lastName || ""}`.trim(),
          time: getTimeAgo(user.createdAt),
          type: "success",
        });
      });

      // Add payments
      payments.forEach((payment: any) => {
        const userName = payment.userId?.firstName || "User";
        const amount = (payment.amount).toFixed(2);
        activities.push({
          text: `Payment received from ${userName} - $${amount}`,
          time: getTimeAgo(payment.createdAt),
          type: "success",
        });
      });

      // Add new trainers
      newTrainers.forEach((trainer: any) => {
        activities.push({
          text: `New trainer added - ${trainer.name}`,
          time: getTimeAgo(trainer.createdAt),
          type: "info",
        });
      });

      // Add new sessions
      newSessions.forEach((session: any) => {
        activities.push({
          text: `New session scheduled - ${session.title}`,
          time: getTimeAgo(session.startDate),
          type: "success",
        });
      });

      // Add account deletion requests
      deletionRequests.forEach((request: any) => {
        activities.push({
          text: `Account deletion request - ${request.fullName}`,
          time: getTimeAgo(request.requestedAt),
          type: "warning",
        });
      });

      // Sort by recency (time-based)
      activities.sort((a, b) => {
        const timeA = extractMinutes(a.time);
        const timeB = extractMinutes(b.time);
        return timeA - timeB;
      });

      res.status(200).json({
        success: true,
        data: activities.slice(0, 10),
      });
    } catch (error) {
      console.error("Error in getRecentActivities:", error);
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : "Server error",
      });
    }
  };

  /**
   * Get top performing services
   * Shows: service name, user count, and total revenue
   */
  getTopServices = async (req: Request, res: Response): Promise<void> => {
    try {
      // Get top services by session count
      const topServicesAgg = await Meeting.aggregate([
        {
          $group: {
            _id: "$service",
            sessionCount: { $sum: 1 },
          },
        },
        {
          $lookup: {
            from: "services",
            localField: "_id",
            foreignField: "_id",
            as: "serviceDetails",
          },
        },
        {
          $unwind: {
            path: "$serviceDetails",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $sort: { sessionCount: -1 },
        },
        {
          $limit: 4,
        },
      ]);

      // Calculate revenue for each service
      const servicesWithRevenue: IServicePerformance[] = await Promise.all(
        topServicesAgg.map(async (service: any) => {
          // Count unique users who purchased this service
          const userCount = await Meeting.distinct("createdBy", {
            service: service._id,
          }).then((users:any) => users.length);

          // Get total revenue from payments related to this service
          const revenueAgg = await Payment.aggregate([
            {
              $match: {
                status: "COMPLETED",
                plan: service.serviceDetails?.title || "",
              },
            },
            {
              $group: {
                _id: null,
                total: { $sum: "$amount" },
              },
            },
          ]);

          const totalRevenue = revenueAgg[0]?.total || 0;
          const formattedRevenue = `$${(totalRevenue / 100).toFixed(2)}`;

          return {
            service: service.serviceDetails?.title || "Unknown",
            users: userCount,
            revenue: formattedRevenue,
          };
        })
      );

      res.status(200).json({
        success: true,
        data: servicesWithRevenue,
      });
    } catch (error) {
      console.error("Error in getTopServices:", error);
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : "Server error",
      });
    }
  };

  /**
   * Get pending payment approvals
   * Returns: payment details with user information
   */
  getPendingApprovals = async (req: Request, res: Response): Promise<void> => {
    try {
      const pending = await Payment.find({ status: "PENDING" })
        .populate("userId", "firstName lastName email")
        .sort({ createdAt: -1 })
        .limit(10)
        .lean();

      const formattedPending = pending.map((payment: any) => ({
        ...payment,
        amount: (payment.amount / 100).toFixed(2),
      }));

      res.status(200).json({
        success: true,
        data: formattedPending,
      });
    } catch (error) {
      console.error("Error in getPendingApprovals:", error);
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : "Server error",
      });
    }
  };

  /**
 * Add this method to your AdminController class
 * GET /stats/revenue-by-country
 * Returns revenue data grouped by country with grand total
 */

getRevenueByCountry = async (req: Request, res: Response): Promise<void> => {
  try {
    // Aggregate payments by country
    const revenueByCountry = await Payment.aggregate([
      {
        // Step 1: Match only completed payments
        $match: {
          status: "COMPLETED",
        },
      },
      {
        // Step 2: Lookup user information to get country
        $lookup: {
          from: "users",
          localField: "userId",
          foreignField: "_id",
          as: "userInfo",
        },
      },
      {
        // Step 3: Unwind the user array
        $unwind: {
          path: "$userInfo",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        // Step 4: Group by country and sum amounts
        $group: {
          _id: "$userInfo.country",
          totalAmount: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
      {
        // Step 5: Sort by total amount descending
        $sort: { totalAmount: -1 },
      },
    ]);

    // Calculate grand total
    const grandTotal = revenueByCountry.reduce(
      (sum, item) => sum + item.totalAmount,
      0
    );

    // Format the data
    const formattedData = revenueByCountry.map((item) => ({
      country: item._id || "N/A",
      count: item.count,
      amount: item.totalAmount,
    }));

    // Add grand total row
    const tableData = {
      rows: formattedData,
      grandTotal: {
        country: "Grand Total",
        count: formattedData.reduce((sum, row) => sum + row.count, 0),
        amount: grandTotal,
      },
    };

    res.status(200).json({
      success: true,
      data: tableData,
    });
  } catch (error) {
    console.error("Error in getRevenueByCountry:", error);
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Server error",
    });
  }
};
}