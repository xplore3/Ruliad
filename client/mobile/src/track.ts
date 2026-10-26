import { useEffect } from 'react';
import api from './api';

type UiEventType = 'ui.page_view' | 'ui.page_stay' | 'ui.action';

export function track(type: UiEventType, payload: Record<string, unknown>) {
  void api.post('/events', { type, payload }).catch(() => {});
}

export function trackAction(action: string, payload: Record<string, unknown> = {}) {
  track('ui.action', { action, ...payload });
}

export function usePageTrack(page: string) {
  useEffect(() => {
    const enteredAt = Date.now();
    track('ui.page_view', { page });
    return () => {
      track('ui.page_stay', { page, durationMs: Date.now() - enteredAt });
    };
  }, [page]);
}
