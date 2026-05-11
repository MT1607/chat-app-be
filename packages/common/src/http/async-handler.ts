import { Request, Response, NextFunction, RequestHandler } from 'express';
export type AsyncHandler<T> = (req: Request, res: Response, next: NextFunction) => Promise<T>;

const toError = (err: unknown): Error => {
  if (err instanceof Error) {
    return err;
  }
  return new Error(String(err));
};

const forwardError = (err: unknown, next: ErrorForwarder): void => {
  next(toError(err));
};

type ErrorForwarder = (err: unknown) => void;

export const asyncHandler = <T>(handler: AsyncHandler<T>): RequestHandler => {
  return (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res, next).catch((err) => forwardError(err, next));
  };
};
