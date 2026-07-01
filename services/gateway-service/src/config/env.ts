import 'dotenv/config';

import { z, createEnv } from '@chat-app-be/common';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  GATEWAY_SERVICE_PORT: z.coerce.number().int().min(0).max(65_535).default(4000),
  AUTH_SERVICE_URL: z.string().url(),
  USER_SERVICE_URL: z.string().url(),
  CHAT_SERVICE_URL: z.string().url(),
  INTERNAL_API_TOKEN: z.string().min(32),
  JWT_SECRET: z.string(),
});

type EnvType = z.infer<typeof envSchema>;

export const env: EnvType = createEnv(envSchema, { serviceName: 'gateway-service' });

export type Env = typeof env;
