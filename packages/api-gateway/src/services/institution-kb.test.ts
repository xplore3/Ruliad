import { expect, it } from 'vitest';
import type { Scenario } from '@grasp-mvp/core';
import { MemoryStore } from '@grasp-mvp/infra';
import { loadRuntime } from './turn.js';
import type { RouteContext } from '../ctx.js';

it('剧本场景也注入培训机构定制资料库', async () => {
  const store = new MemoryStore();
  await store.saveProductKB({
    id: 'kb-institution-custom',
    tenantId: 'tenant-demo',
    name: '培训机构定制资料库',
    version: 1,
    entries: [{ id: 'entry-1', kind: 'keypoint', title: '机构信息', content: '文杰围棋专注少儿围棋教育。' }],
    effectiveAt: new Date().toISOString(),
  });
  await store.saveDrillScript({
    id: 'drill-ground',
    tenantId: 'tenant-demo',
    category: '地推',
    name: '地推剧本',
    content: '销售：您好，我想邀请您参加试听。',
  });
  const scenario: Scenario = {
    id: 'scenario-ground-kb',
    tenantId: 'tenant-demo',
    name: '地推',
    personaConfigId: 'persona-parent',
    skillPointIds: ['sp-need'],
    successCriteria: { passScore: 70 },
    durationMinutes: 20,
    difficulty: 1,
    category: '地推',
    drillScriptId: 'drill-ground',
  };
  const runtime = await loadRuntime({ store } as unknown as RouteContext, scenario);
  expect(runtime?.bundle.systemPrompt).toContain('培训机构定制资料库');
  expect(runtime?.bundle.systemPrompt).toContain('文杰围棋专注少儿围棋教育');
});

it('场景绑定其他知识库时仍注入机构定制资料库', async () => {
  const store = new MemoryStore();
  await store.saveProductKB({
    id: 'kb-institution-custom',
    tenantId: 'tenant-demo',
    name: '培训机构定制资料库',
    version: 1,
    entries: [{ id: 'entry-1', kind: 'faq', title: '退费政策', content: '开课前可全额退费。' }],
    effectiveAt: new Date().toISOString(),
  });
  await store.saveProductKB({
    id: 'kb-scenario-specific',
    tenantId: 'tenant-demo',
    name: '场景专用知识库',
    version: 1,
    entries: [{ id: 'entry-2', kind: 'keypoint', title: '体验课', content: '体验课时长为45分钟。' }],
    effectiveAt: new Date().toISOString(),
  });
  const scenario: Scenario = {
    id: 'scenario-with-specific-kb',
    tenantId: 'tenant-demo',
    name: '课程咨询',
    personaConfigId: 'persona-parent',
    skillPointIds: ['sp-need'],
    successCriteria: { passScore: 70 },
    durationMinutes: 20,
    difficulty: 1,
    productKBId: 'kb-scenario-specific',
  };

  const runtime = await loadRuntime({ store } as unknown as RouteContext, scenario);
  expect(runtime?.bundle.systemPrompt).toContain('体验课时长为45分钟');
  expect(runtime?.bundle.systemPrompt).toContain('培训机构定制资料库');
  expect(runtime?.bundle.systemPrompt).toContain('开课前可全额退费');
});
