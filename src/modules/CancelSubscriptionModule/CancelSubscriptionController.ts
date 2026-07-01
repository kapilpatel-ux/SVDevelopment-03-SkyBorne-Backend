import { Request, Response } from "express";
import CancelSubscriptionModel from "./CancelSubscriptionModel";
import User from "../UserModule/models/User"; 
import mongoose from "mongoose";
import PlanModel from "../PlanModule/models/Plan";

class CancelSubscriptionController {
  private static async resolvePlanDisplayName(planValue: string): Promise<string> {
    const rawPlan = String(planValue || "").trim();
    if (!rawPlan) return "";

    const query: any = {
      $or: [{ uuid: rawPlan }, { name: rawPlan }],
    };

    if (mongoose.Types.ObjectId.isValid(rawPlan)) {
      query.$or.push({ _id: rawPlan });
    }

    const plan = await PlanModel.findOne(query).select("name").lean();
    return String((plan as any)?.name || rawPlan).trim();
  }

  private static async hydratePlanNames(cancelSubscriptions: any[]) {
    const planValues = Array.from(
      new Set(
        cancelSubscriptions
          .map((subscription) => String(subscription?.plan || "").trim())
          .filter(Boolean),
      ),
    );

    if (!planValues.length) {
      return cancelSubscriptions;
    }

    const objectIdPlans = planValues.filter((plan) =>
      mongoose.Types.ObjectId.isValid(plan),
    );

    const plans = await PlanModel.find({
      $or: [
        { uuid: { $in: planValues } },
        { name: { $in: planValues } },
        ...(objectIdPlans.length ? [{ _id: { $in: objectIdPlans } }] : []),
      ],
    })
      .select("_id uuid name")
      .lean();

    const planNameByKey = new Map<string, string>();
    for (const plan of plans) {
      const planName = String((plan as any)?.name || "").trim();
      if (!planName) continue;

      const idKey = String((plan as any)?._id || "").trim();
      const uuidKey = String((plan as any)?.uuid || "").trim();
      const nameKey = String((plan as any)?.name || "").trim();

      if (idKey) planNameByKey.set(idKey, planName);
      if (uuidKey) planNameByKey.set(uuidKey, planName);
      if (nameKey) planNameByKey.set(nameKey, planName);
    }

    return cancelSubscriptions.map((subscription) => {
      const planKey = String(subscription?.plan || "").trim();
      if (!planKey) return subscription;

      const resolvedPlan = planNameByKey.get(planKey);
      if (!resolvedPlan) return subscription;

      return { ...subscription, plan: resolvedPlan };
    });
  }

  private static resolveUserPhone(user: any): string {
    const directPhone = String(user?.phoneNumber || "").trim();
    if (directPhone) return directPhone;

    const fallbackPhone = `${user?.dialingCode || ""}${user?.localNumber || ""}`.trim();
    return fallbackPhone;
  }

  private static resolveUserSubscribedAt(user: any): Date | null {
    const startDate = user?.subscription?.startDate;
    if (!startDate) return null;

    const parsed = new Date(startDate);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
  }

  private static async hydrateUserDetailsFromUserEmail(cancelSubscriptions: any[]) {
    const emailsToLookup = Array.from(
      new Set(
        cancelSubscriptions
          .filter((subscription) => String(subscription?.email || "").trim())
          .map((subscription) => String(subscription.email).trim().toLowerCase()),
      ),
    );

    if (!emailsToLookup.length) {
      return cancelSubscriptions;
    }

    const users = await User.find({ email: { $in: emailsToLookup } })
      .select("email phoneNumber dialingCode localNumber country subscription.startDate")
      .lean();

    const userDetailsByEmail = new Map<
      string,
      {
        phoneNumber?: string;
        country?: string;
        subscribedAt?: Date;
      }
    >();

    for (const user of users) {
      const emailKey = String((user as any)?.email || "").trim().toLowerCase();
      if (!emailKey) continue;

      const resolvedPhone = CancelSubscriptionController.resolveUserPhone(user);
      const resolvedCountry = String((user as any)?.country || "").trim();
      const resolvedSubscribedAt =
        CancelSubscriptionController.resolveUserSubscribedAt(user);

      const detail: {
        phoneNumber?: string;
        country?: string;
        subscribedAt?: Date;
      } = {};

      if (resolvedPhone) detail.phoneNumber = resolvedPhone;
      if (resolvedCountry) detail.country = resolvedCountry;
      if (resolvedSubscribedAt) detail.subscribedAt = resolvedSubscribedAt;

      if (Object.keys(detail).length) {
        userDetailsByEmail.set(emailKey, detail);
      }
    }

    return cancelSubscriptions.map((subscription) => {
      const emailKey = String(subscription?.email || "").trim().toLowerCase();
      const details = userDetailsByEmail.get(emailKey);
      if (!details) return subscription;

      const patch: any = {};

      if (!String(subscription?.phoneNumber || "").trim() && details.phoneNumber) {
        patch.phoneNumber = details.phoneNumber;
      }

      // Always use User.country when available (resolved via email).
      if (details.country) {
        patch.country = details.country;
      }

      // Always use User.subscription.startDate when available (resolved via email).
      if (details.subscribedAt) {
        patch.subscribedAt = details.subscribedAt;
      }

      if (!Object.keys(patch).length) return subscription;

      return { ...subscription, ...patch };
    });
  }

  // 1️⃣ GET: Fetch all cancel subscriptions with pagination
  static async getAll(req: Request, res: Response) {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const search = (req.query.search as string) || "";
      const filter = (req.query.filter as string) || "";

      const skip = (page - 1) * limit;

      // Build query object
      const query: any = {};

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
            { country: { $regex: searchLower, $options: "i" } },
            { userId: { $regex: searchLower, $options: "i" } },
          ],
        };
      }

      // Apply filter if needed
      if (filter === "cancelled") {
        finalQuery.status = "cancelled";
      } else if (filter === "pending") {
        finalQuery.status = "pending";
      } else if (filter === "retained") {
        finalQuery.status = "retained";
      }

      // Fetch cancel subscriptions with applied filters
      const cancelSubscriptionsRaw = await CancelSubscriptionModel.find(finalQuery)
        .select(
          "_id subscriptionId firstName lastName email phoneNumber country subscribedAt userId status description adminDescription createdAt plan cancelledAt"
        )
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 })
        .lean();

      const cancelSubscriptions =
        await CancelSubscriptionController.hydrateUserDetailsFromUserEmail(
          cancelSubscriptionsRaw,
        );
      const cancelSubscriptionsWithPlanNames =
        await CancelSubscriptionController.hydratePlanNames(cancelSubscriptions);

      // Get total count for pagination
      const total = await CancelSubscriptionModel.countDocuments(finalQuery);

      return res.status(200).json({
        success: true,
        message: "Cancel subscriptions fetched successfully",
        data: {
          cancelSubscriptions: cancelSubscriptionsWithPlanNames,
          pagination: {
            currentPage: page,
            totalPages: Math.ceil(total / limit),
            total,
            limit,
          },
        },
      });
    } catch (error) {
      console.error("❌ Error fetching cancel subscriptions:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch cancel subscriptions",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  // 2️⃣ GET: Export cancel subscriptions as CSV
  static async exportCancelSubscriptionsCSV(req: Request, res: Response) {
    try {
      const search = (req.query.search as string) || "";
      const filter = (req.query.filter as string) || "";

      const query: any = {};
      let finalQuery: any = query;

      if (search) {
        const searchLower = search.toLowerCase();
        finalQuery = {
          ...query,
          $or: [
            { firstName: { $regex: searchLower, $options: "i" } },
            { lastName: { $regex: searchLower, $options: "i" } },
            { email: { $regex: searchLower, $options: "i" } },
            { phoneNumber: { $regex: searchLower, $options: "i" } },
            { country: { $regex: searchLower, $options: "i" } },
            { userId: { $regex: searchLower, $options: "i" } },
          ],
        };
      }

      if (filter === "cancelled") {
        finalQuery.status = "cancelled";
      } else if (filter === "pending") {
        finalQuery.status = "pending";
      } else if (filter === "retained") {
        finalQuery.status = "retained";
      }

      const cancelSubscriptionsRaw = await CancelSubscriptionModel.find(finalQuery)
        .select(
          "_id subscriptionId firstName lastName email phoneNumber country subscribedAt userId status description adminDescription createdAt plan cancelledAt",
        )
        .sort({ createdAt: -1 })
        .lean();

      const cancelSubscriptions =
        await CancelSubscriptionController.hydrateUserDetailsFromUserEmail(
          cancelSubscriptionsRaw,
        );
      const cancelSubscriptionsWithPlanNames =
        await CancelSubscriptionController.hydratePlanNames(cancelSubscriptions);

      const headers = [
        "Subscription Id",
        "Name",
        "Email",
        "Phone Number",
        "Country",
        "Subscribed At",
        "User Id",
        "Plan",
        "Status",
        "Description",
        "Admin Comment",
        "Cancelled At",
        "Created At",
      ];

      const formatDate = (dateValue: any) => {
        if (!dateValue) return "N/A";

        const date = new Date(dateValue);
        if (Number.isNaN(date.getTime())) return "N/A";

        return date.toLocaleDateString("en-US", {
          year: "numeric",
          month: "short",
          day: "numeric",
        });
      };

      const formatStatus = (status: string) =>
        status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();

      const rows = cancelSubscriptionsWithPlanNames.map((subscription: any) => {
        const name =
          `${subscription.firstName || ""} ${subscription.lastName || ""}`.trim() ||
          "N/A";

        return [
          subscription.subscriptionId || "N/A",
          name,
          subscription.email || "N/A",
          subscription.phoneNumber || "N/A",
          subscription.country || "N/A",
          formatDate(subscription.subscribedAt),
          subscription.userId || "N/A",
          subscription.plan || "N/A",
          subscription.status ? formatStatus(subscription.status) : "N/A",
          subscription.description || "N/A",
          subscription.adminDescription || "N/A",
          formatDate(subscription.cancelledAt),
          formatDate(subscription.createdAt),
        ];
      });

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

      const filename = `cancel_subscriptions_${new Date().toISOString().split("T")[0]}.csv`;
      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`,
      );

      return res.status(200).send(csvContent);
    } catch (error) {
      console.error("❌ Error exporting cancel subscriptions CSV:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to export cancel subscriptions CSV",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  // 3️⃣ POST: Create a new cancel subscription request
  static async create(req: Request, res: Response) {
    try {
      const { userId, description } = req.body;

      // Validate required fields
      if (!userId || !description) {
        return res.status(400).json({
          success: false,
          message: "userId and description are required",
        });
      }

      // Find user by userId
      const user = await User.findById(userId).select(
        "_id firstName lastName email phoneNumber dialingCode localNumber stripeSubscriptionId plan country subscription.startDate"
      );

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // Check if subscription already exists for this user
      const existingCancellation = await CancelSubscriptionModel.findOne({
        userId,
        status: "pending",
      });

      if (existingCancellation) {
        return res.status(400).json({
          success: false,
          message: "Cancel subscription request already exists for this user",
        });
      }

      // Generate subscriptionId (can be customized as per your needs)
      const subscriptionId = user.stripeSubscriptionId || null;
      const fallbackPhone = `${(user as any)?.dialingCode || ""}${(user as any)?.localNumber || ""}`.trim();
      const phoneNumber = (user as any)?.phoneNumber || fallbackPhone || "";
      const country = String((user as any)?.country || "").trim();
      const subscribedAt =
        CancelSubscriptionController.resolveUserSubscribedAt(user);
      const resolvedPlanName =
        await CancelSubscriptionController.resolvePlanDisplayName(
          String((user as any)?.plan || ""),
        );

      // Create new cancel subscription record
      const newCancelSubscription = await CancelSubscriptionModel.create({
        subscriptionId,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phoneNumber,
        country,
        subscribedAt,
        userId,
        plan: resolvedPlanName || String((user as any)?.plan || ""),
        description: description || "",
        status: "pending",
      });

      return res.status(201).json({
        success: true,
        message: "Cancel subscription request created successfully",
        data: newCancelSubscription,
      });
    } catch (error) {
      console.error("❌ Error creating cancel subscription:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to create cancel subscription request",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
}

export default CancelSubscriptionController;
