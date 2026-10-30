import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  apiError,
  changePassword,
  clearToken,
  deleteAccount,
  exportMyData,
  fetchPreferences,
  getStoredUser,
  savePreferences,
} from '../api';
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
  notifyReport: boolean;
  defaultMode: 'voice-call' | 'voice' | 'text';
  speechRate: 'standard' | 'slow' | 'fast';
  coachIntensity: 'low' | 'medium' | 'high';
  recordingConsent: boolean;
}

const DEFAULT_PREFS: Prefs = {
  notifyReport: true,
  defaultMode: 'voice-call',
  speechRate: 'standard',
  coachIntensity: 'medium',
  recordingConsent: true,
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
  const location = useLocation();
  const [active, setActive] = useState('account');
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const user = getStoredUser();

  // 修改密码内联表单
  const [pwOpen, setPwOpen] = useState(false);
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [newPwd2, setNewPwd2] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);

  useEffect(() => {
    fetchPreferences()
      .then(({ preferences }) => {
        const merged = { ...DEFAULT_PREFS, ...(preferences as Partial<Prefs>) };
        // 历史值 quiet 归一为 low
        if ((merged.coachIntensity as string) === 'quiet') merged.coachIntensity = 'low';
        setPrefs(merged);
      })
      .catch((e) => alert(apiError(e, '偏好设置加载失败')));
  }, []);

  // 从其他页面跳入指定区块（如 Profile 的「关于」）
  useEffect(() => {
    const scrollTo = (location.state as { scrollTo?: string } | null)?.scrollTo;
    if (!scrollTo) return;
    // 等首屏渲染完成后再滚动
    const t = setTimeout(() => jumpTo(scrollTo), 50);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

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

  /** 报告通知开关：开启时需先拿到浏览器 Notification 权限 */
  const toggleNotifyReport = async () => {
    if (!prefs) return;
    const next = !prefs.notifyReport;
    if (next) {
      if (typeof Notification === 'undefined') {
        alert('当前浏览器不支持通知，无法开启');
        return;
      }
      if (Notification.permission === 'denied') {
        alert('浏览器已拒绝通知权限，请先在浏览器站点设置中允许通知');
        return;
      }
      if (Notification.permission === 'default') {
        const p = await Notification.requestPermission();
        if (p !== 'granted') {
          alert('未获得通知权限，报告通知无法开启');
          return;
        }
      }
    }
    update('notifyReport', next);
  };

  const handleLogout = () => {
    clearToken();
    navigate('/login');
  };

  const handleClearCache = () => {
    const keep = new Set(['grasp-token', 'grasp-user', 'grasp-prefs']);
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && !keep.has(k)) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
    alert('缓存已清理');
  };

  const handleChangePassword = async () => {
    if (!oldPwd || !newPwd) {
      alert('请填写旧密码和新密码');
      return;
    }
    if (newPwd.length < 6) {
      alert('新密码至少 6 位');
      return;
    }
    if (newPwd !== newPwd2) {
      alert('两次输入的新密码不一致');
      return;
    }
    setPwBusy(true);
    try {
      await changePassword(oldPwd, newPwd);
      alert('密码已修改，请使用新密码重新登录');
      clearToken();
      navigate('/login');
    } catch (e) {
      alert(apiError(e, '修改失败，请确认旧密码是否正确'));
    } finally {
      setPwBusy(false);
    }
  };

  const handleExport = async () => {
    if (exportBusy) return;
    setExportBusy(true);
    try {
      const data = await exportMyData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `grasp-my-data-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(apiError(e, '导出失败，请稍后重试'));
    } finally {
      setExportBusy(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (
      !window.confirm(
        '注销账号将永久删除你的账号及全部练习数据，且无法恢复。\n\n确定要注销吗？'
      )
    ) {
      return;
    }
    try {
      await deleteAccount();
    } catch (e) {
      alert(apiError(e, '注销失败，请稍后重试'));
      return;
    }
    localStorage.clear();
    alert('账号已注销');
    navigate('/login');
  };

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
            <div
              className="setting-row"
              style={{ cursor: 'pointer' }}
              onClick={() => setPwOpen((v) => !v)}
            >
              <span className="lb">修改密码</span>
              <span className="arrow">›</span>
            </div>
            {pwOpen && (
              <div style={{ padding: '4px 0 12px' }}>
                <div className="field">
                  <label>旧密码</label>
                  <input
                    className="input"
                    type="password"
                    value={oldPwd}
                    onChange={(e) => setOldPwd(e.target.value)}
                    autoComplete="current-password"
                  />
                </div>
                <div className="field">
                  <label>新密码</label>
                  <input
                    className="input"
                    type="password"
                    value={newPwd}
                    onChange={(e) => setNewPwd(e.target.value)}
                    autoComplete="new-password"
                  />
                </div>
                <div className="field">
                  <label>确认新密码</label>
                  <input
                    className="input"
                    type="password"
                    value={newPwd2}
                    onChange={(e) => setNewPwd2(e.target.value)}
                    autoComplete="new-password"
                  />
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={pwBusy}
                    onClick={() => void handleChangePassword()}
                  >
                    {pwBusy ? '提交中…' : '确认修改'}
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setPwOpen(false)}>
                    取消
                  </button>
                </div>
              </div>
            )}
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
              <span className="lb">报告生成通知</span>
              <Switch
                on={prefs?.notifyReport ?? true}
                onToggle={() => void toggleNotifyReport()}
              />
            </div>
            <p className="small muted" style={{ padding: '0 0 4px' }}>
              开启后，练习报告生成完成时会收到浏览器通知
            </p>
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
                <option value="low">安静</option>
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
            <div
              className="setting-row"
              style={{ cursor: 'pointer' }}
              onClick={() => void handleExport()}
            >
              <span className="lb">{exportBusy ? '正在导出…' : '导出我的数据'}</span>
              <span className="arrow">›</span>
            </div>
            <div
              className="setting-row"
              style={{ cursor: 'pointer' }}
              onClick={() => void handleDeleteAccount()}
            >
              <span className="danger">注销账号</span>
            </div>
          </section>

          {/* 通用 */}
          <section className="card sec-card" id="general">
            <h2>通用</h2>
            <div className="setting-row" style={{ cursor: 'pointer' }} onClick={handleClearCache}>
              <span className="lb">清除缓存</span>
              <span className="arrow">›</span>
            </div>
          </section>

          {/* 关于 */}
          <section className="card about-block" id="about">
            <a
              className="logo"
              style={{ justifyContent: 'center', cursor: 'pointer' }}
              onClick={() => navigate('/home')}
            >
              <span className="dot" />
              Graspit
            </a>
            <p className="small muted" style={{ marginTop: 6 }}>
              Graspit v0.1.0
              <br />
              像实战一样练销售
            </p>
            <div className="links">
              <a style={{ cursor: 'pointer' }} onClick={() => navigate('/')}>产品介绍</a>
              <a style={{ cursor: 'pointer' }} onClick={() => navigate('/agreement')}>用户协议</a>
              <a style={{ cursor: 'pointer' }} onClick={() => navigate('/privacy')}>隐私政策</a>
              <a href="mailto:support@grasp.chat">联系客服</a>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
