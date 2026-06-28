import { messageService } from '@/services/message.service';
import { conversationService } from '@/services/conversation.service';
import { getAuthenticatedUser } from '@/utils/auth';
import {
  createConversationSchema,
  listConversationsQuerySchema,
} from '@/validation/conversation.schema';
import { createMessageBodySchema, listMessagesQuerySchema } from '@/validation/message.schema';
import { conversationIdParamsSchema } from '@/validation/shared.schema';
import { asyncHandler, HttpError } from '@chat-app-be/common';
import type { RequestHandler } from 'express';

const parsedConversation = (params: unknown) => {
  const { id } = conversationIdParamsSchema.parse(params);
  return id;
};

export const createConversation: RequestHandler = asyncHandler(async (req, res) => {
  const user = getAuthenticatedUser(req);
  const payload = createConversationSchema.parse(req.body);
  const uniqueParticipantIds = Array.from(new Set([...payload.participantIds, user.id]));

  if (uniqueParticipantIds.length < 2) {
    throw new HttpError(400, 'Conversation must atleast include 1one other participant');
  }

  const conversation = await conversationService.createConversation({
    title: payload.title,
    participantIds: uniqueParticipantIds,
  });

  res.status(201).json({ data: conversation });
});

export const listConversation: RequestHandler = asyncHandler(async (req, res) => {
  const user = getAuthenticatedUser(req);
  const { participantId } = listConversationsQuerySchema.parse(req.query);

  if (participantId && participantId !== user.id) {
    throw new HttpError(403, 'Unauthorized');
  }

  const conversations = await conversationService.listConversation({ participantId: user.id });
  res.status(201).json({ data: conversations });
});

export const getConversation: RequestHandler = asyncHandler(async (req, res) => {
  const user = getAuthenticatedUser(req);
  const conversationId = parsedConversation(req.params);

  const conversation = await conversationService.getConversation(conversationId);

  if (!conversation.participantIds.includes(user.id)) {
    throw new HttpError(403, 'Unauthorized');
  }

  res.status(201).json({ data: conversation });
});

export const createMessage: RequestHandler = asyncHandler(async (req, res) => {
  const user = getAuthenticatedUser(req);
  const conversationId = parsedConversation(req.params);
  const { body } = createMessageBodySchema.parse(req.body);

  const message = await messageService.createMessage(conversationId, user.id, body);
  res.status(201).json({ data: message });
});

export const listMessages: RequestHandler = asyncHandler(async (req, res) => {
  const user = getAuthenticatedUser(req);
  const conversationId = parsedConversation(req.params);
  const query = listMessagesQuerySchema.parse(req.query);

  const after = query.after ? new Date(query.after) : undefined;

  const messages = await messageService.listMessages(conversationId, user.id, {
    limit: query.limit,
    after,
  });

  res.json({ data: messages });
});
