import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  apiError,
  fetchMyFeedback,
  submitFeedbackAudio,
  submitFeedbackText,
} from '../api';
import type { Feedback, FeedbackStatus, FeedbackType } from '../types';
import { FEEDBACK_STATUS_CHIP, FEEDBACK_STATUS_LABELS, FEEDBACK_TYPE_LABELS } from '../types';
import { PcmRecorder, pcmToWav } from '../voice';

const TYPE_KEYS: FeedbackType[] = ['suggestion', 'bug', 'other'];

function fmtDateTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fmtSec(total: number) {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** 反馈条目（个人视角）：内容 + 状态 + 管理员回复 */
function FeedbackItem({ fb }: { fb: Feedback }) {
  return (
    <div className="card fb-item">
      <div className="fb-head">
        <span className="chip chip-blue">{FEEDBACK_TYPE_LABELS[fb.type] ?? fb.type}</span>
        <span className={`chip ${FEEDBACK_STATUS_CHIP[fb.status] ?? 'chip-gray'}`}>
          {FEEDBACK_STATUS_LABELS[fb.status] ?? fb.status}
        </span>
        <time className="fb-time">{fmtDateTime(fb.createdAt)}</time>
      </div>
      <p className="fb-content">{fb.content}</p>
      {fb.source?.trim() && (
        <div className="fb-source">
          <span className="ic">📍</span>
          {fb.source}
        </div>
      )}
      {fb.replies.length > 0 && (
        <div className="fb-replies">
          {fb.replies.map((r) => (
            <div key={r.id} className="fb-reply">
              <div className="fb-reply-head">
                <span className="chip chip-coral">官方回复</span>
                <b>{r.userName}</b>
                <time>{fmtDateTime(r.createdAt)}</time>
              </div>
              <p>{r.content}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Feedback() {
  const navigate = useNavigate();
  const [type, setType] = useState<FeedbackType>('suggestion');
  const [source, setSource] = useState('');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [list, setList] = useState<Feedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  // 语音录入
  const recorderRef = useRef<PcmRecorder | null>(null);
  const chunksRef = useRef<ArrayBuffer[]>([]);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [startBusy, setStartBusy] = useState(false);

  useEffect(() => {
    void fetchMyFeedback()
      .then((res) => setList(res.feedbacks))
      .catch((e) => setListError(apiError(e, '反馈列表加载失败')))
      .finally(() => setLoading(false));
    return () => recorderRef.current?.stop();
  }, []);

  // 录音计时
  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => setSeconds((v) => v + 1), 1000);
    return () => window.clearInterval(timer);
  }, [recording]);

  const guardBusy = () => submitting || startBusy || recording;

  const startRecording = async () => {
    if (guardBusy()) return;
    setStartBusy(true);
    setError(null);
    setNotice(null);
    chunksRef.current = [];
    const recorder = new PcmRecorder();
    try {
      recorder.onChunk = (chunk) => chunksRef.current.push(chunk);
      await recorder.start();
      recorderRef.current = recorder;
      setSeconds(0);
      setRecording(true);
    } catch (err) {
      setError(apiError(err, '无法使用麦克风，请检查授权后重试'));
    } finally {
      setStartBusy(false);
    }
  };

  /** 结束录音并上传（后端 ASR 转写） */
  const stopAndSubmit = async () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    const chunks = chunksRef.current;
    recorder.onChunk = null;
    recorder.stop();
    recorderRef.current = null;
    setRecording(false);
    setSeconds(0);
    if (chunks.length === 0) {
      setError('没有录到声音，请重试');
      return;
    }
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      let fb: Feedback;
      try {
        fb = await submitFeedbackAudio({ type, source, wav: pcmToWav(chunks) });
      } catch (err) {
        // ASR 失败兜底：转写不出文本时引导改用文字输入
        setError(apiError(err, '语音识别失败，请检查网络后重试，或改用文字输入'));
        return;
      }
      setList((prev) => [fb, ...prev]);
      setContent('');
      setNotice('提交成功，感谢你的反馈！');
    } finally {
      setSubmitting(false);
    }
  };

  /** 取消录音：丢弃已录音频 */
  const cancelRecording = () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    recorder.onChunk = null;
    recorder.stop();
    recorderRef.current = null;
    chunksRef.current = [];
    setRecording(false);
    setSeconds(0);
  };

  const submitText = async () => {
    const text = content.trim();
    if (!text) {
      setError('请输入反馈内容');
      return;
    }
    if (guardBusy()) return;
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const fb = await submitFeedbackText({ type, content: text, source });
      setList((prev) => [fb, ...prev]);
      setContent('');
      setNotice('提交成功，感谢你的反馈！');
    } catch (err) {
      setError(apiError(err, '提交失败，请稍后重试'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="wrap">
      <div className="sec-head" style={{ marginBottom: 14, paddingTop: 10 }}>
        <h2 className="bar-title">意见反馈</h2>
        <button className="more back-link" onClick={() => navigate('/profile')}>
          返回我的 ›
        </button>
      </div>

      {/* 提交卡片 */}
      <section className="card fb-form">
        {notice && <div className="fb-notice ok">{notice}</div>}
        {error && <div className="fb-notice err">{error}</div>}

        <div className="field">
          <label>反馈类型</label>
          <div className="seg">
            {TYPE_KEYS.map((k) => (
              <button
                key={k}
                className={type === k ? 'on' : ''}
                onClick={() => setType(k)}
                disabled={submitting}
              >
                {FEEDBACK_TYPE_LABELS[k]}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label>关联功能（可选）</label>
          <input
            className="input"
            value={source}
            maxLength={100}
            placeholder="例如：对练报告、场景详情、录音管理…"
            onChange={(e) => setSource(e.target.value)}
            disabled={submitting}
          />
        </div>

        <div className="field">
          <label>反馈内容</label>
          <textarea
            className="input"
            rows={5}
            maxLength={2000}
            value={content}
            placeholder="请描述你遇到的问题或建议，我们会认真每一条反馈…"
            onChange={(e) => setContent(e.target.value)}
            disabled={submitting}
          />
        </div>

        {/* 语音输入 */}
        <div className="fb-rec">
          {!recording ? (
            <button
              className="btn btn-ghost btn-block"
              onClick={startRecording}
              disabled={startBusy || submitting}
            >
              <span className="ic">🎤</span>
              {startBusy ? '正在开启麦克风…' : '语音输入：点击开始录音，说完自动提交'}
            </button>
          ) : (
            <div className="fb-rec-panel">
              <span className="fb-rec-dot" />
              <span className="num fb-rec-time">{fmtSec(seconds)}</span>
              <div className="fb-rec-actions">
                <button className="btn btn-soft btn-sm" onClick={cancelRecording}>
                  取消
                </button>
                <button className="btn btn-primary btn-sm" onClick={stopAndSubmit} disabled={submitting}>
                  {submitting ? '识别中…' : '结束并提交'}
                </button>
              </div>
            </div>
          )}
        </div>

        <button
          className="btn btn-primary btn-block"
          style={{ marginTop: 16 }}
          onClick={submitText}
          disabled={submitting || recording}
        >
          {submitting ? '提交中…' : '提交反馈'}
        </button>
        <p className="hint-center">提交后由管理员统一查看处理，回复会展示在下方列表中</p>
      </section>

      {/* 我的反馈列表 */}
      <div className="sec-head" style={{ marginBottom: 12, marginTop: 22 }}>
        <h2 className="bar-title">我的反馈</h2>
        <span className="more">{list.length > 0 ? `共 ${list.length} 条` : ''}</span>
      </div>

      {loading && <div className="card empty">加载中…</div>}
      {!loading && listError && (
        <div className="card empty">
          <div className="ic">⚠️</div>
          <h3>加载失败</h3>
          <p>{listError}</p>
        </div>
      )}
      {!loading && !listError && list.length === 0 && (
        <div className="card empty">
          <div className="ic">📝</div>
          <h3>还没有反馈</h3>
          <p>遇到问题或有好的想法，欢迎告诉我们</p>
        </div>
      )}
      <div className="fb-list">
        {list.map((fb) => (
          <FeedbackItem key={fb.id} fb={fb} />
        ))}
      </div>
    </main>
  );
}
