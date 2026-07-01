import { z } from 'zod';

export const createConversationSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  participantIds: z.array(z.string().uuid()).min(1),
});

export const listConversationsSchema = z.object({
  participantId: z.string().uuid().optional(),
});

export const conversationIdSchema = z.object({
  id: z.string().uuid(),
});

export const createMessageSchema = z.object({
  body: z.string().min(1).max(2000),
});

export const listMessagesSchema = z.object({
  limit: z
    .preprocess((v) => (v === undefined ? undefined : Number(v)), z.number().int().min(1).max(200))
    .optional(),
  after: z.string().datetime().optional(),
});
