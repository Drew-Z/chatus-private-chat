# Design: Admin Config Compatibility Recovery

## Boundary

The recovery is a cross-layer projection contract. The Worker owns canonicalization of persisted and environment-backed historical configuration before the admin GET response. React keeps strict runnable contracts, while accepting explicitly disabled recovery objects only where administrators need to repair or delete legacy state.

## Compatibility Contract

An MCP tool is valid when either:

1. all governance fields pass the existing validators; or
2. one or more governance fields are absent, every present governance field is valid, `enabled` is exactly `false`, and `reviewRequired` is exactly `true`.

Both branches continue to require valid label, input schema, confirmation mode, MCP executor type, and non-empty server identity. The compatibility branch never derives missing fingerprints or revisions and never changes tool state.

The canonical admin projection additionally guarantees:

- route fallbacks are ordered and unique;
- quota, token, concurrency, and timeout values are bounded safe integers;
- optional credential metadata is trimmed and blank values are omitted;
- hidden legacy credential markers preserve server-only values without exposing them;
- an MCP server that fails the current executable endpoint/auth/scope contract is retained only as `enabled: false` recovery state.
- builtin tools never receive MCP-only governance properties; `reviewRequired` is omitted rather than serialized as `false`.

Enabled MCP servers remain subject to the complete HTTPS, versioned-auth, managed-reference, and non-empty OAuth-scope contract. Compatibility never upgrades HTTP to HTTPS, invents scopes, rewrites a secret reference, or makes a disabled server runnable.

## Data Flow

1. `loadEditableConfig` reads KV, environment JSON, or defaults and calls `normalizeAppConfig`.
2. Registry normalizers canonicalize arrays and bounded integers, trim optional metadata, and isolate non-runnable MCP servers as disabled recovery entries.
3. `normalizeToolRegistry` projects old MCP tools as disabled/review-required with undefined governance fields.
4. `sanitizeAdminConfig` removes plaintext keys and headers while retaining explicit non-sensitive shadow markers.
5. JSON serialization omits undefined fields from `GET /api/admin/config`.
6. `isAdminConfigSnapshot` validates the exact Worker JSON; strict runnable branches remain unchanged and narrow disabled compatibility branches accept recovery state.
7. Admin UI can repair/delete isolated servers and tools. PUT accepts disabled recovery shapes but continues to reject enabling them before repair.

## Test Boundaries

- Worker API: combined legacy persistence-to-GET projection, exact React decoder acceptance, and GET/PUT/GET preservation.
- Client API: safe incomplete tool/server shapes accepted only while disabled; enabled, non-review, malformed governed fields, and invalid executable variants rejected.
- Capability merge/delete: same-ID rediscovery upgrades the tool and delete affects only owned references.
- Workspace Playwright: admin config containing the legacy shape reaches the operational panel rather than the global error state, and a save/delete path preserves unrelated data.

## Trade-offs

- Worker canonicalization is preferred for values with one safe representation (unique arrays and bounded integers). Client compatibility is reserved for disabled recovery values that must remain visible to administrators.
- Requiring the Worker to synthesize governance hashes, endpoints, scopes, or secret references would create false trust, while dropping the record would remove the administrator's recovery controls.
- No direct persisted-data migration is needed. A successful admin PUT writes the canonical form; explicit repair, rediscovery, or delete removes compatibility cases naturally.

## Rollout and Rollback

- Ship through a focused PR with local fake fixtures and the full repository gate.
- Production deployment occurs only from GitHub Actions after merge to `main`.
- Validate the exact deployed SHA by signing into the real admin surface and confirming configuration loads; do not use synthetic probes or expose response payloads in artifacts.
- Rollback is a PR revert. The server data remains unchanged throughout, so rollback does not require data restoration.
