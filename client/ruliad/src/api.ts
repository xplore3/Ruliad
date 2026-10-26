import axios from 'axios';
import type {
  User,
  Scenario,
  Session,
  RoleCard,
  GrowthData,
  TaskView,
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
  // Demo 模式：始终返回 true
  return true;
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function getStoredUser(): StoredUser | null {
  // Demo 模式：返回模拟用户
  return {
    id: 'demo-user-001',
    username: 'demo',
    name: '演示用户',
    role: 'admin',
    tenantId: 'demo-tenant',
  };
}

export function setStoredUser(user: StoredUser) {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

// ====== Mock Data（演示数据） ======

const MOCK_ROLE_CARDS: RoleCard[] = [
  { id: 'rc-001', scenarioId: 'sc-001', name: '王总', title: '电话销售 · 首次电话邀约', tags: ['B2B', '制造业'], target: '破冰开场，获取面谈机会', source: '官方', difficulty: '入门', industry: '制造业', role: '采购总监', avatar: '' },
  { id: 'rc-002', scenarioId: 'sc-002', name: '李经理', title: '客户主动咨询 · 产品咨询应答', tags: ['SaaS', '科技'], target: '准确传递产品价值，挖掘需求', source: '官方', difficulty: '进阶', industry: '科技', role: 'IT 经理', avatar: '' },
  { id: 'rc-003', scenarioId: 'sc-003', name: '张主任', title: '成交谈判 · 价格异议化解', tags: ['金融', '保险'], target: '守住价格底线，促成签约', source: '官方', difficulty: '高压', industry: '金融', role: '财务总监', avatar: '' },
  { id: 'rc-004', scenarioId: 'sc-004', name: '刘姐', title: '地推破冰 · 社区推广开场', tags: ['消费', '零售'], target: '30秒内打开话匣子', source: '官方', difficulty: '入门', industry: '零售', role: '消费者', avatar: '' },
  { id: 'rc-005', scenarioId: 'sc-005', name: '陈工', title: '电话销售 · 二次跟进促成', tags: ['工业', '设备'], target: '推动决策者拍板', source: '社区', difficulty: '进阶', industry: '工业', role: '技术主管', avatar: '' },
  { id: 'rc-006', scenarioId: 'sc-006', name: '赵总', title: '成交谈判 · 合同条款协商', tags: ['医疗', '器械'], target: '双赢签约', source: '官方', difficulty: '高压', industry: '医疗', role: '采购副总', avatar: '' },
  { id: 'rc-007', scenarioId: 'sc-007', name: '孙女士', title: '客户主动咨询 · 售后投诉处理', tags: ['电商', '消费'], target: '化解不满，挽留客户', source: '官方', difficulty: '进阶', industry: '电商', role: '客户', avatar: '' },
  { id: 'rc-008', scenarioId: 'sc-008', name: '周校长', title: '地推破冰 · 校园推广', tags: ['教育', 'B2B'], target: '建立信任，约定演示', source: '社区', difficulty: '入门', industry: '教育', role: '校长', avatar: '' },
];

const MOCK_TASKS: TaskView[] = [
  { scenarioId: 'sc-001', scenarioName: '首次电话邀约', durationMinutes: 8, difficulty: 1, status: 'passed', bestScore: 85, lastScore: 85, needsRetry: false, isReview: false, personaName: '王总', order: 1, requiredPassScore: 70, personaTitle: '采购总监', methodology: 'SPIN', practiceCount: 3 },
  { scenarioId: 'sc-002', scenarioName: '产品咨询应答', durationMinutes: 12, difficulty: 2, status: 'in_progress', bestScore: 0, lastScore: 0, needsRetry: false, isReview: false, personaName: '李经理', order: 2, requiredPassScore: 75, personaTitle: 'IT 经理', methodology: 'FAB', practiceCount: 0 },
  { scenarioId: 'sc-003', scenarioName: '价格异议化解', durationMinutes: 15, difficulty: 3, status: 'failed_pending_retry', bestScore: 58, lastScore: 58, needsRetry: true, isReview: false, personaName: '张主任', order: 3, requiredPassScore: 70, personaTitle: '财务总监', methodology: 'NEAT', practiceCount: 1 },
  { scenarioId: 'sc-005', scenarioName: '二次跟进促成', durationMinutes: 10, difficulty: 2, status: 'available', bestScore: 0, lastScore: 0, needsRetry: false, isReview: true, reviewDueAt: '2026-10-27T10:00:00Z', reviewLabel: 'D7', personaName: '陈工', order: 5, requiredPassScore: 70, personaTitle: '技术主管', methodology: 'SPIN', practiceCount: 0 },
];

const MOCK_SCENARIOS: Scenario[] = [
  { id: 'sc-001', tenantId: 'demo', name: '首次电话邀约', personaConfigId: 'p-001', successCriteria: { passScore: 70 }, durationMinutes: 8, difficulty: 2, coverageTopics: ['开场白', '需求确认'], personaName: '王总', personaTitle: '采购总监', skillPointNames: ['沟通表达', '需求洞察'], methodology: 'SPIN', source: '官方', practiceCount: 3 },
  { id: 'sc-002', tenantId: 'demo', name: '产品咨询应答', personaConfigId: 'p-002', successCriteria: { passScore: 75 }, durationMinutes: 12, difficulty: 3, coverageTopics: ['产品介绍', '异议预判'], personaName: '李经理', personaTitle: 'IT 经理', skillPointNames: ['产品讲解', '需求洞察'], methodology: 'FAB', source: '官方', practiceCount: 0 },
  { id: 'sc-003', tenantId: 'demo', name: '价格异议化解', personaConfigId: 'p-003', successCriteria: { passScore: 70 }, durationMinutes: 15, difficulty: 4, coverageTopics: ['价格谈判', '价值重塑'], personaName: '张主任', personaTitle: '财务总监', skillPointNames: ['异议处理', '成交推进'], methodology: 'NEAT', source: '官方', practiceCount: 1 },
];

const MOCK_GROWTH: GrowthData = {
  skills: [
    { skillPointId: 'sp-001', name: '沟通表达', currentLevel: 2, maxLevel: 3, history: [], historyCount: 8 },
    { skillPointId: 'sp-002', name: '需求洞察', currentLevel: 1, maxLevel: 3, history: [], historyCount: 5 },
    { skillPointId: 'sp-003', name: '产品讲解', currentLevel: 2, maxLevel: 3, history: [], historyCount: 6 },
    { skillPointId: 'sp-004', name: '异议处理', currentLevel: 1, maxLevel: 3, history: [], historyCount: 3 },
    { skillPointId: 'sp-005', name: '成交推进', currentLevel: 2, maxLevel: 3, history: [], historyCount: 4 },
    { skillPointId: 'sp-006', name: '情绪管理', currentLevel: 3, maxLevel: 3, history: [], historyCount: 7 },
  ],
  sessions: [
    { sessionId: 's-001', scenarioName: '首次电话邀约', mode: 'practice', totalScore: 85, passed: true, at: '2026-10-24T14:30:00Z', prevSessionId: undefined },
    { sessionId: 's-002', scenarioName: '首次电话邀约', mode: 'practice', totalScore: 72, passed: true, at: '2026-10-23T10:00:00Z', prevSessionId: 's-001' },
    { sessionId: 's-003', scenarioName: '产品咨询应答', mode: 'practice', totalScore: 68, passed: false, at: '2026-10-22T16:00:00Z', prevSessionId: undefined },
    { sessionId: 's-004', scenarioName: '价格异议化解', mode: 'practice', totalScore: 58, passed: false, at: '2026-10-21T09:00:00Z', prevSessionId: undefined },
    { sessionId: 's-005', scenarioName: '首次电话邀约', mode: 'exam', totalScore: 88, passed: true, at: '2026-10-20T15:00:00Z', prevSessionId: 's-002' },
    { sessionId: 's-006', scenarioName: '二次跟进促成', mode: 'practice', totalScore: 75, passed: true, at: '2026-10-19T11:30:00Z', prevSessionId: undefined },
    { sessionId: 's-007', scenarioName: '产品咨询应答', mode: 'practice', totalScore: 80, passed: true, at: '2026-10-18T14:00:00Z', prevSessionId: 's-003' },
  ],
  fillerTrend: [],
  certs: [],
};

// ====== Axios 实例（保留真实 API 调用能力，失败时回退 mock） ======

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
      if (location.pathname !== '/login') {
        location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

// ====== 认证 API ======

export async function login(username: string, _password: string) {
  return { token: 'demo-token', user: { id: 'demo', name: '演示用户', role: 'admin', username } } as { token: string; user: User };
}

export async function register(_username: string, _name: string, _password: string) {
  return { token: 'demo-token', user: { id: 'demo', name: '演示用户', role: 'admin', username: 'demo' } } as { token: string; user: User };
}

export async function fetchCurrentUser() {
  return getStoredUser() as unknown as User;
}

// ====== 场景 API（fallback mock） ======

export async function fetchRoleCards() {
  try {
    const { data } = await api.get('/role-cards');
    return data as { cards: RoleCard[] };
  } catch {
    return { cards: MOCK_ROLE_CARDS };
  }
}

export async function fetchTasks() {
  try {
    const { data } = await api.get('/tasks');
    return data as { tasks: TaskView[] };
  } catch {
    return { tasks: MOCK_TASKS };
  }
}

export async function fetchScenarios() {
  try {
    const { data } = await api.get('/scenarios');
    return data as { scenarios: Scenario[] };
  } catch {
    return { scenarios: MOCK_SCENARIOS };
  }
}

// ====== 会话 API ======

export async function createSession(_scenarioId: string, _mode: 'practice' | 'exam' = 'practice') {
  const session: Session = {
    id: `s-${Date.now()}`,
    tenantId: 'demo',
    userId: 'demo-user',
    scenarioId: _scenarioId,
    mode: _mode,
    status: 'active',
    transcript: [],
    hintsUsed: 0,
    startedAt: new Date().toISOString(),
  };
  return { session, persona: { name: 'AI角色', background: '模拟客户角色' }, scenario: { name: '模拟场景', durationMinutes: 10 }, remainingSeconds: 600 };
}

// ====== 成长 API（fallback mock） ======

export async function fetchGrowth() {
  try {
    const { data } = await api.get('/growth');
    return data as GrowthData;
  } catch {
    return MOCK_GROWTH;
  }
}

export default api;
