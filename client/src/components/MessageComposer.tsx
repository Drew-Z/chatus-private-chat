import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import { FileText, Image as ImageIcon, LoaderCircle, Paperclip, RefreshCw, SendHorizontal, Square, X } from "lucide-react";
import type { FileInputPolicy } from "../../../src/contracts/file";
import type { ImageInputPolicy } from "../../../src/contracts/image";
import {
  attachmentErrorLabel,
  type DraftAttachment,
} from "../lib/image-input";
import { resolveComposerQuota } from "../lib/state";

export const COMPOSER_MAX_HEIGHT = 180;

export function resizeComposerTextarea(element: HTMLTextAreaElement, maxHeight = COMPOSER_MAX_HEIGHT): number {
  element.style.height = "auto";
  const height = Math.min(Math.max(element.scrollHeight, 42), maxHeight);
  element.style.height = `${height}px`;
  element.style.overflowY = element.scrollHeight > maxHeight ? "auto" : "hidden";
  return height;
}

export function MessageComposer({
  value,
  attachments,
  imagePolicy,
  filePolicy,
  imagesSupported,
  filesSupported,
  onChange,
  onAddAttachments,
  onRemoveAttachment,
  onRetryAttachment,
  onSubmit,
  onStop,
  busy,
  blocked,
  online,
  routeAvailable,
  agentReady,
  usage,
  usageRefreshing,
  onRefreshUsage,
  placeholder,
  statusText,
}: {
  value: string;
  attachments: DraftAttachment[];
  imagePolicy: ImageInputPolicy;
  filePolicy: FileInputPolicy;
  imagesSupported: boolean;
  filesSupported: boolean;
  onChange: (value: string) => void;
  onAddAttachments: (files: File[]) => void;
  onRemoveAttachment: (id: string) => void;
  onRetryAttachment: (id: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  busy: boolean;
  blocked: boolean;
  online: boolean;
  routeAvailable: boolean;
  agentReady: boolean;
  usage?: { used: number; limit: number; remaining: number } | null;
  usageRefreshing?: boolean;
  onRefreshUsage?: () => void;
  placeholder: string;
  statusText: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const quota = resolveComposerQuota(usage);
  const quotaExhausted = quota.status === "exhausted";
  const attachDisabled = busy || blocked || quotaExhausted || !online || !routeAvailable || !agentReady || (!imagesSupported && !filesSupported);
  const attachmentsSettled = attachments.every((attachment) => attachment.status === "ready");
  const hasReadyAttachment = attachments.some((attachment) => attachment.status === "ready");
  const hasUnsupportedAttachment = attachments.some((attachment) => (
    (attachment.kind === "image" && !imagesSupported) ||
    (attachment.kind === "file" && !filesSupported)
  ));
  const sendDisabled = blocked
    || (!value.trim() && !hasReadyAttachment)
    || !attachmentsSettled
    || !online
    || !agentReady
    || !routeAvailable
    || quotaExhausted
    || hasUnsupportedAttachment;
  const quotaStatusText = quota.status === "exhausted"
    ? `今日消息额度已用完（${quota.used} / ${quota.limit}）。刷新额度后可继续。`
    : quota.status === "available"
      ? `今日剩余 ${quota.remaining} / ${quota.limit}`
      : "";
  const visibleStatusText = quotaExhausted ? quotaStatusText : statusText || quotaStatusText;

  useEffect(() => {
    if (textareaRef.current) resizeComposerTextarea(textareaRef.current);
  }, [value]);

  const addClipboardImages = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (attachDisabled) return;
    const files = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    if (files.length) onAddAttachments(files);
  };

  const handleDragEnter = (event: DragEvent<HTMLFormElement>) => {
    if (attachDisabled || !event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLFormElement>) => {
    if (!dragging) return;
    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  };

  const handleDrop = (event: DragEvent<HTMLFormElement>) => {
    dragDepth.current = 0;
    setDragging(false);
    if (attachDisabled || !event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    const files = Array.from(event.dataTransfer.files);
    if (files.length) onAddAttachments(files);
  };

  return (
    <form
      className={`composer${dragging ? " is-dragging" : ""}`}
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy && !sendDisabled) onSubmit();
      }}
      onDragEnter={handleDragEnter}
      onDragOver={(event) => {
        if (!attachDisabled && event.dataTransfer.types.includes("Files")) event.preventDefault();
      }}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="composer-box">
        {attachments.length > 0 && (
          <div className="attachment-strip" aria-label="待发送附件">
            {attachments.map((attachment) => {
              const unsupported = attachment.kind === "image" ? !imagesSupported : !filesSupported;
              const error = unsupported
                ? attachmentErrorLabel("capability_disabled", attachment.kind)
                : attachment.error ? attachmentErrorLabel(attachment.error, attachment.kind) : "";
              return (
                <figure className={`attachment-preview ${attachment.status}`} key={attachment.id}>
                  <div className="attachment-thumbnail">
                    {attachment.previewUrl
                      ? <img src={attachment.previewUrl} alt="" />
                      : attachment.kind === "image"
                        ? <ImageIcon size={22} aria-hidden="true" />
                        : <FileText size={22} aria-hidden="true" />}
                    {attachment.status === "reading" && <LoaderCircle className="attachment-spinner" size={18} aria-hidden="true" />}
                  </div>
                  <figcaption>
                    <strong title={attachment.filename}>{attachment.filename}</strong>
                    <span className={error ? "attachment-error" : ""}>{error || formatFileSize(attachment.size)}</span>
                  </figcaption>
                  {attachment.error === "read_failed" && !unsupported && (
                    <button className="attachment-icon" type="button" onClick={() => onRetryAttachment(attachment.id)} title="重新读取" aria-label={`重新读取 ${attachment.filename}`}><RefreshCw size={14} /></button>
                  )}
                  <button className="attachment-icon remove" type="button" onClick={() => onRemoveAttachment(attachment.id)} title="移除附件" aria-label={`移除 ${attachment.filename}`}><X size={15} /></button>
                </figure>
              );
            })}
          </div>
        )}
        {dragging && <div className="composer-drop-hint" role="status">松开以添加附件</div>}
        <div className="composer-input-row">
          <input
            ref={fileInputRef}
            className="sr-only"
            type="file"
            accept={[...imagePolicy.acceptedMediaTypes, ...filePolicy.acceptedMediaTypes, ...filePolicy.acceptedExtensions].join(",")}
            multiple
            tabIndex={-1}
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files || []);
              event.currentTarget.value = "";
              if (files.length) onAddAttachments(files);
            }}
          />
          <button
            className="composer-tool"
            type="button"
            disabled={attachDisabled}
            onClick={() => fileInputRef.current?.click()}
            title={!attachDisabled ? "添加附件" : "当前会话不支持附件"}
            aria-label={!attachDisabled ? "添加附件" : "当前会话不支持附件"}
          ><Paperclip size={18} /></button>
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(event) => {
              onChange(event.target.value);
              resizeComposerTextarea(event.currentTarget);
            }}
            onPaste={addClipboardImages}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder={quotaExhausted ? "今日消息额度已用完" : placeholder}
            rows={1}
            disabled={busy || blocked || !online || !routeAvailable}
            readOnly={quotaExhausted}
            aria-label="消息"
            aria-describedby="composer-status"
          />
          {busy ? (
            <button className="composer-action stop" type="button" onClick={onStop} title="停止生成" aria-label="停止生成"><Square size={17} /></button>
          ) : (
            <button className="composer-action" type="submit" disabled={sendDisabled} title="发送" aria-label="发送"><SendHorizontal size={18} /></button>
          )}
        </div>
        <div className="composer-status-row">
          <span id="composer-status" className="composer-status" role="status" aria-live="polite" aria-atomic="true" aria-hidden={!visibleStatusText}>{visibleStatusText || "\u00a0"}</span>
          {quotaExhausted && onRefreshUsage && (
            <button className="composer-quota-refresh" type="button" onClick={onRefreshUsage} disabled={usageRefreshing}>
              <RefreshCw size={14} aria-hidden="true" /><span>{usageRefreshing ? "刷新中" : "刷新额度"}</span>
            </button>
          )}
        </div>
      </div>
    </form>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
