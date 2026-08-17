# Quota-aware member composer

## Goal

Keep visible session usage current after chat turns and prevent members from composing into a known exhausted quota without explanation.

## Requirements

- Refresh session usage after each terminal chat-turn outcome without delaying transcript completion.
- Expose remaining/limit state to the composer using existing session contracts.
- Disable send only when exhaustion is known; unknown or refresh-failed state must not falsely block use.
- Explain quota exhaustion and recover automatically after a later successful refresh.

## Acceptance Criteria

- [ ] Session usage refreshes after successful and failed terminal turn outcomes.
- [ ] The composer visibly explains and blocks send when the server-reported quota is exhausted.
- [ ] A usage-refresh failure preserves the last known value and does not erase the chat result.
- [ ] Unknown quota state does not falsely disable the composer.
- [ ] Tests cover refresh timing, exhausted/available/unknown states, and refresh failure.

## Notes

- Baseline evidence: `client/src/App.tsx:36`, `ChatWorkspace.tsx:520`, and `MessageComposer.tsx:72`.
