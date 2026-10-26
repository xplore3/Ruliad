import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import api from '../api';
import type {
  Appeal,
  AppealsResponse,
  CertHistoryItem,
  CreateSessionResponse,
  ExamWindow,
  ExamWindowsResponse,
} from '../types';

function formatDateTime(at: string): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 设计图静态内容：考核窗口规则
const examRules = [
  '考核模式禁用「暂停求提示」',
  '全程录音，成绩自动上报主管与管理看板',
  '未通过者进入补练任务流，7 天后允许补考',
];

const APPEAL_STATUS: Record<Appeal['status'], { label: string; cls: string }> = {
  pending: { label: '待复核', cls: 'bg-[#fdf3e0] text-[#c98a2d]' },
  upheld: { label: '申诉成功', cls: 'bg-[#d9efe6] text-[#2e9e77]' },
  rejected: { label: '已驳回', cls: 'bg-[#fde8ea] text-[#e05a6b]' },
};

export default function Exams() {
  const navigate = useNavigate();
  const [windows, setWindows] = useState<ExamWindow[] | null>(null);
  const [certs, setCerts] = useState<CertHistoryItem[] | null>(null);
  const [appeals, setAppeals] = useState<Appeal[] | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const appealsRef = useRef<HTMLElement>(null);

  useEffect(() => {
    api
      .get<ExamWindowsResponse>('/exam-windows')
      .then((res) => setWindows(res.data.windows))
      .catch(() => setWindows([]));
    api
      .get<CertHistoryItem[]>('/my-cert-history')
      .then((res) => setCerts(res.data))
      .catch(() => setCerts([]));
    api
      .get<AppealsResponse>('/appeals')
      .then((res) => setAppeals(res.data.appeals))
      .catch(() => setAppeals([]));
  }, []);

  // 当前窗口：优先 open，其次最近一个
  const win = windows?.find((w) => w.status === 'open') ?? windows?.[0] ?? null;

  const startExam = async () => {
    if (starting) return;
    const scenarioId = win?.scenarioIds[0];
    if (!win || !scenarioId) {
      window.alert('考核暂未开放，请稍后重试');
      return;
    }
    setStarting(true);
    setStartError(null);
    try {
      const res = await api.post<CreateSessionResponse>('/sessions', {
        scenarioId,
        mode: 'exam',
        examWindowId: win.id,
      });
      navigate(`/session/${res.data.session.id}`, { state: { ...res.data, mode: 'exam' } });
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 409) {
        const data = err.response.data as { error?: string; nextRetakeAt?: string };
        const retry = data.nextRetakeAt
          ? `（${formatDateTime(data.nextRetakeAt)} 后可补考）`
          : '';
        setStartError(`${data.error ?? '冷却期内暂不能补考'}${retry}`);
      } else {
        window.alert('进入考核失败，请稍后重试');
      }
    } finally {
      setStarting(false);
    }
  };

  // 发起申诉：跳到最近一次考核会话的复盘页（在复盘页可对具体评分项申诉）；
  // 找不到会话时滚动到申诉记录区
  const goAppeal = () => {
    const sessionId = appeals?.[0]?.sessionId ?? certs?.[0]?.sessionIds?.[0];
    if (sessionId) {
      navigate(`/session/${sessionId}/review`);
    } else {
      appealsRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const cooldown =
    win?.myStatus === 'cooldown' && win.nextRetakeAt
      ? new Date(win.nextRetakeAt).getTime() > Date.now()
      : false;

  return (
    <div className="space-y-5 p-4 lg:grid lg:grid-cols-2 lg:gap-5 lg:space-y-0 lg:p-0">
      <h1 className="text-2xl font-bold text-gray-900 lg:col-span-2">考核中心</h1>

      {/* 当前考核窗口 */}
      <section className="rounded-2xl bg-[#17191F] p-5 shadow-lg lg:col-span-2">
        <p className="flex items-center gap-2 text-sm font-semibold text-orange-500">
          <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {win ? (win.status === 'open' ? '当前开窗中' : '考核窗口') : '暂无考核窗口'}
        </p>
        {win ? (
          <>
            <h2 className="mt-2 text-xl font-bold text-white">
              {win.name} · {win.scenarioIds.length} 个指定场景
            </h2>
            <p className="mt-2 text-sm text-slate-300">
              窗口 {formatDateTime(win.startsAt)} ~ {formatDateTime(win.endsAt)}
              {win.myBestScore !== null ? ` · 我的最好成绩 ${win.myBestScore}` : ''}
            </p>
            <ul className="mt-3 space-y-1.5 text-sm leading-relaxed text-slate-300">
              {examRules.map((rule) => (
                <li key={rule}>·{rule}</li>
              ))}
            </ul>
            {win.myStatus === 'passed' ? (
              <p className="mt-5 rounded-xl bg-[#2e9e77]/20 px-4 py-3 text-sm font-semibold text-[#7fd6b5]">
                已通过本窗口考核{win.myCert ? ` · ${win.myCert.totalScore} 分` : ''}
              </p>
            ) : cooldown ? (
              <p className="mt-5 rounded-xl bg-white/5 px-4 py-3 text-sm font-semibold text-orange-400">
                补考冷却中 · {formatDateTime(win.nextRetakeAt!)} 后可补考
              </p>
            ) : (
              <button
                className="mt-5 min-h-13 w-full rounded-xl bg-orange-500 py-3 text-base font-bold text-[#17191F] shadow disabled:opacity-60 lg:w-auto lg:min-w-64 lg:px-10"
                onClick={startExam}
                disabled={starting || win.status !== 'open'}
              >
                {starting
                  ? '正在进入…'
                  : win.myStatus === 'in_progress'
                    ? '继续考核'
                    : win.myStatus === 'failed'
                      ? '重新补考'
                      : '开始考核'}
              </button>
            )}
            {startError && <p className="mt-3 text-sm text-red-400">{startError}</p>}
          </>
        ) : (
          <p className="mt-3 text-sm text-slate-300">
            {windows === null ? '正在加载…' : '当前没有开放的考核窗口，请留意后续通知'}
          </p>
        )}
      </section>

      {/* 历史成绩 */}
      <section className="rounded-2xl bg-white p-4 shadow-sm">
        <h2 className="text-base font-bold text-gray-900">历史成绩</h2>
        {certs === null ? (
          <p className="mt-3 text-sm text-gray-400">正在加载…</p>
        ) : certs.length === 0 ? (
          <p className="mt-3 text-sm text-gray-400">还没有考核成绩</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {certs.map((cert) => (
              <li key={cert.id} className="rounded-xl bg-[#eef3f6] px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                    <svg
                      className={`h-5 w-5 ${cert.passed ? 'text-[#2e9e77]' : 'text-[#e08a97]'}`}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.8}
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                      />
                    </svg>
                    {cert.examWindowName ?? '认证考核'}
                  </span>
                  <span
                    className={`text-sm font-semibold ${
                      cert.passed ? 'text-[#2e9e77]' : 'text-red-500'
                    }`}
                  >
                    {cert.passed ? '通过' : '未通过'}
                  </span>
                </div>
                <p className="mt-1 pl-7 text-xs text-gray-500">
                  {cert.issuedAt.slice(0, 10)} · 加权 {cert.totalScore}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 评分申诉 */}
      <section ref={appealsRef} className="rounded-2xl bg-white p-4 shadow-sm">
        <h2 className="flex items-center gap-2 text-base font-bold text-gray-900">
          <svg className="h-5 w-5 text-orange-500" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M7 3h7l5 5v13H7V3z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v4" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 17h.01" />
          </svg>
          评分申诉
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-gray-600">
          对单条评分有异议可提交申诉，进入人工复核队列（当前平均 18 小时内回复，平台误判率
          2.4%）。
        </p>
        <button
          className="mt-4 min-h-12 w-full rounded-xl border border-gray-300 bg-white py-3 text-base font-semibold text-gray-900 shadow-sm"
          onClick={goAppeal}
        >
          发起申诉
        </button>

        {/* 我的申诉记录 */}
        {appeals !== null && appeals.length > 0 && (
          <ul className="mt-4 space-y-3">
            {appeals.map((appeal) => {
              const status = APPEAL_STATUS[appeal.status];
              return (
                <li key={appeal.id} className="rounded-xl bg-[#eef3f6] px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-gray-900">
                      {appeal.scenarioName ?? '练习场景'} ·{' '}
                      {appeal.scoreItemResult?.itemName ?? (appeal.violation ? `红线违规` : '整体评价')}
                    </span>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${status.cls}`}
                    >
                      {status.label}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    {appeal.createdAt.slice(0, 10)} · {appeal.reason}
                  </p>
                  {appeal.reReview && (
                    <div className="mt-1.5 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5">
                      <span className="text-xs font-medium text-blue-700">
                        AI 复评：
                        {appeal.reReview.verdict === 'agree' ? '维持原评' : appeal.reReview.verdict === 'disagree' ? '支持异议' : '部分支持'}
                      </span>
                      <p className="mt-0.5 text-xs text-gray-600">{appeal.reReview.rationale}</p>
                    </div>
                  )}
                  {appeal.resolution && (
                    <p className="mt-1.5 rounded-lg bg-white px-2.5 py-1.5 text-xs text-gray-600">
                      复核结论：{appeal.resolution}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* 隐私说明 */}
      <p className="text-xs leading-relaxed text-gray-500 lg:col-span-2">
        隐私铁律：练习模式的对话明细与分数仅你本人可见，主管与管理端只能看到考核结果。
      </p>
    </div>
  );
}
