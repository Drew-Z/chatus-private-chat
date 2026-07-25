import { useEffect, useRef } from "react";
import { SendHorizontal, Square } from "lucide-react";

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
  onChange,
  onSubmit,
  onStop,
  busy,
  blocked,
  online,
  routeAvailable,
  agentReady,
  placeholder,
  statusText,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  busy: boolean;
  blocked: boolean;
  online: boolean;
  routeAvailable: boolean;
  agentReady: boolean;
  placeholder: string;
  statusText: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (textareaRef.current) resizeComposerTextarea(textareaRef.current);
  }, [value]);

  return (
    <form className="composer" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
      <div className="composer-box">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
            resizeComposerTextarea(event.currentTarget);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder={placeholder}
          rows={1}
          disabled={busy || blocked || !online || !routeAvailable}
          aria-label="消息"
        />
        {busy ? (
          <button className="composer-action stop" type="button" onClick={onStop} title="停止生成" aria-label="停止生成"><Square size={17} /></button>
        ) : (
          <button className="composer-action" type="submit" disabled={blocked || !value.trim() || !online || !agentReady || !routeAvailable} title="发送" aria-label="发送"><SendHorizontal size={18} /></button>
        )}
      </div>
      <span className="composer-status" role="status" aria-live="polite" aria-atomic="true" aria-hidden={!statusText}>{statusText || "\u00a0"}</span>
    </form>
  );
}
