# CI 与交付治理强化

## Goal

让 PR CI、main 部署和生产验收的结构、超时、路径影响、精确 SHA 与 artifact 约束都能被机器解析和回归测试，避免 workflow 文本看似存在但层级、顺序或条件已经失效，并确保只有真正的文档和 Trellis 记录可以跳过生产部署。

## Background

- `.github/workflows/ci.yml` 的四个 job 和 `.github/workflows/deploy.yml` 的三个 job 都没有 `timeout-minutes`；仅生产验收 job 已有 15 分钟上限。
- `tests/delivery-governance.test.ts` 主要使用字符串包含和计数断言，不能发现 YAML 解析失败、重复键、字段挂错层级、条件接错 job 或关键步骤顺序漂移。
- `scripts/classify-ci-paths.mjs` 将 `.trellis/tasks/**`、`.trellis/spec/**` 和 `.trellis/workspace/**` 下的任意文件都视为记录，导致其中的 `.js`、`.ts`、`.py` 或其他未知可执行内容可能错误跳过部署。
- CI 自身的 workflow、路径分类器和交付治理测试没有稳定触发两套 Playwright，因此修改门禁时可能没有验证门禁所控制的浏览器作业。
- main 部署有两段正确的 remote-main SHA guard，但实现以内联 shell 重复，当前测试只统计命令文本出现两次，不能证明比较严格、空 SHA fail closed 或两个 guard 位于生产 mutation/deploy 之前。
- 路径分类 artifact 缺少 `if-no-files-found: error`；现有测试也没有逐个校验 exact-SHA 命名、路径、保留期和失败证据策略。
- 2026-08-04 的 GitHub Actions run 对 `actions/upload-artifact@v4` 报告 Node 20 弃用警告。GitHub 官方 action 定义已提供 Node 24 的 `actions/checkout@v7`、`actions/setup-node@v7` 和 `actions/upload-artifact@v7`。

## Requirements

- R1. 使用声明的 YAML 解析依赖读取 `ci.yml`、`deploy.yml` 和 `production-acceptance.yml`。解析必须拒绝语法错误和重复键；测试通过结构访问 job、step、`needs`、`if`、`timeout-minutes`、`uses` 和 `with`，而不是依赖原始字符串位置。
- R2. 每个可执行 job 都有明确且有界的超时：快速分类/skip job 不超过 5 分钟，quality 不超过 20 分钟，浏览器 job 不超过 20 分钟，deploy 不超过 30 分钟，生产验收保持 15 分钟。
- R3. docs-only 分类使用有限白名单。全局 Markdown 和 `docs/**` 下批准的文档资产可以跳过部署；`.trellis/tasks/**`、`.trellis/spec/**`、`.trellis/workspace/**` 仅允许当前追踪的 `.md`、`.json`、`.jsonl` 记录类型。其他 Trellis 文件、未知扩展和可执行内容 fail closed 为代码变更。
- R4. `client/**` 继续触发 Workspace 与 fake-Provider Agent Playwright，`src/**` 继续触发 Agent Playwright；CI/deploy workflow、分类器及其治理测试变更必须触发两套浏览器验证。路径规范化、去重、排序和空输入行为保持确定性。
- R5. 结构化测试精确断言 `quality` 永远依赖分类结果并运行五项基础门禁；Workspace/Agent jobs 必须分别依赖 `changes` 且绑定对应 output，不能因 YAML 层级漂移而无条件运行或静默跳过。
- R6. 将 remote-main SHA 校验抽为可单测脚本。它必须拒绝缺失/非法 expected SHA、命令失败、空或歧义 remote 输出以及任何不相等结果。部署 workflow 在资源 provisioning/secret preparation 前运行一次，并在 `wrangler deploy` 紧前再次运行；`workflow_dispatch` 不能绕过。
- R7. 每个 path classification、quality、Playwright、deployment 和 acceptance artifact 都使用 exact `${{ github.sha }}` 名称、明确路径、`if-no-files-found: error` 与规定保留期。失败证据类 manifest/Playwright 上传保持 `if: always()`。
- R8. GitHub 官方 JavaScript actions 使用经官方定义确认的 Node 24 major：`actions/checkout@v7`、`actions/setup-node@v7`、`actions/upload-artifact@v7`。结构化测试拒绝旧 major 和未批准的浮动引用。
- R9. 保持非取消的生产 mutation concurrency、完整历史 checkout、PR 禁止生产 smoke/acceptance、main exact-SHA production verification、docs/Trellis-only skip summary 和 0.x SemVer。
- R10. 所有验证只使用本地 fake Provider/MCP 与静态 workflow fixtures；禁止 live model、真实 MCP、synthetic production probe、本地生产部署或读取生产数据。生产发布仍只能由 GitHub Actions 完成。

## Acceptance Criteria

- [x] AC1. 三份 workflow 均通过 YAML 结构解析；重复键、缺失 job、错误 `needs`/`if`、缺失命令或 step 顺序漂移会使 Vitest 失败。
- [x] AC2. CI、deploy 与 production acceptance 的所有 job 都有符合 R2 上限的 `timeout-minutes`，部署重试仍受 deploy job 总超时约束。
- [x] AC3. 路径分类表驱动测试覆盖正斜杠/反斜杠、`./`、重复项、空输入、混合变更、每类边界文件、合法 Trellis records 与 Trellis 可执行/未知扩展；未知项不会得到 docs-only skip。
- [x] AC4. workflow、分类器和交付治理测试自身的变更触发 Workspace 与 fake-Provider Agent Playwright；结构化断言证明两个 browser job 的 `needs` 和 `if` 精确连接 `changes` outputs。
- [x] AC5. stale-main helper 的 match、mismatch、empty、ambiguous、invalid 和 command-failure deterministic tests 通过；workflow 结构证明两个 guard 分别位于首次生产 mutation 前和 `Deploy Worker` 紧前。
- [x] AC6. 每个治理 artifact 的 exact-SHA 名称、路径、missing-file 策略、`always()` 策略和保留期都有结构化断言；manifest 仍只包含批准的非敏感字段。
- [x] AC7. 三份 workflow 只使用批准的 Node 24 GitHub action majors，GitHub CI 不再产生本任务针对的 Node 20 action runtime warning。
- [x] AC8. `npm run check:frontend`、全量 Vitest、typecheck、Wrangler dry-run、Workspace Playwright、fake-Provider Agent Playwright、`git diff --check`、Trellis 全量一致性与 Trellis 单测全部通过。
- [x] AC9. PR CI 在 exact head SHA 上按影响路径通过并保留 artifacts；合并后的 exact main SHA 由 GitHub Actions 部署和验证，Trellis/docs-only 记录提交继续明确跳过部署。

## Out Of Scope

- 不把第三方 action 全部改为 commit-SHA pin；本任务使用官方 action 的批准 major 并通过 allowlist 防回退，immutable pinning 作为独立供应链策略处理。
- 不改变业务测试内容、Cloudflare 资源模型、生产 acceptance 的临时成员流程或部署重试次数。
- 不把 production smoke/acceptance 移入 PR CI，不增加 live Provider/MCP 探针。
