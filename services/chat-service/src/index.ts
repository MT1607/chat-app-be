import { createApp } from '@/app';
import { createServer } from 'http';
import { env } from '@/config/env';
import { logger } from '@/utils/logger';
import { closeMongoClient, getMongoClient } from '@/clients/mongo.client';
import { closeRedis, connectRedis } from '@/clients/redis.client';
import { startConsumers } from './messaging/rabbitmq.consumer';

const main = async (): Promise<void> => {
  try {
    await Promise.all([getMongoClient(), connectRedis(), startConsumers()]);
    const app = createApp();
    const server = createServer(app);
    const port = env.CHAT_SERVICE_PORT;

    server.listen(port, () => {
      logger.info({ port }, 'Chat service is running');
    });

    const shutdown = () => {
      logger.info('Shutting down chat service');
      Promise.all([closeRedis(), closeMongoClient()]);

      server.close(() => {
        logger.info('Chat service shut down successfully');
        process.exit(0);
      });

      setTimeout(() => {
        logger.error('Graceful shutdown timeout, force exiting');
        process.exit(1);
      }, 10_000);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } catch (error) {
    logger.error(error, 'Failed to start chat service');
    process.exit(1);
  }
};

main().catch((error) => {
  logger.error(error, 'Fatal error');
  process.exit(1);
});
