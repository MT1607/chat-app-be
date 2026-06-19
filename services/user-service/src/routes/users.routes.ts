import { Router } from 'express';
import { asyncHandler, validateRequest } from '@chat-app-be/common';
import { createUser, getAllUsers, getUser, searchUsers } from '@/controllers/users.controller';
import {
  createUserSchema,
  searchUsersQuerySchema,
  userIdParamSchema,
} from '@/validation/user.schema';

export const usersRouter: Router = Router();

usersRouter.get(
  '/search',
  validateRequest({ query: searchUsersQuerySchema }),
  asyncHandler(searchUsers)
);

// Get all users
usersRouter.get('/', asyncHandler(getAllUsers));

// Get user by ID
usersRouter.get('/:id', validateRequest({ params: userIdParamSchema }), asyncHandler(getUser));

// Create user
usersRouter.post('/', validateRequest({ body: createUserSchema }), asyncHandler(createUser));
