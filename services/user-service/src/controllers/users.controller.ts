import { userService } from '@/services/user.service';
import { CreateUserBody, SearchUsersQuery } from '@/validation/user.schema';
import { AsyncHandler } from '@chat-app-be/common/src';
import type { Request, Response } from 'express';

export const getUser: AsyncHandler<void> = async (req, res, next) => {
  try {
    const { id } = req.params as unknown as { id: string };
    const user = await userService.getUserById(id);
    res.json({ data: user });
  } catch (error) {
    next(error);
  }
};

export const getAllUsers: AsyncHandler<void> = async (req, res, next) => {
  try {
    const users = await userService.getAllUsers();
    res.json({ data: users });
  } catch (error) {
    next(error);
  }
};

export const createUser: AsyncHandler<void> = async (req, res, next) => {
  try {
    const userData = req.body as CreateUserBody;
    const user = await userService.createUser(userData);
    res.status(201).json({ data: user });
  } catch (error) {
    next(error);
  }
};

export const searchUsers: AsyncHandler<void> = async (req, res, next) => {
  try {
    const { query, limit, exclude } = req.query as unknown as SearchUsersQuery;
    const user = await userService.searchUsers({
      query,
      excludeIds: exclude,
      limit,
    });

    res.json({ data: user });
  } catch (error) {
    next(error);
  }
};
