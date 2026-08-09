# Legacy browser admin alias rollout implementation plan

- [x] Run `trellis-before-dev`; locate the exact Worker route, smoke/deployment,
      browser, bookmark/query, service-worker, and test callers.
- [x] Version only `legacy.browser.admin-alias` with owner `frontend`, 7-day
      write/read observations, and the minimum supported phase ceiling.
- [x] Wire content-free route-use recording and fail-closed caller classification.
- [x] Add deterministic React redirect/auth/query/error/parity fixtures and
      characterize the zero-write boundary.
- [x] Migrate deployment/test callers without hiding production alias hits.
- [ ] Add independently reversible read-disable and rehearse `routing_switch`.
- [ ] Retain exact-SHA write/read observation evidence and advance only this
      record to `approved_for_cleanup`; remove nothing.
- [x] Run `trellis-check`, focused Worker/client/browser tests, both applicable
      browser suites, and the full repository validation baseline.
- [x] Update legacy/browser/delivery specs and append `DR-06` evidence.
- [ ] Commit, PR, exact-head/exact-main delivery evidence, AC verification,
      consistency validation, and archive.

## Rollback Point

Re-enable `/admin.html` with the prior redirect contract, preserve all evidence,
and reset the affected observation window before another advance.

## Local validation evidence

- `npm run check:frontend`: passed.
- `npm test`: 48 files and 728 tests passed.
- `npm run typecheck`: passed.
- `npx wrangler deploy --dry-run`: passed without deployment.
- `git diff --check`: passed.
- `npm run test:browser:workspace`: 90 passed and 55 intentionally skipped by
  viewport targeting.
- `npm run test:browser:agent`: 3 of 3 passed with local fake Provider fixtures.

## DR-06 evidence

- This rollout mitigates `DR-06` only for the exact `legacy.browser.admin-alias`
  census boundary: caller classes are bounded, route evidence is content-free,
  deployment identity is server-owned, query-preserving redirect parity is
  covered, and the source route remains recoverable.
- `DR-06` is not closed. The routing-switch rehearsal and real production
  seven-day write/read observation windows require an exact merged-main
  GitHub-Actions deployment and retained artifacts before any disable or
  cleanup decision.

## Delivery evidence

- Work commit `b3937166a65cde86b7570bb952a6a2c2d42d5968` was delivered through
  PR #56. PR CI run `31329698513` passed `changes`, `quality`,
  `agent-browser`, and `workspace-browser` on head
  `dd37d84f05880498f188e4482e92b33d27114d8e`.
- PR #56 merged as exact main SHA
  `c6f6b380070e48dc3d9ea16729e33e68bb6b1608` at
  2026-08-09T18:51:21Z. Deploy run `31330106196` passed exact-main guards,
  repository checks, Worker deployment, and production verification.
- Production deployment artifact `9042714932` is retained through
  2026-11-07; deployment-path artifact `9042663835` is retained through
  2026-09-08. Both are named with the exact main SHA.
- The instrumented production observation baseline began after `Verify
  production` passed at 2026-08-09T18:55:31Z. This timestamp starts evidence
  collection only; it does not satisfy either seven-day observation gate.
