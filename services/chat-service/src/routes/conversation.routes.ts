import {
  createConversation,
  createMessage,
  getConversation,
  listConversation,
  listMessages,
} from '@/controllers/conversation.controller';
import { attachAuthenticatiedUser } from '@/middleware/authenticated-user';
import {
  createConversationSchema,
  listConversationsQuerySchema,
} from '@/validation/conversation.schema';
import { createMessageBodySchema, listMessagesQuerySchema } from '@/validation/message.schema';
import { conversationIdParamsSchema } from '@/validation/shared.schema';
import { validateRequest } from '@chat-app-be/common';
import { Router } from 'express';

export const conversationRouter: Router = Router();

conversationRouter.use(attachAuthenticatiedUser);

conversationRouter.post(
  '/',
  validateRequest({ body: createConversationSchema }),
  createConversation
);
conversationRouter.get(
  '/',
  validateRequest({ query: listConversationsQuerySchema }),
  listConversation
);
conversationRouter.get(
  '/:id',
  validateRequest({ params: conversationIdParamsSchema }),
  getConversation
);

// messages
conversationRouter.post(
  '/:id/messages',
  validateRequest({ params: conversationIdParamsSchema, body: createMessageBodySchema }),
  createMessage
);
conversationRouter.get(
  '/:id/messages',
  validateRequest({ params: conversationIdParamsSchema, query: listMessagesQuerySchema }),
  listMessages
);
