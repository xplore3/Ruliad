import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import websocket from '@fastify/websocket';
import { EventTypes } from '@grasp-mvp/core';
import { buildSeedData, createStore } from '@grasp-mvp/infra';
import { createLLMGateway } from '@grasp-mvp/llm-gateway';
import { createSpeechGateway } from '@grasp-mvp/speech-gateway';
import { mkEvent } from './events.js';
import type { RouteContext } from './ctx.js';
import { requireRoles, tokenFailReason, verifyToken } from './auth.js';
import { seedHistory, shouldSeedDemoHistory } from './seed-history.js';
import { ensureDrillScriptSeeds } from './seed-drill-scripts.js';
import { authRoutes } from './routes/auth.js';
import { usersRoutes } from './routes/users.js';
import { tasksRoutes } from './routes/tasks.js';
import { sessionsRoutes } from './routes/sessions.js';
import { voiceRoutes } from './routes/voice.js';
import { guidanceRoutes } from './routes/guidance.js';
import { videoRoutes } from './routes/video.js';
import { voiceTicketRoutes } from './routes/voice-ticket.js';
import { reportsRoutes } from './routes/reports.js';
import { appealsRoutes } from './routes/appeals.js';
import { catalogRoutes } from './routes/catalog.js';
import { scenarioExtractRoutes } from './routes/scenario-extract.js';
import { growthRoutes } from './routes/growth.js';
import { tenantsRoutes } from './routes/tenants.js';
import { examsRoutes } from './routes/exams.js';
import { supervisorRoutes } from './routes/supervisor.js';
import { executiveRoutes } from './routes/executive.js';
import { analyticsRoutes } from './routes/analytics.js';
import { dataAssetsRoutes } from './routes/data-assets.js';
import { workshopRoutes } from './routes/workshop.js';
import { libraryRoutes } from './routes/library.js';
import { pathsRoutes } from './routes/paths.js';
import { eventsRoutes } from './routes/events.js';
import { sandboxRoutes } from './routes/sandbox.js';
import { abilityDetailRoutes } from './routes/ability-detail.js';

const port = Number(process.env.API_PORT ?? '3060');
const host = process.env.API_HOST ?? '0.0.0.0';
const DEFAULT_TENANT = 'tenant-demo';

const app = Fastify({ logger: true });

const store = createStore();
const gateway = createLLMGateway(process.env, {
  onUsage: (info) => {
    void store.appendEvent(
      mkEvent(EventTypes.LLM_USAGE, { payload: { ...info } })
    );
  },
  // 每次 LLM 调用的开始/完成/失败都落到服务日志（含 task、model、耗时），定位评分卡点用
  logger: app.log,
});

const speech = createSpeechGateway(process.env, app.log);
const ctx: RouteContext = { store, gateway, speech };
if (speech.asr.name === 'mock') {
  app.log.warn(
    '语音对练 provider: mock（正在使用 Mock provider，识别/合成均为模拟输出；配置 SPEECH_PROVIDER=aliyun 与 SPEECH_API_KEY 可切换真实服务）'
  );
} else {
  app.log.info(`语音对练 provider: ${speech.asr.name}`);
}

/** 无需登录即可访问的路径（/docs 开头的 swagger 路径全部放行） */
const PUBLIC_PATHS = new Set([
  '/health',
  '/api/v1/auth/login',
  '/api/v1/auth/register',
  '/api/v1/auth/send-code',
  '/api/v1/auth/verify-code',
]);

async function main() {
  if (!process.env.AUTH_SECRET) {
    app.log.warn('AUTH_SECRET 未配置，使用开发默认密钥；生产部署必须设置 AUTH_SECRET，否则 token 可被伪造');
  }
  // 种子数据：无场景时灌入演示数据
  const scenarios = await store.listScenarios(DEFAULT_TENANT);
  if (scenarios.length === 0) {
    await store.seed(buildSeedData());
    app.log.info('种子数据已灌入（tenant-demo）');
  } else {
    // 增量同步：已有数据时检查 persona 数量，不足则补充新增的陪练员
    const existingPersonas = await store.listPersonaConfigs(DEFAULT_TENANT);
    const fullSeed = buildSeedData();
    const missingPersonas = fullSeed.personaConfigs.filter(
      (p) => !existingPersonas.some((e) => e.id === p.id)
    );
    if (missingPersonas.length > 0) {
      for (const p of missingPersonas) {
        await store.savePersonaConfig(p);
      }
      app.log.info(`增量同步：补充 ${missingPersonas.length} 个陪练员（共 ${existingPersonas.length + missingPersonas.length} 个）`);
    }
    // 评分标准库：仅在库为空时灌入种子；之后用户在库中的增删改归用户所有，启动同步不恢复、不覆盖
    const existingScoreItems = await store.listScoreItemDefs(DEFAULT_TENANT);
    if (existingScoreItems.length === 0) {
      for (const d of fullSeed.scoreItemDefs) await store.upsertScoreItemDef(d);
      app.log.info(`种子评分标准已灌入（${fullSeed.scoreItemDefs.length} 条）`);
    }
    // 已有种子标准缺 category 时回填分类（不覆盖已设置的分类）
    const seedItemById = new Map(fullSeed.scoreItemDefs.map((d) => [d.id, d]));
    for (const e of existingScoreItems) {
      const seedItem = seedItemById.get(e.id);
      if (seedItem?.category && !e.category) {
        await store.upsertScoreItemDef({ ...e, category: seedItem.category });
      }
    }
    // 增量同步：回填场景评分分类（仅当场景尚未设置 category，不覆盖用户修改）
    const existingScenarios = await store.listScenarios(DEFAULT_TENANT);
    const seedCategoryById = new Map(fullSeed.scenarios.map((s) => [s.id, s.category]));
    for (const s of existingScenarios) {
      const category = seedCategoryById.get(s.id);
      if (category && !s.category) {
        await store.saveScenario({ ...s, category });
        app.log.info(`增量同步：场景「${s.name}」回填评分分类 ${category}`);
      }
    }
  }
  // 演练剧本库：仅在库为空时灌入四类模板（之后用户的增删改归用户所有；新旧库都执行）
  const drillSeeded = await ensureDrillScriptSeeds(store, DEFAULT_TENANT);
  if (drillSeeded > 0) {
    app.log.info(`演练剧本库：灌入 ${drillSeeded} 条分类模板`);
  }
  // 演示考核历史：无任何认证记录时灌入（看板开箱有数据；确定性合成，不依赖 LLM）。
  // 仅 SEED_DEMO_HISTORY=1 或非 production 且未显式设为 0 时执行（生产默认不灌合成数据）
  if (shouldSeedDemoHistory()) {
    await seedHistory(store);
  } else {
    app.log.info('演示考核历史灌入已跳过（SEED_DEMO_HISTORY 未开启 / 生产环境）');
  }

  await app.register(cors, { origin: true });
  await app.register(multipart, { limits: { fileSize: 500 * 1024 * 1024 } });
  await app.register(websocket);
  await app.register(swagger, {
    openapi: {
      info: { title: 'Grasp · 你的专属陪练员与指导参谋 API', version: '0.1.0' },
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  // 鉴权钩子：Authorization: Bearer <token>；无效或缺失一律 401
  app.decorateRequest('userId', '');
  app.decorateRequest('tenantId', '');
  app.decorateRequest('userRole', 'trainee');
  app.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0];
    if (PUBLIC_PATHS.has(path) || path === '/docs' || path.startsWith('/docs/')) return;
    const isVoiceWsPath = /^\/api\/v1\/sessions\/[^/]+\/voice(-call)?$/.test(path);
    // 语音对练 WS 升级请求：浏览器 WebSocket 无法带 Authorization header，
    // token 经 query 传入，在 voice 路由内用同一套 verifyToken 校验
    if (request.headers.upgrade === 'websocket' && isVoiceWsPath) {
      const isVoiceCallReq = path.endsWith('/voice-call');
      request.log.info(
          {
            path,
            hasTokenQuery: request.url.includes('token='),
            upgradeHeader: request.headers.upgrade,
            connectionHeader: request.headers.connection,
            isVoiceCall: isVoiceCallReq,
            isVoice: !isVoiceCallReq,
            remoteAddress: request.ip,
            userAgent: request.headers['user-agent']?.slice(0, 80),
          },
          '语音 WS 升级请求：跳过 HTTP 层鉴权，token 将在 voice 路由内校验'
        );
        if (isVoiceCallReq) {
          console.log(`[VoiceCall][diag] WS 升级握手到达 Fastify：path=${path} remote=${request.ip} hasToken=${request.url.includes('token=')} UA=${request.headers['user-agent']?.slice(0, 80)}`);
        }
      return;
    }
    // 语音通话路径收到非 WS 升级请求：dump 完整 headers，定位 Nginx 是否真的没透传
    if (isVoiceWsPath) {
      request.log.warn(
        {
          path,
          method: request.method,
          upgradeHeader: request.headers.upgrade ?? null,
          connectionHeader: request.headers.connection ?? null,
          secWebSocketKey: request.headers['sec-websocket-key'] ?? null,
          httpVersion: request.raw.httpVersion,
          remoteAddress: request.ip,
        },
        '语音通话路径收到无 Upgrade 头的请求（可能原因：1) Nginx 未透传 Upgrade/Connection 头；2) 健康检查；3) 用户直接浏览器访问 URL）'
      );
    }
    // 录像回放/关键帧 GET：<video>/<img> 标签无法带 Authorization header，token 经 query 传入，路由内校验
    if (request.method === 'GET' && /^\/api\/v1\/sessions\/[^/]+\/video(\/frames\/\d+)?$/.test(path)) return;
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
    const payload = token ? verifyToken(token) : null;
    if (!payload) {
      request.log.warn(
        {
          path,
          method: request.method,
          hasAuthorizationHeader: !!header,
          hasTokenQuery: request.url.includes('token='),
          tokenFailReason: token ? tokenFailReason(token) : '缺少 Authorization 头',
        },
        '鉴权失败：返回 401'
      );
      // 语音路由收到非 WS 升级请求：几乎可以确定是反向代理（nginx 等）未透传 Upgrade/Connection 头，
      // 导致浏览器 WebSocket 握手被当成普通 HTTP 请求，进入本鉴权钩子（浏览器 WS 无法带 Authorization）
      if (isVoiceWsPath) {
        request.log.warn(
          {
            path,
            upgradeHeader: request.headers.upgrade ?? null,
            connectionHeader: request.headers.connection ?? null,
            httpVersion: request.raw.httpVersion,
          },
          '语音通话路由收到无 Upgrade 头的请求（浏览器 WS 握手被反向代理剥离 Upgrade 头？）。' +
            '修复：代理层需配置 WebSocket 透传，如 nginx：proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade"'
        );
      }
      return reply.code(401).send({ error: '未登录或登录已过期' });
    }
    request.userId = payload.userId;
    request.tenantId = payload.tenantId;
    request.userRole = payload.role;
  });

  app.get('/health', async () => ({ status: 'ok', ts: new Date().toISOString() }));

  await app.register((a) => authRoutes(a, ctx), { prefix: '/api/v1' });
  await app.register((a) => usersRoutes(a, ctx), { prefix: '/api/v1' });
  await app.register((a) => tasksRoutes(a, ctx), { prefix: '/api/v1' });
  await app.register((a) => sessionsRoutes(a, ctx), { prefix: '/api/v1' });
  await app.register((a) => voiceRoutes(a, ctx), { prefix: '/api/v1' });
  await app.register((a) => guidanceRoutes(a, ctx), { prefix: '/api/v1' });
  await app.register((a) => voiceTicketRoutes(a, ctx), { prefix: '/api/v1' });
  await app.register((a) => videoRoutes(a, ctx), { prefix: '/api/v1' });
  await app.register((a) => reportsRoutes(a, ctx), { prefix: '/api/v1' });
  await app.register((a) => appealsRoutes(a, ctx), { prefix: '/api/v1' });
  await app.register((a) => catalogRoutes(a, ctx), { prefix: '/api/v1' });
  await app.register((a) => scenarioExtractRoutes(a, ctx), { prefix: '/api/v1' });
  await app.register((a) => growthRoutes(a, ctx), { prefix: '/api/v1' });
  await app.register((a) => tenantsRoutes(a, ctx), { prefix: '/api/v1' });
  await app.register((a) => examsRoutes(a, ctx), { prefix: '/api/v1' });
  await app.register((a) => pathsRoutes(a, ctx), { prefix: '/api/v1' });
  await app.register((a) => eventsRoutes(a, ctx), { prefix: '/api/v1' });
  await app.register((a) => sandboxRoutes(a, ctx), { prefix: '/api/v1' });
  // 角色受限路由组：整组包一层 preHandler
  await app.register(
    (a) => {
      a.addHook('preHandler', requireRoles('supervisor', 'admin'));
      return supervisorRoutes(a, ctx);
    },
    { prefix: '/api/v1' }
  );
  await app.register(
    (a) => {
      a.addHook('preHandler', requireRoles('executive', 'admin'));
      return executiveRoutes(a, ctx);
    },
    { prefix: '/api/v1' }
  );
  await app.register(
    (a) => {
      a.addHook('preHandler', requireRoles('admin', 'platform'));
      return analyticsRoutes(a, ctx);
    },
    { prefix: '/api/v1' }
  );
  await app.register(
    (a) => {
      a.addHook('preHandler', requireRoles('admin', 'platform'));
      return dataAssetsRoutes(a, ctx);
    },
    { prefix: '/api/v1' }
  );
  await app.register(
    (a) => {
      a.addHook('preHandler', requireRoles('admin', 'platform'));
      return workshopRoutes(a, ctx);
    },
    { prefix: '/api/v1' }
  );
  await app.register(
    (a) => {
      // 资源库（考题/评分标准/评分回归案例）定义本身不敏感：GET 对全员开放（学员端场景详情要展示评估维度），
      // 写操作仍限 admin/platform
      a.addHook('preHandler', async (req, reply) => {
        if (req.method === 'GET') return;
        if (req.userRole !== 'platform' && req.userRole !== 'admin') {
          return reply.code(403).send({ error: '无权访问' });
        }
      });
      return libraryRoutes(a, ctx);
    },
    { prefix: '/api/v1' }
  );
  await app.register((a) => abilityDetailRoutes(a, ctx), { prefix: '/api/v1' });

  try {
    await app.listen({ port, host });
    app.log.info(`API Gateway listening on http://${host}:${port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
