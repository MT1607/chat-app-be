import { createUser, getAllUsers, getUserById, searchUsers } from '@/controller/user.controller';
import { requiredAuth } from '@/middleware/require-auth';
import { createUserSchema, searchUsersSchema, userIdSchema } from '@/validation/user.schema';
import { asyncHandler, validateRequest } from '@chat-app-be/common/src';
import { Router } from 'express';

export const userRouter: Router = Router();

userRouter.get('/', requiredAuth, asyncHandler(getAllUsers));
userRouter.get(
  '/search',
  requiredAuth,
  validateRequest({ query: searchUsersSchema }),
  asyncHandler(searchUsers)
);
userRouter.get(
  '/:id',
  requiredAuth,
  validateRequest({ params: userIdSchema }),
  asyncHandler(getUserById)
);
userRouter.post(
  '/',
  requiredAuth,
  validateRequest({ body: createUserSchema }),
  asyncHandler(createUser)
);
