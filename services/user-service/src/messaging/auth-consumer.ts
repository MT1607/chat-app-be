import { env } from '@/config/env';
import { userService } from '@/services/user.service';
import { logger } from '@/utils/logger';
import {
  AUTH_EVENT_EXCHANGE,
  AUTH_USER_REGISTERED_ROUTING_KEY,
  type AuthRegisteredEvent,
} from '@chat-app-be/common';
import { ChannelModel, connect, Connection, ConsumeMessage, type Channel, Replies } from 'amqplib';

type ManageConnection = Connection & ChannelModel;

let connectionRef: ManageConnection | null = null;
let channel: Channel | null = null;
let consumerTag: string | null = null;

const QUEUE_NAME = 'auth-service.auth-events';

const closeConnection = async (conn: ManageConnection) => {
  await conn.close();
  connectionRef = null;
  channel = null;
  consumerTag = null;
};

const handleMessage = async (message: ConsumeMessage | null, channel: Channel) => {
  const raw = message?.content.toString();
  const event = JSON.parse(raw || '{}') as AuthRegisteredEvent;

  await userService.syncFromAuthUser(event.payload);
  console.log(`Processed auth registered event for user ${event.payload.id}`);
  channel.ack(message!);
};

export const startAuthConsumer = async () => {
  if (!env.RABBITMQ_URL) {
    logger.warn('RABBITMQ_URL is not defined. Skipping auth consumer setup.');
    return;
  }

  if (channel) {
    logger.info('Auth consumer is already running.');
    return;
  }

  const connection = (await connect(env.RABBITMQ_URL)) as ManageConnection;
  connectionRef = connection;
  const ch = await connection.createChannel();
  channel = ch;

  await ch.assertExchange(AUTH_EVENT_EXCHANGE, 'topic', { durable: true });
  const q = await ch.assertQueue(QUEUE_NAME, { durable: true });
  await ch.bindQueue(q.queue, AUTH_EVENT_EXCHANGE, AUTH_USER_REGISTERED_ROUTING_KEY);

  const consumeHandler = (msg: ConsumeMessage | null) => {
    if (!msg) {
      return;
    }

    void handleMessage(msg, ch).catch((err: unknown) => {
      logger.error({ error: err }, 'Error processing auth event message');
      ch.nack(msg, false, false);
    });
  };

  const result: Replies.Consume = await ch.consume(q.queue, consumeHandler, { noAck: false });
  consumerTag = result.consumerTag;
  connection.on('close', () => {
    logger.warn('Auth consumer connection closed.');
    connectionRef = null;
    channel = null;
    consumerTag = null;
  });

  connection.on('error', (err) => {
    logger.error({ error: err }, 'Auth consumer connection error');
  });

  logger.info('Auth consumer started.');
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

    const conn = connectionRef;
    if (conn) {
      await closeConnection(conn);
      connectionRef = null;
    }
  } catch (err) {
    logger.error({ error: err }, 'Error stopping auth consumer');
  }
};
