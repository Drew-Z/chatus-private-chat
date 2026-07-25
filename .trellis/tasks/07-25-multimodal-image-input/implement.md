# Multimodal Image Input - Implementation Plan

## Execution

1. [x] Add a canonical data-image parser and exact normalization result shared by Worker, TeamAgent persistence, legacy conversion, and provider adapters; add padding-aware byte/count/total limits.
2. [x] Add structured errors for unsupported capability, MIME, malformed data, count overflow, per-image overflow, and total overflow. Prove no provider call occurs after rejection.
3. [x] Add `ImageInputPolicy` to the Worker session projection and exact client decoder without exposing provider internals.
4. [x] Add a pure client attachment reducer/helper with object URL cleanup, FileReader conversion, batch validation, deterministic ordering, and rejected-send restoration tests.
5. [x] Extend `MessageComposer` with a paperclip button, hidden multiple file input, paste handler, drag/drop state, preview strip, per-item error/remove actions, and image-only send enablement.
6. [x] Send AI SDK `file` and optional `text` parts from `ConversationChat`; clear or restore the submitted attachment snapshot consistently with text drafts.
7. [x] Harden incoming user-message persistence and branch/edit behavior so valid images round-trip and forged user file parts cannot become durable without breaking server-authored file outputs.
8. [x] Add OpenAI-compatible and Anthropic conversion fixtures, Agent reload/export/delete tests, forged-client tests, and privacy assertions.
9. [x] Extend the deterministic workspace fixture for ready/reading/error previews and verify keyboard, touch, overflow, and route-capability behavior across five viewports.
10. [x] Update frontend Agent/persistence, provider capability, privacy/export, and operations specs.

## Validation

```powershell
npm.cmd run check:frontend
npm.cmd test
npm.cmd run test:browser:workspace
npm.cmd run typecheck
npx.cmd wrangler deploy --dry-run
git diff --check
python ./.trellis/scripts/task.py validate .trellis/tasks/07-25-multimodal-image-input
```

All provider behavior uses local fixtures. Do not call a live model or perform a liveness probe.

## Validation Results

- `npm.cmd run check:frontend` passed.
- `npm.cmd test` passed with 22 files and 273 tests.
- `npm.cmd run test:browser:workspace` passed with 33 tests and 2 expected viewport skips.
- `npm.cmd run typecheck` passed for Worker, React client, and browser fixture.
- `npx.cmd wrangler deploy --dry-run` passed without deployment.
- `git diff --check` and Trellis task validation passed.
- Retained 1920px and 390px screenshots were inspected; no page overflow or control overlap was found.
- No live provider request, model liveness probe, or local production deployment was performed.

## Risk And Rollback Points

- After parser extraction: all existing valid text/image fixtures must remain accepted before client work begins.
- After Agent persistence hardening: valid historical image parts must reload; invalid remote/non-image parts must fail closed without corrupting text.
- After composer work: removing the UI change must not require reverting server validation.
- Before release: inspect retained screenshots and verify image data is absent from test output, task files, logs, exports, and git diff.
