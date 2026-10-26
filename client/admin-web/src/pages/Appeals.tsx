import { useCallback, useEffect, useState } from 'react';
import api from '../api';
import { AdminSectionTabs } from '../components/Layout';

type AppealStatus = 'pending' | 'upheld' | 'rejected';

interface AppealItemBrief {
  itemName: string;
  levelLabel: string;
  score: number;
  quote?: string;
  rationale?: string;
  isReference?: boolean;
}

interface Appeal {
  id: string;
  sessionId: string;
  targetType?: 'score_item' | 'violation' | 'overall';
  scoreItemResultIndex?: number;
  violationIndex?: number;
  userId: string;
  reason: string;
  status: AppealStatus;
  resolution?: string;
  createdAt: string;
  resolvedAt?: string;
  scenarioName?: string;
  userName?: string;
  scoreItemResult?: AppealItemBrief;
  violation?: { ruleId: string; kind: string; detail: string; fatal: boolean } | null;
  reReview?: {
    verdict: 'agree' | 'disagree' | 'partial';
    rationale: string;
    suggestedScore?: number;
    reviewedAt: string;
  };
}

interface TranscriptEntry {
  seq: number;
  speaker: 'trainee' | 'persona' | 'coach' | string;
  text: string;
  at?: string;
  isHint?: boolean;
}

interface AppealDetailItem extends AppealItemBrief {
  quoteTurnSeq?: number;
  confidence?: number;
  judgeAgree?: boolean;
  isObservation?: boolean;
}

interface AppealDetail {
  appeal: Appeal;
  session?: { id: string; transcript?: TranscriptEntry[] };
  scoreItemResult?: AppealDetailItem;
}

const statusTabs: { key: AppealStatus | ''; label: string }[] = [
  { key: '', label: '全部' },
  { key: 'pending', label: '待复核' },
  { key: 'upheld', label: '已成立' },
  { key: 'rejected', label: '已驳回' },
];

const statusBadge: Record<AppealStatus, { label: string; cls: string }> = {
  pending: { label: '待复核', cls: 'bg-yellow-100 text-yellow-800' },
  upheld: { label: '已成立', cls: 'bg-green-100 text-green-800' },
  rejected: { label: '已驳回', cls: 'bg-gray-200 text-gray-600' },
};

function Badge({ status }: { status: AppealStatus }) {
  const b = statusBadge[status] ?? statusBadge.pending;
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${b.cls}`}>
      {b.label}
    </span>
  );
}

function fmtTime(t?: string) {
  if (!t) return '-';
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? t : d.toLocaleString('zh-CN', { hour12: false });
}

const speakerStyle: Record<string, { label: string; wrap: string; bubble: string }> = {
  trainee: { label: '学员', wrap: 'justify-end', bubble: 'bg-blue-600 text-white' },
  persona: { label: '客户', wrap: 'justify-start', bubble: 'bg-white border border-gray-200' },
  coach: { label: '教练', wrap: 'justify-start', bubble: 'bg-orange-50 border border-orange-300 text-orange-900' },
};

export default function Appeals() {
  const [tab, setTab] = useState<AppealStatus | ''>('');
  const [appeals, setAppeals] = useState<Appeal[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState('');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AppealDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [resolution, setResolution] = useState('');
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState('');

  const loadList = useCallback(async (status: AppealStatus | '') => {
    setListLoading(true);
    setListError('');
    try {
      const res = await api.get<Appeal[] | { appeals?: Appeal[] }>('/appeals', {
        params: status ? { status } : {},
      });
      const d = res.data;
      setAppeals(Array.isArray(d) ? d : (d?.appeals ?? []));
    } catch {
      setListError('加载申诉列表失败，请确认后端服务已启动');
      setAppeals([]);
    } finally {
      setListLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const res = await api.get<AppealDetail>(`/appeals/${id}`);
      setDetail(res.data);
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    loadList(tab);
  }, [tab, loadList]);

  useEffect(() => {
    if (selectedId) {
      setResolution('');
      setResolveError('');
      loadDetail(selectedId);
    } else {
      setDetail(null);
    }
  }, [selectedId, loadDetail]);

  const resolve = async (status: 'upheld' | 'rejected') => {
    if (!selectedId) return;
    if (!resolution.trim()) {
      setResolveError('请填写归因意见');
      return;
    }
    setResolving(true);
    setResolveError('');
    try {
      await api.post(`/appeals/${selectedId}/resolve`, {
        status,
        resolution: resolution.trim(),
      });
      await Promise.all([loadList(tab), loadDetail(selectedId)]);
    } catch {
      setResolveError('裁定提交失败，请重试');
    } finally {
      setResolving(false);
    }
  };

  const detailAppeal = detail?.appeal;
  const detailItem: AppealDetailItem | undefined =
    detail?.scoreItemResult ?? detailAppeal?.scoreItemResult;
  const quoteSeq = detailItem?.quoteTurnSeq;

  return (
    <div>
      <AdminSectionTabs />
      <h1 className="text-xl font-semibold mb-4">申诉复核</h1>

      <div className="flex gap-1 mb-4 border-b border-gray-300">
        {statusTabs.map((t) => (
          <button
            key={t.key}
            onClick={() => {
              setTab(t.key);
              setSelectedId(null);
            }}
            className={`px-4 py-2 text-sm -mb-px border-b-2 ${
              tab === t.key
                ? 'border-blue-600 text-blue-600 font-medium'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex flex-col lg:flex-row gap-4 items-start">
        {/* 申诉列表 */}
        <div className="w-full lg:w-96 shrink-0 space-y-2">
          {listLoading && <p className="text-sm text-gray-500 py-8 text-center">加载中…</p>}
          {!listLoading && listError && (
            <p className="text-sm text-red-600 py-8 text-center">{listError}</p>
          )}
          {!listLoading && !listError && appeals.length === 0 && (
            <div className="py-12 text-center text-sm text-gray-400 bg-white rounded-lg border border-gray-200">
              暂无申诉记录
            </div>
          )}
          {appeals.map((a) => (
            <button
              key={a.id}
              onClick={() => setSelectedId(a.id)}
              className={`w-full text-left bg-white rounded-lg border p-3 transition-colors ${
                selectedId === a.id
                  ? 'border-blue-500 ring-1 ring-blue-500'
                  : 'border-gray-200 hover:border-gray-400'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium">{a.userName ?? a.userId}</span>
                <div className="flex items-center gap-1">
                  {a.reReview && (
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                      a.reReview.verdict === 'agree' ? 'bg-gray-100 text-gray-600'
                      : a.reReview.verdict === 'disagree' ? 'bg-green-100 text-green-700'
                      : 'bg-orange-100 text-orange-700'
                    }`}>
                      {a.reReview.verdict === 'agree' ? '复评:维持' : a.reReview.verdict === 'disagree' ? '复评:支持' : '复评:部分'}
                    </span>
                  )}
                  <Badge status={a.status} />
                </div>
              </div>
              <p className="text-xs text-gray-500 mb-1">
                {a.scenarioName ?? '未知场景'} ·{' '}
                {a.targetType === 'violation' ? '红线违规' : a.targetType === 'overall' ? '整体评价' : (a.scoreItemResult?.itemName ?? '-')}
                {a.scoreItemResult?.levelLabel ? `（${a.scoreItemResult.levelLabel}）` : ''}
              </p>
              <p className="text-xs text-gray-600 line-clamp-2">{a.reason}</p>
              <p className="text-xs text-gray-400 mt-1">{fmtTime(a.createdAt)}</p>
            </button>
          ))}
        </div>

        {/* 详情面板 */}
        <div className="flex-1 min-w-0">
          {!selectedId && (
            <div className="py-20 text-center text-sm text-gray-400 bg-white rounded-lg border border-gray-200">
              从左侧选择一条申诉查看详情
            </div>
          )}
          {selectedId && detailLoading && (
            <p className="text-sm text-gray-500 py-20 text-center">加载详情…</p>
          )}
          {selectedId && !detailLoading && !detailAppeal && (
            <p className="text-sm text-red-600 py-20 text-center">加载详情失败</p>
          )}
          {selectedId && !detailLoading && detailAppeal && (
            <div className="space-y-4">
              {/* 被申诉评分项 */}
              <section className="bg-white rounded-lg border border-gray-200 p-4">
                <h2 className="text-sm font-semibold mb-3">被申诉评分项</h2>
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-base font-medium">{detailItem?.itemName ?? '-'}</span>
                  <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-800 text-xs font-medium">
                    {detailItem?.levelLabel ?? '-'} · {detailItem?.score ?? '-'} 分
                  </span>
                  {detailItem?.isReference && (
                    <span className="px-2 py-0.5 rounded bg-purple-100 text-purple-800 text-xs">
                      双 judge 不一致·参考
                    </span>
                  )}
                  {detailItem?.isObservation && (
                    <span className="px-2 py-0.5 rounded bg-gray-100 text-gray-600 text-xs">观察项</span>
                  )}
                </div>
                {detailItem?.rationale && (
                  <p className="text-sm text-gray-700 mb-2">
                    <span className="text-gray-400">依据：</span>
                    {detailItem.rationale}
                  </p>
                )}
                {detailItem?.quote && (
                  <blockquote className="text-sm text-gray-600 border-l-2 border-gray-300 pl-3 mb-2">
                    「{detailItem.quote}」
                    {quoteSeq != null && (
                      <span className="text-xs text-gray-400 ml-2">第 {quoteSeq} 轮</span>
                    )}
                  </blockquote>
                )}
                <div className="flex gap-4 text-xs text-gray-500">
                  {detailItem?.confidence != null && (
                    <span>置信度 {(detailItem.confidence * 100).toFixed(0)}%</span>
                  )}
                  {detailItem?.judgeAgree != null && (
                    <span>judge 一致：{detailItem.judgeAgree ? '是' : '否'}</span>
                  )}
                </div>
              </section>

              {/* 申诉理由 */}
              <section className="bg-white rounded-lg border border-gray-200 p-4">
                <h2 className="text-sm font-semibold mb-2">申诉理由</h2>
                <p className="text-sm text-gray-700 whitespace-pre-wrap">{detailAppeal.reason}</p>
              </section>

              {/* AI 复评结果 */}
              {detailAppeal.reReview && (
                <section className="bg-white rounded-lg border border-blue-200 p-4">
                  <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
                    <svg className="h-4 w-4 text-blue-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                    AI 复评结果
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      detailAppeal.reReview.verdict === 'agree' ? 'bg-gray-100 text-gray-600'
                      : detailAppeal.reReview.verdict === 'disagree' ? 'bg-green-100 text-green-700'
                      : 'bg-orange-100 text-orange-700'
                    }`}>
                      {detailAppeal.reReview.verdict === 'agree' ? '维持原评' : detailAppeal.reReview.verdict === 'disagree' ? '支持异议' : '部分支持'}
                    </span>
                    {detailAppeal.reReview.suggestedScore !== undefined && (
                      <span className="text-xs text-gray-500">建议分数 {detailAppeal.reReview.suggestedScore}</span>
                    )}
                  </h2>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{detailAppeal.reReview.rationale}</p>
                  <p className="text-xs text-gray-400 mt-2">复评时间：{fmtTime(detailAppeal.reReview.reviewedAt)}</p>
                </section>
              )}

              {/* 对话回放 */}
              <section className="bg-white rounded-lg border border-gray-200 p-4">
                <h2 className="text-sm font-semibold mb-3">对话回放</h2>
                {detail?.session?.transcript && detail.session.transcript.length > 0 ? (
                  <div className="space-y-2 max-h-64 lg:max-h-96 overflow-y-auto pr-1">
                    {detail.session.transcript.map((t) => {
                      const s = speakerStyle[t.speaker] ?? speakerStyle.persona;
                      const highlighted = quoteSeq != null && t.seq === quoteSeq;
                      return (
                        <div key={t.seq} className={`flex ${s.wrap}`}>
                          <div
                            className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${s.bubble} ${
                              highlighted ? 'ring-2 ring-yellow-400' : ''
                            }`}
                          >
                            <span className={`block text-xs mb-0.5 ${t.speaker === 'trainee' ? 'text-blue-200' : 'text-gray-400'}`}>
                              #{t.seq} {s.label}
                              {t.isHint ? ' · 提示' : ''}
                              {highlighted ? ' · 引用轮次' : ''}
                            </span>
                            {t.text}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-gray-400">暂无对话记录</p>
                )}
              </section>

              {/* 裁定区 */}
              {detailAppeal.status === 'pending' ? (
                <section className="bg-white rounded-lg border border-gray-200 p-4">
                  <h2 className="text-sm font-semibold mb-3">裁定</h2>
                  <textarea
                    value={resolution}
                    onChange={(e) => setResolution(e.target.value)}
                    rows={3}
                    placeholder="归因意见（必填）：说明评分是否有误及原因"
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                  />
                  {resolveError && <p className="text-xs text-red-600 mt-1">{resolveError}</p>}
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={() => resolve('upheld')}
                      disabled={resolving}
                      className="px-4 py-2 rounded-md bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-50"
                    >
                      裁定成立
                    </button>
                    <button
                      onClick={() => resolve('rejected')}
                      disabled={resolving}
                      className="px-4 py-2 rounded-md bg-gray-500 text-white text-sm font-medium hover:bg-gray-600 disabled:opacity-50"
                    >
                      裁定驳回
                    </button>
                  </div>
                </section>
              ) : (
                <section className="bg-white rounded-lg border border-gray-200 p-4">
                  <h2 className="text-sm font-semibold mb-2">裁定结果</h2>
                  <div className="flex items-center gap-2 mb-2">
                    <Badge status={detailAppeal.status} />
                    <span className="text-xs text-gray-400">{fmtTime(detailAppeal.resolvedAt)}</span>
                  </div>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">
                    {detailAppeal.resolution ?? '（无归因意见）'}
                  </p>
                </section>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
