import axios from 'axios';
import type {
  User,
  Scenario,
  PersonaConfig,
  GrowthData,
  ReviewData,
  TurnResult,
  SessionCreated,
  Session,
  ExamWindow,
  SceneType,
  ScenarioScript,
  ScenarioParticipant,
  DemoFaq,
  DrillScript,
  GoldenCase,
  ScoreItemDef,
} from './types';

const TOKEN_KEY = 'grasp-token';
const USER_KEY = 'grasp-user';
const PREFS_KEY = 'grasp-prefs';

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
  localStorage.removeItem(PREFS_KEY);
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

// ====== 会话 API ======

export async function createSession(scenarioId: string, mode: 'practice' | 'exam' = 'practice', examWindowId?: string) {
  const { data } = await api.post('/sessions', {
    scenarioId,
    mode,
    ...(examWindowId ? { examWindowId } : {}),
    // 自动附上设置页的教练提示强度偏好，Practice 等调用方无需关心
    coachIntensity: getPreferredCoachIntensity(),
  });
  return data as SessionCreated;
}

export async function fetchExamWindows() {
  const { data } = await api.get('/exam-windows');
  return data as { windows: ExamWindow[] };
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

/** 提交考题答案；返回对错、得分、解析与正确答案（答题后展示用） */
export async function submitQuizAnswer(sessionId: string, quizId: string, answer: string[]) {
  const { data } = await api.post(`/sessions/${sessionId}/quiz-answer`, { quizId, answer });
  return data as {
    correct: boolean;
    score: number;
    explanation?: string;
    correctAnswer?: string[] | string;
  };
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

/** 进入正式对练（live）：通知服务端从此刻开始倒计时（幂等）。失败不影响本地流程 */
export async function markLiveStart(sessionId: string) {
  const { data } = await api.post(`/sessions/${sessionId}/live-start`);
  return data as { remainingSeconds: number | null };
}

export async function fetchReview(sessionId: string) {
  const { data } = await api.get(`/sessions/${sessionId}/review`);
  // 报告就绪即触发本地通知（受设置页「报告生成通知」开关控制）
  localNotify('练习报告已生成', '本次评分与反馈已就绪');
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
  description?: string | null;
  productKBId?: string;
  methodology?: string;
  source?: string;
  sceneType?: SceneType;
  script?: ScenarioScript | null;
  participants?: ScenarioParticipant[] | null;
}

export async function createScenario(payload: ScenarioPayload) {
  const { data } = await api.post('/scenarios', payload);
  return data as Scenario;
}

export async function updateScenario(id: string, payload: Partial<ScenarioPayload>) {
  const { data } = await api.put(`/scenarios/${id}`, payload);
  return data as Scenario;
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
  return data as PersonaConfig;
}

export async function updatePersonaConfig(id: string, payload: Partial<PersonaConfigPayload>) {
  const { data } = await api.put(`/persona-configs/${id}`, payload);
  return data as PersonaConfig;
}

export async function fetchSkillPoints() {
  const { data } = await api.get('/skill-points');
  return data as { skillPoints: import('./types').SkillPoint[] };
}

/** 试聊：不落库的角色试聊。后端契约为 { text, history }：text 为最新一条用户消息，history 为之前的多轮 */
export async function trialChat(personaConfigId: string, messages: { role: 'user' | 'assistant'; content: string }[]) {
  const last = messages[messages.length - 1];
  const { data } = await api.post(`/persona-configs/${personaConfigId}/trial-chat`, {
    text: last?.role === 'user' ? last.content : '',
    history: messages.slice(0, -1),
  });
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

// ====== 资源库管理 API（admin） ======

// ---- 讲解标准库 / 演练真实度标准库 / 场景指引配置（新手指引五步流程配套） ----

export async function listBriefingStandards() {
  const { data } = await api.get('/library/briefing-standards');
  return data as { items: import('./lib/guidance').BriefingStandard[] };
}

/** upsert：body 带 id 则更新，否则新建 */
export async function saveBriefingStandard(payload: Partial<import('./lib/guidance').BriefingStandard>) {
  const { data } = await api.post('/library/briefing-standards', payload);
  return data as import('./lib/guidance').BriefingStandard;
}

export async function deleteBriefingStandard(id: string) {
  await api.delete(`/library/briefing-standards/${id}`);
}

export async function listRealismStandards() {
  const { data } = await api.get('/library/realism-standards');
  return data as { items: import('./lib/guidance').RealismStandard[] };
}

/** upsert：body 带 id 则更新，否则新建 */
export async function saveRealismStandard(payload: Partial<import('./lib/guidance').RealismStandard>) {
  const { data } = await api.post('/library/realism-standards', payload);
  return data as import('./lib/guidance').RealismStandard;
}

export async function deleteRealismStandard(id: string) {
  await api.delete(`/library/realism-standards/${id}`);
}

export async function listScenarioGuidances() {
  const { data } = await api.get('/library/scenario-guidance');
  return data as { items: import('./lib/guidance').ScenarioGuidance[] };
}

/** upsert：body 带 id 则更新，否则新建；scenarioId / name / qualifyQuestions 后端必填校验 */
export async function saveScenarioGuidance(payload: Partial<import('./lib/guidance').ScenarioGuidance>) {
  const { data } = await api.post('/library/scenario-guidance', payload);
  return data as import('./lib/guidance').ScenarioGuidance;
}

export async function deleteScenarioGuidance(id: string) {
  await api.delete(`/library/scenario-guidance/${id}`);
}

export async function fetchPersonaConfigs() {
  const { data } = await api.get('/persona-configs');
  return data as { personaConfigs: PersonaConfig[] };
}

export type LibraryExtractTarget = 'scenario' | 'demo-faq' | 'score-item' | 'golden-case' | 'briefing-standard' | 'realism-standard';

export interface LibraryExtractResult {
  reply: string;
  rows: Record<string, unknown>[];
}

/** 整段文字 AI 提炼为资源库条目（不落库） */
export async function extractLibraryRows(target: LibraryExtractTarget, text: string) {
  const { data } = await api.post('/library/extract', { target, text });
  return data as LibraryExtractResult;
}

// ---- 示范问答库 ----

export async function listDemoFaqs(category?: string) {
  const { data } = await api.get('/library/demo-faqs', { params: category ? { category } : {} });
  return data as { faqs: DemoFaq[] };
}

export async function createDemoFaq(payload: Partial<DemoFaq>) {
  const { data } = await api.post('/library/demo-faqs', payload);
  return data as DemoFaq;
}

export async function batchCreateDemoFaqs(items: Partial<DemoFaq>[]) {
  const { data } = await api.post('/library/demo-faqs/batch', { items });
  return data as { count: number; faqs: DemoFaq[] };
}

export async function updateDemoFaq(id: string, payload: Partial<DemoFaq>) {
  const { data } = await api.put(`/library/demo-faqs/${id}`, payload);
  return data as DemoFaq;
}

export async function deleteDemoFaq(id: string) {
  await api.delete(`/library/demo-faqs/${id}`);
}

// ---- 示范剧本库 ----

export async function listDemoScripts(category?: string) {
  const { data } = await api.get('/library/demo-scripts', { params: category ? { category } : {} });
  return data as { items: import('./types').DemoScript[] };
}

export async function createDemoScript(payload: Partial<import('./types').DemoScript>) {
  const { data } = await api.post('/library/demo-scripts', payload);
  return data as import('./types').DemoScript;
}

export async function updateDemoScript(id: string, payload: Partial<import('./types').DemoScript>) {
  const { data } = await api.put(`/library/demo-scripts/${id}`, payload);
  return data as import('./types').DemoScript;
}

export async function deleteDemoScript(id: string) {
  await api.delete(`/library/demo-scripts/${id}`);
}

// ---- 评分标准定义 ----

export async function listScoreItems(skillPointId?: string) {
  const { data } = await api.get('/library/score-items', { params: skillPointId ? { skillPointId } : {} });
  return data as { items: ScoreItemDef[] };
}

export async function createScoreItem(payload: Partial<ScoreItemDef>) {
  const { data } = await api.post('/library/score-items', payload);
  return data as ScoreItemDef;
}

export async function updateScoreItem(id: string, payload: Partial<ScoreItemDef>) {
  const { data } = await api.put(`/library/score-items/${id}`, payload);
  return data as ScoreItemDef;
}

export async function deleteScoreItem(id: string) {
  await api.delete(`/library/score-items/${id}`);
}

// ---- 演练剧本库（模拟演练剧情参照：演练开始交给 LLM 理解，决定谁先开口、如何回应、何时结束） ----

export async function listDrillScripts(category?: string) {
  const { data } = await api.get('/library/drill-scripts', { params: category ? { category } : {} });
  return data as { items: DrillScript[] };
}

export async function createDrillScript(payload: Partial<DrillScript>) {
  const { data } = await api.post('/library/drill-scripts', payload);
  return data as DrillScript;
}

export async function updateDrillScript(id: string, payload: Partial<DrillScript>) {
  const { data } = await api.put(`/library/drill-scripts/${id}`, payload);
  return data as DrillScript;
}

export async function deleteDrillScript(id: string) {
  await api.delete(`/library/drill-scripts/${id}`);
}

// ---- 评分回归案例 ----

export async function listGoldenCases() {
  const { data } = await api.get('/library/golden-cases');
  return data as { cases: GoldenCase[] };
}

export async function createGoldenCase(payload: Partial<GoldenCase>) {
  const { data } = await api.post('/library/golden-cases', payload);
  return data as GoldenCase;
}

export async function updateGoldenCase(id: string, payload: Partial<GoldenCase>) {
  const { data } = await api.put(`/library/golden-cases/${id}`, payload);
  return data as GoldenCase;
}

export async function deleteGoldenCase(id: string) {
  await api.delete(`/library/golden-cases/${id}`);
}

// ====== 用户偏好 ======

export type Preferences = Record<string, unknown>;

/** 读本地缓存的偏好（voice.ts / createSession 等非组件代码的同步消费入口） */
export function getCachedPreferences(): Preferences {
  const raw = localStorage.getItem(PREFS_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Preferences;
  } catch {
    return {};
  }
}

/** 默认语速偏好 → TTS rate：慢 0.8 / 标准 1 / 快 1.25 */
export function getPreferredSpeechRate(): number {
  const v = getCachedPreferences().speechRate;
  if (v === 'slow') return 0.8;
  if (v === 'fast') return 1.25;
  return 1;
}

/** 教练提示强度偏好 → 会话创建参数（历史值 quiet 归一为 low） */
export function getPreferredCoachIntensity(): 'low' | 'medium' | 'high' {
  const v = getCachedPreferences().coachIntensity;
  if (v === 'high') return 'high';
  if (v === 'low' || v === 'quiet') return 'low';
  return 'medium';
}

/** 本地通知；未开偏好或浏览器未授权时静默跳过 */
export function localNotify(title: string, body?: string) {
  if (getCachedPreferences().notifyReport === false) return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    new Notification(title, { body });
  } catch {
    /* 部分环境构造 Notification 受限，忽略 */
  }
}

export async function fetchPreferences() {
  const { data } = await api.get('/users/me/preferences');
  const prefs = (data as { preferences?: Preferences }).preferences ?? {};
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  return data as { preferences: Preferences };
}

export async function savePreferences(preferences: Preferences) {
  const { data } = await api.put('/users/me/preferences', preferences);
  const saved = (data as { preferences?: Preferences }).preferences ?? preferences;
  localStorage.setItem(PREFS_KEY, JSON.stringify(saved));
  return data as { preferences: Preferences };
}

// ====== 账号管理 API ======

/** 修改密码；旧密码错误时后端返回 400 */
export async function changePassword(oldPassword: string, newPassword: string) {
  await api.post('/auth/change-password', { oldPassword, newPassword });
}

/** 导出我的数据（JSON） */
export async function exportMyData() {
  const { data } = await api.get('/users/me/export');
  return data;
}

/** 注销账号（204）；调用方负责清理本地状态并跳转登录页 */
export async function deleteAccount() {
  await api.delete('/users/me');
}

// ====== 新手指引 API ======

export type GuidanceVoiceRole = 'persona' | 'coach' | 'sales' | 'narrator' | 'child';

/** 场景新手指引包；guidance 为 null 表示该场景无引导资源（调用方回退本地逻辑） */
export async function fetchGuidance(scenarioId: string) {
  const { data } = await api.get(`/scenarios/${scenarioId}/guidance`);
  return data as { guidance: import('./lib/guidance').ScenarioGuidance | null };
}

export interface DemoLine {
  role: 'sales' | 'customer' | 'child' | 'narrator';
  text: string;
  /** TTS 情绪唤醒度（小朋友小声/大声靠它区分） */
  arousal?: number;
  /** 激情倍率（销售=3）：等比放大语速/音调抬升 */
  excitement?: number;
  /** 销售对小朋友说话的台词：播报放轻放缓 */
  soft?: boolean;
}

/** 资格提问回答：raw PCM 上传，返回识别文本；最后一题时 experienced 给出结论 */
export async function qualifyAnswer(sessionId: string, q: number, audio: ArrayBuffer) {
  const { data } = await api.post(`/sessions/${sessionId}/qualify-answer?q=${q}`, audio, {
    headers: { 'Content-Type': 'audio/pcm' },
  });
  return data as { text: string; experienced: boolean | null };
}

/** 获取一版示范对话剧本；无示范模式时 lines 为空且 hasDemo=false */
export async function fetchDemo(sessionId: string, version: number) {
  const { data } = await api.post(`/sessions/${sessionId}/demo`, { version });
  return data as { lines: DemoLine[]; hasDemo?: boolean };
}

/** 第3步讲解口播稿：每条一句，用教练音色逐条 TTS 播放 */
export async function fetchBriefing(sessionId: string) {
  const { data } = await api.post(`/sessions/${sessionId}/briefing`);
  return data as { lines: string[] };
}

/** 示范播完后的语音选择：raw PCM 上传，返回识别文本与选择 */
export async function demoChoice(sessionId: string, audio: ArrayBuffer) {
  const { data } = await api.post(`/sessions/${sessionId}/demo-choice`, audio, {
    headers: { 'Content-Type': 'audio/pcm' },
  });
  return data as { text: string; choice: 'replay' | 'practice' };
}

/** 任意文本合成语音；voiceRole 选择音色（默认 persona），arousal 控制情绪唤醒度，excitement 为激情倍率；rate 取设置页默认语速偏好；soft 表示对小朋友说话（放轻放缓，避免吓到孩子） */
export async function ttsClip(sessionId: string, text: string, voiceRole: GuidanceVoiceRole = 'persona', arousal?: number, excitement?: number, soft?: boolean) {
  const rate = getPreferredSpeechRate();
  const { data } = await api.post(`/sessions/${sessionId}/tts`, {
    text,
    voiceRole,
    arousal,
    excitement: soft ? Math.min(excitement ?? 4, 4) : excitement,
    rate: soft ? Math.max(0.5, rate * 0.9) : rate,
  });
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
