import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PcmRecorder } from '../voice';
import {
  answerInstitutionQuestions,
  apiError,
  completeInstitutionOnboarding,
  fetchCurrentUser,
  fetchInstitutionOnboardingStatus,
  reviseInstitutionQa,
  type InstitutionQaItem,
} from '../api';

const QUESTIONS = [
  '机构的科目内容',
  '适龄年龄',
  '收费标准，有没有试听当天报名的优惠政策？有没有其他的优惠政策？具体力度是什么？',
  '机构是否有内部教材和课程体系？',
  '科目多久考级一次？孩子学多久可以考级？',
  '对于新报名的学生，一周上几次课？一次多长时间？跟年龄有关系吗？',
  '机构的地址在哪里？',
  '这个科目每天练习的时间需要多久？是否需要家长陪同练？',
  '培训机构最大的特色或优势是什么？',
  '报名以后排班流程是什么？',
  '上课的简单流程是什么？',
  '根据年龄如何分班？',
  '男孩学的多还是女孩学的多？分别有什么优势？',
  '介绍师资力量，尤其是入门班的师资。',
  '附近都有什么同行？比起他们，我们的优势是什么？',
  '缺课怎么补课？',
  '招聘老师的标准是什么？',
  '试听课老师和上课老师是否是一样的？',
  '寒暑假的集训课程如何设置？',
  '退费政策如何？',
] as const;

const INTRO_TEXT = '为了更好地帮助销售们提高技能，现在需要了解机构的销售专业知识。';

type Phase = 'intro' | 'answering' | 'summary' | 'complete';

export default function InstitutionOnboarding() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>('intro');
  const [qa, setQa] = useState<InstitutionQaItem[]>([]);
  const [recording, setRecording] = useState(false);
  const [hasRecording, setHasRecording] = useState(false);
  const [starting, setStarting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [loadingExisting, setLoadingExisting] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const recorderRef = useRef<PcmRecorder | null>(null);
  const chunksRef = useRef<ArrayBuffer[]>([]);
  const finishingRef = useRef(false);

  useEffect(() => () => recorderRef.current?.stop(), []);

  useEffect(() => {
    let active = true;
    void fetchInstitutionOnboardingStatus()
      .then((status) => {
        if (active && status.completed && status.qa.length === QUESTIONS.length) {
          setQa(status.qa);
          setPhase('summary');
          setNotice('已加载当前初始化信息，可直接修改补充后重新正式提交。');
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoadingExisting(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const mergeChunks = () => {
    const chunks = chunksRef.current;
    const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(new Uint8Array(chunk), offset);
      offset += chunk.byteLength;
    }
    return merged.buffer;
  };

  const startRecording = async (revise = false) => {
    if (recording || starting || busy || finalizing || loadingExisting) return;
    setStarting(true);
    setError('');
    setNotice('');
    setHasRecording(false);
    chunksRef.current = [];
    finishingRef.current = false;
    let recorder: PcmRecorder | null = null;
    try {
      await fetchCurrentUser();
      recorder = new PcmRecorder();
      recorder.onChunk = (chunk) => chunksRef.current.push(chunk);
      recorderRef.current = recorder;
      await recorder.start();
      setPhase(revise ? 'summary' : 'answering');
      setRecording(true);
    } catch (err) {
      recorder?.stop();
      recorderRef.current = null;
      setError(apiError(err, '无法使用麦克风，请检查授权'));
    } finally {
      setStarting(false);
    }
  };

  const submitRecording = async (revise: boolean) => {
    if (finishingRef.current || chunksRef.current.length === 0) return;
    finishingRef.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    const audio = mergeChunks();
    try {
      await fetchCurrentUser();
      if (revise) {
        const result = await reviseInstitutionQa(qa, audio);
        setQa(result.qa);
        setNotice(result.action === 'done'
          ? '问答内容已确认，请点击“完成所有修改，正式提交”。'
          : result.rationale || '已按您的意见修改，请继续核对。');
      } else {
        const result = await answerInstitutionQuestions(audio);
        setQa(result.qa);
        setPhase('summary');
        setNotice('20 个回答已整理完成，请逐条核对。');
      }
      setHasRecording(false);
    } catch (err) {
      setHasRecording(true);
      setError(apiError(err, '处理失败，请检查网络后使用原录音重试'));
    } finally {
      setBusy(false);
      finishingRef.current = false;
    }
  };

  const finalizeQa = async () => {
    if (finalizing || busy || recording || starting) return;
    const normalized = qa.map((item) => ({ ...item, answer: item.answer.trim() }));
    if (normalized.length !== QUESTIONS.length) {
      setError('问答数量不完整，请重新整理后再提交');
      return;
    }
    if (normalized.some((item) => !item.answer)) {
      setError('还有答案为空，请补充后再正式提交');
      return;
    }
    setFinalizing(true);
    setError('');
    setNotice('');
    try {
      await completeInstitutionOnboarding(normalized);
      setQa(normalized);
      setPhase('complete');
    } catch (err) {
      setError(apiError(err, '正式提交失败，请重试，修改内容仍保留在当前页面'));
    } finally {
      setFinalizing(false);
    }
  };

  const finishRecording = (revise: boolean) => {
    if (finishingRef.current || !recording) return;
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
    const hasAudio = chunksRef.current.some((chunk) => chunk.byteLength > 0);
    setHasRecording(hasAudio);
    if (!hasAudio) {
      setError('没有录到声音，请重新录制');
      return;
    }
    void submitRecording(revise);
  };

  const recordingControls = (revise: boolean) => {
    const buttonText = starting
      ? '正在检查登录并打开麦克风…'
      : busy
        ? revise ? '正在提交修改意见…' : '正在整理 20 个问答…'
        : recording
          ? revise ? '结束语音并提交' : '已经回答20个问题'
          : hasRecording
            ? revise ? '重新提交这段语音' : '使用原录音重试'
            : revise ? '用语音修改' : '重新开始语音回答';
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, marginTop: 20 }}>
        <button
          className="btn btn-primary"
          style={{ minWidth: 230, minHeight: 48, fontSize: 16 }}
          disabled={starting || busy || finalizing}
          onClick={() => {
            if (recording) finishRecording(revise);
            else if (hasRecording) void submitRecording(revise);
            else void startRecording(revise);
          }}
        >
          {buttonText}
        </button>
        {hasRecording && !busy && !recording && !finalizing && (
          <button className="btn btn-ghost btn-sm" disabled={starting} onClick={() => void startRecording(revise)}>
            重新录制
          </button>
        )}
        <span className="small muted">
          {recording
            ? '录音由您手动结束，不会因停顿而自动提交'
            : hasRecording
              ? '刚才的录音仍保留，可直接重试，无需重新回答'
              : '点击按钮后允许使用麦克风'}
        </span>
      </div>
    );
  };

  return (
    <main style={{ maxWidth: 980, margin: '0 auto', padding: '30px 20px' }}>
      <section className="card" style={{ padding: 28 }}>
        <div className="small muted" style={{ marginBottom: 10 }}>机构资料初始化</div>
        <h1 style={{ fontSize: 26, marginBottom: 12 }}>了解您所在培训机构的销售专业知识</h1>
        <p style={{ lineHeight: 1.8, color: '#4B5563' }}>{INTRO_TEXT}</p>

        {(phase === 'intro' || phase === 'answering') && (
          <>
            <div style={{ marginTop: 22, padding: '18px 20px', borderRadius: 14, background: '#FFF7F5', border: '1px solid #FED7D2' }}>
              <strong style={{ display: 'block', marginBottom: 6 }}>请对照下面 20 个问题，用一段语音依次整体回答</strong>
              <span className="small" style={{ color: '#6B7280', lineHeight: 1.7 }}>
                无需逐题点击，也不用等待 AI 朗读。全部回答完后，点击“已经回答20个问题”。
              </span>
            </div>

            {phase === 'answering' && (
              <div
                role="status"
                aria-live="polite"
                style={{
                  marginTop: 18,
                  padding: '18px 20px',
                  borderRadius: 14,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  color: recording ? '#9A3412' : '#4B5563',
                  background: recording ? '#FFF1ED' : '#F5F7FA',
                  border: `1px solid ${recording ? '#FDA4AF' : '#E5E7EB'}`,
                }}
              >
                {recording && <span className="pulse-dot" aria-hidden="true" />}
                <div>
                  <strong style={{ display: 'block', fontSize: 18 }}>
                    {busy ? '正在识别并整理您的回答' : recording ? '现在轮到您说，正在录音' : starting ? '正在准备录音' : '本次录音已结束'}
                  </strong>
                  <span className="small">请按照页面顺序，把 20 个问题的答案完整说出来。</span>
                </div>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(330px, 1fr))', gap: 12, marginTop: 20 }}>
              {QUESTIONS.map((question, index) => (
                <article
                  key={question}
                  style={{ display: 'flex', gap: 12, padding: '15px 16px', borderRadius: 12, border: '1px solid #E5E7EB', background: '#FFFFFF' }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: 28,
                      height: 28,
                      flex: '0 0 28px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: '50%',
                      color: '#C2410C',
                      background: '#FFF1ED',
                      fontSize: 13,
                      fontWeight: 700,
                    }}
                  >
                    {index + 1}
                  </span>
                  <div style={{ color: '#374151', lineHeight: 1.65 }}>{question}</div>
                </article>
              ))}
            </div>

            {phase === 'intro' ? (
              <div style={{ display: 'flex', justifyContent: 'center', marginTop: 24 }}>
                <button
                  className="btn btn-primary"
                  style={{ minWidth: 220, minHeight: 48, fontSize: 16 }}
                  disabled={starting || loadingExisting}
                  onClick={() => void startRecording(false)}
                >
                  {loadingExisting ? '正在检查初始化信息…' : starting ? '正在打开麦克风…' : '现在开始语音'}
                </button>
              </div>
            ) : recordingControls(false)}
          </>
        )}

        {phase === 'summary' && (
          <div style={{ marginTop: 24 }}>
            <h2 style={{ fontSize: 22 }}>机构问答库</h2>
            <p className="muted" style={{ marginTop: 8, lineHeight: 1.7 }}>
              请核对这份完整的一问一答资料，可以直接修改补充答案，也可以用语音修改。所有修改完成后，必须点击页面底部的最终提交按钮。
            </p>
            {recording && (
              <div
                role="status"
                aria-live="polite"
                style={{ marginTop: 16, padding: '16px 18px', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 14, color: '#9A3412', background: '#FFF1ED', border: '1px solid #FDA4AF' }}
              >
                <span className="pulse-dot" aria-hidden="true" />
                <strong>现在轮到您说，请说出修改意见；如果没有修改，也可以告诉我“没有修改”</strong>
              </div>
            )}
            <div style={{ display: 'grid', gap: 12, marginTop: 18 }}>
              {qa.map((item, index) => (
                <article key={`${index}-${item.question}`} style={{ padding: 18, borderRadius: 12, border: '1px solid #E5E7EB', background: '#FFFFFF' }}>
                  <strong style={{ display: 'block', marginBottom: 9, lineHeight: 1.6 }}>{index + 1}. {item.question}</strong>
                  <textarea
                    aria-label={`第 ${index + 1} 题答案`}
                    value={item.answer}
                    disabled={busy || recording || finalizing}
                    onChange={(event) => {
                      const answer = event.target.value;
                      setQa((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, answer } : entry));
                    }}
                    rows={3}
                    style={{
                      boxSizing: 'border-box',
                      width: '100%',
                      minHeight: 88,
                      padding: '10px 12px',
                      border: '1px solid #D1D5DB',
                      borderRadius: 8,
                      color: '#374151',
                      background: busy || recording || finalizing ? '#F9FAFB' : '#FFFFFF',
                      font: 'inherit',
                      lineHeight: 1.8,
                      resize: 'vertical',
                    }}
                  />
                </article>
              ))}
            </div>
            {notice && <p role="status" className="small" style={{ marginTop: 16, padding: 12, borderRadius: 10, color: '#166534', background: '#F0FDF4' }}>{notice}</p>}
            {recordingControls(true)}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, marginTop: 26, paddingTop: 22, borderTop: '1px solid #E5E7EB' }}>
              <button
                type="button"
                className="btn btn-primary"
                style={{ minWidth: 280, minHeight: 52, fontSize: 17, fontWeight: 700 }}
                disabled={busy || recording || starting || finalizing}
                onClick={() => void finalizeQa()}
              >
                {finalizing ? '正在正式提交…' : '完成所有修改，正式提交'}
              </button>
              <span className="small muted" style={{ textAlign: 'center', lineHeight: 1.7 }}>
                正式提交后写入培训机构定制资料库，之后所有场景都会阅读这些内容
              </span>
            </div>
          </div>
        )}

        {phase === 'complete' && (
          <div style={{ marginTop: 24, padding: 22, borderRadius: 14, background: '#F0FDF4' }}>
            <h2 style={{ color: '#15803D' }}>资料已入库</h2>
            <p>培训机构定制资料库已保存，后续所有训练场景都会阅读这些内容。</p>
            <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => navigate('/home')}>返回首页</button>
          </div>
        )}
        {error && <p role="alert" style={{ color: '#DC2626', marginTop: 16 }}>{error}</p>}
      </section>
    </main>
  );
}
