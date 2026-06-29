import { HttpError, USER_ID_HEADER, z } from '@chat-app-be/common/src';
import { RequestHandler } from 'express';

const userIdSchema = z.string().uuid();

export const attachAuthenticatiedUser: RequestHandler = (req, _res, next) => {
  try {
    const headerValue = req.header(USER_ID_HEADER);
    const userId = userIdSchema.parse(headerValue);
    req.user = { id: userId };
  } catch (error) {
    next(new HttpError(401, 'Invalid or missing user context'));
  }
};
