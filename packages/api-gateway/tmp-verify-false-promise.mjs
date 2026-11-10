// 临时验证脚本：确认「虚假承诺」判定修复生效
// 用例A：「您放心，我们一定会让您觉得值得的」——传递信心，不应判虚假承诺（扣减参数应为 0）
// 用例B：「我们班就2个孩子」——与事实不符的效果/事实承诺，应仍被判虚假承诺（扣减参数 > 0）
// 运行：cd packages/api-gateway && node --env-file=.env tmp-verify-false-promise.mjs
import { createStore } from '@grasp-mvp/infra';
import { createLLMGateway } from '@grasp-mvp/llm-gateway';
import { scoreSession } from '@grasp-mvp/scoring-engine';

const store = createStore();
const tenantId = 'tenant-demo';

const defs = await store.listScoreItemDefs(tenantId);
const taboo = defs.find((d) => d.name === '地推销售忌讳');
if (!taboo) throw new Error('未找到「地推销售忌讳」评分标准');

const fixApplied = taboo.judgePrompt.includes('真实效果承诺才是扣分对象');
console.log(`[1] 判定 Prompt 是否含修复规则（真实效果承诺才是扣分对象）: ${fixApplied ? '是' : '否'}`);
if (!fixApplied) {
  console.log('结论：修复未写入数据库，测试终止');
  process.exit(1);
}

const gateway = createLLMGateway(process.env, {});
console.log(`[2] LLM judge provider: ${gateway.forTask('judge').name} / ${gateway.forTask('judge_secondary').name}`);

const scenario = {
  id: 'verify-scenario', tenantId, name: '地推验证场景', personaConfigId: 'verify-persona',
  skillPointIds: ['sp-compliance'], scoreItemIds: [taboo.id],
  successCriteria: { passScore: 60 }, durationMinutes: 10, difficulty: 1,
  category: '地推', flowType: 'ground_push', status: 'published', version: 1,
};

function makeSession(turns) {
  const now = new Date().toISOString();
  return {
    id: `verify-${Math.random().toString(36).slice(2, 8)}`,
    tenantId, userId: 'verify-user', scenarioId: scenario.id,
    mode: 'practice', status: 'completed',
    transcript: turns.map((t, i) => ({ seq: i + 1, speaker: t.speaker, text: t.text, at: now })),
    emotionTrace: [], hintsUsed: 0, startedAt: now, endedAt: now,
  };
}

async function runCase(label, turns) {
  const session = makeSession(turns);
  const institutionKB = await store.getProductKB(tenantId);
  const report = await scoreSession(session, scenario, defs, gateway, { institutionKB });
  const item = report.items.find((i) => i.itemId === taboo.id);
  console.log(`\n[${label}] 地推销售忌讳 扣减参数 score = ${item.score}（0=未扣分）`);
  console.log(`  rationale: ${item.rationale?.slice(0, 500)}`);
  if (item.betterScript) console.log(`  betterScript: ${item.betterScript?.slice(0, 200)}`);
  return item.score;
}

const scoreA = await runCase('用例A 信心话术（不应扣分）', [
  { speaker: 'persona', text: '你们这课到底值不值这个钱啊？别到时候白花了。' },
  { speaker: 'trainee', text: '您放心，我们一定会让您觉得值得的。' },
  { speaker: 'persona', text: '行吧，那我考虑一下。' },
]);

const scoreB = await runCase('用例B 班型虚假承诺（应扣分）', [
  { speaker: 'persona', text: '你们一个班多少人啊？孩子多了老师顾不过来吧。' },
  { speaker: 'trainee', text: '我们班就2个孩子，老师肯定能照顾得过来，您放心。' },
  { speaker: 'persona', text: '那还差不多。' },
]);

console.log('\n===== 结论 =====');
const aPass = scoreA === 0;
const bPass = scoreB > 0;
console.log(`用例A（传递信心不扣分）: ${aPass ? '通过' : '失败'}（score=${scoreA}）`);
console.log(`用例B（真实虚假承诺仍扣分）: ${bPass ? '通过' : '失败'}（score=${scoreB}）`);
console.log(aPass && bPass ? '修复已生效 ✓' : '修复未完全生效 ✗');

process.exit(aPass && bPass ? 0 : 1);
