import { env } from '@/config/env';
import { userRepository } from '@/repositories/user.repository';
import { logger } from '@/utils/logger';
import {
  USER_CREATED_ROUTING_KEY,
  USER_EVENT_EXCHANGE,
  UserCreatedEvent,
} from '@chat-app-be/common/src';
import { ChannelModel, connect, Connection, ConsumeMessage, type Channel, Replies } from 'amqplib';

let connection: ChannelModel | null = null;
let channel: Channel | null = null;
let consumerTag: string | null = null;

const EVENT_QUEUE = 'chat-service.user-events';

const closeAmqpConnection = async (conn: ChannelModel) => {
  await conn.close();
};

const handleUserCreated = async (event: UserCreatedEvent) => {
  await userRepository.upsertUser(event.payload);
};

export const startConsumers = async () => {
  if (!env.RABBITMQ_URL) {
    logger.info('RABBITMQ_URL is not defined. Skipping auth consumer setup.');
    return;
  }

  if (channel) {
    logger.info('Auth consumer is already running.');
    return;
  }

  const conn = await connect(env.RABBITMQ_URL);
  connection = conn;
  const ch = await connection.createChannel();
  channel = ch;

  await ch.assertExchange(USER_EVENT_EXCHANGE, 'topic', { durable: true });
  const q = await ch.assertQueue(EVENT_QUEUE, { durable: true });
  await ch.bindQueue(q.queue, USER_EVENT_EXCHANGE, USER_CREATED_ROUTING_KEY);

  const consumeHandler = (msg: ConsumeMessage | null) => {
    if (!msg) {
      return;
    }

    void (async () => {
      const raw = msg?.content.toString();
      const event = JSON.parse(raw || '{}') as UserCreatedEvent;

      await handleUserCreated(event);
      ch.ack(msg!);
    })().catch((err: unknown) => {
      logger.error({ err: err }, 'Failed to process event');
      ch.nack(msg, false, false);
    });
  };

  const result: Replies.Consume = await ch.consume(q.queue, consumeHandler);
  consumerTag = result.consumerTag;
  logger.info('RabbitMQ consumer started');
};

export const stopAuthConsumer = async () => {
  try {
    const ch = channel;
    if (ch && consumerTag) {
      await ch.cancel(consumerTag);
      consumerTag = null;
    }

    if (ch) {
      await ch.close();
      channel = null;
    }

    const conn = connection;
    if (conn) {
      await closeAmqpConnection(conn);
      connection = null;
    }
  } catch (err) {
    logger.error({ error: err }, 'Error stopping auth consumer');
  }
};
