import { useState, type FormEvent } from "react";
import { ProductBrand } from "./ProductBrand";

export function LoginView({
  message,
  onSubmit,
}: {
  message?: string;
  onSubmit: (accessCode: string) => Promise<void>;
}) {
  const [accessCode, setAccessCode] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessCode.trim() || submitting) return;
    setSubmitting(true);
    await onSubmit(accessCode.trim());
    setSubmitting(false);
  }

  return (
    <main className="auth-shell">
      <section className="auth-panel" aria-labelledby="login-title">
        <ProductBrand />
        <p className="eyebrow">BIAU PORT · 成员入口</p>
        <h1 id="login-title">进入你的工作台</h1>
        <p className="muted">使用专属访问码连接你的 Agent、对话和已分配能力。</p>
        <form onSubmit={handleSubmit} className="stack-form">
          <label htmlFor="access-code">访问码</label>
          <input
            id="access-code"
            type="password"
            autoComplete="current-password"
            value={accessCode}
            onChange={(event) => setAccessCode(event.target.value)}
            placeholder="输入访问码"
            required
          />
          <button type="submit" disabled={submitting}>{submitting ? "正在进入..." : "进入泊语"}</button>
          <p className="form-message" role="status">{message}</p>
        </form>
      </section>
    </main>
  );
}
