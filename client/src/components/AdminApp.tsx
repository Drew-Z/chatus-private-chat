import { useCallback, useEffect, useState, type FormEvent } from "react";
import { KeyRound } from "lucide-react";
import { AdminWorkspace } from "./AdminWorkspace";
import { PageState } from "./PageState";
import { adminLogin, fetchAdminSession } from "../lib/api";

type AdminAppState =
  | { status: "loading" }
  | { status: "login"; message?: string }
  | { status: "error"; message: string }
  | { status: "authenticated" };

export function AdminApp() {
  const [state, setState] = useState<AdminAppState>({ status: "loading" });

  const refresh = useCallback(async () => {
    try {
      const authenticated = await fetchAdminSession();
      setState(authenticated ? { status: "authenticated" } : { status: "login" });
    } catch (error) {
      setState({ status: "error", message: error instanceof Error ? error.message : "暂时无法连接管理服务。" });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (state.status === "loading") {
    return <PageState title="正在连接管理后台" detail="正在恢复管理员会话。" />;
  }

  if (state.status === "error") {
    return <PageState title="管理后台暂时不可用" detail={state.message} onRetry={() => { setState({ status: "loading" }); void refresh(); }} />;
  }

  if (state.status === "login") {
    return (
      <AdminLoginView
        message={state.message}
        onSubmit={async (token) => {
          const result = await adminLogin(token);
          if (!result.ok) {
            setState({ status: "login", message: result.message });
            return;
          }
          setState({ status: "loading" });
          await refresh();
        }}
      />
    );
  }

  return (
    <AdminWorkspace
      onSessionExpired={() => setState({ status: "login", message: "管理员会话已失效，请重新登录。" })}
      onLogout={() => setState({ status: "login" })}
    />
  );
}

function AdminLoginView({
  message,
  onSubmit,
}: {
  message?: string;
  onSubmit: (token: string) => Promise<void>;
}) {
  const [token, setToken] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token.trim() || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(token.trim());
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-shell admin-auth-shell">
      <section className="auth-panel" aria-labelledby="admin-login-title">
        <div className="brand-lockup">
          <div className="brand-mark">A</div>
          <div>
            <strong>Chatus</strong>
            <span>Private AI workspace</span>
          </div>
        </div>
        <p className="eyebrow">ADMIN ACCESS</p>
        <h1 id="admin-login-title">进入管理后台</h1>
        <p className="muted">管理员 Token 仅用于建立后台会话。</p>
        <form onSubmit={submit} className="stack-form">
          <label htmlFor="admin-token">管理员 Token</label>
          <input
            id="admin-token"
            type="password"
            autoComplete="current-password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            required
          />
          <button type="submit" disabled={submitting} className="icon-text-button">
            <KeyRound size={16} />
            <span>{submitting ? "正在验证..." : "进入后台"}</span>
          </button>
          <p className="form-message" role="status">{message}</p>
        </form>
        <a className="auth-back-link" href="/">返回聊天</a>
      </section>
    </main>
  );
}
