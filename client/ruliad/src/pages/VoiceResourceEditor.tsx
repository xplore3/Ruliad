import { useEffect, useRef, useState } from 'react';
import {
  apiError,
  applyVoiceConfig,
  getStoredUser,
  previewVoiceConfigAudio,
  previewVoiceConfigText,
  voiceConfigAsrStreamUrl,
} from '../api';
import type { VoiceConfigContext, VoiceConfigOperationPreview, VoiceConfigPreview } from '../api';
import { AsrStreamClient, PcmRecorder, pcmToWav } from '../voice';

/** 资源类型仅用于展示，不再作为下拉框选项 */
const TARGET_LABELS: Record<string, string> = {
  scenario: '对练场景',
  persona: '陪练角色',
  'skill-point': '技能点',
  element: '角色要素',
  'product-kb': '产品知识库',
  'demo-faq': '示范问答',
  'demo-script': '示范剧本',
  'drill-script': '演练剧本',
  'score-item': '评分标准',
  'golden-case': '评分回归案例',
  'briefing-standard': '讲解标准',
  'realism-standard': '演练真实度标准',
  'scenario-guidance': '场景指引配置',
  'quiz-question': '测验题',
  'methodology-config': '方法论配置',
};

const KIND_LABELS: Record<string, string> = {
  'create-scenario': '新建场景',
  'update-scenario': '更新场景',
  'create-persona': '新建角色',
  'update-persona': '更新角色',
  'copy-persona': '复制角色后修改',
  'create-resource': '新建资源',
  'update-resource': '更新资源',
  'copy-resource': '复制资源后修改',
};

const SCOPE_STYLES: Record<string, { label: string; cls: string }> = {
  direct: { label: '直接修改', cls: 'chip green' },
  'copy-on-write': { label: '副本修改', cls: 'chip blue' },
  general: { label: '通用建议', cls: 'chip amber' },
};

const FIELD_LABELS: Record<string, string> = {
  name: '名称', category: '分类', description: '描述', methodology: '方法论', source: '来源',
  sceneType: '场景类型', flowType: '执行策略', status: '状态', difficulty: '难度', duration: '时长（分钟）',
  successCriteria: '及格分', goal: '我方目标', doNot: '禁止事项',
  roleName: '角色姓名', roleTitle: '角色职位', roleIndustry: '角色行业',
  personalities: '性格标签', decisionStyle: '决策风格', objections: '典型异议', hiddenInfo: '禁止透露',
  speechRate: '语速', challenge: '挑战强度', interruptLevel: '打断频率',
  scriptExecutionOrder: '执行顺序', scriptTopics: '话题', scriptCustomerQuestions: '客户问题', scriptAssessmentPoints: '主要考核点',
  participants: '参与者',
  // 测验题
  scenarioId: '所属场景', skillPointId: '所属技能点', productKBEntryId: '关联知识条目', type: '题型',
  prompt: '题干', options: '选项', correctAnswer: '正确答案', referencePoints: '参考要点',
  explanation: '解析', score: '分值', trigger: '触发条件', required: '必答',
  // 方法论配置
  skillWeights: '技能点权重', redlinePhrases: '红线话术', fillerWords: '口头禅', passScore: '及格分',
};

function fmtValue(key: string, value: unknown): string {
  if (value === undefined || value === null || value === '') return '（清空）';
  if (Array.isArray(value)) {
    return value.length
      ? value.map((item) => (typeof item === 'object' ? JSON.stringify(item) : String(item))).join('、')
      : '（清空）';
  }
  if (typeof value === 'object') return JSON.stringify(value);
  if (key === 'duration' && typeof value === 'number') return `${value} 分钟`;
  if (key === 'successCriteria' && typeof value === 'number') return `${value} 分`;
  return String(value);
}

/** 把 LLM 提炼的字段 + 绑定名称整理为可读行 */
function operationRows(op: VoiceConfigOperationPreview): Array<[string, string]> {
  const rows: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(op.fields)) {
    rows.push([FIELD_LABELS[key] ?? key, fmtValue(key, value)]);
  }
  for (const [key, value] of Object.entries(op.persona ?? {})) {
    if (key === 'name') continue;
    rows.push([`角色·${FIELD_LABELS[key] ?? key}`, fmtValue(key, value)]);
  }
  if (op.persona?.name) rows.unshift(['角色·姓名', String(op.persona.name)]);
  if (op.skillPointNames?.length) rows.push(['绑定技能点', op.skillPointNames.join('、')]);
  if (op.scoreItemNames?.length) rows.push(['绑定评分标准', op.scoreItemNames.join('、')]);
  if (op.drillScriptName) rows.push(['绑定演练剧本', op.drillScriptName]);
  for (const [key, value] of Object.entries(op.conversation ?? {})) {
    rows.push([FIELD_LABELS[key] ?? key, fmtValue(key, value)]);
  }
  return rows;
}

export interface VoiceEditorApplied {
  result?: Record<string, unknown>;
  command?: import('../types').VoiceEditCommand;
}

/**
 * 语音自动场景创建和配置（统一入口）
 * - 不再选择资源类型 / 操作对象：LLM 自动提炼，服务端自动定位
 * - 权限策略：admin 直接改；普通用户仅改自己的对象，共享资源自动复制副本，公共内容为通用建议
 * - 先预览（operations 列表），确认后才落库
 */
export default function VoiceResourceEditor({
  embedded = false,
  context,
  onApplied,
}: {
  embedded?: boolean;
  context?: VoiceConfigContext;
  onApplied?: (applied: VoiceEditorApplied) => void;
}) {
  const isAdmin = ['admin', 'platform'].includes(getStoredUser()?.role ?? '');
  const [input, setInput] = useState('');
  const [preview, setPreview] = useState<VoiceConfigPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [notice, setNotice] = useState('');
  const recorder = useRef<PcmRecorder | null>(null);
  const chunks = useRef<ArrayBuffer[]>([]);
  const timer = useRef<number | null>(null);
  /** 实时识别通道：边说边识别，partial 实时写回输入框 */
  const asrSocketRef = useRef<AsrStreamClient | null>(null);

  useEffect(() => () => {
    recorder.current?.stop();
    asrSocketRef.current?.close();
    if (timer.current) window.clearInterval(timer.current);
  }, []);

  /** 建立实时识别通道；连接失败返回 null，停止录音时回退整段上传批量识别 */
  const openAsrStream = async (): Promise<AsrStreamClient | null> => {
    const sock = new AsrStreamClient(voiceConfigAsrStreamUrl());
    try {
      await sock.connect();
      sock.onPartial = (text) => {
        if (text) setInput(text);
      };
      sock.onClose = () => {
        if (asrSocketRef.current === sock) asrSocketRef.current = null;
      };
      asrSocketRef.current = sock;
      return sock;
    } catch {
      asrSocketRef.current = null;
      return null;
    }
  };

  const previewText = async () => {
    if (!input.trim() || busy) return;
    setBusy(true);
    try {
      setPreview(await previewVoiceConfigText(input.trim(), context));
      setNotice('');
    } catch (e) {
      setNotice(apiError(e, '提取失败'));
    } finally {
      setBusy(false);
    }
  };

  const toggleRecording = async () => {
    if (recording) {
      recorder.current?.stop();
      recorder.current = null;
      setRecording(false);
      if (timer.current) window.clearInterval(timer.current);
      if (!chunks.current.length) return setNotice('没有录到声音');
      const sock = asrSocketRef.current;
      asrSocketRef.current = null;
      setBusy(true);
      try {
        // 优先取实时识别的最终文本；流式失败时回退整段上传批量识别
        let finalText = '';
        let usedStream = false;
        if (sock?.isOpen) {
          try {
            finalText = (await sock.finish()).trim();
            usedStream = true;
          } catch {
            usedStream = false;
          }
        }
        sock?.close();
        if (usedStream) {
          if (!finalText) return setNotice('未识别到有效语音');
          chunks.current = [];
          setInput(finalText);
          setPreview(await previewVoiceConfigText(finalText, context));
          setNotice('');
        } else {
          const result = await previewVoiceConfigAudio(pcmToWav(chunks.current), context);
          chunks.current = [];
          setInput(result.transcript ?? '');
          setPreview(result);
          setNotice('');
        }
      } catch (e) {
        setNotice(apiError(e, '语音识别失败'));
      } finally {
        setBusy(false);
      }
      return;
    }
    try {
      // 先建流式识别通道（失败不影响录音，停止时回退批量识别）
      await openAsrStream();
      const rec = new PcmRecorder();
      chunks.current = [];
      rec.onChunk = (chunk) => {
        chunks.current.push(chunk);
        asrSocketRef.current?.sendAudio(chunk);
      };
      await rec.start();
      recorder.current = rec;
      setSeconds(0);
      setRecording(true);
      timer.current = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    } catch (e) {
      asrSocketRef.current?.close();
      asrSocketRef.current = null;
      setNotice(e instanceof Error ? e.message : '无法访问麦克风');
    }
  };

  const apply = async () => {
    if (!preview || preview.scoreExplain || busy) return;
    setBusy(true);
    try {
      const saved = await applyVoiceConfig(preview.commandId, preview.expectedRevisions, context);
      if (saved.pendingReview) {
        setNotice('已提交到统一处理页面，共享资源和其他用户的数据未被修改');
      } else {
        setNotice('已保存，未覆盖其他用户在此期间产生的修改');
      }
      setPreview(null);
      onApplied?.(saved);
    } catch (e) {
      setNotice(apiError(e, '保存失败'));
    } finally {
      setBusy(false);
    }
  };

  const discard = () => {
    setPreview(null);
    setNotice('');
  };

  return (
    <div className={embedded ? undefined : 'card lib-card'} style={embedded ? undefined : { padding: 20 }}>
      {!embedded && (
        <div className="fs-head">
          <div>
            <h3>语音自动场景创建和配置</h3>
            <p className="hint">
              直接用自然语言描述要创建或修改的场景、场景配置或资源库对象：LLM 自动提炼内容，服务端自动定位对象，
              先预览差异、确认后才保存；版本冲突不会覆盖他人修改。也可以询问上一场对练的评分原因（如"上一场为什么某项得分低"）。
            </p>
          </div>
        </div>
      )}
      {!isAdmin && (
        <p className="hint">
          你可以直接创建场景、修改自己创建的场景和私有资源；共享资源会自动创建副本，公共内容会提交为通用建议。
        </p>
      )}
      <div className="field" style={{ marginTop: 16 }}>
        <label>创建 / 修改指令</label>
        <textarea
          className="input"
          rows={4}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="例如：新建一个电销场景「首次电话邀约」，客户是爱压价的采购经理，时长 12 分钟、及格分 80；也可以直接问：上一场为什么「激情度」得分低？"
          maxLength={2000}
        />
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn btn-primary" disabled={busy} onClick={() => void toggleRecording()}>
          {recording ? `停止并生成预览（${seconds}s）` : '语音输入'}
        </button>
        <button
          className="btn btn-ghost"
          disabled={busy || (!recording && !input.trim())}
          onClick={() => void previewText()}
        >
          根据文字生成预览
        </button>
      </div>
      {preview && (
        <div style={{ marginTop: 20 }}>
          <p className="hint" style={{ marginBottom: 8 }}>{preview.reply}</p>
          {preview.transcript && <p className="hint">识别原文：{preview.transcript}</p>}
          {preview.scoreExplain ? (
            <div className="card inner-card" style={{ padding: 14, marginTop: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span className="chip blue">评分解读</span>
                <strong>{preview.scoreExplain.scenarioName}</strong>
                <span className="hint">
                  {new Date(preview.scoreExplain.sessionAt).toLocaleString()} · 总分 {preview.scoreExplain.totalScore}
                  {preview.scoreExplain.passed ? '（通过）' : '（未通过）'}
                </span>
              </div>
              <p style={{ marginTop: 10, whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{preview.scoreExplain.answer}</p>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button className="btn btn-ghost" disabled={busy} onClick={discard}>
                  继续提问
                </button>
              </div>
            </div>
          ) : (
            <>
          {preview.general && (
            <p className="lib-warn">
              {`本次包含通用 / 共享内容${preview.operations.find((op) => op.generalReason)?.generalReason ? `：${preview.operations.find((op) => op.generalReason)?.generalReason}` : ''}，将进入统一处理页面，不直接修改业务数据。`}
            </p>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
            {preview.operations.map((op) => {
              const scope = SCOPE_STYLES[op.scope] ?? SCOPE_STYLES.direct;
              const rows = op.diagnosis ? [] : operationRows(op);
              return (
                <div key={op.index} className="card inner-card" style={{ padding: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span className="chip gray">{TARGET_LABELS[op.target] ?? op.target}</span>
                    <span className={`chip ${op.action === 'create' ? 'green' : 'blue'}`}>
                      {op.action === 'create' ? '新建' : '修改'}
                    </span>
                    <span className={scope.cls}>{scope.label}</span>
                    <strong>{op.subject || op.resourceName || KIND_LABELS[op.planKind]}</strong>
                    <span className="hint">{KIND_LABELS[op.planKind] ?? op.planKind}</span>
                  </div>
                  {op.scopeReason && op.scope !== 'direct' && (
                    <p className="hint" style={{ marginTop: 6 }}>{op.scopeReason}</p>
                  )}
                  {op.diagnosis && (
                    <div style={{ marginTop: 10 }}>
                      <p><strong>{op.diagnosis.summary}</strong></p>
                      <p className="hint" style={{ marginTop: 6 }}>
                        诊断对象：{op.diagnosis.session.scenarioName}
                        {op.diagnosis.session.endedAt ? `（${new Date(op.diagnosis.session.endedAt).toLocaleString()}）` : ''}
                        {' '}· {op.diagnosis.scoreItem.name} · 评分维度：{op.diagnosis.aspect}
                      </p>
                      <div style={{ marginTop: 8 }}>
                        <strong>原因判断</strong>
                        {op.diagnosis.reasons.map((reason) => <p key={reason} className="hint" style={{ marginTop: 4 }}>· {reason}</p>)}
                      </div>
                      <div style={{ marginTop: 8 }}>
                        <strong>检测证据</strong>
                        {op.diagnosis.evidence.map((item) => <p key={item} className="hint" style={{ marginTop: 4 }}>· {item}</p>)}
                      </div>
                      <div style={{ marginTop: 8 }}>
                        <strong>本次修改</strong>
                        {op.diagnosis.proposedChanges.map((change) => <p key={change} className="hint" style={{ marginTop: 4 }}>· {change}</p>)}
                      </div>
                    </div>
                  )}
                  {rows.length > 0 && (
                    <div className="weights" style={{ marginTop: 8 }}>
                      {rows.map(([label, value]) => (
                        <div key={label} className="witem">
                          <div className="wl"><span>{label}</span></div>
                          <div className="wd">{value}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {op.impact?.length > 0 && (
                    <p className="lib-warn">
                      影响 {op.impact.length} 个场景：{op.impact.map((item) => item.name).join('、')}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="btn btn-primary" disabled={busy} onClick={() => void apply()}>
              {preview.hasPrivate ? '确认应用' : '提交统一处理'}
            </button>
            <button className="btn btn-ghost" disabled={busy} onClick={discard}>
              丢弃预览
            </button>
          </div>
            </>
          )}
        </div>
      )}
      {notice && <p className="hint" style={{ marginTop: 16 }}>{notice}</p>}
    </div>
  );
}
