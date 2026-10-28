import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { login, loginByCode, sendSmsCode, savePreferences, apiError } from '../api';

const SCENES = [
  { em: '📞', title: '电话销售', desc: '主动外呼、绕过前台、开场破冰' },
  { em: '💬', title: '咨询接待', desc: '接住上门线索，快速摸清需求' },
  { em: '🤝', title: '现场成交', desc: '价格博弈、条款拉扯、临门一脚' },
  { em: '👋', title: '地推引流课', desc: '陌生场景下 30 秒打开话题' },
];

export default function Login() {
  const navigate = useNavigate();
  const [authMode, setAuthMode] = useState<'code' | 'pwd'>('code');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [agreed, setAgreed] = useState(true);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [devHint, setDevHint] = useState('');
  const [error, setError] = useState('');
  const [isNewUser, setIsNewUser] = useState(false);
  const [picks, setPicks] = useState<number[]>([0, 2]);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const togglePick = (i: number) => {
    setPicks((prev) => (prev.includes(i) ? prev.filter((p) => p !== i) : [...prev, i]));
  };

  const doCodeLogin = async (phoneNum: string, codeVal: string) => {
    const res = await loginByCode(phoneNum, codeVal);
    if (res.isNewUser) {
      setIsNewUser(true);
    } else {
      navigate('/home');
    }
  };

  const handleSendCode = async () => {
    if (sending || countdown > 0 || loading) return;
    if (!/^1\d{10}$/.test(phone)) {
      setError('请输入正确的手机号');
      return;
    }
    setSending(true);
    setError('');
    try {
      const res = await sendSmsCode(phone);
      setCountdown(60);
      if (res._devCode) {
        setCode(res._devCode);
        setDevHint('开发模式验证码已自动填入，点击登录');
      }
    } catch (err) {
      setError(apiError(err, '验证码发送失败，请稍后重试'));
    } finally {
      setSending(false);
    }
  };

  const handleLogin = async () => {
    if (loading) return;
    if (!agreed) {
      setError('请先阅读并勾选《用户协议》和《隐私政策》');
      return;
    }
    setLoading(true);
    setError('');
    try {
      if (authMode === 'code') {
        if (!phone || !code) {
          setError('请输入手机号和验证码');
          setLoading(false);
          return;
        }
        await doCodeLogin(phone, code);
      } else {
        if (!username || !password) {
          setError('请输入用户名和密码');
          setLoading(false);
          return;
        }
        await login(username, password);
        navigate('/home');
      }
    } catch (err) {
      setError(apiError(err, authMode === 'code' ? '登录失败，请检查验证码' : '用户名或密码错误'));
    } finally {
      setLoading(false);
    }
  };

  const handleOnboardingDone = async () => {
    if (loading) return;
    setLoading(true);
    try {
      await savePreferences({ onboardingScenes: picks.map((i) => SCENES[i].title) });
    } catch {
      // 偏好保存失败不阻塞进入首页
    } finally {
      setLoading(false);
      navigate('/home');
    }
  };

  return (
    <main className="auth">
      {/* 登录 / 注册卡片 */}
      <section className="card auth-card">
        <div className="auth-logo"><span className="dot" />Grasp</div>
        <div className="auth-hero">
          <h1>像实战一样练销售</h1>
          <p>AI 扮演客户，随时陪你过招</p>
        </div>

        {authMode === 'code' ? (
          <>
            <div className="field">
              <input className="input" type="tel" placeholder="请输入手机号" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="field">
              <div className="code-row">
                <input className="input" type="text" placeholder="请输入验证码" value={code} onChange={(e) => setCode(e.target.value)} />
                <button
                  className="btn ghost sm"
                  onClick={handleSendCode}
                  disabled={sending || countdown > 0}
                >
                  {countdown > 0 ? `${countdown}s 后重发` : sending ? '发送中…' : '获取验证码'}
                </button>
              </div>
              {devHint && <p className="hint" style={{ fontSize: 12, color: '#2FAE7B', marginTop: 6 }}>{devHint}</p>}
            </div>
          </>
        ) : (
          <>
            <div className="field">
              <input className="input" type="text" placeholder="请输入用户名" value={username} onChange={(e) => setUsername(e.target.value)} />
            </div>
            <div className="field">
              <input className="input" type="password" placeholder="请输入密码" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
          </>
        )}

        <div className="agree" onClick={() => setAgreed((v) => !v)}>
          <span className="box">{agreed ? '✓' : ''}</span>
          <span>
            我已阅读并同意
            <a href="/agreement" target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>《用户协议》</a>
            和
            <a href="/privacy" target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>《隐私政策》</a>
          </span>
        </div>

        {error && <p style={{ fontSize: 12, color: '#E85C62', margin: '4px 0 10px' }}>{error}</p>}

        <a className="btn primary block" onClick={handleLogin} style={loading ? { pointerEvents: 'none', opacity: .7 } : undefined}>
          {loading ? '登录中…' : '登录 / 注册'}
        </a>

        {authMode === 'code' ? (
          <a className="pwd-link" onClick={() => { setAuthMode('pwd'); setError(''); }}>密码登录 ›</a>
        ) : (
          <a className="pwd-link" onClick={() => { setAuthMode('code'); setError(''); }}>验证码登录 ›</a>
        )}
      </section>

      {/* 首次登录 - 选择常练场景 */}
      {isNewUser && (
        <section className="card auth-card demo-card">
          <div className="demo-tag"><span className="chip gray">欢迎加入 · 完善你的练习偏好</span></div>
          <h2>你最常练哪类场景？</h2>
          <p className="sub">可多选，帮你更快找到合适的对手</p>
          <div className="pick-grid">
            {SCENES.map((s, i) => {
              const on = picks.includes(i);
              return (
                <div key={s.title} onClick={() => togglePick(i)} className={`pick${on ? ' on' : ''}`}>
                  <span className="ck">{on ? '✓' : ''}</span>
                  <div className="em">{s.em}</div>
                  <h3>{s.title}</h3>
                  <p>{s.desc}</p>
                </div>
              );
            })}
          </div>
          <a className="btn primary block" onClick={handleOnboardingDone} style={loading ? { pointerEvents: 'none', opacity: .7 } : undefined}>
            {loading ? '保存中…' : '完成，开始探索'}
          </a>
        </section>
      )}
    </main>
  );
}
