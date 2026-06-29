import { Router } from 'express';
import { conversationRouter } from '@/routes/conversation.routes';

export const registerRoutes = (app: Router) => {
  app.use('/conversations', conversationRouter);
};
