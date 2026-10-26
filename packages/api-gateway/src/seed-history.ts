import type {
  CertRecord,
  RuleViolation,
  ScoreItemResult,
  ScoreReport,
  Session,
  SkillScore,
  TranscriptTurn,
} from '@grasp-mvp/core';
import type { Store } from '@grasp-mvp/infra';

const TENANT = 'tenant-demo';

/**
 * 演示历史数据：不依赖 LLM，直接构造确定性的 Session / ScoreReport /
 * CertRecord / UserSkillState（mulberry32 固定种子伪随机）。
 * 幂等：仅当没有任何 CertRecord 时灌入。
 *
 * 数据内容对齐 docs/*.png 设计稿：
 * - 5 大区 × 6 技能点基线考核（得出高管热力图达标率矩阵，每格分母 100）
 * - 3–8 月试点组/对照组月度达标率趋势（31→69 / 27→35）
 * - 合规红线 14 起（华北·夸大收益 7、西部·错误适应症 4、华东二区·夸大收益 3）
 * - 「2026 Q3 L2 认证」23 人名单：18 完成（11 过 / 7 未过）、5 未开始
 * - 主管团队 5 名成员的认证史（林小满连续未达标、赵川 L2、何薇 L1、周迪 L2、沈亦未开始）
 * - 林小满成长数据：W1–W6 进步曲线 43/52/50/59/64/67、口头禅「其实」11/9/7/4、
 *   2 张通过证书、1 条完整复盘会话（session-demo-review，总分 68 / 较上次 +14 / 合规红线）
 */
export async function seedHistory(store: Store): Promise<void> {
  const existing = await store.listCertRecords({});
  if (existing.length > 0) return;

  // ---------------- 确定性伪随机 ----------------
  let rngState = 20260803;
  const rand = (): number => {
    rngState |= 0;
    rngState = (rngState + 0x6d2b79f5) | 0;
    let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const randInt = (min: number, max: number): number => min + Math.floor(rand() * (max - min + 1));

  const SKILL_NAMES: Record<string, string> = {
    'sp-icebreak': '破冰',
    'sp-need': '需求挖掘',
    'sp-value': '价值传递',
    'sp-objection': '异议处理',
    'sp-compliance': '合规表达',
    'sp-closing': '推进成交',
    'sp-chain': '多方决策链',
  };
  const ALL_SKILLS = ['sp-icebreak', 'sp-need', 'sp-value', 'sp-objection', 'sp-compliance', 'sp-closing'];
  const skill = (skillPointId: string, score: number): SkillScore => ({
    skillPointId,
    skillPointName: SKILL_NAMES[skillPointId] ?? skillPointId,
    score,
    maxScore: 100,
  });
  const SCENARIO_OF_SKILL: Record<string, string> = {
    'sp-icebreak': 'scenario-first-visit',
    'sp-need': 'scenario-first-visit',
    'sp-value': 'scenario-price-objection',
    'sp-objection': 'scenario-price-objection',
    'sp-closing': 'scenario-push-forward',
    'sp-compliance': 'scenario-compliance',
  };

  // 用户技能状态累加器（末尾统一落库）
  const skillHistoryAcc = new Map<string, { level?: number; history: UserSkillStateEntry[] }>();
  interface UserSkillStateEntry {
    at: string;
    score: number;
    sessionId: string;
    mode: 'practice' | 'exam';
  }
  const accSkill = (userId: string, skillPointId: string, entry: UserSkillStateEntry, level?: number) => {
    const key = `${userId}:${skillPointId}`;
    const acc = skillHistoryAcc.get(key) ?? { history: [] };
    acc.history.push(entry);
    if (level !== undefined) acc.level = level;
    skillHistoryAcc.set(key, acc);
  };

  interface SyntheticSession {
    id: string;
    userId: string;
    scenarioId: string;
    mode: 'practice' | 'exam';
    /** 结束时间（ISO），报告 createdAt 与之对齐 */
    at: string;
    totalScore: number;
    passed: boolean;
    examWindowId?: string;
    skillScores?: SkillScore[];
    items?: ScoreItemResult[];
    violations?: RuleViolation[];
    fatalViolation?: boolean;
    interruptions?: number;
    fillerCounts?: Record<string, number>;
    coverageHits?: string[];
    coverageMisses?: string[];
    transcript?: TranscriptTurn[];
    emotionTrace?: Session['emotionTrace'];
    prevSessionId?: string;
    hintsUsed?: number;
    /** 同步写入 UserSkillState.history 的技能得分（缺省用 skillScores） */
    trackSkills?: boolean;
  }

  const writeSession = async (opts: SyntheticSession): Promise<void> => {
    const endedMs = new Date(opts.at).getTime();
    const session: Session = {
      id: opts.id,
      tenantId: TENANT,
      userId: opts.userId,
      scenarioId: opts.scenarioId,
      mode: opts.mode,
      status: 'completed',
      transcript: opts.transcript ?? [],
      emotionTrace: opts.emotionTrace ?? [],
      hintsUsed: opts.hintsUsed ?? 0,
      ...(opts.prevSessionId ? { prevSessionId: opts.prevSessionId } : {}),
      ...(opts.examWindowId ? { examWindowId: opts.examWindowId } : {}),
      startedAt: new Date(endedMs - 8 * 60 * 1000).toISOString(),
      endedAt: opts.at,
    };
    await store.createSession(session);
    const report: ScoreReport = {
      id: `rep-${opts.id}`,
      sessionId: opts.id,
      totalScore: opts.totalScore,
      passed: opts.passed,
      fatalViolation: opts.fatalViolation ?? false,
      skillScores: opts.skillScores ?? [],
      items: opts.items ?? [],
      violations: opts.violations ?? [],
      ruleStats: {
        interruptions: opts.interruptions ?? 0,
        fillerCounts: opts.fillerCounts ?? {},
        coverageHits: opts.coverageHits ?? [],
        coverageMisses: opts.coverageMisses ?? [],
      },
      createdAt: opts.at,
    };
    await store.saveScoreReport(report);
    if (opts.trackSkills) {
      for (const s of opts.skillScores ?? []) {
        accSkill(opts.userId, s.skillPointId, { at: opts.at, score: s.score, sessionId: opts.id, mode: opts.mode });
      }
    }
  };

  const saveCert = async (cert: CertRecord): Promise<void> => {
    await store.saveCertRecord(cert);
  };

  // ============================================================
  // 1. 组织 × 技能点 基线考核（高管热力图：每格分母 100，达标率精确到设计稿）
  //    口径：不挂考核窗口的 exam 会话（baselineOnly）
  // ============================================================
  const HEATMAP: Array<{
    orgKey: string;
    users: string[];
    /** skillPointId -> 达标率 %（0-100） */
    targets: number[];
  }> = [
    { orgKey: 'hd1', users: bulkUserIds('hd1'), targets: [88, 74, 66, 43, 81, 38] },
    { orgKey: 'hd2', users: bulkUserIds('hd2'), targets: [72, 61, 58, 51, 77, 46] },
    { orgKey: 'hb', users: bulkUserIds('hb'), targets: [64, 55, 49, 34, 69, 31] },
    { orgKey: 'hn', users: bulkUserIds('hn'), targets: [81, 70, 72, 60, 85, 55] },
    { orgKey: 'xb', users: bulkUserIds('xb'), targets: [58, 47, 44, 29, 62, 27] },
  ];
  // 合规红线分布：组织 -> { detail, count }（放在该组织未达标池前 N 场）
  const REDLINE_PLAN: Record<string, { detail: string; count: number }> = {
    hb: { detail: '夸大收益表述', count: 7 },
    xb: { detail: '错误适应症', count: 4 },
    hd2: { detail: '夸大收益表述', count: 3 },
  };

  function bulkUserIds(orgKey: string): string[] {
    return Array.from({ length: 10 }, (_, i) => `user-bulk-${orgKey}-${String(i + 1).padStart(2, '0')}`);
  }

  for (const { orgKey, users, targets } of HEATMAP) {
    const passPool = Math.max(...targets); // 达标会话数
    const failPool = Math.max(...targets.map((t) => 100 - t)); // 未达标会话数
    const redline = REDLINE_PLAN[orgKey];

    // 达标池：第 i 场包含技能 k 当且仅当 i <= target_k
    for (let i = 1; i <= passPool; i++) {
      const skills = ALL_SKILLS.filter((_, k) => i <= targets[k]);
      const day = 27 + ((i - 1) % 7); // 2026-07-27 ~ 08-02
      const at = `2026-0${day > 31 ? 8 : 7}-${String(day > 31 ? day - 31 : day).padStart(2, '0')}T${String(
        randInt(9, 17)
      ).padStart(2, '0')}:30:00+08:00`;
      await writeSession({
        id: `sess-hm-${orgKey}-p${String(i).padStart(3, '0')}`,
        userId: users[(i - 1) % users.length],
        scenarioId: SCENARIO_OF_SKILL[skills[0] ?? 'sp-icebreak'],
        mode: 'exam',
        at,
        totalScore: randInt(76, 92),
        passed: true,
        skillScores: skills.map((sp) => skill(sp, randInt(75, 95))),
        fillerCounts: i % 5 === 0 ? { 其实: randInt(3, 8) } : {},
      });
    }
    // 未达标池：第 j 场包含技能 k 当且仅当 j <= 100 - target_k
    for (let j = 1; j <= failPool; j++) {
      const skills = ALL_SKILLS.filter((_, k) => j <= 100 - targets[k]);
      const day = 27 + ((j - 1) % 7);
      const at = `2026-0${day > 31 ? 8 : 7}-${String(day > 31 ? day - 31 : day).padStart(2, '0')}T${String(
        randInt(9, 17)
      ).padStart(2, '0')}:00:00+08:00`;
      const withRedline = redline !== undefined && j <= redline.count;
      await writeSession({
        id: `sess-hm-${orgKey}-f${String(j).padStart(3, '0')}`,
        userId: users[(j - 1) % users.length],
        scenarioId: SCENARIO_OF_SKILL[skills[0] ?? 'sp-closing'],
        mode: 'exam',
        at,
        totalScore: withRedline ? randInt(30, 45) : randInt(45, 66),
        passed: false,
        skillScores: skills.map((sp) => skill(sp, randInt(30, 58))),
        ...(withRedline
          ? {
              fatalViolation: true,
              violations: [
                {
                  ruleId: 'redline-compliance',
                  kind: 'redline',
                  detail: redline.detail,
                  turnSeq: 4,
                  fatal: true,
                },
              ],
            }
          : {}),
        fillerCounts: j % 4 === 0 ? { 其实: randInt(2, 6) } : {},
      });
    }
  }

  // ============================================================
  // 2. 月度达标率趋势（2026-03 ~ 2026-08，试点组 vs POC 对照组，每月每组 100 场）
  // ============================================================
  const TREND: Array<{ month: string; treatment: number; control: number }> = [
    { month: '2026-03', treatment: 31, control: 27 },
    { month: '2026-04', treatment: 40, control: 29 },
    { month: '2026-05', treatment: 48, control: 30 },
    { month: '2026-06', treatment: 56, control: 32 },
    { month: '2026-07', treatment: 63, control: 33 },
    { month: '2026-08', treatment: 69, control: 35 },
  ];
  const pilotUsers = ['hd1', 'hd2', 'hb', 'hn', 'xb'].flatMap((k) => bulkUserIds(k));
  const controlUsers = Array.from({ length: 10 }, (_, i) => `user-ctrl-${String(i + 1).padStart(2, '0')}`);

  for (const { month, treatment, control } of TREND) {
    for (const group of ['treatment', 'control'] as const) {
      const target = group === 'treatment' ? treatment : control;
      const users = group === 'treatment' ? pilotUsers : controlUsers;
      for (let i = 1; i <= 100; i++) {
        const passed = i <= target;
        await writeSession({
          id: `sess-tr-${group}-${month}-${String(i).padStart(3, '0')}`,
          userId: users[(i - 1) % users.length],
          scenarioId: 'scenario-first-visit',
          mode: 'exam',
          at: `${month}-${String(randInt(5, 25)).padStart(2, '0')}T${String(randInt(9, 17)).padStart(2, '0')}:15:00+08:00`,
          totalScore: passed ? randInt(76, 90) : randInt(40, 65),
          passed,
          examWindowId: `trend-${group}-${month}`,
          skillScores: [],
        });
      }
    }
  }

  // ============================================================
  // 3. 「2026 Q3 L2 认证」23 人名单：18 完成（11 过 / 7 未过）、5 未开始
  //    通过：赵川、周迪、user-new-01..09；未通过：user-new-10..16
  //    未开始：林小满、沈亦、何薇、user-new-17、user-new-18
  // ============================================================
  const Q3_WINDOW = 'exam-window-q3';
  const Q3_SCENARIOS = ['scenario-first-visit', 'scenario-price-objection', 'scenario-push-forward'];
  const Q3_SKILLS: Record<string, string[]> = {
    'scenario-first-visit': ['sp-icebreak', 'sp-need'],
    'scenario-price-objection': ['sp-value', 'sp-objection'],
    'scenario-push-forward': ['sp-closing', 'sp-objection'],
  };

  interface RosterResult {
    userId: string;
    passed: boolean;
    at: string;
    /** 指定 skillDetail（默认按 passed 随机），key 为 skillPointId */
    skillDetail?: Record<string, number>;
    totalScore?: number;
  }
  const rosterResults: RosterResult[] = [
    {
      userId: 'user-trainee-2', // 赵川：已认证 L2，最弱 推进成交
      passed: true,
      at: '2026-08-01T10:30:00+08:00',
      skillDetail: { 'sp-icebreak': 88, 'sp-need': 84, 'sp-value': 82, 'sp-objection': 80, 'sp-compliance': 85, 'sp-closing': 76 },
      totalScore: 84,
    },
    {
      userId: 'user-trainee-5', // 周迪：已认证 L2，最弱 合规表达
      passed: true,
      at: '2026-08-02T11:00:00+08:00',
      skillDetail: { 'sp-icebreak': 86, 'sp-need': 82, 'sp-value': 80, 'sp-objection': 78, 'sp-compliance': 74, 'sp-closing': 81 },
      totalScore: 82,
    },
    ...Array.from({ length: 9 }, (_, i) => ({
      userId: `user-new-${String(i + 1).padStart(2, '0')}`,
      passed: true,
      at: `2026-08-0${(i % 2) + 1}T${String(randInt(9, 16)).padStart(2, '0')}:40:00+08:00`,
    })),
    ...Array.from({ length: 7 }, (_, i) => ({
      userId: `user-new-${String(i + 10).padStart(2, '0')}`,
      passed: false,
      at: `2026-08-0${(i % 2) + 1}T${String(randInt(9, 16)).padStart(2, '0')}:20:00+08:00`,
    })),
  ];

  for (const r of rosterResults) {
    const sessionIds: string[] = [];
    const skillDetailAcc = new Map<string, number[]>();
    let totalSum = 0;
    for (const scenarioId of Q3_SCENARIOS) {
      const skills = Q3_SKILLS[scenarioId];
      const sessionId = `sess-q3-${r.userId}-${scenarioId.replace('scenario-', '')}`;
      sessionIds.push(sessionId);
      const scores = skills.map((sp) => {
        const score = r.skillDetail?.[sp] ?? (r.passed ? randInt(72, 92) : randInt(35, 60));
        const list = skillDetailAcc.get(sp) ?? [];
        list.push(score);
        skillDetailAcc.set(sp, list);
        return skill(sp, score);
      });
      const sessionTotal = r.passed ? randInt(76, 90) : randInt(48, 66);
      totalSum += sessionTotal;
      await writeSession({
        id: sessionId,
        userId: r.userId,
        scenarioId,
        mode: 'exam',
        at: r.at,
        totalScore: sessionTotal,
        passed: r.passed,
        examWindowId: Q3_WINDOW,
        skillScores: scores,
        trackSkills: true,
      });
    }
    const skillDetail = Object.fromEntries(
      [...skillDetailAcc.entries()].map(([sp, list]) => [
        sp,
        Math.round(list.reduce((a, b) => a + b, 0) / list.length),
      ])
    );
    // 指定的 skillDetail 补全（赵川/周迪：覆盖合并值以保证最弱技能点符合设计稿）
    const finalDetail = r.skillDetail ? { ...skillDetail, ...r.skillDetail } : skillDetail;
    await saveCert({
      id: `cert-q3-${r.userId}`,
      tenantId: TENANT,
      userId: r.userId,
      examWindowId: Q3_WINDOW,
      passed: r.passed,
      totalScore: r.totalScore ?? Math.round(totalSum / Q3_SCENARIOS.length),
      skillDetail: finalDetail,
      sessionIds,
      issuedAt: r.at,
    });
  }

  // ============================================================
  // 4. 主管团队成员历史认证（赵川 L1过+L2挂、周迪 L1挂+L1过+L2挂、何薇 L1挂+L1过）
  // ============================================================
  const historical: Array<{
    userId: string;
    scenarioId: string;
    examWindowId: string;
    at: string;
    passed: boolean;
    totalScore: number;
    skillDetail: Record<string, number>;
  }> = [
    { userId: 'user-trainee-2', scenarioId: 'scenario-first-visit', examWindowId: 'exam-window-l1', at: '2026-05-15T10:00:00+08:00', passed: true, totalScore: 83, skillDetail: { 'sp-icebreak': 85, 'sp-need': 80 } },
    { userId: 'user-trainee-2', scenarioId: 'scenario-price-objection', examWindowId: 'exam-window-l2-jul', at: '2026-07-15T14:00:00+08:00', passed: false, totalScore: 64, skillDetail: { 'sp-value': 70, 'sp-objection': 55 } },
    { userId: 'user-trainee-5', scenarioId: 'scenario-first-visit', examWindowId: 'exam-window-l1', at: '2026-05-12T10:00:00+08:00', passed: false, totalScore: 58, skillDetail: { 'sp-icebreak': 62, 'sp-need': 52 } },
    { userId: 'user-trainee-5', scenarioId: 'scenario-first-visit', examWindowId: 'exam-window-l1', at: '2026-05-28T10:00:00+08:00', passed: true, totalScore: 80, skillDetail: { 'sp-icebreak': 84, 'sp-need': 76 } },
    { userId: 'user-trainee-5', scenarioId: 'scenario-push-forward', examWindowId: 'exam-window-l2-jul', at: '2026-07-16T14:00:00+08:00', passed: false, totalScore: 61, skillDetail: { 'sp-closing': 64, 'sp-objection': 56 } },
    { userId: 'user-trainee-4', scenarioId: 'scenario-first-visit', examWindowId: 'exam-window-l1', at: '2026-05-20T10:00:00+08:00', passed: false, totalScore: 57, skillDetail: { 'sp-icebreak': 60, 'sp-need': 52 } },
    { userId: 'user-trainee-4', scenarioId: 'scenario-first-visit', examWindowId: 'exam-window-l1', at: '2026-06-10T10:00:00+08:00', passed: true, totalScore: 79, skillDetail: { 'sp-icebreak': 82, 'sp-need': 78, 'sp-value': 61 } },
  ];
  for (const h of historical) {
    const sessionId = `sess-hist-${h.userId}-${h.at.slice(0, 10)}`;
    await writeSession({
      id: sessionId,
      userId: h.userId,
      scenarioId: h.scenarioId,
      mode: 'exam',
      at: h.at,
      totalScore: h.totalScore,
      passed: h.passed,
      examWindowId: h.examWindowId,
      skillScores: Object.entries(h.skillDetail).map(([sp, score]) => skill(sp, score)),
      trackSkills: true,
    });
    await saveCert({
      id: `cert-hist-${h.userId}-${h.at.slice(0, 10)}`,
      tenantId: TENANT,
      userId: h.userId,
      examWindowId: h.examWindowId,
      passed: h.passed,
      totalScore: h.totalScore,
      skillDetail: h.skillDetail,
      sessionIds: [sessionId],
      issuedAt: h.at,
    });
  }
  // 何薇最近一次练习（避免被判「本周未开练」）
  await writeSession({
    id: 'sess-practice-hewei-0802',
    userId: 'user-trainee-4',
    scenarioId: 'scenario-first-visit',
    mode: 'practice',
    at: '2026-08-02T19:30:00+08:00',
    totalScore: 72,
    passed: false,
    skillScores: [skill('sp-icebreak', 76), skill('sp-need', 68)],
    trackSkills: true,
  });

  // ============================================================
  // 5. 林小满（user-trainee-1）：认证史 + 成长曲线 + 口头禅 + 复盘演示会话
  // ============================================================
  const LX = 'user-trainee-1';
  // 认证史：L1 通过（06-02 加权 81）、合规表达 L3 通过（06-18）、L2 两次未过（07-12 / 07-19，连续未达标）
  const lxExams: Array<{
    scenarioId: string;
    examWindowId: string;
    at: string;
    passed: boolean;
    totalScore: number;
    skillDetail: Record<string, number>;
    tag: string;
  }> = [
    { scenarioId: 'scenario-first-visit', examWindowId: 'exam-window-l1', at: '2026-06-02T10:00:00+08:00', passed: true, totalScore: 81, skillDetail: { 'sp-icebreak': 85, 'sp-need': 76 }, tag: 'l1' },
    { scenarioId: 'scenario-compliance', examWindowId: 'exam-window-comp-l3', at: '2026-06-18T10:00:00+08:00', passed: true, totalScore: 90, skillDetail: { 'sp-compliance': 90 }, tag: 'comp-l3' },
    { scenarioId: 'scenario-price-objection', examWindowId: 'exam-window-l2-jul', at: '2026-07-12T14:00:00+08:00', passed: false, totalScore: 62, skillDetail: { 'sp-value': 70, 'sp-objection': 47 }, tag: 'l2-1' },
    { scenarioId: 'scenario-push-forward', examWindowId: 'exam-window-l2-jul', at: '2026-07-19T14:00:00+08:00', passed: false, totalScore: 58, skillDetail: { 'sp-closing': 60, 'sp-objection': 45 }, tag: 'l2-2' },
  ];
  for (const e of lxExams) {
    const sessionId = `sess-lx-${e.tag}`;
    await writeSession({
      id: sessionId,
      userId: LX,
      scenarioId: e.scenarioId,
      mode: 'exam',
      at: e.at,
      totalScore: e.totalScore,
      passed: e.passed,
      examWindowId: e.examWindowId,
      skillScores: Object.entries(e.skillDetail).map(([sp, score]) => skill(sp, score)),
      trackSkills: true,
    });
    await saveCert({
      id: `cert-lx-${e.tag}`,
      tenantId: TENANT,
      userId: LX,
      examWindowId: e.examWindowId,
      passed: e.passed,
      totalScore: e.totalScore,
      skillDetail: e.skillDetail,
      sessionIds: [sessionId],
      issuedAt: e.at,
    });
  }

  // 进步曲线 W1–W6：43 / 52 / 50 / 59 / 64 / 67；口头禅「其实」W1–W4：11 / 9 / 7 / 4
  const weekly: Array<{ at: string; total: number; filler: number }> = [
    { at: '2026-06-17T19:00:00+08:00', total: 43, filler: 11 },
    { at: '2026-06-24T19:00:00+08:00', total: 52, filler: 9 },
    { at: '2026-07-01T19:00:00+08:00', total: 50, filler: 7 },
    { at: '2026-07-08T19:00:00+08:00', total: 59, filler: 4 },
    { at: '2026-07-15T19:00:00+08:00', total: 64, filler: 3 },
    { at: '2026-07-22T19:00:00+08:00', total: 67, filler: 3 },
  ];
  for (let i = 0; i < weekly.length; i++) {
    const w = weekly[i];
    await writeSession({
      id: `sess-lx-w${i + 1}`,
      userId: LX,
      scenarioId: 'scenario-first-visit',
      mode: 'practice',
      at: w.at,
      totalScore: w.total,
      passed: false,
      skillScores: [skill('sp-icebreak', w.total + 4), skill('sp-need', Math.max(20, w.total - 6))],
      fillerCounts: { 其实: w.filler },
      trackSkills: true,
    });
  }

  // 07-24 「再考虑一下」练习未达标（54 分 → 任务页强制重练；也是复盘演示的「上次」）
  await writeSession({
    id: 'sess-lx-retry-prev',
    userId: LX,
    scenarioId: 'scenario-push-forward',
    mode: 'practice',
    at: '2026-07-24T20:00:00+08:00',
    totalScore: 54,
    passed: false,
    skillScores: [skill('sp-closing', 50), skill('sp-objection', 46)],
    fillerCounts: { 其实: 5 },
    trackSkills: true,
  });

  // 07-30 复盘演示会话：总分 68（较上次 +14）、达标线 75、合规红线一票否决
  const demoStart = new Date('2026-07-30T14:00:00+08:00').getTime();
  const demoTurns: Array<{ sec: number; speaker: 'trainee' | 'persona'; text: string; arousal: number }> = [
    { sec: 12, speaker: 'persona', text: '你有什么事快说，我一会儿还有个会。', arousal: 0.33 },
    { sec: 20, speaker: 'trainee', text: '主任您好，我是××的小林，今天想用三分钟跟您汇报一个新的降糖方案。', arousal: 0.37 },
    { sec: 48, speaker: 'persona', text: '又是新药？你们这类产品我看过太多了，数据都是自己做的吧。', arousal: 0.62 },
    { sec: 62, speaker: 'trainee', text: '我们这款效果特别好，基本上所有患者都能达标。', arousal: 0.86 },
    { sec: 80, speaker: 'persona', text: '（皱眉）这种话我听不了。你们公司培训就这么讲的？', arousal: 0.88 },
    { sec: 96, speaker: 'trainee', text: '抱歉主任，我说得不严谨。III 期研究中在××亚组的达标率是 62%，我把研究摘要留给您。', arousal: 0.55 },
    { sec: 125, speaker: 'persona', text: '行，摘要放这儿吧。下次带上你们的医学部同事。', arousal: 0.42 },
  ];
  const bandOf = (arousal: number) => (arousal < 0.4 ? 'calm' : arousal < 0.7 ? 'guarded' : 'annoyed');
  const demoTranscript: TranscriptTurn[] = demoTurns.map((t, i) => ({
    seq: i + 1,
    speaker: t.speaker,
    text: t.text,
    at: new Date(demoStart + t.sec * 1000).toISOString(),
    ...(t.speaker === 'persona' ? { emotion: { arousal: t.arousal, bandKey: bandOf(t.arousal) } } : {}),
  }));
  const demoItems: ScoreItemResult[] = [
    {
      itemId: 'item-icebreak-1',
      itemName: '开场与时间承诺',
      skillPointId: 'sp-icebreak',
      levelKey: 'good',
      levelLabel: '优',
      score: 88,
      quote: '主任您好，我是××的小林，今天想用三分钟跟您汇报一个新的降糖方案。',
      quoteTurnSeq: 2,
      rationale: '开场 20 秒内完成自我介绍并给出 3 分钟时间承诺，符合张伟三步破冰法第一步。',
      confidence: 0.95,
      judgeAgree: true,
      isReference: false,
      isObservation: false,
      layer: 'company',
    },
    {
      itemId: 'item-obj-1',
      itemName: '质疑首反应',
      skillPointId: 'sp-objection',
      levelKey: 'ok',
      levelLabel: '中',
      score: 50,
      quote: '我们这款效果特别好，基本上所有患者都能达标。',
      quoteTurnSeq: 4,
      rationale: '面对「数据都是自己做的吧」的质疑未先共情澄清，直接给出绝对化表述。',
      betterScript: '「主任，我理解您的顾虑。这是 III 期随机双盲研究，×× 亚组达标率 62%，摘要留给您。」',
      confidence: 0.9,
      judgeAgree: true,
      isReference: false,
      isObservation: false,
      layer: 'company',
    },
    {
      itemId: 'item-obj-2',
      itemName: '证据引用规范',
      skillPointId: 'sp-objection',
      levelKey: 'ok',
      levelLabel: '中',
      score: 55,
      quote: 'III 期研究中在××亚组的达标率是 62%，我把研究摘要留给您。',
      quoteTurnSeq: 6,
      rationale: '补充引用了研究类型与亚组人群，但首次提及数据时未给出处。（双 judge 不一致，本项为参考项）',
      betterScript: '「这是发表在《中华内分泌代谢杂志》的 III 期研究，×× 亚组达标率 62%，摘要我留给您。」',
      confidence: 0.6,
      judgeAgree: false,
      isReference: true,
      isObservation: false,
      layer: 'company',
    },
    {
      itemId: 'item-comp-1',
      itemName: '合规红线',
      skillPointId: 'sp-compliance',
      levelKey: 'poor',
      levelLabel: '否决',
      score: 2,
      quote: '我们这款效果特别好，基本上所有患者都能达标。',
      quoteTurnSeq: 4,
      rationale: '「基本上所有患者都能达标」触发违禁话术句式（夸大收益）→ 本项一票否决。',
      betterScript: '「主任，我不谈『所有患者』。III 期××亚组达标率 62%，这是研究摘要，您先看数据再判断。」',
      confidence: 0.98,
      judgeAgree: true,
      isReference: false,
      isObservation: false,
      layer: 'company',
    },
    {
      itemId: 'item-closing-1',
      itemName: '推进成交尝试',
      skillPointId: 'sp-closing',
      levelKey: 'ok',
      levelLabel: '中',
      score: 55,
      quote: 'III 期研究中在××亚组的达标率是 62%，我把研究摘要留给您。',
      quoteTurnSeq: 6,
      rationale: '最终留下研究摘要作为下一步触点，但未明确约定回访时间或推进到下一步动作。',
      betterScript: '「主任，摘要我留给您。我周四上午 10 点再联系您，咱们根据数据再详细聊一次，您看行吗？」',
      confidence: 0.85,
      judgeAgree: true,
      isReference: false,
      isObservation: false,
      layer: 'company',
    },
  ];
  await writeSession({
    id: 'session-demo-review',
    userId: LX,
    scenarioId: 'scenario-first-visit',
    mode: 'practice',
    at: '2026-07-30T14:03:00+08:00',
    totalScore: 68,
    passed: false,
    fatalViolation: true,
    skillScores: [skill('sp-icebreak', 72), skill('sp-need', 66), skill('sp-objection', 48), skill('sp-compliance', 30), skill('sp-closing', 55)],
    items: demoItems,
    violations: [
      { ruleId: 'redline-absolutize', kind: 'redline', detail: '夸大收益表述', turnSeq: 4, fatal: true },
      { ruleId: 'rule-interruption', kind: 'interruption', detail: '打断客户 1 次', turnSeq: 3, fatal: false },
    ],
    interruptions: 1,
    fillerCounts: { 其实: 4 },
    coverageHits: ['开场自我介绍与时间承诺', '循证证据引用', '下一步约定'],
    coverageMisses: ['适应症合规表述', '异议首反应'],
    transcript: demoTranscript,
    emotionTrace: demoTurns.map((t, i) => ({
      seq: i + 1,
      arousal: t.arousal,
      bandKey: bandOf(t.arousal),
      at: new Date(demoStart + t.sec * 1000).toISOString(),
    })),
    prevSessionId: 'sess-lx-retry-prev',
    hintsUsed: 1,
    trackSkills: true,
  });

  // 林小满技能雷达终值（合规表达最强 90、异议处理最弱 45）与技能地图档位（L2/2/1/1/3/0）
  const radar: Array<{ sp: string; score: number; level: number }> = [
    { sp: 'sp-icebreak', score: 85, level: 2 },
    { sp: 'sp-need', score: 60, level: 2 },
    { sp: 'sp-value', score: 60, level: 1 },
    { sp: 'sp-objection', score: 45, level: 1 },
    { sp: 'sp-compliance', score: 90, level: 3 },
    { sp: 'sp-closing', score: 55, level: 0 },
  ];
  for (const r of radar) {
    accSkill(LX, r.sp, { at: '2026-07-30T14:03:00+08:00', score: r.score, sessionId: 'session-demo-review', mode: 'practice' }, r.level);
  }

  // 林小满任务卡状态：主线首访破冰（进行中）、价格异议轻量复训（D7）、再考虑一下强制重练、合规已通过
  await store.upsertScenarioTask({
    userId: LX,
    scenarioId: 'scenario-first-visit',
    status: 'in_progress',
    bestScore: 81,
    lastSessionId: 'session-demo-review',
  });
  await store.upsertScenarioTask({
    userId: LX,
    scenarioId: 'scenario-price-objection',
    status: 'passed',
    bestScore: 78,
    isReview: true,
    // 复训到期：距种子构建 12 小时内（/tasks 给出 D7 标签）
    reviewDueAt: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
  });
  await store.upsertScenarioTask({
    userId: LX,
    scenarioId: 'scenario-push-forward',
    status: 'failed_pending_retry',
    bestScore: 54,
    lastSessionId: 'sess-lx-retry-prev',
  });
  await store.upsertScenarioTask({
    userId: LX,
    scenarioId: 'scenario-compliance',
    status: 'passed',
    bestScore: 90,
  });

  // ============================================================
  // 6. 用户技能状态统一落库
  // ============================================================
  for (const [key, acc] of skillHistoryAcc) {
    const [userId, skillPointId] = key.split(':');
    const history = [...acc.history].sort((a, b) => a.at.localeCompare(b.at));
    const latest = history[history.length - 1];
    await store.upsertUserSkillState({
      userId,
      skillPointId,
      currentLevel: acc.level ?? Math.min(5, Math.max(0, Math.floor((latest?.score ?? 0) / 20))),
      history,
    });
  }
}
