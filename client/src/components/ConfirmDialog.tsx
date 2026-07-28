import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { X } from "lucide-react";

type ConfirmDialogProps = {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  pendingLabel?: string;
  tone?: "default" | "danger";
  fallbackFocus?: () => HTMLElement | null;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
};

export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  pendingLabel = "处理中...",
  tone = "default",
  fallbackFocus,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const errorId = useId();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    const frame = window.requestAnimationFrame(() => {
      dialog?.querySelector<HTMLElement>("[data-dialog-initial-focus]")?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (dialog?.open) dialog.close();
      const previous = previousFocusRef.current;
      const focusTarget = previous?.isConnected ? previous : fallbackFocus?.();
      if (focusTarget?.isConnected) focusTarget.focus();
    };
  }, []);

  async function confirm() {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      await onConfirm();
      onCancel();
    } catch (failure) {
      setError(failure instanceof Error && failure.message.trim()
        ? failure.message
        : "操作失败，请重试。");
    } finally {
      setPending(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = [...dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    )].filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
    if (!focusable.length) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !dialog.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="confirm-dialog"
      aria-labelledby={titleId}
      aria-describedby={`${descriptionId}${error ? ` ${errorId}` : ""}`}
      aria-busy={pending}
      onKeyDown={handleKeyDown}
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onCancel();
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onCancel();
      }}
    >
      <div className="confirm-dialog-content">
        <header>
          <h2 id={titleId}>{title}</h2>
          <button className="icon-button" type="button" onClick={onCancel} disabled={pending} aria-label="关闭确认窗口" title="关闭">
            <X size={17} />
          </button>
        </header>
        <div className="confirm-dialog-body">
          <p id={descriptionId}>{description}</p>
          {error && <p className="confirm-dialog-error" id={errorId} role="alert">{error}</p>}
        </div>
        <footer>
          <button className="quiet-button" data-dialog-initial-focus type="button" onClick={onCancel} disabled={pending}>取消</button>
          <button className={tone === "danger" ? "danger-button" : "primary-button"} type="button" onClick={() => void confirm()} disabled={pending}>
            {pending ? pendingLabel : confirmLabel}
          </button>
        </footer>
      </div>
    </dialog>
  );
}
