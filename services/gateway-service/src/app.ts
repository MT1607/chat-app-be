import express, { type Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { errorHandle } from '@/middleware/error-handle';
import { registerRoutes } from '@/routes';
import { createInternalAuthMiddleware } from '@chat-app-be/common/src';
import { env } from './config/env';

export const createApp = (): Application => {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: '*',
      credentials: true,
    })
  );
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(
    createInternalAuthMiddleware(env.INTERNAL_AUTH_TOKEN, {
      headerName: 'x-internal-token',
    })
  );

  registerRoutes(app);

  app.use((_req, res) => {
    res.status(404).json({ message: 'Not Found' });
  });

  app.use(errorHandle);

  return app;
};
