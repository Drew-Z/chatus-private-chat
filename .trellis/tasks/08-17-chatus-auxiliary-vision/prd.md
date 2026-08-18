# Chatus auxiliary vision

## Goal

Implement truthful native and assisted image paths with bounded private evidence and auxiliary Provider accounting.

## Requirements

- Dependency: `08-17-chatus-capability-catalog-adoption` must be complete and
  green; consume its projection, disclosure, and augmentation-assignment
  contracts without redefining them.
- Preserve native `supportsImages` truth and derive exactly one image mode:
  `native`, `assisted_tool`, `assisted_preanswer`, or `none`.
- The helper route is administrator-selected, enabled, credential-ready,
  instance-owned, and backed by an executable native-image offering. It cannot
  require member BYOK or recursively use assisted vision.
- Tool-capable text routes must use a forced trusted `image_inspect` executor;
  text-only routes run bounded helper inspection before the main answer.
- Raw Base64 images never enter generic MCP JSON or the selected unsupported text
  Provider request. The helper receives canonical in-scope image parts only.
- Normalize strict bounded private evidence containing description, OCR text,
  and limitations. Exclude it from member export and monitoring; include it in
  validated admin backup/restore; copy only with source images and delete it with
  the conversation.
- Add a distinct `auxiliary_vision` Provider run kind and reuse existing route
  plans, credentials, capacity, budgets, deadlines, usage, cancellation, and
  terminal ledger settlement.
- One submitted message consumes one admission. Failure or cancellation prevents
  unsupported main I/O and exposes retry, remove-image, and native-route recovery.
- Tests use fake Providers only and do not modify protected observation or legacy
  rollout artifacts.

## Acceptance Criteria

- [x] Route projection and UI distinguish native, both assisted paths, and none
  without labeling assisted models as natively multimodal.
- [x] Fake Provider matrices prove exact run order/count/kind, one admission,
  helper fallback, usage/cost capture, no unsupported image leakage, and complete
  terminal settlement.
- [x] Missing config/credential/capacity/budget, malformed evidence, timeout, and
  cancellation fail before unsupported main Provider I/O; late results are inert.
- [x] Evidence decoders reject unknown keys, URLs, oversized fields/arrays, raw
  Provider output, and reasoning; lifecycle tests cover follow-up, branch,
  edit/resend, regenerate, delete, export, backup, and restore.
- [x] Native image behavior and existing Provider monitoring remain green.

## Parent Acceptance Mapping

This child owns parent AC4-AC5 and the auxiliary-vision portions of AC7, AC9,
and AC10.
