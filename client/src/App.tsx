import { useCallback, useEffect, useState } from "react";
import { LoginView } from "./components/LoginView";
import { MemberLoginDialog } from "./components/MemberLoginDialog";
import { ChatWorkspace } from "./components/ChatWorkspace";
import { AdminApp } from "./components/AdminApp";
import { PageState } from "./components/PageState";
import { createGuestSession, fetchSession, login, logout, type SessionProjection } from "./lib/api";
import type { ClientSurface } from "./lib/routing";
import { consumeMcpOAuthCallback, type McpOAuthCallbackResult } from "./lib/mcp-oauth";
import {
  readThemePreference,
  removeDeviceValuesByPrefix,
  resolveTheme,
  writeThemePreference,
  getDeviceStorage,
  type ThemePreference,
} from "./lib/device-preferences";

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
  const [memberLoginOpen, setMemberLoginOpen] = useState(false);
  const [mcpOAuthResult, setMcpOAuthResult] = useState<McpOAuthCallbackResult | null>(null);
  const themeUser = state.status === "authenticated" ? state.session.user : "anonymous";
  const { themePreference, setThemePreference } = useDeviceTheme(themeUser);

  const refresh = useCallback(async () => {
    try {
      const session = await fetchSession() || await createGuestSession();
      setState(session ? { status: "authenticated", session } : { status: "login" });
    } catch (error) {
      setState({ status: "error", message: error instanceof Error ? error.message : "暂时无法连接服务器。" });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const callback = consumeMcpOAuthCallback(window.location.href);
    if (!callback) return;
    window.history.replaceState(window.history.state, "", callback.relativeUrl);
    setMcpOAuthResult(callback.result);
  }, []);

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
    <>
      <ChatWorkspace
        key={state.session.user}
        session={state.session}
        mcpOAuthResult={mcpOAuthResult}
        onMcpOAuthResultConsumed={() => setMcpOAuthResult(null)}
        onMemberLogin={() => setMemberLoginOpen(true)}
        themePreference={themePreference}
        onThemePreferenceChange={setThemePreference}
        onLogout={async () => {
          await logout();
          setState({ status: "loading" });
          await refresh();
        }}
      />
      {state.session.access === "guest" && memberLoginOpen && (
        <MemberLoginDialog
          onClose={() => setMemberLoginOpen(false)}
          onSubmit={async (accessCode) => {
            const result = await login(accessCode);
            if (!result.ok) return result.message;
            clearSessionStorage(state.session.user);
            setMemberLoginOpen(false);
            setState({ status: "loading" });
            await refresh();
            return null;
          }}
        />
      )}
    </>
  );
}

function useDeviceTheme(user: string): {
  themePreference: ThemePreference;
  setThemePreference: (preference: ThemePreference) => boolean;
} {
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>(() => (
    readThemePreference(getDeviceStorage(), user)
  ));

  useEffect(() => {
    setThemePreferenceState(readThemePreference(getDeviceStorage(), user));
  }, [user]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const resolved = resolveTheme(themePreference, media.matches);
      document.documentElement.dataset.theme = resolved;
      document.documentElement.style.colorScheme = resolved;
    };
    apply();
    if (themePreference !== "follow-system") return;
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [themePreference]);

  const setThemePreference = useCallback((preference: ThemePreference) => {
    setThemePreferenceState(preference);
    return writeThemePreference(getDeviceStorage(), user, preference);
  }, [user]);

  return { themePreference, setThemePreference };
}

function clearSessionStorage(user: string): void {
  const prefix = `chatus:react:${user}:`;
  removeDeviceValuesByPrefix(getDeviceStorage(), prefix);
}
