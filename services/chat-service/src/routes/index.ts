import { Router } from 'express';
import { chatRouter } from '@/routes/chat.routes';

export const registerRoutes = (app: Router) => {
  app.use('/chat', chatRouter);
};
