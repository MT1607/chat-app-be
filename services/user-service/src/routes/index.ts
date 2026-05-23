import { Router } from 'express';
import { usersRouter } from '@/routes/users.routes';

export const registerRoutes = (app: Router) => {
  app.use('/users', usersRouter);
};
