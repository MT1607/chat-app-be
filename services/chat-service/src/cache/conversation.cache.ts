import { getRedisClient } from '@/clients/redis.client';
import { Conversation } from '@/types/conversation';
import { logger } from '@/utils/logger';

const CACHE_PREFIX = 'conversation';
const TTL_SECONDS = 60;

const serialize = (conversation: Conversation): string => {
  return JSON.stringify({
    ...conversation,
    createAt: conversation.createdAt.toISOString(),
    updateAt: conversation.updatedAt.toISOString(),
  });
};

const deserialize = (raw: string): Conversation => {
  const parsed = JSON.parse(raw) as Conversation & {
    createdAt: string;
    updatedAt: string;
  };

  return {
    ...parsed,
    createdAt: new Date(parsed.createdAt),
    updatedAt: new Date(parsed.updatedAt),
  };
};

export const conversationCache = {
  async get(conversationId: string): Promise<Conversation | null> {
    const redis = getRedisClient();
    const payload = await redis.get(`${CACHE_PREFIX}${conversationId}`);
    return payload ? deserialize(payload) : null;
  },

  async set(conversation: Conversation): Promise<void> {
    const redis = getRedisClient();
    await redis.setex(`${CACHE_PREFIX}${conversation.id}`, TTL_SECONDS, serialize(conversation));
  },

  async delete(conversationId: string): Promise<void> {
    const redis = getRedisClient();
    await redis.del(`${CACHE_PREFIX}${conversationId}`);
  },
};
