import { useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../api';
import StatusBar from '../components/StatusBar';
import { VoiceRecorder, blobToPcm16 } from '../voice/recorder';

/* ── 推演结果类型 ── */
interface Phase {
  name: string;
  customerReaction: string;
  keyObjection: string;
  suggestedStrategy: string;
  riskPoints: string[];
  successMetrics: string;
}
interface PredictedObjection {
  objection: string;
  frequency: string;
  suggestedResponse: string;
}
interface CriticalMoment {
  moment: string;
  whatToDo: string;
  whatToAvoid: string;
}
interface SandboxResult {
  summary?: string;
  phases?: Phase[];
  predictedObjections?: PredictedObjection[];
  criticalMoments?: CriticalMoment[];
  winProbability?: string;
  keyAdvice?: string[];
  redLineWarnings?: string[];
}

/** 提取到的沙盘参数 */
interface ExtractedParams {
  environment?: {
    setting?: string;
    timing?: string;
    competitors?: string;
    constraints?: string;
    marketTrend?: string;
  };
  customer?: {
    profile?: string;
    role?: string;
    budget?: string;
    needs?: string;
    concerns?: string;
    relationship?: string;
  };
  self?: {
    role?: string;
    resources?: string;
    goals?: string;
    strengths?: string;
    weaknesses?: string;
  };
}

type Phase2 = 'input' | 'confirm' | 'result';

/** 统一色板 */
const C = {
  bg: '#17191F',
  panel: '#22252D',
  panel2: '#2A2D36',
  text: '#F7F7FA',
  sub: '#A4A7B3',
  accent: '#E85C62',
  success: '#5DC7A3',
  border: 'rgba(255,255,255,0.06)',
};

export default function Sandbox() {
  const { scenarioId } = useParams<{ scenarioId: string }>();
  const navigate = useNavigate();

  const [phase, setPhase] = useState<Phase2>('input');
  const [inputText, setInputText] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [extracted, setExtracted] = useState<ExtractedParams | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<SandboxResult | null>(null);
  const [expandedPhase, setExpandedPhase] = useState<number | null>(null);

  // 语音录制
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<VoiceRecorder | null>(null);

  /* ── 从自然语言提取沙盘参数 ── */
  async function extractParams(text: string) {
    if (!text.trim() || extracting) return;
    setExtracting(true);
    setError('');
    try {
      const res = await api.post<{ extracted: ExtractedParams }>('/sandbox/extract', {
        scenarioId,
        text,
      });
      setExtracted(res.data.extracted ?? {});
      setPhase('confirm');
    } catch (e: any) {
      setError(e?.response?.data?.error ?? '信息提取失败，请重试');
    } finally {
      setExtracting(false);
    }
  }

  /* ── 语音输入：录音 → ASR → 提取 ── */
  const startRecord = async () => {
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

  const finishRecord = async () => {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    setRecording(false);
    if (!recorder) return;
    try {
      const blob = await recorder.stop();
      const pcm = await blobToPcm16(blob);
      await transcribeAndExtract(pcm);
    } catch {
      window.alert('语音识别失败，请改用文字输入');
    }
  };

  const transcribeAndExtract = async (pcm: ArrayBuffer) => {
    if (!scenarioId) return;
    setExtracting(true);
    setError('');
    try {
      const sessionRes = await api.post<{ session: { id: string } }>('/sessions', { scenarioId, mode: 'practice' });
      const sessionId = sessionRes.data.session.id;
      const asrRes = await api.post<{ userText: string }>(`/sessions/${sessionId}/voice-turn`, pcm, {
        headers: { 'Content-Type': 'audio/pcm' },
      });
      await api.post(`/sessions/${sessionId}/end`).catch(() => {});
      const text = asrRes.data.userText;
      if (!text) {
        setError('未识别到语音内容');
        setExtracting(false);
        return;
      }
      setInputText(text);
      await extractParams(text);
    } catch {
      setError('语音识别失败，请改用文字输入');
      setExtracting(false);
    }
  };

  /* ── 执行推演 ── */
  async function runSimulation() {
    if (!extracted) return;
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const res = await api.post('/sandbox/simulate', {
        scenarioId,
        environment: extracted.environment ?? {},
        customer: extracted.customer ?? {},
        self: extracted.self ?? {},
      });
      setResult(res.data.result as SandboxResult);
      setPhase('result');
      setExpandedPhase(0);
    } catch (e: any) {
      setError(e?.response?.data?.error ?? '推演失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  }

  /* ═══════════ 输入阶段 ═══════════ */
  if (phase === 'input') {
    return (
      <div className="relative mx-auto flex min-h-screen w-full max-w-md flex-col" style={{ backgroundColor: C.bg }}>
        <StatusBar dark />
        <div className="flex items-center px-4 py-2">
          <button onClick={() => navigate(-1)} className="flex h-9 w-9 items-center justify-center">
            <svg className="h-5 w-5" style={{ color: C.sub }} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
          </button>
        </div>

        <div className="px-5 pt-2">
          <h1 className="text-xl font-bold" style={{ color: C.text }}>推演沙盘</h1>
          <p className="mt-1 text-sm" style={{ color: C.sub }}>描述你的场景条件，AI 自动提取并推演</p>
        </div>

        {/* 示例提示 */}
        <div className="mx-5 mt-5 rounded-2xl p-4" style={{ backgroundColor: C.panel }}>
          <p className="text-xs font-bold" style={{ color: C.text }}>💡 试试这样说</p>
          <div className="mt-2 space-y-1.5 text-xs leading-relaxed" style={{ color: C.sub }}>
            <p>"我在三甲医院学术交流会上拜访一位55岁的学术型主任，月底预算紧张，竞品A正在打价格战。我的目标是争取客户同意安排POC测试。"</p>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {[
              '三甲医院，学术型主任55岁',
              '月底预算紧张，竞品打价格战',
              '目标是争取安排POC测试',
            ].map((ex) => (
              <button
                key={ex}
                className="rounded-full px-3 py-1.5 text-xs transition active:scale-95"
                style={{ backgroundColor: C.panel2, color: C.text }}
                onClick={() => setInputText((prev) => (prev ? prev + ' ' + ex : ex))}
              >
                + {ex}
              </button>
            ))}
          </div>
        </div>

        {/* 文本输入区 */}
        <div className="mx-5 mt-4 flex-1">
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="描述环境因素、客户信息和你的自身条件，越详细推演越准确…"
            rows={6}
            className="w-full resize-none rounded-2xl px-4 py-3 text-sm leading-relaxed focus:outline-none"
            style={{ backgroundColor: C.panel, color: C.text, border: `1px solid ${C.panel2}` }}
          />
          {error && <p className="mt-2 text-center text-xs" style={{ color: C.accent }}>{error}</p>}
        </div>

        {/* 操作按钮 */}
        <div className="px-5 pb-6 pt-3">
          <div className="flex items-center gap-3">
            {/* 语音按钮 */}
            <button
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full transition active:scale-95"
              style={{
                backgroundColor: recording ? '#ff4444' : C.panel,
                color: recording ? '#fff' : C.text,
              }}
              onPointerDown={startRecord}
              onPointerUp={finishRecord}
              onPointerLeave={finishRecord}
              onPointerCancel={finishRecord}
              onContextMenu={(e) => e.preventDefault()}
            >
              <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-14 0m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V6a3 3 0 016 0v5a3 3 0 01-3 3z" />
              </svg>
            </button>
            {/* 提取按钮 */}
            <button
              onClick={() => extractParams(inputText)}
              disabled={extracting || !inputText.trim()}
              className="flex flex-1 items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-bold transition active:scale-[0.98] disabled:opacity-50"
              style={{ backgroundColor: C.accent, color: '#F7F7FA' }}
            >
              {extracting ? (
                <>
                  <svg className="h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                  正在提取…
                </>
              ) : (
                <>🤖 AI 提取并推演</>
              )}
            </button>
          </div>
          {recording && <p className="mt-2 text-center text-xs" style={{ color: C.accent }}>正在录音 · 松开后识别</p>}
        </div>
      </div>
    );
  }

  /* ═══════════ 确认阶段 ═══════════ */
  if (phase === 'confirm') {
    return (
      <div className="relative mx-auto flex min-h-screen w-full max-w-md flex-col" style={{ backgroundColor: C.bg }}>
        <StatusBar dark />
        <div className="flex items-center px-4 py-2">
          <button onClick={() => setPhase('input')} className="flex h-9 w-9 items-center justify-center">
            <svg className="h-5 w-5" style={{ color: C.sub }} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
          </button>
        </div>

        <div className="px-5 pt-2">
          <h1 className="text-xl font-bold" style={{ color: C.text }}>提取结果确认</h1>
          <p className="mt-1 text-sm" style={{ color: C.sub }}>AI 已提取以下信息，确认无误后开始推演</p>
        </div>

        <div className="mx-5 mt-5 flex-1 space-y-3">
          <ConfirmSection title="🌍 环境因素" data={extracted?.environment} fields={[
            { key: 'setting', label: '场景地点' },
            { key: 'timing', label: '时间节点' },
            { key: 'competitors', label: '竞品动态' },
            { key: 'constraints', label: '外部约束' },
            { key: 'marketTrend', label: '市场趋势' },
          ]} />

          <ConfirmSection title="👤 客户信息" data={extracted?.customer} fields={[
            { key: 'profile', label: '客户画像' },
            { key: 'role', label: '决策角色' },
            { key: 'budget', label: '预算情况' },
            { key: 'needs', label: '核心需求' },
            { key: 'concerns', label: '潜在顾虑' },
            { key: 'relationship', label: '与我的关系' },
          ]} />

          <ConfirmSection title="📋 自身信息" data={extracted?.self} fields={[
            { key: 'role', label: '我的角色' },
            { key: 'resources', label: '可用资源' },
            { key: 'goals', label: '本次目标' },
            { key: 'strengths', label: '自身优势' },
            { key: 'weaknesses', label: '自身短板' },
          ]} />
        </div>

        {error && <p className="px-5 text-center text-xs" style={{ color: C.accent }}>{error}</p>}

        {/* 操作按钮 */}
        <div className="px-5 pb-6 pt-3">
          <div className="flex gap-3">
            <button
              onClick={() => setPhase('input')}
              className="flex w-28 items-center justify-center rounded-2xl py-3.5 text-sm font-bold transition active:scale-[0.98]"
              style={{ border: `1px solid ${C.panel2}`, color: C.text, backgroundColor: C.panel }}
            >
              重新输入
            </button>
            <button
              onClick={runSimulation}
              disabled={loading}
              className="flex flex-1 items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-bold transition active:scale-[0.98] disabled:opacity-50"
              style={{ backgroundColor: C.accent, color: '#F7F7FA' }}
            >
              {loading ? (
                <>
                  <svg className="h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                  推演中…
                </>
              ) : (
                <>🎲 开始推演</>
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ═══════════ 结果阶段 ═══════════ */
  return (
    <div className="relative mx-auto flex min-h-screen w-full max-w-md flex-col" style={{ backgroundColor: C.bg }}>
      <StatusBar dark />
      <div className="flex items-center px-4 py-2">
        <button onClick={() => setPhase('confirm')} className="flex h-9 w-9 items-center justify-center">
          <svg className="h-5 w-5" style={{ color: C.sub }} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
        </button>
      </div>

      <div className="px-5 pt-2">
        <h1 className="text-xl font-bold" style={{ color: C.text }}>推演结果</h1>
        <p className="mt-1 text-sm" style={{ color: C.sub }}>基于当前条件模拟的对练全流程</p>
      </div>

      {/* 概述 + 成功率 */}
      {result?.summary && (
        <div className="mx-5 mt-5 rounded-2xl p-4" style={{ backgroundColor: C.panel }}>
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <p className="text-xs" style={{ color: C.sub }}>推演概述</p>
              <p className="mt-1.5 text-sm font-medium leading-relaxed" style={{ color: C.text }}>{result.summary}</p>
            </div>
            {result.winProbability && (
              <span
                className="ml-3 shrink-0 rounded-full px-3 py-1 text-xs font-bold"
                style={{
                  backgroundColor: result.winProbability === '低' ? 'rgba(232,92,98,0.15)' : result.winProbability === '高' ? 'rgba(93,199,163,0.15)' : C.panel2,
                  color: result.winProbability === '低' ? C.accent : result.winProbability === '高' ? C.success : C.text,
                }}
              >
                成功率 {result.winProbability}
              </span>
            )}
          </div>
        </div>
      )}

      {/* 推演阶段 */}
      {result?.phases && result.phases.length > 0 && (
        <div className="mx-5 mt-5">
          <h2 className="text-base font-bold" style={{ color: C.text }}>推演阶段</h2>
          <div className="mt-3 space-y-2">
            {result.phases.map((p, i) => (
              <div key={i} className="overflow-hidden rounded-xl" style={{ backgroundColor: C.panel }}>
                <button
                  onClick={() => setExpandedPhase(expandedPhase === i ? null : i)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left"
                >
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold"
                    style={{ backgroundColor: C.accent, color: '#F7F7FA' }}
                  >
                    {i + 1}
                  </span>
                  <span className="flex-1 text-sm font-bold" style={{ color: C.text }}>{p.name}</span>
                  <svg className={`h-5 w-5 transition-transform ${expandedPhase === i ? 'rotate-180' : ''}`} style={{ color: C.sub }} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                </button>
                {expandedPhase === i && (
                  <div className="space-y-3 border-t px-4 py-3" style={{ borderColor: C.border }}>
                    <ResultRow label="客户反应" value={p.customerReaction} />
                    <ResultRow label="核心异议" value={p.keyObjection} highlight="orange" />
                    <ResultRow label="建议策略" value={p.suggestedStrategy} highlight="blue" />
                    {p.riskPoints && p.riskPoints.length > 0 && (
                      <div>
                        <p className="text-xs font-bold" style={{ color: C.accent }}>风险点</p>
                        <div className="mt-1 space-y-1">
                          {p.riskPoints.map((r, j) => (
                            <div key={j} className="flex items-start gap-1.5">
                              <span className="mt-0.5 text-xs" style={{ color: C.accent }}>⚠</span>
                              <span className="flex-1 text-xs leading-relaxed" style={{ color: C.sub }}>{r}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {p.successMetrics && (
                      <ResultRow label="成功标志" value={p.successMetrics} highlight="green" />
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 预测异议 */}
      {result?.predictedObjections && result.predictedObjections.length > 0 && (
        <div className="mx-5 mt-5">
          <h2 className="text-base font-bold" style={{ color: C.text }}>预测异议库</h2>
          <div className="mt-3 space-y-2">
            {result.predictedObjections.map((o, i) => (
              <div key={i} className="rounded-xl p-4" style={{ backgroundColor: C.panel }}>
                <div className="flex items-start justify-between">
                  <p className="flex-1 text-sm font-bold" style={{ color: C.text }}>{o.objection}</p>
                  <span
                    className="ml-2 shrink-0 rounded-full px-2 py-0.5 text-xs font-bold"
                    style={{
                      backgroundColor: o.frequency === '高频' ? 'rgba(232,92,98,0.15)' : C.panel2,
                      color: o.frequency === '高频' ? C.accent : C.sub,
                    }}
                  >{o.frequency}</span>
                </div>
                <p className="mt-2 text-xs leading-relaxed" style={{ color: C.sub }}>
                  <span className="font-bold" style={{ color: C.text }}>建议回应：</span>{o.suggestedResponse}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 关键时刻 */}
      {result?.criticalMoments && result.criticalMoments.length > 0 && (
        <div className="mx-5 mt-5">
          <h2 className="text-base font-bold" style={{ color: C.text }}>关键时刻</h2>
          <div className="mt-3 space-y-2">
            {result.criticalMoments.map((c, i) => (
              <div key={i} className="rounded-xl p-4" style={{ backgroundColor: C.panel, borderLeft: `4px solid ${C.accent}` }}>
                <p className="text-sm font-bold" style={{ color: C.text }}>⚡ {c.moment}</p>
                <div className="mt-2 space-y-1.5">
                  <p className="text-xs" style={{ color: C.sub }}><span className="font-bold" style={{ color: C.success }}>✅ 做：</span>{c.whatToDo}</p>
                  <p className="text-xs" style={{ color: C.sub }}><span className="font-bold" style={{ color: C.accent }}>❌ 避：</span>{c.whatToAvoid}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 核心建议 */}
      {result?.keyAdvice && result.keyAdvice.length > 0 && (
        <div className="mx-5 mt-5 rounded-2xl p-4" style={{ backgroundColor: 'rgba(93,199,163,0.08)' }}>
          <h2 className="text-sm font-bold" style={{ color: C.success }}>💡 核心建议</h2>
          <ul className="mt-2 space-y-1.5">
            {result.keyAdvice.map((a, i) => (
              <li key={i} className="text-xs leading-relaxed" style={{ color: C.text }}>
                <span className="font-bold" style={{ color: C.success }}>{i + 1}.</span> {a}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 红线警示 */}
      {result?.redLineWarnings && result.redLineWarnings.length > 0 && (
        <div className="mx-5 mt-3 rounded-2xl p-4" style={{ backgroundColor: 'rgba(232,92,98,0.08)' }}>
          <h2 className="text-sm font-bold" style={{ color: C.accent }}>🚫 红线警示</h2>
          <ul className="mt-2 space-y-1.5">
            {result.redLineWarnings.map((w, i) => (
              <li key={i} className="text-xs leading-relaxed" style={{ color: C.text }}>
                <span className="font-bold" style={{ color: C.accent }}>!</span> {w}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 底部操作 */}
      <div className="px-5 pb-6 pt-4">
        <button
          onClick={() => setPhase('input')}
          className="mx-auto flex w-full max-w-[300px] items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-bold transition active:scale-[0.98]"
          style={{ backgroundColor: C.accent, color: '#F7F7FA' }}
        >
          🔧 重新推演
        </button>
      </div>
    </div>
  );
}

/* ────── 确认区域组件 ────── */
function ConfirmSection({
  title,
  data,
  fields,
}: {
  title: string;
  data: Record<string, string> | undefined;
  fields: { key: string; label: string }[];
}) {
  const items = fields.filter((f) => data?.[f.key]?.trim());
  if (items.length === 0) return null;
  return (
    <div className="rounded-2xl p-4" style={{ backgroundColor: C.panel }}>
      <h2 className="text-sm font-bold" style={{ color: C.text }}>{title}</h2>
      <div className="mt-3 space-y-2">
        {items.map((f) => (
          <div key={f.key} className="flex items-start gap-2">
            <span className="shrink-0 text-xs" style={{ color: C.sub }}>{f.label}</span>
            <span className="flex-1 text-xs leading-relaxed" style={{ color: C.text }}>{data![f.key]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ResultRow({ label, value, highlight }: { label: string; value: string; highlight?: 'orange' | 'blue' | 'green' }) {
  if (!value) return null;
  const bgMap: Record<string, string> = {
    orange: 'rgba(232,92,98,0.08)',
    blue: 'rgba(164,167,179,0.08)',
    green: 'rgba(93,199,163,0.08)',
  };
  return (
    <div className="rounded-lg px-3 py-2" style={{ backgroundColor: highlight ? bgMap[highlight] : 'transparent' }}>
      <p className="text-xs font-bold" style={{ color: C.sub }}>{label}</p>
      <p className="mt-0.5 text-xs leading-relaxed" style={{ color: C.text }}>{value}</p>
    </div>
  );
}
