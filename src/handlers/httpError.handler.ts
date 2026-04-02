import { NextFunction, Request, Response } from "express";
import { ValidationError as YupValidationError } from "yup";

export type ErrorDetails = Record<string, unknown> | null;

export type ErrorResponse = {
  success: false;
  code: string;
  message: string;
  details: ErrorDetails;
  traceId: string;
};

export const buildErrorResponse = ({
  code,
  message,
  details,
  traceId,
}: {
  code: string;
  message: string;
  details?: ErrorDetails;
  traceId: string;
}): ErrorResponse => ({
  success: false,
  code,
  message,
  details: details ?? null,
  traceId,
});

export class HttpError extends Error {
  statusCode: number = 400;
  code: string;
  details?: ErrorDetails;
  constructor(
    statusCode: number,
    code: string,
    message: string | undefined,
    details?: ErrorDetails
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details ?? null;
  }
}

export class UnauthorizedError extends HttpError {
  constructor(message: string | undefined = "Unauthorized", details?: ErrorDetails) {
    super(401, "UNAUTHORIZED", message, details);
  }
}

export class BadRequestError extends HttpError {
  constructor(message: string | undefined = "Bad request", details?: ErrorDetails) {
    super(400, "BAD_REQUEST", message, details);
  }
}

export class ForbiddenError extends HttpError {
  constructor(message: string | undefined = "Forbidden", details?: ErrorDetails) {
    super(403, "FORBIDDEN", message, details);
  }
}

export class NotFoundError extends HttpError {
  constructor(message: string | undefined = "Not found", details?: ErrorDetails) {
    super(404, "NOT_FOUND", message, details);
  }
}

export class MethodNotAllowedError extends HttpError {
  constructor(message: string | undefined = "Method not allowed", details?: ErrorDetails) {
    super(405, "METHOD_NOT_ALLOWED", message, details);
  }
}

export class ConflictError extends HttpError {
  constructor(message: string | undefined = "Conflict", details?: ErrorDetails) {
    super(409, "CONFLICT", message, details);
  }
}

export class UnprocessableEntityError extends HttpError {
  constructor(message: string | undefined = "Validation failed", details?: ErrorDetails) {
    super(422, "VALIDATION_ERROR", message, details);
  }
}

export class InternalServerError extends HttpError {
  constructor(
    message: string | undefined = "Internal server error",
    details?: ErrorDetails
  ) {
    super(500, "INTERNAL_SERVER_ERROR", message, details);
  }
}

const extractValidationDetails = (err: unknown): ErrorDetails => {
  if (err instanceof YupValidationError) {
    return { errors: err.errors };
  }

  const mongooseErrors = (err as any)?.errors;
  if (mongooseErrors && typeof mongooseErrors === "object") {
    const errors = Object.values(mongooseErrors)
      .map((entry: any) => entry?.message)
      .filter(Boolean);
    return { errors };
  }

  const fallbackErrors = (err as any)?.errors;
  if (Array.isArray(fallbackErrors)) {
    return { errors: fallbackErrors };
  }

  return null;
};

export async function httpErrorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) {
  const traceHeader = req.headers["x-trace-id"] || req.headers["x-request-id"];
  const traceId =
    res.locals?.traceId ||
    (Array.isArray(traceHeader) ? traceHeader[0] : traceHeader) ||
    "unknown";

  res.setHeader("X-Trace-Id", traceId);

  let statusCode = 500;
  let code = "INTERNAL_SERVER_ERROR";
  let message = "Internal server error";
  let details: ErrorDetails = null;

  if (err instanceof HttpError) {
    statusCode = err.statusCode;
    code = err.code;
    message = err.message || message;
    details = err.details ?? null;
  } else if (err instanceof YupValidationError || (err as any)?.name === "ValidationError") {
    statusCode = 422;
    code = "VALIDATION_ERROR";
    message = "Validation failed";
    details = extractValidationDetails(err);
  } else if (err instanceof SyntaxError && "body" in err) {
    statusCode = 400;
    code = "BAD_REQUEST";
    message = "Invalid JSON payload";
  } else {
    console.error(`[${traceId}] Unhandled error:`, err);
  }

  return res
    .status(statusCode)
    .json(buildErrorResponse({ code, message, details, traceId }));
}
