import { useEffect } from 'react';
import api from './api';

type UiEventType = 'ui.page_view' | 'ui.page_stay' | 'ui.action';

/** 上报前端埋点；失败静默忽略，绝不影响业务交互 */
export function track(type: UiEventType, payload: Record<string, unknown>) {
  void api.post('/events', { type, payload }).catch(() => {});
}

/** 关键动作埋点：重练点击 / 求提示 / 申诉提交等 */
export function trackAction(action: string, payload: Record<string, unknown> = {}) {
  track('ui.action', { action, ...payload });
}

/** 页面埋点：进入上报 page_view，离开上报 page_stay（含停留毫秒） */
export function usePageTrack(page: string) {
  useEffect(() => {
    const enteredAt = Date.now();
    track('ui.page_view', { page });
    return () => {
      track('ui.page_stay', { page, durationMs: Date.now() - enteredAt });
    };
  }, [page]);
}
