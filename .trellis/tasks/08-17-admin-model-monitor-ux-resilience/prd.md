# Admin model monitor UX resilience

## Goal

Make model monitoring searchable, correctly visualized, and resilient when unrelated operations sections fail.

## Requirements

- Apply operations search to model-monitor groups and their relevant provider/model labels.
- Visualize monitor-native success/failure information, not only total attempts.
- Isolate read failures so a non-monitor section cannot collapse the full operations page.
- Keep legacy endpoints, transition controls, rollout state, gates, and evidence completely unchanged.
- Use existing read data only; do not add or run synthetic probes.

## Acceptance Criteria

- [x] Search filters model-monitor groups and displays a clear no-match state.
- [x] Trend presentation distinguishes attempts and outcomes or exposes an equivalent success-rate signal with accessible text.
- [x] Independent section failures render local retry/error states while healthy sections remain usable.
- [x] Model-monitor failure remains visible and retryable.
- [x] No legacy rollout file, endpoint, control, gate, state, or evidence is changed.
- [x] Tests cover filtering, trend semantics, and partial failures with mocked responses.

## Notes

- Baseline evidence: `client/src/features/admin/AdminOperationsPanel.tsx:157,715` and `client/src/lib/api.ts:1210`.
