# Legacy API cloud chats rollout evidence

## Production baseline

- PR #76 merged the method- and caller-specific instrumentation as main SHA
  `36db0f0b048db75dc0943672d352d052cf1f29e1`.
- GitHub Actions deployment run `31719901675` passed exact-main guards, Worker
  deployment, and production smoke. Worker version
  `e9f203a2-ed4a-4768-8dd3-15f23219f158` is live; no local production deploy was
  used.
- Exact-main 30-day census run `31720354544` returned only the strict aggregate:
  zero rows, calls, unknown callers, unexpected access, and deployment mismatch;
  status was `clear`. Artifact `9189023771` is retained through 2026-11-11. No
  census row or request content was inspected or copied here.

## Identity and recovery rehearsal

- The completed stable-principal/resource delivery supplies immutable principal,
  Root, UserState, resource, and conversation-Agent routes. The isolated restore
  fixture proves each target identity is unique and the conversation mapping is
  one-to-one; labels are not used as authority.
- The route rehearsal captures the exact pre-test surface atom, blocks a legacy
  write before UserState or Agent mutation, rolls writes back to `shadowing`, and
  proves the retained route is reusable. It then rolls a simulated read-disable
  back to `recovery_proven`, restores compatibility reads, keeps writes disabled,
  and restores the original atom in `finally`.
- The isolated restore drill uses current runtime schema versions, restores
  non-empty compatible UserState and TeamAgent rows, preserves the exact
  cloud-chats registry projection, reports zero loss and unresolved references,
  and leaves target writes closed. Drill output contains no conversation content,
  object identity, label, credential, token, or raw exception.

## Delivery evidence

- PR #86 final head `b48a1f91863fc4956f0292824685de9a1501368e` passed
  `changes` and `quality` in run `31776316693`; the path classifier skipped both
  browser jobs, whose impacted suites had already passed locally.
- PR #86 squash-merged into `main` as exact SHA
  `11006c32d5aa5158bb6ad0583597769254c27908`. The merge SHA has no associated
  Actions run, so this delivery did not trigger a production deployment.

## Scheduled monitoring

- The main-only, non-canceling production census workflow adds an exact 02:37 UTC
  daily run for `legacy.api.cloud-chats` / 30 days. The existing chat-post and
  browser-shell schedules remain unchanged.
- Scheduled runs reuse the strict zero-count cloud-chats gate, accept only the
  captured deployed main SHA or its Git ancestor, retain the aggregate-only
  artifact before gating, and cannot deploy, mutate registry state, or advance a
  rollout phase.
- Instrumentation became live at `2026-08-13T16:21:12Z`. No census before
  `2026-09-12T16:21:12Z` can prove a complete 30-day quiet period; the first
  scheduled slot after that boundary is `2026-09-13T02:37:00Z` (Beijing
  `2026-09-13 10:37`).
- PR #88 final head `8417ae8d46785e501088cda0e6406f06e89e12d1` passed
  `changes`, `quality`, `workspace-browser`, and `agent-browser` in run
  `31781128802`, then squash-merged into `main` as exact SHA
  `c319fe851f37060ba568bb607b2844e0044b99bc`. The merge produced no production
  deployment; the new schedule remains read-only monitoring only.

## Remaining gates

This evidence is local and pre-disable. It does not raise the code-owned
`instrumented` phase ceiling, disable production writes or reads, start either
30-day observation window, authorize cleanup, delete a route, or delete any
transitional state. The task remains `in_progress`.
