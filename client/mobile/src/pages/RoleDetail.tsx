﻿import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../api';
import type { Scenario, PersonaConfig } from '../types';
import StatusBar from '../components/StatusBar';
import { Avatar } from '../components/Avatar';

export default function RoleDetail() {
  const { scenarioId } = useParams<{ scenarioId: string }>();
  const navigate = useNavigate();
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [persona, setPersona] = useState<PersonaConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!scenarioId) return;
    api.get<{ scenarios: Scenario[] }>('/scenarios').then((res) => {
      const s = res.data.scenarios.find((sc) => sc.id === scenarioId);
      if (s) {
        setScenario(s);
        if (s.personaConfigId) {
          api.get<PersonaConfig>(`/persona-configs/${s.personaConfigId}`).then((r) => {
            setPersona(r.data);
          }).catch(() => {});
        }
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [scenarioId]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ backgroundColor: '#17191F' }}>
        <p className="text-sm" style={{ color: '#A4A7B3' }}>正在加载…</p>
      </div>
    );
  }

  const name = persona?.name ?? scenario?.name ?? '陪练员';
  const title = persona?.occupation ? `${persona.occupation} · AI 角色` : 'AI 角色';
  const tags = ['高压挑战'];
  const source = persona ? `案例库 v${persona.version}` : '案例库';

  return (
    <div className="relative mx-auto flex min-h-screen w-full max-w-md flex-col" style={{ backgroundColor: '#17191F' }}>
      <StatusBar dark />
      {/* 返回 */}
      <div className="flex items-center px-4 py-2">
        <button onClick={() => navigate(-1)} className="flex h-9 w-9 items-center justify-center">
          <svg className="h-5 w-5" style={{ color: '#A4A7B3' }} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      </div>

      {/* 陪练员头像 */}
      <div className="flex flex-col items-center px-6 pt-4">
        <Avatar name={name} avatar={persona?.avatar} size="xl" rounded="full" className="shadow-lg" />
        <h1 className="mt-4 text-2xl font-bold" style={{ color: '#F7F7FA' }}>{name}</h1>
        <p className="mt-1 text-sm" style={{ color: '#A4A7B3' }}>{title}</p>
      </div>

      {/* 标签 */}
      <div className="mt-4 flex justify-center gap-2 px-6">
        {tags.map((tag) => (
          <span key={tag} className="rounded-full px-3 py-1 text-xs font-medium" style={{ backgroundColor: 'rgba(232,92,98,0.12)', color: '#E85C62' }}>
            {tag}
          </span>
        ))}
      </div>

      {/* 画像描述 */}
      <div className="mx-6 mt-6 rounded-2xl p-5" style={{ backgroundColor: '#22252D' }}>
        <p className="text-sm leading-relaxed" style={{ color: '#F7F7FA' }}>
          {persona?.background ?? '正在评估 CRM 系统，重视投入回报。你的目标是确认真实需求，并争取下一次演示。'}
        </p>
        <div className="mt-4 pt-4" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <p className="text-xs" style={{ color: '#A4A7B3' }}>来源</p>
          <p className="mt-1 text-sm font-medium" style={{ color: '#F7F7FA' }}>{source}</p>
        </div>
      </div>

      {/* 开始对练 */}
      <div className="mt-auto p-6">
        <button
          className="mx-auto block min-h-13 w-full max-w-[260px] rounded-2xl text-base font-bold shadow-lg transition active:scale-[0.98]"
          style={{ backgroundColor: '#E85C62', color: '#17191F' }}
          onClick={() => navigate(`/mode/${scenarioId}`)}
        >
          开始对练
        </button>
      </div>
    </div>
  );
}
