﻿﻿﻿import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../api';
import StatusBar from '../components/StatusBar';
import { usePageTrack } from '../track';
import type { AppealReReview, CreateSessionResponse, ReviewResponse, TranscriptTurn } from '../types';

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

function turnTime(turn: TranscriptTurn, startedAt: string): string {
  if (!turn.at) return '';
  const ms = new Date(turn.at).getTime() - new Date(startedAt).getTime();
  if (Number.isNaN(ms) || ms < 0) return '';
  const total = Math.round(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export default function Review() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<ReviewResponse | null>(null);
  const [error, setError] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [loading, setLoading] = useState(false);
  // 申诉状态
  const [disagreeTarget, setDisagreeTarget] = useState<string | null>(null);
  const [disagreeReason, setDisagreeReason] = useState('');
  const [disagreedTargets, setDisagreedTargets] = useState<Set<string>>(new Set());
  const [reReviews, setReReviews] = useState<Record<string, AppealReReview>>({});
  const [submitting, setSubmitting] = useState(false);
  usePageTrack('/session/:id/review');

  const load = () => {
    if (!id) return;
    const startedAt = Date.now();
    console.log(`[Review] GET /sessions/${id}/review 开始`);
    setError(false);
    setLoading(true);
    // 超时检测：30 秒未响应视为异常
    const timeoutTimer = setTimeout(() => {
      console.warn(`[Review] GET /review 超时（30s），停止等待`);
      setError(true);
      setLoading(false);
    }, 30_000);
    api.get<ReviewResponse>(`/sessions/${id}/review`)
      .then((res) => {
        clearTimeout(timeoutTimer);
        console.log(
          `[Review] GET /review 成功 耗时=${Date.now() - startedAt}ms`,
          res.data.report
            ? `totalScore=${res.data.report.totalScore} items=${res.data.report.items.length}`
            : 'report=null（会话被跳过）'
        );
        setData(res.data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        clearTimeout(timeoutTimer);
        const e = err as { response?: { status?: number; data?: unknown }; message?: string };
        console.error(
          `[Review] GET /review 失败 耗时=${Date.now() - startedAt}ms status=${e.response?.status}`,
          e.response?.data ?? e.message ?? err
        );
        setError(true);
        setLoading(false);
      });
  };
  useEffect(load, [id]);

  const retry = async () => {
    if (retrying || !data?.scenario) return;
    setRetrying(true);
    try {
      const res = await api.post<CreateSessionResponse>('/sessions', { scenarioId: data.scenario.id, mode: 'practice' });
      navigate(`/session/text/${res.data.session.id}`, { state: res.data });
    } catch {
      window.alert('创建练习失败');
      setRetrying(false);
    }
  };

  const submitDisagree = async (target: string) => {
    const reason = disagreeReason.trim();
    if (!reason || !id || submitting) return;
    setSubmitting(true);
    try {
      const [type, idxStr] = target.split(':');
      const body: Record<string, unknown> = { sessionId: id, reason };
      if (type === 'score_item') {
        body.targetType = 'score_item';
        body.scoreItemResultIndex = Number(idxStr);
      } else if (type === 'violation') {
        body.targetType = 'violation';
        body.violationIndex = Number(idxStr);
      } else {
        body.targetType = 'overall';
      }
      const res = await api.post<{ reReview?: AppealReReview }>('/appeals', body);
      setDisagreedTargets((prev) => new Set(prev).add(target));
      setDisagreeTarget(null);
      setDisagreeReason('');
      if (res.data.reReview) {
        setReReviews((prev) => ({ ...prev, [target]: res.data.reReview! }));
      }
    } catch {
      window.alert('提交失败，请重试');
    } finally {
      setSubmitting(false);
    }
  };

  const renderReReview = (target: string) => {
    const reReview = reReviews[target];
    if (!reReview) return null;
    const verdictLabel = { agree: '维持原评', disagree: '支持你的异议', partial: '部分支持' }[reReview.verdict];
    const verdictColor = { agree: C.sub, disagree: C.success, partial: C.accent }[reReview.verdict];
    return (
      <div className="mt-2 rounded-lg p-3" style={{ border: `1px solid ${C.border}`, backgroundColor: C.panel }}>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold" style={{ color: C.text }}>AI 复评</span>
          <span className="rounded-full px-2 py-0.5 text-xs font-medium" style={{ backgroundColor: C.panel2, color: verdictColor }}>{verdictLabel}</span>
          {reReview.suggestedScore !== undefined && <span className="text-xs" style={{ color: C.sub }}>建议 {reReview.suggestedScore} 分</span>}
        </div>
        <p className="mt-1.5 text-[13px]" style={{ color: C.sub }}>{reReview.rationale}</p>
      </div>
    );
  };

  const renderDisagreeBlock = (target: string) => {
    if (disagreedTargets.has(target)) {
      return (
        <div className="mt-3">
          <p className="text-xs font-medium" style={{ color: C.success }}>已提交异议，AI 已复评</p>
          {renderReReview(target)}
        </div>
      );
    }
    if (disagreeTarget === target) {
      return (
        <div className="mt-3 space-y-2">
          <textarea
            className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
            style={{ backgroundColor: C.panel2, color: C.text, border: `1px solid ${C.border}` }}
            rows={2}
            placeholder="请说明你不同意的原因…"
            value={disagreeReason}
            onChange={(e) => setDisagreeReason(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              className="flex-1 rounded-lg py-2.5 text-sm font-semibold transition disabled:opacity-50"
              style={{ backgroundColor: C.accent, color: '#F7F7FA' }}
              onClick={() => submitDisagree(target)}
              disabled={submitting || !disagreeReason.trim()}
            >
              {submitting ? '提交中…' : '提交异议'}
            </button>
            <button
              className="rounded-lg px-4 py-2.5 text-sm"
              style={{ border: `1px solid ${C.border}`, color: C.sub }}
              onClick={() => { setDisagreeTarget(null); setDisagreeReason(''); }}
            >
              取消
            </button>
          </div>
        </div>
      );
    }
    return (
      <button
        className="mt-2 flex items-center gap-1 text-xs font-medium"
        style={{ color: C.accent }}
        onClick={() => { setDisagreeTarget(target); setDisagreeReason(''); }}
      >
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
        我不同意
      </button>
    );
  };

  if (error) {
    return (
      <div className="relative mx-auto flex min-h-screen w-full max-w-md flex-col" style={{ backgroundColor: C.bg }}>
        <StatusBar dark />
        <div className="flex flex-col items-center gap-3 py-20 text-center">
          <p className="text-sm" style={{ color: C.sub }}>报告加载失败或超时，请重试</p>
          <button className="rounded-lg px-5 py-2 text-sm font-medium" style={{ backgroundColor: C.accent, color: '#F7F7FA' }} onClick={load}>重新加载</button>
          <button className="rounded-lg px-5 py-2 text-sm font-medium" style={{ border: `1px solid ${C.panel2}`, color: C.text, backgroundColor: C.panel }} onClick={() => navigate('/practice')}>返回对练列表</button>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="relative mx-auto flex min-h-screen w-full max-w-md flex-col" style={{ backgroundColor: C.bg }}>
        <StatusBar dark />
        <div className="flex flex-col items-center gap-3 py-20 text-center">
          <div className="h-10 w-10 animate-spin rounded-full border-2" style={{ borderColor: 'rgba(255,255,255,0.2)', borderTopColor: C.accent }} />
          <p className="text-sm" style={{ color: C.sub }}>
            {loading ? '正在生成复盘…' : '准备中…'}
          </p>
          {loading && (
            <button className="text-xs underline" style={{ color: C.sub }} onClick={load}>
              等待时间过长？点击重试
            </button>
          )}
        </div>
      </div>
    );
  }

  // 会话被放弃
  if (!data.report) {
    return (
      <div className="relative mx-auto flex min-h-screen w-full max-w-md flex-col" style={{ backgroundColor: C.bg }}>
        <StatusBar dark />
        <div className="flex flex-col items-center gap-3 py-20 text-center">
          <p className="text-sm" style={{ color: C.sub }}>本次对练对话较少或时长较短，未生成复盘报告。</p>
          <button
            className="rounded-lg px-5 py-2 text-sm font-medium"
            style={{ backgroundColor: C.accent, color: '#F7F7FA' }}
            onClick={() => navigate('/practice')}
          >
            返回对练列表
          </button>
        </div>
      </div>
    );
  }

  const { session, report, scenario, persona, prevScore } = data;
  const diff = prevScore !== null ? report.totalScore - prevScore : null;
  const fatalViolations = report.violations.filter((v) => v.fatal);
  const { ruleStats } = report;
  const fillerEntries = Object.entries(ruleStats.fillerCounts).sort((a, b) => b[1] - a[1]);
  const topFiller = fillerEntries[0] ?? null;
  const coverageTotal = ruleStats.coverageHits.length + ruleStats.coverageMisses.length;

  return (
    <div className="relative mx-auto flex min-h-screen w-full max-w-md flex-col" style={{ backgroundColor: C.bg }}>
      <StatusBar dark />
      <div className="flex items-center px-4 py-2">
        <button onClick={() => navigate('/practice')} className="flex h-9 w-9 items-center justify-center">
          <svg className="h-5 w-5" style={{ color: C.sub }} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
        </button>
      </div>

      <div className="px-5">
        <p className="text-xs" style={{ color: C.sub }}>
          {scenario?.name ?? '练习场景'}{persona ? ` · ${persona.name}` : ''}
        </p>
        <h1 className="mt-1 text-2xl font-bold" style={{ color: C.text }}>本次复盘</h1>
      </div>

      {/* 得分卡 */}
      <div className="mx-4 mt-4 rounded-2xl p-5" style={{ backgroundColor: C.panel }}>
        <div className="flex items-end justify-between">
          <div className="flex items-end gap-2">
            <span className="text-5xl font-bold" style={{ color: C.text }}>{report.totalScore}</span>
            {diff !== null && (
              <span className="pb-1 text-sm font-medium" style={{ color: diff >= 0 ? C.success : C.accent }}>
                较上次 {diff >= 0 ? `+${diff}` : diff}
              </span>
            )}
            <span
              className="mb-0.5 rounded-full px-2.5 py-0.5 text-xs font-semibold"
              style={{
                backgroundColor: report.passed ? 'rgba(93,199,163,0.15)' : 'rgba(232,92,98,0.15)',
                color: report.passed ? C.success : C.accent,
              }}
            >
              {report.passed ? '已达标' : '未达标'}
            </span>
          </div>
          {scenario?.passScore && <span className="text-sm" style={{ color: C.sub }}>达标线 {scenario.passScore}</span>}
        </div>

        {fatalViolations.length > 0 && (
          <div className="mt-3 rounded-xl px-3 py-2.5" style={{ backgroundColor: 'rgba(232,92,98,0.08)' }}>
            <p className="text-[13px]" style={{ color: C.accent }}>{fatalViolations.map((v) => v.detail).join('；')}</p>
          </div>
        )}

        {fatalViolations.length > 0 && renderDisagreeBlock('violation:0')}

        {/* 技能得分 */}
        <div className="mt-4 space-y-3">
          {report.skillScores.map((s) => {
            const ratio = s.maxScore > 0 ? s.score / s.maxScore : 0;
            const color = ratio >= 0.8 ? C.success : ratio >= 0.4 ? '#f59e0b' : C.accent;
            return (
              <div key={s.skillPointId} className="flex items-center gap-3">
                <span className="w-24 shrink-0 truncate text-sm" style={{ color: C.sub }}>{s.skillPointName}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full" style={{ backgroundColor: C.panel2 }}>
                  <div className="h-full rounded-full" style={{ width: `${Math.min(100, ratio * 100)}%`, backgroundColor: color }} />
                </div>
                <span className="w-20 shrink-0 text-right text-xs" style={{ color: C.text }}>{s.score} / {s.maxScore}</span>
              </div>
            );
          })}
        </div>

        {/* 行为统计 */}
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-xl px-4 py-3" style={{ backgroundColor: C.panel2 }}>
            <p className="text-xs" style={{ color: C.sub }}>打断客户</p>
            <p className="mt-1 text-lg font-bold" style={{ color: C.text }}>{ruleStats.interruptions}次</p>
          </div>
          <div className="rounded-xl px-4 py-3" style={{ backgroundColor: C.panel2 }}>
            <p className="text-xs" style={{ color: C.sub }}>话术覆盖</p>
            <p className="mt-1 text-lg font-bold" style={{ color: C.text }}>{ruleStats.coverageHits.length} / {coverageTotal}</p>
          </div>
          <div className="rounded-xl px-4 py-3" style={{ backgroundColor: C.panel2 }}>
            <p className="text-xs" style={{ color: C.sub }}>{topFiller ? `口头禅「${topFiller[0]}」` : '口头禅'}</p>
            <p className="mt-1 text-lg font-bold" style={{ color: C.text }}>{topFiller ? `${topFiller[1]}次` : '0次'}</p>
          </div>
          <div className="rounded-xl px-4 py-3" style={{ backgroundColor: C.panel2 }}>
            <p className="text-xs" style={{ color: C.sub }}>提示消耗</p>
            <p className="mt-1 text-lg font-bold" style={{ color: C.text }}>{session.hintsUsed} / 3</p>
          </div>
        </div>

        {renderDisagreeBlock('overall')}
      </div>

      {/* 对话回放 */}
      <div className="mx-4 mt-6">
        <h2 className="text-lg font-bold" style={{ color: C.text }}>对话回放</h2>
        <div className="mt-3 space-y-3">
          {session.transcript.map((turn) => {
            if (turn.speaker === 'coach' || turn.isHint) {
              return (
                <div key={turn.seq} className="rounded-2xl px-4 py-3" style={{ border: `1px solid rgba(232,92,98,0.2)`, backgroundColor: 'rgba(232,92,98,0.05)' }}>
                  <p className="text-xs" style={{ color: C.sub }}><span>{turnTime(turn, session.startedAt)}</span><span className="ml-2 font-medium" style={{ color: C.accent }}>教练提示</span></p>
                  <p className="mt-2 text-[15px]" style={{ color: C.text }}>{turn.text}</p>
                </div>
              );
            }
            const isTrainee = turn.speaker === 'trainee';
            return (
              <div key={turn.seq} className="rounded-2xl px-4 py-3" style={{ backgroundColor: isTrainee ? C.accent : C.panel, color: isTrainee ? '#F7F7FA' : C.text }}>
                <p className="text-xs" style={{ color: isTrainee ? 'rgba(255,255,255,0.7)' : C.sub }}><span>{turnTime(turn, session.startedAt)}</span><span className="ml-2">{isTrainee ? '我' : `客户 ${persona?.name ?? ''}`}</span></p>
                <p className="mt-2 text-[15px] leading-relaxed">{turn.text}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* 评分明细 */}
      {report.items.length > 0 && (
        <div className="mx-4 mt-6">
          <h2 className="text-lg font-bold" style={{ color: C.text }}>评分明细</h2>
          <div className="mt-3 space-y-3">
            {report.items.map((item, i) => (
              <div key={i} className="rounded-2xl p-4" style={{ backgroundColor: C.panel }}>
                <div className="flex items-center justify-between">
                  <span className="text-[15px] font-bold" style={{ color: C.text }}>{item.itemName}</span>
                  <span className="text-sm font-semibold" style={{ color: C.success }}>{item.levelLabel}</span>
                </div>
                <p className="mt-2 text-[13px]" style={{ color: C.sub }}>{item.rationale}</p>
                {item.quote && <p className="mt-2 rounded-lg px-3 py-2 text-[13px]" style={{ backgroundColor: C.panel2, color: C.text }}>「{item.quote}」</p>}
                {item.betterScript && <p className="mt-2 text-[13px]" style={{ color: C.success }}>建议：{item.betterScript}</p>}
                {renderDisagreeBlock(`score_item:${i}`)}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 再练一次 */}
      <div className="p-5">
        <button
          className="mx-auto block min-h-14 w-full max-w-[280px] rounded-2xl text-base font-bold transition active:scale-[0.98] disabled:opacity-50"
          style={{ backgroundColor: C.accent, color: '#F7F7FA' }}
          onClick={retry}
          disabled={retrying || !scenario}
        >
          {retrying ? '正在创建…' : '再练一次（同陪练员·换随机种子）'}
        </button>
      </div>
    </div>
  );
}
