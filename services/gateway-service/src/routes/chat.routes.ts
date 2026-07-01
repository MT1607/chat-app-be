import {
  createConversation,
  createMessage,
  getConversation,
  listConversations,
  listMessages,
} from '@/controller/chat.controller';
import { requiredAuth } from '@/middleware/require-auth';
import {
  conversationIdSchema,
  createConversationSchema,
  createMessageSchema,
  listConversationsSchema,
  listMessagesSchema,
} from '@/validation/chat.schema';
import { validateRequest } from '@chat-app-be/common/src';
import { Router } from 'express';

export const chatRouter: Router = Router();

chatRouter.use(requiredAuth);

chatRouter.post('/', validateRequest({ body: createConversationSchema }), createConversation);
chatRouter.get('/', validateRequest({ query: listConversationsSchema }), listConversations);
chatRouter.get('/:id', validateRequest({ params: conversationIdSchema }), getConversation);
chatRouter.post(
  '/:id/messages',
  validateRequest({ params: conversationIdSchema, body: createMessageSchema }),
  createMessage
);
chatRouter.get(
  '/:id/messages',
  validateRequest({ params: conversationIdSchema, query: listMessagesSchema }),
  listMessages
);
