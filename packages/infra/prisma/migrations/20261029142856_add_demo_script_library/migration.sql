-- 新增示范剧本库（DemoScript）：新手指引第2步「示范」的双人对戏剧本，按业务线分支（地推/电销/接待咨询/课程顾问）
-- ScenarioGuidance 的 data JSON 中 demo 字段改为 demoScriptId 引用，由 seed:guidance 种子脚本 upsert 覆盖存量行（不做 SQL 数据迁移）

-- CreateTable
CREATE TABLE IF NOT EXISTS "DemoScript" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL,
    "data" TEXT NOT NULL
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DemoScript_tenantId_idx" ON "DemoScript"("tenantId");
