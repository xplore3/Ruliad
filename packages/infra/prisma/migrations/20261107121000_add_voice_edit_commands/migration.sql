CREATE TABLE "VoiceEditCommand" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "VoiceEditCommand_tenantId_userId_idx" ON "VoiceEditCommand"("tenantId", "userId");
CREATE INDEX "VoiceEditCommand_tenantId_status_idx" ON "VoiceEditCommand"("tenantId", "status");
CREATE INDEX "VoiceEditCommand_tenantId_createdAt_idx" ON "VoiceEditCommand"("tenantId", "createdAt");
