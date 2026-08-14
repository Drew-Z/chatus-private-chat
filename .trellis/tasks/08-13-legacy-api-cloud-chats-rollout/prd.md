# Legacy API cloud chats rollout

## Goal

Retire the compatibility `GET/PUT/DELETE /api/chats` and
`POST /api/chats/migrate` boundaries only after the Agent conversation APIs are
authoritative for every caller and preserve equivalent UserState synchronization
and recovery behavior.

## Surface Contract

- Surface: `legacy.api.cloud-chats`
- Kind/risk/owner: `api` / `high` / `data`
- Data/callers: conversations; Agent runtime, browser, operator, test, and
  Worker API
- Replacement: `agent-conversation-api`
- Recovery/rollback: `capture_restore` / `compatibility_read`
- Observation: separate 30-day write and read windows

## Constraints

- Instrument only this surface. Do not change `POST /api/chat`, browser-shell
  routing, KV chat-index ownership, UserState substate ownership, or physical
  conversation deletion.
- Evidence is exact-SHA, content-free, and must not retain conversation IDs,
  request/response bodies, URLs, headers, credentials, tokens, or raw logs.
- Production changes and observation runs use GitHub Actions; local validation
  uses fake Provider/MCP fixtures only.
- Legacy route and transitional UserState/Agent state remain retained for
  capture, isolated restore, and reversible rollback.

## Requirements

- Map and instrument each legacy method and every declared browser, Agent,
  operator, test, scheduled, and Worker caller with deterministic read/write
  classification.
- Prove parity for list/read/upsert/delete/migrate behavior, ordering,
  pagination, metadata, tombstones, retries/idempotency, account cleanup,
  Agent import/sync, and stable errors.
- Reconcile identity/resource mappings one-to-one and retain the evidence needed
  by the ACL identity start gate.
- Stop legacy writes only after the Agent API is authoritative and hidden
  scheduled/operator/UserState mutations are excluded or migrated.
- Prove capture/restore and a compatibility-read rollback before disabling reads.
- Complete both observation windows independently; advance only this record to
  at most `approved_for_cleanup`, deleting no route or data.

## Acceptance Criteria

- [x] AC1. Every legacy method and declared caller class has exact-SHA,
      content-free census evidence with no unknown or unexplained access.
- [x] AC2. Agent parity covers list/read/upsert/delete/migrate, pagination,
      tombstones, retries, cleanup, metadata, sync, and stable errors using only
      deterministic local fixtures.
- [x] AC3. Identity/resource migration maps reconcile one-to-one and satisfy the
      ACL identity planning gate without implying disable completion.
- [ ] AC4. Write-disable produces no authoritative legacy mutation, hidden
      sync, quota/accounting side effect, or Agent/UserState divergence.
- [x] AC5. Capture/restore and compatibility-read rollback pass before the write
      observation window completes.
- [ ] AC6. Read-disable is reversible and its independent 30-day window passes
      with no unexplained caller.
- [x] AC7. Route code, UserState/Agent state, and rollback sources remain
      retained; only this record may reach `approved_for_cleanup`.
- [ ] AC8. Focused/full tests, specs, delivery/PR evidence, task validation,
      and archive consistency pass.

## Out of Scope

- Disabling the browser shell, `POST /api/chat`, KV projections, UserState
  substate, Provider/config/credential fallbacks, ACL grants or transfer, and
  physical conversation deletion.
