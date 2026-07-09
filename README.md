# Chatus Private Chat

一个部署在 Cloudflare Workers 上的私有多模态聊天窗口。它只暴露网页聊天 UI，不提供 OpenAI-compatible API 分发入口。

## 架构

```text
Browser
  -> Cloudflare Worker + Static Assets
  -> KV session and quota store
  -> route adapter
     -> OpenAI-compatible /chat/completions
     -> Anthropic /v1/messages
```

## 支持能力

- 多线路：每条线路可配置独立 `baseUrl`、`model`、协议类型和 fallback。
- 多朋友：按访问码 label 匹配用户，每个用户可设置允许线路、默认线路、限额和 BYOK。
- 多协议：`openai-chat` 适合 OpenAI-compatible 中转；`anthropic-messages` 适合 Claude/Claude Code 一类 Anthropic Messages 接口。
- 多模态：前端支持图片上传；后端会按线路协议转换图片格式。
- 私有访问：访问码登录、HttpOnly session、KV 限额，不暴露 `/v1/chat/completions` 分发接口。

## 本地配置

复制 `.env.example` 为 `.dev.vars`，填入不会提交到仓库的密钥：

```bash
ACCESS_CODES="friend:change-this-long-random-code"
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
    "allowBringYourOwnKey": false
  },
  "users": {
    "friend": {
      "defaultRoute": "grok-main",
      "allowedRoutes": ["grok-main", "grok-backup", "claude-code"],
      "allowBringYourOwnKey": true,
      "dailyMessageLimit": 80,
      "minuteMessageLimit": 12
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
- `directEndpoint`: 设为 `true` 时，`baseUrl` 会被当作完整 endpoint，不再自动拼 `/chat/completions` 或 `/v1/messages`。

## GitHub Actions Secrets

仓库需要设置：

```text
CLOUDFLARE_API_TOKEN   Cloudflare API Token，用于 GitHub Actions 部署
CLOUDFLARE_ACCOUNT_ID  当前 Cloudflare 账号 ID
ACCESS_CODES           聊天窗口访问码
ROUTES_CONFIG          多线路配置，推荐设置
WORKER_SECRETS_JSON    可选，JSON 对象，用于上传动态线路 key
SYSTEM_PROMPT          可选，默认系统提示词
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

## 自动部署

推送到 `main` 分支会自动执行 `.github/workflows/deploy.yml`：

```text
install -> typecheck -> write .prod.secrets.json -> wrangler deploy
```

当前 KV namespace 已绑定：

```text
chatus_private_chat -> 677a99ca03f14921ac091851fb95a8da
```

## 开发

```bash
npm install
npm run dev
npm run typecheck
npx wrangler deploy --dry-run
```

## 借鉴项目

- LibreChat：适合作为多 endpoint 配置和 BYOK UI 的参考。
- LiteLLM：适合作为路由、fallback、virtual key 和 provider adapter 的参考。

这个项目的取舍更轻：不做公开 API proxy，只做一个私有网页登录聊天窗。
