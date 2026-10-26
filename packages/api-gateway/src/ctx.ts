import type { LLMGateway } from '@grasp-mvp/core';
import type { Store } from '@grasp-mvp/infra';
import type { SpeechGateway } from '@grasp-mvp/speech-gateway';

/** 路由上下文：装配层注入 */
export interface RouteContext {
  store: Store;
  gateway: LLMGateway;
  speech: SpeechGateway;
}
