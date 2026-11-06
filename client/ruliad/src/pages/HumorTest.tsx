import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AdaptiveVad, PcmRecorder } from '../voice';
import {
  answerFluencyTest,
  apiError,
  createSession,
  scoreFluencyTest,
  scoreHumorTest,
  startFluencyTest as requestFluencyQuestions,
  ttsClip,
  voiceTurn,
  type FluencyTestResult,
} from '../api';

type Stage = 'idle' | 'recording' | 'processing' | 'scoring' | 'done';
type TestKind = 'humor' | 'fluency';
type AnswerRecord = { question: string; text: string };
const SILENCE_MS = 2500;
const FLUENCY_QUESTION_COUNT = 6;

export default function HumorTest() {
  const navigate = useNavigate();
  const [stage, setStage] = useState<Stage>('idle');
  const [testKind, setTestKind] = useState<TestKind>('humor');
  const [questions, setQuestions] = useState<string[]>([]);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<AnswerRecord[]>([]);
  const [userText, setUserText] = useState('');
  const [replyText, setReplyText] = useState('');
  const [deduction, setDeduction] = useState(0);
  const [rationale, setRationale] = useState('');
  const [fluencyResult, setFluencyResult] = useState<FluencyTestResult | null>(null);
  const [error, setError] = useState('');
  const recorderRef = useRef<PcmRecorder | null>(null);
  const questionAudioRef = useRef<HTMLAudioElement | null>(null);
  const chunksRef = useRef<ArrayBuffer[]>([]);
  const finishingRef = useRef(false);
  const spokeRef = useRef(false);
  const lastVoiceAtRef = useRef(0);
  const vadRef = useRef(new AdaptiveVad());
  const sessionIdRef = useRef('');
  const testKindRef = useRef<TestKind>('humor');
  const questionsRef = useRef<string[]>([]);
  const questionIndexRef = useRef(0);
  const answersRef = useRef<AnswerRecord[]>([]);
  const resultRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => () => {
    recorderRef.current?.stop();
    questionAudioRef.current?.pause();
  }, []);
  useEffect(() => {
    if (stage === 'done') resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [stage]);

  const clearResult = () => {
    setUserText('');
    setReplyText('');
    setRationale('');
    setDeduction(0);
    setFluencyResult(null);
    setError('');
  };

  const updateQuestionIndex = (index: number) => {
    questionIndexRef.current = index;
    setQuestionIndex(index);
  };

  const selectTestKind = (kind: TestKind) => {
    if (stage === 'processing' || stage === 'scoring') return;
    recorderRef.current?.stop();
    recorderRef.current = null;
    questionAudioRef.current?.pause();
    sessionIdRef.current = '';
    questionsRef.current = [];
    answersRef.current = [];
    setQuestions([]);
    setAnswers([]);
    updateQuestionIndex(0);
    finishingRef.current = false;
    testKindRef.current = kind;
    setTestKind(kind);
    setStage('idle');
    clearResult();
  };

  const speakQuestion = async (sessionId: string, index: number) => {
    const question = questionsRef.current[index];
    if (!question) return;
    try {
      const clip = await ttsClip(sessionId, `第${index + 1}题。${question}`, 'coach');
      if (sessionIdRef.current !== sessionId || questionIndexRef.current !== index || recorderRef.current) return;
      questionAudioRef.current?.pause();
      const audio = new Audio(`data:audio/${clip.audioFormat};base64,${clip.audioBase64}`);
      questionAudioRef.current = audio;
      await audio.play();
    } catch {
    }
  };

  const finishRecording = async () => {
    if (finishingRef.current || !sessionIdRef.current) return;
    finishingRef.current = true;
    const kind = testKindRef.current;
    recorderRef.current?.stop();
    recorderRef.current = null;
    const chunks = chunksRef.current;
    if (chunks.length === 0) {
      setError('没有录到声音，请重试');
      setStage('idle');
      finishingRef.current = false;
      return;
    }
    const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(new Uint8Array(chunk), offset);
      offset += chunk.byteLength;
    }

    setStage('processing');
    setError('');
    try {
      if (kind === 'fluency') {
        const answer = await answerFluencyTest(sessionIdRef.current, merged.buffer);
        setUserText(answer.userText);
        const question = questionsRef.current[questionIndexRef.current];
        const nextAnswers = [...answersRef.current, { question, text: answer.userText }];
        answersRef.current = nextAnswers;
        setAnswers(nextAnswers);
        if (nextAnswers.length >= FLUENCY_QUESTION_COUNT) {
          setStage('scoring');
          const result = await scoreFluencyTest(sessionIdRef.current);
          setFluencyResult(result);
          setDeduction(result.deduction);
          setRationale(result.rationale);
          setStage('done');
        } else {
          const nextIndex = questionIndexRef.current + 1;
          updateQuestionIndex(nextIndex);
          setStage('idle');
          void speakQuestion(sessionIdRef.current, nextIndex);
        }
      } else {
        const reply = await voiceTurn(sessionIdRef.current, merged.buffer);
        setUserText(reply.userText);
        setReplyText(reply.replyText);
        setStage('scoring');
        const result = await scoreHumorTest(sessionIdRef.current);
        setDeduction(result.deduction);
        setRationale(result.rationale);
        setStage('done');
      }
    } catch (err) {
      setError(apiError(err, '测试失败，请重试'));
      setStage('idle');
    } finally {
      finishingRef.current = false;
    }
  };

  const startFluencyTest = async () => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    recorderRef.current?.stop();
    recorderRef.current = null;
    questionAudioRef.current?.pause();
    questionsRef.current = [];
    answersRef.current = [];
    setQuestions([]);
    setAnswers([]);
    updateQuestionIndex(0);
    clearResult();
    setStage('processing');
    try {
      const created = await createSession('scenario-humor-test');
      sessionIdRef.current = created.session.id;
      const result = await requestFluencyQuestions(sessionIdRef.current);
      const nextQuestions = result.questions.map((item) => item.question);
      questionsRef.current = nextQuestions;
      answersRef.current = [];
      setQuestions(nextQuestions);
      setAnswers([]);
      updateQuestionIndex(0);
      setStage('idle');
      void speakQuestion(sessionIdRef.current, 0);
    } catch (err) {
      setError(apiError(err, '无法准备六题测试，请重试'));
      setStage('idle');
    } finally {
      finishingRef.current = false;
    }
  };

  const startRecording = async () => {
    if (testKindRef.current === 'fluency' && questionsRef.current.length === 0) {
      await startFluencyTest();
      return;
    }
    clearResult();
    finishingRef.current = false;
    questionAudioRef.current?.pause();
    try {
      if (testKindRef.current === 'humor') {
        const created = await createSession('scenario-humor-test');
        sessionIdRef.current = created.session.id;
      }
      const recorder = new PcmRecorder();
      chunksRef.current = [];
      spokeRef.current = false;
      lastVoiceAtRef.current = 0;
      vadRef.current = new AdaptiveVad();
      recorder.onChunk = (chunk) => chunksRef.current.push(chunk);
      recorder.onLevel = (rms) => {
        const now = Date.now();
        if (vadRef.current.isSpeech(rms)) {
          spokeRef.current = true;
          lastVoiceAtRef.current = now;
          return;
        }
        if (spokeRef.current && now - lastVoiceAtRef.current >= SILENCE_MS) {
          void finishRecording();
        }
      };
      recorderRef.current = recorder;
      await recorder.start();
      setStage('recording');
    } catch (err) {
      setError(apiError(err, '无法开始测试，请检查麦克风权限'));
      recorderRef.current?.stop();
      recorderRef.current = null;
    }
  };

  const primaryAction = () => {
    if (stage === 'recording') return void finishRecording();
    if (testKind === 'fluency' && questions.length === 0) return void startFluencyTest();
    return void startRecording();
  };

  const primaryLabel = () => {
    if (stage === 'recording') return testKind === 'fluency' ? '结束本题回答' : '结束录音并评分';
    if (stage === 'processing') return testKind === 'fluency' && questions.length === 0 ? '正在准备随机6题…' : '识别回答中…';
    if (stage === 'scoring') return '评分中…';
    if (testKind === 'fluency') return questions.length === 0 ? '开始六题测试' : `开始回答第${questionIndex + 1}题`;
    return '开始录音';
  };

  return (
    <main style={{ maxWidth: 860, margin: '0 auto', padding: '32px 20px' }}>
      <button className="btn btn-ghost btn-sm" onClick={() => navigate('/home')}>返回首页</button>
      <section className="card" style={{ marginTop: 16, padding: 28 }}>
        <h1 style={{ fontSize: 24, marginBottom: 8 }}>幽默、虚假承诺与语调测试</h1>
        <p className="muted" style={{ marginBottom: 20 }}>
          使用同一录音流程，分别检查表达意图，以及磕磕绊绊和含糊表达。
        </p>

        <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
          {([
            ['humor', '幽默与虚假承诺'],
            ['fluency', '磕磕绊绊语调'],
          ] as const).map(([kind, label]) => (
            <button
              key={kind}
              className={testKind === kind ? 'btn btn-primary' : 'btn btn-ghost'}
              disabled={stage === 'processing' || stage === 'scoring'}
              onClick={() => selectTestKind(kind)}
            >
              {label}
            </button>
          ))}
        </div>

        {testKind === 'humor' ? (
          <>
            <div style={{ padding: 20, borderRadius: 12, background: '#F5F6F8', marginBottom: 20 }}>
              <div className="small muted" style={{ marginBottom: 8 }}>家长</div>
              <strong style={{ fontSize: 20 }}>孩子不喜欢。</strong>
            </div>
            <div style={{ padding: 20, borderRadius: 12, border: '1px solid #E5E7EB', marginBottom: 20 }}>
              <div className="small muted" style={{ marginBottom: 8 }}>建议回答</div>
              <div>大哥，您相信我，孩子过来以后，一定会跟您说：哎哟妈妈，围棋太好玩了，我要学围棋！</div>
            </div>
          </>
        ) : (
          <>
            <div style={{ padding: 20, borderRadius: 12, background: '#F5F6F8', marginBottom: 20 }}>
              <div className="small muted" style={{ marginBottom: 8 }}>
                {questions.length > 0 ? `系统随机提问 · 第 ${questionIndex + 1} / ${FLUENCY_QUESTION_COUNT} 题` : '系统随机提问'}
              </div>
              <strong style={{ fontSize: 20, lineHeight: 1.6 }}>
                {questions[questionIndex] ?? `开始后将从不放回的咨询问题池随机抽取 ${FLUENCY_QUESTION_COUNT} 题`}
              </strong>
              {answers.length > 0 && stage !== 'done' && <p className="small muted" style={{ marginTop: 12 }}>已完成 {answers.length} 题</p>}
            </div>
            <div style={{ padding: 20, borderRadius: 12, border: '1px solid #E5E7EB', marginBottom: 20 }}>
              <div className="small muted" style={{ marginBottom: 8 }}>测试说明</div>
              <p style={{ margin: 0, lineHeight: 1.7 }}>
                请逐题用语音自然回答。六题结束后，系统汇总全部回答，检测“嗯、啊、这个、那个、就是、然后、其实”等成串填充词、重复字词和频繁句中停顿；触发后全局扣 40 分。单个填充词、正常换气和句尾停顿不会扣分。
              </p>
            </div>
          </>
        )}

        {stage !== 'done' && (
          <button className="btn btn-primary" disabled={stage === 'processing' || stage === 'scoring'} onClick={primaryAction}>
            {primaryLabel()}
          </button>
        )}
        {stage === 'recording' && <p className="small muted" style={{ marginTop: 12 }}>正在录音，回答完后停顿约 2.5 秒会自动进入下一题。</p>}
        {stage === 'processing' && questions.length > 0 && <p className="small muted" style={{ marginTop: 12 }}>正在识别本题回答并分析录音…</p>}
        {stage === 'scoring' && (
          <p className="small muted" style={{ marginTop: 12 }}>
            {testKind === 'humor' ? '正在进行双评审，通常需要十几秒，请稍候…' : '正在汇总六题回答，分析填充词、重复断句和句中停顿…'}
          </p>
        )}
        {error && <p style={{ color: '#DC2626', marginTop: 12 }}>{error}</p>}

        {userText && (
          <div style={{ marginTop: 24 }}>
            <div className="small muted">{testKind === 'fluency' ? '本题识别文本' : '识别文本'}</div>
            <p>{userText}</p>
          </div>
        )}
        {replyText && (
          <div style={{ marginTop: 16 }}>
            <div className="small muted">客户回应</div>
            <p>{replyText}</p>
          </div>
        )}
        {stage === 'done' && (
          <div ref={resultRef} style={{ marginTop: 24, padding: 20, borderRadius: 12, background: deduction > 0 ? '#FFF1F2' : '#F0FDF4' }}>
            <div className="small muted" style={{ marginBottom: 6 }}>评分结果</div>
            <h2 style={{ fontSize: 22, color: deduction > 0 ? '#DC2626' : '#15803D' }}>
              {deduction > 0 ? `扣 ${deduction} 分` : '未扣分'}
            </h2>
            <p style={{ marginTop: 12, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{rationale}</p>
            {testKind === 'fluency' && fluencyResult && (
              <div style={{ marginTop: 18, padding: 16, borderRadius: 10, background: 'rgba(255,255,255,0.75)' }}>
                <strong>六题检测依据</strong>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginTop: 12 }}>
                  <span>填充词总数：{fluencyResult.fillerCount} 次</span>
                  <span>重复字词：{fluencyResult.repetitionCount} 次</span>
                  <span>句中明显停顿：{fluencyResult.disruptedPauseCount} 处</span>
                  <span>涉及轮次：{fluencyResult.affectedTurns}</span>
                </div>
                {fluencyResult.answers.map((answer, index) => (
                  <div key={`${index}-${answer.question}`} style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid #E5E7EB' }}>
                    <strong className="small">第{index + 1}题：{answer.question}</strong>
                    <p className="small" style={{ margin: '6px 0', lineHeight: 1.6 }}>回答：{answer.text}</p>
                    <div className="small muted" style={{ lineHeight: 1.7 }}>
                      {answer.analysis.reasons.length > 0 ? answer.analysis.reasons.join('；') : '未检测到明显异常'}
                      {answer.analysis.averageVoicedSegmentMs > 0 && `；平均连续发声 ${(answer.analysis.averageVoicedSegmentMs / 1000).toFixed(1)} 秒`}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <button
              className="btn btn-primary"
              style={{ marginTop: 16 }}
              onClick={() => testKind === 'fluency' ? void startFluencyTest() : void startRecording()}
            >
              再测一次
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
