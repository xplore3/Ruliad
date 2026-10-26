import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../api';
import StatusBar from '../components/StatusBar';
import { Avatar } from '../components/Avatar';
import { speakPersona, stopSpeaking, ttsSupported } from '../tts';
import { VoiceRecorder, blobToPcm16 } from '../voice/recorder';

const STYLES = ['理性', '直接', '温和'];
const CONCERNS = ['价格', '风险', '效率'];
const DIFFICULTIES = ['入门 · 轻松上手', '进阶 · 更深入地追问价值', '高压 · 极限压力测试'];

interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
}

/** 统一色板 */
const C = {
  bg: '#17191F',
  panel: '#22252D',
  panel2: '#2A2D36',
  text: '#F7F7FA',
  sub: '#A4A7B3',
  accent: '#E85C62',
  success: '#5DC7A3',
};

export default function RoleCustomize() {
  const { scenarioId } = useParams<{ scenarioId: string }>();
  const navigate = useNavigate();
  const [style, setStyle] = useState<string[]>(['理性']);
  const [concern, setConcern] = useState<string[]>(['价格']);
  const [difficulty, setDifficulty] = useState('进阶 · 更深入地追问价值');
  const [industryPref, setIndustryPref] = useState('');
  const [showMore, setShowMore] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  // 头像上传
  const [avatar, setAvatar] = useState<string>('');
  const [personaName, setPersonaName] = useState<string>('');
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarMsg, setAvatarMsg] = useState('');
  const avatarInputRef = useRef<HTMLInputElement>(null);

  // 对话式修改状态
  const [chatMode, setChatMode] = useState<'idle' | 'text' | 'voice'>('idle');
  const [chatHistory, setChatHistory] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [voiceOn] = useState(ttsSupported());
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<VoiceRecorder | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const toggle = (arr: string[], setArr: (v: string[]) => void, val: string) => {
    setArr(arr.includes(val) ? arr.filter((v) => v !== val) : [...arr, val]);
  };

  // ---- 加载已有画像信息 ----
  useEffect(() => {
    (async () => {
      try {
        const scenarioRes = await api.get<{ scenarios: { id: string; personaConfigId: string }[] }>('/scenarios');
        const scenario = scenarioRes.data.scenarios.find((s) => s.id === scenarioId);
        if (!scenario) return;
        const personaRes = await api.get<{ persona: { name: string; avatar?: string } }>(`/persona-configs/${scenario.personaConfigId}`);
        setPersonaName(personaRes.data.persona?.name || '陪练员');
        if (personaRes.data.persona?.avatar) setAvatar(personaRes.data.persona.avatar);
      } catch { /* ignore */ }
    })();
  }, [scenarioId]);

  // ---- 头像上传 ----
  const handleAvatarSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarUploading(true);
    setAvatarMsg('');
    try {
      const scenarioRes = await api.get<{ scenarios: { id: string; personaConfigId: string }[] }>('/scenarios');
      const scenario = scenarioRes.data.scenarios.find((s) => s.id === scenarioId);
      if (!scenario) { setAvatarUploading(false); return; }
      const formData = new FormData();
      formData.append('file', file);
      const res = await api.post<{ avatar: string; message: string }>(
        `/persona-configs/${scenario.personaConfigId}/avatar`,
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      );
      setAvatar(res.data.avatar);
      setAvatarMsg('头像已更新 ✓');
    } catch (err: any) {
      setAvatarMsg(err?.response?.data?.error ?? '头像上传失败');
    } finally {
      setAvatarUploading(false);
      if (avatarInputRef.current) avatarInputRef.current.value = '';
    }
  };

  // ---- 保存表单修改 ----
  const saveForm = async () => {
    if (saving) return;
    setSaving(true);
    setSaveMsg('');
    try {
      const scenarioRes = await api.get<{ scenarios: { id: string; personaConfigId: string }[] }>('/scenarios');
      const scenario = scenarioRes.data.scenarios.find((s) => s.id === scenarioId);
      if (!scenario) {
        setSaveMsg('未找到场景');
        setSaving(false);
        return;
      }
      await api.patch(`/persona-configs/${scenario.personaConfigId}/customize`, {
        style,
        concerns: concern,
        difficulty,
        industryPreference: industryPref || undefined,
      });
      setSaveMsg('画像已保存 ✓');
      setTimeout(() => navigate(-1), 800);
    } catch {
      setSaveMsg('保存失败，请重试');
      setSaving(false);
    }
  };

  // ---- AI 对话式修改 ----
  const sendChat = async (text: string) => {
    if (!text.trim() || chatLoading) return;
    setChatInput('');
    setChatLoading(true);
    const userMsg: ChatMsg = { role: 'user', content: text };
    const newHistory = [...chatHistory, userMsg];
    setChatHistory(newHistory);

    try {
      const scenarioRes = await api.get<{ scenarios: { id: string; personaConfigId: string }[] }>('/scenarios');
      const scenario = scenarioRes.data.scenarios.find((s) => s.id === scenarioId);
      if (!scenario) {
        setChatLoading(false);
        return;
      }
      const res = await api.post<{
        reply: string;
        changes: Record<string, unknown>;
        applied: boolean;
        persona: unknown;
      }>(`/persona-configs/${scenario.personaConfigId}/chat-customize`, {
        text,
        history: newHistory.slice(-10),
        apply: true,
      });
      const assistantMsg: ChatMsg = { role: 'assistant', content: res.data.reply };
      setChatHistory([...newHistory, assistantMsg]);
      if (voiceOn) speakPersona(res.data.reply);
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    } catch {
      const errorMsg: ChatMsg = { role: 'assistant', content: '抱歉，出错了，请重试。' };
      setChatHistory([...newHistory, errorMsg]);
    } finally {
      setChatLoading(false);
    }
  };

  // ---- 语音输入 ----
  const startVoiceRecord = async () => {
    if (recording || !VoiceRecorder.supported()) return;
    try {
      const recorder = new VoiceRecorder();
      recorderRef.current = recorder;
      await recorder.start();
      setRecording(true);
    } catch {
      window.alert('无法访问麦克风');
    }
  };

  const finishVoiceRecord = async () => {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    setRecording(false);
    if (!recorder) return;
    try {
      const blob = await recorder.stop();
      const pcm = await blobToPcm16(blob);
      await sendChatFromPcm(pcm);
    } catch {
      window.alert('语音识别失败，请改用文字输入');
    }
  };

  const sendChatFromPcm = async (pcm: ArrayBuffer) => {
    try {
      const scenarioRes = await api.get<{ scenarios: { id: string; personaConfigId: string; name: string }[] }>('/scenarios');
      const scenario = scenarioRes.data.scenarios.find((s) => s.id === scenarioId);
      if (!scenario) return;
      const sessionRes = await api.post<{ session: { id: string } }>('/sessions', { scenarioId, mode: 'practice' });
      const sessionId = sessionRes.data.session.id;
      const asrRes = await api.post<{ userText: string }>(`/sessions/${sessionId}/voice-turn`, pcm, {
        headers: { 'Content-Type': 'audio/pcm' },
      });
      await api.post(`/sessions/${sessionId}/end`).catch(() => {});
      if (asrRes.data.userText) {
        void sendChat(asrRes.data.userText);
      }
    } catch {
      window.alert('语音识别失败，请改用文字输入');
    }
  };

  return (
    <div className="relative mx-auto flex min-h-screen w-full max-w-md flex-col" style={{ backgroundColor: C.bg }}>
      <StatusBar dark />
      <div className="flex items-center px-4 py-2">
        <button onClick={() => navigate(-1)} className="flex h-9 w-9 items-center justify-center">
          <svg className="h-5 w-5" style={{ color: C.sub }} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
        </button>
      </div>

      <div className="px-5 pt-2">
        <h1 className="text-xl font-bold" style={{ color: C.text }}>自定义特征</h1>
        <p className="mt-1 text-sm" style={{ color: C.sub }}>少量选择，定义真实挑战</p>
      </div>

      {/* 头像上传区 */}
      <div className="mx-5 mt-4 flex items-center gap-4 rounded-2xl p-4" style={{ backgroundColor: C.panel }}>
        <div className="relative">
          <Avatar name={personaName} avatar={avatar || undefined} size="lg" rounded="full" />
          {avatarUploading && (
            <div className="absolute inset-0 flex items-center justify-center rounded-full" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
              <div className="h-5 w-5 animate-spin rounded-full border-2" style={{ borderColor: 'rgba(255,255,255,0.3)', borderTopColor: '#F7F7FA' }} />
            </div>
          )}
        </div>
        <div className="flex-1">
          <p className="text-sm font-bold" style={{ color: C.text }}>上传自定义头像</p>
          <p className="text-xs" style={{ color: C.sub }}>支持 JPG / PNG / WebP / GIF，最大 2MB</p>
          {avatarMsg && <p className="mt-1 text-xs" style={{ color: avatarMsg.includes('✓') ? C.success : C.accent }}>{avatarMsg}</p>}
        </div>
        <button
          className="flex h-10 w-10 items-center justify-center rounded-full transition active:scale-95"
          style={{ backgroundColor: C.accent, color: '#F7F7FA' }}
          onClick={() => avatarInputRef.current?.click()}
          disabled={avatarUploading}
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.06 4h3.88a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
        </button>
        <input ref={avatarInputRef} type="file" className="hidden" accept="image/jpeg,image/png,image/webp,image/gif" onChange={handleAvatarSelect} />
      </div>

      {/* 模式切换：表单 / AI对话 */}
      <div className="mx-5 mt-4 flex rounded-xl p-1" style={{ backgroundColor: C.panel }}>
        <button
          className="flex-1 rounded-lg py-2 text-sm font-medium transition"
          style={{
            backgroundColor: chatMode === 'idle' ? C.accent : 'transparent',
            color: chatMode === 'idle' ? '#F7F7FA' : C.sub,
          }}
          onClick={() => setChatMode('idle')}
        >
          表单编辑
        </button>
        <button
          className="flex-1 rounded-lg py-2 text-sm font-medium transition"
          style={{
            backgroundColor: chatMode !== 'idle' ? C.accent : 'transparent',
            color: chatMode !== 'idle' ? '#F7F7FA' : C.sub,
          }}
          onClick={() => setChatMode('text')}
        >
          AI 对话修改
        </button>
      </div>

      {/* ===== 表单模式 ===== */}
      {chatMode === 'idle' && (
        <>
          {/* 沟通风格 */}
          <div className="mx-5 mt-6">
            <p className="text-sm font-bold" style={{ color: C.text }}>沟通风格</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {STYLES.map((s) => {
                const active = style.includes(s);
                return (
                  <button
                    key={s}
                    className="rounded-full px-4 py-2 text-sm font-medium transition"
                    style={{
                      backgroundColor: active ? C.accent : C.panel,
                      color: active ? '#F7F7FA' : C.sub,
                    }}
                    onClick={() => toggle(style, setStyle, s)}
                  >{s}</button>
                );
              })}
            </div>
          </div>

          {/* 核心顾虑 */}
          <div className="mx-5 mt-6">
            <p className="text-sm font-bold" style={{ color: C.text }}>核心顾虑</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {CONCERNS.map((c) => {
                const active = concern.includes(c);
                return (
                  <button
                    key={c}
                    className="rounded-full px-4 py-2 text-sm font-medium transition"
                    style={{
                      backgroundColor: active ? C.accent : C.panel,
                      color: active ? '#F7F7FA' : C.sub,
                    }}
                    onClick={() => toggle(concern, setConcern, c)}
                  >{c}</button>
                );
              })}
            </div>
          </div>

          {/* 挑战强度 */}
          <div className="mx-5 mt-6">
            <p className="text-sm font-bold" style={{ color: C.text }}>挑战强度</p>
            <div className="mt-2 space-y-2">
              {DIFFICULTIES.map((d) => {
                const active = difficulty === d;
                return (
                  <button
                    key={d}
                    className="flex w-full items-center justify-between rounded-xl px-4 py-3 text-sm transition"
                    style={{
                      border: `2px solid ${active ? C.accent : 'transparent'}`,
                      backgroundColor: C.panel,
                    }}
                    onClick={() => setDifficulty(d)}
                  >
                    <span style={{ color: active ? C.text : C.sub, fontWeight: active ? 700 : 400 }}>{d}</span>
                    {active && <svg className="h-4 w-4" style={{ color: C.accent }} fill="currentColor" viewBox="0 0 24 24"><path d="M12 2a10 10 0 100 20 10 10 0 000-20z" /></svg>}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 更多特征 */}
          <button
            className="mx-5 mt-6 flex w-[calc(100%-2.5rem)] items-center justify-between rounded-xl px-4 py-3 text-sm"
            style={{ backgroundColor: C.panel, color: C.text }}
            onClick={() => setShowMore(!showMore)}
          >
            更多特征
            <svg className={`h-4 w-4 transition ${showMore ? 'rotate-180' : ''}`} style={{ color: C.sub }} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
          </button>

          {showMore && (
            <div className="mx-5 mt-2 space-y-2">
              <div className="rounded-xl p-4" style={{ backgroundColor: C.panel }}>
                <p className="text-sm" style={{ color: C.sub }}>行业偏好</p>
                <input
                  className="mt-1 w-full bg-transparent text-sm focus:outline-none"
                  style={{ color: C.text }}
                  placeholder="如：金融、电商、企业软件"
                  value={industryPref}
                  onChange={(e) => setIndustryPref(e.target.value)}
                />
              </div>
            </div>
          )}

          <div className="flex-1" />

          {/* 保存 */}
          <div className="p-5">
            {saveMsg && <p className="mb-2 text-center text-sm" style={{ color: saveMsg.includes('✓') ? C.success : C.accent }}>{saveMsg}</p>}
            <button
              className="mx-auto block min-h-13 w-full max-w-[260px] rounded-2xl text-base font-bold transition active:scale-[0.98] disabled:opacity-50"
              style={{ backgroundColor: C.accent, color: '#F7F7FA' }}
              onClick={saveForm}
              disabled={saving}
            >
              {saving ? '正在保存…' : '保存为画像 v3'}
            </button>
          </div>
        </>
      )}

      {/* ===== AI 对话式修改 ===== */}
      {chatMode !== 'idle' && (
        <div className="flex flex-1 flex-col">
          {/* 对话区 */}
          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4 no-scrollbar">
            {chatHistory.length === 0 && (
              <div className="rounded-xl p-4 text-sm" style={{ backgroundColor: C.panel, color: C.sub }}>
                告诉我你想怎么改陪练员画像。比如：
                <br />· "把沟通风格改成直接一点"
                <br />· "增加一个对安全性的顾虑"
                <br />· "把难度调到高压模式"
                <br />· "让他更关注效率而不是价格"
              </div>
            )}
            {chatHistory.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className="max-w-[80%] rounded-2xl px-4 py-3 text-[15px] leading-relaxed"
                  style={{
                    backgroundColor: msg.role === 'user' ? C.accent : C.panel,
                    color: msg.role === 'user' ? '#F7F7FA' : C.text,
                  }}
                >
                  {msg.content}
                </div>
              </div>
            ))}
            {chatLoading && (
              <div className="flex justify-start">
                <div className="rounded-2xl px-4 py-3" style={{ backgroundColor: C.panel }}>
                  <div className="h-4 w-4 animate-spin rounded-full border-2" style={{ borderColor: 'rgba(232,92,98,0.3)', borderTopColor: C.accent }} />
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* 输入区 */}
          <div className="border-t px-4 pb-4 pt-3" style={{ borderColor: 'rgba(255,255,255,0.06)', backgroundColor: C.bg }}>
            <div className="flex items-center gap-2">
              <input
                className="h-12 min-w-0 flex-1 rounded-full px-4 text-sm placeholder:opacity-60 focus:outline-none"
                style={{ backgroundColor: C.panel, color: C.text, border: `1px solid ${C.panel2}` }}
                placeholder="描述你想怎么改…"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void sendChat(chatInput); }}
              />
              {/* 语音按钮 */}
              <button
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full transition active:scale-95"
                style={{ backgroundColor: recording ? '#ff4444' : C.panel, color: recording ? '#fff' : C.text }}
                onPointerDown={startVoiceRecord}
                onPointerUp={finishVoiceRecord}
                onPointerLeave={finishVoiceRecord}
                onPointerCancel={finishVoiceRecord}
                onContextMenu={(e) => e.preventDefault()}
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-14 0m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V6a3 3 0 016 0v5a3 3 0 01-3 3z" />
                </svg>
              </button>
              {/* 发送按钮 */}
              <button
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full transition active:scale-95 disabled:opacity-50"
                style={{ backgroundColor: C.accent, color: '#F7F7FA' }}
                onClick={() => void sendChat(chatInput)}
                disabled={!chatInput.trim() || chatLoading}
              >
                <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24"><path d="M2 21l21-9L2 3v7l15 2-15 2v7z" /></svg>
              </button>
            </div>
            {recording && <p className="mt-2 text-center text-xs" style={{ color: C.accent }}>正在录音 · 松开发送</p>}
            <button
              className="mt-3 mx-auto block w-full max-w-[260px] rounded-xl py-2.5 text-sm font-medium"
              style={{ border: `1px solid ${C.panel2}`, color: C.text, backgroundColor: C.panel }}
              onClick={() => { stopSpeaking(); navigate(-1); }}
            >
              完成修改
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
