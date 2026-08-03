# Chatus

一个部署在 Cloudflare Workers 上、面向受信任成员的工作 Agent，可选开放受限访客入口。编程与项目协作是首个内置能力包，产品本身仍保持通用；它只暴露网页体验，不提供公开的 OpenAI-compatible API 分发入口。

## 架构

```text
Browser
  -> Cloudflare Worker gateway + typed React assets
  -> per-member TeamAgent Durable Objects
     -> root Agent (conversation index, memory and cleanup state)
     -> conversation Agent (messages, resumable streams and approvals)
  -> KV (shared configuration, access data and encrypted secret records)
  -> capability registry (assigned Skills, tools and reviewed MCP servers)
  -> provider router (logical models -> ordered offerings -> provider capacity + fallback)
```

## 支持能力

- 模型池：用户选择逻辑模型；一个逻辑模型可按优先级关联多个 provider，一个 provider 的 endpoint 和凭据可复用于多个上游模型。
- 多朋友：按访问码 label 匹配用户，每个用户可设置允许线路、默认线路、限额和 BYOK。
- 能力分配：管理员可按成员分配 Skills 与工具；每次会话投影和执行都会重新校验，撤销后旧会话也不能继续调用。
- 用户身份：可为稳定 label 配置独立显示名称；修改昵称不会影响访问码、权限或历史会话归属。
- 用户状态：可暂停或恢复某个朋友；暂停后拒绝新登录并使现有会话在下一次请求时失效，但保留其数据和配置。
- 多协议：`openai-chat` 适合 OpenAI-compatible 中转；`anthropic-messages` 适合 Claude/Claude Code 一类 Anthropic Messages 接口。
- 多模态：前端支持图片上传；后端会按线路协议转换图片格式。
- 私有访问：访问码登录、HttpOnly session、强一致用户限额，不暴露 `/v1/chat/completions` 分发接口。
- 公开访客：可选择一条逻辑模型给未登录用户试用；访客没有 BYOK、Skills、工具、MCP、长期记忆、反馈、导出或成员文件上传能力。
- 登录保护：按 IP 对失败访问码尝试做 Durable Object 强一致限流，成功登录后自动清空失败计数。
- 管理保护：管理员 Token 使用独立的 IP 限流窗口，避免与普通用户访问码计数相互影响。
- 会话安全：朋友可从设置主动退出所有设备，撤销同一用户的全部登录 Cookie，但保留聊天和记忆数据。
- 缓存安全：所有 JSON API、认证响应和敏感后台数据统一使用 `Cache-Control: no-store`，静态资源仍保留正常缓存。
- 发布健康：`/healthz` 以不泄露配置的方式检查 KV、Durable Object 和基础配置，并作为 GitHub Actions 生产发布门禁。
- 请求追踪：所有响应带 `X-Request-ID`；未捕获异常返回统一 JSON 编号并写入不含敏感正文的结构化日志。
- 故障定位：网页错误会显示 8 位请求编号，可用完整 `X-Request-ID` 在 Cloudflare Observability 中检索。
- 用户诊断：设置中可复制版本、线路、网络和 PWA 状态，不包含密钥、对话正文或长期记忆。
- 多会话：云端同步 + 本地缓存，每个朋友最多 30 个会话；满额时不会静默淘汰历史记录，误删可在短时间内撤销，上下文按字符预算裁剪，并带会话摘要。
- 版本化备份：完整 JSON 导出包含格式版本、会话模型、分支来源和摘要进度；旧版备份保持兼容，导入前展示来源用户与时间，较新的未知格式会安全拒绝。
- 安全恢复：手动导入使用独立恢复语义并生成新版本时间；账户清除后仍可恢复明确选择的备份，但普通旧设备同步不能带回删除前的数据。
- 分支导航：编辑、重发、重新生成和手动分支会记录来源会话，可从会话头部一键返回原会话并跨设备同步。
- 多设备保护：旧设备不会覆盖较新的云端会话；发生冲突时自动保留云端版本并创建“此设备副本”。
- 条件删除：旧设备删除会话时不会移除其他设备刚更新的版本，冲突时自动恢复较新的云端会话。
- 删除防复活：单会话删除使用服务端墓碑；永久删除会注销全部设备并设置账户级删除时间线，延迟请求和旧设备缓存不能重新上传旧数据。
- 非破坏式清空：会话头部的清空操作会开始一个空白会话，原会话及云端历史完整保留。
- 本地草稿：未发送文本按用户和会话隔离保存，刷新或切换会话后自动恢复，退出时清理。
- 记忆草稿：长期记忆的未保存编辑按用户隔离保存在本机，刷新后自动恢复，保存或退出时清理。
- 长期记忆：每个成员的根 Agent 保存权威记忆，支持用户检查、编辑和删除；旧 KV 记录只作为幂等导入与回滚证据保留。
- 聊天体验：Markdown、代码块复制和表格渲染；历史消息编辑、重发、重新生成和截断续写都会创建独立分支，并支持会话搜索导出和移动端抽屉侧栏。
- 安装与更新：支持 PWA 安装；检测到新版本后由用户确认刷新，不会在回答生成中途强制接管。
- 回答反馈：朋友可标记“有帮助 / 需改进”，后台查看近期好评率；只记录线路与消息标识，不保存反馈对应的对话正文。
- 管理后台：`/react-chat/admin` 是唯一日常入口，管理成员访问、Provider、逻辑模型、Skill/MCP、公开访客、可靠性与运营视图；`/admin.html` 仅保留到新版入口的永久回滚重定向。线路状态来自配置就绪度与真实任务的脱敏遥测，不发送主动测活提示。
- 后台编辑保护：用户、线路、访问码和长期记忆存在未保存修改时，切换对象、刷新、退出或关闭页面前会提醒确认。
- 配置并发保护：后台保存或恢复 Secret 配置时校验版本指纹，避免旧标签页或另一台设备覆盖较新的线路与用户配置。
- 凭据并发保护：访问码保存、轮换、撤销和恢复 Secret 时校验版本指纹，旧后台不能恢复已经失效的访问码。
- 记忆并发保护：用户设置页与管理后台保存长期记忆时校验用户级版本指纹，避免多设备无声覆盖。

## 本地配置

复制 `.env.example` 为 `.dev.vars`，填入不会提交到仓库的密钥：

```bash
ACCESS_CODES="friend:change-this-long-random-code"
ADMIN_TOKEN="change-this-long-admin-token"
ROUTES_CONFIG="{...}"
PRIMARY_OPENAI_KEY="sk-..."
BACKUP_OPENAI_KEY="sk-..."
ANTHROPIC_KEY="sk-ant-..."
SYSTEM_PROMPT="You are a helpful assistant."
```

本地兼容模式下，`ACCESS_CODES` 支持多个访问码，用英文逗号分隔：

```bash
ACCESS_CODES="friend:code-one,alice:code-two"
```

登录后的用户 label 就是 `friend`、`alice`，会用于匹配 `ROUTES_CONFIG.users`。生产部署不读取 GitHub `ACCESS_CODES`；成员访问码由管理员在 `/react-chat/admin` 中生成并托管到 KV。

## ROUTES_CONFIG

生产 provider-pool 模式需要把 `ROUTES_CONFIG` 放进 GitHub Secret；GitHub Actions 会在部署时上传为 Worker Secret。直接在 Cloudflare Dashboard 设置同名 Worker Secret 可作为运行时兼容来源，但不能通过 Actions preflight，所以不适合作为干净 fork 的唯一配置入口。本地开发可以把同一 JSON 放进 `.dev.vars`。

```json
{
  "providers": {
    "primary-openai": {
      "label": "Primary OpenAI-compatible",
      "type": "openai-chat",
      "baseUrl": "https://provider-a.example/v1",
      "apiKeyRef": "PRIMARY_OPENAI_KEY",
      "concurrency": "exclusive",
      "queueTimeoutMs": 10000,
      "priority": 100,
      "supportsImages": true,
      "supportsTools": true
    },
    "backup-openai": {
      "label": "Backup OpenAI-compatible",
      "type": "openai-chat",
      "baseUrl": "https://provider-b.example/v1",
      "apiKeyRef": "BACKUP_OPENAI_KEY",
      "concurrency": "bounded",
      "maxConcurrent": 4,
      "queueTimeoutMs": 8000,
      "priority": 60,
      "supportsImages": true
    },
    "anthropic-team": {
      "label": "Anthropic team",
      "type": "anthropic-messages",
      "baseUrl": "https://api.anthropic.com",
      "apiKeyRef": "ANTHROPIC_KEY",
      "headers": {
        "anthropic-version": "2023-06-01"
      },
      "concurrency": "unlimited",
      "priority": 80,
      "supportsImages": true,
      "supportsTools": true
    }
  },
  "defaults": {
    "defaultRoute": "general-chat",
    "allowedRoutes": ["general-chat", "reasoning-mini", "claude-code"],
    "allowBringYourOwnKey": false,
    "blockedPrompts": ["你好", "hi", "hello", "测试", "test", "在吗", "嗨", "哈喽", "hey", "ping"]
  },
  "publicAccess": {
    "enabled": false,
    "routeId": "general-chat",
    "sessionTtlSeconds": 86400,
    "dailyMessageLimit": 20,
    "minuteMessageLimit": 6,
    "sourceDailyMessageLimit": 200,
    "sourceMinuteMessageLimit": 30
  },
  "users": {
    "friend": {
      "defaultRoute": "general-chat",
      "allowedRoutes": ["general-chat", "reasoning-mini", "claude-code"],
      "allowBringYourOwnKey": true,
      "dailyMessageLimit": 500,
      "minuteMessageLimit": 12,
      "systemPrompt": "你是这位朋友的私人助手，回答简洁友好。"
    }
  },
  "routes": {
    "general-chat": {
      "label": "General chat",
      "offerings": [
        { "providerId": "primary-openai", "model": "grok-4.20-multi-agent-xhigh", "enabled": true },
        { "providerId": "backup-openai", "model": "grok-4.20-multi-agent-xhigh", "priority": 55, "enabled": true }
      ],
      "fallbacks": ["claude-code"],
      "supportsImages": true,
      "supportsTools": true
    },
    "reasoning-mini": {
      "label": "Reasoning mini",
      "offerings": [
        { "providerId": "primary-openai", "model": "reasoning-mini", "enabled": true },
        { "providerId": "backup-openai", "model": "reasoning-mini", "enabled": true }
      ],
      "supportsImages": true
    },
    "claude-code": {
      "label": "Claude Code",
      "offerings": [
        { "providerId": "anthropic-team", "model": "claude-sonnet-4-5", "enabled": true }
      ],
      "supportsImages": true
    }
  }
}
```

字段说明：

- `providers.<id>` 是物理服务商实例。ID 必须以字母或数字开头，最多 80 个字符，只能包含字母、数字、点、下划线和短横线。`type` 支持 `openai-chat` 和 `anthropic-messages`；`baseUrl`、`headers`、`apiKeyRef`、BYOK 策略和 endpoint 只在这里配置一次。
- `routes.<id>` 是用户选择的逻辑模型和权限 ID。`fallbacks` 引用其他逻辑模型，不是同一 provider 的备用副本。
- `offerings` 只连接 `providerId` 与上游 `model`，可覆盖 `priority`、`supportsImages`、`supportsTools`；不要在 offering 中复制 endpoint 或密钥。
- `publicAccess` 控制未登录访客入口，默认关闭。启用后只能暴露一条逻辑模型，并分别限制单访客和同来源的每日/每分钟额度。访客线路必须使用后台 KV 托管的 provider key；仅存在同名 Worker Secret 或 `WORKER_SECRETS_JSON` 不会让访客线路可用。
- `priority` 数值越大越优先；同优先级才按该逻辑模型/provider 对的真实任务成功率和延迟排序。系统不发送主动测活请求。
- `concurrency: "exclusive"` 让 provider 在所有模型、所有成员之间只允许一个活动请求；`"bounded"` 使用 `maxConcurrent`；`"unlimited"` 不获取并发租约。
- provider 忙时会先跳过并尝试其他 offering；全部候选都忙才统一等待，`queueTimeoutMs` 只能是 `0..10000` 毫秒，超时返回稳定的忙碌错误，不打断已有请求。
- fallback 只发生在首次可见输出之前。HTTP `200` 中的错误事件、畸形 SSE、空流或只有 `[DONE]` 的响应仍会被判为失败并尝试下一个候选；一旦已有文本、推理、工具或审批输出，后续断流会直接报错，不会把另一个 provider 的内容拼到同一回答中。用户取消也不会触发 fallback。
- `requiresUserKey`、`allowUserKey`、`enabled`、`directEndpoint`、`blockedPrompts` 的语义保持不变；新配置的密钥只写 `apiKeyRef`，明文 key 不进入配置。
- 旧式 route 中的 `type`、`baseUrl`、`model`、`apiKeyRef` 仍可读取，并会投影为 `legacy:<routeId>` 的单一 `unlimited` provider offering。旧明文 key 只在服务端兼容保留，管理 API 永不回显；显式迁移前，原 `apiKeyRef` 必须已有后台托管密钥或同名 Worker Secret。迁移只保存引用并删除旧内嵌 key，不会复制明文。

## GitHub Actions Secrets

首次部署还需要配置四项非敏感 Repository Variables：

```text
CHATUS_WORKER_NAME       稳定的 Worker 名称，例如 chatus-team
CHATUS_KV_NAMESPACE_ID  新建 KV namespace 后得到的 32 位 ID
CHATUS_R2_BUCKET_NAME   实例专属 R2 bucket 的稳定名称；Actions 缺失时创建，例如 chatus-team-workspace-files
CHATUS_PRODUCTION_URL   完整 HTTPS origin，不带路径，例如 https://chat.example.com
```

`CHATUS_PRODUCTION_URL` 以 `.workers.dev` 结尾时，部署脚本会启用 Workers.dev；其他域名会生成 Cloudflare Custom Domain 配置。四项值在首次生产部署后都应保持稳定，尤其不要用“改 Worker 名或 R2 bucket”的方式改品牌，否则会形成新的 Worker/持久化边界。

仓库 Secrets 需要设置：

```text
CLOUDFLARE_API_TOKEN   Cloudflare API Token，用于 GitHub Actions 部署
CLOUDFLARE_ACCOUNT_ID  当前 Cloudflare 账号 ID
ADMIN_TOKEN            管理后台登录 token，用于 /react-chat/admin
ROUTES_CONFIG          provider、逻辑模型与成员权限配置；provider-pool 模式必需，只有旧单线路 fallback 可由 UPSTREAM_API_KEY 替代
ROUTE_KEYS_MASTER_KEY  可选但推荐，后台加密管理 provider key 的一次性主密钥
WORKER_SECRETS_JSON    可选，JSON 对象，用于上传动态 provider key
SYSTEM_PROMPT          可选，默认系统提示词
BLOCKED_PROMPTS        可选，全局屏蔽的短提示词列表
UPSTREAM_API_KEY       可选，旧单线路 fallback
```

从零创建 Cloudflare 资源、设置最小变量/密钥并完成首次 Actions 发布的完整流程见 [`docs/self-hosting.md`](docs/self-hosting.md)。仓库不保存维护者的 Account ID、KV ID 或生产域名。

首次发布不需要在 GitHub 保存成员访问码。部署成功后使用 `ADMIN_TOKEN` 登录 `/react-chat/admin`，创建 `team-member` 之类的成员 label；随机访问码只在创建/轮换成功时显示一次。成员 label 必须与后台成员权限或 `ROUTES_CONFIG.users` 中的 label 一致。忘记旧码时直接在后台轮换，旧码和该成员已有会话会同时失效。

若要在管理后台直接新增和轮换 provider key，先生成 32 个随机字节的 Base64 值：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

把输出仅保存为 GitHub Secret `ROUTE_KEYS_MASTER_KEY`，再通过 `Deploy to Cloudflare` 工作流发布一次。之后可以在 `/react-chat/admin` 的 Provider 编辑器中填写 `API Key Ref`，输入新密钥并点击“保存密钥”；密钥会使用 AES-GCM 加密后写入 KV，页面和 API 都不会读回明文。

已有 Worker Secret 仍然兼容。也可以把这些动态 key 集中放进 GitHub Secret `WORKER_SECRETS_JSON`，让 Actions 部署时一起上传：

```json
{
  "PRIMARY_OPENAI_KEY": "sk-...",
  "BACKUP_OPENAI_KEY": "sk-...",
  "ANTHROPIC_KEY": "sk-ant-..."
}
```

托管密钥优先于同名 Worker Secret；只有显式删除托管密钥后才会恢复使用同名 Worker Secret，损坏或无法解密的托管记录不会静默回退。生产发布只通过 GitHub Actions，不要从本机 Wrangler 账号部署。更换 `ROUTE_KEYS_MASTER_KEY` 后，原有托管密钥无法解密，需要在后台逐条重新录入。

公开访客访问默认关闭。启用前先确认目标逻辑模型可供成员正常使用，并在 `/react-chat/admin` 的公开访问设置中选择唯一访客线路和额度。访客线路必须引用后台托管 provider key；若只依赖 Worker Secret，成员可能可用，但访客会被视为没有可用服务端密钥。关闭公开访问开关就是访客功能回滚，不影响成员登录和成员线路。

`BLOCKED_PROMPTS` 可以填逗号分隔：

```text
你好,hi,hello,测试,test,在吗,嗨,哈喽,hey,ping
```

也可以填 JSON 数组：

```json
["你好", "hi", "hello", "测试", "test", "在吗", "嗨", "哈喽", "hey", "ping"]
```

命中后网页会提示：`不要用这种方式测活，必须使用一个小任务之类的`。

## 管理后台

访问：

```text
https://你的 Worker 域名/react-chat/admin
```

后台使用单独的 `ADMIN_TOKEN` 登录。登录 `/react-chat/admin` 后可以：

- 查看今天每个朋友的用量、剩余额度、活跃 session、长期记忆长度。
- 创建、轮换和撤销成员访问码；访问码由服务端生成、仅显示一次并存入 KV，不需要 GitHub `ACCESS_CODES`。
- 用表单快速配置某个朋友可用的线路、默认模型、每日额度、每分钟额度、是否允许 BYOK。
- 在服务商池中一次配置 provider 的协议、`baseUrl`、`apiKeyRef`、并发模式和默认优先级，并把多个上游模型映射成用户可选的逻辑模型。
- 拉取 provider 的完整模型列表，批量创建逻辑模型或合并 offering；批量操作不复制 endpoint/key，也不自动扩大成员的 `allowedRoutes`。
- 在不重新部署的情况下新增、替换或删除后台加密 provider key；后台只显示配置状态，不回显密钥。
- 查看仍以内联 route 表示的旧线路安全状态，并在服务端预检通过后批量迁移为 Provider + Offering；仅有旧明文 key 的线路会明确阻断，要求先保存对应 Key Ref。
- 旧后台的完整 JSON 编辑、整库 reset 与 CSV 报告已退役；配置变更通过受 revision 保护的新版表单完成，运营视图提供脱敏聚合数据。

后台保存的配置写入 Cloudflare KV，优先级高于 `ROUTES_CONFIG` Secret；如果删除后台覆盖配置，Worker 会重新读取 Secret。provider 密钥解析优先级为：用户 BYOK（允许时）→ 旧式 route/provider `apiKey` → 后台加密密钥 → 同名 Worker Secret。`requiresUserKey` 会阻止使用所有服务端密钥。成员访问码是独立的 KV 托管状态，删除或撤销后不会回退到 GitHub/Worker `ACCESS_CODES`；后台托管 provider key 删除后若存在同名 Worker Secret，才会按兼容规则恢复。

## 公开访客访问

公开访客是受限匿名会话，不是开放 API。未登录用户只能获得一条管理员指定的逻辑模型，不能使用 BYOK、Skills、工具、MCP、长期记忆、反馈、导出、成员专属文件上传或自定义 System Prompt。访客会话和来源都有独立额度，并且同一访客 label 同时只能有一个生成中的请求。

生产启用流程：

1. 在 provider pool 中配置一条稳定逻辑模型，并为它的 provider 写入后台托管密钥。
2. 在 `/react-chat/admin` 启用公开访问，选择该逻辑模型并设置 TTL、单访客额度和同来源额度。
3. 用新的隐私窗口访问生产 origin，确认只显示固定访客模型和成员登录入口。
4. 禁用公开访问后再次验证访客入口关闭；不要用 Cron、doctor 或隐藏 completion 作为验收方式。

## 会话与记忆

当前实现借鉴了常见聊天项目的分层方式，但保持轻量：

- 会话历史：按成员存入对话 Agent 的 SQLite + 浏览器 localStorage 缓存；根 Agent 维护索引，换设备可恢复，最多 30 个会话。旧版 KV/UserState 会话会幂等导入且暂不删除源记录。
- 短期上下文：前后端按字符预算裁剪（默认约 14000 字符 / 最近 40 条），并优先保留最近对话；历史图片只保留最近 2 轮用户消息。
- 会话摘要：聊天达到一定长度后自动调用当前线路生成滚动摘要，并在后续请求里作为 system 信息注入；自动摘要不扣用户消息额度，同一会话不会并发生成重复摘要。
- 长期记忆：根 Agent SQLite 是权威来源，默认最多 4000 字符；支持手写编辑与「建议写入」确认后追加，旧 KV 仅用于首次导入和回滚核验。
- System 注入：`SYSTEM_PROMPT` + 长期记忆 + 会话摘要，会放到请求最前面。

聊天 UI 支持 Markdown/代码块复制、消息编辑/重发/重新生成、会话搜索与导出、粘贴/拖拽图片，以及移动端侧栏抽屉。

暂时没有引入向量库。只有一个朋友或少量朋友使用时，可编辑记忆 + 会话摘要比黑盒向量检索更稳，也更容易知道模型到底记住了什么。

## 管理后台增强

- 可观测性：近 7 日请求量、错误率、fallback、限流，以及按线路/用户拆分。
- 今日用量面板可一键重置某用户今日额度。
- 可按用户读取/编辑/清空长期记忆。
- 用户可配置专属 System Prompt（叠加在全局 `SYSTEM_PROMPT` 之后，最多 2000 字）。
- 访问码支持按 label 生成随机长码并追加到列表。
- 新朋友可从用户表单一次完成权限配置与访问码生成，避免用户配置和访问控制不同步。
- 线路状态刷新只读取配置就绪度和真实任务的脱敏遥测，不发送 completion 或隐藏探测提示。
- 生产配置不注册线路测活 Cron，也不会在后台自动向模型发送探测请求。
- 服务商支持从上游安全拉取完整模型列表；浏览器只发送 `providerId`，密钥由服务端解析，批量选择后生成或合并逻辑模型 offering。
- 运营视图提供每日趋势、线路成功率和用户额度概况的脱敏分页数据；不导出访问码、API Key、Base URL、Prompt、记忆或对话正文。

## 会话同步 API

- `GET /api/chats`：拉取当前用户云端会话
- `PUT /api/chats`：保存/更新单个会话
- `DELETE /api/chats?id=`：删除会话
- `POST /api/chats/migrate`：本地会话迁移；`merge` 用于后台自动合并，`restore` 仅用于用户明确导入备份，`replace` 用于完整替换恢复

## 自动部署

推送到 `main` 分支会自动执行 `.github/workflows/deploy.yml`：

```text
install -> typecheck/frontend/test -> instance + secret preflight
        -> generated Wrangler dry-run -> GitHub Actions deploy -> exact-SHA smoke
```

工作流从 Repository Variables 生成忽略提交的 `.wrangler.deploy.jsonc`，从 GitHub Secrets 生成权限受限的 `.prod.secrets.json`。缺少实例参数、Cloudflare 凭据、管理员凭据或模型线路时，会在上传前按变量名失败，错误不会输出值。部署和生产成员验收共用同一个生产变更队列，不会取消已经开始的上传、smoke 或清理。真实 Wrangler 上传前会再次确认当前提交仍是远端 `main` tip；上传失败最多重试 3 次，然后失败。代码检查和生产 smoke 失败不会重试或被忽略。

生产运行、故障判断、密钥轮换、回滚和数据恢复流程见 [`docs/operations.md`](docs/operations.md)。

`wrangler.jsonc` 只保留可共享的本地/干跑基线，不包含任何生产实例 ID。生成后的生产配置包含 `UserState`、`TeamAgent` 与 `ProviderCoordinator` 的 SQLite 类迁移，首次部署会自动创建 Durable Object namespace；只有新增、删除或重命名 Durable Object 类绑定时才增加 migration tag，不能修改已经上线的 tag。

## 开发

项目已初始化 Trellis Codex 工作流：

- `.trellis/`：工作流、规格、任务和开发者记录
- `.agents/skills/trellis-*`：Codex 可调用的 Trellis 技能
- `.codex/hooks.json`：在用户提交消息时注入当前 Trellis 状态

首次初始化或更新后需要重新打开 Codex 项目任务，让命令列表重新加载。用户级 `config.toml` 必须启用 `[features].hooks = true`；可通过 `/hooks` 检查 hook 状态。Codex 中也可以直接调用 `$trellis-start`、`$trellis-continue`、`$trellis-check` 和 `$trellis-finish-work`。

```bash
npm install
npm run dev
npm run typecheck
npm test
npm run deploy:dry-run
```

仓库没有本地生产 `deploy` 脚本。生产发布只通过 GitHub Actions 读取已配置的实例参数和 Secrets。

## 借鉴项目

- LibreChat：适合作为多 endpoint 配置和 BYOK UI 的参考。
- Open WebUI：适合作为用户记忆、会话管理和管理员配置体验的参考。
- LangChain：适合作为短期上下文窗口和长期记忆分层的参考。
- LiteLLM：适合作为路由、fallback、virtual key 和 provider adapter 的参考。

这个项目的取舍更轻：不做公开 API proxy，只做受限访客入口和私有成员网页登录工作区。
