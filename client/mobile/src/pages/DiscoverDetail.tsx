import { useNavigate } from 'react-router-dom';
import StatusBar from '../components/StatusBar';

export default function DiscoverDetail() {
  const navigate = useNavigate();

  return (
    <div className="relative mx-auto flex min-h-screen w-full max-w-md flex-col" style={{ backgroundColor: '#17191F' }}>
      <StatusBar dark />
      <div className="flex items-center px-4 py-2">
        <button onClick={() => navigate(-1)} className="flex h-9 w-9 items-center justify-center">
          <svg className="h-5 w-5" style={{ color: '#A4A7B3' }} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
        </button>
      </div>

      {/* 作者 */}
      <div className="flex items-center gap-3 px-5 pt-2">
        <div className="flex h-12 w-12 items-center justify-center rounded-full text-base font-bold" style={{ backgroundColor: 'rgba(232,92,98,0.12)', color: '#E85C62' }}>陈</div>
        <div className="flex-1">
          <p className="text-base font-bold" style={{ color: '#F7F7FA' }}>小陈的成长记录</p>
          <p className="text-xs" style={{ color: '#A4A7B3' }}>公开 · 已脱敏</p>
        </div>
      </div>

      {/* 成果标题 */}
      <div className="mx-5 mt-6 rounded-2xl p-5" style={{ backgroundColor: 'rgba(232,92,98,0.08)' }}>
        <p className="text-base font-bold" style={{ color: '#F7F7FA' }}>一次更有说服力的回应</p>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-xs" style={{ color: '#E85C62' }}>异议处理</span>
          <span className="text-3xl font-bold" style={{ color: '#E85C62' }}>82</span>
          <span className="text-xs" style={{ color: '#A4A7B3' }}>/ 100</span>
        </div>
      </div>

      {/* 作者心得 */}
      <div className="mx-5 mt-4 rounded-2xl p-5" style={{ backgroundColor: '#22252D' }}>
        <p className="text-sm font-bold" style={{ color: '#F7F7FA' }}>作者心得</p>
        <p className="mt-2 text-sm leading-relaxed" style={{ color: '#A4A7B3' }}>
          我先确认了客户担心的迁移成本，再用试点方案降低风险。
        </p>
      </div>

      {/* 练习条件 */}
      <div className="mx-5 mt-4 rounded-2xl p-5" style={{ backgroundColor: '#22252D' }}>
        <p className="text-sm font-bold" style={{ color: '#F7F7FA' }}>练习条件</p>
        <div className="mt-3 space-y-2 text-sm">
          <div className="flex justify-between"><span style={{ color: '#A4A7B3' }}>对练模式</span><span style={{ color: '#F7F7FA' }}>语音对话</span></div>
          <div className="flex justify-between"><span style={{ color: '#A4A7B3' }}>评分规则</span><span style={{ color: '#F7F7FA' }}>SPIN v1</span></div>
        </div>
      </div>

      {/* 练同款 */}
      <div className="flex-1" />
      <div className="p-5">
        <button
          className="mx-auto block min-h-13 w-full max-w-[260px] rounded-2xl text-base font-bold shadow-lg transition active:scale-[0.98]"
          style={{ backgroundColor: '#E85C62', color: '#17191F' }}
          onClick={() => navigate('/')}
        >
          练同款公开陪练员
        </button>
        <p className="mt-3 text-center text-xs" style={{ color: '#A4A7B3' }}>同款入口仅向公开陪练员开放</p>
      </div>
    </div>
  );
}
