﻿import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../api';
import StatusBar from '../components/StatusBar';
import { Avatar } from '../components/Avatar';
import type { Scenario, CreateSessionResponse } from '../types';

type Mode = 'text' | 'voice' | 'call';

const MODES: { key: Mode; title: string; desc: string; icon: string; color: string }[] = [
  { key: 'text', title: '文字对话', desc: '专注逻辑与话术', icon: '💬', color: 'orange' },
  { key: 'voice', title: '语音对话', desc: '一轮一轮说，先校对再发送', icon: '🎙', color: 'blue' },
  { key: 'call', title: '语音通话', desc: '实时开口，可插话', icon: '📞', color: 'green' },
];

export default function ModeSelect() {
  const { scenarioId } = useParams<{ scenarioId: string }>();
  const navigate = useNavigate();
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [selected, setSelected] = useState<Mode>('text');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!scenarioId) return;
    api.get<{ scenarios: Scenario[] }>('/scenarios').then((res) => {
      const s = res.data.scenarios.find((sc) => sc.id === scenarioId);
      if (s) setScenario(s);
    }).catch(() => {});
  }, [scenarioId]);

  const start = async () => {
    if (creating || !scenarioId) return;
    setCreating(true);
    try {
      const res = await api.post<CreateSessionResponse>('/sessions', {
        scenarioId,
        mode: 'practice',
      });
      const sessionId = res.data.session.id;
      const route = selected === 'text' ? 'text' : selected === 'voice' ? 'voice' : 'call';
      navigate(`/session/${route}/${sessionId}`, { state: res.data });
    } catch {
      window.alert('创建会话失败，请重试');
      setCreating(false);
    }
  };

  const personaName = scenario?.personaName ?? '陪练员';

  return (
    <div className="relative mx-auto flex min-h-screen w-full max-w-md flex-col">
      <StatusBar dark />
      <div className="flex items-center px-4 py-2">
        <button onClick={() => navigate(-1)} className="flex h-9 w-9 items-center justify-center">
          <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      </div>

      {/* 陪练员简述 */}
      <div className="px-6 pt-2">
        <div className="flex items-center gap-3">
          <Avatar name={personaName} size="lg" rounded="full" />
          <div>
            <p className="text-lg font-bold">与{personaName}对练</p>
            <p className="text-xs">陪练员 v2 · SPIN 基础规则</p>
          </div>
        </div>
      </div>

      {/* 模式选择 */}
      <div className="mt-6 flex-1 space-y-3 px-6">
        {MODES.map((mode) => {
          const isSelected = selected === mode.key;
          return (
            <button
              key={mode.key}
              className={`relative flex w-full items-center gap-4 rounded-2xl border-2 p-4 text-left transition-all duration-200 ${
                isSelected
                  ? mode.color === 'orange'
                    ? 'border-orange-500 bg-orange-50 shadow-lg shadow-orange-200 scale-[1.02]'
                    : mode.color === 'blue'
                    ? 'border-blue-500 bg-blue-50 shadow-lg shadow-blue-200 scale-[1.02]'
                    : 'border-green-600 bg-green-50 shadow-lg shadow-green-200 scale-[1.02]'
                  : 'border-gray-200 bg-white opacity-50'
              }`}
              onClick={() => setSelected(mode.key)}
              onDoubleClick={() => { setSelected(mode.key); start(); }}
            >
              {/* 选中打勾标记 */}
              {isSelected && (
                <span className={`absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full text-white text-xs font-bold ${
                  mode.color === 'orange' ? 'bg-orange-500' : mode.color === 'blue' ? 'bg-blue-500' : 'bg-green-600'
                }`}>✓</span>
              )}
              <span className={`text-3xl transition-transform ${isSelected ? 'scale-110' : ''}`}>{mode.icon}</span>
              <div className="flex-1">
                <p className={`text-base font-bold ${isSelected ? '' : 'text-gray-400'}`}>{mode.title}</p>
                <p className={`mt-0.5 text-sm ${isSelected ? 'text-gray-600' : 'text-gray-300'}`}>{mode.desc}</p>
              </div>
              {isSelected && (
                <span className="text-xs text-gray-400 whitespace-nowrap">双击开始 →</span>
              )}
            </button>
          );
        })}

        {selected !== 'text' && (
          <p className="px-1 text-xs text-gray-500">语音模式需要麦克风权限</p>
        )}
      </div>

      {/* 确认 */}
      <div className="p-6">
        <button
          className={`mx-auto block min-h-13 w-full max-w-[260px] rounded-2xl text-base font-bold shadow-lg transition-all duration-300 active:scale-[0.98] disabled:scale-100 disabled:opacity-50 ${
            selected === 'text'
              ? 'bg-orange-500 hover:bg-orange-600 text-white'
              : selected === 'voice'
              ? 'bg-blue-500 hover:bg-blue-600 text-white'
              : 'bg-green-600 hover:bg-green-700 text-white'
          }`}
          onClick={start}
          disabled={creating}
        >
          {creating ? '正在创建…' : `开始${MODES.find((m) => m.key === selected)?.title.replace('对话', '').replace('语音', '')}训练`}
        </button>
        <p className="mt-2 text-center text-xs text-gray-400">双击模式卡片也可开始</p>
      </div>
    </div>
  );
}
