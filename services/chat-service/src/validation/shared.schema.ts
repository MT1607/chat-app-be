import { z } from '@chat-app-be/common';

export const conversationIdParamsSchema = z.object({
  id: z.string().uuid(),
});
