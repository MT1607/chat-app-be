import { createApp } from '@/app';
import { createServer } from 'http';
import { env } from '@/config/env';
import { logger } from '@/utils/logger';
import { connectToDatabase } from '@/db/sequelize';

const main = async (): Promise<void> => {
  try {
    await connectToDatabase();

    const app = createApp();
    const server = createServer(app);
    const port = env.USER_SERVICE_PORT;

    server.listen(port, () => {
      logger.info({ port }, 'User service is running');
    });

    const shutdown = () => {
      logger.info('Shutting down user service');

      Promise.all([])
        .catch((error) => {
          logger.error({ error }, 'Error during shutdown');
        })
        .finally(() => {
          server.close(() => process.exit(0));
        });
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (error) {
    logger.error(error);
    process.exit(1);
  }
};

main();
