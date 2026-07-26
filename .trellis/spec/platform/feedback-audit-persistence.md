# Feedback And Administrative Audit Persistence

## 1. Scope / Trigger

Use this contract when changing member answer feedback, administrative audit records, their KV storage, administrator projections, or user-data deletion. These records remain shared operational metadata in `CHAT_STORE`; moving them into a different durable owner is a separate migration.

## 2. Signatures

```typescript
createFeedbackAuditService({ store, nowIso, createId })

service.listFeedback(): Promise<FeedbackRecord[]>
service.upsertFeedback(input): Promise<FeedbackRecord>
service.removeFeedbackByLabel(label): Promise<void>
service.listAdminAudit(): Promise<AdminAuditRecord[]>
service.appendAdminAudit(action, target?): Promise<void>
```

- Feedback key: `feedback:recent`
- Administrative audit key: `config:admin_audit`
- Both keys store one newest-first JSON array with at most 100 records.
- The injected store exposes only `get(key)` and `put(key, value)`. Time and audit IDs are injected for deterministic tests.

## 3. Contracts

- `src/services/feedback-audit.ts` owns the keys, record types, exact stored-record decoders, uniqueness, newest-first order, and 100-record bounds. Worker handlers must not parse or rewrite these KV arrays directly.
- Feedback contains only `id`, member `label`, `rating`, optional bounded reason, logical `routeId`, `chatId`, `messageId`, and `at`. It never contains prompts, completions, message content, memories, credentials, provider endpoints, or raw tool data.
- Feedback identity remains `${label}:${chatId}:${messageId}`. A new rating for that ID replaces the prior record and moves it to the front. User-data deletion removes only records whose exact label matches the deleted member.
- Stored records are accepted only when all keys, text bounds, rating/reason rules, and parseable timestamps match the typed administrator decoder. Invalid records and later duplicate IDs are omitted from projections and from the next successful rewrite.
- The Worker continues to own authentication, guest denial, request decoding, feedback reason validation, logical-route existence, HTTP responses, and the decision about when and which administrative action to record.
- Feedback reads and writes are authoritative for the request and propagate KV failures. Administrative audit append is best-effort and catches both read and write failures so a completed administrator mutation is never rolled back by audit persistence.
- Direct administrative list reads retain ordinary KV failure behavior; only `appendAdminAudit` is fail-open.
- The shared KV arrays still use non-atomic read-modify-write. This service boundary does not claim append-only ledger guarantees or solve concurrent lost updates; any stronger audit guarantee requires a Durable Object or another atomic owner.

## 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Key is absent, blank, malformed JSON, or not an array | Project an empty list |
| Array member has unknown/missing fields, invalid bounds/date/reason, or forbidden extra data | Omit that member |
| A later member repeats an earlier record ID | Keep the first/newest valid record only |
| Feedback write or member-feedback deletion cannot read/write KV | Propagate the failure; do not report success |
| Audit append cannot read or write KV | Resolve without throwing; keep the administrator operation successful |
| Administrator list read cannot reach KV | Propagate the read failure through the existing API error path |
| User data is deleted | Rewrite feedback without that exact member label; retain other members |

## 5. Good / Base / Bad Cases

- Good: a member changes one answer from down to up; the same feedback ID moves to the front, remains unique, and contains no answer text.
- Base: a malformed historical array member is skipped while valid records remain visible to the exact typed Operations decoder.
- Bad: `src/worker.ts` reads `feedback:recent`, casts arbitrary JSON, or lets an audit KV failure turn a successful member-access rotation into an HTTP failure.
- Bad: describe the current KV audit array as an immutable or strongly ordered compliance ledger.

## 6. Tests Required

- Unit-test malformed top-level values, exact entry validation, duplicate-ID removal, newest-first upsert, the 100-record bound, and member-scoped deletion.
- Assert audit targets are bounded, generated entries are newest-first, and both audit read and write failures are fail-open during append.
- Assert feedback storage failures reject the write rather than returning success.
- Keep Worker integration tests for member feedback privacy, duplicate rating replacement, administrator readback, guest denial, and user-data deletion.
- Keep client exact-decoder tests that reject secret/message fields, invalid reasons, duplicate IDs, and oversized projections.

## 7. Wrong vs Correct

### Wrong

```typescript
const records = JSON.parse(await env.CHAT_STORE.get("feedback:recent") || "[]");
await env.CHAT_STORE.put("feedback:recent", JSON.stringify(records));
```

### Correct

```typescript
const records = feedbackAuditService(env);
await records.upsertFeedback(validatedFeedback);
await records.appendAdminAudit("config.update");
```

The service owns untrusted stored JSON and the two different failure policies; the Worker owns request and business validation.
