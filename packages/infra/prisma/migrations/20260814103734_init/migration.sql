-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "data" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "supervisorId" TEXT,
    "data" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "teamId" TEXT,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "data" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "MethodologyConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "data" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Element" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "layer" TEXT NOT NULL,
    "tenantId" TEXT,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "data" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "CalibrationEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "elementId" TEXT,
    "kind" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "PersonaConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "data" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "SkillPoint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "data" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Scenario" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "personaConfigId" TEXT NOT NULL,
    "data" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "LearningPath" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "data" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "ScenarioTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "data" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "examWindowId" TEXT,
    "startedAt" DATETIME NOT NULL,
    "endedAt" DATETIME,
    "data" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "ScoreReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "totalScore" REAL NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "data" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ScoreItemDef" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "skillPointId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "layer" TEXT NOT NULL,
    "data" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Appeal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ExamWindow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startsAt" DATETIME NOT NULL,
    "endsAt" DATETIME NOT NULL,
    "data" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "CertRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "examWindowId" TEXT NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "data" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "UserSkillState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "skillPointId" TEXT NOT NULL,
    "data" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "ProductKB" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "data" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "ExtractionProject" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "data" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "DataConsent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "data" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "GoldenCase" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "data" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "RegressionRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "passed" BOOLEAN NOT NULL,
    "data" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "DomainEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "tenantId" TEXT,
    "sessionId" TEXT,
    "userId" TEXT,
    "payload" TEXT NOT NULL,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "Organization_tenantId_idx" ON "Organization"("tenantId");

-- CreateIndex
CREATE INDEX "Team_orgId_idx" ON "Team"("orgId");

-- CreateIndex
CREATE INDEX "User_tenantId_role_idx" ON "User"("tenantId", "role");

-- CreateIndex
CREATE INDEX "User_teamId_idx" ON "User"("teamId");

-- CreateIndex
CREATE INDEX "MethodologyConfig_tenantId_idx" ON "MethodologyConfig"("tenantId");

-- CreateIndex
CREATE INDEX "Element_layer_tenantId_idx" ON "Element"("layer", "tenantId");

-- CreateIndex
CREATE INDEX "Element_type_idx" ON "Element"("type");

-- CreateIndex
CREATE INDEX "CalibrationEvent_elementId_idx" ON "CalibrationEvent"("elementId");

-- CreateIndex
CREATE INDEX "PersonaConfig_tenantId_idx" ON "PersonaConfig"("tenantId");

-- CreateIndex
CREATE INDEX "SkillPoint_tenantId_idx" ON "SkillPoint"("tenantId");

-- CreateIndex
CREATE INDEX "Scenario_tenantId_idx" ON "Scenario"("tenantId");

-- CreateIndex
CREATE INDEX "LearningPath_tenantId_idx" ON "LearningPath"("tenantId");

-- CreateIndex
CREATE INDEX "ScenarioTask_userId_status_idx" ON "ScenarioTask"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ScenarioTask_userId_scenarioId_key" ON "ScenarioTask"("userId", "scenarioId");

-- CreateIndex
CREATE INDEX "Session_userId_mode_idx" ON "Session"("userId", "mode");

-- CreateIndex
CREATE INDEX "Session_tenantId_mode_idx" ON "Session"("tenantId", "mode");

-- CreateIndex
CREATE INDEX "Session_scenarioId_idx" ON "Session"("scenarioId");

-- CreateIndex
CREATE UNIQUE INDEX "ScoreReport_sessionId_key" ON "ScoreReport"("sessionId");

-- CreateIndex
CREATE INDEX "ScoreItemDef_tenantId_skillPointId_idx" ON "ScoreItemDef"("tenantId", "skillPointId");

-- CreateIndex
CREATE INDEX "Appeal_status_idx" ON "Appeal"("status");

-- CreateIndex
CREATE INDEX "Appeal_sessionId_idx" ON "Appeal"("sessionId");

-- CreateIndex
CREATE INDEX "ExamWindow_tenantId_status_idx" ON "ExamWindow"("tenantId", "status");

-- CreateIndex
CREATE INDEX "CertRecord_tenantId_userId_idx" ON "CertRecord"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "CertRecord_examWindowId_idx" ON "CertRecord"("examWindowId");

-- CreateIndex
CREATE UNIQUE INDEX "UserSkillState_userId_skillPointId_key" ON "UserSkillState"("userId", "skillPointId");

-- CreateIndex
CREATE INDEX "ProductKB_tenantId_idx" ON "ProductKB"("tenantId");

-- CreateIndex
CREATE INDEX "ExtractionProject_tenantId_idx" ON "ExtractionProject"("tenantId");

-- CreateIndex
CREATE INDEX "DataConsent_tenantId_idx" ON "DataConsent"("tenantId");

-- CreateIndex
CREATE INDEX "DomainEvent_sessionId_idx" ON "DomainEvent"("sessionId");

-- CreateIndex
CREATE INDEX "DomainEvent_tenantId_type_idx" ON "DomainEvent"("tenantId", "type");
