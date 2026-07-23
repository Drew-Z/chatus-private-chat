import { useCallback, useEffect, useState } from "react";
import { LoginView } from "./components/LoginView";
import { ChatWorkspace } from "./components/ChatWorkspace";
import { AdminApp } from "./components/AdminApp";
import { PageState } from "./components/PageState";
import { fetchSession, login, logout, type SessionProjection } from "./lib/api";
import type { ClientSurface } from "./lib/routing";

type AppState =
  | { status: "loading" }
  | { status: "login"; message?: string }
  | { status: "error"; message: string }
  | { status: "authenticated"; session: SessionProjection };

export function App({ surface = "chat" }: { surface?: ClientSurface }) {
  if (surface === "admin") return <AdminApp />;
  return <ChatApp />;
}

function ChatApp() {
  const [state, setState] = useState<AppState>({ status: "loading" });

  const refresh = useCallback(async () => {
    try {
      const session = await fetchSession();
      setState(session ? { status: "authenticated", session } : { status: "login" });
    } catch (error) {
      setState({ status: "error", message: error instanceof Error ? error.message : "暂时无法连接服务器。" });
    }
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

  if (state.status === "error") {
    return <PageState title="连接暂时中断" detail={state.message} onRetry={() => { setState({ status: "loading" }); void refresh(); }} />;
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
