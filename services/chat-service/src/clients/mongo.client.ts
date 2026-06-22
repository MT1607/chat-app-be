import { env } from '@/config/env';
import { logger } from '@/utils/logger';
import { MongoClient } from 'mongodb';

export { MongoClient } from 'mongodb';

let client: MongoClient | null = null;
export const getMongoClient = async () => {
  if (client) {
    return client;
  }

  const mongoUrl = env.MONGO_URL;
  client = new MongoClient(mongoUrl);
  await client.connect();
  logger.info('MongoDB connection established');

  return client;
};

export const closeMongoClient = async () => {
  if (!client) {
    return;
  }

  await client.close();
  logger.info('MongoDB connection closed');
  client = null;
};
