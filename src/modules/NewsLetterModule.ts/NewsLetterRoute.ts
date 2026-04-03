import NewsletterController from "./NewsLetterController";
import { NewsLetterValidate } from "./NewsLetterValidate";
import type { AppRouteDefinition } from "../../routes/route.types";

export const NewsLetterRoute: AppRouteDefinition[] = [
  {
    path: "/news-letter",
    request: NewsLetterValidate,
    action: NewsletterController.subscribe,
    method: "post",
  },
];
