import { Request, Response } from "express";
import DeviceToken from "./models/DeviceToken";
import { PushNotificationService } from "../../services/pushNotification.service";

export default class NotificationController {
  static async registerDeviceToken(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.id;
      const { token, platform, deviceId, optInBroadcast } = req.body || {};

      console.log("[NotificationController] registerDeviceToken:start", {
        userIdPrefix: String(userId).slice(0, 8),
        tokenPrefix: String(token).slice(0, 24),
        platform,
      });

      if (!userId) {
        console.error("[NotificationController] registerDeviceToken:no-user");
        return res.status(401).json({ success: false, message: "User not authenticated" });
      }

      if (!token || !platform) {
        console.error("[NotificationController] registerDeviceToken:missing-params", {
          hasToken: !!token,
          hasPlatform: !!platform,
        });
        return res.status(400).json({
          success: false,
          message: "token and platform are required",
        });
      }

      if (!["ios", "android", "web"].includes(String(platform))) {
        console.error("[NotificationController] registerDeviceToken:invalid-platform", {
          platform,
        });
        return res.status(400).json({
          success: false,
          message: "platform must be ios, android, or web",
        });
      }

      const savedToken = await DeviceToken.findOneAndUpdate(
        { token: String(token).trim() },
        {
          $set: {
            userId,
            platform,
            deviceId: deviceId || null,
            isActive: true,
            lastSeenAt: new Date(),
            optInBroadcast:
              typeof optInBroadcast === "boolean" ? optInBroadcast : true,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );

      console.log("[NotificationController] registerDeviceToken:saved", {
        userIdPrefix: String(savedToken?.userId).slice(0, 8),
        tokenPrefix: String(savedToken?.token).slice(0, 24),
        platform: savedToken?.platform,
        isActive: savedToken?.isActive,
      });

      return res.status(200).json({
        success: true,
        message: "Device token registered successfully",
      });
    } catch (error: any) {
      console.error("[NotificationController] registerDeviceToken:error", {
        message: error?.message,
        stack: error?.stack?.slice(0, 200),
      });
      return res.status(500).json({
        success: false,
        message: error?.message || "Failed to register device token",
      });
    }
  }

  static async unregisterDeviceToken(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.id;
      const { token } = req.body || {};

      if (!userId) {
        return res.status(401).json({ success: false, message: "User not authenticated" });
      }

      if (!token) {
        return res.status(400).json({
          success: false,
          message: "token is required",
        });
      }

      await DeviceToken.updateOne(
        { userId, token: String(token).trim() },
        {
          $set: {
            isActive: false,
            lastSeenAt: new Date(),
          },
        },
      );

      return res.status(200).json({
        success: true,
        message: "Device token unregistered successfully",
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: error?.message || "Failed to unregister device token",
      });
    }
  }

  static async updateNotificationPreferences(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.id;
      const { optInBroadcast } = req.body || {};

      if (!userId) {
        return res.status(401).json({ success: false, message: "User not authenticated" });
      }

      if (typeof optInBroadcast !== "boolean") {
        return res.status(400).json({
          success: false,
          message: "optInBroadcast must be boolean",
        });
      }

      const result = await DeviceToken.updateMany(
        { userId, isActive: true },
        {
          $set: {
            optInBroadcast,
            lastSeenAt: new Date(),
          },
        },
      );

      return res.status(200).json({
        success: true,
        message: "Notification preferences updated",
        data: { updatedTokens: result.modifiedCount },
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: error?.message || "Failed to update preferences",
      });
    }
  }

  /**
   * Debug endpoint: Check what device tokens exist for the current user
   */
  static async debugGetMyTokens(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.id;

      if (!userId) {
        return res.status(401).json({ success: false, message: "User not authenticated" });
      }

      const tokens = await DeviceToken.find(
        { userId },
        { token: 1, platform: 1, isActive: 1, deviceId: 1, lastSeenAt: 1 },
      ).lean();

      console.log("[NotificationController] debugGetMyTokens", {
        userIdPrefix: String(userId).slice(0, 8),
        tokenCount: tokens.length,
        tokens: tokens.map((t) => ({
          tokenPrefix: String(t.token).slice(0, 24),
          platform: t.platform,
          isActive: t.isActive,
          lastSeenAt: t.lastSeenAt,
        })),
      });

      return res.status(200).json({
        success: true,
        data: {
          tokenCount: tokens.length,
          tokens: tokens.map((t) => ({
            tokenPrefix: String(t.token).slice(0, 24),
            platform: t.platform,
            isActive: t.isActive,
            lastSeenAt: t.lastSeenAt,
          })),
        },
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: error?.message || "Failed to fetch tokens",
      });
    }
  }

  static async sendAdminBroadcast(req: Request, res: Response) {
    try {
      const { title, body, data } = req.body || {};

      if (!title || !body) {
        return res.status(400).json({
          success: false,
          message: "title and body are required",
        });
      }

      const result = await PushNotificationService.sendBroadcastOptIn({
        title: String(title),
        body: String(body),
        data: data && typeof data === "object" ? data : undefined,
        highPriority: false,
      });

      const responseMessage =
        result.reason === "fcm_not_configured"
          ? "Broadcast request received, but FCM is not configured on backend"
          : result.reason === "no_tokens"
            ? "Broadcast request received, but no active opted-in device tokens were found"
            : "Broadcast push notification dispatched";

      return res.status(200).json({
        success: true,
        message: responseMessage,
        data: result,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: error?.message || "Failed to send broadcast",
      });
    }
  }

  static async sendTestNotification(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.id;
      const { title, body, data } = req.body || {};

      if (!userId) {
        return res.status(401).json({ success: false, message: "User not authenticated" });
      }

      // Use defaults if not provided
      const notificationTitle = title || "Test Notification";
      const notificationBody = body || "🎉 This is a test push notification from SkyBorne";
      const notificationData = {
        type: "test",
        timestamp: new Date().toISOString(),
        ...(data && typeof data === "object" ? data : {}),
      };

      // Get active device tokens for user
      const deviceTokens = await DeviceToken.find({ userId, isActive: true });

      if (deviceTokens.length === 0) {
        return res.status(400).json({
          success: false,
          message: "No active device tokens registered. Please register a device first.",
        });
      }

      // Send test notification to all user's devices
      const result = await PushNotificationService.sendToUser(userId, {
        title: String(notificationTitle),
        body: String(notificationBody),
        data: notificationData,
      });

      return res.status(200).json({
        success: true,
        message: "Test push notification sent successfully",
        data: {
          deviceCount: deviceTokens.length,
          successCount: result.successCount || 0,
          failureCount: result.failureCount || 0,
          details: result,
        },
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: error?.message || "Failed to send test notification",
      });
    }
  }
}
