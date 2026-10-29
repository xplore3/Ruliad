import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { fetchScenarios, createSession, listScoreItems, apiError } from '../api';
import type { Scenario } from '../types';
import { categoryOf } from '../lib/categories';

function categoryLabelOf(s: Scenario): string | null {
  return categoryOf(s)?.label ?? null;
}

type StartTarget = 'call' | 'voice' | 'text';

export default function ScenarioDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [starting, setStarting] = useState<StartTarget | null>(null);
  const [startError, setStartError] = useState('');
  /** 各评估维度的真实权重百分比（与 skills 同序）；null = 无评分标准数据，不展示权重 */
  const [skillWeights, setSkillWeights] = useState<number[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!id) {
      setLoading(false);
      return;
    }
    fetchScenarios()
      .then((data) => {
        if (cancelled) return;
        setScenario(data.scenarios.find((s) => s.id === id) ?? null);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(apiError(err, '场景加载失败，请稍后重试'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  // 按技能点取评分标准定义，汇总各维度权重并归一化为百分比（评分引擎按 weight 加权平均）
  useEffect(() => {
    if (!scenario) return;
    const ids = scenario.skillPointIds ?? [];
    const names = scenario.skillPointNames ?? [];
    if (ids.length === 0 || names.length === 0) {
      setSkillWeights(null);
      return;
    }
    let cancelled = false;
    Promise.all(ids.map((spId) => listScoreItems(spId).catch(() => ({ items: [] }))))
      .then((results) => {
        if (cancelled) return;
        const sums = results.map((r) => r.items.reduce((s, it) => s + (it.weight || 0), 0));
        const total = sums.reduce((a, b) => a + b, 0);
        if (total <= 0) {
          setSkillWeights(null);
          return;
        }
        const percents = names.map((_, i) => ((sums[i] ?? 0) / total) * 100);
        const rounded = percents.slice(0, -1).map((v) => Math.round(v));
        // 末位吃舍入误差，凑满 100
        rounded.push(Math.max(0, 100 - rounded.reduce((a, b) => a + b, 0)));
        setSkillWeights(rounded);
      })
      .catch(() => {
        if (!cancelled) setSkillWeights(null);
      });
    return () => {
      cancelled = true;
    };
  }, [scenario]);

  const startSession = async (target: StartTarget) => {
    if (!id || starting) return;
    setStarting(target);
    setStartError('');
    try {
      const data = await createSession(id, 'practice');
      const sessionId = data.session.id;
      if (target === 'call') {
        navigate(`/call?sessionId=${sessionId}`);
      } else {
        navigate(`/practice/${sessionId}?mode=${target}`);
      }
    } catch (err) {
      setStartError(apiError(err, '创建会话失败，请稍后重试'));
      setStarting(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-3 border-coral/30 border-t-coral rounded-full animate-spin" />
      </div>
    );
  }

  if (!scenario) {
    return (
      <div className="px-4 py-16 flex flex-col items-center gap-4">
        <p className="text-sm text-text-secondary">{loadError || '场景不存在'}</p>
        <button
          onClick={() => navigate('/home')}
          className="px-6 py-2.5 bg-coral text-white rounded-2xl text-sm font-medium"
        >
          返回首页
        </button>
      </div>
    );
  }

  const skills = scenario.skillPointNames ?? [];
  const topics = scenario.coverageTopics ?? [];
  const infoRows: { label: string; value: string }[] = [];
  infoRows.push({ label: '及格分', value: `${scenario.successCriteria.passScore} 分` });
  if (scenario.source) infoRows.push({ label: '来源', value: scenario.source });
  if (scenario.practiceCount != null) infoRows.push({ label: '练习人次', value: `${scenario.practiceCount}` });

  return (
    <div className="px-4 py-4 pb-8">
      {/* 顶部返回 */}
      <button
        onClick={() => navigate('/home')}
        className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-text-primary mb-4 transition-colors"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        返回
      </button>

      {/* 场景头部卡片 */}
      <div className="bg-dark-card rounded-2xl p-4 border border-white/5 mb-5">
        <div className="flex items-center gap-2 mb-3">
          <span className="px-2 py-0.5 bg-coral/15 text-coral text-xs rounded-full font-medium">{categoryLabelOf(scenario) ?? '综合场景'}</span>
          <span className="text-xs text-text-tertiary">时长 {scenario.durationMinutes} 分钟</span>
          <span className="ml-auto flex gap-0.5">
            {[1, 2, 3, 4, 5].map((i) => (
              <svg key={i} width="14" height="14" viewBox="0 0 24 24" fill={i <= scenario.difficulty ? '#E85C62' : 'none'} stroke={i <= scenario.difficulty ? '#E85C62' : '#4A5060'} strokeWidth="2">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
            ))}
          </span>
        </div>
        <h1 className="text-lg font-bold text-text-primary">{scenario.name}</h1>
        {scenario.methodology && (
          <p className="text-xs text-text-secondary mt-2 leading-relaxed">
            {scenario.methodology}
          </p>
        )}
      </div>

      {/* 角色信息 */}
      {(scenario.personaName || scenario.personaTitle) && (
        <div className="bg-dark-card rounded-2xl p-4 border border-white/5 mb-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-11 h-11 rounded-full bg-gradient-to-br from-coral/30 to-dark-panel flex items-center justify-center text-text-primary font-bold border border-coral/30">
              {(scenario.personaName ?? '客')[0]}
            </div>
            <div>
              <div className="text-text-primary text-sm font-medium">{scenario.personaName ?? 'AI 客户'}</div>
              {scenario.personaTitle && <div className="text-text-tertiary text-xs">{scenario.personaTitle}</div>}
            </div>
          </div>
          <div className="space-y-2.5 mt-3">
            {infoRows.map((row) => (
              <InfoRow key={row.label} label={row.label} value={row.value} />
            ))}
          </div>
        </div>
      )}

      {/* 练习目标 */}
      {topics.length > 0 && (
        <div className="bg-dark-card rounded-2xl p-4 border border-white/5 mb-5">
          <h3 className="text-text-primary text-sm font-semibold mb-2.5">练习目标</h3>
          <ul className="space-y-2">
            {topics.map((goal, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-text-secondary">
                <span className="w-5 h-5 rounded-full bg-coral/15 text-coral text-[10px] flex items-center justify-center shrink-0 mt-0.5 font-medium">{i + 1}</span>
                {goal}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 评估维度 */}
      {skills.length > 0 && (
        <div className="bg-dark-card rounded-2xl p-4 border border-white/5 mb-6">
          <h3 className="text-text-primary text-sm font-semibold mb-2.5">评估维度</h3>
          <div className="space-y-2">
            {skills.map((name, i) => (
              <div key={name} className="flex items-center gap-3 px-3 py-2.5 bg-dark-panel rounded-xl">
                <div className="w-1.5 h-1.5 rounded-full bg-coral" />
                <span className="text-xs text-text-primary flex-1">{name}</span>
                {skillWeights && (
                  <span className="text-[11px] text-text-tertiary">{skillWeights[i]}%</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 三种模式入口 */}
      <div className="space-y-2.5">
        <p className="text-xs text-text-tertiary font-medium mb-1">选择对练模式</p>
        {startError && <p className="text-xs text-coral">{startError}</p>}
        <button
          onClick={() => startSession('call')}
          disabled={starting !== null}
          className="w-full py-3.5 bg-coral text-white rounded-2xl text-sm font-medium hover:bg-coral-disabled disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
        >
          <span>📞</span> {starting === 'call' ? '创建会话中…' : '实时通话 · 连续双向音频'}
        </button>
        <div className="grid grid-cols-2 gap-2.5">
          <button
            onClick={() => startSession('voice')}
            disabled={starting !== null}
            className="py-3.5 bg-dark-panel text-text-primary rounded-2xl text-xs font-medium hover:bg-dark-elevated transition-colors border border-cat-inquiry/20 flex items-center justify-center gap-1.5 disabled:opacity-50"
          >
            <span>🎙</span> {starting === 'voice' ? '创建中…' : '轮次语音'}
          </button>
          <button
            onClick={() => startSession('text')}
            disabled={starting !== null}
            className="py-3.5 bg-dark-panel text-text-primary rounded-2xl text-xs font-medium hover:bg-dark-elevated transition-colors border border-cat-ground/20 flex items-center justify-center gap-1.5 disabled:opacity-50"
          >
            <span>⌨️</span> {starting === 'text' ? '创建中…' : '文字对练'}
          </button>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-text-tertiary w-12 shrink-0">{label}</span>
      <span className="text-xs text-text-primary">{value}</span>
    </div>
  );
}
