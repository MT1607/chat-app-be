import { EventPayload, OutboundEvent } from './event-types';

export const USER_EVENT_EXCHANGE = 'user.events';
export const USER_CREATED_ROUTING_KEY = 'user.created';

export interface UserCreatedPayload extends EventPayload {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
  updatedAt: string;
}

export type UserCreatedEvent = OutboundEvent<typeof USER_CREATED_ROUTING_KEY, UserCreatedPayload>;
