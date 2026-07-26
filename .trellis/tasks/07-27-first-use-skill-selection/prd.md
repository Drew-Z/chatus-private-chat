# Automatic first-use Skill selection

## Goal

Make new member conversations useful without a hidden manual Skill-selection prerequisite while preserving explicit per-conversation controls and server-side allow-list enforcement.

## Requirements

- A newly created member conversation must be useful without requiring the member to discover the settings drawer and manually activate every assigned Skill first.
- When the create request omits `skillIds`, the server derives the initial selection from the current enabled and assigned Skill projection, preserves administrator ordering, and persists at most the existing three-Skill limit.
- An explicit create payload `skillIds: []` remains a deliberate no-Skill selection. An explicit non-empty list retains the current normalization, limit, and authorization checks.
- `allowedSkills === undefined` continues to mean all enabled Skills are assigned, while `allowedSkills: []` continues to deny all Skills. Conversation defaults must not collapse this administrator assignment distinction.
- Guests receive no default Skills. Existing, imported, resumed, and branched conversations are not backfilled or migrated.
- Conversation PATCH semantics do not change: omitted `skillIds` leaves the selection unchanged, while `skillIds: []` clears it.
- Every turn continues to filter the persisted/client selection against the current enabled assignment before adding instructions or tools, so a revoked Skill cannot be restored by stale state.
- The React new-conversation path omits `skillIds` and treats the server response as authoritative. Conversation switching and refresh continue to preserve an explicitly empty persisted selection.
- This task provides a deterministic first-use bootstrap only. It does not claim to implement request-relevance Skill selection; a future automatic mode must use an explicit contract rather than reinterpret empty arrays.

## Acceptance Criteria

- [ ] Omitting `skillIds` for a new member conversation persists the first three enabled, assigned Skills in the existing stable registry order.
- [ ] Explicit empty and explicit valid non-empty selections remain distinguishable and round-trip unchanged.
- [ ] Explicit unassigned Skill IDs still fail with `403 skill_not_allowed`.
- [ ] A deny-all assignment and every guest create path produce an empty selection.
- [ ] Existing conversation hydration, PATCH, branch inheritance, and turn-time revocation behavior remain unchanged.
- [ ] The typed client no longer sends `skillIds: []` for the ordinary new-conversation action.
- [ ] Focused Worker/client contract tests and the full project release gates pass without live model calls or production deployment.

## Notes

- Parent task: `.trellis/tasks/07-16-team-agent-productization`.
- The existing three-Skill ceiling is intentionally unchanged; raising it would alter prompt and tool budgets and belongs in a separate task.
