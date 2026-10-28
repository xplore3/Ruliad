import { useState } from 'react';
import { submitQuizAnswer, apiError } from '../api';
import type { QuizQuestion } from '../types';

interface QuizResultView {
  correct: boolean;
  score: number;
  explanation?: string;
  correctAnswer?: string[] | string;
}

interface Props {
  sessionId: string;
  quiz: QuizQuestion;
  /** 作答完成（已看到结果并点「继续」） */
  onDone: () => void;
  /** 非必答题可跳过；必答题不渲染跳过入口 */
  onSkip?: () => void;
}

const TYPE_LABEL: Record<QuizQuestion['type'], string> = {
  single_choice: '单选题',
  multi_choice: '多选题',
  true_false: '判断题',
  short_answer: '简答题',
  scenario_pick: '情景题',
};

/** 对练中弹出的随场考题：作答 → 即时判分 → 展示解析 */
export default function QuizModal({ sessionId, quiz, onDone, onSkip }: Props) {
  const isChoice = quiz.type === 'single_choice' || quiz.type === 'multi_choice' || quiz.type === 'true_false';
  const isMulti = quiz.type === 'multi_choice';

  const [selected, setSelected] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<QuizResultView | null>(null);

  const toggle = (id: string) => {
    if (isMulti) {
      setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    } else {
      setSelected([id]);
    }
  };

  const canSubmit = !submitting && (isChoice ? selected.length > 0 : text.trim().length > 0);

  const correctAnswerText = (r: QuizResultView): string => {
    if (r.correctAnswer === undefined) return '';
    const ids = Array.isArray(r.correctAnswer) ? r.correctAnswer : [r.correctAnswer];
    const labels = ids.map((id) => quiz.options?.find((o) => o.id === id)?.label ?? id);
    return labels.join('、');
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError('');
    try {
      const answer = isChoice ? selected : [text.trim()];
      setResult(await submitQuizAnswer(sessionId, quiz.id, answer));
    } catch (err) {
      setError(apiError(err, '提交失败，请重试'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="boot-overlay" style={{ zIndex: 60 }}>
      <div
        className="card"
        style={{
          width: 'min(520px, calc(100vw - 32px))',
          maxHeight: '80vh',
          overflowY: 'auto',
          padding: '20px 22px',
          background: '#1E2230',
          color: '#F7F7FA',
          border: '1px solid rgba(255,255,255,.1)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span className="chip chip-coral !text-[11.5px]">随场考题 · {TYPE_LABEL[quiz.type]}</span>
          <span style={{ fontSize: 12, opacity: 0.65 }}>{quiz.score} 分{quiz.required ? ' · 必答' : ''}</span>
        </div>

        <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.6, marginBottom: 16 }}>{quiz.prompt}</div>

        {!result && isChoice && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
            {(quiz.options ?? []).map((o) => {
              const on = selected.includes(o.id);
              return (
                <button
                  key={o.id}
                  onClick={() => toggle(o.id)}
                  style={{
                    textAlign: 'left',
                    padding: '10px 14px',
                    borderRadius: 12,
                    fontSize: 14,
                    lineHeight: 1.5,
                    cursor: 'pointer',
                    color: '#F7F7FA',
                    background: on ? 'rgba(255,107,91,.18)' : 'rgba(255,255,255,.06)',
                    border: `1px solid ${on ? '#FF6B5B' : 'rgba(255,255,255,.12)'}`,
                  }}
                >
                  {isMulti ? (on ? '☑ ' : '☐ ') : (on ? '◉ ' : '○ ')}
                  {o.label}
                </button>
              );
            })}
            {(quiz.options ?? []).length === 0 && (
              <div style={{ fontSize: 13, opacity: 0.6 }}>本题缺少选项配置，请跳过</div>
            )}
          </div>
        )}

        {!result && !isChoice && (
          <textarea
            className="input"
            rows={4}
            placeholder="输入你的回答…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            style={{ width: '100%', marginBottom: 16, resize: 'vertical' }}
          />
        )}

        {result && (
          <div style={{ marginBottom: 16 }}>
            <div
              style={{
                padding: '10px 14px',
                borderRadius: 12,
                fontSize: 14,
                fontWeight: 600,
                marginBottom: 10,
                background: result.correct ? 'rgba(34,160,107,.15)' : 'rgba(255,107,91,.15)',
                border: `1px solid ${result.correct ? 'rgba(34,160,107,.5)' : 'rgba(255,107,91,.5)'}`,
              }}
            >
              {result.correct ? `✓ 回答正确 +${result.score} 分` : '✗ 回答错误'}
            </div>
            {!result.correct && correctAnswerText(result) && (
              <div style={{ fontSize: 13, marginBottom: 8, opacity: 0.9 }}>
                正确答案：{correctAnswerText(result)}
              </div>
            )}
            {result.explanation && (
              <div style={{ fontSize: 13, lineHeight: 1.7, opacity: 0.75 }}>解析：{result.explanation}</div>
            )}
          </div>
        )}

        {error && <div style={{ fontSize: 13, color: '#FF6B5B', marginBottom: 10 }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          {!result && onSkip && (
            <button className="btn btn-ghost btn-sm" onClick={onSkip} disabled={submitting}>
              稍后再答
            </button>
          )}
          {!result ? (
            <button className="btn btn-primary btn-sm" onClick={handleSubmit} disabled={!canSubmit}>
              {submitting ? '提交中…' : '提交答案'}
            </button>
          ) : (
            <button className="btn btn-primary btn-sm" onClick={onDone}>
              继续对练 →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
