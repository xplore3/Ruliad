// 验证「未推进售卖导致结束」演练的改进建议是否使用用户指定的具体路径
// 该路径为确定性代码（buildGroundPushIncompleteGoal），不需要 LLM
// 运行：cd packages/api-gateway && node --env-file=.env tmp-verify-improvement-suggestion.mjs
import { createStore } from '@grasp-mvp/infra';
import { createLLMGateway } from '@grasp-mvp/llm-gateway';
import { scoreSession } from '@grasp-mvp/scoring-engine';

const store = createStore();
const tenantId = 'tenant-demo';
const defs = await store.listScoreItemDefs(tenantId);
const proactive = defs.find((d) => d.name === '地推主动性');
const gateway = createLLMGateway(process.env, {});
const institutionKB = await store.getProductKB(tenantId);
const suggestionRules = await store.listSuggestionRules(tenantId);

const scenario = {
  id: 'verify-incomplete', tenantId, name: '地推验证场景', personaConfigId: 'p',
  skillPointIds: ['sp-ground'], scoreItemIds: [proactive.id],
  successCriteria: { passScore: 60 }, durationMinutes: 10, difficulty: 1,
  category: '地推', flowType: 'ground_push', status: 'published', version: 1,
};

const now = new Date().toISOString();
const session = {
  id: 'verify-incomplete-session', tenantId, userId: 'verify-user', scenarioId: scenario.id,
  mode: 'practice', status: 'completed',
  transcript: [
    { seq: 1, speaker: 'trainee', text: '姐您好，我们有一个围棋体验活动，想请孩子来体验一下。', at: now },
    { seq: 2, speaker: 'persona', text: '（客户放慢了脚步，伸手接过邀请卡，低头看了看）嗯……围棋啊。', at: now },
    { seq: 3, speaker: 'trainee', text: '这个现在我看小朋友的年纪正适合开始学围棋，我们老师经验很丰富，要不您也来体验一下。', at: now },
    { seq: 4, speaker: 'persona', text: '好的，我回去琢磨琢磨，先走了。', at: now },
    { seq: 5, speaker: 'trainee', text: '那您慢走。', at: now },
  ],
  emotionTrace: [], hintsUsed: 0,
  completionStatus: 'incomplete',
  completionReason: '客户已给最后推进机会，但学员仍没有实质成交动作，地推主动性不合格，本场未完成。',
  startedAt: now, endedAt: now,
};

const report = await scoreSession(session, scenario, defs, gateway, { institutionKB, suggestionRules });
console.log('=== 改进目标 improvementGoal ===');
console.log('title:', report.improvementGoal?.title);
console.log('rationale:', report.improvementGoal?.rationale);
console.log('suggestion:', report.improvementGoal?.suggestion);
console.log('\n=== summary ===');
console.log(report.summary);
console.log('\n=== 判定 ===');
const suggestion = report.improvementGoal?.suggestion ?? '';
const hasPath = ['试听流程', '地址', '电话', '售价'].filter((k) => (suggestion + (report.summary ?? '')).includes(k));
const hasOrder = (suggestion + (report.summary ?? '')).includes('订一张');
console.log('包含完整路径要点（试听流程/地址/电话/售价）:', hasPath.length, '/4');
console.log('包含「订一张」:', hasOrder);
console.log(hasPath.length >= 3 && hasOrder ? '已生效 ✓' : '未生效 ✗（仍为旧的笼统建议）');
process.exit(0);
