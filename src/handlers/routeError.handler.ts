/*
  Catch Errors Handler

  With async/await, you need some way to catch errors
  Instead of using try{} catch(e) {} in each controller, we wrap the function in
  catchErrors(), catch any errors they throw, and pass it along to our express middleware with next()
*/

import { NextFunction, Request, Response } from 'express';
import { HttpError } from './httpError.handler';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function catchErrors(fn: any) {
  return function (req: Request, res: Response, next: NextFunction) {
    return fn(req, res, next).catch((error: Error) => {
      if (error.name === 'ValidationError') {
        return res.status(400).json({
          success: false,
          message: 'Required fields are not supplied',
        });
      }

      if (error instanceof HttpError) {
        return next(error);
      }

      console.error(
        `[catchErrors] Controller "${fn.name || 'anonymous'}" failed:`,
        error
      );

      return next(error);
    });
  };
}

/*
    Not Found Error Handler
  
    If we hit a route that is not found, we mark it as 404 and pass it along to the next error handler to display
  */
export function routeNotFound(req: Request, res: Response) {
  return res.status(404).json({
    success: false,
    message: "Endpoints doesn't exist.",
  });
}
