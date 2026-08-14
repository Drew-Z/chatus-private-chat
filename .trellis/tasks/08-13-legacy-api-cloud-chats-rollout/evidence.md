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

## Remaining gates

This evidence is local and pre-disable. It does not raise the code-owned
`instrumented` phase ceiling, disable production writes or reads, start either
30-day observation window, authorize cleanup, delete a route, or delete any
transitional state. The task remains `in_progress`.
