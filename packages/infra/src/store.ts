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
  SessionMode,
  SkillPoint,
  Team,
  User,
  UserRole,
  UserSkillState,
} from '@grasp-mvp/core';

export interface SessionFilter {
  userId?: string;
  scenarioId?: string;
  mode?: SessionMode;
  examWindowId?: string;
  tenantId?: string;
}

export interface AppealFilter {
  status?: string;
  userId?: string;
  sessionId?: string;
}

export interface CertFilter {
  userId?: string;
  examWindowId?: string;
  tenantId?: string;
}

/** 种子数据（scripts/seed 使用） */
export interface SeedData {
  organizations: Organization[];
  teams: Team[];
  users: User[];
  methodologyConfigs: MethodologyConfig[];
  elements: Element[];
  personaConfigs: PersonaConfig[];
  skillPoints: SkillPoint[];
  scenarios: Scenario[];
  learningPaths: LearningPath[];
  scoreItemDefs: ScoreItemDef[];
  goldenCases: GoldenCase[];
  productKBs: ProductKB[];
  examWindows?: ExamWindow[];
  extractionProjects?: ExtractionProject[];
  briefingStandards?: BriefingStandard[];
  realismStandards?: RealismStandard[];
  scenarioGuidance?: ScenarioGuidance[];
}

/**
 * 统一仓储接口。
 * 两个实现：PrismaStore（生产，SQLite）/ MemoryStore（本地无 DB 时降级）。
 */
export interface Store {
  // ---- 组织与用户 ----
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(tenantId: string, username: string): Promise<User | undefined>;
  listUsers(tenantId: string, role?: UserRole): Promise<User[]>;
  saveUser(user: User): Promise<void>;
  getTeam(id: string): Promise<Team | undefined>;
  listTeams(orgId: string): Promise<Team[]>;
  saveTeam(team: Team): Promise<void>;
  listOrganizations(tenantId: string): Promise<Organization[]>;
  saveOrganization(org: Organization): Promise<void>;

  // ---- 方法论配置 ----
  getMethodologyConfig(tenantId: string): Promise<MethodologyConfig | undefined>;
  upsertMethodologyConfig(config: MethodologyConfig): Promise<void>;

  // ---- 要素 ----
  getElement(id: string): Promise<Element | undefined>;
  listElements(filter: { layer?: string; tenantId?: string; type?: string }): Promise<Element[]>;
  saveCalibrationEvent(event: CalibrationEvent): Promise<void>;
  listCalibrationEvents(elementId?: string): Promise<CalibrationEvent[]>;

  // ---- 角色 / 场景 / 技能点 / 学习路径 ----
  getPersonaConfig(id: string): Promise<PersonaConfig | undefined>;
  listPersonaConfigs(tenantId: string): Promise<PersonaConfig[]>;
  savePersonaConfig(config: PersonaConfig): Promise<void>;
  getSkillPoint(id: string): Promise<SkillPoint | undefined>;
  listSkillPoints(tenantId: string): Promise<SkillPoint[]>;
  getScenario(id: string): Promise<Scenario | undefined>;
  listScenarios(tenantId: string): Promise<Scenario[]>;
  saveScenario(scenario: Scenario): Promise<void>;
  deleteScenario(id: string): Promise<void>;
  getLearningPath(id: string): Promise<LearningPath | undefined>;
  listLearningPaths(tenantId: string): Promise<LearningPath[]>;
  upsertLearningPath(path: LearningPath): Promise<void>;

  // ---- 场景任务 ----
  getScenarioTask(userId: string, scenarioId: string): Promise<ScenarioTask | undefined>;
  listScenarioTasks(userId: string): Promise<ScenarioTask[]>;
  upsertScenarioTask(task: ScenarioTask): Promise<void>;

  // ---- 会话 ----
  createSession(session: Session): Promise<void>;
  getSession(id: string): Promise<Session | undefined>;
  updateSession(id: string, patch: Partial<Session>): Promise<void>;
  listSessions(filter: SessionFilter): Promise<Session[]>;

  // ---- 评分 ----
  saveScoreReport(report: ScoreReport): Promise<void>;
  getScoreReportBySession(sessionId: string): Promise<ScoreReport | undefined>;
  listScoreItemDefs(tenantId: string, skillPointId?: string): Promise<ScoreItemDef[]>;
  upsertScoreItemDef(def: ScoreItemDef): Promise<void>;
  deleteScoreItemDef(id: string): Promise<void>;

  // ---- 示范问答库（第2步「示范」环节 FAQ 池） ----
  getDemoFaq(id: string): Promise<DemoFaq | undefined>;
  listDemoFaqs(tenantId: string, category?: string): Promise<DemoFaq[]>;
  saveDemoFaq(q: DemoFaq): Promise<void>;
  deleteDemoFaq(id: string): Promise<void>;

  // ---- 示范剧本库（第2步「示范」双人对戏剧本，按业务线分支） ----
  getDemoScript(id: string): Promise<DemoScript | undefined>;
  listDemoScripts(tenantId: string, category?: string): Promise<DemoScript[]>;
  saveDemoScript(s: DemoScript): Promise<void>;
  deleteDemoScript(id: string): Promise<void>;

  // ---- 新手指引流程配置 ----
  getScenarioGuidance(scenarioId: string): Promise<ScenarioGuidance | undefined>;
  getScenarioGuidanceById(id: string): Promise<ScenarioGuidance | undefined>;
  listScenarioGuidances(tenantId: string): Promise<ScenarioGuidance[]>;
  saveScenarioGuidance(g: ScenarioGuidance): Promise<void>;
  deleteScenarioGuidance(id: string): Promise<void>;
  listBriefingStandards(tenantId: string): Promise<BriefingStandard[]>;
  saveBriefingStandard(s: BriefingStandard): Promise<void>;
  deleteBriefingStandard(id: string): Promise<void>;
  listRealismStandards(tenantId: string): Promise<RealismStandard[]>;
  saveRealismStandard(s: RealismStandard): Promise<void>;
  deleteRealismStandard(id: string): Promise<void>;

  // ---- 申诉 ----
  createAppeal(appeal: Appeal): Promise<void>;
  getAppeal(id: string): Promise<Appeal | undefined>;
  updateAppeal(id: string, patch: Partial<Appeal>): Promise<void>;
  listAppeals(filter: AppealFilter): Promise<Appeal[]>;

  // ---- 考核认证 ----
  getExamWindow(id: string): Promise<ExamWindow | undefined>;
  listExamWindows(tenantId: string): Promise<ExamWindow[]>;
  upsertExamWindow(window: ExamWindow): Promise<void>;
  saveCertRecord(record: CertRecord): Promise<void>;
  listCertRecords(filter: CertFilter): Promise<CertRecord[]>;

  // ---- 用户技能状态 ----
  getUserSkillState(userId: string, skillPointId: string): Promise<UserSkillState | undefined>;
  listUserSkillStates(userId: string): Promise<UserSkillState[]>;
  upsertUserSkillState(state: UserSkillState): Promise<void>;

  // ---- 内容工坊 / 企业私有数据 ----
  saveProductKB(kb: ProductKB): Promise<void>;
  getProductKB(tenantId: string): Promise<ProductKB | undefined>;
  getProductKBById(id: string): Promise<ProductKB | undefined>;
  listExtractionProjects(tenantId: string): Promise<ExtractionProject[]>;
  upsertExtractionProject(project: ExtractionProject): Promise<void>;
  listDataConsents(tenantId: string): Promise<DataConsent[]>;
  listGoldenCases(): Promise<GoldenCase[]>;
  saveGoldenCase(goldenCase: GoldenCase): Promise<void>;
  deleteGoldenCase(id: string): Promise<void>;
  saveRegressionRun(run: RegressionRun): Promise<void>;
  listRegressionRuns(): Promise<RegressionRun[]>;

  // ---- 考题 ----
  listQuizQuestions(tenantId: string, scenarioId?: string): Promise<QuizQuestion[]>;
  saveQuizQuestion(q: QuizQuestion): Promise<void>;
  deleteQuizQuestion(id: string): Promise<void>;

  // ---- 账号注销 ----
  deleteUser(id: string): Promise<void>;
  /** 删除用户全部关联数据：会话/评分报告/申诉/认证记录/技能状态/场景任务/事件 */
  deleteUserData(userId: string): Promise<void>;

  // ---- 事件流 ----
  appendEvent(event: DomainEvent): Promise<void>;
  listEvents(filter: { sessionId?: string; tenantId?: string; type?: string }): Promise<DomainEvent[]>;

  // ---- 种子 ----
  seed(data: SeedData): Promise<void>;
}
