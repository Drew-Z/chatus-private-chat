import { useEffect, useRef, useState, type FormEvent } from "react";
import { LogIn, X } from "lucide-react";

export function MemberLoginDialog({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (accessCode: string) => Promise<string | null>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [accessCode, setAccessCode] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    const frame = window.requestAnimationFrame(() => dialog?.querySelector<HTMLInputElement>("input")?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      if (dialog?.open) dialog.close();
      previousFocusRef.current?.focus();
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = accessCode.trim();
    if (!code || submitting) return;
    setSubmitting(true);
    setMessage("");
    try {
      const error = await onSubmit(code);
      if (error) setMessage(error);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "暂时无法登录，请稍后重试。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="account-action-dialog member-login-dialog"
      aria-labelledby="member-login-title"
      aria-describedby="member-login-description"
      onCancel={(event) => { event.preventDefault(); if (!submitting) onClose(); }}
      onMouseDown={(event) => { if (event.target === event.currentTarget && !submitting) onClose(); }}
    >
      <div className="account-action-dialog-content">
        <header>
          <div><LogIn size={17} aria-hidden="true" /><strong id="member-login-title">成员登录</strong></div>
          <button className="icon-button" type="button" onClick={onClose} disabled={submitting} aria-label="关闭" title="关闭"><X size={18} /></button>
        </header>
        <form className="account-action-dialog-body stack-form" onSubmit={handleSubmit}>
          <p id="member-login-description">输入管理员发放的访问码，解锁已分配的模型和成员能力。</p>
          <label htmlFor="member-access-code">访问码</label>
          <input
            id="member-access-code"
            type="password"
            autoComplete="current-password"
            value={accessCode}
            onChange={(event) => setAccessCode(event.target.value)}
            placeholder="输入访问码"
            disabled={submitting}
            required
          />
          {message && <p className="account-status error" role="alert">{message}</p>}
          <div className="account-dialog-actions">
            <button className="quiet-button" type="button" onClick={onClose} disabled={submitting}>取消</button>
            <button className="primary-button icon-text-button" type="submit" disabled={submitting || !accessCode.trim()}>
              <LogIn size={15} />
              <span>{submitting ? "登录中..." : "登录"}</span>
            </button>
          </div>
        </form>
      </div>
    </dialog>
  );
}
