import express, { Request } from "express";
import { MethodNotAllowedError } from "../handlers/httpError.handler";
import appApiRoutes from "./list";
import { catchErrors } from "../handlers/routeError.handler";
import validateData from "../utils/validation.utils";
import { verifyAccessToken } from "../middlewares/verifyToken.middleware";
import { hasRole, verifyPermission } from "../middlewares/hasPermission";

const router = express.Router();

function methodNotAllow(req: Request) {
  const method = req.method;
  throw new MethodNotAllowedError(
    "You are not allow to use " + method + " for this route"
  );
}
const publicApi = [
  "/about-us",
  "/services",
  "/services/active",
  "/plans",
  "/testimonials",
  "/faq",
  "/consultation",
  "/news-letter",
  "/countries",
  "/products",
  "/products/published",
  "/products/category/:categoryId",
  "/products/:productId",
  "/meetings/:id/recording"
];

appApiRoutes?.map(({ path, request, method, action,roles }: any) => {
  const isPublicRoute = publicApi.includes(path);

  const middlewares = isPublicRoute
    ? validateData(request)
    : [verifyAccessToken, hasRole(roles), validateData(request)];

  switch (method) {
    case "get":
      router.route(path).get(middlewares, catchErrors(action));
      break;

    case "post":
      router.route(path).post(middlewares, catchErrors(action));
      break;

    case "put":
      router.route(path).put(middlewares, catchErrors(action));
      break;

    case "patch":
      router.route(path).patch(middlewares, catchErrors(action));
      break;

    case "delete":
      router.route(path).delete(middlewares, catchErrors(action));
      break;

    default:
      break;
  }
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// router.stack.forEach(function(r:any){
//   if (r.route && r.route.path){
//     console.log(r.route.path)
//   }
// })

export default router;
