# Implementation Plan: 季度后续设计决策

## Ordered Checklist

- [x] 加载 identity/session、Agent storage、feedback/audit、backup/restore 与 legacy cleanup 证据。
- [x] 撰写 `research/member-sharing-acl-design.md` 和 ACL risks。
- [x] 撰写 `research/provider-usage-cost-budget-feedback-design.md` 和 finance/privacy risks。
- [x] 撰写 `research/instance-recovery-legacy-retirement-design.md` 和 DR/retirement risks。
- [x] 合并 `research/risk-register.md`，去重并标注 owner/review date。
- [x] 逐份检查事实引用、推荐、未决选择、迁移/回滚和 acceptance scenarios。
- [x] 运行 `trellis-check` 的文档/spec 一致性检查和 `git diff --check`。
- [x] 验证变更路径没有运行时代码；复用/运行所需全量 main 绿色检查。
- [ ] 用 `trellis-update-spec` 判断哪些设计不变量应进入 spec，提交并归档。

## Validation Commands

```text
git diff --name-only
git diff --check
npm run check:frontend
npm test
npm run typecheck
npx wrangler deploy --dry-run
```

## Rollback Points

- 每份设计独立 review；证据不足的推荐保留为未决，不伪装成已决定实现。
- 若出现 runtime diff，移出本任务并回到对应未来实现任务。
