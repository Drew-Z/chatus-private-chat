# Multimodal Image Input

## 1. Scope / Trigger

Use this contract when changing image attachment acquisition, the session image policy, AI SDK user file parts, Worker message normalization, Agent persistence, provider image conversion, branching, export, or conversation deletion.

The first release stores bounded inline data URLs in the per-conversation AIChat SQLite message table. R2/object storage, remote browser URLs, general files, OCR, image generation, and client recompression are separate designs.

## 2. Signatures

```typescript
type ImageInputPolicy = {
  acceptedMediaTypes: Array<"image/png" | "image/jpeg" | "image/webp" | "image/gif">;
  maxImages: number;
  maxImageBytes: number;
  maxTotalImageBytes: number;
};

type ImageValidationErrorCode =
  | "invalid_image_type"
  | "invalid_image_data"
  | "image_too_large"
  | "too_many_images"
  | "images_too_large";

parseDataImage(value: unknown, declaredMediaType?: unknown): DataImageParseResult;
imageInputPolicy(env: Env): ImageInputPolicy;
normalizeMessages(input: unknown, env: Env): MessageNormalizationResult;
sanitizeUserImageParts(parts: UIMessage["parts"], policy: ImageInputPolicy): SanitizedUserImageParts;
```

```text
GET /api/session
  -> { routes[].supportsImages: boolean, imageInput: ImageInputPolicy, ... }

AI SDK user part
  -> { type: "file", mediaType, filename?, url: "data:image/...;base64,..." }
```

Optional Worker variables are `MAX_IMAGES_PER_REQUEST`, `MAX_IMAGE_BYTES`, and `MAX_TOTAL_IMAGE_BYTES`. The historical `MAX_IMAGES_PER_REQUEST` name means the maximum for each normalized message/turn, not a cumulative conversation-history limit.

## 3. Contracts

- `src/contracts/image.ts` owns MIME normalization, strict padded Base64 parsing, exact decoded-byte calculation, default ceilings, and error literals. Worker, Agent, legacy conversion, and provider adapters reuse it instead of defining regexes or approximate byte formulas.
- Defaults are four images, 1,300,000 decoded bytes per image, and 1,300,000 decoded bytes combined per user message. Environment values may lower these limits but must never raise the inline ceilings.
- Image count and total bytes reset for every normalized message. Accumulating these values across the complete conversation makes later image turns fail after earlier valid images and is forbidden.
- `/api/session` projects the exact policy. The client decoder accepts only the four supported MIME values and positive integer limits; components do not invent fallback limits.
- Picker, clipboard paste, and file drag/drop all enter the same draft helper. Browser `File` and object URLs are local preview state only; requests contain validated data URLs.
- Draft previews keep reading, ready, and per-item error states. Object URLs are revoked on removal, successful submission, abandoned rejected submission, conversation switch/logout, and unmount.
- Submission permits images with optional text. Text and attachments form one draft generation: a rejection restores both only when the user has not created any newer draft state.
- A route without `supportsImages: true` disables acquisition in the client. The Worker/Agent still reject forged file parts with `image_not_supported` before quota consumption or provider execution.
- User `file` parts are validated before durable persistence. If any user file part is invalid, every file part in that turn is stripped, the rejected persisted turn is deleted, and the exact error is returned. Imported invalid legacy turns are filtered without leaving pending rejection state.
- Valid user image parts survive Agent reload and durable branch/edit/resend/regenerate flows. Text-only historical edit preserves existing validated image parts.
- Provider conversion parses the canonical data URL again and fails closed. OpenAI-compatible and Anthropic adapters never silently drop a malformed image.
- User-data export includes only bounded `{ type: "file", mediaType, name? }` metadata. It never includes file URLs or bytes. Conversation cleanup and full user-data deletion remove the AIChat rows that contain inline image data.
- Logs, telemetry, diagnostics, feedback, Trellis artifacts, and passive reliability records contain no image URL, bytes, content hash, or byte fingerprint.

## 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Remote URL, empty data, invalid Base64, or MIME/data mismatch | `400 invalid_image_data` |
| MIME outside PNG, JPEG/JPG, WebP, GIF | `400 invalid_image_type` |
| More than the policy count in one message | `400 too_many_images` |
| One decoded image exceeds `maxImageBytes` | `413 image_too_large` |
| Combined decoded images in one message exceed `maxTotalImageBytes` | `413 images_too_large` |
| Selected logical route is not image-capable | `400 image_not_supported` |
| Client FileReader fails | Keep the item as `read_failed`; allow retry/remove; send remains disabled |
| Agent receives a forged invalid user file part | Delete the rejected turn and make zero provider requests |
| Import contains an invalid user image turn | Filter that turn; do not poison the next live submission |
| A newer local draft exists when submission fails | Keep the newer text/images and revoke the abandoned submitted previews |

## 5. Good / Base / Bad Cases

- Good: a user sends two images totaling less than 1.3 MB, later sends another valid image in the same conversation, branches the first turn, and all persisted branches reload while export exposes metadata only.
- Base: a text-only route shows a disabled attachment control; text chat remains unchanged and a forged image request receives `image_not_supported` before provider fetch.
- Bad: the client accepts four images per turn but the Worker accumulates image count across historical messages, so the fifth image in a later turn fails unexpectedly.
- Bad: Agent persistence silently removes only the malformed file and executes the remaining text, making the user believe the model saw an image that never reached it.
- Bad: increasing `MAX_IMAGE_BYTES` above 1.3 MB appears to work until Base64 expansion causes `SQLITE_TOOBIG` in `cf_ai_chat_agent_messages`.

## 6. Tests Required

- Unit-test strict Base64 padding, MIME aliases/mismatch, exact decoded bytes, per-image/count/per-message totals, and upper/lower environment clamping.
- Assert two separate valid image messages do not share count or total-size counters.
- Assert `/api/session` and the exact client decoder agree on `ImageInputPolicy` and `routes[].supportsImages`.
- Assert every image rejection returns the stable status/code and causes zero provider fetches.
- Persist an image at the 1,300,000-byte ceiling, evict the Durable Object, reload it, and assert the complete file part remains.
- Assert forged Agent turns are deleted, branch copies retain image parts, export omits data URLs, and cleanup leaves no AIChat message rows.
- Cover OpenAI-compatible and Anthropic conversion with local fixtures only. Do not contact a live provider or run a capability probe.
- Cover picker, paste, drop, read failure, retry, removal, image-only send, whole-draft rejection recovery, capability changes, object URL cleanup, and the 1920/1440/780/480/390 viewport matrix.
- Before shipping run `npm run check:frontend`, `npm test`, `npm run test:browser:workspace`, `npm run typecheck`, `npx wrangler deploy --dry-run`, and `git diff --check`.

## 7. Wrong vs Correct

### Wrong

```typescript
let totalImageBytes = 0;
for (const message of conversation) {
  totalImageBytes += approximateBase64Bytes(message);
  if (totalImageBytes > limit) return imageError("images_too_large");
}
```

This applies a composer/SQLite-row limit to the entire conversation and makes later valid image turns fail.

### Correct

```typescript
for (const message of conversation) {
  let imageCount = 0;
  let totalImageBytes = 0;
  for (const part of message.parts) {
    const parsed = parseDataImage(part.url, part.mediaType);
    if (!parsed.ok) return imageError(parsed.error);
    imageCount += 1;
    totalImageBytes += parsed.image.decodedBytes;
    if (imageCount > policy.maxImages) return imageError("too_many_images");
    if (totalImageBytes > policy.maxTotalImageBytes) return imageError("images_too_large");
  }
}
```

The canonical parser and per-message counters keep client policy, SQLite persistence, legacy conversion, and provider execution aligned.
