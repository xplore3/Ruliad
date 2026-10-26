/** 事件流：append-only，要素资产库的原料 */

export const EventTypes = {
  SESSION_STARTED: 'session.started',
  SESSION_TURN: 'session.turn',
  SESSION_EMOTION_UPDATED: 'session.emotion_updated',
  SESSION_HINT_USED: 'session.hint_used',
  SESSION_COMPLETED: 'session.completed',
  SESSION_PROCTOR_EVENT: 'session.proctor_event',
  PERSONA_CONSISTENCY_VIOLATION: 'persona.consistency_violation',
  SCORING_COMPLETED: 'scoring.completed',
  APPEAL_CREATED: 'appeal.created',
  APPEAL_RESOLVED: 'appeal.resolved',
  CERT_ISSUED: 'cert.issued',
  CALIBRATION_RECORDED: 'calibration.recorded',
  LLM_USAGE: 'llm.usage',
  // 前端埋点（POST /events 仅接受这三类）
  UI_PAGE_VIEW: 'ui.page_view',
  UI_PAGE_STAY: 'ui.page_stay',
  UI_ACTION: 'ui.action',
} as const;

export type EventType = (typeof EventTypes)[keyof typeof EventTypes];

export interface DomainEvent {
  id: string;
  type: EventType;
  tenantId?: string;
  sessionId?: string;
  userId?: string;
  payload: Record<string, unknown>;
  at: string;
}

export class EventBus {
  private handlers: Map<string, Array<(event: DomainEvent) => void>> = new Map();

  on(type: string, handler: (event: DomainEvent) => void): () => void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler);
    this.handlers.set(type, list);
    return () => {
      const idx = list.indexOf(handler);
      if (idx >= 0) list.splice(idx, 1);
    };
  }

  emit(event: DomainEvent): void {
    const list = this.handlers.get(event.type) ?? [];
    for (const handler of list) handler(event);
    const all = this.handlers.get('*') ?? [];
    for (const handler of all) handler(event);
  }
}
