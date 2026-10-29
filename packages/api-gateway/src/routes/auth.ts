import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { User } from '@grasp-mvp/core';
import { hashPassword, verifyPassword, TencentSmsClient } from '@grasp-mvp/infra';
import type { RouteContext } from '../ctx.js';
import { signToken } from '../auth.js';

const DEFAULT_TENANT = 'tenant-demo';

/** API 输出用户：剔除 passwordHash（username 可返回） */
function publicUser(user: User) {
  const { passwordHash: _passwordHash, ...rest } = user;
  return rest;
}

/* ───────── 验证码内存存储（替代 Redis，适合 MVP 单实例） ───────── */

interface CodeEntry {
  code: string;
  expiresAt: number;
  // 频率限制
  sentAt: number;
}

const codeStore = new Map<string, CodeEntry>();
const CODE_TTL_MS = 5 * 60 * 1000; // 5 分钟有效
const RATE_LIMIT_MS = 60 * 1000; // 60 秒发送间隔
const DAILY_LIMIT = 5;
const dailyCount = new Map<string, { count: number; date: string }>();

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/* ───────── 腾讯云短信客户端初始化 ───────── */

let smsClient: TencentSmsClient | null = null;

function getSmsClient(): TencentSmsClient | null {
  if (smsClient) return smsClient;
  const secretId = process.env.TENCENT_CLOUD_SECRET_ID;
  const secretKey = process.env.TENCENT_CLOUD_SECRET_KEY;
  if (!secretId || !secretKey) return null;
  smsClient = new TencentSmsClient(secretId, secretKey);
  return smsClient;
}

function getSmsConfig() {
  return {
    signName: process.env.SMS_SIGN_NAME ?? '',
    templateId: process.env.SMS_TEMPLATE_CODE ?? '',
    sdkAppId: process.env.TENCENT_SMS_SDK_APP_ID ?? '',
  };
}

/* ───────── 手机号校验 ───────── */

function isValidPhone(phone: string): boolean {
  return /^1[3-9]\d{9}$/.test(phone);
}

export async function authRoutes(app: FastifyInstance, ctx: RouteContext): Promise<void> {
  const { store } = ctx;

  // ====== 发送验证码 ======
  app.post<{ Body: { phone?: string } }>('/auth/send-code', async (request, reply) => {
    const phone = request.body?.phone?.trim();

    if (!phone) {
      return reply.code(400).send({ error: '手机号不能为空' });
    }
    if (!isValidPhone(phone)) {
      return reply.code(400).send({ error: '手机号格式不正确' });
    }

    // SMS_ENABLE=true：真实发送短信并校验；其他情况：全部模拟执行
    const smsEnabled = process.env.SMS_ENABLE === 'true';

    if (smsEnabled) {
      // ── 真实短信模式 ──

      // 频率限制：60 秒内只能发 1 次
      const existing = codeStore.get(phone);
      if (existing && Date.now() - existing.sentAt < RATE_LIMIT_MS) {
        const waitSec = Math.ceil((RATE_LIMIT_MS - (Date.now() - existing.sentAt)) / 1000);
        return reply.code(429).send({ error: `发送太频繁，请 ${waitSec} 秒后再试` });
      }

      // 单日次数限制
      const daily = dailyCount.get(phone);
      const today = todayKey();
      if (daily && daily.date === today && daily.count >= DAILY_LIMIT) {
        return reply.code(429).send({ error: '今日验证码获取次数已达上限（5次），请明天再试' });
      }

      const code = generateCode();
      codeStore.set(phone, {
        code,
        expiresAt: Date.now() + CODE_TTL_MS,
        sentAt: Date.now(),
      });

      // 更新单日计数
      if (daily && daily.date === today) {
        daily.count++;
      } else {
        dailyCount.set(phone, { count: 1, date: today });
      }

      app.log.info(`[验证码] ${phone} => ${code}`);

      // 检查短信配置是否完整
      const client = getSmsClient();
      const cfg = getSmsConfig();
      const smsConfigured = !!(client && cfg.signName && cfg.templateId && cfg.sdkAppId);

      if (!smsConfigured) {
        const reason = !client
          ? '未配置 TENCENT_CLOUD_SECRET_ID / TENCENT_CLOUD_SECRET_KEY'
          : '短信配置不完整（需 SMS_SIGN_NAME / SMS_TEMPLATE_CODE / TENCENT_SMS_SDK_APP_ID）';
        app.log.error(`[SMS] SMS_ENABLE=true 但 ${reason}`);
        return reply.code(503).send({
          error: `短信服务未配置：${reason}`,
        });
      }

      // 调用腾讯云短信服务发送验证码
      try {
        const result = await client.sendSms({
          phoneNumbers: [phone],
          smsSdkAppId: cfg.sdkAppId,
          signName: cfg.signName,
          templateId: cfg.templateId,
          templateParams: [code, '5'],
        });
        const status = result.SendStatusSet?.[0];
        if (status && status.Code === 'Ok') {
          return reply.code(200).send({ success: true, message: '验证码已发送' });
        }
        app.log.error(`[腾讯云短信失败] ${JSON.stringify(result.SendStatusSet)} ${JSON.stringify(result.Error)}`);
        return reply.code(500).send({ error: '短信发送失败，请稍后重试' });
      } catch (err) {
        app.log.error(`[短信异常] ${err instanceof Error ? err.message : String(err)}`);
        return reply.code(500).send({ error: '短信服务异常，请稍后重试' });
      }
    } else {
      // ── 模拟模式（SMS_ENABLE≠true）：跳过真实发送，回显验证码，不限制频率 ──

      const code = generateCode();
      codeStore.set(phone, {
        code,
        expiresAt: Date.now() + CODE_TTL_MS,
        sentAt: Date.now(),
      });

      app.log.info(`[SMS] 模拟模式 ${phone} => ${code}`);
      return reply.code(200).send({
        success: true,
        message: '验证码已发送（模拟模式）',
        _devCode: code,
      });
    }
  });

  // ====== 验证码登录/注册（一体） ======
  app.post<{ Body: { phone?: string; code?: string; name?: string } }>(
    '/auth/verify-code',
    async (request, reply) => {
      const phone = request.body?.phone?.trim();
      const code = request.body?.code?.trim();
      const name = request.body?.name?.trim();

      if (!phone || !code) {
        return reply.code(400).send({ error: '手机号和验证码不能为空' });
      }

      const smsEnabled = process.env.SMS_ENABLE === 'true';

      if (smsEnabled) {
        // ── 真实模式：严格校验验证码 ──
        const entry = codeStore.get(phone);
        if (!entry) {
          return reply.code(400).send({ error: '验证码已过期，请重新获取' });
        }
        if (Date.now() > entry.expiresAt) {
          codeStore.delete(phone);
          return reply.code(400).send({ error: '验证码已过期，请重新获取' });
        }
        if (entry.code !== code) {
          return reply.code(400).send({ error: '验证码错误' });
        }
        // 验证通过，删除验证码（一次性使用）
        codeStore.delete(phone);
      } else {
        // ── 模拟模式：跳过验证码校验 ──
        app.log.info(`[SMS] 模拟模式，跳过验证码校验 ${phone}`);
        codeStore.delete(phone);
      }

      // 以手机号作为 username 查找或创建用户
      let user = await store.getUserByUsername(DEFAULT_TENANT, phone);
      const isNewUser = !user;
      if (!user) {
        user = {
          id: randomUUID(),
          tenantId: DEFAULT_TENANT,
          orgId: (await store.listOrganizations(DEFAULT_TENANT))[0]?.id ?? 'default',
          name: name || `用户${phone.slice(-4)}`,
          role: 'trainee',
          username: phone,
          passwordHash: hashPassword(randomUUID()), // 随机密码，阻止密码登录
        };
        await store.saveUser(user);
      }

      const token = signToken({
        userId: user.id,
        tenantId: user.tenantId,
        role: user.role,
        name: user.name,
      });
      return reply.code(200).send({
        token,
        user: publicUser(user),
        isNewUser,
      });
    }
  );

  // 注册：同租户内 username 唯一，角色固定 trainee
  app.post<{ Body: { username?: string; name?: string; password?: string } }>(
    '/auth/register',
    async (request, reply) => {
      const { username, name, password } = request.body ?? {};
      if (!username?.trim() || !name?.trim() || !password) {
        return reply.code(400).send({ error: 'username / name / password 必填' });
      }
      if (password.length < 6) {
        return reply.code(400).send({ error: '密码长度至少 6 位' });
      }
      const tenantHeader = request.headers['x-tenant-id'];
      const tenantId =
        (Array.isArray(tenantHeader) ? tenantHeader[0] : tenantHeader) || DEFAULT_TENANT;
      const existing = await store.getUserByUsername(tenantId, username.trim());
      if (existing) {
        return reply.code(409).send({ error: '用户名已存在' });
      }
      const user: User = {
        id: randomUUID(),
        tenantId,
        // 落到租户第一个组织（无组织时退化为 'default'，仅作占位）
        orgId: (await store.listOrganizations(tenantId))[0]?.id ?? 'default',
        name: name.trim(),
        role: 'trainee',
        username: username.trim(),
        passwordHash: hashPassword(password),
      };
      await store.saveUser(user);
      const token = signToken({
        userId: user.id,
        tenantId: user.tenantId,
        role: user.role,
        name: user.name,
      });
      return reply.code(201).send({ token, user: publicUser(user) });
    }
  );

  // 登录：用户不存在与密码错误统一 401，不泄露账号是否存在
  app.post<{ Body: { username?: string; password?: string; tenantId?: string } }>(
    '/auth/login',
    async (request, reply) => {
      const { username, password, tenantId } = request.body ?? {};
      if (!username || !password) {
        return reply.code(400).send({ error: 'username / password 必填' });
      }
      const user = await store.getUserByUsername(tenantId || DEFAULT_TENANT, username);
      if (!user || !verifyPassword(password, user.passwordHash)) {
        return reply.code(401).send({ error: '用户名或密码错误' });
      }
      const token = signToken({
        userId: user.id,
        tenantId: user.tenantId,
        role: user.role,
        name: user.name,
      });
      return { token, user: publicUser(user) };
    }
  );

  // 当前用户（鉴权钩子已就绪 request.userId）
  app.get('/auth/me', async (request, reply) => {
    const user = await store.getUser(request.userId);
    if (!user) return reply.code(404).send({ error: '用户不存在' });
    return publicUser(user);
  });

  // 修改密码：校验旧密码后换新哈希。token 为无状态 JWT，无法即时吊销，
  // 这里更新密码哈希（旧密码立即失效），已签发 token 到期后自然失效
  app.post<{ Body: { oldPassword?: string; newPassword?: string } }>(
    '/auth/change-password',
    async (request, reply) => {
      const { oldPassword, newPassword } = request.body ?? {};
      if (!oldPassword || !newPassword) {
        return reply.code(400).send({ error: 'oldPassword / newPassword 必填' });
      }
      if (newPassword.length < 6) {
        return reply.code(400).send({ error: '新密码长度至少 6 位' });
      }
      const user = await store.getUser(request.userId);
      if (!user) return reply.code(404).send({ error: '用户不存在' });
      if (!verifyPassword(oldPassword, user.passwordHash)) {
        return reply.code(400).send({ error: '旧密码错误' });
      }
      await store.saveUser({ ...user, passwordHash: hashPassword(newPassword) });
      return { success: true };
    }
  );
}
