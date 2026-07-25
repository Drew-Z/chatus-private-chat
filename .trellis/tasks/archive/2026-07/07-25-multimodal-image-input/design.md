# Multimodal Image Input - Design

## Chosen Shape

Keep the existing AI SDK `UIMessage` file-part and inline-data architecture for the first release, while making the full boundary strict and user-visible:

```text
picker / paste / drop
  -> local attachment reducer
  -> MIME/count/size validation + object URL preview
  -> FileReader data URL
  -> sendMessage({ parts: [file..., text?] })
  -> TeamAgent canonical image validation before persistence
  -> legacy ChatMessage image_url conversion
  -> route/provider capability filtering
  -> AI SDK provider image part
```

## Client Contracts

```typescript
type ImageInputPolicy = {
  acceptedMediaTypes: Array<"image/png" | "image/jpeg" | "image/webp" | "image/gif">;
  maxImages: number;
  maxImageBytes: number;
  maxTotalImageBytes: number;
};

type DraftImageAttachment = {
  id: string;
  file: File;
  filename: string;
  mediaType: ImageInputPolicy["acceptedMediaTypes"][number];
  size: number;
  previewUrl: string;
  dataUrl?: string;
  status: "reading" | "ready" | "error";
  error?: "unsupported_type" | "too_large" | "too_many" | "total_too_large" | "read_failed";
};
```

Use a small reducer/helper module under `client/src/lib/` for deterministic add/remove/read/send/recovery transitions. `MessageComposer` owns presentation callbacks; `ConversationChat` owns draft state and Agent submission.

## Session Projection

Add `imageInput: ImageInputPolicy` to the exact session projection. Availability is derived from the selected route's existing `supportsImages` projection, while accepted MIME and limits come from the Worker environment/config. A route change revalidates existing draft attachments; unsupported drafts remain visible with an error until removed or the user returns to a capable route.

## Message Construction

```typescript
const parts = [
  ...readyImages.map((image) => ({
    type: "file" as const,
    mediaType: image.mediaType,
    filename: image.filename,
    url: image.dataUrl,
  })),
  ...(text ? [{ type: "text" as const, text }] : []),
];

await chat.sendMessage({ role: "user", parts });
```

Do not submit browser `File`, object URLs, remote URLs, or raw ArrayBuffers to the Agent. Object URLs are preview-only and always revoked.

## Canonical Server Validation

Extract the existing data-image parser into a shared server-side contract owner used by:

- Worker `/api/chat` normalization
- TeamAgent incoming `UIMessage.file` validation before persistence
- `toLegacyMessages()` conversion
- provider model-message conversion
- focused tests

The parser returns exact metadata and decoded byte length, accounting for base64 padding. Normalization returns either a complete validated message list or an explicit error; it never partially drops an attachment.

Local workerd verification proved that the earlier 2,500,000-byte proposal expands past the AIChat SQLite row limit and fails with `SQLITE_TOOBIG`. The safe inline defaults therefore keep the complete Base64-expanded user message below the SDK's 1.8 MB safety threshold:

```text
max images: 4
max decoded bytes per image: 1,300,000
max decoded bytes per user message: 1,300,000
accepted types: PNG, JPEG, WebP, GIF
```

## Error Matrix

| Condition | Client behavior | Server behavior |
| --- | --- | --- |
| Route lacks image capability | Disable attach, retain visible draft error after route change | `400 image_not_supported` before provider planning |
| Unsupported MIME | Per-item error, no read | `400 invalid_image_type` |
| Malformed/non-data URL | Not constructible through UI | `400 invalid_image_data` |
| Per-image size exceeded | Per-item error | `413 image_too_large` |
| Count exceeded | Reject excess selection as a visible batch error | `400 too_many_images` |
| Total size exceeded | Keep existing items, reject offending additions | `413 images_too_large` |
| FileReader fails | Item error with remove/retry | No request |
| Send fails before acceptance | Restore submitted draft snapshot | Existing safe Agent error, no duplicate submission |

## Persistence And Privacy

- Incoming user `file` parts are validated before persistence: only valid bounded image data URLs survive. Server-authored assistant/tool file parts remain governed by their existing output contracts.
- The same validation runs before model conversion so persisted content and provider content cannot diverge.
- Branch snapshots copy validated image parts. Text-only edit operations preserve source image parts according to the existing branch contract or explicitly reject unsupported edits; they never erase images silently.
- Export retains only media type and bounded filename. Logs and telemetry retain no URL, byte length fingerprint, or content.
- Conversation deletion and user-data purge remain the authoritative lifecycle delete paths.

## UX References

The design intentionally combines recurring open-source patterns documented in `research/open-source-image-input.md`: capability-aware attachment controls, paste/drop support, horizontal preview/removal, upload/read pending state, server validation, and structured AI SDK file parts.

## Compatibility And Rollback

- Existing text-only messages and persisted valid file parts remain readable.
- The attach control can be removed without changing provider adapters; strict persistence validation should remain.
- Inline data URLs avoid a new R2 binding/migration in this slice. The verified SQLite ceiling is authoritative: larger image limits require authenticated R2/object storage as a separate migration task and must not be enabled through environment overrides alone.
- No production deployment occurs locally.
