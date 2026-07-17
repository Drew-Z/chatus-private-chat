export type RouteProjection = {
  id: string;
  label: string;
  model: string;
  type: string;
  supportsTools: boolean;
  healthStatus?: "healthy" | "unhealthy" | "unknown";
  healthOutcome?: string;
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

export type AgentConversation = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  summary: string;
  pinned: boolean;
  routeId?: string;
  parentChatId?: string;
  skillIds: string[];
  messageCount: number;
};

export type AgentMemory = {
  memory: string;
  revision: string;
  updatedAt: number;
  maxChars: number;
};

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function fetchSession(): Promise<SessionProjection | null> {
  let response: Response;
  try {
    response = await fetch("/api/session", { credentials: "include", cache: "no-store" });
  } catch {
    throw new ApiError("network_unavailable", "暂时无法连接服务器。", 0);
  }
  if (response.status === 401) return null;
  const data = await readResponseData(response);
  if (!response.ok) throw apiErrorFromResponse(response, data, "暂时无法恢复登录状态。");
  if (!isSessionProjection(data)) throw new ApiError("invalid_session_response", "服务器返回了无法识别的登录状态。", 502);
  return data;
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
    const data = await readResponseData(response);
    return { ok: false, message: getLoginErrorMessage(data) };
  } catch {
    return { ok: false, message: "暂时无法连接服务器，请稍后重试。" };
  }
}

export async function logout(): Promise<void> {
  await fetch("/api/logout", { method: "POST", credentials: "include" }).catch(() => undefined);
}

export async function listAgentConversations(): Promise<AgentConversation[]> {
  const data = await requestJson("/api/agent/conversations");
  if (!isRecord(data) || !Array.isArray(data.conversations) || !data.conversations.every(isAgentConversation)) {
    throw new ApiError("invalid_conversation_response", "会话列表格式无效。", 502);
  }
  return data.conversations;
}

export async function createAgentConversation(input: {
  routeId?: string;
  skillIds?: string[];
} = {}): Promise<AgentConversation> {
  const data = await requestJson("/api/agent/conversations", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!isRecord(data) || !isAgentConversation(data.conversation)) {
    throw new ApiError("invalid_conversation_response", "新会话格式无效。", 502);
  }
  return data.conversation;
}

export async function updateAgentConversation(
  conversation: AgentConversation,
  patch: { title?: string; routeId?: string; skillIds?: string[] },
): Promise<AgentConversation> {
  const data = await requestJson(`/api/agent/conversations/${encodeURIComponent(conversation.id)}`, {
    method: "PATCH",
    body: JSON.stringify({ ...patch, expectedUpdatedAt: conversation.updatedAt }),
  });
  if (!isRecord(data) || !isAgentConversation(data.conversation)) {
    throw new ApiError("invalid_conversation_response", "会话更新格式无效。", 502);
  }
  return data.conversation;
}

export async function deleteAgentConversation(conversation: AgentConversation): Promise<AgentConversation[]> {
  const data = await requestJson(
    `/api/agent/conversations/${encodeURIComponent(conversation.id)}?expectedUpdatedAt=${conversation.updatedAt}`,
    { method: "DELETE" },
  );
  if (!isRecord(data) || !Array.isArray(data.conversations) || !data.conversations.every(isAgentConversation)) {
    throw new ApiError("invalid_conversation_response", "会话删除结果格式无效。", 502);
  }
  return data.conversations;
}

export async function getAgentMemory(): Promise<AgentMemory> {
  const data = await requestJson("/api/agent/memory");
  if (!isAgentMemory(data)) throw new ApiError("invalid_memory_response", "长期记忆格式无效。", 502);
  return data;
}

export async function putAgentMemory(memory: AgentMemory, value: string): Promise<AgentMemory> {
  const data = await requestJson("/api/agent/memory", {
    method: "PUT",
    body: JSON.stringify({ memory: value, expectedRevision: memory.revision }),
  });
  if (!isAgentMemory(data)) throw new ApiError("invalid_memory_response", "长期记忆更新格式无效。", 502);
  return data;
}

export function isSessionProjection(value: unknown): value is SessionProjection {
  if (!isRecord(value) || !isRecord(value.usage) || !isRecord(value.agent)) return false;
  if (!Array.isArray(value.routes) || !value.routes.every(isRouteProjection)) return false;
  if (!Array.isArray(value.skills) || !value.skills.every(isSkillProjection)) return false;
  const routeIds = value.routes.map((route) => route.id);
  const skillIds = value.skills.map((skill) => skill.id);
  return isNonEmptyString(value.user)
    && isNonEmptyString(value.displayName)
    && typeof value.defaultRoute === "string"
    && ((routeIds.length === 0 && value.defaultRoute === "") || routeIds.includes(value.defaultRoute))
    && new Set(routeIds).size === routeIds.length
    && new Set(skillIds).size === skillIds.length
    && isNonNegativeInteger(value.usage.used)
    && isNonNegativeInteger(value.usage.remaining)
    && isPositiveInteger(value.usage.limit)
    && value.usage.remaining <= value.usage.limit
    && isNonEmptyString(value.agent.transport)
    && isNonEmptyString(value.agent.basePath)
    && isNonEmptyString(value.agent.instance);
}

export function isAgentConversation(value: unknown): value is AgentConversation {
  return isRecord(value)
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.title)
    && isNonNegativeInteger(value.createdAt)
    && isNonNegativeInteger(value.updatedAt)
    && value.updatedAt >= value.createdAt
    && typeof value.summary === "string"
    && typeof value.pinned === "boolean"
    && (value.routeId === undefined || isNonEmptyString(value.routeId))
    && (value.parentChatId === undefined || isNonEmptyString(value.parentChatId))
    && isUniqueStringIdArray(value.skillIds)
    && isNonNegativeInteger(value.messageCount);
}

export function isAgentMemory(value: unknown): value is AgentMemory {
  return isRecord(value)
    && typeof value.memory === "string"
    && typeof value.revision === "string"
    && isNonNegativeInteger(value.updatedAt)
    && isPositiveInteger(value.maxChars)
    && value.memory.length <= value.maxChars;
}

function isRouteProjection(value: unknown): value is RouteProjection {
  return isRecord(value)
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.label)
    && isNonEmptyString(value.model)
    && isNonEmptyString(value.type)
    && typeof value.supportsTools === "boolean"
    && (value.healthStatus === undefined || value.healthStatus === "healthy" || value.healthStatus === "unhealthy" || value.healthStatus === "unknown")
    && (value.healthOutcome === undefined || typeof value.healthOutcome === "string");
}

function isSkillProjection(value: unknown): value is SkillProjection {
  return isRecord(value)
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.label)
    && (value.description === undefined || typeof value.description === "string")
    && isUniqueStringIdArray(value.toolIds);
}

async function requestJson(path: string, init: RequestInit = {}): Promise<unknown> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set("Content-Type", "application/json");
  headers.set("X-Chatus-Client", "web");
  let response: Response;
  try {
    response = await fetch(path, { ...init, credentials: "include", headers, cache: "no-store" });
  } catch {
    throw new ApiError("network_unavailable", "网络不可用，请检查连接后重试。", 0);
  }
  const data = await readResponseData(response);
  if (!response.ok) throw apiErrorFromResponse(response, data, "请求暂时失败，请稍后重试。");
  return data;
}

async function readResponseData(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

function apiErrorFromResponse(response: Response, data: unknown, fallback: string): ApiError {
  const code = isRecord(data) && typeof data.error === "string" ? data.error : `http_${response.status}`;
  return new ApiError(code, getErrorMessage(data, fallback), response.status);
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

function isUniqueStringIdArray(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.every(isNonEmptyString)
    && new Set(value).size === value.length;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return isNonNegativeInteger(value) && value > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
