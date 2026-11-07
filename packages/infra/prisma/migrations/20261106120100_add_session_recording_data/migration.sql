-- AlterTable：SessionRecording 补齐文档表约定的 data JSON 列
ALTER TABLE "SessionRecording" ADD COLUMN "data" TEXT NOT NULL DEFAULT "{}";
