import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';


type CallPhase = 'dialing' | 'ringing' | 'connected' | 'ended';

const DIAL_NUMBER = '138-0000-8888';

const MOCK_SUBTITLES = [
  { speaker: '王总', text: '喂，谁啊？' },
  { speaker: '我', text: '王总您好，我是XX公司的小陈。' },
  { speaker: '王总', text: '小陈？有什么事吗？' },
  { speaker: '我', text: '王总，想占用您两分钟，关于设备管理有个问题请教。' },
  { speaker: '王总', text: '哦，你说吧，不过我现在时间不多。' },
  { speaker: '我', text: '明白，就是想了解一下，您这边设备故障响应一般多久？' },
  { speaker: '王总', text: '这个……隔天吧，看他们排期。怎么了？' },
  { speaker: '我', text: '那有没有遇到过响应不及时影响生产的情况？' },
  { speaker: '王总', text: '有啊，前两个月有一次等了三天，产线停了小半天。' },
  { speaker: '我', text: '那确实挺耽误事的。我们这边承诺是2小时到场……' },
];

export default function Call() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<CallPhase>('dialing');
  const [elapsed, setElapsed] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeaker, setIsSpeaker] = useState(false);
  const [showSubtitle, setShowSubtitle] = useState(true);
  const [currentSubtitleIdx, setCurrentSubtitleIdx] = useState(-1);
  const [subtitleHistory, setSubtitleHistory] = useState<{ speaker: string; text: string }[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (phase === 'connected') {
      timerRef.current = setInterval(() => {
        setElapsed((prev) => prev + 1);
      }, 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [phase]);

  useEffect(() => {
    if (phase === 'connected') {
      const interval = setInterval(() => {
        setCurrentSubtitleIdx((prev) => {
          const next = prev + 1;
          if (next < MOCK_SUBTITLES.length) {
            setSubtitleHistory((h) => [...h, MOCK_SUBTITLES[next]]);
            return next;
          }
          return prev;
        });
      }, 4000);
      return () => clearInterval(interval);
    }
  }, [phase]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const handleDial = () => {
    setPhase('ringing');
    setTimeout(() => {
      setPhase('connected');
    }, 2500);
  };

  const handleEndCall = () => {
    setPhase('ended');
    if (timerRef.current) clearInterval(timerRef.current);
    setTimeout(() => {
      navigate('/review/demo');
    }, 800);
  };

  return (
    <div className="fixed inset-0 bg-gradient-to-b from-dark-bg to-dark-panel z-[100] flex flex-col">
      {/* 顶栏 */}
      <header className="h-12 flex items-center justify-between px-4 shrink-0">
        <button
          onClick={() => navigate(-1)}
          className="w-8 h-8 rounded-full bg-white/8 flex items-center justify-center text-text-secondary hover:bg-white/12 transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div className="text-text-secondary text-sm font-medium">
          与 · 王建国 · 通话
        </div>
        <div className="w-8" />
      </header>

      {/* 主内容 */}
      <div className="flex-1 flex flex-col items-center justify-center relative">
        {/* 拨号阶段 */}
        {phase === 'dialing' && (
          <div className="flex flex-col items-center">
            <div className="w-24 h-24 rounded-full bg-gradient-to-br from-dark-card to-dark-panel flex items-center justify-center text-text-primary text-4xl font-bold mb-5 border-2 border-coral/30 shadow-lg shadow-coral/10">
              王
            </div>
            <h2 className="text-text-primary text-lg font-bold">王建国</h2>
            <p className="text-text-secondary text-xs mt-1">采购总监 · 某科技公司</p>
            <p className="text-text-tertiary text-xs mt-0.5">{DIAL_NUMBER}</p>

            <button
              onClick={handleDial}
              className="mt-8 w-16 h-16 rounded-full bg-success flex items-center justify-center text-white text-2xl shadow-lg shadow-success/30 hover:bg-success/90 transition-all active:scale-95"
            >
              📞
            </button>
            <p className="text-text-tertiary text-xs mt-3">点击拨号开始通话</p>
          </div>
        )}

        {/* 振铃阶段 */}
        {phase === 'ringing' && (
          <div className="flex flex-col items-center">
            <div className="w-24 h-24 rounded-full bg-gradient-to-br from-dark-card to-dark-panel flex items-center justify-center text-text-primary text-4xl font-bold mb-5 border-2 border-coral/30 animate-pulse">
              王
            </div>
            <h2 className="text-text-primary text-lg font-bold">正在呼叫...</h2>
            <div className="flex items-center gap-1 mt-3">
              <span className="w-2 h-2 bg-success rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-2 h-2 bg-success rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-2 h-2 bg-success rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
            <p className="text-text-tertiary text-xs mt-3">{DIAL_NUMBER}</p>
          </div>
        )}

        {/* 通话中 */}
        {phase === 'connected' && (
          <div className="flex flex-col items-center w-full">
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-coral/30 to-coral/10 flex items-center justify-center text-text-primary text-3xl font-bold mb-3 border-2 border-coral/40 shadow-lg shadow-coral/15">
              王
            </div>
            <h2 className="text-text-primary text-base font-bold">王建国</h2>
            <p className="text-text-tertiary text-xs mt-0.5">采购总监 · 某科技公司</p>
            <div className="font-din text-text-secondary text-sm mt-1.5">{formatTime(elapsed)}</div>

            {/* 声波动画 */}
            <div className="flex items-end gap-1 mt-5 h-10">
              {Array.from({ length: 18 }).map((_, i) => (
                <div
                  key={i}
                  className="w-1.5 bg-coral/60 rounded-full"
                  style={{
                    height: `${Math.random() * 28 + 8}px`,
                    animation: `callWave 0.8s ease-in-out ${i * 0.04}s infinite alternate`,
                  }}
                />
              ))}
            </div>

            {/* 实时字幕 */}
            {showSubtitle && (
              <div className="mt-6 w-full max-w-sm px-4">
                <div className="bg-dark-card/80 backdrop-blur-sm border border-white/8 rounded-xl p-3 max-h-28 overflow-y-auto">
                  {subtitleHistory.length > 0 ? (
                    <div className="space-y-1.5">
                      {[...subtitleHistory].reverse().slice(0, 3).map((s, i) => (
                        <div key={i} className={`text-xs ${i === 0 ? 'text-text-primary' : 'text-text-tertiary'} ${i === 0 ? 'font-medium' : ''}`}>
                          <span className="text-text-tertiary mr-1">[{s.speaker}]</span> {s.text}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-text-tertiary text-xs text-center">等待语音...</p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 结束过渡 */}
        {phase === 'ended' && (
          <div className="flex flex-col items-center">
            <div className="w-20 h-20 rounded-full bg-success/15 flex items-center justify-center text-3xl mb-3">
              ✓
            </div>
            <h2 className="text-text-primary text-base font-bold">通话结束</h2>
            <p className="text-text-tertiary text-xs mt-1">正在生成评估报告...</p>
          </div>
        )}
      </div>

      {/* 底部操作栏 */}
      <div className="pb-6 pt-3 px-6 shrink-0">
        {phase === 'connected' && (
          <div className="flex items-center justify-center gap-5">
            <button
              onClick={() => setIsMuted(!isMuted)}
              className={`w-12 h-12 rounded-full flex flex-col items-center justify-center transition-all ${
                isMuted ? 'bg-text-primary text-dark-bg' : 'bg-dark-card text-text-primary hover:bg-dark-elevated'
              }`}
            >
              <span className="text-sm">{isMuted ? '🔇' : '🎙'}</span>
              <span className="text-[9px] mt-0.5 text-text-tertiary">静音</span>
            </button>

            <button
              onClick={handleEndCall}
              className="w-14 h-14 rounded-full bg-coral flex items-center justify-center text-white text-xl shadow-lg shadow-coral/30 hover:bg-coral-hover transition-all active:scale-95"
            >
              📴
            </button>

            <button
              onClick={() => setIsSpeaker(!isSpeaker)}
              className={`w-12 h-12 rounded-full flex flex-col items-center justify-center transition-all ${
                isSpeaker ? 'bg-text-primary text-dark-bg' : 'bg-dark-card text-text-primary hover:bg-dark-elevated'
              }`}
            >
              <span className="text-sm">🔊</span>
              <span className="text-[9px] mt-0.5 text-text-tertiary">免提</span>
            </button>
          </div>
        )}

        {phase === 'connected' && (
          <div className="flex items-center justify-center gap-3 mt-3">
            <button
              onClick={() => setShowSubtitle(!showSubtitle)}
              className={`px-2.5 py-1 rounded-full text-xs transition-all ${
                showSubtitle ? 'bg-dark-elevated text-text-primary' : 'bg-dark-card text-text-tertiary'
              }`}
            >
              {showSubtitle ? '隐藏字幕' : '显示字幕'}
            </button>
            <button className="px-2.5 py-1 rounded-full bg-dark-card text-text-tertiary text-xs">
              暂停
            </button>
            <button className="px-2.5 py-1 rounded-full bg-dark-card text-text-tertiary text-xs">
              回放上段
            </button>
          </div>
        )}

        <style>{`
          @keyframes callWave {
            0% { height: 6px; }
            100% { height: 32px; }
          }
        `}</style>
      </div>
    </div>
  );
}
