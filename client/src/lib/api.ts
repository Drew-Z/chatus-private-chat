import { IMAGE_MEDIA_TYPES, type ImageInputPolicy } from "../../../src/contracts/image";

export type RouteProjection = {
  id: string;
  label: string;
  model: string;
  type: string;
  supportsImages: boolean;
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
  imageInput: ImageInputPolicy;
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
  offerings?: AdminModelOffering[];
  fallbacks?: string[];
  maxTokens?: number;
  temperature?: number;
  allowUserKey?: boolean;
  requiresUserKey?: boolean;
  supportsImages?: boolean;
  supportsTools?: boolean;
  type?: "openai-chat" | "anthropic-messages";
  baseUrl?: string;
  model?: string;
  apiKeyRef?: string;
  authHeader?: string;
  authPrefix?: string;
  directEndpoint?: boolean;
  hasLegacyKey?: boolean;
  hasCustomHeaders?: boolean;
  [key: string]: unknown;
};

export type AdminModelOffering = {
  providerId: string;
  model: string;
  enabled?: boolean;
  priority?: number;
  supportsImages?: boolean;
  supportsTools?: boolean;
};

export type AdminProviderConfig = {
  label: string;
  type: "openai-chat" | "anthropic-messages";
  baseUrl: string;
  enabled?: boolean;
  apiKeyRef?: string;
  authHeader?: string;
  authPrefix?: string;
  directEndpoint?: boolean;
  allowUserKey?: boolean;
  requiresUserKey?: boolean;
  supportsImages?: boolean;
  supportsTools?: boolean;
  concurrency?: "unlimited" | "exclusive" | "bounded";
  maxConcurrent?: number;
  queueTimeoutMs?: number;
  priority?: number;
  hasLegacyKey?: boolean;
  hasCustomHeaders?: boolean;
  headerSourceRouteId?: string;
  [key: string]: unknown;
};

export type AdminProvider = {
  id: string;
  label: string;
  type: "openai-chat" | "anthropic-messages";
  baseUrl: string;
  enabled: boolean;
  apiKeyRef?: string;
  credentialStatus: "configured" | "missing" | "unavailable" | "user_key_required";
  hasLegacyKey: boolean;
  hasCustomHeaders: boolean;
  directEndpoint: boolean;
  allowUserKey: boolean;
  requiresUserKey: boolean;
  supportsImages: boolean;
  supportsTools: boolean;
  concurrency: "unlimited" | "exclusive" | "bounded";
  maxConcurrent?: number;
  queueTimeoutMs: number;
  priority: number;
  referencedBy: string[];
};

export type AdminLogicalModel = {
  id: string;
  label: string;
  enabled: boolean;
  fallbacks: string[];
  supportsImages: boolean;
  supportsTools: boolean;
  offerings: AdminModelOffering[];
  referencedBy: string[];
};

export type AdminRouteSecretMetadata = {
  apiKeyRef: string;
  source: "managed" | "worker" | "legacy" | "missing";
  status: "configured" | "unavailable" | "missing";
  managed: boolean;
  environmentFallback: boolean;
  updatedAt?: string;
  revision?: string;
  message?: string;
};

export type AdminRouteSecretsSnapshot = {
  masterKeyReady: boolean;
  masterKeyMessage?: string;
  items: AdminRouteSecretMetadata[];
};

export type AdminSecretMutationResponse = {
  ok: true;
  item: AdminRouteSecretMetadata;
};

export type AdminModelDiscoveryResponse = {
  models: string[];
  count: number;
  endpoint: string;
};

export type AdminReliabilityRoute = {
  routeId: string;
  model: string;
  enabled: boolean;
  attempts: number;
  successes: number;
  averageLatencyMs: number;
  lastOutcome?: string;
  observedAt?: string;
  lastFallback?: boolean;
  fallbackCount?: number;
  streamSamples?: number;
  progressiveSamples?: number;
  averageFirstVisibleLatencyMs?: number;
  lastFirstVisibleLatencyMs?: number;
  lastStreamShape?: "progressive" | "single_chunk";
};

export type AdminReliabilityProvider = {
  providerId: string;
  label: string;
  enabled: boolean;
  credentialStatus: "configured" | "missing" | "unavailable" | "user_key_required";
  concurrency: "unlimited" | "exclusive" | "bounded";
  maxConcurrent?: number;
  queueTimeoutMs: number;
  routes: AdminReliabilityRoute[];
};

export type AdminReliabilitySnapshot = {
  generatedAt: string;
  providers: AdminReliabilityProvider[];
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
  providers: Record<string, AdminProviderConfig>;
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

export async function fetchAdminRouteSecrets(): Promise<AdminRouteSecretsSnapshot> {
  const data = await requestJson("/api/admin/route-secrets");
  if (!isAdminRouteSecretsSnapshot(data)) {
    throw new ApiError("invalid_admin_route_secrets_response", "线路密钥状态格式无效。", 502);
  }
  return data;
}

export async function putAdminRouteSecret(
  apiKeyRef: string,
  apiKey: string,
  expectedRevision?: string,
): Promise<AdminSecretMutationResponse> {
  const data = await requestJson(`/api/admin/route-secrets/${encodeURIComponent(apiKeyRef)}`, {
    method: "PUT",
    body: JSON.stringify({ apiKey, ...(expectedRevision === undefined ? {} : { expectedRevision }) }),
  });
  if (!isAdminSecretMutationResponse(data)) {
    throw new ApiError("invalid_admin_route_secret_response", "线路密钥保存结果格式无效。", 502);
  }
  return data;
}

export async function deleteAdminRouteSecret(
  apiKeyRef: string,
  expectedRevision?: string,
): Promise<AdminSecretMutationResponse> {
  const data = await requestJson(`/api/admin/route-secrets/${encodeURIComponent(apiKeyRef)}`, {
    method: "DELETE",
    body: JSON.stringify(expectedRevision === undefined ? {} : { expectedRevision }),
  });
  if (!isAdminSecretMutationResponse(data)) {
    throw new ApiError("invalid_admin_route_secret_response", "线路密钥删除结果格式无效。", 502);
  }
  return data;
}

export async function discoverAdminProviderModels(providerId: string): Promise<AdminModelDiscoveryResponse> {
  const data = await requestJson("/api/admin/route-models", {
    method: "POST",
    body: JSON.stringify({ providerId }),
  });
  if (!isAdminModelDiscoveryResponse(data)) {
    throw new ApiError("invalid_admin_model_discovery_response", "模型列表格式无效。", 502);
  }
  return data;
}

export async function fetchAdminReliability(): Promise<AdminReliabilitySnapshot> {
  const data = await requestJson("/api/admin/reliability");
  if (!isAdminReliabilitySnapshot(data)) {
    throw new ApiError("invalid_admin_reliability_response", "可靠性数据格式无效。", 502);
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
  if (!isImageInputPolicy(value.imageInput)) return false;
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

export function isAdminRouteSecretsSnapshot(value: unknown): value is AdminRouteSecretsSnapshot {
  return isRecord(value)
    && hasOnlyKeys(value, ["masterKeyReady", "masterKeyMessage", "items"])
    && typeof value.masterKeyReady === "boolean"
    && (value.masterKeyMessage === undefined || isNonEmptyString(value.masterKeyMessage))
    && Array.isArray(value.items)
    && value.items.every(isAdminRouteSecretMetadata)
    && new Set(value.items.map((item) => item.apiKeyRef)).size === value.items.length;
}

export function isAdminSecretMutationResponse(value: unknown): value is AdminSecretMutationResponse {
  return isRecord(value)
    && hasExactKeys(value, ["ok", "item"])
    && value.ok === true
    && isAdminRouteSecretMetadata(value.item);
}

export function isAdminModelDiscoveryResponse(value: unknown): value is AdminModelDiscoveryResponse {
  return isRecord(value)
    && hasExactKeys(value, ["models", "count", "endpoint"])
    && isUniqueStringIdArray(value.models)
    && value.models.length <= 500
    && value.models.every((model) => model.length <= 200)
    && value.count === value.models.length
    && isSafeHttpUrl(value.endpoint);
}

export function isAdminReliabilitySnapshot(value: unknown): value is AdminReliabilitySnapshot {
  if (!isRecord(value)
    || !hasExactKeys(value, ["generatedAt", "providers"])
    || !isIsoDate(value.generatedAt)
    || !Array.isArray(value.providers)
    || !value.providers.every(isAdminReliabilityProvider)) {
    return false;
  }
  const providerIds = value.providers.map((provider) => provider.providerId);
  return new Set(providerIds).size === providerIds.length;
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

  for (const route of Object.values(routes)) {
    const providerIds = route.offerings?.map((offering) => offering.providerId) || [];
    if (new Set(providerIds).size !== providerIds.length || providerIds.some((id) => !hasOwn(providers, id))) return false;
    if (route.fallbacks?.some((id) => !routeIds.has(id))) return false;
  }

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
    && typeof value.supportsImages === "boolean"
    && typeof value.supportsTools === "boolean"
    && (value.healthStatus === undefined || value.healthStatus === "healthy" || value.healthStatus === "unhealthy" || value.healthStatus === "unknown")
    && (value.healthOutcome === undefined || typeof value.healthOutcome === "string");
}

function isImageInputPolicy(value: unknown): value is ImageInputPolicy {
  if (!isRecord(value) || !hasExactKeys(value, [
    "acceptedMediaTypes",
    "maxImages",
    "maxImageBytes",
    "maxTotalImageBytes",
  ])) return false;
  if (!Array.isArray(value.acceptedMediaTypes)) return false;
  const accepted = value.acceptedMediaTypes;
  return accepted.length === IMAGE_MEDIA_TYPES.length
    && new Set(accepted).size === accepted.length
    && IMAGE_MEDIA_TYPES.every((mediaType) => accepted.includes(mediaType))
    && isPositiveInteger(value.maxImages)
    && isPositiveInteger(value.maxImageBytes)
    && isPositiveInteger(value.maxTotalImageBytes);
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
  if (!isRecord(value)
    || hasForbiddenSecretField(value)
    || !hasOnlyKeys(value, [
      "label",
      "enabled",
      "offerings",
      "fallbacks",
      "maxTokens",
      "temperature",
      "allowUserKey",
      "requiresUserKey",
      "supportsImages",
      "supportsTools",
      "type",
      "baseUrl",
      "model",
      "apiKeyRef",
      "authHeader",
      "authPrefix",
      "directEndpoint",
      "hasLegacyKey",
      "hasCustomHeaders",
    ])
    || typeof value.label !== "string"
    || (value.enabled !== undefined && typeof value.enabled !== "boolean")
    || (value.offerings !== undefined && (!Array.isArray(value.offerings) || !value.offerings.every(isAdminModelOffering)))
    || (value.fallbacks !== undefined && !isUniqueStringIdArray(value.fallbacks))
    || (value.maxTokens !== undefined && !isPositiveInteger(value.maxTokens))
    || (value.temperature !== undefined && !isFiniteNumber(value.temperature))
    || (value.allowUserKey !== undefined && typeof value.allowUserKey !== "boolean")
    || (value.requiresUserKey !== undefined && typeof value.requiresUserKey !== "boolean")
    || (value.supportsImages !== undefined && typeof value.supportsImages !== "boolean")
    || (value.supportsTools !== undefined && typeof value.supportsTools !== "boolean")
    || (value.hasLegacyKey !== undefined && typeof value.hasLegacyKey !== "boolean")
    || (value.hasCustomHeaders !== undefined && typeof value.hasCustomHeaders !== "boolean")) {
    return false;
  }
  const hasLegacyRoute = value.type !== undefined || value.baseUrl !== undefined || value.model !== undefined;
  if (hasLegacyRoute) {
    if ((value.type !== "openai-chat" && value.type !== "anthropic-messages")
      || !isSafeHttpUrl(value.baseUrl)
      || !isNonEmptyString(value.model)) return false;
  }
  return (value.apiKeyRef === undefined || isRouteSecretRef(value.apiKeyRef))
    && (value.authHeader === undefined || isNonEmptyString(value.authHeader))
    && (value.authPrefix === undefined || typeof value.authPrefix === "string")
    && (value.directEndpoint === undefined || typeof value.directEndpoint === "boolean");
}

function isSanitizedAdminProviderConfig(value: unknown): value is AdminProviderConfig {
  return isRecord(value)
    && !hasForbiddenSecretField(value)
    && hasOnlyKeys(value, [
      "label",
      "type",
      "baseUrl",
      "enabled",
      "apiKeyRef",
      "authHeader",
      "authPrefix",
      "directEndpoint",
      "allowUserKey",
      "requiresUserKey",
      "supportsImages",
      "supportsTools",
      "concurrency",
      "maxConcurrent",
      "queueTimeoutMs",
      "priority",
      "hasLegacyKey",
      "hasCustomHeaders",
      "headerSourceRouteId",
    ])
    && typeof value.label === "string"
    && (value.type === "openai-chat" || value.type === "anthropic-messages")
    && isSafeHttpUrl(value.baseUrl)
    && (value.enabled === undefined || typeof value.enabled === "boolean")
    && (value.apiKeyRef === undefined || isRouteSecretRef(value.apiKeyRef))
    && (value.authHeader === undefined || isNonEmptyString(value.authHeader))
    && (value.authPrefix === undefined || typeof value.authPrefix === "string")
    && (value.directEndpoint === undefined || typeof value.directEndpoint === "boolean")
    && (value.allowUserKey === undefined || typeof value.allowUserKey === "boolean")
    && (value.requiresUserKey === undefined || typeof value.requiresUserKey === "boolean")
    && (value.supportsImages === undefined || typeof value.supportsImages === "boolean")
    && (value.supportsTools === undefined || typeof value.supportsTools === "boolean")
    && (
      value.concurrency === undefined
      || value.concurrency === "unlimited"
      || value.concurrency === "exclusive"
      || value.concurrency === "bounded"
    )
    && (value.maxConcurrent === undefined || (isPositiveInteger(value.maxConcurrent) && value.maxConcurrent <= 100))
    && (value.concurrency !== "bounded" || value.maxConcurrent !== undefined)
    && (value.queueTimeoutMs === undefined || (isNonNegativeInteger(value.queueTimeoutMs) && value.queueTimeoutMs <= 10_000))
    && (value.priority === undefined || isFiniteNumber(value.priority))
    && (value.hasLegacyKey === undefined || typeof value.hasLegacyKey === "boolean")
    && (value.hasCustomHeaders === undefined || typeof value.hasCustomHeaders === "boolean")
    && (value.headerSourceRouteId === undefined || isNonEmptyString(value.headerSourceRouteId));
}

function isAdminModelOffering(value: unknown): value is AdminModelOffering {
  return isRecord(value)
    && hasOnlyKeys(value, ["providerId", "model", "enabled", "priority", "supportsImages", "supportsTools"])
    && isProviderId(value.providerId)
    && isNonEmptyString(value.model)
    && value.model.length <= 200
    && (value.enabled === undefined || typeof value.enabled === "boolean")
    && (value.priority === undefined || isFiniteNumber(value.priority))
    && (value.supportsImages === undefined || typeof value.supportsImages === "boolean")
    && (value.supportsTools === undefined || typeof value.supportsTools === "boolean");
}

function isAdminRouteSecretMetadata(value: unknown): value is AdminRouteSecretMetadata {
  return isRecord(value)
    && !hasForbiddenSecretField(value)
    && hasOnlyKeys(value, [
      "apiKeyRef",
      "source",
      "status",
      "managed",
      "environmentFallback",
      "updatedAt",
      "revision",
      "message",
    ])
    && isRouteSecretRef(value.apiKeyRef)
    && (value.source === "managed" || value.source === "worker" || value.source === "legacy" || value.source === "missing")
    && (value.status === "configured" || value.status === "unavailable" || value.status === "missing")
    && typeof value.managed === "boolean"
    && typeof value.environmentFallback === "boolean"
    && (value.updatedAt === undefined || isIsoDate(value.updatedAt))
    && (value.revision === undefined || isNonEmptyString(value.revision))
    && (value.message === undefined || isNonEmptyString(value.message));
}

function isAdminReliabilityProvider(value: unknown): value is AdminReliabilityProvider {
  if (!isRecord(value)
    || !hasOnlyKeys(value, [
      "providerId",
      "label",
      "enabled",
      "credentialStatus",
      "concurrency",
      "maxConcurrent",
      "queueTimeoutMs",
      "routes",
    ])
    || !isProviderId(value.providerId)
    || !isNonEmptyString(value.label)
    || typeof value.enabled !== "boolean"
    || (
      value.credentialStatus !== "configured"
      && value.credentialStatus !== "missing"
      && value.credentialStatus !== "unavailable"
      && value.credentialStatus !== "user_key_required"
    )
    || (value.concurrency !== "unlimited" && value.concurrency !== "exclusive" && value.concurrency !== "bounded")
    || (value.maxConcurrent !== undefined && (!isPositiveInteger(value.maxConcurrent) || value.maxConcurrent > 100))
    || (value.concurrency === "bounded" && value.maxConcurrent === undefined)
    || !isNonNegativeInteger(value.queueTimeoutMs)
    || value.queueTimeoutMs > 10_000
    || !Array.isArray(value.routes)
    || !value.routes.every(isAdminReliabilityRoute)) {
    return false;
  }
  const routeIds = value.routes.map((route) => route.routeId);
  return new Set(routeIds).size === routeIds.length;
}

function isAdminReliabilityRoute(value: unknown): value is AdminReliabilityRoute {
  return isRecord(value)
    && hasOnlyKeys(value, [
      "routeId",
      "model",
      "enabled",
      "attempts",
      "successes",
      "averageLatencyMs",
      "lastOutcome",
      "observedAt",
      "lastFallback",
      "fallbackCount",
      "streamSamples",
      "progressiveSamples",
      "averageFirstVisibleLatencyMs",
      "lastFirstVisibleLatencyMs",
      "lastStreamShape",
    ])
    && isNonEmptyString(value.routeId)
    && isNonEmptyString(value.model)
    && typeof value.enabled === "boolean"
    && isNonNegativeInteger(value.attempts)
    && value.attempts <= 1_000
    && isNonNegativeInteger(value.successes)
    && value.successes <= value.attempts
    && isNonNegativeInteger(value.averageLatencyMs)
    && value.averageLatencyMs <= 600_000
    && (value.lastOutcome === undefined || isNonEmptyString(value.lastOutcome))
    && (value.observedAt === undefined || isIsoDate(value.observedAt))
    && (value.lastFallback === undefined || typeof value.lastFallback === "boolean")
    && (value.fallbackCount === undefined || (isNonNegativeInteger(value.fallbackCount) && value.fallbackCount <= value.attempts))
    && hasValidAdminStreamEvidence(value, value.successes);
}

function hasValidAdminStreamEvidence(value: Record<string, unknown>, successes: number): boolean {
  const fields = [
    value.streamSamples,
    value.progressiveSamples,
    value.averageFirstVisibleLatencyMs,
    value.lastFirstVisibleLatencyMs,
    value.lastStreamShape,
  ];
  if (fields.every((field) => field === undefined)) return true;
  if (fields.some((field) => field === undefined)) return false;
  return isPositiveInteger(value.streamSamples)
    && value.streamSamples <= 1_000
    && value.streamSamples <= successes
    && isNonNegativeInteger(value.progressiveSamples)
    && value.progressiveSamples <= value.streamSamples
    && isNonNegativeInteger(value.averageFirstVisibleLatencyMs)
    && value.averageFirstVisibleLatencyMs <= 600_000
    && isNonNegativeInteger(value.lastFirstVisibleLatencyMs)
    && value.lastFirstVisibleLatencyMs <= 600_000
    && (value.lastStreamShape === "progressive" || value.lastStreamShape === "single_chunk");
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

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function hasForbiddenSecretField(value: Record<string, unknown>): boolean {
  return ["apiKey", "headers", "secret", "ciphertext", "iv", "token", "credential", "credentials"]
    .some((key) => hasOwn(value, key));
}

function isProviderId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(value);
}

function isRouteSecretRef(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z][A-Z0-9_]{1,63}$/.test(value);
}

function isSafeHttpUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2_048) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim()) && Number.isFinite(Date.parse(value));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
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
