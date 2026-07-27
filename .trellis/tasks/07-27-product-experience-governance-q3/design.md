# Design: Chatus 季度体验与治理优化计划

## Task Tree Boundary

父任务是需求和审计边界，不作为代码分支。每个子任务拥有独立 AC、技术设计、实现计划、验证记录、spec 更新、工作 commit 和归档。依赖顺序写进子任务文档，不靠目录树隐式表达。

## Delivery Phases

1. Phase 1 先建立可信交付门禁，再修复管理员可靠性，最后利用稳定后台完成首次配置闭环。
2. Phase 2 先引入不可变文件版本和 R2/SQLite 元数据，再在这些版本之上增加异步解析。
3. Phase 3 先扩展会话 Skill 模式，再扩展 MCP 成员授权；两者都复用既有 logical model、telemetry 和工具确认边界。
4. Phase 4 只做三项后续设计，阻止未定权限、成本和灾备语义渗入本季度实现。

## Cross-Cutting Contracts

- Security: secret、token、access code、对话和记忆不得进入日志、browser persistence、导出或 artifact。
- Identity: 文件、解析、Skill、MCP 均以现有 member/root TeamAgent 范围作为数据所有权边界。
- Versions: 文件对象和会话引用固定不可变 version；schema/config 漂移通过显式状态和重审处理。
- Operations: R2、Queue、SQLite 之间不存在跨服务事务，使用状态机、幂等 key、generation 和 outbox/reconciliation 恢复。
- Tests: Worker/API 用 Vitest Cloudflare pool，浏览器用本地 fixture/fake Provider/MCP；production acceptance 只由 GitHub Actions 运行。
- Release: code PR 合并到 main 后自动部署；docs/Trellis-only commit 由路径分类跳过部署。

## Evidence Model

每个子任务归档前记录：AC checklist、验证命令和结果、工作 commit、PR URL/merge SHA、spec 更新或无更新判断、waiver（如有）。父任务最终读取所有 8 个子任务的 active/archive 元数据并生成逐项证据矩阵。

## Rollback Strategy

- 门禁与后台改动用独立 PR，可回滚合并 commit。
- R2、Queue、schema 改动采用 additive migration 和 feature-disabled fallback；回滚代码不得删除已上传对象或破坏 tombstone。
- Automatic Skill 和 OAuth MCP 均有 manual/disabled 回退，旧会话和未授权成员保持原行为。
- 设计型文档只改变决策记录，不改变运行时。

