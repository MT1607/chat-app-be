export type EventPayload = Record<string, unknown>;

export interface DomainEvent<T extends string, P extends EventPayload> {
  type: T;
  payload: P;
  occurredAt: string;
}

export interface EventMetadata {
  correlationId?: string;
  causationId?: string;
  version?: unknown;
}

export interface OutboundEvent<T extends string, P extends EventPayload> extends DomainEvent<T, P> {
  metadata?: EventMetadata;
}

export interface InboundEvent<T extends string, P extends EventPayload> extends DomainEvent<T, P> {
  metadata: EventMetadata;
}
