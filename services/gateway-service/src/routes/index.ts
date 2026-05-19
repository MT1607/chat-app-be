import { Router } from 'express';
import { authRouter } from '@/routes/auth.routes';

export const registerRoutes = (app: Router) => {
  // Routes will be registered here
  app.use('/auth', authRouter);
};
