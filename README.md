# Grasp MVP

AI 销售陪练与认证系统 MVP。轻量级前后端工程，技术栈与 `Grasp/Grasp` 保持一致。
产品设计依据 `docs/frontend-design.md`，当前已完成 **Phase 1–3**：

- 学员端（grasp-web）：任务流 / 对练页 / 复盘页 / 成长档案 / 考核中心（文字对练，语音入口预留）
- 管理端（admin-web）：申诉复核、场景配置、主管视图、高管视图、数据中心（汇报包导出）、
  考核管理、内容工坊（流水线/评分规则/回归测试/观察项）、多租户切换、企业微信 SSO 占位
- 后端：角色引擎（情绪动力学 + 行为档位）、评分引擎（确定性规则层 + LLM 双 judge）、
  会话/任务/复盘/申诉/成长/考核认证/看板聚合/内容工坊 API；无 LLM Key 时走确定性 Mock，
  离线可完整跑通；启动自动播种子数据与演示考核历史。

## 结构

```
Grasp/mvp
├── package.json              # monorepo 根配置
├── pnpm-workspace.yaml       # pnpm workspace
├── turbo.json                # turbo 任务编排
├── tsconfig.base.json        # 共享 TypeScript 配置
├── packages
│   ├── core                  # 核心类型 / 事件总线 / LLM 接口 (@grasp-mvp/core)
│   ├── infra                 # Prisma（SQLite）/ MemoryStore 仓储 + 种子数据 (@grasp-mvp/infra)
│   ├── llm-gateway           # LLM 多模型路由 + Mock Provider (@grasp-mvp/llm-gateway)
│   ├── role-engine           # 角色编译 / 情绪追踪 / 对话演员 (@grasp-mvp/role-engine)
│   ├── scoring-engine        # 规则层 + LLM 双 judge 评分 (@grasp-mvp/scoring-engine)
│   └── api-gateway           # Fastify API 网关 (@grasp-mvp/api-gateway)
└── client
    ├── grasp-web             # 学员端：React 19 + Vite + Tailwind（移动优先）
    └── admin-web             # 管理端：React 18 + Vite + Tailwind
```

## 前置条件

- Node.js >= 20
- pnpm 9
- SQLite（内置默认，无需安装；不配置 `DATABASE_URL` 时降级 MemoryStore，数据不持久化）

## 安装

```bash
cd Grasp/mvp
pnpm install
```

## 数据库与 LLM 配置（均可选）

- **数据库**：默认 SQLite 持久化，库文件 `packages/infra/prisma/dev.db`
  （`packages/api-gateway/.env` 中 `DATABASE_URL="file:./dev.db"`，相对路径基于
  `packages/infra/prisma/` 解析）。schema 变更后执行 `pnpm db:generate && pnpm db:migrate`。
  注释掉 `DATABASE_URL` 则降级 MemoryStore（重启丢数据）；删除 `dev.db` 重启即可重置全部数据。
  注：Prisma 不支持 SQLite 的 Json 列，`data`/`payload` 为 JSON 文本列（PrismaStore 内
  序列化）；如需改回 PostgreSQL，将 schema provider 改回 `postgresql`、`String` 载荷列改回
  `Json`、重建迁移并还原 PrismaStore 的 toJson/fromRow 即可。
- **LLM**：在 `packages/api-gateway/.env` 配置 `LLM_PROVIDER`（可选 `deepseek` / `kimi` /
  `qwen` / `openai` / `zhipu` / `baichuan` / `agnes` / `custom`）+ 对应的
  `<PROVIDER>_API_KEY` / `<PROVIDER>_BASE_URL` / `<PROVIDER>_CHAT_MODEL`
  （如 `DEEPSEEK_API_KEY`；baseUrl/model 缺省用各 Provider 预设）。也兼容传统
  `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` 写法；按任务覆盖用 `LLM_MODEL_ACTOR` /
  `LLM_MODEL_JUDGE` / `LLM_SECONDARY_API_KEY` 等（见 `packages/llm-gateway/src/gateway.ts`）。
  不配置时全部任务路由到确定性 MockLLMProvider，离线可跑通完整闭环。
- 启动时若无场景数据，api-gateway 自动播入种子数据（demo 租户、学员"小李"、
  角色"王经理"、3 个技能点、2 个场景、5 个评分项）。
  种子含 **8 个 AI 陪练员**（教育培训机构家长角色，覆盖焦虑型 / 升学型 / 理性型 / 体验型 / 犹豫拖延型等类型），
  启动时自动增量同步——已有旧数据时只补充缺失的陪练员，不会覆盖已有数据。

## 云端部署

### 种子数据（8 个陪练员）在云端生效

种子数据采用 **自动增量同步** 机制，无需手动操作即可在云端生效：

1. **首次部署**（空数据库）：API 启动时自动灌入全部种子数据（58 个陪练员 + 场景 + 技能点 + 考核窗口）。
2. **已有旧数据的数据库**：API 启动时检测到已有场景，自动增量同步——按 persona id 比对，只补充缺失的陪练员，不覆盖已有数据。
3. **手动强制灌种**：在云端服务器执行 `pnpm --filter @grasp-mvp/api-gateway seed`（幂等：已有的跳过，缺失的补充）。

```bash
# 云端部署步骤
cd /app && pnpm install && pnpm build

# 方式一：直接启动（自动灌种 + 增量同步）
pm2 startOrRestart packages/api-gateway/ecosystem.config.cjs

# 方式二：先手动灌种再启动（适合初始化大量数据时）
pnpm --filter @grasp-mvp/api-gateway seed
pm2 startOrRestart packages/api-gateway/ecosystem.config.cjs

# 前端部署
pm2 startOrRestart client/landing/ecosystem.config.cjs       # 落地页
pm2 startOrRestart client/admin-web/ecosystem.config.cjs     # 管理端
pm2 startOrRestart client/grasp-web/ecosystem.config.cjs      # 学员端
```

> 注意：DATABASE_URL 使用 PostgreSQL 时，种子数据写入持久化数据库，重启不会丢失。
> 不设 DATABASE_URL 时使用内存存储，重启即丢失（仅适合开发）。

## 开发

### 一键启动所有服务

```bash
pnpm dev:all
```

访问：
- API Gateway: http://localhost:3060
- Swagger Docs: http://localhost:3060/docs
- grasp-web（学员端）: http://localhost:5173
- admin-web（管理端）: http://localhost:5174

### 单独启动

```bash
# 仅后端 API
pnpm dev:api

# grasp-web + API
pnpm dev:web

# admin-web + API
pnpm dev:admin
```

## 构建与测试

```bash
pnpm build
pnpm test
```

## API 概览（/api/v1）

身份：请求头 `x-user-id`（缺省种子学员 `user-trainee-1`；管理端用 `user-admin-1`）；
租户：`x-tenant-id`（缺省 `tenant-demo`）。

| 路由 | 说明 |
|---|---|
| `GET /tasks` | 学员任务列表（含需重练 / D7 复训标签）+ 技能地图 |
| `POST /sessions` | 创建对练会话（practice/exam；exam 校验窗口/名单/冷却期） |
| `GET /sessions/:id` | 会话详情 + 剩余时间 |
| `POST /sessions/:id/turns` | 学员发言 → 情绪更新 → 角色回复 |
| `POST /sessions/:id/hint` | 求提示（仅 practice，限 3 次） |
| `POST /sessions/:id/end` | 结束 → 评分 → 任务/技能状态；exam 追加 CertRecord |
| `GET /sessions/:id/review` | 复盘聚合（会话+评分报告+场景+角色+上次得分） |
| `POST /appeals` / `GET /appeals` / `GET /appeals/:id` / `POST /appeals/:id/resolve` | 申诉提交 / 队列 / 详情 / 裁定（写校准事件） |
| `GET /scenarios` / `POST /scenarios` / `GET /persona-configs` / `GET /skill-points` | 目录与极简场景配置 |
| `POST /persona-configs/:id/trial-chat` | 角色试玩：不落库的单轮试聊（编译运行时包 + actor 回复） |
| `GET /growth` | 成长档案（技能状态 + 历史成绩 + 口头禅趋势） |
| `GET /exam-windows` / `POST /exam-windows` / `POST /exam-windows/:id/status` / `GET /exam-windows/:id/monitor` / `GET /exam-windows/:id/export` | 考核窗口：学员视图（状态/冷却/证书）/ 建窗 / 状态流转 / 进度监控 / 成绩 CSV 导出 |
| `GET /supervisor/overview` / `GET /supervisor/members/:userId` | 主管：团队热力图（仅考核数据）/ 成员详情（无对话原文） |
| `GET /executive/summary` / `GET /executive/org-teams?orgId=` | 高管：组织热力图 / 达标趋势 / 合规 / POC 对照；组织下钻到团队热力图 |
| `GET /admin/analytics` / `GET /admin/report-export` | 数据中心聚合（含考核完成漏斗）/ 自包含 HTML 汇报页（可打印） |
| `GET/POST /workshop/extraction-projects` / `POST .../advance` | 内容工坊：要素提取流水线（collecting→done） |
| `GET/POST /library/score-items` / `GET/POST /library/golden-cases` | 评分标准库（第5步评分依据）/ 评分回归案例库 |
| `GET /workshop/product-kb` / `PUT /workshop/product-kb` / `POST /workshop/product-kb/entries` | 产品知识库：读取 / 整体替换（版本自增）/ 条目批量导入（按 id 覆盖或追加） |
| `POST /users/import` | 用户批量导入（admin）：orgName/teamName 按名解析、不存在自动创建；username 冲突更新，逐行容错 |
| `POST /workshop/regression-runs/run` / `GET /workshop/regression-runs` / `GET /workshop/observations` | 回归跑分（0.8 发布闸门）/ 历史 / 观察项聚合 |
| `GET /tenants` / `GET /auth/providers` / `GET /auth/wecom` | 租户列表 / SSO 提供方 / 企业微信 SSO 占位（501） |
| `POST /events` | 前端埋点上报（ui.page_view / ui.page_stay / ui.action，其余类型 400） |

## 企业数据接入

除页面手工配置外，两类初始化数据可经 API 批量接入（均需 admin 角色的 Bearer token）：

```bash
# 产品知识库：整体创建/替换（entries[].kind ∈ keypoint/redline/competitor/faq）
curl -X PUT http://localhost:3060/api/v1/workshop/product-kb \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"数学思维课程话术手册","entries":[{"kind":"faq","title":"能优惠吗","content":"先确认课时包与赠课方案…","frequency":31}]}'

# 条目批量导入：带 id 覆盖同 id 条目，无 id 追加；版本自动 +1
curl -X POST http://localhost:3060/api/v1/workshop/product-kb/entries \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"entries":[{"kind":"redline","title":"禁止保过承诺","content":"不得使用保证提分、包过等表述"}]}'

# 用户批量导入（HR 花名册）：orgName/teamName 按名解析、缺失自动创建；
# username 已存在则更新（不显式给 password 不动原密码）；缺省初始密码 123456；单次上限 500
curl -X POST http://localhost:3060/api/v1/users/import \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"users":[{"username":"zhangsan","name":"张三","role":"trainee","orgName":"华东一区","teamName":"直营二组"}]}'
```

角色/场景/评分标准/评分回归案例等其余主数据经对应 POST 端点逐条接入（见 API 概览）；资源库各库与新手指引五步执行环节的对应关系见 `packages/core/src/types/guidance.ts` 文件头注释；
录音萃取流水线暂只接受外部转写后的文本引用（`recordingRefs`），录音上传与 ASR 转写未实现。

## 约定

- 后端使用 Fastify + TypeScript + `NodeNext` module resolution（相对 import 带 `.js` 后缀）。
- 前端使用 React + Vite + TypeScript + Tailwind CSS 4；admin-web 图表用 ECharts。
- workspace 包名前缀统一为 `@grasp-mvp/*`。
- 语音输入（ASR）与角色语音（TTS）均已用浏览器语音能力实现：Web Speech API 识别学员语音，
  SpeechSynthesis 播报角色回复（情绪唤醒度 → 语速/音调，舞台提示如"（皱眉）"不播报），
  Chrome/Edge 可用，微信 WebView 降级为禁用/隐藏。服务端 ASR/TTS 已实现：
  一期 `POST /api/v1/sessions/:id/voice-turn`（HTTP 批量，multipart 或 audio/* raw body），
  二期 `GET /api/v1/sessions/:id/voice?token=…`（WebSocket 流式，PCM16 二进制帧进、
  asr_partial/asr_final/reply_text/tts_sentence/turn_complete 等事件出，支持 interrupt 打断）；
  `SPEECH_PROVIDER=mock`（默认）离线可跑通，`=aliyun` 走阿里百炼 DashScope（paraformer + CosyVoice，
  配 `SPEECH_API_KEY`/`DASHSCOPE_API_KEY`，未联调）。
  仍未做：企业微信 SSO 真实接入（SSO 仅有入口与配置占位端点）。
