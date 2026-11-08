import { expect, it } from 'vitest';
import type { LLMGateway, Scenario, ScoreItemDef, Session } from '@grasp-mvp/core';
import { MockLLMProvider } from '@grasp-mvp/llm-gateway';
import { analyzeReceptionTrialInvitation } from './trial-invitation.js';
import { judgeItem } from './judge.js';

function makeSession(text: string): Session {
  return {
    id: 'session-trial-invitation',
    tenantId: 'tenant-demo',
    userId: 'user-trainee-1',
    scenarioId: 'scenario-reception',
    mode: 'practice',
    status: 'completed',
    transcript: [{ seq: 1, speaker: 'trainee', text, at: '2026-01-01T10:00:00Z' }],
    emotionTrace: [],
    hintsUsed: 0,
    startedAt: '2026-01-01T10:00:00Z',
  };
}

function semanticGateway(): LLMGateway {
  return {
    forTask: () => new MockLLMProvider((messages) => {
      const prompt = messages.map((message) => message.content).join('\n');
      if (prompt.includes('封闭式邀约语义复核')) {
        const traineeText = [...prompt.matchAll(/学员：([^\n]+)/g)].map((match) => match[1]).at(-1) ?? '';
        const closed = /您想让孩子试听吗|要不要试听|需要我给您安排试听课吗|可以带孩子来试听吗|建议您.*(试听|活动)|可以带孩子参加(试听|活动)|您想参加吗|要不要参加.*活动/.test(traineeText);
        return JSON.stringify({ triggered: closed, quoteTurnSeq: 1, reason: closed ? '疑问式或建议式试听或活动邀约' : '直接安排时间或单纯介绍课程活动' });
      }
      return JSON.stringify({ score: 0, rationale: '其他忌讳未触犯' });
    }),
  };
}

it.each([
  '您想让孩子试听吗？',
  '要不要试听？',
  '需要我给您安排试听课吗？',
  '可以带孩子来试听吗？',
  '建议您过来之后试听一下，然后再决定要不要报名。',
  '您可以带孩子参加试听。',
  '我们有个活动，您想参加吗？',
  '要不要参加我们的活动？',
  '建议您带孩子参加我们的活动。',
])('疑问式或建议式试听、活动邀约“%s”全局扣5分', async (text) => {
  const result = await analyzeReceptionTrialInvitation(makeSession(text), semanticGateway());
  expect(result.deduction).toBe(5);
});

it.each([
  '您什么时候方便试听？我给您安排。',
  '您看周六还是周日方便，我给您安排试听。',
  '我们有免费试听课。',
  '试听课多长时间？',
  '我们有免费的亲子活动。',
  '活动什么时候举办？',
])('直接安排时间或非邀约表达“%s”不扣分', async (text) => {
  expect((await analyzeReceptionTrialInvitation(makeSession(text), semanticGateway())).deduction).toBe(0);
});

it('建议式试听邀约和询问要不要报名并入封闭式问题扣5分', async () => {
  const result = await analyzeReceptionTrialInvitation(
    makeSession('呃，您随时可以过来看一下，不过呢也建议您呃过来之后试听一下。这个试听也是免费的，您感觉一下，然后再决定要不要报名。'),
    semanticGateway()
  );
  expect(result.triggered).toBe(true);
  expect(result.deduction).toBe(5);
});

it('咨询接待忌讳项追加封闭式试听邀约5分', async () => {
  const scenario: Scenario = {
    id: 'scenario-reception',
    tenantId: 'tenant-demo',
    name: '咨询接待',
    personaConfigId: 'persona-parent',
    skillPointIds: ['sp-compliance'],
    successCriteria: { passScore: 70 },
    durationMinutes: 25,
    difficulty: 1,
    category: '咨询接待',
  };
  const def: ScoreItemDef = {
    id: 'reception-taboo',
    tenantId: 'tenant-demo',
    skillPointId: 'sp-compliance',
    name: '咨询接待忌讳事项',
    behaviorAnchor: '独立扣分项',
    judgePrompt: '其他忌讳',
    weight: 0,
    levels: [],
    layer: 'company',
    isObservation: false,
    category: '咨询接待',
    scoringMode: 'score',
    deductionOnly: true,
  };
  const result = await judgeItem(def, makeSession('您想让孩子试听吗？'), semanticGateway(), scenario);
  expect(result.score).toBe(5);
  expect(result.rationale).toContain('全局扣5分');
  expect(result.betterScript).toContain('您什么时候方便参加？我给您安排。');
});

it('地推销售忌讳识别变相活动邀约且不启用机构资料规则', async () => {
  const scenario: Scenario = {
    id: 'scenario-ground-push',
    tenantId: 'tenant-demo',
    name: '地推引流课',
    personaConfigId: 'persona-parent',
    skillPointIds: ['sp-compliance'],
    successCriteria: { passScore: 70 },
    durationMinutes: 20,
    difficulty: 1,
    category: '地推',
  };
  const def: ScoreItemDef = {
    id: 'ground-push-taboo',
    tenantId: 'tenant-demo',
    skillPointId: 'sp-compliance',
    name: '地推销售忌讳',
    behaviorAnchor: '独立扣分项',
    judgePrompt: '其他忌讳',
    weight: 0,
    levels: [],
    layer: 'company',
    isObservation: false,
    category: '地推',
    scoringMode: 'score',
    deductionOnly: true,
  };
  const result = await judgeItem(def, makeSession('我们有个活动，您想参加吗？'), semanticGateway(), scenario);
  expect(result.score).toBe(5);
  expect(result.rationale).toContain('全局扣5分');
  expect(result.rationale).not.toContain('资料真实性');
});
