import { Router, type Request, type Response, type NextFunction } from 'express';
import { asyncHandler } from '@chat-app-be/common';
import { getUsersController } from '@/controllers/users.controller';

export const usersRouter: Router = Router();

usersRouter.get(
  '/',
  asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
    await getUsersController(req, res);
  })
);
