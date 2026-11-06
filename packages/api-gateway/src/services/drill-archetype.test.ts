import { describe, expect, it } from 'vitest';
import type { Scenario } from '@grasp-mvp/core';
import { MemoryStore } from '@grasp-mvp/infra';
import { archetypePrompt, initialCustomerArchetype } from './drill.js';
import { loadRuntime } from './turn.js';
import type { RouteContext } from '../ctx.js';

const groundContent = '10次应该有5次客户表现出不感兴趣';

const receptionScenario: Scenario = {
  id: 'scenario-reception',
  tenantId: 'tenant-demo',
  name: '咨询接待',
  personaConfigId: 'persona-parent',
  skillPointIds: ['sp-need'],
  successCriteria: { passScore: 70 },
  durationMinutes: 20,
  difficulty: 1,
  category: '咨询接待',
};

describe('客户类型适用场景', () => {
  it('固定无兴趣小场只适用于地推，咨询接待固定为有兴趣', () => {
    expect(initialCustomerArchetype(groundContent, '地推')).toBe('uninterested');
    expect(initialCustomerArchetype(groundContent, '咨询接待')).toBe('interested');
    expect(initialCustomerArchetype(groundContent, '电销')).toBeUndefined();
  });

  it('咨询接待提示词不引入地推固定拒绝流程', () => {
    const prompt = archetypePrompt('interested', '咨询接待');
    expect(prompt).toContain('明确有兴趣');
    expect(prompt).toContain('不得使用地推第一小场的固定无兴趣反应');
  });

  it('学员报出文杰围棋后禁止客户重复确认机构', () => {
    const prompt = archetypePrompt('interested', '咨询接待');
    expect(prompt).toContain('不得再询问“是文杰围棋吗”');
    expect(prompt).toContain('直接自然说明咨询需求');
  });

  it('旧咨询接待会话即使存了 uninterested 也按有兴趣客户运行', async () => {
    const runtime = await loadRuntime({ store: new MemoryStore() } as unknown as RouteContext, receptionScenario, 1, 'uninterested');
    expect(runtime?.bundle.systemPrompt).toContain('明确有兴趣、主动上门咨询的客户');
    expect(runtime?.bundle.systemPrompt).not.toContain('【本场客户类型（系统随机确定，必须严格遵守，优先级高于其他行为要求）】不感兴趣的客户');
    expect(runtime?.bundle.systemPrompt).toContain('对方已经说过姓名或机构时，不得重复确认');
  });
});
