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
import { buildErrorResponse, httpErrorHandler } from "./handlers/httpError.handler";
import multer from "multer";
import dotenv from "dotenv";
import helmet from "helmet";
import rateLimitMiddleware from "./utils/rateLimit.utils";
import { apiTimeout } from "./middlewares/timeout";
import { ExpressAdapter } from '@bull-board/express';
import { createBullBoard } from '@bull-board/api';
import { BullAdapter } from '@bull-board/api/bullAdapter';
import Stripe from 'stripe';
import zoomWebhook from "./routes/zoomWebhook";
import PaymentController from "./modules/PaymentModule/controllers/paymentController";
import { StripeService } from "./modules/PaymentModule/services/stripe.service";
import stripeWebhook from "./modules/PaymentModule/controllers/stripeWebhook";
import ngeniusWebhook from "./modules/PaymentModule/controllers/ngeniusWebhook";
import ecomStripeWebhook from "./routes/ecomstripe.webhook"
import { v4 as uuidv4 } from "uuid";

const app: Application = express();



// BullBoard UI
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath("/admin/queues");



createBullBoard({
  queues: [new BullAdapter(emailQueue)],
  serverAdapter,
});

app.use("/admin/queues", serverAdapter.getRouter());

dotenv.config();

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
    origin: true,
    credentials: true,
  })
);

app.use(cookieParser());

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.use(compression());

app.use(helmet({ crossOriginResourcePolicy: false }));

if (process.env.TRUST_PROXY === "true") {
  app.set("trust proxy", 1);
}

// Trace ID middleware for structured error responses
app.use((req: Request, res: Response, next) => {
  const traceHeader = req.headers["x-trace-id"] || req.headers["x-request-id"];
  const traceId = (Array.isArray(traceHeader) ? traceHeader[0] : traceHeader) || uuidv4();
  res.locals.traceId = traceId;
  res.setHeader("X-Trace-Id", traceId);
  next();
});

// Normalize error responses into a consistent shape
app.use((req: Request, res: Response, next) => {
  const originalJson = res.json.bind(res);

  res.json = (body: any) => {
    if (res.statusCode >= 400) {
      const traceId = res.locals?.traceId || "unknown";
      const isStructured =
        body &&
        typeof body === "object" &&
        "code" in body &&
        "message" in body &&
        "traceId" in body;

      if (!isStructured) {
        const statusCode = res.statusCode;
        const isServerError = statusCode >= 500;
        const fallbackMessage = isServerError ? "Internal server error" : "Request failed";
        const rawMessage =
          typeof body?.message === "string"
            ? body.message
            : typeof body?.error === "string"
              ? body.error
              : fallbackMessage;
        const message = isServerError ? fallbackMessage : rawMessage;
        const details = isServerError ? null : body?.details ?? body?.data ?? null;

        const codeMap: Record<number, string> = {
          400: "BAD_REQUEST",
          401: "UNAUTHORIZED",
          403: "FORBIDDEN",
          404: "NOT_FOUND",
          405: "METHOD_NOT_ALLOWED",
          409: "CONFLICT",
          422: "VALIDATION_ERROR",
        };
        const code = body?.code || codeMap[statusCode] || "INTERNAL_SERVER_ERROR";

        body = buildErrorResponse({ code, message, details, traceId });
      }
    }

    return originalJson(body);
  };

  next();
});

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
