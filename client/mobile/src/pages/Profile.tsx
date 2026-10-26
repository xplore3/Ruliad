﻿﻿﻿import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { getStoredUser } from '../api';
import { usePageTrack } from '../track';
import { Avatar } from '../components/Avatar';
import type { GrowthResponse } from '../types';

function showVipFeature(title: string) {
  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-50 flex items-center justify-center';
  overlay.style.background = 'rgba(0,0,0,0.5)';
  overlay.innerHTML = `
    <div style="margin:0 1.5rem;width:100%;max-width:24rem;background:#22252D;border-radius:1rem;padding:1.75rem 1.5rem;text-align:center;box-shadow:0 20px 25px -5px rgba(0,0,0,0.3);">
      <div style="font-size:2.5rem;">👑</div>
      <p style="margin-top:0.5rem;font-size:1.125rem;font-weight:700;color:#F7F7FA;">${title} · VIP 专属功能</p>
      <p style="margin-top:0.75rem;font-size:0.875rem;color:#A4A7B3;line-height:1.6;">该功能为 VIP 会员专属，升级 VIP 即可解锁全部高级能力。</p>
      <p style="margin-top:0.75rem;font-size:0.8125rem;color:#E85C62;font-weight:600;">升级 VIP 请联系：graspai@126.com</p>
      <button id="vip-close" style="margin-top:1.25rem;width:100%;border-radius:0.75rem;background:#E85C62;padding:0.625rem 0;font-size:0.875rem;font-weight:700;color:#F7F7FA;border:none;cursor:pointer;">知道了</button>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('#vip-close')?.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}


export default function Profile() {
  const navigate = useNavigate();
  const [data, setData] = useState<GrowthResponse | null>(null);
  const user = getStoredUser();
  usePageTrack('/profile');

  useEffect(() => {
    api.get<GrowthResponse>('/growth').then((res) => setData(res.data)).catch(() => {});
  }, []);

  const totalScore = data && data.skills.length > 0
    ? Math.round(data.skills.reduce((sum, s) => sum + s.currentLevel * 20, 0) / data.skills.length)
    : 0;

  const topSkills = data?.skills.slice(0, 2).map((s) => `${s.name} ${s.currentLevel * 20}`).join(' · ') ?? '';

  return (
    <div className="flex flex-col" style={{ backgroundColor: '#17191F', minHeight: '100vh' }}>
      {/* 头部 */}
      <div className="px-5 pb-6 pt-4" style={{ backgroundColor: '#17191F' }}>
        <div className="flex items-center gap-3">
          <Avatar name={(user?.name ?? '我')} size="lg" rounded="full" />
          <div>
            <p className="text-lg font-bold" style={{ color: '#F7F7FA' }}>{user?.name ?? '我'}</p>
            <p className="text-xs" style={{ color: '#A4A7B3' }}>个人 · 默认私密</p>
          </div>
        </div>
      </div>

      {/* 综合能力 */}
      <div className="mx-4 -mt-3 rounded-2xl p-5" style={{ backgroundColor: '#22252D' }}>
        <div className="flex items-baseline justify-between">
          <span className="text-sm" style={{ color: '#A4A7B3' }}>最近有效训练 · 演示</span>
        </div>
        <div className="mt-1 flex items-end gap-2">
          <span className="text-5xl font-bold" style={{ color: '#F7F7FA' }}>{totalScore || '—'}</span>
          <span className="pb-1 text-sm" style={{ color: '#A4A7B3' }}>综合能力</span>
        </div>
        {topSkills && <p className="mt-2 text-xs" style={{ color: '#A4A7B3' }}>{topSkills}</p>}
      </div>

      {/* 功能入口 */}
      <div className="mx-4 mt-4 space-y-2">
        <ProfileItem
          icon="📊"
          title="我的多维能力"
          subtitle="画像 / 趋势"
          onClick={() => navigate('/my-abilities')}
        />
        <ProfileItem
          icon="📋"
          title="训练计划"
          subtitle="VIP 专属"
          badge="👑"
          onClick={() => showVipFeature('训练计划')}
        />
        <ProfileItem
          icon="⚙️"
          title="我的配置"
          subtitle="声音 / 评分 / 隐私"
          onClick={() => navigate('/config')}
        />
        <ProfileItem
          icon="📦"
          title="个人数据"
          subtitle="VIP 专属"
          badge="👑"
          onClick={() => showVipFeature('个人数据')}
        />
        <ProfileItem
          icon="ℹ️"
          title="关于"
          subtitle="使用说明 · 常见问题"
          onClick={() => navigate('/about')}
        />
      </div>

      <div className="h-8" />
    </div>
  );
}

function ProfileItem({ icon, title, subtitle, onClick, badge }: { icon: string; title: string; subtitle: string; onClick: () => void; badge?: string }) {
  return (
    <button
      className="flex w-full items-center gap-3 rounded-2xl p-4 text-left transition active:scale-[0.98]"
      style={{ backgroundColor: '#22252D' }}
      onClick={onClick}
    >
      <span className="text-2xl">{icon}</span>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <p className="text-[15px] font-bold" style={{ color: '#F7F7FA' }}>{title}</p>
          {badge && <span className="text-xs">{badge}</span>}
        </div>
        <p className="text-xs" style={{ color: '#A4A7B3' }}>{subtitle}</p>
      </div>
      <svg className="h-5 w-5" style={{ color: '#A4A7B3', opacity: 0.5 }} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
    </button>
  );
}
