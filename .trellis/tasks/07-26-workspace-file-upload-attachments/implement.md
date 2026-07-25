# Workspace File Upload Attachments - Implementation Plan

## Execution

1. [x] Add a shared `FileInputPolicy` / validation contract for supported text file attachments, error codes, filename normalization, byte/char limits, and environment clamps.
2. [x] Extend `SessionProjection` and exact client decoder with `capabilities.fileInput` and `fileInput`, with guest projections forced to disabled.
3. [x] Generalize the client draft attachment helper so picker/drop can accept both current images and supported text files while preserving object URL cleanup for images only.
4. [x] Update `MessageComposer` UI copy, attachment strip states, remove/retry controls, and disabled states for mixed image/file drafts.
5. [x] Normalize text file attachments into deterministic model-visible text context before provider execution in both `/api/chat` and `/agent`.
6. [x] Extend Agent persistence validation so forged or malformed non-image file parts cannot be silently persisted or sent to a provider.
7. [x] Ensure branch/edit/resend/regenerate/continue, export, account deletion, conversation cleanup, and local draft restoration handle bounded file context consistently.
8. [x] Add a frontend code-spec for file attachments and update the frontend spec index.
9. [x] Add the Codex-like workspace roadmap to product docs or the parent task once the MVP boundaries are confirmed.

## Validation

```powershell
npm.cmd run check:frontend
npm.cmd test
npm.cmd run test:browser:workspace
npm.cmd run typecheck
npx.cmd wrangler deploy --dry-run
git diff --check
python ./.trellis/scripts/task.py validate .trellis/tasks/07-26-workspace-file-upload-attachments
```

## Focused Tests

- Unit-test file policy clamping, MIME/extension allow-listing, UTF-8 decode failures, filename normalization, count limits, per-file byte limits, total byte limits, and extracted char limits.
- Worker/API tests prove unsupported/oversized forged files fail before provider fetch and that valid file context reaches only local fake providers.
- Agent tests prove persistence reload and branch/resend flows preserve bounded file context without leaking raw file URLs or binary bytes.
- Client decoder tests reject widened guest projections and malformed file policies.
- Browser tests cover picker, drag/drop, remove, retry, mixed image/file drafts, unsupported file chips, and no horizontal overflow across the viewport matrix.

## Rollback Points

- After session projection changes: disabling file capability must hide the UI and reject forged file requests.
- After composer changes: current image picker/paste/drop behavior must remain green.
- After Agent persistence changes: rejected file turns must not leave poisoned AIChat rows.
- Before commit: verify no uploaded fixture includes real user content or secrets.
