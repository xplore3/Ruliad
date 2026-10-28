-- CreateTable
CREATE TABLE "CustomerQuestion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT '',
    "data" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "QuizQuestion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "scenarioId" TEXT,
    "skillPointId" TEXT,
    "type" TEXT NOT NULL,
    "data" TEXT NOT NULL
);

-- CreateIndex
CREATE INDEX "CustomerQuestion_tenantId_idx" ON "CustomerQuestion"("tenantId");

-- CreateIndex
CREATE INDEX "QuizQuestion_tenantId_idx" ON "QuizQuestion"("tenantId");

-- CreateIndex
CREATE INDEX "QuizQuestion_tenantId_scenarioId_idx" ON "QuizQuestion"("tenantId", "scenarioId");
