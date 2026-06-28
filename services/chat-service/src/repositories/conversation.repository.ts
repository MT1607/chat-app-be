import { getMongoClient } from '@/clients/mongo.client';
import {
  Conversation,
  ConversationFilter,
  ConverstationSummary,
  CreateConversationInput,
} from '@/types/conversation';
import { randomUUID } from 'crypto';
import { Document, WithId, ObjectId } from 'mongodb';

const CONVERSATION_COLLECTION = 'conversations';
const MESSAGES_COLLECTION = 'messages';

const toConversation = (doc: WithId<Document>): Conversation => ({
  id: String(doc._id),
  title: typeof doc.title === 'string' ? doc.title : null,
  participantIds: Array.isArray(doc.participantIds) ? (doc.participantIds as string[]) : [],
  createdAt: new Date(doc.createAt as string | number | Date),
  updatedAt: new Date(doc.updateAt as string | number | Date),
  lastMessageAt: typeof doc.lastMessageAt
    ? new Date(doc.lastMessageAt as string | number | Date)
    : null,
  lastMessagePreview: typeof doc.lastMessagePreview === 'string' ? doc.lastMessagePreview : null,
});

const toConversationSumary = (doc: WithId<Document>): ConverstationSummary => toConversation(doc);

export const conversationRepository = {
  async create(input: CreateConversationInput): Promise<Conversation> {
    const client = await getMongoClient();
    const db = client.db();
    const collection = db.collection(CONVERSATION_COLLECTION);
    const now = new Date();
    const document = {
      _id: randomUUID(),
      title: input.title ?? null,
      participantIds: input.participantIds,
      createAt: now,
      updateAt: now,
      lastMessageAt: null,
      lastMessagePrview: null,
    };

    await collection.insertOne(document as unknown as Document);
    return toConversation(document as unknown as WithId<Document>);
  },

  async findById(id: string): Promise<Conversation | null> {
    const client = await getMongoClient();
    const db = client.db();
    const doc = await db.collection(CONVERSATION_COLLECTION).findOne({ _id: new Object(id) });
    return doc ? toConversation(doc) : null;
  },

  async findSummaries(filter: ConversationFilter): Promise<ConverstationSummary[]> {
    const client = await getMongoClient();
    const db = client.db();
    const cursor = db
      .collection(CONVERSATION_COLLECTION)
      .find({ participantIds: filter.participantId })
      .sort({ lastMessageAt: -1, updateAt: -1 });

    const result = await cursor.toArray();
    return result.map((doc) => toConversationSumary(doc));
  },

  async touchConversation(conversationId: string, preview: string): Promise<void> {
    const client = await getMongoClient();
    const db = client.db();

    await db.collection(CONVERSATION_COLLECTION).updateOne(
      { _id: new ObjectId(conversationId) },
      {
        $set: {
          lastMessageAt: new Date(),
          lastMessagePreview: preview,
          updateAt: new Date(),
        },
      }
    );
  },

  async removeAll(): Promise<void> {
    const client = await getMongoClient();
    const db = client.db();
    await Promise.all([
      db.collection(CONVERSATION_COLLECTION).deleteMany({}),
      db.collection(MESSAGES_COLLECTION).deleteMany({}),
    ]);
  },
};
