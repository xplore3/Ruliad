-- CreateTable
CREATE TABLE "DrillScript" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL,
    "data" TEXT NOT NULL
);

-- CreateIndex
CREATE INDEX "DrillScript_tenantId_category_idx" ON "DrillScript"("tenantId", "category");

-- RedefineIndex
DROP INDEX "AnalysisStandard_tenantId_idx";
CREATE INDEX "BriefingStandard_tenantId_idx" ON "BriefingStandard"("tenantId");

-- RedefineIndex
DROP INDEX "CustomerQuestion_tenantId_idx";
CREATE INDEX "DemoFaq_tenantId_idx" ON "DemoFaq"("tenantId");
