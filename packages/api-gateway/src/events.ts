import { randomUUID } from 'node:crypto';
import type { DomainEvent, EventType } from '@grasp-mvp/core';

/** 构造领域事件：补 id 与 at */
export function mkEvent(
  type: EventType,
  init: {
    tenantId?: string;
    sessionId?: string;
    userId?: string;
    payload?: Record<string, unknown>;
  } = {}
): DomainEvent {
  return {
    id: randomUUID(),
    type,
    tenantId: init.tenantId,
    sessionId: init.sessionId,
    userId: init.userId,
    payload: init.payload ?? {},
    at: new Date().toISOString(),
  };
}
