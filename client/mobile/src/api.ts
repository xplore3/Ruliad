import axios from 'axios';

const TOKEN_KEY = 'grasp-token';
const USER_KEY = 'grasp-user';

export interface StoredUser {
  id: string;
  username?: string;
  name: string;
  role: string;
  tenantId: string;
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

/**
 * 检查 token 是否存在且未过期。
 * Token 格式为 base64url(JSON payload).base64url(hmac)，
 * payload 中含 exp（Unix 秒），过期则清除。
 */
export function isTokenValid(): boolean {
  const token = getToken();
  if (!token) return false;
  try {
    const dataPart = token.split('.')[0];
    // base64url -> base64：替换 URL 安全字符，补齐 padding
    const b64 = dataPart.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded)) as { exp?: number };
    if (typeof payload.exp !== 'number') return true; // 无 exp 字段则不校验
    if (payload.exp < Date.now() / 1000) {
      // 过期：清除无效 token
      clearToken();
      return false;
    }
    return true;
  } catch {
    // 解析失败，清除无效 token
    clearToken();
    return false;
  }
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function getStoredUser(): StoredUser | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredUser;
  } catch {
    return null;
  }
}

export function setStoredUser(user: StoredUser) {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

const api = axios.create({
  baseURL: '/api/v1',
});

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      clearToken();
      if (location.pathname !== '/login' && location.pathname !== '/register') {
        location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

/** 定时检查 token 是否过期（每分钟检查一次） */
if (typeof window !== 'undefined') {
  setInterval(() => {
    const token = getToken();
    if (token && !isTokenValid()) {
      location.href = '/login';
    }
  }, 60 * 1000);
}

export default api;
