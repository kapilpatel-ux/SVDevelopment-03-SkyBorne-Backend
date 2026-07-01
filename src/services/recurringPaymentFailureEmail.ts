import sgMail from "@sendgrid/mail";

if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

interface SendRecurringPaymentFailureEmailParams {
  to: string;
  firstName?: string;
  failedAt?: Date | string;
  subscriptionId?: string;
  invoiceId?: string;
  gracePeriodHours?: number;
}

const formatReadableDateTime = (value?: Date | string) => {
  if (!value) return "N/A";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "N/A";

  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
};

const getRecurringPaymentFailureHTML = ({
  firstName,
  failedAt,
  subscriptionId,
  invoiceId,
  gracePeriodHours = 48,
}: {
  firstName?: string;
  failedAt?: Date | string;
  subscriptionId?: string;
  invoiceId?: string;
  gracePeriodHours?: number;
}) => {
  const accountUrl =
    process.env.DASHBOARD_URL ||
    process.env.FRONTEND_URL ||
    process.env.WEBSITE_URL ||
    "";

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    body { margin: 0; padding: 0; background: #f5f5f5; font-family: Arial, sans-serif; color: #333; }
    .container { max-width: 600px; margin: 0 auto; background: #fff; }
    .header { background: linear-gradient(135deg, #b54767 0%, #d97fa0 100%); color: #fff; padding: 28px; text-align: center; }
    .content { padding: 28px; }
    .warning { background: #fff8e6; border: 1px solid #ffd37a; border-radius: 8px; padding: 16px; margin: 16px 0; }
    .meta { background: #fafafa; border: 1px solid #eee; border-radius: 8px; padding: 14px; margin: 18px 0; font-size: 14px; }
    .cta { display: inline-block; margin-top: 18px; background: #c94a7f; color: #fff !important; text-decoration: none; padding: 12px 20px; border-radius: 6px; font-weight: 600; }
    .footer { border-top: 1px solid #eee; padding: 16px 28px; color: #888; font-size: 12px; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2 style="margin: 0;">Payment Failed</h2>
      <p style="margin: 8px 0 0;">Action required to keep your subscription active</p>
    </div>

    <div class="content">
      <p>Hi <strong>${firstName || "Member"}</strong>,</p>
      <p>We could not process your recurring subscription payment.</p>
      <p>Please update your card details or keep sufficient funds available.</p>

      <div class="warning">
        If we do not receive a successful payment within <strong>${gracePeriodHours} hours</strong>, your subscription status will be set to <strong>inactive</strong>.
      </div>

      <div class="meta">
        <p style="margin: 0 0 8px;"><strong>Failure time:</strong> ${formatReadableDateTime(failedAt)}</p>
        <p style="margin: 0 0 8px;"><strong>Subscription ID:</strong> ${subscriptionId || "N/A"}</p>
        <p style="margin: 0;"><strong>Invoice ID:</strong> ${invoiceId || "N/A"}</p>
      </div>

      ${
        accountUrl
          ? `<a href="${accountUrl}" class="cta">Update Card Details</a>`
          : ""
      }

      <p style="margin-top: 20px;">Thank you.</p>
    </div>

    <div class="footer">
      <p style="margin: 0;">You received this email because you have an active subscription on SKYBORNE.</p>
    </div>
  </div>
</body>
</html>
  `;
};

export const sendRecurringPaymentFailureEmail = async (
  params: SendRecurringPaymentFailureEmailParams,
) => {
  if (!process.env.SENDGRID_API_KEY) {
    throw new Error("SENDGRID_API_KEY is not configured");
  }

  if (!process.env.SENDGRID_FROM_EMAIL) {
    throw new Error("SENDGRID_FROM_EMAIL is not configured");
  }

  const msg = {
    to: params.to,
    from: process.env.SENDGRID_FROM_EMAIL,
    subject: "Payment failed: please update card details within 48 hours",
    html: getRecurringPaymentFailureHTML(params),
  };

  await sgMail.send(msg);
};

