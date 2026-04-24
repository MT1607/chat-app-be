import { z } from 'zod';
import { HttpError } from '../error/http-error';
import { Request, Response, NextFunction } from 'express';
import { ZodTypeAny, ZodError, AnyZodObject } from 'zod';

type Schema = AnyZodObject | ZodTypeAny;
type ParamsRecord = Record<string, string>;
type QueryRecord = Record<string, unknown>;

export interface RequestValidateSchema {
  body?: Schema;
  params?: Schema;
  query?: Schema;
}

const formatedError = (error: ZodError) => {
  return error.errors.map((err) => ({
    path: err.path.join('.'),
    message: err.message,
  }));
};

export const validateRequest = (schemas: RequestValidateSchema) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (schemas.body) {
        const parsedBody = schemas.body.parse(req.body) as unknown;
        req.body = parsedBody;
      }
      if (schemas.params) {
        const parsedParams = schemas.params.parse(req.params) as ParamsRecord;
        req.params = parsedParams as Request['params'];
      }
      if (schemas.query) {
        const parsedQuery = schemas.query.parse(req.query) as QueryRecord;
        req.query = parsedQuery as Request['query'];
      }

      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const formattedErrors = formatedError(error);
        next(new HttpError(422, 'Validation Error', { issues: formattedErrors }));
      }

      next(error);
    }
  };
};
