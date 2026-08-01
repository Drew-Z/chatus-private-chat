# Chatus 季度体验与治理优化计划

## Goal

在不触碰线上模型和本地生产部署的前提下，完成 Chatus 本季度交付治理、管理员体验、首次配置、文件工作区、文档解析、Skill 自动选择和 OAuth MCP 能力，并用 8 个可独立验收的子任务留下可追踪的 PR、验证、规范和归档证据。

## Background

- 仓库当前从 `main` 自动部署，但没有 pull request CI。
- React 管理后台已覆盖多数日常配置，但仍有退出、错误恢复、长列表和 legacy 后台入口问题。
- 当前文件仅以内联 UTF-8 文本附件存在，没有 R2 工作区、异步解析或稳定文件版本。
- 当前 Skill 是手工分配，MCP 没有成员级 OAuth 授权闭环。
- 生产只能经 GitHub Actions；所有自动化测试必须使用本地 fake Provider/MCP。

## Requirements

- R1. 所有代码变更通过 PR；文档和 Trellis 记录可以直接提交。PR、部署、生产验收和 commit SHA 可追踪，保留非敏感 artifacts。
- R2. 按以下顺序完成 8 个子任务，每个子任务独立执行规划、before-dev、实现、check、全量验证、spec 更新、提交和归档：
  1. `07-27-delivery-governance-gates`
  2. `07-27-admin-safety-recovery`
  3. `07-27-first-setup-admin-closure`
  4. `07-27-r2-file-workspace`
  5. `07-27-async-document-ingest`
  6. `07-27-automatic-skill-selection`
  7. `07-27-oauth-mcp-governance`
  8. `07-27-q3-followup-design-decisions`
- R3. 第一阶段完成交付门禁、管理员可靠性和首次配置闭环；第二阶段完成 R2 文件工作区和异步 PDF/Office 解析；第三阶段完成 Automatic Skill 和 OAuth MCP；最后仅形成三份后续设计决策，不实现其产品功能。
- R4. 保持 0.x SemVer；任何版本或迁移设计不得暗示 1.0 稳定性承诺。
- R5. 不打印或提交访问码、API key、token、对话内容和已存记忆。
- R6. 禁止 live model、synthetic production probe、本地生产部署和本地 Wrangler 生产账号部署。
- R7. 每个代码子任务在归档前必须执行 `npm run check:frontend`、`npm test`、`npm run typecheck`、`npx wrangler deploy --dry-run` 和 `git diff --check`，并按影响路径运行 Workspace Playwright 与本地 fake Provider Agent 测试。
- R8. 父任务不承载产品代码；它在全部子任务完成后负责跨任务集成复核和逐项证据审计。

## Acceptance Criteria

- [x] AC1. 8 个子任务均有收敛后的 `prd.md`、`design.md` 和 `implement.md`，且父子关系双向一致。
- [x] AC2. 7 个实现型子任务均有工作 commit、PR/合并证据、完整验证记录、spec 判断和成功归档记录。
- [x] AC3. 设计型子任务产生三份明确的决策文档和风险登记，不包含未经批准的功能实现。
- [x] AC4. 所有子任务的 AC 均完成或存在结构化、持久化、可审计的 waiver；父任务没有未解释的失败检查。
- [x] AC5. main 部署与生产验收只由 GitHub Actions 运行，并能从部署/验收记录追溯到准确 SHA 和 artifacts。
- [x] AC6. 最终全量验证全部通过；任何跳过项都有路径分类或环境原因证据，且不是 live model/production 规避。
- [x] AC7. 最终审计逐项映射本 PRD 的 R1-R8 和每个子任务 AC 到 commit、PR、测试、spec 和归档证据。

## Out of Scope

- 不在本父任务直接实现产品代码。
- 不实现成员分享/转交/ACL、Provider cost/budget/feedback、实例备份恢复和 legacy 退役；这些只进入子任务 8 的设计与风险登记。
- 不使用真实 Provider、真实 OAuth MCP 或生产用户数据做测试。
