import Stripe from "stripe";
import mongoose from "mongoose";
import EcomPayment from "../modules/EcomPaymentModule/Ecompayment.model";
import Order from "../modules/OrderModule/order.model";
import Customer from "../modules/CustomerModule/customer.model";
import Cart from "../modules/ServiceModule/CartModule/Cart.model";
import User from "../modules/UserModule/models/User";
import Product from "../modules/ProductModule/product.models";
import { sendEcomOrderSuccessEmails } from "./ecomOrderEmail.service";

// ── Stripe instance (separate from subscription stripe) ──────────────────────
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-12-15.clover" as any,
});

export class EcomStripeService {
  private static async decrementProductStockForOrderItems(
    orderItems: Array<{ product: any; quantity: number }>
  ) {
    const quantityByProduct = new Map<string, number>();

    for (const item of orderItems || []) {
      const productId = item?.product?.toString?.() || String(item?.product || "").trim();
      const qty = Number(item?.quantity || 0);

      if (!productId || !mongoose.Types.ObjectId.isValid(productId) || qty <= 0) continue;
      quantityByProduct.set(productId, (quantityByProduct.get(productId) || 0) + qty);
    }

    for (const [productId, qty] of quantityByProduct.entries()) {
      try {
        // First try strict decrement when enough stock exists.
        const strict = await Product.updateOne(
          { _id: productId, stock: { $gte: qty } },
          { $inc: { stock: -qty } }
        );

        if ((strict as any)?.modifiedCount > 0) {
          console.log("✅ [EcomStripe] Stock decremented:", { productId, qty });
          continue;
        }

        // Fallback: clamp to zero when stock is lower than purchased quantity.
        const product = await Product.findById(productId).select("name stock").exec();
        if (!product) {
          console.warn("⚠️ [EcomStripe] Product not found for stock decrement:", { productId, qty });
          continue;
        }

        const currentStock = Number((product as any).stock || 0);
        const nextStock = Math.max(0, currentStock - qty);

        if (nextStock !== currentStock) {
          (product as any).stock = nextStock;
          await product.save();
        }

        console.warn("⚠️ [EcomStripe] Stock adjusted with low-stock fallback:", {
          productId,
          productName: (product as any)?.name,
          orderedQty: qty,
          previousStock: currentStock,
          newStock: nextStock,
        });
      } catch (stockErr: any) {
        console.error("❌ [EcomStripe] Failed to decrement stock:", {
          productId,
          qty,
          message: stockErr?.message || stockErr,
        });
      }
    }
  }

  private static async buildOrderItemsFromStripeLineItems(lineItems: any[]) {
    let subtotal = 0;
    const items: Array<{
      product: string;
      name: string;
      price: number;
      quantity: number;
      image?: string;
    }> = [];

    for (const line of lineItems || []) {
      const quantity = Number(line?.quantity) || 1;
      const unitAmountCents =
        line?.price?.unit_amount ??
        (line?.amount_total && quantity
          ? Math.round(line.amount_total / quantity)
          : 0);

      let productObj: any =
        line?.price?.product && typeof line.price.product === "object"
          ? line.price.product
          : null;

      if (!productObj && typeof line?.price?.product === "string") {
        try {
          productObj = await stripe.products.retrieve(line.price.product);
        } catch (err: any) {
          console.warn("⚠️ [EcomStripe] Failed to retrieve Stripe product:", {
            productId: line.price.product,
            message: err?.message || err,
          });
          productObj = null;
        }
      }

      const productId =
        productObj?.metadata?.productId ||
        productObj?.metadata?.product_id ||
        line?.price?.product?.metadata?.productId ||
        line?.price?.product?.metadata?.product_id;

      if (!productId) continue;

      const image =
        Array.isArray(productObj?.images) && productObj.images.length > 0
          ? productObj.images[0]
          : undefined;
      const name = productObj?.name || line?.description || "Item";
      const price = Number(unitAmountCents) / 100;

      subtotal += price * quantity;
      items.push({
        product: productId,
        name,
        price,
        quantity,
        image,
      });
    }

    return { items, subtotal };
  }

  static async rebuildOrderItemsFromPaymentIntent(paymentIntentId: string) {
    if (!paymentIntentId) return null;
    const sessions = await stripe.checkout.sessions.list({
      payment_intent: paymentIntentId,
      limit: 1,
      expand: ["data.line_items", "data.line_items.data.price.product"],
    });

    const session = sessions.data?.[0];
    if (!session || session.metadata?.type !== "ecom") return null;

    const lineItems = (session as any)?.line_items?.data ?? [];
    if (!lineItems.length) return null;

    return await EcomStripeService.buildOrderItemsFromStripeLineItems(lineItems);
  }
  /**
   * Refund a Stripe payment intent (full or partial).
   * amountInCents is optional; omit for full refund.
   */
  static async refundPaymentIntent(
    paymentIntentId: string,
    amountInCents?: number
  ): Promise<Stripe.Refund> {
    const payload: Stripe.RefundCreateParams = {
      payment_intent: paymentIntentId,
    };

    if (typeof amountInCents === "number" && Number.isFinite(amountInCents)) {
      payload.amount = Math.max(0, Math.round(amountInCents));
    }

    return stripe.refunds.create(payload);
  }

  /**
   * Resolve a Stripe hosted receipt URL from a payment intent.
   */
  static async getReceiptUrl(paymentIntentId: string): Promise<string | null> {
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ["latest_charge"],
    });

    const charge = intent.latest_charge as Stripe.Charge | string | null;
    if (!charge || typeof charge === "string") {
      return null;
    }

    return charge.receipt_url || null;
  }
  /**
   * Create a Stripe Checkout Session for ecom product purchase.
   * Completely separate from subscription checkout sessions.
   */
  static async createEcomCheckoutSession(
    userId: string,
    cartItems: Array<{
      productId: string;
      name: string;
      price: number;
      quantity: number;
      image?: string;
    }>,
    shippingAddress: Record<string, any>,
    userEmail: string,
    source: "app" | "web" = "web",
    customSuccessUrl?: string,
    customCancelUrl?: string
  ): Promise<{
    checkoutUrl: string;
    sessionId: string;
    orderRef: string;
  }> {
    const orderRef = `ECOM-${Date.now()}`;

    // Build Stripe line items from cart
    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = cartItems.map(
      (item) => ({
        price_data: {
          currency: "usd",
          product_data: {
            name: item.name,
            ...(item.image ? { images: [item.image] } : {}),
            metadata: {
              productId: String(item.productId || ""),
            },
          },
          unit_amount: Math.round(item.price * 100), // cents
        },
        quantity: item.quantity,
      })
    );

    const appSuccessUrl = customSuccessUrl || process.env.ECOM_APP_SUCCESS_URL;
    const appCancelUrl = customCancelUrl || process.env.ECOM_APP_CANCEL_URL;
    const webSuccessUrl =
      process.env.ECOM_WEB_SUCCESS_URL ||
      `${process.env.FRONTEND_URL}/order-success?sessionId={CHECKOUT_SESSION_ID}`;
    const webCancelUrl =
      process.env.ECOM_WEB_CANCEL_URL ||
      `${process.env.FRONTEND_URL}/checkout?cancelled=true`;

    if (source === "app" && (!appSuccessUrl || !appCancelUrl)) {
      throw new Error(
        "Missing ecom app redirect URLs. Set ECOM_APP_SUCCESS_URL and ECOM_APP_CANCEL_URL.",
      );
    }

    if (source === "web" && (!webSuccessUrl || !webCancelUrl)) {
      throw new Error(
        "Missing ecom web redirect URLs. Set ECOM_WEB_SUCCESS_URL/ECOM_WEB_CANCEL_URL or FRONTEND_URL.",
      );
    }

    const successUrl = source === "app" ? appSuccessUrl : webSuccessUrl;
    const cancelUrl = source === "app" ? appCancelUrl : webCancelUrl;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment", // ← one-time payment, NOT subscription
      line_items: lineItems,
      customer_email: userEmail,
      metadata: {
        userId,
        orderRef,
        shippingAddress: JSON.stringify(shippingAddress),
        type: "ecom", // ← distinguish from subscription sessions
      },
      success_url: successUrl,
      cancel_url: cancelUrl,
    });

    return {
      checkoutUrl: session.url!,
      sessionId: session.id,
      orderRef,
    };
  }

  /**
   * Fulfill ecom order after Stripe confirms payment.
   * Called from webhook — creates Order, Customer, EcomPayment atomically.
   */
static async fulfillEcomOrder(sessionId: string): Promise<void> {
  console.log("🔵 [EcomStripe] fulfillEcomOrder started:", sessionId);

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["payment_intent", "line_items", "line_items.data.price.product"],
    });
    console.log("🔵 [EcomStripe] Session retrieved:", {
      id: session.id,
      type: session.metadata?.type,
      payment_status: session.payment_status,
      orderRef: session.metadata?.orderRef,
      userId: session.metadata?.userId,
      amount_total: session.amount_total,
    });

    if (session.metadata?.type !== "ecom") {
      console.log("ℹ️ [EcomStripe] Skipping non-ecom session, type:", session.metadata?.type);
      return;
    }
    if (session.payment_status !== "paid") {
      console.log("ℹ️ [EcomStripe] Skipping unpaid session, status:", session.payment_status);
      return;
    }

    const { userId, orderRef, shippingAddress: shippingAddressRaw } = session.metadata!;
    const rawAddress = JSON.parse(shippingAddressRaw);
console.log("🔵 [EcomStripe] Parsed shippingAddress:", rawAddress);

// ✅ Map frontend fields → Order schema fields
const shippingAddress = {
  fullName: `${rawAddress.firstName ?? ""} ${rawAddress.lastName ?? ""}`.trim(),
  addressLine1: rawAddress.address ?? rawAddress.addressLine1 ?? "",
  addressLine2: rawAddress.addressLine2 ?? "",
  city: rawAddress.city ?? "",
  state: rawAddress.state ?? rawAddress.region ?? "N/A",  // frontend doesn't send state
  country: rawAddress.country ?? "N/A",                   // frontend doesn't send country
  postalCode: rawAddress.zip ?? rawAddress.postalCode ?? "",
  phone: rawAddress.phone ?? "",
};
console.log("🔵 [EcomStripe] Mapped shippingAddress:", shippingAddress);


    const paymentIntent = session.payment_intent as Stripe.PaymentIntent;
    const amountTotal = (session.amount_total ?? 0) / 100;
    const user = await User.findById(userId).select("firstName lastName email state country city").lean();
    console.log("🔵 [EcomStripe] Processing order:", { userId, orderRef, amountTotal });

    // ── 1. Find or create Customer ──────────────────────────────────────────
    console.log("🔵 [EcomStripe] Step 1: Finding/creating customer for userId:", userId);
    let customer = await Customer.findOne({ userId });
    if (!customer) {
      console.log("🔵 [EcomStripe] Customer not found, creating new...");
      customer = await Customer.create({
        userId,
        totalOrders: 0,
        totalSpent: 0,
        lastOrderAt: new Date(),
      });
      console.log("✅ [EcomStripe] Customer created:", customer._id);
    } else {
      console.log("✅ [EcomStripe] Customer found:", customer._id);
    }

    // ── 2. Rebuild order items from cart ────────────────────────────────────
    console.log("🔵 [EcomStripe] Step 2: Fetching cart for userId:", userId);
    const cart = await Cart.findOne({ userId }).lean();
    const cartItems = cart?.items ?? [];
    console.log("🔵 [EcomStripe] Cart items count:", cartItems.length);
    if (cartItems.length === 0) {
      console.warn("⚠️ [EcomStripe] Cart is empty for userId:", userId);
    }

    type OrderItemInput = {
      product: any;
      name: string;
      price: number;
      quantity: number;
      image?: string;
    };

    let subtotal = 0;
    let orderItems: OrderItemInput[] =
      cartItems.length > 0
        ? cartItems.map((item: any): OrderItemInput => {
            const lineTotal = item.price * item.quantity;
            subtotal += lineTotal;
            return {
              product: item.product,
              name: item.name,
              price: item.price,
              quantity: item.quantity,
              image: item.image || undefined,
            };
          })
        : [];

    // Fallback to Stripe line items if cart is empty
    if (orderItems.length === 0) {
      const lineItems = (session as any)?.line_items?.data ?? [];
      const rebuilt = await EcomStripeService.buildOrderItemsFromStripeLineItems(lineItems);
      orderItems = rebuilt.items;
      subtotal = rebuilt.subtotal;
      console.log(
        "🔵 [EcomStripe] Fallback order items from Stripe:",
        orderItems.length
      );
    }
    console.log("🔵 [EcomStripe] Order items built, subtotal:", subtotal);

    // ── 3. Create Order ─────────────────────────────────────────────────────
    console.log("🔵 [EcomStripe] Step 3: Creating order:", orderRef);
    const order = await Order.create({
      orderNumber: orderRef,
      userId,
      customerId: customer._id,
      stripePaymentIntentId: paymentIntent.id,
      items: orderItems,
      subtotal,
      tax: 0,
      shippingCharge: 0,
      discount: 0,
      totalAmount: amountTotal,
      paymentMethod: "stripe",
      paymentStatus: "Paid",
      orderStatus: "Pending",
      shippingAddress,
      isPaid: true,
      paidAt: new Date(),
    });
    console.log("✅ [EcomStripe] Order created:", order._id);

    // ── 3.1 Decrement product stock based on purchased quantities ───────────
    await EcomStripeService.decrementProductStockForOrderItems(orderItems);

    // ── 4. Create EcomPayment ───────────────────────────────────────────────
    console.log("🔵 [EcomStripe] Step 4: Creating EcomPayment for paymentIntent:", paymentIntent.id);
    await EcomPayment.create({
      userId,
      orderId: order._id,
      customerId: customer._id,
      stripePaymentIntentId: paymentIntent.id,
      stripeCustomerId: session.customer as string | undefined,
      amount: amountTotal,
      amountInCents: session.amount_total ?? 0,
      currency: session.currency ?? "usd",
      status: "succeeded",
      receiptUrl: paymentIntent.latest_charge
        ? `https://dashboard.stripe.com/payments/${paymentIntent.id}`
        : undefined,
      orderRef,
      metadata: {
        sessionId,
        stripeCustomer: session.customer,
      },
    });
    console.log("✅ [EcomStripe] EcomPayment created");

    // ── 4.1 Send order success emails (admin + user) ───────────────────────
    try {
      await sendEcomOrderSuccessEmails({
        orderRef,
        paymentIntentId: paymentIntent.id,
        amount: amountTotal,
        currency: session.currency ?? "usd",
        paidAt: new Date(),
        user: {
          id: String(userId),
          firstName: (user as any)?.firstName,
          lastName: (user as any)?.lastName,
          email: (user as any)?.email,
          state: (user as any)?.state,
          country: (user as any)?.country,
          city: (user as any)?.city,
        },
        checkout: {
          email: rawAddress?.email || session.customer_details?.email || undefined,
          phone: rawAddress?.phone || session.customer_details?.phone || undefined,
          firstName: rawAddress?.firstName,
          lastName: rawAddress?.lastName,
          address: rawAddress?.address || rawAddress?.addressLine1,
          city: rawAddress?.city,
          state: rawAddress?.state || rawAddress?.region,
          country: rawAddress?.country,
          zip: rawAddress?.zip || rawAddress?.postalCode,
        },
        items: orderItems.map((item) => ({
          name: item.name,
          quantity: Number(item.quantity) || 1,
          price: Number(item.price) || 0,
        })),
      });
      console.log("✅ [EcomStripe] Success emails sent:", orderRef);
    } catch (mailErr: any) {
      console.error("⚠️ [EcomStripe] Failed to send success emails:", {
        orderRef,
        message: mailErr?.message || mailErr,
      });
    }

    // ── 5. Update Customer stats ────────────────────────────────────────────
    console.log("🔵 [EcomStripe] Step 5: Updating customer stats");
    customer.totalOrders += 1;
    customer.totalSpent += amountTotal;
    (customer as any).lastOrderAt = new Date();
    await customer.save();
    console.log("✅ [EcomStripe] Customer stats updated:", {
      totalOrders: customer.totalOrders,
      totalSpent: customer.totalSpent,
    });

    // ── 6. Clear cart ───────────────────────────────────────────────────────
    console.log("🔵 [EcomStripe] Step 6: Clearing cart for userId:", userId);
    await Cart.findOneAndUpdate({ userId }, { items: [] });
    console.log("✅ [EcomStripe] Cart cleared");

    console.log("✅ [EcomStripe] Order fulfilled successfully:", orderRef);
  } catch (error: any) {
    console.error("❌ [EcomStripe] fulfillEcomOrder failed:", {
      message: error.message,
      stack: error.stack,
      sessionId,
    });
    throw error;
  }
}
  /**
   * Retrieve session details (used by frontend success page)
   */
  static async getSessionDetails(sessionId: string) {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    return session;
  }
}
