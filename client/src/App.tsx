import { useCallback, useEffect, useState } from "react";
import { LoginView } from "./components/LoginView";
import { ChatWorkspace } from "./components/ChatWorkspace";
import { fetchSession, login, logout, type SessionProjection } from "./lib/api";

type AppState =
  | { status: "loading" }
  | { status: "login"; message?: string }
  | { status: "authenticated"; session: SessionProjection };

export function App() {
  const [state, setState] = useState<AppState>({ status: "loading" });

  const refresh = useCallback(async () => {
    const session = await fetchSession();
    setState(session ? { status: "authenticated", session } : { status: "login" });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (state.status === "loading") {
    return <PageState title="正在连接 Chatus" detail="正在恢复登录状态和 Agent 连接。" />;
  }

  if (state.status === "login") {
    return (
      <LoginView
        message={state.message}
        onSubmit={async (accessCode) => {
          const result = await login(accessCode);
          if (!result.ok) {
            setState({ status: "login", message: result.message });
            return;
          }
          await refresh();
        }}
      />
    );
  }

  return (
    <ChatWorkspace
      session={state.session}
      onLogout={async () => {
        await logout();
        setState({ status: "login" });
      }}
    />
  );
}

function PageState({ title, detail }: { title: string; detail: string }) {
  return (
    <main className="page-state" aria-live="polite">
      <div className="brand-mark">C</div>
      <h1>{title}</h1>
      <p>{detail}</p>
    </main>
  );
}
