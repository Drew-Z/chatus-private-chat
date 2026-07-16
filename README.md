# Chatus Private Chat

一个部署在 Cloudflare Workers 上的私有多模态聊天窗口。它只暴露网页聊天 UI，不提供 OpenAI-compatible API 分发入口。

## 架构

```text
Browser
  -> Cloudflare Worker + Static Assets
  -> KV sessions, configuration and long-term memory
  -> per-user SQLite Durable Object (quota, metrics and cloud chats)
  -> route adapter
     -> OpenAI-compatible /chat/completions
     -> Anthropic /v1/messages
```

## 支持能力

- 多线路：每条线路可配置独立 `baseUrl`、`model`、协议类型和 fallback。
- 多朋友：按访问码 label 匹配用户，每个用户可设置允许线路、默认线路、限额和 BYOK。
- 用户身份：可为稳定 label 配置独立显示名称；修改昵称不会影响访问码、权限或历史会话归属。
- 用户状态：可暂停或恢复某个朋友；暂停后拒绝新登录并使现有会话在下一次请求时失效，但保留其数据和配置。
- 多协议：`openai-chat` 适合 OpenAI-compatible 中转；`anthropic-messages` 适合 Claude/Claude Code 一类 Anthropic Messages 接口。
- 多模态：前端支持图片上传；后端会按线路协议转换图片格式。
- 私有访问：访问码登录、HttpOnly session、强一致用户限额，不暴露 `/v1/chat/completions` 分发接口。
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
- 长期记忆：每个访问码 label 在 KV 中有一份长期记忆，支持建议写入与后台编辑。
- 聊天体验：Markdown、代码块复制和表格渲染；历史消息编辑、重发、重新生成和截断续写都会创建独立分支，并支持会话搜索导出和移动端抽屉侧栏。
- 安装与更新：支持 PWA 安装；检测到新版本后由用户确认刷新，不会在回答生成中途强制接管。
- 回答反馈：朋友可标记“有帮助 / 需改进”，后台查看近期好评率；只记录线路与消息标识，不保存反馈对应的对话正文。
- 管理后台：`/admin.html` 可管理访问码、用户额度、专属提示词、允许线路、默认模型、长期记忆、7 日用量/错误率，并可按需手动检查线路；运营报表不包含敏感字段。
- 后台编辑保护：用户、线路、访问码、JSON 和长期记忆存在未保存修改时，切换对象、刷新、退出或关闭页面前会提醒确认。
- 配置并发保护：后台保存或恢复 Secret 配置时校验版本指纹，避免旧标签页或另一台设备覆盖较新的线路与用户配置。
- 凭据并发保护：访问码保存、轮换、撤销和恢复 Secret 时校验版本指纹，旧后台不能恢复已经失效的访问码。
- 记忆并发保护：用户设置页与管理后台保存长期记忆时校验用户级版本指纹，避免多设备无声覆盖。

## 本地配置

复制 `.env.example` 为 `.dev.vars`，填入不会提交到仓库的密钥：

```bash
ACCESS_CODES="friend:change-this-long-random-code"
ADMIN_TOKEN="change-this-admin-token"
ROUTES_CONFIG="{...}"
UPSTREAM_GROK_MAIN_KEY="sk-..."
UPSTREAM_GROK_BACKUP_KEY="sk-..."
ANTHROPIC_KEY="sk-ant-..."
SYSTEM_PROMPT="You are a helpful assistant."
```

`ACCESS_CODES` 支持多个访问码，用英文逗号分隔：

```bash
ACCESS_CODES="friend:code-one,alice:code-two"
```

登录后的用户 label 就是 `friend`、`alice`，会用于匹配 `ROUTES_CONFIG.users`。

## ROUTES_CONFIG

推荐把 `ROUTES_CONFIG` 放进 GitHub Secret 或 Cloudflare Secret，不提交到仓库。

```json
{
  "defaults": {
    "defaultRoute": "grok-main",
    "allowedRoutes": ["grok-main"],
    "allowBringYourOwnKey": false,
    "blockedPrompts": ["你好", "hi", "hello", "测试", "test", "在吗", "嗨", "哈喽", "hey", "ping"]
  },
  "users": {
    "friend": {
      "defaultRoute": "grok-main",
      "allowedRoutes": ["grok-main", "grok-backup", "claude-code"],
      "allowBringYourOwnKey": true,
      "dailyMessageLimit": 500,
      "minuteMessageLimit": 12,
      "systemPrompt": "你是这位朋友的私人助手，回答简洁友好。"
    }
  },
  "routes": {
    "grok-main": {
      "label": "Grok 主线路",
      "type": "openai-chat",
      "baseUrl": "https://example-a.com/v1",
      "apiKeyRef": "UPSTREAM_GROK_MAIN_KEY",
      "model": "grok-4.20-multi-agent-xhigh",
      "fallbacks": ["grok-backup"],
      "supportsImages": true
    },
    "grok-backup": {
      "label": "Grok 备用线路",
      "type": "openai-chat",
      "baseUrl": "https://example-b.com/v1",
      "apiKeyRef": "UPSTREAM_GROK_BACKUP_KEY",
      "model": "grok-4.20-multi-agent-xhigh",
      "supportsImages": true
    },
    "claude-code": {
      "label": "Claude Code",
      "type": "anthropic-messages",
      "baseUrl": "https://api.anthropic.com",
      "apiKeyRef": "ANTHROPIC_KEY",
      "model": "claude-sonnet-4-5",
      "headers": {
        "anthropic-version": "2023-06-01"
      },
      "maxTokens": 4096,
      "supportsImages": true
    }
  }
}
```

字段说明：

- `type`: 目前支持 `openai-chat` 和 `anthropic-messages`。
- `apiKeyRef`: 线路密钥的稳定逻辑名称，例如 `UPSTREAM_GROK_MAIN_KEY`。Worker 会依次查找后台加密密钥和同名 Worker Secret。
- `apiKey`: 仅为旧配置兼容保留。新配置不要把明文 key 写进 `ROUTES_CONFIG`。
- `requiresUserKey`: 设为 `true` 时，这条线路必须由朋友填写自己的 API key。
- `allowUserKey`: 设为 `false` 时，即使用户开启 BYOK，这条线路也不允许覆盖服务端 key。
- `enabled`: 设为 `false` 可临时停用线路；配置和统计会保留，但用户不可选择，fallback 也不会调用。
- `directEndpoint`: 设为 `true` 时，`baseUrl` 会被当作完整 endpoint，不再自动拼 `/chat/completions` 或 `/v1/messages`。
- `blockedPrompts`: 精确屏蔽低价值短提示词，例如 `["你好", "hi", "hello", "测试", "test"]`。只拦最后一条纯文本用户消息，带图片或更长任务不会被拦。

## GitHub Actions Secrets

仓库需要设置：

```text
CLOUDFLARE_API_TOKEN   Cloudflare API Token，用于 GitHub Actions 部署
CLOUDFLARE_ACCOUNT_ID  当前 Cloudflare 账号 ID
ACCESS_CODES           聊天窗口访问码
ADMIN_TOKEN            管理后台登录 token，用于 /admin.html
ROUTES_CONFIG          多线路配置，推荐设置
ROUTE_KEYS_MASTER_KEY  可选但推荐，后台加密管理线路 key 的一次性主密钥
WORKER_SECRETS_JSON    可选，JSON 对象，用于上传动态线路 key
SYSTEM_PROMPT          可选，默认系统提示词
BLOCKED_PROMPTS        可选，全局屏蔽的短提示词列表
UPSTREAM_API_KEY       可选，旧单线路 fallback
```

当前 Cloudflare Account ID：

```text
f04d5c8ecf3260827f1ea87b22454ae8
```

若要在管理后台直接新增和轮换线路 key，先生成 32 个随机字节的 Base64 值：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

把输出仅保存为 GitHub Secret `ROUTE_KEYS_MASTER_KEY`，再通过 `Deploy to Cloudflare` 工作流发布一次。之后可以在 `/admin.html` 的线路编辑器中填写 `API Key Ref`，输入新密钥并点击“保存密钥”；密钥会使用 AES-GCM 加密后写入 KV，页面和 API 都不会读回明文。

已有 Worker Secret 仍然兼容。也可以把这些动态 key 集中放进 GitHub Secret `WORKER_SECRETS_JSON`，让 Actions 部署时一起上传：

```json
{
  "UPSTREAM_GROK_MAIN_KEY": "sk-...",
  "UPSTREAM_GROK_BACKUP_KEY": "sk-...",
  "ANTHROPIC_KEY": "sk-ant-..."
}
```

托管密钥优先于同名 Worker Secret；删除托管密钥后会自动恢复使用 Worker Secret。生产发布只通过 GitHub Actions，不要从本机 Wrangler 账号部署。更换 `ROUTE_KEYS_MASTER_KEY` 后，原有托管密钥无法解密，需要在后台逐条重新录入。

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
https://你的 Worker 域名/admin.html
```

后台使用单独的 `ADMIN_TOKEN` 登录。登录后可以：

- 查看今天每个朋友的用量、剩余额度、活跃 session、长期记忆长度。
- 编辑访问码，格式仍是 `friend:code-one,alice:code-two`。
- 用表单快速配置某个朋友可用的线路、默认模型、每日额度、每分钟额度、是否允许 BYOK。
- 用表单新增/修改线路的 `baseUrl`、`model`、`apiKeyRef`、协议类型、fallback 和图片支持。
- 在不重新部署的情况下新增、替换或删除后台加密线路 key；后台只显示配置状态，不回显密钥。
- 直接编辑完整 `ROUTES_CONFIG` JSON，处理 `headers`、`authHeader`、`directEndpoint` 等高级字段。
- 删除 KV 覆盖配置，恢复到 GitHub/Cloudflare Secret 中的默认配置。

后台保存的配置写入 Cloudflare KV，优先级高于 `ROUTES_CONFIG` Secret；如果删除后台覆盖配置，Worker 会重新读取 Secret。线路密钥解析优先级为：用户 BYOK（允许时）→ 旧式 `apiKey` → 后台加密密钥 → 同名 Worker Secret。`requiresUserKey` 会阻止使用所有服务端密钥。

## 会话与记忆

当前实现借鉴了常见聊天项目的分层方式，但保持轻量：

- 会话历史：按用户存入 SQLite Durable Object + 浏览器 localStorage 缓存；换设备可恢复，最多 30 个会话。旧版 KV 会话会在首次读取时自动迁移。
- 短期上下文：前后端按字符预算裁剪（默认约 14000 字符 / 最近 40 条），并优先保留最近对话；历史图片只保留最近 2 轮用户消息。
- 会话摘要：聊天达到一定长度后自动调用当前线路生成滚动摘要，并在后续请求里作为 system 信息注入；自动摘要不扣用户消息额度，同一会话不会并发生成重复摘要。
- 长期记忆：保存在 Cloudflare KV 的 `memory:<label>`，默认最多 4000 字符；支持手写编辑与「建议写入」确认后追加。
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
- 线路仅在管理员主动点击时执行手动检查（最小 completion，查看延迟与连通性）。
- 生产配置不注册线路测活 Cron，也不会在后台自动向模型发送探测请求。
- 线路支持从上游安全拉取模型列表，API Key 由 Worker Secret 注入，浏览器可直接选择模型 ID。
- 可导出每日趋势、线路成功率和用户额度概况 CSV；报表不包含访问码、API Key、Base URL、Prompt、记忆或对话正文。

## 会话同步 API

- `GET /api/chats`：拉取当前用户云端会话
- `PUT /api/chats`：保存/更新单个会话
- `DELETE /api/chats?id=`：删除会话
- `POST /api/chats/migrate`：本地会话迁移；`merge` 用于后台自动合并，`restore` 仅用于用户明确导入备份，`replace` 用于完整替换恢复

## 自动部署

推送到 `main` 分支会自动执行 `.github/workflows/deploy.yml`：

```text
install -> typecheck -> test -> write .prod.secrets.json -> wrangler deploy
```

Wrangler 上传遇到 Cloudflare 控制面临时 `5xx` 时会自动重试 3 次；代码检查和生产 smoke 失败不会重试或被忽略。

生产运行、故障判断、密钥轮换、回滚和数据恢复流程见 [`docs/operations.md`](docs/operations.md)。

当前 KV namespace 已绑定：

```text
chatus_private_chat -> 677a99ca03f14921ac091851fb95a8da
```

`wrangler.jsonc` 包含 `UserState` Durable Object 的 `v1` SQLite 类迁移，首次部署会自动创建，不需要在 Dashboard 手动建库。现有 SQLite 表由 Durable Object 构造器通过 `CREATE TABLE IF NOT EXISTS` 幂等升级；只有新增、删除或重命名 Durable Object 类绑定时才需要增加 Wrangler migration tag，不能修改已经上线的 tag。自定义域名可以继续在 Cloudflare Dashboard 管理，部署不会移除它。

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
npx wrangler deploy --dry-run
```

## 借鉴项目

- LibreChat：适合作为多 endpoint 配置和 BYOK UI 的参考。
- Open WebUI：适合作为用户记忆、会话管理和管理员配置体验的参考。
- LangChain：适合作为短期上下文窗口和长期记忆分层的参考。
- LiteLLM：适合作为路由、fallback、virtual key 和 provider adapter 的参考。

这个项目的取舍更轻：不做公开 API proxy，只做一个私有网页登录聊天窗。
