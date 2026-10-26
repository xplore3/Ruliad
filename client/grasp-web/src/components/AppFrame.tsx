import type { ReactNode } from 'react';

interface AppFrameProps {
  children: ReactNode;
  className?: string;
}

/**
 * 学员端统一外框：
 * - 移动端（<lg）：max-w-md 全屏 H5，与原生体验一致；
 * - PC（lg+）：宽度由使用方通过 className 决定（Layout 传 lg:max-w-none 铺满，
 *   全屏页传 lg:max-w-3xl/4xl 居中限宽）。
 */
export default function AppFrame({ children, className = '' }: AppFrameProps) {
  return (
    <div
      className={`mx-auto flex min-h-screen w-full max-w-md flex-col bg-gray-50 text-gray-900 lg:bg-transparent ${className}`}
    >
      {children}
    </div>
  );
}
