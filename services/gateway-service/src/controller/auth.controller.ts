import { authProxyService } from '@/services/auth-proxy.services';
import { registerSchema } from '@/validation/auth.schema';
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
