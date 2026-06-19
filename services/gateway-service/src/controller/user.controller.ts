import { SearchUsersParams, userProxyService } from '@/services/user-proxy.service';
import { getAuthenticatedUser } from '@/utils/auth';
import { createUserSchema, searchUsersSchema, userIdSchema } from '@/validation/user.schema';
import { AsyncHandler } from '@chat-app-be/common/src';

export const getAllUsers: AsyncHandler<void> = async (req, res, next) => {
  try {
    const response = await userProxyService.getAllUser();
    res.json(response);
  } catch (error) {
    next(error);
  }
};

export const getUserById: AsyncHandler<void> = async (req, res, next) => {
  try {
    const params = userIdSchema.parse(req.params);
    const response = await userProxyService.getUserId(params.id);
    res.json(response);
  } catch (error) {
    next(error);
  }
};

export const createUser: AsyncHandler<void> = async (req, res, next) => {
  try {
    const payload = createUserSchema.parse(req.body);
    const response = await userProxyService.createUser(payload);
    res.status(201).json(response);
  } catch (error) {
    next(error);
  }
};

export const searchUsers: AsyncHandler<void> = async (req, res, next) => {
  try {
    const user = getAuthenticatedUser(req);
    const parsedQuery: SearchUsersParams = searchUsersSchema.parse(req.query);
    const { query, limit, exclude } = parsedQuery;

    const sanitizedExclude = Array.from(new Set([...(exclude ?? []), user.id]));
    const users = await userProxyService.searchUser({
      query,
      limit,
      exclude: sanitizedExclude,
    });
    res.json({ data: users });
  } catch (error) {
    next(error);
  }
};
