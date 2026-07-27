# Implementation Plan: Chatus 季度体验与治理优化计划

## Ordered Checklist

- [ ] 逐个完成 8 个子任务的规划收敛，确认依赖和 AC。
- [ ] 按 1 到 8 的顺序激活子任务；父任务保持 planning，直到最终审计。
- [ ] 每个实现型子任务：加载 `trellis-before-dev`，实现，加载 `trellis-check`，修复到绿色。
- [ ] 每个实现型子任务按影响路径运行浏览器测试，并运行五项全量 shipping checks。
- [ ] 每个子任务加载 `trellis-update-spec`，提交工作 commit，通过 PR 进入 main，再归档。
- [ ] 子任务 8 只提交设计与风险登记，禁止加入运行时代码。
- [ ] 全部子任务归档后激活父任务，运行任务树一致性和全量项目验证。
- [ ] 生成最终 requirement-to-evidence 审计，提交父任务记录并归档。

## Validation Baseline

```text
npm run check:frontend
npm test
npm run typecheck
npx wrangler deploy --dry-run
git diff --check
npm run test:browser:workspace   # frontend/workspace 影响路径
npm run test:browser:agent       # Agent/provider 影响路径
```

## Review Gates

- 子任务规划 gate：三个文档完整、无 `TBD`、AC 可测试、依赖显式。
- 子任务实现 gate：只改本任务范围，测试不调用 live Provider/MCP/production。
- 子任务提交 gate：工作 commit 与 PR 证据存在，spec 判断完成。
- 子任务 archive gate：AC、验证、commit、children、waiver 和任务索引一致。
- 父任务 gate：8 子任务均完成，最终全量检查和证据矩阵无缺口。

## Rollback Points

- 每个子任务以独立工作 commit/PR 为回滚单元。
- 发现跨任务设计缺陷时回到对应子任务规划，不在后续子任务偷偷修补契约。
- 外部生产状态只能由 GitHub Actions workflow 改变。

