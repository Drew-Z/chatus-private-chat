# Text File Attachments

## Scenario: Member Text File Context Uploads

### 1. Scope / Trigger

- Trigger: changing generic file upload, composer attachment drafts, session `fileInput` policy, Worker/Agent message normalization, provider conversion, branch/retry persistence, export, or browser workspace fixture coverage.
- The MVP supports member-only UTF-8 text-like files. Images stay on the existing image path. PDFs, Office files, folders, archives, remote URLs, R2 storage, native provider file upload, and sandbox execution are separate designs.

### 2. Signatures

```typescript
type FileInputPolicy = {
  acceptedMediaTypes: string[];
  acceptedExtensions: string[];
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxExtractedChars: number;
};

type SessionCapabilities = {
  imageInput: boolean;
  fileInput: boolean;
  memory: boolean;
  messageActions: boolean;
  feedback: boolean;
  accountData: boolean;
};
```

```text
GET /api/session
  -> { fileInput: FileInputPolicy, capabilities.fileInput: boolean, ... }

AI SDK user part from browser
  -> { type: "file", mediaType, filename, url: "data:<text-like>;base64,<utf8-bytes>" }

Provider-visible normalized text
  -> <attached_file name="notes.md" mediaType="text/markdown" bytes="123">...</attached_file>
```

Optional Worker variables are `MAX_FILES_PER_REQUEST`, `MAX_FILE_BYTES`, `MAX_TOTAL_FILE_BYTES`, and `MAX_FILE_CHARS`. They may lower defaults but must not raise hard inline ceilings.

### 3. Contracts

- `src/contracts/file.ts` is the single owner for supported media types/extensions, filename normalization, strict data URL parsing, UTF-8 decoding, byte/char counting, stable error literals, and deterministic `<attached_file>` formatting.
- Member session projections set `capabilities.fileInput === true`; guest projections always set `capabilities.fileInput === false` even when the public route supports images.
- The browser uses one mixed attachment draft lifecycle for images and files. Images may create object URLs; text files must not create object URLs and must keep only bounded UTF-8 text/data URL state until submission settles.
- `/api/chat` and `prepareTeamAgentTurn()` must validate file input before provider execution. Text files become ordinary text parts before provider routing; provider adapters must not receive native non-image file parts.
- `TeamAgent.sanitizeMessageForPersistence()` converts valid text-file `file` parts into deterministic text parts before durable AIChat persistence. Invalid file turns use the same pending rejection/delete-stale-row path as invalid images.
- Render persisted `<attached_file>` text blocks as compact attachment rows in the React transcript, while copy/edit actions keep the full text context.
- Export and cleanup rely on the existing conversation text path. Exports may include deterministic attached-file text as conversation text, but must never include object URLs, raw binary bytes, credentials, provider metadata, or hashes.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Guest or disabled session sends generic text file | `400 file_not_supported`; no provider fetch |
| Unsupported extension/media type | `400 invalid_file_type` |
| Remote URL, malformed data URL, bad Base64, MIME mismatch, or non-UTF-8 bytes | `400 invalid_file_data` |
| More than `maxFiles` in one user message | `400 too_many_files` |
| One file exceeds `maxFileBytes` | `413 file_too_large` |
| Combined file bytes exceed `maxTotalBytes` | `413 files_too_large` |
| Extracted text exceeds `maxExtractedChars` | `413 file_text_too_large` |
| Any file part in a user turn is invalid | Delete the rejected turn and make zero provider requests |

### 5. Good / Base / Bad Cases

- Good: a member sends text plus `notes.md`; the provider receives text plus one deterministic `<attached_file>` block and no `data:text` URL.
- Base: the selected route does not support images; image chips show unsupported, but member text-file upload remains available because file context is route-portable text.
- Bad: persisting a generic AI SDK `file` part and relying on `convertToModelMessages()` lets a non-portable file reach a provider or tool continuation.
- Bad: hiding file upload in the guest UI while accepting forged guest file parts server-side widens public access.

### 6. Tests Required

- Unit-test file policy clamping, media/extension acceptance, filename normalization, data URL parsing, UTF-8 decode failures, size/count/char limits, and deterministic attached-file formatting.
- Client decoder tests must reject missing/malformed `fileInput`, malformed `capabilities.fileInput`, and guest projections with `fileInput: true`.
- Worker tests must prove valid text files reach a local fake provider only as deterministic text, and invalid/guest file input causes zero provider fetches.
- Agent tests must prove valid text-file parts are converted before persistence, invalid turns are deleted, and branch/retry paths preserve the bounded text context.
- Browser workspace tests must cover mixed image/file chips, reading/error/remove/retry states, disabled image capability with file upload still available, and the 1920/1440/780/480/390 viewport matrix.

### 7. Wrong vs Correct

#### Wrong

```typescript
await chat.sendMessage({
  files: [{ type: "file", mediaType: "text/markdown", filename: "notes.md", url }],
});
// Later: convertToModelMessages(this.messages) forwards the generic file part.
```

#### Correct

```typescript
const parsed = parseDataTextFile(part.url, part.mediaType, part.filename, filePolicy, state);
parts.push({ type: "text", text: parsed.file.contextText });
```

Normalize text files to bounded text at the Worker/Agent boundary so every provider route and tool continuation sees the same portable context.
