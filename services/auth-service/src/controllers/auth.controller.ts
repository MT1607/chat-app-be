import { login, refreshTokens, register, revokeRefreshTokens } from '@/services/auth.service';
import { LoginInput, RegisterInput } from '@/types/auth';
import { asyncHandler, HttpError } from '@chat-app-be/common';
import { RequestHandler } from 'express';

export const registerHandler: RequestHandler = asyncHandler(async (req, res) => {
  const payload = req.body as RegisterInput;
  const tokens = await register(payload);
  res.status(201).json(tokens);
});

export const loginHandler: RequestHandler = asyncHandler(async (req, res) => {
  // Implementation for login handler
  const payload = req.body as LoginInput;
  const tokens = await login(payload);
  res.json(tokens);
});

export const refreshTokenHandler: RequestHandler = asyncHandler(async (req, res) => {
  // Implementation for refresh token handler
  const { refreshToken } = req.body as { refreshToken?: string };
  if (!refreshToken) {
    throw new HttpError(400, 'Refresh token is required');
  }

  const newTokens = await refreshTokens(refreshToken);
  res.json(newTokens);
});

export const revokeTokensHandler: RequestHandler = asyncHandler(async (req, res) => {
  const { userId } = req.body as { userId?: string };
  if (!userId) {
    throw new HttpError(400, 'User ID is required');
  }
  await revokeRefreshTokens(userId);
  res.status(204).send();
});
