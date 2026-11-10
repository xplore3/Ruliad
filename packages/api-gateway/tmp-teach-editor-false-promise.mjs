// 让场景编辑器自己修改「虚假承诺」判定规则：走真实 /library/voice-config 流程（预览→应用）
// 运行：cd packages/api-gateway && node --env-file=.env tmp-teach-editor-false-promise.mjs
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { createStore } from '@grasp-mvp/infra';
import { createLLMGateway } from '@grasp-mvp/llm-gateway';
import { voiceConfigRoutes } from './dist/routes/voice-config.js';

const INSTRUCTION = process.env.INSTRUCTION ?? [
  '刚才那次模拟演练，LLM 判定使用者说"您放心，我们一定会让您觉得值得的"是虚假承诺。',
  '虚假承诺应该是对孩子的学习的一些具体情况，做出与实际情况不同的保证。',
  '例如在初始化信息录入中一个班为8人，但是销售为了让客户选择机构，谎称一个班2个人，这就是虚假承诺。',
  '但是说"您过来以后一定会觉得值得的"，更多的是传递信心，并不是虚构了事实、做出超出机构实际情况的保证。',
  '在判定使用者虚假承诺的时候，评分库应该对这两种情况进行区分，修正这个问题。',
].join('');

const store = createStore();
const gateway = createLLMGateway(process.env, {});
const app = Fastify();
await app.register(multipart);
app.addHook('onRequest', async (request) => {
  request.userId = 'user-admin-1';
  request.userRole = 'admin';
  request.tenantId = 'tenant-demo';
});
await app.register((a) => voiceConfigRoutes(a, { store, gateway, speech: { asr: {} } }), { prefix: '/api/v1' });

const before = (await store.listScoreItemDefs('tenant-demo')).find((d) => d.name === '地推销售忌讳');
console.log('[0] 修改前 judgePrompt 长度:', before.judgePrompt.length);

console.log('\n[1] 把指令交给场景编辑器（文本通道，与语音同流程）...');
const contextScenario = process.env.CONTEXT_SCENARIO;
const preview = await app.inject({
  method: 'POST', url: '/api/v1/library/voice-config',
  payload: { text: INSTRUCTION, context: contextScenario ? { scenarioId: contextScenario } : {} },
});
if (preview.statusCode !== 200) {
  console.log('预览失败:', preview.statusCode, preview.body);
  process.exit(1);
}
const body = preview.json();
if (body.noChange) {
  console.log('编辑器判断：无需修改。回复:', body.reply);
  await app.close();
  process.exit(0);
}
console.log('编辑器回复:', body.reply);
console.log('操作:', JSON.stringify(body.operations?.map((o) => ({ target: o.target, action: o.action, subject: o.subject, scope: o.scope, planKind: o.planKind })), null, 2));
if (body.operations?.[0]?.diagnosis) console.log('诊断:', JSON.stringify(body.operations[0].diagnosis, null, 2));
if (body.scoreExplain) console.log('注意：被分流为评分解读，没有生成修改计划');
if (!body.commandId) { console.log('没有 commandId，流程终止'); process.exit(1); }

console.log('\n[2] 确认应用预览（等同于点击「确认应用」）...');
const applied = await app.inject({
  method: 'POST', url: '/api/v1/library/voice-config',
  payload: { apply: true, commandId: body.commandId, expectedRevisions: body.expectedRevisions },
});
console.log('应用结果:', applied.statusCode, applied.body.slice(0, 400));

const after = (await store.listScoreItemDefs('tenant-demo')).find((d) => d.name === '地推销售忌讳');
console.log('\n[3] 修改后 judgePrompt 长度:', after.judgePrompt.length);
if (after.judgePrompt !== before.judgePrompt) {
  console.log('新增片段:');
  console.log(after.judgePrompt.slice(before.judgePrompt.length));
} else {
  console.log('judgePrompt 未发生变化');
}
await app.close();
process.exit(0);
