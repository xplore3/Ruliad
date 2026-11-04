import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AdaptiveVad, PcmRecorder } from '../voice';
import { apiError, createSession, scoreHumorTest, voiceTurn } from '../api';

type Stage = 'idle' | 'recording' | 'processing' | 'scoring' | 'done';
const SILENCE_MS = 2500;

export default function HumorTest() {
  const navigate = useNavigate();
  const [stage, setStage] = useState<Stage>('idle');
  const [userText, setUserText] = useState('');
  const [replyText, setReplyText] = useState('');
  const [deduction, setDeduction] = useState(0);
  const [rationale, setRationale] = useState('');
  const [error, setError] = useState('');
  const recorderRef = useRef<PcmRecorder | null>(null);
  const chunksRef = useRef<ArrayBuffer[]>([]);
  const finishingRef = useRef(false);
  const spokeRef = useRef(false);
  const lastVoiceAtRef = useRef(0);
  const vadRef = useRef(new AdaptiveVad());
  const sessionIdRef = useRef('');
  const resultRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => () => recorderRef.current?.stop(), []);
  useEffect(() => {
    if (stage === 'done') resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [stage]);

  const finishRecording = async () => {
    if (finishingRef.current || !sessionIdRef.current) return;
    finishingRef.current = true;
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
      const reply = await voiceTurn(sessionIdRef.current, merged.buffer);
      setUserText(reply.userText);
      setReplyText(reply.replyText);
      setStage('scoring');
      const result = await scoreHumorTest(sessionIdRef.current);
      setDeduction(result.deduction);
      setRationale(result.rationale);
      setStage('done');
    } catch (err) {
      setError(apiError(err, '测试失败，请重试'));
      setStage('idle');
    } finally {
      finishingRef.current = false;
    }
  };

  const startRecording = async () => {
    setError('');
    setUserText('');
    setReplyText('');
    setRationale('');
    setDeduction(0);
    finishingRef.current = false;
    try {
      const created = await createSession('scenario-humor-test');
      sessionIdRef.current = created.session.id;
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

  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: '32px 20px' }}>
      <button className="btn btn-ghost btn-sm" onClick={() => navigate('/home')}>返回首页</button>
      <section className="card" style={{ marginTop: 16, padding: 28 }}>
        <h1 style={{ fontSize: 24, marginBottom: 8 }}>幽默与虚假承诺测试</h1>
        <p className="muted" style={{ marginBottom: 24 }}>
          请按自己的语气回答。系统会结合文字与客观语音证据，判断玩笑表达还是虚假承诺。
        </p>

        <div style={{ padding: 20, borderRadius: 12, background: '#F5F6F8', marginBottom: 20 }}>
          <div className="small muted" style={{ marginBottom: 8 }}>家长</div>
          <strong style={{ fontSize: 20 }}>孩子不喜欢。</strong>
        </div>

        <div style={{ padding: 20, borderRadius: 12, border: '1px solid #E5E7EB', marginBottom: 20 }}>
          <div className="small muted" style={{ marginBottom: 8 }}>建议回答</div>
          <div>大哥，您相信我，孩子过来以后，一定会跟您说：哎哟妈妈，围棋太好玩了，我要学围棋！</div>
        </div>

        {stage !== 'done' && (
          <button
            className="btn btn-primary"
            disabled={stage === 'processing' || stage === 'scoring'}
            onClick={stage === 'recording' ? () => void finishRecording() : () => void startRecording()}
          >
            {stage === 'recording' ? '结束录音并评分' : stage === 'processing' ? '识别与回复中…' : stage === 'scoring' ? '评分中…' : '开始录音'}
          </button>
        )}
        {stage === 'recording' && <p className="small muted" style={{ marginTop: 12 }}>正在录音，说完后停顿约 2.5 秒会自动提交。</p>}
        {stage === 'processing' && <p className="small muted" style={{ marginTop: 12 }}>语音已提交，正在识别并等待客户回应…</p>}
        {stage === 'scoring' && <p className="small muted" style={{ marginTop: 12 }}>正在进行双评审，通常需要十几秒，请稍候…</p>}
        {error && <p style={{ color: '#DC2626', marginTop: 12 }}>{error}</p>}

        {userText && (
          <div style={{ marginTop: 24 }}>
            <div className="small muted">识别文本</div>
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
            <p style={{ marginTop: 12, lineHeight: 1.7 }}>{rationale}</p>
            <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => void startRecording()}>再测一次</button>
          </div>
        )}
      </section>
    </main>
  );
}
