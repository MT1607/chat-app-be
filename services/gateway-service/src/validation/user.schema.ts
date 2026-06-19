import { z } from 'zod';

export const createUserSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(3).max(50),
});

export const searchUsersSchema = z.object({
  query: z.string().min(1),
  limit: z.number().positive().optional(),
  exclude: z.array(z.string().uuid()).optional(),
});

export const updateUserSchema = z
  .object({
    displayName: z.string().min(3).max(50).optional(),
    email: z.string().email().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided for update',
  });

export const userIdSchema = z.object({
  id: z.string().uuid(),
});

// Type inference from schemas
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type SearchUsersInput = z.infer<typeof searchUsersSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type UserIdInput = z.infer<typeof userIdSchema>;
