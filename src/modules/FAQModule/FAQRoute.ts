import FAQController from "./FAQController";
import { cacheResponse } from "../../middlewares/cache.middleware";

const faqCache = cacheResponse({ keyPrefix: "faq", ttlSeconds: 600 });

export const FAQRoute = [
  {
    path: "/faq",
    request: null,
    action: FAQController.getAll,
    method: "get",
    cache: faqCache,
  },
];
