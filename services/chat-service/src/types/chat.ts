export interface Reaction {
  emoji: string;
  userId: string;
  createdAt: Date;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  createdAt: Date;
  reactions: Reaction[];
}

export interface MessageListOptions {
  limit?: number;
  after?: Date;
}
