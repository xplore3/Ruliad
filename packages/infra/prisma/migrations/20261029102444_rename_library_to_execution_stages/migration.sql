-- 资源库按执行环节改名：CustomerQuestion→DemoFaq（新手指引第2步「示范」FAQ 池）、AnalysisStandard→BriefingStandard（第3步「讲解」标准库）
-- ScenarioGuidance/AnalysisStandard/RealismStandard 历史上由 prisma db push 直接入库（无 migration 记录），
-- 此处用 CREATE TABLE IF NOT EXISTS 兼容「全新库按 migration 顺序重建」与「已有库表已存在」两种场景。

-- CreateTable
CREATE TABLE IF NOT EXISTS "ScenarioGuidance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "data" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AnalysisStandard" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT '',
    "data" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "RealismStandard" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT '',
    "data" TEXT NOT NULL
);

-- CreateTable（保底：CustomerQuestion 已由 20261027110118_add_customer_question 创建）
CREATE TABLE IF NOT EXISTS "CustomerQuestion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT '',
    "data" TEXT NOT NULL
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ScenarioGuidance_tenantId_idx" ON "ScenarioGuidance"("tenantId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ScenarioGuidance_scenarioId_idx" ON "ScenarioGuidance"("scenarioId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AnalysisStandard_tenantId_idx" ON "AnalysisStandard"("tenantId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RealismStandard_tenantId_idx" ON "RealismStandard"("tenantId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CustomerQuestion_tenantId_idx" ON "CustomerQuestion"("tenantId");

-- AlterTable：表名随执行环节改名
ALTER TABLE "CustomerQuestion" RENAME TO "DemoFaq";
ALTER TABLE "AnalysisStandard" RENAME TO "BriefingStandard";

-- 存量 JSON 数据字段名迁移：ScenarioGuidance.data.analysisStandardIds → briefingStandardIds
UPDATE "ScenarioGuidance" SET "data" = REPLACE("data", 'analysisStandardIds', 'briefingStandardIds');
