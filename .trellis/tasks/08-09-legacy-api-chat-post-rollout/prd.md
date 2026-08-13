# Legacy API chat post rollout

## Goal

Retire `POST /api/chat` after all browser, guest, test, and Worker callers use the
TeamAgent transport with equivalent quota, Provider, streaming, cancellation,
error, and privacy behavior.

## Surface Contract

- Surface: `legacy.api.chat-post`
- Kind/risk/owner: `api` / `high` / `data`
- Data/callers: `conversation`; browser, test, Worker API
- Replacement: `team-agent-transport`
- Recovery/rollback: `capture_restore` / `routing_switch`
- Observation: 30-day write window followed by 30-day read window

## Dependencies

- Archived registry foundation and current Agent transport baseline.
- Instrumentation/census/parity may proceed with browser-shell work.
- Write-disable requires `legacy.browser.shell` read observation to complete and
  all other callers to be migrated or explicitly blocked.
- Census and migration/parity evidence contributes to the ACL identity start
  gate; read-disable and cleanup do not block that identity task.

## Requirements

- Instrument route admission and every declared caller without recording request,
  conversation, model, Provider, credential, memory, or response content.
- Prove TeamAgent parity for member/guest admission, one-message quota, logical
  model/offering selection, Automatic Skill, fallback/deadline/progress,
  streaming, tools, files, cancellation, stable errors, and telemetry using only
  local fake Provider/MCP fixtures.
- Define `write` as admitted legacy POST execution and `read` as compatibility
  route availability/dispatch so both controls are deterministic.
- Prove capture/isolated restore covers any transitional state needed for
  rollback; rehearse the routing switch before write-disable.
- Complete separate 30-day windows and leave route deletion to later cleanup.

## Acceptance Criteria

- [x] AC1. Browser, guest, test, and Worker API callers are completely mapped and
      instrumented with content-free exact-SHA evidence.
- [x] AC2. Agent parity covers quota, Provider attempts/budget, skills, files,
      tools, streams, cancellation, progress, errors, and privacy.
- [x] AC3. Caller census and identity migration/parity contract are sufficient
      to unblock the stable principal/resource identity planning gate.
- [x] AC4. No legacy POST receives an authoritative message after write-disable;
      denial produces zero hidden Provider/tool calls and no double quota count.
- [ ] AC5. Capture/restore and routing rollback are proven before the 30-day
      write window completes.
- [ ] AC6. Compatibility route disable is reversible and the 30-day read window
      passes with no unexplained caller.
- [x] AC7. No endpoint code or conversation data is deleted; only this record
      reaches at most `approved_for_cleanup`.
- [ ] AC8. Focused/full fake-runtime tests, specs, PR/delivery evidence, AC, and
      archive consistency pass.

## Out of Scope

- Retiring `/api/chats*`, browser shell, UserState/KV projections, or changing
  Agent/Provider accounting semantics; destructive cleanup.
