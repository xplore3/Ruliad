import { buildSeedData, createStore } from '@grasp-mvp/infra';
import { seedHistory } from './seed-history.js';

const TENANT = 'tenant-demo';

/**
 * 独立数据初始化脚本：buildSeedData（基础种子）+ seedHistory（合成历史）。
 * 用法：pnpm --filter @grasp-mvp/api-gateway seed
 * （等价于 pnpm build && node dist/seed-demo.js；有 DATABASE_URL 时写入 PostgreSQL，
 * 否则使用内存存储——进程退出即丢失，仅用于校验灌数逻辑。）
 * 幂等：已有场景 / 已有 CertRecord 时对应阶段自动跳过。
 */
async function main() {
  const store = createStore();

  const scenariosBefore = await store.listScenarios(TENANT);
  const fullSeed = buildSeedData();

  if (scenariosBefore.length === 0) {
    await store.seed(fullSeed);
    console.log('[seed] 基础种子已灌入（tenant-demo）');
  } else {
    console.log(`[seed] 已有 ${scenariosBefore.length} 个场景，基础种子跳过`);

    // 增量同步：补充缺失的陪练员
    const existingPersonas = await store.listPersonaConfigs(TENANT);
    const missingPersonas = fullSeed.personaConfigs.filter(
      (p) => !existingPersonas.some((e) => e.id === p.id)
    );
    if (missingPersonas.length > 0) {
      for (const p of missingPersonas) {
        await store.savePersonaConfig(p);
      }
      console.log(`[seed] 增量同步：补充 ${missingPersonas.length} 个陪练员（共 ${existingPersonas.length + missingPersonas.length} 个）`);
    } else {
      console.log(`[seed] 已有 ${existingPersonas.length} 个陪练员，无增量更新`);
    }
  }

  const certsBefore = await store.listCertRecords({});
  await seedHistory(store);
  const certsAfter = await store.listCertRecords({});
  console.log(
    certsBefore.length === 0
      ? `[seed] 合成历史已灌入（新增 ${certsAfter.length} 条认证记录）`
      : `[seed] 已有 ${certsBefore.length} 条认证记录，合成历史跳过`
  );

  // 摘要
  const [orgs, users, trainees, sessions, windows, skillPoints, personas, paths] = await Promise.all([
    store.listOrganizations(TENANT),
    store.listUsers(TENANT),
    store.listUsers(TENANT, 'trainee'),
    store.listSessions({ tenantId: TENANT }),
    store.listExamWindows(TENANT),
    store.listSkillPoints(TENANT),
    store.listPersonaConfigs(TENANT),
    store.listLearningPaths(TENANT),
  ]);
  console.log('[seed] 摘要：');
  console.log(`  组织：${orgs.length}（${orgs.map((o) => o.name).join(' / ')}）`);
  console.log(`  用户：${users.length}（学员 ${trainees.length}）`);
  console.log(`  技能点：${skillPoints.length}  角色：${personas.length}  学习路径：${paths.length}`);
  console.log(`  考核窗口：${windows.length}（${windows.map((w) => `${w.name}[${w.status}]`).join(' / ')}）`);
  console.log(`  会话：${sessions.length}  认证记录：${certsAfter.length}`);
}

main().catch((err) => {
  console.error('[seed] 失败：', err);
  process.exit(1);
});
