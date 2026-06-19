import { env } from '@/config/env';
import { AuthenticatedUser, HttpError } from '@chat-app-be/common/src';
import { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';

interface AccessTokenClaims {
  sub: string;
  email?: string;
}

const parseAuthorizationHeader = (value: string | undefined): string => {
  if (!value) {
    throw new HttpError(401, 'Unauthorized');
  }

  const [schema, token] = value.split(' ');
  if (schema.toLowerCase() !== 'bearer' || !token) {
    throw new HttpError(401, 'Unauthorized');
  }

  return token;
};

const toAuthenticatedUser = (claims: AccessTokenClaims): AuthenticatedUser => {
  if (!claims.sub) {
    throw new HttpError(401, 'Unauthorized');
  }

  return {
    id: claims.sub,
    email: claims.email,
  };
};

export const requiredAuth: RequestHandler = (req, _res, next) => {
  try {
    const token = parseAuthorizationHeader(req.headers.authorization);
    const claims = jwt.verify(token, env.JWT_SECRET) as AccessTokenClaims;
    req.user = toAuthenticatedUser(claims);
  } catch (error) {
    if (error instanceof HttpError) {
      next(error);
      return;
    }
    next(new HttpError(401, 'Unauthorized'));
  }
};
