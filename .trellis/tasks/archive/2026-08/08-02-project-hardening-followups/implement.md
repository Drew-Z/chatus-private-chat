# Implementation Plan: Project Hardening Follow-ups

## Ordered Checklist

- [x] Complete child PRDs and child-level design/implementation plans where behavior changes.
- [x] Execute `admin-config-compatibility-recovery` to restore the production admin surface without enabling incomplete legacy MCP tools.
- [x] Execute `background-cleanup-reliability` with failure injection for guest, workspace and conversation purge.
- [x] Execute `public-error-redaction` with secret-bearing provider/MCP/runtime error fixtures.
- [x] Execute `skill-quota-route-governance` with quota ordering, BYOK isolation, atomic telemetry and deadline tests.
- [x] Execute `frontend-legacy-experience` with safe route-to-provider migration, static admin retirement, React/legacy keyboard, scrolling, responsive and bundle evidence.
- [x] Execute `ci-delivery-hardening` with parsed workflow assertions, timeouts, path classification and docs-only skip tests.
- [x] Execute `test-performance-capacity` with coverage/test-pool metrics and explicit capacity decisions.
- [x] Run cross-child integration review for contracts, privacy, deletion, rollback and 0.x compatibility.
- [x] Run full shipping gate and exact-SHA production acceptance through GitHub Actions only.
- [x] Update specs, record all validation/artifact/run evidence, archive children, then archive parent and journal.

## Child Delivery Matrix

| Child | PR | Recorded work commit | Result |
| --- | --- | --- | --- |
| `admin-config-compatibility-recovery` | #31 | `d0248089df8c2a33d3ec1b9f3fb6619de24be406` | 10/10 AC, archived |
| `background-cleanup-reliability` | #36 | `48996aa1823614a89bdcaaca3637dea72b0858d2` | 8/8 AC, archived |
| `public-error-redaction` | #33 | `31028f36aa14ad159c2680fd695ed45810f2684d` | 10/10 AC, archived |
| `skill-quota-route-governance` | #38 | `f03c13a323bdc29ae336e280c081a01d97b93f97` | 9/9 AC, archived |
| `frontend-legacy-experience` | #44 | `6fb3594843cc38b45484a91c8335dc489456b634` | 10/10 AC, archived and user accepted |
| `ci-delivery-hardening` | #45 | `47db7cc121aa749a6bdb94b4e8ce43077f6b061b` | 9/9 AC, archived |
| `test-performance-capacity` | #46 | `0d06d1074175ae93b2ed15df6144570e4d76ee90` | 10/10 AC, archived |
| `production-acceptance-cleanup-recovery` | #43 | `0dffa223306986f81240fea9991ce923225f83b2` | 6/6 AC, archived |

## Final Integration Review (2026-08-05)

- Cleanup and deletion: guest, conversation, Workspace, member purge, and production-acceptance cleanup retain durable markers/locks until owned backends succeed; failure injection and retry exhaustion remain bounded and idempotent.
- Privacy: canonical public errors, passive telemetry, migration responses, audits, screenshots, and delivery manifests exclude raw upstream bodies, endpoints, credentials, cookies, content, member identifiers, object keys, and checksums.
- Quota and capacity: Automatic Skill admission precedes selector/main work and charges one message unit; BYOK telemetry is isolated; Provider aggregates are single-writer; members remain explicitly unlimited; the 60-second boundary covers only pre-visible output; Workspace usage remains metadata-tracked rather than bucket-actual.
- Frontend and administration: fail-closed legacy MCP recovery, Provider + Offering migration, `/admin.html` redirect, keyboard/390px/scroll coverage, and clarified entity labels coexist without restoring the removed static admin or deleting the runtime legacy route reader.
- Rollback and compatibility: every code child is independently revertible, production code changes remain GitHub Actions-only, later records-only commits skip deployment, and SemVer remains `0.1.0`.

## Final Validation Evidence (2026-08-05)

- `npm run check:frontend`: passed; the measured React bundle was 902.06 KB minified / 250.90 KB gzip JS, with no approved transfer/CPU budget supporting speculative splitting.
- `npm test`: 40 files and 587 tests passed in the serial Workers pool.
- `npm run test:coverage`: 40 files and 587 tests passed; Istanbul measured 60.78% statements, 57.57% branches, 55.78% functions, and 65.22% lines.
- `npm run test:browser:workspace`: 84 passed and 46 viewport-conditional skips across 130 cases.
- `npm run test:browser:agent`: 3 passed against the isolated local fake Provider.
- `npm run typecheck`, `npx wrangler deploy --dry-run`, `git diff --check`, Trellis repository validation, and all 7 Trellis unit tests passed.
- Final deployable `main` SHA `0d06d1074175ae93b2ed15df6144570e4d76ee90` passed PR exact-head CI in run `30939931722`, GitHub Actions deployment/production verification in run `30940550954`, and model-free temporary-member production acceptance in run `30941162756`; manifests were retained.
- Later task/archive/journal commits contain only approved Trellis records. Runs `30964338638` and `30964420540` proved that deployment was skipped and the records-only evidence job succeeded.
- No local production deployment, live Provider/MCP/OAuth call, synthetic model probe, production configuration read, or CI-driven production migration was used.

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
