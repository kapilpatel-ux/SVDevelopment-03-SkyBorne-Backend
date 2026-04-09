import admin from "firebase-admin";
import fs from "fs";
import path from "path";
import DeviceToken from "../modules/NotificationModule/models/DeviceToken";
import PushNotificationLog from "../modules/NotificationModule/models/PushNotificationLog";
import MeetingAttendance from "../modules/MeetingModule/MeetingModels/MeetingAttendance";
import MeetingParticipant from "../modules/MeetingModule/MeetingModels/MeetingParticipant";
import regionModel from "../modules/RegionModule/region.model";
import countryModel from "../modules/CountryModule/country.model";
import User from "../modules/UserModule/models/User";

type PushPayload = {
  title: string;
  body: string;
  data?: Record<string, string>;
  highPriority?: boolean;
};

export class PushNotificationService {
  private static firebaseReady = false;
  private static firebaseEnabled = false;

  private static initializeFirebase() {
    if (this.firebaseReady) return;
    this.firebaseReady = true;

    try {
      if (admin.apps.length) {
        this.firebaseEnabled = true;
        return;
      }

      const serviceAccountJson = process.env.FCM_SERVICE_ACCOUNT_JSON;
      const serviceAccountPath = process.env.FCM_SERVICE_ACCOUNT_PATH;

      if (serviceAccountJson) {
        const credentials = JSON.parse(serviceAccountJson);
        console.log("🔐 [PushNotificationService] firebase:init", {
          source: "FCM_SERVICE_ACCOUNT_JSON",
          projectId: credentials?.project_id,
          keyId: credentials?.private_key_id,
          clientEmail: credentials?.client_email,
        });
        admin.initializeApp({
          credential: admin.credential.cert(credentials),
        });
        this.firebaseEnabled = true;
        return;
      }

      if (serviceAccountPath && fs.existsSync(serviceAccountPath)) {
        const raw = fs.readFileSync(serviceAccountPath, "utf8");
        const credentials = JSON.parse(raw);
        console.log("🔐 [PushNotificationService] firebase:init", {
          source: "FCM_SERVICE_ACCOUNT_PATH",
          path: serviceAccountPath,
          projectId: credentials?.project_id,
          keyId: credentials?.private_key_id,
          clientEmail: credentials?.client_email,
        });
        admin.initializeApp({
          credential: admin.credential.cert(credentials),
        });
        this.firebaseEnabled = true;
        return;
      }

      if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        admin.initializeApp({
          credential: admin.credential.applicationDefault(),
        });
        this.firebaseEnabled = true;
        return;
      }

      const defaultServiceAccountPath = path.resolve(process.cwd(), "firebase-service-account.json");
      if (fs.existsSync(defaultServiceAccountPath)) {
        const raw = fs.readFileSync(defaultServiceAccountPath, "utf8");
        const credentials = JSON.parse(raw);
        console.log("🔐 [PushNotificationService] firebase:init", {
          source: "firebase-service-account.json",
          path: defaultServiceAccountPath,
          projectId: credentials?.project_id,
          keyId: credentials?.private_key_id,
          clientEmail: credentials?.client_email,
        });
        admin.initializeApp({
          credential: admin.credential.cert(credentials),
        });
        this.firebaseEnabled = true;
        return;
      }

      console.warn(
        "⚠️ FCM not configured. Set FCM_SERVICE_ACCOUNT_JSON or FCM_SERVICE_ACCOUNT_PATH or GOOGLE_APPLICATION_CREDENTIALS",
      );
    } catch (error) {
      console.error("❌ Failed to initialize Firebase Admin SDK:", error);
      this.firebaseEnabled = false;
    }
  }

  private static normalizeData(data?: Record<string, any>) {
    if (!data) return undefined;

    const normalized: Record<string, string> = {};
    for (const [key, value] of Object.entries(data)) {
      normalized[key] = typeof value === "string" ? value : JSON.stringify(value);
    }

    return normalized;
  }

  private static async sendMulticast(tokens: string[], payload: PushPayload) {
    this.initializeFirebase();

    console.log("🔔 [PushNotificationService] dispatch:start", {
      title: payload.title,
      highPriority: Boolean(payload.highPriority),
      tokenCount: tokens.length,
    });

    if (!this.firebaseEnabled) {
      console.warn("⚠️ [PushNotificationService] dispatch:skipped - FCM not configured", {
        title: payload.title,
        tokenCount: tokens.length,
      });
      return {
        successCount: 0,
        failureCount: 0,
        invalidTokens: [] as string[],
        reason: "fcm_not_configured",
      };
    }

    if (tokens.length === 0) {
      console.warn("⚠️ [PushNotificationService] dispatch:skipped - no device tokens", {
        title: payload.title,
      });
      return {
        successCount: 0,
        failureCount: 0,
        invalidTokens: [] as string[],
        reason: "no_tokens",
      };
    }

    const message: admin.messaging.MulticastMessage = {
      tokens,
      notification: {
        title: payload.title,
        body: payload.body,
      },
      data: this.normalizeData(payload.data),
      android: {
        priority: payload.highPriority ? "high" : "normal",
      },
      apns: {
        headers: {
          "apns-priority": payload.highPriority ? "10" : "5",
        },
      },
    };

    const response = await admin.messaging().sendEachForMulticast(message);
    const invalidTokens: string[] = [];
    const errorCodeSummary: Record<string, number> = {};
    const failureSamples: Array<{ tokenPrefix: string; code: string; message: string }> = [];

    response.responses.forEach((item, index) => {
      if (!item.success) {
        const code = item.error?.code || "";
        const message = item.error?.message || "";
        const normalizedCode = code || "unknown";

        errorCodeSummary[normalizedCode] = (errorCodeSummary[normalizedCode] || 0) + 1;

        if (failureSamples.length < 5) {
          failureSamples.push({
            tokenPrefix: String(tokens[index] || "").slice(0, 24),
            code: normalizedCode,
            message,
          });
        }

        if (
          code === "messaging/registration-token-not-registered" ||
          code === "messaging/invalid-registration-token"
        ) {
          invalidTokens.push(tokens[index]);
        }
      }
    });

    console.log("✅ [PushNotificationService] dispatch:done", {
      title: payload.title,
      tokenCount: tokens.length,
      successCount: response.successCount,
      failureCount: response.failureCount,
      invalidTokenCount: invalidTokens.length,
      errorCodeSummary,
    });

    if (response.failureCount > 0) {
      console.warn("⚠️ [PushNotificationService] dispatch:failure-details", {
        title: payload.title,
        errorCodeSummary,
        failureSamples,
      });
    }

    return {
      successCount: response.successCount,
      failureCount: response.failureCount,
      invalidTokens,
      errorCodeSummary,
      failureSamples,
      reason: "sent",
    };
  }

  static async sendToUser(
    userId: string,
    payload: PushPayload,
    options?: {
      category?: "transactional" | "reminder" | "lifecycle" | "broadcast" | "security";
      eventType?: string;
      dedupeKey?: string;
      metadata?: Record<string, any>;
    },
  ) {
    if (options?.dedupeKey) {
      const existing = await PushNotificationLog.findOne({ dedupeKey: options.dedupeKey })
        .select("_id")
        .lean();

      if (existing) {
        return { skipped: true, reason: "duplicate", successCount: 0, failureCount: 0 };
      }
    }

    const tokenDocs = await DeviceToken.find({ userId, isActive: true }).select("token");
    const tokens = tokenDocs.map((item) => item.token).filter(Boolean);

    console.log("🔔 [PushNotificationService] sendToUser", {
      userId,
      title: payload.title,
      tokenCount: tokens.length,
      category: options?.category || "transactional",
      eventType: options?.eventType || "push.single",
    });

    const result = await this.sendMulticast(tokens, payload);

    if (result.invalidTokens.length > 0) {
      await DeviceToken.updateMany(
        { token: { $in: result.invalidTokens } },
        { $set: { isActive: false, lastSeenAt: new Date() } },
      );
    }

    await PushNotificationLog.create({
      userId,
      eventType: options?.eventType || "push.single",
      category: options?.category || "transactional",
      title: payload.title,
      body: payload.body,
      tokenCount: tokens.length,
      successCount: result.successCount,
      failureCount: result.failureCount,
      dedupeKey: options?.dedupeKey,
      metadata: options?.metadata || null,
      sentAt: new Date(),
    });

    console.log("✅ [PushNotificationService] sendToUser:logged", {
      userId,
      title: payload.title,
      successCount: result.successCount,
      failureCount: result.failureCount,
      reason: (result as any).reason || "sent",
    });

    return result;
  }

  static async sendToUsers(
    userIds: string[],
    payload: PushPayload,
    options?: {
      category?: "transactional" | "reminder" | "lifecycle" | "broadcast" | "security";
      eventType?: string;
      metadata?: Record<string, any>;
    },
  ) {
    if (!userIds.length) {
      return { successCount: 0, failureCount: 0, invalidTokens: [] as string[] };
    }

    const tokenDocs = await DeviceToken.find({
      userId: { $in: userIds },
      isActive: true,
    }).select("token userId");

    const tokens = tokenDocs.map((item) => item.token).filter(Boolean);
    const usersWithTokens = new Set(tokenDocs.map((doc) => String(doc.userId)));
    const usersWithoutTokens = userIds.filter((id) => !usersWithTokens.has(id));

    console.log("🔔 [PushNotificationService] sendToUsers", {
      userCount: userIds.length,
      title: payload.title,
      tokenCount: tokens.length,
      usersWithTokens: usersWithTokens.size,
      usersWithoutTokens: usersWithoutTokens.length,
      category: options?.category || "transactional",
      eventType: options?.eventType || "push.bulk",
    });

    if (usersWithoutTokens.length > 0) {
      console.warn(
        "⚠️ [PushNotificationService] Users without device tokens (may not have app installed):",
        { userCount: usersWithoutTokens.length },
      );
    }

    const result = await this.sendMulticast(tokens, payload);

    if (result.invalidTokens.length > 0) {
      await DeviceToken.updateMany(
        { token: { $in: result.invalidTokens } },
        { $set: { isActive: false, lastSeenAt: new Date() } },
      );
    }

    await PushNotificationLog.create({
      eventType: options?.eventType || "push.bulk",
      category: options?.category || "transactional",
      title: payload.title,
      body: payload.body,
      tokenCount: tokens.length,
      successCount: result.successCount,
      failureCount: result.failureCount,
      metadata: options?.metadata || null,
      sentAt: new Date(),
    });

    console.log("✅ [PushNotificationService] sendToUsers:logged", {
      userCount: userIds.length,
      title: payload.title,
      successCount: result.successCount,
      failureCount: result.failureCount,
      reason: (result as any).reason || "sent",
    });

    return result;
  }

  private static async resolveUserIdsByRegion(regionName: string): Promise<string[]> {
    const regionDoc = await regionModel.findOne({ name: regionName }).select("_id");
    if (!regionDoc) return [];

    const countries = await countryModel
      .find({ region: regionDoc._id, status: "active" })
      .select("code")
      .lean();

    const countryCodes = countries
      .map((item: any) => String(item?.code || "").trim())
      .filter(Boolean);

    if (!countryCodes.length) return [];

    const users = await User.find({
      countryCode: { $in: countryCodes },
      isActive: true,
      isEmailVerified: true,
      "subscription.status": "active",
    })
      .select("_id")
      .lean();

    return users.map((item: any) => String(item._id));
  }

  private static async resolveUserIdsByMeeting(meetingId: string): Promise<string[]> {
    const [participantIds, attendanceIds] = await Promise.all([
      MeetingParticipant.distinct("userId", { meetingId }),
      MeetingAttendance.distinct("user", {
        meeting: meetingId,
        status: { $in: ["registered", "joined", "completed"] },
      }),
    ]);

    return Array.from(
      new Set(
        [...participantIds, ...attendanceIds]
          .map((id) => String(id || "").trim())
          .filter(Boolean),
      ),
    );
  }

  static async sendMeetingLifecycleToRegion(params: {
    action: "created" | "rescheduled" | "cancelled";
    meetingId: string;
    meetingTitle: string;
    region: string;
    localTime?: Date;
  }) {
    const userIds = await this.resolveUserIdsByRegion(params.region);

    const titleMap = {
      created: "Meeting scheduled",
      rescheduled: "Meeting updated",
      cancelled: "Meeting cancelled",
    };

    const bodyMap = {
      created: `${params.meetingTitle} has been scheduled for your region (${params.region}).`,
      rescheduled: `${params.meetingTitle} has been rescheduled for your region (${params.region}).`,
      cancelled: `${params.meetingTitle} has been cancelled for your region (${params.region}).`,
    };

    return this.sendToUsers(
      userIds,
      {
        title: titleMap[params.action],
        body: bodyMap[params.action],
        highPriority: true,
        data: {
          type: "meeting.lifecycle",
          action: params.action,
          meetingId: params.meetingId,
          region: params.region,
          localTime: params.localTime ? params.localTime.toISOString() : "",
        },
      },
      {
        category: "transactional",
        eventType: `meeting.${params.action}`,
        metadata: params,
      },
    );
  }

  static async sendMeetingLifecycleToParticipants(params: {
    action: "created" | "rescheduled" | "cancelled";
    meetingId: string;
    meetingTitle: string;
    localTime?: Date;
  }) {
    const userIds = await this.resolveUserIdsByMeeting(params.meetingId);

    const titleMap = {
      created: "Class scheduled",
      rescheduled: "Class updated",
      cancelled: "Class cancelled",
    };

    const bodyMap = {
      created: `${params.meetingTitle} has been scheduled.`,
      rescheduled: `${params.meetingTitle} has been updated.`,
      cancelled: `${params.meetingTitle} has been cancelled.`,
    };

    if (!userIds.length) {
      return {
        successCount: 0,
        failureCount: 0,
        invalidTokens: [],
        skipped: true,
        reason: "no_participants",
      };
    }

    return this.sendToUsers(
      userIds,
      {
        title: titleMap[params.action],
        body: bodyMap[params.action],
        highPriority: true,
        data: {
          type: "meeting.lifecycle",
          action: params.action,
          meetingId: params.meetingId,
          localTime: params.localTime ? params.localTime.toISOString() : "",
        },
      },
      {
        category: "transactional",
        eventType: `meeting.${params.action}`,
        metadata: params,
      },
    );
  }

  static async sendSessionReminderToUsers(
    userIds: string[],
    params: {
      meetingId: string;
      meetingTitle: string;
      minutesBefore: number;
      classStartAt: Date;
      region: string;
    },
  ) {
    console.log("📨 [PushNotificationService] sendSessionReminderToUsers:start", {
      meetingId: params.meetingId,
      userCount: userIds.length,
      meetingTitle: params.meetingTitle,
      region: params.region,
    });

    const result = await this.sendToUsers(
      userIds,
      {
        title: "Upcoming session reminder",
        body: `${params.meetingTitle} starts in ${params.minutesBefore} minutes.`,
        highPriority: true,
        data: {
          type: "meeting.reminder",
          screen: "ClassDetails",
          classId: params.meetingId,
          deeplink: `skybornedrop://class/${params.meetingId}`,
          meetingId: params.meetingId,
          minutesBefore: String(params.minutesBefore),
          classStartAt: params.classStartAt.toISOString(),
          region: params.region,
        },
      },
      {
        category: "reminder",
        eventType: "meeting.reminder",
        metadata: params,
      },
    );

    console.log("📨 [PushNotificationService] sendSessionReminderToUsers:done", {
      meetingId: params.meetingId,
      successCount: result.successCount,
      failureCount: result.failureCount,
    });

    return result;
  }

  static async sendSessionReminderToParticipants(
    meetingId: string,
    params: {
      meetingTitle: string;
      minutesBefore: number;
      classStartAt: Date;
      region?: string;
    },
  ) {
    const userIds = await this.resolveUserIdsByMeeting(meetingId);

    if (!userIds.length) {
      return {
        successCount: 0,
        failureCount: 0,
        invalidTokens: [],
        skipped: true,
        reason: "no_participants",
      };
    }

    return this.sendToUsers(
      userIds,
      {
        title: "Upcoming session reminder",
        body: `${params.meetingTitle} starts in ${params.minutesBefore} minutes.`,
        highPriority: true,
        data: {
          type: "meeting.reminder",
          screen: "ClassDetails",
          classId: meetingId,
          deeplink: `skybornedrop://class/${meetingId}`,
          meetingId,
          minutesBefore: String(params.minutesBefore),
          classStartAt: params.classStartAt.toISOString(),
          region: params.region || "",
        },
      },
      {
        category: "reminder",
        eventType: "meeting.reminder",
        metadata: { meetingId, ...params },
      },
    );
  }

  static async sendSubscriptionExpiryReminder(
    userId: string,
    daysLeft: number,
    endDate: Date,
    dedupeKey: string,
  ) {
    return this.sendToUser(
      userId,
      {
        title: "Subscription expiring soon",
        body: `Your subscription expires in ${daysLeft} day${daysLeft > 1 ? "s" : ""}.`,
        highPriority: false,
        data: {
          type: "subscription.expiry",
          daysLeft: String(daysLeft),
          endDate: endDate.toISOString(),
        },
      },
      {
        category: "lifecycle",
        eventType: "subscription.expiry_reminder",
        dedupeKey,
        metadata: { daysLeft, endDate },
      },
    );
  }

  static async sendWelcome(userId: string, firstName?: string) {
    return this.sendToUser(
      userId,
      {
        title: "Welcome to Skyborne",
        body: `Hi ${firstName || "there"}, your account is ready.`,
        highPriority: true,
        data: { type: "account.welcome" },
      },
      {
        category: "lifecycle",
        eventType: "account.welcome",
      },
    );
  }

  static async sendPasswordResetRequested(userId: string) {
    return this.sendToUser(
      userId,
      {
        title: "Password reset requested",
        body: "We received a request to reset your password.",
        highPriority: true,
        data: { type: "security.password_reset_requested" },
      },
      {
        category: "security",
        eventType: "security.password_reset_requested",
      },
    );
  }

  static async sendPasswordChanged(userId: string) {
    return this.sendToUser(
      userId,
      {
        title: "Password updated",
        body: "Your account password was changed successfully.",
        highPriority: true,
        data: { type: "security.password_changed" },
      },
      {
        category: "security",
        eventType: "security.password_changed",
      },
    );
  }

  static async sendPaymentStatus(
    userId: string,
    params: {
      success: boolean;
      amount?: number;
      currency?: string;
      plan?: string;
      invoiceId?: string;
    },
  ) {
    const statusText = params.success ? "successful" : "failed";

    return this.sendToUser(
      userId,
      {
        title: params.success ? "Payment successful" : "Payment failed",
        body: `Your payment was ${statusText}${params.plan ? ` for ${params.plan}` : ""}.`,
        highPriority: true,
        data: {
          type: "payment.status",
          status: params.success ? "success" : "failed",
          amount: String(params.amount || ""),
          currency: params.currency || "",
          plan: params.plan || "",
          invoiceId: params.invoiceId || "",
        },
      },
      {
        category: "transactional",
        eventType: params.success ? "payment.success" : "payment.failed",
        metadata: params,
      },
    );
  }

  static async sendPlanChanged(userId: string, fromPlan: string, toPlan: string) {
    return this.sendToUser(
      userId,
      {
        title: "Plan updated",
        body: `Your plan has changed from ${fromPlan} to ${toPlan}.`,
        highPriority: true,
        data: {
          type: "plan.changed",
          fromPlan,
          toPlan,
        },
      },
      {
        category: "lifecycle",
        eventType: "plan.changed",
        metadata: { fromPlan, toPlan },
      },
    );
  }

  static async sendBookingConfirmed(
    userId: string,
    params: { meetingId: string; meetingTitle: string; localTime?: Date },
  ) {
    return this.sendToUser(
      userId,
      {
        title: "Booking confirmed",
        body: `Your booking for ${params.meetingTitle} is confirmed.`,
        highPriority: true,
        data: {
          type: "booking.confirmed",
          screen: "ClassDetails",
          classId: params.meetingId,
          deeplink: `skybornedrop://class/${params.meetingId}`,
          meetingId: params.meetingId,
          localTime: params.localTime ? params.localTime.toISOString() : "",
        },
      },
      {
        category: "transactional",
        eventType: "booking.confirmed",
        metadata: params,
      },
    );
  }

  static async sendBookingCancelled(
    userId: string,
    params: { meetingId: string; meetingTitle: string; localTime?: Date },
  ) {
    return this.sendToUser(
      userId,
      {
        title: "Booking cancelled",
        body: `Your booking for ${params.meetingTitle} was cancelled.`,
        highPriority: true,
        data: {
          type: "booking.cancelled",
          screen: "ClassDetails",
          classId: params.meetingId,
          deeplink: `skybornedrop://class/${params.meetingId}`,
          meetingId: params.meetingId,
          localTime: params.localTime ? params.localTime.toISOString() : "",
        },
      },
      {
        category: "transactional",
        eventType: "booking.cancelled",
        metadata: params,
      },
    );
  }

  static async sendBroadcastOptIn(payload: PushPayload) {
    const tokenDocs = await DeviceToken.find({ isActive: true, optInBroadcast: true }).select(
      "token",
    );
    const tokens = tokenDocs.map((item) => item.token).filter(Boolean);
    const result = await this.sendMulticast(tokens, payload);

    if (result.invalidTokens.length > 0) {
      await DeviceToken.updateMany(
        { token: { $in: result.invalidTokens } },
        { $set: { isActive: false, lastSeenAt: new Date() } },
      );
    }

    await PushNotificationLog.create({
      eventType: "broadcast.admin",
      category: "broadcast",
      title: payload.title,
      body: payload.body,
      tokenCount: tokens.length,
      successCount: result.successCount,
      failureCount: result.failureCount,
      metadata: payload.data || null,
      sentAt: new Date(),
    });

    return {
      ...result,
      tokenCount: tokens.length,
    };
  }
}
