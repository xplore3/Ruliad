import { useCallback, useEffect, useState } from 'react';
import api from '../../api';

type Stage = 'collecting' | 'analyzing' | 'encoding' | 'validating' | 'done';

interface ExtractionProject {
  id: string;
  tenantId: string;
  name: string;
  recordingRefs: string[];
  diffFindings: string[];
  interviewNotes: string[];
  status: Stage;
  createdAt: string;
}

const STAGES: { key: Stage; label: string }[] = [
  { key: 'collecting', label: '采集' },
  { key: 'analyzing', label: '分析' },
  { key: 'encoding', label: '编码' },
  { key: 'validating', label: '验证' },
  { key: 'done', label: '完成' },
];

const STAGE_BADGE: Record<Stage, string> = {
  collecting: 'bg-gray-100 text-gray-600',
  analyzing: 'bg-blue-50 text-blue-700',
  encoding: 'bg-purple-50 text-purple-700',
  validating: 'bg-yellow-50 text-yellow-700',
  done: 'bg-green-50 text-green-700',
};

const fmtTime = (iso: string) => new Date(iso).toLocaleString();

export default function Pipeline() {
  const [projects, setProjects] = useState<ExtractionProject[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [recordingRefs, setRecordingRefs] = useState('');
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [advancingId, setAdvancingId] = useState('');
  const [confirmedNotes, setConfirmedNotes] = useState<Record<string, boolean>>({});

  const loadAll = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const res = await api.get<{ projects: ExtractionProject[] }>(
        '/workshop/extraction-projects',
      );
      setProjects(res.data?.projects ?? []);
    } catch {
      setLoadError('加载数据失败，请确认后端服务已启动');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const advance = async (p: ExtractionProject) => {
    setAdvancingId(p.id);
    setLoadError('');
    try {
      await api.post(`/workshop/extraction-projects/${p.id}/advance`);
      await loadAll();
    } catch {
      setLoadError('推进失败，请重试');
    } finally {
      setAdvancingId('');
    }
  };

  const submit = async () => {
    if (!name.trim()) return setFormError('请填写项目名称');
    setSubmitting(true);
    setFormError('');
    try {
      await api.post('/workshop/extraction-projects', {
        name: name.trim(),
        recordingRefs: recordingRefs
          .split(/[,，\n]/)
          .map((s) => s.trim())
          .filter(Boolean),
      });
      setName('');
      setRecordingRefs('');
      setShowForm(false);
      await loadAll();
    } catch {
      setFormError('创建失败，请重试');
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls =
    'w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500';

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">陪练员构建流水线</h1>
        <button
          onClick={() => {
            setShowForm((v) => !v);
            setFormError('');
          }}
          className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
        >
          {showForm ? '收起' : '新建项目'}
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">项目名称 *</label>
              <input
                className={inputCls}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：销冠王姐录音萃取"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">
                录音引用（多个用逗号分隔，可空）
              </label>
              <input
                className={inputCls}
                value={recordingRefs}
                onChange={(e) => setRecordingRefs(e.target.value)}
                placeholder="rec-001.mp3, rec-002.mp3"
              />
            </div>
          </div>
          {formError && <p className="text-xs text-red-600 mt-3">{formError}</p>}
          <div className="mt-4">
            <button
              onClick={submit}
              disabled={submitting}
              className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? '提交中…' : '创建项目'}
            </button>
          </div>
        </div>
      )}

      {loadError && <p className="text-sm text-red-600 mb-3">{loadError}</p>}

      {loading ? (
        <p className="text-sm text-gray-500 py-12 text-center">加载中…</p>
      ) : (
        <div className="overflow-x-auto">
        <div className="grid grid-cols-5 gap-3 items-start min-w-[1100px]">
          {STAGES.map((stage) => {
            const column = projects.filter((p) => p.status === stage.key);
            return (
              <div key={stage.key} className="bg-gray-50 rounded-lg border border-gray-200 p-3">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-medium">{stage.label}</p>
                  <span className="text-xs text-gray-400">{column.length}</span>
                </div>
                {column.length === 0 && (
                  <p className="text-xs text-gray-300 text-center py-6">无项目</p>
                )}
                {column.map((p) => (
                  <div
                    key={p.id}
                    className="bg-white rounded-md border border-gray-200 p-3 mb-2 last:mb-0"
                  >
                    <p className="text-sm font-medium">{p.name}</p>
                    <p className="text-xs text-gray-400 mt-1">{fmtTime(p.createdAt)}</p>
                    <div className="mt-2">
                      <span className={`px-2 py-0.5 rounded text-xs ${STAGE_BADGE[p.status]}`}>
                        {STAGES.find((s) => s.key === p.status)?.label ?? p.status}
                      </span>
                    </div>
                    {p.recordingRefs.length > 0 && (
                      <p className="text-xs text-gray-500 mt-2 truncate">
                        素材：{p.recordingRefs.join('、')}
                      </p>
                    )}
                    {p.interviewNotes.length > 0 && (
                      <div className="mt-2 rounded border border-purple-100 bg-purple-50/50 p-2">
                        <p className="text-xs text-purple-700 font-medium mb-1">
                          LLM 草稿 · 需人工确认
                        </p>
                        <div className="flex gap-2">
                          <div className="flex-1 space-y-1">
                            {p.interviewNotes.map((note, i) => (
                              <p key={i} className="text-xs text-gray-600 whitespace-pre-wrap">
                                {note}
                              </p>
                            ))}
                          </div>
                          <button
                            onClick={() =>
                              setConfirmedNotes((m) => ({ ...m, [p.id]: !m[p.id] }))
                            }
                            className={`self-start shrink-0 px-2 py-1 rounded text-xs border ${
                              confirmedNotes[p.id]
                                ? 'border-green-600 text-green-700 bg-green-50'
                                : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                            }`}
                          >
                            {confirmedNotes[p.id] ? '已确认' : '确认'}
                          </button>
                        </div>
                      </div>
                    )}
                    {p.status !== 'done' && (
                      <button
                        onClick={() => advance(p)}
                        disabled={advancingId === p.id}
                        className="mt-2 w-full px-3 py-1 rounded border border-blue-600 text-blue-600 text-xs hover:bg-blue-50 disabled:opacity-50"
                      >
                        {advancingId === p.id ? '推进中…' : '推进一阶段'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
        </div>
      )}
    </div>
  );
}
