import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiError, clearToken, fetchPreferences, getStoredUser, savePreferences } from '../api';
import type { Preferences } from '../api';

const NAV_ITEMS = [
  { id: 'account', icon: '👤', label: '账号与安全' },
  { id: 'notice', icon: '🔔', label: '通知' },
  { id: 'voice', icon: '🎙', label: '语音与练习' },
  { id: 'privacy', icon: '🔒', label: '隐私' },
  { id: 'general', icon: '⚙️', label: '通用' },
  { id: 'about', icon: 'ℹ️', label: '关于' },
];

interface Prefs {
  notifyPractice: boolean;
  notifyReport: boolean;
  defaultMode: 'voice-call' | 'voice' | 'text';
  speechRate: 'standard' | 'slow' | 'fast';
  coachIntensity: 'medium' | 'quiet' | 'high';
  recordingConsent: boolean;
  theme: 'system' | 'light' | 'dark';
}

const DEFAULT_PREFS: Prefs = {
  notifyPractice: true,
  notifyReport: true,
  defaultMode: 'voice-call',
  speechRate: 'standard',
  coachIntensity: 'medium',
  recordingConsent: true,
  theme: 'system',
};

function Switch({ on, onToggle }: { on: boolean; onToggle?: () => void }) {
  return (
    <span
      className={`switch${on ? ' on' : ''}`}
      onClick={onToggle}
      style={onToggle ? { cursor: 'pointer' } : undefined}
    >
      <i />
    </span>
  );
}

export default function Settings() {
  const navigate = useNavigate();
  const [active, setActive] = useState('account');
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const user = getStoredUser();

  useEffect(() => {
    fetchPreferences()
      .then(({ preferences }) => setPrefs({ ...DEFAULT_PREFS, ...(preferences as Partial<Prefs>) }))
      .catch((e) => alert(apiError(e, '偏好设置加载失败')));
  }, []);

  // 滚动定位高亮（scroll-spy）
  useEffect(() => {
    const sections = NAV_ITEMS.map((n) => document.getElementById(n.id)).filter(
      (el): el is HTMLElement => el !== null
    );
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(entry.target.id);
        }
      },
      { rootMargin: '-80px 0px -60% 0px' }
    );
    sections.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  const jumpTo = (id: string) => {
    setActive(id);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const update = <K extends keyof Prefs>(key: K, value: Prefs[K]) => {
    if (!prefs) return;
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    savePreferences(next as Preferences).catch((e) =>
      alert(apiError(e, '保存失败，请稍后重试'))
    );
  };

  const handleLogout = () => {
    clearToken();
    navigate('/login');
  };

  const handleClearCache = () => {
    const keep = new Set(['grasp-token', 'grasp-user']);
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && !keep.has(k)) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
    alert('缓存已清理');
  };

  const notYet = () => alert('该功能暂未开放');

  return (
    <main className="wrap">
      <div className="layout-settings">
        {/* 左侧 sticky 侧导航 */}
        <aside className="card sidenav">
          {NAV_ITEMS.map((item) => (
            <a
              key={item.id}
              className={active === item.id ? 'active' : ''}
              onClick={() => jumpTo(item.id)}
            >
              {item.icon} {item.label}
            </a>
          ))}
        </aside>

        <div>
          {/* 账号与安全 */}
          <section className="card sec-card" id="account">
            <h2>账号与安全</h2>
            <div className="setting-row">
              <span className="lb">用户名</span>
              <span className="vl">{user?.username || user?.name || '—'}</span>
            </div>
            <div className="setting-row" style={{ cursor: 'pointer' }} onClick={notYet}>
              <span className="lb">修改密码</span>
              <span className="arrow">›</span>
            </div>
            <div className="setting-row">
              <span className="danger" style={{ cursor: 'pointer' }} onClick={handleLogout}>
                退出登录
              </span>
            </div>
          </section>

          {/* 通知 */}
          <section className="card sec-card" id="notice">
            <h2>通知</h2>
            <div className="setting-row">
              <span className="lb">练习提醒</span>
              <Switch on={prefs?.notifyPractice ?? true} onToggle={() => prefs && update('notifyPractice', !prefs.notifyPractice)} />
            </div>
            <div className="setting-row">
              <span className="lb">报告生成通知</span>
              <Switch on={prefs?.notifyReport ?? true} onToggle={() => prefs && update('notifyReport', !prefs.notifyReport)} />
            </div>
          </section>

          {/* 语音与练习 */}
          <section className="card sec-card" id="voice">
            <h2>语音与练习</h2>
            <div className="setting-row">
              <span className="lb">默认练习模式</span>
              <select
                className="input"
                value={prefs?.defaultMode ?? 'voice-call'}
                onChange={(e) => update('defaultMode', e.target.value as Prefs['defaultMode'])}
              >
                <option value="voice-call">语音通话</option>
                <option value="voice">轮次语音</option>
                <option value="text">文字对话</option>
              </select>
            </div>
            <div className="setting-row">
              <span className="lb">默认语速</span>
              <select
                className="input"
                value={prefs?.speechRate ?? 'standard'}
                onChange={(e) => update('speechRate', e.target.value as Prefs['speechRate'])}
              >
                <option value="standard">标准（≈150 WPM）</option>
                <option value="slow">慢</option>
                <option value="fast">快</option>
              </select>
            </div>
            <div className="setting-row">
              <span className="lb">教练提示强度</span>
              <select
                className="input"
                value={prefs?.coachIntensity ?? 'medium'}
                onChange={(e) => update('coachIntensity', e.target.value as Prefs['coachIntensity'])}
              >
                <option value="medium">适中</option>
                <option value="quiet">安静</option>
                <option value="high">高频</option>
              </select>
            </div>
          </section>

          {/* 隐私 */}
          <section className="card sec-card" id="privacy">
            <h2>隐私</h2>
            <div className="setting-row">
              <span className="lb">录音与分析授权</span>
              <Switch on={prefs?.recordingConsent ?? true} onToggle={() => prefs && update('recordingConsent', !prefs.recordingConsent)} />
            </div>
            <div className="setting-row" style={{ cursor: 'pointer' }} onClick={notYet}>
              <span className="lb">导出我的数据</span>
              <span className="arrow">›</span>
            </div>
            <div className="setting-row" style={{ cursor: 'pointer' }} onClick={notYet}>
              <span className="danger">注销账号</span>
            </div>
          </section>

          {/* 通用 */}
          <section className="card sec-card" id="general">
            <h2>通用</h2>
            <div className="setting-row">
              <span className="lb">主题</span>
              <select
                className="input"
                value={prefs?.theme ?? 'system'}
                onChange={(e) => update('theme', e.target.value as Prefs['theme'])}
              >
                <option value="system">跟随系统</option>
                <option value="light">浅色</option>
                <option value="dark">深色</option>
              </select>
            </div>
            <div className="setting-row" style={{ cursor: 'pointer' }} onClick={handleClearCache}>
              <span className="lb">清除缓存</span>
              <span className="arrow">›</span>
            </div>
          </section>

          {/* 关于 */}
          <section className="card about-block" id="about">
            <a className="logo" href="index.html" style={{ justifyContent: 'center' }}>
              <span className="dot" />
              Grasp
            </a>
            <p className="small muted" style={{ marginTop: 6 }}>
              Grasp v0.3.0（设计演示版）
              <br />
              像实战一样练销售
            </p>
            <div className="links">
              <a>产品介绍</a>
              <a>用户协议</a>
              <a>隐私政策</a>
              <a>联系客服</a>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
