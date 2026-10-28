import type { ReactNode } from 'react';

/** 静态协议页布局：无需登录，卡片式排版（与登录页视觉一致） */
export default function DocLayout({ title, updatedAt, children }: { title: string; updatedAt: string; children: ReactNode }) {
  return (
    <main style={{ minHeight: '100vh', background: '#F7F7FA', padding: '32px 16px 64px' }}>
      <div className="card" style={{ maxWidth: 760, margin: '0 auto', padding: '32px 28px', lineHeight: 1.9, fontSize: 14, color: '#33353B' }}>
        <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>{title}</div>
        <div className="small muted" style={{ marginBottom: 8 }}>更新日期：{updatedAt}</div>
        <div style={{ background: '#FFF4E5', border: '1px solid #F5A623', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#8a5a00', marginBottom: 20 }}>
          本页面内容为模板文本，仅供参考，正式版本以法务审核后发布的条款为准。
        </div>
        {children}
      </div>
    </main>
  );
}

export function DocSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ marginBottom: 20 }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>{title}</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{children}</div>
    </section>
  );
}
