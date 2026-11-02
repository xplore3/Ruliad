import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const DIR = path.resolve(process.cwd(), 'recordings');

/** 留存学员每轮上行录音（16kHz PCM16 mono → WAV），供评分测量问题离线核查；失败不影响回合 */
export function saveTurnRecording(sessionId: string, pcm: Buffer): void {
  try {
    mkdirSync(DIR, { recursive: true });
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + pcm.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(16000, 24);
    header.writeUInt32LE(32000, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(pcm.length, 40);
    writeFileSync(path.join(DIR, `${sessionId}-${Date.now()}.wav`), Buffer.concat([header, pcm]));
  } catch {
    // 磁盘不可写等异常静默忽略
  }
}
