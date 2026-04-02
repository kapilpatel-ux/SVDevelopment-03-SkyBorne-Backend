import type { Request, Response, NextFunction } from "express";
import * as jwt from "jsonwebtoken";
import { verifyToken } from "../config/jwt";
import { UnauthorizedError } from "../handlers/httpError.handler";


export interface AuthRequest extends Request {
  user?: any; // you can type this better based on your TokenPayload
}

export function verifyAccessToken(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    // 1️⃣ Read header
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new UnauthorizedError("No token provided");
    }

    // 2️⃣ Extract token
    const token = authHeader.split(" ")[1];

    // 3️⃣ Verify token
    const decoded = verifyToken(token);

    // 4️⃣ Attach user data to req
    req.user = decoded;

    // 5️⃣ Continue
    return next();
  } catch (error) {
    return next(new UnauthorizedError("Invalid or expired token"));
  }
}
