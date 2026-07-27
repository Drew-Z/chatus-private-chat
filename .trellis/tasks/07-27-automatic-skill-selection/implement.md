# Implementation Plan: Automatic Skill 选择

## Ordered Checklist

- [ ] 加载 Agent streaming、capability、quota、telemetry specs。
- [ ] 为 schema upgrade、create/PATCH/branch/import/export/guest 边界先写测试。
- [ ] 增加 skillMode contracts、SQLite migration 和客户端 hydration/UI。
- [ ] 实现 selector helper、5 秒全链路 abort、200 token/无 tools/同 logical route 限制。
- [ ] 实现结构化校验、last-success/admin-order fallback 和 turn 前二次撤权过滤。
- [ ] 增加 selector purpose telemetry，并证明用户 quota 只计一次。
- [ ] 展示本轮选择和 fallback 来源，保留 manual 编辑。
- [ ] 用 fake Provider 覆盖成功、offering fallback、timeout、malformed、撤权竞态和主回答继续。
- [ ] 运行 `trellis-check`、两类浏览器测试和五项全量验证。
- [ ] 更新 Agent/capability/telemetry specs，记录验证、提交、PR、合并并归档。

## Risky Files

- `src/contracts/agent.ts`
- `src/agent/team-agent.ts`
- `src/worker.ts`
- `src/services/provider-router.ts`
- `src/services/route-reliability.ts`

## Rollback Points

- schema/contract、selector、UI/telemetry 分开提交。
- selector 故障必须回退 Skill 选择，不能让主 turn 整体失败。
