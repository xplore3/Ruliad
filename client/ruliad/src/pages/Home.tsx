import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchScenarios, fetchMySessions, fetchGrowth, createSession, apiError } from '../api';
import type { MySessionRecord } from '../api';
import type { GrowthData, Scenario } from '../types';

/** 分类关键词匹配：按场景名称与 coverageTopics 归类 */
const CATEGORY_RULES = [
  { label: '电话销售', color: '#FF6B5B', keywords: ['电话', '外呼', '电销', '前台'] },
  { label: '客户主动咨询', color: '#4B7BEC', keywords: ['咨询', '来电', '上门', '询价', '比价'] },
  { label: '成交谈判', color: '#F5A623', keywords: ['谈判', '成交', '续约', '涨价', '条款', '价格', '签约'] },
  { label: '地推破冰', color: '#2FAE7B', keywords: ['地推', '破冰', '陌生', '展会', '商场', '摊位', '驻足'] },
] as const;

const CATEGORIES = [
  { label: '全部', value: '', color: '' },
  ...CATEGORY_RULES.map((r) => ({ label: r.label, value: r.label, color: r.color })),
];

/** 封面预设：按场景 id hash 选取渐变与 emoji */
const COVERS = [
  { g: 'linear-gradient(135deg, #FF6B5B 0%, #F5A623 100%)', em: '📞' },
  { g: 'linear-gradient(135deg, #4B7BEC 0%, #7B61FF 100%)', em: '💬' },
  { g: 'linear-gradient(135deg, #F5A623 0%, #E85C62 100%)', em: '🤝' },
  { g: 'linear-gradient(135deg, #2FAE7B 0%, #4B7BEC 100%)', em: '👋' },
  { g: 'linear-gradient(135deg, #7B61FF 0%, #E85C62 100%)', em: '🎯' },
  { g: 'linear-gradient(135deg, #2FAE7B 0%, #F5A623 100%)', em: '🚀' },
];

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}

function scenarioText(s: Scenario): string {
  return [s.name, s.personaName ?? '', ...(s.coverageTopics ?? [])].join(' ');
}

function categoryOf(s: Scenario) {
  const text = scenarioText(s);
  return CATEGORY_RULES.find((r) => r.keywords.some((k) => text.includes(k))) ?? null;
}

function matchCategory(s: Scenario, value: string): boolean {
  if (!value) return true;
  const rule = CATEGORY_RULES.find((r) => r.label === value);
  if (!rule) return true;
  const text = scenarioText(s);
  return rule.keywords.some((k) => text.includes(k));
}

function difficultyLabel(d: number): string {
  if (d <= 2) return '初级';
  if (d === 3) return '进阶';
  return '挑战';
}

export default function Home() {
  const navigate = useNavigate();
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [records, setRecords] = useState<MySessionRecord[]>([]);
  const [growth, setGrowth] = useState<GrowthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeCategory, setActiveCategory] = useState('');
  const [practicedOnly, setPracticedOnly] = useState(false);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [startError, setStartError] = useState('');

  /** 点击场景：直接创建会话并进入练习页（轮次语音模式） */
  const startPractice = async (scenarioId: string) => {
    if (startingId) return;
    setStartingId(scenarioId);
    setStartError('');
    try {
      const data = await createSession(scenarioId, 'practice');
      navigate(`/practice/${data.session.id}?mode=voice`);
    } catch (err) {
      setStartError(apiError(err, '创建会话失败，请稍后重试'));
      setStartingId(null);
    }
  };

  const load = () => {
    setLoading(true);
    setError('');
    Promise.all([
      fetchScenarios(),
      fetchMySessions().catch(() => ({ records: [] as MySessionRecord[] })),
      fetchGrowth().catch(() => null),
    ])
      .then(([s, r, g]) => {
        setScenarios(s.scenarios);
        setRecords(r.records);
        setGrowth(g);
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

  /** 为你推荐：取 currentLevel 最低的技能，匹配 skillPointNames 含该技能的第一个场景 */
  const hero = useMemo(() => {
    if (scenarios.length === 0) return null;
    const weakest = growth?.skills?.length
      ? [...growth.skills].sort((a, b) => a.currentLevel - b.currentLevel)[0]
      : null;
    if (weakest) {
      const hit = scenarios.find((s) => s.skillPointNames?.includes(weakest.name));
      if (hit) return { scenario: hit, skillName: weakest.name };
    }
    return { scenario: scenarios[0], skillName: null as string | null };
  }, [scenarios, growth]);

  const filteredScenes = scenarios.filter((s) => {
    if (!matchCategory(s, activeCategory)) return false;
    if (practicedOnly && !bestScores.has(s.id)) return false;
    return true;
  });

  return (
    <div>
      {/* 类别胶囊条 - matches prototype .cats */}
      <div className="cats">
        {CATEGORIES.map((cat) => (
          <span
            key={cat.value}
            onClick={() => setActiveCategory(cat.value)}
            className={`chip ${activeCategory === cat.value ? 'all' : 'gray'}`}
          >
            {cat.color && <i className="cdot" style={{ background: cat.color }} />}
            {cat.label}
          </span>
        ))}
        <span
          onClick={() => setPracticedOnly((v) => !v)}
          className={`chip ${practicedOnly ? 'all' : 'gray'}`}
        >
          仅看已练习
        </span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 border-3 border-coral/30 border-t-coral rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center h-64 gap-3">
          <p className="text-sm text-text-secondary">{error}</p>
          <button className="btn ghost sm" onClick={load}>重试</button>
        </div>
      ) : (
        <>
          {/* 为你推荐 Hero - matches prototype .hero */}
          {hero && (
            <section className="card hero">
              <div className="avatar">
                <span style={{ fontSize: 28, lineHeight: 1 }}>{COVERS[hashId(hero.scenario.id) % COVERS.length].em}</span>
              </div>
              <div>
                <span className="chip coral" style={{ marginBottom: 6 }}>
                  {hero.skillName ? `为你推荐 · 针对弱项「${hero.skillName}」` : '为你推荐'}
                </span>
                <h2>{hero.scenario.name}</h2>
                <p>
                  {hero.scenario.methodology ??
                    `对手：${hero.scenario.personaName ?? 'AI 客户'}${hero.scenario.personaTitle ? ` · ${hero.scenario.personaTitle}` : ''}，时长约 ${hero.scenario.durationMinutes} 分钟。`}
                </p>
              </div>
              <div className="cta">
                <button className="btn primary" disabled={startingId !== null} onClick={() => startPractice(hero.scenario.id)}>
                  {startingId === hero.scenario.id ? '创建会话中…' : '立即开练'}
                </button>
              </div>
            </section>
          )}

          {/* 热门场景 - matches prototype .sec-head */}
          <div className="sec-head">
            <h2 className="bar">热门场景</h2>
            <span className="more">按你的行业智能排序</span>
          </div>

          {startError && (
            <p className="text-xs text-coral" style={{ marginBottom: 8 }}>{startError}</p>
          )}

          {/* 瀑布流卡片 - matches prototype .masonry */}
          {filteredScenes.length === 0 ? (
            <div className="flex items-center justify-center h-40">
              <p className="text-sm text-text-tertiary">暂无符合条件的场景</p>
            </div>
          ) : (
            <div className="masonry">
              {filteredScenes.map((scene) => {
                const h = hashId(scene.id);
                const cover = COVERS[h % COVERS.length];
                const tier = (h % 4) + 1;
                const cat = categoryOf(scene);
                const score = bestScores.get(scene.id);
                const practiced = score != null || records.some((r) => r.scenarioId === scene.id);
                const tags = [...new Set([...(scene.skillPointNames ?? []), ...(scene.coverageTopics ?? [])])].slice(0, 4);
                return (
                  <div
                    key={scene.id}
                    onClick={() => startPractice(scene.id)}
                    className="card scene-card"
                    style={startingId === scene.id ? { opacity: 0.6, pointerEvents: 'none' } : undefined}
                  >
                    {/* 封面 */}
                    <div
                      className={`cover t${tier}`}
                      style={{ background: cover.g, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                      <span style={{ fontSize: 44, lineHeight: 1 }}>{cover.em}</span>
                      <span className="chip cat">
                        <i className="cdot" style={{ background: cat?.color ?? '#8A8F98' }} />
                        {cat?.label ?? '综合场景'}
                      </span>
                      <span className="diff">{difficultyLabel(scene.difficulty)} · 约 {scene.durationMinutes} 分钟</span>
                      {practiced && score != null && (
                        <span className="practiced">已练习 · {score} 分</span>
                      )}
                    </div>

                    {/* 文字区 - matches prototype .sbody */}
                    <div className="sbody">
                      <h3>{scene.name}</h3>
                      {scene.methodology && <p className="desc">{scene.methodology}</p>}
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
                      {practiced && (
                        <button
                          className="again"
                          onClick={(e) => {
                            e.stopPropagation();
                            startPractice(scene.id);
                          }}
                        >
                          再练一次 →
                        </button>
                      )}
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
