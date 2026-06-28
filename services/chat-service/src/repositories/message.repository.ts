import { getMongoClient } from '@/clients/mongo.client';
import { Message, MessageListOptions, Reaction } from '@/types/chat';
import { randomUUID } from 'crypto';
import { Document, WithId } from 'mongodb';

const MESSAGES_COLLECTION = 'messages';

const toMessage = (doc: WithId<Document>): Message => ({
  id: String(doc._id),
  conversationId: String(doc.conversationId),
  senderId: String(doc.senderId),
  body: String(doc.body),
  createdAt: new Date(doc.createdAt as string | number | Date),
  reactions: Array.isArray(doc.reactions)
    ? (doc.reactions as WithId<Document>[]).map((r) => ({
        emoji: String(r.emoji),
        userId: String(r.userId),
        createdAt: new Date(r.createdAt as string | number | Date),
      } satisfies Reaction))
    : [],
});

export const messageRepository = {
  async create(conversationId: string, senderId: string, body: string): Promise<Message> {
    const client = await getMongoClient();
    const now = new Date();
    const document = {
      _id: randomUUID(),
      conversationId,
      senderId,
      body,
      createdAt: now,
      reactions: [],
    };

    await client.db().collection(MESSAGES_COLLECTION).insertOne(document as unknown as Document);
    return toMessage(document as unknown as WithId<Document>);
  },

  async findByConversation(
    conversationId: string,
    options: MessageListOptions = {}
  ): Promise<Message[]> {
    const client = await getMongoClient();
    const query: Record<string, unknown> = { conversationId };

    if (options.after) {
      query.createdAt = { $gt: options.after };
    }

    const docs = await client
      .db()
      .collection(MESSAGES_COLLECTION)
      .find(query)
      .sort({ createdAt: -1 })
      .limit(options.limit ?? 50)
      .toArray();

    return docs.map(toMessage);
  },

  async findById(messageId: string): Promise<Message | null> {
    const client = await getMongoClient();
    const doc = await client
      .db()
      .collection(MESSAGES_COLLECTION)
      .findOne({ _id: messageId } as unknown as Document);
    return doc ? toMessage(doc) : null;
  },
};