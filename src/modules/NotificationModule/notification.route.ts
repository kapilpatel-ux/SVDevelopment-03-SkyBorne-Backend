import NotificationController from "./notification.controller";

export const NotificationRoute = [
  {
    path: "/notifications/device-token/register",
    request: null,
    action: NotificationController.registerDeviceToken,
    method: "post",
  },
  {
    path: "/notifications/device-token/unregister",
    request: null,
    action: NotificationController.unregisterDeviceToken,
    method: "post",
  },
  {
    path: "/notifications/preferences",
    request: null,
    action: NotificationController.updateNotificationPreferences,
    method: "patch",
  },
  {
    path: "/notifications/debug/my-tokens",
    request: null,
    action: NotificationController.debugGetMyTokens,
    method: "get",
  },
  {
    path: "/notifications/admin/broadcast",
    request: null,
    action: NotificationController.sendAdminBroadcast,
    method: "post",
    roles: ["admin"],
  },
  {
    path: "/notifications/test",
    request: null,
    action: NotificationController.sendTestNotification,
    method: "post",
  },
];
