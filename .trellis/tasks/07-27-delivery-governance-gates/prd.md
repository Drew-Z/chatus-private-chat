# PR CI 与 Trellis 交付门禁

## Goal

在代码进入 `main` 前建立稳定、可追踪的 PR 门禁，并让部署、生产验收和 Trellis 归档都能证明准确的 commit、验证与任务状态。

## Background

- `.github/workflows/` 目前只有 main 部署和手工生产验收，没有 `pull_request` workflow。
- main 部署已有 stale SHA 防护、release metadata 和 production smoke，但没有可保留的构建/验收 artifact。
- `task.py archive` 当前不校验 AC、验证、work commit、waiver、未完成子任务或全量父子索引一致性。
- `.trellis/workspace/index.md` 与实际开发者索引漂移。

## Requirements

- R1. 新增稳定命名的 PR CI，执行 frontend check、Vitest、typecheck、Wrangler dry-run 和 diff check。
- R2. 基于影响路径运行 Workspace Playwright 和本地 fake Provider Agent；稳定 job 不因条件跳过而从 branch protection 消失。
- R3. 测试仅使用本地 fixture/fake Provider，不调用 live model、production 或 synthetic production probe。
- R4. main 合并后自动部署；docs/Trellis-only commit 明确跳过部署并留下判定证据。
- R5. 部署和生产验收记录准确 SHA，保留不含 secret 的 build/test/acceptance artifacts；production acceptance 继续受保护且只在 GitHub Actions 运行。
- R6. Trellis archive 前校验：无未完成 AC/TBD、验证记录存在、work commit 可解析、children 已完成、父子引用一致、无重复/循环/孤儿、归档目标不冲突。
- R7. waiver 是结构化持久字段，至少包含 gate id、reason、approver 和时间；无 waiver 不得绕过门禁。
- R8. 修复 workspace 根索引漂移并新增全量 task/workspace 一致性验证。
- R9. 保持当前 0.x SemVer，不把门禁变更宣称为 1.0 稳定发布。

## Acceptance Criteria

- [ ] AC1. `pull_request` 触发的 CI 有稳定基础 job，五项命令失败会阻断 PR。
- [ ] AC2. 路径分类单测覆盖 frontend/workspace、Agent/provider、共享配置和 docs/Trellis-only；两类 Playwright 只在对应影响路径运行。
- [ ] AC3. main workflow 对 code merge 自动部署，对 docs/Trellis-only 清晰跳过；部署仍保留 stale-main 和串行保护。
- [ ] AC4. workflow artifacts 含 commit SHA、lockfile/bundle 摘要、测试或生产验收摘要与失败诊断，不含凭据、Wrangler state 或用户内容。
- [ ] AC5. archive 对每个 R6 条件都有通过与拒绝测试，失败不会移动任务目录或写 completed 状态。
- [ ] AC6. 结构化 waiver 被 task 元数据持久化、校验并进入审计输出；自由文本不能绕过门禁。
- [ ] AC7. 全量一致性命令能发现父子反向引用、重复/循环、active/archive 冲突和 workspace 根索引漂移。
- [ ] AC8. 相关 deployment contract、Trellis Python 测试和五项全量验证全部通过。

## Out of Scope

- 不从本机部署生产，不自动运行 live production acceptance。
- 不在此任务实现其他季度产品功能。

