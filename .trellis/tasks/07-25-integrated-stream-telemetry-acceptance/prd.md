# PRD: Integrated Stream Telemetry Acceptance

## Goal

Close the remaining truthful-streaming acceptance gap without contacting a live model: Chatus must distinguish a genuinely progressive upstream response from a buffered single-chunk response, record time to first visible output from real tasks, and expose that evidence to administrators through the typed provider-pool reliability surface.

## Requirements

### R1. Truthful Stream Evidence

- Measure time from the start of an actual provider attempt to the first user-visible text or reasoning delta.
- Classify a successfully completed text response as `progressive` only when the upstream emitted more than one visible text/reasoning delta; classify one visible delta as `single_chunk`.
- Do not classify metadata-only or tool-only attempts as buffered text responses.
- Do not synthesize token animation or split a buffered response in the client.
- Cancellation and post-output failures must preserve their existing semantics and must not be recorded as successful stream-shape samples.

### R2. Passive, Bounded Telemetry

- Extend the existing per-logical-model/provider passive reliability record with optional first-visible latency and stream-shape evidence.
- Write version-2 reliability records. Version-1 and malformed reliability records are development-only data and are deleted when read instead of migrated.
- Bound counters and latency values consistently with the existing 1,000-sample / 600,000-ms reliability limits.
- Telemetry remains best effort and must never change provider selection, stream success, fallback, quota, or lease release.
- Never record prompts, completions, tool payloads, credentials, provider response bodies, or raw stream chunks.

### R3. Typed Administration

- `/api/admin/reliability` returns only the new bounded aggregate fields and existing secret-free provider/model metadata.
- The exact React client decoder rejects unknown or malformed fields, including inconsistent sample counts.
- The typed reliability view shows first-visible latency and the most recent/aggregate stream shape clearly enough to distinguish progressive delivery from a single buffered chunk.
- Unknown and non-text states are explicit and are not presented as failures.

### R4. Deterministic Acceptance

- Local fake-provider tests cover delayed progressive deltas, one visible chunk, pre-output fallback, post-output failure, provider-busy timeout, and cancellation without a live model call.
- Tests prove that the first progressive delta can be consumed before the later delta is released; reading the whole response at once is insufficient evidence.
- Existing branch persistence and request-id idempotency tests remain green as part of the focused Worker acceptance set.
- The workspace browser suite remains model-free and continues to block `/api`, `/agent`, and external requests.

## Acceptance Criteria

- [x] A successful multi-delta provider attempt records bounded first-visible latency and `progressive` shape for the exact logical-model/provider pair.
- [x] A successful one-delta provider attempt records `single_chunk` without fake client streaming.
- [x] Tool-only, cancelled, and failed attempts do not increment successful text stream-shape samples.
- [x] Version-1 reliability records are treated as unknown and removed instead of entering version-2 aggregates.
- [x] The admin reliability API and typed decoder expose consistent, secret-free telemetry aggregates.
- [x] The typed reliability UI distinguishes progressive, single-chunk, and unknown evidence on desktop and narrow layouts without overflow.
- [x] Deterministic fake-provider tests prove progressive delivery, single-chunk behavior, pre-output fallback, post-output lock, busy timeout, and cancellation without network access to a model service.
- [x] `npm run check:frontend`, `npm test`, `npm run test:browser:workspace`, `npm run typecheck`, `npx wrangler deploy --dry-run`, and `git diff --check` pass in sequence.

## Constraints

- Do not send liveness prompts or contact a live model or MCP server.
- Do not remove the legacy SSE/tool-approval protocol or legacy storage in this task.
- Do not add the optional BIAU MCP integration in this task.
- Do not expose or persist secrets, real conversations, memories, or raw provider payloads.
- Do not deploy production locally, push, or trigger production release without explicit user confirmation.

## Out Of Scope

- A broader workspace redesign; the visual interaction pass is already complete.
- Changing administrator priority, passive quality ordering, provider capacity semantics, or the 10-second all-busy deadline.
- Destructive migration or retirement of rollback paths.
- Production-only migration verification.
