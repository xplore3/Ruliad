import axios from 'axios';
import type {
  User,
  Scenario,
  PersonaConfig,
  RoleCard,
  GrowthData,
  TaskView,
  ReviewData,
  TurnResult,
  SessionCreated,
  Session,
} from './types';

const TOKEN_KEY = 'grasp-token';
const USER_KEY = 'grasp-user';

export interface StoredUser {
  id: string;
  username?: string;
  name: string;
  role: string;
  tenantId: string;
}

// ====== Token 管理 ======

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function isTokenValid(): boolean {
  return !!getToken();
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

// ====== Axios 实例 ======

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
    if (error?.response?.status === 401) {
      clearToken();
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

/** 从错误响应提取后端 error 文案 */
export function apiError(err: unknown, fallback = '请求失败，请稍后重试'): string {
  if (axios.isAxiosError(err)) {
    const msg = (err.response?.data as { error?: string } | undefined)?.error;
    if (msg) return msg;
  }
  return fallback;
}

// ====== 认证 API ======

export async function login(username: string, password: string) {
  const { data } = await api.post('/auth/login', { username, password });
  const res = data as { token: string; user: User };
  setToken(res.token);
  setStoredUser(res.user);
  return res;
}

export async function register(username: string, name: string, password: string) {
  const { data } = await api.post('/auth/register', { username, name, password });
  const res = data as { token: string; user: User };
  setToken(res.token);
  setStoredUser(res.user);
  return res;
}

/** 发送短信验证码；开发环境后端会回 _devCode */
export async function sendSmsCode(phone: string) {
  const { data } = await api.post('/auth/send-code', { phone });
  return data as { success: boolean; message: string; _devCode?: string };
}

/** 验证码登录/注册一体 */
export async function loginByCode(phone: string, code: string, name?: string) {
  const { data } = await api.post('/auth/verify-code', { phone, code, name });
  const res = data as { token: string; user: User; isNewUser: boolean };
  setToken(res.token);
  setStoredUser(res.user);
  return res;
}

export async function fetchCurrentUser() {
  const { data } = await api.get('/auth/me');
  const user = data as User;
  setStoredUser(user);
  return user;
}

// ====== 目录 API ======

export async function fetchScenarios() {
  const { data } = await api.get('/scenarios');
  return data as { scenarios: Scenario[] };
}

export async function fetchRoleCards() {
  const { data } = await api.get('/role-cards');
  return data as { cards: RoleCard[] };
}

export async function fetchTasks() {
  const { data } = await api.get('/tasks');
  return data as { tasks: TaskView[] };
}

// ====== 会话 API ======

export async function createSession(scenarioId: string, mode: 'practice' | 'exam' = 'practice') {
  const { data } = await api.post('/sessions', { scenarioId, mode });
  return data as SessionCreated;
}

export async function fetchSession(sessionId: string) {
  const { data } = await api.get(`/sessions/${sessionId}`);
  return data as {
    session: Session;
    persona: SessionCreated['persona'] | null;
    scenario: SessionCreated['scenario'] | null;
    remainingSeconds: number | null;
  };
}

export async function sendTurn(sessionId: string, text: string) {
  const { data } = await api.post(`/sessions/${sessionId}/turns`, { text });
  return data as TurnResult;
}

export async function requestHint(sessionId: string) {
  const { data } = await api.post(`/sessions/${sessionId}/hint`);
  return data as { hintTurn: import('./types').TranscriptTurn; hintsRemaining: number };
}

export async function endSession(sessionId: string) {
  const { data } = await api.post(`/sessions/${sessionId}/end`);
  return data as { sessionId: string; skippedReport?: boolean };
}

/** AI 教练开场白；voice=true 时附带教练与 persona 开场白的 TTS 音频（base64 wav） */
export async function fetchOpening(sessionId: string, voice: boolean) {
  const { data } = await api.post(`/sessions/${sessionId}/opening${voice ? '?voice=1' : ''}`);
  return data as { coachText: string; coachAudio?: string; personaAudio?: string };
}

export async function pauseSession(sessionId: string) {
  const { data } = await api.post(`/sessions/${sessionId}/pause`);
  return data as { pausedAt: string; remainingSeconds: number | null };
}

export async function resumeSession(sessionId: string) {
  const { data } = await api.post(`/sessions/${sessionId}/resume`);
  return data as { remainingSeconds: number | null };
}

export async function fetchReview(sessionId: string) {
  const { data } = await api.get(`/sessions/${sessionId}/review`);
  return data as ReviewData;
}

export interface MySessionRecord {
  sessionId: string;
  scenarioId: string;
  scenarioName: string | null;
  mode: string;
  status: string;
  totalScore: number | null;
  passed: boolean | null;
  durationSec: number | null;
  at: string;
}

export async function fetchMySessions() {
  const { data } = await api.get('/my/sessions');
  return data as { records: MySessionRecord[] };
}

// ====== 成长 API ======

export async function fetchGrowth() {
  const { data } = await api.get('/growth');
  return data as GrowthData;
}

// ====== 场景构建 API（admin） ======

export interface ScenarioPayload {
  name: string;
  personaConfigId: string;
  skillPointIds: string[];
  passScore: number;
  durationMinutes: number;
  difficulty?: number;
  coverageTopics?: string[];
  methodology?: string;
  source?: string;
}

export async function createScenario(payload: ScenarioPayload) {
  const { data } = await api.post('/scenarios', payload);
  return data as { scenario: Scenario };
}

export async function updateScenario(id: string, payload: Partial<ScenarioPayload>) {
  const { data } = await api.put(`/scenarios/${id}`, payload);
  return data as { scenario: Scenario };
}

export async function deleteScenario(id: string) {
  await api.delete(`/scenarios/${id}`);
}

export interface PersonaConfigPayload {
  name: string;
  background: string;
  age?: number;
  occupation?: string;
  elementIds?: string[];
  behaviorBands?: { key: string; instruction: string; minArousal: number; maxArousal: number }[];
  voiceProfile?: Record<string, unknown>;
}

export async function createPersonaConfig(payload: PersonaConfigPayload) {
  const { data } = await api.post('/persona-configs', payload);
  return data as { persona: PersonaConfig };
}

export async function updatePersonaConfig(id: string, payload: Partial<PersonaConfigPayload>) {
  const { data } = await api.put(`/persona-configs/${id}`, payload);
  return data as { persona: PersonaConfig };
}

export async function fetchSkillPoints() {
  const { data } = await api.get('/skill-points');
  return data as { skillPoints: import('./types').SkillPoint[] };
}

/** 试聊：不落库的角色试聊 */
export async function trialChat(personaConfigId: string, messages: { role: 'user' | 'assistant'; content: string }[]) {
  const { data } = await api.post(`/persona-configs/${personaConfigId}/trial-chat`, { messages });
  return data as { reply: string };
}

// ====== 场景 AI 辅助提取 ======

export interface ScenarioExtractResult {
  transcript?: string;
  reply: string;
  fields: Record<string, unknown>;
}

/** 文字描述 → 场景维度提取；current 为当前表单快照时做增量修改 */
export async function extractScenarioFromText(text: string, current?: Record<string, unknown>) {
  const { data } = await api.post('/scenarios/extract', { text, current });
  return data as ScenarioExtractResult;
}

/** 语音（wav）→ ASR → 场景维度提取；current 为当前表单快照时做增量修改 */
export async function extractScenarioFromAudio(wav: Blob, current?: Record<string, unknown>) {
  const fd = new FormData();
  // current 必须先于文件字段 append，后端 request.file() 才能读到
  if (current) fd.append('current', JSON.stringify(current));
  fd.append('file', wav, 'voice.wav');
  const { data } = await api.post('/scenarios/extract', fd);
  return data as ScenarioExtractResult;
}

// ====== 用户偏好 ======

export type Preferences = Record<string, unknown>;

export async function fetchPreferences() {
  const { data } = await api.get('/users/me/preferences');
  return data as { preferences: Preferences };
}

export async function savePreferences(preferences: Preferences) {
  const { data } = await api.put('/users/me/preferences', preferences);
  return data as { preferences: Preferences };
}

// ====== 新手指引（地推引流课） API ======

export type GuidanceVoiceRole = 'persona' | 'coach' | 'sales' | 'narrator';

export interface DemoLine {
  role: 'sales' | 'customer' | 'narrator';
  text: string;
}

/** 资格提问回答：raw PCM 上传，返回识别文本；q=2 时 experienced 给出结论 */
export async function qualifyAnswer(sessionId: string, q: 1 | 2, audio: ArrayBuffer) {
  const { data } = await api.post(`/sessions/${sessionId}/qualify-answer?q=${q}`, audio, {
    headers: { 'Content-Type': 'audio/pcm' },
  });
  return data as { text: string; experienced: boolean | null };
}

/** 获取一版示范对话剧本 */
export async function fetchDemo(sessionId: string, version: number) {
  const { data } = await api.post(`/sessions/${sessionId}/demo`, { version });
  return data as { lines: DemoLine[] };
}

/** 示范播完后的语音选择：raw PCM 上传，返回识别文本与选择 */
export async function demoChoice(sessionId: string, audio: ArrayBuffer) {
  const { data } = await api.post(`/sessions/${sessionId}/demo-choice`, audio, {
    headers: { 'Content-Type': 'audio/pcm' },
  });
  return data as { text: string; choice: 'replay' | 'practice' };
}

/** 任意文本合成语音；voiceRole 选择音色（默认 persona） */
export async function ttsClip(sessionId: string, text: string, voiceRole: GuidanceVoiceRole = 'persona') {
  const { data } = await api.post(`/sessions/${sessionId}/tts`, { text, voiceRole });
  return data as { audioBase64: string; audioFormat: string };
}

// ====== 语音 WebSocket =======

/** 语音 WS 地址（token 经 query 传递，浏览器 WS 无法带 header） */
export function voiceWsUrl(sessionId: string, kind: 'voice' | 'voice-call' = 'voice'): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const token = encodeURIComponent(getToken() ?? '');
  return `${proto}//${window.location.host}/api/v1/sessions/${sessionId}/${kind}?token=${token}`;
}

export default api;
