# Chatus 第三方实例部署

本文描述如何从一个干净的 fork 创建独立 Chatus 实例。生产 Worker 只通过 GitHub Actions 发布；本机可以开发和执行 dry-run，但不要运行生产 `wrangler deploy`。

## 1. 准备 Cloudflare 资源

1. Fork 仓库，并在 fork 的 `main` 分支启用 GitHub Actions。
2. 在目标 Cloudflare 账号创建一个新的 KV namespace，并记录其 32 位 namespace ID。每个独立实例使用自己的 namespace，不要复制其他实例的 ID。
3. 决定稳定的 Worker 名称，例如 `chatus-team`。首次部署后不要改名；改名会创建另一个 Worker 持久化边界，不是无损品牌重命名。
4. 决定生产 HTTPS origin：可以是 `https://<worker>.<account-subdomain>.workers.dev`，也可以是账号中可管理的自定义域名，例如 `https://chat.example.com`。不要包含 `/admin`、其他路径、查询或 fragment。
5. 创建 Cloudflare API Token。可从 Cloudflare 的 **Edit Cloudflare Workers** 模板开始，将 Account Resources 限制到目标账号；使用自定义域名时再把 Zone Resources 限制到目标域名。不要使用 Global API Key。

Durable Object namespace 不需要手工创建。工作流中的 Wrangler migrations 会在首次部署时创建 `UserState`、`TeamAgent` 和 `ProviderCoordinator` SQLite classes。

## 2. 设置 GitHub Repository Variables

进入 fork 的 **Settings -> Secrets and variables -> Actions -> Variables**，设置：

| Variable | 示例 | 约束 |
| --- | --- | --- |
| `CHATUS_WORKER_NAME` | `chatus-team` | 1-63 位小写字母、数字或连字符 |
| `CHATUS_KV_NAMESPACE_ID` | `0123...cdef` | 新建 namespace 的 32 位十六进制 ID |
| `CHATUS_PRODUCTION_URL` | `https://chat.example.com` | HTTPS origin，不带路径、端口、查询或 fragment |

若 URL 以 `.workers.dev` 结尾，生成配置会设置 `workers_dev: true`；否则会生成 `custom_domain: true` 的 route。变量不包含密钥，不要把 Worker Secret 填到 Variables。

## 3. 设置 GitHub Secrets

进入 **Actions -> Secrets**，至少设置：

| Secret | 用途 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | GitHub Actions 调用 Cloudflare 部署 API |
| `CLOUDFLARE_ACCOUNT_ID` | 目标 Cloudflare Account ID |
| `ADMIN_TOKEN` | 管理后台登录 Token，至少 24 位 |
| `ROUTES_CONFIG` | provider、逻辑模型、offerings 与成员权限 JSON；旧式单 route 配置仍可读取 |

推荐同时设置：

| Secret | 用途 |
| --- | --- |
| `ROUTE_KEYS_MASTER_KEY` | 32 随机字节的 Base64，用于后台加密托管 provider key |
| `WORKER_SECRETS_JSON` | 可选的 provider key JSON 对象，key 必须是大写环境变量名 |
| `SYSTEM_PROMPT` | 可选的全局 System Prompt |
| `BLOCKED_PROMPTS` | 可选的低价值短提示词阻止列表 |

`ROUTES_CONFIG` 推荐从 provider pool 开始。下面的最小结构同时展示一个逻辑模型使用两个 provider，以及同一个 provider 复用到多个上游模型：

```json
{
  "providers": {
    "primary": {
      "label": "Primary",
      "type": "openai-chat",
      "baseUrl": "https://provider-a.example/v1",
      "apiKeyRef": "PRIMARY_PROVIDER_KEY",
      "concurrency": "exclusive",
      "queueTimeoutMs": 10000,
      "priority": 100
    },
    "backup": {
      "label": "Backup",
      "type": "openai-chat",
      "baseUrl": "https://provider-b.example/v1",
      "apiKeyRef": "BACKUP_PROVIDER_KEY",
      "concurrency": "bounded",
      "maxConcurrent": 4,
      "queueTimeoutMs": 8000,
      "priority": 60
    }
  },
  "routes": {
    "general": {
      "label": "General",
      "offerings": [
        { "providerId": "primary", "model": "general-model" },
        { "providerId": "backup", "model": "general-model" }
      ]
    },
    "reasoning": {
      "label": "Reasoning",
      "offerings": [
        { "providerId": "primary", "model": "reasoning-model" }
      ]
    }
  },
  "defaults": {
    "defaultRoute": "general",
    "allowedRoutes": ["general", "reasoning"]
  },
  "publicAccess": {
    "enabled": false,
    "routeId": "general",
    "sessionTtlSeconds": 86400,
    "dailyMessageLimit": 20,
    "minuteMessageLimit": 6,
    "sourceDailyMessageLimit": 200,
    "sourceMinuteMessageLimit": 30
  }
}
```

`exclusive` 在该 provider 的所有模型和成员之间只允许一个活动请求；`bounded` 使用 `maxConcurrent`；`unlimited` 不获取租约。`queueTimeoutMs` 必须是 `0..10000` 的整数。管理员优先级先决定候选顺序，同优先级才使用真实任务的脱敏成功率和延迟；不要配置 Cron、doctor 或隐藏 completion 做模型测活。流式 fallback 只在首次可见输出前发生，HTTP `200` 的错误/空 SSE 也会被判为失败；输出后断流不会切换 provider。`publicAccess` 默认关闭，启用时只能暴露一条逻辑模型，并同时限制单访客和同来源的消息额度。

在可信终端生成随机值，并只把输出放进对应 GitHub Secret：

```bash
# ADMIN_TOKEN
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"

# ROUTE_KEYS_MASTER_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

`WORKER_SECRETS_JSON` 只用于额外 provider key，例如：

```json
{
  "PRIMARY_PROVIDER_KEY": "replace-in-github-secret"
}
```

它不能覆盖 `ACCESS_CODES`、`ADMIN_TOKEN`、`ROUTES_CONFIG`、Cloudflare 凭据或三项实例 Variables。生产部署不再要求或读取 GitHub `ACCESS_CODES`；部署配置会启用 KV 托管模式。首次发布后使用 `ADMIN_TOKEN` 登录 `/react-chat/admin`，创建成员并生成访问码；访问码只显示一次，忘记后直接轮换。更方便的长期做法是只设置一次 `ROUTE_KEYS_MASTER_KEY`，部署后在 `/admin.html` 中按 provider 的 `apiKeyRef` 录入和轮换托管密钥。密钥输入在提交后立即清空，页面和读取 API 只返回来源、状态与更新时间，永不回显明文。

公开访客访问仍默认关闭。启用前先让目标逻辑模型在成员账号下可用，并确认该 provider 的密钥来源是后台 KV 托管；同名 Worker Secret 或 `WORKER_SECRETS_JSON` 只能作为成员/兼容来源，不能让访客线路隐式可用。然后在 `/react-chat/admin` 的公开访问设置中选择唯一逻辑模型、设置 TTL 和额度。关闭公开访问开关即可回滚访客入口，不会撤销成员访问。

Wrangler 的 `--secrets-file` 是增量上传：从 GitHub 删除一个可选 Secret 或从 `WORKER_SECRETS_JSON` 删除一个 key，**不会从 Cloudflare Worker 删除已经存在的远端 Secret**。需要撤销时，先确认后台状态显示的是 KV 托管还是 Worker Secret；KV 托管项在后台删除，Worker Secret 则要先让线路/`apiKeyRef` 停止引用它，再在 Cloudflare Dashboard 的 Worker Variables and Secrets 中显式删除，并重新运行部署与 smoke。仅删除 GitHub Secret 不是凭据撤销。

管理后台可从 provider 拉取完整模型列表，并批量创建逻辑模型或合并 offering。新增模型不会复制 endpoint 或 credential，也不会自动修改成员 `allowedRoutes`。旧式 route 的 `type`、`baseUrl`、`model`、`apiKeyRef` 会继续投影为单一 `unlimited` provider；旧明文 key 只在服务端兼容保留，显式迁移前必须先让该 `apiKeyRef` 对应后台托管密钥或同名 Worker Secret。迁移只保存 credential reference 并移除旧内嵌字段，不会复制明文。

## 4. 首次发布

在 GitHub Actions 手动运行 **Deploy to Cloudflare**，或在配置完成后推送 `main`。工作流会依次：

1. 执行类型、前端和单元测试。
2. 校验三项实例 Variables、Cloudflare 凭据、管理员凭据和模型线路配置。
3. 生成忽略提交的 `.wrangler.deploy.jsonc` 与权限受限的 `.prod.secrets.json`。
4. 使用生成配置执行 Wrangler dry-run，再通过相同配置发布。
5. 在真实 Wrangler 上传前再次确认当前提交仍是远端 `main` tip，然后对 `CHATUS_PRODUCTION_URL` 执行精确 Git SHA 的无模型 smoke。
6. 在普通成功或失败路径中删除准备出的 Secret 文件。GitHub 托管 runner 是临时环境，但不要把生成文件复制到日志、issue 或仓库。

Preflight 错误只指出缺失或无效的变量名，不输出 Secret 值。部署成功后先在同一 origin 的 `/react-chat/admin` 使用 `ADMIN_TOKEN` 登录并创建成员，再用生成的访问码进入聊天。旧的 GitHub/Cloudflare `ACCESS_CODES` Secret 在托管模式下不会被读取；确认迁移完成后可在 Cloudflare Dashboard 中显式删除旧 Secret。

## 5. 更新、验收与恢复

- 常规更新：把上游改动合并到 fork 的 `main`，由同一工作流发布。不要改三项实例 Variables。部署和生产成员验收共用生产变更队列，新的运行会等待当前上传、smoke 或清理完成，不会取消已经开始的生产变更。
- 成员数据验收：部署后手动运行 **Production member acceptance**。它读取 `CHATUS_PRODUCTION_URL` 与 `ADMIN_TOKEN`，创建并清理随机临时成员，不调用模型，并在清理后再次确认 release SHA 仍匹配触发提交。该工作流不覆盖公开访客体验。
- 公开访客验收：在新的隐私窗口打开生产 origin，确认可取得隔离访客会话、只看到固定访客模型和成员登录入口；禁用公开访问后确认访客入口关闭。不要用合成 prompt 或后台 completion 探测替代这一步。
- 代码回滚：对错误提交执行 `git revert` 并推送 `main`，让完整 Actions 门禁重新发布。不要 force-push，也不要本地覆盖 Worker。
- 配置恢复：GitHub Secrets 定义每次部署要上传的基线值，但不会自动清理远端旧 Worker Secret；后台 KV 配置是生产成员访问码的唯一来源。旧 `ACCESS_CODES` Secret 在托管模式下被忽略，确认 KV 成员正常后可在 Cloudflare Dashboard 中显式删除。托管 provider key 删除后可能回退同名 Worker Secret；撤销前先停止引用并确认当前来源。托管 provider key 依赖原 `ROUTE_KEYS_MASTER_KEY`，更换主密钥后需重新录入。
- provider 配置迁移：旧式 route 可在迁移期间继续运行。先创建 provider 与 offering，核对逻辑模型 fallback、成员权限和密钥引用，再移除旧内嵌 endpoint 字段；配置回滚不应修改 Worker 名、KV ID 或 Account。
- 数据边界：切换 KV ID、Worker 名或 Cloudflare Account 会指向新的存储边界，不是数据迁移。现阶段不要删除旧 KV/UserState 数据；Agent 导入仍以这些源记录作为回滚证据。

详细生产诊断、密钥轮换和回滚约束见 [`operations.md`](operations.md)。
