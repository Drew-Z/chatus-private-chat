# Design: 季度后续设计决策

## Deliverables

在本任务目录 `research/` 下生成三份权威设计文档和一个 consolidated `risk-register.md`。设计以当前 identity/storage/telemetry/backup 事实为地基，不假定尚不存在的 org、principal、ledger 或 cross-DO transaction。

## Decision Method

每份文档按以下顺序：问题与非目标 -> 当前证据 -> 不变量 -> 候选方案 -> 推荐和 trade-off -> 数据/API/state machine -> migration/compatibility -> privacy/security -> operations/rollback -> acceptance scenarios -> 未决选择 -> risks。

## ACL Boundary

重点判断 ACL 绑定 conversation resource 还是 member root、stable principal 取代 label 的路径、owner/viewer/editor 动作矩阵、transfer 是原子 ownership 还是 copy-and-revoke，以及 memory/tool trust/export 永不隐式共享的不变量。

## Provider Finance Boundary

把 user turn、logical run、provider attempt 分开；实际 provider/offering attribution 必须服务端生成。区分 provider-reported usage、估算与 invoice reconciliation，不在来源未知时称为真实成本。预算明确 reserve/settle/correct 和 fallback/tool-loop 行为。

## Recovery and Retirement Boundary

把 full-instance DR 与用户 export、代码回滚分开。先列 inventory 和 stop-write/consistency，再定义 provisioning/identity mapping/restore/reconcile/drill。RPO/RTO 只定义测量法。legacy admin、API、credentials、KV import、UserState 等分别有 census/parity/backup/rollback gate。

## Risk Register

统一字段：ID/domain、asset/trust boundary、trigger、failure mode、severity、likelihood、invariant、decision required、detection、mitigation、rollback、acceptance evidence、owner、review date。

## No-Code Guard

本任务变更路径只允许 `.trellis/tasks/**`、`.trellis/spec/**` 和必要 `docs/**`。任何 `src/`、`client/`、workflow、wrangler 或 package 变化都视为范围失败。

