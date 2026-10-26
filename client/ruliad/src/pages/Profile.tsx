import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchGrowth } from '../api';
import type { UserSkillState } from '../types';

export default function Profile() {
  const navigate = useNavigate();
  const [skills, setSkills] = useState<UserSkillState[]>([]);
  const [stats, setStats] = useState({ avgScore: 0, totalHours: 0, streakDays: 0 });
  const [filterLevel, setFilterLevel] = useState<number | null>(null);

  useEffect(() => {
    fetchGrowth()
      .then((data) => {
        setSkills(data.skills);
        const totalScore = data.sessions.reduce((sum, s) => sum + s.totalScore, 0);
        setStats({
          avgScore: data.sessions.length > 0 ? Math.round(totalScore / data.sessions.length) : 0,
          totalHours: data.sessions.length * 0.2,
          streakDays: 7,
        });
      })
      .catch(console.error);
  }, []);

  const filteredSkills = filterLevel !== null ? skills.filter((s) => s.currentLevel === filterLevel) : skills;

  return (
    <div className="px-4 py-4">
      {/* Profile card matching prototype .profile */}
      <div className="card" style={{ padding: 22, margin: '24px 0 8px', display: 'flex', alignItems: 'center', gap: 18 }}>
        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-coral to-coral-dark flex items-center justify-center text-white text-2xl font-bold">
          演
        </div>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#1F2329', marginBottom: 2 }}>销售小陈</h1>
          <div style={{ fontSize: 13, color: '#6B7280' }}>
            已练习 <b style={{ color: '#FF6B5B', fontWeight: 700 }}>23</b> 场 · 综合 <b style={{ color: '#FF6B5B', fontWeight: 700 }}>78</b> 分
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, flex: 'none' }}>
          <button className="btn ghost sm">设置</button>
          <button className="btn ghost sm">关于</button>
        </div>
      </div>

      {/* Skill filter row */}
      <div style={{ margin: '16px 0 12px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: '#1F2329' }}>📒 练习记录</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          {[
            { key: null, label: '全部' },
            { key: 1, label: 'L1' },
            { key: 2, label: 'L2' },
            { key: 3, label: 'L3' },
          ].map((f) => (
            <button
              key={f.label}
              onClick={() => setFilterLevel(f.key)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all border ${
                filterLevel === f.key ? 'bg-coral text-white border-transparent' : 'bg-white text-text-secondary border-line hover:border-coral hover:text-coral'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="card" style={{ padding: 16, textAlign: 'center' }}>
          <div className="font-din text-2xl font-bold text-coral">{stats.avgScore}</div>
          <div className="text-xs text-text-tertiary mt-0.5">平均得分</div>
        </div>
        <div className="card" style={{ padding: 16, textAlign: 'center' }}>
          <div className="font-din text-2xl font-bold text-cat-ground">{stats.totalHours}</div>
          <div className="text-xs text-text-tertiary mt-0.5">累计时长(h)</div>
        </div>
        <div className="card" style={{ padding: 16, textAlign: 'center' }}>
          <div className="font-din text-2xl font-bold text-success">6</div>
          <div className="text-xs text-text-tertiary mt-0.5">技能点亮</div>
        </div>
      </div>

      {/* Skill list */}
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <h3 style={{ fontWeight: 600, color: '#1F2329', marginBottom: 12, fontSize: 15 }}>多维能力画像</h3>
        <div className="space-y-3">
          {filteredSkills.map((skill) => (
            <div key={skill.skillPointId} style={{ background: '#F7F7F8', borderRadius: 12, padding: 12 }}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span style={{ fontSize: 14, fontWeight: 500, color: '#1F2329' }}>{skill.name}</span>
                  <span style={{
                    padding: '2px 6px', borderRadius: 6, fontSize: 10, fontWeight: 700,
                    background: skill.currentLevel === 3 ? '#FDF3E1' : skill.currentLevel === 2 ? '#E7F6F0' : '#F1F2F4',
                    color: skill.currentLevel === 3 ? '#B87A0E' : skill.currentLevel === 2 ? '#2FAE7B' : '#9CA1AB',
                  }}>
                    L{skill.currentLevel}
                  </span>
                </div>
                <span style={{ fontSize: 12, color: '#9CA1AB' }}>练习 {skill.historyCount} 次</span>
              </div>
              {/* Level progress */}
              <div className="flex gap-1.5">
                {[1, 2, 3].map((l) => (
                  <div key={l} style={{ flex: 1, height: 6, borderRadius: 999, background: '#EBEBEF', overflow: 'hidden' }}>
                    <div
                      style={{
                        height: '100%', borderRadius: 999, transition: 'width .3s',
                        width: l <= skill.currentLevel ? '100%' : '0%',
                        background: skill.currentLevel === 3 ? '#F5A623' : skill.currentLevel === 2 ? '#2FAE7B' : '#FF6B5B',
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}

          {filteredSkills.length === 0 && (
            <div className="py-8 text-center">
              <p style={{ fontSize: 14, color: '#6B7280' }}>该等级暂无能力数据</p>
            </div>
          )}
        </div>
      </div>

      {/* Training plan */}
      <div style={{
        background: 'linear-gradient(to right, #FFF0EE, #E7F6F0)',
        borderRadius: 16, padding: 16, border: '1px solid #FFE4DF', marginBottom: 16,
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#FFF0EE', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flex: 'none' }}>📋</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h4 style={{ fontSize: 14, fontWeight: 500, color: '#1F2329' }}>训练计划</h4>
          <p style={{ fontSize: 12, color: '#9CA1AB', marginTop: 2 }}>本周还有 3 个计划待完成</p>
        </div>
        <button onClick={() => navigate('/sessions')} style={{ padding: '6px 14px', background: '#FF6B5B', color: '#fff', fontSize: 12, borderRadius: 999, fontWeight: 500, flex: 'none' }}>
          查看
        </button>
      </div>

      {/* Settings entries */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <SettingsRow iconColor="#FF6B5B" icon="settings" title="练习设置" desc="麦克风、语速、输入方式" />
        <SettingsRow iconColor="#2FAE7B" icon="info" title="关于" desc="Grasp AI 销售陪练 · v1.0.0 Demo" />
        <SettingsRow iconColor="#F5A623" icon="mail" title="反馈" desc="提交您的建议与问题" />
      </div>

      {/* Demo watermark */}
      <div style={{ marginTop: 16, padding: 12, borderRadius: 16, border: '1px dashed #EBEBEF', textAlign: 'center', background: '#F7F7F8' }}>
        <p style={{ fontSize: 12, color: '#9CA1AB' }}>
          当前为 Demo 演示版本 · 所有数据均为模拟数据
        </p>
      </div>
    </div>
  );
}

function SettingsRow({ iconColor, icon, title, desc }: { iconColor: string; icon: 'settings' | 'info' | 'mail'; title: string; desc: string }) {
  const iconSvg = {
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></>,
    info: <><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></>,
    mail: <><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></>,
  };

  return (
    <button className="w-full flex items-center gap-4 px-4 py-3.5 transition-colors" style={{ borderBottom: '1px solid #EBEBEF' }}>
      <div style={{ width: 36, height: 36, borderRadius: 12, background: '#F7F7F8', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={iconColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {iconSvg[icon]}
        </svg>
      </div>
      <div style={{ flex: 1, textAlign: 'left' }}>
        <span style={{ fontSize: 14, fontWeight: 500, color: '#1F2329' }}>{title}</span>
        <p style={{ fontSize: 12, color: '#9CA1AB', marginTop: 2 }}>{desc}</p>
      </div>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9CA1AB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </button>
  );
}
