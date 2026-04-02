import setRateLimit from "express-rate-limit";
import type { Request, RequestHandler, Response } from "express";
import { buildErrorResponse } from "../handlers/httpError.handler";

type EndpointRateLimit = {
  path: string;
  method: "get" | "post" | "put" | "patch" | "delete";
  windowMs: number;
  max: number;
  message: string;
};

const keyGenerator = (req: Request) => {
  const userId =
    (req as any)?.user?.id ||
    (req as any)?.user?._id?.toString?.() ||
    (req as any)?.userId;
  return userId ? `user:${userId}` : `ip:${req.ip}`;
};

const buildRateLimitHandler =
  (message: string, max: number, windowMs: number) =>
  (req: Request, res: Response) => {
    const traceId = res.locals?.traceId || "unknown";
    return res.status(429).json(
      buildErrorResponse({
        code: "RATE_LIMITED",
        message,
        details: {
          limit: max,
          windowMs,
        },
        traceId,
      })
    );
  };

const createRateLimiter = (limit: EndpointRateLimit): RequestHandler =>
  setRateLimit({
    windowMs: limit.windowMs,
    max: limit.max,
    message: limit.message,
    handler: buildRateLimitHandler(limit.message, limit.max, limit.windowMs),
    keyGenerator,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: false,
  });

const endpointRateLimits: EndpointRateLimit[] = [
  {
    path: "/login",
    method: "post",
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: "Too many login attempts. Please try again later.",
  },
  {
    path: "/social-login",
    method: "post",
    windowMs: 15 * 60 * 1000,
    max: 15,
    message: "Too many login attempts. Please try again later.",
  },
  {
    path: "/send-otp",
    method: "post",
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: "Too many OTP requests. Please try again later.",
  },
  {
    path: "/request-password-reset",
    method: "post",
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: "Too many reset requests. Please try again later.",
  },
  {
    path: "/verify-otp",
    method: "post",
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: "Too many OTP verification attempts. Please try again later.",
  },
  {
    path: "/reset-password",
    method: "post",
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: "Too many reset attempts. Please try again later.",
  },
  {
    path: "/payment/create-order",
    method: "post",
    windowMs: 60 * 1000,
    max: 20,
    message: "Too many payment attempts. Please slow down.",
  },
  {
    path: "/payments",
    method: "post",
    windowMs: 60 * 1000,
    max: 20,
    message: "Too many payment attempts. Please slow down.",
  },
  {
    path: "/payment/upgrade-order",
    method: "post",
    windowMs: 60 * 1000,
    max: 10,
    message: "Too many upgrade attempts. Please slow down.",
  },
  {
    path: "/payment/verify-payment",
    method: "post",
    windowMs: 60 * 1000,
    max: 30,
    message: "Too many verification attempts. Please slow down.",
  },
];

const limiterCache = new Map<string, RequestHandler>();

export const getEndpointRateLimiter = (
  path: string,
  method: string
): RequestHandler | null => {
  const normalizedMethod = method.toLowerCase();
  const limit = endpointRateLimits.find(
    (rule) => rule.path === path && rule.method === normalizedMethod
  );
  if (!limit) {
    return null;
  }

  const cacheKey = `${limit.method}:${limit.path}`;
  if (!limiterCache.has(cacheKey)) {
    limiterCache.set(cacheKey, createRateLimiter(limit));
  }
  return limiterCache.get(cacheKey) || null;
};

// Global rate limit middleware (fallback)
const rateLimitMiddleware = setRateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: "You have exceeded your request limit.",
  handler: buildRateLimitHandler(
    "You have exceeded your request limit.",
    60,
    60 * 1000
  ),
  keyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
});

export default rateLimitMiddleware;
