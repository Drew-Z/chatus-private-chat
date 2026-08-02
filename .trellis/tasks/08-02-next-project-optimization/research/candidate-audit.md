# 下一轮优化候选审计

## 审计结论

当前仓库没有残留 `TODO`/`FIXME`、无条件跳过测试或已知红色门禁；上一轮 8 个交付均已归档。因此下一轮不应做无目标清理，而应修复现有绿色测试未覆盖的真实边界。四份独立只读审计分别检查了产品体验、质量门禁、安全/运维和性能维护热点。

## 候选矩阵

| 候选 | 当前缺口与证据 | 用户/项目价值 | 风险与工作量 | 确定性验收 |
| --- | --- | --- | --- | --- |
| C1. 成员退出登录 fail-closed | `client/src/lib/api.ts:1081-1083` 吞掉网络错误且不检查 HTTP/JSON；`client/src/App.tsx:79-83` 无条件刷新状态；`client/src/components/ChatWorkspace.tsx:309-314` 在服务端确认前清理草稿。Worker `src/worker.ts:2089-2103` 已等待 session 删除成功后才清 cookie。现有严格测试只覆盖 admin logout（`tests/client-api.test.ts:219-270`）。 | 修复共享设备上的错误安全预期；退出失败时保留工作区和草稿，给出可重试反馈。两份独立审计均识别此缺口。 | S-M；低迁移风险，涉及 client API、App/Workspace 状态和 focused tests。 | network、4xx/5xx、空/非 JSON、`ok:false`、额外字段全部保持认证态和草稿；精确 `{ok:true}` 才离开；Worker KV delete 失败无 clearing cookie。 |
| C2. 配额感知 Composer | `/api/session` 已返回实时 usage（`src/worker.ts:2512-2528`），侧栏只显示启动时快照（`ConversationSidebar.tsx:361-365`）；Composer/send gate 不检查剩余额度（`MessageComposer.tsx:72-78`, `ChatWorkspace.tsx:710-724`）。服务端 429 已带 scope/reset/Retry-After（`src/worker.ts:5605-5620`）。 | 避免额度为 0 时仍允许提交；让日限额和分钟限流具有可操作解释且不丢草稿。 | M；需要明确 session 刷新所有权和 429 投影。 | 成功一轮后 remaining 从 1 刷新为 0；发送禁用但草稿可编辑；minute/daily 显示不同重试文案。 |
| C3. R2/Queue 被动 readiness | `/healthz` 与 setup health 仅检查 KV/DO/config（`src/worker.ts:1721-1758,2440-2452`）；production smoke 只断言 `kv/durableObject/configured`（`scripts/smoke-production.mjs:31-41`），未覆盖已经支持的 R2 与 document queue bindings。 | 避免部署后首次上传/解析才发现 binding 或 queue-name 漂移；不需要生产 canary 或模型探针。 | S-M；运维语义需明确只能声明 configured/readable，不能声称 Queue 端到端 healthy。 | 固定 sentinel 的只读 R2 `head`；producer/name 配置检查；失败 503/setup incomplete；零 Queue send、零 Provider 调用、响应不泄露资源名。 |
| C4. React 会话置顶/取消置顶 | 列表投影已有 `pinned` 且 Root SQL 已按 pinned 排序（`client/src/lib/api.ts:590-597`, `src/agent/team-agent.ts:496-505`），但 React 无操作，PATCH contract 也省略 pinned（`ConversationSidebar.tsx:251-267`, `client/src/lib/api.ts:1108-1115`, `src/contracts/agent.ts:97-104`）。 | 恢复 legacy 已有的高频会话组织能力；范围清晰、可见价值直接。 | M；涉及 revision-checked contract、UI 排序与冲突恢复。 | pin 后立即排到未置顶前；unpin 恢复 updatedAt 排序；409 可见且可重试；390px/键盘可用。 |
| C5. CI 路径分类 fail-closed | classifier 对未知可执行路径默认 `workspace=false, agent=false`，且任意 `.md` 可成为 docs-only（`scripts/classify-ci-paths.mjs:5-65`）；浏览器 job 完全依赖该分类（`.github/workflows/ci.yml:105-150`）；测试只覆盖少量手选路径（`tests/delivery-governance.test.ts:24-95`）。 | 防止新增脚本、workflow 或运行时静态 Markdown 绕过两类浏览器门禁。 | M；会增加 CI 分钟，workflow 变更风险高于产品局部修复。 | 未知 executable/runtime 默认触发两套 browser；`public/**`/`client/**` Markdown 不得 docs-only；解析 YAML 并用 mutation fixtures 证明关键步骤缺失必失败。 |
| C6. 分离 Node 与 Workers Vitest 项目 | 全部 40 个测试文件使用 Cloudflare pool 且 `maxWorkers:1`（`vitest.config.ts:4-23`）；审计估算仅 8 文件/157 tests 依赖 Workers，32 文件/248 tests 是纯逻辑。 | 缩短本地和 CI 反馈时间，把 Windows Miniflare 串行限制局部化。 | M；主要风险是测试分类遗漏或 Node/Workers 环境差异。 | 两项目总测试数不丢失；Workers 继续串行且无随机 forbidden-port；三次中位耗时有可测改善。 |

## 推荐顺序

1. **C1 成员退出登录 fail-closed**：安全与体验同时受益，事实明确，范围最小，可复用已验证的 admin logout exact-decoder 模式，不依赖未来产品决策。
2. **C3 R2/Queue 被动 readiness**：小到中等投入，补齐新存储能力上线后的运维盲区。
3. **C2 配额感知 Composer**：直接产品价值，但需要先确定 session usage 的刷新/缓存边界。
4. C4 会话置顶：清晰的功能补齐，但风险低于 C1/C3。
5. C5 CI fail-closed：重要但会改变交付成本，适合单独治理任务。
6. C6 测试池拆分：主要是交付效率，用户价值较间接。

## 推荐本轮范围

本轮选择 C1：把成员退出登录提升到与管理员退出一致的 fail-closed 合约。原因是它修复当前真实安全语义缺口，改动面可控，能够在一个任务内完成 API exact decoder、UI pending/error/retry、草稿保留、Worker failure regression 和两类浏览器/全量门禁。

未选择的候选保留为后续任务，不与 C1 捆绑，避免把一个小而高价值的安全修复扩张成跨域优化包。
