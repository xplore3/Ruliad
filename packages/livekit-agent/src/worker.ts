#!/usr/bin/env node
/**
 * Grasp LiveKit Agent Worker
 *
 * 开发模式：进程启动后监听 LiveKit room 创建事件（通过 webhook），
 * 自动以 bot participant 身份加入房间，接管 VAD / ASR / personaTurn / TTS。
 *
 * 生产模式：可与 LiveKit Agent Worker runner 集成，使用官方 dispatch 机制。
 *
 * 运行方式：
 *   node dist/worker.js
 * 环境变量（packages/api-gateway/.env）：
 *   LIVEKIT_URL=ws://localhost:7880
 *   LIVEKIT_API_KEY=devkey
 *   LIVEKIT_API_SECRET=secret
 *   API_BASE_URL=http://localhost:3060   # personaTurn 端点
 *
 * 直接连接（非 dispatch）模式：每收到一个新房间或预配置房间列表，
 * bot 主动加入处理。
 */
import { RoomServiceClient } from 'livekit-server-sdk';

const lkUrl = process.env.LIVEKIT_URL;
const lkApiKey = process.env.LIVEKIT_API_KEY ?? 'devkey';
const lkApiSecret = process.env.LIVEKIT_API_SECRET ?? 'secret';
const apiBaseUrl = process.env.API_BASE_URL ?? 'http://localhost:3060';

if (!lkUrl) {
  console.error('[GraspAgent] 缺少 LIVEKIT_URL，请检查环境变量');
  process.exit(1);
}

const roomService = new RoomServiceClient(
  lkUrl.replace(/^ws/, 'http'),
  lkApiKey,
  lkApiSecret,
);

console.log(`[GraspAgent] 启动 → LiveKit=${lkUrl} api=${apiBaseUrl}`);

// 获取活跃房间列表，为每个房间启动 bot participant
async function pollRooms(): Promise<void> {
  try {
    const rooms = await roomService.listRooms();
    for (const room of rooms) {
      console.log(`[GraspAgent] 活跃房间: ${room.name} (numParticipants=${room.numParticipants})`);
      // TODO: 为没有 bot 的房间启动 GraspAgentBot
      void room;
    }
  } catch (err) {
    console.error('[GraspAgent] 获取房间列表失败:', err instanceof Error ? err.message : String(err));
  }
}

// 每 10 秒轮询一次（生产环境改用 webhook）
const pollInterval = setInterval(pollRooms, 10_000);
pollRooms().catch(() => {});

process.on('SIGINT', () => {
  console.log('[GraspAgent] 收到 SIGINT，退出中...');
  clearInterval(pollInterval);
  process.exit(0);
});
