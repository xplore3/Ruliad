import type {
  BriefingStandard,
  Appeal,
  CalibrationEvent,
  CertRecord,
  DemoFaq,
  DemoScript,
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
  RealismStandard,
  RegressionRun,
  Scenario,
  ScenarioGuidance,
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

/**
 * 内存仓储：本地无 SQLite 数据库时的降级实现，同时用于单元/集成测试。
 * 进程重启即丢失，仅用于开发与演示。
 */
export class MemoryStore implements Store {
  private organizations = new Map<string, Organization>();
  private teams = new Map<string, Team>();
  private users = new Map<string, User>();
  private methodologyConfigs = new Map<string, MethodologyConfig>();
  private elements = new Map<string, Element>();
  private calibrationEvents: CalibrationEvent[] = [];
  private personaConfigs = new Map<string, PersonaConfig>();
  private skillPoints = new Map<string, SkillPoint>();
  private scenarios = new Map<string, Scenario>();
  private learningPaths = new Map<string, LearningPath>();
  private scenarioTasks = new Map<string, ScenarioTask>();
  private sessions = new Map<string, Session>();
  private scoreReports = new Map<string, ScoreReport>();
  private scoreItemDefs = new Map<string, ScoreItemDef>();
  private demoFaqs = new Map<string, DemoFaq>();
  private demoScripts = new Map<string, DemoScript>();
  private scenarioGuidances = new Map<string, ScenarioGuidance>();
  private briefingStandards = new Map<string, BriefingStandard>();
  private realismStandards = new Map<string, RealismStandard>();
  private appeals = new Map<string, Appeal>();
  private examWindows = new Map<string, ExamWindow>();
  private certRecords: CertRecord[] = [];
  private userSkillStates = new Map<string, UserSkillState>();
  private productKBs = new Map<string, ProductKB>();
  private extractionProjects = new Map<string, ExtractionProject>();
  private dataConsents = new Map<string, DataConsent>();
  private goldenCases = new Map<string, GoldenCase>();
private regressionRuns: RegressionRun[] = [];
private quizQuestions = new Map<string, QuizQuestion>();
private events: DomainEvent[] = [];

  private taskKey(userId: string, scenarioId: string) {
    return `${userId}:${scenarioId}`;
  }
  private skillKey(userId: string, skillPointId: string) {
    return `${userId}:${skillPointId}`;
  }

  // ---- 组织与用户 ----
  async getUser(id: string) {
    return this.users.get(id);
  }
  async getUserByUsername(tenantId: string, username: string) {
    return [...this.users.values()].find(
      (u) => u.tenantId === tenantId && u.username === username
    );
  }
  async listUsers(tenantId: string, role?: UserRole) {
    return [...this.users.values()].filter(
      (u) => u.tenantId === tenantId && (!role || u.role === role)
    );
  }
  async saveUser(user: User) {
    this.users.set(user.id, user);
  }
  async getTeam(id: string) {
    return this.teams.get(id);
  }
  async listTeams(orgId: string) {
    return [...this.teams.values()].filter((t) => t.orgId === orgId);
  }
  async saveTeam(team: Team) {
    this.teams.set(team.id, team);
  }
  async listOrganizations(tenantId: string) {
    return [...this.organizations.values()].filter((o) => o.tenantId === tenantId);
  }
  async saveOrganization(org: Organization) {
    this.organizations.set(org.id, org);
  }

  // ---- 方法论 ----
  async getMethodologyConfig(tenantId: string) {
    return [...this.methodologyConfigs.values()].find((c) => c.tenantId === tenantId);
  }
  async upsertMethodologyConfig(config: MethodologyConfig) {
    this.methodologyConfigs.set(config.id, config);
  }

  // ---- 要素 ----
  async getElement(id: string) {
    return this.elements.get(id);
  }
  async listElements(filter: { layer?: string; tenantId?: string; type?: string }) {
    return [...this.elements.values()].filter(
      (e) =>
        (!filter.layer || e.layer === filter.layer) &&
        (!filter.type || e.type === filter.type) &&
        (filter.tenantId === undefined || e.tenantId === filter.tenantId)
    );
  }
  async saveCalibrationEvent(event: CalibrationEvent) {
    this.calibrationEvents.push(event);
  }
  async listCalibrationEvents(elementId?: string) {
    return this.calibrationEvents.filter((e) => !elementId || e.elementId === elementId);
  }

  // ---- 角色 / 场景 / 技能点 / 学习路径 ----
  async getPersonaConfig(id: string) {
    return this.personaConfigs.get(id);
  }
  async listPersonaConfigs(tenantId: string) {
    return [...this.personaConfigs.values()].filter((p) => p.tenantId === tenantId);
  }
  async savePersonaConfig(config: PersonaConfig) {
    this.personaConfigs.set(config.id, config);
  }
  async getSkillPoint(id: string) {
    return this.skillPoints.get(id);
  }
  async listSkillPoints(tenantId: string) {
    return [...this.skillPoints.values()].filter((s) => s.tenantId === tenantId);
  }
  async getScenario(id: string) {
    return this.scenarios.get(id);
  }
  async listScenarios(tenantId: string) {
    return [...this.scenarios.values()].filter((s) => s.tenantId === tenantId);
  }
  async saveScenario(scenario: Scenario) {
    this.scenarios.set(scenario.id, scenario);
  }
  async deleteScenario(id: string) {
    this.scenarios.delete(id);
  }
  async getLearningPath(id: string) {
    return this.learningPaths.get(id);
  }
  async listLearningPaths(tenantId: string) {
    return [...this.learningPaths.values()].filter((p) => p.tenantId === tenantId);
  }
  async upsertLearningPath(path: LearningPath) {
    this.learningPaths.set(path.id, path);
  }

  // ---- 场景任务 ----
  async getScenarioTask(userId: string, scenarioId: string) {
    return this.scenarioTasks.get(this.taskKey(userId, scenarioId));
  }
  async listScenarioTasks(userId: string) {
    return [...this.scenarioTasks.values()].filter((t) => t.userId === userId);
  }
  async upsertScenarioTask(task: ScenarioTask) {
    this.scenarioTasks.set(this.taskKey(task.userId, task.scenarioId), task);
  }

  // ---- 会话 ----
  async createSession(session: Session) {
    this.sessions.set(session.id, session);
  }
  async getSession(id: string) {
    return this.sessions.get(id);
  }
  async updateSession(id: string, patch: Partial<Session>) {
    const s = this.sessions.get(id);
    if (s) this.sessions.set(id, { ...s, ...patch });
  }
  async listSessions(filter: SessionFilter) {
    return [...this.sessions.values()].filter(
      (s) =>
        (!filter.userId || s.userId === filter.userId) &&
        (!filter.scenarioId || s.scenarioId === filter.scenarioId) &&
        (!filter.mode || s.mode === filter.mode) &&
        (!filter.examWindowId || s.examWindowId === filter.examWindowId) &&
        (!filter.tenantId || s.tenantId === filter.tenantId)
    );
  }

  // ---- 评分 ----
  async saveScoreReport(report: ScoreReport) {
    this.scoreReports.set(report.sessionId, report);
  }
  async getScoreReportBySession(sessionId: string) {
    return this.scoreReports.get(sessionId);
  }
  async listScoreItemDefs(tenantId: string, skillPointId?: string) {
    return [...this.scoreItemDefs.values()].filter(
      (d) => d.tenantId === tenantId && (!skillPointId || d.skillPointId === skillPointId)
    );
  }
  async upsertScoreItemDef(def: ScoreItemDef) {
    this.scoreItemDefs.set(def.id, def);
  }
  async deleteScoreItemDef(id: string) {
    this.scoreItemDefs.delete(id);
  }

  // ---- 示范问答库 ----
  async getDemoFaq(id: string) {
    return this.demoFaqs.get(id);
  }
  async listDemoFaqs(tenantId: string, category?: string) {
    return [...this.demoFaqs.values()].filter(
      (q) => q.tenantId === tenantId && (!category || q.category === category)
    );
  }
  async saveDemoFaq(q: DemoFaq) {
    this.demoFaqs.set(q.id, q);
  }
  async deleteDemoFaq(id: string) {
    this.demoFaqs.delete(id);
  }

  // ---- 示范剧本库 ----
  async getDemoScript(id: string) {
    return this.demoScripts.get(id);
  }
  async listDemoScripts(tenantId: string, category?: string) {
    return [...this.demoScripts.values()].filter(
      (s) => s.tenantId === tenantId && (!category || s.category === category)
    );
  }
  async saveDemoScript(s: DemoScript) {
    this.demoScripts.set(s.id, s);
  }
  async deleteDemoScript(id: string) {
    this.demoScripts.delete(id);
  }

  // ---- 新手指引流程配置 ----
  async getScenarioGuidance(scenarioId: string) {
    return [...this.scenarioGuidances.values()].find((g) => g.scenarioId === scenarioId);
  }
  async getScenarioGuidanceById(id: string) {
    return this.scenarioGuidances.get(id);
  }
  async listScenarioGuidances(tenantId: string) {
    return [...this.scenarioGuidances.values()].filter((g) => g.tenantId === tenantId);
  }
  async saveScenarioGuidance(g: ScenarioGuidance) {
    this.scenarioGuidances.set(g.id, g);
  }
  async deleteScenarioGuidance(id: string) {
    this.scenarioGuidances.delete(id);
  }
  async listBriefingStandards(tenantId: string) {
    return [...this.briefingStandards.values()].filter((s) => s.tenantId === tenantId);
  }
  async saveBriefingStandard(s: BriefingStandard) {
    this.briefingStandards.set(s.id, s);
  }
  async deleteBriefingStandard(id: string) {
    this.briefingStandards.delete(id);
  }
  async listRealismStandards(tenantId: string) {
    return [...this.realismStandards.values()].filter((s) => s.tenantId === tenantId);
  }
  async saveRealismStandard(s: RealismStandard) {
    this.realismStandards.set(s.id, s);
  }
  async deleteRealismStandard(id: string) {
    this.realismStandards.delete(id);
  }

  // ---- 申诉 ----
  async createAppeal(appeal: Appeal) {
    this.appeals.set(appeal.id, appeal);
  }
  async getAppeal(id: string) {
    return this.appeals.get(id);
  }
  async updateAppeal(id: string, patch: Partial<Appeal>) {
    const a = this.appeals.get(id);
    if (a) this.appeals.set(id, { ...a, ...patch });
  }
  async listAppeals(filter: AppealFilter) {
    return [...this.appeals.values()].filter(
      (a) =>
        (!filter.status || a.status === filter.status) &&
        (!filter.userId || a.userId === filter.userId) &&
        (!filter.sessionId || a.sessionId === filter.sessionId)
    );
  }

  // ---- 考核认证 ----
  async getExamWindow(id: string) {
    return this.examWindows.get(id);
  }
  async listExamWindows(tenantId: string) {
    return [...this.examWindows.values()].filter((w) => w.tenantId === tenantId);
  }
  async upsertExamWindow(window: ExamWindow) {
    this.examWindows.set(window.id, window);
  }
  async saveCertRecord(record: CertRecord) {
    this.certRecords.push(record);
  }
  async listCertRecords(filter: CertFilter) {
    return this.certRecords.filter(
      (c) =>
        (!filter.userId || c.userId === filter.userId) &&
        (!filter.examWindowId || c.examWindowId === filter.examWindowId) &&
        (!filter.tenantId || c.tenantId === filter.tenantId)
    );
  }

  // ---- 用户技能状态 ----
  async getUserSkillState(userId: string, skillPointId: string) {
    return this.userSkillStates.get(this.skillKey(userId, skillPointId));
  }
  async listUserSkillStates(userId: string) {
    return [...this.userSkillStates.values()].filter((s) => s.userId === userId);
  }
  async upsertUserSkillState(state: UserSkillState) {
    this.userSkillStates.set(this.skillKey(state.userId, state.skillPointId), state);
  }

  // ---- 内容工坊 ----
  async saveProductKB(kb: ProductKB) {
    this.productKBs.set(kb.id, kb);
  }
async getProductKB(tenantId: string) {
return [...this.productKBs.values()].find((k) => k.tenantId === tenantId);
}
async getProductKBById(id: string) {
return this.productKBs.get(id);
}
  async listExtractionProjects(tenantId: string) {
    return [...this.extractionProjects.values()].filter((p) => p.tenantId === tenantId);
  }
  async upsertExtractionProject(project: ExtractionProject) {
    this.extractionProjects.set(project.id, project);
  }
  async listDataConsents(tenantId: string) {
    return [...this.dataConsents.values()].filter((c) => c.tenantId === tenantId);
  }
  async listGoldenCases() {
    return [...this.goldenCases.values()];
  }
  async saveGoldenCase(goldenCase: GoldenCase) {
    this.goldenCases.set(goldenCase.id, goldenCase);
  }
  async deleteGoldenCase(id: string) {
    this.goldenCases.delete(id);
  }
  async saveRegressionRun(run: RegressionRun) {
    this.regressionRuns.push(run);
  }
async listRegressionRuns() {
return this.regressionRuns;
}

// ---- 考题 ----
async listQuizQuestions(tenantId: string, scenarioId?: string) {
return [...this.quizQuestions.values()].filter(
(q) => q.tenantId === tenantId && (!scenarioId || q.scenarioId === scenarioId)
);
}
async saveQuizQuestion(q: QuizQuestion) {
this.quizQuestions.set(q.id, q);
}
async deleteQuizQuestion(id: string) {
this.quizQuestions.delete(id);
}

  // ---- 账号注销 ----
  async deleteUser(id: string) {
    this.users.delete(id);
  }
  async deleteUserData(userId: string) {
    const sessionIds = new Set(
      [...this.sessions.values()].filter((s) => s.userId === userId).map((s) => s.id)
    );
    for (const sid of sessionIds) {
      this.sessions.delete(sid);
      this.scoreReports.delete(sid); // scoreReports 以 sessionId 为键
    }
    for (const [id, a] of this.appeals) {
      if (a.userId === userId) this.appeals.delete(id);
    }
    this.certRecords = this.certRecords.filter((c) => c.userId !== userId);
    for (const key of [...this.userSkillStates.keys()]) {
      if (key.startsWith(`${userId}:`)) this.userSkillStates.delete(key);
    }
    for (const key of [...this.scenarioTasks.keys()]) {
      if (key.startsWith(`${userId}:`)) this.scenarioTasks.delete(key);
    }
    this.events = this.events.filter(
      (e) => e.userId !== userId && !(e.sessionId && sessionIds.has(e.sessionId))
    );
  }

  // ---- 事件流 ----
  async appendEvent(event: DomainEvent) {
    this.events.push(event);
  }
  async listEvents(filter: { sessionId?: string; tenantId?: string; type?: string }) {
    return this.events.filter(
      (e) =>
        (!filter.sessionId || e.sessionId === filter.sessionId) &&
        (!filter.tenantId || e.tenantId === filter.tenantId) &&
        (!filter.type || e.type === filter.type)
    );
  }

  // ---- 种子 ----
  async seed(data: SeedData) {
    for (const o of data.organizations) this.organizations.set(o.id, o);
    for (const t of data.teams) this.teams.set(t.id, t);
    for (const u of data.users) this.users.set(u.id, u);
    for (const c of data.methodologyConfigs) this.methodologyConfigs.set(c.id, c);
    for (const e of data.elements) this.elements.set(e.id, e);
    for (const p of data.personaConfigs) this.personaConfigs.set(p.id, p);
    for (const s of data.skillPoints) this.skillPoints.set(s.id, s);
    for (const s of data.scenarios) this.scenarios.set(s.id, s);
    for (const p of data.learningPaths) this.learningPaths.set(p.id, p);
    for (const d of data.scoreItemDefs) this.scoreItemDefs.set(d.id, d);
    for (const g of data.goldenCases) this.goldenCases.set(g.id, g);
    for (const k of data.productKBs) this.productKBs.set(k.id, k);
    for (const w of data.examWindows ?? []) this.examWindows.set(w.id, w);
    for (const p of data.extractionProjects ?? []) this.extractionProjects.set(p.id, p);
    for (const s of data.briefingStandards ?? []) this.briefingStandards.set(s.id, s);
    for (const s of data.realismStandards ?? []) this.realismStandards.set(s.id, s);
    for (const g of data.scenarioGuidance ?? []) this.scenarioGuidances.set(g.id, g);
  }
}
