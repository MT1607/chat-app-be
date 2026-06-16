import { env } from '@/config/env';
import { logger } from '@/utils/logger';
import amqplib, { Channel, ChannelModel, Connection } from 'amqplib';
import {
  UserCreatedPayload,
  USER_CREATED_ROUTING_KEY,
  USER_EVENT_EXCHANGE,
  UserCreatedEvent,
} from '@chat-app-be/common';

type ManagedConnection = Connection & Pick<ChannelModel, 'close' | 'createChannel' | 'on'>;

let connection: ManagedConnection | null = null;
let channel: Channel | null = null;

const messagingEnabled = Boolean(env.RABBITMQ_URL);

const ensureChannel = async (): Promise<Channel | null> => {
  if (!messagingEnabled) {
    return null;
  }

  if (channel) {
    return channel;
  }

  if (!env.RABBITMQ_URL) {
    return null;
  }

  const amqpConnection = (await amqplib.connect(env.RABBITMQ_URL)) as unknown as ManagedConnection;
  connection = amqpConnection;
  amqpConnection.on('close', () => {
    connection = null;
    channel = null;
  });

  amqpConnection.on('error', (err) => {
    logger.error({ err: err }, 'AMQP connection error');
    connection = null;
    channel = null;
  });

  const amqpChannel = await amqpConnection.createChannel();
  channel = amqpChannel;
  await amqpChannel.assertExchange('user-events', 'topic', { durable: true });
  return amqpChannel;
};

export const initMessaging = async () => {
  if (!messagingEnabled) {
    logger.info('RABBITMQ_URL is not defined. Messaging features will be disabled.');
    return;
  }

  await ensureChannel();
  logger.info('User service RabbitMQ initialized');
};

export const closeMessaging = async () => {
  try {
    if (channel) {
      const currentChannel = channel;
      channel = null;
      await currentChannel.close();
    }
    if (connection) {
      const currentConnection: ManagedConnection = connection;
      connection = null;
      await currentConnection.close();
    }

    logger.info('User service RabbitMQ pushlisher closed');
  } catch (error) {
    logger.error({ err: error }, 'Error occurred while closing RabbitMQ connection/channel');
  }
};

export const publishUserCreatedEvent = async (payload: UserCreatedPayload) => {
  const ch = await ensureChannel();
  if (!ch) {
    logger.debug({ payload }, 'Skipping user.created event publish; messaging disabled');
    return;
  }

  const event: UserCreatedEvent = {
    type: USER_CREATED_ROUTING_KEY,
    payload,
    occurredAt: new Date().toISOString(),
    metadata: { version: 1 },
  };
  try {
    const success = ch.publish(
      USER_EVENT_EXCHANGE,
      USER_CREATED_ROUTING_KEY,
      Buffer.from(JSON.stringify(event)),
      { contentType: 'application/json', persistent: true }
    );

    if (!success) {
      logger.warn(
        { event },
        'Failed to publish user.created event; message was not sent to RabbitMQ'
      );
    }
  } catch (error) {
    logger.error({ err: error }, 'Error occurred while publishing user.created event');
  }
};
