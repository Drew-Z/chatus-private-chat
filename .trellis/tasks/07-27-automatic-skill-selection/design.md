# Design: Automatic Skill 选择

## Schema and Migration

`chatus_conversations` 增加 `skill_mode TEXT NOT NULL DEFAULT 'manual'`，应用级 upgrader 对既有 DB 幂等加列。create boundary 对新 member 显式写 automatic；guest、legacy import 和旧 row 为 manual。持久 `skill_ids` 在 manual 是选择，在 automatic 是经验证的 fallback snapshot；本轮结果单独保存在 response/telemetry metadata，不改会话设置。

## Selector Pipeline

1. 对当前 member 取 enabled/assigned Skill，管理员 `order,id` 排序。
2. 若无候选则返回空选择，不调用 Provider。
3. 使用当前 logical route 的 selector helper，禁止 logical route fallback，允许 route 内 offering fallback。
4. 5 秒 AbortController 覆盖 lease acquisition 和 generateText；`maxTokens=200`、`maxRetries=0`、无 tools。
5. 严格解析 JSON，去重、最多 3、再次通过 `getSelectedSkills` 校验。
6. 成功保存 last-success snapshot；失败重新校验 last-success，不存在则排序前三项。
7. 主 turn 在最终 prompt/tools 构建前再校验一次。

## Quota and Telemetry

selector 用 `consumeQuota:false`，主 turn 保持唯一一次 `admitTurn`。route reliability/event 增加 operation/purpose=`skill_selection`，每个 offering attempt 保留 latency/fallback/error，但主回答聚合默认排除 selector。

## Visibility

Agent response metadata 和会话 UI 展示本轮 `mode`、selected public skill ids/labels、source=`model|last_success|admin_default`。不展示 selector prompt、raw response 或 provider credentials。

## Compatibility and Rollback

旧客户端缺 mode 时服务端按既有会话值；manual 行为不变。功能回滚可将新会话默认恢复 manual，既有 automatic 会话可由 schema 继续读取并按 manual fallback 安全降级。

