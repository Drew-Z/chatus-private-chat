# Workspace File Upload Attachments

## Goal

Add a Codex-like attachment workflow so a member can add local files to a chat turn as bounded context. The first release should make file upload useful for notes, code snippets, logs, configuration, CSV/JSON, and Markdown without introducing unsafe binary parsing, live model probes, or a new storage service.

## Background

- The chat workspace already supports image attachments through picker, paste, drag/drop, object URL previews, strict client policy, Worker normalization, Agent persistence validation, branch persistence, export redaction, and cleanup.
- The current image contract explicitly leaves general files, PDF/Office parsing, R2/object storage, and remote browser URLs for later designs.
- Provider adapters currently understand text and image parts. Generic provider-native file parts are not portable across OpenAI-compatible and Anthropic-compatible routes.
- AIChat conversation rows can store bounded inline content, but large arbitrary binary files risk SQLite limits, slow sync, privacy surprises, and oversized prompts.
- Public guest access is intentionally restricted; the first guest release supports plain chat and approved image input only.

## Requirements

### R1. Member-only file context MVP

- Authenticated members can attach multiple local text-like files to one outgoing message.
- Anonymous guests do not receive generic file upload in the first release.
- Attachments are sent as message context for the current turn and persist with the conversation as bounded, visible user-provided context.
- A text-only message, image-only message, file-only message, and mixed text/image/file message all use the same draft lifecycle.

### R2. Safe supported formats and limits

- The MVP supports text-derived formats only: plain text, Markdown, JSON, YAML, CSV/TSV, XML/HTML/CSS, JavaScript/TypeScript, common source files, logs, and other UTF-8 text files.
- Unsupported binary formats, PDFs, DOCX, XLSX, PPTX, archives, executables, and remote URLs are rejected with stable visible errors.
- File limits are explicit in the session projection and enforced again server-side. Recommended first-release ceilings are 5 files, 256 KiB per file, and 512 KiB total extracted text per message.
- Filenames are normalized, bounded, and treated as untrusted display text. Directory paths, when later supported, must be relative and sanitized.

### R3. Prompt and persistence semantics

- Text file content is converted into a deterministic model-visible context block with filename, media type, byte count, and bounded content.
- Provider routing does not depend on native file upload support. The first release works with every text-capable logical route because files are normalized to text context before provider execution.
- Branch/edit/resend/regenerate/continue preserve the bounded file context exactly like other user message parts.
- User-data export must be explicit about attached file metadata and whether file text is included as conversation text; it must never include raw binary bytes or object URLs.

### R4. UI and accessibility

- The composer exposes an attachment action that covers images and files without hiding the existing image workflow.
- Ready, reading, rejected, remove, retry, and capability-disabled states are visible in a stable attachment strip on desktop and touch layouts.
- Drag/drop and file picker share the same validation path. Clipboard paste may keep image-only behavior unless text-file paste can be implemented safely.
- Long filenames and many attachment chips must not create horizontal overflow at the existing viewport matrix.

### R5. Codex-like capability roadmap

- Planning must capture the next stages after MVP: folder upload, PDF/Office extraction, project workspace/file tree, selectable context, task goals, tool-backed file operations, and optional sandbox/code execution.
- Roadmap items are not part of the first implementation unless explicitly promoted into a later Trellis child task.
- Folder selection is a roadmap item, not part of this MVP. The MVP ships multi-file text attachments first so limits, persistence, export, and provider prompt behavior can be validated before introducing relative paths and directory trees.

## Acceptance Criteria

- [ ] A member can attach a valid small text/Markdown/JSON/code file, send it, and the local fake provider receives the bounded file context.
- [ ] Unsupported binary files and oversized files are rejected before provider execution with stable client and server errors.
- [ ] Guests cannot enable or forge generic file upload.
- [ ] File attachments survive Agent persistence reload and branch/resend flows within configured limits.
- [ ] Export, cleanup, logs, telemetry, feedback, and diagnostics do not expose raw binary bytes, object URLs, credentials, or private file hashes.
- [ ] Browser tests cover picker, drag/drop, rejected files, remove/retry, mixed image/file drafts, and 1920/1440/780/480/390 layouts.
- [ ] The implementation passes `npm run check:frontend`, `npm test`, `npm run test:browser:workspace`, `npm run typecheck`, `npx wrangler deploy --dry-run`, `git diff --check`, and Trellis task validation.

## Out Of Scope

- PDF, DOCX, XLSX, PPTX, archive, audio, video, OCR, and remote URL ingestion in the MVP.
- Folder upload, recursive directory traversal, and workspace file trees in the MVP.
- R2-backed long-lived file storage or cross-conversation file libraries.
- Editing remote repositories or local filesystem state from the web UI.
- Code execution, terminals, sandboxes, package installation, or autonomous project modification.
- Generic file upload for anonymous guests.
