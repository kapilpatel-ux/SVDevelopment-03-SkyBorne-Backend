import { Request, Response, NextFunction } from "express";
import UserService from "../services/userService";
import User from "../models/User";
import AccountDeletionRequest from "../models/AccountDeletionRequest";
import DeviceToken from "../../NotificationModule/models/DeviceToken";
import MeetingAttendance from "../../MeetingModule/MeetingModels/MeetingAttendance";
import Service from "../../ServiceModule/models/Service";
import Meeting from "../../MeetingModule/MeetingModels/Meeting";
import extractPhoneDetails from "../../../utils/extractPhoneDetail";
import Payment from "../../PaymentModule/models/Payment";
import MeetingParticipant from "../../MeetingModule/MeetingModels/MeetingParticipant";
import { Feedback } from "../../FeedbackModule/FeedbackModel";
import UserSubscription from "../../PaymentModule/models/Subscription";
import { StripeService } from "../../PaymentModule/services/stripe.service";
import { NgeniusService } from "../../../services/ngenius.service";
import {
  notifyAccountDeletionDecision,
  notifyAccountDeletionRejection,
} from "../../../services/accountDeletion.service";

const userService = new UserService();

async function anonymizeUserAccount(user: any) {
  try {
    await Payment.deleteMany({ userId: user._id });
    await UserSubscription.deleteMany({ userId: user._id });
    await MeetingParticipant.deleteMany({ userId: user._id });
    await MeetingAttendance.deleteMany({ user: user._id });
    await Feedback.deleteMany({ userId: user._id });
  } catch (error) {
    console.error("Error deleting related records:", error);
  }

  user.email = `deleted+${user._id}@remove.local`;
  user.firstName = "Deleted";
  user.lastName = "User";
  user.phoneNumber = undefined as any;
  user.dialingCode = undefined as any;
  user.localNumber = undefined as any;
  user.ngeniusCustomerId = undefined as any;
  user.stripeCustomerId = undefined as any;
  user.stripeSubscriptionId = undefined as any;
  user.subscription = {
    ...user.subscription,
    status: "cancelled",
    cancelledAt: new Date(),
  } as any;
  user.isActive = false;
  user.onboardingCompleted = false;

  await user.save();
}

export class UserController {
  // Original pagination endpoint
  static async getAll(req: Request, res: Response) {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const search = (req.query.search as string) || "";
      const country = (req.query.country as string) || "";
      const plan = (req.query.plan as string) || "";
      const filter = (req.query.filter as string) || "";

      const skip = (page - 1) * limit;

      // Build query object
      const query: any = { role: "user" };
      query.onboardingCompleted = true;

      // Filter by country code
      if (country && country !== "all") {
        query.countryCode = country.toUpperCase();
      }

      // Filter by plan
      if (plan && plan !== "all") {
        query.plan = plan;
      }

      // Build search query
      let finalQuery = query;

      if (search) {
        const searchLower = search.toLowerCase();
        finalQuery = {
          ...query,
          $or: [
            { firstName: { $regex: searchLower, $options: "i" } },
            { lastName: { $regex: searchLower, $options: "i" } },
            { email: { $regex: searchLower, $options: "i" } },
            { phoneNumber: { $regex: searchLower, $options: "i" } },
          ],
        };
      }

      // Fetch users with applied filters
      const users = await User.find(finalQuery)
        .select(
          "_id firstName lastName email phoneNumber country countryCode plan isActive createdAt",
        )
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 })
        .lean();

      // Get total count for pagination
      const total = await User.countDocuments(finalQuery);

      return res.status(200).json({
        success: true,
        message: "Users fetched successfully",
        data: {
          users,
          pagination: {
            currentPage: page,
            totalPages: Math.ceil(total / limit),
            total,
            limit,
          },
        },
      });
    } catch (error) {
      console.error("❌ Error fetching users:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch users",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  // =======================================
  // NEW: GET ALL USERS FOR EXPORT (NO PAGINATION)
  // =======================================
  // =======================================
  // EXPORT USERS AS CSV
  // =======================================
  static async exportUsersCSV(req: Request, res: Response) {
    try {
      const search = (req.query.search as string) || "";
      const country = (req.query.country as string) || "";
      const plan = (req.query.plan as string) || "";

      // Build query object
      const query: any = { role: "user" };
      query.onboardingCompleted = true;

      // Filter by country code
      if (country && country !== "all") {
        query.countryCode = country.toUpperCase();
      }

      // Filter by plan
      if (plan && plan !== "all") {
        query.plan = plan;
      }

      // Build search query
      let finalQuery = query;

      if (search) {
        const searchLower = search.toLowerCase();
        finalQuery = {
          ...query,
          $or: [
            { firstName: { $regex: searchLower, $options: "i" } },
            { lastName: { $regex: searchLower, $options: "i" } },
            { email: { $regex: searchLower, $options: "i" } },
            { phoneNumber: { $regex: searchLower, $options: "i" } },
          ],
        };
      }

      // Fetch ALL users with applied filters
      const users = await User.find(finalQuery)
        .select(
          "_id firstName lastName email phoneNumber country countryCode plan isActive createdAt",
        )
        .sort({ createdAt: -1 })
        .lean();

      // Generate CSV
      const headers = [
        "Name",
        "Email",
        "Phone",
        "Country",
        "Plan",
        "Status",
        "Created Date",
      ];

      const rows = users.map((user: any) => {
        const name =
          `${user.firstName || ""} ${user.lastName || ""}`.trim() || "N/A";
        const email = user?.email || "N/A";
        const phone = user?.phoneNumber || "N/A";
        const country = user?.country || user?.countryCode || "N/A";
        const plan = user.plan || "N/A";
        const status = user.isActive ? "Active" : "Inactive";
        const createdDate = new Date(user.createdAt).toLocaleDateString(
          "en-US",
          {
            year: "numeric",
            month: "short",
            day: "numeric",
          },
        );

        return [name, email, phone, country, plan, status, createdDate];
      });

      // Escape CSV values
      const escapeCSV = (value: string): string => {
        const escaped = String(value).replace(/"/g, '""');
        return escaped.includes(",") ||
          escaped.includes('"') ||
          escaped.includes("\n")
          ? `"${escaped}"`
          : escaped;
      };

      const csvContent = [
        headers.join(","),
        ...rows.map((row) => row.map(escapeCSV).join(",")),
      ].join("\n");

      // Set headers for file download
      const filename = `users_${new Date().toISOString().split("T")[0]}.csv`;
      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`,
      );

      return res.status(200).send(csvContent);
    } catch (error) {
      console.error("❌ Error exporting users CSV:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to export users CSV",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  static async GetDashboardStats(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      const {region} = req?.query;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "User not authenticated",
        });
      }

      // Fetch user data
      const user = await User.findById(userId).select("plan classCredits");

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

      // Determine which service titles to filter based on plan
      let serviceTitles: string[] = [];

      if (user.plan === "gold-yoga") {
        serviceTitles = ["Yoga"];
      } else if (user.plan === "gold-zumba") {
        serviceTitles = ["Zumba Dance"];
      } else if (user.plan === "gold-mixed") {
        serviceTitles = ["Yoga", "Zumba Dance"];
      } else if (user.plan === "diamond" || user.plan === "platinum") {
        serviceTitles = ["Yoga", "Zumba Dance", "Diet & Nutrition"];
      }

      // Fetch service IDs based on titles
      const services = await Service.find({
        title: { $in: serviceTitles },
      }).select("_id");

      const serviceIds = services.map((service) => service._id);

      // 1. Count Upcoming Sessions
      const upcomingSessions = await Meeting.countDocuments({
        localTime: { $gte: oneHourAgo },
        service: { $in: serviceIds },
        ...(region ? { liveRegion: region } : {}),
      });

      // 2. Get Total Credits
      const totalCredits =
        (Number(user.classCredits?.yoga) || 0) +
        (Number(user.classCredits?.zumba) || 0) +
        (Number(user.classCredits?.specialty) || 0);

      // 3. Count Classes Attended
      const classesAttended = await MeetingAttendance.countDocuments({
        user: userId,
        status: { $in: ["joined", "completed"] },
      });

      // 4. Get Current Plan
      const planDetails = {
        plan: user.plan || "Not Selected",
        displayName: getPlanDisplayName(user.plan),
      };

      res.setHeader("Cache-Control", "no-store");

      return res.json({
        success: true,
        data: {
          upcomingSessions,
          totalCredits,
          classesAttended,
          currentPlan: planDetails,
        },
      });
    } catch (error: any) {
      console.error("Error fetching dashboard stats:", error.message);
      return res.status(500).json({
        success: false,
        message: error.message || "Error fetching dashboard statistics",
      });
    }
  }

  static async me(req: Request, res: Response) {
    try {
      const userId = req?.user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "User not authenticated",
        });
      }

      const user = await User.findById(userId).select("-password");

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      res.json({
        success: true,
        user,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: error.message || "Error fetching user profile",
      });
    }
  }

  static async changePassword(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      const { currentPassword, newPassword, confirmPassword } = req.body ?? {};

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "User not authenticated",
        });
      }

      if (!currentPassword || !newPassword) {
        return res.status(400).json({
          success: false,
          message: "Current password and new password are required",
        });
      }

      if (typeof newPassword !== "string" || newPassword.length < 8) {
        return res.status(400).json({
          success: false,
          message: "New password must be at least 8 characters",
        });
      }

      if (confirmPassword !== undefined && newPassword !== confirmPassword) {
        return res.status(400).json({
          success: false,
          message: "New password and confirm password do not match",
        });
      }

      const user = await User.findById(userId).select("+password");
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      const isMatch = await (user as any).comparePassword(currentPassword);
      if (!isMatch) {
        return res.status(400).json({
          success: false,
          message: "Current password is incorrect",
        });
      }

      (user as any).password = newPassword;
      await user.save();

      return res.status(200).json({
        success: true,
        message: "Password changed successfully",
      });
    } catch (error: any) {
      console.error("❌ Error changing password:", error);
      return res.status(500).json({
        success: false,
        message: error?.message || "Failed to change password",
      });
    }
  }

  static async updateProfile(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user?.id;
      const payload = req.body;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "User not authenticated",
        });
      }

      // Allowed fields for update
      const allowedFields = [
        "firstName",
        "lastName",
        "phone",
        "country",
        "status",
      ];

      // Filter payload to only include allowed fields
      const updateData: any = {};
      allowedFields.forEach((field) => {
        if (payload[field] !== undefined) {
          if (field === "phone") {
            // Extract phone details
            const { dialingCode, localNumber, countryCode, country } =
              extractPhoneDetails(payload.phone);

            updateData.phoneNumber = payload.phone;     
            updateData.dialingCode = dialingCode;       
            updateData.localNumber = localNumber;     
            updateData.countryCode = countryCode;     
            updateData.country = country;             
          } else {
            updateData[field] = payload[field];
          }
        }
      });

      // Prevent email from being updated
      if (payload.email) {
        updateData.email = payload.email;
      }

      // Prevent password from being updated via this endpoint
      if (payload.password) {
        return res.status(400).json({
          success: false,
          message: "Use the password reset endpoint to change password",
        });
      }

      if (Object.keys(updateData).length === 0) {
        return res.status(400).json({
          success: false,
          message: "No valid fields to update",
        });
      }

      const updatedUser = await User.findByIdAndUpdate(userId, updateData, {
        new: true,
        runValidators: true,
      }).select("-password");

      if (!updatedUser) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      res.status(200).json({
        success: true,
        message: "Profile updated successfully",
        data: updatedUser,
      });
    } catch (error: any) {
      console.error("Error updating profile:", error);
      next(error);
    }
  }

  static async updateUserStatus(req: Request, res: Response) {
    try {
      const { userId } = req.params;
      const { status } = req.body;

      // Validate status
      const allowedStatuses = ["active", "inactive", "blocked"];
      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message: "Invalid status value",
        });
      }

      // Map status → isActive (since schema uses isActive)
      const updatePayload: any = {
        isActive: status === "active",
      };

      // Optional: store blocked users logic
      if (status === "blocked") {
        updatePayload.isActive = false;
      }

      const updatedUser = await User.findByIdAndUpdate(
        userId,
        { $set: updatePayload },
        { new: true },
      ).select("-password");

      if (!updatedUser) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      return res.status(200).json({
        success: true,
        message: "User status updated successfully",
        data: updatedUser,
      });
    } catch (error: any) {
      console.error("Error updating user status:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to update user status",
      });
    }
  }

  static async deleteAccount(req: Request, res: Response) {
    try {
      const userId = req?.user?.id;
      const deletionReason =
        typeof req.body?.reason === "string" && req.body.reason.trim().length > 0
          ? req.body.reason.trim()
          : "User requested account deletion";

      if (!userId) {
        return res.status(401).json({ success: false, message: "User not authenticated" });
      }

      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ success: false, message: "User not found" });
      }

      const existingRequest = await AccountDeletionRequest.findOne({
        userId: user._id,
        status: "requested",
      })
        .sort({ requestedAt: -1 })
        .lean();

      if (existingRequest) {
        return res.status(200).json({
          success: true,
          message: "Account deletion request is already pending",
          data: existingRequest,
        });
      }

      const fullName = `${user.firstName || ""} ${user.lastName || ""}`.trim() || "User";

      const request = await AccountDeletionRequest.create({
        userId: user._id,
        email: user.email,
        fullName,
        reason: deletionReason,
        status: "requested",
        requestedAt: new Date(),
        metadata: {
          gateway: user.gateway,
          plan: user.plan || null,
        },
      });

      return res.status(200).json({
        success: true,
        message: "Account deletion request submitted successfully",
        data: request,
      });
    } catch (error: any) {
      console.error("Error deleting account:", error);
      return res.status(500).json({ success: false, message: error.message || "Failed to delete account" });
    }
  }

  static async approveDeletionRequest(req: Request, res: Response) {
    try {
      const requestId = req.params.requestId;
      const reviewedBy = req.user?.id || null;

      const request = await AccountDeletionRequest.findById(requestId);
      if (!request) {
        return res.status(404).json({ success: false, message: "Deletion request not found" });
      }

      if (request.status !== "requested") {
        return res.status(409).json({
          success: false,
          message: "Deletion request has already been reviewed",
        });
      }

      const user = await User.findById(request.userId);
      if (!user) {
        return res.status(404).json({ success: false, message: "User not found" });
      }

      const recipientName =
        [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || request.fullName;

      const gateway = String(user.gateway || request.metadata?.gateway || "").toLowerCase();

      try {
        if (gateway === "stripe" && user.stripeSubscriptionId) {
          await StripeService.cancelSubscription(user.stripeSubscriptionId);
        }

        if (gateway === "ngenius") {
          await NgeniusService.cancelRecurringSubscription(String(user._id));
        }
      } catch (error) {
        console.error("Error cancelling external subscription:", error);
      }

      await anonymizeUserAccount(user);

      const notifications = await notifyAccountDeletionDecision({
        userId: String(user._id),
        email: request.email,
        firstName: recipientName,
        decision: "approved",
      });

      const updatedRequest = await AccountDeletionRequest.findByIdAndUpdate(
        request._id,
        {
          $set: {
            status: "approved",
            processedAt: new Date(),
            reviewedAt: new Date(),
            reviewedBy,
            rejectionReason: null,
          },
        },
        { new: true },
      );

      try {
        await DeviceToken.deleteMany({ userId: user._id });
      } catch (error) {
        console.error("Error deleting device tokens after account approval:", error);
      }

      return res.status(200).json({
        success: true,
        message: "Account deletion request approved and user account removed",
        data: updatedRequest,
        notifications,
      });
    } catch (error: any) {
      console.error("Error approving deletion request:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to approve deletion request",
      });
    }
  }

  static async rejectDeletionRequest(req: Request, res: Response) {
    try {
      const requestId = req.params.requestId;
      const reviewedBy = req.user?.id || null;
      const rejectionReason =
        typeof req.body?.reason === "string" && req.body.reason.trim().length > 0
          ? req.body.reason.trim()
          : "No reason provided by admin";

      const request = await AccountDeletionRequest.findById(requestId);
      if (!request) {
        return res.status(404).json({ success: false, message: "Deletion request not found" });
      }

      if (request.status !== "requested") {
        return res.status(409).json({
          success: false,
          message: "Deletion request has already been reviewed",
        });
      }

      const updatedRequest = await AccountDeletionRequest.findByIdAndUpdate(
        request._id,
        {
          $set: {
            status: "rejected",
            processedAt: new Date(),
            reviewedAt: new Date(),
            reviewedBy,
            rejectionReason,
          },
        },
        { new: true },
      );

      const notifications = await notifyAccountDeletionRejection({
        userId: String(request.userId),
        email: request.email,
        firstName: request.fullName,
        reason: rejectionReason,
      });

      return res.status(200).json({
        success: true,
        message: "Account deletion request rejected",
        data: updatedRequest,
        notifications,
      });
    } catch (error: any) {
      console.error("Error rejecting deletion request:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to reject deletion request",
      });
    }
  }

  static async deleteDeletionRequest(req: Request, res: Response) {
    try {
      const requestId = req.params.requestId;
      const request = await AccountDeletionRequest.findById(requestId);

      if (!request) {
        return res.status(404).json({ success: false, message: "Deletion request not found" });
      }

      if (request.status !== "requested") {
        return res.status(409).json({
          success: false,
          message: "Only pending deletion requests can be deleted",
        });
      }

      await AccountDeletionRequest.findByIdAndDelete(requestId);

      return res.status(200).json({
        success: true,
        message: "Deletion request deleted successfully",
        data: request,
      });
    } catch (error: any) {
      console.error("Error deleting deletion request:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to delete deletion request",
      });
    }
  }
}

// Helper function to get display name for plans
function getPlanDisplayName(plan: string | undefined): string {
  const planMap: { [key: string]: string } = {
    "gold-yoga": "Gold Yoga",
    "gold-zumba": "Gold Zumba",
    "gold-mixed": "Gold Mixed",
    diamond: "Diamond",
    platinum: "Platinum",
  };
  return planMap[plan || ""] || "No Plan";
}
