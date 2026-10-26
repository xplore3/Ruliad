import { Fragment, useCallback, useEffect, useState } from 'react';
import api from '../../api';

interface TranscriptTurn {
  seq: number;
  speaker: string;
  text: string;
}

interface GoldenCase {
  id: string;
  name: string;
  transcript: TranscriptTurn[];
  expected: { itemId: string; levelKey: string }[];
}

interface RegressionRun {
  id: string;
  at: string;
  totalCases: number;
  matched: number;
  errorRate: number;
  passed: boolean;
  details: {
    caseId: string;
    itemId: string;
    expected: string;
    actual: string;
    match: boolean;
  }[];
}

const fmtTime = (iso: string) => new Date(iso).toLocaleString();
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

export default function Regression() {
  const [cases, setCases] = useState<GoldenCase[]>([]);
  const [runs, setRuns] = useState<RegressionRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');

  const [expandedId, setExpandedId] = useState('');
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState('');
  const [lastRun, setLastRun] = useState<{ run: RegressionRun; gatePassed: boolean } | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [c, r] = await Promise.all([
        api.get<{ cases: GoldenCase[] }>('/workshop/golden-cases'),
        api.get<{ runs: RegressionRun[] }>('/workshop/regression-runs'),
      ]);
      setCases(c.data?.cases ?? []);
      setRuns(r.data?.runs ?? []);
    } catch {
      setLoadError('加载数据失败，请确认后端服务已启动');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const runRegression = async () => {
    setRunning(true);
    setRunError('');
    try {
      const res = await api.post<{ run: RegressionRun; gatePassed: boolean }>(
        '/workshop/regression-runs/run',
      );
      setLastRun(res.data);
      await loadAll();
    } catch {
      setRunError('回归运行失败，请重试');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">回归测试</h1>
        <button
          onClick={runRegression}
          disabled={running || cases.length === 0}
          className="px-6 py-2.5 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {running ? '回归运行中…' : '运行回归'}
        </button>
      </div>

      {runError && <p className="text-sm text-red-600 mb-3">{runError}</p>}

      {lastRun && (
        <div
          className={`rounded-lg border p-5 mb-4 ${
            lastRun.gatePassed
              ? 'bg-green-50 border-green-200'
              : 'bg-red-50 border-red-200'
          }`}
        >
          <div className="flex items-center justify-between">
            <div>
              <p
                className={`text-2xl font-bold ${
                  lastRun.gatePassed ? 'text-green-700' : 'text-red-700'
                }`}
              >
                {lastRun.gatePassed ? '闸门通过' : '闸门未通过'}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                {fmtTime(lastRun.run.at)} · 闸门阈值 80%
              </p>
            </div>
            <div className="text-right text-sm text-gray-700 space-y-1">
              <p>总用例数：{lastRun.run.totalCases}</p>
              <p>
                匹配：{lastRun.run.matched}/{lastRun.run.details.length} 项断言
              </p>
              <p>通过率：{pct(1 - lastRun.run.errorRate)}</p>
            </div>
          </div>
        </div>
      )}

      <h2 className="text-sm font-medium text-gray-700 mb-2">金标准用例</h2>
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden mb-6">
        {loading ? (
          <p className="text-sm text-gray-500 py-12 text-center">加载中…</p>
        ) : loadError && cases.length === 0 ? (
          <p className="text-sm text-red-600 py-12 text-center">{loadError}</p>
        ) : cases.length === 0 ? (
          <p className="text-sm text-gray-400 py-12 text-center">暂无金标准用例</p>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs text-gray-500">
                <th className="px-4 py-2.5 font-medium">用例名称</th>
                <th className="px-4 py-2.5 font-medium">对话轮数</th>
                <th className="px-4 py-2.5 font-medium">期望断言</th>
              </tr>
            </thead>
            <tbody>
              {cases.map((c) => {
                const expanded = expandedId === c.id;
                return (
                  <Fragment key={c.id}>
                    <tr
                      className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer"
                      onClick={() => setExpandedId(expanded ? '' : c.id)}
                    >
                      <td className="px-4 py-2.5 font-medium">{c.name}</td>
                      <td className="px-4 py-2.5">{c.transcript.length}</td>
                      <td className="px-4 py-2.5 text-gray-600">
                        {c.expected.map((e) => `${e.itemId}=${e.levelKey}`).join('，')}
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="border-t border-gray-100 bg-gray-50">
                        <td colSpan={3} className="px-4 py-3">
                          <div className="space-y-1.5">
                            {c.transcript.map((t) => (
                              <p key={t.seq} className="text-sm">
                                <span
                                  className={`inline-block w-16 shrink-0 text-xs ${
                                    t.speaker === 'trainee' ? 'text-blue-600' : 'text-gray-500'
                                  }`}
                                >
                                  {t.speaker === 'trainee' ? '学员' : '客户'}
                                </span>
                                <span className="text-gray-700">{t.text}</span>
                              </p>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
      </div>

      <h2 className="text-sm font-medium text-gray-700 mb-2">历史跑分</h2>
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        {runs.length === 0 ? (
          <p className="text-sm text-gray-400 py-12 text-center">
            暂无回归记录，点击右上角「运行回归」发起首次跑分
          </p>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs text-gray-500">
                <th className="px-4 py-2.5 font-medium">时间</th>
                <th className="px-4 py-2.5 font-medium">总用例数</th>
                <th className="px-4 py-2.5 font-medium">匹配断言</th>
                <th className="px-4 py-2.5 font-medium">通过率</th>
                <th className="px-4 py-2.5 font-medium">闸门结果</th>
              </tr>
            </thead>
            <tbody>
              {[...runs].reverse().map((r) => (
                <tr key={r.id} className="border-t border-gray-100">
                  <td className="px-4 py-2.5 text-gray-600">{fmtTime(r.at)}</td>
                  <td className="px-4 py-2.5">{r.totalCases}</td>
                  <td className="px-4 py-2.5">
                    {r.matched}/{r.details.length}
                  </td>
                  <td className="px-4 py-2.5">{pct(1 - r.errorRate)}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`px-2 py-0.5 rounded text-xs ${
                        r.passed ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                      }`}
                    >
                      {r.passed ? '通过' : '未通过'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  );
}
