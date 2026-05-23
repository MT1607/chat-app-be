import {
  AUTH_EVENT_EXCHANGE,
  AUTH_USER_REGISTERED_ROUTING_KEY,
  type AuthUserRegisteredPayload,
} from '@chat-app-be/common/src';

import { connect, type Channel, type ChannelModel } from 'amqplib';
import { logger } from '@/utils/logger';
import { env } from '@/config/env';

let connectionRef: ChannelModel | null = null;
let channel: Channel | null = null;

export const initPublisher = async (): Promise<void> => {
  if (!env.RABBITMQ_URL) {
    logger.warn('RabbitMQ URL is not defined. Event publishing will be disabled.');
    return;
  }

  if (channel) {
    return;
  }

  const connection = await connect(env.RABBITMQ_URL);
  connectionRef = connection;
  channel = await connection.createChannel();
  await channel.assertExchange(AUTH_EVENT_EXCHANGE, 'topic', { durable: true });

  connection.on('close', () => {
    logger.warn('RabbitMQ connection closed.');
    channel = null;
    connectionRef = null;
  });
  connection.on('error', (err) => {
    logger.error({ err }, 'RabbitMQ connection error.');
    channel = null;
    connectionRef = null;
  });
  logger.info('RabbitMQ publisher initialized.');
};

export const publishAuthUserRegistered = async (
  payload: AuthUserRegisteredPayload
): Promise<void> => {
  if (!channel) {
    logger.warn('RabbitMQ channel is not initialized. Cannot publish event.');
    return;
  }

  const event = {
    type: AUTH_USER_REGISTERED_ROUTING_KEY,
    payload,
    occurredAt: new Date().toISOString(),
    metadata: { version: '1.0.0' },
  };

  const messageBuffer = Buffer.from(JSON.stringify(event));
  const published = channel.publish(
    AUTH_EVENT_EXCHANGE,
    AUTH_USER_REGISTERED_ROUTING_KEY,
    messageBuffer,
    {
      contentType: 'application/json',
      persistent: true,
    }
  );

  if (!published) {
    logger.warn({ payload }, 'Failed to publish AuthUserRegistered event.');
  }
  logger.info({ payload }, 'Published AuthUserRegistered event.');
};

export const closePublisher = async (): Promise<void> => {
  try {
    const ch = channel;
    const conn = connectionRef;

    if (ch) {
      await ch.close();
      channel = null;
    }

    if (conn) {
      await conn.close();
      connectionRef = null;
    }
  } catch (error) {
    logger.error({ err: error }, 'Error closing RabbitMQ publisher.');
  }
};
