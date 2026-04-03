import type { NextFunction, Request, Response } from "express";
import type { RequestHandler } from "express";

export type RouteMethod = "get" | "post" | "put" | "patch" | "delete";

export type RouteAction = (
  req: Request,
  res: Response,
  next: NextFunction
) => Promise<unknown> | unknown;

export interface AppRouteDefinition {
  path: string;
  method: RouteMethod;
  action: RouteAction;
  request?: unknown;
  roles?: string[];
  cache?: RequestHandler;
}

export interface AuthRouteDefinition {
  name: string;
  method: "get" | "post";
  action: RouteAction;
  middleware?: RequestHandler | RequestHandler[] | null;
}
