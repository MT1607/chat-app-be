import { z } from '@chat-app-be/common/src';

export const createUserSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(1).max(255),
});

export const userIdParamSchema = z.object({
  id: z.string().uuid(),
});

const excludeSchema = z
  .union([
    z.array(z.string().uuid()),
    z
      .string()
      .uuid()
      .transform((v) => [v]),
  ])
  .optional()
  .transform((v) => v ?? []);

export const searchUsersQuerySchema = z.object({
  query: z.string().min(1).max(255),
  limit: z
    .union([z.string(), z.number()])
    .transform((value) => Number(value))
    .refine((value) => !isNaN(value) && value > 0 && value <= 25, {
      message: 'Limit must be between 1 and 25',
    })
    .optional(),
  exclude: excludeSchema,
});

export type SearchUsersQuery = z.infer<typeof searchUsersQuerySchema>;
export type CreateUserBody = z.infer<typeof createUserSchema>;
export type UserIdParam = z.infer<typeof userIdParamSchema>;
