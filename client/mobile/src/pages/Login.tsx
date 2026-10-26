﻿﻿﻿import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import api, { isTokenValid, setStoredUser, setToken, type StoredUser } from '../api';
import StatusBar from '../components/StatusBar';

interface VerifyResponse {
  token: string;
  user: StoredUser;
  isNewUser?: boolean;
}

/** 中国大陆手机号校验 */
function isValidPhone(phone: string): boolean {
  return /^1[3-9]\d{9}$/.test(phone);
}

export default function Login() {
  const navigate = useNavigate();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sending, setSending] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 已登录用户直接跳首页
  useEffect(() => {
    if (isTokenValid()) navigate('/', { replace: true });
  }, [navigate]);

  useEffect(() => {
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  const sendCode = async () => {
    if (countdown > 0 || sending) return;
    if (!phone.trim()) { setError('请输入手机号'); return; }
    if (!isValidPhone(phone.trim())) { setError('手机号格式不正确'); return; }
    setError('');
    setSending(true);
    try {
      const res = await api.post('/auth/send-code', { phone: phone.trim() });
      if (res.data?._devCode) {
        // 开发环境：自动填充验证码
        setCode(res.data._devCode);
      }
      // 开始倒计时
      setCountdown(60);
      timerRef.current = setInterval(() => {
        setCountdown((c) => {
          if (c <= 1) {
            if (timerRef.current) clearInterval(timerRef.current);
            return 0;
          }
          return c - 1;
        });
      }, 1000);
    } catch (err) {
      setError(
        axios.isAxiosError(err) && err.response?.data?.error
          ? String(err.response.data.error)
          : '验证码发送失败，请稍后重试'
      );
    } finally {
      setSending(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (!phone.trim()) { setError('请输入手机号'); return; }
    if (!code.trim()) { setError('请输入验证码'); return; }
    setError('');
    setSubmitting(true);
    try {
      const res = await api.post<VerifyResponse>('/auth/verify-code', {
        phone: phone.trim(),
        code: code.trim(),
      });
      setToken(res.data.token);
      setStoredUser(res.data.user);
      navigate('/', { replace: true });
    } catch (err) {
      setError(
        axios.isAxiosError(err) && err.response?.data?.error
          ? String(err.response.data.error)
          : '登录失败，请稍后重试'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative mx-auto flex min-h-screen w-full max-w-md flex-col bg-gradient-to-b from-[#17191F] via-[#17191F] to-[#0f1923]">
      <StatusBar dark />
      <div className="flex flex-1 flex-col justify-center px-8">
        {/* Logo */}
        <div className="mb-10 text-center">
          <img src="/logo.png" alt="Grasp" className="mx-auto mb-3 h-16 w-16 rounded-2xl" />
          <h1 className="text-3xl font-bold" style={{ color: '#F7F7FA' }}>Grasp · 你的专属陪练员与指导参谋</h1>
          <p className="mt-2 text-sm" style={{ color: '#A4A7B3' }}>你的专属陪练员与指导参谋</p>
          <p className="mt-1 text-xs" style={{ color: '#A4A7B3', opacity: 0.7 }}>销售 AI 陪练</p>
        </div>

        {/* 表单 */}
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium" style={{ color: '#A4A7B3' }}>手机号</label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 11))}
              required
              inputMode="tel"
              autoComplete="tel"
              className="min-h-12 w-full rounded-xl border px-4 focus:outline-none"
              style={{ backgroundColor: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.1)', color: '#F7F7FA' }}
              placeholder="请输入手机号"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium" style={{ color: '#A4A7B3' }}>验证码</label>
            <div className="flex gap-2">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                required
                inputMode="numeric"
                autoComplete="one-time-code"
                className="min-h-12 min-w-0 flex-1 rounded-xl border px-4 focus:outline-none"
                style={{ backgroundColor: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.1)', color: '#F7F7FA' }}
                placeholder="6 位验证码"
              />
              <button
                type="button"
                onClick={sendCode}
                disabled={countdown > 0 || sending || !isValidPhone(phone)}
                className="min-h-12 shrink-0 rounded-xl border px-4 text-sm font-medium transition disabled:opacity-40"
                style={{ borderColor: 'rgba(232,92,98,0.5)', color: '#E85C62' }}
              >
                {sending ? '发送中…' : countdown > 0 ? `${countdown}s` : '获取验证码'}
              </button>
            </div>
          </div>
          {error && <p className="text-sm" style={{ color: '#E85C62' }}>{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="mx-auto block min-h-12 w-full max-w-[260px] rounded-xl text-base font-bold disabled:opacity-50"
            style={{ backgroundColor: '#E85C62', color: '#F7F7FA' }}
          >
            {submitting ? '登录中…' : '登录 / 注册'}
          </button>
        </form>
        <p className="mt-6 text-center text-xs leading-relaxed" style={{ color: '#A4A7B3', opacity: 0.7 }}>
          继续即表示同意用户协议与隐私政策；录音与分析将在对练前单独确认。
        </p>
        <p className="mt-4 text-center text-sm" style={{ color: '#A4A7B3' }}>
          想用密码登录？
          <Link to="/register" style={{ color: '#E85C62' }}>
            去注册
          </Link>
        </p>
      </div>
    </div>
  );
}
