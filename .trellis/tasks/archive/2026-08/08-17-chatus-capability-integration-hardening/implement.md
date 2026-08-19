# Capability Integration Hardening Implementation

## Dependencies

Start only after all four implementation children are complete and archived.

## Checklist

- [x] Load `trellis-before-dev` and every touched-layer spec.
- [x] Build/run the local fake-service cross-layer matrix for assignment,
  revocation, admission, vision, research, fallback, cancellation, recovery, and
  lifecycle behavior.
- [x] Add missing focused tests or return ownership defects to the appropriate
  child contract before proceeding.
- [x] Scan exact public/persisted/monitoring/log/backup shapes for prohibited
  identity, content, raw result, URL, reasoning, and credential fields.
- [x] Load `trellis-update-spec` and update all applicable executable contracts.
- [x] Load `trellis-check` and run focused checks.
- [x] Run the final commands serially:
  `npm run check:frontend`, `npm test`, `npm run test:browser:workspace`,
  `npm run test:browser:agent`, `npm run typecheck`,
  `npx wrangler deploy --dry-run`, `git diff --check`.
- [x] Verify no protected path changed and no live external request or production
  deployment occurred.
- [ ] Commit/archive this child, perform parent AC1-AC12 review, then archive the
  parent planning task.

## Validation Record

- Focused Vitest: 5 files, 290 tests passed.
- Full Vitest: 60 files, 918 tests passed.
- Workspace Playwright: 119 passed, 71 conditional skips across five viewports.
- Agent browser acceptance: 3 passed with local fake Provider ownership.
- Frontend structure, typecheck, Wrangler packaging dry-run, and diff whitespace
  checks passed. Generated frontend assets remained unchanged.
- Protected-path audit returned no matches; no live external or production action
  ran.

## Rollback

Revert only the incomplete hardening/spec changes and reopen the child that owns
any discovered contract defect. Do not weaken tests or protected boundaries to
make the gate pass.
