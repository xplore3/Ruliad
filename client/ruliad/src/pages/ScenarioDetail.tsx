import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { fetchScenarios, createSession } from '../api';
import type { Scenario } from '../types';

export default function ScenarioDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (id) {
      fetchScenarios()
        .then((data) => {
          const found = data.scenarios.find((s) => s.id === id);
          setScenario(found ?? null);
        })
        .catch(console.error)
        .finally(() => setLoading(false));
    }
  }, [id]);

  const handleStartPractice = async (mode: 'text' | 'voice') => {
    if (!id || starting) return;
    setStarting(true);
    try {
      const data = await createSession(id, 'practice');
      navigate(`/practice/${data.session.id}`);
    } catch (err) {
      console.error(err);
      alert('创建会话失败，请稍后重试');
    } finally {
      setStarting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-3 border-coral/30 border-t-coral rounded-full animate-spin" />
      </div>
    );
  }

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
          <span className="px-2 py-0.5 bg-coral/15 text-coral text-xs rounded-full font-medium">电话销售</span>
          <span className="text-xs text-text-tertiary">时长 {scenario?.durationMinutes || 10} 分钟</span>
          <span className="ml-auto flex gap-0.5">
            {[1, 2, 3, 4, 5].map((i) => (
              <svg key={i} width="14" height="14" viewBox="0 0 24 24" fill={i <= (scenario?.difficulty || 0) ? '#E85C62' : 'none'} stroke={i <= (scenario?.difficulty || 0) ? '#E85C62' : '#4A5060'} strokeWidth="2">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
            ))}
          </span>
        </div>
        <h1 className="text-lg font-bold text-text-primary">{scenario?.name || '场景详情'}</h1>
        <p className="text-xs text-text-secondary mt-2 leading-relaxed">
          在这个场景中，你将扮演销售人员，向目标客户进行首次电话邀约。客户是一位谨慎的采购总监，对新产品持怀疑态度。
        </p>
      </div>

      {/* 角色信息 */}
      <div className="bg-dark-card rounded-2xl p-4 border border-white/5 mb-5">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-11 h-11 rounded-full bg-gradient-to-br from-coral/30 to-dark-panel flex items-center justify-center text-text-primary font-bold border border-coral/30">
            王
          </div>
          <div>
            <div className="text-text-primary text-sm font-medium">{scenario?.personaName || '王总'}</div>
            <div className="text-text-tertiary text-xs">{scenario?.personaTitle || '采购总监 · 某科技公司'}</div>
          </div>
        </div>
        <div className="space-y-2.5 mt-3">
          <InfoRow label="性格" value="谨慎、数据驱动" />
          <InfoRow label="态度" value="初步排斥，愿意给机会" />
          <InfoRow label="核心痛点" value="担心切换成本" />
          <InfoRow label="隐藏信息" value="目前对原供应商服务不满" />
        </div>
      </div>

      {/* 练习目标 */}
      <div className="bg-dark-card rounded-2xl p-4 border border-white/5 mb-5">
        <h3 className="text-text-primary text-sm font-semibold mb-2.5">练习目标</h3>
        <ul className="space-y-2">
          {['快速建立信任感', '准确挖掘客户痛点', '自然引出产品介绍', '处理"已有供应商"异议'].map((goal, i) => (
            <li key={i} className="flex items-start gap-2 text-xs text-text-secondary">
              <span className="w-5 h-5 rounded-full bg-coral/15 text-coral text-[10px] flex items-center justify-center shrink-0 mt-0.5 font-medium">{i + 1}</span>
              {goal}
            </li>
          ))}
        </ul>
      </div>

      {/* 评估维度 */}
      <div className="bg-dark-card rounded-2xl p-4 border border-white/5 mb-6">
        <h3 className="text-text-primary text-sm font-semibold mb-2.5">评估维度</h3>
        <div className="space-y-2">
          {[
            { name: '开场破冰', weight: '20%' },
            { name: '需求挖掘', weight: '25%' },
            { name: '方案呈现', weight: '20%' },
            { name: '异议处理', weight: '20%' },
            { name: '促成成交', weight: '15%' },
          ].map((dim) => (
            <div key={dim.name} className="flex items-center gap-3 px-3 py-2.5 bg-dark-panel rounded-xl">
              <div className="w-1.5 h-1.5 rounded-full bg-coral" />
              <span className="text-xs text-text-primary flex-1">{dim.name}</span>
              <span className="text-[11px] text-text-tertiary">{dim.weight}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 三种模式入口 */}
      <div className="space-y-2.5">
        <p className="text-xs text-text-tertiary font-medium mb-1">选择对练模式</p>
        <button
          onClick={() => navigate('/call')}
          disabled={starting}
          className="w-full py-3.5 bg-coral text-white rounded-2xl text-sm font-medium hover:bg-coral-disabled disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
        >
          <span>📞</span> 实时通话 · 连续双向音频
        </button>
        <div className="grid grid-cols-2 gap-2.5">
          <button
            onClick={() => handleStartPractice('voice')}
            disabled={starting}
            className="py-3.5 bg-dark-panel text-text-primary rounded-2xl text-xs font-medium hover:bg-dark-elevated transition-colors border border-cat-inquiry/20 flex items-center justify-center gap-1.5"
          >
            <span>🎙</span> 轮次语音
          </button>
          <button
            onClick={() => handleStartPractice('text')}
            disabled={starting}
            className="py-3.5 bg-dark-panel text-text-primary rounded-2xl text-xs font-medium hover:bg-dark-elevated transition-colors border border-cat-ground/20 flex items-center justify-center gap-1.5"
          >
            <span>⌨️</span> 文字对练
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
