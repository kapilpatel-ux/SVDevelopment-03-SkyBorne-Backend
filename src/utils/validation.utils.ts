import { NextFunction, Request, Response } from "express";
import { ValidationError } from "yup";
import { logger } from "./winston.utils";
import { UnprocessableEntityError } from "../handlers/httpError.handler";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const validateData =
  (schema: any) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!schema) return next();
      await schema.validate(
        {
          body: req.body,
          query: req.query,
          params: req.params,
        },
        { abortEarly: false }
      );
      return next();
    } catch (err) {
      if (err instanceof ValidationError) {
        logger.error(
          `
          Validation Error: ${JSON.stringify(err.errors)} 
          Request body: ${JSON.stringify(req.body)} 
          Request route: ${req.originalUrl}
        `
        );

        return next(
          new UnprocessableEntityError("Validation failed", {
            errors: err.errors,
          })
        );
      }
      return next(err as Error);
    }
  };

export default validateData;
