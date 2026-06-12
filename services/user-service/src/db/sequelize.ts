import { Sequelize } from 'sequelize';

import { env } from '@/config/env';
import { logger } from '@/utils/logger';

export const sequelize = new Sequelize(env.USER_SERVICE_DB_URL, {
  dialect: 'postgres',
  logging:
    env.NODE_ENV === 'development' ? (msg: unknown) => logger.debug({ sequelize: msg }) : false,
  define: {
    underscored: true,
    freezeTableName: true,
  },
});

export const connectToDatabase = async () => {
  try {
    await sequelize.authenticate();
    logger.info('Connection to the database has been established successfully.');
  } catch (error) {
    logger.error({ error }, 'Unable to connect to the database:');
    throw error;
  }
};

export const disconnectFromDatabase = async () => {
  try {
    await sequelize.close();
    logger.info('Connection to the database has been closed successfully.');
  } catch (error) {
    logger.error({ error }, 'Unable to disconnect from the database:');
    throw error;
  }
};
