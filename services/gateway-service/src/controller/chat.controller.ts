import { chatProxyService } from '@/services/chat-proxy.service';
import { getAuthenticatedUser } from '@/utils/auth';
import {
  conversationIdSchema,
  createConversationSchema,
  createMessageSchema,
  listMessagesSchema,
} from '@/validation/chat.schema';
import { HttpError, asyncHandler } from '@chat-app-be/common/src';
import type { RequestHandler } from 'express';

export const createConversation: RequestHandler = asyncHandler(async (req, res) => {
  const user = getAuthenticatedUser(req);
  const payload = createConversationSchema.parse(req.body);

  const uniqueParticipantIds = Array.from(new Set([...payload.participantIds, user.id]));

  if (uniqueParticipantIds.length < 2) {
    throw new HttpError(400, 'Conversation must at least include one other participant');
  }

  const response = await chatProxyService.createConversation(user.id, {
    title: payload.title,
    participantIds: uniqueParticipantIds,
  });

  res.status(201).json({ data: response });
});

export const listConversations: RequestHandler = asyncHandler(async (req, res) => {
  const user = getAuthenticatedUser(req);
  const response = await chatProxyService.listConversations(user.id);
  res.json({ data: response });
});

export const getConversation: RequestHandler = asyncHandler(async (req, res) => {
  const user = getAuthenticatedUser(req);
  const { id } = conversationIdSchema.parse(req.params);
  const response = await chatProxyService.getConversation(id, user.id);

  if (!response.data.participantIds.includes(user.id)) {
    throw new HttpError(403, 'You are not a participant in this conversation');
  }

  res.json({ data: response.data });
});

export const createMessage: RequestHandler = asyncHandler(async (req, res) => {
  const user = getAuthenticatedUser(req);
  const { id } = conversationIdSchema.parse(req.params);
  const payload = createMessageSchema.parse(req.body);
  const response = await chatProxyService.createMessage(id, user.id, payload);
  res.status(201).json({ data: response });
});

export const listMessages: RequestHandler = asyncHandler(async (req, res) => {
  const user = getAuthenticatedUser(req);
  const { id } = conversationIdSchema.parse(req.params);
  const params = listMessagesSchema.parse(req.query);
  const response = await chatProxyService.listMessages(id, user.id, params);
  res.json({ data: response });
});
