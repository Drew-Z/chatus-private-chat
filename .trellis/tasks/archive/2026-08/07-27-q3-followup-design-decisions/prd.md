# 季度后续设计决策

## Goal

对三个明确不在本季度实现的产品方向形成可审阅设计、决策问题和风险登记，避免未定语义污染已批准的季度实现。

## Requirements

- R1. 产出 `member-sharing-acl-design.md`：成员分享、转交、稳定 principal、角色/动作矩阵、撤权/删除/export/memory/tool trust 边界与跨 owner 一致性。
- R2. 产出 `provider-usage-cost-budget-feedback-design.md`：turn/run/attempt 归因、usage/cost 账本、价格版本/货币、预算层级与执行、feedback 防伪归因、隐私和 reconciliation。
- R3. 产出 `instance-recovery-legacy-retirement-design.md`：durable inventory、备份一致性/密钥、restore 顺序和 drill、RPO/RTO 测量方法、各 legacy surface 退役门禁和不可逆清理回滚边界。
- R4. 每份文档包含 current evidence、明确不变量、候选方案/推荐、未决产品选择、迁移/回滚、验收场景和风险登记。
- R5. RPO/RTO 在没有实际 capture schedule 和 measured restore drill 前不得填写承诺数值。
- R6. 不把 share、cost budget、full backup/restore 或 legacy destructive cleanup 实现进代码/config/schema。

## Acceptance Criteria

- [x] AC1. 三份设计文档分别存在，结构完整并引用当前代码/spec/task 的精确证据。
- [x] AC2. ACL 文档有 owner/viewer/editor 等候选角色动作矩阵，并明确 transfer、revoke、member deletion、memory/tool/export 边界。
- [x] AC3. Provider finance 文档区分 turn/run/attempt，明确实际 Provider 归因、unknown/late/corrected usage、预算 reserve/settle/reconcile 和 feedback 防伪。
- [x] AC4. Recovery 文档列出 persistent/transitional/rebuildable inventory、consistency protocol、key custody、restore drill 证据和分 surface legacy gate。
- [x] AC5. 风险登记至少含 asset、trigger、failure mode、severity/likelihood、invariant、detection、mitigation、rollback、acceptance evidence、owner/review date。
- [x] AC6. `git diff` 证明本子任务只改 Trellis/spec/docs 设计记录，没有运行时或 deployment 实现。
- [x] AC7. 文档/spec 校验、五项全量验证（代码无变时可复用最近 main 绿色证据）和 diff check 通过，任务提交并归档。

## Out of Scope

- 三个方向的任何运行时实现、生产数据迁移和 destructive legacy cleanup。
