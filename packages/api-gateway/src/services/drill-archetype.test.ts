import { describe, expect, it } from 'vitest';
import type { Scenario } from '@grasp-mvp/core';
import { MemoryStore } from '@grasp-mvp/infra';
import { detectFirstSpeaker, dualSceneEnabledFor, firstSceneTimeLimitMs, FIRST_SCENE_MAX_MS, receptionCustomerPrompt, resolveDrillScript, supportsDualScene, SCENE_TRANSITION_NARRATION } from './drill.js';
import { loadRuntime } from './turn.js';
import { CLOSING_TEMPLATE, GROUND_PUSH_DUAL_SCENE_INTRO } from '../seed-drill-scripts.js';
import type { RouteContext } from '../ctx.js';

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

describe('双场制启用判定（场景编辑器开关）', () => {
  it('双场制仅地推与现场成交支持，其他分类不开放', () => {
    expect(supportsDualScene('地推')).toBe(true);
    expect(supportsDualScene('现场成交')).toBe(true);
    expect(supportsDualScene('电销')).toBe(false);
    expect(supportsDualScene('咨询接待')).toBe(false);
    expect(supportsDualScene(undefined)).toBe(false);
  });

  it('双场制需场景开关开启且绑定演练剧本才启用', () => {
    const ground: Scenario = { ...receptionScenario, category: '地推', dualSceneEnabled: true };
    expect(dualSceneEnabledFor(ground, true)).toBe(true);
    expect(dualSceneEnabledFor(ground, false)).toBe(false);
    expect(dualSceneEnabledFor({ ...ground, dualSceneEnabled: false }, true)).toBe(false);
    expect(dualSceneEnabledFor({ ...ground, dualSceneEnabled: undefined }, true)).toBe(false);
    expect(dualSceneEnabledFor({ ...ground, category: '电销' }, true)).toBe(false);
    expect(dualSceneEnabledFor({ ...ground, category: '咨询接待' }, true)).toBe(false);
    expect(dualSceneEnabledFor({ ...ground, category: '现场成交' }, true)).toBe(true);
  });

  it('第一小场硬时限仅地推适用，谈判型现场成交不设硬时限', () => {
    expect(firstSceneTimeLimitMs({ ...receptionScenario, category: '地推' })).toBe(FIRST_SCENE_MAX_MS);
    expect(firstSceneTimeLimitMs({ ...receptionScenario, category: '地推', flowType: 'ground_push' })).toBe(FIRST_SCENE_MAX_MS);
    expect(firstSceneTimeLimitMs({ ...receptionScenario, category: '现场成交' })).toBeUndefined();
    expect(firstSceneTimeLimitMs({ ...receptionScenario, category: '现场成交', flowType: 'generic' })).toBeUndefined();
  });

  it('现场成交种子剧本与代码契约一致：双场制声明、客户先开口、切场旁白文案一致', () => {
    expect(detectFirstSpeaker(CLOSING_TEMPLATE)).toBe('persona');
    expect(CLOSING_TEMPLATE).toContain(SCENE_TRANSITION_NARRATION);
    expect(CLOSING_TEMPLATE).toContain('固定拒绝成交');
    expect(CLOSING_TEMPLATE).toContain('是否成交取决于销售表现');
  });

  it('种子双场制说明与代码契约一致：学员先开口、切场旁白文案一致', () => {
    expect(detectFirstSpeaker(GROUND_PUSH_DUAL_SCENE_INTRO)).toBe('trainee');
    expect(GROUND_PUSH_DUAL_SCENE_INTRO).toContain(SCENE_TRANSITION_NARRATION);
    expect(GROUND_PUSH_DUAL_SCENE_INTRO).toContain('固定为不感兴趣的客户');
    expect(GROUND_PUSH_DUAL_SCENE_INTRO).toContain('固定为潜在意向客户');
  });

  it('地推双场制的客户行为提示词全部来自剧本库，代码不再注入客户类型段落', async () => {
    const store = new MemoryStore();
    await store.saveDrillScript({
      id: 'drill-ground',
      tenantId: 'tenant-demo',
      category: '地推',
      name: '地推剧本',
      content: `${GROUND_PUSH_DUAL_SCENE_INTRO}\n销售：您好！`,
    });
    const scenario: Scenario = {
      ...receptionScenario,
      id: 'scenario-ground',
      category: '地推',
      drillScriptId: 'drill-ground',
    };
    const runtime = await loadRuntime({ store } as unknown as RouteContext, scenario);
    expect(runtime?.bundle.systemPrompt).toContain('第一小场：你扮演第一位家长，固定为不感兴趣的客户');
    expect(runtime?.bundle.systemPrompt).toContain('第二小场');
    expect(runtime?.bundle.systemPrompt).not.toContain('【本场客户类型（系统随机确定');
  });
});

describe('咨询接待固定客户类型', () => {
  it('咨询接待提示词不引入地推固定拒绝流程', () => {
    const prompt = receptionCustomerPrompt();
    expect(prompt).toContain('明确有兴趣');
    expect(prompt).toContain('不得使用地推第一小场的固定无兴趣反应');
  });

  it('学员报出文杰围棋后禁止客户重复确认机构', () => {
    const prompt = receptionCustomerPrompt();
    expect(prompt).toContain('不得再询问“是文杰围棋吗”');
    expect(prompt).toContain('直接自然说明咨询需求');
  });

  it('咨询接待固定按有兴趣客户运行，不读历史会话的小场状态', async () => {
    const runtime = await loadRuntime({ store: new MemoryStore() } as unknown as RouteContext, receptionScenario, 1);
    expect(runtime?.bundle.systemPrompt).toContain('明确有兴趣、主动上门咨询的客户');
    expect(runtime?.bundle.systemPrompt).not.toContain('固定为不感兴趣的客户');
    expect(runtime?.bundle.systemPrompt).toContain('对方已经说过姓名或机构时，不得重复确认');
  });
});


it('同分类场景只读取各自显式绑定的演练剧本', async () => {
  const store = new MemoryStore();
  await store.saveDrillScript({ id: 'drill-a', tenantId: 'tenant-demo', category: '电销', name: '剧本 A', content: '客户：A' });
  await store.saveDrillScript({ id: 'drill-b', tenantId: 'tenant-demo', category: '电销', name: '剧本 B', content: '客户：B' });
  const scenario: Scenario = {
    ...receptionScenario,
    id: 'scenario-phone', category: '电销', flowType: 'generic', drillScriptId: 'drill-b',
  };
  expect((await resolveDrillScript(store, scenario))?.id).toBe('drill-b');
  expect(await resolveDrillScript(store, { ...scenario, drillScriptId: undefined })).toBeUndefined();
  expect(await resolveDrillScript(store, { ...scenario, tenantId: 'tenant-other' })).toBeUndefined();
});


it('显式通用策略即使属于地推分类也不加载地推专项提示词', async () => {
  const scenario: Scenario = {
    ...receptionScenario,
    id: 'scenario-generic-ground', category: '地推', flowType: 'generic',
  };
  const runtime = await loadRuntime({ store: new MemoryStore() } as unknown as RouteContext, scenario);
  expect(runtime?.bundle.systemPrompt).not.toContain('地推客户只是潜在客户');
  expect(runtime?.bundle.systemPrompt).not.toContain('六连问');
});
