// 回放真实问题场次 c126dcd3：修复前 忌讳score=100/指数0.2；修复后应约为 30/0.7
// 运行：cd packages/api-gateway && node --env-file=.env tmp-replay-confidence-bug.mjs
import { createStore } from '@grasp-mvp/infra';
import { createLLMGateway } from '@grasp-mvp/llm-gateway';
import { scoreSession } from '@grasp-mvp/scoring-engine';

const store = createStore();
const tenantId = 'tenant-demo';
const session = await store.getSession('c126dcd3-639b-4c2e-ab08-9682c4d09d60');
const scenario = await store.getScenario(session.scenarioId);
const defs = await store.listScoreItemDefs(tenantId);
const gateway = createLLMGateway(process.env, {});
const institutionKB = await store.getProductKB(tenantId);
const suggestionRules = await store.listSuggestionRules(tenantId);

const report = await scoreSession(session, scenario, defs, gateway, { institutionKB, suggestionRules });
const taboo = report.items.find((i) => i.itemName === '地推销售忌讳');
console.log('=== 回放结果（修复前：score=100, 指数=0.2, 总分=0）===');
console.log('地推销售忌讳 score:', taboo.score);
console.log('confidenceIndex:', report.confidenceIndex);
console.log('totalScore:', report.totalScore, '| baseScore:', report.baseScore);
console.log('judgeAgree:', taboo.judgeAgree, '| confidence:', taboo.confidence);
console.log('rationale 前 300 字:', taboo.rationale.slice(0, 300));
const ok = taboo.score <= 40 && report.confidenceIndex >= 0.6;
console.log(ok ? '\n修复生效 ✓（扣减与内容相符）' : '\n仍异常 ✗');
process.exit(0);
