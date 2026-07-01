import { env } from '@/config/env';
import { HttpError, USER_ID_HEADER } from '@chat-app-be/common';
import axios from 'axios';

const client = axios.create({
  baseURL: env.CHAT_SERVICE_URL,
  timeout: 5000,
  headers: { 'X-Internal-Token': env.INTERNAL_API_TOKEN },
});

export interface ConversationDto {
  id: string;
  title?: string;
  participantIds: string[];
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
}

export interface ReactionDto {
  emoji: string;
  userId: string;
  createdAt: string;
}

export interface MessageDto {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  createdAt: string;
  reactions: ReactionDto[];
}

export interface ConversationResponse {
  data: ConversationDto;
}

export interface ConversationListResponse {
  data: ConversationDto[];
}

export interface MessageResponse {
  data: MessageDto;
}

export interface MessageListResponse {
  data: MessageDto[];
}

export interface CreateConversationPayload {
  title?: string;
  participantIds: string[];
}

export interface CreateMessagePayload {
  body: string;
}

export interface ListMessagesParams {
  limit?: number;
  after?: string;
}

const resolvedMessage = (status: number, data: unknown) => {
  if (typeof data === 'object' && data && 'message' in data) {
    const message = (data as Record<string, unknown>).message;
    if (typeof message === 'string' && message.trim().length > 0) {
      return message;
    }
  }

  return status >= 500
    ? 'Chat service is currently unavailable'
    : 'An error occurred while processing the request';
};

const handleAxiosError = (error: unknown): never => {
  if (!axios.isAxiosError(error) || !error.response) {
    throw new HttpError(500, 'Chat service is currently unavailable');
  }

  const { status, data } = error.response as { status: number; data: unknown };
  throw new HttpError(status, resolvedMessage(status, data));
};

export const chatProxyService = {
  async createConversation(
    userId: string,
    payload: CreateConversationPayload
  ): Promise<ConversationResponse> {
    try {
      const response = await client.post<ConversationResponse>('/conversations', payload, {
        headers: { [USER_ID_HEADER]: userId },
      });
      return response.data;
    } catch (error) {
      return handleAxiosError(error);
    }
  },

  async listConversations(userId: string): Promise<ConversationListResponse> {
    try {
      const response = await client.get<ConversationListResponse>('/conversations', {
        headers: { [USER_ID_HEADER]: userId },
      });
      return response.data;
    } catch (error) {
      return handleAxiosError(error);
    }
  },

  async getConversation(conversationId: string, userId: string): Promise<ConversationResponse> {
    try {
      const response = await client.get<ConversationResponse>(`/conversations/${conversationId}`, {
        headers: { [USER_ID_HEADER]: userId },
      });
      return response.data;
    } catch (error) {
      return handleAxiosError(error);
    }
  },

  async createMessage(
    conversationId: string,
    userId: string,
    payload: CreateMessagePayload
  ): Promise<MessageResponse> {
    try {
      const response = await client.post<MessageResponse>(
        `/conversations/${conversationId}/messages`,
        payload,
        { headers: { [USER_ID_HEADER]: userId } }
      );
      return response.data;
    } catch (error) {
      return handleAxiosError(error);
    }
  },

  async listMessages(
    conversationId: string,
    userId: string,
    params: ListMessagesParams
  ): Promise<MessageListResponse> {
    try {
      const response = await client.get<MessageListResponse>(
        `/conversations/${conversationId}/messages`,
        { headers: { [USER_ID_HEADER]: userId }, params }
      );
      return response.data;
    } catch (error) {
      return handleAxiosError(error);
    }
  },
};
