import sgMail from "@sendgrid/mail";
import User from "../modules/UserModule/models/User";

type EmailOrderItem = {
  name: string;
  quantity: number;
  price: number;
};

type SendEcomOrderEmailsParams = {
  orderRef: string;
  paymentIntentId: string;
  amount: number;
  currency: string;
  paidAt: Date;
  user: {
    id: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    country?: string;
    state?: string;
    city?: string;
  };
  checkout: {
    email?: string;
    phone?: string;
    firstName?: string;
    lastName?: string;
    address?: string;
    city?: string;
    state?: string;
    country?: string;
    zip?: string;
  };
  items: EmailOrderItem[];
};

type SendEcomOrderCancelledEmailsParams = {
  orderNumber: string;
  totalAmount: number;
  cancelledAt: Date;
  cancelledBy: "customer" | "admin";
  user: {
    id: string;
    firstName?: string;
    lastName?: string;
    email?: string;
  };
};

type SendEcomOrderStatusUpdatedEmailsParams = {
  orderNumber: string;
  totalAmount: number;
  updatedAt: Date;
  previousStatus?: string;
  newStatus: string;
  user: {
    id: string;
    firstName?: string;
    lastName?: string;
    email?: string;
  };
};

const formatCurrency = (amount: number, currency: string) => {
  return `${currency.toUpperCase()} ${Number(amount || 0).toFixed(2)}`;
};

const formatReadableDateTime = (value: Date) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "N/A";

  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  });
};

const formatUsd = (amount: number) => {
  return `$${Number(amount || 0).toFixed(2)}`;
};

const escapeHtml = (value?: string | number | null) => {
  const str = String(value ?? "");
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
};

const getOrderSummary = (items: EmailOrderItem[]) => {
  const subtotal = items.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0);
  const totalQty = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  return { subtotal, totalQty };
};

const buildItemsTableRows = (items: EmailOrderItem[]) => {
  if (!items.length) {
    return `
      <tr>
        <td colspan="4" style="padding: 12px; border-bottom: 1px solid #eee; color: #666; text-align: center;">
          No items found
        </td>
      </tr>
    `;
  }

  return items
    .map((item) => {
      const lineTotal = Number(item.price || 0) * Number(item.quantity || 0);
      return `
        <tr>
          <td style="padding: 12px; border-bottom: 1px solid #eee;">${escapeHtml(item.name)}</td>
          <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: center;">${Number(item.quantity || 0)}</td>
          <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: right;">${Number(item.price || 0).toFixed(2)}</td>
          <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: right;">${lineTotal.toFixed(2)}</td>
        </tr>
      `;
    })
    .join("");
};

const getBaseEmailShell = (title: string, subtitle: string, content: string) => {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    body { margin: 0; padding: 0; background: #f5f5f5; font-family: Arial, sans-serif; color: #333; }
    .container { max-width: 680px; margin: 0 auto; background: #fff; }
    .header { background: linear-gradient(135deg, #b54767 0%, #d97fa0 100%); color: #fff; padding: 28px; text-align: center; }
    .header h2 { margin: 0; font-size: 26px; }
    .header p { margin: 8px 0 0; opacity: 0.95; }
    .content { padding: 24px; }
    .card { background: #fafafa; border: 1px solid #ececec; border-radius: 10px; padding: 16px; margin-bottom: 16px; }
    .card h3 { margin: 0 0 12px; font-size: 16px; color: #222; }
    .meta-row { margin: 8px 0; font-size: 14px; }
    .meta-label { font-weight: 700; color: #333; }
    .meta-value { color: #4a4a4a; }
    .table-wrap { overflow-x: auto; border: 1px solid #ececec; border-radius: 10px; background: #fff; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th { background: #f3f3f3; color: #333; text-align: left; padding: 12px; border-bottom: 1px solid #e7e7e7; }
    .summary { margin-top: 14px; border: 1px solid #ececec; border-radius: 10px; padding: 14px; background: #fff; }
    .summary-table { width: 100%; border-collapse: collapse; }
    .summary-table td { padding: 6px 0; font-size: 14px; }
    .summary-table .label { color: #333; }
    .summary-table .value { text-align: right; font-weight: 600; color: #222; white-space: nowrap; }
    .summary-table .total-row td { font-weight: 700; font-size: 15px; padding-top: 10px; border-top: 1px solid #eee; }
    .cta { display: inline-block; margin-top: 12px; background: #c94a7f; color: #fff !important; text-decoration: none; padding: 11px 18px; border-radius: 6px; font-weight: 600; }
    .footer { border-top: 1px solid #eee; padding: 16px 24px; color: #888; font-size: 12px; text-align: center; }
    @media (max-width: 600px) {
      .content { padding: 16px; }
      .header h2 { font-size: 22px; }
      th, td { font-size: 13px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(subtitle)}</p>
    </div>
    <div class="content">
      ${content}
    </div>
    <div class="footer">
      <p style="margin:0;">Skyborne Drop and Tech Investments LLC | Meydan Freezone, Dubai, UAE</p>
      <p style="margin:4px 0 0;">This is an automated transactional email from SKYBORNE.</p>
    </div>
  </div>
</body>
</html>
`;
};

const buildAdminEmailHtml = (params: SendEcomOrderEmailsParams) => {
  const fullName = `${params.user.firstName || ""} ${params.user.lastName || ""}`.trim();
  const checkoutName =
    `${params.checkout.firstName || ""} ${params.checkout.lastName || ""}`.trim() || "N/A";
  const eventTime = formatReadableDateTime(params.paidAt);
  const region = params.checkout.state || params.user.state || "N/A";
  const country = params.checkout.country || params.user.country || "N/A";
  const orderSummary = getOrderSummary(params.items);

  const content = `
    <p style="margin-top:0;">A new ecommerce payment has been confirmed by Stripe webhook.</p>

    <div class="card">
      <h3>Order & Payment</h3>
      <div class="meta-row"><span class="meta-label">Order Reference:</span> <span class="meta-value">${escapeHtml(params.orderRef)}</span></div>
      <div class="meta-row"><span class="meta-label">Payment Intent ID:</span> <span class="meta-value">${escapeHtml(params.paymentIntentId)}</span></div>
      <div class="meta-row"><span class="meta-label">Payment Status:</span> <span class="meta-value">Paid</span></div>
      <div class="meta-row"><span class="meta-label">Payment Method:</span> <span class="meta-value">Stripe (Card)</span></div>
      <div class="meta-row"><span class="meta-label">Paid At:</span> <span class="meta-value">${escapeHtml(eventTime)}</span></div>
      <div class="meta-row"><span class="meta-label">Currency:</span> <span class="meta-value">${escapeHtml(params.currency.toUpperCase())}</span></div>
      <div class="meta-row"><span class="meta-label">Total Paid:</span> <span class="meta-value">${escapeHtml(formatCurrency(params.amount, params.currency))}</span></div>
    </div>

    <div class="card">
      <h3>Customer Details</h3>
      <div class="meta-row"><span class="meta-label">User ID:</span> <span class="meta-value">${escapeHtml(params.user.id)}</span></div>
      <div class="meta-row"><span class="meta-label">Name:</span> <span class="meta-value">${escapeHtml(fullName || "N/A")}</span></div>
      <div class="meta-row"><span class="meta-label">Account Email:</span> <span class="meta-value">${escapeHtml(params.user.email || "N/A")}</span></div>
      <div class="meta-row"><span class="meta-label">Checkout Email:</span> <span class="meta-value">${escapeHtml(params.checkout.email || "N/A")}</span></div>
      <div class="meta-row"><span class="meta-label">Phone:</span> <span class="meta-value">${escapeHtml(params.checkout.phone || "N/A")}</span></div>
      <div class="meta-row"><span class="meta-label">Region/State:</span> <span class="meta-value">${escapeHtml(region)}</span></div>
      <div class="meta-row"><span class="meta-label">Country:</span> <span class="meta-value">${escapeHtml(country)}</span></div>
      <div class="meta-row"><span class="meta-label">City:</span> <span class="meta-value">${escapeHtml(params.checkout.city || params.user.city || "N/A")}</span></div>
    </div>

    <div class="card">
      <h3>Shipping Address</h3>
      <div class="meta-row"><span class="meta-label">Recipient:</span> <span class="meta-value">${escapeHtml(checkoutName)}</span></div>
      <div class="meta-row"><span class="meta-label">Address Line:</span> <span class="meta-value">${escapeHtml(params.checkout.address || "N/A")}</span></div>
      <div class="meta-row"><span class="meta-label">City:</span> <span class="meta-value">${escapeHtml(params.checkout.city || "N/A")}</span></div>
      <div class="meta-row"><span class="meta-label">State/Region:</span> <span class="meta-value">${escapeHtml(params.checkout.state || "N/A")}</span></div>
      <div class="meta-row"><span class="meta-label">Country:</span> <span class="meta-value">${escapeHtml(params.checkout.country || "N/A")}</span></div>
      <div class="meta-row"><span class="meta-label">Postal Code:</span> <span class="meta-value">${escapeHtml(params.checkout.zip || "N/A")}</span></div>
    </div>

    <div class="card">
      <h3>Purchased Items</h3>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th style="text-align:center;">Qty</th>
              <th style="text-align:right;">Unit Price</th>
              <th style="text-align:right;">Line Total</th>
            </tr>
          </thead>
          <tbody>
            ${buildItemsTableRows(params.items)}
          </tbody>
        </table>
      </div>
      <div class="summary">
        <table class="summary-table" role="presentation">
          <tr>
            <td class="label">Total Items</td>
            <td class="value">${orderSummary.totalQty}</td>
          </tr>
          <tr>
            <td class="label">Subtotal</td>
            <td class="value">${formatCurrency(orderSummary.subtotal, params.currency)}</td>
          </tr>
          <tr>
            <td class="label">Shipping</td>
            <td class="value">${formatCurrency(0, params.currency)}</td>
          </tr>
          <tr>
            <td class="label">Tax</td>
            <td class="value">${formatCurrency(0, params.currency)}</td>
          </tr>
          <tr class="total-row">
            <td class="label">Grand Total</td>
            <td class="value">${formatCurrency(params.amount, params.currency)}</td>
          </tr>
        </table>
      </div>
    </div>
  `;

  return getBaseEmailShell(
    "New Ecom Order Paid",
    "Admin purchase alert",
    content
  );
};

const buildUserEmailHtml = (params: SendEcomOrderEmailsParams) => {
  const customerName =
    `${params.checkout.firstName || ""} ${params.checkout.lastName || ""}`.trim() ||
    `${params.user.firstName || ""} ${params.user.lastName || ""}`.trim() ||
    "Customer";
  const eventTime = formatReadableDateTime(params.paidAt);
  const region = params.checkout.state || params.user.state || "N/A";
  const country = params.checkout.country || params.user.country || "N/A";
  const orderSummary = getOrderSummary(params.items);
  const frontendUrl = process.env.FRONTEND_URL || "";
  const ordersUrl = frontendUrl ? `${frontendUrl.replace(/\/$/, "")}/my-orders` : "";

  const content = `
    <p style="margin-top:0;">Hi <strong>${escapeHtml(customerName)}</strong>,</p>
    <p>Your order has been successfully placed and payment is confirmed.</p>

    <div class="card">
      <h3>Order Summary</h3>
      <div class="meta-row"><span class="meta-label">Order Reference:</span> <span class="meta-value">${escapeHtml(params.orderRef)}</span></div>
      <div class="meta-row"><span class="meta-label">Payment Status:</span> <span class="meta-value">Paid</span></div>
      <div class="meta-row"><span class="meta-label">Payment Method:</span> <span class="meta-value">Stripe (Card)</span></div>
      <div class="meta-row"><span class="meta-label">Date & Time:</span> <span class="meta-value">${escapeHtml(eventTime)}</span></div>
      <div class="meta-row"><span class="meta-label">Region/State:</span> <span class="meta-value">${escapeHtml(region)}</span></div>
      <div class="meta-row"><span class="meta-label">Country:</span> <span class="meta-value">${escapeHtml(country)}</span></div>
      <div class="meta-row"><span class="meta-label">Total Paid:</span> <span class="meta-value">${escapeHtml(formatCurrency(params.amount, params.currency))}</span></div>
    </div>

    <div class="card">
      <h3>Shipping Address</h3>
      <div class="meta-row"><span class="meta-label">Recipient:</span> <span class="meta-value">${escapeHtml(customerName)}</span></div>
      <div class="meta-row"><span class="meta-label">Address Line:</span> <span class="meta-value">${escapeHtml(params.checkout.address || "N/A")}</span></div>
      <div class="meta-row"><span class="meta-label">City:</span> <span class="meta-value">${escapeHtml(params.checkout.city || "N/A")}</span></div>
      <div class="meta-row"><span class="meta-label">State/Region:</span> <span class="meta-value">${escapeHtml(params.checkout.state || "N/A")}</span></div>
      <div class="meta-row"><span class="meta-label">Country:</span> <span class="meta-value">${escapeHtml(params.checkout.country || "N/A")}</span></div>
      <div class="meta-row"><span class="meta-label">Postal Code:</span> <span class="meta-value">${escapeHtml(params.checkout.zip || "N/A")}</span></div>
    </div>

    <div class="card">
      <h3>Items Purchased</h3>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th style="text-align:center;">Qty</th>
              <th style="text-align:right;">Unit Price</th>
              <th style="text-align:right;">Line Total</th>
            </tr>
          </thead>
          <tbody>
            ${buildItemsTableRows(params.items)}
          </tbody>
        </table>
      </div>
      <div class="summary">
        <table class="summary-table" role="presentation">
          <tr>
            <td class="label">Total Items</td>
            <td class="value">${orderSummary.totalQty}</td>
          </tr>
          <tr>
            <td class="label">Subtotal</td>
            <td class="value">${formatCurrency(orderSummary.subtotal, params.currency)}</td>
          </tr>
          <tr>
            <td class="label">Shipping</td>
            <td class="value">${formatCurrency(0, params.currency)}</td>
          </tr>
          <tr>
            <td class="label">Tax</td>
            <td class="value">${formatCurrency(0, params.currency)}</td>
          </tr>
          <tr class="total-row">
            <td class="label">Grand Total</td>
            <td class="value">${formatCurrency(params.amount, params.currency)}</td>
          </tr>
        </table>
      </div>
      ${
        ordersUrl
          ? `<a href="${escapeHtml(ordersUrl)}" class="cta">View My Orders</a>`
          : ""
      }
    </div>

    <p style="font-size:14px; color:#555;">If you have any questions, reply to this email or contact support.</p>
  `;

  return getBaseEmailShell(
    "Order Confirmed",
    "Thank you for shopping with SKYBORNE",
    content
  );
};

const normalizeEmailList = (value?: string | null) => {
  if (!value) return [];
  return value
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
};

const resolveAdminEmails = async () => {
  const envEmails = [
    ...normalizeEmailList(process.env.ECOM_ADMIN_NOTIFICATION_EMAILS),
    ...normalizeEmailList(process.env.ADMIN_EMAILS),
    ...normalizeEmailList(process.env.ECOM_ADMIN_NOTIFICATION_EMAIL),
    ...normalizeEmailList(process.env.ADMIN_EMAIL),
    ...normalizeEmailList(process.env.EMAIL_FROM),
  ];

  const adminUsers = await User.find({ role: "admin" }).select("email").lean();
  const dbEmails = (adminUsers || [])
    .map((user: any) => String(user?.email || "").trim().toLowerCase())
    .filter(Boolean);

  const unique = Array.from(new Set([...envEmails, ...dbEmails]));
  return unique;
};

export const sendEcomOrderSuccessEmails = async (
  params: SendEcomOrderEmailsParams
): Promise<void> => {
  if (!process.env.SENDGRID_API_KEY || !process.env.SENDGRID_FROM_EMAIL) {
    console.warn(
      "⚠️ [EcomEmail] SENDGRID_API_KEY or SENDGRID_FROM_EMAIL is missing; skipping ecom emails."
    );
    return;
  }

  sgMail.setApiKey(process.env.SENDGRID_API_KEY);

  const adminEmails = await resolveAdminEmails();
  const checkoutEmail = (params.checkout.email || "").trim().toLowerCase();
  const fallbackUserEmail = (params.user.email || "").trim().toLowerCase();
  const userEmail = checkoutEmail || fallbackUserEmail;

  const jobs: Promise<any>[] = [];

  if (adminEmails.length > 0) {
    adminEmails.forEach((adminEmail) => {
      jobs.push(
        sgMail.send({
          to: adminEmail,
          from: process.env.SENDGRID_FROM_EMAIL,
          subject: `New Ecom Order Paid: ${params.orderRef}`,
          html: buildAdminEmailHtml(params),
        } as any)
      );
    });
  } else {
    console.warn(
      `⚠️ [EcomEmail] Admin notification email not found for order ${params.orderRef}. Set ECOM_ADMIN_NOTIFICATION_EMAIL(S) or ADMIN_EMAIL(S), or ensure admin user exists in DB.`
    );
  }

  if (userEmail) {
    jobs.push(
      sgMail.send({
        to: userEmail,
        from: process.env.SENDGRID_FROM_EMAIL,
        subject: `Order Confirmation: ${params.orderRef}`,
        html: buildUserEmailHtml(params),
      } as any)
    );
  } else {
    console.warn(
      `⚠️ [EcomEmail] User email missing for order ${params.orderRef}; skipping user confirmation email.`
    );
  }

  if (!jobs.length) return;
  await Promise.all(jobs);
};

const buildOrderCancelledAdminEmailHtml = (
  params: SendEcomOrderCancelledEmailsParams
) => {
  const fullName = `${params.user.firstName || ""} ${params.user.lastName || ""}`.trim();
  const cancelledAt = formatReadableDateTime(params.cancelledAt);

  const content = `
    <p style="margin-top:0;">An ecom order has been cancelled by the ${escapeHtml(params.cancelledBy)}.</p>

    <div class="card">
      <h3>Order</h3>
      <div class="meta-row"><span class="meta-label">Order Number:</span> <span class="meta-value">${escapeHtml(params.orderNumber)}</span></div>
      <div class="meta-row"><span class="meta-label">Total Amount:</span> <span class="meta-value">${escapeHtml(formatUsd(params.totalAmount))}</span></div>
      <div class="meta-row"><span class="meta-label">Cancelled At:</span> <span class="meta-value">${escapeHtml(cancelledAt)}</span></div>
    </div>

    <div class="card">
      <h3>Customer</h3>
      <div class="meta-row"><span class="meta-label">User ID:</span> <span class="meta-value">${escapeHtml(params.user.id)}</span></div>
      <div class="meta-row"><span class="meta-label">Name:</span> <span class="meta-value">${escapeHtml(fullName || "N/A")}</span></div>
      <div class="meta-row"><span class="meta-label">Email:</span> <span class="meta-value">${escapeHtml(params.user.email || "N/A")}</span></div>
    </div>
  `;

  return getBaseEmailShell("Order Cancelled", `Order ${params.orderNumber} was cancelled`, content);
};

const buildOrderCancelledUserEmailHtml = (
  params: SendEcomOrderCancelledEmailsParams
) => {
  const fullName = `${params.user.firstName || ""} ${params.user.lastName || ""}`.trim();
  const cancelledAt = formatReadableDateTime(params.cancelledAt);

  const content = `
    <p style="margin-top:0;">Hi ${escapeHtml(fullName || "there")},</p>
    <p>Your order has been cancelled successfully.</p>

    <div class="card">
      <h3>Order</h3>
      <div class="meta-row"><span class="meta-label">Order Number:</span> <span class="meta-value">${escapeHtml(params.orderNumber)}</span></div>
      <div class="meta-row"><span class="meta-label">Total Amount:</span> <span class="meta-value">${escapeHtml(formatUsd(params.totalAmount))}</span></div>
      <div class="meta-row"><span class="meta-label">Cancelled At:</span> <span class="meta-value">${escapeHtml(cancelledAt)}</span></div>
    </div>

    <p style="margin-bottom:0;">If you did not request this cancellation, please contact support.</p>
  `;

  return getBaseEmailShell("Order Cancelled", `Order ${params.orderNumber} cancelled`, content);
};

export const sendEcomOrderCancelledEmails = async (
  params: SendEcomOrderCancelledEmailsParams
): Promise<void> => {
  if (!process.env.SENDGRID_API_KEY || !process.env.SENDGRID_FROM_EMAIL) {
    console.warn(
      "⚠️ [EcomEmail] SENDGRID_API_KEY or SENDGRID_FROM_EMAIL is missing; skipping cancellation emails."
    );
    return;
  }

  sgMail.setApiKey(process.env.SENDGRID_API_KEY);

  const adminEmails = await resolveAdminEmails();
  const userEmail = String(params.user.email || "").trim().toLowerCase();

  const jobs: Promise<any>[] = [];

  if (adminEmails.length > 0) {
    adminEmails.forEach((adminEmail) => {
      jobs.push(
        sgMail.send({
          to: adminEmail,
          from: process.env.SENDGRID_FROM_EMAIL,
          subject: `Order Cancelled: ${params.orderNumber}`,
          html: buildOrderCancelledAdminEmailHtml(params),
        } as any)
      );
    });
  }

  if (userEmail) {
    jobs.push(
      sgMail.send({
        to: userEmail,
        from: process.env.SENDGRID_FROM_EMAIL,
        subject: `Order Cancelled: ${params.orderNumber}`,
        html: buildOrderCancelledUserEmailHtml(params),
      } as any)
    );
  }

  if (!jobs.length) return;
  await Promise.all(jobs);
};

const buildOrderStatusUpdatedAdminEmailHtml = (
  params: SendEcomOrderStatusUpdatedEmailsParams
) => {
  const fullName = `${params.user.firstName || ""} ${params.user.lastName || ""}`.trim();
  const updatedAt = formatReadableDateTime(params.updatedAt);

  const content = `
    <p style="margin-top:0;">An admin updated an ecom order status.</p>

    <div class="card">
      <h3>Order</h3>
      <div class="meta-row"><span class="meta-label">Order Number:</span> <span class="meta-value">${escapeHtml(params.orderNumber)}</span></div>
      <div class="meta-row"><span class="meta-label">Total Amount:</span> <span class="meta-value">${escapeHtml(formatUsd(params.totalAmount))}</span></div>
      <div class="meta-row"><span class="meta-label">Previous Status:</span> <span class="meta-value">${escapeHtml(params.previousStatus || "N/A")}</span></div>
      <div class="meta-row"><span class="meta-label">New Status:</span> <span class="meta-value">${escapeHtml(params.newStatus)}</span></div>
      <div class="meta-row"><span class="meta-label">Updated At:</span> <span class="meta-value">${escapeHtml(updatedAt)}</span></div>
    </div>

    <div class="card">
      <h3>Customer</h3>
      <div class="meta-row"><span class="meta-label">User ID:</span> <span class="meta-value">${escapeHtml(params.user.id)}</span></div>
      <div class="meta-row"><span class="meta-label">Name:</span> <span class="meta-value">${escapeHtml(fullName || "N/A")}</span></div>
      <div class="meta-row"><span class="meta-label">Email:</span> <span class="meta-value">${escapeHtml(params.user.email || "N/A")}</span></div>
    </div>
  `;

  return getBaseEmailShell(
    "Order Status Updated",
    `Order ${params.orderNumber} is now ${params.newStatus}`,
    content
  );
};

const buildOrderStatusUpdatedUserEmailHtml = (
  params: SendEcomOrderStatusUpdatedEmailsParams
) => {
  const fullName = `${params.user.firstName || ""} ${params.user.lastName || ""}`.trim();
  const updatedAt = formatReadableDateTime(params.updatedAt);

  const content = `
    <p style="margin-top:0;">Hi ${escapeHtml(fullName || "there")},</p>
    <p>Your order status has been updated.</p>

    <div class="card">
      <h3>Order</h3>
      <div class="meta-row"><span class="meta-label">Order Number:</span> <span class="meta-value">${escapeHtml(params.orderNumber)}</span></div>
      <div class="meta-row"><span class="meta-label">Previous Status:</span> <span class="meta-value">${escapeHtml(params.previousStatus || "N/A")}</span></div>
      <div class="meta-row"><span class="meta-label">New Status:</span> <span class="meta-value">${escapeHtml(params.newStatus)}</span></div>
      <div class="meta-row"><span class="meta-label">Updated At:</span> <span class="meta-value">${escapeHtml(updatedAt)}</span></div>
    </div>
  `;

  return getBaseEmailShell(
    "Order Status Updated",
    `Order ${params.orderNumber} is now ${params.newStatus}`,
    content
  );
};

export const sendEcomOrderStatusUpdatedEmails = async (
  params: SendEcomOrderStatusUpdatedEmailsParams
): Promise<void> => {
  if (!process.env.SENDGRID_API_KEY || !process.env.SENDGRID_FROM_EMAIL) {
    console.warn(
      "⚠️ [EcomEmail] SENDGRID_API_KEY or SENDGRID_FROM_EMAIL is missing; skipping status update emails."
    );
    return;
  }

  sgMail.setApiKey(process.env.SENDGRID_API_KEY);

  const adminEmails = await resolveAdminEmails();
  const userEmail = String(params.user.email || "").trim().toLowerCase();

  const jobs: Promise<any>[] = [];

  if (adminEmails.length > 0) {
    adminEmails.forEach((adminEmail) => {
      jobs.push(
        sgMail.send({
          to: adminEmail,
          from: process.env.SENDGRID_FROM_EMAIL,
          subject: `Order Status Updated: ${params.orderNumber}`,
          html: buildOrderStatusUpdatedAdminEmailHtml(params),
        } as any)
      );
    });
  }

  if (userEmail) {
    jobs.push(
      sgMail.send({
        to: userEmail,
        from: process.env.SENDGRID_FROM_EMAIL,
        subject: `Order Status Updated: ${params.orderNumber}`,
        html: buildOrderStatusUpdatedUserEmailHtml(params),
      } as any)
    );
  }

  if (!jobs.length) return;
  await Promise.all(jobs);
};
