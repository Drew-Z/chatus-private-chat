# Open-Source Image Input Research

Research date: 2026-07-25. Repositories were inspected read-only at the pinned commits below. No live model was called.

## Open WebUI

Source: <https://github.com/open-webui/open-webui/blob/ecd48e2f718220a6400ecf49eafd4867a38feb10/src/lib/components/chat/MessageInput.svelte>

- Gates uploads on selected-model `vision` and `file_upload` capabilities before accepting the file.
- Supports clipboard images, drag/drop, file picker, upload-pending state, preview/removal, and image-only submission.
- Reads images as data URLs for temporary chat, optionally compresses them, and otherwise uploads them to server-managed storage.
- Useful Chatus lesson: one attachment state machine should feed every acquisition path, and pending uploads must block send.

## LibreChat

Sources:

- <https://github.com/danny-avila/LibreChat/blob/21dc4a2ef490b86510e4b410fe8f78d52c1d9629/client/src/components/Chat/Input/Files/AttachFileChat.tsx>
- <https://github.com/danny-avila/LibreChat/blob/21dc4a2ef490b86510e4b410fe8f78d52c1d9629/client/src/components/Chat/Input/Files/DragDropWrapper.tsx>
- <https://github.com/danny-avila/LibreChat/blob/21dc4a2ef490b86510e4b410fe8f78d52c1d9629/api/server/middleware/limiters/uploadLimiters.js>

- Resolves endpoint/agent file configuration before presenting an attachment control.
- Keeps drag/drop overlay mounted for stable interaction and maintains a rich attachment lifecycle with previews and live/DB reconciliation.
- Applies both IP and authenticated-user upload rate limiters on the server.
- Useful Chatus lesson: client capability gating is UX; endpoint policy and abuse limits remain authoritative.

## LobeChat

Sources:

- <https://github.com/lobehub/lobe-chat/blob/3384fe491e001245fe1929c322dc8137cf00ca62/src/features/AttachmentInput/AttachmentUploadButton.tsx>
- <https://github.com/lobehub/lobe-chat/blob/3384fe491e001245fe1929c322dc8137cf00ca62/src/components/DragUploadZone/usePasteFile.ts>
- <https://github.com/lobehub/lobe-chat/blob/3384fe491e001245fe1929c322dc8137cf00ca62/src/components/DragUploadZone/useLocalDragUpload.ts>
- <https://github.com/lobehub/lobe-chat/blob/3384fe491e001245fe1929c322dc8137cf00ca62/src/store/file/slices/chat/uploadGuard.ts>
- <https://github.com/lobehub/lobe-chat/blob/3384fe491e001245fe1929c322dc8137cf00ca62/src/hooks/useVisualMediaUploadAbility.ts>

- Uses one batch callback for multi-select, clipboard, and drag/drop.
- Separates file-type filtering from model visual-media capability, including fallback visual-understanding policy.
- Explicitly supports PNG, JPEG/JPG, WebP, and GIF for chat images.
- Useful Chatus lesson: keep acquisition, file validation, and model capability as separate testable decisions.

## Vercel AI Chatbot

Sources:

- <https://github.com/vercel/ai-chatbot/blob/c2f8235e1f3ea903ad8b7f61447c4f74164b5c58/components/chat/multimodal-input.tsx>
- <https://github.com/vercel/ai-chatbot/blob/c2f8235e1f3ea903ad8b7f61447c4f74164b5c58/components/chat/preview-attachment.tsx>
- <https://github.com/vercel/ai-chatbot/blob/c2f8235e1f3ea903ad8b7f61447c4f74164b5c58/app/%28chat%29/api/files/upload/route.ts>

- Converts uploaded attachments to AI SDK `{ type: "file", mediaType, name, url }` message parts.
- Supports picker and pasted images, shows horizontal previews/loading states, permits removal, and blocks send while uploads are pending.
- The server validates authenticated uploads with an explicit MIME allowlist and 5 MB limit before object storage.
- Useful Chatus lesson: use native AI SDK file parts and keep preview/loading state separate from the final message payload.

## Official AI SDK And Cloudflare Agents

Sources:

- <https://ai-sdk.dev/docs/ai-sdk-ui/chatbot#file-attachments>
- <https://developers.cloudflare.com/agents/runtime/operations/using-ai-models/>

- AI SDK accepts a `FileList` through `sendMessage({ text, files })` or explicit `FileUIPart` objects with `filename`, `mediaType`, and URL/data URL.
- UI rendering is based on message `parts`, including image file parts.
- Cloudflare Agents uses AI SDK under `AIChatAgent`, preserves long-running Agent work across client disconnects, and supports streaming through the Agent transport.
- Useful Chatus lesson: stay inside the existing `UIMessage.parts` contract so reconnect, persistence, and provider conversion remain aligned.

## Decision For Chatus

Adopt the shared interaction pattern but keep the first implementation narrower:

- image-only, not general file upload;
- one reducer for picker/paste/drop;
- server-projected limits and route capability;
- inline data URLs with strict total bounds instead of a new R2 lifecycle;
- exact server rejection rather than silent attachment dropping;
- no prompt/image bytes in logs, exports, telemetry, or research artifacts.
