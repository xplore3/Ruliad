﻿﻿﻿import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import StatusBar from '../components/StatusBar';

const MODES = ['语音对话', '语音通话', '文字对话'];
const VOICE_STYLES = ['自然 · 标准', '沉稳 · 慢速', '活泼 · 快速'];
const SCORING_METHODS = ['SPIN v1', '规则 v1'];
const REMINDERS = ['关闭', '每天 09:00', '每天 20:00'];

export default function MyConfig() {
  const navigate = useNavigate();
  const [defaultMode, setDefaultMode] = useState('语音对话');
  const [voiceStyle, setVoiceStyle] = useState('自然 · 标准');
  const [scoringMethod, setScoringMethod] = useState('SPIN v1');
  const [reminder, setReminder] = useState('关闭');
  const [micTestStatus, setMicTestStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const [picker, setPicker] = useState<{ title: string; options: string[]; value: string; onSelect: (v: string) => void } | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);

  const openPicker = (title: string, options: string[], value: string, onSelect: (v: string) => void) => {
    setPicker({ title, options, value, onSelect });
  };

  const testMic = async () => {
    if (micTestStatus === 'testing') return;
    setMicTestStatus('testing');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      // 检测 1.5 秒是否有音量
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      let hasSound = false;
      const start = Date.now();
      const check = () => {
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((s, v) => s + v, 0) / data.length;
        if (avg > 10) { hasSound = true; }
        if (Date.now() - start > 1500) {
          stream.getTracks().forEach((t) => t.stop());
          ctx.close();
          setMicTestStatus(hasSound ? 'ok' : 'fail');
          return;
        }
        requestAnimationFrame(check);
      };
      check();
    } catch {
      setMicTestStatus('fail');
    }
  };

  const micLabel = micTestStatus === 'testing' ? '检测中…' : micTestStatus === 'ok' ? '✓ 正常' : micTestStatus === 'fail' ? '✗ 不可用' : '点击检测';

  return (
    <div className="relative mx-auto flex min-h-screen w-full max-w-md flex-col" style={{ backgroundColor: '#17191F' }}>
      <StatusBar dark />
      <div className="flex items-center px-4 py-2">
        <button onClick={() => navigate(-1)} className="flex h-9 w-9 items-center justify-center">
          <svg className="h-5 w-5" style={{ color: '#A4A7B3' }} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
        </button>
      </div>

      <div className="px-5 pt-2">
        <h1 className="text-xl font-bold" style={{ color: '#F7F7FA' }}>我的配置</h1>
        <p className="mt-1 text-sm" style={{ color: '#A4A7B3' }}>把训练调成你的节奏</p>
      </div>

      <div className="mx-5 mt-6 space-y-2">
        <ConfigItem label="默认模式" value={defaultMode} onClick={() => openPicker('默认模式', MODES, defaultMode, setDefaultMode)} />
        <ConfigItem label="声音与语速" value={voiceStyle} onClick={() => openPicker('声音与语速', VOICE_STYLES, voiceStyle, setVoiceStyle)} />
        <ConfigItem label="麦克风测试" value={micLabel} onClick={testMic} />
        <ConfigItem label="评分方法" value={scoringMethod} onClick={() => openPicker('评分方法', SCORING_METHODS, scoringMethod, setScoringMethod)} />
        <ConfigItem label="训练提醒" value={reminder} onClick={() => openPicker('训练提醒', REMINDERS, reminder, setReminder)} />
        <ConfigItem label="隐私与数据" value="管理" onClick={() => window.alert('👑 隐私与数据 · VIP 专属功能\n\n该功能为 VIP 会员专属，升级 VIP 即可解锁。\n\n升级 VIP 请联系：graspai@126.com')} />
        <ConfigItem label="账户与协议" value="查看" onClick={() => window.alert('👑 账户与协议 · VIP 专属功能\n\n该功能为 VIP 会员专属，升级 VIP 即可解锁。\n\n升级 VIP 请联系：graspai@126.com')} />
      </div>

      <div className="flex-1" />
      <div className="h-6" />

      {/* 底部选择器 */}
      {picker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={() => setPicker(null)}>
          <div className="relative mx-auto w-[calc(100%-2.5rem)] max-w-md rounded-3xl p-5" style={{ backgroundColor: '#22252D' }} onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-bold" style={{ color: '#F7F7FA' }}>{picker.title}</h3>
              <button className="text-sm" style={{ color: '#A4A7B3' }} onClick={() => setPicker(null)}>关闭</button>
            </div>
            <div className="space-y-2">
              {picker.options.map((opt) => (
                <button
                  key={opt}
                  className="flex w-full items-center justify-between rounded-xl px-4 py-3 text-sm transition"
                  style={picker.value === opt ? { border: '2px solid #E85C62', backgroundColor: 'rgba(232,92,98,0.08)', color: '#F7F7FA', fontWeight: 700 } : { border: '1px solid rgba(255,255,255,0.06)', backgroundColor: 'rgba(255,255,255,0.03)', color: '#A4A7B3' }}
                  onClick={() => { picker.onSelect(opt); setPicker(null); }}
                >
                  {opt}
                  {picker.value === opt && <svg className="h-4 w-4" style={{ color: '#E85C62' }} fill="currentColor" viewBox="0 0 24 24"><path d="M12 2a10 10 0 100 20 10 10 0 000-20z" /></svg>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ConfigItem({ label, value, onClick }: { label: string; value: string; onClick: () => void }) {
  return (
    <button className="flex w-full items-center justify-between rounded-2xl px-4 py-3.5 transition active:scale-[0.98]" style={{ backgroundColor: '#22252D' }} onClick={onClick}>
      <span className="text-[15px] font-medium" style={{ color: '#F7F7FA' }}>{label}</span>
      <div className="flex items-center gap-1.5">
        <span className="text-sm" style={{ color: '#A4A7B3' }}>{value}</span>
        <svg className="h-4 w-4" style={{ color: '#A4A7B3', opacity: 0.5 }} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
      </div>
    </button>
  );
}
