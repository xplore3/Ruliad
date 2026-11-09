-- 保留所有历史指引；只阻止今后产生同租户、同场景的重复记录。
CREATE TRIGGER IF NOT EXISTS "ScenarioGuidance_prevent_duplicate_insert"
BEFORE INSERT ON "ScenarioGuidance"
WHEN EXISTS (
  SELECT 1 FROM "ScenarioGuidance"
  WHERE "tenantId" = NEW."tenantId" AND "scenarioId" = NEW."scenarioId"
)
BEGIN
  SELECT RAISE(ABORT, 'duplicate scenario guidance');
END;

CREATE TRIGGER IF NOT EXISTS "ScenarioGuidance_prevent_duplicate_update"
BEFORE UPDATE OF "tenantId", "scenarioId" ON "ScenarioGuidance"
WHEN EXISTS (
  SELECT 1 FROM "ScenarioGuidance"
  WHERE "tenantId" = NEW."tenantId" AND "scenarioId" = NEW."scenarioId" AND "id" <> NEW."id"
)
BEGIN
  SELECT RAISE(ABORT, 'duplicate scenario guidance');
END;

-- 旧回归案例 tenantId 保持 NULL，继续作为全局共享案例；新案例由应用写入租户 ID。
ALTER TABLE "GoldenCase" ADD COLUMN "tenantId" TEXT;
CREATE INDEX IF NOT EXISTS "GoldenCase_tenantId_idx" ON "GoldenCase"("tenantId");
