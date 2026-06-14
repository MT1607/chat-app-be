import { loginUser, refreshTokens, registerUser, revokeTokens } from '@/controller/auth.controller';
import { loginSchema, refreshSchema, registerSchema, revokeSchema } from '@/validation/auth.schema';
import { asyncHandler, validateRequest } from '@chat-app-be/common/src';
import { Router } from 'express';

export const authRouter: Router = Router();

authRouter.post('/register', validateRequest({ body: registerSchema }), asyncHandler(registerUser));
authRouter.post('/login', validateRequest({ body: loginSchema }), asyncHandler(loginUser));
authRouter.post('/refresh', validateRequest({ body: refreshSchema }), asyncHandler(refreshTokens));
authRouter.post('/revoke', validateRequest({ body: revokeSchema }), asyncHandler(revokeTokens));
