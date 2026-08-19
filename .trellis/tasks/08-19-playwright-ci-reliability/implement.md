# Playwright CI reliability implementation

## Checklist

- [x] Replace both apt-owning Playwright install steps with the bounded Chromium-only contract.
- [x] Extend workflow structural tests for exact command, environment, timeout, no-apt flags, and step ordering.
- [x] Update the delivery-governance spec.
- [ ] Run focused delivery-governance tests.
- [ ] Run the full local serial quality and both browser suites.
- [ ] Commit and push the isolated branch, open a dedicated draft PR, and observe both remote browser jobs.
- [ ] Record the work commit and PR URL before archive review.

## Validation Commands

```bash
npx vitest run tests/delivery-governance.test.ts
npm run check:frontend
npm test
npm run test:browser:workspace
npm run test:browser:agent
npm run typecheck
npx wrangler deploy --dry-run
git diff --check
python ./.trellis/scripts/task.py validate-all
```

Run `npm run check:frontend` and the later validation commands serially. Browser suites use only deterministic fixtures and the local fake Provider.

## Review Gates

- Confirm neither browser job contains `--with-deps`, `install-deps`, `apt-get`, a system Chrome channel, or a third-party action.
- Confirm job names, classifier conditions, test commands, artifact paths, and 20-minute job timeouts are unchanged.
- Confirm PR files do not include any production observation or legacy rollout task/gate/evidence path.
- Distinguish a remote browser test failure from installation infrastructure failure using the exact failed step and logs.

## Rollback

Revert the workflow/spec/test commit. Do not increase the total job timeout or silently skip either browser suite as a rollback.
