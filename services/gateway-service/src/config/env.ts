import 'dotenv/config';

import { z, createEnv } from '@chat-app-be/common';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  GATEWAY_SERVICE_PORT: z.coerce.number().int().min(0).max(65_535).default(4000),
  AUTH_SERVICE_URL: z.string().url().default('http://localhost:4003'),
});

type EnvType = z.infer<typeof envSchema>;

export const env: EnvType = createEnv(envSchema, { serviceName: 'gateway-service' });

export type Env = typeof env;
