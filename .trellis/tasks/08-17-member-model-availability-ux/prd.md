# Member model availability UX

## Goal

Give members an honest, actionable view of model availability without hiding read failures or conflating availability with route health.

## Requirements

- Represent availability loading, success, empty, stale, and error states explicitly.
- Keep aggregate model availability and route/service health as separately labeled concepts.
- Provide a manual retry for read failures without triggering provider probes.
- Preserve the last successful value when a refresh fails, clearly marked as stale.

## Acceptance Criteria

- [ ] Availability read failures are visible and retryable rather than swallowed.
- [ ] The header no longer presents route health as if it were current aggregate model availability.
- [ ] A failed refresh can show the prior value with stale/error context.
- [ ] Empty configured availability is distinguishable from a network failure.
- [ ] Tests cover loading, empty, error, stale, success, and retry states with mocked endpoints only.

## Notes

- Baseline evidence: `client/src/features/chat/ChatWorkspace.tsx:140` and `WorkspaceHeader.tsx:91`.
