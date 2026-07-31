# Implementation Plan: 异步 PDF Office 文档解析

## Ordered Checklist

- [x] 加载 file/persistence/deployment specs，完成 parser Workers/安全研究并写入 `research/`。
- [x] 用小型正常和恶意 fixtures 对候选库做本地实验与 Wrangler dry-run，再锁定依赖。
- [x] 增加 Queue/DLQ bindings、Env 类型、deployment config 和 consumer 契约测试。
- [x] 先写状态机、generation、retry/DLQ、delete race 和 quota 边界测试。
- [x] 实现格式 gate、受限 text/PDF/OOXML 解析和资源限制。
- [x] 实现 producer、consumer、DLQ consumer、人工 retry 和幂等状态更新。
- [x] 接入 workspace 状态 UI、retry 及 turn exact-version text resolver。
- [x] 扩展账户/文件删除，覆盖 queued/extracting 竞态。
- [x] 运行恶意 fixture suite、`trellis-check`、两类浏览器测试和五项全量验证。
- [ ] 更新 document security/queue specs，记录验证、提交、PR、合并并归档。

## Validation Evidence

- `npm run check:frontend`: passed; Vite production client and structural checks.
- `npm test`: passed, 38 files / 467 tests.
- `npm run test:browser:workspace`: passed, 67 passed / 33 skipped across five viewports.
- `npm run test:browser:agent`: passed, 1 local fake-Provider Agent test.
- `npm run typecheck`: passed for Worker, React client, and browser tests.
- `npx wrangler deploy --dry-run`: passed, 6373.10 KiB / gzip 1293.30 KiB.
- `git diff --check`: passed.
- `python ./.trellis/scripts/task.py validate-all`: repository consistency OK.

## Risky Files

- `wrangler.jsonc`
- `src/index.ts`
- `src/worker.ts`
- `src/agent/team-agent.ts`
- parser modules and fixtures

## Rollback Points

- binding/state machine、parser、UI 分开提交。
- 未完成 Workers 与恶意文档 gate 不安装 parser 依赖，不把格式标成 supported。
