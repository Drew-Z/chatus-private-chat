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

工作流只从 GitHub Repository Variables 读取实例定位信息：`CHATUS_WORKER_NAME`、`CHATUS_KV_NAMESPACE_ID`、`CHATUS_PRODUCTION_URL`。它会先运行 `scripts/prepare-deployment.mjs`，在上传前校验这些变量、Cloudflare 凭据、`ADMIN_TOKEN` 以及 `ROUTES_CONFIG` / `UPSTREAM_API_KEY`，再生成忽略提交的 Wrangler 配置与 Secret 文件。生产配置启用 KV 托管访问码模式，不读取 GitHub `ACCESS_CODES`。Preflight 失败时只记录变量名，不记录值。

三项实例变量在首次部署后应视为持久化身份。修改 Worker 名、KV ID 或 Cloudflare Account 会切换到新的 Worker/数据边界，不是普通配置更新。第三方首次安装流程见 [`self-hosting.md`](self-hosting.md)。

## 登录态生产验收

需要验证成员隔离、Agent WebSocket、版本冲突或永久删除时，在 GitHub Actions 手动运行 `Production member acceptance`。该工作流会先确认生产版本与触发提交一致，再使用 `ADMIN_TOKEN` 在生产访问码覆盖中追加两名随机临时成员，验证登录、会话投影、对话/记忆隔离、乐观并发冲突、Agent WebSocket、会话墓碑和 `DELETE /api/user-data`。

验收脚本不会调用模型、不会输出访问码或 Cookie，并在成功或失败时清理临时成员数据、恢复访问码配置。验收期间不要同时在后台编辑访问码；脚本使用 revision 检查，检测到并发修改会重试，无法安全恢复时会让工作流失败以便人工处理。

命令行等价入口（需要在受信环境提供 `ADMIN_TOKEN`）：

```bash
PRODUCTION_URL=https://你的生产域名 ADMIN_TOKEN=<从环境变量读取> npm run acceptance:production
```

不要把 Token、临时访问码、Cookie、响应正文或生产记忆复制到日志、issue、截图或任务文件。

生产地址统一从 Repository Variable `CHATUS_PRODUCTION_URL` 派生：

```text
$CHATUS_PRODUCTION_URL
$CHATUS_PRODUCTION_URL/admin.html
$CHATUS_PRODUCTION_URL/healthz
$CHATUS_PRODUCTION_URL/release.json
```

## Provider pool 运行语义

- 用户选择逻辑模型，运行时按 offering 解析物理 provider。管理员 `priority` 越高越优先；只有同优先级才按精确 `(logicalRouteId, providerId)` 的真实任务成功率和延迟排序。
- `exclusive` 的 provider 在所有 offered models 和所有成员之间只有一个活动名额；`bounded` 使用 `maxConcurrent`；`unlimited` 不获取并发租约。
- 请求先无等待尝试有资格的候选。某个 provider 忙时，只要有其他候选立即可用就直接跳过；全部候选都忙时才进入共享等待，`queueTimeoutMs` 只能是 `0..10000` 毫秒。
- 成功、上游失败、流取消和客户端断开都会释放租约；活动请求不会因另一个请求到达而被截断。超过共享 deadline 后返回稳定的 provider busy 错误。
- fallback 只能发生在首次可见文本、推理、工具或审批输出之前。HTTP `200` 中的错误事件、畸形 SSE、空流或只有 `[DONE]` 的响应仍属于协议失败，可在输出前尝试备用 offering；输出后断流直接结束当前回答，不会切换 provider 拼接内容。
- 用户取消不会触发 fallback。输出前协议失败、输出后断流和取消都会释放 provider 租约，但只有真实成功完成的流才记录成功遥测。
- provider 质量只来自真实用户任务的脱敏结果。禁止新增 Cron、doctor、后台刷新 completion 或隐藏 synthetic prompt 做测活。
- typed 后台“可靠性”中的“平均延迟”是完整 provider 尝试耗时；“首字输出”只统计成功文本流从尝试开始到首个非空文本/推理增量的耗时。工具型或没有文本增量的成功调用显示为未知，不表示故障。
- “渐进”表示最近成功文本流包含多个真实上游增量；“单块”表示上游只暴露一个可见增量，通常说明 provider、代理或兼容层进行了缓冲。网页不会把单块结果拆成假的逐字输出。形态计数最多保留 1,000 个脱敏样本，不保存提示词、回答或原始 chunk。

## 故障判断

1. 查看 `/healthz`。`kv`、`legacyDurableObject`、`teamAgent`、`durableObject`、`configured` 应全部为 `true`；首次引导期间 `memberAccessConfigured` 可以是 `false`。
2. 查看 `/release.json`，确认 `commit` 是预期的完整 Git SHA。
3. 查看 GitHub Actions 中失败的具体步骤。
4. 用户错误中的 8 位“请求编号”对应响应头 `X-Request-ID` 的前 8 位；在 Cloudflare Observability 中按完整 ID 检索结构化日志。
5. 若 Wrangler 日志出现 Cloudflare API `521`、`522` 或 `malformed response`，而测试已经通过，通常是控制面故障。重跑失败的工作流，不要修改业务代码或改用本机账号部署。

## 常见恢复

- 上游线路异常：在后台刷新线路状态，先确认配置就绪信息，再查看最近真实用户任务的脱敏结果。可先停用异常线路，fallback 会跳过已停用线路。后台状态刷新不会向模型发送探测提示。
- HTTP `200` 但回答为空或中途断开：`event: error`、畸形 SSE、空流和只有 `[DONE]` 的响应仍按协议失败处理。首次可见输出前会尝试备用 provider；输出后不会 fallback。后者应按响应头中的完整 `X-Request-ID` 查询日志，不要误判为备用线路配置失效。
- 响应长时间等待或不是渐进输出：先比较后台的“首字输出”和“平均延迟”。首字慢表示上游开始返回内容较晚；首字接近总耗时且形态为“单块”通常表示上游链路缓冲，不是浏览器漏渲染。只有多个真实 delta 才会显示为“渐进”，不要通过前端 typewriter 动画掩盖缓冲。
- provider busy：先检查该 provider 的 `concurrency`、`maxConcurrent`、等待上限与近期真实任务。确认业务容量后再调高 bounded 容量、降低优先级或临时停用 provider；不要通过主动 completion 判断是否恢复。
- 用户无法登录：确认用户未暂停、访问码 label 与用户配置一致，并检查登录限流倒计时。
- 页面仍是旧版本：等待 PWA 更新提示并点击“立即刷新”；用 `/release.json` 判断生产版本，不以浏览器缓存内容为准。
- 云端同步冲突：系统会保留云端新版，并把当前设备内容创建为“此设备副本”，不要手工覆盖原会话。
- 已删除会话重新出现：先确认生产版本；当前版本会取消前端保存队列，并用单会话墓碑与账户级删除时间线拒绝旧设备数据。不要通过清空墓碑解决同步问题。
- 核心健康异常：先检查 KV 和 Durable Object 绑定，再检查至少一条启用线路。首次部署没有成员访问码时属于正常引导状态，应使用管理员后台创建首个成员。

## 后台 provider 密钥

首次启用时，在可信环境运行以下命令生成 32 字节随机主密钥：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

把输出仅保存到 GitHub Secret `ROUTE_KEYS_MASTER_KEY`，通过 `Deploy to Cloudflare` 发布一次。不要把主密钥写入 `.env`、任务文档、issue、聊天记录或截图。

之后的普通 provider key 操作不需要重新部署：

1. 在 `/admin.html` 打开“服务商池”，填写稳定的 `API Key Ref`。provider 保存 endpoint、协议和 credential；offering 只保存 `providerId` 与上游 model，不复制密钥。
2. 在“后台服务商密钥”中输入新 key 并保存。输入框会立即清空，后台只显示配置来源和更新时间。
3. 保存后可直接拉取完整模型列表并刷新线路状态。若需要验证真实生成，只能由用户批准并执行一个有实际用途的任务。
4. 删除托管密钥只会删除 KV 中的 AES-GCM 密文；若存在同名 Worker Secret，会自动恢复使用它。

若状态显示“无法解密”或“记录损坏”，不要复制 KV 内容排查，也不要尝试记录密文。确认主密钥是否被更换，然后删除该托管项并重新录入。托管密钥的优先级高于同名 Worker Secret；损坏的托管项不会静默回退到另一个值。

## 密钥轮换

1. 普通上游 provider key：直接在管理后台替换并立即运行模型拉取与状态刷新，不需要部署。
2. `ADMIN_TOKEN`、`ROUTES_CONFIG`、兼容用 `WORKER_SECRETS_JSON`：在 GitHub Secrets 更新后运行 `Deploy to Cloudflare`；preflight 会在上传前拒绝缺失或结构错误的配置。生产 `ACCESS_CODES` 不再放入 GitHub，管理员在 `/react-chat/admin` 中创建或轮换并写入 KV。
3. `ROUTE_KEYS_MASTER_KEY`：更换后旧托管密钥无法解密。先记录需要重新录入的 `apiKeyRef` 名称，再更新 GitHub Secret、通过 Actions 发布，并在后台逐条重新录入 provider key。
4. 验证工作流、生产 smoke、模型拉取和状态刷新成功；如需验证生成能力，使用用户批准的真实任务。
5. 轮换访问码会使对应 label 的现有登录会话失效；轮换管理员 Token 会使全部旧后台会话在下一次请求时失效。
6. 不把真实访问码、上游 Key、管理员 Token、主密钥或完整 Secret JSON 写入 issue、日志、截图和仓库文件。

`wrangler deploy --secrets-file` 只新增或覆盖本次提供的值，不删除远端已有 Worker Secret。从 GitHub Secrets 或 `WORKER_SECRETS_JSON` 移除 key 后，必须先停止线路引用，再到 Cloudflare Dashboard 的 Worker Variables and Secrets 显式删除远端值，最后重新运行部署与 smoke；只删 GitHub Secret 不构成撤销。

## 旧 route 配置迁移

旧式 route 的 `type`、`baseUrl`、`model`、`apiKeyRef` 仍会被投影为 `legacy:<routeId>` 的单一 `unlimited` provider，不需要紧急修改生产 Secret。旧明文 `apiKey` 只在服务端兼容保存，管理 API 和页面永不回显。执行显式迁移前，必须确认原 `apiKeyRef` 已对应后台托管密钥或同名 Worker Secret；迁移操作只保存该引用并删除旧内嵌 key，绝不会读取或复制明文。随后核对逻辑模型 fallback、成员 `defaultRoute` / `allowedRoutes` 并观察真实任务遥测。迁移期间保留可回滚的旧配置；不要通过更换 Worker 名、KV ID 或 Cloudflare Account 做配置回滚。

## 回滚

使用 Git 创建反向提交并推送 `main`，让相同的测试和生产门禁执行：

```bash
git revert <bad-commit-sha>
git push origin main
```

不要使用 `git reset --hard` 改写共享历史，也不要从本机直接覆盖 Worker。回滚时保持三项实例 Variables 不变，并以 `/release.json` 和精确 SHA smoke 为准。Durable Object migration tag 只能追加，代码回滚不会自动回滚已经执行的数据 schema。

## 数据与备份

- 用户可在设置中下载经过脱敏的用户数据 JSON。导出包含成员标签、长期记忆、会话元数据、文本和文件名/类型，不包含访问码、provider/admin 配置、原始工具载荷或文件 URL；附件最多 5 MB、单会话最多 512 KB，超出部分保留最新消息并以 `truncated` / `messagesTruncated` 标记。手动导入使用 `restore` 语义，可恢复明确选择的旧备份；后台自动同步只使用 `merge`，不会绕过删除时间线。
- 用户可删除本机缓存、退出所有设备或永久删除全部数据。永久删除会清除对话、摘要、记忆、反馈、用量和指标，注销全部设备，并阻止删除前的本地副本回流。
- 长期记忆可由用户或管理员查看和编辑。
- provider/逻辑模型等后台覆盖保存在 KV，删除后按各配置的兼容来源恢复；生产成员访问码由 KV 托管，删除后不会回退到 GitHub/Worker `ACCESS_CODES`，空值表示等待管理员创建首个成员。后台 provider key 以 AES-GCM 密文单独保存在 KV，主密钥只存在于 Worker Secret。
- 根 `TeamAgent` 保存会话索引、权威长期记忆、迁移标记和删除清理状态；对话 `TeamAgent` 保存消息、流和审批状态。`UserState` 与旧 KV 记录在迁移验收前继续作为导入/回滚来源。
- SQLite 表通过构造器中的幂等 `CREATE TABLE IF NOT EXISTS` 升级；新增或重命名 Durable Object 类绑定时才增加 Wrangler migration tag，任何已经上线的 tag 都不能修改。
- 当前没有把 KV/DO 跨账号复制为另一实例的自动迁移命令。不要通过替换 `CHATUS_KV_NAMESPACE_ID` 或 `CHATUS_WORKER_NAME` 尝试恢复数据；先保留原实例并做专门迁移与对账。

## 开发流程

- 当前仓库已启用 Trellis Codex 集成。复杂改动应在 `.trellis/tasks/` 保存需求、设计、执行和验收上下文，并在修改前读取相应 `.trellis/spec/`。
- Codex 项目命令与 hooks 在任务启动时加载；初始化或更新 `.codex/` 后需要重新打开项目任务。`/hooks` 用于查看审批状态，Trellis 工作流能力通过项目级 Trellis 命令或 `$trellis-*` 技能调用。
- 本文件继续作为生产运行手册；Trellis 负责任务过程和可复用工程规范，不在两处重复维护同一操作步骤。
