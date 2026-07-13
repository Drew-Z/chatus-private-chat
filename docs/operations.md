# Chatus 生产运行手册

本文档用于部署交接和故障处理。生产环境只通过 GitHub Actions 发布，不在维护者电脑上直接执行 `wrangler deploy`，避免部署到错误的 Cloudflare 账号。

## 发布检查

合并或推送到 `main` 前执行：

```bash
npm run check:frontend
npm test
npm run typecheck
npx wrangler deploy --dry-run
git diff --check
```

推送后确认 `Deploy to Cloudflare` 工作流成功。工作流会检查精确提交 SHA、`/healthz`、登录页、管理后台、PWA、静态图标、安全响应头和未登录 API 行为。

生产地址：

```text
https://chatus.ciallobill.qzz.io
https://chatus.ciallobill.qzz.io/admin
https://chatus.ciallobill.qzz.io/healthz
https://chatus.ciallobill.qzz.io/release.json
```

## 故障判断

1. 查看 `/healthz`。`kv`、`durableObject`、`configured` 应全部为 `true`。
2. 查看 `/release.json`，确认 `commit` 是预期的完整 Git SHA。
3. 查看 GitHub Actions 中失败的具体步骤。
4. 用户错误中的 8 位“请求编号”对应响应头 `X-Request-ID` 的前 8 位；在 Cloudflare Observability 中按完整 ID 检索结构化日志。
5. 若 Wrangler 日志出现 Cloudflare API `521`、`522` 或 `malformed response`，而测试已经通过，通常是控制面故障。重跑失败的工作流，不要修改业务代码或改用本机账号部署。

## 常见恢复

- 上游线路异常：在后台执行线路巡检，确认 Base URL、模型和 `apiKeyRef`。可先停用异常线路，fallback 会跳过已停用线路。
- 用户无法登录：确认用户未暂停、访问码 label 与用户配置一致，并检查登录限流倒计时。
- 页面仍是旧版本：等待 PWA 更新提示并点击“立即刷新”；用 `/release.json` 判断生产版本，不以浏览器缓存内容为准。
- 云端同步冲突：系统会保留云端新版，并把当前设备内容创建为“此设备副本”，不要手工覆盖原会话。
- 已删除会话重新出现：先确认生产版本；当前版本会取消前端保存队列，并用单会话墓碑与账户级删除时间线拒绝旧设备数据。不要通过清空墓碑解决同步问题。
- 核心健康异常：先检查 KV 和 Durable Object 绑定，再检查 `ACCESS_CODES` 与至少一条启用线路是否存在。

## 后台线路密钥

首次启用时，在可信环境运行以下命令生成 32 字节随机主密钥：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

把输出仅保存到 GitHub Secret `ROUTE_KEYS_MASTER_KEY`，通过 `Deploy to Cloudflare` 发布一次。不要把主密钥写入 `.env`、任务文档、issue、聊天记录或截图。

之后的普通线路 key 操作不需要重新部署：

1. 在 `/admin.html` 打开“模型线路”，填写稳定的 `API Key Ref`。
2. 在“后台线路密钥”中输入新 key 并保存。输入框会立即清空，后台只显示配置来源和更新时间。
3. 保存后可直接拉取模型并执行健康检查。
4. 删除托管密钥只会删除 KV 中的 AES-GCM 密文；若存在同名 Worker Secret，会自动恢复使用它。

若状态显示“无法解密”或“记录损坏”，不要复制 KV 内容排查，也不要尝试记录密文。确认主密钥是否被更换，然后删除该托管项并重新录入。托管密钥的优先级高于同名 Worker Secret；损坏的托管项不会静默回退到另一个值。

## 密钥轮换

1. 普通上游线路 key：直接在管理后台替换并立即运行模型拉取与线路巡检，不需要部署。
2. `ACCESS_CODES`、`ADMIN_TOKEN`、`ROUTES_CONFIG`、兼容用 `WORKER_SECRETS_JSON`：在 GitHub Secrets 更新后运行 `Deploy to Cloudflare`。
3. `ROUTE_KEYS_MASTER_KEY`：更换后旧托管密钥无法解密。先记录需要重新录入的 `apiKeyRef` 名称，再更新 GitHub Secret、通过 Actions 发布，并在后台逐条重新录入线路 key。
4. 验证工作流、生产 smoke、模型拉取和线路巡检成功。
5. 轮换访问码会使对应 label 的现有登录会话失效；轮换管理员 Token 会使全部旧后台会话在下一次请求时失效。
6. 不把真实访问码、上游 Key、管理员 Token、主密钥或完整 Secret JSON 写入 issue、日志、截图和仓库文件。

## 回滚

使用 Git 创建反向提交并推送 `main`，让相同的测试和生产门禁执行：

```bash
git revert <bad-commit-sha>
git push origin main
```

不要使用 `git reset --hard` 改写共享历史，也不要从本机直接覆盖 Worker。回滚后以 `/release.json` 和精确 SHA smoke 为准。

## 数据与备份

- 用户可在设置中导出全部会话 JSON。手动导入使用 `restore` 语义，可恢复明确选择的旧备份；后台自动同步只使用 `merge`，不会绕过删除时间线。
- 用户可删除本机缓存、退出所有设备或永久删除全部数据。永久删除会清除对话、摘要、记忆、反馈、用量和指标，注销全部设备，并阻止删除前的本地副本回流。
- 长期记忆可由用户或管理员查看和编辑。
- 访问码与线路配置的后台覆盖保存在 KV；删除覆盖后会恢复 GitHub/Worker Secret 中的配置。后台线路 key 以 AES-GCM 密文单独保存在 KV，主密钥只存在于 Worker Secret。
- Durable Object 保存用量、指标、云端会话和删除时间线。SQLite 表通过构造器中的幂等 `CREATE TABLE IF NOT EXISTS` 升级；新增或重命名 Durable Object 类绑定时才增加 Wrangler migration tag，任何已经上线的 tag 都不能修改。

## 开发流程

- 当前仓库已启用 Trellis Codex 集成。复杂改动应在 `.trellis/tasks/` 保存需求、设计、执行和验收上下文，并在修改前读取相应 `.trellis/spec/`。
- Codex 项目命令与 hooks 在任务启动时加载；初始化或更新 `.codex/` 后需要重新打开项目任务。`/hooks` 用于查看审批状态，Trellis 工作流能力通过项目级 Trellis 命令或 `$trellis-*` 技能调用。
- 本文件继续作为生产运行手册；Trellis 负责任务过程和可复用工程规范，不在两处重复维护同一操作步骤。
