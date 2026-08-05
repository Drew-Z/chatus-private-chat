# Implementation Plan: Admin Config Compatibility Recovery

## Ordered Checklist

- [x] Add one combined historical Worker fixture containing duplicate fallbacks, numeric-string/fractional limits, out-of-range capacity, hidden credential markers, and an incomplete MCP tool.
- [x] Canonicalize route fallbacks, integer quota/token/capacity fields, and blank optional credential metadata in Worker normalization without exposing or dropping server-only credential state.
- [x] Isolate historical MCP servers with invalid executable endpoint/auth/scope state as disabled recovery objects; keep enabled validation strict and make disabled repair/delete PUT round-trips possible.
- [x] Pass the exact Worker GET JSON to `isAdminConfigSnapshot`; refine React compatibility only for disabled recovery shapes that cannot be canonicalized without inventing semantics.
- [x] Add client and Worker negative cases proving invalid enabled MCP servers/tools remain rejected.
- [x] Extend capability registry tests for explicit delete and same-ID rediscovery upgrade without changing unrelated tools or assignments.
- [x] Extend Workspace Playwright with the exact legacy projection and verify operational admin render plus one recovery/save path.
- [x] Run focused tests, then `trellis-check`, the complete shipping gate, and Trellis consistency validation.
- [x] Update the relevant frontend API/capability spec with the fail-closed legacy compatibility rule.
- [x] Commit the focused work, open a PR, retain CI artifacts, merge, validate the GitHub Actions deployment at the exact SHA, record evidence, and archive the child.

## Validation Commands

```text
npx vitest run tests/client-api.test.ts tests/client-admin-capabilities.test.ts tests/worker-api.test.ts
npm run check:frontend
npm test
npm run test:browser:workspace
npm run typecheck
npx wrangler deploy --dry-run
git diff --check
python ./.trellis/scripts/task.py validate-all
python -m unittest discover -s .trellis/tests -p test_*.py -v
```

## Review Gates

- Compatibility gate: incomplete governance is accepted only when fail-closed flags are exact; invalid historical MCP server execution metadata is visible only while disabled.
- Canonical projection gate: every combined legacy Worker GET response accepted by the API contract passes the production React decoder without client-side coercion.
- Preservation gate: no decoder or save path silently enables, deletes, or fabricates governance for the legacy tool.
- Regression gate: complete MCP tools, builtin tools, discovery review behavior, and admin config exact-key validation remain unchanged.
- Delivery gate: no production action occurs outside GitHub Actions and exact-SHA acceptance artifacts contain no configuration payloads or credentials.

## Risky Files and Rollback Points

- `client/src/lib/api.ts`: broad predicates risk accepting runnable malformed capabilities; compatibility branches must require exact disabled state.
- `src/worker.ts`: production normalization is security-sensitive; integer fallback and MCP isolation must be deterministic, bounded, and covered before changing persistence behavior.
- `client/src/lib/admin-capabilities.ts`: retain existing discovery semantics; only same-ID replacement is in scope.
- Browser fixtures must use local fake data and must not capture production responses.
