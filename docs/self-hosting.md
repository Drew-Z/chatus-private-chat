# Chatus 第三方实例部署

本文描述如何从一个干净的 fork 创建独立 Chatus 实例。生产 Worker 只通过 GitHub Actions 发布；本机可以开发和执行 dry-run，但不要运行生产 `wrangler deploy`。

## 1. 准备 Cloudflare 资源

1. Fork 仓库，并在 fork 的 `main` 分支启用 GitHub Actions。
2. 在目标 Cloudflare 账号创建一个新的 KV namespace，并记录其 32 位 namespace ID。每个独立实例使用自己的 namespace，不要复制其他实例的 ID。
3. 决定稳定的 Worker 名称，例如 `chatus-team`。首次部署后不要改名；改名会创建另一个 Worker 持久化边界，不是无损品牌重命名。
4. 决定生产 HTTPS origin：可以是 `https://<worker>.<account-subdomain>.workers.dev`，也可以是账号中可管理的自定义域名，例如 `https://chat.example.com`。不要包含 `/admin`、其他路径、查询或 fragment。
5. 创建 Cloudflare API Token。可从 Cloudflare 的 **Edit Cloudflare Workers** 模板开始，将 Account Resources 限制到目标账号；使用自定义域名时再把 Zone Resources 限制到目标域名。不要使用 Global API Key。

Durable Object namespace 不需要手工创建。工作流中的 Wrangler migrations 会在首次部署时创建 `UserState` 和 `TeamAgent` SQLite classes。

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
| `ACCESS_CODES` | 邀请成员，格式为 `label:random-code`，每个 code 至少 16 位，多个条目用逗号分隔 |
| `ADMIN_TOKEN` | 管理后台登录 Token，至少 24 位 |
| `ROUTES_CONFIG` | 推荐的多线路 JSON 配置；也可仅用兼容项 `UPSTREAM_API_KEY` |

推荐同时设置：

| Secret | 用途 |
| --- | --- |
| `ROUTE_KEYS_MASTER_KEY` | 32 随机字节的 Base64，用于后台加密托管线路 key |
| `WORKER_SECRETS_JSON` | 可选的线路 key JSON 对象，key 必须是大写环境变量名 |
| `SYSTEM_PROMPT` | 可选的全局 System Prompt |
| `BLOCKED_PROMPTS` | 可选的低价值短提示词阻止列表 |

在可信终端生成随机值，并只把输出放进对应 GitHub Secret：

```bash
# ACCESS_CODES 中冒号右侧的随机部分，以及 ADMIN_TOKEN
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"

# ROUTE_KEYS_MASTER_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

`WORKER_SECRETS_JSON` 只用于额外线路 key，例如：

```json
{
  "UPSTREAM_MAIN_KEY": "replace-in-github-secret"
}
```

它不能覆盖 `ACCESS_CODES`、`ADMIN_TOKEN`、`ROUTES_CONFIG`、Cloudflare 凭据或三项实例 Variables。更方便的长期做法是只设置一次 `ROUTE_KEYS_MASTER_KEY`，部署后在 `/admin.html` 中按 `apiKeyRef` 录入和轮换托管线路 key。

Wrangler 的 `--secrets-file` 是增量上传：从 GitHub 删除一个可选 Secret 或从 `WORKER_SECRETS_JSON` 删除一个 key，**不会从 Cloudflare Worker 删除已经存在的远端 Secret**。需要撤销时，先让线路/`apiKeyRef` 停止引用它，再在 Cloudflare Dashboard 的 Worker Variables and Secrets 中显式删除，并重新运行部署与 smoke。仅删除 GitHub Secret 不是凭据撤销。

## 4. 首次发布

在 GitHub Actions 手动运行 **Deploy to Cloudflare**，或在配置完成后推送 `main`。工作流会依次：

1. 执行类型、前端和单元测试。
2. 校验三项实例 Variables、Cloudflare 凭据、访问/管理员凭据和模型线路配置。
3. 生成忽略提交的 `.wrangler.deploy.jsonc` 与权限受限的 `.prod.secrets.json`。
4. 使用生成配置执行 Wrangler dry-run，再通过相同配置发布。
5. 对 `CHATUS_PRODUCTION_URL` 执行精确 Git SHA 的无模型 smoke。
6. 无论成功失败都删除准备出的 Secret 文件。

Preflight 错误只指出缺失或无效的变量名，不输出 Secret 值。部署成功后访问生产 URL，用 `ACCESS_CODES` 登录；管理员入口为同一 origin 下的 `/admin.html`。

## 5. 更新、验收与恢复

- 常规更新：把上游改动合并到 fork 的 `main`，由同一工作流发布。不要改三项实例 Variables。
- 成员数据验收：部署后手动运行 **Production member acceptance**。它读取 `CHATUS_PRODUCTION_URL` 与 `ADMIN_TOKEN`，创建并清理随机临时成员，不调用模型。
- 代码回滚：对错误提交执行 `git revert` 并推送 `main`，让完整 Actions 门禁重新发布。不要 force-push，也不要本地覆盖 Worker。
- 配置恢复：GitHub Secrets 定义每次部署要上传的基线值，但不会自动清理远端旧 Worker Secret；后台 KV 覆盖可单独删除以恢复基线。托管线路 key 依赖原 `ROUTE_KEYS_MASTER_KEY`，更换主密钥后需重新录入。
- 数据边界：切换 KV ID、Worker 名或 Cloudflare Account 会指向新的存储边界，不是数据迁移。现阶段不要删除旧 KV/UserState 数据；Agent 导入仍以这些源记录作为回滚证据。

详细生产诊断、密钥轮换和回滚约束见 [`operations.md`](operations.md)。
