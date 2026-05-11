import 'dotenv/config';

import { z, createEnv } from '@chat-app-be/common';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  AUTH_SERVICE_PORT: z.coerce.number().int().min(0).max(65_535).default(4003),
  AUTH_SERVICE_DB_URL: z.string().url(),
  JWT_SECRET: z.string(),
  JWT_EXPIRES_IN: z.string().default('1d'),
  JWT_REFRESH_SECRET: z.string(),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),
});

type EnvType = z.infer<typeof envSchema>;

export const env: EnvType = createEnv(envSchema, { serviceName: 'auth-service' });

export type Env = typeof env;
