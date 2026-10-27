import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type {
  Appeal,
  CalibrationEvent,
  CertRecord,
  DataConsent,
  DomainEvent,
  Element,
  ExamWindow,
  ExtractionProject,
  GoldenCase,
  LearningPath,
  MethodologyConfig,
  Organization,
  PersonaConfig,
  ProductKB,
  QuizQuestion,
  RegressionRun,
  Scenario,
  ScenarioTask,
  ScoreItemDef,
  ScoreReport,
  Session,
  SkillPoint,
  Team,
  User,
  UserRole,
  UserSkillState,
} from '@grasp-mvp/core';
import type { AppealFilter, CertFilter, SeedData, SessionFilter, Store } from './store.js';

/** 去掉 undefined 值（Prisma Json 字段不接受 undefined） */
function sanitize<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

function pick(obj: Record<string, unknown>, keys: string[]) {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

function omit(obj: Record<string, unknown>, keys: string[]) {
  const out: Record<string, unknown> = { ...obj };
  for (const k of keys) delete out[k];
  return out;
}

function fromRow<T>(row: Record<string, unknown>, indexedKeys: string[]): T {
  // SQLite：data/payload 列为 JSON 文本，读出时 parse
  const raw = row.data ?? row.payload;
  const data = (typeof raw === 'string' ? JSON.parse(raw) : (raw ?? {})) as Record<string, unknown>;
  const out: Record<string, unknown> = { ...data };
  for (const k of indexedKeys) {
    const v = row[k];
    out[k] = v instanceof Date ? v.toISOString() : v;
  }
  return out as T;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/** SQLite String 列存储 JSON 文本（Prisma 不支持 SQLite Json 列） */
function toJson(value: unknown): string {
  return JSON.stringify(value ?? {});
}

function docTable<T extends { id: string }>(table: any, indexedKeys: string[], jsonColumn = 'data') {
  return {
    async get(id: string): Promise<T | undefined> {
      const row = await table.findUnique({ where: { id } });
      return row ? fromRow<T>(row, indexedKeys) : undefined;
    },
    async list(where: Record<string, unknown> = {}): Promise<T[]> {
      const rows = await table.findMany({ where });
      return rows.map((r: Record<string, unknown>) => fromRow<T>(r, indexedKeys));
    },
    async create(obj: T): Promise<void> {
      const indexed = pick(obj as unknown as Record<string, unknown>, indexedKeys);
      const data = sanitize(omit(obj as unknown as Record<string, unknown>, indexedKeys));
      await table.create({ data: { ...indexed, [jsonColumn]: toJson(data) } });
    },
    async upsertById(obj: T): Promise<void> {
      const indexed = pick(obj as unknown as Record<string, unknown>, indexedKeys);
      const data = sanitize(omit(obj as unknown as Record<string, unknown>, indexedKeys));
      await table.upsert({
        where: { id: obj.id },
        create: { ...indexed, [jsonColumn]: toJson(data) },
        update: { ...indexed, [jsonColumn]: toJson(data) },
      });
    },
    async update(id: string, patch: Partial<T>): Promise<void> {
      const existing = await this.get(id);
      if (!existing) return;
      const merged = { ...existing, ...patch };
      const indexed = pick(merged as unknown as Record<string, unknown>, indexedKeys);
      const data = sanitize(omit(merged as unknown as Record<string, unknown>, indexedKeys));
      await table.update({ where: { id }, data: { ...indexed, [jsonColumn]: toJson(data) } });
    },
    async delete(id: string): Promise<void> {
      await table.delete({ where: { id } }).catch(() => {});
    },
  };
}

/** SQLite 持久化实现。表结构为「索引列 + JSON 文本」文档风格。 */
export class PrismaStore implements Store {
  private prisma: PrismaClient;
  private organizations;
  private teams;
  private users;
  private methodologyConfigs;
  private elements;
  private calibrationEvents;
  private personaConfigs;
  private skillPoints;
  private scenarios;
  private learningPaths;
  private scenarioTasks;
  private sessions;
  private scoreReports;
  private scoreItemDefs;
  private appeals;
  private examWindows;
  private certRecords;
  private userSkillStates;
  private productKBs;
  private extractionProjects;
  private dataConsents;
  private goldenCases;
private regressionRuns;
private quizQuestions;
private domainEvents;

  constructor(prisma?: PrismaClient) {
    this.prisma = prisma ?? new PrismaClient();
    this.organizations = docTable<Organization>(this.prisma.organization, ['id', 'tenantId', 'name', 'parentId']);
    this.teams = docTable<Team>(this.prisma.team, ['id', 'orgId', 'name', 'supervisorId']);
    this.users = docTable<User>(this.prisma.user, ['id', 'tenantId', 'orgId', 'teamId', 'name', 'role']);
    this.methodologyConfigs = docTable<MethodologyConfig>(this.prisma.methodologyConfig, ['id', 'tenantId', 'name']);
    this.elements = docTable<Element>(this.prisma.element, ['id', 'type', 'layer', 'tenantId', 'name', 'version']);
    this.calibrationEvents = docTable<CalibrationEvent>(this.prisma.calibrationEvent, ['id', 'elementId', 'kind', 'createdAt']);
    this.personaConfigs = docTable<PersonaConfig>(this.prisma.personaConfig, ['id', 'tenantId', 'name', 'version']);
    this.skillPoints = docTable<SkillPoint>(this.prisma.skillPoint, ['id', 'tenantId', 'name']);
    this.scenarios = docTable<Scenario>(this.prisma.scenario, ['id', 'tenantId', 'name', 'personaConfigId']);
    this.learningPaths = docTable<LearningPath>(this.prisma.learningPath, ['id', 'tenantId', 'name']);
    this.scenarioTasks = docTable<ScenarioTask & { id: string }>(this.prisma.scenarioTask, ['id', 'userId', 'scenarioId', 'status']);
    this.sessions = docTable<Session>(this.prisma.session, ['id', 'tenantId', 'userId', 'scenarioId', 'mode', 'status', 'examWindowId', 'startedAt', 'endedAt']);
    this.scoreReports = docTable<ScoreReport>(this.prisma.scoreReport, ['id', 'sessionId', 'totalScore', 'passed', 'createdAt']);
    this.scoreItemDefs = docTable<ScoreItemDef>(this.prisma.scoreItemDef, ['id', 'tenantId', 'skillPointId', 'name', 'layer']);
    this.appeals = docTable<Appeal>(this.prisma.appeal, ['id', 'sessionId', 'userId', 'status', 'createdAt']);
    this.examWindows = docTable<ExamWindow>(this.prisma.examWindow, ['id', 'tenantId', 'name', 'status', 'startsAt', 'endsAt']);
    this.certRecords = docTable<CertRecord>(this.prisma.certRecord, ['id', 'tenantId', 'userId', 'examWindowId', 'passed']);
    this.userSkillStates = docTable<UserSkillState & { id: string }>(this.prisma.userSkillState, ['id', 'userId', 'skillPointId']);
    this.productKBs = docTable<ProductKB>(this.prisma.productKB, ['id', 'tenantId', 'name', 'version']);
    this.extractionProjects = docTable<ExtractionProject>(this.prisma.extractionProject, ['id', 'tenantId', 'name', 'status']);
    this.dataConsents = docTable<DataConsent>(this.prisma.dataConsent, ['id', 'tenantId']);
    this.goldenCases = docTable<GoldenCase>(this.prisma.goldenCase, ['id', 'name']);
this.regressionRuns = docTable<RegressionRun>(this.prisma.regressionRun, ['id', 'at', 'passed']);
this.quizQuestions = docTable<QuizQuestion>(this.prisma.quizQuestion, ['id', 'tenantId', 'scenarioId', 'skillPointId', 'type']);
this.domainEvents = docTable<DomainEvent>(this.prisma.domainEvent, ['id', 'type', 'tenantId', 'sessionId', 'userId', 'at'], 'payload');
  }

  // ---- 组织与用户 ----
  getUser(id: string) {
    return this.users.get(id);
  }
  async getUserByUsername(tenantId: string, username: string) {
    // username 非索引列：按租户取出后过滤
    const users = await this.users.list({ tenantId });
    return users.find((u) => u.username === username);
  }
  listUsers(tenantId: string, role?: UserRole) {
    return this.users.list({ tenantId, ...(role ? { role } : {}) });
  }
  saveUser(user: User) {
    return this.users.upsertById(user);
  }
  getTeam(id: string) {
    return this.teams.get(id);
  }
  listTeams(orgId: string) {
    return this.teams.list({ orgId });
  }
  saveTeam(team: Team) {
    return this.teams.upsertById(team);
  }
  listOrganizations(tenantId: string) {
    return this.organizations.list({ tenantId });
  }
  saveOrganization(org: Organization) {
    return this.organizations.upsertById(org);
  }

  // ---- 方法论 ----
  async getMethodologyConfig(tenantId: string) {
    const rows = await this.methodologyConfigs.list({ tenantId });
    return rows[0];
  }
  upsertMethodologyConfig(config: MethodologyConfig) {
    return this.methodologyConfigs.upsertById(config);
  }

  // ---- 要素 ----
  getElement(id: string) {
    return this.elements.get(id);
  }
  listElements(filter: { layer?: string; tenantId?: string; type?: string }) {
    const where: Record<string, unknown> = {};
    if (filter.layer) where.layer = filter.layer;
    if (filter.type) where.type = filter.type;
    if (filter.tenantId !== undefined) where.tenantId = filter.tenantId;
    return this.elements.list(where);
  }
  saveCalibrationEvent(event: CalibrationEvent) {
    return this.calibrationEvents.create(event);
  }
  listCalibrationEvents(elementId?: string) {
    return this.calibrationEvents.list(elementId ? { elementId } : {});
  }

  // ---- 角色 / 场景 / 技能点 / 学习路径 ----
  getPersonaConfig(id: string) {
    return this.personaConfigs.get(id);
  }
  listPersonaConfigs(tenantId: string) {
    return this.personaConfigs.list({ tenantId });
  }
  savePersonaConfig(config: PersonaConfig) {
    return this.personaConfigs.upsertById(config);
  }
  getSkillPoint(id: string) {
    return this.skillPoints.get(id);
  }
  listSkillPoints(tenantId: string) {
    return this.skillPoints.list({ tenantId });
  }
  getScenario(id: string) {
    return this.scenarios.get(id);
  }
  listScenarios(tenantId: string) {
    return this.scenarios.list({ tenantId });
  }
  saveScenario(scenario: Scenario) {
    return this.scenarios.upsertById(scenario);
  }
  deleteScenario(id: string) {
    return this.scenarios.delete(id);
  }
  getLearningPath(id: string) {
    return this.learningPaths.get(id);
  }
  listLearningPaths(tenantId: string) {
    return this.learningPaths.list({ tenantId });
  }
  upsertLearningPath(path: LearningPath) {
    return this.learningPaths.upsertById(path);
  }

  // ---- 场景任务 ----
  async getScenarioTask(userId: string, scenarioId: string) {
    const rows = await this.scenarioTasks.list({ userId, scenarioId });
    return rows[0];
  }
  listScenarioTasks(userId: string) {
    return this.scenarioTasks.list({ userId });
  }
  async upsertScenarioTask(task: ScenarioTask) {
    const existing = await this.getScenarioTask(task.userId, task.scenarioId);
    if (existing) {
      await this.prisma.scenarioTask.update({
        where: { userId_scenarioId: { userId: task.userId, scenarioId: task.scenarioId } },
        data: { status: task.status, data: toJson(sanitize(omit(task as unknown as Record<string, unknown>, ['id', 'userId', 'scenarioId', 'status']))) },
      });
    } else {
      await this.scenarioTasks.create({ ...task, id: randomUUID() } as ScenarioTask & { id: string });
    }
  }

  // ---- 会话 ----
  createSession(session: Session) {
    return this.sessions.create(session);
  }
  getSession(id: string) {
    return this.sessions.get(id);
  }
  updateSession(id: string, patch: Partial<Session>) {
    return this.sessions.update(id, patch);
  }
  listSessions(filter: SessionFilter) {
    const where: Record<string, unknown> = {};
    if (filter.userId) where.userId = filter.userId;
    if (filter.scenarioId) where.scenarioId = filter.scenarioId;
    if (filter.mode) where.mode = filter.mode;
    if (filter.examWindowId) where.examWindowId = filter.examWindowId;
    if (filter.tenantId) where.tenantId = filter.tenantId;
    return this.sessions.list(where);
  }

  // ---- 评分 ----
  saveScoreReport(report: ScoreReport) {
    return this.scoreReports.create(report);
  }
  async getScoreReportBySession(sessionId: string) {
    const rows = await this.scoreReports.list({ sessionId });
    return rows[0];
  }
  listScoreItemDefs(tenantId: string, skillPointId?: string) {
    return this.scoreItemDefs.list({ tenantId, ...(skillPointId ? { skillPointId } : {}) });
  }
  upsertScoreItemDef(def: ScoreItemDef) {
    return this.scoreItemDefs.upsertById(def);
  }

  // ---- 申诉 ----
  createAppeal(appeal: Appeal) {
    return this.appeals.create(appeal);
  }
  getAppeal(id: string) {
    return this.appeals.get(id);
  }
  updateAppeal(id: string, patch: Partial<Appeal>) {
    return this.appeals.update(id, patch);
  }
  listAppeals(filter: AppealFilter) {
    const where: Record<string, unknown> = {};
    if (filter.status) where.status = filter.status;
    if (filter.userId) where.userId = filter.userId;
    if (filter.sessionId) where.sessionId = filter.sessionId;
    return this.appeals.list(where);
  }

  // ---- 考核认证 ----
  getExamWindow(id: string) {
    return this.examWindows.get(id);
  }
  listExamWindows(tenantId: string) {
    return this.examWindows.list({ tenantId });
  }
  upsertExamWindow(window: ExamWindow) {
    return this.examWindows.upsertById(window);
  }
  saveCertRecord(record: CertRecord) {
    return this.certRecords.create(record);
  }
  listCertRecords(filter: CertFilter) {
    const where: Record<string, unknown> = {};
    if (filter.userId) where.userId = filter.userId;
    if (filter.examWindowId) where.examWindowId = filter.examWindowId;
    if (filter.tenantId) where.tenantId = filter.tenantId;
    return this.certRecords.list(where);
  }

  // ---- 用户技能状态 ----
  async getUserSkillState(userId: string, skillPointId: string) {
    const rows = await this.userSkillStates.list({ userId, skillPointId });
    return rows[0];
  }
  listUserSkillStates(userId: string) {
    return this.userSkillStates.list({ userId });
  }
  async upsertUserSkillState(state: UserSkillState) {
    const existing = await this.getUserSkillState(state.userId, state.skillPointId);
    if (existing) {
      await this.prisma.userSkillState.update({
        where: { userId_skillPointId: { userId: state.userId, skillPointId: state.skillPointId } },
        data: { data: toJson(sanitize(omit(state as unknown as Record<string, unknown>, ['id', 'userId', 'skillPointId']))) },
      });
    } else {
      await this.userSkillStates.create({ ...state, id: randomUUID() } as UserSkillState & { id: string });
    }
  }

  // ---- 内容工坊 ----
  saveProductKB(kb: ProductKB) {
    return this.productKBs.upsertById(kb);
  }
async getProductKB(tenantId: string) {
const rows = await this.productKBs.list({ tenantId });
return rows[0];
}
async getProductKBById(id: string) {
return this.productKBs.get(id);
}
  listExtractionProjects(tenantId: string) {
    return this.extractionProjects.list({ tenantId });
  }
  upsertExtractionProject(project: ExtractionProject) {
    return this.extractionProjects.upsertById(project);
  }
  listDataConsents(tenantId: string) {
    return this.dataConsents.list({ tenantId });
  }
  listGoldenCases() {
    return this.goldenCases.list();
  }
  saveGoldenCase(goldenCase: GoldenCase) {
    return this.goldenCases.upsertById(goldenCase);
  }
  saveRegressionRun(run: RegressionRun) {
    return this.regressionRuns.create(run);
  }
listRegressionRuns() {
return this.regressionRuns.list();
}

// ---- 考题 ----
listQuizQuestions(tenantId: string, scenarioId?: string) {
const where: Record<string, unknown> = { tenantId };
if (scenarioId) where.scenarioId = scenarioId;
return this.quizQuestions.list(where);
}
saveQuizQuestion(q: QuizQuestion) {
return this.quizQuestions.upsertById(q);
}
async deleteQuizQuestion(id: string) {
await this.quizQuestions.delete(id);
}

  // ---- 事件流 ----
  appendEvent(event: DomainEvent) {
    return this.domainEvents.create(event);
  }
  listEvents(filter: { sessionId?: string; tenantId?: string; type?: string }) {
    const where: Record<string, unknown> = {};
    if (filter.sessionId) where.sessionId = filter.sessionId;
    if (filter.tenantId) where.tenantId = filter.tenantId;
    if (filter.type) where.type = filter.type;
    return this.domainEvents.list(where);
  }

  // ---- 种子 ----
  async seed(data: SeedData) {
    for (const o of data.organizations) await this.organizations.upsertById(o);
    for (const t of data.teams) await this.teams.upsertById(t);
    for (const u of data.users) await this.users.upsertById(u);
    for (const c of data.methodologyConfigs) await this.methodologyConfigs.upsertById(c);
    for (const e of data.elements) await this.elements.upsertById(e);
    for (const p of data.personaConfigs) await this.personaConfigs.upsertById(p);
    for (const s of data.skillPoints) await this.skillPoints.upsertById(s);
    for (const s of data.scenarios) await this.scenarios.upsertById(s);
    for (const p of data.learningPaths) await this.learningPaths.upsertById(p);
    for (const d of data.scoreItemDefs) await this.scoreItemDefs.upsertById(d);
    for (const g of data.goldenCases) await this.goldenCases.upsertById(g);
    for (const k of data.productKBs) await this.productKBs.upsertById(k);
    for (const w of data.examWindows ?? []) await this.examWindows.upsertById(w);
    for (const p of data.extractionProjects ?? []) await this.extractionProjects.upsertById(p);
  }
}
