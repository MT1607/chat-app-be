import 'dotenv/config';

import { z, createEnv } from '@chat-app-be/common';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  USER_SERVICE_PORT: z.coerce.number().int().min(0).max(65_535).default(4001),
  USER_SERVICE_DB_URL: z.string().url(),
  RABBITMQ_URL: z.string().url().optional(),
  INTERNAL_API_TOKEN: z.string().min(16),
});

type EnvType = z.infer<typeof envSchema>;

export const env: EnvType = createEnv(envSchema, { serviceName: 'user-service' });

export type Env = typeof env;
