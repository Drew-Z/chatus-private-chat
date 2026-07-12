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
- 多协议：`openai-chat` 适合 OpenAI-compatible 中转；`anthropic-messages` 适合 Claude/Claude Code 一类 Anthropic Messages 接口。
- 多模态：前端支持图片上传；后端会按线路协议转换图片格式。
- 私有访问：访问码登录、HttpOnly session、强一致用户限额，不暴露 `/v1/chat/completions` 分发接口。
- 多会话：云端同步 + 本地缓存，每个朋友最多 30 个会话；上下文按字符预算裁剪，并带会话摘要。
- 长期记忆：每个访问码 label 在 KV 中有一份长期记忆，支持建议写入与后台编辑。
- 聊天体验：Markdown 渲染、消息编辑/重发/重新生成、会话搜索导出、移动端抽屉侧栏。
- 管理后台：`/admin.html` 可管理访问码、用户额度、专属提示词、允许线路、默认模型、长期记忆、7 日用量/错误率与线路健康检查。

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
- `apiKeyRef`: 从 Worker secret/env 读取 key，例如 `UPSTREAM_GROK_MAIN_KEY`。
- `apiKey`: 也可以直接写在 `ROUTES_CONFIG` 里，适合只想维护一个 GitHub Secret 的私有小项目。
- `requiresUserKey`: 设为 `true` 时，这条线路必须由朋友填写自己的 API key。
- `allowUserKey`: 设为 `false` 时，即使用户开启 BYOK，这条线路也不允许覆盖服务端 key。
- `enabled`: 设为 `false` 可临时停用线路；配置和统计会保留，但用户不可选择、fallback 不会调用、自动巡检会跳过。
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
WORKER_SECRETS_JSON    可选，JSON 对象，用于上传动态线路 key
SYSTEM_PROMPT          可选，默认系统提示词
BLOCKED_PROMPTS        可选，全局屏蔽的短提示词列表
UPSTREAM_API_KEY       可选，旧单线路 fallback
```

当前 Cloudflare Account ID：

```text
f04d5c8ecf3260827f1ea87b22454ae8
```

如果 `ROUTES_CONFIG` 使用 `apiKeyRef`，还需要把对应 key 配成 Cloudflare Worker Secret，例如：

```bash
npx wrangler secret put UPSTREAM_GROK_MAIN_KEY
npx wrangler secret put UPSTREAM_GROK_BACKUP_KEY
npx wrangler secret put ANTHROPIC_KEY
```

也可以把这些动态 key 集中放进 GitHub Secret `WORKER_SECRETS_JSON`，让 Actions 部署时一起上传：

```json
{
  "UPSTREAM_GROK_MAIN_KEY": "sk-...",
  "UPSTREAM_GROK_BACKUP_KEY": "sk-...",
  "ANTHROPIC_KEY": "sk-ant-..."
}
```

两种方式选一种就行。`wrangler deploy --secrets-file` 会上传本次文件里的 secrets，同时保留 Worker 上已有的其他 secrets。

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
- 直接编辑完整 `ROUTES_CONFIG` JSON，处理 `headers`、`authHeader`、`directEndpoint` 等高级字段。
- 删除 KV 覆盖配置，恢复到 GitHub/Cloudflare Secret 中的默认配置。

后台保存的配置写入 Cloudflare KV，优先级高于 `ROUTES_CONFIG` Secret；如果删除后台覆盖配置，Worker 会重新读取 Secret。上游 API Key 仍建议放在 Worker Secret / `WORKER_SECRETS_JSON` 里，后台线路只填写 `apiKeyRef`。

## 会话与记忆

当前实现借鉴了常见聊天项目的分层方式，但保持轻量：

- 会话历史：按用户存入 SQLite Durable Object + 浏览器 localStorage 缓存；换设备可恢复，最多 30 个会话。旧版 KV 会话会在首次读取时自动迁移。
- 短期上下文：前后端按字符预算裁剪（默认约 14000 字符 / 最近 40 条），并优先保留最近对话；历史图片只保留最近 2 轮用户消息。
- 会话摘要：聊天达到一定长度后自动调用当前线路生成滚动摘要，并在后续请求里作为 system 信息注入。
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
- 线路支持健康检查（最小 completion，查看延迟与连通性）。
- Cloudflare Cron 每 6 小时自动巡检所有线路，结果会同步显示在聊天模型选择器和后台告警中心。
- 线路支持从上游安全拉取模型列表，API Key 由 Worker Secret 注入，浏览器可直接选择模型 ID。

## 会话同步 API

- `GET /api/chats`：拉取当前用户云端会话
- `PUT /api/chats`：保存/更新单个会话
- `DELETE /api/chats?id=`：删除会话
- `POST /api/chats/migrate`：本地会话首次迁移/合并到云端

## 自动部署

推送到 `main` 分支会自动执行 `.github/workflows/deploy.yml`：

```text
install -> typecheck -> test -> write .prod.secrets.json -> wrangler deploy
```

当前 KV namespace 已绑定：

```text
chatus_private_chat -> 677a99ca03f14921ac091851fb95a8da
```

`wrangler.jsonc` 还包含 `UserState` Durable Object 的 `v1` SQLite 迁移，首次部署会自动创建，不需要在 Dashboard 手动建库。自定义域名可以继续在 Cloudflare Dashboard 管理，部署不会移除它。

## 开发

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
