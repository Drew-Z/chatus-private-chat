# Multimodal Image Input

## Goal

Let users attach supported images to a chat turn through the React workspace with clear previews, capability-aware controls, strict validation, safe persistence, and correct AI SDK/provider conversion.

## Background

- The Worker already accepts inline `data:image/...;base64` parts for PNG, JPEG, WebP, and GIF. The implementation must keep each complete Base64-expanded user message below the AIChat SQLite row limit.
- Provider contracts and provider-pool administration already project `supportsImages`, and both chat execution paths filter routes/provider candidates by that capability.
- The provider adapter already converts image data URLs into AI SDK model image parts for OpenAI-compatible and Anthropic providers.
- `MessageView` already renders AI SDK `file` parts whose media type is an image.
- The current composer and send path accept only text, so normal users cannot reach the existing multimodal backend.
- Agent persistence currently keeps arbitrary `file` parts without validating URL scheme, MIME, count, or size. This must be corrected before exposing the UI.

## Requirements

### R1. Capability-aware input

- The attach control is enabled only when the selected logical route reports `supportsImages: true` and the workspace is online, ready, and not account-blocked.
- Capability enforcement remains server-side. A forged file part on a non-image route fails before provider execution.
- Image policy is projected from the server as an exact contract so the client does not duplicate limit constants.

### R2. Attachment acquisition

- Support a paperclip file picker, clipboard image paste, and drag/drop over the composer/workspace.
- Accept PNG, JPEG/JPG, WebP, and GIF only in the first release.
- Multiple selection is supported up to the server-projected count and total-size limits.
- The inline first release supports up to four images whose combined decoded size is at most 1,300,000 bytes; the same value is the per-image ceiling. Larger payloads require a later authenticated object-storage design.
- Preserve ordinary pasted text and ignore non-file drag data.

### R3. Preview and lifecycle

- Selected images appear in a stable horizontal preview strip above the text area with thumbnail, filename, size, upload/read status, and a remove button.
- Reading/validation failures stay attached to the relevant item with a clear retry/remove path.
- Object URLs used for local preview are revoked on removal, successful submission, conversation switch, logout, and unmount.
- Sending is disabled while any attachment is still reading or invalid.

### R4. Message submission and recovery

- A turn may contain text plus images or images without text.
- The client sends AI SDK `file` parts with exact `mediaType`, bounded filename, and a validated data URL, followed by an optional text part.
- Successful submission clears the draft and attachments. Rejected submission restores the exact submitted text and attachments unless the user has already created newer draft state.
- Stop, retry, regenerate, branch, export, and deletion behavior remain consistent. Editing a historical image turn is text-only in the first release and must not silently discard its image parts.

### R5. Strict server normalization and persistence

- Both `/api/chat` and `/agent` reject unsupported MIME, malformed base64, remote URLs, excess count, per-image limit, and total-image limit with a stable non-secret error code.
- Invalid or excess images are not silently dropped from a turn.
- Agent persistence retains only validated image file parts and bounded file metadata. Non-image file parts and remote URLs are rejected or removed before durable storage.
- Validation and provider conversion share one canonical data-image parser/limit policy to avoid drift.

### R6. Privacy and storage

- Image bytes never enter logs, diagnostics, telemetry, feedback, user-data export, or task artifacts.
- User-data export continues to include only safe file metadata. Conversation/user deletion removes persisted image data.
- The first release uses bounded inline data URLs because the existing Agent/provider path already supports them. R2/object storage, deduplication, and thumbnails are deferred until usage justifies the added lifecycle surface.
- No image EXIF extraction, OCR, or background processing is added.

### R7. Accessible responsive UX

- The attach and remove controls use icons with accessible names/tooltips and stable touch targets.
- Keyboard users can open the picker, remove attachments, and send an image-only turn.
- Preview layout must not widen the transcript or composer at 1920, 1440, 780, 480, and touch-enabled 390 pixel viewports.

## Acceptance Criteria

- [x] Picker, paste, and drag/drop add valid images and preserve ordinary text behavior.
- [x] The preview strip displays reading, ready, and error states; removal revokes local preview resources.
- [x] Text-plus-image and image-only turns reach `sendMessage()` as valid AI SDK file/text parts.
- [x] A rejected send restores submitted attachments without overwriting newer draft state.
- [x] Non-image routes disable the UI and reject forged file parts server-side.
- [x] Unsupported MIME, malformed base64, remote URL, count overflow, per-file overflow, and total overflow produce exact errors and no provider call.
- [x] Agent reload retains valid image turns but cannot persist arbitrary remote/non-image/oversized file parts.
- [x] Provider conversion is covered for OpenAI-compatible and Anthropic image inputs using local fixtures only.
- [x] Export/log/telemetry assertions prove no image data URL or bytes escape the conversation store.
- [x] Deletion removes image-bearing conversations and stale reconnect cannot restore them.
- [x] Five-viewport Playwright acceptance finds no overlap or horizontal page overflow.
- [x] Full release gates pass without a live model call or local production deployment.

## Out Of Scope

- General documents, audio, video, camera capture, HEIC conversion, OCR, or image generation.
- Remote image URLs supplied by the browser.
- R2/object-storage migration, thumbnails, deduplication, or client-side recompression.
- Editing or replacing images inside a historical message.
- Capability probing against a live provider.

## Product Decision

The designated public guest model may receive the same image UI only after its logical route is explicitly marked image-capable. The exact upstream model capability remains a configuration decision in the public-access task.
