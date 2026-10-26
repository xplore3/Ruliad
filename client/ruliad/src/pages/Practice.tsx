import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { createSession } from '../api';
import type { SessionCreated, TranscriptTurn } from '../types';

type PracticeStatus = 'idle' | 'speaking' | 'user_turn' | 'thinking' | 'paused' | 'ended';
type PracticeMode = 'text' | 'voice';

interface Message {
  id: string;
  speaker: 'persona' | 'trainee' | 'coach';
  text: string;
  time?: string;
  isVoice?: boolean;
}

const MOCK_MESSAGES: Message[] = [
  { id: 'm1', speaker: 'persona', text: '你好，请问有什么事？我现在比较忙。', time: '0:03', isVoice: true },
  { id: 'm2', speaker: 'trainee', text: '王总您好，我是XX公司的小陈，专门做企业设备管理方案的。想占用您两分钟时间，请教一个问题。', time: '0:08', isVoice: true },
  { id: 'm3', speaker: 'persona', text: '两分钟，你说吧。不过先说，我们现在已经有供应商了。', time: '0:18', isVoice: true },
  { id: 'm4', speaker: 'coach', text: '💡 对方抛出「已有供应商」的经典异议。建议先认可现状，再挖痛点差异。', time: '0:20' },
  { id: 'm5', speaker: 'trainee', text: '理解，方便问下您目前用的这套，设备故障响应一般是多久？', time: '0:24', isVoice: true },
  { id: 'm6', speaker: 'persona', text: '响应？大概隔天吧，看他们排期怎么了？', time: '0:30', isVoice: true },
  { id: 'm7', speaker: 'persona', text: '前两个月有一次等了三天，产线停了小半天。', time: '0:35', isVoice: true },
];

export default function Practice() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [session, setSession] = useState<SessionCreated | null>(null);
  const [mode, setMode] = useState<PracticeMode>('voice');
  const [status, setStatus] = useState<PracticeStatus>('idle');
  const [messages, setMessages] = useState<Message[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [textInput, setTextInput] = useState('');
  const [coachTip, setCoachTip] = useState('');
  const [showModeSwitch, setShowModeSwitch] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (sessionId && sessionId !== 'new') {
      createSession('scenario-demo')
        .then(setSession)
        .catch(console.error);
    }
  }, [sessionId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (status === 'speaking' || status === 'user_turn') {
      timerRef.current = setInterval(() => {
        setElapsed((prev) => prev + 1);
      }, 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [status]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const handleStart = () => {
    setStatus('thinking');
    setMessages([]);
    setTimeout(() => {
      setStatus('speaking');
      setMessages([MOCK_MESSAGES[0]]);
      setTimeout(() => {
        setStatus('user_turn');
        setCoachTip('💡 对方时间紧迫，请快速说明来意，提问而非介绍产品');
      }, 2000);
    }, 1500);
  };

  const handlePause = () => setStatus('paused');

  const handleResume = () => setStatus('user_turn');

  const handleStop = () => {
    setStatus('ended');
    navigate(`/review/${sessionId || 'demo'}`);
  };

  const handleSendMessage = () => {
    if (!textInput.trim()) return;
    const newMsg: Message = {
      id: `usr-${Date.now()}`,
      speaker: 'trainee',
      text: textInput,
      time: formatTime(elapsed),
    };
    setMessages((prev) => [...prev, newMsg]);
    setTextInput('');
    setStatus('thinking');
    setCoachTip('');

    setTimeout(() => {
      const aiReply = MOCK_MESSAGES.find((m) => !messages.includes(m) && m.speaker === 'persona');
      if (aiReply) {
        setMessages((prev) => [...prev, { ...aiReply, id: `ai-${Date.now()}` }]);
        setStatus('user_turn');
      }
    }, 2000);
  };

  const toggleRecording = () => {
    if (mode === 'text') {
      setMode('voice');
      return;
    }

    if (isRecording) {
      setIsRecording(false);
      const voiceMsg: Message = {
        id: `voice-${Date.now()}`,
        speaker: 'trainee',
        text: '（语音消息已发送，正在处理中...）',
        time: formatTime(elapsed),
      };
      setMessages((prev) => [...prev, voiceMsg]);
      setStatus('thinking');
      setTimeout(() => {
        setMessages((prev) => [...prev, { id: 'ai-resp', speaker: 'persona', text: '嗯，这个说法有点意思。那你把响应时效写进合同里，敢不敢？', time: formatTime(elapsed), isVoice: true }]);
        setStatus('user_turn');
        setCoachTip('💡 「敢不敢写进合同」是推进成交的机会信号！');
      }, 2500);
    } else {
      setIsRecording(true);
      setStatus('user_turn');
    }
  };

  const handleBack = () => {
    if (status !== 'idle' && status !== 'ended') {
      if (!confirm('练习尚未结束，确定退出吗？')) return;
    }
    navigate('/home');
  };

  return (
    <div className="fixed inset-0 bg-dark-bg z-[100] flex flex-col">
      {/* 顶栏（紧凑） */}
      <header className="h-12 bg-dark-bg border-b border-white/6 flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-2">
          <button onClick={handleBack} className="w-8 h-8 rounded-full bg-dark-panel flex items-center justify-center text-text-secondary hover:bg-dark-elevated transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <span className="text-sm text-text-primary font-medium truncate">与 · 王建国 · 对练</span>
          <span className="px-2 py-0.5 bg-coral/15 text-coral text-xs rounded-full font-medium">电话销售</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 font-din text-sm font-semibold text-text-primary">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
            </svg>
            {formatTime(elapsed)}
          </div>
          <button
            onClick={() => setShowModeSwitch(!showModeSwitch)}
            className="text-xs text-text-secondary hover:text-text-primary transition-colors"
          >
            ⋮
          </button>
        </div>
      </header>

      {/* 模式切换菜单 */}
      {showModeSwitch && (
        <div className="absolute top-12 right-4 z-[101]">
          <div className="bg-dark-card rounded-2xl shadow-2xl border border-white/8 p-2 min-w-[180px]">
            <div className="px-3 py-2 text-xs text-text-tertiary font-medium">对练模式</div>
            <button
              onClick={() => { setMode('voice'); setShowModeSwitch(false); }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors ${mode === 'voice' ? 'bg-coral/10 text-coral' : 'text-text-primary hover:bg-dark-elevated'}`}
            >
              <span>🎙</span> 轮次语音
            </button>
            <button
              onClick={() => { setMode('text'); setShowModeSwitch(false); }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors ${mode === 'text' ? 'bg-coral/10 text-coral' : 'text-text-primary hover:bg-dark-elevated'}`}
            >
              <span>⌨️</span> 文字
            </button>
            <div className="border-t border-white/5 my-1" />
            <button
              onClick={() => { setShowModeSwitch(false); navigate('/call'); }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-text-primary hover:bg-dark-elevated transition-colors"
            >
              <span>📞</span> 切换到通话模式
            </button>
            <div className="border-t border-white/5 my-1" />
            <button
              onClick={() => setShowModeSwitch(false)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-text-secondary hover:bg-dark-elevated transition-colors"
            >
              ⚙️ 练习设置
            </button>
          </div>
        </div>
      )}

      {/* 主内容区 - 参与者横排（手机端优先） */}
      <div className="flex gap-3 px-4 pt-3 pb-2 overflow-x-auto border-b border-white/6 shrink-0">
        {/* AI 角色 */}
        <div className="flex gap-2.5 items-center bg-dark-panel rounded-2xl px-3 py-2.5 shrink-0">
          <div className="relative">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-coral/80 to-coral flex items-center justify-center text-white font-bold text-sm">
              王
            </div>
            {(status === 'speaking' || status === 'thinking') && (
              <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-success rounded-full border-2 border-dark-panel animate-pulse" />
            )}
          </div>
          <div>
            <div className="text-text-primary text-sm font-medium">王建国</div>
            <div className="text-text-tertiary text-xs">采购总监 · AI</div>
          </div>
        </div>
        {/* 练习者 */}
        <div className={`flex gap-2.5 items-center rounded-2xl px-3 py-2.5 shrink-0 border ${status === 'user_turn' ? 'border-success/40 bg-success/5' : 'border-white/6 bg-dark-panel'}`}>
          <div className="relative">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-cat-ground to-cat-ground/80 flex items-center justify-center text-white font-bold text-sm">
              我
            </div>
            {isRecording && (
              <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-coral rounded-full border-2 border-dark-panel animate-pulse" />
            )}
          </div>
          <div>
            <div className="text-text-primary text-sm font-medium">销售小陈</div>
            <div className="text-text-tertiary text-xs">你 · 销售方</div>
          </div>
        </div>
        {/* 教练 */}
        <div className="flex gap-2.5 items-center bg-dark-panel rounded-2xl px-3 py-2.5 shrink-0">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-cat-inquiry to-cat-inquiry/80 flex items-center justify-center text-white font-bold text-xs">
            AI
          </div>
          <div className="flex-1">
            <div className="text-text-primary text-sm font-medium">AI 教练</div>
            <div className="text-success text-xs">观察中</div>
          </div>
        </div>
      </div>

      {/* 对话区 */}
      <main className="flex-1 flex flex-col bg-dark-bg overflow-hidden">
        {/* 状态栏 */}
        <div className="px-4 py-2.5 flex items-center gap-2 border-b border-white/6 text-xs">
          {status === 'thinking' && (
            <div className="flex items-center gap-2 text-text-secondary">
              <span className="flex items-center gap-0.5">
                <span className="w-1.5 h-1.5 bg-coral rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 bg-coral rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 bg-coral rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </span>
              对方正在思考...
            </div>
          )}
          {status === 'speaking' && (
            <div className="flex items-center gap-2 text-coral">
              <span className="w-2 h-2 bg-coral rounded-full animate-pulse" />
              对方正在说话...
            </div>
          )}
          {status === 'user_turn' && (
            <div className="flex items-center gap-2 text-success">
              <span className="w-2 h-2 bg-success rounded-full animate-pulse" />
              🎙 轮到你说话了
            </div>
          )}
          {status === 'paused' && (
            <div className="flex items-center gap-2 text-text-tertiary">
              <span className="w-2 h-2 bg-warning rounded-full" />
              已暂停
            </div>
          )}
          {status === 'idle' && (
            <div className="text-text-secondary">点击下方「开始」按钮开启练习</div>
          )}
          {coachTip && status !== 'idle' && status !== 'ended' && (
            <button
              onClick={() => setCoachTip('')}
              className="ml-auto w-5 h-5 rounded-full bg-dark-elevated text-text-tertiary flex items-center justify-center text-xs hover:bg-dark-panel"
            >
              ×
            </button>
          )}
        </div>

        {/* 对话气泡 */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {messages.map((msg) => (
            <div key={msg.id} className={`flex gap-2.5 ${msg.speaker === 'trainee' ? 'flex-row-reverse' : ''}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-xs shrink-0 ${
                msg.speaker === 'persona' ? 'bg-gradient-to-br from-coral/70 to-coral' :
                msg.speaker === 'coach' ? 'bg-gradient-to-br from-cat-inquiry to-cat-inquiry/80' :
                'bg-gradient-to-br from-cat-ground to-cat-ground/80'
              }`}>
                {msg.speaker === 'persona' ? '王' : msg.speaker === 'coach' ? '教' : '我'}
              </div>
              <div className="max-w-[75%]">
                <div className={`rounded-2xl px-3.5 py-2.5 ${
                  msg.speaker === 'trainee'
                    ? 'bg-coral text-white rounded-br-md'
                    : msg.speaker === 'coach'
                      ? 'bg-cat-ground/8 text-text-primary border border-cat-ground/15 text-sm'
                      : 'bg-dark-card text-text-primary border border-white/8 rounded-bl-md'
                }`}>
                  {msg.isVoice && msg.speaker !== 'coach' && (
                    <div className={`text-[11px] mb-1 flex items-center gap-1 ${msg.speaker === 'trainee' ? 'text-white/70' : 'text-coral'}`}>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>
                      语音 · {msg.time}
                    </div>
                  )}
                  {msg.text}
                </div>
                {msg.speaker !== 'coach' && msg.time && !msg.isVoice && (
                  <div className={`text-[11px] text-text-tertiary mt-1 ${msg.speaker === 'trainee' ? 'text-right' : ''}`}>{msg.time}</div>
                )}
              </div>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>

        {/* Coach 提示浮动条 */}
        {coachTip && status !== 'idle' && status !== 'ended' && (
          <div className="mx-4 mb-2 px-3 py-2.5 bg-cat-ground/8 border border-cat-ground/15 rounded-xl text-xs text-text-primary flex items-start gap-2">
            <span className="shrink-0">💡</span>
            <span className="flex-1">{coachTip}</span>
          </div>
        )}

        {/* 底部操作栏 */}
        <div className="shrink-0 border-t border-white/6 px-4 py-3 pb-[calc(12px+env(safe-area-inset-bottom))]">
          {/* 控制按钮 */}
          <div className="flex items-center justify-center gap-3 mb-2">
            {(status === 'idle' || status === 'ended') && (
              <button
                onClick={handleStart}
                className="px-6 py-2.5 bg-coral text-white rounded-full text-sm font-medium hover:bg-coral-hover transition-colors shadow-md shadow-coral/25"
              >
                ▶ 开始练习
              </button>
            )}
            {(status === 'speaking' || status === 'user_turn' || status === 'thinking') && (
              <>
                <button onClick={handlePause} className="px-4 py-2 bg-dark-panel text-text-secondary rounded-full text-sm hover:bg-dark-elevated transition-colors">
                  ⏸ 暂停
                </button>
                <button
                  onClick={handleStop}
                  className="px-4 py-2 bg-coral/15 text-coral rounded-full text-sm font-medium hover:bg-coral/25 transition-colors"
                >
                  ⏹ 停止
                </button>
                <button className="px-4 py-2 bg-dark-panel text-text-secondary rounded-full text-sm hover:bg-dark-elevated transition-colors">
                  ↺ 回放
                </button>
              </>
            )}
            {status === 'paused' && (
              <>
                <button onClick={handleResume} className="px-6 py-2.5 bg-success text-white rounded-full text-sm font-medium hover:bg-success/90 transition-colors">
                  ▶ 继续
                </button>
                <button
                  onClick={handleStop}
                  className="px-4 py-2 bg-coral/15 text-coral rounded-full text-sm font-medium hover:bg-coral/25 transition-colors"
                >
                  ⏹ 结束练习
                </button>
              </>
            )}
          </div>

          {/* 语音/文本输入区 */}
          {(status === 'user_turn' || status === 'paused') && (
            <div className="flex items-center gap-2">
              {mode === 'voice' ? (
                <button
                  onClick={toggleRecording}
                  className={`w-12 h-12 rounded-full flex items-center justify-center text-xl transition-all shrink-0 ${
                    isRecording
                      ? 'bg-coral shadow-lg shadow-coral/40 scale-110 animate-pulse'
                      : 'bg-coral hover:bg-coral-hover shadow-md shadow-coral/25'
                  }`}
                >
                  {isRecording ? '⏹' : '🎙'}
                </button>
              ) : (
                <div className="flex-1 flex items-center gap-2">
                  <input
                    type="text"
                    value={textInput}
                    onChange={(e) => setTextInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                    placeholder="输入你的回复..."
                    className="flex-1 px-4 py-2.5 bg-dark-panel rounded-2xl text-sm text-text-primary placeholder:text-text-tertiary border border-white/8 focus:border-coral/40 focus:outline-none transition-all"
                    autoFocus
                  />
                  <button
                    onClick={handleSendMessage}
                    className="px-4 py-2.5 bg-coral text-white rounded-2xl text-sm font-medium hover:bg-coral-hover transition-colors"
                  >
                    发送
                  </button>
                </div>
              )}
              <button
                onClick={() => setMode(mode === 'voice' ? 'text' : 'voice')}
                className="w-9 h-9 bg-dark-panel text-text-secondary rounded-full flex items-center justify-center hover:bg-dark-elevated transition-colors shrink-0 text-sm"
                title={mode === 'voice' ? '切换文本' : '切换语音'}
              >
                {mode === 'voice' ? '⌨️' : '🎙'}
              </button>
            </div>
          )}

          {mode === 'voice' && (status === 'user_turn' || status === 'paused') && (
            <p className="text-center text-xs text-text-tertiary mt-2">
              {isRecording ? '正在录音... 点击按钮停止' : '点击麦克风开始说话'}
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
