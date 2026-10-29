import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchScenarios, fetchMySessions, fetchExamWindows, fetchPreferences, createSession, apiError, getStoredUser } from '../api';
import type { MySessionRecord } from '../api';
import type { ExamWindow, Scenario } from '../types';
import { CATEGORY_RULES, categoryOf, matchCategory } from '../lib/categories';

/** 实战训练模块卡片配置（后续增删卡片改这里即可） */
/* 辅助色统一：图标背景用 slate-100 slate-500 色系，保持商务克制感 */
const TRAINING_MODULES = [
  {
    key: 'ground-push',
    label: '地推引流课',
    icon: '👋',
    color: '#64748B',
    image: '/field-promotion.png',
    desc: '陌生拜访与破冰开场，练在街头商场快速建立对话',
    entry: 'practice',
    categoryLabel: '地推引流课',
  },
  {
    key: 'phone',
    label: '电话销售',
    icon: '📞',
    color: '#64748B',
    image: '/telephone-sale.png',
    desc: '外呼开场与异议应对，练在 30 秒内抓住客户注意力',
    entry: 'call',
    categoryLabel: '电话销售',
  },
  {
    key: 'inquiry',
    label: '咨询接待',
    icon: '💬',
    color: '#64748B',
    image: '/client-reception.png',
    desc: '承接主动咨询与询价比价，练需求挖掘与专业解答',
    entry: 'practice',
    categoryLabel: '咨询接待',
  },
  {
    key: 'deal',
    label: '现场成交',
    icon: '🤝',
    color: '#64748B',
    image: '/negotiation.png',
    desc: '价格谈判与签约推进，练临门一脚的成交能力',
    entry: 'practice',
    categoryLabel: '现场成交',
  },
] as const;

type TrainingModule = (typeof TRAINING_MODULES)[number];

const CATEGORIES = [
  { label: '全部', value: '', color: '' },
  ...CATEGORY_RULES.map((r) => ({ label: r.label, value: r.label, color: r.color })),
];

function difficultyLabel(d: number): string {
  if (d <= 2) return '初级';
  if (d === 3) return '进阶';
  return '挑战';
}

/** 该场景是否有可参加的考核窗口（与后端 sessions.ts 的校验口径对齐） */
function examWindowFor(windows: ExamWindow[], scenarioId: string): ExamWindow | null {
  const userId = getStoredUser()?.id;
  const nowMs = Date.now();
  return (
    windows.find(
      (w) =>
        w.status === 'open' &&
        w.scenarioIds.includes(scenarioId) &&
        (!userId || w.userIds.includes(userId)) &&
        nowMs >= new Date(w.startsAt).getTime() &&
        nowMs <= new Date(w.endsAt).getTime() &&
        w.myStatus !== 'passed' &&
        w.myStatus !== 'cooldown'
    ) ?? null
  );
}

export default function Home() {
  const navigate = useNavigate();
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [records, setRecords] = useState<MySessionRecord[]>([]);
  const [examWindows, setExamWindows] = useState<ExamWindow[]>([]);
  /** 设置页的「默认模式」偏好（voice-call=实时通话 / voice=轮次语音 / text=文字），拉取失败回退轮次语音 */
  const [defaultMode, setDefaultMode] = useState<'voice-call' | 'voice' | 'text'>('voice');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeCategory, setActiveCategory] = useState('');
  const [practicedOnly, setPracticedOnly] = useState(false);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [startError, setStartError] = useState('');

  /** 实战训练卡片：从场景类型为「实战训练」的场景中匹配（优先按卡片类别，回退到该类型第一个） */
  const drillScenarios = useMemo(() => scenarios.filter((s) => s.sceneType === 'drill'), [scenarios]);

  const drillFor = (mod: TrainingModule): Scenario | null =>
    drillScenarios.find((s) => matchCategory(s, mod.categoryLabel)) ?? drillScenarios[0] ?? null;

  const startTraining = async (mod: TrainingModule) => {
    if (startingId) return;
    const hit = drillFor(mod);
    if (!hit) return;
    setStartingId(mod.key);
    setStartError('');
    try {
      const data = await createSession(hit.id, 'practice');
      if (mod.entry === 'call') {
        navigate(`/call?sessionId=${data.session.id}`);
      } else {
        navigate(`/practice/${data.session.id}?mode=voice&script=none`);
      }
    } catch (err) {
      setStartError(apiError(err, '创建会话失败，请稍后重试'));
      setStartingId(null);
    }
  };

  /** 实用场景 - 练习（按场景类别跳转：电话销售类进实时通话页，其余按「设置 → 默认模式」偏好进练习页） */
  const startPractice = async (scene: Scenario) => {
    if (startingId) return;
    setStartingId(scene.id);
    setStartError('');
    try {
      const data = await createSession(scene.id, 'practice');
      if (categoryOf(scene)?.label === '电话销售') {
        navigate(`/call?sessionId=${data.session.id}`);
      } else {
        navigate(`/practice/${data.session.id}?mode=${defaultMode === 'text' ? 'text' : 'voice'}`);
      }
    } catch (err) {
      setStartError(apiError(err, '创建会话失败，请稍后重试'));
      setStartingId(null);
    }
  };

  /** 实用场景 - 考核（需存在覆盖该场景的开放考核窗口） */
  const startExam = async (scene: Scenario) => {
    if (startingId) return;
    const window = examWindowFor(examWindows, scene.id);
    if (!window) return;
    setStartingId(scene.id);
    setStartError('');
    try {
      const data = await createSession(scene.id, 'exam', window.id);
      if (defaultMode === 'voice-call') {
        navigate(`/call?sessionId=${data.session.id}`);
      } else {
        navigate(`/practice/${data.session.id}?mode=${defaultMode}`);
      }
    } catch (err) {
      setStartError(apiError(err, '创建考核会话失败，请稍后重试'));
      setStartingId(null);
    }
  };

  const load = () => {
    setLoading(true);
    setError('');
    Promise.all([
      fetchScenarios(),
      fetchMySessions().catch(() => ({ records: [] as MySessionRecord[] })),
      fetchExamWindows().catch(() => ({ windows: [] as ExamWindow[] })),
      fetchPreferences().catch(() => ({ preferences: {} })),
    ])
      .then(([s, r, w, p]) => {
        setScenarios(s.scenarios);
        setRecords(r.records);
        setExamWindows(w.windows);
        const mode = (p.preferences as { defaultMode?: string }).defaultMode;
        if (mode === 'voice-call' || mode === 'voice' || mode === 'text') setDefaultMode(mode);
      })
      .catch((err) => setError(apiError(err, '场景加载失败，请稍后重试')))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  /** 每个场景的历史最高分 */
  const bestScores = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of records) {
      if (r.totalScore == null) continue;
      const cur = map.get(r.scenarioId);
      if (cur == null || r.totalScore > cur) map.set(r.scenarioId, r.totalScore);
    }
    return map;
  }, [records]);

  const filteredScenes = scenarios.filter((s) => {
    // 实用场景模块只列「实用场景」类型（缺省按 practical 兼容存量数据）
    if ((s.sceneType ?? 'practical') === 'drill') return false;
    if (!matchCategory(s, activeCategory)) return false;
    if (practicedOnly && !bestScores.has(s.id)) return false;
    return true;
  });

  return (
    <div>
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 border-3 border-coral/30 border-t-coral rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center h-64 gap-3">
          <p className="text-sm text-text-secondary">{error}</p>
          <button className="btn-ghost btn btn-sm" onClick={load}>重试</button>
        </div>
      ) : (
        <>
          {/* 实战训练 */}
          <div className="sec-head">
            <h2 className="bar-title">实战训练</h2>
          </div>
          {startError && (
            <p className="text-xs text-coral" style={{ marginBottom: 8 }}>{startError}</p>
          )}
          <div className="train-grid" style={{ marginBottom: 28 }}>
            {TRAINING_MODULES.map((mod) => {
              const available = drillFor(mod) !== null;
              const starting = startingId === mod.key;
              return (
                <div
                  key={mod.key}
                  className={`card train-card${available && !startingId ? '' : ' disabled'}`}
                  onClick={() => startTraining(mod)}
                >
                  <div className="train-left">
                    <div className="train-icon">
                      {mod.icon}
                    </div>
                    <h3>{mod.label}</h3>
                    <p className="desc">{available ? mod.desc : '该类别暂无可用场景'}</p>
                    <div className="train-meta">
                      <span className="train-go">
                        {starting ? '创建会话中…' : mod.entry === 'call' ? '发起通话 →' : '开始练习 →'}
                      </span>
                    </div>
                  </div>
                  <div className="train-visual">
                    <img className="train-illus" src={mod.image} alt={mod.label} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* 实用场景 */}
          <div className="sec-head">
            <h2 className="bar-title">实用场景</h2>
            <span className="more">从场景库选择 · 有剧本对练</span>
          </div>

          {/* 类别筛选 */}
          <div className="cats">
            {CATEGORIES.map((cat) => (
              <span
                key={cat.value}
                onClick={() => setActiveCategory(cat.value)}
                className={`chip ${activeCategory === cat.value ? 'active' : 'chip-gray'}`}
              >
                {cat.color && <i className="cdot" style={{ background: cat.color }} />}
                {cat.label}
              </span>
            ))}
            <span
              onClick={() => setPracticedOnly((v) => !v)}
              className={`chip ${practicedOnly ? 'active' : 'chip-gray'}`}
            >
              仅看已练习
            </span>
          </div>

          {filteredScenes.length === 0 ? (
            <div className="flex items-center justify-center h-40">
              <p className="text-sm text-text-tertiary">暂无符合条件的场景</p>
            </div>
          ) : (
            <div className="scene-grid">
              {filteredScenes.map((scene) => {
                const cat = categoryOf(scene);
                const score = bestScores.get(scene.id);
                const examWindow = examWindowFor(examWindows, scene.id);
                const tags = [...new Set([...(scene.skillPointNames ?? []), ...(scene.coverageTopics ?? [])])].slice(0, 4);
                const busy = startingId === scene.id;
                return (
                  <div
                    key={scene.id}
                    className="card scene-card"
                    style={busy ? { opacity: 0.6, pointerEvents: 'none' } : undefined}
                  >
                    {/* 封面 */}
                    <div className="cover">
                      <span className="scene-dot" />
                      <span className="chip cat">
                        <i className="cdot" style={{ background: cat?.color ?? '#8A8F98' }} />
                        {cat?.label ?? '综合场景'}
                      </span>
                      {(scene.sceneType ?? 'practical') !== 'drill' && <span className="scripted">有剧本</span>}
                      <span className="diff">{difficultyLabel(scene.difficulty)} · 约 {scene.durationMinutes} 分钟</span>
                      {score != null && <span className="practiced">已练习 · {score} 分</span>}
                    </div>

                    {/* 文字区 */}
                    <div className="sbody">
                      <h3>{scene.name}</h3>
                      {(scene.personaName || scene.personaTitle) && (
                        <div className="who">
                          <div
                            className="avatar"
                            style={{ width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11 }}
                          >
                            {(scene.personaName ?? '客')[0]}
                          </div>
                          {scene.personaName ?? 'AI 客户'}{scene.personaTitle ? ` · ${scene.personaTitle}` : ''}
                        </div>
                      )}
                      {tags.length > 0 && (
                        <div className="tags">
                          {tags.map((tag) => (
                            <span key={tag}>{tag}</span>
                          ))}
                        </div>
                      )}
                      <div className="scene-actions">
                        <button
                          className="btn btn-soft btn-sm"
                          disabled={startingId !== null}
                          onClick={() => startPractice(scene)}
                        >
                          {busy ? '创建会话中…' : '练习'}
                        </button>
                        {examWindow && (
                          <button
                            className="btn btn-ghost btn-sm"
                            disabled={startingId !== null}
                            onClick={() => startExam(scene)}
                            title={`考核窗口：${examWindow.name}`}
                          >
                            考核
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
