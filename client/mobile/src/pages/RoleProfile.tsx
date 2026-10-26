﻿import { useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../api';
import StatusBar from '../components/StatusBar';

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

export default function RoleProfile() {
  const { scenarioId } = useParams<{ scenarioId: string }>();
  const navigate = useNavigate();

  // 导入相关状态
  const [importMode, setImportMode] = useState<'idle' | 'file' | 'chat-record'>('idle');
  const [importText, setImportText] = useState('');
  const [importLoading, setImportLoading] = useState(false);
  const [importResult, setImportResult] = useState<{ reply: string; changes: Record<string, unknown>; applied: boolean } | null>(null);
  const [fileName, setFileName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const traits = [
    { label: '决策风格', value: '理性谨慎' },
    { label: '预算态度', value: '重视回报' },
    { label: '典型异议', value: '价格 / 迁移成本' },
    { label: '决策链', value: '业务负责人 → 采购' },
    { label: '信息来源', value: '模板 + 2 份资料' },
  ];

  // ---- 文件导入 ----
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      setImportText(text);
    };
    reader.onerror = () => {
      window.alert('文件读取失败');
    };
    reader.readAsText(file, 'utf-8');
  };

  // ---- 执行导入分析 ----
  const runImport = async () => {
    if (!importText.trim() || importLoading) return;
    setImportLoading(true);
    setImportResult(null);
    try {
      const scenarioRes = await api.get<{ scenarios: { id: string; personaConfigId: string }[] }>('/scenarios');
      const scenario = scenarioRes.data.scenarios.find((s) => s.id === scenarioId);
      if (!scenario) {
        setImportLoading(false);
        return;
      }
      const res = await api.post<{
        reply: string;
        changes: Record<string, unknown>;
        applied: boolean;
      }>(`/persona-configs/${scenario.personaConfigId}/import`, {
        source: importMode === 'file' ? 'file' : 'chat-record',
        content: importText,
        fileName: importMode === 'file' ? fileName : undefined,
        apply: true,
      });
      setImportResult({
        reply: res.data.reply,
        changes: res.data.changes,
        applied: res.data.applied,
      });
    } catch {
      setImportResult({
        reply: '导入分析失败，请重试',
        changes: {},
        applied: false,
      });
    } finally {
      setImportLoading(false);
    }
  };

  const resetImport = () => {
    setImportMode('idle');
    setImportText('');
    setImportResult(null);
    setFileName('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="relative mx-auto flex min-h-screen w-full max-w-md flex-col" style={{ backgroundColor: C.bg }}>
      <StatusBar dark />
      <div className="flex items-center px-4 py-2">
        <button onClick={() => navigate(-1)} className="flex h-9 w-9 items-center justify-center">
          <svg className="h-5 w-5" style={{ color: C.sub }} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
        </button>
      </div>

      <div className="px-5 pt-2">
        <h1 className="text-xl font-bold" style={{ color: C.text }}>陪练员画像</h1>
        <p className="mt-1 text-sm" style={{ color: C.sub }}>私有版本 v2</p>
      </div>

      {/* 核心特征 */}
      <div className="mx-5 mt-6">
        <h2 className="text-base font-bold" style={{ color: C.text }}>核心特征</h2>
        <div className="mt-3 space-y-3">
          {traits.map((trait) => (
            <div key={trait.label} className="flex items-center justify-between rounded-xl px-4 py-3" style={{ backgroundColor: C.panel }}>
              <span className="text-sm" style={{ color: C.sub }}>{trait.label}</span>
              <span className="text-sm font-medium" style={{ color: C.text }}>{trait.value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 导入区 */}
      <div className="mx-5 mt-6">
        <h2 className="text-base font-bold" style={{ color: C.text }}>导入资料</h2>
        <p className="mt-1 text-xs" style={{ color: C.sub }}>上传文件或粘贴聊天记录，AI 自动提取画像特征</p>

        {importMode === 'idle' ? (
          <div className="mt-3 space-y-3">
            <button
              className="flex w-full items-center gap-3 rounded-xl p-4 text-left transition active:scale-[0.98]"
              style={{ backgroundColor: C.panel }}
              onClick={() => setImportMode('file')}
            >
              <span className="text-2xl">📄</span>
              <div className="flex-1">
                <p className="text-[15px] font-bold" style={{ color: C.text }}>文件导入</p>
                <p className="text-xs" style={{ color: C.sub }}>支持 .txt / .md / .csv / .json</p>
              </div>
              <svg className="h-5 w-5" style={{ color: C.sub }} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
            </button>
            <button
              className="flex w-full items-center gap-3 rounded-xl p-4 text-left transition active:scale-[0.98]"
              style={{ backgroundColor: C.panel }}
              onClick={() => setImportMode('chat-record')}
            >
              <span className="text-2xl">💬</span>
              <div className="flex-1">
                <p className="text-[15px] font-bold" style={{ color: C.text }}>聊天记录导入</p>
                <p className="text-xs" style={{ color: C.sub }}>粘贴与客户的真实对话，提取画像</p>
              </div>
              <svg className="h-5 w-5" style={{ color: C.sub }} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
            </button>
            <button
              className="flex w-full items-center gap-3 rounded-xl p-4 text-left transition active:scale-[0.98]"
              style={{ backgroundColor: C.panel }}
              onClick={() => window.alert('👑 数据增强 · VIP 专属功能\n\n该功能为 VIP 会员专属，升级 VIP 即可解锁。\n\n升级 VIP 请联系：graspai@126.com')}
            >
              <span className="text-2xl">⚡</span>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-[15px] font-bold" style={{ color: C.text }}>数据增强</p>
                  <span className="rounded-full px-1.5 py-0.5 text-[10px] font-bold" style={{ backgroundColor: 'rgba(232,92,98,0.12)', color: C.accent }}>VIP</span>
                </div>
                <p className="text-xs" style={{ color: C.sub }}>AI 自动补全画像维度与场景线索</p>
              </div>
              <svg className="h-5 w-5" style={{ color: C.sub }} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
            </button>
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            {/* 返回导入选择 */}
            <button
              className="flex items-center gap-1.5 text-sm"
              style={{ color: C.sub }}
              onClick={resetImport}
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
              返回
            </button>

            {/* 文件选择 */}
            {importMode === 'file' && (
              <div>
                <label
                  className="flex cursor-pointer flex-col items-center justify-center rounded-xl py-8 text-center transition"
                  style={{ border: `2px dashed ${C.panel2}`, backgroundColor: C.panel }}
                >
                  <svg className="h-8 w-8" style={{ color: C.sub }} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                  <span className="mt-2 text-sm font-medium" style={{ color: C.text }}>
                    {fileName || '点击选择文件'}
                  </span>
                  <span className="mt-0.5 text-xs" style={{ color: C.sub }}>.txt / .md / .csv / .json</span>
                  <input ref={fileInputRef} type="file" className="hidden" accept=".txt,.md,.csv,.json,text/*" onChange={handleFileSelect} />
                </label>
                {importText && (
                  <div className="mt-2 max-h-32 overflow-y-auto rounded-lg p-3 text-xs" style={{ backgroundColor: C.panel, color: C.sub }}>
                    {importText.slice(0, 500)}{importText.length > 500 ? '…' : ''}
                  </div>
                )}
              </div>
            )}

            {/* 聊天记录粘贴 */}
            {importMode === 'chat-record' && (
              <div>
                <textarea
                  className="h-40 w-full resize-none rounded-xl p-4 text-sm focus:outline-none"
                  style={{ backgroundColor: C.panel, color: C.text, border: `1px solid ${C.panel2}` }}
                  placeholder={'粘贴与客户的聊天记录，例如：\n客户：你们这个价格太高了\n我：我们的价值体现在…\n客户：但竞品更便宜\n…'}
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                />
              </div>
            )}

            {/* 执行导入 */}
            <button
              className="mx-auto flex w-full max-w-[260px] items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold transition active:scale-[0.98] disabled:opacity-50"
              style={{ backgroundColor: C.accent, color: '#F7F7FA' }}
              onClick={runImport}
              disabled={!importText.trim() || importLoading}
            >
              {importLoading ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2" style={{ borderColor: 'rgba(255,255,255,0.3)', borderTopColor: '#F7F7FA' }} />
                  AI 分析中…
                </>
              ) : (
                <>
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
                  AI 提取画像特征
                </>
              )}
            </button>

            {/* 导入结果 */}
            {importResult && (
              <div className="rounded-xl p-4" style={{ backgroundColor: C.panel }}>
                <div className="flex items-center gap-2">
                  {importResult.applied ? (
                    <svg className="h-5 w-5" style={{ color: C.success }} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                  ) : (
                    <svg className="h-5 w-5" style={{ color: C.accent }} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4M12 16h.01" /></svg>
                  )}
                  <span className="text-sm font-bold" style={{ color: C.text }}>
                    {importResult.applied ? '画像已更新' : '未提取到有效特征'}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-relaxed" style={{ color: C.sub }}>{importResult.reply}</p>
                {importResult.applied && Object.keys(importResult.changes).length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {Object.keys(importResult.changes).map((key) => (
                      <span key={key} className="rounded-full px-2.5 py-1 text-xs font-medium" style={{ backgroundColor: C.panel2, color: C.text }}>
                        {key}
                      </span>
                    ))}
                  </div>
                )}
                {importResult.applied && (
                  <button
                    className="mt-3 text-xs font-medium"
                    style={{ color: C.accent }}
                    onClick={() => navigate(-1)}
                  >
                    查看更新后的画像 →
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 自定义画像特征 */}
      <div className="mx-5 mt-6">
        <button
          className="mx-auto flex w-full max-w-[280px] items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-bold transition active:scale-[0.98]"
          style={{ backgroundColor: C.accent, color: '#F7F7FA' }}
          onClick={() => navigate(`/space/${scenarioId}/customize`)}
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
          自定义画像特征
        </button>
        <button
          className="mt-3 mx-auto flex w-full max-w-[280px] items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-bold transition active:scale-[0.98]"
          style={{ border: `1px solid ${C.panel2}`, color: C.text, backgroundColor: C.panel }}
          onClick={() => navigate(`/space/${scenarioId}/customize`)}
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
          重新画像
        </button>
      </div>

      <div className="flex-1" />
      <div className="h-6" />
    </div>
  );
}
