import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import type { SessionMode } from '@grasp-mvp/core';

/** recordings 目录（相对项目根） */
const REL_DIR = 'recordings';
const DIR = path.resolve(process.cwd(), REL_DIR);

/** 上行音频参数：16kHz PCM16 单声道 */
const SAMPLE_RATE = 16000;
const BYTES_PER_SAMPLE = 2;
const WAV_HEADER_BYTES = 44;

/** 录音保存元信息：调用方附带会话上下文，落库（SessionRecording）由路由层完成 */
export interface TurnRecordingMeta {
  sessionId: string;
  userId: string;
  tenantId: string;
  scenarioId: string;
  mode: SessionMode;
  /** 会话内学员回合序号（从 1 起） */
  turnSeq: number;
}

export interface SavedRecordingFile {
  id: string;
  /** recordings 目录下的相对路径，如 recordings/<sessionId>/<turnSeq>-<short>.wav */
  filePath: string;
  fileSize: number;
  /** 时长（秒） */
  durationSec: number;
}

/**
 * 留存学员本轮上行录音（16kHz PCM16 mono → WAV）。
 * 文件按会话分子目录存放：recordings/<sessionId>/<turnSeq>-<shortId>.wav。
 * 失败（磁盘不可写等）返回 null 且不抛错——录音留存不得影响正常回合。
 */
export function saveTurnRecording(pcm: Buffer, meta: TurnRecordingMeta): SavedRecordingFile | null {
  try {
    const id = randomUUID();
    const fileName = `${String(meta.turnSeq).padStart(2, '0')}-${id.slice(0, 8)}.wav`;
    const relativePath = `${meta.sessionId}/${fileName}`;
    const filePath = path.posix.join(REL_DIR, relativePath);
    // 按会话分子目录存放：先确保 recordings/<sessionId>/ 存在
    mkdirSync(path.resolve(DIR, meta.sessionId), { recursive: true });

    const durationSec = Math.round((pcm.length / BYTES_PER_SAMPLE / SAMPLE_RATE) * 100) / 100;

    const header = Buffer.alloc(WAV_HEADER_BYTES);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + pcm.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(SAMPLE_RATE, 24);
    header.writeUInt32LE(SAMPLE_RATE * BYTES_PER_SAMPLE, 28);
    header.writeUInt16LE(BYTES_PER_SAMPLE, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(pcm.length, 40);

    writeFileSync(path.resolve(DIR, relativePath), Buffer.concat([header, pcm]));

    return {
      id,
      filePath,
      fileSize: WAV_HEADER_BYTES + pcm.length,
      durationSec,
    };
  } catch {
    return null;
  }
}

/** 删除录音文件（同时做目录穿越防护）；文件不存在/不可删时静默 */
export function deleteRecordingFile(filePath: string): void {
  try {
    const abs = path.resolve(process.cwd(), filePath);
    if (!abs.startsWith(DIR + path.sep)) return;
    unlinkSync(abs);
  } catch {
    // 忽略
  }
}
