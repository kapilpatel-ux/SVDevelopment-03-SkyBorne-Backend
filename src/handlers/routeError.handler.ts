/*
  Catch Errors Handler

  With async/await, you need some way to catch errors
  Instead of using try{} catch(e) {} in each controller, we wrap the function in
  catchErrors(), catch any errors they throw, and pass it along to our express middleware with next()
*/

import { NextFunction, Request, Response } from "express";
import { NotFoundError } from "./httpError.handler";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function catchErrors(fn: any) {
  return function (req: Request, res: Response, next: NextFunction) {
    return Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/*
    Not Found Error Handler
  
    If we hit a route that is not found, we mark it as 404 and pass it along to the next error handler to display
  */
export function routeNotFound(req: Request, res: Response, next: NextFunction) {
  return next(new NotFoundError("Endpoint does not exist"));
}
