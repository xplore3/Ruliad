import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import api, { setStoredUser, setToken, type StoredUser } from '../api';

interface LoginResponse {
  token: string;
  user: StoredUser;
}

/** 按角色决定登录后落地页 */
function homeOf(role: string): string | null {
  switch (role) {
    case 'supervisor':
      return '/supervisor';
    case 'executive':
      return '/executive';
    case 'admin':
    case 'platform':
      return '/appeals';
    default:
      return null;
  }
}

export default function Login() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError('');
    setSubmitting(true);
    try {
      const res = await api.post<LoginResponse>('/auth/login', { username, password });
      const home = homeOf(res.data.user.role);
      if (!home) {
        setError('该账号是学员账号，请使用学员端登录');
        return;
      }
      setToken(res.data.token);
      setStoredUser(res.data.user);
      navigate(home, { replace: true });
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
    <div className="flex min-h-screen items-center justify-center bg-gray-100 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-8 shadow">
        <h1 className="mb-1 text-xl font-bold text-gray-900">Grasp · 你的专属陪练员与指导参谋 · 管理台</h1>
        <p className="mb-6 text-sm text-gray-500">请使用管理账号登录</p>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">用户名</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoComplete="username"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="请输入用户名"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">密码</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="请输入密码"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? '登录中…' : '登录'}
          </button>
        </form>
      </div>
    </div>
  );
}
