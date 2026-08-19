# GitHub Actions minute optimization implementation

## Checklist

- [x] Add `quality` classification output and regression fixtures.
- [x] Add per-PR cancel-in-progress concurrency and gate baseline quality on `quality`.
- [x] Convert production deployment to main-only manual dispatch while preserving safety gates.
- [x] Group and bound Dependabot update PRs.
- [x] Update delivery-governance structural tests and code spec.
- [x] Run the full local Chatus quality gate without live provider or production operations.
- [x] Commit, push the isolated branch, and open a PR.

## Validation Commands

```bash
npm run check:frontend
npm test
npm run typecheck
npx wrangler deploy --dry-run
python ./.trellis/scripts/task.py validate ./.trellis/tasks/08-10-08-10-github-actions-minute-optimization
git diff --check
```

## Risk And Rollback Points

- Do not cancel an in-progress production mutation; only PR quality uses cancel-in-progress.
- Manual deploy must reject a dispatch from any ref other than `main`.
- Keep exact-main guards before provisioning and immediately before deployment.
- Do not read or print GitHub/Cloudflare secrets.
- Revert the workflow commit if manual deployment gating blocks a reviewed release.
