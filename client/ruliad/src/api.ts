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
  OrganizationItem,
  ManagerType,
  KbEntry,
  ManagementOverview,
ManagementTeamResults,
ManagementTeamAbility,
ManagementMemberProfile,
ManagementSessionDetail,
  ManagementKb,
  Feedback,
  FeedbackReply,
  FeedbackStatus,
  FeedbackType,
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
  const token = getToken();
  if (!token) return false;
  try {
    const encoded = token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(encoded)) as { exp?: number };
    return typeof payload.exp === 'number' && payload.exp * 1000 > Date.now();
  } catch {
    return false;
  }
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
        const redirect = `${window.location.pathname}${window.location.search}`;
        window.location.href = `/login?redirect=${encodeURIComponent(redirect)}`;
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
    if (err.code === 'ECONNABORTED') return '处理超时，请检查网络后重试';
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

export async function fetchScenarios(manage = false) {
  const { data } = await api.get('/scenarios', { params: manage ? { manage: 1 } : {} });
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

export async function voiceTurn(sessionId: string, audio: ArrayBuffer) {
  const { data } = await api.post(`/sessions/${sessionId}/voice-turn`, audio, {
    headers: { 'Content-Type': 'audio/pcm' },
  });
  return data as { userText: string; replyText: string };
}

export async function scoreHumorTest(sessionId: string) {
  const { data } = await api.post(`/sessions/${sessionId}/humor-test-score`);
  return data as { deduction: number; rationale: string; betterScript?: string; userText: string; prosody?: unknown };
}

export async function startFluencyTest(sessionId: string) {
  const { data } = await api.post(`/sessions/${sessionId}/fluency-test/start`);
  return data as { questions: Array<{ question: string }>; total: number };
}

export async function answerFluencyTest(sessionId: string, audio: ArrayBuffer) {
  const { data } = await api.post(`/sessions/${sessionId}/fluency-test-answer`, audio, {
    headers: { 'Content-Type': 'audio/pcm' },
  });
  return data as { userText: string; answeredCount: number; total: number };
}

export interface FluencyTurnAnalysis {
  seq: number;
  fillerCount: number;
  repetitionCount: number;
  disruptedPauseCount: number;
  pauseRatio: number;
  averageVoicedSegmentMs: number;
  severe: boolean;
  reasons: string[];
}

export interface FluencyTestResult {
  triggered: boolean;
  deduction: number;
  rationale: string;
  evidence: string[];
  fillerCount: number;
  repetitionCount: number;
  disruptedPauseCount: number;
  affectedTurns: number;
  userText: string;
  turns: FluencyTurnAnalysis[];
  answers: Array<{ question: string; text: string; analysis: FluencyTurnAnalysis }>;
}

export async function scoreFluencyTest(sessionId: string) {
  const { data } = await api.post(`/sessions/${sessionId}/fluency-test-score`);
  return data as FluencyTestResult;
}

export interface InstitutionQaItem {
  question: string;
  answer: string;
}

export async function fetchInstitutionOnboardingStatus() {
  const { data } = await api.get('/institution-onboarding/status');
  return data as { completed: boolean; questionCount: number; qa: InstitutionQaItem[] };
}

export async function answerInstitutionQuestions(audio: ArrayBuffer) {
  const { data } = await api.post('/institution-onboarding/answer', audio, {
    headers: { 'Content-Type': 'audio/pcm' },
    timeout: 10 * 60 * 1000,
  });
  return data as { qa: InstitutionQaItem[] };
}

export async function reviseInstitutionQa(qa: InstitutionQaItem[], audio: ArrayBuffer) {
  const form = new FormData();
  form.append('qa', JSON.stringify(qa));
  form.append('file', new Blob([audio], { type: 'audio/pcm' }), 'revision.pcm');
  const { data } = await api.post('/institution-onboarding/revise', form, { timeout: 3 * 60 * 1000 });
  return data as { action: 'modify' | 'done'; qa: InstitutionQaItem[]; rationale: string };
}

export async function completeInstitutionOnboarding(qa: InstitutionQaItem[]) {
  const { data } = await api.post('/institution-onboarding/complete', { qa });
  return data as { completed: boolean; entries: number };
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
  return data as { sessionId: string; scoring?: boolean; skippedReport?: boolean };
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
  if (data.report) localNotify('练习报告已生成', '本次评分与反馈已就绪');
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
  completionStatus?: 'completed' | 'incomplete';
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
  productKBId?: string | null;
  drillScriptId?: string | null;
  scoreItemIds?: string[];
  methodology?: string;
  source?: string;
  sceneType?: SceneType;
  category?: import('./types').ScoreCategory;
  flowType?: 'generic' | 'ground_push' | 'reception';
  script?: ScenarioScript | null;
  participants?: ScenarioParticipant[] | null;
  conversation?: Scenario['conversation'] | null;
  status?: 'draft' | 'published';
  expectedVersion?: number;
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
  industry?: string;
  personalityTags?: string[];
  decisionStyle?: string;
  objections?: string[];
  hiddenInfo?: string[];
  elementIds?: string[];
  productKBId?: string | null;
  behaviorBands?: { key: string; instruction: string; minArousal: number; maxArousal: number }[];
  knowledgeBoundary?: { mustNotKnow?: string[]; loadedKnowledge?: string[] };
  voiceProfile?: Record<string, unknown>;
  expectedVersion?: number;
}

export async function fetchPersonaConfig(id: string) {
  const { data } = await api.get(`/persona-configs/${id}`);
  return data as PersonaConfig;
}

export async function createPersonaConfig(payload: PersonaConfigPayload) {
  const { data } = await api.post('/persona-configs', payload);
  return data as PersonaConfig;
}

export async function updatePersonaConfig(id: string, payload: Partial<PersonaConfigPayload>) {
  const { data } = await api.put(`/persona-configs/${id}`, payload);
  return data as PersonaConfig;
}

export async function deletePersonaConfig(id: string) {
  await api.delete(`/persona-configs/${id}`);
}

export async function fetchSkillPoints() {
  const { data } = await api.get('/skill-points');
  return data as { skillPoints: import('./types').SkillPoint[] };
}

export async function createSkillPoint(payload: Partial<import('./types').SkillPoint>) {
  const { data } = await api.post('/skill-points', payload);
  return data as import('./types').SkillPoint;
}

export async function updateSkillPoint(id: string, payload: Partial<import('./types').SkillPoint>) {
  const { data } = await api.put(`/skill-points/${id}`, payload);
  return data as import('./types').SkillPoint;
}

export async function deleteSkillPoint(id: string) {
  await api.delete(`/skill-points/${id}`);
}

export async function listElements() {
  const { data } = await api.get('/elements');
  return data as { elements: import('./types').Element[] };
}

export async function createElement(payload: Partial<import('./types').Element>) {
  const { data } = await api.post('/elements', payload);
  return data as import('./types').Element;
}

export async function updateElement(id: string, payload: Partial<import('./types').Element> & { expectedVersion: number }) {
  const { data } = await api.put(`/elements/${id}`, payload);
  return data as import('./types').Element;
}

export async function deleteElement(id: string) {
  await api.delete(`/elements/${id}`);
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
  commandId?: string;
  general?: boolean;
  generalReason?: string;
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

export type ResourceEditTarget = 'scenario' | 'persona' | 'skill-point' | 'element' | 'product-kb' | 'demo-faq' | 'demo-script' | 'drill-script' | 'score-item' | 'golden-case' | 'briefing-standard' | 'realism-standard' | 'scenario-guidance';

export interface ResourceEditPreview {
  transcript?: string;
  reply: string;
  patch: Record<string, unknown>;
  expectedRevision: string;
  affectedScenarios?: Array<{ id: string; name: string }>;
  commandId: string;
  general: boolean;
  generalReason?: string;
}

export async function listResourceItems(target: ResourceEditTarget) {
  const { data } = await api.get('/library/resource-items', { params: { target } });
  return data as { items: Array<{ id: string; name: string; revision: string; version?: number; createdBy?: string; owned: boolean }> };
}

export async function previewResourceEdit(target: ResourceEditTarget, id: string | undefined, text: string) {
  const { data } = await api.post('/library/ai-edit', { target, id, text });
  return data as ResourceEditPreview;
}

export async function previewResourceEditAudio(target: ResourceEditTarget, id: string | undefined, wav: Blob) {
  const fd = new FormData();
  fd.append('target', target);
  fd.append('id', id ?? '');
  fd.append('file', wav, 'resource-edit.wav');
  const { data } = await api.post('/library/ai-edit', fd);
  return data as ResourceEditPreview;
}

export async function applyResourceEdit(target: ResourceEditTarget, id: string | undefined, patch: Record<string, unknown>, expectedRevision: string, commandId: string) {
  const { data } = await api.post('/library/ai-edit', { target, id, patch, expectedRevision, commandId, apply: true });
  return data as { item?: { id: string; name?: string }; revision?: string; pendingReview?: boolean; command: import('./types').VoiceEditCommand };
}

// ====== 语音自动场景创建和配置（统一入口，替代分资源类型的语音编辑） ======

/** 语音配置上下文：嵌入场景编辑器时传入当前场景与表单快照，服务端据此自动定位对象 */
export interface VoiceConfigContext {
  scenarioId?: string;
  form?: Record<string, unknown>;
}

/** 单条操作预览：LLM 提炼 + 服务端定位/权限策略后的结果 */
export interface VoiceConfigOperationPreview {
  index: number;
  target: string;
  action: 'create' | 'update';
  subject: string;
  resourceName?: string;
  fields: Record<string, unknown>;
  persona: Record<string, unknown>;
  skillPointNames: string[];
  scoreItemNames: string[];
  drillScriptName: string;
  conversation: Record<string, unknown>;
  resolvedResourceId?: string;
  scope: 'direct' | 'copy-on-write' | 'general';
  scopeReason?: string;
  impact: Array<{ id: string; name: string }>;
  general: boolean;
  generalReason?: string;
  planKind: string;
  diagnosis?: import('./types').VoiceConfigDiagnosis;
}

/** 评分原因解读结果（询问上一场评分时返回，无可应用的编辑操作） */
export interface ScoreExplainResult {
  scenarioName: string;
  sessionId: string;
  sessionAt: string;
  totalScore: number;
  passed: boolean;
  answer: string;
}

export interface VoiceConfigPreview {
  transcript?: string;
  reply: string;
  operations: VoiceConfigOperationPreview[];
  general: boolean;
  hasPrivate: boolean;
  commandId: string;
  expectedRevisions: Record<string, string>;
  /** 评分原因解读：存在时不渲染编辑操作，也没有确认应用按钮 */
  scoreExplain?: ScoreExplainResult;
}

/** 文字指令 → 生成配置预览（不直接落库） */
export async function previewVoiceConfigText(text: string, context?: VoiceConfigContext) {
  const { data } = await api.post('/library/voice-config', { text, context });
  return data as VoiceConfigPreview;
}

/** 语音（wav）→ ASR → 生成配置预览 */
export async function previewVoiceConfigAudio(wav: Blob, context?: VoiceConfigContext) {
  const fd = new FormData();
  // context 必须先于文件字段 append，后端 request.file() 才能读到
  if (context) fd.append('context', JSON.stringify(context));
  fd.append('file', wav, 'voice-config.wav');
  const { data } = await api.post('/library/voice-config', fd);
  return data as VoiceConfigPreview;
}

/** 确认应用已生成的预览命令（apply=true）；返回落库结果或通用建议待处理标记 */
export async function applyVoiceConfig(commandId: string, expectedRevisions: Record<string, string>, context?: VoiceConfigContext) {
  const { data } = await api.post('/library/voice-config', { apply: true, commandId, expectedRevisions, context });
  return data as {
    pendingReview?: boolean;
    command: import('./types').VoiceEditCommand;
    result?: Record<string, unknown>;
  };
}

/** 语音配置命令日志（普通用户仅看自己的；管理员可看全部/筛选通用建议） */
export async function listVoiceConfigLogs(generalOnly = false) {
  const { data } = await api.get('/library/voice-config/logs', { params: generalOnly ? { general: '1' } : {} });
  return data as { items: import('./types').VoiceEditCommand[] };
}

/** 管理员处理通用建议 */
export async function reviewVoiceConfigCommand(id: string, payload: { status?: 'pending_review' | 'in_review' | 'resolved' | 'rejected'; reviewNote?: string }) {
  const { data } = await api.patch(`/library/voice-config/logs/${id}`, payload);
  return data as import('./types').VoiceEditCommand;
}

export async function listVoiceEditCommands(generalOnly = false) {
  const { data } = await api.get('/voice-edit-commands', { params: generalOnly ? { general: 1 } : {} });
  return data as { items: import('./types').VoiceEditCommand[] };
}

export async function markVoiceEditCommandApplied(id: string) {
  const { data } = await api.post(`/voice-edit-commands/${id}/applied`);
  return data as import('./types').VoiceEditCommand;
}

export async function reviewVoiceEditCommand(id: string, payload: { status?: 'pending_review' | 'in_review' | 'resolved' | 'rejected'; reviewNote?: string }) {
  const { data } = await api.patch(`/voice-edit-commands/${id}`, payload);
  return data as import('./types').VoiceEditCommand;
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

// ====== 机构 API ======

/** 机构列表（含成员/团队规模） */
export async function fetchOrganizations() {
  const { data } = await api.get('/organizations');
  return data as { organizations: OrganizationItem[] };
}

/** 新建机构（系统管理员）；返回新建机构 */
export async function createOrganization(name: string, parentId?: string, description?: string) {
  const { data } = await api.post(
    '/organizations',
    description ? { name, parentId, description } : parentId ? { name, parentId } : { name }
  );
  return data as { organization: OrganizationItem };
}

/** 更新机构（系统管理员）：名称 / 简介 / 上级机构 */
export async function updateOrganization(
  id: string,
  patch: { name?: string; description?: string | null; parentId?: string | null }
) {
  const { data } = await api.put(`/organizations/${id}`, patch);
  return data as { organization: OrganizationItem };
}

/** 用户列表（系统管理员专属，已剔除 passwordHash） */
export async function fetchUsers() {
  const { data } = await api.get('/users');
  return data as User[];
}

/** 更新用户（系统管理员专属）：角色 / 管理者类型 / 所属机构 */
export async function updateUser(
  id: string,
  patch: { role?: User['role']; managerType?: ManagerType | null; orgId?: string }
) {
  const { data } = await api.patch(`/users/${id}`, patch);
  return data as { user: User };
}

// ====== 管理者后台 API ======

/** 管理总览 */
export async function fetchManagementOverview() {
  const { data } = await api.get('/management/overview');
  return data as ManagementOverview;
}

/** 团队成果 */
export async function fetchManagementTeamResults() {
  const { data } = await api.get('/management/team-results');
  return data as ManagementTeamResults;
}

/** 团队能力分析 */
export async function fetchManagementTeamAbility() {
  const { data } = await api.get('/management/team-ability');
  return data as ManagementTeamAbility;
}

/** 成员档案（团队能力分析下钻） */
export async function fetchManagementMemberProfile(userId: string) {
  const { data } = await api.get(`/management/team-ability/member/${userId}`);
  return data as ManagementMemberProfile;
}

/** 成员单次练习详情：评分报告 + 录音回放条目（管理者下钻） */
export async function fetchManagementSessionDetail(userId: string, sessionId: string) {
  const { data } = await api.get(`/management/team-ability/member/${userId}/session/${sessionId}`);
  return data as ManagementSessionDetail;
}

/** 知识库读取 */
export async function fetchManagementKnowledgeBase() {
  const { data } = await api.get('/management/knowledge-base');
  return data as ManagementKb;
}

/** 知识库整体保存（name + 全量条目，自动递增版本） */
export async function saveManagementKnowledgeBase(payload: { name: string; entries: Array<Partial<KbEntry>>; expectedVersion?: number }) {
  const { data } = await api.put('/management/knowledge-base', payload);
  return data as { success: boolean; version: number };
}

/** 知识库增量保存（按 id upsert；未传 id 视为新增） */
export async function appendManagementKnowledgeBase(entries: Array<Partial<KbEntry>>) {
  const { data } = await api.post('/management/knowledge-base', { entries });
  return data as { added: number; updated: number; total: number; version: number };
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

/** 资格提问回答（流式识别已出文本）：直接传文本，服务端跳过 ASR */
export async function qualifyAnswerText(sessionId: string, q: number, text: string) {
  const { data } = await api.post(`/sessions/${sessionId}/qualify-answer?q=${q}`, { text });
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

/** 示范播完后的语音选择（流式识别已出文本）：直接传文本，服务端跳过 ASR */
export async function demoChoiceText(sessionId: string, text: string) {
  const { data } = await api.post(`/sessions/${sessionId}/demo-choice`, { text });
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

// ====== 录音管理 API（admin） ======

export interface RecordingItem {
  id: string;
  sessionId: string;
  userId: string;
  userName: string;
  scenarioId: string;
  scenarioName: string;
  mode: 'practice' | 'exam';
  turnSeq: number;
  durationSec: number;
  fileSize: number;
  createdAt: string;
  /** 详情接口返回：音频文件是否还在磁盘上 */
  fileExists?: boolean;
}

/** 会话分组：同一场练习会话的全部录音（组内按说话顺序 turnSeq 升序） */
export interface RecordingGroup {
  sessionId: string;
  userId: string;
  userName: string;
  scenarioId: string;
  scenarioName: string;
  mode: 'practice' | 'exam';
  /** 会话内录音条数 */
  turnCount: number;
  /** 会话内最早一条录音时间 */
  startedAt: string;
  /** 会话内最近一条录音时间 */
  lastAt: string;
  items: RecordingItem[];
}

export interface RecordingQuery {
  userId?: string;
  sessionId?: string;
  scenarioId?: string;
  mode?: 'practice' | 'exam';
  /** 关键字搜索（用户名 / 用户ID / 场景名 / 场景ID / 会话ID） */
  keyword?: string;
  limit?: number;
  offset?: number;
}

export async function fetchRecordings(query: RecordingQuery = {}) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== '') params.set(k, String(v));
  }
  const { data } = await api.get(`/recordings?${params.toString()}`);
  return data as {
    groups: RecordingGroup[];
    totalItems: number;
    total: number;
    offset: number;
    limit: number;
  };
}

export async function deleteRecording(id: string) {
  await api.delete(`/recordings/${id}`);
}

/** 录音回放地址：token 经 query 传入（<audio> 标签无法带 Authorization header） */
export function recordingAudioUrl(id: string): string {
  const token = encodeURIComponent(getToken() ?? '');
  return `/api/v1/recordings/${id}/audio?token=${token}`;
}

// ====== 语音 WebSocket =======

/** 语音 WS 地址（token 经 query 传递，浏览器 WS 无法带 header）；asr-stream = 新手指引流式识别通道 */
export function voiceWsUrl(sessionId: string, kind: 'voice' | 'voice-call' | 'asr-stream' = 'voice'): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const token = encodeURIComponent(getToken() ?? '');
  return `${proto}//${window.location.host}/api/v1/sessions/${sessionId}/${kind}?token=${token}`;
}

/** 语音自动配置的流式识别通道地址（浏览器 WS 无法带 header，token 经 query 传入） */
export function voiceConfigAsrStreamUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const token = encodeURIComponent(getToken() ?? '');
  return `${proto}//${window.location.host}/api/v1/library/voice-config/asr-stream?token=${token}`;
}

// ====== 用户反馈 API ======

/** 提交文字反馈 */
export async function submitFeedbackText(payload: { type: FeedbackType; content: string; source?: string }) {
  const { data } = await api.post('/feedback', payload);
  return data as Feedback;
}

/** 提交语音反馈：wav 音频上传，后端 ASR 转写为反馈内容 */
export async function submitFeedbackAudio(payload: { type: FeedbackType; source?: string; wav: Blob }) {
  const fd = new FormData();
  fd.append('type', payload.type);
  if (payload.source?.trim()) fd.append('source', payload.source.trim());
  fd.append('file', payload.wav, 'feedback.wav');
  const { data } = await api.post('/feedback', fd, { timeout: 3 * 60 * 1000 });
  return data as Feedback;
}

/** 我的反馈列表（当前登录用户） */
export async function fetchMyFeedback() {
  const { data } = await api.get('/my/feedback');
  return data as { feedbacks: Feedback[] };
}

export interface FeedbackAdminQuery {
  status?: FeedbackStatus | '';
  type?: FeedbackType | '';
  userId?: string;
  limit?: number;
  offset?: number;
}

/** 全部反馈列表（admin/platform） */
export async function fetchAllFeedback(query: FeedbackAdminQuery = {}) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== '') params.set(k, String(v));
  }
  const { data } = await api.get(`/feedback?${params.toString()}`);
  return data as { feedbacks: Feedback[]; total: number; offset: number; limit: number };
}

/** 反馈详情（admin/platform） */
export async function fetchFeedbackDetail(id: string) {
  const { data } = await api.get(`/feedback/${id}`);
  return data as Feedback;
}

/** 回复反馈（admin/platform） */
export async function replyFeedback(id: string, content: string) {
  const { data } = await api.post(`/feedback/${id}/reply`, { content });
  return data as FeedbackReply;
}

/** 更新反馈状态（admin/platform） */
export async function updateFeedbackStatus(id: string, status: FeedbackStatus) {
  const { data } = await api.patch(`/feedback/${id}/status`, { status });
  return data as Feedback;
}

/** 删除反馈（admin/platform） */
export async function deleteFeedback(id: string) {
  await api.delete(`/feedback/${id}`);
}

export default api;
