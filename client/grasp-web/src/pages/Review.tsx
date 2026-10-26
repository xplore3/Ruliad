﻿﻿﻿import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api, { getToken } from '../api';
import AppFrame from '../components/AppFrame';
import { trackAction, usePageTrack } from '../track';
import type { AppealReReview, CreateSessionResponse, ReviewResponse, TranscriptTurn } from '../types';

/* ================= 工具 ================= */

/** 相对会话开始的 mm:ss */
function turnTime(turn: TranscriptTurn, startedAt: string): string {
  if (!turn.at) return '';
  const ms = new Date(turn.at).getTime() - new Date(startedAt).getTime();
  if (Number.isNaN(ms) || ms < 0) return '';
  const total = Math.round(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/* ================= 情绪曲线 ================= */

function EmotionChart({ data }: { data: { t: string; v: number }[] }) {
  const W = 320;
  const H = 180;
  const PL = 30;
  const PR = 8;
  const PT = 12;
  const PB = 24;
  const iw = W - PL - PR;
  const ih = H - PT - PB;
  const x = (i: number) => PL + (i * iw) / Math.max(1, data.length - 1);
  const y = (v: number) => PT + (1 - v) * ih;
  // Catmull-Rom 转三次贝塞尔，得到平滑曲线
  const pts = data.map((d, i) => ({ x: x(i), y: y(d.v) }));
  let dAttr = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    dAttr += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full">
      {[0, 0.25, 0.5, 0.75, 1].map((v) => (
        <g key={v}>
          <line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} stroke="#eef1f4" strokeWidth="1" />
          <text x={PL - 5} y={y(v) + 3} fontSize="9" fill="#9aa5b1" textAnchor="end">
            {v}
          </text>
        </g>
      ))}
      {/* 0.75 警戒线 */}
      <line
        x1={PL}
        x2={W - PR}
        y1={y(0.75)}
        y2={y(0.75)}
        stroke="#e08a97"
        strokeWidth="1.2"
        strokeDasharray="5 4"
      />
      <path d={dAttr} fill="none" stroke="#0d5e63" strokeWidth="2.2" strokeLinecap="round" />
      {pts.map((p, i) => (
        <g key={data[i].t + i}>
          <circle cx={p.x} cy={p.y} r="3.6" fill="#ffffff" stroke="#0d5e63" strokeWidth="2" />
          <text x={p.x} y={H - 6} fontSize="9" fill="#9aa5b1" textAnchor="middle">
            {data[i].t}
          </text>
        </g>
      ))}
    </svg>
  );
}

/* ================= 小图标 ================= */

function ThumbIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M14 9V5a2 2 0 00-2-2l-2 5H7a2 2 0 00-2 2v7a2 2 0 002 2h8.28a2 2 0 001.95-1.55l1.1-5.5A2 2 0 0016.38 9H14zM7 10v9"
      />
    </svg>
  );
}

function FlagIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 21V4m0 1h11l-2.5 3.5L16 12H5" />
    </svg>
  );
}

/* ================= 页面 ================= */

type Tone = 'white' | 'green' | 'red' | 'orange';

const TONE_STYLE: Record<Tone, { card: string; tag: string }> = {
  white: { card: 'bg-white shadow-sm', tag: '' },
  green: { card: 'bg-[#e4f2ec] border border-[#c4e2d5]', tag: 'text-[#2e9e77]' },
  red: { card: 'bg-[#fcebee] border border-[#f3c4cc]', tag: 'text-[#d14d5f]' },
  orange: { card: 'bg-[#fde8e1] border border-[#f3c8b8]', tag: 'text-[#d9622d]' },
};

export default function Review() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<ReviewResponse | null>(null);
  const [error, setError] = useState(false);
  const [openItem, setOpenItem] = useState<number | null>(null);
  // 申诉状态：score_item 用 index，violation 用 'v{index}'，overall 用 'overall'
  const [disagreeTarget, setDisagreeTarget] = useState<string | null>(null);
  const [disagreeReason, setDisagreeReason] = useState('');
  const [disagreedTargets, setDisagreedTargets] = useState<Set<string>>(new Set());
  // AI 复评结果：key = target string, value = reReview
  const [reReviews, setReReviews] = useState<Record<string, AppealReReview>>({});
  const [submitting, setSubmitting] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  usePageTrack('/session/:id/review');

  const load = () => {
    if (!id) return;
    const startedAt = Date.now();
    console.log(`[Review] GET /sessions/${id}/review 开始`);
    setError(false);
    api
      .get<ReviewResponse>(`/sessions/${id}/review`)
      .then((res) => {
        console.log(
          `[Review] GET /review 成功 耗时=${Date.now() - startedAt}ms`,
          res.data.report
            ? `totalScore=${res.data.report.totalScore} items=${res.data.report.items.length}`
            : 'report=null（会话被跳过）'
        );
        setData(res.data);
      })
      .catch((err: unknown) => {
        const e = err as { response?: { status?: number; data?: unknown }; message?: string };
        console.error(
          `[Review] GET /review 失败 耗时=${Date.now() - startedAt}ms status=${e.response?.status}`,
          e.response?.data ?? e.message ?? err
        );
        setError(true);
      });
  };

  useEffect(load, [id]);

  const submitDisagree = async (target: string) => {
    const reason = disagreeReason.trim();
    if (!reason || !id || submitting) return;
    setSubmitting(true);
    try {
      // 解析 target：score_item:{index} | violation:{index} | overall
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
      trackAction('appeal_submit', { sessionId: id, target });
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

  /** AI 复评结果展示 */
  const renderReReview = (target: string) => {
    const reReview = reReviews[target];
    if (!reReview) return null;
    const verdictLabel = {
      agree: '维持原评',
      disagree: '支持你的异议',
      partial: '部分支持',
    }[reReview.verdict];
    const verdictColor = {
      agree: 'bg-gray-100 text-gray-600',
      disagree: 'bg-green-100 text-green-700',
      partial: 'bg-orange-100 text-orange-700',
    }[reReview.verdict];
    return (
      <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-3">
        <div className="flex items-center gap-2">
          <svg className="h-4 w-4 text-blue-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
          <span className="text-xs font-semibold text-blue-700">AI 复评结果</span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${verdictColor}`}>
            {verdictLabel}
          </span>
          {reReview.suggestedScore !== undefined && (
            <span className="text-xs text-gray-500">建议分数 {reReview.suggestedScore}</span>
          )}
        </div>
        <p className="mt-2 text-[13px] leading-relaxed text-gray-700">{reReview.rationale}</p>
      </div>
    );
  };

  /** "我不同意" 交互区块 */
  const renderDisagreeBlock = (target: string) => {
    if (disagreedTargets.has(target)) {
      return (
        <div className="mt-3">
          <p className="text-xs font-medium text-[#0d5e63]">已提交异议，AI 已复评</p>
          {renderReReview(target)}
        </div>
      );
    }
    if (disagreeTarget === target) {
      return (
        <div className="mt-3 space-y-2">
          <input
            className="h-11 w-full rounded-lg border border-gray-300 px-3 focus:border-[#0d5e63] focus:outline-none"
            placeholder="请说明你不同意的原因…"
            value={disagreeReason}
            onChange={(e) => setDisagreeReason(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              className="h-11 flex-1 rounded-lg bg-[#0d5e63] text-white disabled:opacity-50"
              onClick={() => submitDisagree(target)}
              disabled={submitting || !disagreeReason.trim()}
            >
              {submitting ? '提交中…' : '提交异议'}
            </button>
            <button
              className="h-11 rounded-lg px-4 text-gray-500"
              onClick={() => {
                setDisagreeTarget(null);
                setDisagreeReason('');
              }}
            >
              取消
            </button>
          </div>
        </div>
      );
    }
    return (
      <button
        className="mt-3 flex items-center gap-1 text-xs font-medium text-[#e05a6b]"
        onClick={() => {
          setDisagreeTarget(target);
          setDisagreeReason('');
        }}
      >
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
        我不同意
      </button>
    );
  };

  const retry = async () => {
    if (retrying || !data?.scenario) return;
    setRetrying(true);
    trackAction('repractice_click', { sessionId: id, scenarioId: data.scenario.id });
    try {
      const res = await api.post<CreateSessionResponse>('/sessions', {
        scenarioId: data.scenario.id,
        mode: 'practice',
      });
      navigate(`/session/${res.data.session.id}`, { state: res.data });
    } catch {
      window.alert('创建练习失败，请稍后重试');
      setRetrying(false);
    }
  };

  if (error) {
    return (
      <AppFrame className="px-4 pb-10 pt-5 lg:max-w-3xl">
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-sm text-gray-500">复盘报告加载失败，请稍后重试</p>
          <button
            className="rounded-lg bg-[#0d5e63] px-5 py-2 text-sm font-medium text-white"
            onClick={load}
          >
            重新加载
          </button>
        </div>
      </AppFrame>
    );
  }

  if (!data) {
    return (
      <AppFrame className="px-4 pb-10 pt-5 lg:max-w-3xl">
        <p className="py-10 text-center text-sm text-gray-400">正在生成复盘…</p>
      </AppFrame>
    );
  }

  // 会话被放弃（对话太少或时间太短），不生成报告
  if (!data.report) {
    return (
      <AppFrame className="px-4 pb-10 pt-5 lg:max-w-3xl">
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-sm text-gray-500">本次对练对话较少或时长较短，未生成复盘报告。</p>
          <button
            className="rounded-lg bg-[#0d5e63] px-5 py-2 text-sm font-medium text-white"
            onClick={() => navigate('/tasks')}
          >
            返回任务列表
          </button>
        </div>
      </AppFrame>
    );
  }

  const { session, report, scenario, persona, prevScore } = data;
  const passLine = scenario?.passScore ?? null;
  const diff = prevScore !== null ? report.totalScore - prevScore : null;
  const fatalViolations = report.violations.filter((v) => v.fatal);
  const { ruleStats } = report;
  const fillerEntries = Object.entries(ruleStats.fillerCounts).sort((a, b) => b[1] - a[1]);
  const topFiller = fillerEntries[0] ?? null;
  const coverageTotal = ruleStats.coverageHits.length + ruleStats.coverageMisses.length;
  const disagreeCount = report.items.filter((it) => !it.judgeAgree).length;

  const stats = [
    { label: '打断客户', value: `${ruleStats.interruptions}次` },
    {
      label: '话术要点覆盖',
      value: `${ruleStats.coverageHits.length} / ${coverageTotal}`,
    },
    {
      label: topFiller ? `口头禅「${topFiller[0]}」` : '口头禅',
      value: topFiller ? `${topFiller[1]}次` : '0次',
    },
    { label: '提示消耗', value: `${session.hintsUsed} / 3` },
  ];

  // 情绪曲线：emotionTrace 优先，退化为 transcript 内 persona 轮快照
  const emotionData = (session.emotionTrace ?? [])
    .map((p) => ({
      t: turnTime({ seq: p.seq, speaker: 'persona', text: '', at: p.at }, session.startedAt),
      v: p.arousal,
    }))
    .filter((p) => p.t !== '');
  const peak = emotionData.reduce<(typeof emotionData)[number] | null>(
    (max, p) => (max === null || p.v > max.v ? p : max),
    null
  );

  // 每个 transcript seq 关联的评分项下标
  const itemsBySeq = new Map<number, number[]>();
  report.items.forEach((item, index) => {
    const list = itemsBySeq.get(item.quoteTurnSeq) ?? [];
    list.push(index);
    itemsBySeq.set(item.quoteTurnSeq, list);
  });
  const violationSeqs = new Map(report.violations.map((v) => [v.turnSeq, v]));

  /** 对话时间戳跳转到录像对应时刻并播放 */
  const seekVideo = (turn: TranscriptTurn) => {
    const v = videoRef.current;
    if (!v || !turn.at) return;
    const sec = (new Date(turn.at).getTime() - new Date(session.startedAt).getTime()) / 1000;
    if (Number.isNaN(sec) || sec < 0) return;
    v.currentTime = sec;
    void v.play().catch(() => {});
  };

  /** 时间戳：有录像时渲染为可点击跳转，否则纯文本 */
  const renderTurnTime = (turn: TranscriptTurn) =>
    session.videoUrl ? (
      <button
        className="text-gray-400 underline decoration-dotted underline-offset-2"
        onClick={() => seekVideo(turn)}
        title="跳转到录像对应时刻"
      >
        {turnTime(turn, session.startedAt)}
      </button>
    ) : (
      <span className="text-gray-400">{turnTime(turn, session.startedAt)}</span>
    );

  /** 评分项卡（判定依据 / 原文定位 / 更优话术 / 申诉） */
  const renderItemDetail = (index: number) => {
    const item = report.items[index];
    return (
      <div
        key={index}
        className="relative space-y-3 overflow-hidden rounded-xl bg-white p-3 text-[13px] leading-relaxed text-gray-700"
      >
        {item.isReference && (
          <span className="pointer-events-none absolute right-2 top-2 rotate-12 rounded border border-gray-300 px-1.5 py-0.5 text-[10px] font-semibold text-gray-300">
            参考项
          </span>
        )}
        <p>
          <span className="font-bold text-gray-900">档位：</span>
          {item.levelLabel}（{item.score} 分）
        </p>
        <div>
          <p className="font-bold text-gray-900">判定依据</p>
          <p className="mt-1">{item.rationale}</p>
        </div>
        {item.quote && (
          <p className="rounded-lg bg-gray-50 px-2.5 py-2 text-gray-600">
            <span className="font-bold text-gray-900">原文定位：</span>
            「{item.quote}」
          </p>
        )}
        {item.betterScript && (
          <div>
            <p className="font-bold text-gray-900">更优话术示范</p>
            <p className="mt-1">{item.betterScript}</p>
          </div>
        )}
        <p className="text-xs text-gray-400">
          判定置信度 {Math.round(item.confidence * 100)}%
          {item.judgeAgree ? ' · 双 judge 一致' : ' · 双 judge 不一致，已标注为参考项'}
        </p>
        {renderDisagreeBlock(`score_item:${index}`)}
      </div>
    );
  };

  return (
    <AppFrame className="px-4 pb-10 pt-5 lg:max-w-3xl">
      {/* 页头 */}
      <p className="text-xs text-gray-500">
        {scenario?.name ?? '练习场景'}
        {persona ? ` · ${persona.name}` : ''} · {session.mode === 'exam' ? '考核模式' : '练习模式'}
      </p>
      <h1 className="mt-1 text-2xl font-bold text-gray-900">本次复盘</h1>

      {/* ① 总览得分卡 */}
      <section className="mt-4 rounded-2xl bg-white p-4 shadow-sm">
        <div className="flex items-end justify-between">
          <div className="flex items-end gap-2">
            <span className="text-5xl font-bold leading-none text-[#17191F]">
              {report.totalScore}
            </span>
            {diff !== null && (
              <span
                className={`pb-0.5 text-sm font-medium ${
                  diff >= 0 ? 'text-green-600' : 'text-red-500'
                }`}
              >
                较上次 {diff >= 0 ? `+${diff}` : diff}
              </span>
            )}
            <span
              className={`mb-0.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                report.passed ? 'bg-[#d9efe6] text-[#2e9e77]' : 'bg-[#fde8ea] text-[#e05a6b]'
              }`}
            >
              {report.passed ? '已达标' : '未达标'}
            </span>
          </div>
          {passLine !== null && <span className="text-sm text-gray-500">达标线 {passLine}</span>}
        </div>

        {/* 红线警示 */}
        {fatalViolations.length > 0 && (
          <div className="mt-3 flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2.5">
            <svg
              className="mt-0.5 h-4 w-4 shrink-0 text-red-500"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
              />
            </svg>
            <p className="text-[13px] leading-snug text-red-600">
              {fatalViolations.map((v) => v.detail).join('；')}
              {report.fatalViolation ? ' → 本次一票否决，需强制重练同场景' : ''}
            </p>
          </div>
        )}

        {/* 对红线违规的"我不同意" */}
        {fatalViolations.length > 0 && renderDisagreeBlock('violation:0')}

        {/* 技能点得分条 */}
        <div className="mt-4 space-y-3">
          {report.skillScores.map((s) => {
            const ratio = s.maxScore > 0 ? s.score / s.maxScore : 0;
            const color = ratio >= 0.8 ? '#2e9e77' : ratio >= 0.4 ? '#f59e0b' : '#e05260';
            return (
              <div key={s.skillPointId} className="flex items-center gap-3">
                <span className="w-28 shrink-0 truncate text-sm text-gray-600">
                  {s.skillPointName}
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${Math.min(100, ratio * 100)}%`, backgroundColor: color }}
                  />
                </div>
                <span className="w-24 shrink-0 whitespace-nowrap text-right text-xs text-gray-500">
                  {s.score} / {s.maxScore}
                </span>
              </div>
            );
          })}
        </div>

        {/* 行为统计 */}
        <div className="mt-4 grid grid-cols-2 gap-3">
          {stats.map((s) => (
            <div key={s.label} className="rounded-xl bg-[#eef3f6] px-4 py-3">
              <p className="text-xs text-gray-500">{s.label}</p>
              <p className="mt-1 text-lg font-bold text-gray-900">{s.value}</p>
            </div>
          ))}
        </div>

        <p className="mt-4 text-xs leading-relaxed text-gray-400">
          判定置信度：
          {disagreeCount === 0
            ? '全部评分项双 judge 一致（高置信度）。'
            : `${disagreeCount} 个评分项双 judge 不一致，已标注为参考项。`}
        </p>

        {/* 对整体评价的"我不同意" */}
        {renderDisagreeBlock('overall')}
      </section>

      {/* ①.5 对练录像（有录像时才展示） */}
      {session.videoUrl && (
        <section className="mt-6">
          <h2 className="text-lg font-bold text-gray-900">对练录像</h2>
          <video
            ref={videoRef}
            controls
            playsInline
            preload="metadata"
            className="mt-3 w-full rounded-2xl bg-black shadow-sm"
            src={`${session.videoUrl}?token=${getToken() ?? ''}`}
          />
          <p className="mt-2 text-xs text-gray-400">
            点击下方对话回放中的时间戳，可跳转到录像对应时刻。
          </p>
        </section>
      )}

      {/* ② 对话回放 */}
      <section className="mt-6">
        <h2 className="text-lg font-bold text-gray-900">对话回放</h2>
        <div className="mt-3 space-y-3">
          {session.transcript.map((turn) => {
            if (turn.speaker === 'coach' || turn.isHint) {
              return (
                <div key={turn.seq} className="rounded-2xl border border-[#f0ddb2] bg-[#fdf3e1] px-4 py-3">
                  <p className="text-xs">
                    {renderTurnTime(turn)}
                    <span className="ml-2 font-medium text-[#c98a2d]">教练提示</span>
                  </p>
                  <p className="mt-2 text-[15px] leading-relaxed text-gray-900">{turn.text}</p>
                </div>
              );
            }
            const isTrainee = turn.speaker === 'trainee';
            const itemIdxs = itemsBySeq.get(turn.seq) ?? [];
            const violation = violationSeqs.get(turn.seq);
            const tone: Tone = !isTrainee
              ? 'white'
              : violation?.fatal
                ? 'red'
                : itemIdxs.some((i) => report.items[i].isReference)
                  ? 'orange'
                  : 'green';
            const style = TONE_STYLE[tone];
            const firstItem = itemIdxs[0];
            const tag =
              firstItem !== undefined
                ? report.items[firstItem].itemName
                : violation
                  ? '合规红线'
                  : undefined;
            return (
              <div key={turn.seq} className={`rounded-2xl px-4 py-3 ${style.card}`}>
                <div className="flex items-center justify-between">
                  <p className="text-xs">
                    {renderTurnTime(turn)}
                    <span className="ml-2 text-gray-400">
                      {isTrainee ? '我' : `客户 ${persona?.name ?? ''}`}
                    </span>
                  </p>
                  {tag && (
                    <button
                      className={`flex items-center gap-1 text-xs font-medium ${style.tag}`}
                      onClick={
                        firstItem !== undefined
                          ? () => setOpenItem((v) => (v === firstItem ? null : firstItem))
                          : undefined
                      }
                    >
                      {tone === 'green' ? (
                        <ThumbIcon className="h-3.5 w-3.5" />
                      ) : (
                        <FlagIcon className="h-3.5 w-3.5" />
                      )}
                      {tag}
                    </button>
                  )}
                </div>
                <p className="mt-2 text-[15px] leading-relaxed text-gray-900">{turn.text}</p>

                {/* 扣分点展开：档位 + 依据 + 原文定位 + 更优话术 + 我不同意 */}
                {firstItem !== undefined &&
                  openItem === firstItem &&
                  renderItemDetail(firstItem)}
              </div>
            );
          })}
        </div>
      </section>

      {/* ③ 评分明细（逐评分项，可分别提出异议） */}
      {report.items.length > 0 && (
        <section className="mt-6">
          <h2 className="text-lg font-bold text-gray-900">评分明细</h2>
          <div className="mt-3 space-y-3">
            {report.items.map((item, index) => (
              <div key={index} className="rounded-2xl bg-white p-4 shadow-sm">
                <button
                  className="flex w-full items-center justify-between text-left"
                  onClick={() => setOpenItem((v) => (v === index ? null : index))}
                >
                  <span className="text-[15px] font-bold text-gray-900">{item.itemName}</span>
                  <span className="flex items-center gap-2 text-xs text-gray-500">
                    {item.isReference && (
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-400">
                        参考
                      </span>
                    )}
                    <span className="font-semibold text-[#3d6b70]">{item.levelLabel}</span>
                    <svg
                      className={`h-4 w-4 transition ${openItem === index ? 'rotate-180' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </span>
                </button>
                {openItem === index && <div className="mt-3">{renderItemDetail(index)}</div>}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ③.5 视频表现（基于录像关键帧的多模态评审，不计入总分） */}
      {report.videoReview && (
        <section className="mt-6 rounded-2xl bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-gray-900">视频表现</h2>
            <span className="text-sm font-semibold text-[#3d6b70]">
              表情仪态 {report.videoReview.expressionScore} / 100
            </span>
          </div>
          {report.videoReview.summary && (
            <p className="mt-2 text-sm leading-relaxed text-gray-700">
              {report.videoReview.summary}
            </p>
          )}
          <div className="mt-3 space-y-1.5 text-sm text-gray-600">
            {report.videoReview.eyeContact && <p>· 眼神：{report.videoReview.eyeContact}</p>}
            {report.videoReview.expression && <p>· 表情：{report.videoReview.expression}</p>}
            {report.videoReview.lipSyncNote && (
              <p>· 口型与发声：{report.videoReview.lipSyncNote}</p>
            )}
          </div>
          {report.videoReview.suggestions.length > 0 && (
            <div className="mt-3 rounded-xl bg-[#eef3f6] px-3 py-2.5">
              <p className="text-xs font-medium text-gray-500">改进建议</p>
              <ul className="mt-1 list-disc space-y-1 pl-4 text-sm text-gray-700">
                {report.videoReview.suggestions.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="mt-3 text-xs text-gray-400">
            基于对练录像关键帧的多模态评审，仅作参考，不计入总分。
          </p>
        </section>
      )}

      {/* ④ 情绪曲线 */}
      <section className="mt-6 rounded-2xl bg-white p-4 shadow-sm">
        <h2 className="text-base font-bold text-gray-900">客户情绪曲线（唤醒度）</h2>
        {emotionData.length > 0 && peak ? (
          <>
            <p className="mt-1 text-sm text-gray-500">
              峰值出现在 {peak.t}，客户情绪升到{' '}
              <span className="font-bold text-red-500">{peak.v.toFixed(2)}</span>
            </p>
            <EmotionChart data={emotionData} />
          </>
        ) : (
          <p className="mt-3 text-sm text-gray-400">本次会话没有情绪记录</p>
        )}
      </section>

      {/* ⑤ 再练一次 */}
      <button
        className="mt-6 flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#0d5e63] text-base font-bold text-white shadow-lg transition active:scale-[0.98] disabled:opacity-50 lg:mx-auto lg:max-w-sm"
        onClick={retry}
        disabled={retrying || !scenario}
      >
        <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 5.5v13l11-6.5-11-6.5z" />
        </svg>
        {retrying ? '正在创建…' : '再练一次（同陪练员·换随机种子）'}
      </button>
    </AppFrame>
  );
}
