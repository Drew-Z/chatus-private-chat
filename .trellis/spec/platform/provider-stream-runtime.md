# Provider Stream Runtime

## 1. Scope / Trigger

Use this contract when changing legacy OpenAI-compatible or Anthropic-compatible streaming requests, Anthropic-to-OpenAI SSE conversion, pre-output stream validation, or upstream stream cancellation.

The module is a protocol adapter. Provider selection, credential resolution, capacity leases, fallback orchestration, response security headers, quota release, reliability telemetry, and chat metrics remain outside it.

## 2. Signatures

- Module: `src/services/provider-stream-runtime.ts`
- Provider attempt: `callProviderStream({ route, apiKey, usedUserKey, messages, temperature, defaultMaxTokens, signal?, fetch? })`
- Successful result: `{ ok: true, body, cancelUpstream }`
- HTTP failure result: `{ ok: false, status, message, terminal }`
- Protocol failure: `UpstreamRequestError(status, message, "protocol_error")`
- Preflight limit: `MAX_PROVIDER_STREAM_PREFLIGHT_BYTES`

The optional `fetch` dependency exists for deterministic adapter tests. Production callers omit it and use the Worker global fetch.

## 3. Contracts

- `ResolvedProviderRoute` is the only executable route shape. Legacy route configuration must be normalized before the stream attempt begins.
- OpenAI-compatible requests use the shared route URL, saved-header, authentication, and numeric temperature helpers. They send `stream=true`, preserve multimodal chat messages, and include route `max_tokens` only when configured.
- Anthropic requests use the shared message conversion, default `anthropic-version`, route max tokens or the injected deployment default, and temperature clamping to `[0,1]`.
- Anthropic text deltas are projected as OpenAI-compatible SSE content chunks. Stop reasons are projected as finish chunks, with `max_tokens` mapped to `length`, and `message_stop` emits one `[DONE]` event.
- A successful attempt is not returned until at least one non-empty visible content delta has been validated. Metadata-only prefixes are buffered up to 256 KB.
- DONE-only, empty, malformed, incomplete, explicit error, and oversized pre-visible streams fail before the Worker commits the provider response.
- After the first visible output, protocol validation continues on the returned stream. A later protocol failure errors that stream and must not reopen provider fallback.
- `cancelUpstream` is idempotent and cancels the active normalized reader; Anthropic cancellation propagates to the original provider body.
- Non-2xx responses use bounded shared error projection. Status 400/422 and user-key 401/403 follow `isTerminalProviderFailure`; other HTTP failures remain eligible for pre-output fallback.

## 4. Ownership And Fallback Boundary

The Worker owns the attempt loop. It may try another eligible provider only when `callProviderStream` returns an HTTP failure or throws before returning `{ ok: true }`.

Once `{ ok: true }` is returned, the Worker wraps the body with the provider lease lifecycle. Completion records success; stream failure records the protocol or upstream error; cancellation releases capacity without recording a synthetic success or failure. None of these post-return paths may re-enter provider selection.

`UpstreamRequestError` is also used by non-streaming completion compatibility paths so status extraction and passive reliability classification keep one runtime identity.

## 5. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Provider returns non-2xx | Return `{ ok: false }` with bounded message and terminal classification |
| OpenAI stream emits `[DONE]` before content | Throw `UpstreamRequestError(502, ..., "protocol_error")` before handoff |
| Anthropic stream emits an error event before content | Throw the same protocol error before handoff |
| Stream exceeds 256 KB before content | Cancel upstream and throw a protocol error before handoff |
| Stream ends or leaves an incomplete event before content | Cancel upstream and throw a protocol error before handoff |
| Invalid SSE arrives after visible content | Error the committed stream; release its lease; do not fall back |
| Request or response consumer cancels | Propagate cancellation upstream and release the lease once |

## 6. Tests Required

- Unit-test OpenAI and Anthropic request URL, headers, body, temperature, and max-token behavior.
- Unit-test metadata preflight, first-visible handoff, DONE-only and empty streams, invalid/error events, incomplete streams, and the 256 KB pre-visible limit.
- Unit-test Anthropic text, finish, stop, and cancellation conversion.
- Keep Worker integration tests for HTTP and protocol fallback, post-visible failure, provider lease release, reliability telemetry, and BYOK terminal classification.
- Run `npm run check:frontend`, `npm test`, `npm run typecheck`, `npx wrangler deploy --dry-run`, and `git diff --check`.

## 7. Wrong vs Correct

### Wrong

```typescript
const response = await fetch(url, init);
return new Response(response.body);
```

This commits the provider before proving that it can produce visible output, so an empty or error-only HTTP 200 stream cannot safely fall back.

### Correct

```typescript
const attempt = await callProviderStream(args);
if (!attempt.ok) return classifyAttempt(attempt);
const response = new Response(attempt.body, { headers: streamHeaders });
return responseWithProviderLease(response, lease, lifecycle, attempt.cancelUpstream);
```

The adapter proves the pre-output protocol boundary; the Worker still owns provider orchestration and the post-handoff lease lifecycle.
