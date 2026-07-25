# Product Closure Docs And Legacy Cleanup - Implementation Plan

## Execution

1. [ ] Read current README, self-hosting guide, operations guide, deployment workflow, `.env.example`, Wrangler config, and production acceptance scripts.
2. [ ] Search for stale access-code, liveness-probe, legacy admin, legacy chat, and maintainer-specific setup references.
3. [ ] Update operator docs for public guest access, managed member bootstrap, provider secrets, production acceptance, rollback, and remote secret deletion.
4. [ ] Create `legacy-cleanup-audit.md` with evidence-backed classifications for protocol, storage, UI, and config compatibility surfaces.
5. [ ] Add follow-up Trellis task recommendations for runtime deletion only where the audit gives clear prerequisites.
6. [ ] Validate docs and task artifacts without live model calls or production deploys.

## Validation

```powershell
git diff --check
python ./.trellis/scripts/task.py validate .trellis/tasks/07-26-product-closure-docs-legacy-cleanup
```

Run broader tests only if runtime files or scripts are changed.

## Rollback Points

- Before editing runtime files: stop and split a separate implementation task.
- Before removing any legacy reference: confirm the current docs or code no longer require it.
- Before commit: scan diffs for secrets, production IDs, conversation content, and maintainer-specific values.
