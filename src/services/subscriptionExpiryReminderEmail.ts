import sgMail from "@sendgrid/mail";

if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

interface SendSubscriptionExpiryReminderParams {
  to: string;
  firstName?: string;
  plan?: string;
  expiryDate: Date | string;
  autoRenewDate?: Date | string;
  daysRemaining: number;
}

const formatPlan = (plan?: string) => {
  if (!plan) return "Your current plan";
  return plan
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
};

const formatReadableDate = (input?: Date | string) => {
  if (!input) return "N/A";
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return "N/A";

  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
};

const getSubscriptionExpiryReminderHTML = ({
  firstName,
  plan,
  expiryDate,
  autoRenewDate,
  daysRemaining,
}: {
  firstName?: string;
  plan?: string;
  expiryDate: Date | string;
  autoRenewDate?: Date | string;
  daysRemaining: number;
}) => {
  const formattedExpiryDate = formatReadableDate(expiryDate);
  const formattedAutoRenewDate = formatReadableDate(autoRenewDate || expiryDate);

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    body { margin: 0; padding: 0; background: #f5f5f5; font-family: Arial, sans-serif; color: #333; }
    .container { max-width: 600px; margin: 0 auto; background: #fff; }
    .header { background: linear-gradient(135deg, #c94a7f 0%, #d97fa0 100%); color: #fff; padding: 28px; text-align: center; }
    .content { padding: 28px; }
    .box { background: #fff8e6; border: 1px solid #ffd37a; border-radius: 8px; padding: 16px; margin: 16px 0; }
    .label { color: #666; font-size: 14px; }
    .value { color: #111; font-weight: 700; font-size: 15px; }
    .cta { display: inline-block; margin-top: 18px; background: #c94a7f; color: #fff; text-decoration: none; padding: 12px 20px; border-radius: 6px; font-weight: 600; }
    .footer { border-top: 1px solid #eee; padding: 16px 28px; color: #888; font-size: 12px; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2 style="margin: 0;">Subscription Reminder</h2>
      <p style="margin: 8px 0 0;">Your plan expires in ${daysRemaining} days</p>
    </div>

    <div class="content">
      <p>Hi <strong>${firstName || "Member"}</strong>,</p>

      <p>This is to inform you that your current plan will expire on <strong>${formattedExpiryDate}</strong>.</p>
      <p>Please note that your plan will be automatically renewed on <strong>${formattedAutoRenewDate}</strong>.</p>
      <p>Thank you.</p>

      <div class="box">
        <p style="margin: 0 0 8px;"><span class="label">Plan:</span> <span class="value">${formatPlan(plan)}</span></p>
        <p style="margin: 0 0 8px;"><span class="label">Expiry Date:</span> <span class="value">${formattedExpiryDate}</span></p>
        <p style="margin: 0;"><span class="label">Auto-Renew Date:</span> <span class="value">${formattedAutoRenewDate}</span></p>
      </div>

    </div>

    <div class="footer">
      <p style="margin: 0;">You received this email because you have an active subscription on SKYBORNE.</p>
    </div>
  </div>
</body>
</html>
  `;
};

export const sendSubscriptionExpiryReminderEmail = async (
  params: SendSubscriptionExpiryReminderParams,
) => {
  if (!process.env.SENDGRID_API_KEY) {
    throw new Error("SENDGRID_API_KEY is not configured");
  }

  if (!process.env.SENDGRID_FROM_EMAIL) {
    throw new Error("SENDGRID_FROM_EMAIL is not configured");
  }

  const { to, firstName, plan, expiryDate, autoRenewDate, daysRemaining } =
    params;

  const msg = {
    to,
    from: process.env.SENDGRID_FROM_EMAIL,
    subject: `Your subscription expires in ${daysRemaining} days`,
    html: getSubscriptionExpiryReminderHTML({
      firstName,
      plan,
      expiryDate,
      autoRenewDate,
      daysRemaining,
    }),
  };

  await sgMail.send(msg);
};
