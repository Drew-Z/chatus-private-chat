import { IMAGE_MEDIA_TYPES, type ImageInputPolicy } from "../../../src/contracts/image";
import {
  DEFAULT_FILE_INPUT_POLICY,
  TEXT_FILE_BASENAMES,
  TEXT_FILE_EXTENSIONS,
  type FileInputPolicy,
} from "../../../src/contracts/file";

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
  access: "guest" | "member";
  user: string;
  displayName: string;
  usage: { used: number; limit: number; remaining: number };
  routes: RouteProjection[];
  defaultRoute: string;
  allowBringYourOwnKey: boolean;
  hasUserSystemPrompt: boolean;
  imageInput: ImageInputPolicy;
  fileInput: FileInputPolicy;
  capabilities: {
    imageInput: boolean;
    fileInput: boolean;
    memory: boolean;
    messageActions: boolean;
    feedback: boolean;
    accountData: boolean;
  };
  skills: SkillProjection[];
  tools: ToolProjection[];
  agent: { transport: string; basePath: string; instance: string };
};

export type AdminPublicAccessConfig = {
  enabled: boolean;
  routeId: string;
  sessionTtlSeconds: number;
  dailyMessageLimit: number;
  minuteMessageLimit: number;
  sourceDailyMessageLimit: number;
  sourceMinuteMessageLimit: number;
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

export type AdminMcpAuthType = "none" | "bearer" | "x-api-key";

export type AdminMcpServerConfig = {
  enabled: boolean;
  label: string;
  endpoint: string;
  authType: AdminMcpAuthType;
  secretRef?: string;
};

export type AdminMcpSecretMetadata = {
  secretRef: string;
  source: "managed" | "worker" | "missing";
  status: "configured" | "unavailable" | "missing";
  managed: boolean;
  environmentFallback: boolean;
  updatedAt?: string;
  revision?: string;
  message?: string;
};

export type AdminMcpSecretsSnapshot = {
  masterKeyReady: boolean;
  masterKeyMessage?: string;
  items: AdminMcpSecretMetadata[];
};

export type AdminMcpSecretMutationResponse = {
  ok: true;
  item: AdminMcpSecretMetadata;
};

export type AdminMcpDiscoveryRequest = {
  serverId: string;
  label?: string;
  endpoint: string;
  authType: AdminMcpAuthType;
  secretRef?: string;
};

export type AdminMcpDiscoveredTool = {
  id: string;
  label: string;
  description: string;
  inputSchema: Record<string, unknown>;
  confirmation: "first-per-conversation";
  executor: {
    type: "mcp";
    serverId: string;
    remoteName: string;
  };
  schemaFingerprint: string;
};

export type AdminMcpDiscoveryResponse = {
  serverId: string;
  tools: AdminMcpDiscoveredTool[];
  rejected: number;
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

export type AdminOperationsTrendPoint = {
  day: string;
  requests: number;
  errors: number;
  fallbacks: number;
  rateLimited: number;
  errorRate: number;
};

export type AdminOperationsRouteStats = {
  id: string;
  label: string;
  model: string;
  ok7d: number;
  error7d: number;
  errorRate7d: number;
  days: Array<{ day: string; ok: number; error: number }>;
};

export type AdminOperationsUserStats = {
  label: string;
  enabled: boolean;
  displayName: string;
  used: number;
  dailyLimit: number;
  remaining: number;
  defaultRoute: string;
  allowedRoutes: string[];
  allowBringYourOwnKey: boolean;
  hasSystemPrompt: boolean;
  systemPromptChars: number;
  activeSessions: number;
  memoryChars: number;
  requests7d: number;
  errors7d: number;
  errorRate7d: number;
  usageByDay: Array<{ day: string; used: number }>;
};

export type AdminOperationsStats = {
  day: string;
  days: string[];
  totals: {
    requests: number;
    errors: number;
    fallbacks: number;
    rateLimited: number;
    errorRate: number;
  };
  trend: AdminOperationsTrendPoint[];
  routeStats: AdminOperationsRouteStats[];
  users: AdminOperationsUserStats[];
  routes: Array<{
    id: string;
    enabled: boolean;
    label: string;
    type?: "openai-chat" | "anthropic-messages";
    model?: string;
    baseUrl?: string;
    apiKeyRef: string;
    requiresUserKey: boolean;
    supportsImages: boolean;
  }>;
  configSource: "kv" | "secret" | "default";
  accessCodeSource: "kv" | "secret" | "managed";
};

export type AdminAuditEntry = {
  id: string;
  action: string;
  target?: string;
  at: string;
};

export type AdminFeedbackEntry = {
  id: string;
  label: string;
  rating: "up" | "down";
  reason?: "" | "inaccurate" | "misunderstood" | "verbose" | "format" | "other";
  routeId: string;
  chatId: string;
  messageId: string;
  at: string;
};

export type AdminOperationsSnapshot = {
  stats: AdminOperationsStats;
  audit: AdminAuditEntry[];
  feedback: AdminFeedbackEntry[];
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
  inputSchema: Record<string, unknown>;
  executor:
    | { type: "builtin"; name: "text_stats" }
    | { type: "mcp"; serverId: string; remoteName: string };
  schemaFingerprint?: string;
  [key: string]: unknown;
};

export type AdminConfig = {
  routes: Record<string, AdminRouteConfig>;
  providers: Record<string, AdminProviderConfig>;
  users: Record<string, AdminUserConfig>;
  defaults: AdminUserConfig;
  publicAccess: AdminPublicAccessConfig;
  skills: Record<string, AdminSkillConfig>;
  tools: Record<string, AdminToolConfig>;
  mcpServers: Record<string, AdminMcpServerConfig>;
  [key: string]: unknown;
};

export type AdminConfigSnapshot = {
  config: AdminConfig;
  source: "kv" | "secret" | "default";
  revision: string;
};

export type AdminSetupStepStatus = "ready" | "incomplete" | "blocked" | "not_run" | "stale";

export type AdminSetupStep = {
  ready: boolean;
  status: AdminSetupStepStatus;
  count: number;
};

export type AdminSetupStatus = {
  ready: boolean;
  configSource: "kv" | "secret" | "default";
  steps: {
    health: AdminSetupStep;
    provider: AdminSetupStep;
    model: AdminSetupStep;
    member: AdminSetupStep;
    permission: AdminSetupStep;
    smoke: AdminSetupStep;
  };
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

export type AdminUsageResetResponse = {
  ok: true;
  label: string;
  day: string;
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

export type UserDataExportConversation = Omit<AgentConversation, "workspaceFiles"> & {
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
  workspaceFiles: WorkspaceConversationFileRef[];
};

export type WorkspaceFileVersion = {
  id: string;
  fileId: string;
  size: number;
  mediaType: string;
  checksum: string;
  state: "pending" | "ready" | "failed" | "deleting";
  createdAt: number;
};

export type WorkspaceFile = {
  id: string;
  path: string;
  name: string;
  pinned: boolean;
  state: "uploading" | "ready" | "failed" | "deleting" | "deleted";
  createdAt: number;
  updatedAt: number;
  currentVersion?: WorkspaceFileVersion;
  retryAvailable: boolean;
};

export type WorkspaceConversationFileRef = {
  fileId: string;
  versionId: string;
  path: string;
  name: string;
  size: number;
  mediaType: string;
  checksum: string;
};

export type WorkspaceFilePage = {
  files: WorkspaceFile[];
  nextCursor?: string;
  maxFileBytes: number;
};

export type WorkspaceFileVersions = {
  file: WorkspaceFile;
  versions: WorkspaceFileVersion[];
};

export type WorkspaceFileDeleteResult =
  | { deleted: true; existing: boolean }
  | { deleted: false; pending: true; message: string };

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
  const data = await requestJson("/api/admin/logout", { method: "POST" });
  if (!isRecord(data) || !hasExactKeys(data, ["ok"]) || data.ok !== true) {
    throw new ApiError("invalid_admin_logout_response", "服务器返回了无法识别的退出结果。", 502);
  }
}

export async function fetchAdminConfig(): Promise<AdminConfigSnapshot> {
  const data = await requestJson("/api/admin/config");
  if (!isAdminConfigSnapshot(data)) {
    throw new ApiError("invalid_admin_config_response", "管理配置格式无效。", 502);
  }
  return data;
}

export async function fetchAdminSetupStatus(): Promise<AdminSetupStatus> {
  const data = await requestJson("/api/admin/setup-status");
  if (!isAdminSetupStatus(data)) {
    throw new ApiError("invalid_admin_setup_status_response", "首次配置状态格式无效。", 502);
  }
  return data;
}

export async function runAdminSetupSmoke(): Promise<AdminSetupStatus> {
  const data = await requestJson("/api/admin/setup-smoke", { method: "POST" });
  if (!isAdminSetupStatus(data)) {
    throw new ApiError("invalid_admin_setup_smoke_response", "首次配置检查结果格式无效。", 502);
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

export async function fetchAdminMcpSecrets(): Promise<AdminMcpSecretsSnapshot> {
  const data = await requestJson("/api/admin/mcp-secrets");
  if (!isAdminMcpSecretsSnapshot(data)) {
    throw new ApiError("invalid_admin_mcp_secrets_response", "MCP 密钥状态格式无效。", 502);
  }
  return data;
}

export async function putAdminMcpSecret(
  secretRef: string,
  secret: string,
  expectedRevision?: string,
): Promise<AdminMcpSecretMutationResponse> {
  const data = await requestJson(`/api/admin/mcp-secrets/${encodeURIComponent(secretRef)}`, {
    method: "PUT",
    body: JSON.stringify({ secret, ...(expectedRevision === undefined ? {} : { expectedRevision }) }),
  });
  if (!isAdminMcpSecretMutationResponse(data)) {
    throw new ApiError("invalid_admin_mcp_secret_response", "MCP 密钥保存结果格式无效。", 502);
  }
  return data;
}

export async function deleteAdminMcpSecret(
  secretRef: string,
  expectedRevision?: string,
): Promise<AdminMcpSecretMutationResponse> {
  const data = await requestJson(`/api/admin/mcp-secrets/${encodeURIComponent(secretRef)}`, {
    method: "DELETE",
    body: JSON.stringify(expectedRevision === undefined ? {} : { expectedRevision }),
  });
  if (!isAdminMcpSecretMutationResponse(data)) {
    throw new ApiError("invalid_admin_mcp_secret_response", "MCP 密钥删除结果格式无效。", 502);
  }
  return data;
}

export async function discoverAdminMcpTools(request: AdminMcpDiscoveryRequest): Promise<AdminMcpDiscoveryResponse> {
  const data = await requestJson("/api/admin/mcp-discovery", {
    method: "POST",
    body: JSON.stringify(request),
  });
  if (!isAdminMcpDiscoveryResponse(data)) {
    throw new ApiError("invalid_admin_mcp_discovery_response", "MCP 工具发现结果格式无效。", 502);
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

export async function fetchAdminOperations(): Promise<AdminOperationsSnapshot> {
  const [stats, audit, feedback] = await Promise.all([
    requestJson("/api/admin/stats"),
    requestJson("/api/admin/audit"),
    requestJson("/api/admin/feedback"),
  ]);
  if (!isAdminOperationsStats(stats)) {
    throw new ApiError("invalid_admin_stats_response", "运营统计格式无效。", 502);
  }
  if (!isAdminAuditSnapshot(audit)) {
    throw new ApiError("invalid_admin_audit_response", "管理审计格式无效。", 502);
  }
  if (!isAdminFeedbackSnapshot(feedback)) {
    throw new ApiError("invalid_admin_feedback_response", "成员反馈格式无效。", 502);
  }
  return { stats, audit: audit.entries, feedback: feedback.entries };
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

export async function resetAdminMemberUsage(label: string): Promise<AdminUsageResetResponse> {
  const data = await requestJson("/api/admin/usage", {
    method: "POST",
    body: JSON.stringify({ label }),
  });
  if (!isAdminUsageResetResponse(data)) {
    throw new ApiError("invalid_admin_usage_reset_response", "成员用量重置结果格式无效。", 502);
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

export async function createGuestSession(): Promise<SessionProjection | null> {
  let response: Response;
  try {
    response = await fetch("/api/guest-session", {
      method: "POST",
      credentials: "include",
      headers: { "X-Chatus-Client": "web" },
    });
  } catch {
    throw new ApiError("network_unavailable", "暂时无法连接服务器。", 0);
  }
  const data = await readResponseData(response);
  if (response.status === 404 && isRecord(data) && data.error === "public_access_disabled") return null;
  if (!response.ok) throw apiErrorFromResponse(response, data, "暂时无法创建访客会话。");
  if (!isSessionProjection(data)) throw new ApiError("invalid_session_response", "服务器返回了无法识别的访客状态。", 502);
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

export async function listWorkspaceFiles(input: {
  query?: string;
  cursor?: string;
  limit?: number;
} = {}): Promise<WorkspaceFilePage> {
  const query = new URLSearchParams();
  if (input.query?.trim()) query.set("q", input.query.trim());
  if (input.cursor) query.set("cursor", input.cursor);
  if (input.limit) query.set("limit", String(input.limit));
  const data = await requestJson(`/api/workspace/files${query.size ? `?${query}` : ""}`);
  if (!isWorkspaceFilePage(data)) throw new ApiError("invalid_workspace_response", "文件列表格式无效。", 502);
  return data;
}

export async function listWorkspaceFileVersions(fileId: string): Promise<WorkspaceFileVersions> {
  const data = await requestJson(`/api/workspace/files/${encodeURIComponent(fileId)}/versions`);
  if (!isWorkspaceFileVersions(data)) throw new ApiError("invalid_workspace_response", "文件版本格式无效。", 502);
  return data;
}

export async function uploadWorkspaceFile(input: {
  file: File;
  relativePath: string;
  operationId: string;
  fileId?: string;
  expectedUpdatedAt?: number;
}): Promise<WorkspaceFile> {
  const form = new FormData();
  form.set("file", input.file);
  form.set("relativePath", input.relativePath);
  form.set("operationId", input.operationId);
  if (input.expectedUpdatedAt) form.set("expectedUpdatedAt", String(input.expectedUpdatedAt));
  const suffix = input.fileId ? `/${encodeURIComponent(input.fileId)}/retry` : "";
  const data = await requestFormJson(`/api/workspace/files${suffix}`, form);
  if (!isWorkspaceUploadResponse(data)) {
    throw new ApiError("invalid_workspace_response", "文件上传结果格式无效。", 502);
  }
  return data.file;
}

export async function updateWorkspaceFile(
  file: WorkspaceFile,
  patch: { relativePath?: string; pinned?: boolean },
): Promise<WorkspaceFile> {
  const data = await requestJson(`/api/workspace/files/${encodeURIComponent(file.id)}`, {
    method: "PATCH",
    body: JSON.stringify({ ...patch, expectedUpdatedAt: file.updatedAt }),
  });
  if (!isWorkspaceFileMutationResponse(data)) {
    throw new ApiError("invalid_workspace_response", "文件更新结果格式无效。", 502);
  }
  return data.file;
}

export async function deleteWorkspaceFile(file: WorkspaceFile, operationId: string): Promise<WorkspaceFileDeleteResult> {
  const query = new URLSearchParams({
    expectedUpdatedAt: String(file.updatedAt),
    operationId,
  });
  const data = await requestJson(`/api/workspace/files/${encodeURIComponent(file.id)}?${query}`, { method: "DELETE" });
  if (!isWorkspaceFileDeleteResponse(data)) {
    throw new ApiError("invalid_workspace_response", "文件删除结果格式无效。", 502);
  }
  return data.deleted
    ? { deleted: true, existing: data.existing }
    : { deleted: false, pending: true, message: data.message };
}

export async function setConversationWorkspaceFiles(
  conversation: AgentConversation,
  files: Array<{ fileId: string; versionId: string }>,
): Promise<AgentConversation> {
  const data = await requestJson(
    `/api/agent/conversations/${encodeURIComponent(conversation.id)}/workspace-files`,
    {
      method: "PUT",
      body: JSON.stringify({ expectedUpdatedAt: conversation.updatedAt, files }),
    },
  );
  if (!isWorkspaceConversationMutationResponse(data)) {
    throw new ApiError("invalid_conversation_response", "会话文件更新格式无效。", 502);
  }
  return data.conversation;
}

export function workspaceFileDownloadUrl(fileId: string, versionId?: string): string {
  const query = versionId ? `?versionId=${encodeURIComponent(versionId)}` : "";
  return `/api/workspace/files/${encodeURIComponent(fileId)}/download${query}`;
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
  if (!isRecord(value) || !isRecord(value.usage) || !isRecord(value.agent) || !isSessionCapabilities(value.capabilities)) return false;
  if (!isImageInputPolicy(value.imageInput)) return false;
  if (!isFileInputPolicy(value.fileInput)) return false;
  if (!Array.isArray(value.routes) || !value.routes.every(isRouteProjection)) return false;
  if (!Array.isArray(value.skills) || !value.skills.every(isSkillProjection)) return false;
  if (!Array.isArray(value.tools) || !value.tools.every(isToolProjection)) return false;
  const routeIds = value.routes.map((route) => route.id);
  const skillIds = value.skills.map((skill) => skill.id);
  const toolIds = value.tools.map((tool) => tool.id);
  if (!((value.access === "guest" || value.access === "member")
    && isNonEmptyString(value.user)
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
    && isNonEmptyString(value.agent.instance))) {
    return false;
  }

  if (value.access === "guest") {
    return isGuestSessionProjection(value as SessionProjection, routeIds);
  }
  return true;
}

function isGuestSessionProjection(value: SessionProjection, routeIds: string[]): boolean {
  const restrictedCapabilities = value.capabilities.memory === false
    && value.capabilities.messageActions === false
    && value.capabilities.feedback === false
    && value.capabilities.accountData === false
    && value.capabilities.fileInput === false;
  const imageInputAllowed = value.routes.some((route) => route.supportsImages);
  return value.allowBringYourOwnKey === false
    && value.hasUserSystemPrompt === false
    && value.skills.length === 0
    && value.tools.length === 0
    && value.routes.length <= 1
    && value.routes.every((route) => route.supportsTools === false)
    && restrictedCapabilities
    && value.capabilities.imageInput === imageInputAllowed
    && ((routeIds.length === 0 && value.defaultRoute === "") || (routeIds.length === 1 && value.defaultRoute === routeIds[0]));
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

export function isAdminSetupStatus(value: unknown): value is AdminSetupStatus {
  if (!isRecord(value)
    || !hasExactKeys(value, ["ready", "configSource", "steps"])
    || typeof value.ready !== "boolean"
    || (value.configSource !== "kv" && value.configSource !== "secret" && value.configSource !== "default")
    || !isRecord(value.steps)
    || !hasExactKeys(value.steps, ["health", "provider", "model", "member", "permission", "smoke"])) {
    return false;
  }
  const steps = value.steps;
  const prerequisiteNames = ["health", "provider", "model", "member", "permission"] as const;
  if (!prerequisiteNames.every((name) => isAdminSetupStep(steps[name], ["ready", "incomplete"]))) {
    return false;
  }
  if (!isAdminSetupStep(steps.smoke, ["ready", "blocked", "not_run", "stale"])) return false;
  const validatedSteps = [
    ...prerequisiteNames.map((name) => steps[name] as AdminSetupStep),
    steps.smoke as AdminSetupStep,
  ];
  return value.ready === validatedSteps
    .every((step) => step.ready);
}

function isAdminSetupStep(value: unknown, statuses: readonly AdminSetupStepStatus[]): value is AdminSetupStep {
  return isRecord(value)
    && hasExactKeys(value, ["ready", "status", "count"])
    && typeof value.ready === "boolean"
    && typeof value.status === "string"
    && statuses.includes(value.status as AdminSetupStepStatus)
    && value.ready === (value.status === "ready")
    && isNonNegativeInteger(value.count)
    && value.count <= 10_000
    && (value.status !== "ready" || value.count > 0)
    && (value.status !== "blocked" || value.count === 0)
    && (value.status !== "not_run" || value.count === 0)
    && (value.status !== "stale" || value.count === 0);
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

export function isAdminMcpSecretsSnapshot(value: unknown): value is AdminMcpSecretsSnapshot {
  return isRecord(value)
    && hasOnlyKeys(value, ["masterKeyReady", "masterKeyMessage", "items"])
    && typeof value.masterKeyReady === "boolean"
    && (value.masterKeyMessage === undefined || isNonEmptyString(value.masterKeyMessage))
    && Array.isArray(value.items)
    && value.items.length <= 1_000
    && value.items.every(isAdminMcpSecretMetadata)
    && new Set(value.items.map((item) => item.secretRef)).size === value.items.length;
}

export function isAdminMcpSecretMutationResponse(value: unknown): value is AdminMcpSecretMutationResponse {
  return isRecord(value)
    && hasExactKeys(value, ["ok", "item"])
    && value.ok === true
    && isAdminMcpSecretMetadata(value.item);
}

export function isAdminMcpDiscoveryResponse(value: unknown): value is AdminMcpDiscoveryResponse {
  if (!isRecord(value)
    || !hasExactKeys(value, ["serverId", "tools", "rejected"])
    || !isCapabilityId(value.serverId, 80)
    || !Array.isArray(value.tools)
    || value.tools.length > 200
    || !isNonNegativeInteger(value.rejected)) {
    return false;
  }
  const serverId = value.serverId;
  if (!value.tools.every((tool) => isAdminMcpDiscoveredTool(tool, serverId))) return false;
  return new Set(value.tools.map((tool) => tool.id)).size === value.tools.length;
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

export function isAdminOperationsStats(value: unknown): value is AdminOperationsStats {
  if (!isRecord(value)
    || !hasExactKeys(value, ["day", "days", "totals", "trend", "routeStats", "users", "routes", "configSource", "accessCodeSource"])
    || !isDayString(value.day)
    || !isDayArray(value.days)) {
    return false;
  }
  const days = value.days;
  if (days.length < 1
    || days.length > 31
    || days[0] !== value.day
    || !isAdminOperationsTotals(value.totals)
    || !Array.isArray(value.trend)
    || value.trend.length !== days.length
    || !value.trend.every(isAdminOperationsTrendPoint)
    || !sameStringOrder(days, value.trend.map((item) => item.day))
    || !Array.isArray(value.routeStats)
    || value.routeStats.length > 500
    || !value.routeStats.every((item) => isAdminOperationsRouteStats(item, days))
    || !Array.isArray(value.users)
    || value.users.length > 1_000
    || !value.users.every((item) => isAdminOperationsUserStats(item, days))
    || !Array.isArray(value.routes)
    || value.routes.length > 500
    || !value.routes.every(isAdminOperationsRoute)
    || (value.configSource !== "kv" && value.configSource !== "secret" && value.configSource !== "default")
    || (value.accessCodeSource !== "kv" && value.accessCodeSource !== "secret" && value.accessCodeSource !== "managed")) {
    return false;
  }
  const routeIds = value.routeStats.map((route) => route.id);
  const configuredRouteIds = value.routes.map((route) => route.id);
  const userLabels = value.users.map((user) => user.label);
  return new Set(routeIds).size === routeIds.length
    && new Set(configuredRouteIds).size === configuredRouteIds.length
    && sameStringOrder(routeIds, configuredRouteIds)
    && new Set(userLabels).size === userLabels.length
    && value.totals.requests === sumBy(value.trend, (item) => item.requests)
    && value.totals.errors === sumBy(value.trend, (item) => item.errors)
    && value.totals.fallbacks === sumBy(value.trend, (item) => item.fallbacks)
    && value.totals.rateLimited === sumBy(value.trend, (item) => item.rateLimited);
}

export function isAdminAuditSnapshot(value: unknown): value is { entries: AdminAuditEntry[] } {
  if (!isRecord(value)
    || !hasExactKeys(value, ["entries"])
    || !Array.isArray(value.entries)
    || value.entries.length > 100
    || !value.entries.every(isAdminAuditEntry)) {
    return false;
  }
  return new Set(value.entries.map((entry) => entry.id)).size === value.entries.length;
}

export function isAdminFeedbackSnapshot(value: unknown): value is { entries: AdminFeedbackEntry[] } {
  if (!isRecord(value)
    || !hasExactKeys(value, ["entries"])
    || !Array.isArray(value.entries)
    || value.entries.length > 100
    || !value.entries.every(isAdminFeedbackEntry)) {
    return false;
  }
  return new Set(value.entries.map((entry) => entry.id)).size === value.entries.length;
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

export function isAdminUsageResetResponse(value: unknown): value is AdminUsageResetResponse {
  return isRecord(value)
    && hasExactKeys(value, ["ok", "label", "day"])
    && value.ok === true
    && isNonEmptyString(value.label)
    && isDayString(value.day);
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
  const publicAccess = value.publicAccess;
  const skills = value.skills;
  const tools = value.tools;
  const mcpServers = value.mcpServers;
  if (!isRegistry(routes, isAdminRouteConfig) || Object.keys(routes).length === 0) return false;
  const routeIds = new Set(Object.keys(routes));
  if (!Object.values(routes).some((route) => route.enabled !== false)) return false;
  if (!isRegistry(providers, isSanitizedAdminProviderConfig)) return false;
  if (!isRegistry(users, isAdminUserConfig) || !isAdminUserConfig(defaults) || !isAdminPublicAccessConfig(publicAccess)) return false;
  if (!isRegistry(skills, isAdminSkillConfig) || !isRegistry(tools, isAdminToolConfig)) return false;
  if (!isRegistry(mcpServers, isAdminMcpServerConfig)) return false;
  const skillRegistryIds = Object.keys(skills);
  const toolRegistryIds = Object.keys(tools);
  const mcpServerIds = Object.keys(mcpServers);
  if (skillRegistryIds.length > 50
    || toolRegistryIds.length > 200
    || mcpServerIds.length > 20
    || !skillRegistryIds.every((id) => isCapabilityId(id, 80))
    || !toolRegistryIds.every((id) => isCapabilityId(id, 160))
    || !mcpServerIds.every((id) => isCapabilityId(id, 80))) {
    return false;
  }
  if (publicAccess.enabled) {
    const publicRoute = routes[publicAccess.routeId];
    if (!publicRoute || publicRoute.enabled === false) return false;
  }

  for (const route of Object.values(routes)) {
    const providerIds = route.offerings?.map((offering) => offering.providerId) || [];
    if (new Set(providerIds).size !== providerIds.length || providerIds.some((id) => !hasOwn(providers, id))) return false;
    if (route.fallbacks?.some((id) => !routeIds.has(id))) return false;
  }

  const skillIds = new Set(Object.keys(skills));
  const toolIds = new Set(Object.keys(tools));
  const mcpIds = new Set(Object.keys(mcpServers));
  const assignments = [defaults, ...Object.values(users)];
  if (assignments.some((assignment) => (
    (assignment.defaultRoute !== undefined && !routeIds.has(assignment.defaultRoute))
    || assignment.allowedRoutes?.some((id) => !routeIds.has(id))
    || assignment.allowedSkills?.some((id) => !skillIds.has(id))
    || assignment.allowedTools?.some((id) => !toolIds.has(id))
  ))) return false;
  if (!Object.values(skills).every((skill) => skill.toolIds.every((id) => toolIds.has(id)))) return false;
  return Object.entries(tools).every(([id, tool]) => (
    tool.executor.type === "builtin"
      ? id === "builtin:text_stats"
      : mcpIds.has(tool.executor.serverId)
        && id === `mcp:${tool.executor.serverId}:${tool.executor.remoteName}`
  ));
}

export function isAgentConversation(value: unknown): value is AgentConversation {
  return isRecord(value)
    && hasExactKeys(value, [
      "id",
      "title",
      "createdAt",
      "updatedAt",
      "summary",
      "pinned",
      "skillIds",
      "messageCount",
      "workspaceFiles",
      ...(value.routeId === undefined ? [] : ["routeId"]),
      ...(value.parentChatId === undefined ? [] : ["parentChatId"]),
    ])
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
    && isNonNegativeInteger(value.messageCount)
    && Array.isArray(value.workspaceFiles)
    && value.workspaceFiles.length <= 10
    && value.workspaceFiles.every(isWorkspaceConversationFileRef);
}

export function isWorkspaceFileVersion(value: unknown): value is WorkspaceFileVersion {
  return isRecord(value)
    && hasExactKeys(value, ["id", "fileId", "size", "mediaType", "checksum", "state", "createdAt"])
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.fileId)
    && isNonNegativeInteger(value.size)
    && isNonEmptyString(value.mediaType)
    && /^[0-9a-f]{64}$/u.test(typeof value.checksum === "string" ? value.checksum : "")
    && (value.state === "pending" || value.state === "ready" || value.state === "failed" || value.state === "deleting")
    && isNonNegativeInteger(value.createdAt);
}

export function isWorkspaceFile(value: unknown): value is WorkspaceFile {
  return isRecord(value)
    && hasExactKeys(value, [
      "id",
      "path",
      "name",
      "pinned",
      "state",
      "createdAt",
      "updatedAt",
      "retryAvailable",
      ...(value.currentVersion === undefined ? [] : ["currentVersion"]),
    ])
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.path)
    && isNonEmptyString(value.name)
    && typeof value.pinned === "boolean"
    && (value.state === "uploading" || value.state === "ready" || value.state === "failed"
      || value.state === "deleting" || value.state === "deleted")
    && isNonNegativeInteger(value.createdAt)
    && isNonNegativeInteger(value.updatedAt)
    && value.updatedAt >= value.createdAt
    && (value.currentVersion === undefined || isWorkspaceFileVersion(value.currentVersion))
    && typeof value.retryAvailable === "boolean";
}

function isWorkspaceConversationFileRef(value: unknown): value is WorkspaceConversationFileRef {
  return isRecord(value)
    && hasExactKeys(value, ["fileId", "versionId", "path", "name", "size", "mediaType", "checksum"])
    && isNonEmptyString(value.fileId)
    && isNonEmptyString(value.versionId)
    && isNonEmptyString(value.path)
    && isNonEmptyString(value.name)
    && isNonNegativeInteger(value.size)
    && isNonEmptyString(value.mediaType)
    && /^[0-9a-f]{64}$/u.test(typeof value.checksum === "string" ? value.checksum : "");
}

function isWorkspaceFilePage(value: unknown): value is WorkspaceFilePage {
  return isRecord(value)
    && hasExactKeys(value, ["files", "maxFileBytes", ...(value.nextCursor === undefined ? [] : ["nextCursor"])])
    && Array.isArray(value.files)
    && value.files.every(isWorkspaceFile)
    && (value.nextCursor === undefined || typeof value.nextCursor === "string")
    && isPositiveInteger(value.maxFileBytes);
}

function isWorkspaceFileVersions(value: unknown): value is WorkspaceFileVersions {
  return isRecord(value)
    && hasExactKeys(value, ["file", "versions"])
    && isWorkspaceFile(value.file)
    && Array.isArray(value.versions)
    && value.versions.every(isWorkspaceFileVersion);
}

function isWorkspaceUploadResponse(value: unknown): value is { ok: true; file: WorkspaceFile } {
  if (!isRecord(value) || value.ok !== true || !isWorkspaceFile(value.file)) return false;
  if (value.pending === true) {
    return hasExactKeys(value, ["ok", "pending", "file", "message"])
      && isNonEmptyString(value.message);
  }
  return hasExactKeys(value, ["ok", "file", "existing"])
    && typeof value.existing === "boolean";
}

function isWorkspaceFileMutationResponse(value: unknown): value is { ok: true; file: WorkspaceFile } {
  return isRecord(value)
    && hasExactKeys(value, ["ok", "file"])
    && value.ok === true
    && isWorkspaceFile(value.file);
}

function isWorkspaceFileDeleteResponse(value: unknown): value is WorkspaceFileDeleteResult & { ok: true } {
  if (!isRecord(value) || value.ok !== true || typeof value.deleted !== "boolean") return false;
  if (value.deleted) {
    return hasExactKeys(value, ["ok", "deleted", "existing"])
      && typeof value.existing === "boolean";
  }
  return hasExactKeys(value, ["ok", "deleted", "pending", "message"])
    && value.pending === true
    && isNonEmptyString(value.message);
}

function isWorkspaceConversationMutationResponse(
  value: unknown,
): value is { ok: true; conversation: AgentConversation } {
  return isRecord(value)
    && hasExactKeys(value, ["ok", "conversation"])
    && value.ok === true
    && isAgentConversation(value.conversation);
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

function isFileInputPolicy(value: unknown): value is FileInputPolicy {
  if (!isRecord(value) || !hasExactKeys(value, [
    "acceptedMediaTypes",
    "acceptedExtensions",
    "maxFiles",
    "maxFileBytes",
    "maxTotalBytes",
    "maxExtractedChars",
  ])) return false;
  if (!Array.isArray(value.acceptedMediaTypes) || !Array.isArray(value.acceptedExtensions)) return false;
  const mediaTypes = value.acceptedMediaTypes;
  const extensions = value.acceptedExtensions;
  return mediaTypes.length > 0
    && mediaTypes.length <= 80
    && extensions.length > 0
    && extensions.length <= 120
    && new Set(mediaTypes).size === mediaTypes.length
    && new Set(extensions).size === extensions.length
    && mediaTypes.every((mediaType) => typeof mediaType === "string" && mediaType.length > 0 && mediaType.length <= 120)
    && extensions.every((extension) => (
      typeof extension === "string"
      && extension.length > 0
      && extension.length <= 40
      && (TEXT_FILE_EXTENSIONS.includes(extension as (typeof TEXT_FILE_EXTENSIONS)[number])
        || TEXT_FILE_BASENAMES.includes(extension as (typeof TEXT_FILE_BASENAMES)[number]))
    ))
    && DEFAULT_FILE_INPUT_POLICY.acceptedMediaTypes.every((mediaType) => mediaTypes.includes(mediaType))
    && isPositiveInteger(value.maxFiles)
    && isPositiveInteger(value.maxFileBytes)
    && isPositiveInteger(value.maxTotalBytes)
    && isPositiveInteger(value.maxExtractedChars)
    && value.maxFiles <= DEFAULT_FILE_INPUT_POLICY.maxFiles
    && value.maxFileBytes <= DEFAULT_FILE_INPUT_POLICY.maxFileBytes
    && value.maxTotalBytes <= DEFAULT_FILE_INPUT_POLICY.maxTotalBytes
    && value.maxExtractedChars <= DEFAULT_FILE_INPUT_POLICY.maxExtractedChars;
}

function isSessionCapabilities(value: unknown): value is SessionProjection["capabilities"] {
  return isRecord(value)
    && hasExactKeys(value, ["imageInput", "fileInput", "memory", "messageActions", "feedback", "accountData"])
    && typeof value.imageInput === "boolean"
    && typeof value.fileInput === "boolean"
    && typeof value.memory === "boolean"
    && typeof value.messageActions === "boolean"
    && typeof value.feedback === "boolean"
    && typeof value.accountData === "boolean";
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
  return isAgentConversation({ ...summary, workspaceFiles: [] })
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

function isAdminPublicAccessConfig(value: unknown): value is AdminPublicAccessConfig {
  return isRecord(value)
    && hasExactKeys(value, [
      "enabled",
      "routeId",
      "sessionTtlSeconds",
      "dailyMessageLimit",
      "minuteMessageLimit",
      "sourceDailyMessageLimit",
      "sourceMinuteMessageLimit",
    ])
    && typeof value.enabled === "boolean"
    && typeof value.routeId === "string"
    && isBoundedInteger(value.sessionTtlSeconds, 900, 7 * 86_400)
    && isBoundedInteger(value.dailyMessageLimit, 1, 1_000)
    && isBoundedInteger(value.minuteMessageLimit, 1, 60)
    && isBoundedInteger(value.sourceDailyMessageLimit, 1, 10_000)
    && isBoundedInteger(value.sourceMinuteMessageLimit, 1, 600);
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

function isAdminMcpSecretMetadata(value: unknown): value is AdminMcpSecretMetadata {
  return isRecord(value)
    && !hasForbiddenSecretField(value)
    && hasOnlyKeys(value, [
      "secretRef",
      "source",
      "status",
      "managed",
      "environmentFallback",
      "updatedAt",
      "revision",
      "message",
    ])
    && isRouteSecretRef(value.secretRef)
    && (value.source === "managed" || value.source === "worker" || value.source === "missing")
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

function isAdminOperationsTotals(value: unknown): value is AdminOperationsStats["totals"] {
  return isRecord(value)
    && hasExactKeys(value, ["requests", "errors", "fallbacks", "rateLimited", "errorRate"])
    && isMetricCount(value.requests)
    && isMetricCount(value.errors)
    && value.errors <= value.requests
    && isMetricCount(value.fallbacks)
    && value.fallbacks <= value.requests
    && isMetricCount(value.rateLimited)
    && isPercentage(value.errorRate)
    && value.errorRate === metricRate(value.errors, value.requests);
}

function isAdminOperationsTrendPoint(value: unknown): value is AdminOperationsTrendPoint {
  return isRecord(value)
    && hasExactKeys(value, ["day", "requests", "errors", "fallbacks", "rateLimited", "errorRate"])
    && isDayString(value.day)
    && isMetricCount(value.requests)
    && isMetricCount(value.errors)
    && value.errors <= value.requests
    && isMetricCount(value.fallbacks)
    && value.fallbacks <= value.requests
    && isMetricCount(value.rateLimited)
    && isPercentage(value.errorRate)
    && value.errorRate === metricRate(value.errors, value.requests);
}

function isAdminOperationsRouteStats(value: unknown, days: string[]): value is AdminOperationsRouteStats {
  if (!isRecord(value)
    || !hasExactKeys(value, ["id", "label", "model", "ok7d", "error7d", "errorRate7d", "days"])
    || !isNonEmptyString(value.id)
    || !isNonEmptyString(value.label)
    || typeof value.model !== "string"
    || !isMetricCount(value.ok7d)
    || !isMetricCount(value.error7d)
    || !isPercentage(value.errorRate7d)
    || !Array.isArray(value.days)
    || value.days.length !== days.length
    || !value.days.every(isAdminOperationsRouteDay)) {
    return false;
  }
  const ok7d = sumBy(value.days, (item) => item.ok);
  const error7d = sumBy(value.days, (item) => item.error);
  return sameStringOrder(days, value.days.map((item) => item.day))
    && value.ok7d === ok7d
    && value.error7d === error7d
    && value.errorRate7d === metricRate(error7d, ok7d + error7d);
}

function isAdminOperationsRouteDay(value: unknown): value is AdminOperationsRouteStats["days"][number] {
  return isRecord(value)
    && hasExactKeys(value, ["day", "ok", "error"])
    && isDayString(value.day)
    && isMetricCount(value.ok)
    && isMetricCount(value.error);
}

function isAdminOperationsUserStats(value: unknown, days: string[]): value is AdminOperationsUserStats {
  if (!isRecord(value)
    || !hasExactKeys(value, [
      "label", "enabled", "displayName", "used", "dailyLimit", "remaining", "defaultRoute", "allowedRoutes",
      "allowBringYourOwnKey", "hasSystemPrompt", "systemPromptChars", "activeSessions", "memoryChars",
      "requests7d", "errors7d", "errorRate7d", "usageByDay",
    ])
    || !isNonEmptyString(value.label)
    || typeof value.enabled !== "boolean"
    || !isNonEmptyString(value.displayName)
    || !isMetricCount(value.used)
    || !isPositiveInteger(value.dailyLimit)
    || !isMetricCount(value.remaining)
    || value.remaining !== Math.max(0, value.dailyLimit - value.used)
    || typeof value.defaultRoute !== "string"
    || !isUniqueStringIdArray(value.allowedRoutes)
    || typeof value.allowBringYourOwnKey !== "boolean"
    || typeof value.hasSystemPrompt !== "boolean"
    || !isMetricCount(value.systemPromptChars)
    || value.hasSystemPrompt !== (value.systemPromptChars > 0)
    || !isMetricCount(value.activeSessions)
    || !isMetricCount(value.memoryChars)
    || !isMetricCount(value.requests7d)
    || !isMetricCount(value.errors7d)
    || value.errors7d > value.requests7d
    || !isPercentage(value.errorRate7d)
    || !Array.isArray(value.usageByDay)
    || value.usageByDay.length !== days.length
    || !value.usageByDay.every(isAdminOperationsUsageDay)
    || !sameStringOrder(days, value.usageByDay.map((item) => item.day))) {
    return false;
  }
  return value.used === value.usageByDay[0]?.used
    && value.requests7d === sumBy(value.usageByDay, (item) => item.used)
    && value.errorRate7d === metricRate(value.errors7d, value.requests7d);
}

function isAdminOperationsUsageDay(value: unknown): value is AdminOperationsUserStats["usageByDay"][number] {
  return isRecord(value)
    && hasExactKeys(value, ["day", "used"])
    && isDayString(value.day)
    && isMetricCount(value.used);
}

function isAdminOperationsRoute(value: unknown): value is AdminOperationsStats["routes"][number] {
  return isRecord(value)
    && !hasForbiddenSecretField(value)
    && hasOnlyKeys(value, ["id", "enabled", "label", "type", "model", "baseUrl", "apiKeyRef", "requiresUserKey", "supportsImages"])
    && isNonEmptyString(value.id)
    && typeof value.enabled === "boolean"
    && typeof value.label === "string"
    && (value.type === undefined || value.type === "openai-chat" || value.type === "anthropic-messages")
    && (value.model === undefined || typeof value.model === "string")
    && (value.baseUrl === undefined || isSafeHttpUrl(value.baseUrl))
    && (value.apiKeyRef === "" || isRouteSecretRef(value.apiKeyRef))
    && typeof value.requiresUserKey === "boolean"
    && typeof value.supportsImages === "boolean";
}

function isAdminAuditEntry(value: unknown): value is AdminAuditEntry {
  return isRecord(value)
    && !hasForbiddenSecretField(value)
    && hasOnlyKeys(value, ["id", "action", "target", "at"])
    && isBoundedText(value.id, 100, false)
    && isBoundedText(value.action, 100, false)
    && (value.target === undefined || isBoundedText(value.target, 100, false))
    && isIsoDate(value.at);
}

function isAdminFeedbackEntry(value: unknown): value is AdminFeedbackEntry {
  const reasons = new Set(["inaccurate", "misunderstood", "verbose", "format", "other"]);
  return isRecord(value)
    && !hasForbiddenSecretField(value)
    && hasOnlyKeys(value, ["id", "label", "rating", "reason", "routeId", "chatId", "messageId", "at"])
    && isBoundedText(value.id, 512, false)
    && isBoundedText(value.label, 160, false)
    && (value.rating === "up" || value.rating === "down")
    && (
      value.rating === "up"
        ? value.reason === undefined || value.reason === ""
        : typeof value.reason === "string" && reasons.has(value.reason)
    )
    && isBoundedText(value.routeId, 100, false)
    && isBoundedText(value.chatId, 100, false)
    && isBoundedText(value.messageId, 100, false)
    && isIsoDate(value.at);
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
    && hasOnlyKeys(value, ["enabled", "label", "description", "instructions", "toolIds", "order"])
    && typeof value.enabled === "boolean"
    && isBoundedText(value.label, 80, false)
    && (value.description === undefined || isBoundedText(value.description, 500, true))
    && isBoundedText(value.instructions, 8_000, false)
    && isUniqueCapabilityIdArray(value.toolIds, 160, 200)
    && (value.order === undefined || (typeof value.order === "number" && Number.isInteger(value.order) && value.order >= -10_000 && value.order <= 10_000));
}

function isAdminToolConfig(value: unknown): value is AdminToolConfig {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ["enabled", "label", "description", "inputSchema", "confirmation", "executor", "schemaFingerprint"])
    || typeof value.enabled !== "boolean"
    || !isBoundedText(value.label, 80, false)
    || (value.description !== undefined && !isBoundedText(value.description, 1_000, true))
    || !(
      value.confirmation === "auto"
      || value.confirmation === "first-per-conversation"
      || value.confirmation === "always"
    )
    || !isRecord(value.inputSchema)
    || !isRecord(value.executor)
    || (value.schemaFingerprint !== undefined && !isSchemaFingerprint(value.schemaFingerprint))) {
    return false;
  }
  if (value.executor.type === "builtin") {
    return hasExactKeys(value.executor, ["type", "name"])
      && value.executor.name === "text_stats"
      && (value.confirmation === "auto" || value.confirmation === "always")
      && value.schemaFingerprint === undefined;
  }
  return value.executor.type === "mcp"
    && hasExactKeys(value.executor, ["type", "serverId", "remoteName"])
    && isCapabilityId(value.executor.serverId, 80)
    && isMcpRemoteName(value.executor.remoteName)
    && value.confirmation !== "auto"
    && isSchemaFingerprint(value.schemaFingerprint);
}

function isAdminMcpServerConfig(value: unknown): value is AdminMcpServerConfig {
  return isRecord(value)
    && hasOnlyKeys(value, ["enabled", "label", "endpoint", "authType", "secretRef"])
    && typeof value.enabled === "boolean"
    && isBoundedText(value.label, 80, false)
    && isSafeMcpEndpoint(value.endpoint)
    && (value.authType === "none" || value.authType === "bearer" || value.authType === "x-api-key")
    && (value.secretRef === undefined || isRouteSecretRef(value.secretRef))
    && (value.authType === "none" ? value.secretRef === undefined : value.secretRef !== undefined);
}

function isAdminMcpDiscoveredTool(value: unknown, serverId: string): value is AdminMcpDiscoveredTool {
  if (!isRecord(value)
    || !hasExactKeys(value, ["id", "label", "description", "inputSchema", "confirmation", "executor", "schemaFingerprint"])
    || !isCapabilityId(value.id, 160)
    || !isBoundedText(value.label, 80, false)
    || !isBoundedText(value.description, 1_000, true)
    || !isRecord(value.inputSchema)
    || value.confirmation !== "first-per-conversation"
    || !isSchemaFingerprint(value.schemaFingerprint)
    || !isRecord(value.executor)
    || !hasExactKeys(value.executor, ["type", "serverId", "remoteName"])
    || value.executor.type !== "mcp"
    || value.executor.serverId !== serverId
    || !isMcpRemoteName(value.executor.remoteName)) {
    return false;
  }
  return value.id === `mcp:${serverId}:${value.executor.remoteName}`;
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

async function requestFormJson(path: string, form: FormData): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      body: form,
      credentials: "include",
      headers: { "X-Chatus-Client": "web" },
      cache: "no-store",
    });
  } catch {
    throw new ApiError("network_unavailable", "网络不可用，请检查连接后重试。", 0);
  }
  const data = await readResponseData(response);
  if (!response.ok) throw apiErrorFromResponse(response, data, "文件操作失败，请稍后重试。");
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

function isCapabilityId(value: unknown, maxLength: number): value is string {
  return typeof value === "string"
    && value.length <= maxLength
    && /^[A-Za-z0-9][A-Za-z0-9:._-]*$/.test(value);
}

function isUniqueCapabilityIdArray(value: unknown, maxLength: number, maxItems: number): value is string[] {
  return Array.isArray(value)
    && value.length <= maxItems
    && value.every((item) => isCapabilityId(item, maxLength))
    && new Set(value).size === value.length;
}

function isSchemaFingerprint(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isMcpRemoteName(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
}

function isSafeMcpEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2_048) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
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

function isDayString(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isDayArray(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.every(isDayString)
    && new Set(value).size === value.length;
}

function isMetricCount(value: unknown): value is number {
  return isNonNegativeInteger(value) && value <= 1_000_000_000;
}

function isPercentage(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0 && value <= 100;
}

function isBoundedText(value: unknown, maxChars: number, allowEmpty: boolean): value is string {
  return typeof value === "string" && value.length <= maxChars && (allowEmpty || Boolean(value.trim()));
}

function sameStringOrder(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function metricRate(part: number, total: number): number {
  return total > 0 ? Number(((part / total) * 100).toFixed(1)) : 0;
}

function sumBy<T>(items: T[], select: (item: T) => number): number {
  return items.reduce((sum, item) => sum + select(item), 0);
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

function isBoundedInteger(value: unknown, minimum: number, maximum: number): value is number {
  return isNonNegativeInteger(value) && value >= minimum && value <= maximum;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
