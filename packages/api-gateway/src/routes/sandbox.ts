import type { FastifyInstance } from 'fastify';
import type { RouteContext } from '../ctx.js';

/** 推演沙盘请求体 */
interface SandboxRequest {
  scenarioId: string;
  /** 环境因素 */
  environment: {
    setting?: string;       // 场景/地点，如"三甲医院学术交流会"
    timing?: string;         // 时间点，如"月底预算紧张期"
    competitors?: string;    // 竞品动态
    constraints?: string;    // 外部约束，如"集采政策"
    marketTrend?: string;   // 市场趋势
  };
  /** 客户信息 */
  customer: {
    profile?: string;       // 客户画像，如"学术型主任，55岁"
    role?: string;          // 决策角色
    budget?: string;        // 预算情况
    needs?: string;         // 核心需求
    concerns?: string;      // 潜在顾虑
    relationship?: string;  // 与学员关系
  };
  /** 自身信息 */
  self: {
    role?: string;          // 我的角色，如"区域销售经理"
    resources?: string;     // 可用资源
    goals?: string;         // 本次目标
    strengths?: string;     // 自身优势
    weaknesses?: string;   // 自身短板
  };
}

export async function sandboxRoutes(app: FastifyInstance, ctx: RouteContext): Promise<void> {
  const { store, gateway } = ctx;

  // ── 从自然语言中提取沙盘参数 ──
  app.post<{ Body: { scenarioId: string; text: string } }>(
    '/sandbox/extract',
    async (request, reply) => {
      const { scenarioId, text } = request.body ?? {};
      if (!scenarioId || !text?.trim()) {
        return reply.code(400).send({ error: 'scenarioId / text 必填' });
      }

      const scenario = await store.getScenario(scenarioId);
      if (!scenario) return reply.code(404).send({ error: '场景不存在' });

      const prompt = [
        '你是信息提取助手。请从用户输入的自然语言描述中，提取沙盘推演所需的结构化信息。',
        '如果用户没有提到某个字段，则该字段留空字符串 ""。',
        '只输出 JSON，不要输出其他内容。',
        '',
        '场景上下文：' + scenario.name,
        '',
        '用户输入：',
        text,
        '',
        '请提取为以下 JSON 结构：',
        '{',
        '  "environment": {',
        '    "setting": "场景地点，如三甲医院、线上会议",',
        '    "timing": "时间节点，如月底预算紧张期",',
        '    "competitors": "竞品动态",',
        '    "constraints": "外部约束，如政策、合规",',
        '    "marketTrend": "市场趋势"',
        '  },',
        '  "customer": {',
        '    "profile": "客户画像，如学术型主任55岁",',
        '    "role": "决策角色",',
        '    "budget": "预算情况",',
        '    "needs": "核心需求",',
        '    "concerns": "潜在顾虑",',
        '    "relationship": "与我的关系"',
        '  },',
        '  "self": {',
        '    "role": "我的角色",',
        '    "resources": "可用资源",',
        '    "goals": "本次目标",',
        '    "strengths": "自身优势",',
        '    "weaknesses": "自身短板"',
        '  }',
        '}',
      ].join('\n');

      try {
        const result = await gateway.forTask('extractor').chat(
          [{ role: 'user', content: prompt }],
          { jsonMode: true, temperature: 0.3, maxTokens: 1000 }
        );

        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(result.content);
        } catch {
          const jsonMatch = result.content.match(/\{[\s\S]*\}/);
          parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
        }

        return { extracted: parsed };
      } catch (err) {
        app.log.error({ err }, '沙盘信息提取失败');
        return reply.code(500).send({ error: '信息提取失败，请重试' });
      }
    }
  );

  // ── 沙盘推演 ──
  app.post<{ Body: SandboxRequest }>('/sandbox/simulate', async (request, reply) => {
    const body = request.body;
    if (!body?.scenarioId) {
      return reply.code(400).send({ error: 'scenarioId 必填' });
    }

    // 获取场景与陪练员信息
    const scenario = await store.getScenario(body.scenarioId);
    if (!scenario) return reply.code(404).send({ error: '场景不存在' });

    const persona = await store.getPersonaConfig(scenario.personaConfigId);
    const productKB = scenario.productKBId
      ? await store.getProductKBById(scenario.productKBId)
      : persona?.productKBId
        ? await store.getProductKBById(persona.productKBId)
        : await store.getProductKB(request.tenantId);

    // 构建上下文
    const personaInfo = persona
      ? [
          `陪练员名称：${persona.name}`,
          `背景：${persona.background}`,
          persona.occupation ? `职业：${persona.occupation}` : '',
          persona.age ? `年龄：${persona.age}` : '',
        ].filter(Boolean).join('\n')
      : '（无陪练员配置）';

    const productInfo = productKB
      ? [
          `产品知识库：${productKB.name}（v${productKB.version}）`,
          ...productKB.entries.slice(0, 20).map((e) =>
            `[${e.kind}] ${e.title}：${e.content.slice(0, 200)}`
          ),
        ].join('\n')
      : '（无产品知识库）';

    const scenarioInfo = [
      `场景：${scenario.name}`,
      `难度：${scenario.difficulty}`,
      `时长上限：${scenario.durationMinutes} 分钟`,
      scenario.personaTitle ? `客户设定：${scenario.personaTitle}` : '',
      scenario.methodology ? `方法论：${scenario.methodology}` : '',
    ].filter(Boolean).join('\n');

    const envInfo = [
      body.environment.setting ? `📍 场景地点：${body.environment.setting}` : '',
      body.environment.timing ? `⏰ 时间节点：${body.environment.timing}` : '',
      body.environment.competitors ? `⚔️ 竞品动态：${body.environment.competitors}` : '',
      body.environment.constraints ? `🔒 外部约束：${body.environment.constraints}` : '',
      body.environment.marketTrend ? `📈 市场趋势：${body.environment.marketTrend}` : '',
    ].filter(Boolean).join('\n');

    const customerInfo = [
      body.customer.profile ? `👤 客户画像：${body.customer.profile}` : '',
      body.customer.role ? `👔 决策角色：${body.customer.role}` : '',
      body.customer.budget ? `💰 预算情况：${body.customer.budget}` : '',
      body.customer.needs ? `🎯 核心需求：${body.customer.needs}` : '',
      body.customer.concerns ? `⚠️ 潜在顾虑：${body.customer.concerns}` : '',
      body.customer.relationship ? `🤝 与我的关系：${body.customer.relationship}` : '',
    ].filter(Boolean).join('\n');

    const selfInfo = [
      body.self.role ? `📋 我的角色：${body.self.role}` : '',
      body.self.resources ? `🛠️ 可用资源：${body.self.resources}` : '',
      body.self.goals ? `🏆 本次目标：${body.self.goals}` : '',
      body.self.strengths ? `💪 自身优势：${body.self.strengths}` : '',
      body.self.weaknesses ? `📉 自身短板：${body.self.weaknesses}` : '',
    ].filter(Boolean).join('\n');

    const prompt = [
      '你是一位资深的销售对练推演教练。请基于以下信息进行一次完整的沙盘推演，',
      '模拟客户在不同阶段可能的反应、异议走向，以及学员应该采取的关键策略。',
      '',
      '═══════════════════════════════════════',
      '【场景信息】',
      scenarioInfo,
      '',
      '【陪练员信息】',
      personaInfo,
      '',
      '【产品知识库】',
      productInfo,
      '',
      '═══════════════════════════════════════',
      '【环境因素】',
      envInfo || '（未填写）',
      '',
      '【客户信息】',
      customerInfo || '（未填写）',
      '',
      '【自身信息】',
      selfInfo || '（未填写）',
      '',
      '═══════════════════════════════════════',
      '',
      '请输出 JSON 格式的推演结果，结构如下：',
      '{',
      '  "summary": "整体推演概述（2-3句话）",',
      '  "phases": [',
      '    {',
      '      "name": "阶段名称（如：破冰开场）",',
      '      "customerReaction": "客户在此阶段可能的反应与情绪",',
      '      "keyObjection": "客户可能提出的核心异议",',
      '      "suggestedStrategy": "建议的应对策略",',
      '      "riskPoints": ["风险点1", "风险点2"],',
      '      "successMetrics": "该阶段成功的标志"',
      '    }',
      '  ],',
      '  "predictedObjections": [',
      '    { "objection": "异议内容", "frequency": "高频/中频/低频", "suggestedResponse": "建议回应" }',
      '  ],',
      '  "criticalMoments": [',
      '    { "moment": "关键时刻描述", "whatToDo": "应该做什么", "whatToAvoid": "应该避免什么" }',
      '  ],',
      '  "winProbability": "预估成功率（低/中/高）",',
      '  "keyAdvice": ["核心建议1", "核心建议2", "核心建议3"],',
      '  "redLineWarnings": ["红线警示1", "红线警示2"]',
      '}',
      '',
      '请生成 3-5 个推演阶段（phases），2-5 个预测异议（predictedObjections），2-4 个关键时刻（criticalMoments）。',
      '内容要具体、可操作，结合产品知识库中的红线和要点。',
    ].join('\n');

    try {
      const result = await gateway.forTask('actor').chat(
        [{ role: 'user', content: prompt }],
        { jsonMode: true, temperature: 0.7, maxTokens: 4000 }
      );

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(result.content);
      } catch {
        // LLM 输出可能不是纯 JSON，尝试提取
        const jsonMatch = result.content.match(/\{[\s\S]*\}/);
        parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { summary: result.content };
      }

      return {
        scenarioId: body.scenarioId,
        scenarioName: scenario.name,
        personaName: persona?.name ?? '陪练员',
        result: parsed,
        model: result.model,
        generatedAt: new Date().toISOString(),
      };
    } catch (err) {
      app.log.error({ err }, '沙盘推演失败');
      return reply.code(500).send({ error: '推演失败，请稍后重试' });
    }
  });
}
