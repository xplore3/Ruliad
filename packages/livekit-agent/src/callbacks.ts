/** Agent 内部事件回调 */
export interface Callbacks {
  onStatusChange?: (status: 'idle' | 'connecting' | 'listening' | 'processing' | 'speaking' | 'error') => void;
  onAsrPartial?: (text: string) => void;
  onAsrFinal?: (text: string) => void;
  onReplyText?: (text: string) => void;
  onTurnComplete?: (turn: unknown, emotion: unknown) => void;
  onError?: (message: string) => void;
}
