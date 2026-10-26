/**
 * 语音通话 LiveKit 接入票据接口
 *
 * 前端在进入语音对练时先调 POST /sessions/:id/livekit-ticket：
 *   1. 后端校验 token
 *   2. 创建 LiveKit room（Name = sessionId）并写入 metadata
 *   3. dispatch Grasp Agent
 *   4. 返回 access token 供前端直连 LiveKit Server
 */
import type { FastifyInstance } from 'fastify';
import { AccessToken, RoomServiceClient, AgentDispatchClient } from 'livekit-server-sdk';
import type { RouteContext } from '../ctx.js';
import { verifyToken } from '../auth.js';

export async function voiceTicketRoutes(app: FastifyInstance, ctx: RouteContext) {
  const lkUrl = process.env.LIVEKIT_URL;
  const lkApiKey = process.env.LIVEKIT_API_KEY ?? 'devkey';
  const lkApiSecret = process.env.LIVEKIT_API_SECRET ?? 'secret';
  const publicBaseUrl = process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:8080';

  if (!lkUrl) {
    app.log.warn('LIVEKIT_URL 未配置，livekit-ticket 接口将不可用');
  }

  const roomService = lkUrl
    ? new RoomServiceClient(lkUrl.replace(/^ws/, 'http'), lkApiKey, lkApiSecret)
    : null;
  const agentDispatch = lkUrl
    ? new AgentDispatchClient(lkUrl.replace(/^ws/, 'http'), lkApiKey, lkApiSecret)
    : null;
  const agentName = process.env.LIVEKIT_AGENT_NAME ?? 'grasp-agent';

  app.post<{ Params: { id: string }; Querystring: { token?: string } }>(
    '/sessions/:id/livekit-ticket',
    async (req, reply) => {
      if (!lkUrl || !roomService || !agentDispatch) {
        return reply.code(503).send({ error: '语音服务未配置（缺少 LIVEKIT_URL）' });
      }

      const token = req.query.token;
      const payload = token ? verifyToken(token) : null;
      if (!payload) return reply.code(401).send({ error: '未登录或登录已过期' });

      const sessionId = req.params.id;

      // 校验会话归属
      const session = await ctx.store.getSession(sessionId);
      if (!session) return reply.code(404).send({ error: '会话不存在' });
      if (session.userId !== payload.userId) return reply.code(403).send({ error: '无权限访问该会话' });

      const roomName = `session-${sessionId}`;

      try {
        // 1. 创建房间（已存在时忽略错误——用户重复进页面等场景）
        try {
          await roomService.createRoom({
            name: roomName,
            metadata: JSON.stringify({
              sessionId,
              token,
              apiBaseUrl: publicBaseUrl,
              personaConfigId: session.scenarioId,
            }),
            emptyTimeout: 60 * 30, // 30 分钟无人自动清理
            maxParticipants: 2,
          });
          console.log(`[LiveKit] 房间已就绪 ${roomName}`);
        } catch (roomErr) {
          // 房间已存在：忽略；其他错误：抛出到外层
          const msg = roomErr instanceof Error ? roomErr.message : String(roomErr);
          if (msg.toLowerCase().includes('already exists') || msg.includes('409')) {
            console.log(`[LiveKit] 房间已存在，忽略 ${roomName}`);
          } else {
            throw roomErr;
          }
        }

        // 2. 派发 Agent（已存在会被覆盖）
        try {
          await agentDispatch.createDispatch(roomName, agentName, {
            metadata: JSON.stringify({ sessionId, token, apiBaseUrl: publicBaseUrl }),
          });
          console.log(`[LiveKit] 已派发 agent=${agentName} → room=${roomName}`);
        } catch (dispatchErr) {
          console.warn('[LiveKit] dispatch 失败（可能是 agent 未注册）:', dispatchErr instanceof Error ? dispatchErr.message : String(dispatchErr));
        }

        // 3. 为用户生成 join token
        const at = new AccessToken(lkApiKey, lkApiSecret, {
          identity: `user-${payload.userId}`,
          ttl: '1h',
        });
        at.addGrant({
          room: roomName,
          roomJoin: true,
          canPublish: true,
          canSubscribe: true,
        });
        const userToken = await at.toJwt();

        return {
          url: lkUrl,
          token: userToken,
          room: roomName,
        };
      } catch (err) {
        console.error('[LiveKit] 创建票据失败:', err instanceof Error ? err.message : String(err));
        return reply.code(500).send({ error: '语音服务初始化失败' });
      }
    }
  );
}
