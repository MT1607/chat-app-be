import { conversationCache } from '@/cache/conversation.cache';
import { conversationRepository } from '@/repositories/conversation.repository';
import {
  Conversation,
  ConversationFilter,
  ConverstationSummary,
  CreateConversationInput,
} from '@/types/conversation';
import { HttpError } from '@chat-app-be/common';

export const conversationService = {
  async createConversation(input: CreateConversationInput) {
    const conversation = await conversationRepository.create(input);
    await conversationCache.set(conversation);
    return conversation;
  },
  async getConversation(id: string): Promise<Conversation> {
    const cached = await conversationCache.get(id);
    if (cached) {
      return cached;
    }
    const conversation = await conversationRepository.findById(id);
    if (!conversation) {
      throw new HttpError(404, 'Conversation not found');
    }
    await conversationCache.set(conversation);
    return conversation;
  },
  async listConversation(filter: ConversationFilter): Promise<ConverstationSummary[]> {
    return await conversationRepository.findSummaries(filter);
  },
  async touchConversation(conversationId: string, preview: string): Promise<void> {
    await conversationRepository.touchConversation(conversationId, preview);
    await conversationCache.delete(conversationId);
  },
};
