import { Router } from 'express';
import { authRouter } from '@/routes/auth.routes';
import { userRouter } from '@/routes/user.routes';
import { chatRouter } from '@/routes/chat.routes';

export const registerRoutes = (app: Router) => {
  app.use('/auth', authRouter);
  app.use('/users', userRouter);
  app.use('/conversations', chatRouter);
};
