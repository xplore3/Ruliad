import { useCallback, useEffect, useState } from 'react';
import api from '../../api';

interface Observation {
  itemId: string;
  itemName: string;
  occurrences: number;
  avgScoreWhenPresent: number;
  overallPassRate: number;
  note: string;
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

export default function Observations() {
  const [observations, setObservations] = useState<Observation[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');

  const loadAll = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const res = await api.get<{ observations: Observation[] } | Observation[]>(
        '/workshop/observations',
      );
      const data = res.data;
      setObservations(Array.isArray(data) ? data : (data?.observations ?? []));
    } catch {
      setLoadError('加载数据失败，请确认后端服务已启动');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  return (
    <div>
      <h1 className="text-xl font-semibold mb-2">观察项</h1>
      <p className="text-xs text-gray-500 mb-4">
        观察项不计分，积累 4–6 周数据后供校准会议裁决是否转为正式评分项。
      </p>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        {loading ? (
          <p className="text-sm text-gray-500 py-12 text-center">加载中…</p>
        ) : loadError && observations.length === 0 ? (
          <p className="text-sm text-red-600 py-12 text-center">{loadError}</p>
        ) : observations.length === 0 ? (
          <p className="text-sm text-gray-400 py-12 text-center">
            暂无观察项数据：将评分项标记为「观察项」并完成若干考核会话后，此处自动聚合统计
          </p>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs text-gray-500">
                <th className="px-4 py-2.5 font-medium">评分项</th>
                <th className="px-4 py-2.5 font-medium">出现次数</th>
                <th className="px-4 py-2.5 font-medium">出现时均分</th>
                <th className="px-4 py-2.5 font-medium">整体通过率</th>
                <th className="px-4 py-2.5 font-medium">说明</th>
              </tr>
            </thead>
            <tbody>
              {observations.map((o) => (
                <tr key={o.itemId} className="border-t border-gray-100">
                  <td className="px-4 py-2.5 font-medium">{o.itemName}</td>
                  <td className="px-4 py-2.5">{o.occurrences}</td>
                  <td className="px-4 py-2.5">{o.avgScoreWhenPresent}</td>
                  <td className="px-4 py-2.5">{pct(o.overallPassRate)}</td>
                  <td className="px-4 py-2.5 text-gray-500 text-xs">{o.note}</td>
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
