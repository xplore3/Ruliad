import type { ScoreCategory, ScoreItemDef } from '@grasp-mvp/core';
import type { SeedData } from './store.js';
import { hashPassword } from './password.js';

const TENANT = 'tenant-demo';

/** 其余三类相对底版（咨询接待）的评分标准 id 前缀 */
const SCORE_CATEGORY_PREFIX: [ScoreCategory, string][] = [
  ['地推', 'dt'],
  ['电销', 'dx'],
  ['现场成交', 'xc'],
];

/**
 * 评分标准四分类：底版 7 条归「咨询接待」，地推/电销/现场成交各复制一套（id 加前缀），
 * 内容初始一致，四类在评分标准库中独立增删维护。
 */
function withScoreItemCategories(base: ScoreItemDef[]): ScoreItemDef[] {
  const marked = base.map((item) => ({ ...item, category: '咨询接待' as const }));
  const copies = SCORE_CATEGORY_PREFIX.flatMap(([category, prefix]) =>
    marked.map((item) => ({
      ...item,
      id: item.id.replace(/^item-/, `item-${prefix}-`),
      category,
    }))
  );
  return [...marked, ...copies];
}

/** 华东一区考核名单 23 人（5 名主管团队成员 + 18 名新人班学员） */
export const Q3_ROSTER_USER_IDS = [
  'user-trainee-1',
  'user-trainee-2',
  'user-trainee-3',
  'user-trainee-4',
  'user-trainee-5',
  ...Array.from({ length: 18 }, (_, i) => `user-new-${String(i + 1).padStart(2, '0')}`),
];

const NEWBIE_NAMES = [
  '陈晨',
  '李想',
  '王雪',
  '张帆',
  '刘畅',
  '杨帆',
  '黄睿',
  '周洁',
  '吴迪',
  '郑楠',
  '孙阳',
  '马悦',
  '朱琳',
  '胡波',
  '郭静',
  '林涛',
  '高翔',
  '罗成',
];

/**
 * 演示种子数据：教育培训机构 AI 销售陪练场景（对齐 docs/*.png 设计稿）。
 * - 5 个大区组织；华东一区含主管团队（5 人）、新人班（18 人）、直营二组（批量用户）
 * - 6 个核心技能点 + 1 个锁定技能点（多方决策链拆解）
 * - 3 个家长角色 / 4 个场景 / 1 条新人学习路径 / 4 个考核窗口
 * 所有 id 使用稳定字符串，可重复执行不产生差异。
 * 所有种子用户密码统一为 '123456'（scrypt 哈希，随机 salt，每次构建不同属正常）。
 */
export function buildSeedData(): SeedData {
  const passwordHash = hashPassword('123456');

  const trainee = (
    id: string,
    name: string,
    username: string,
    orgId: string,
    teamId?: string
  ) => ({
    id,
    tenantId: TENANT,
    orgId,
    ...(teamId ? { teamId } : {}),
    name,
    role: 'trainee' as const,
    username,
    passwordHash,
  });

  // 每个大区的批量学员（承载组织×技能点基线考核数据）
  const bulkOrgs = [
    { orgId: 'org-hd1', teamId: 'team-hd1-a', key: 'hd1' },
    { orgId: 'org-hd2', teamId: 'team-hd2-a', key: 'hd2' },
    { orgId: 'org-hb', teamId: 'team-hb-a', key: 'hb' },
    { orgId: 'org-hn', teamId: 'team-hn-a', key: 'hn' },
    { orgId: 'org-xb', teamId: 'team-xb-a', key: 'xb' },
  ];
  const bulkUsers = bulkOrgs.flatMap(({ orgId, teamId, key }) =>
    Array.from({ length: 10 }, (_, i) =>
      trainee(
        `user-bulk-${key}-${String(i + 1).padStart(2, '0')}`,
        `${key.toUpperCase()} 学员 ${String(i + 1).padStart(2, '0')}`,
        `bulk-${key}-${String(i + 1).padStart(2, '0')}`,
        orgId,
        teamId
      )
    )
  );
  // POC 对照组（未参训）
  const controlUsers = Array.from({ length: 10 }, (_, i) =>
    trainee(
      `user-ctrl-${String(i + 1).padStart(2, '0')}`,
      `对照组学员 ${String(i + 1).padStart(2, '0')}`,
      `ctrl-${String(i + 1).padStart(2, '0')}`,
      'org-hd2',
      'team-hd2-b'
    )
  );

  // ── 批量生成陪练员（教育培训机构家长，覆盖多类型 / 多难度） ──
  const INDUSTRY_ROLES: Array<{
    industry: string;
    role: string;
    occupation: string;
    names: string[];
    bgs: string[];
    tagsList: string[][];
    targets: string[];
  }> = [
    // ══ 教育培训机构家长客户 ══
    {
      industry: '教育',
      role: '家长',
      occupation: '培训机构家长',
      names: ['韩文博', '沈丽娟', '高鹏飞', '田雨萌', '朱子轩'],
      bgs: ['小学生家长，35岁，教育焦虑型；对效果数据敏感但反感过度营销，需要看到真实提分案例。', '初中生家长，40岁，升学导向型；关注名师资质与升学率，愿意为结果付费。', '高中生家长，45岁，理性决策型；重视课程体系完整性与性价比，喜欢对比多家机构。', '幼儿家长，30岁，体验驱动型；需要试听课验证教学风格与环境，对师资稳定性敏感。', '研学营家长，38岁，视野开拓型；关注课程体系国际化和安全保障，对价格不太敏感。'],
      tagsList: [['焦虑型', '重效果'], ['升学型', '重师资'], ['理性型', '重体系'], ['体验型', '重感受', '视野型重品质']],
      targets: ['用真实案例缓解教育焦虑', '用师资实力打动升学型家长', '用课程体系说服理性决策型', '用试听体验赢得体验型家长', '用国际化品质吸引视野开拓型'],
    },
  ];

  const VOICE_POOL_M = ['longxiaocheng_v2', 'longtian_v2', 'longhua_v2', 'longjie_v2', 'longshu_v2'];
  const VOICE_POOL_F = ['longxiaoxia_v2', 'longcheng_v2', 'longjing_v2', 'longyue_v2', 'longfei_v2'];

  const generatedPersonas = INDUSTRY_ROLES.flatMap((tmpl, gi) =>
    tmpl.names.map((name, ni) => {
      const idx = gi * 5 + ni;
      const isMale = ni % 2 === 0;
      const difficulty = ni === 0 ? 1 : ni <= 2 ? 2 : 3;
      return {
        id: `persona-gen-${String(idx + 1).padStart(2, '0')}`,
        tenantId: TENANT,
        name,
        background: tmpl.bgs[ni],
        age: 30 + ni * 5 + gi * 2,
        occupation: tmpl.occupation,
        voiceProfile: { voice: isMale ? VOICE_POOL_M[ni % 5] : VOICE_POOL_F[ni % 5] },
        elementIds: [],
        behaviorBands: [
          { minArousal: 0, maxArousal: 0.4, key: 'calm', instruction: '正常沟通，愿意听学员介绍' },
          { minArousal: 0.4, maxArousal: 0.7, key: 'guarded', instruction: '开始质疑，提出反对意见' },
          { minArousal: 0.7, maxArousal: 1.0, key: 'annoyed', instruction: '不耐烦，要求结束对话或直接拒绝' },
        ],
        knowledgeBoundary: {
          mustNotKnow: ['学员所在公司的内部销售政策', '学员的业绩指标与提成'],
          loadedKnowledge: ['同行业竞品的基本信息与价格区间'],
        },
        sourceMeta: {
          archetype: `${tmpl.industry} · ${tmpl.occupation}`,
          recordings: 3 + ni,
          recordingsKind: '模拟构建',
          lastCalibrated: '2026-0' + (1 + (ni % 6)),
          practiceCount: 100 + idx * 15,
          calibrationStatus: idx % 3 === 0 ? '待校准' : '已校准',
        },
        version: 1,
      };
    })
  );

  return {
    organizations: [
      { id: 'org-hd1', tenantId: TENANT, name: '华东一区' },
      { id: 'org-hd2', tenantId: TENANT, name: '华东二区' },
      { id: 'org-hb', tenantId: TENANT, name: '华北大区' },
      { id: 'org-hn', tenantId: TENANT, name: '华南大区' },
      { id: 'org-xb', tenantId: TENANT, name: '西部大区' },
    ],
    teams: [
      { id: 'team-hd1', orgId: 'org-hd1', name: '华东一区·直营一组', supervisorId: 'user-supervisor-1' },
      { id: 'team-hd1-new', orgId: 'org-hd1', name: '华东一区·新人班' },
      { id: 'team-hd1-a', orgId: 'org-hd1', name: '华东一区·直营二组' },
      { id: 'team-hd2-a', orgId: 'org-hd2', name: '华东二区·直营一组' },
      { id: 'team-hd2-b', orgId: 'org-hd2', name: '华东二区·对照组（POC·未参训）' },
      { id: 'team-hb-a', orgId: 'org-hb', name: '华北大区·直营一组' },
      { id: 'team-hn-a', orgId: 'org-hn', name: '华南大区·直营一组' },
      { id: 'team-xb-a', orgId: 'org-xb', name: '西部大区·直营一组' },
    ],
    users: [
      trainee('user-trainee-1', '林小满', 'trainee1', 'org-hd1', 'team-hd1'),
      trainee('user-trainee-2', '赵川', 'trainee2', 'org-hd1', 'team-hd1'),
      trainee('user-trainee-3', '沈亦', 'trainee3', 'org-hd1', 'team-hd1'),
      trainee('user-trainee-4', '何薇', 'trainee4', 'org-hd1', 'team-hd1'),
      trainee('user-trainee-5', '周迪', 'trainee5', 'org-hd1', 'team-hd1'),
      ...NEWBIE_NAMES.map((name, i) =>
        trainee(
          `user-new-${String(i + 1).padStart(2, '0')}`,
          name,
          `trainee${String(i + 6).padStart(2, '0')}`,
          'org-hd1',
          'team-hd1-new'
        )
      ),
      ...bulkUsers,
      ...controlUsers,
      {
        id: 'user-admin-1',
        tenantId: TENANT,
        orgId: 'org-hd1',
        name: '培训管理员',
        role: 'admin',
        username: 'admin1',
        passwordHash,
      },
      {
        id: 'user-supervisor-1',
        tenantId: TENANT,
        orgId: 'org-hd1',
        teamId: 'team-hd1',
        name: '王主管',
        role: 'supervisor',
        username: 'supervisor1',
        passwordHash,
      },
      {
        id: 'user-executive-1',
        tenantId: TENANT,
        orgId: 'org-hd1',
        name: '陈总',
        role: 'executive',
        username: 'executive1',
        passwordHash,
      },
    ],
    methodologyConfigs: [
      {
        id: 'methodology-demo',
        tenantId: TENANT,
        name: '课程顾问销售方法论',
        skillWeights: {
          'sp-icebreak': 1,
          'sp-need': 1,
          'sp-value': 1,
          'sp-objection': 1,
          'sp-compliance': 1,
          'sp-closing': 1,
        },
        redlinePhrases: ['保证提分', '包过', '百分百考上名校', '考不上全额退款', '绝对有效果', '一夜逆袭'],
        fillerWords: ['其实', '那个', '就是说', '然后', '嗯'],
        passScore: 75,
      },
    ],
    elements: [
      {
        id: 'elem-e-academic',
        type: 'E',
        layer: 'tenant',
        tenantId: TENANT,
        name: '营销警觉',
        version: 1,
        content: '对焦虑营销、无案例支撑的提分承诺高度敏感，听到绝对化用词会明显反感并追问真实案例。',
        dynamics: {
          triggers: [
            {
              id: 'trig-absolutize',
              keywords: ['所有孩子', '保证', '包过', '绝对', '一定能'],
              escalation: 0.35,
              description: '绝对化/夸大表述触发强烈反感',
            },
            {
              id: 'trig-data',
              keywords: ['提分', '案例', '升学率', '效果'],
              escalation: 0.1,
              description: '效果类话题触发追问真实案例',
            },
          ],
          decayPerTurn: 0.08,
          baseArousal: 0.35,
        },
      },
      {
        id: 'elem-c-evidence',
        type: 'C',
        layer: 'tenant',
        tenantId: TENANT,
        name: '效果实证信念',
        version: 1,
        content: '只信任真实学员提分案例、试听课体验与家长口碑，对机构自报数据持怀疑态度。',
      },
      {
        id: 'elem-b-busy',
        type: 'B',
        layer: 'tenant',
        tenantId: TENANT,
        name: '接送间隙节奏',
        version: 1,
        content: '接送孩子间隙沟通，时间以分钟计，开场 30 秒无价值信息即结束对话。',
      },
      {
        id: 'elem-e-price',
        type: 'E',
        layer: 'tenant',
        tenantId: TENANT,
        name: '价格戒备',
        version: 1,
        content: '对课时费高度敏感，听到报价先压价，习惯用其他机构低价做对比。',
        dynamics: {
          triggers: [
            {
              id: 'trig-quote',
              keywords: ['价格', '报价', '贵', '预算', '优惠'],
              escalation: 0.25,
              description: '价格类话题触发戒备与压价',
            },
          ],
          decayPerTurn: 0.06,
          baseArousal: 0.4,
        },
      },
      {
        id: 'elem-c-gpo',
        type: 'C',
        layer: 'tenant',
        tenantId: TENANT,
        name: '理性比价导向',
        version: 1,
        content: '报班决策以多家机构对比与真实试听体验为先，过度营销话术会被直接拒绝并质疑动机。',
      },
      {
        id: 'elem-b-profit',
        type: 'B',
        layer: 'tenant',
        tenantId: TENANT,
        name: '犹豫拖延决策',
        version: 1,
        content: '关注课程效果与性价比，决策慢且多变，拿不定主意时用「再和爱人商量一下」拖延。',
      },
    ],
    personaConfigs: [
      {
        id: 'persona-chen',
        tenantId: TENANT,
        name: '孟建国',
        background: '小学生家长，38岁工程师爸爸，教育意识强但预算有限；需要性价比高的课程方案，对课时费与效果承诺极为敏感。',
        age: 38,
        occupation: '培训机构家长',
        voiceProfile: { voice: 'longxiaocheng_v2' },
        elementIds: [],
        behaviorBands: [
          { minArousal: 0, maxArousal: 0.4, key: 'calm', instruction: '愿意了解，主动询问课程内容与课时费' },
          { minArousal: 0.4, maxArousal: 0.7, key: 'guarded', instruction: '开始对比其他机构，提出效果与价格质疑' },
          { minArousal: 0.7, maxArousal: 1.0, key: 'annoyed', instruction: '认为不划算，表示再考虑考虑或直接拒绝' },
        ],
        knowledgeBoundary: {
          mustNotKnow: ['学员所在机构的内部销售政策', '学员的业绩指标与提成'],
          loadedKnowledge: ['本地培训机构的课程价格区间与口碑'],
        },
        sourceMeta: {
          archetype: '教育家长 · 预算谨慎型',
          recordings: 10,
          recordingsKind: '模拟构建',
          lastCalibrated: '2026-08',
          practiceCount: 520,
          calibrationStatus: '已校准',
        },
        version: 1,
      },
      {
        id: 'persona-liu',
        tenantId: TENANT,
        name: '韩文博',
        background: '小学生家长，35岁，教育焦虑型；对培训效果数据敏感但反感过度营销，需要看到真实提分案例才愿付费。',
        age: 35,
        occupation: '培训机构家长',
        voiceProfile: { voice: 'longxiaoxia_v2' },
        elementIds: [],
        behaviorBands: [
          { minArousal: 0, maxArousal: 0.4, key: 'calm', instruction: '愿意试听，关注师资与课程体系' },
          { minArousal: 0.4, maxArousal: 0.7, key: 'guarded', instruction: '开始对比其他机构，质疑效果承诺' },
          { minArousal: 0.7, maxArousal: 1.0, key: 'annoyed', instruction: '认为是在焦虑营销，直接拒绝沟通' },
        ],
        knowledgeBoundary: {
          mustNotKnow: ['学员所在机构的内部运营数据'],
          loadedKnowledge: ['本地培训机构的口碑与价格区间'],
        },
        sourceMeta: {
          archetype: '教育培训家长 · 效果驱动型',
          recordings: 8,
          recordingsKind: '模拟构建',
          lastCalibrated: '2026-07',
          practiceCount: 380,
          calibrationStatus: '已校准',
        },
        version: 1,
      },
      {
        id: 'persona-zhao',
        tenantId: TENANT,
        name: '顾长风',
        background: '初中生家长，40岁，升学导向但迟迟不决策；态度温和，习惯说「再考虑一下」，什么事都要回去和爱人孩子商量。',
        age: 40,
        occupation: '培训机构家长',
        voiceProfile: { voice: 'longtian_v2' },
        elementIds: [],
        behaviorBands: [
          { minArousal: 0, maxArousal: 0.4, key: 'calm', instruction: '礼貌倾听，询问课程体系与师资情况' },
          { minArousal: 0.4, maxArousal: 0.7, key: 'guarded', instruction: '含糊回避承诺，强调要回去商量' },
          { minArousal: 0.7, maxArousal: 1.0, key: 'annoyed', instruction: '感到被逼迫，结束沟通' },
        ],
        knowledgeBoundary: {
          mustNotKnow: ['学员所在机构的内部底价与折扣权限'],
          loadedKnowledge: ['同类培训机构的课程价格区间与班型设置'],
        },
        sourceMeta: {
          archetype: '教育家长 · 犹豫拖延型',
          recordings: 6,
          recordingsKind: '模拟构建',
          lastCalibrated: '2026-06',
          practiceCount: 290,
          calibrationStatus: '已校准',
        },
        version: 1,
      },
      ...generatedPersonas,
    ],
    skillPoints: [
      {
        id: 'sp-icebreak',
        tenantId: TENANT,
        name: '破冰',
        description: '开场 30 秒建立信任并赢得对话时间',
        assetName: '张伟三步破冰法',
        author: '张伟（华东销冠）',
        source: '来自 张伟（华东销冠）',
        practiceCount: 1284,
        achievementRate: 41,
        badge: '已验证',
      },
      {
        id: 'sp-need',
        tenantId: TENANT,
        name: '需求挖掘',
        description: '通过开放式提问识别家长真实报班需求',
        assetName: '需求追问四步曲',
        author: '陈静（华南销冠）',
        source: '来自 陈静（华南销冠）',
        practiceCount: 388,
        achievementRate: 35,
        badge: '已验证',
      },
      {
        id: 'sp-value',
        tenantId: TENANT,
        name: '价值传递',
        description: '用价值重述化解价格异议，不直接让价',
        assetName: '价值重述应对价格异议',
        author: '李蔓（大区亚军）',
        source: '来自 李蔓（大区亚军）',
        practiceCount: 962,
        achievementRate: 33,
        badge: '观察中',
      },
      {
        id: 'sp-objection',
        tenantId: TENANT,
        name: '异议处理',
        description: '共情澄清后回应客户异议，不急于反驳',
        assetName: '异议共情澄清法',
        author: '李蔓（大区亚军）',
        source: '来自 李蔓（大区亚军）',
        practiceCount: 356,
        achievementRate: 26,
        badge: '观察中',
      },
      {
        id: 'sp-compliance',
        tenantId: TENANT,
        name: '合规表达',
        description: '严格按课程实际效果与广告合规口径表述，不承诺提分保过',
        assetName: '效果承诺合规表达',
        author: '教研部',
        source: '来自 教研部话术手册 §3.2',
        practiceCount: 610,
        achievementRate: 29,
        badge: '已验证',
      },
      {
        id: 'sp-closing',
        tenantId: TENANT,
        name: '推进成交',
        description: '识别拖延信号，确认顾虑归属并给出下一步小承诺',
        assetName: '再考虑一下的推进法',
        author: '王岩（KA 总监）',
        source: '来自 王岩（KA 总监）',
        practiceCount: 731,
        achievementRate: 22,
        badge: '待复审',
      },
      {
        id: 'sp-chain',
        tenantId: TENANT,
        name: '多方决策链',
        description: '拆解孩子/父母/祖辈多方决策链并各个击破',
        assetName: '多方决策链拆解',
        author: '周迪',
        source: '来自 待解锁',
        practiceCount: 402,
        badge: '观察中',
        locked: true,
      },
      {
        id: 'sp-empathy',
        tenantId: TENANT,
        name: '倾听共情',
        description: '识别客户情绪并给予共情回应，不急于解决问题',
        assetName: '共情式倾听回应',
        author: '王岩（KA 总监）',
        source: '来自 王岩（KA 总监）',
        practiceCount: 520,
        achievementRate: 31,
        badge: '观察中',
      },
      {
        id: 'sp-clarity',
        tenantId: TENANT,
        name: '表达清晰',
        description: '用简洁结构化语言传递信息，避免冗余词和模糊表达',
        assetName: '简洁结构化表达',
        author: '李蔓（大区亚军）',
        source: '来自 李蔓（大区亚军）',
        practiceCount: 445,
        achievementRate: 28,
        badge: '观察中',
      },
    ],
    scenarios: [
      {
        id: 'scenario-first-visit',
        tenantId: TENANT,
        category: '咨询接待',
        name: '首访破冰·焦虑家长',
        personaConfigId: 'persona-chen',
        skillPointIds: ['sp-icebreak', 'sp-need'],
        successCriteria: { passScore: 75 },
        durationMinutes: 10,
        difficulty: 2,
        coverageTopics: ['开场自我介绍与时间承诺', '真实提分案例引用', '效果承诺合规表述', '异议首反应', '下一步约定'],
        personaTitle: '谨慎型家长，时间只给 8 分钟',
        methodology: '张伟三步破冰法 · L2',
        source: '官方',
        sceneType: 'practical',
        script: {
          executionOrder: '开场破冰 → 需求探询 → 提分案例呈现 → 异议处理 → 约定下一步',
          purpose: '训练首次接待时在有限时间内建立信任并拿到试听课约定',
          topics: ['开场自我介绍与时间承诺', '真实提分案例引用', '效果承诺合规表述', '异议首反应', '下一步约定'],
          customerQuestions: ['你们这个课程和孩子现在上的有什么区别？', '提分案例是真的吗？能看学员数据吗？', '今天我没时间，下次再说吧'],
          assessmentPoints: ['8 分钟内完成开场并说明来意', '至少引用 1 个真实学员案例', '对时间异议给出首反应', '拿到明确的试听课约定'],
        },
        participants: [
          {
            name: '学员（课程顾问）',
            traits: '首次接待该家长，对家长背景了解有限',
            speakingStyle: '专业、简洁、有结构化表达',
            speechScope: '课程介绍、学员案例、试听约定',
            languageRequirements: '开场 30 秒内说明来意并给出时间承诺',
            goal: '在 8 分钟内建立初步信任并约定试听课',
          },
          {
            name: '孟建国（学生家长）',
            traits: '谨慎型家长，时间紧张，对效果承诺敏感',
            speakingStyle: '语速快、打断多、问题直接',
            speechScope: '围绕课程效果与时间成本发问',
            languageRequirements: '不接受夸大承诺，要求真实案例',
            goal: '快速判断这次沟通是否值得继续投入时间',
          },
        ],
        practiceCount: 128,
      },
      {
        id: 'scenario-price-objection',
        tenantId: TENANT,
        category: '现场成交',
        name: '价格异议·比价家长',
        personaConfigId: 'persona-liu',
        skillPointIds: ['sp-value', 'sp-objection'],
        successCriteria: { passScore: 70 },
        durationMinutes: 10,
        difficulty: 2,
        coverageTopics: ['价值重述', '价格异议首反应', '优惠合规边界'],
        personaTitle: '预算收紧，压价强硬',
        methodology: '价值重述应对价格异议 · L1',
        source: '官方',
        sceneType: 'practical',
        script: {
          executionOrder: '倾听异议 → 确认预算背景 → 价值重述 → 合规优惠 → 推进报名',
          purpose: '训练面对强硬压价时守住价值表达并在合规边界内推进报名',
          topics: ['价值重述', '价格异议首反应', '优惠合规边界'],
          customerQuestions: ['你们的课时费比别家高 20%，凭什么？', '预算就这么点，能降就降，不能降算了', '降价之外还能给什么优惠？'],
          assessmentPoints: ['先共情再回应，不直接反驳', '用价值重述替代价格让步', '优惠方案不越合规边界'],
        },
        participants: [
          {
            name: '学员（课程顾问）',
            traits: '已有多轮沟通，本次进入价格谈判阶段',
            speakingStyle: '沉稳、不急于让步',
            speechScope: '课程价值主张、班型方案、合规范围内的优惠条件',
            languageRequirements: '不主动降价，不在合规边界外承诺',
            goal: '守住价格底线的同时推进签约报名',
          },
          {
            name: '韩文博（学生家长）',
            traits: '预算收紧，压价强硬，习惯用其他机构报价施压',
            speakingStyle: '强势、直接、常用最后通牒式表达',
            speechScope: '价格、预算、机构对比、优惠条件',
            languageRequirements: '只谈价格与优惠，不聊课程细节',
            goal: '争取最低课时费与最优优惠',
          },
        ],
        practiceCount: 86,
      },
      {
        id: 'scenario-push-forward',
        tenantId: TENANT,
        category: '现场成交',
        name: '「再考虑一下」推进',
        personaConfigId: 'persona-zhao',
        skillPointIds: ['sp-closing', 'sp-objection'],
        successCriteria: { passScore: 75 },
        durationMinutes: 12,
        difficulty: 3,
        coverageTopics: ['顾虑归属确认', '小承诺推进', '时间节点约定'],
        personaTitle: '态度温和但迟迟不表态',
        methodology: '再考虑一下的推进法 · L2',
        source: '官方',
        sceneType: 'practical',
        script: {
          executionOrder: '识别拖延信号 → 顾虑归属确认 → 小承诺推进 → 约定时间节点',
          purpose: '训练把「再考虑一下」转化为可推进的具体下一步',
          topics: ['顾虑归属确认', '小承诺推进', '时间节点约定'],
          customerQuestions: ['方案不错，我再考虑一下吧', '这事我一个人定不了，得回去商量', '你们先放着，有需要我联系你'],
          assessmentPoints: ['确认顾虑归属（产品/价格/流程/人）', '拿到至少一个小承诺', '约定明确的下次沟通时间节点'],
        },
        participants: [
          {
            name: '学员（课程顾问）',
            traits: '课程方案已介绍完毕，家长未明确拒绝',
            speakingStyle: '温和但目标明确，善于提问',
            speechScope: '顾虑确认、方案补充、试听安排',
            languageRequirements: '不逼迫表态，用提问引导家长说出真实顾虑',
            goal: '把模糊拖延转化为明确的试听时间与小承诺',
          },
          {
            name: '顾长风（学生家长）',
            traits: '态度温和但迟迟不表态，家里决策链复杂',
            speakingStyle: '礼貌、含糊、回避直接承诺',
            speechScope: '孩子兴趣、爱人意见、家庭时间安排',
            languageRequirements: '不当面拒绝，也不轻易给时间表',
            goal: '在不承诺的前提下获取更多信息用于家庭商量',
          },
        ],
        practiceCount: 54,
      },
      {
        id: 'scenario-compliance',
        tenantId: TENANT,
        category: '咨询接待',
        name: '合规效果承诺表达',
        personaConfigId: 'persona-chen',
        skillPointIds: ['sp-compliance'],
        successCriteria: { passScore: 80 },
        durationMinutes: 10,
        difficulty: 3,
        coverageTopics: ['效果承诺边界', '案例引用规范', '退费政策说明'],
        personaTitle: '严谨型家长，追问案例真实性',
        methodology: '效果承诺合规表达 · L3',
        source: '官方',
        sceneType: 'practical',
        script: {
          executionOrder: '效果承诺边界说明 → 真实案例呈现 → 退费政策提示 → 答疑与确认',
          purpose: '训练在广告合规口径下表达课程效果与学员案例',
          topics: ['效果承诺边界', '案例引用规范', '退费政策说明'],
          customerQuestions: ['你们敢保证孩子提分吗？', '这个提分案例的学员基础是怎样的？', '万一没效果，退费怎么算？'],
          assessmentPoints: ['不做保过/保分承诺', '案例引用说明学员基础与周期', '主动说明退费与请假政策'],
        },
        participants: [
          {
            name: '学员（课程顾问）',
            traits: '需向家长做合规的课程效果沟通',
            speakingStyle: '严谨、引用真实案例、避免绝对化表述',
            speechScope: '课程体系、真实学员案例、退费与请假政策',
            languageRequirements: '所有表述须在广告合规口径内，不承诺提分保过',
            goal: '完成一次零违规的效果沟通并获得家长认可',
          },
          {
            name: '孟建国（学生家长）',
            traits: '严谨型家长，重视案例真实性与政策边界',
            speakingStyle: '追问细节、要求实证、不放过模糊表述',
            speechScope: '提分案例、师资资质、退费政策',
            languageRequirements: '只接受有据可查的表述',
            goal: '验证课程效果宣传是否真实可信',
          },
        ],
        practiceCount: 32,
      },
      // ---- 实战训练（无剧本自由对练） ----
      {
        id: 'scenario-drill-ground-push',
        tenantId: TENANT,
        category: '地推',
        name: '实战·地推陌生破冰',
        personaConfigId: 'persona-zhao',
        skillPointIds: ['sp-icebreak'],
        successCriteria: { passScore: 70 },
        durationMinutes: 8,
        difficulty: 2,
        coverageTopics: ['地推开场', '陌生破冰', '驻足引导'],
        personaTitle: '接送孩子路过的家长，脚步匆匆',
        source: '官方',
        sceneType: 'drill',
        practiceCount: 45,
      },
      {
        id: 'scenario-drill-phone-sales',
        tenantId: TENANT,
        category: '电销',
        name: '实战·电话外呼开场',
        personaConfigId: 'persona-liu',
        skillPointIds: ['sp-icebreak', 'sp-need'],
        successCriteria: { passScore: 70 },
        durationMinutes: 8,
        difficulty: 2,
        coverageTopics: ['电话外呼开场', '30 秒价值主张', '前台转接应对'],
        personaTitle: '忙碌的家长，随时可能挂断',
        source: '官方',
        sceneType: 'drill',
        practiceCount: 67,
      },
      {
        id: 'scenario-drill-inquiry',
        tenantId: TENANT,
        category: '咨询接待',
        name: '实战·客户来电咨询',
        personaConfigId: 'persona-chen',
        skillPointIds: ['sp-need', 'sp-value'],
        successCriteria: { passScore: 70 },
        durationMinutes: 10,
        difficulty: 2,
        coverageTopics: ['来电咨询承接', '需求挖掘', '询价比价应对'],
        personaTitle: '主动来电询价，同时在对比别家',
        source: '官方',
        sceneType: 'drill',
        practiceCount: 58,
      },
      {
        id: 'scenario-drill-negotiation',
        tenantId: TENANT,
        category: '现场成交',
        name: '实战·成交价格谈判',
        personaConfigId: 'persona-liu',
        skillPointIds: ['sp-closing', 'sp-objection'],
        successCriteria: { passScore: 75 },
        durationMinutes: 12,
        difficulty: 3,
        coverageTopics: ['价格谈判', '条款协商', '签约推进'],
        personaTitle: '压价强势，谈判经验丰富',
        source: '官方',
        sceneType: 'drill',
        practiceCount: 39,
      },
    ],
    learningPaths: [
      {
        id: 'path-newbie',
        tenantId: TENANT,
        name: '新人首月认证包',
        items: [
          { scenarioId: 'scenario-first-visit', passScore: 75, order: 1 },
          { scenarioId: 'scenario-price-objection', passScore: 70, order: 2 },
          { scenarioId: 'scenario-push-forward', passScore: 75, order: 3 },
          { scenarioId: 'scenario-compliance', passScore: 80, order: 4 },
        ],
        assignedTeamIds: ['team-hd1-new'],
      },
    ],
    scoreItemDefs: withScoreItemCategories([
      {
        id: 'item-icebreak-1',
        tenantId: TENANT,
        skillPointId: 'sp-icebreak',
        name: '开场与时间承诺',
        behaviorAnchor: '开场 30 秒内完成自我介绍并给出明确时间承诺',
        judgePrompt:
          '请判定学员的开场破冰质量（自我介绍、时间承诺、引发兴趣）。根据对话记录选择最匹配的档位，按 JSON 输出 levelKey、quote、quoteTurnSeq、rationale。',
        weight: 1,
        levels: [
          { key: 'poor', label: '差', score: 30, description: '无自我介绍或冗长无重点' },
          { key: 'ok', label: '中', score: 60, description: '有介绍但无时间承诺或吸引力不足' },
          { key: 'good', label: '好', score: 90, description: '简洁介绍 + 时间承诺 + 悬念式开场' },
        ],
        layer: 'company',
        isObservation: false,
      },
      {
        id: 'item-need-1',
        tenantId: TENANT,
        skillPointId: 'sp-need',
        name: '开放式提问',
        behaviorAnchor: '用开放式问题引导家长表达真实报班需求',
        judgePrompt:
          '请判定学员的提问质量。根据对话记录选择最匹配的档位，按 JSON 输出 levelKey、quote、quoteTurnSeq、rationale。',
        weight: 1,
        levels: [
          { key: 'poor', label: '差', score: 30, description: '只顾介绍产品，基本不提问' },
          { key: 'ok', label: '中', score: 60, description: '有提问但多为封闭式' },
          { key: 'good', label: '好', score: 90, description: '开放式提问并追问细节' },
        ],
        layer: 'company',
        isObservation: false,
      },
      {
        id: 'item-value-1',
        tenantId: TENANT,
        skillPointId: 'sp-value',
        name: '价值重述',
        behaviorAnchor: '面对价格异议先重述价值，不直接让价',
        judgePrompt:
          '请判定学员面对价格异议时的价值重述质量。根据对话记录选择最匹配的档位，按 JSON 输出 levelKey、quote、quoteTurnSeq、rationale。',
        weight: 1,
        levels: [
          { key: 'poor', label: '差', score: 30, description: '直接让价或与竞品拼价格' },
          { key: 'ok', label: '中', score: 60, description: '有价值表述但空泛' },
          { key: 'good', label: '好', score: 90, description: '价值重述具体、有数据支撑，稳住价格体系' },
        ],
        layer: 'company',
        isObservation: false,
      },
      {
        id: 'item-obj-1',
        tenantId: TENANT,
        skillPointId: 'sp-objection',
        name: '异议首反应',
        behaviorAnchor: '面对异议先共情澄清，不急于反驳或承诺',
        judgePrompt:
          '请判定学员面对客户异议时的首反应质量。根据对话记录选择最匹配的档位，按 JSON 输出 levelKey、quote、quoteTurnSeq、rationale。',
        weight: 1,
        levels: [
          { key: 'poor', label: '差', score: 30, description: '直接反驳客户或做出违规承诺' },
          { key: 'ok', label: '中', score: 60, description: '有回应但缺乏共情与澄清' },
          { key: 'good', label: '好', score: 90, description: '先共情澄清再有针对性地回应' },
        ],
        layer: 'company',
        isObservation: false,
      },
      {
        id: 'item-obj-2',
        tenantId: TENANT,
        skillPointId: 'sp-objection',
        name: '案例引用规范',
        behaviorAnchor: '引用提分案例时说明学员基础、学习周期与数据出处',
        judgePrompt:
          '请判定学员引用效果案例的规范性。根据对话记录选择最匹配的档位，按 JSON 输出 levelKey、quote、quoteTurnSeq、rationale。',
        weight: 1,
        levels: [
          { key: 'poor', label: '差', score: 30, description: '无案例或编造案例' },
          { key: 'ok', label: '中', score: 60, description: '有案例但未说明学员基础与周期' },
          { key: 'good', label: '好', score: 90, description: '学员基础、学习周期、数据出处齐全' },
        ],
        layer: 'company',
        isObservation: false,
      },
      {
        id: 'item-comp-1',
        tenantId: TENANT,
        skillPointId: 'sp-compliance',
        name: '效果承诺合规表述',
        behaviorAnchor: '严格按课程实际效果表述，不承诺提分保过',
        judgePrompt:
          '请判定学员的效果表述合规性。根据对话记录选择最匹配的档位，按 JSON 输出 levelKey、quote、quoteTurnSeq、rationale。',
        weight: 1,
        levels: [
          { key: 'poor', label: '差', score: 30, description: '承诺提分保过或夸大效果' },
          { key: 'ok', label: '中', score: 60, description: '表述基本合规但边界含糊' },
          { key: 'good', label: '好', score: 90, description: '严格限定效果表述并主动说明退费政策' },
        ],
        layer: 'company',
        isObservation: false,
      },
      {
        id: 'item-closing-1',
        tenantId: TENANT,
        skillPointId: 'sp-closing',
        name: '小承诺推进',
        behaviorAnchor: '面对拖延先确认顾虑归属，再给出下一步小承诺',
        judgePrompt:
          '请判定学员的推进表现。根据对话记录选择最匹配的档位，按 JSON 输出 levelKey、quote、quoteTurnSeq、rationale。',
        weight: 1,
        levels: [
          { key: 'poor', label: '差', score: 30, description: '放任客户拖延或强行逼单' },
          { key: 'ok', label: '中', score: 60, description: '有推进但未确认顾虑归属' },
          { key: 'good', label: '好', score: 90, description: '确认顾虑归属并约定具体下一步与时间' },
        ],
        layer: 'company',
        isObservation: false,
      },
    ]),
    goldenCases: [
      {
        id: 'golden-case-1',
        name: '首访破冰标准示范（张伟）',
        transcript: [
          { seq: 1, speaker: 'persona', text: '你有什么事快说，我一会儿还要去接送孩子。' },
          { seq: 2, speaker: 'trainee', text: '家长您好，我是××的小林，今天只用三分钟，跟您介绍一个适合您孩子的数学思维课程。' },
          { seq: 3, speaker: 'persona', text: '又是推销课程？你们这类机构我看过太多了，提分案例都是自己编的吧。' },
          { seq: 4, speaker: 'trainee', text: '家长，我不谈所有孩子。上学期同基础学员平均提分 15 分，这是脱敏的学员档案，您先看案例再判断。' },
          { seq: 5, speaker: 'persona', text: '行，资料放这儿吧。下次带上你们的任课老师。' },
          { seq: 6, speaker: 'trainee', text: '好的，我周四下午带孩子来上试听课，任课老师当面跟您聊，半小时就够，您看方便吗？' },
        ],
        expected: [
          { itemId: 'item-icebreak-1', levelKey: 'good' },
          { itemId: 'item-obj-1', levelKey: 'good' },
          { itemId: 'item-obj-2', levelKey: 'good' },
        ],
      },
    ],
    productKBs: [
      {
        id: 'kb-course',
        tenantId: TENANT,
        name: '数学思维课程话术手册',
        version: 4,
        effectiveAt: '2026-05-01T00:00:00.000Z',
        entries: [
          {
            id: 'kb-faq-data',
            kind: 'faq',
            title: '「提分案例是真的吗」',
            content: '最优应对：出示脱敏学员档案 + 邀任课老师面谈',
            frequency: 38,
          },
          {
            id: 'kb-faq-later',
            kind: 'faq',
            title: '「再考虑一下」',
            content: '最优应对：推进法：确认顾虑归属 + 给下一步小承诺',
            frequency: 31,
          },
          {
            id: 'kb-faq-expensive',
            kind: 'faq',
            title: '「太贵了」',
            content: '最优应对：价值重述四句式',
            frequency: 27,
          },
          {
            id: 'kb-kp-1',
            kind: 'keypoint',
            title: '核心卖点：同基础学员平均提分',
            content: '上学期同基础学员平均提分 15 分，引用时必须说明学员基础与学习周期。',
          },
          {
            id: 'kb-red-1',
            kind: 'redline',
            title: '禁止绝对化效果承诺',
            content: '禁止使用「保证提分」「包过」「百分百考上名校」等绝对化表述。',
          },
          {
            id: 'kb-red-2',
            kind: 'redline',
            title: '禁止虚假案例宣传',
            content: '仅可引用脱敏后的真实学员案例，虚构案例与升学率一律不得提及。',
          },
          {
            id: 'kb-comp-1',
            kind: 'competitor',
            title: '竞品机构 A 价格对比',
            content: '竞品机构 A 课时费低约 15%，但师资流动性大，应对以价值重述为主。',
          },
        ],
      },
    ],
    examWindows: [
      {
        id: 'exam-window-l1',
        tenantId: TENANT,
        name: 'L1 认证考核',
        startsAt: '2026-05-10T09:00:00+08:00',
        endsAt: '2026-06-10T18:00:00+08:00',
        scenarioIds: ['scenario-first-visit'],
        userIds: ['user-trainee-1', 'user-trainee-2', 'user-trainee-4', 'user-trainee-5'],
        status: 'closed',
        retakeCooldownDays: 7,
      },
      {
        id: 'exam-window-comp-l3',
        tenantId: TENANT,
        name: '合规表达认证 L3',
        startsAt: '2026-06-15T09:00:00+08:00',
        endsAt: '2026-06-20T18:00:00+08:00',
        scenarioIds: ['scenario-compliance'],
        userIds: ['user-trainee-1'],
        status: 'closed',
        retakeCooldownDays: 7,
      },
      {
        id: 'exam-window-l2-jul',
        tenantId: TENANT,
        name: 'L2 认证考核（7 月）',
        startsAt: '2026-07-10T09:00:00+08:00',
        endsAt: '2026-07-20T18:00:00+08:00',
        scenarioIds: ['scenario-price-objection', 'scenario-push-forward'],
        userIds: ['user-trainee-1', 'user-trainee-2', 'user-trainee-5'],
        status: 'closed',
        retakeCooldownDays: 7,
      },
      {
        id: 'exam-window-q3',
        tenantId: TENANT,
        name: '2026 Q3 L2 认证',
        startsAt: '2026-08-14T09:00:00+08:00',
        endsAt: '2026-08-19T18:00:00+08:00',
        scenarioIds: ['scenario-first-visit', 'scenario-price-objection', 'scenario-push-forward'],
        userIds: Q3_ROSTER_USER_IDS,
        status: 'open',
        retakeCooldownDays: 7,
        proctoring: {
          disableHints: true,
          maxAttemptsPerScenario: 1,
        },
      },
    ],
    extractionProjects: [
      {
        id: 'ext-project-1',
        tenantId: TENANT,
        name: '张伟（华东销冠）录音萃取',
        recordingRefs: ['rec-zhangwei-001.mp3', 'rec-zhangwei-002.mp3', 'rec-zhangwei-003.mp3'],
        diffFindings: [
          {
            topic: '开场破冰',
            championDid: '30 秒内自我介绍 + 时间承诺 + 悬念式开场',
            averageDid: '冗长公司介绍，无时间承诺',
          },
        ],
        interviewNotes: ['张伟：先给家长一个「只听三分钟」的理由，再谈课程。'],
        trialValidation: { passed: true, note: '试打 3 场均达标', at: '2026-05-20T10:00:00.000Z' },
        status: 'done',
        createdAt: '2026-04-15T09:00:00.000Z',
      },
      {
        id: 'ext-project-2',
        tenantId: TENANT,
        name: '老学员家长访谈萃取（王妈妈）',
        recordingRefs: ['int-wang-001.mp3'],
        diffFindings: [],
        interviewNotes: ['王妈妈：「再考虑一下」多半是要回去和爱人商量课时费。'],
        status: 'collecting',
        createdAt: '2026-07-02T09:00:00.000Z',
      },
    ],
  };
}
