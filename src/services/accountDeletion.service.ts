import sgMail from "@sendgrid/mail";
import { PushNotificationService } from "./pushNotification.service";
import User from "../modules/UserModule/models/User";

export type AccountDeletionDecision = "approved" | "rejected";

export interface AccountDeletionNotificationParams {
  userId: string;
  email: string;
  firstName?: string;
  decision: AccountDeletionDecision;
  reason?: string;
}

export interface AccountDeletionNotificationResult {
  pushSent: boolean;
  emailSent: boolean;
  pushError?: string;
  emailError?: string;
}

const getSupportUrl = () =>
  process.env.DASHBOARD_URL || process.env.FRONTEND_URL || process.env.WEBSITE_URL || "https://skybornedrop.com";

const getDisplayName = (firstName?: string) => firstName?.trim() || "Member";

const buildEmailHtml = (
  decision: AccountDeletionDecision,
  firstName?: string,
  reason?: string,
) => {
  const title = decision === "approved" ? "Account deleted" : "Deletion request rejected";
  const accent = decision === "approved" ? "#b54767" : "#d97706";
  const bodyCopy =
    decision === "approved"
      ? "Your SkyBorne account has been deleted after admin approval. You will be signed out on your next app request."
      : "Your SkyBorne account deletion request was rejected by the admin team. Your account remains active.";

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    body { margin: 0; padding: 0; background: #f5f5f5; font-family: Arial, sans-serif; color: #333; }
    .container { max-width: 600px; margin: 0 auto; background: #fff; }
    .header { background: linear-gradient(135deg, ${accent} 0%, #d97fa0 100%); color: #fff; padding: 28px; text-align: center; }
    .content { padding: 28px; line-height: 1.6; }
    .notice { background: #fafafa; border: 1px solid #eee; border-radius: 8px; padding: 16px; margin: 18px 0; }
    .reason { background: #fff8f0; border: 1px solid #fed7aa; border-radius: 8px; padding: 16px; margin: 18px 0; }
    .cta { display: inline-block; margin-top: 18px; background: ${accent}; color: #fff !important; text-decoration: none; padding: 12px 20px; border-radius: 6px; font-weight: 600; }
    .footer { border-top: 1px solid #eee; padding: 16px 28px; color: #888; font-size: 12px; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2 style="margin: 0;">${title}</h2>
      <p style="margin: 8px 0 0;">SkyBorne account update</p>
    </div>

    <div class="content">
      <p>Hi <strong>${getDisplayName(firstName)}</strong>,</p>
      <p>${bodyCopy}</p>

      ${reason ? `<div class="reason"><strong>Admin note:</strong><br />${reason}</div>` : ""}

      <div class="notice">
        ${decision === "approved"
          ? "If you still see your account in the app, refresh the session or reopen the app to clear cached access."
          : `You can continue using your account. If you need another review, please contact support.`}
      </div>

      <a href="${getSupportUrl()}" class="cta">Open SkyBorne</a>
    </div>

    <div class="footer">
      <p style="margin: 0;">You received this email because your account is registered with SkyBorne.</p>
    </div>
  </div>
</body>
</html>
  `;
};

const sendDeletionEmail = async (
  params: AccountDeletionNotificationParams,
): Promise<{ sent: boolean; error?: string }> => {
  const apiKey = process.env.SENDGRID_API_KEY || "";
  const fromEmail = process.env.SENDGRID_FROM_EMAIL;

  if (!apiKey || !apiKey.startsWith("SG.") || !fromEmail) {
    return {
      sent: false,
      error: "SendGrid is not configured",
    };
  }

  try {
    sgMail.setApiKey(apiKey);

    const recipientUser = await User.findById(params.userId).select("email firstName lastName").lean();
    const recipientEmail = String(recipientUser?.email || params.email || "").trim();

    if (!recipientEmail) {
      return {
        sent: false,
        error: "Recipient email not found",
      };
    }

    const recipientName =
      [recipientUser?.firstName, recipientUser?.lastName].filter(Boolean).join(" ").trim() ||
      params.firstName;

    const subject =
      params.decision === "approved"
        ? "Your SkyBorne account has been deleted"
        : "Your SkyBorne account deletion request was rejected";

    await sgMail.send({
      to: recipientEmail,
      from: fromEmail,
      subject,
      personalizations: [
        {
          to: [{ email: recipientEmail, name: recipientName || undefined }],
          subject,
        },
      ],
      html: buildEmailHtml(params.decision, recipientName, params.reason),
    });

    return { sent: true };
  } catch (error: any) {
    return {
      sent: false,
      error: error?.message || "Failed to send account deletion email",
    };
  }
};

export const notifyAccountDeletionDecision = async (
  params: AccountDeletionNotificationParams,
): Promise<AccountDeletionNotificationResult> => {
  const pushPayload =
    params.decision === "approved"
      ? {
          title: "Account deleted",
          body: "Your SkyBorne account was approved for deletion. Please sign in again if you still see this profile.",
        }
      : {
          title: "Deletion request rejected",
          body: params.reason
            ? `Your deletion request was rejected: ${params.reason}`
            : "Your deletion request was rejected by the admin team.",
        };

  const [pushResult, emailResult] = await Promise.allSettled([
    PushNotificationService.sendToUserPrimaryDevice(
      params.userId,
      pushPayload,
      {
        category: "security",
        eventType:
          params.decision === "approved"
            ? "account-deletion-approved"
            : "account-deletion-rejected",
      },
    ),
    sendDeletionEmail(params),
  ]);

  const result: AccountDeletionNotificationResult = {
    pushSent: false,
    emailSent: false,
  };

  if (pushResult.status === "fulfilled") {
    const value: any = pushResult.value;
    result.pushSent = Boolean(value?.successCount > 0 || value?.skipped);
  } else {
    result.pushError = pushResult.reason?.message || "Failed to send push notification";
  }

  if (emailResult.status === "fulfilled") {
    result.emailSent = emailResult.value.sent;
    if (!emailResult.value.sent) {
      result.emailError = emailResult.value.error;
    }
  } else {
    result.emailError = emailResult.reason?.message || "Failed to send account deletion email";
  }

  return result;
};

export const notifyAccountDeletionRejection = async (
  params: Omit<AccountDeletionNotificationParams, "decision">,
): Promise<AccountDeletionNotificationResult> => {
  return notifyAccountDeletionDecision({
    ...params,
    decision: "rejected",
  });
};