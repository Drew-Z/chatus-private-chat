# Automatic Skill 选择

## Goal

让新成员会话默认按消息自动选择最多 3 个已授权 Skill，同时保持旧会话的手工语义、访客禁用、用户配额只计一次，并让选择过程和结果可观察、可回退。

## Requirements

- R1. 会话新增 `skillMode: automatic | manual`；新成员会话默认 automatic，旧会话/legacy import 默认 manual，访客强制 manual 且 `skillIds=[]`。
- R2. manual 保持现有精确 `skillIds` 行为；automatic 每轮临时选择，不用结果覆盖持久 manual/fallback snapshot。
- R3. selector 使用主回答同一 logical model，不跨 logical route fallback；可在该 route 的 offering 内按现有 Provider 策略尝试。
- R4. selector 总时限 <=5 秒、输出 <=200 tokens、无 tools、结构化 `{skillIds:string[]}`、最多 3 项。
- R5. 候选和结果都重新校验 enabled、member assignment、去重和管理员排序；撤权竞态不能进入 prompt/tools。
- R6. selector 不重复计算用户消息配额，但每个 Provider attempt 记录独立 `skill_selection` telemetry，不污染主回答可靠性/成本口径。
- R7. timeout、provider、空响应、invalid JSON 或无合法项时，先用重新校验的上次成功选择；不存在时用管理员排序前三项。
- R8. 选择结果在当前会话/回答 UI 可见，明确标注 automatic、fallback 原因和实际启用 Skill，不暴露 prompt/Provider secret。
- R9. branch/export/import/hydration 明确保留 mode；旧 schema 幂等迁移为 manual。

## Acceptance Criteria

- [ ] AC1. 旧 SQLite row/legacy import 迁移为 manual；新成员 create 为 automatic；访客 create/PATCH automatic 被服务端拒绝或规范化为 manual empty。
- [ ] AC2. selector 只使用当前 logical route、maxTokens=200、无 tools，并在 lease wait + provider 请求总计 5 秒内取消。
- [ ] AC3. 合法 JSON 最多选择 3 个；未知、重复、未授权、disabled 和竞态撤权 Skill 不进入最终 prompt/tools。
- [ ] AC4. selector + 主回答产生两类 Provider telemetry，但用户日/分钟配额只增加一次，continuation 不重复 admission。
- [ ] AC5. timeout/empty/malformed/provider failure 均不阻断主回答；按“重新校验上次选择 -> 管理员前三项”顺序回退。
- [ ] AC6. API 与 UI 显示本轮实际选择和 fallback 来源；manual UI 仍可精确选择/清空。
- [ ] AC7. branch/import/export/client hydration 覆盖 automatic/manual 兼容语义。
- [ ] AC8. fake Provider Agent、Workspace Playwright 和五项全量验证通过。

## Out of Scope

- 不训练独立分类模型，不为访客启用 automatic，不把 selector 选择记为用户消息额度。
