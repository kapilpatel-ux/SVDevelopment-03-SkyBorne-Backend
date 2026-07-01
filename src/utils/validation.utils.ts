import { NextFunction, Request, Response } from "express";
import { ValidationError } from "yup";
import { logger } from "./winston.utils";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const validateData =
  (schema: any) => async (req: Request, res: Response, next: NextFunction) => {
    if (!schema) return next();

    try {
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

        return res.status(422).json({
          success: false,
          message: `Validation Errors. ${err.errors[0]}`,
          data: err.errors,
        });
      }

      logger.error(
        `
          Validation middleware unexpected error: ${
            err instanceof Error ? err.message : JSON.stringify(err)
          }
          Request route: ${req.originalUrl}
        `
      );

      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  };

export default validateData;
