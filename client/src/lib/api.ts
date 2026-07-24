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

export type ToolProjection = {
  id: string;
  label: string;
  description?: string;
  source: "builtin" | "mcp";
  confirmation: "auto" | "first-per-conversation" | "always";
};

export type SessionProjection = {
  user: string;
  displayName: string;
  usage: { used: number; limit: number; remaining: number };
  routes: RouteProjection[];
  defaultRoute: string;
  allowBringYourOwnKey: boolean;
  hasUserSystemPrompt: boolean;
  skills: SkillProjection[];
  tools: ToolProjection[];
  agent: { transport: string; basePath: string; instance: string };
};

export type AdminUserConfig = {
  enabled?: boolean;
  displayName?: string;
  defaultRoute?: string;
  allowedRoutes?: string[];
  allowedSkills?: string[];
  allowedTools?: string[];
  allowBringYourOwnKey?: boolean;
  dailyMessageLimit?: number;
  minuteMessageLimit?: number;
  blockedPrompts?: string[];
  systemPrompt?: string;
  [key: string]: unknown;
};

export type AdminRouteConfig = {
  label: string;
  enabled?: boolean;
  hasLegacyKey?: boolean;
  hasCustomHeaders?: boolean;
  [key: string]: unknown;
};

export type AdminSkillConfig = {
  enabled: boolean;
  label: string;
  description?: string;
  instructions: string;
  toolIds: string[];
  order?: number;
  [key: string]: unknown;
};

export type AdminToolConfig = {
  enabled: boolean;
  label: string;
  description?: string;
  confirmation: "auto" | "first-per-conversation" | "always";
  executor: { type: "builtin" | "mcp"; [key: string]: unknown };
  [key: string]: unknown;
};

export type AdminConfig = {
  routes: Record<string, AdminRouteConfig>;
  providers: Record<string, Record<string, unknown>>;
  users: Record<string, AdminUserConfig>;
  defaults: AdminUserConfig;
  skills: Record<string, AdminSkillConfig>;
  tools: Record<string, AdminToolConfig>;
  mcpServers: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
};

export type AdminConfigSnapshot = {
  config: AdminConfig;
  source: "kv" | "secret" | "default";
  revision: string;
};

export type AdminMemberProjection = {
  label: string;
  displayName: string;
  configured: boolean;
  hasAccessCode: boolean;
};

export type AdminMembersSnapshot = {
  members: AdminMemberProjection[];
  accessRevision: string;
  accessSource: "kv" | "secret" | "managed";
};

export type AdminSessionRevocation = {
  revoked: number;
  complete: boolean;
};

export type AdminMemberCredentialResponse = {
  member: AdminMemberProjection;
  accessCode: string;
  accessRevision: string;
  sessionRevocation: AdminSessionRevocation;
};

export type AdminMemberRevokeResponse = {
  member: AdminMemberProjection | null;
  accessRevision: string;
  sessionRevocation: AdminSessionRevocation;
};

export type AdminMemberConfigRemovalResponse = {
  member: AdminMemberProjection | null;
  config: AdminConfig;
  source: "kv";
  revision: string;
};

export type AdminMemberSessionsResponse = {
  ok: true;
  label: string;
  revoked: number;
  complete: boolean;
};

export type UserDataMutationResponse = {
  ok: true;
  revoked: number;
};

export type UserDataExportPart =
  | { type: "text"; text: string }
  | { type: "file"; mediaType: string; name?: string };

export type UserDataExportMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  parts: UserDataExportPart[];
};

export type UserDataExportConversation = AgentConversation & {
  messages: UserDataExportMessage[];
  messagesTruncated: boolean;
};

export type UserDataExport = {
  schema: "chatus-user-data";
  version: 1;
  exportedAt: string;
  account: { label: string };
  memory: { text: string; updatedAt: number };
  conversations: UserDataExportConversation[];
  truncated: boolean;
};

export type ApiErrorDetails = {
  currentRevision?: string;
  retryAfter?: number;
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

export type AgentConversationBranchAction = "branch" | "edit" | "resend" | "regenerate" | "continue";

export type AgentConversationBranchResult = {
  requestId: string;
  conversation: AgentConversation;
  launch: "none" | "respond" | "continue";
  anchorMessageId?: string;
};

export type FeedbackRating = "up" | "down";

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
    readonly details: ApiErrorDetails = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function fetchAdminSession(): Promise<boolean> {
  let response: Response;
  try {
    response = await fetch("/api/admin/session", { credentials: "include", cache: "no-store" });
  } catch {
    throw new ApiError("network_unavailable", "暂时无法连接管理服务。", 0);
  }
  if (response.status === 401) return false;
  const data = await readResponseData(response);
  if (!response.ok) throw apiErrorFromResponse(response, data, "暂时无法恢复管理员会话。");
  if (!isAdminSessionProjection(data)) {
    throw new ApiError("invalid_admin_session_response", "服务器返回了无法识别的管理员会话。", 502);
  }
  return true;
}

export async function adminLogin(token: string): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const response = await fetch("/api/admin/login", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "X-Chatus-Client": "web" },
      body: JSON.stringify({ token }),
    });
    if (response.ok) return { ok: true };
    return { ok: false, message: getAdminLoginErrorMessage(await readResponseData(response)) };
  } catch {
    return { ok: false, message: "暂时无法连接管理服务，请稍后重试。" };
  }
}

export async function adminLogout(): Promise<void> {
  await fetch("/api/admin/logout", { method: "POST", credentials: "include" }).catch(() => undefined);
}

export async function fetchAdminConfig(): Promise<AdminConfigSnapshot> {
  const data = await requestJson("/api/admin/config");
  if (!isAdminConfigSnapshot(data)) {
    throw new ApiError("invalid_admin_config_response", "管理配置格式无效。", 502);
  }
  return data;
}

export async function putAdminConfig(config: AdminConfig, expectedRevision: string): Promise<AdminConfigSnapshot> {
  const data = await requestJson("/api/admin/config", {
    method: "PUT",
    body: JSON.stringify({ config, expectedRevision }),
  });
  if (!isAdminConfigSnapshot(data)) {
    throw new ApiError("invalid_admin_config_response", "配置保存结果格式无效。", 502);
  }
  return data;
}

export async function fetchAdminMembers(): Promise<AdminMembersSnapshot> {
  const data = await requestJson("/api/admin/members");
  if (!isAdminMemberListResponse(data)) {
    throw new ApiError("invalid_admin_members_response", "成员列表格式无效。", 502);
  }
  return data;
}

export async function createAdminMemberAccess(
  label: string,
  expectedAccessRevision: string,
): Promise<AdminMemberCredentialResponse> {
  const data = await requestJson("/api/admin/members", {
    method: "POST",
    body: JSON.stringify({ label, expectedAccessRevision }),
  });
  if (!isAdminMemberCredentialResponse(data)) {
    throw new ApiError("invalid_admin_member_credential_response", "成员创建结果格式无效。", 502);
  }
  return data;
}

export async function rotateAdminMemberAccess(
  label: string,
  expectedAccessRevision: string,
): Promise<AdminMemberCredentialResponse> {
  const data = await requestJson(`/api/admin/members/${encodeURIComponent(label)}/access-code`, {
    method: "POST",
    body: JSON.stringify({ expectedAccessRevision }),
  });
  if (!isAdminMemberCredentialResponse(data)) {
    throw new ApiError("invalid_admin_member_credential_response", "访问码轮换结果格式无效。", 502);
  }
  return data;
}

export async function revokeAdminMemberAccess(
  label: string,
  expectedAccessRevision: string,
): Promise<AdminMemberRevokeResponse> {
  const data = await requestJson(`/api/admin/members/${encodeURIComponent(label)}/access-code`, {
    method: "DELETE",
    body: JSON.stringify({ expectedAccessRevision }),
  });
  if (!isAdminMemberRevokeResponse(data)) {
    throw new ApiError("invalid_admin_member_revoke_response", "访问撤销结果格式无效。", 502);
  }
  return data;
}

export async function removeAdminMemberConfig(
  label: string,
  expectedConfigRevision: string,
): Promise<AdminMemberConfigRemovalResponse> {
  const data = await requestJson(`/api/admin/members/${encodeURIComponent(label)}/config`, {
    method: "DELETE",
    body: JSON.stringify({ expectedConfigRevision }),
  });
  if (!isAdminMemberConfigRemovalResponse(data)) {
    throw new ApiError("invalid_admin_member_config_response", "成员配置删除结果格式无效。", 502);
  }
  return data;
}

export async function revokeAdminMemberSessions(label: string): Promise<AdminMemberSessionsResponse> {
  const data = await requestJson("/api/admin/sessions/revoke", {
    method: "POST",
    body: JSON.stringify({ label }),
  });
  if (!isAdminMemberSessionsResponse(data)) {
    throw new ApiError("invalid_admin_member_sessions_response", "成员会话注销结果格式无效。", 502);
  }
  return data;
}

export async function revokeAllSessions(): Promise<UserDataMutationResponse> {
  const data = await requestJson("/api/sessions/revoke-all", { method: "POST" });
  if (!isUserDataMutationResponse(data)) {
    throw new ApiError("invalid_session_revocation_response", "会话注销结果格式无效。", 502);
  }
  return data;
}

export async function deleteUserData(): Promise<UserDataMutationResponse> {
  const data = await requestJson("/api/user-data", { method: "DELETE" });
  if (!isUserDataMutationResponse(data)) {
    throw new ApiError("invalid_user_data_response", "用户数据清理结果格式无效。", 502);
  }
  return data;
}

export async function exportUserData(): Promise<{ blob: Blob; truncated: boolean }> {
  let response: Response;
  try {
    response = await fetch("/api/user-data/export", { credentials: "include", cache: "no-store" });
  } catch {
    throw new ApiError("network_unavailable", "网络不可用，请检查连接后重试。", 0);
  }
  if (!response.ok) throw apiErrorFromResponse(response, await readResponseData(response), "数据导出失败，请稍后重试。");
  const contentType = response.headers.get("Content-Type")?.split(";", 1)[0].trim();
  if (contentType !== "application/json") {
    throw new ApiError("invalid_user_data_export_response", "导出结果格式无效。", 502);
  }
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > 5_000_000) {
    throw new ApiError("user_data_export_too_large", "导出文件过大，请先删除不再需要的会话后重试。", 413);
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ApiError("invalid_user_data_export_response", "导出结果格式无效。", 502);
  }
  if (!isUserDataExport(data)) {
    throw new ApiError("invalid_user_data_export_response", "导出结果格式无效。", 502);
  }
  return {
    blob: new Blob([text], { type: "application/json;charset=utf-8" }),
    truncated: data.truncated,
  };
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

export async function createAgentConversationBranch(
  conversation: AgentConversation,
  input: {
    requestId: string;
    action: AgentConversationBranchAction;
    sourceMessageId: string;
    editedText?: string;
  },
): Promise<AgentConversationBranchResult> {
  const data = await requestJson(`/api/agent/conversations/${encodeURIComponent(conversation.id)}/branches`, {
    method: "POST",
    body: JSON.stringify({
      ...input,
      expectedUpdatedAt: conversation.updatedAt,
    }),
  });
  if (!isAgentConversationBranchResult(data)) {
    throw new ApiError("invalid_branch_response", "分支会话结果格式无效。", 502);
  }
  return data;
}

export async function submitFeedback(input: {
  rating: FeedbackRating;
  routeId: string;
  chatId: string;
  messageId: string;
  reason?: "inaccurate" | "misunderstood" | "verbose" | "format" | "other";
}): Promise<FeedbackRating> {
  const data = await requestJson("/api/feedback", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!isRecord(data) || !hasExactKeys(data, ["ok", "rating"]) || data.ok !== true
    || (data.rating !== "up" && data.rating !== "down")) {
    throw new ApiError("invalid_feedback_response", "反馈结果格式无效。", 502);
  }
  return data.rating;
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
  if (!Array.isArray(value.tools) || !value.tools.every(isToolProjection)) return false;
  const routeIds = value.routes.map((route) => route.id);
  const skillIds = value.skills.map((skill) => skill.id);
  const toolIds = value.tools.map((tool) => tool.id);
  return isNonEmptyString(value.user)
    && isNonEmptyString(value.displayName)
    && typeof value.defaultRoute === "string"
    && typeof value.allowBringYourOwnKey === "boolean"
    && typeof value.hasUserSystemPrompt === "boolean"
    && ((routeIds.length === 0 && value.defaultRoute === "") || routeIds.includes(value.defaultRoute))
    && new Set(routeIds).size === routeIds.length
    && new Set(skillIds).size === skillIds.length
    && new Set(toolIds).size === toolIds.length
    && value.skills.every((skill) => skill.toolIds.every((toolId) => toolIds.includes(toolId)))
    && isNonNegativeInteger(value.usage.used)
    && isNonNegativeInteger(value.usage.remaining)
    && isPositiveInteger(value.usage.limit)
    && value.usage.remaining <= value.usage.limit
    && isNonEmptyString(value.agent.transport)
    && isNonEmptyString(value.agent.basePath)
    && isNonEmptyString(value.agent.instance);
}

export function isAdminSessionProjection(value: unknown): value is { authenticated: true } {
  return isRecord(value) && value.authenticated === true;
}

export function isAdminConfigSnapshot(value: unknown): value is AdminConfigSnapshot {
  return isRecord(value)
    && isAdminConfig(value.config)
    && (value.source === "kv" || value.source === "secret" || value.source === "default")
    && isNonEmptyString(value.revision);
}

export function isAdminMemberListResponse(
  value: unknown,
): value is AdminMembersSnapshot {
  if (!isRecord(value)
    || !hasExactKeys(value, ["members", "accessRevision", "accessSource"])
    || !Array.isArray(value.members)
    || !value.members.every(isAdminMemberProjection)
    || typeof value.accessRevision !== "string"
    || (value.accessSource !== "kv" && value.accessSource !== "secret" && value.accessSource !== "managed")) {
    return false;
  }
  const labels = value.members.map((member) => member.label);
  return new Set(labels).size === labels.length;
}

export function isAdminMemberCredentialResponse(
  value: unknown,
): value is AdminMemberCredentialResponse {
  return isRecord(value)
    && hasExactKeys(value, ["member", "accessCode", "accessRevision", "sessionRevocation"])
    && isAdminMemberProjection(value.member)
    && isNonEmptyString(value.accessCode)
    && value.accessCode.length <= 512
    && isNonEmptyString(value.accessRevision)
    && isAdminSessionRevocation(value.sessionRevocation);
}

export function isAdminMemberRevokeResponse(
  value: unknown,
): value is AdminMemberRevokeResponse {
  return isRecord(value)
    && hasExactKeys(value, ["member", "accessRevision", "sessionRevocation"])
    && (value.member === null || isAdminMemberProjection(value.member))
    && isNonEmptyString(value.accessRevision)
    && isAdminSessionRevocation(value.sessionRevocation);
}

export function isAdminMemberConfigRemovalResponse(
  value: unknown,
): value is AdminMemberConfigRemovalResponse {
  return isRecord(value)
    && hasExactKeys(value, ["member", "config", "source", "revision"])
    && (value.member === null || isAdminMemberProjection(value.member))
    && isAdminConfig(value.config)
    && value.source === "kv"
    && isNonEmptyString(value.revision);
}

export function isAdminMemberSessionsResponse(
  value: unknown,
): value is AdminMemberSessionsResponse {
  return isRecord(value)
    && hasExactKeys(value, ["ok", "label", "revoked", "complete"])
    && value.ok === true
    && isNonEmptyString(value.label)
    && isNonNegativeInteger(value.revoked)
    && typeof value.complete === "boolean";
}

export function isUserDataMutationResponse(value: unknown): value is UserDataMutationResponse {
  return isRecord(value)
    && hasExactKeys(value, ["ok", "revoked"])
    && value.ok === true
    && isNonNegativeInteger(value.revoked);
}

export function isUserDataExport(value: unknown): value is UserDataExport {
  if (!isRecord(value)
    || !hasExactKeys(value, ["schema", "version", "exportedAt", "account", "memory", "conversations", "truncated"])
    || value.schema !== "chatus-user-data"
    || value.version !== 1
    || !isNonEmptyString(value.exportedAt)
    || !Number.isFinite(Date.parse(value.exportedAt))
    || !isRecord(value.account)
    || !hasExactKeys(value.account, ["label"])
    || !isNonEmptyString(value.account.label)
    || !isRecord(value.memory)
    || !hasExactKeys(value.memory, ["text", "updatedAt"])
    || typeof value.memory.text !== "string"
    || !isNonNegativeInteger(value.memory.updatedAt)
    || !Array.isArray(value.conversations)
    || value.conversations.length > 50
    || !value.conversations.every(isUserDataExportConversation)
    || typeof value.truncated !== "boolean") {
    return false;
  }
  return true;
}

export function isAdminConfig(value: unknown): value is AdminConfig {
  if (!isRecord(value)) return false;
  const routes = value.routes;
  const providers = value.providers;
  const users = value.users;
  const defaults = value.defaults;
  const skills = value.skills;
  const tools = value.tools;
  const mcpServers = value.mcpServers;
  if (!isRegistry(routes, isAdminRouteConfig) || Object.keys(routes).length === 0) return false;
  const routeIds = new Set(Object.keys(routes));
  if (!Object.values(routes).some((route) => route.enabled !== false)) return false;
  if (!isRegistry(providers, isSanitizedAdminProviderConfig)) return false;
  if (!isRegistry(users, isAdminUserConfig) || !isAdminUserConfig(defaults)) return false;
  if (!isRegistry(skills, isAdminSkillConfig) || !isRegistry(tools, isAdminToolConfig)) return false;
  if (!isRegistry(mcpServers, isAdminMcpServerConfig)) return false;

  const skillIds = new Set(Object.keys(skills));
  const toolIds = new Set(Object.keys(tools));
  const assignments = [defaults, ...Object.values(users)];
  if (assignments.some((assignment) => (
    (assignment.defaultRoute !== undefined && !routeIds.has(assignment.defaultRoute))
    || assignment.allowedRoutes?.some((id) => !routeIds.has(id))
    || assignment.allowedSkills?.some((id) => !skillIds.has(id))
    || assignment.allowedTools?.some((id) => !toolIds.has(id))
  ))) return false;
  return Object.values(skills).every((skill) => skill.toolIds.every((id) => toolIds.has(id)));
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

export function isAgentConversationBranchResult(value: unknown): value is AgentConversationBranchResult {
  if (!isRecord(value) || !isNonEmptyString(value.requestId) || !isAgentConversation(value.conversation)
    || (value.launch !== "none" && value.launch !== "respond" && value.launch !== "continue")) return false;
  const allowedKeys = new Set(["ok", "requestId", "conversation", "launch", "anchorMessageId"]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key)) || value.ok !== true) return false;
  return value.anchorMessageId === undefined || isNonEmptyString(value.anchorMessageId);
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

function isToolProjection(value: unknown): value is ToolProjection {
  return isRecord(value)
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.label)
    && (value.description === undefined || typeof value.description === "string")
    && (value.source === "builtin" || value.source === "mcp")
    && (
      value.confirmation === "auto"
      || value.confirmation === "first-per-conversation"
      || value.confirmation === "always"
    );
}

function isAdminMemberProjection(value: unknown): value is AdminMemberProjection {
  return isRecord(value)
    && hasExactKeys(value, ["label", "displayName", "configured", "hasAccessCode"])
    && isNonEmptyString(value.label)
    && isNonEmptyString(value.displayName)
    && typeof value.configured === "boolean"
    && typeof value.hasAccessCode === "boolean";
}

function isUserDataExportConversation(value: unknown): value is UserDataExportConversation {
  if (!isRecord(value)) return false;
  const expectedKeys = [
    "id",
    "title",
    "createdAt",
    "updatedAt",
    "summary",
    "pinned",
    "skillIds",
    "messageCount",
    "messages",
    "messagesTruncated",
    ...(value.routeId === undefined ? [] : ["routeId"]),
    ...(value.parentChatId === undefined ? [] : ["parentChatId"]),
  ];
  if (!hasExactKeys(value, expectedKeys)
    || !Array.isArray(value.messages)
    || value.messages.length > 200
    || !value.messages.every(isUserDataExportMessage)) {
    return false;
  }
  const { messages: _messages, messagesTruncated, ...summary } = value;
  return isAgentConversation(summary)
    && typeof messagesTruncated === "boolean";
}

function isUserDataExportMessage(value: unknown): value is UserDataExportMessage {
  return isRecord(value)
    && hasExactKeys(value, ["id", "role", "parts"])
    && isNonEmptyString(value.id)
    && (value.role === "user" || value.role === "assistant" || value.role === "system")
    && Array.isArray(value.parts)
    && value.parts.length <= 32
    && value.parts.every(isUserDataExportPart);
}

function isUserDataExportPart(value: unknown): value is UserDataExportPart {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  if (value.type === "text") {
    return hasExactKeys(value, ["type", "text"])
      && typeof value.text === "string"
      && value.text.length <= 20_020;
  }
  if (value.type === "file") {
    return (hasExactKeys(value, ["type", "mediaType"]) || hasExactKeys(value, ["type", "mediaType", "name"]))
      && isNonEmptyString(value.mediaType)
      && value.mediaType.length <= 120
      && (value.name === undefined || (typeof value.name === "string" && value.name.length <= 200));
  }
  return false;
}

function isAdminSessionRevocation(value: unknown): value is AdminSessionRevocation {
  return isRecord(value)
    && hasExactKeys(value, ["revoked", "complete"])
    && isNonNegativeInteger(value.revoked)
    && typeof value.complete === "boolean";
}

function isAdminUserConfig(value: unknown): value is AdminUserConfig {
  return isRecord(value)
    && (value.enabled === undefined || typeof value.enabled === "boolean")
    && (value.displayName === undefined || typeof value.displayName === "string")
    && (value.defaultRoute === undefined || typeof value.defaultRoute === "string")
    && (value.allowedRoutes === undefined || isUniqueStringIdArray(value.allowedRoutes))
    && (value.allowedSkills === undefined || isUniqueStringIdArray(value.allowedSkills))
    && (value.allowedTools === undefined || isUniqueStringIdArray(value.allowedTools))
    && (value.allowBringYourOwnKey === undefined || typeof value.allowBringYourOwnKey === "boolean")
    && (value.dailyMessageLimit === undefined || isPositiveInteger(value.dailyMessageLimit))
    && (value.minuteMessageLimit === undefined || isPositiveInteger(value.minuteMessageLimit))
    && (value.blockedPrompts === undefined || (
      Array.isArray(value.blockedPrompts) && value.blockedPrompts.every((item) => typeof item === "string")
    ))
    && (value.systemPrompt === undefined || typeof value.systemPrompt === "string");
}

function isAdminRouteConfig(value: unknown): value is AdminRouteConfig {
  return isRecord(value)
    && typeof value.label === "string"
    && (value.enabled === undefined || typeof value.enabled === "boolean")
    && (value.hasLegacyKey === undefined || typeof value.hasLegacyKey === "boolean")
    && (value.hasCustomHeaders === undefined || typeof value.hasCustomHeaders === "boolean")
    && !hasOwn(value, "apiKey")
    && !hasOwn(value, "headers");
}

function isSanitizedAdminProviderConfig(value: unknown): value is Record<string, unknown> {
  return isRecord(value)
    && typeof value.label === "string"
    && (value.type === "openai-chat" || value.type === "anthropic-messages")
    && isNonEmptyString(value.baseUrl)
    && (value.enabled === undefined || typeof value.enabled === "boolean")
    && (value.hasLegacyKey === undefined || typeof value.hasLegacyKey === "boolean")
    && (value.hasCustomHeaders === undefined || typeof value.hasCustomHeaders === "boolean")
    && !hasOwn(value, "apiKey")
    && !hasOwn(value, "headers");
}

function isAdminSkillConfig(value: unknown): value is AdminSkillConfig {
  return isRecord(value)
    && typeof value.enabled === "boolean"
    && typeof value.label === "string"
    && (value.description === undefined || typeof value.description === "string")
    && isNonEmptyString(value.instructions)
    && isUniqueStringIdArray(value.toolIds)
    && (value.order === undefined || (typeof value.order === "number" && Number.isFinite(value.order)));
}

function isAdminToolConfig(value: unknown): value is AdminToolConfig {
  return isRecord(value)
    && typeof value.enabled === "boolean"
    && typeof value.label === "string"
    && (value.description === undefined || typeof value.description === "string")
    && (
      value.confirmation === "auto"
      || value.confirmation === "first-per-conversation"
      || value.confirmation === "always"
    )
    && isRecord(value.inputSchema)
    && isRecord(value.executor)
    && (value.executor.type === "builtin" || value.executor.type === "mcp");
}

function isAdminMcpServerConfig(value: unknown): value is Record<string, unknown> {
  return isRecord(value)
    && typeof value.enabled === "boolean"
    && typeof value.label === "string"
    && isNonEmptyString(value.endpoint)
    && (value.authType === "none" || value.authType === "bearer" || value.authType === "x-api-key")
    && (value.secretRef === undefined || typeof value.secretRef === "string");
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
  return new ApiError(code, getErrorMessage(data, fallback), response.status, {
    currentRevision: isRecord(data) && typeof data.currentRevision === "string" ? data.currentRevision : undefined,
    retryAfter: isRecord(data) && isNonNegativeInteger(data.retryAfter) ? data.retryAfter : undefined,
  });
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

function getAdminLoginErrorMessage(value: unknown): string {
  if (!isRecord(value)) return "管理员 Token 无效或暂时不可用。";
  if (value.error === "invalid_token") return "管理员 Token 不正确，请检查后重试。";
  if (value.error === "admin_login_rate_limited") return "尝试次数过多，请稍后再试。";
  if (value.error === "admin_not_configured") return "服务尚未配置管理员 Token。";
  return getErrorMessage(value, "管理员 Token 无效或暂时不可用。");
}

function isRegistry<T>(value: unknown, guard: (entry: unknown) => entry is T): value is Record<string, T> {
  return isRecord(value) && Object.values(value).every(guard);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => hasOwn(value, key));
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
