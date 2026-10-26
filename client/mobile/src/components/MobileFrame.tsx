import type { ReactNode } from 'react';

interface MobileFrameProps {
  children: ReactNode;
  className?: string;
}

/**
 * 手机端统一外框：390×844 设计基准，max-w-md 全屏 H5
 */
export default function MobileFrame({ children, className = '' }: MobileFrameProps) {
  return (
    <div
      className={`relative mx-auto flex min-h-screen w-full max-w-md flex-col ${className}`}
      style={{ backgroundColor: '#17191F', color: '#F7F7FA' }}
    >
      {children}
    </div>
  );
}
