import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import StatusBar from '../components/StatusBar';

type Stage = 'dialogue' | 'evidence' | 'scoring';

export default function ReportGenerating() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [stage, setStage] = useState<Stage>('dialogue');
  const [done, setDone] = useState(false);

  useEffect(() => {
    const stages: Stage[] = ['dialogue', 'evidence', 'scoring'];
    let idx = 0;
    const timer = setInterval(() => {
      idx++;
      if (idx < stages.length) {
        setStage(stages[idx]);
      } else {
        clearInterval(timer);
        setDone(true);
      }
    }, 1500);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!done || !sessionId) return;
    // 跳转复盘页
    const timer = setTimeout(() => navigate(`/session/${sessionId}/review`), 500);
    return () => clearTimeout(timer);
  }, [done, sessionId, navigate]);

  const steps = [
    { key: 'dialogue', label: '对话整理', done: stage !== 'dialogue' },
    { key: 'evidence', label: '证据定位', done: stage === 'scoring' },
    { key: 'scoring', label: '多维评分', done: done },
  ];

  return (
    <div className="relative mx-auto flex min-h-screen w-full max-w-md flex-col">
      <StatusBar dark />
      <div className="flex items-center px-4 py-2">
        <button onClick={() => navigate('/practice')} className="flex h-9 w-9 items-center justify-center">
          <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
        </button>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center px-6">
        {/* 动画图标 */}
        <div className="relative mb-8">
          <div className="h-24 w-24 animate-pulse rounded-full" />
          <div className="absolute inset-0 flex items-center justify-center">
            <svg className="h-10 w-10 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
              <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        </div>

        <h1 className="text-xl font-bold">分析中</h1>
        <p className="mt-2 text-sm">正在理解你的每一次回应</p>

        {/* 阶段 */}
        <div className="mt-10 w-full space-y-3">
          {steps.map((step) => (
            <div key={step.key} className="flex items-center gap-3 rounded-xl px-4 py-3 shadow-sm">
              {step.done ? (
                <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              ) : stage === step.key ? (
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-orange-500/30 border-t-orange-500" />
              ) : (
                <div className="h-5 w-5 rounded-full border-2" />
              )}
              <span className={`text-sm font-medium ${step.done ? '' : stage === step.key ? '' : ''}`}>
                {step.label}
              </span>
              <span className={`ml-auto text-xs ${step.done ? '' : ''}`}>
                {step.done ? '已完成' : stage === step.key ? '进行中' : '等待中'}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="p-6">
        <button
          className="mx-auto block w-full max-w-[260px] rounded-2xl border  py-3 text-sm font-medium"
          onClick={() => navigate('/practice')}
        >
          返回对练列表
        </button>
        <p className="mt-3 text-center text-xs">离开后可在对练列表查看报告</p>
      </div>
    </div>
  );
}
