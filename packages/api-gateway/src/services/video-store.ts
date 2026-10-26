import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * 对练录像本地存储（MVP：落磁盘；生产建议换对象存储，仅需替换本模块实现）。
 * 目录由 VIDEO_STORAGE_DIR 指定，默认 ./data/videos（相对进程 cwd）。
 */
export function videoDir(): string {
  return path.resolve(process.env.VIDEO_STORAGE_DIR ?? './data/videos');
}

export async function ensureVideoDir(): Promise<string> {
  const dir = videoDir();
  await mkdir(dir, { recursive: true });
  return dir;
}

export function videoFileName(sessionId: string, ext: string): string {
  return `${sessionId}.${ext}`;
}

export function frameFileName(sessionId: string, index: number): string {
  return `${sessionId}_f${index}.jpg`;
}

export async function saveVideoFile(sessionId: string, ext: string, data: Buffer): Promise<string> {
  const file = videoFileName(sessionId, ext);
  await writeFile(path.join(await ensureVideoDir(), file), data);
  return file;
}

export async function saveFrameFile(sessionId: string, index: number, data: Buffer): Promise<string> {
  const file = frameFileName(sessionId, index);
  await writeFile(path.join(await ensureVideoDir(), file), data);
  return file;
}

/** 把会话的评分关键帧读为 base64 data URL（供多模态 judge；文件缺失时截断返回） */
export async function readFramesAsDataUrls(sessionId: string, count: number): Promise<string[]> {
  const dir = videoDir();
  const urls: string[] = [];
  for (let i = 0; i < count; i++) {
    try {
      const buf = await readFile(path.join(dir, frameFileName(sessionId, i)));
      urls.push(`data:image/jpeg;base64,${buf.toString('base64')}`);
    } catch {
      break;
    }
  }
  return urls;
}
