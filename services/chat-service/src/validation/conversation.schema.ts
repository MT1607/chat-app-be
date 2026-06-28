import { z } from '@chat-app-be/common';

export const createConversationSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  participantIds: z.array(z.string().uuid()).min(1),
});

export const listConversationsQuerySchema = z.object({
  participantId: z.string().uuid().optional(),
});
