/* eslint-disable @typescript-eslint/no-explicit-any */

import express from "express";
import type { Application, Request, Response } from "express";
import { emailQueue } from './services/queues/emailQueue';
import cors from "cors";
import cookieParser from "cookie-parser";
import compression from "compression";
import authApiRouter from "./routes/authApiRouter";
import appApiRouter from "./routes/appApiRouter";
import { routeNotFound } from "./handlers/routeError.handler";
import { httpErrorHandler } from "./handlers/httpError.handler";
import multer from "multer";
import dotenv from "dotenv";
import helmet from "helmet";
import rateLimitMiddleware from "./utils/rateLimit.utils";
import { apiTimeout } from "./middlewares/timeout";
import { ExpressAdapter } from '@bull-board/express';
import { createBullBoard } from '@bull-board/api';
import { BullAdapter } from '@bull-board/api/bullAdapter';
import { verifyAccessToken } from "./middlewares/verifyToken.middleware";
import { hasRole } from "./middlewares/hasPermission";
import { getAllowedOrigins, isOriginAllowed } from "./utils/cors";
import Stripe from 'stripe';
import zoomWebhook from "./routes/zoomWebhook";
import PaymentController from "./modules/PaymentModule/controllers/paymentController";
import { StripeService } from "./modules/PaymentModule/services/stripe.service";
import stripeWebhook from "./modules/PaymentModule/controllers/stripeWebhook";
import ngeniusWebhook from "./modules/PaymentModule/controllers/ngeniusWebhook";
import ecomStripeWebhook from "./routes/ecomstripe.webhook"

dotenv.config();

const app: Application = express();



// BullBoard UI (restricted in production by default)
const isProduction =
  process.env.APP_ENV === "production" || process.env.NODE_ENV === "production";
const allowedOrigins = getAllowedOrigins();
const shouldExposeQueueDashboard =
  !isProduction || process.env.ENABLE_QUEUE_DASHBOARD === "true";

if (shouldExposeQueueDashboard) {
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath("/admin/queues");

  createBullBoard({
    queues: [new BullAdapter(emailQueue)],
    serverAdapter,
  });

  const queueDashboardAuth = isProduction
    ? [verifyAccessToken, hasRole(["admin"])]
    : [];

  app.use("/admin/queues", ...queueDashboardAuth, serverAdapter.getRouter());
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

app.use(
  "/webhooks/stripe",
  (req, res, next) => {
    next();
  },
  express.raw({ type: "application/json" }),
  stripeWebhook
);


app.use(
  "/webhooks/ecom-stripe",
  express.raw({ type: "application/json" }),
  ecomStripeWebhook
);
app.use(
  cors({
    origin: (origin, callback) => {
      if (isOriginAllowed(origin, allowedOrigins)) {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

app.use(cookieParser());

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.use(compression());

app.use(helmet({ crossOriginResourcePolicy: false }));

if (process.env.APP_ENV === "production") {
  app.use(rateLimitMiddleware);
}

// Initialize email queue
emailQueue.on('ready', () => {
  console.log('✅ Email queue is ready');
});

emailQueue.on('error', (err) => {
  console.error('❌ Email queue error:', err);
});

try {
  PaymentController.initPaymentSystems();
} catch (error) {
  console.error('❌ Error initializing payment systems:', error);
  process.exit(1);
}









// app.use(apiTimeout(10000));

/* 7. STATIC files (optional) */
// app.use("/uploads", express.static("uploads"));

/* 8. Request Logger */
app.use((req: Request, res: Response, next) => {
  const start = Date.now();
  res.on("finish", () => {
    console.log(
      `[API HIT] ${req.method} ${req.originalUrl} → ${res.statusCode} (${
        Date.now() - start
      }ms)`
    );
  });
  next();
});




/* 9. All routes go here */
const apiVersion = "/api/v1/";

app.use(apiVersion, zoomWebhook);


// Demo route
app.get("/", (req: Request, res: Response) => {
  res.status(200).json({
    status: "success",
    message: "Skyborne API is running smoothly!",
    version: apiVersion,
    timestamp: new Date().toISOString(),
  });
});

app.use(apiVersion, authApiRouter);
app.use(apiVersion, appApiRouter);

/* 10. 404 handler (route not found) */
app.use(routeNotFound);

/* 11. Global error handler — MUST BE LAST */
app.use(httpErrorHandler);

/* 12. Hide Express signature */
app.disable("x-powered-by");

export default app;
