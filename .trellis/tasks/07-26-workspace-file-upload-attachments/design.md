# Workspace File Upload Attachments - Design

## Architecture

Reuse the existing image attachment shape, but split the domain into two policies:

```text
Browser File objects
  -> draft attachment helper
  -> bounded text extraction or image data URL
  -> UI message parts
  -> Worker normalization
  -> Agent persistence validation
  -> provider text/image conversion
```

Images keep their current data URL path. Generic files start as local `File` objects, are decoded as UTF-8 text in the browser for preview/status, and are validated again in the Worker/Agent before any provider call.

## Contracts

### Session projection

Add a member-only file policy beside the existing image policy:

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

Guest projections must have `capabilities.fileInput === false`.

### Draft attachments

The client should either generalize `DraftImageAttachment` into `DraftAttachment` or add a parallel `DraftFileAttachment` helper. A combined draft owns:

- local `File`
- normalized filename
- media type / extension
- byte size
- reading / ready / error status
- optional object URL for image previews only
- extracted text for supported file attachments

### Model-visible representation

The portable MVP should not send arbitrary non-image `file` parts to provider adapters. Instead, file content becomes a deterministic text part:

```text
<attached_file name="notes.md" mediaType="text/markdown" bytes="1234">
...
</attached_file>
```

The Worker and Agent own the final normalization so a forged browser payload cannot bypass limits. If a request contains unsupported file parts, the server rejects or strips the rejected turn before provider execution, following the existing image safety pattern.

## Data Flow

1. Composer picker/drop receives `File[]`.
2. The draft helper classifies images through the current image path and text files through the new file policy.
3. FileReader decodes text attachments as UTF-8. Decode errors produce `read_failed`.
4. Sending a turn converts ready images to image parts and ready files to bounded text context parts.
5. `/api/chat` and `/agent` both validate file context before quota/provider execution.
6. Agent persistence keeps only bounded text context and sanitized file metadata.
7. Export and deletion use the existing Agent cleanup path.

## Compatibility

- Existing image behavior must remain unchanged.
- Existing provider configs do not need a new `supportsFiles` flag for MVP because file content is text-normalized before provider routing.
- The MVP is member-only, so public guest route access remains single-model plain chat plus approved image input.
- Legacy chat fallback should either understand the same normalized text context or reject file attachments before model execution.

## Roadmap Toward Codex-like Workspace Features

1. Multi-file text context attachments.
2. Folder selection that flattens supported text files with sanitized relative paths and explicit count/size caps.
3. Server-side document extraction for PDF/DOCX/XLSX/PPTX with deterministic parsers and no live model calls.
4. Workspace file tree with selectable context, pinning, search, and per-conversation file references.
5. Tool-backed file operations with user approval, revision checks, and export/delete semantics.
6. Optional Cloudflare sandbox/code execution for trusted members, behind a separate security design.
7. Goal/planning mode that can reason over attached project files, propose tasks, and run approved tools, closer to Codex.

## Rollback

Disabling `capabilities.fileInput` in the session projection must hide the UI and make forged file requests fail closed. Since the MVP stores only bounded text in the existing transcript path, rollback does not require deleting a new object store.
