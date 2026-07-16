export type RouteProjection = {
  id: string;
  label: string;
  model: string;
  type: string;
  supportsTools: boolean;
};

export type SkillProjection = {
  id: string;
  label: string;
  description?: string;
  toolIds: string[];
};

export type SessionProjection = {
  user: string;
  displayName: string;
  usage: { used: number; limit: number; remaining: number };
  routes: RouteProjection[];
  defaultRoute: string;
  skills: SkillProjection[];
  agent: { transport: string; basePath: string; instance: string };
};

export async function fetchSession(): Promise<SessionProjection | null> {
  try {
    const response = await fetch("/api/session", { credentials: "include" });
    if (!response.ok) return null;
    const data: unknown = await response.json();
    return isSessionProjection(data) ? data : null;
  } catch {
    return null;
  }
}

export async function login(accessCode: string): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const response = await fetch("/api/login", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "X-Chatus-Client": "web" },
      body: JSON.stringify({ code: accessCode }),
    });
    if (response.ok) return { ok: true };
    const data: unknown = await response.json().catch(() => null);
    return { ok: false, message: getLoginErrorMessage(data) };
  } catch {
    return { ok: false, message: "暂时无法连接服务器，请稍后重试。" };
  }
}

export async function logout(): Promise<void> {
  await fetch("/api/logout", { method: "POST", credentials: "include" }).catch(() => undefined);
}

function isSessionProjection(value: unknown): value is SessionProjection {
  if (!isRecord(value)) return false;
  return typeof value.user === "string"
    && typeof value.displayName === "string"
    && Array.isArray(value.routes)
    && Array.isArray(value.skills)
    && isRecord(value.usage)
    && typeof value.usage.remaining === "number"
    && typeof value.usage.limit === "number"
    && typeof value.defaultRoute === "string"
    && isRecord(value.agent)
    && typeof value.agent.basePath === "string";
}

function getErrorMessage(value: unknown, fallback: string): string {
  if (isRecord(value) && typeof value.message === "string" && value.message.trim()) return value.message;
  if (isRecord(value) && typeof value.error === "string" && value.error.trim()) return value.error;
  return fallback;
}

function getLoginErrorMessage(value: unknown): string {
  if (!isRecord(value)) return "访问码无效或暂时不可用。";
  if (value.error === "invalid_code") return "访问码不正确，请检查后重试。";
  if (value.error === "user_disabled") return getErrorMessage(value, "该成员已暂停使用。");
  if (value.error === "login_rate_limited") return "尝试次数过多，请稍后再试。";
  if (value.error === "server_not_configured") return "服务尚未完成访问配置。";
  return getErrorMessage(value, "访问码无效或暂时不可用。");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
