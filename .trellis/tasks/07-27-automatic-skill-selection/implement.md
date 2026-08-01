# Implementation Plan: Automatic Skill 选择

## Ordered Checklist

- [x] 加载 Agent streaming、capability、quota、telemetry specs。
- [x] 为 schema upgrade、create/PATCH/branch/import/export/guest 边界先写测试。
- [x] 增加 skillMode contracts、SQLite migration 和客户端 hydration/UI。
- [x] 实现 selector helper、5 秒全链路 abort、200 token/无 tools/同 logical route 限制。
- [x] 实现结构化校验、last-success/admin-order fallback 和 turn 前二次撤权过滤。
- [x] 增加 selector purpose telemetry，并证明用户 quota 只计一次。
- [x] 展示本轮选择和 fallback 来源，保留 manual 编辑。
- [x] 用 fake Provider 覆盖成功、offering fallback、timeout、malformed、撤权竞态和主回答继续。
- [x] 运行 `trellis-check`、两类浏览器测试和五项全量验证。
- [x] 更新 Agent/capability/telemetry specs并记录本地验证。
- [ ] 提交、PR、合并、生产 exact-SHA 验收并归档。

## Validation Evidence

- `npm run check:frontend`: passed; Vite production client and structural source checks.
- `npm test`: passed, 38 files / 478 tests.
- `npm run test:browser:workspace`: passed, 72 passed / 33 skipped across five viewports.
- `npm run test:browser:agent`: passed, 1 local fake-Provider Agent acceptance test with isolated selector requests.
- `npm run typecheck`: passed for Worker, React client, and browser tests.
- `npx wrangler deploy --dry-run`: passed with Wrangler 4.110.0, 6391.11 KiB / gzip 1296.65 KiB; no deployment performed.
- `git diff --check`: passed with no whitespace errors.

## Risky Files

- `src/contracts/agent.ts`
- `src/agent/team-agent.ts`
- `src/worker.ts`
- `src/services/provider-router.ts`
- `src/services/route-reliability.ts`

## Rollback Points

- schema/contract、selector、UI/telemetry 分开提交。
- selector 故障必须回退 Skill 选择，不能让主 turn 整体失败。
