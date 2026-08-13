# Legacy browser shell rollout

## Goal

Retire the `/legacy/` shell, legacy static assets, and service-worker caller path
after the React Workspace proves complete user-flow and migration parity, without
retiring the chat APIs that remain independently governed.

## Surface Contract

- Surface: `legacy.browser.shell`
- Kind/risk/owner: `browser` / `medium` / `frontend`
- Data/callers: `browser_asset`, `conversation`; browser, deployment,
  service-worker, test, Worker API
- Replacement: `react-workspace-shell`
- Recovery/rollback: `code_only` / `routing_switch`
- Observation: 14-day write window followed by 14-day read window

## Dependencies

- Archived registry/control-plane foundation.
- React Workspace and Agent transport remain production-supported with no legacy
  admin dependency.
- Chat API rollout tasks may instrument and prove parity in parallel, but their
  disable gates must continue treating this shell as a caller until its read
  observation completes.

## Requirements

- Instrument `/legacy/`, legacy asset entry points, service-worker navigation,
  deploy fingerprinting, smoke tests, and all declared caller classes.
- Prove React parity for login/guest admission, conversation creation/history,
  streaming, attachments, models/providers, migrations, settings, errors, and
  required responsive Workspace flows using local deterministic fixtures.
- Inventory local-storage/service-worker migration behavior and ensure stale
  clients neither lose supported data nor resurrect the shell after disable.
- Separate shell read/write semantics from `POST /api/chat` and `/api/chats`;
  those APIs remain independently observable and reversible.
- Rehearse the route switch, complete 14-day write/read observation, and retain
  the static rollback source without destructive asset deletion.

## Acceptance Criteria

- [ ] AC1. All browser, deployment, service-worker, test, and Worker route callers
      are instrumented with content-free exact-SHA use evidence.
- [x] AC2. React Workspace parity covers supported member/guest/admin-adjacent
      workflows, local migration, errors, and required viewports.
- [x] AC3. Shell versus API caller/write boundaries are explicit; disabling the
      shell cannot silently disable or authorize either chat API surface.
- [x] AC4. Stale service workers, cached assets, local storage, bookmarks, and
      retries cannot bypass the control or resurrect obsolete state.
- [ ] AC5. Routing rollback is rehearsed and the 14-day write window passes.
- [ ] AC6. Read-disable is reversible and the 14-day read window passes with no
      unexplained caller.
- [x] AC7. Static assets and rollback routes remain retained; only this record
      reaches at most `approved_for_cleanup`.
- [ ] AC8. Full validation, impacted Workspace/local fake Provider tests, specs,
      PR/delivery evidence, AC, and archive consistency pass.

## Out of Scope

- Disabling or deleting `POST /api/chat`, `/api/chats*`, KV/UserState data, or
  other legacy records; physical static-asset cleanup.
