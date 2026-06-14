import {
  loginHandler,
  refreshTokenHandler,
  registerHandler,
  revokeTokensHandler,
} from '@/controllers/auth.controller';
import { validateRequest } from '@chat-app-be/common';
import { Router } from 'express';
import { loginSchema, refreshSchema, registerSchema, revokeSchema } from '@/routes/auth.schema';

export const authRouter: Router = Router();

authRouter.post('/register', validateRequest({ body: registerSchema.shape.body }), registerHandler);
authRouter.post('/login', validateRequest({ body: loginSchema.shape.body }), loginHandler);
authRouter.post(
  '/refresh',
  validateRequest({ body: refreshSchema.shape.body }),
  refreshTokenHandler
);
authRouter.post('/revoke', validateRequest({ body: revokeSchema.shape.body }), revokeTokensHandler);
