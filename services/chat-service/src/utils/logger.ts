import { createLogger } from '@chat-app-be/common';
import type { Logger } from '@chat-app-be/common';

export const logger: Logger = createLogger({ name: 'chat-service' });
