import { authProxyService } from '@/services/auth-proxy.service';
import { loginSchema, refreshSchema, registerSchema, revokeSchema } from '@/validation/auth.schema';
import { AsyncHandler } from '@chat-app-be/common/src';

export const registerUser: AsyncHandler<void> = async (req, res, next) => {
  try {
    const payload = registerSchema.parse(req.body);
    const response = await authProxyService.register(payload);
    res.status(201).json(response);
  } catch (error) {
    next(error);
  }
};

export const loginUser: AsyncHandler<void> = async (req, res, next) => {
  try {
    const payload = loginSchema.parse(req.body);
    const response = await authProxyService.login(payload);
    res.json(response);
  } catch (error) {
    next(error);
  }
};

export const refreshTokens: AsyncHandler<void> = async (req, res, next) => {
  try {
    const payload = refreshSchema.parse(req.body);
    const response = await authProxyService.refreshTokens(payload);
    res.json(response);
  } catch (error) {
    next(error);
  }
};

export const revokeTokens: AsyncHandler<void> = async (req, res, next) => {
  try {
    const payload = revokeSchema.parse(req.body);
    const response = await authProxyService.revokeTokens(payload);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
};
