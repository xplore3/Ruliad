﻿﻿﻿import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import StatusBar from '../components/StatusBar';
import type { GrowthResponse } from '../types';

const DIMENSIONS = [
  { key: 'need', name: '需求挖掘', score: 88 },
  { key: 'value', name: '价值表达', score: 81 },
  { key: 'objection', name: '异议处理', score: 72 },
  { key: 'closing', name: '推进成交', score: 76 },
  { key: 'empathy', name: '倾听共情', score: 85 },
  { key: 'clarity', name: '表达清晰', score: 78 },
];

export default function MyAbility() {
  const navigate = useNavigate();
  const [data, setData] = useState<GrowthResponse | null>(null);

  useEffect(() => {
    api.get<GrowthResponse>('/growth').then((res) => setData(res.data)).catch(() => {});
  }, []);

  const totalScore = data && data.skills.length > 0
    ? Math.round(data.skills.reduce((sum, s) => sum + s.currentLevel * 20, 0) / data.skills.length)
    : 80;

  return (
    <div className="relative mx-auto flex min-h-screen w-full max-w-md flex-col" style={{ backgroundColor: '#17191F' }}>
      <StatusBar dark />
      <div className="flex items-center px-4 py-2">
        <button onClick={() => navigate(-1)} className="flex h-9 w-9 items-center justify-center">
          <svg className="h-5 w-5" style={{ color: '#A4A7B3' }} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
        </button>
      </div>

      <div className="px-5 pt-2">
        <h1 className="text-xl font-bold" style={{ color: '#F7F7FA' }}>陪练员专项能力</h1>
        <p className="mt-1 text-xs" style={{ color: '#A4A7B3' }}>最近 30 天 · 语音对话 · 规则 v1</p>
      </div>

      {/* 综合分 */}
      <div className="mx-5 mt-6 rounded-2xl p-5" style={{ backgroundColor: '#22252D' }}>
        <div className="flex items-center gap-4">
          <div className="shrink-0">
            <RadarChart dimensions={DIMENSIONS} />
          </div>
          <div className="flex-1">
            <span className="text-5xl font-bold" style={{ color: '#F7F7FA' }}>{totalScore}</span>
            <p className="mt-1 text-xs" style={{ color: '#A4A7B3' }}>综合能力</p>
          </div>
        </div>
      </div>

      {/* 各维度得分 */}
      <div className="mx-5 mt-4 space-y-3">
        {DIMENSIONS.map((dim) => (
          <div key={dim.key} className="rounded-2xl p-4" style={{ backgroundColor: '#22252D' }}>
            <div className="flex items-center justify-between">
              <span className="text-[15px] font-bold" style={{ color: '#F7F7FA' }}>{dim.name}</span>
              <span className="text-lg font-bold" style={{ color: dim.score >= 80 ? '#5DC7A3' : '#E85C62' }}>{dim.score}</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full" style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}>
              <div
                className="h-full rounded-full"
                style={{ width: `${dim.score}%`, backgroundColor: dim.score >= 80 ? '#5DC7A3' : '#E85C62' }}
              />
            </div>
            <button className="mt-2 text-xs font-medium" style={{ color: '#E85C62' }} onClick={() => navigate(`/space/${dim.key}/detail`, { state: { key: dim.key, name: dim.name, score: dim.score } })}>查看评分证据与指导 ›</button>
          </div>
        ))}
      </div>

      {/* 底部 */}
      <div className="flex-1" />
      <div className="h-6" />
    </div>
  );
}

function RadarChart({ dimensions }: { dimensions: { name: string; score: number }[] }) {
  const W = 160;
  const H = 160;
  const CX = W / 2;
  const CY = H / 2;
  const R = 55;
  const n = dimensions.length;
  const angleAt = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const vertex = (i: number, ratio: number) => ({
    x: CX + Math.cos(angleAt(i)) * R * ratio,
    y: CY + Math.sin(angleAt(i)) * R * ratio,
  });

  const valuePoints = dimensions
    .map((d, i) => { const p = vertex(i, d.score / 100); return `${p.x},${p.y}`; })
    .join(' ');

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-40 w-40">
      {[1, 2, 3, 4, 5].map((level) => (
        <polygon
          key={level}
          points={dimensions.map((_, i) => { const p = vertex(i, level / 5); return `${p.x},${p.y}`; }).join(' ')}
          fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="1"
        />
      ))}
      {dimensions.map((_, i) => {
        const p = vertex(i, 1);
        return <line key={i} x1={CX} y1={CY} x2={p.x} y2={p.y} stroke="rgba(255,255,255,0.08)" strokeWidth="1" />;
      })}
      <polygon points={valuePoints} fill="rgba(232,92,98,0.2)" stroke="#E85C62" strokeWidth="1.5" />
      {dimensions.map((d, i) => {
        const label = vertex(i, 1.3);
        return <text key={d.name} x={label.x} y={label.y + 3} fontSize="8" fill="#A4A7B3" textAnchor="middle">{d.name.slice(0, 2)}</text>;
      })}
    </svg>
  );
}
