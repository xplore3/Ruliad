-- CreateTable
CREATE TABLE "SessionRecording" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "turnSeq" INTEGER NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "durationSec" DOUBLE PRECISION NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "SessionRecording_sessionId_turnSeq_idx" ON "SessionRecording"("sessionId", "turnSeq");

-- CreateIndex
CREATE INDEX "SessionRecording_tenantId_userId_idx" ON "SessionRecording"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "SessionRecording_scenarioId_idx" ON "SessionRecording"("scenarioId");
