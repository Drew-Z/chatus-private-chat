# Implementation Plan: PR CI 与 Trellis 交付门禁

## Ordered Checklist

- [ ] 激活任务并加载 frontend/platform/spec 与 Trellis workflow 规则。
- [ ] 为 path classifier、PR CI、deploy skip、artifact/SHA contract 先补契约测试。
- [ ] 新增 PR workflow，接入五项基础检查和条件 Workspace/Agent Playwright。
- [ ] 让 browser runners 支持 caller-owned artifact 目录且保持脱敏。
- [ ] 扩展 deploy/production acceptance 的 code-path gating、manifest 和 artifact retention。
- [ ] 为 task validation/archive 先写 Python 测试夹具。
- [ ] 实现结构化 waiver、AC/validation/work commit/child/tree/root-index 校验和 archive fail-before-mutate。
- [ ] 修复 workspace 根索引生成或验证逻辑，提供全量一致性 CLI。
- [ ] 运行 `trellis-check`，修复全部发现。
- [ ] 运行两类浏览器测试和五项全量验证。
- [ ] 更新 delivery/Trellis spec，记录验证结果和 work commit，提交、PR、合并、归档。

## Risky Files

- `.github/workflows/*.yml`
- `.trellis/scripts/common/task_store.py`
- `.trellis/scripts/common/task_validation.py`
- `.trellis/scripts/task.py`
- `scripts/run-browser-*.mjs`

## Validation Commands

```text
python -m unittest discover .trellis/tests
npm run test:browser:workspace
npm run test:browser:agent
npm run check:frontend
npm test
npm run typecheck
npx wrangler deploy --dry-run
git diff --check
```

## Rollback Points

- workflow/runner 与 Trellis archive 分成独立 commits，便于单独回滚。
- archive 测试未证明 fail-before-mutate 前不得在真实任务上试归档。

