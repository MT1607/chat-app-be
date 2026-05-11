import { register } from '@/services/auth.service';
import { RegisterInput } from '@/types/auth';
import { asyncHandler } from '@chat-app-be/common';
import { RequestHandler } from 'express';

export const registerHandler: RequestHandler = asyncHandler(async (req, res) => {
  const payload = req.body as RegisterInput;
  const tokens = await register(payload);
  res.status(201).json(tokens);
});
