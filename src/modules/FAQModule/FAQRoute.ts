import FAQController from "./FAQController";
import { cacheResponse } from "../../middlewares/cache.middleware";
import type { AppRouteDefinition } from "../../routes/route.types";

const faqCache = cacheResponse({ keyPrefix: "faq", ttlSeconds: 600 });

export const FAQRoute: AppRouteDefinition[] = [
  {
    path: "/faq",
    request: null,
    action: FAQController.getAll,
    method: "get",
    cache: faqCache,
  },
];
