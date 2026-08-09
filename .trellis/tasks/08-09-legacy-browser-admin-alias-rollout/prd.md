# Legacy browser admin alias rollout

## Goal

Retire the `/admin.html` compatibility alias after proving all bookmarks,
deployment checks, tests, and Worker route callers use `/react-chat/admin` or can
be safely redirected, while preserving an independently reversible route.

## Surface Contract

- Surface: `legacy.browser.admin-alias`
- Kind/risk/owner: `browser` / `low` / `frontend`
- Data/callers: `browser_asset`; browser, deployment, test, Worker API
- Replacement: `react-admin-route`
- Recovery/rollback: `code_only` / `routing_switch`
- Observation: 7-day write window followed by 7-day read window

The runtime record remains `unassigned` and `discovered` until this task ships an
evidence-backed manifest version. This task may advance only this exact record.

## Dependencies

- Archived `legacy-surface-registry-control-plane` foundation and current
  `.trellis/spec/platform/legacy-surface-governance.md` contract.
- React admin authentication, loading/error recovery, and operational navigation
  remain the supported replacement baseline.

## Requirements

- Instrument exact `/admin.html` route use from every declared caller class with
  content-free exact-SHA evidence; do not treat production quiet as census.
- Prove redirect, authentication, query handling, error recovery, smoke checks,
  bookmarks, and browser tests preserve supported behavior at the React route.
- Define whether this read-only alias has any write-class caller and prove the
  classification deterministically before write observation.
- Raise the code-owned phase ceiling only as each implemented gate becomes
  enforceable. An admin action cannot bypass the ceiling.
- Rehearse `routing_switch` rollback before disabling the alias, then complete
  separate 7-day write/read observation windows without unexplained access.
- Keep the old route implementation recoverable until separately approved
  cleanup; do not remove unrelated legacy browser or API surfaces.

## Acceptance Criteria

- [ ] AC1. Owner, caller map, instrumentation contract, and exact route boundary
      are versioned only for `legacy.browser.admin-alias`.
- [ ] AC2. Browser, deployment, test, and Worker API caller census is complete and
      content-free on exact deployment SHAs.
- [ ] AC3. `/react-chat/admin` parity covers authentication, navigation, query,
      error, smoke, bookmark, desktop, and 390px behavior.
- [ ] AC4. No authoritative write is attributed to the alias, or every discovered
      write caller is migrated and proven before stop-write.
- [ ] AC5. Routing rollback is rehearsed and the 7-day write observation passes.
- [ ] AC6. Alias disable is independently reversible and the 7-day read
      observation passes with no unexplained caller.
- [ ] AC7. No route code or rollback source is physically removed; the record
      reaches at most `approved_for_cleanup`.
- [ ] AC8. Focused/full tests, specs, PR CI, exact-main deployment/acceptance,
      evidence, work commit, archive checks, and repository consistency pass.

## Out of Scope

- Removing `/legacy/`, legacy chat APIs, static legacy shell assets, or any stored
  data; anonymous/public admin access; destructive cleanup.
