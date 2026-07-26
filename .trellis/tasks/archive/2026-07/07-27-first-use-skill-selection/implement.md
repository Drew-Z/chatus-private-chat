# Implementation Plan

- [x] Add Worker conversation-create regression coverage for omitted `skillIds`, stable three-Skill default ordering, disabled/deny-all filtering, guest denial, explicit empty preservation, and explicit unauthorized rejection.
- [x] Change the create-only default branch in `validateAgentConversationSettings()` to derive IDs from the current enabled assigned public Skill projection.
- [x] Change the typed React new-conversation action to omit `skillIds`; keep hydration, PATCH, branch, and per-turn filtering unchanged.
- [x] Add a frontend structure assertion that the ordinary create path omits the field and that existing conversation hydration still reads persisted `activeConversation.skillIds`.
- [x] Update the frontend capability/state contracts with the create-versus-PATCH three-state semantics and the first-use bootstrap boundary.
- [x] Run `npm run check:frontend`, focused Worker tests, `npm test`, `npm run test:browser:workspace`, `npm run test:browser:agent`, `npm run typecheck`, `npx wrangler deploy --dry-run`, `git diff --check`, and Trellis task validation.
- [x] Review the diff for credentials, access codes, conversation content, stored memory, production identifiers, and unrelated user changes before commit.

## Verification Record

- 2026-07-27: Frontend structure checks passed; the focused Worker suite passed 91 tests and the full Vitest suite passed 31 files / 368 tests.
- 2026-07-27: The workspace Playwright matrix passed 56 checks with 14 expected viewport skips, and the real local-Agent fake-provider acceptance passed its streaming, approval, attachment, and branch scenario.
- 2026-07-27: Strict type-check, Wrangler deployment dry-run, Trellis task validation, sensitive-literal review, and diff checks passed. No live model, push, or production deployment was used.

## Rollback

Revert the create-only server default and restore the typed client explicit empty array. No data rollback is needed because persisted arrays remain valid under both behaviors.
