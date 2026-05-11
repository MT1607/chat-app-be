import { Router } from 'express';
import { authRouter } from '@/routes/auth.routes';

export const registerRoutes = (app: Router) => {
  app.use('/auth', authRouter);
};
