# Implementation Plan: Project Hardening Follow-ups

## Ordered Checklist

- [ ] Complete child PRDs and child-level design/implementation plans where behavior changes.
- [ ] Execute `admin-config-compatibility-recovery` to restore the production admin surface without enabling incomplete legacy MCP tools.
- [ ] Execute `background-cleanup-reliability` with failure injection for guest, workspace and conversation purge.
- [ ] Execute `public-error-redaction` with secret-bearing provider/MCP/runtime error fixtures.
- [ ] Execute `skill-quota-route-governance` with quota ordering, BYOK isolation, atomic telemetry and deadline tests.
- [ ] Execute `frontend-legacy-experience` with safe route-to-provider migration, static admin retirement, React/legacy keyboard, scrolling, responsive and bundle evidence.
- [ ] Execute `ci-delivery-hardening` with parsed workflow assertions, timeouts, path classification and docs-only skip tests.
- [ ] Execute `test-performance-capacity` with coverage/test-pool metrics and explicit capacity decisions.
- [ ] Run cross-child integration review for contracts, privacy, deletion, rollback and 0.x compatibility.
- [ ] Run full shipping gate and exact-SHA production acceptance through GitHub Actions only.
- [ ] Update specs, record all validation/artifact/run evidence, archive children, then archive parent and journal.

## Validation Commands

```text
npm run check:frontend
npm test
npm run test:browser:workspace
npm run test:browser:agent
npm run typecheck
npx wrangler deploy --dry-run
git diff --check
python ./.trellis/scripts/task.py validate-all
python -m unittest discover -s .trellis/tests -p test_*.py -v
```

## Review Gates

- Retry/purge gate: no marker or tombstone disappears before all required backends succeed.
- Privacy gate: no public error or artifact contains raw upstream body, secret, token, cookie, prompt, draft or member identifier.
- Quota gate: automatic selector and provider work are metered in the documented order; BYOK and shared telemetry are isolated.
- Browser gate: React and legacy supported surfaces have keyboard and 390px evidence.
- Admin retirement gate: mixed-safe/unsafe route migrations are atomic and redacted; `/admin.html` cannot render the removed static UI.
- Delivery gate: workflow structure, timeout, exact SHA and artifact retention are machine-checked.

## Rollback Points

- Child commits are independently revertible.
- Retry schema changes require backward-compatible readers before writers.
- CI-only changes must prove docs/Trellis-only commits still skip deploy.
- Capacity changes are not merged without a product decision and measured baseline.
