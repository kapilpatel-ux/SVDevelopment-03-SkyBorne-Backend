import type { NextFunction, Request, Response } from "express";
import redisClient from "../config/redis";
import { logger } from "../utils/winston.utils";

type CacheOptions = {
  keyPrefix: string;
  ttlSeconds: number;
};

type CachedPayload = {
  statusCode: number;
  body: any;
};

const isRedisReady = (): boolean => {
  const client = redisClient as any;
  return Boolean(client?.isReady || client?.isOpen);
};

const buildCacheKey = (prefix: string, req: Request) => {
  const requestKey = req.originalUrl || req.url || "";
  return `${prefix}:${requestKey}`;
};

export const cacheResponse = ({ keyPrefix, ttlSeconds }: CacheOptions) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET") {
      return next();
    }

    const bypassHeader = String(req.headers["x-cache-bypass"] || "").toLowerCase();
    const bypassQuery = String((req.query as any)?.cache || "").toLowerCase();
    if (req.headers.authorization || bypassHeader === "true" || bypassQuery === "false") {
      return next();
    }

    if (!isRedisReady()) {
      return next();
    }

    const cacheKey = buildCacheKey(keyPrefix, req);

    try {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached) as CachedPayload;
        res.setHeader("X-Cache", "HIT");
        res.setHeader(
          "Cache-Control",
          `public, max-age=${ttlSeconds}, s-maxage=${ttlSeconds}`,
        );
        return res.status(parsed.statusCode || 200).json(parsed.body);
      }
    } catch (error) {
      logger.warn(`Cache read failed for ${cacheKey}: ${(error as Error).message}`);
    }

    const originalJson = res.json.bind(res);

    res.json = (body: any) => {
      if (res.statusCode < 400 && body?.success !== false) {
        const payload: CachedPayload = {
          statusCode: res.statusCode,
          body,
        };

        redisClient
          .set(cacheKey, JSON.stringify(payload), { EX: ttlSeconds })
          .catch((error) => {
            logger.warn(
              `Cache write failed for ${cacheKey}: ${(error as Error).message}`,
            );
          });
      }

      res.setHeader(
        "Cache-Control",
        `public, max-age=${ttlSeconds}, s-maxage=${ttlSeconds}`,
      );
      res.setHeader("X-Cache", "MISS");
      return originalJson(body);
    };

    return next();
  };
};

export const invalidateCacheByPrefix = async (prefix: string) => {
  if (!isRedisReady()) {
    return;
  }

  try {
    let cursor = "0";
    const pattern = `${prefix}:*`;

    do {
      const reply = await redisClient.scan(cursor, { MATCH: pattern, COUNT: 100 });
      cursor = reply.cursor;
      if (reply.keys.length > 0) {
        await redisClient.del(reply.keys);
      }
    } while (cursor !== "0");
  } catch (error) {
    logger.warn(
      `Cache invalidation failed for ${prefix}: ${(error as Error).message}`,
    );
  }
};
