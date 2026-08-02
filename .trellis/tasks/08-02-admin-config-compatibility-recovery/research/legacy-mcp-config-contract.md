# Legacy MCP Admin Config Contract

## First Confirmed Cause

- `src/worker.ts:6288-6309` normalizes stored configuration before admin projection.
- `src/worker.ts:8841-8867` treats missing MCP governance fields as incomplete, forces `reviewRequired: true`, and prevents `enabled: true` from surviving normalization.
- `src/worker.ts:9519-9522` serializes the normalized object, so governance properties holding `undefined` are absent from the JSON response.
- `client/src/lib/api.ts:2586-2641` validates optional fields when present but then requires all four fields in the MCP branch, rejecting the Worker projection.
- `client/src/lib/api.ts:702-706` maps that rejection to `invalid_admin_config_response` / “管理配置格式无效。”, which produces the observed global admin error.

## PUT Round-trip

- `src/worker.ts:2801-2831` validates, normalizes, and persists admin PUT requests.
- `src/worker.ts:6648-6675` validates raw MCP servers but does not reject an incomplete disabled tool.
- `src/worker.ts:6558-6562` requires the referenced MCP server to exist but does not require governance fields.
- Therefore an incomplete tool can safely round-trip as disabled/review-required; the current production blocker is the React GET decoder.

## Existing Test Anchors

- `tests/worker-api.test.ts:4305-4371` covers governed MCP drift but not a legacy incomplete projection.
- `tests/client-api.test.ts:515-603` covers admin snapshot validation but not the fail-closed compatibility shape.
- `tests/client-admin-capabilities.test.ts:154-190` covers delete and discovery merge ownership.
- `tests/browser/workspace-visual.spec.ts:1122-1279` covers the capability admin panel and is the correct browser regression surface.

## Decision

Accept an incomplete MCP tool only as a recovery object when it is explicitly disabled and review-required. Preserve it for explicit deletion or same-ID rediscovery. Do not synthesize governance fields, enable it, or interpret discovery as an authoritative deletion snapshot.

## Second Production Failure

The first fix shipped at exact SHA `7624ccaa9bc4294312bf0e08cdb42bd0fbb5e599`, with PR CI, deployment, and production verification passing. The legacy admin remains usable at that SHA, while React still reports `invalid_admin_config_response`. This rules out the original MCP-tool mismatch as the only cause and keeps production acceptance open.

The GET path is `loadEditableConfig -> normalizeAppConfig -> sanitizeAdminConfig`; it does not call `validateAppConfig`. React therefore sees historical values that Worker normalization accepts but the strict snapshot decoder rejects. Confirmed mismatches include duplicate route fallbacks, numeric strings/fractions in positive-number fields, out-of-range provider capacity, blank optional credential metadata, and legacy MCP endpoint/auth/scope shapes.

The combined cross-layer fixture exposed the decisive second root cause: `normalizeToolRegistry` assigned the boolean result of an MCP-only expression to every tool, so the always-present `builtin:text_stats` was serialized with `reviewRequired: false`. React intentionally rejects any builtin tool that carries MCP governance fields. This made even the default Worker admin GET fail `isAdminConfigSnapshot`; the first MCP compatibility patch could not fix the page by itself.

## Revised Decision

- Canonicalize data with a single safe meaning in the Worker: unique fallbacks, bounded safe integers, and omitted blank optional strings.
- Preserve valid historical environment credential references and hidden server-only values; never return plaintext secrets or headers.
- Retain non-runnable historical MCP servers as disabled recovery records. Do not invent HTTPS endpoints, OAuth scopes, or credential references.
- Permit disabled recovery records to round-trip so an administrator can repair or delete them; continue rejecting the same invalid state when enabled.
- Add a cross-layer characterization assertion that calls the real React `isAdminConfigSnapshot` decoder on the exact JSON returned by the Worker GET handler.
- Keep MCP governance projection executor-specific: builtin tools omit `reviewRequired` and every fingerprint/side-effect field, while MCP tools retain the complete-governance or disabled/review-required recovery branches.
