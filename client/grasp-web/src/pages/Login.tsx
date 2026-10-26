import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import api, { setStoredUser, setToken, type StoredUser } from '../api';
import AppFrame from '../components/AppFrame';

interface LoginResponse {
  token: string;
  user: StoredUser;
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
      setToken(res.data.token);
      setStoredUser(res.data.user);
      navigate('/tasks', { replace: true });
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
    <AppFrame className="lg:max-w-md">
      <main className="flex flex-1 flex-col justify-center p-6">
        <h1 className="mb-1 text-2xl font-bold text-gray-900">Grasp · 你的专属陪练员与指导参谋</h1>
        <p className="mb-8 text-sm text-gray-500">登录后开始今天的陪练</p>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">用户名</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoComplete="username"
              className="min-h-11 w-full rounded-lg border border-gray-300 px-3 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
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
              className="min-h-11 w-full rounded-lg border border-gray-300 px-3 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              placeholder="请输入密码"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="min-h-11 w-full rounded-lg bg-indigo-600 font-medium text-white disabled:opacity-50"
          >
            {submitting ? '登录中…' : '登录'}
          </button>
        </form>
        <p className="mt-6 text-center text-sm text-gray-500">
          没有账号？
          <Link to="/register" className="text-indigo-600">
            去注册
          </Link>
        </p>
      </main>
    </AppFrame>
  );
}
