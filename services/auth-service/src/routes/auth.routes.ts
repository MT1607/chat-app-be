import { registerHandler } from '@/controllers/auth.controller';
import { validateRequest } from '@chat-app-be/common';
import { Router } from 'express';
import { registerSchema } from '@/routes/auth.schema';

export const authRouter: Router = Router();

authRouter.post('/register', validateRequest({ body: registerSchema.shape.body }), registerHandler);
