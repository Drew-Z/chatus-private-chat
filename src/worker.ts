import { DurableObject } from "cloudflare:workers";
import { getAgentByName } from "agents";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker";
import type { JsonSchemaType } from "@modelcontextprotocol/sdk/validation";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import { generateText, type ModelMessage, type UIMessage } from "ai";
import type { TeamAgent } from "./agent/team-agent";
import {
  MAX_AGENT_CONVERSATIONS,
  type AgentExportMessage,
  type AgentConversationBranchAction,
  type AgentConversationBranchLaunch,
  type AgentConversationBranchOperation,
  type AgentConversationBranchReservationResult,
  type AgentConversationInput,
  type AgentConversationMutationResult,
  type AgentConversationSummary,
  type AgentSkillSelectionMetadata,
  type AgentSkillSelectionReason,
  type ConversationSkillMode,
  type TeamAgentProps,
} from "./contracts/agent";
import type {
  CapabilityAssignment,
  CapabilityToolExecutionResult,
  CapabilityToolRunner,
  CapabilityStreamEvent,
  McpOAuth2AuthConfig,
  McpServerConfig,
  ModelTurn,
  NormalizedToolDefinition,
  SkillConfig,
  ToolApprovalDecision,
  ToolConfig,
  ToolExecutor,
} from "./contracts/capability";
import type { ChatMessage, ChatPart, ToolEventSummary } from "./contracts/chat";
import {
  DEFAULT_IMAGE_INPUT_POLICY,
  MAX_INLINE_IMAGE_BYTES_PER_MESSAGE,
  parseDataImage,
  type ImageInputPolicy,
  type ImageValidationErrorCode,
} from "./contracts/image";
import {
  DEFAULT_FILE_INPUT_POLICY,
  MAX_INLINE_FILE_BYTES_PER_MESSAGE,
  emptyTextFileValidationState,
  parseDataTextFile,
  type FileInputPolicy,
  type FileValidationErrorCode,
} from "./contracts/file";
import type {
  ProviderConfig,
  ProviderCredential,
  ProviderType,
  ResolvedProviderRoute,
  RouteConfig,
} from "./contracts/provider";
import type { GuestSession, Session } from "./contracts/session";
import {
  MAX_WORKSPACE_FILE_BYTES,
  MAX_WORKSPACE_FILES_PER_CONVERSATION,
  MAX_WORKSPACE_LIST_LIMIT,
  normalizeWorkspaceEntityId,
  normalizeWorkspaceOperationId,
  workspaceDocumentByteLimit,
  type DocumentIngestMessage,
  type WorkspaceDeleteReservationResult,
  type WorkspaceFileProjection,
  type WorkspaceMutationResult,
  type WorkspaceUploadReservationResult,
} from "./contracts/workspace-file";
import { DocumentIngestError, extractDocumentText } from "./services/document-ingest";
import {
  buildProviderRoutePlan,
  isTerminalProviderFailure,
  MAX_PROVIDER_CONCURRENCY,
  MAX_PROVIDER_QUEUE_TIMEOUT_MS,
  resolveProviderRouteCandidates,
  resolveProviderCredential,
  routeProviderKey,
} from "./services/provider-router";
import {
  buildCapabilityToolDefinitions,
  getPublicCapabilities,
  getSelectedSkills,
  normalizeToolConfirmation,
} from "./services/capability-registry";
import { createProviderLanguageModel, toProviderModelMessages } from "./services/provider-model";
import {
  createFallbackLanguageModel,
  type FallbackModelCandidate,
} from "./services/fallback-language-model";
import {
  isRecentRouteReliability,
  isRecentProviderRouteReliability,
  loadProviderRouteReliability,
  loadRouteReliability,
  recordRouteReliability,
  routeReliabilityMessage,
  type RouteReliabilityOutcome,
  type RouteReliabilityRecord,
} from "./services/route-reliability";
import { acquireFirstAvailableProvider, acquireProviderLease, type ProviderLease } from "./services/provider-lease";
import {
  createQuotaAdmissionService,
  type QuotaBucket,
  type QuotaUsageResult,
} from "./services/quota-admission";
import {
  createManagedSecretService,
  managedSecretPrefix,
  ManagedSecretError,
  MANAGED_SECRET_REF_PATTERN,
  MAX_MANAGED_SECRET_CHARS,
  type ManagedSecretMetadata,
} from "./services/managed-secrets";
import {
  createMcpRuntime,
  isForbiddenMcpUrl,
  isValidMcpEndpoint,
  MCP_REMOTE_NAME_PATTERN,
  McpRuntimeError,
  normalizeMcpToolSchema,
  type McpDiscoveredTool,
  type McpDiscoveryResult,
  type McpRuntimeExecution,
} from "./services/mcp-runtime";
import {
  buildMcpOAuthAuthorizationUrl,
  createMcpOAuthPkce,
  decryptMcpOAuthToken,
  discoverMcpOAuthMetadata,
  encryptMcpOAuthToken,
  exchangeMcpOAuthCode,
  hasRequiredOAuthScopes,
  MCP_OAUTH_CALLBACK_PATH,
  MCP_OAUTH_STATE_TTL_MS,
  McpOAuthError,
  isSafeOAuthIssuer,
  normalizeEncryptedMcpOAuthToken,
  normalizeOAuthScopes,
  refreshMcpOAuthToken,
  type EncryptedMcpOAuthToken,
  type McpOAuthTokenSet,
} from "./services/mcp-oauth";
import {
  appendProviderToolResults,
  appendProviderTurn,
  buildHeaders,
  callProviderToolTurn,
  clampNumber,
  createProviderToolHistory,
  DEFAULT_ANTHROPIC_VERSION,
  formatUpstreamErrorMessage,
  ProviderToolError,
  setAuthHeader,
  type ProviderToolExecutionResult,
  type ProviderToolHistory,
} from "./services/provider-tool-runtime";
import { createProviderPlanRuntime } from "./services/provider-plan-runtime";
import {
  callProviderStream,
  UpstreamRequestError,
} from "./services/provider-stream-runtime";
import {
  createFeedbackAuditService,
  isDownFeedbackReason,
  type FeedbackReason,
} from "./services/feedback-audit";
import type { ProviderCoordinator } from "./provider-coordinator";

export type { ChatMessage } from "./contracts/chat";
export type { Session } from "./contracts/session";

type AdminSession = {
  createdAt: number;
  lastSeen: number;
  tokenFingerprint: string;
};

type AccessEntry = {
  label: string;
  code: string;
};

type AdminMemberProjection = {
  label: string;
  displayName: string;
  configured: boolean;
  hasAccessCode: boolean;
};

type AccessCodeSnapshot = {
  accessCodes: string;
  source: "kv" | "secret" | "managed";
  entries: AccessEntry[];
  revision: string;
};

type AdminSetupStepStatus = "ready" | "incomplete" | "blocked" | "not_run" | "stale";

type AdminSetupStepProjection = {
  ready: boolean;
  status: AdminSetupStepStatus;
  count: number;
};

type AdminSetupStatusProjection = {
  ready: boolean;
  configSource: "kv" | "secret" | "default";
  steps: {
    health: AdminSetupStepProjection;
    provider: AdminSetupStepProjection;
    model: AdminSetupStepProjection;
    member: AdminSetupStepProjection;
    permission: AdminSetupStepProjection;
    smoke: AdminSetupStepProjection;
  };
};

type CapabilityChatRpcArgs = Omit<CapabilityChatArgs, "env" | "requestSignal"> & { chatId: string };

type PendingToolApproval = {
  callId: string;
  trustKey: string;
  allowConversation: boolean;
  resolve: (decision: ToolApprovalDecision) => void;
  reject: (error: CapabilityError) => void;
  timer: ReturnType<typeof setTimeout>;
};

type ActiveCapabilityRun = {
  chatId: string;
  controller: AbortController;
  pendingApproval?: PendingToolApproval;
};

type UserConfig = CapabilityAssignment & {
  enabled?: boolean;
  displayName?: string;
  defaultRoute?: string;
  allowedRoutes?: string[];
  allowBringYourOwnKey?: boolean;
  dailyMessageLimit?: number;
  minuteMessageLimit?: number;
  blockedPrompts?: string[];
  systemPrompt?: string;
};

type AppConfig = {
  routes: Record<string, RouteConfig>;
  providers: Record<string, ProviderConfig>;
  users?: Record<string, UserConfig>;
  defaults?: UserConfig;
  publicAccess: PublicAccessConfig;
  skills?: Record<string, SkillConfig>;
  tools?: Record<string, ToolConfig>;
  mcpServers?: Record<string, McpServerConfig>;
};

type McpToolDriftEntry = {
  reviewRevision: string;
  observedAt: string;
};

type McpToolDriftOverlay = {
  version: 1;
  tools: Record<string, McpToolDriftEntry>;
};

type PublicAccessConfig = {
  enabled: boolean;
  routeId: string;
  sessionTtlSeconds: number;
  dailyMessageLimit: number;
  minuteMessageLimit: number;
  sourceDailyMessageLimit: number;
  sourceMinuteMessageLimit: number;
};

type SessionCapabilities = {
  imageInput: boolean;
  fileInput: boolean;
  memory: boolean;
  messageActions: boolean;
  feedback: boolean;
  accountData: boolean;
};

type PublicRoute = {
  id: string;
  label: string;
  type: ProviderType;
  model: string;
  allowUserKey: boolean;
  requiresUserKey: boolean;
  supportsImages: boolean;
  supportsTools: boolean;
  healthStatus?: "healthy" | "unhealthy" | "unknown";
  healthCheckedAt?: string;
  healthSource?: "real_task";
  healthOutcome?: RouteReliabilityOutcome;
};

type RouteReadinessStatus = "healthy" | "unhealthy" | "unknown" | "unavailable" | "disabled";

type RouteStatusProjection = {
  routeId: string;
  status: RouteReadinessStatus;
  source: "passive";
  enabled: boolean;
  configured: boolean;
  credentialStatus: "configured" | "user_key_required" | "missing" | "unavailable";
  model: string;
  type: ProviderType;
  message: string;
  reliability: RouteReliabilityRecord | null;
  checkedAt?: string;
  latencyMs?: number;
};

type AdminReliabilityRouteProjection = {
  routeId: string;
  model: string;
  enabled: boolean;
  attempts: number;
  successes: number;
  averageLatencyMs: number;
  lastOutcome?: RouteReliabilityOutcome;
  observedAt?: string;
  lastFallback?: boolean;
  fallbackCount?: number;
  streamSamples?: number;
  progressiveSamples?: number;
  averageFirstVisibleLatencyMs?: number;
  lastFirstVisibleLatencyMs?: number;
  lastStreamShape?: "progressive" | "single_chunk";
};

type AdminReliabilityProviderProjection = {
  providerId: string;
  label: string;
  enabled: boolean;
  credentialStatus: "configured" | "missing" | "unavailable" | "user_key_required";
  concurrency: "unlimited" | "exclusive" | "bounded";
  maxConcurrent?: number;
  queueTimeoutMs: number;
  routes: AdminReliabilityRouteProjection[];
};

type RouteAccess = {
  routes: PublicRoute[];
  defaultRoute: string;
  user: UserConfig;
  publicAccess?: PublicAccessConfig;
};

type RouteSecretSource = "managed" | "worker" | "legacy" | "missing";

type RouteSecretMetadata = Omit<ManagedSecretMetadata, "namespace" | "ref" | "source"> & {
  apiKeyRef: string;
  source: RouteSecretSource;
};

type McpSecretMetadata = Omit<ManagedSecretMetadata, "namespace" | "ref"> & { secretRef: string };

export type Env = {
  ASSETS: Fetcher;
  CHAT_STORE: KVNamespace;
  WORKSPACE_FILES: R2Bucket;
  DOCUMENT_INGEST: Queue<DocumentIngestMessage>;
  USER_STATE: DurableObjectNamespace<UserState>;
  TEAM_AGENT: DurableObjectNamespace<TeamAgent>;
  PROVIDER_COORDINATOR: DurableObjectNamespace<ProviderCoordinator>;
  ACCESS_CODES?: string;
  ACCESS_CODES_MODE?: string;
  ROUTES_CONFIG?: string;
  SYSTEM_PROMPT?: string;
  UPSTREAM_BASE_URL?: string;
  UPSTREAM_API_KEY?: string;
  MODEL_NAME?: string;
  DAILY_MESSAGE_LIMIT?: string;
  MINUTE_MESSAGE_LIMIT?: string;
  MAX_TEXT_CHARS?: string;
  MAX_IMAGE_BYTES?: string;
  MAX_IMAGES_PER_REQUEST?: string;
  MAX_TOTAL_IMAGE_BYTES?: string;
  MAX_FILES_PER_REQUEST?: string;
  MAX_FILE_BYTES?: string;
  MAX_TOTAL_FILE_BYTES?: string;
  MAX_FILE_CHARS?: string;
  MAX_MEMORY_CHARS?: string;
  MAX_SUMMARY_CHARS?: string;
  MAX_CONTEXT_CHARS?: string;
  SESSION_TTL_SECONDS?: string;
  DEFAULT_MAX_TOKENS?: string;
  DEFAULT_CLIENT?: string;
  DOCUMENT_INGEST_QUEUE_NAME?: string;
  DOCUMENT_INGEST_DLQ_NAME?: string;
  BLOCKED_PROMPTS?: string;
  ADMIN_TOKEN?: string;
  ROUTE_KEYS_MASTER_KEY?: string;
  [key: string]: unknown;
};

const SESSION_COOKIE = "chatus_session";
const ADMIN_COOKIE = "chatus_admin";
const MAX_MESSAGES = 40;
const MAX_REQUEST_BYTES = 7_000_000;
const DEFAULT_DAILY_LIMIT = 500;
const DEFAULT_MINUTE_LIMIT = 12;
const DEFAULT_MEMORY_CHARS = 4_000;
const DEFAULT_SUMMARY_CHARS = 1_200;
const DEFAULT_CONTEXT_CHARS = 14_000;
const DEFAULT_USER_SYSTEM_PROMPT_CHARS = 2_000;
const METRICS_DAYS = 7;
const MAX_CLOUD_SESSIONS = 30;
const MAX_CLOUD_MESSAGES = 120;
const MAX_CLOUD_SESSION_BYTES = 1_800_000;
const MAX_USER_DATA_EXPORT_BYTES = 5_000_000;
const MAX_USER_DATA_EXPORT_CONVERSATION_BYTES = 512_000;
const USER_DATA_EXPORT_ITEM_HEADROOM_BYTES = 4_096;
const AGENT_LEGACY_MIGRATION_ID = "legacy-user-state-v1";
const ADMIN_SESSION_TTL_SECONDS = 604_800;
const BLOCKED_PROMPT_MESSAGE = "不要用这种方式测活，必须使用一个小任务之类的";
const ROUTES_CONFIG_KEY = "config:routes_config";
const ACCESS_CODES_KEY = "config:access_codes";
const SETUP_SMOKE_KEY = "config:setup_smoke";
const MCP_TOOL_DRIFT_KEY = "config:mcp_tool_drift";
const MAX_SKILLS = 50;
const MAX_TOOLS = 200;
const MAX_MCP_SERVERS = 20;
const MCP_OAUTH_CANDIDATE_TTL_MS = 30 * 60 * 1_000;
const MAX_MCP_OAUTH_CANDIDATE_BYTES = 2_000_000;
const MAX_SELECTED_SKILLS = 3;
const SKILL_SELECTOR_DEADLINE_MS = 5_000;
const SKILL_SELECTOR_MAX_OUTPUT_TOKENS = 200;
const SKILL_SELECTOR_MAX_PROMPT_CHARS = 6_000;
const MAX_SKILL_INSTRUCTIONS_CHARS = 8_000;
const MAX_TOOL_EVENTS = 16;
const MAX_TOOL_ARGUMENT_SUMMARY_CHARS = 500;
const MAX_TOOL_RESULT_PREVIEW_CHARS = 2_000;
const CAPABILITY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._-]*$/;
const PROVIDER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const MEMBER_LABEL_PATTERN = /^[A-Za-z0-9._-]{1,80}$/;
const GUEST_LABEL_PREFIX = "guest-";
const GUEST_SOURCE_PREFIX = "guest-source:";
const GUEST_CLEANUP_PREFIX = "guest-cleanup:";
const DEFAULT_PUBLIC_SESSION_TTL_SECONDS = 86_400;
const DEFAULT_GUEST_DAILY_LIMIT = 20;
const DEFAULT_GUEST_MINUTE_LIMIT = 6;
const DEFAULT_GUEST_SOURCE_DAILY_LIMIT = 200;
const DEFAULT_GUEST_SOURCE_MINUTE_LIMIT = 30;
const MAX_PUBLIC_SESSION_TTL_SECONDS = 7 * 86_400;
const GUEST_CLEANUP_BATCH_SIZE = 10;
const MAX_GUEST_DAILY_LIMIT = 1_000;
const MAX_GUEST_MINUTE_LIMIT = 60;
const MAX_GUEST_SOURCE_DAILY_LIMIT = 10_000;
const MAX_GUEST_SOURCE_MINUTE_LIMIT = 600;
const GUEST_TURN_LEASE_MS = 10 * 60_000;
const MAX_TOOL_ROUNDS = 4;
const MAX_TOOL_CALLS = 8;
const TOOL_CALL_TIMEOUT_MS = 15_000;
const TOOL_TOTAL_BUDGET_MS = 45_000;
const MAX_PENDING_MCP_OAUTH_STATES = 8;
const MCP_OAUTH_REFRESH_SKEW_MS = 60_000;
const WORKSPACE_PENDING_UPLOAD_MISSING_OBJECT_TIMEOUT_MS = 60_000;
const MAX_TOOL_RESULT_BYTES = 32 * 1024;
const TOOL_SCHEMA_VALIDATOR = new CfWorkerJsonSchemaValidator({ draft: "2020-12", shortcircuit: false });

class CapabilityError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "CapabilityError";
  }
}

type ChatMetric = {
  kind: "success" | "failure" | "route_error" | "rate_limited";
  routeId?: string;
  fallback?: boolean;
  now?: number;
};

type StoredChat = CloudChat & { serializedBytes: number };

type UserStats = {
  usage: Record<string, number>;
  metrics: Array<{ day: string; kind: string; routeId: string; count: number }>;
};

type McpOAuthStateInput = {
  ownerLabel: string;
  state: string;
  sessionFingerprint: string;
  serverId: string;
  configRevision: string;
  verifier: string;
  callbackUrl: string;
  expiresAt: number;
  nowMs?: number;
};

type ConsumedMcpOAuthState = {
  serverId: string;
  configRevision: string;
  verifier: string;
  callbackUrl: string;
};

type McpOAuthConnectionProjection = {
  serverId: string;
  connected: boolean;
  reviewRequired: boolean;
  grantedScopes: string[];
  expiresAt?: number;
  status: "connected" | "expired" | "review_required" | "disconnected";
};

type PublicMcpOAuthConnection = McpOAuthConnectionProjection & { label: string };

type McpOAuthDiscoveryCandidateProjection = {
  candidateId: string;
  serverId: string;
  createdAt: number;
  expiresAt: number;
  tools: number;
  rejected: number;
};

type StoredMcpOAuthDiscoveryCandidateRow = {
  candidate_id: string;
  config_revision: string;
  discovery_json: string;
  created_at: number;
  expires_at: number;
};

type StoredMcpOAuthTokenRow = {
  encrypted_record: string;
  token_expires_at: number | null;
  config_revision: string;
  granted_scopes: string;
  review_required: number;
  revision: number;
};

export class UserState extends DurableObject<Env> implements QuotaBucket {
  private readonly runtimeEnv: Env;
  private readonly activeCapabilityRuns = new Map<string, ActiveCapabilityRun>();
  private readonly conversationTrust = new Map<string, { toolIds: Set<string>; lastSeenAt: number }>();
  private readonly mcpOAuthRefreshes = new Map<string, Promise<string>>();
  private readonly mcpOAuthMutationGenerations = new Map<string, number>();
  private mcpOAuthPurgeGeneration = 0;
  private toolConfirmationTimeoutMs = 120_000;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.runtimeEnv = env;
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS usage (
          day TEXT PRIMARY KEY,
          count INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS bursts (
          minute INTEGER PRIMARY KEY,
          count INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS login_failures (
          at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS metrics (
          day TEXT NOT NULL,
          kind TEXT NOT NULL,
          route_id TEXT NOT NULL DEFAULT '',
          count INTEGER NOT NULL,
          PRIMARY KEY (day, kind, route_id)
        );
        CREATE TABLE IF NOT EXISTS chats (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          summary TEXT NOT NULL,
          summary_until INTEGER NOT NULL,
          message_count INTEGER NOT NULL,
          content TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS deleted_chats (
          id TEXT PRIMARY KEY,
          deleted_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS user_state (
          key TEXT PRIMARY KEY,
          value INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS guest_turn_lease (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          token TEXT NOT NULL,
          expires_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS mcp_oauth_owner (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          owner_label TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS mcp_oauth_states (
          state_hash TEXT PRIMARY KEY,
          session_fingerprint TEXT NOT NULL,
          server_id TEXT NOT NULL,
          config_revision TEXT NOT NULL,
          verifier TEXT NOT NULL,
          callback_url TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS mcp_oauth_tokens (
          server_id TEXT PRIMARY KEY,
          encrypted_record TEXT NOT NULL,
          token_expires_at INTEGER,
          config_revision TEXT NOT NULL,
          granted_scopes TEXT NOT NULL,
          review_required INTEGER NOT NULL DEFAULT 0,
          revision INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS mcp_oauth_discovery_candidates (
          server_id TEXT PRIMARY KEY,
          candidate_id TEXT NOT NULL UNIQUE,
          config_revision TEXT NOT NULL,
          discovery_json TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS chats_updated_at ON chats(updated_at DESC);
        CREATE INDEX IF NOT EXISTS mcp_oauth_states_expires_at ON mcp_oauth_states(expires_at);
        CREATE INDEX IF NOT EXISTS mcp_oauth_candidates_expires_at ON mcp_oauth_discovery_candidates(expires_at);
      `);
    });
  }

  async consumeLimits(
    dailyLimit: number,
    minuteLimit: number,
    nowMs: number,
    legacyDayCount = 0,
  ): Promise<QuotaUsageResult> {
    const day = new Date(nowMs).toISOString().slice(0, 10);
    const minute = Math.floor(nowMs / 60_000);
    const sql = this.ctx.storage.sql;
    sql.exec(
      "INSERT INTO usage(day, count) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET count = MAX(count, excluded.count)",
      day,
      Math.max(0, legacyDayCount),
    );
    const dayCount = sql.exec<{ count: number }>("SELECT count FROM usage WHERE day = ?", day).one().count;
    const minuteCount =
      sql.exec<{ count: number }>("SELECT count FROM bursts WHERE minute = ?", minute).toArray()[0]?.count || 0;

    if (dayCount >= dailyLimit) {
      return { ok: false, retryAfter: secondsUntilNextUtcDay(nowMs), reset: "daily" };
    }
    if (minuteCount >= minuteLimit) {
      return { ok: false, retryAfter: Math.max(1, 60 - Math.floor((nowMs % 60_000) / 1000)), reset: "minute" };
    }

    sql.exec("UPDATE usage SET count = count + 1 WHERE day = ?", day);
    sql.exec(
      "INSERT INTO bursts(minute, count) VALUES (?, 1) ON CONFLICT(minute) DO UPDATE SET count = count + 1",
      minute,
    );
    sql.exec("DELETE FROM bursts WHERE minute < ?", minute - 2);
    sql.exec("DELETE FROM usage WHERE day < ?", utcDayStringAt(nowMs, METRICS_DAYS + 2));
    return { ok: true, remaining: Math.max(0, dailyLimit - dayCount - 1) };
  }

  async getUsage(day: string, legacyDayCount = 0): Promise<number> {
    this.ctx.storage.sql.exec(
      "INSERT INTO usage(day, count) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET count = MAX(count, excluded.count)",
      day,
      Math.max(0, legacyDayCount),
    );
    return this.ctx.storage.sql.exec<{ count: number }>("SELECT count FROM usage WHERE day = ?", day).one().count;
  }

  async refundLimits(nowMs: number): Promise<void> {
    const day = new Date(nowMs).toISOString().slice(0, 10);
    const minute = Math.floor(nowMs / 60_000);
    this.ctx.storage.sql.exec("UPDATE usage SET count = MAX(0, count - 1) WHERE day = ?", day);
    this.ctx.storage.sql.exec("UPDATE bursts SET count = MAX(0, count - 1) WHERE minute = ?", minute);
    this.ctx.storage.sql.exec("DELETE FROM usage WHERE day = ? AND count = 0", day);
    this.ctx.storage.sql.exec("DELETE FROM bursts WHERE minute = ? AND count = 0", minute);
  }

  async acquireGuestTurn(
    token: string,
    nowMs: number,
    leaseMs: number,
  ): Promise<{ ok: true } | { ok: false; retryAfter: number }> {
    this.ctx.storage.sql.exec("DELETE FROM guest_turn_lease WHERE expires_at <= ?", nowMs);
    const active = this.ctx.storage.sql
      .exec<{ expires_at: number }>("SELECT expires_at FROM guest_turn_lease WHERE singleton = 1")
      .toArray()[0];
    if (active) {
      return { ok: false, retryAfter: Math.max(1, Math.ceil((active.expires_at - nowMs) / 1_000)) };
    }
    this.ctx.storage.sql.exec(
      "INSERT INTO guest_turn_lease(singleton, token, expires_at) VALUES (1, ?, ?)",
      token,
      nowMs + leaseMs,
    );
    return { ok: true };
  }

  async releaseGuestTurn(token: string): Promise<void> {
    this.ctx.storage.sql.exec("DELETE FROM guest_turn_lease WHERE singleton = 1 AND token = ?", token);
  }

  async getLoginThrottle(nowMs: number, limit: number, windowMs: number): Promise<{ ok: boolean; retryAfter: number }> {
    const cutoff = nowMs - windowMs;
    this.ctx.storage.sql.exec("DELETE FROM login_failures WHERE at <= ?", cutoff);
    const rows = this.ctx.storage.sql.exec<{ at: number }>("SELECT at FROM login_failures ORDER BY at ASC").toArray();
    if (rows.length < limit) return { ok: true, retryAfter: 0 };
    return { ok: false, retryAfter: Math.max(1, Math.ceil((rows[0].at + windowMs - nowMs) / 1000)) };
  }

  async recordLoginFailure(nowMs: number): Promise<void> {
    this.ctx.storage.sql.exec("INSERT INTO login_failures(at) VALUES (?)", nowMs);
  }

  async clearLoginFailures(): Promise<void> {
    this.ctx.storage.sql.exec("DELETE FROM login_failures");
  }

  async healthCheck(): Promise<boolean> {
    return this.ctx.storage.sql.exec<{ ok: number }>("SELECT 1 AS ok").one().ok === 1;
  }

  async storeMcpOAuthState(args: McpOAuthStateInput): Promise<void> {
    const nowMs = args.nowMs ?? Date.now();
    requireMcpOAuthOwnerLabel(args.ownerLabel);
    requireMcpOAuthServerId(args.serverId);
    requireMcpOAuthRevision(args.configRevision);
    if (!isMcpOAuthOpaqueValue(args.state) || !isMcpOAuthOpaqueValue(args.verifier)) {
      throw new McpOAuthError("mcp_oauth_config_invalid", "OAuth PKCE 状态无效");
    }
    if (!isSecretFingerprint(args.sessionFingerprint)) {
      throw new McpOAuthError("mcp_oauth_config_invalid", "OAuth 会话绑定无效");
    }
    if (
      !Number.isSafeInteger(args.expiresAt)
      || args.expiresAt <= nowMs
      || args.expiresAt > nowMs + MCP_OAUTH_STATE_TTL_MS
      || !isSafeMcpOAuthCallbackUrl(args.callbackUrl)
    ) {
      throw new McpOAuthError("mcp_oauth_config_invalid", "OAuth callback 状态无效");
    }
    const purgeGeneration = this.mcpOAuthPurgeGeneration;
    const stateHash = await secretFingerprint(args.state);
    if (purgeGeneration !== this.mcpOAuthPurgeGeneration) {
      throw new McpOAuthError("mcp_oauth_token_unavailable", "OAuth 连接已被删除，请重新连接");
    }
    this.ctx.storage.transactionSync(() => {
      this.ensureMcpOAuthOwner(args.ownerLabel);
      this.ctx.storage.sql.exec("DELETE FROM mcp_oauth_states WHERE expires_at <= ?", nowMs);
      const count = this.ctx.storage.sql
        .exec<{ count: number }>("SELECT COUNT(*) AS count FROM mcp_oauth_states")
        .one().count;
      if (count >= MAX_PENDING_MCP_OAUTH_STATES) {
        this.ctx.storage.sql.exec(
          "DELETE FROM mcp_oauth_states WHERE state_hash IN ("+
            "SELECT state_hash FROM mcp_oauth_states ORDER BY created_at ASC LIMIT ?)",
          count - MAX_PENDING_MCP_OAUTH_STATES + 1,
        );
      }
      this.ctx.storage.sql.exec(
        "INSERT INTO mcp_oauth_states("+
          "state_hash, session_fingerprint, server_id, config_revision, verifier, callback_url, expires_at, created_at"+
          ") VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        stateHash,
        args.sessionFingerprint,
        args.serverId,
        args.configRevision,
        args.verifier,
        args.callbackUrl,
        args.expiresAt,
        nowMs,
      );
    });
  }

  async consumeMcpOAuthState(args: {
    ownerLabel: string;
    state: string;
    sessionFingerprint: string;
    nowMs?: number;
  }): Promise<ConsumedMcpOAuthState | null> {
    const nowMs = args.nowMs ?? Date.now();
    if (
      !MEMBER_LABEL_PATTERN.test(args.ownerLabel)
      || !isMcpOAuthOpaqueValue(args.state)
      || !isSecretFingerprint(args.sessionFingerprint)
    ) return null;
    const stateHash = await secretFingerprint(args.state);
    return this.ctx.storage.transactionSync(() => {
      this.ensureMcpOAuthOwner(args.ownerLabel);
      this.ctx.storage.sql.exec("DELETE FROM mcp_oauth_states WHERE expires_at <= ?", nowMs);
      const row = this.ctx.storage.sql.exec<{
        server_id: string;
        config_revision: string;
        verifier: string;
        callback_url: string;
      }>(
        "SELECT server_id, config_revision, verifier, callback_url FROM mcp_oauth_states "+
          "WHERE state_hash = ? AND session_fingerprint = ? AND expires_at > ?",
        stateHash,
        args.sessionFingerprint,
        nowMs,
      ).toArray()[0];
      if (!row) return null;
      this.ctx.storage.sql.exec("DELETE FROM mcp_oauth_states WHERE state_hash = ?", stateHash);
      return {
        serverId: row.server_id,
        configRevision: row.config_revision,
        verifier: row.verifier,
        callbackUrl: row.callback_url,
      };
    });
  }

  async storeMcpOAuthToken(args: {
    ownerLabel: string;
    serverId: string;
    auth: McpOAuth2AuthConfig;
    token: McpOAuthTokenSet;
    nowMs?: number;
  }): Promise<McpOAuthConnectionProjection> {
    const nowMs = args.nowMs ?? Date.now();
    requireMcpOAuthOwnerLabel(args.ownerLabel);
    requireMcpOAuthServerId(args.serverId);
    requireMatchingMcpOAuthToken(args.auth, args.token);
    const purgeGeneration = this.mcpOAuthPurgeGeneration;
    const encrypted = await encryptMcpOAuthToken({
      masterKey: this.runtimeEnv.ROUTE_KEYS_MASTER_KEY,
      ownerLabel: args.ownerLabel,
      serverId: args.serverId,
      token: args.token,
      nowIso: new Date(nowMs).toISOString(),
    });
    if (purgeGeneration !== this.mcpOAuthPurgeGeneration) {
      throw new McpOAuthError("mcp_oauth_token_unavailable", "OAuth 连接已被删除，请重新连接");
    }
    const reviewRequired = !hasRequiredOAuthScopes(args.token.grantedScopes, args.auth.scopes);
    this.bumpMcpOAuthMutationGeneration(args.serverId);
    this.mcpOAuthRefreshes.delete(args.serverId);
    this.ctx.storage.transactionSync(() => {
      this.ensureMcpOAuthOwner(args.ownerLabel);
      const previousRevision = this.ctx.storage.sql.exec<{ revision: number }>(
        "SELECT revision FROM mcp_oauth_tokens WHERE server_id = ?",
        args.serverId,
      ).toArray()[0]?.revision || 0;
      this.ctx.storage.sql.exec(
        "INSERT INTO mcp_oauth_tokens("+
          "server_id, encrypted_record, token_expires_at, config_revision, granted_scopes, review_required, revision, updated_at"+
          ") VALUES (?, ?, ?, ?, ?, ?, ?, ?) "+
          "ON CONFLICT(server_id) DO UPDATE SET "+
          "encrypted_record = excluded.encrypted_record, token_expires_at = excluded.token_expires_at, "+
          "config_revision = excluded.config_revision, granted_scopes = excluded.granted_scopes, "+
          "review_required = excluded.review_required, revision = excluded.revision, updated_at = excluded.updated_at",
        args.serverId,
        JSON.stringify(encrypted),
        args.token.expiresAt ?? null,
        args.auth.configRevision,
        JSON.stringify(args.token.grantedScopes),
        reviewRequired ? 1 : 0,
        previousRevision + 1,
        nowMs,
      );
      this.ctx.storage.sql.exec("DELETE FROM mcp_oauth_states WHERE server_id = ?", args.serverId);
      this.ctx.storage.sql.exec("DELETE FROM mcp_oauth_discovery_candidates WHERE server_id = ?", args.serverId);
    });
    return mcpOAuthConnectionProjection(
      args.serverId,
      args.token.grantedScopes,
      args.token.expiresAt,
      reviewRequired,
      nowMs,
    );
  }

  async getMcpOAuthConnection(args: {
    ownerLabel: string;
    serverId: string;
    auth?: McpOAuth2AuthConfig;
    nowMs?: number;
  }): Promise<McpOAuthConnectionProjection> {
    const nowMs = args.nowMs ?? Date.now();
    requireMcpOAuthOwnerLabel(args.ownerLabel);
    requireMcpOAuthServerId(args.serverId);
    this.ensureMcpOAuthOwner(args.ownerLabel);
    const row = this.readMcpOAuthTokenRow(args.serverId);
    if (!row) return disconnectedMcpOAuthConnection(args.serverId);
    const grantedScopes = parseStoredMcpOAuthScopes(row.granted_scopes);
    const configDrift = Boolean(args.auth && (
      row.config_revision !== args.auth.configRevision
      || !hasRequiredOAuthScopes(grantedScopes, args.auth.scopes)
    ));
    if (configDrift && row.review_required !== 1) {
      this.ctx.storage.sql.exec(
        "UPDATE mcp_oauth_tokens SET review_required = 1 WHERE server_id = ? AND revision = ?",
        args.serverId,
        row.revision,
      );
    }
    return mcpOAuthConnectionProjection(
      args.serverId,
      grantedScopes,
      row.token_expires_at ?? undefined,
      row.review_required === 1 || configDrift,
      nowMs,
    );
  }

  async markMcpOAuthReviewRequired(ownerLabel: string, serverId: string): Promise<void> {
    requireMcpOAuthOwnerLabel(ownerLabel);
    requireMcpOAuthServerId(serverId);
    this.ensureMcpOAuthOwner(ownerLabel);
    this.bumpMcpOAuthMutationGeneration(serverId);
    this.mcpOAuthRefreshes.delete(serverId);
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        "UPDATE mcp_oauth_tokens SET review_required = 1, revision = revision + 1 WHERE server_id = ?",
        serverId,
      );
      this.ctx.storage.sql.exec("DELETE FROM mcp_oauth_discovery_candidates WHERE server_id = ?", serverId);
    });
  }

  async revokeMcpOAuthConnection(ownerLabel: string, serverId: string): Promise<void> {
    requireMcpOAuthOwnerLabel(ownerLabel);
    requireMcpOAuthServerId(serverId);
    this.ensureMcpOAuthOwner(ownerLabel);
    this.bumpMcpOAuthMutationGeneration(serverId);
    this.mcpOAuthRefreshes.delete(serverId);
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("DELETE FROM mcp_oauth_tokens WHERE server_id = ?", serverId);
      this.ctx.storage.sql.exec("DELETE FROM mcp_oauth_states WHERE server_id = ?", serverId);
      this.ctx.storage.sql.exec("DELETE FROM mcp_oauth_discovery_candidates WHERE server_id = ?", serverId);
    });
  }

  async storeMcpOAuthDiscoveryCandidate(args: {
    ownerLabel: string;
    serverId: string;
    configRevision: string;
    discovery: McpDiscoveryResult;
    nowMs?: number;
  }): Promise<McpOAuthDiscoveryCandidateProjection> {
    const nowMs = args.nowMs ?? Date.now();
    requireMcpOAuthOwnerLabel(args.ownerLabel);
    requireMcpOAuthServerId(args.serverId);
    requireMcpOAuthRevision(args.configRevision);
    const discovery = normalizeStoredMcpOAuthDiscovery(args.discovery, args.serverId);
    if (!discovery) throw new McpOAuthError("mcp_oauth_token_invalid", "OAuth MCP 发现候选无效");
    const discoveryJson = JSON.stringify(discovery);
    if (new TextEncoder().encode(discoveryJson).byteLength > MAX_MCP_OAUTH_CANDIDATE_BYTES) {
      throw new McpOAuthError("mcp_oauth_token_invalid", "OAuth MCP 发现候选超过大小限制");
    }
    const candidateId = crypto.randomUUID();
    const expiresAt = nowMs + MCP_OAUTH_CANDIDATE_TTL_MS;
    this.ctx.storage.transactionSync(() => {
      this.requireExistingMcpOAuthOwner(args.ownerLabel);
      const token = this.readMcpOAuthTokenRow(args.serverId);
      if (!token || token.review_required === 1 || token.config_revision !== args.configRevision) {
        throw new McpOAuthError("mcp_oauth_token_unavailable", "OAuth 连接已变化，请重新连接");
      }
      this.ctx.storage.sql.exec("DELETE FROM mcp_oauth_discovery_candidates WHERE expires_at <= ?", nowMs);
      this.ctx.storage.sql.exec(
        "INSERT INTO mcp_oauth_discovery_candidates("+
          "server_id, candidate_id, config_revision, discovery_json, created_at, expires_at"+
          ") VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(server_id) DO UPDATE SET "+
          "candidate_id = excluded.candidate_id, config_revision = excluded.config_revision, "+
          "discovery_json = excluded.discovery_json, created_at = excluded.created_at, expires_at = excluded.expires_at",
        args.serverId,
        candidateId,
        args.configRevision,
        discoveryJson,
        nowMs,
        expiresAt,
      );
    });
    return {
      candidateId,
      serverId: args.serverId,
      createdAt: nowMs,
      expiresAt,
      tools: discovery.tools.length,
      rejected: discovery.rejected,
    };
  }

  async getMcpOAuthDiscoveryCandidate(args: {
    ownerLabel: string;
    serverId: string;
    configRevision: string;
    nowMs?: number;
  }): Promise<{ discoveryJson: string } | null> {
    const nowMs = args.nowMs ?? Date.now();
    requireMcpOAuthOwnerLabel(args.ownerLabel);
    requireMcpOAuthServerId(args.serverId);
    requireMcpOAuthRevision(args.configRevision);
    return this.ctx.storage.transactionSync(() => {
      this.requireExistingMcpOAuthOwner(args.ownerLabel);
      this.ctx.storage.sql.exec("DELETE FROM mcp_oauth_discovery_candidates WHERE expires_at <= ?", nowMs);
      const row = this.ctx.storage.sql.exec<StoredMcpOAuthDiscoveryCandidateRow>(
        "SELECT candidate_id, config_revision, discovery_json, created_at, expires_at "+
          "FROM mcp_oauth_discovery_candidates WHERE server_id = ?",
        args.serverId,
      ).toArray()[0];
      if (!row) return null;
      if (row.config_revision !== args.configRevision) {
        this.ctx.storage.sql.exec("DELETE FROM mcp_oauth_discovery_candidates WHERE server_id = ?", args.serverId);
        return null;
      }
      try {
        const discovery = normalizeStoredMcpOAuthDiscovery(JSON.parse(row.discovery_json), args.serverId);
        if (discovery) return { discoveryJson: JSON.stringify(discovery) };
      } catch {
        // Invalid stored candidates are removed rather than projected to administrators.
      }
      this.ctx.storage.sql.exec("DELETE FROM mcp_oauth_discovery_candidates WHERE server_id = ?", args.serverId);
      return null;
    });
  }

  async resolveMcpOAuthAccessToken(args: {
    ownerLabel: string;
    serverId: string;
    auth: McpOAuth2AuthConfig;
    nowMs?: number;
  }): Promise<string> {
    requireMcpOAuthOwnerLabel(args.ownerLabel);
    requireMcpOAuthServerId(args.serverId);
    this.ensureMcpOAuthOwner(args.ownerLabel);
    const row = this.readMcpOAuthTokenRow(args.serverId);
    if (!row) throw new McpOAuthError("mcp_oauth_token_unavailable", "OAuth 连接不存在，请重新连接");
    if (row.review_required === 1) {
      throw new McpOAuthError("mcp_oauth_review_required", "OAuth 连接需要重新审查");
    }
    const current = this.mcpOAuthRefreshes.get(args.serverId);
    if (current) return current;
    const task = this.resolveMcpOAuthAccessTokenFresh({ ...args, nowMs: args.nowMs ?? Date.now() });
    this.mcpOAuthRefreshes.set(args.serverId, task);
    try {
      return await task;
    } finally {
      if (this.mcpOAuthRefreshes.get(args.serverId) === task) this.mcpOAuthRefreshes.delete(args.serverId);
    }
  }

  async runCapabilityChat(args: CapabilityChatRpcArgs): Promise<Response> {
    this.pruneConversationTrust();
    if (this.activeCapabilityRuns.size >= 4) {
      return capabilityErrorResponse("too_many_active_runs", "当前并行工具会话过多，请稍后重试");
    }
    const chatId = normalizeCapabilityId(args.chatId, 80);
    if (!chatId) return capabilityErrorResponse("invalid_chat_id", "会话 ID 无效");
    const runId = crypto.randomUUID();
    const controller = new AbortController();
    const active: ActiveCapabilityRun = { chatId, controller };
    this.activeCapabilityRuns.set(runId, active);
    return createCapabilityChatResponse(
      { ...args, env: this.runtimeEnv },
      {
        runId,
        controller,
        requestApproval: (definition, event) => this.waitForToolApproval(runId, definition, event),
        cleanup: () => this.cleanupCapabilityRun(runId),
      },
    );
  }

  async resolveToolApproval(
    runId: string,
    callId: string,
    decision: ToolApprovalDecision,
  ): Promise<{ resolved: boolean; invalidDecision?: boolean }> {
    const active = this.activeCapabilityRuns.get(runId);
    const pending = active?.pendingApproval;
    if (!active || !pending || pending.callId !== callId) return { resolved: false };
    if (decision === "conversation" && !pending.allowConversation) {
      return { resolved: false, invalidDecision: true };
    }
    active.pendingApproval = undefined;
    clearTimeout(pending.timer);
    if (decision === "conversation") {
      const trust = this.conversationTrust.get(active.chatId) || { toolIds: new Set<string>(), lastSeenAt: Date.now() };
      trust.toolIds.add(pending.trustKey);
      trust.lastSeenAt = Date.now();
      this.conversationTrust.set(active.chatId, trust);
      this.pruneConversationTrust();
    }
    pending.resolve(decision);
    return { resolved: true };
  }

  private waitForToolApproval(
    runId: string,
    definition: NormalizedToolDefinition,
    event: ToolEventSummary,
  ): ToolApprovalDecision | Promise<ToolApprovalDecision> {
    const active = this.activeCapabilityRuns.get(runId);
    if (!active) return Promise.reject(new CapabilityError("request_cancelled", "工具会话已结束", true));
    const policy = normalizeToolConfirmation(definition.config);
    const trustKey = toolTrustKey(definition);
    const trust = this.conversationTrust.get(active.chatId);
    if (policy === "first-per-conversation" && trust?.toolIds.has(trustKey)) {
      trust.lastSeenAt = Date.now();
      return "conversation";
    }
    if (active.pendingApproval) {
      return Promise.reject(new CapabilityError("tool_execution_failed", "同一会话存在重复的待确认工具"));
    }
    return new Promise<ToolApprovalDecision>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (active.pendingApproval?.callId === event.id) active.pendingApproval = undefined;
        reject(new CapabilityError("tool_confirmation_timeout", "工具确认已超时，请重试"));
      }, this.toolConfirmationTimeoutMs);
      active.pendingApproval = {
        callId: event.id,
        trustKey,
        allowConversation: policy === "first-per-conversation",
        resolve,
        reject,
        timer,
      };
      active.controller.signal.addEventListener("abort", () => {
        if (active.pendingApproval?.callId === event.id) active.pendingApproval = undefined;
        clearTimeout(timer);
        reject(new CapabilityError("request_cancelled", "工具会话已取消", true));
      }, { once: true });
    });
  }

  private ensureMcpOAuthOwner(ownerLabel: string): void {
    this.ctx.storage.sql.exec(
      "INSERT INTO mcp_oauth_owner(singleton, owner_label) VALUES (1, ?) ON CONFLICT(singleton) DO NOTHING",
      ownerLabel,
    );
    const storedOwner = this.ctx.storage.sql
      .exec<{ owner_label: string }>("SELECT owner_label FROM mcp_oauth_owner WHERE singleton = 1")
      .one().owner_label;
    if (storedOwner !== ownerLabel) {
      throw new McpOAuthError("mcp_oauth_token_unavailable", "OAuth 连接 owner 不匹配");
    }
  }

  private requireExistingMcpOAuthOwner(ownerLabel: string): void {
    const storedOwner = this.ctx.storage.sql
      .exec<{ owner_label: string }>("SELECT owner_label FROM mcp_oauth_owner WHERE singleton = 1")
      .toArray()[0]?.owner_label;
    if (storedOwner !== ownerLabel) {
      throw new McpOAuthError("mcp_oauth_token_unavailable", "OAuth 连接 owner 不匹配");
    }
  }

  private readMcpOAuthTokenRow(serverId: string): StoredMcpOAuthTokenRow | null {
    return this.ctx.storage.sql.exec<StoredMcpOAuthTokenRow>(
      "SELECT encrypted_record, token_expires_at, config_revision, granted_scopes, review_required, revision "+
        "FROM mcp_oauth_tokens WHERE server_id = ?",
      serverId,
    ).toArray()[0] || null;
  }

  private bumpMcpOAuthMutationGeneration(serverId: string): number {
    const next = (this.mcpOAuthMutationGenerations.get(serverId) || 0) + 1;
    this.mcpOAuthMutationGenerations.set(serverId, next);
    return next;
  }

  private async resolveMcpOAuthAccessTokenFresh(args: {
    ownerLabel: string;
    serverId: string;
    auth: McpOAuth2AuthConfig;
    nowMs: number;
  }): Promise<string> {
    this.ensureMcpOAuthOwner(args.ownerLabel);
    const row = this.readMcpOAuthTokenRow(args.serverId);
    if (!row) throw new McpOAuthError("mcp_oauth_token_unavailable", "OAuth 连接不存在，请重新连接");
    if (row.review_required === 1) {
      throw new McpOAuthError("mcp_oauth_review_required", "OAuth 连接需要重新审查");
    }
    const mutationGeneration = this.mcpOAuthMutationGenerations.get(args.serverId) || 0;
    const purgeGeneration = this.mcpOAuthPurgeGeneration;
    let token: McpOAuthTokenSet;
    try {
      const encrypted = normalizeEncryptedMcpOAuthToken(JSON.parse(row.encrypted_record));
      token = await decryptMcpOAuthToken({
        masterKey: this.runtimeEnv.ROUTE_KEYS_MASTER_KEY,
        ownerLabel: args.ownerLabel,
        serverId: args.serverId,
        record: encrypted,
      });
    } catch (error) {
      if (
        mutationGeneration === (this.mcpOAuthMutationGenerations.get(args.serverId) || 0)
        && purgeGeneration === this.mcpOAuthPurgeGeneration
      ) this.deleteMcpOAuthTokenRevision(args.serverId, row.revision);
      if (error instanceof McpOAuthError) throw error;
      throw new McpOAuthError("mcp_oauth_token_unavailable", "OAuth 连接无法解密，请重新连接");
    }
    if (purgeGeneration !== this.mcpOAuthPurgeGeneration) {
      throw new McpOAuthError("mcp_oauth_token_unavailable", "OAuth 连接已被删除，请重新连接");
    }
    if (mutationGeneration !== (this.mcpOAuthMutationGenerations.get(args.serverId) || 0)) {
      return this.resolveMcpOAuthAccessTokenFresh(args);
    }

    const tokenMatchesConfig = mcpOAuthTokenMatchesAuth(args.auth, token);
    const scopesAvailable = hasRequiredOAuthScopes(token.grantedScopes, args.auth.scopes);
    if (!tokenMatchesConfig || !scopesAvailable || row.config_revision !== args.auth.configRevision) {
      this.ctx.storage.sql.exec(
        "UPDATE mcp_oauth_tokens SET review_required = 1, revision = revision + 1 "+
          "WHERE server_id = ? AND revision = ?",
        args.serverId,
        row.revision,
      );
      this.bumpMcpOAuthMutationGeneration(args.serverId);
      throw new McpOAuthError("mcp_oauth_review_required", "OAuth 配置或 scope 已变化，需要重新授权");
    }
    if (!token.expiresAt || token.expiresAt > args.nowMs + MCP_OAUTH_REFRESH_SKEW_MS) return token.accessToken;
    if (!token.refreshToken) {
      this.deleteMcpOAuthTokenRevision(args.serverId, row.revision);
      throw new McpOAuthError("mcp_oauth_token_unavailable", "OAuth token 已过期，请重新连接");
    }

    let refreshed: McpOAuthTokenSet;
    try {
      const [metadata, clientSecret] = await Promise.all([
        discoverMcpOAuthMetadata(args.auth),
        args.auth.clientSecretRef
          ? managedSecretService(this.runtimeEnv).resolve("mcp", args.auth.clientSecretRef)
          : Promise.resolve(undefined),
      ]);
      refreshed = await refreshMcpOAuthToken({
        metadata,
        auth: args.auth,
        refreshToken: token.refreshToken,
        previousScopes: token.grantedScopes,
        clientSecret: clientSecret || undefined,
        now: args.nowMs,
      });
    } catch (error) {
      if (
        error instanceof McpOAuthError
        && error.code === "mcp_oauth_invalid_grant"
        && mutationGeneration === (this.mcpOAuthMutationGenerations.get(args.serverId) || 0)
        && purgeGeneration === this.mcpOAuthPurgeGeneration
      ) this.deleteMcpOAuthTokenRevision(args.serverId, row.revision);
      throw error;
    }
    if (purgeGeneration !== this.mcpOAuthPurgeGeneration) {
      throw new McpOAuthError("mcp_oauth_token_unavailable", "OAuth 连接已被删除，请重新连接");
    }
    if (mutationGeneration !== (this.mcpOAuthMutationGenerations.get(args.serverId) || 0)) {
      return this.resolveMcpOAuthAccessTokenFresh(args);
    }

    requireMatchingMcpOAuthToken(args.auth, refreshed);
    const reviewRequired = !hasRequiredOAuthScopes(refreshed.grantedScopes, args.auth.scopes);
    const encrypted = await encryptMcpOAuthToken({
      masterKey: this.runtimeEnv.ROUTE_KEYS_MASTER_KEY,
      ownerLabel: args.ownerLabel,
      serverId: args.serverId,
      token: refreshed,
      nowIso: new Date(args.nowMs).toISOString(),
    });
    if (purgeGeneration !== this.mcpOAuthPurgeGeneration) {
      throw new McpOAuthError("mcp_oauth_token_unavailable", "OAuth 连接已被删除，请重新连接");
    }
    if (mutationGeneration !== (this.mcpOAuthMutationGenerations.get(args.serverId) || 0)) {
      return this.resolveMcpOAuthAccessTokenFresh(args);
    }
    const update = this.ctx.storage.sql.exec(
      "UPDATE mcp_oauth_tokens SET encrypted_record = ?, token_expires_at = ?, config_revision = ?, "+
        "granted_scopes = ?, review_required = ?, revision = revision + 1, updated_at = ? "+
        "WHERE server_id = ? AND revision = ?",
      JSON.stringify(encrypted),
      refreshed.expiresAt ?? null,
      args.auth.configRevision,
      JSON.stringify(refreshed.grantedScopes),
      reviewRequired ? 1 : 0,
      args.nowMs,
      args.serverId,
      row.revision,
    );
    if (update.rowsWritten !== 1) return this.resolveMcpOAuthAccessTokenFresh(args);
    this.bumpMcpOAuthMutationGeneration(args.serverId);
    if (reviewRequired) {
      throw new McpOAuthError("mcp_oauth_review_required", "OAuth scope 已变化，需要重新授权");
    }
    return refreshed.accessToken;
  }

  private deleteMcpOAuthTokenRevision(serverId: string, revision: number): void {
    const deletion = this.ctx.storage.sql.exec(
      "DELETE FROM mcp_oauth_tokens WHERE server_id = ? AND revision = ?",
      serverId,
      revision,
    );
    if (deletion.rowsWritten > 0) this.bumpMcpOAuthMutationGeneration(serverId);
  }

  private cleanupCapabilityRun(runId: string): void {
    const active = this.activeCapabilityRuns.get(runId);
    if (!active) return;
    const pending = active.pendingApproval;
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(new CapabilityError("request_cancelled", "工具会话已结束", true));
    }
    active.controller.abort("run_finished");
    this.activeCapabilityRuns.delete(runId);
  }

  private pruneConversationTrust(now = Date.now()): void {
    for (const [chatId, trust] of this.conversationTrust) {
      if (now - trust.lastSeenAt > 2 * 60 * 60 * 1_000) this.conversationTrust.delete(chatId);
    }
    while (this.conversationTrust.size > 30) {
      const oldest = [...this.conversationTrust.entries()].sort((left, right) => left[1].lastSeenAt - right[1].lastSeenAt)[0];
      if (!oldest) break;
      this.conversationTrust.delete(oldest[0]);
    }
  }

  async resetUsage(day: string): Promise<void> {
    this.ctx.storage.sql.exec("DELETE FROM usage WHERE day = ?", day);
  }

  async recordMetric(metric: ChatMetric): Promise<void> {
    const day = new Date(metric.now || Date.now()).toISOString().slice(0, 10);
    const increment = (kind: string, routeId = "") => {
      this.ctx.storage.sql.exec(
        "INSERT INTO metrics(day, kind, route_id, count) VALUES (?, ?, ?, 1) " +
          "ON CONFLICT(day, kind, route_id) DO UPDATE SET count = count + 1",
        day,
        kind,
        routeId,
      );
    };

    if (metric.kind === "success") {
      increment("req");
      if (metric.routeId) increment("route_ok", metric.routeId);
      if (metric.fallback) increment("fb");
    } else if (metric.kind === "failure") {
      increment("req");
      increment("err");
    } else if (metric.kind === "route_error" && metric.routeId) {
      increment("route_err", metric.routeId);
    } else if (metric.kind === "rate_limited") {
      increment("rl");
    }
    this.ctx.storage.sql.exec("DELETE FROM metrics WHERE day < ?", utcDayStringAt(metric.now || Date.now(), METRICS_DAYS + 2));
  }

  async getStats(days: string[]): Promise<UserStats> {
    const allowed = new Set(days);
    const usage: Record<string, number> = {};
    for (const row of this.ctx.storage.sql.exec<{ day: string; count: number }>("SELECT day, count FROM usage")) {
      if (allowed.has(row.day)) usage[row.day] = row.count;
    }
    const metrics = this.ctx.storage.sql
      .exec<{ day: string; kind: string; route_id: string; count: number }>(
        "SELECT day, kind, route_id, count FROM metrics",
      )
      .toArray()
      .filter((row) => allowed.has(row.day))
      .map((row) => ({ day: row.day, kind: row.kind, routeId: row.route_id, count: row.count }));
    return { usage, metrics };
  }

  async listChats(): Promise<CloudChat[]> {
    const rows = this.ctx.storage.sql
      .exec<{ content: string }>("SELECT content FROM chats ORDER BY updated_at DESC LIMIT ?", MAX_CLOUD_SESSIONS)
      .toArray();
    return rows
      .map((row) => {
        try {
          return normalizeCloudChat(JSON.parse(row.content));
        } catch {
          return null;
        }
      })
      .filter((chat): chat is CloudChat => Boolean(chat));
  }

  async upsertChat(chat: StoredChat): Promise<{ accepted: boolean }> {
    if (chat.serializedBytes > MAX_CLOUD_SESSION_BYTES) return { accepted: false };
    const purgeAt = this.ctx.storage.sql
      .exec<{ value: number }>("SELECT value FROM user_state WHERE key = 'chats_purged_at'")
      .toArray()[0]?.value || 0;
    if (chat.updatedAt <= purgeAt) return { accepted: false };
    const tombstone = this.ctx.storage.sql
      .exec<{ deleted_at: number }>("SELECT deleted_at FROM deleted_chats WHERE id = ?", chat.id)
      .toArray()[0];
    if (tombstone && chat.updatedAt <= tombstone.deleted_at) return { accepted: false };
    if (tombstone) this.ctx.storage.sql.exec("DELETE FROM deleted_chats WHERE id = ?", chat.id);
    const existing = this.ctx.storage.sql
      .exec<{ updated_at: number }>("SELECT updated_at FROM chats WHERE id = ?", chat.id)
      .toArray()[0];
    if (existing && existing.updated_at > chat.updatedAt) return { accepted: false };
    this.writeChat(chat);
    this.ctx.storage.sql.exec(
      "DELETE FROM chats WHERE id NOT IN (SELECT id FROM chats ORDER BY updated_at DESC LIMIT ?)",
      MAX_CLOUD_SESSIONS,
    );
    return { accepted: true };
  }

  async replaceChats(chats: StoredChat[]): Promise<void> {
    this.ctx.storage.sql.exec("DELETE FROM chats");
    this.ctx.storage.sql.exec("DELETE FROM deleted_chats");
    this.ctx.storage.sql.exec("DELETE FROM user_state WHERE key = 'chats_purged_at'");
    for (const chat of chats.slice(0, MAX_CLOUD_SESSIONS)) this.writeChat(chat);
  }

  async migrateLegacyChats(chats: StoredChat[]): Promise<boolean> {
    const count = this.ctx.storage.sql.exec<{ count: number }>("SELECT COUNT(*) AS count FROM chats").one().count;
    if (count > 0) return false;
    for (const chat of chats.slice(0, MAX_CLOUD_SESSIONS)) this.writeChat(chat);
    return true;
  }

  async purgeUserData(nowMs = Date.now()): Promise<void> {
    this.mcpOAuthPurgeGeneration += 1;
    this.mcpOAuthRefreshes.clear();
    this.mcpOAuthMutationGenerations.clear();
    for (const runId of [...this.activeCapabilityRuns.keys()]) this.cleanupCapabilityRun(runId);
    this.conversationTrust.clear();
    this.ctx.storage.sql.exec("DELETE FROM chats");
    this.ctx.storage.sql.exec("DELETE FROM deleted_chats");
    this.ctx.storage.sql.exec("DELETE FROM usage");
    this.ctx.storage.sql.exec("DELETE FROM bursts");
    this.ctx.storage.sql.exec("DELETE FROM metrics");
    this.ctx.storage.sql.exec("DELETE FROM guest_turn_lease");
    this.ctx.storage.sql.exec("DELETE FROM mcp_oauth_states");
    this.ctx.storage.sql.exec("DELETE FROM mcp_oauth_tokens");
    this.ctx.storage.sql.exec("DELETE FROM mcp_oauth_discovery_candidates");
    this.ctx.storage.sql.exec("DELETE FROM mcp_oauth_owner");
    this.ctx.storage.sql.exec(
      "INSERT INTO user_state(key, value) VALUES ('chats_purged_at', ?) ON CONFLICT(key) DO UPDATE SET value = MAX(value, excluded.value)",
      nowMs,
    );
  }

  async deleteChat(id: string, expectedUpdatedAt = 0): Promise<{ deleted: boolean; conflict: boolean; currentChat?: CloudChat }> {
    const row = this.ctx.storage.sql
      .exec<{ updated_at: number; content: string }>("SELECT updated_at, content FROM chats WHERE id = ?", id)
      .toArray()[0];
    if (!row) {
      this.writeDeletionTombstone(id, Date.now());
      return { deleted: false, conflict: false };
    }
    if (expectedUpdatedAt > 0 && row.updated_at > expectedUpdatedAt) {
      try {
        const currentChat = normalizeCloudChat(JSON.parse(row.content));
        return currentChat ? { deleted: false, conflict: true, currentChat } : { deleted: false, conflict: true };
      } catch {
        return { deleted: false, conflict: true };
      }
    }
    this.ctx.storage.sql.exec("DELETE FROM chats WHERE id = ?", id);
    this.writeDeletionTombstone(id, Math.max(Date.now(), row.updated_at));
    return { deleted: true, conflict: false };
  }

  private writeDeletionTombstone(id: string, deletedAt: number): void {
    this.ctx.storage.sql.exec(
      "INSERT INTO deleted_chats(id, deleted_at) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET deleted_at = MAX(deleted_at, excluded.deleted_at)",
      id,
      deletedAt,
    );
    this.ctx.storage.sql.exec("DELETE FROM deleted_chats WHERE deleted_at < ?", Date.now() - 90 * 24 * 60 * 60 * 1000);
    this.ctx.storage.sql.exec(
      "DELETE FROM deleted_chats WHERE id NOT IN (SELECT id FROM deleted_chats ORDER BY deleted_at DESC LIMIT 500)",
    );
  }

  private writeChat(chat: StoredChat): void {
    const content = JSON.stringify({
      id: chat.id,
      title: chat.title,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
      summary: chat.summary,
      summaryUntil: chat.summaryUntil,
      pinned: chat.pinned,
      routeId: chat.routeId,
      parentChatId: chat.parentChatId,
      skillIds: chat.skillIds,
      messages: chat.messages,
    });
    this.ctx.storage.sql.exec(
      `INSERT INTO chats(id, title, created_at, updated_at, summary, summary_until, message_count, content)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET title = excluded.title, created_at = excluded.created_at,
         updated_at = excluded.updated_at, summary = excluded.summary, summary_until = excluded.summary_until,
         message_count = excluded.message_count, content = excluded.content`,
      chat.id,
      chat.title,
      chat.createdAt,
      chat.updatedAt,
      chat.summary,
      chat.summaryUntil,
      chat.messages.length,
      content,
    );
  }
}

export default {
  async fetch(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const requestId = crypto.randomUUID();
    try {
      const response = await handleRequest(request, env, url, ctx, requestId);
      return response.webSocket ? response : withRequestId(response, requestId);
    } catch (error) {
      console.error(JSON.stringify({
        level: "error",
        event: "unhandled_request_error",
        requestId,
        method: request.method,
        path: url.pathname,
        error: error instanceof Error ? error.name : "UnknownError",
      }));
      const response = url.pathname.startsWith("/api/") || url.pathname === "/healthz" || url.pathname.startsWith("/agent")
        ? jsonResponse({ error: "internal_error", requestId }, 500)
        : textResponse("Internal server error", 500, "text/plain");
      return withRequestId(response, requestId);
    }
  },
  async queue(batch: MessageBatch<DocumentIngestMessage>, env: Env): Promise<void> {
    await handleDocumentIngestBatch(batch, env);
  },
};

async function handleDocumentIngestBatch(batch: MessageBatch<DocumentIngestMessage>, env: Env): Promise<void> {
  const mainQueue = env.DOCUMENT_INGEST_QUEUE_NAME?.trim() || "";
  const deadLetterQueue = env.DOCUMENT_INGEST_DLQ_NAME?.trim() || "";
  if (!mainQueue || !deadLetterQueue || mainQueue === deadLetterQueue) {
    for (const message of batch.messages) message.retry();
    return;
  }
  if (batch.queue === deadLetterQueue) {
    for (const message of batch.messages) await handleDocumentIngestDlqMessage(message, env);
    return;
  }
  if (batch.queue !== mainQueue) {
    for (const message of batch.messages) message.retry();
    return;
  }
  for (const message of batch.messages) await handleDocumentIngestMessage(message, env);
}

async function handleDocumentIngestDlqMessage(message: Message<DocumentIngestMessage>, env: Env): Promise<void> {
  const body = normalizeDocumentIngestQueueMessage(message.body);
  if (!body) {
    message.ack();
    return;
  }
  try {
    const root = await getTeamAgent(env, body.ownerId);
    await root.recordDocumentIngestDlq(body, "document_ingest_retry_exhausted");
    message.ack();
  } catch {
    message.retry();
  }
}

async function handleDocumentIngestMessage(message: Message<DocumentIngestMessage>, env: Env): Promise<void> {
  const body = normalizeDocumentIngestQueueMessage(message.body);
  if (!body) {
    message.ack();
    return;
  }
  let root: DurableObjectStub<TeamAgent>;
  try {
    root = await getTeamAgent(env, body.ownerId);
  } catch {
    message.retry();
    return;
  }
  const begun = await root.beginDocumentIngest(body);
  if (begun.action === "retry") {
    message.retry({ delaySeconds: begun.retryAfterSeconds });
    return;
  }
  if (begun.action === "ack") {
    message.ack();
    return;
  }
  try {
    const source = await env.WORKSPACE_FILES.get(begun.sourceObjectKey);
    if (!source || source.size !== begun.size) throw new Error("workspace_object_unavailable");
    const sourceBytes = new Uint8Array(await source.arrayBuffer());
    if (await sha256HexBytes(sourceBytes) !== begun.checksum) throw new Error("workspace_object_checksum_mismatch");
    const result = await extractDocumentText({
      bytes: sourceBytes,
      name: begun.name,
      mediaType: begun.mediaType,
    });
    const extractedBytes = new TextEncoder().encode(result.text);
    const checksum = await sha256HexBytes(extractedBytes);
    await env.WORKSPACE_FILES.put(begun.extractedObjectKey, extractedBytes, {
      sha256: checksum,
      httpMetadata: { contentType: "text/plain; charset=utf-8" },
      customMetadata: { format: result.format },
    });
    const completed = await root.completeDocumentIngest(body, {
      objectKey: begun.extractedObjectKey,
      checksum,
      bytes: extractedBytes.byteLength,
      chars: result.text.length,
    });
    if (!completed) await env.WORKSPACE_FILES.delete(begun.extractedObjectKey);
    message.ack();
  } catch (error) {
    const transient = !(error instanceof DocumentIngestError) || error.transient;
    const code = error instanceof DocumentIngestError
      ? error.code
      : error instanceof Error && error.message.startsWith("workspace_")
        ? error.message.slice(0, 80)
        : "document_ingest_transient_failure";
    const recorded = await root.recordDocumentIngestFailure(body, code, transient).catch(() => false);
    if (transient || !recorded) message.retry();
    else message.ack();
  }
}

async function handleRequest(
  request: Request,
  env: Env,
  url: URL,
  ctx: ExecutionContext | undefined,
  requestId: string,
): Promise<Response> {
  if (url.pathname === "/robots.txt") {
    return textResponse("User-agent: *\nDisallow: /\n", 200, "text/plain");
  }
  if (url.pathname === "/healthz" && request.method === "GET") {
    return handleHealthCheck(env);
  }
  if (url.pathname === "/agent" || url.pathname.startsWith("/agent/")) {
    return handleTeamAgentRequest(request, env, url, ctx, requestId);
  }
  if (url.pathname.startsWith("/api/")) {
    return handleApi(request, env, url, ctx, requestId);
  }
  if (request.method === "GET" && url.pathname === "/react-chat") {
    return Response.redirect(new URL("/react-chat/", url).toString(), 308);
  }
  if (
    request.method === "GET"
    && (url.pathname === "/react-chat/admin" || url.pathname === "/react-chat/admin/")
  ) {
    // Cloudflare Assets canonicalizes index.html to the directory URL, which would drop the admin pathname.
    return fetchRewrittenAsset(request, env, url, "/react-chat/");
  }
  if (request.method === "GET" && url.pathname === "/legacy") {
    return Response.redirect(new URL("/legacy/", url).toString(), 308);
  }
  if (request.method === "GET" && url.pathname === "/legacy/") {
    return fetchRewrittenAsset(request, env, url, "/legacy/");
  }
  if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    const shellPath = env.DEFAULT_CLIENT === "legacy" ? "/legacy/" : "/react-chat/index.html";
    return fetchRewrittenAsset(request, env, url, shellPath);
  }
  const assetResponse = await env.ASSETS.fetch(request);
  return withAssetCacheHeaders(assetResponse, url);
}

async function fetchRewrittenAsset(
  request: Request,
  env: Env,
  originalUrl: URL,
  pathname: string,
): Promise<Response> {
  const assetUrl = new URL(originalUrl);
  assetUrl.pathname = pathname;
  const assetResponse = await env.ASSETS.fetch(new Request(assetUrl, request));
  return withAssetCacheHeaders(assetResponse, originalUrl);
}

function withAssetCacheHeaders(response: Response, url: URL): Response {
  const secured = withSecurityHeaders(response);
  const fingerprint = url.searchParams.get("v") || "";
  const releaseFingerprint = /^[0-9a-f]{40}$/i.test(fingerprint) && /\.(?:css|js)$/i.test(url.pathname);
  const viteFingerprint = /^\/react-chat\/assets\/.+-[A-Za-z0-9_-]{8,}\.(?:css|js)$/i.test(url.pathname);
  if (!releaseFingerprint && !viteFingerprint) return secured;

  const headers = new Headers(secured.headers);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  return new Response(secured.body, {
    status: secured.status,
    statusText: secured.statusText,
    headers,
  });
}

async function handleHealthCheck(env: Env): Promise<Response> {
  try {
    const [config, accessCodes, kvProbe, legacyDurableObject, teamAgent] = await Promise.all([
      loadAppConfig(env),
      loadAccessCodes(env),
      env.CHAT_STORE.get("health:probe"),
      getUserState(env, "health:probe").healthCheck(),
      getTeamAgent(env, "health:probe").then((agent) => agent.healthCheck()),
    ]);
    void kvProbe;
    const configured = Object.values(config.routes).some((route) => route.enabled !== false);
    const memberAccessConfigured = parseAccessCodes(accessCodes).length > 0;
    const agentReady = teamAgent.ok === true && teamAgent.storage === true;
    const durableObject = Boolean(legacyDurableObject && agentReady);
    const ok = Boolean(durableObject && configured);
    return jsonResponse({
      status: ok ? "ok" : "degraded",
      checks: {
        kv: true,
        durableObject,
        legacyDurableObject: Boolean(legacyDurableObject),
        teamAgent: agentReady,
        configured,
        memberAccessConfigured,
      },
    }, ok ? 200 : 503);
  } catch {
    return jsonResponse({
      status: "degraded",
      checks: {
        kv: false,
        durableObject: false,
        legacyDurableObject: false,
        teamAgent: false,
        configured: false,
        memberAccessConfigured: false,
      },
    }, 503);
  }
}

async function handleTeamAgentRequest(
  request: Request,
  env: Env,
  url: URL,
  ctx: ExecutionContext | undefined,
  requestId: string,
): Promise<Response> {
  if (hasInvalidOrigin(request, url)) {
    return jsonResponse({ error: "invalid_origin" }, 403);
  }
  await scheduleGuestCleanupDrain(env, ctx, requestId);

  const session = await getSession(request, env);
  if (!session) return jsonResponse({ error: "unauthorized" }, 401);

  const chatId = normalizeAgentConversationId(url.searchParams.get("chatId"));
  if (!chatId) {
    return jsonResponse({ error: "invalid_chat_id", message: "会话 ID 无效" }, 400);
  }
  await ensureAgentLegacyImport(env, session.label);
  await drainAgentConversationCleanup(env, session.label);
  const root = await getTeamAgent(env, session.label, session);
  const now = Date.now();
  const created = await root.createConversation({
    id: chatId,
    title: "新对话",
    createdAt: now,
    updatedAt: now,
    summary: "",
    pinned: false,
    skillMode: session.kind === "member" ? "automatic" : "manual",
    skillIds: [],
  });
  if (!created.ok) return agentConversationMutationError(created);
  const agent = await getTeamAgentConversation(env, session.label, chatId, session);
  return agent.fetch(request);
}

async function handleApi(
  request: Request,
  env: Env,
  url: URL,
  ctx: ExecutionContext | undefined,
  requestId: string,
): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: sensitiveResponseHeaders() });
  }
  if (request.method !== "GET" && request.method !== "HEAD" && hasInvalidOrigin(request, url)) {
    return jsonResponse({ error: "invalid_origin" }, 403);
  }
  await scheduleGuestCleanupDrain(env, ctx, requestId);

  if (url.pathname === "/api/admin/login" && request.method === "POST") {
    return handleAdminLogin(request, env, url);
  }

  if (url.pathname === "/api/admin/logout" && request.method === "POST") {
    return handleAdminLogout(request, env, url);
  }

  if (url.pathname.startsWith("/api/admin/")) {
    const admin = await getAdminSession(request, env);
    if (!admin) {
      return jsonResponse({ error: "unauthorized" }, 401);
    }
    return handleAdminApi(request, env, url);
  }

  if (url.pathname === "/api/login" && request.method === "POST") {
    return handleLogin(request, env, url);
  }

  if (url.pathname === "/api/logout" && request.method === "POST") {
    return handleLogout(request, env, url);
  }

  if (url.pathname === "/api/guest-session" && request.method === "POST") {
    return handleGuestSession(request, env, url);
  }

  const session = await getSession(request, env);
  if (!session) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }
  if (session.kind === "guest" && !isGuestApiAllowed(url.pathname, request.method)) {
    return jsonResponse({ error: "capability_not_allowed", message: "访客账号不支持这项操作" }, 403);
  }

  if (url.pathname === "/api/mcp/oauth/start" && request.method === "POST") {
    return handleMcpOAuthStart(request, env, session, url);
  }
  if (url.pathname === MCP_OAUTH_CALLBACK_PATH && request.method === "GET") {
    return handleMcpOAuthCallback(request, env, session, url);
  }
  if (url.pathname === "/api/mcp/oauth/status" && request.method === "GET") {
    return handleMcpOAuthStatus(env, session);
  }
  if (url.pathname === "/api/mcp/oauth/discovery" && request.method === "POST") {
    return handleMcpOAuthDiscovery(request, env, session);
  }
  if (url.pathname === "/api/mcp/oauth/revoke" && request.method === "POST") {
    return handleMcpOAuthRevoke(request, env, session);
  }

  if (url.pathname === "/api/session" && request.method === "GET") {
    return jsonResponse(await buildSessionProjection(env, session));
  }

  if (url.pathname === "/api/chat" && request.method === "POST") {
    return handleChat(request, env, session);
  }
  if (url.pathname === "/api/tool-approvals" && request.method === "POST") {
    return handleToolApproval(request, env, session);
  }
  if (url.pathname === "/api/feedback" && request.method === "POST") {
    return handleFeedback(request, env, session);
  }

  if (url.pathname === "/api/agent/conversations" && request.method === "GET") {
    return handleListAgentConversations(env, session);
  }
  if (url.pathname === "/api/agent/conversations" && request.method === "POST") {
    return handleCreateAgentConversation(request, env, session);
  }
  if (
    url.pathname.startsWith("/api/agent/conversations/")
    && url.pathname.endsWith("/workspace-files")
    && request.method === "PUT"
  ) {
    return handleSetConversationWorkspaceFiles(request, env, session, url);
  }
  if (
    url.pathname.startsWith("/api/agent/conversations/")
    && url.pathname.endsWith("/branches")
    && request.method === "POST"
  ) {
    return handleCreateAgentConversationBranch(request, env, session, url);
  }
  if (url.pathname.startsWith("/api/agent/conversations/") && request.method === "PATCH") {
    return handleUpdateAgentConversation(request, env, session, url);
  }
  if (url.pathname.startsWith("/api/agent/conversations/") && request.method === "DELETE") {
    return handleDeleteAgentConversation(env, session, url);
  }
  if (url.pathname === "/api/agent/memory" && request.method === "GET") {
    return handleGetAgentMemory(env, session);
  }
  if (url.pathname === "/api/agent/memory" && request.method === "PUT") {
    return handlePutAgentMemory(request, env, session);
  }

  if (url.pathname === "/api/workspace/files" && request.method === "GET") {
    return handleListWorkspaceFiles(env, session, url);
  }
  if (url.pathname === "/api/workspace/files" && request.method === "POST") {
    return handleWorkspaceFileUpload(request, env, session);
  }
  const workspaceFileRoute = workspaceFileRouteFromUrl(url);
  if (workspaceFileRoute) {
    if (workspaceFileRoute.action === "versions" && request.method === "GET") {
      return handleListWorkspaceFileVersions(env, session, workspaceFileRoute.fileId);
    }
    if (workspaceFileRoute.action === "download" && request.method === "GET") {
      return handleDownloadWorkspaceFile(env, session, url, workspaceFileRoute.fileId);
    }
    if (workspaceFileRoute.action === "retry" && request.method === "POST") {
      return handleWorkspaceFileUpload(request, env, session, workspaceFileRoute.fileId);
    }
    if (workspaceFileRoute.action === "ingest-retry" && request.method === "POST") {
      return handleWorkspaceDocumentIngestRetry(request, env, session, workspaceFileRoute.fileId);
    }
    if (workspaceFileRoute.action === "file" && request.method === "PATCH") {
      return handleUpdateWorkspaceFile(request, env, session, workspaceFileRoute.fileId);
    }
    if (workspaceFileRoute.action === "file" && request.method === "DELETE") {
      return handleDeleteWorkspaceFile(env, session, url, workspaceFileRoute.fileId);
    }
  }

  if (url.pathname === "/api/user-data/export" && request.method === "GET") {
    return handleExportUserData(env, session);
  }

  if (url.pathname === "/api/memory" && request.method === "GET") {
    return handleGetMemory(env, session);
  }

  if (url.pathname === "/api/memory" && request.method === "PUT") {
    return handlePutMemory(request, env, session);
  }

  if (url.pathname === "/api/memory/suggest" && request.method === "POST") {
    return handleMemorySuggest(request, env, session);
  }

  if (url.pathname === "/api/session-summary" && request.method === "POST") {
    return handleSessionSummary(request, env, session);
  }

  if (url.pathname === "/api/chats" && request.method === "GET") {
    return handleListChats(env, session);
  }

  if (url.pathname === "/api/chats" && request.method === "PUT") {
    return handlePutChat(request, env, session);
  }

  if (url.pathname === "/api/chats" && request.method === "DELETE") {
    return handleDeleteChat(request, env, session, url);
  }

  if (url.pathname === "/api/chats/migrate" && request.method === "POST") {
    return handleMigrateChats(request, env, session);
  }
  if (url.pathname === "/api/sessions/revoke-all" && request.method === "POST") {
    const revoked = await revokeSessionsByLabel(env, session.label);
    return jsonResponse({ ok: true, revoked }, 200, {
      "Set-Cookie": buildSessionCookie("", 0, url.protocol === "https:"),
    });
  }

  if (url.pathname === "/api/user-data" && request.method === "DELETE") {
    try {
      const revoked = await attemptMemberAccountCleanup(env, session.label);
      return jsonResponse({ ok: true, revoked }, 200, {
        "Set-Cookie": buildSessionCookie("", 0, url.protocol === "https:"),
      });
    } catch {
      return jsonResponse({
        error: "user_data_purge_incomplete",
        message: "文件对象清理尚未完成，请稍后重试",
      }, 503);
    }
  }

  return jsonResponse({ error: "not_found" }, 404);
}

function isGuestApiAllowed(pathname: string, method: string): boolean {
  if (pathname === "/api/session" && method === "GET") return true;
  if (pathname === "/api/chat" && method === "POST") return true;
  if (pathname === "/api/agent/conversations" && (method === "GET" || method === "POST")) return true;
  if (pathname.startsWith("/api/agent/conversations/") && !pathname.endsWith("/branches")) {
    return method === "PATCH" || method === "DELETE";
  }
  return false;
}

function hasInvalidOrigin(request: Request, url: URL): boolean {
  const origin = request.headers.get("Origin");
  return Boolean(origin && origin !== url.origin);
}

async function handleLogin(request: Request, env: Env, url: URL): Promise<Response> {
  const loginState = await getLoginState(env, request, "user");
  const throttle = await loginState.getLoginThrottle(Date.now(), 8, 10 * 60_000);
  if (!throttle.ok) {
    return jsonResponse({ error: "login_rate_limited", retryAfter: throttle.retryAfter }, 429, { "Retry-After": String(throttle.retryAfter) });
  }
  const accessCodes = await loadAccessCodes(env);
  if (!accessCodes.trim()) {
    return jsonResponse({ error: "server_not_configured" }, 503);
  }

  const body = await readJson<{ code?: string }>(request);
  const code = body.code?.trim() || "";
  const label = await findAccessLabel(accessCodes, code);

  if (!label) {
    await loginState.recordLoginFailure(Date.now());
    return jsonResponse({ error: "invalid_code" }, 401);
  }
  const config = await loadAppConfig(env);
  if (getEffectiveUserConfig(config, label).enabled === false) {
    return jsonResponse({ error: "user_disabled", message: "该用户已暂停使用" }, 403);
  }
  await loginState.clearLoginFailures();

  const now = Date.now();
  const ttl = numberEnv(env.SESSION_TTL_SECONDS, 2_592_000);
  const session: Session = {
    id: crypto.randomUUID(),
    label,
    kind: "member",
    createdAt: now,
    lastSeen: now,
    expiresAt: now + ttl * 1_000,
  };
  const token = randomToken();

  const previousToken = getCookie(request, SESSION_COOKIE);
  if (previousToken) {
    const previous = await getStoredSession(env, previousToken);
    await env.CHAT_STORE.delete(`session:${previousToken}`);
    if (previous?.kind === "guest") await cleanupGuestSessionData(env, previous);
  }

  await env.CHAT_STORE.put(`session:${token}`, JSON.stringify(session), {
    expirationTtl: ttl,
  });

  return jsonResponse(
    { authenticated: true, user: label },
    200,
    {
      "Set-Cookie": buildSessionCookie(token, ttl, url.protocol === "https:"),
    },
  );
}

async function handleLogout(request: Request, env: Env, url: URL): Promise<Response> {
  const token = getCookie(request, SESSION_COOKIE);
  if (token) {
    const session = await getStoredSession(env, token);
    await env.CHAT_STORE.delete(`session:${token}`);
    if (session?.kind === "guest") await cleanupGuestSessionData(env, session);
  }

  return jsonResponse(
    { ok: true },
    200,
    {
      "Set-Cookie": buildSessionCookie("", 0, url.protocol === "https:"),
    },
  );
}

async function handleAdminLogin(request: Request, env: Env, url: URL): Promise<Response> {
  const loginState = await getLoginState(env, request, "admin");
  const throttle = await loginState.getLoginThrottle(Date.now(), 5, 15 * 60_000);
  if (!throttle.ok) {
    return jsonResponse(
      { error: "admin_login_rate_limited", message: "管理员登录尝试过多，请稍后再试", retryAfter: throttle.retryAfter },
      429,
      { "Retry-After": String(throttle.retryAfter) },
    );
  }
  const expected = env.ADMIN_TOKEN?.trim() || "";
  if (!expected) {
    return jsonResponse({ error: "admin_not_configured" }, 503);
  }

  const body = await readJson<{ token?: string }>(request);
  const token = body.token?.trim() || "";
  if (!(await secureCompare(token, expected))) {
    await loginState.recordLoginFailure(Date.now());
    return jsonResponse({ error: "invalid_token" }, 401);
  }
  await loginState.clearLoginFailures();

  const now = Date.now();
  const sessionToken = randomToken();
  const session: AdminSession = { createdAt: now, lastSeen: now, tokenFingerprint: await secretFingerprint(expected) };
  await env.CHAT_STORE.put(`admin:${sessionToken}`, JSON.stringify(session), {
    expirationTtl: ADMIN_SESSION_TTL_SECONDS,
  });

  return jsonResponse(
    { authenticated: true },
    200,
    {
      "Set-Cookie": buildAdminCookie(sessionToken, ADMIN_SESSION_TTL_SECONDS, url.protocol === "https:"),
    },
  );
}

async function handleAdminLogout(request: Request, env: Env, url: URL): Promise<Response> {
  const token = getCookie(request, ADMIN_COOKIE);
  if (token) {
    await env.CHAT_STORE.delete(`admin:${token}`);
  }

  return jsonResponse(
    { ok: true },
    200,
    {
      "Set-Cookie": buildAdminCookie("", 0, url.protocol === "https:"),
    },
  );
}

async function handleAdminApi(request: Request, env: Env, url: URL): Promise<Response> {
  if (url.pathname === "/api/admin/session" && request.method === "GET") {
    return jsonResponse({ authenticated: true });
  }

  if (url.pathname === "/api/admin/config" && request.method === "GET") {
    return handleGetAdminConfig(env);
  }

  if (url.pathname === "/api/admin/setup-status" && request.method === "GET") {
    return handleGetAdminSetupStatus(env);
  }

  if (url.pathname === "/api/admin/setup-smoke" && request.method === "POST") {
    return handleAdminSetupSmoke(env);
  }

  if (url.pathname === "/api/admin/members" && request.method === "GET") {
    return handleGetAdminMembers(env);
  }

  if (url.pathname === "/api/admin/members" && request.method === "POST") {
    return handleCreateAdminMemberAccess(request, env);
  }

  const memberAccessLabel = memberAccessLabelFromAdminPath(url.pathname);
  if (memberAccessLabel !== null && request.method === "POST") {
    return handleRotateAdminMemberAccess(request, env, memberAccessLabel);
  }
  if (memberAccessLabel !== null && request.method === "DELETE") {
    return handleRevokeAdminMemberAccess(request, env, memberAccessLabel);
  }

  const memberConfigLabel = memberConfigLabelFromAdminPath(url.pathname);
  if (memberConfigLabel !== null && request.method === "DELETE") {
    return handleRemoveAdminMemberConfig(request, env, memberConfigLabel);
  }

  if (url.pathname === "/api/admin/config" && request.method === "PUT") {
    return handlePutAdminConfig(request, env);
  }

  if (url.pathname === "/api/admin/route-secrets" && request.method === "GET") {
    return handleGetAdminRouteSecrets(env);
  }

  const routeSecretRef = routeSecretRefFromAdminPath(url.pathname);
  if (routeSecretRef && request.method === "PUT") {
    return handlePutAdminRouteSecret(request, env, routeSecretRef);
  }
  if (routeSecretRef && request.method === "DELETE") {
    return handleDeleteAdminRouteSecret(request, env, routeSecretRef);
  }

  if (url.pathname === "/api/admin/mcp-secrets" && request.method === "GET") {
    return handleGetAdminMcpSecrets(env);
  }

  const mcpSecretRef = secretRefFromAdminPath(url.pathname, "/api/admin/mcp-secrets/");
  if (mcpSecretRef && request.method === "PUT") {
    return handlePutAdminMcpSecret(request, env, mcpSecretRef);
  }
  if (mcpSecretRef && request.method === "DELETE") {
    return handleDeleteAdminMcpSecret(request, env, mcpSecretRef);
  }

  if (url.pathname === "/api/admin/users" && request.method === "POST") {
    return handleCreateAdminUser(request, env);
  }

  if (url.pathname === "/api/admin/config" && request.method === "DELETE") {
    const body = await readJson<{ expectedRevision?: unknown }>(request);
    const conflict = await configRevisionConflict(env, body.expectedRevision);
    if (conflict) return conflict;
    await env.CHAT_STORE.delete(ROUTES_CONFIG_KEY);
    await appendAdminAudit(env, "config.reset");
    return jsonResponse({ ok: true });
  }

  if (url.pathname === "/api/admin/access-codes" && request.method === "GET") {
    return handleGetAdminAccessCodes(env);
  }

  if (url.pathname === "/api/admin/access-codes" && request.method === "PUT") {
    return handlePutAdminAccessCodes(request, env);
  }

  if (url.pathname === "/api/admin/access-codes" && request.method === "DELETE") {
    const body = await readJson<{ expectedRevision?: unknown }>(request);
    const conflict = await accessRevisionConflict(env, body.expectedRevision);
    if (conflict) return conflict;
    await env.CHAT_STORE.delete(ACCESS_CODES_KEY);
    await appendAdminAudit(env, "access.reset");
    return jsonResponse({ ok: true });
  }

  if (url.pathname === "/api/admin/stats" && request.method === "GET") {
    return handleGetAdminStats(env);
  }

  if (url.pathname === "/api/admin/memory" && request.method === "GET") {
    return handleAdminGetMemory(request, env, url);
  }

  if (url.pathname === "/api/admin/memory" && request.method === "PUT") {
    return handleAdminPutMemory(request, env);
  }

  if (url.pathname === "/api/admin/usage" && request.method === "POST") {
    return handleAdminResetUsage(request, env);
  }

  if (url.pathname === "/api/admin/audit" && request.method === "GET") {
    return jsonResponse({ entries: await feedbackAuditService(env).listAdminAudit() });
  }
  if (url.pathname === "/api/admin/feedback" && request.method === "GET") {
    return jsonResponse({ entries: await feedbackAuditService(env).listFeedback() });
  }

  if (url.pathname === "/api/admin/sessions/revoke" && request.method === "POST") {
    const body = await readJson<{ label?: unknown }>(request);
    const label = typeof body.label === "string" ? body.label.trim() : "";
    if (!label) return jsonResponse({ error: "label_required" }, 400);
    const sessionRevocation = await revokeMemberSessionsWithRetry(env, label);
    await appendAdminAudit(
      env,
      sessionRevocation.complete ? "sessions.revoke" : "sessions.revoke.incomplete",
      label,
    );
    return jsonResponse({ ok: true, label, ...sessionRevocation });
  }

  if (url.pathname === "/api/admin/route-health" && request.method === "POST") {
    return handleAdminRouteHealth(request, env);
  }

  if (url.pathname === "/api/admin/route-health" && request.method === "GET") {
    return handleGetAdminRouteHealth(env);
  }

  if (url.pathname === "/api/admin/reliability" && request.method === "GET") {
    return handleGetAdminReliability(env);
  }

  if (url.pathname === "/api/admin/route-models" && request.method === "POST") {
    return handleAdminRouteModels(request, env);
  }

  if (url.pathname === "/api/admin/mcp-discovery" && request.method === "POST") {
    return handleAdminMcpDiscovery(request, env);
  }

  return jsonResponse({ error: "not_found" }, 404);
}

async function handleGetAdminConfig(env: Env): Promise<Response> {
  const { config, source } = await loadEditableConfig(env);
  return jsonResponse({ config: sanitizeAdminConfig(config), source, revision: await configRevision(config) });
}

async function handleGetAdminSetupStatus(env: Env): Promise<Response> {
  const setup = await buildAdminSetupStatus(env);
  return jsonResponse(setup.projection);
}

async function handleAdminSetupSmoke(env: Env): Promise<Response> {
  const setup = await buildAdminSetupStatus(env);
  if (!setup.prerequisitesReady) {
    return jsonResponse({
      error: "setup_incomplete",
      message: "请先完成无模型 smoke 之前的配置步骤",
    }, 409);
  }

  await env.CHAT_STORE.put(SETUP_SMOKE_KEY, JSON.stringify({
    version: 1,
    fingerprint: setup.fingerprint,
    completedAt: new Date().toISOString(),
  }));
  return jsonResponse((await buildAdminSetupStatus(env)).projection);
}

async function buildAdminSetupStatus(env: Env): Promise<{
  projection: AdminSetupStatusProjection;
  prerequisitesReady: boolean;
  fingerprint: string;
}> {
  const [{ config, source: configSource }, accessSnapshot, health] = await Promise.all([
    loadEditableConfig(env),
    loadAccessCodeSnapshot(env),
    inspectAdminSetupHealth(env),
  ]);
  const explicitConfig = configSource !== "default";
  const enabledRoutes = Object.entries(config.routes)
    .filter(([, route]) => route.enabled !== false);
  const modelCount = explicitConfig
    ? enabledRoutes.filter(([routeId, route]) => (
        resolveProviderRouteCandidates(routeId, route, config.providers).length > 0
      )).length
    : 0;

  const providerStatuses = await Promise.all([
    ...Object.entries(config.providers)
      .filter(([, provider]) => provider.enabled !== false)
      .map(([providerId, provider]) => inspectAdminProviderCredential(env, providerId, provider)),
    ...enabledRoutes.flatMap(([routeId, route]) => (
      route.offerings?.length
        ? []
        : resolveProviderRouteCandidates(routeId, route, config.providers)
            .map((candidate) => inspectResolvedProviderCredential(env, candidate))
    )),
  ]);
  const providerCount = explicitConfig
    ? providerStatuses.filter((status) => status === "configured").length
    : 0;

  const accessLabels = [...new Set(accessSnapshot.entries
    .map((entry) => entry.label.trim())
    .filter(isValidMemberLabel))];
  const memberCount = accessLabels.length;
  const permissionCount = accessLabels.filter((label) => {
    const configuredLabel = Object.keys(config.users || {}).find((rawLabel) => rawLabel.trim() === label);
    if (configuredLabel === undefined) return false;
    const user = config.users?.[configuredLabel];
    if (!user || user.enabled === false || !user.allowedRoutes?.length) return false;
    return user.allowedRoutes.some((routeId) => config.routes[routeId]?.enabled !== false);
  }).length;

  const healthStep = setupStep(health.ready, health.count);
  const providerStep = setupStep(providerCount > 0, providerCount);
  const modelStep = setupStep(modelCount > 0, modelCount);
  const memberStep = setupStep(memberCount > 0, memberCount);
  const permissionStep = setupStep(permissionCount > 0, permissionCount);
  const prerequisitesReady = healthStep.ready
    && providerStep.ready
    && modelStep.ready
    && memberStep.ready
    && permissionStep.ready
    && validateAppConfig(config).ok;
  const fingerprint = await secretFingerprint(JSON.stringify({
    version: 1,
    configSource,
    configRevision: await configRevision(config),
    accessRevision: accessSnapshot.revision,
    healthReady: health.ready,
    providerStatuses,
    modelCount,
    memberCount,
    permissionCount,
  }));
  const smokeRecord = await loadAdminSetupSmoke(env);
  const smokeReady = prerequisitesReady && smokeRecord?.fingerprint === fingerprint;
  const smokeStatus: AdminSetupStepStatus = !prerequisitesReady
    ? "blocked"
    : !smokeRecord ? "not_run"
      : smokeReady ? "ready" : "stale";
  const smokeStep: AdminSetupStepProjection = {
    ready: smokeReady,
    status: smokeStatus,
    count: smokeReady ? 1 : 0,
  };
  const projection: AdminSetupStatusProjection = {
    ready: prerequisitesReady && smokeReady,
    configSource,
    steps: {
      health: healthStep,
      provider: providerStep,
      model: modelStep,
      member: memberStep,
      permission: permissionStep,
      smoke: smokeStep,
    },
  };
  return { projection, prerequisitesReady, fingerprint };
}

function setupStep(ready: boolean, count: number): AdminSetupStepProjection {
  return { ready, status: ready ? "ready" : "incomplete", count };
}

async function inspectAdminSetupHealth(env: Env): Promise<{ ready: boolean; count: number }> {
  const checks = await Promise.allSettled([
    env.CHAT_STORE.get("health:setup-probe"),
    getUserState(env, "health:setup-probe").healthCheck(),
    getTeamAgent(env, "health:setup-probe").then((agent) => agent.healthCheck()),
  ]);
  const kvReady = checks[0].status === "fulfilled";
  const legacyReady = checks[1].status === "fulfilled" && Boolean(checks[1].value);
  const teamReady = checks[2].status === "fulfilled"
    && checks[2].value.ok === true
    && checks[2].value.storage === true;
  const count = [kvReady, legacyReady, teamReady].filter(Boolean).length;
  return { ready: count === 3, count };
}

async function inspectResolvedProviderCredential(
  env: Env,
  candidate: ResolvedProviderRoute,
): Promise<AdminReliabilityProviderProjection["credentialStatus"]> {
  if (candidate.requiresUserKey) return "user_key_required";
  try {
    return await resolveRouteKey(candidate, env, "") ? "configured" : "missing";
  } catch {
    return "unavailable";
  }
}

async function loadAdminSetupSmoke(env: Env): Promise<{ fingerprint: string } | null> {
  const stored = await env.CHAT_STORE.get(SETUP_SMOKE_KEY);
  if (!stored) return null;
  try {
    const value = JSON.parse(stored) as unknown;
    if (!isRecord(value) || value.version !== 1 || typeof value.fingerprint !== "string" || !value.fingerprint) {
      return null;
    }
    return { fingerprint: value.fingerprint };
  } catch {
    return null;
  }
}

async function handleGuestSession(request: Request, env: Env, url: URL): Promise<Response> {
  const existing = await getSession(request, env);
  if (existing?.kind === "guest") return jsonResponse(await buildSessionProjection(env, existing));
  if (existing?.kind === "member") return jsonResponse(await buildSessionProjection(env, existing));

  const config = await loadAppConfig(env);
  if (!config.publicAccess.enabled) {
    return jsonResponse({ error: "public_access_disabled" }, 404);
  }

  const now = Date.now();
  const ttl = config.publicAccess.sessionTtlSeconds;
  const session: GuestSession = {
    id: crypto.randomUUID(),
    label: `${GUEST_LABEL_PREFIX}${randomToken().slice(0, 48)}`,
    kind: "guest",
    createdAt: now,
    lastSeen: now,
    expiresAt: now + ttl * 1_000,
    sourceKey: `${GUEST_SOURCE_PREFIX}${await sourceIdentityDigest(request)}`,
  };
  const token = randomToken();
  await Promise.all([
    env.CHAT_STORE.put(`session:${token}`, JSON.stringify(session), { expirationTtl: ttl }),
    scheduleGuestCleanup(env, session),
  ]);
  return jsonResponse(await buildSessionProjection(env, session), 200, {
    "Set-Cookie": buildSessionCookie(token, ttl, url.protocol === "https:"),
  });
}

async function buildSessionProjection(env: Env, session: Session): Promise<Record<string, unknown>> {
  const config = await loadAppConfig(env);
  const access = await getRouteAccess(config, session, env);
  const capabilities = getPublicCapabilities(config, access.user);
  const policy = sessionCapabilities(session, access);
  const [usage, routes, mcpConnections] = await Promise.all([
    quotaAdmissionService(env).getUsage(session, access.user),
    Promise.all(access.routes.map((route) => withPublicRouteHealth(env, route))),
    session.kind === "member" ? listMcpOAuthConnections(env, session) : Promise.resolve([]),
  ]);
  return {
    authenticated: true,
    access: session.kind,
    user: session.label,
    displayName: session.kind === "guest" ? "访客" : access.user.displayName || session.label,
    usage,
    routes,
    defaultRoute: access.defaultRoute,
    allowBringYourOwnKey: session.kind === "member" && Boolean(access.user.allowBringYourOwnKey),
    hasUserSystemPrompt: session.kind === "member" && Boolean(access.user.systemPrompt?.trim()),
    imageInput: imageInputPolicy(env),
    fileInput: fileInputPolicy(env),
    capabilities: policy,
    skills: session.kind === "member" ? capabilities.skills : [],
    tools: session.kind === "member" ? capabilities.tools : [],
    mcpConnections,
    agent: {
      transport: "cloudflare-ai-chat",
      className: "team-agent",
      basePath: "agent",
      instance: await getTeamAgentInstanceName(session.label),
    },
  };
}

async function handleGetAdminMembers(env: Env): Promise<Response> {
  const [{ config }, accessSnapshot] = await Promise.all([
    loadEditableConfig(env),
    loadAccessCodeSnapshot(env),
  ]);
  const accessLabels = accessSnapshot.entries.map((entry) => entry.label.trim()).filter(Boolean);
  const accessLabelSet = new Set(accessLabels);
  const configuredByLabel = new Map<string, string>();
  for (const rawLabel of Object.keys(config.users || {})) {
    const label = rawLabel.trim();
    if (label && !configuredByLabel.has(label)) configuredByLabel.set(label, rawLabel);
  }
  const labels = [...new Set([...accessLabels, ...configuredByLabel.keys()])]
    .sort((left, right) => left.localeCompare(right));
  return jsonResponse({
    members: labels
      .map((label) => projectAdminMember(config, label, accessLabelSet.has(label)))
      .filter((member): member is AdminMemberProjection => member !== null),
    accessRevision: accessSnapshot.revision,
    accessSource: accessSnapshot.source,
  });
}

async function handleCreateAdminMemberAccess(request: Request, env: Env): Promise<Response> {
  const body = await readJson<{ label?: unknown; expectedAccessRevision?: unknown }>(request);
  const label = normalizeMemberLabel(body.label);
  if (!label) return invalidMemberLabelResponse();
  const current = await requireAccessCodeMutationSnapshot(env, body.expectedAccessRevision);
  if (current instanceof Response) return current;
  if (current.entries.some((entry) => entry.label === label)) {
    return jsonResponse({ error: "access_code_exists", message: "该成员已有访问码，请使用轮换操作" }, 409);
  }

  const { config } = await loadEditableConfig(env);
  const accessCode = randomToken();
  const nextAccessCodes = serializeAccessCodes([...current.entries, { label, code: accessCode }]);
  await env.CHAT_STORE.put(ACCESS_CODES_KEY, nextAccessCodes);
  await appendAdminAudit(env, "member.access.create", label);
  return jsonResponse({
    member: projectAdminMember(config, label, true),
    accessCode,
    accessRevision: await accessCodesFingerprint(nextAccessCodes),
    sessionRevocation: { revoked: 0, complete: true },
  });
}

async function handleRotateAdminMemberAccess(request: Request, env: Env, rawLabel: string): Promise<Response> {
  const label = normalizeMemberLabel(rawLabel);
  if (!label) return invalidMemberLabelResponse();
  const body = await readJson<{ expectedAccessRevision?: unknown }>(request);
  const current = await requireAccessCodeMutationSnapshot(env, body.expectedAccessRevision);
  if (current instanceof Response) return current;
  if (!current.entries.some((entry) => entry.label === label)) {
    return jsonResponse({ error: "access_code_not_found", message: "该成员当前没有可轮换的访问码" }, 404);
  }

  const { config } = await loadEditableConfig(env);
  const accessCode = randomToken();
  let replaced = false;
  const nextEntries: AccessEntry[] = [];
  for (const entry of current.entries) {
    if (entry.label !== label) {
      nextEntries.push(entry);
    } else if (!replaced) {
      nextEntries.push({ label, code: accessCode });
      replaced = true;
    }
  }
  const nextAccessCodes = serializeAccessCodes(nextEntries);
  await env.CHAT_STORE.put(ACCESS_CODES_KEY, nextAccessCodes);
  const sessionRevocation = await revokeMemberSessionsWithRetry(env, label);
  await appendAdminAudit(
    env,
    sessionRevocation.complete ? "member.access.rotate" : "member.access.rotate.sessions_incomplete",
    label,
  );
  return jsonResponse({
    member: projectAdminMember(config, label, true),
    accessCode,
    accessRevision: await accessCodesFingerprint(nextAccessCodes),
    sessionRevocation,
  });
}

async function handleRevokeAdminMemberAccess(request: Request, env: Env, rawLabel: string): Promise<Response> {
  const label = normalizeMemberLabel(rawLabel);
  if (!label) return invalidMemberLabelResponse();
  const body = await readJson<{ expectedAccessRevision?: unknown }>(request);
  const current = await requireAccessCodeMutationSnapshot(env, body.expectedAccessRevision);
  if (current instanceof Response) return current;
  if (!current.entries.some((entry) => entry.label === label)) {
    return jsonResponse({ error: "access_code_not_found", message: "该成员当前没有访问码" }, 404);
  }

  const nextEntries = current.entries.filter((entry) => entry.label !== label);
  if (!nextEntries.length) {
    return jsonResponse({
      error: "last_access_code",
      message: "不能撤销最后一个访问码，请先创建另一名可登录成员",
    }, 409);
  }

  const { config } = await loadEditableConfig(env);
  const nextAccessCodes = serializeAccessCodes(nextEntries);
  await env.CHAT_STORE.put(ACCESS_CODES_KEY, nextAccessCodes);
  const sessionRevocation = await revokeMemberSessionsWithRetry(env, label);
  await appendAdminAudit(
    env,
    sessionRevocation.complete ? "member.access.revoke" : "member.access.revoke.sessions_incomplete",
    label,
  );
  return jsonResponse({
    member: projectAdminMember(config, label, false),
    accessRevision: await accessCodesFingerprint(nextAccessCodes),
    sessionRevocation,
  });
}

async function handleRemoveAdminMemberConfig(request: Request, env: Env, rawLabel: string): Promise<Response> {
  const label = normalizeExistingMemberLabel(rawLabel);
  if (!label) {
    return jsonResponse({ error: "invalid_member_label", message: "成员 label 不能为空且不能超过 160 个字符" }, 400);
  }
  const body = await readJson<{ expectedConfigRevision?: unknown }>(request);
  const current = await requireConfigMutationSnapshot(env, body.expectedConfigRevision);
  if (current instanceof Response) return current;

  const configuredLabel = Object.keys(current.config.users || {}).find((key) => key.trim() === label);
  if (configuredLabel === undefined) {
    return jsonResponse({ error: "member_config_not_found", message: "该成员没有独立配置" }, 404);
  }

  const users = { ...(current.config.users || {}) };
  for (const key of Object.keys(users)) {
    if (key.trim() === label) delete users[key];
  }
  const nextConfig: AppConfig = { ...current.config, users };
  const validation = validateAppConfig(nextConfig);
  if (!validation.ok) {
    return jsonResponse({ error: "invalid_config", message: validation.message }, 400);
  }

  await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify(nextConfig));
  await appendAdminAudit(env, "member.config.remove", label);
  const access = await loadAccessCodeSnapshot(env);
  const revision = await configRevision(nextConfig);
  return jsonResponse({
    member: projectAdminMember(nextConfig, label, access.entries.some((entry) => entry.label === label)),
    config: sanitizeAdminConfig(nextConfig),
    source: "kv",
    revision,
  });
}

function memberAccessLabelFromAdminPath(pathname: string): string | null {
  return memberLabelFromAdminPath(pathname, "/access-code");
}

function memberConfigLabelFromAdminPath(pathname: string): string | null {
  return memberLabelFromAdminPath(pathname, "/config");
}

function memberLabelFromAdminPath(pathname: string, suffix: string): string | null {
  const prefix = "/api/admin/members/";
  if (!pathname.startsWith(prefix) || !pathname.endsWith(suffix)) return null;
  const encoded = pathname.slice(prefix.length, -suffix.length);
  if (!encoded || encoded.includes("/")) return "";
  try {
    const label = decodeURIComponent(encoded);
    return label.includes("/") ? "" : label;
  } catch {
    return "";
  }
}

function normalizeMemberLabel(value: unknown): string {
  const label = typeof value === "string" ? value.trim() : "";
  return isValidMemberLabel(label) ? label : "";
}

function normalizeExistingMemberLabel(value: unknown): string {
  const label = typeof value === "string" ? value.trim() : "";
  return label.length > 0 && label.length <= 160 && !label.startsWith(GUEST_LABEL_PREFIX) ? label : "";
}

function isValidMemberLabel(label: string): boolean {
  return MEMBER_LABEL_PATTERN.test(label) && !label.startsWith(GUEST_LABEL_PREFIX);
}

function invalidMemberLabelResponse(): Response {
  return jsonResponse({
    error: "invalid_label",
    message: "label 需为 1 至 80 个字母、数字、点、下划线或短横线，且不能使用访客保留前缀",
  }, 400);
}

function projectAdminMember(config: AppConfig, label: string, hasAccessCode: boolean): AdminMemberProjection | null {
  const configuredLabel = Object.keys(config.users || {}).find((rawLabel) => rawLabel.trim() === label);
  if (configuredLabel === undefined && !hasAccessCode) return null;
  const user = getEffectiveUserConfig(config, configuredLabel || label);
  return {
    label,
    displayName: user.displayName || label,
    configured: configuredLabel !== undefined,
    hasAccessCode,
  };
}

async function loadAccessCodeSnapshot(env: Env): Promise<AccessCodeSnapshot> {
  const editable = await loadEditableAccessCodes(env);
  return {
    ...editable,
    entries: parseAccessCodes(editable.accessCodes),
    revision: await accessCodesFingerprint(editable.accessCodes),
  };
}

async function requireAccessCodeMutationSnapshot(
  env: Env,
  expectedValue: unknown,
): Promise<AccessCodeSnapshot | Response> {
  if (typeof expectedValue !== "string") {
    return jsonResponse({
      error: "expected_access_revision_required",
      message: "缺少访问码版本，请刷新成员列表后重试",
    }, 400);
  }
  const current = await loadAccessCodeSnapshot(env);
  if (current.revision === expectedValue) return current;
  return jsonResponse({
    error: "access_codes_conflict",
    message: "访问码已在其他标签页或设备更新，请刷新后重试",
    currentRevision: current.revision,
  }, 409);
}

function serializeAccessCodes(entries: AccessEntry[]): string {
  return entries.map((entry) => `${entry.label}:${entry.code}`).join(",");
}

async function revokeMemberSessionsWithRetry(
  env: Env,
  label: string,
): Promise<{ revoked: number; complete: boolean }> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return { revoked: await revokeSessionsByLabel(env, label), complete: true };
    } catch {
      // A second full scan safely completes a partially failed first pass.
    }
  }
  return { revoked: 0, complete: false };
}

async function handlePutAdminConfig(request: Request, env: Env): Promise<Response> {
  const body = await readJson<{ config?: unknown; expectedRevision?: unknown }>(request);
  const conflict = await configRevisionConflict(env, body.expectedRevision);
  if (conflict) return conflict;
  const publicAccessValidation = validateRawPublicAccessConfiguration(body.config);
  if (!publicAccessValidation.ok) {
    return jsonResponse({ error: "invalid_config", message: publicAccessValidation.message }, 400);
  }
  const rawProviderPoolValidation = validateRawProviderPoolConfiguration(body.config);
  if (!rawProviderPoolValidation.ok) {
    return jsonResponse({ error: "invalid_config", message: rawProviderPoolValidation.message }, 400);
  }
  const rawMcpValidation = validateRawMcpConfiguration(body.config);
  if (!rawMcpValidation.ok) {
    return jsonResponse({ error: "invalid_config", message: rawMcpValidation.message }, 400);
  }
  const editable = await loadEditableConfig(env);
  const normalized = await applyMcpOAuthConfigRevisions(mergeHiddenCredentialShadows(
    editable.config,
    normalizeAppConfig(body.config),
    body.config,
  ));
  const validation = validateAppConfig(normalized);
  if (!validation.ok) {
    return jsonResponse({ error: "invalid_config", message: validation.message }, 400);
  }

  await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify(normalized));
  await reconcileMcpToolDriftOverlay(env, normalized);
  await appendAdminAudit(env, "config.update");
  return jsonResponse({ ok: true, config: sanitizeAdminConfig(normalized), source: "kv", revision: await configRevision(normalized) });
}

function sanitizeAdminConfig(config: AppConfig): Record<string, unknown> {
  const providers = Object.fromEntries(Object.entries(config.providers).map(([providerId, provider]) => {
    const { apiKey, headers, ...safeProvider } = provider;
    return [providerId, {
      ...safeProvider,
      ...(apiKey ? { hasLegacyKey: true } : {}),
      ...(headers && Object.keys(headers).length ? { hasCustomHeaders: true } : {}),
    }];
  }));
  const routes = Object.fromEntries(Object.entries(config.routes).map(([routeId, route]) => {
    const { apiKey, headers, ...safeRoute } = route;
    return [routeId, {
      ...safeRoute,
      ...(apiKey ? { hasLegacyKey: true } : {}),
      ...(headers && Object.keys(headers).length ? { hasCustomHeaders: true } : {}),
    }];
  }));
  return { ...config, providers, routes };
}

function mergeHiddenCredentialShadows(existing: AppConfig, next: AppConfig, projection: unknown): AppConfig {
  const rawConfig = isRecord(projection) ? projection : {};
  const rawProviders = isRecord(rawConfig.providers) ? rawConfig.providers : {};
  const rawRoutes = isRecord(rawConfig.routes) ? rawConfig.routes : {};
  const providers = { ...next.providers };
  const rawProviderHeaders = new Map<string, boolean>();
  const rawProviderHeaderSources = new Map<string, string>();
  for (const [providerId, rawProvider] of Object.entries(rawProviders)) {
    if (isRecord(rawProvider)) {
      rawProviderHeaders.set(providerId, rawProvider.hasCustomHeaders === true);
      if (typeof rawProvider.headerSourceRouteId === "string") {
        rawProviderHeaderSources.set(providerId, rawProvider.headerSourceRouteId);
      }
    }
  }
  for (const [providerId, provider] of Object.entries(existing.providers)) {
    if (
      provider.apiKey
      && hasOwn(providers, providerId)
      && providers[providerId]
      && !providers[providerId].apiKey
      && hasOwn(rawProviders, providerId)
      && isRecord(rawProviders[providerId])
      && rawProviders[providerId].hasLegacyKey === true
    ) {
      providers[providerId] = { ...providers[providerId], apiKey: provider.apiKey };
    }
    if (
      provider.headers
      && hasOwn(providers, providerId)
      && providers[providerId]
      && !providers[providerId].headers
      && rawProviderHeaders.get(providerId) === true
    ) {
      providers[providerId] = { ...providers[providerId], headers: provider.headers };
    }
  }
  for (const [providerId, sourceRouteId] of rawProviderHeaderSources) {
    const sourceRoute = existing.routes[sourceRouteId];
    const rawSourceRoute = rawRoutes[sourceRouteId];
    if (
      sourceRoute?.headers
      && isRecord(rawSourceRoute)
      && rawSourceRoute.hasCustomHeaders === true
      && hasOwn(providers, providerId)
      && providers[providerId]
      && !providers[providerId].headers
    ) {
      providers[providerId] = { ...providers[providerId], headers: sourceRoute.headers };
    }
  }

  const routes = { ...next.routes };
  const rawRouteHeaders = new Map<string, boolean>();
  for (const [routeId, rawRoute] of Object.entries(rawRoutes)) {
    if (isRecord(rawRoute)) rawRouteHeaders.set(routeId, rawRoute.hasCustomHeaders === true);
  }
  for (const [routeId, route] of Object.entries(existing.routes)) {
    const candidate = routes[routeId];
    if (
      route.apiKey
      && candidate
      && isLegacyRouteConfig(candidate)
      && !candidate.apiKey
      && isRecord(rawRoutes[routeId])
      && rawRoutes[routeId].hasLegacyKey === true
    ) {
      routes[routeId] = { ...candidate, apiKey: route.apiKey };
    }
    if (
      route.headers
      && candidate
      && isLegacyRouteConfig(candidate)
      && !candidate.headers
      && rawRouteHeaders.get(routeId) === true
    ) {
      routes[routeId] = { ...routes[routeId], headers: route.headers };
    }
  }
  return { ...next, providers, routes };
}

function isLegacyRouteConfig(route: RouteConfig): boolean {
  return Boolean(
    (route.type === "openai-chat" || route.type === "anthropic-messages")
    && typeof route.baseUrl === "string"
    && route.baseUrl.trim()
    && typeof route.model === "string"
    && route.model.trim(),
  );
}

async function configRevision(config: AppConfig): Promise<string> {
  return secretFingerprint(JSON.stringify(config));
}

async function configRevisionConflict(env: Env, expectedValue: unknown): Promise<Response | null> {
  const expectedRevision = typeof expectedValue === "string" ? expectedValue : "";
  if (!expectedRevision) return null;
  const current = await loadEditableConfig(env);
  const currentRevision = await configRevision(current.config);
  if (currentRevision === expectedRevision) return null;
  return jsonResponse({
    error: "config_conflict",
    message: "配置已在其他标签页或设备更新，请刷新后重新编辑",
    currentRevision,
  }, 409);
}

function routeSecretRefFromAdminPath(pathname: string): string | null {
  return secretRefFromAdminPath(pathname, "/api/admin/route-secrets/");
}

function secretRefFromAdminPath(pathname: string, prefix: string): string | null {
  if (!pathname.startsWith(prefix)) return null;
  try {
    return decodeURIComponent(pathname.slice(prefix.length));
  } catch {
    return "";
  }
}

async function handleGetAdminRouteSecrets(env: Env): Promise<Response> {
  const config = await loadAppConfig(env);
  const prefix = managedSecretPrefix("route");
  const refs = new Set(
    [...Object.values(config.providers), ...Object.values(config.routes)]
      .map((item) => item.apiKeyRef?.trim() || "")
      .filter((ref) => MANAGED_SECRET_REF_PATTERN.test(ref)),
  );
  let cursor: string | undefined;
  do {
    const page = await env.CHAT_STORE.list({ prefix, cursor, limit: 100 });
    for (const key of page.keys) {
      const encodedRef = key.name.slice(prefix.length);
      try {
        const ref = decodeURIComponent(encodedRef);
        if (MANAGED_SECRET_REF_PATTERN.test(ref)) refs.add(ref);
      } catch {
        // Invalid historical keys remain inaccessible and are not exposed by the admin API.
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  const [masterKey, items] = await Promise.all([
    inspectRouteMasterKey(env),
    Promise.all([...refs].sort().map((ref) => inspectRouteSecret(env, ref))),
  ]);
  return jsonResponse({
    masterKeyReady: masterKey.ready,
    ...(masterKey.message ? { masterKeyMessage: masterKey.message } : {}),
    items,
  });
}

async function handlePutAdminRouteSecret(request: Request, env: Env, apiKeyRef: string): Promise<Response> {
  if (!MANAGED_SECRET_REF_PATTERN.test(apiKeyRef)) {
    return jsonResponse({
      error: "invalid_api_key_ref",
      message: "API Key Ref 必须以大写字母开头，且只能包含大写字母、数字和下划线",
    }, 400);
  }

  const body = await readJson<{ apiKey?: unknown; expectedRevision?: unknown }>(request);
  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  if (!apiKey) {
    return jsonResponse({ error: "api_key_required", message: "请输入要保存的线路密钥" }, 400);
  }
  if (apiKey.length > MAX_MANAGED_SECRET_CHARS) {
    return jsonResponse({ error: "api_key_too_long", message: "线路密钥长度超出限制" }, 400);
  }

  const conflict = await routeSecretRevisionConflict(env, apiKeyRef, body.expectedRevision);
  if (conflict) return conflict;

  try {
    await managedSecretService(env).write("route", apiKeyRef, apiKey);
    await appendAdminAudit(env, "route-secret.update", apiKeyRef);
    return jsonResponse({ ok: true, item: await inspectRouteSecret(env, apiKeyRef) });
  } catch (error) {
    return routeSecretAdminErrorResponse(error);
  }
}

async function handleDeleteAdminRouteSecret(request: Request, env: Env, apiKeyRef: string): Promise<Response> {
  if (!MANAGED_SECRET_REF_PATTERN.test(apiKeyRef)) {
    return jsonResponse({
      error: "invalid_api_key_ref",
      message: "API Key Ref 必须以大写字母开头，且只能包含大写字母、数字和下划线",
    }, 400);
  }
  const body = await readJson<{ expectedRevision?: unknown }>(request);
  const conflict = await routeSecretRevisionConflict(env, apiKeyRef, body.expectedRevision);
  if (conflict) return conflict;
  await managedSecretService(env).delete("route", apiKeyRef);
  await appendAdminAudit(env, "route-secret.delete", apiKeyRef);
  return jsonResponse({ ok: true, item: await inspectRouteSecret(env, apiKeyRef) });
}

async function handleGetAdminMcpSecrets(env: Env): Promise<Response> {
  const config = await loadAppConfig(env);
  const prefix = managedSecretPrefix("mcp");
  const refs = new Set(
    Object.values(config.mcpServers || {})
      .map((server) => {
        if (server.auth.type === "bearer" || server.auth.type === "x-api-key") return server.auth.secretRef;
        if (server.auth.type === "oauth2") return server.auth.clientSecretRef || "";
        return "";
      })
      .filter((ref) => MANAGED_SECRET_REF_PATTERN.test(ref)),
  );
  let cursor: string | undefined;
  do {
    const page = await env.CHAT_STORE.list({ prefix, cursor, limit: 100 });
    for (const key of page.keys) {
      const encodedRef = key.name.slice(prefix.length);
      try {
        const ref = decodeURIComponent(encodedRef);
        if (MANAGED_SECRET_REF_PATTERN.test(ref)) refs.add(ref);
      } catch {
        // Invalid historical keys remain inaccessible and are not exposed by the admin API.
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  const [masterKey, items] = await Promise.all([
    inspectRouteMasterKey(env),
    Promise.all([...refs].sort().map((ref) => inspectMcpSecret(env, ref))),
  ]);
  return jsonResponse({
    masterKeyReady: masterKey.ready,
    ...(masterKey.message ? { masterKeyMessage: masterKey.message } : {}),
    items,
  });
}

async function handlePutAdminMcpSecret(request: Request, env: Env, secretRef: string): Promise<Response> {
  if (!MANAGED_SECRET_REF_PATTERN.test(secretRef)) {
    return jsonResponse({
      error: "invalid_secret_ref",
      message: "Secret Ref 必须以大写字母开头，且只能包含大写字母、数字和下划线",
    }, 400);
  }
  const body = await readJson<{ secret?: unknown; expectedRevision?: unknown }>(request);
  const secret = typeof body.secret === "string" ? body.secret : "";
  if (secret.length === 0) return jsonResponse({ error: "secret_required", message: "请输入要保存的 MCP 密钥" }, 400);
  if (secret.length > MAX_MANAGED_SECRET_CHARS) {
    return jsonResponse({ error: "secret_too_long", message: "MCP 密钥长度超出限制" }, 400);
  }
  const conflict = await managedSecretRevisionConflict(env, "mcp", secretRef, body.expectedRevision);
  if (conflict) return conflict;
  try {
    await managedSecretService(env).write("mcp", secretRef, secret);
    await appendAdminAudit(env, "mcp-secret.update", secretRef);
    return jsonResponse({ ok: true, item: await inspectMcpSecret(env, secretRef) });
  } catch (error) {
    return routeSecretAdminErrorResponse(error);
  }
}

async function handleDeleteAdminMcpSecret(request: Request, env: Env, secretRef: string): Promise<Response> {
  if (!MANAGED_SECRET_REF_PATTERN.test(secretRef)) {
    return jsonResponse({
      error: "invalid_secret_ref",
      message: "Secret Ref 必须以大写字母开头，且只能包含大写字母、数字和下划线",
    }, 400);
  }
  const body = await readJson<{ expectedRevision?: unknown }>(request);
  const conflict = await managedSecretRevisionConflict(env, "mcp", secretRef, body.expectedRevision);
  if (conflict) return conflict;
  await managedSecretService(env).delete("mcp", secretRef);
  await appendAdminAudit(env, "mcp-secret.delete", secretRef);
  return jsonResponse({ ok: true, item: await inspectMcpSecret(env, secretRef) });
}

async function inspectMcpSecret(env: Env, secretRef: string): Promise<McpSecretMetadata> {
  const { namespace: _namespace, ref, ...metadata } = await managedSecretService(env).inspect("mcp", secretRef);
  return { secretRef: ref, ...metadata };
}

async function managedSecretRevisionConflict(
  env: Env,
  namespace: "route" | "mcp",
  secretRef: string,
  expectedValue: unknown,
): Promise<Response | null> {
  const expectedRevision = typeof expectedValue === "string" ? expectedValue : "";
  if (!expectedRevision) return null;
  const currentRevision = await managedSecretService(env).revision(namespace, secretRef);
  if (currentRevision === expectedRevision) return null;
  return jsonResponse({
    error: namespace === "route" ? "route_secret_conflict" : "mcp_secret_conflict",
    message: namespace === "route"
      ? "线路密钥已在其他标签页或设备更新，请刷新后重试"
      : "MCP 密钥已在其他标签页或设备更新，请刷新后重试",
    currentRevision,
  }, 409);
}

async function routeSecretRevisionConflict(
  env: Env,
  apiKeyRef: string,
  expectedValue: unknown,
): Promise<Response | null> {
  return managedSecretRevisionConflict(env, "route", apiKeyRef, expectedValue);
}

async function inspectRouteMasterKey(env: Env): Promise<{ ready: boolean; message?: string }> {
  return managedSecretService(env).inspectMasterKey();
}

async function inspectRouteSecret(env: Env, apiKeyRef: string): Promise<RouteSecretMetadata> {
  const { namespace: _namespace, ref, ...metadata } = await managedSecretService(env).inspect("route", apiKeyRef);
  return { apiKeyRef: ref, ...metadata };
}

function routeSecretAdminErrorResponse(error: unknown): Response {
  if (error instanceof ManagedSecretError) {
    return jsonResponse({ error: error.code, message: error.message }, 503);
  }
  return jsonResponse({ error: "route_secret_operation_failed", message: "线路密钥操作失败" }, 500);
}

async function handleGetAdminAccessCodes(env: Env): Promise<Response> {
  const { accessCodes, source } = await loadEditableAccessCodes(env);
  return jsonResponse({
    accessCodes,
    entries: parseAccessCodes(accessCodes).map(({ label }) => ({ label })),
    source,
    revision: await accessCodesFingerprint(accessCodes),
  });
}

async function handlePutAdminAccessCodes(request: Request, env: Env): Promise<Response> {
  const body = await readJson<{ accessCodes?: unknown; expectedRevision?: unknown }>(request);
  const conflict = await accessRevisionConflict(env, body.expectedRevision);
  if (conflict) return conflict;
  const accessCodes = typeof body.accessCodes === "string" ? body.accessCodes.trim() : "";
  const entries = parseAccessCodes(accessCodes);
  if (!entries.length) {
    return jsonResponse({ error: "invalid_access_codes", message: "至少需要一个 label:code 访问码" }, 400);
  }

  await env.CHAT_STORE.put(ACCESS_CODES_KEY, accessCodes);
  await appendAdminAudit(env, "access.update", `${entries.length} entries`);
  return jsonResponse({
    ok: true,
    entries: entries.map(({ label }) => ({ label })),
    source: "kv",
    revision: await accessCodesFingerprint(accessCodes),
  });
}

async function accessRevisionConflict(env: Env, expectedValue: unknown): Promise<Response | null> {
  const expectedRevision = typeof expectedValue === "string" ? expectedValue : "";
  if (!expectedRevision) return null;
  const current = await loadEditableAccessCodes(env);
  const currentRevision = await accessCodesFingerprint(current.accessCodes);
  if (currentRevision === expectedRevision) return null;
  return jsonResponse({
    error: "access_codes_conflict",
    message: "访问码已在其他标签页或设备更新，请刷新后重试",
    currentRevision,
  }, 409);
}

async function handleGetAdminStats(env: Env): Promise<Response> {
  const [{ config, source: configSource }, { accessCodes, source: accessCodeSource }] = await Promise.all([
    loadEditableConfig(env),
    loadEditableAccessCodes(env),
  ]);
  const day = utcDayString(0);
  const days = Array.from({ length: METRICS_DAYS }, (_, index) => utcDayString(index));
  const accessLabels = parseAccessCodes(accessCodes).map((entry) => entry.label);
  const configLabels = Object.keys(config.users || {});
  const labels = [...new Set([...accessLabels, ...configLabels])].sort();
  const routeIds = Object.keys(config.routes);
  const sessionsByLabel = await countActiveSessionsByLabel(env);
  const stateByLabel = new Map<string, UserStats>();
  const legacyUsageByLabel = new Map<string, Record<string, number>>();
  const memoryByLabel = new Map<string, string>();
  await Promise.all(
    labels.map(async (label) => {
      await ensureAgentLegacyImport(env, label);
      const [state, legacyUsage, memory] = await Promise.all([
        getUserState(env, label).getStats(days),
        Promise.all(days.map((dayKey) => env.CHAT_STORE.get(usageKey(label, dayKey)))),
        getTeamAgent(env, label).then((root) => root.getMemory()),
      ]);
      stateByLabel.set(label, state);
      legacyUsageByLabel.set(
        label,
        Object.fromEntries(days.map((dayKey, index) => [dayKey, positiveCount(legacyUsage[index])])),
      );
      memoryByLabel.set(label, memory.memory);
    }),
  );

  const metricTotal = (dayKey: string, kind: string, routeId = "") =>
    [...stateByLabel.values()].reduce(
      (sum, state) =>
        sum +
        state.metrics
          .filter((metric) => metric.day === dayKey && metric.kind === kind && metric.routeId === routeId)
          .reduce((metricSum, metric) => metricSum + metric.count, 0),
      0,
    );

  const trend = days.map((dayKey) => {
    const requests = metricTotal(dayKey, "req");
    const errors = metricTotal(dayKey, "err");
    const fallbacks = metricTotal(dayKey, "fb");
    const rateLimited = metricTotal(dayKey, "rl");
    return {
      day: dayKey,
      requests,
      errors,
      fallbacks,
      rateLimited,
      errorRate: requests > 0 ? Number(((errors / requests) * 100).toFixed(1)) : 0,
    };
  });

  const routeStats = routeIds.map((routeId) => {
    const dayStats = days.map((dayKey) => ({
      day: dayKey,
      ok: metricTotal(dayKey, "route_ok", routeId),
      error: metricTotal(dayKey, "route_err", routeId),
    }));
    const ok7d = dayStats.reduce((sum, item) => sum + item.ok, 0);
    const error7d = dayStats.reduce((sum, item) => sum + item.error, 0);
    return {
      id: routeId,
      label: config.routes[routeId]?.label || routeId,
      model: config.routes[routeId]?.model || "",
      ok7d,
      error7d,
      errorRate7d: ok7d + error7d > 0 ? Number(((error7d / (ok7d + error7d)) * 100).toFixed(1)) : 0,
      days: dayStats,
    };
  });

  const users = labels.map((label) => {
    const user = { ...config.defaults, ...(config.users?.[label] || {}) };
    const state = stateByLabel.get(label) || { usage: {}, metrics: [] };
    const legacyUsage = legacyUsageByLabel.get(label) || {};
    const usage7d = days.map((dayKey) => Math.max(state.usage[dayKey] || 0, legacyUsage[dayKey] || 0));
    const used = usage7d[0] || 0;
    const dailyLimit = user.dailyMessageLimit || numberEnv(env.DAILY_MESSAGE_LIMIT, DEFAULT_DAILY_LIMIT);
    const requests7d = usage7d.reduce((sum, value) => sum + value, 0);
    const errorCount7d = state.metrics
      .filter((metric) => metric.kind === "err")
      .reduce((sum, metric) => sum + metric.count, 0);
    return {
      label,
      enabled: user.enabled !== false,
      displayName: user.displayName || label,
      used,
      dailyLimit,
      remaining: Math.max(0, dailyLimit - used),
      defaultRoute: user.defaultRoute || "",
      allowedRoutes: user.allowedRoutes || [],
      allowBringYourOwnKey: Boolean(user.allowBringYourOwnKey),
      hasSystemPrompt: Boolean(user.systemPrompt?.trim()),
      systemPromptChars: user.systemPrompt?.trim().length || 0,
      activeSessions: sessionsByLabel.get(label) || 0,
      memoryChars: memoryByLabel.get(label)?.length || 0,
      requests7d,
      errors7d: errorCount7d,
      errorRate7d: requests7d > 0 ? Number(((errorCount7d / requests7d) * 100).toFixed(1)) : 0,
      usageByDay: days.map((dayKey, index) => ({ day: dayKey, used: usage7d[index] })),
    };
  });

  const totals = trend.reduce(
    (acc, item) => {
      acc.requests += item.requests;
      acc.errors += item.errors;
      acc.fallbacks += item.fallbacks;
      acc.rateLimited += item.rateLimited;
      return acc;
    },
    { requests: 0, errors: 0, fallbacks: 0, rateLimited: 0 },
  );

  return jsonResponse({
    day,
    days,
    totals: {
      ...totals,
      errorRate: totals.requests > 0 ? Number(((totals.errors / totals.requests) * 100).toFixed(1)) : 0,
    },
    trend,
    routeStats,
    users,
    routes: Object.entries(config.routes).map(([id, route]) => ({
      id,
      enabled: route.enabled !== false,
      label: route.label,
      type: route.type,
      model: route.model,
      baseUrl: route.baseUrl,
      apiKeyRef: route.apiKeyRef || "",
      requiresUserKey: Boolean(route.requiresUserKey),
      supportsImages: route.supportsImages !== false,
    })),
    configSource,
    accessCodeSource,
  });
}

async function handleGetMemory(env: Env, session: Session): Promise<Response> {
  await ensureAgentLegacyImport(env, session.label);
  const root = await getTeamAgent(env, session.label);
  const record = await root.getMemory();
  return jsonResponse({
    ...record,
    maxChars: numberEnv(env.MAX_MEMORY_CHARS, DEFAULT_MEMORY_CHARS),
  });
}

async function requireConfigMutationSnapshot(
  env: Env,
  expectedValue: unknown,
): Promise<{ config: AppConfig; source: "kv" | "secret" | "default"; revision: string } | Response> {
  if (typeof expectedValue !== "string" || !expectedValue) {
    return jsonResponse({
      error: "expected_config_revision_required",
      message: "缺少配置版本，请刷新成员配置后重试",
    }, 400);
  }
  const editable = await loadEditableConfig(env);
  const revision = await configRevision(editable.config);
  if (revision === expectedValue) return { ...editable, revision };
  return jsonResponse({
    error: "config_conflict",
    message: "配置已在其他标签页或设备更新，请刷新后重试",
    currentRevision: revision,
  }, 409);
}

async function handlePutMemory(request: Request, env: Env, session: Session): Promise<Response> {
  const maxChars = numberEnv(env.MAX_MEMORY_CHARS, DEFAULT_MEMORY_CHARS);
  const body = await readJson<{ memory?: unknown; expectedRevision?: unknown }>(request);
  await ensureAgentLegacyImport(env, session.label);
  const root = await getTeamAgent(env, session.label);
  const current = await root.getMemory();
  const expectedRevision = typeof body.expectedRevision === "string" ? body.expectedRevision : current.revision;
  const result = await root.putMemory(
    typeof body.memory === "string" ? body.memory.trim().slice(0, maxChars) : "",
    expectedRevision,
  );
  if (!result.ok) return agentMemoryConflictResponse(result.current);
  if (!result.record) return jsonResponse({ error: "memory_update_failed" }, 500);
  return jsonResponse({ ok: true, ...result.record, maxChars });
}

async function handleAdminGetMemory(request: Request, env: Env, url: URL): Promise<Response> {
  const label = (url.searchParams.get("label") || "").trim();
  if (!label) {
    return jsonResponse({ error: "label_required" }, 400);
  }
  await ensureAgentLegacyImport(env, label);
  const root = await getTeamAgent(env, label);
  const record = await root.getMemory();
  return jsonResponse({
    label,
    ...record,
    maxChars: numberEnv(env.MAX_MEMORY_CHARS, DEFAULT_MEMORY_CHARS),
  });
}

async function handleAdminPutMemory(request: Request, env: Env): Promise<Response> {
  const maxChars = numberEnv(env.MAX_MEMORY_CHARS, DEFAULT_MEMORY_CHARS);
  const body = await readJson<{ label?: unknown; memory?: unknown; expectedRevision?: unknown }>(request);
  const label = typeof body.label === "string" ? body.label.trim() : "";
  if (!label) {
    return jsonResponse({ error: "label_required" }, 400);
  }
  if (typeof body.expectedRevision !== "string") {
    return jsonResponse({ error: "expected_revision_required", message: "缺少记忆版本，请刷新后重试" }, 400);
  }
  await ensureAgentLegacyImport(env, label);
  const memory = typeof body.memory === "string" ? body.memory.trim().slice(0, maxChars) : "";
  const root = await getTeamAgent(env, label);
  const result = await root.putMemory(memory, body.expectedRevision);
  if (!result.ok) {
    return jsonResponse({
      error: "memory_conflict",
      message: "长期记忆已在其他设备更新，请重新读取后再编辑",
      currentRevision: result.current?.revision || "",
    }, 409);
  }
  await appendAdminAudit(env, memory ? "memory.update" : "memory.clear", label);
  return jsonResponse({ ok: true, label, ...result.record, maxChars });
}

function agentMemoryConflictResponse(current?: { revision: string; updatedAt: number }): Response {
  return jsonResponse({
    error: "memory_conflict",
    message: "长期记忆已在其他设备更新，请重新读取后再编辑",
    currentRevision: current?.revision || "",
    currentUpdatedAt: current?.updatedAt || 0,
  }, 409);
}

async function handleAdminResetUsage(request: Request, env: Env): Promise<Response> {
  const body = await readJson<{ label?: unknown }>(request);
  const label = typeof body.label === "string" ? body.label.trim() : "";
  if (!label) {
    return jsonResponse({ error: "label_required" }, 400);
  }
  const day = new Date().toISOString().slice(0, 10);
  await Promise.all([
    env.CHAT_STORE.delete(usageKey(label, day)),
    getUserState(env, label).resetUsage(day),
  ]);
  await appendAdminAudit(env, "usage.reset", label);
  return jsonResponse({ ok: true, label, day });
}

async function handleCreateAdminUser(request: Request, env: Env): Promise<Response> {
  const body = await readJson<{ label?: unknown; user?: unknown }>(request);
  const label = typeof body.label === "string" ? body.label.trim() : "";
  if (!isValidMemberLabel(label)) {
    return invalidMemberLabelResponse();
  }
  const [{ config }, { accessCodes }] = await Promise.all([loadEditableConfig(env), loadEditableAccessCodes(env)]);
  if (config.users?.[label] || parseAccessCodes(accessCodes).some((entry) => entry.label === label)) {
    return jsonResponse({ error: "user_exists", message: "该 label 已存在" }, 409);
  }
  const user = normalizeUserConfig(body.user);
  const nextConfig = { ...config, users: { ...(config.users || {}), [label]: user } };
  const validation = validateAppConfig(nextConfig);
  if (!validation.ok) return jsonResponse({ error: "invalid_config", message: validation.message }, 400);
  const accessCode = randomToken();
  const nextAccessCodes = accessCodes.trim() ? `${accessCodes.trim()},${label}:${accessCode}` : `${label}:${accessCode}`;
  await Promise.all([
    env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify(nextConfig)),
    env.CHAT_STORE.put(ACCESS_CODES_KEY, nextAccessCodes),
  ]);
  await appendAdminAudit(env, "user.create", label);
  return jsonResponse({
    ok: true,
    label,
    accessCode,
    config: sanitizeAdminConfig(nextConfig),
    configRevision: await configRevision(nextConfig),
    accessRevision: await accessCodesFingerprint(nextAccessCodes),
  });
}

async function handleFeedback(request: Request, env: Env, session: Session): Promise<Response> {
  const body = await readJson<{ rating?: unknown; reason?: unknown; routeId?: unknown; chatId?: unknown; messageId?: unknown }>(request);
  if (body.rating !== "up" && body.rating !== "down") return jsonResponse({ error: "invalid_rating" }, 400);
  const reason: FeedbackReason = body.rating === "down"
    && isDownFeedbackReason(body.reason)
    ? body.reason
    : "";
  if (body.rating === "down" && !reason) return jsonResponse({ error: "feedback_reason_required" }, 400);
  const routeId = typeof body.routeId === "string" ? body.routeId.trim().slice(0, 100) : "";
  const chatId = typeof body.chatId === "string" ? body.chatId.trim().slice(0, 100) : "";
  const messageId = typeof body.messageId === "string" ? body.messageId.trim().slice(0, 100) : "";
  if (!routeId || !chatId || !messageId) return jsonResponse({ error: "feedback_metadata_required" }, 400);
  const config = await loadAppConfig(env);
  if (!config.routes[routeId]) return jsonResponse({ error: "route_not_found" }, 404);
  await feedbackAuditService(env).upsertFeedback({
    label: session.label,
    rating: body.rating,
    reason,
    routeId,
    chatId,
    messageId,
  });
  return jsonResponse({ ok: true, rating: body.rating });
}

async function handleMemorySuggest(request: Request, env: Env, session: Session): Promise<Response> {
  if (request.headers.get("x-chatus-client") !== "web") {
    return jsonResponse({ error: "forbidden" }, 403);
  }
  const body = await readJson<{ messages?: unknown; routeId?: unknown; userApiKey?: unknown }>(request);
  const normalization = normalizeMessages(body.messages, env, { fileInput: session.kind === "member" });
  if (!normalization.ok) {
    return jsonResponse({ error: normalization.error, message: normalization.message }, normalization.status);
  }
  const normalized = normalization.messages;
  if (!normalized.length) {
    return jsonResponse({ error: "empty_messages" }, 400);
  }

  await ensureAgentLegacyImport(env, session.label);
  const existing = (await (await getTeamAgent(env, session.label)).getMemory()).memory.trim();
  const transcript = formatTranscript(normalized).slice(0, 8_000);
  const prompt: ChatMessage[] = [
    {
      role: "system",
      content:
        "你是记忆整理助手。根据对话提炼值得长期保存的用户信息，例如偏好、身份、禁忌、常用背景。" +
        "只输出简洁中文 bullet 列表，每条一行，以 - 开头。不要编造。没有可记信息时只输出：无。",
    },
    {
      role: "user",
      content:
        (existing ? `当前长期记忆：\n${existing}\n\n` : "") +
        `最近对话：\n${transcript}\n\n请给出建议新增或更新的记忆条目。`,
    },
  ];

  const result = await completeWithUserRoute(env, session, {
    routeId: typeof body.routeId === "string" ? body.routeId : undefined,
    userApiKey: typeof body.userApiKey === "string" ? body.userApiKey : undefined,
    messages: prompt,
    maxTokens: 500,
    temperature: 0.2,
    consumeQuota: true,
  });
  if (!result.ok) {
    return jsonResponse({ error: result.error, message: result.message, routeId: result.routeId }, result.status);
  }

  const suggestion = cleanSuggestionText(result.text);
  return jsonResponse({ suggestion, routeId: result.routeId });
}

async function handleSessionSummary(request: Request, env: Env, session: Session): Promise<Response> {
  if (request.headers.get("x-chatus-client") !== "web") {
    return jsonResponse({ error: "forbidden" }, 403);
  }
  const body = await readJson<{
    messages?: unknown;
    previousSummary?: unknown;
    routeId?: unknown;
    userApiKey?: unknown;
  }>(request);
  const normalization = normalizeMessages(body.messages, env, { fileInput: session.kind === "member" });
  if (!normalization.ok) {
    return jsonResponse({ error: normalization.error, message: normalization.message }, normalization.status);
  }
  const normalized = normalization.messages;
  if (!normalized.length) {
    return jsonResponse({ error: "empty_messages" }, 400);
  }

  const maxSummary = numberEnv(env.MAX_SUMMARY_CHARS, DEFAULT_SUMMARY_CHARS);
  const previous =
    typeof body.previousSummary === "string" ? body.previousSummary.trim().slice(0, maxSummary) : "";
  const transcript = formatTranscript(normalized).slice(0, 10_000);
  const prompt: ChatMessage[] = [
    {
      role: "system",
      content:
        "你是会话摘要助手。用简洁中文更新会话摘要，保留目标、约束、关键事实、未完成事项与用户偏好。" +
        `输出纯文本，不超过 ${maxSummary} 字，不要标题装饰。`,
    },
    {
      role: "user",
      content:
        (previous ? `已有摘要：\n${previous}\n\n` : "") +
        `新增对话：\n${transcript}\n\n请输出更新后的完整摘要。`,
    },
  ];

  const result = await completeWithUserRoute(env, session, {
    routeId: typeof body.routeId === "string" ? body.routeId : undefined,
    userApiKey: typeof body.userApiKey === "string" ? body.userApiKey : undefined,
    messages: prompt,
    maxTokens: 700,
    temperature: 0.2,
    consumeQuota: false,
  });
  if (!result.ok) {
    return jsonResponse({ error: result.error, message: result.message, routeId: result.routeId }, result.status);
  }

  const summary = result.text.trim().slice(0, maxSummary);
  return jsonResponse({ summary, routeId: result.routeId, maxChars: maxSummary });
}

async function handleListAgentConversations(env: Env, session: Session): Promise<Response> {
  await ensureAgentLegacyImport(env, session.label);
  await drainAgentConversationCleanup(env, session.label);
  const root = await getTeamAgent(env, session.label);
  const conversations = await root.listConversations();
  return jsonResponse({ conversations, maxConversations: MAX_AGENT_CONVERSATIONS });
}

async function handleCreateAgentConversation(request: Request, env: Env, session: Session): Promise<Response> {
  const body = await readJson<{
    id?: unknown;
    title?: unknown;
    routeId?: unknown;
    skillMode?: unknown;
    skillIds?: unknown;
  }>(request);
  const settings = await validateAgentConversationSettings(
    env,
    session,
    body.routeId,
    body.skillMode,
    body.skillIds,
    true,
  );
  if (!settings.ok) return settings.response;
  await ensureAgentLegacyImport(env, session.label);
  const now = Date.now();
  const id = normalizeAgentConversationId(body.id) || crypto.randomUUID();
  const root = await getTeamAgent(env, session.label);
  const result = await root.createConversation({
    id,
    title: typeof body.title === "string" ? body.title : "新对话",
    createdAt: now,
    updatedAt: now,
    summary: "",
    pinned: false,
    routeId: settings.routeId,
    skillMode: settings.skillMode,
    skillIds: settings.skillIds || [],
  });
  if (!result.ok || !result.conversation) return agentConversationMutationError(result);
  return jsonResponse({ ok: true, conversation: result.conversation }, result.created ? 201 : 200);
}

async function handleCreateAgentConversationBranch(
  request: Request,
  env: Env,
  session: Session,
  url: URL,
): Promise<Response> {
  const sourceId = agentConversationBranchSourceIdFromPath(url);
  if (!sourceId) return jsonResponse({ error: "invalid_chat_id", message: "会话 ID 无效" }, 400);
  const body = await readJson<{
    requestId?: unknown;
    action?: unknown;
    sourceMessageId?: unknown;
    expectedUpdatedAt?: unknown;
    editedText?: unknown;
  }>(request);
  const requestId = normalizeAgentBranchRequestId(body.requestId);
  const action = normalizeAgentBranchAction(body.action);
  const sourceMessageId = normalizeAgentBranchMessageId(body.sourceMessageId);
  const expectedUpdatedAt = finitePositiveInteger(body.expectedUpdatedAt);
  const editedText = typeof body.editedText === "string" ? body.editedText : undefined;
  if (!requestId || !action || !sourceMessageId || !expectedUpdatedAt) {
    return jsonResponse({ error: "invalid_branch_request", message: "分支请求无效，请刷新后重试" }, 400);
  }
  if ((action === "edit" && !editedText?.trim()) || (action !== "edit" && editedText !== undefined)) {
    return jsonResponse({ error: "invalid_branch_request", message: "分支编辑内容无效" }, 400);
  }

  await ensureAgentLegacyImport(env, session.label);
  await drainAgentConversationCleanup(env, session.label);
  const root = await getTeamAgent(env, session.label);
  const source = (await root.listConversations()).find((conversation) => conversation.id === sourceId);
  if (!source) return jsonResponse({ error: "conversation_not_found", message: "会话不存在" }, 404);
  const settings = await repairAgentConversationSettings(
    env,
    session,
    source.routeId,
    source.skillMode,
    source.skillIds,
  );
  const launch = branchLaunchForAction(action);
  const fingerprint = await secretFingerprint(JSON.stringify({
    sourceId,
    sourceMessageId,
    action,
    expectedUpdatedAt,
    editedText: editedText || "",
  }));
  const reservation = await root.reserveConversationBranch({
    requestId,
    fingerprint,
    sourceId,
    sourceMessageId,
    sourceMessageCount: source.messageCount,
    action,
    expectedUpdatedAt,
    destinationId: crypto.randomUUID(),
    title: branchConversationTitle(source.title, action),
    routeId: settings.routeId,
    skillMode: settings.skillMode,
    skillIds: settings.skillIds,
    launch,
  });
  if (reservation.ok === false) return agentConversationBranchReservationError(reservation);
  if (reservation.operation.state === "ready" || reservation.operation.state === "launched") {
    return agentConversationBranchResponse(reservation.operation);
  }

  const sourceAgent = await getTeamAgentConversation(env, session.label, sourceId);
  const copied = await sourceAgent.copyConversationBranchTo({
    sourceMessageId,
    sourceMessageCount: reservation.operation.sourceMessageCount,
    action,
    ...(editedText === undefined ? {} : { editedText }),
    replacementMessageId: `branch-${requestId}`,
    requestId,
    fingerprint,
    destinationId: reservation.operation.destinationId,
    destinationInstance: await getTeamAgentConversationInstanceName(session.label, reservation.operation.destinationId),
    body: { routeId: settings.routeId, skillMode: settings.skillMode, skillIds: settings.skillIds },
  });
  if ("error" in copied) {
    await failAgentConversationBranch(env, session.label, root, reservation.operation, fingerprint);
    return agentConversationBranchCopyError(copied.error);
  }

  await root.recordConversationActivity({
    id: reservation.operation.destinationId,
    messageCount: copied.messageCount,
    routeId: settings.routeId,
    skillIds: settings.skillIds,
  });
  const completed = await root.markConversationBranchState(
    requestId,
    fingerprint,
    copied.launch === "none" ? "ready" : "launched",
    copied.anchorMessageId,
  );
  if (completed.ok === false) return agentConversationBranchReservationError(completed);
  return agentConversationBranchResponse(completed.operation);
}

async function handleUpdateAgentConversation(
  request: Request,
  env: Env,
  session: Session,
  url: URL,
): Promise<Response> {
  const id = agentConversationIdFromPath(url);
  if (!id) return jsonResponse({ error: "invalid_chat_id", message: "会话 ID 无效" }, 400);
  const body = await readJson<{
    title?: unknown;
    routeId?: unknown;
    skillMode?: unknown;
    skillIds?: unknown;
    expectedUpdatedAt?: unknown;
  }>(request);
  const expectedUpdatedAt = finitePositiveInteger(body.expectedUpdatedAt);
  if (!expectedUpdatedAt) {
    return jsonResponse({ error: "expected_updated_at_required", message: "缺少会话版本，请刷新后重试" }, 400);
  }
  await ensureAgentLegacyImport(env, session.label);
  const root = await getTeamAgent(env, session.label);
  const current = (await root.listConversations())
    .find((conversation) => conversation.id === id);
  if (!current) return jsonResponse({ error: "conversation_not_found", message: "会话不存在" }, 404);
  const settings = await validateAgentConversationSettings(
    env,
    session,
    body.routeId,
    body.skillMode === undefined ? current.skillMode : body.skillMode,
    body.skillIds,
    false,
  );
  if (!settings.ok) return settings.response;
  const result = await root.updateConversation({
    id,
    expectedUpdatedAt,
    title: typeof body.title === "string" ? body.title : undefined,
    routeId: settings.routeId,
    skillMode: settings.skillMode,
    skillIds: settings.skillIds,
  });
  if (!result.ok || !result.conversation) return agentConversationMutationError(result);
  return jsonResponse({ ok: true, conversation: result.conversation });
}

async function handleDeleteAgentConversation(env: Env, session: Session, url: URL): Promise<Response> {
  const id = agentConversationIdFromPath(url);
  if (!id) return jsonResponse({ error: "invalid_chat_id", message: "会话 ID 无效" }, 400);
  const expectedUpdatedAt = finitePositiveInteger(url.searchParams.get("expectedUpdatedAt"));
  if (!expectedUpdatedAt) {
    return jsonResponse({ error: "expected_updated_at_required", message: "缺少会话版本，请刷新后重试" }, 400);
  }
  await ensureAgentLegacyImport(env, session.label);
  const root = await getTeamAgent(env, session.label);
  const result = await root.deleteConversation(id, expectedUpdatedAt);
  if (!result.ok) return agentConversationMutationError(result);
  const cleanupPending = !(await attemptAgentConversationCleanup(env, session.label, id, root));
  const conversations = await root.listConversations();
  return jsonResponse({ ok: true, deleted: true, cleanupPending, conversations }, cleanupPending ? 202 : 200);
}

async function handleGetAgentMemory(env: Env, session: Session): Promise<Response> {
  await ensureAgentLegacyImport(env, session.label);
  const root = await getTeamAgent(env, session.label);
  const record = await root.getMemory();
  return jsonResponse({ ...record, maxChars: numberEnv(env.MAX_MEMORY_CHARS, DEFAULT_MEMORY_CHARS) });
}

async function handlePutAgentMemory(request: Request, env: Env, session: Session): Promise<Response> {
  const body = await readJson<{ memory?: unknown; expectedRevision?: unknown }>(request);
  if (typeof body.expectedRevision !== "string") {
    return jsonResponse({ error: "expected_revision_required", message: "缺少记忆版本，请刷新后重试" }, 400);
  }
  await ensureAgentLegacyImport(env, session.label);
  const expectedRevision = body.expectedRevision;
  const root = await getTeamAgent(env, session.label);
  const result = await root.putMemory(
    typeof body.memory === "string" ? body.memory : "",
    expectedRevision,
  );
  if (!result.ok) {
    const current = result.current;
    return jsonResponse({
      error: "memory_conflict",
      message: "长期记忆已在其他设备更新，请重新读取后再编辑",
      currentRevision: current?.revision || "",
      currentUpdatedAt: current?.updatedAt || 0,
    }, 409);
  }
  if (!result.record) return jsonResponse({ error: "memory_update_failed" }, 500);
  return jsonResponse({ ok: true, ...result.record, maxChars: numberEnv(env.MAX_MEMORY_CHARS, DEFAULT_MEMORY_CHARS) });
}

async function handleListWorkspaceFiles(env: Env, session: Session, url: URL): Promise<Response> {
  await ensureAgentLegacyImport(env, session.label);
  const root = await getTeamAgent(env, session.label, session);
  await drainWorkspaceOperations(env, root, session.label);
  const result = await root.listWorkspaceFiles(
    url.searchParams.get("q") || "",
    url.searchParams.get("cursor") || "",
    Math.min(MAX_WORKSPACE_LIST_LIMIT, finitePositiveInteger(url.searchParams.get("limit")) || 30),
  );
  return jsonResponse({ ...result, maxFileBytes: MAX_WORKSPACE_FILE_BYTES });
}

async function handleListWorkspaceFileVersions(env: Env, session: Session, fileId: string): Promise<Response> {
  await ensureAgentLegacyImport(env, session.label);
  const root = await getTeamAgent(env, session.label, session);
  await drainWorkspaceOperations(env, root, session.label);
  const result = await root.listWorkspaceFileVersions(fileId);
  return result
    ? jsonResponse(result)
    : jsonResponse({ error: "workspace_file_not_found", message: "文件不存在" }, 404);
}

async function handleWorkspaceFileUpload(
  request: Request,
  env: Env,
  session: Session,
  fileId = "",
): Promise<Response> {
  const contentLength = finitePositiveInteger(request.headers.get("Content-Length"));
  if (contentLength > MAX_WORKSPACE_FILE_BYTES + 256_000) {
    return jsonResponse({ error: "workspace_file_too_large", message: "文件不能超过 10 MB" }, 413);
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonResponse({ error: "workspace_upload_invalid", message: "上传表单无效" }, 400);
  }
  const fileValue = form.get("file");
  if (!(fileValue instanceof File) || fileValue.size <= 0) {
    return jsonResponse({ error: "workspace_upload_invalid", message: "请选择要上传的文件" }, 400);
  }
  if (fileValue.size > MAX_WORKSPACE_FILE_BYTES) {
    return jsonResponse({ error: "workspace_file_too_large", message: "文件不能超过 10 MB" }, 413);
  }
  const operationId = normalizeWorkspaceOperationId(form.get("operationId"));
  if (!operationId) {
    return jsonResponse({ error: "workspace_operation_id_required", message: "缺少幂等操作标识" }, 400);
  }

  await ensureAgentLegacyImport(env, session.label);
  const root = await getTeamAgent(env, session.label, session);
  await drainWorkspaceOperations(env, root, session.label);
  const existing = fileId ? await root.listWorkspaceFileVersions(fileId) : undefined;
  if (fileId && !existing) return jsonResponse({ error: "workspace_file_not_found", message: "文件不存在" }, 404);
  const expectedUpdatedAt = fileId ? finitePositiveInteger(form.get("expectedUpdatedAt")) : 0;
  if (fileId && !expectedUpdatedAt) {
    return jsonResponse({ error: "expected_updated_at_required", message: "缺少文件版本，请刷新后重试" }, 400);
  }
  const relativePathValue = form.get("relativePath");
  const relativePath = typeof relativePathValue === "string" && relativePathValue
    ? relativePathValue
    : existing?.file.path || fileValue.name;
  const documentByteLimit = workspaceDocumentByteLimit(fileValue.type, relativePath);
  if (!documentByteLimit) {
    return jsonResponse({ error: "workspace_document_unsupported", message: "仅支持文本、PDF、DOCX、XLSX 和 PPTX" }, 415);
  }
  if (fileValue.size > documentByteLimit) {
    const message = documentByteLimit < MAX_WORKSPACE_FILE_BYTES ? "文本文件不能超过 1 MB" : "文档不能超过 10 MB";
    return jsonResponse({ error: "workspace_file_too_large", message }, 413);
  }
  const bytes = await fileValue.arrayBuffer();
  const checksum = await sha256HexBytes(bytes);
  const reservation = await root.reserveWorkspaceUpload({
    operationId,
    relativePath,
    size: bytes.byteLength,
    mediaType: fileValue.type || "application/octet-stream",
    checksum,
    ...(fileId ? { fileId, expectedUpdatedAt } : {}),
  });
  if (!reservation.ok) return workspaceMutationError(reservation);
  if (reservation.reservation.completed) {
    const queued = await enqueueWorkspaceDocument(env, root, session.label, reservation.reservation.file);
    return queued
      ? jsonResponse({ ok: true, file: reservation.reservation.file, existing: true })
      : jsonResponse({ error: "document_ingest_queue_unavailable", message: "文件已保存，解析任务可手动重试" }, 503);
  }

  try {
    await env.WORKSPACE_FILES.put(reservation.reservation.objectKey, bytes, {
      sha256: checksum,
      httpMetadata: { contentType: reservation.reservation.mediaType },
    });
  } catch {
    await root.recordWorkspaceOperationFailure(
      reservation.reservation.operationId,
      reservation.reservation.generation,
      "workspace_r2_put_failed",
    ).catch(() => undefined);
    return jsonResponse({ error: "workspace_upload_failed", message: "文件写入失败，可重新上传" }, 503);
  }

  try {
    const completed = await root.completeWorkspaceUpload(
      reservation.reservation.operationId,
      reservation.reservation.generation,
    );
    if (!completed.ok) return workspaceMutationError(completed);
    const queued = await enqueueWorkspaceDocument(env, root, session.label, completed.file);
    if (!queued) {
      return jsonResponse({
        error: "document_ingest_queue_unavailable",
        message: "文件已保存，解析任务可手动重试",
        file: completed.file,
      }, 503);
    }
    return jsonResponse({ ok: true, file: completed.file, existing: reservation.reservation.existing }, fileId ? 200 : 201);
  } catch {
    return jsonResponse({
      ok: true,
      pending: true,
      file: reservation.reservation.file,
      message: "文件已写入，元数据正在自动恢复",
    }, 202);
  }
}

async function enqueueWorkspaceDocument(
  env: Env,
  root: DurableObjectStub<TeamAgent>,
  ownerId: string,
  file: WorkspaceFileProjection,
): Promise<boolean> {
  const version = file.currentVersion;
  if (!version || version.ingestStatus !== "queued") return version?.ingestStatus === "ready";
  const message: DocumentIngestMessage = {
    ownerId,
    fileId: file.id,
    versionId: version.id,
    generation: version.ingestGeneration,
  };
  try {
    await env.DOCUMENT_INGEST.send(message, { contentType: "json" });
    return true;
  } catch {
    await root.recordDocumentIngestDlq(message, "document_ingest_queue_unavailable").catch(() => undefined);
    return false;
  }
}

async function handleWorkspaceDocumentIngestRetry(
  request: Request,
  env: Env,
  session: Session,
  fileId: string,
): Promise<Response> {
  const body = await readJson<unknown>(request);
  if (!isRecord(body) || Object.keys(body).some((key) => key !== "versionId")) {
    return jsonResponse({ error: "document_ingest_retry_invalid", message: "解析重试参数无效" }, 400);
  }
  const root = await getTeamAgent(env, session.label, session);
  const versions = await root.listWorkspaceFileVersions(fileId);
  if (!versions?.file.currentVersion) return jsonResponse({ error: "workspace_file_not_found", message: "文件不存在" }, 404);
  const requestedVersionId = body.versionId === undefined
    ? versions.file.currentVersion.id
    : normalizeWorkspaceEntityId(body.versionId);
  if (!requestedVersionId) return jsonResponse({ error: "document_ingest_retry_invalid", message: "解析版本无效" }, 400);
  const retried = await root.retryDocumentIngest(fileId, requestedVersionId);
  if (!retried.ok) {
    return retried.error === "workspace_file_not_found"
      ? jsonResponse({ error: retried.error, message: "文件不存在" }, 404)
      : jsonResponse({ error: retried.error, message: "当前解析状态不可重试" }, 409);
  }
  try {
    await env.DOCUMENT_INGEST.send(retried.message, { contentType: "json" });
  } catch {
    await root.recordDocumentIngestDlq(retried.message, "document_ingest_queue_unavailable").catch(() => undefined);
    return jsonResponse({ error: "document_ingest_queue_unavailable", message: "解析队列暂时不可用" }, 503);
  }
  return jsonResponse({ ok: true });
}

async function handleUpdateWorkspaceFile(
  request: Request,
  env: Env,
  session: Session,
  fileId: string,
): Promise<Response> {
  const body = await readJson<unknown>(request);
  if (
    !isRecord(body)
    || Object.keys(body).some((key) => key !== "expectedUpdatedAt" && key !== "relativePath" && key !== "pinned")
    || (body.relativePath === undefined && body.pinned === undefined)
    || (body.pinned !== undefined && typeof body.pinned !== "boolean")
  ) {
    return jsonResponse({ error: "workspace_update_invalid", message: "文件更新参数无效" }, 400);
  }
  const expectedUpdatedAt = finitePositiveInteger(body.expectedUpdatedAt);
  if (!expectedUpdatedAt) {
    return jsonResponse({ error: "expected_updated_at_required", message: "缺少文件版本，请刷新后重试" }, 400);
  }
  const root = await getTeamAgent(env, session.label, session);
  const result = await root.updateWorkspaceFile(fileId, expectedUpdatedAt, {
    ...(body.relativePath === undefined ? {} : { relativePath: body.relativePath }),
    ...(body.pinned === undefined ? {} : { pinned: body.pinned }),
  });
  return result.ok ? jsonResponse({ ok: true, file: result.file }) : workspaceMutationError(result);
}

async function handleDeleteWorkspaceFile(
  env: Env,
  session: Session,
  url: URL,
  fileId: string,
): Promise<Response> {
  const expectedUpdatedAt = finitePositiveInteger(url.searchParams.get("expectedUpdatedAt"));
  const operationId = normalizeWorkspaceOperationId(url.searchParams.get("operationId"));
  if (!expectedUpdatedAt || !operationId) {
    return jsonResponse({ error: "workspace_delete_invalid", message: "缺少文件版本或幂等操作标识" }, 400);
  }
  const root = await getTeamAgent(env, session.label, session);
  const result = await root.reserveWorkspaceFileDelete(fileId, expectedUpdatedAt, operationId);
  if (!result.ok) return workspaceMutationError(result);
  if (result.reservation.completed) {
    return jsonResponse({ ok: true, deleted: true, existing: result.reservation.existing });
  }
  try {
    await deleteWorkspaceObjects(env.WORKSPACE_FILES, result.reservation.objectKeys);
    const completed = await root.completeWorkspaceFileDelete(
      result.reservation.operationId,
      result.reservation.generation,
    );
    if (!completed) throw new Error("workspace_delete_finalize_failed");
    return jsonResponse({ ok: true, deleted: true, existing: result.reservation.existing });
  } catch {
    await root.recordWorkspaceOperationFailure(
      result.reservation.operationId,
      result.reservation.generation,
      "workspace_r2_delete_failed",
    ).catch(() => undefined);
    return jsonResponse({ ok: true, deleted: false, pending: true, message: "删除正在自动重试" }, 202);
  }
}

async function handleDownloadWorkspaceFile(
  env: Env,
  session: Session,
  url: URL,
  fileId: string,
): Promise<Response> {
  const root = await getTeamAgent(env, session.label, session);
  const metadata = await root.listWorkspaceFileVersions(fileId);
  if (!metadata) return jsonResponse({ error: "workspace_file_not_found", message: "文件不存在" }, 404);
  const requestedVersionId = normalizeWorkspaceEntityId(url.searchParams.get("versionId"));
  const versionId = requestedVersionId || metadata.file.currentVersion?.id || "";
  const version = versionId ? await root.getWorkspaceFileVersion(fileId, versionId) : undefined;
  if (!version) return jsonResponse({ error: "workspace_version_not_found", message: "文件版本不存在" }, 404);
  const object = await env.WORKSPACE_FILES.get(version.objectKey);
  if (!object || object.size !== version.size) {
    return jsonResponse({ error: "workspace_object_unavailable", message: "文件对象暂时不可用" }, 503);
  }
  const storedChecksum = object.checksums.sha256;
  if (!storedChecksum || hexBytes(storedChecksum) !== version.checksum) {
    return jsonResponse({ error: "workspace_object_invalid", message: "文件完整性校验失败" }, 503);
  }
  return new Response(object.body, {
    status: 200,
    headers: sensitiveResponseHeaders({
      "Content-Type": version.mediaType,
      "Content-Length": String(object.size),
      "Content-Disposition": workspaceContentDisposition(version.name),
      ETag: `"sha256-${version.checksum}"`,
      "X-Content-Type-Options": "nosniff",
    }),
  });
}

async function handleSetConversationWorkspaceFiles(
  request: Request,
  env: Env,
  session: Session,
  url: URL,
): Promise<Response> {
  const conversationId = agentConversationWorkspaceSourceIdFromPath(url);
  if (!conversationId) return jsonResponse({ error: "invalid_chat_id", message: "会话 ID 无效" }, 400);
  const body = await readJson<unknown>(request);
  if (!isRecord(body) || Object.keys(body).length !== 2 || !("expectedUpdatedAt" in body) || !("files" in body)) {
    return jsonResponse({ error: "workspace_refs_invalid", message: "会话文件选择无效" }, 400);
  }
  const expectedUpdatedAt = finitePositiveInteger(body.expectedUpdatedAt);
  const files = Array.isArray(body.files) && body.files.every(isWorkspaceConversationRefInput)
    ? body.files
    : undefined;
  if (
    !expectedUpdatedAt
    || !files
    || files.length > MAX_WORKSPACE_FILES_PER_CONVERSATION
  ) {
    return jsonResponse({ error: "workspace_refs_invalid", message: "会话文件选择无效" }, 400);
  }
  const root = await getTeamAgent(env, session.label, session);
  const result = await root.setConversationWorkspaceFiles(
    conversationId,
    expectedUpdatedAt,
    files,
  );
  if (!result.ok) return agentConversationMutationError(result);
  return jsonResponse({ ok: true, conversation: result.conversation });
}

function workspaceMutationError(
  result: Extract<WorkspaceUploadReservationResult | WorkspaceMutationResult | WorkspaceDeleteReservationResult, { ok: false }>,
): Response {
  if (result.error === "workspace_file_not_found") {
    return jsonResponse({ error: result.error, message: "文件不存在" }, 404);
  }
  if (result.error === "workspace_file_deleted") {
    return jsonResponse({ error: result.error, message: "文件已删除" }, 410);
  }
  if (
    result.error === "workspace_path_invalid"
    || result.error === "workspace_upload_invalid"
    || result.error === "workspace_update_invalid"
  ) {
    return jsonResponse({ error: result.error, message: "文件路径或上传参数无效" }, 400);
  }
  if (result.error === "workspace_account_purge_in_progress") {
    return jsonResponse({ error: result.error, message: "账户数据正在清理，请稍后重试" }, 409);
  }
  return jsonResponse({
    error: result.error,
    message: result.error === "workspace_path_conflict"
      ? "已有同路径文件"
      : result.error === "workspace_operation_failed"
        ? "上次文件操作失败，请使用新的操作标识重试"
        : "文件已更新，请刷新后重试",
    current: result.current || null,
  }, 409);
}

function isWorkspaceConversationRefInput(
  value: unknown,
): value is { fileId: string; versionId: string } {
  return isRecord(value)
    && Object.keys(value).length === 2
    && typeof value.fileId === "string"
    && typeof value.versionId === "string"
    && Boolean(normalizeWorkspaceEntityId(value.fileId))
    && Boolean(normalizeWorkspaceEntityId(value.versionId));
}

async function handleExportUserData(env: Env, session: Session): Promise<Response> {
  try {
    await ensureAgentLegacyImport(env, session.label);
    await drainAgentConversationCleanup(env, session.label);
    const root = await getTeamAgent(env, session.label);
    const [memory, conversations] = await Promise.all([
      root.getMemory(),
      root.listConversations(),
    ]);
    const exportedConversations: Array<Omit<AgentConversationSummary, "workspaceFiles"> & {
      messages: AgentExportMessage[];
      messagesTruncated: boolean;
    }> = [];
    const encoder = new TextEncoder();
    const baseDocument = {
      schema: "chatus-user-data",
      version: 1,
      exportedAt: new Date().toISOString(),
      account: { label: session.label },
      memory: { text: memory.memory, updatedAt: memory.updatedAt },
      conversations: exportedConversations,
      truncated: false,
    };
    let encodedBytes = encoder.encode(JSON.stringify(baseDocument)).byteLength;
    let truncated = false;

    for (const conversation of conversations) {
      const remainingBytes = MAX_USER_DATA_EXPORT_BYTES
        - encodedBytes
        - USER_DATA_EXPORT_ITEM_HEADROOM_BYTES;
      if (remainingBytes < 32_768) {
        truncated = true;
        break;
      }
      const agent = await getTeamAgentConversation(env, session.label, conversation.id);
      const result = await agent.exportMessages(
        Math.min(remainingBytes, MAX_USER_DATA_EXPORT_CONVERSATION_BYTES),
      );
      const { workspaceFiles: _workspaceFiles, ...exportableConversation } = conversation;
      const exported = {
        ...exportableConversation,
        messages: result.messages,
        messagesTruncated: result.truncated,
      };
      const itemBytes = encoder.encode(JSON.stringify(exported)).byteLength
        + (exportedConversations.length ? 1 : 0);
      if (encodedBytes + itemBytes > MAX_USER_DATA_EXPORT_BYTES) {
        truncated = true;
        break;
      }
      exportedConversations.push(exported);
      encodedBytes += itemBytes;
      truncated ||= result.truncated;
    }
    if (exportedConversations.length < conversations.length) truncated = true;

    const body = JSON.stringify({ ...baseDocument, truncated });
    if (encoder.encode(body).byteLength > MAX_USER_DATA_EXPORT_BYTES) {
      return jsonResponse({
        error: "user_data_export_too_large",
        message: "导出数据过大，请先删除不再需要的会话后重试",
      }, 413);
    }
    return new Response(body, {
      status: 200,
      headers: sensitiveResponseHeaders({
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": 'attachment; filename="chatus-user-data.json"',
      }),
    });
  } catch {
    return jsonResponse({
      error: "user_data_export_unavailable",
      message: "暂时无法完整读取个人数据，请稍后重试",
    }, 503);
  }
}

async function validateAgentConversationSettings(
  env: Env,
  session: Session,
  routeValue: unknown,
  skillModeValue: unknown,
  skillValue: unknown,
  useDefaults: boolean,
): Promise<
  | { ok: true; routeId?: string; skillMode: ConversationSkillMode; skillIds?: string[] }
  | { ok: false; response: Response }
> {
  const config = await loadAppConfig(env);
  const access = await getRouteAccess(config, session, env);
  const requestedRoute = typeof routeValue === "string" ? routeValue.trim() : "";
  if (requestedRoute && !access.routes.some((route) => route.id === requestedRoute)) {
    return { ok: false, response: jsonResponse({ error: "route_not_allowed", message: "该线路不可用" }, 403) };
  }
  if (session.kind === "guest") {
    return {
      ok: true,
      routeId: requestedRoute || (useDefaults ? access.defaultRoute : undefined),
      skillMode: "manual",
      skillIds: [],
    };
  }
  const skillMode = skillModeValue === undefined && useDefaults
    ? "automatic"
    : normalizeConversationSkillMode(skillModeValue);
  if (!skillMode) {
    return { ok: false, response: jsonResponse({ error: "invalid_skill_mode", message: "Skill 模式无效" }, 400) };
  }
  let skillIds: string[] | undefined;
  if (skillValue !== undefined) {
    const requestedSkills = normalizeSelectedSkillIds(skillValue);
    const allowedSkills = new Set(getPublicCapabilities(config, access.user).skills.map((skill) => skill.id));
    if (requestedSkills.some((id) => !allowedSkills.has(id))) {
      return { ok: false, response: jsonResponse({ error: "skill_not_allowed", message: "包含未分配的 Skill" }, 403) };
    }
    skillIds = requestedSkills;
  } else if (useDefaults && skillMode === "manual") {
    skillIds = getPublicCapabilities(config, access.user).skills
      .slice(0, MAX_SELECTED_SKILLS)
      .map((skill) => skill.id);
  } else if (useDefaults) {
    skillIds = [];
  }
  return {
    ok: true,
    routeId: requestedRoute || (useDefaults ? access.defaultRoute : undefined),
    skillMode,
    skillIds,
  };
}

async function repairAgentConversationSettings(
  env: Env,
  session: Session,
  routeValue: unknown,
  skillModeValue: unknown,
  skillValue: unknown,
): Promise<{ routeId?: string; skillMode: ConversationSkillMode; skillIds: string[] }> {
  const config = await loadAppConfig(env);
  const access = await getRouteAccess(config, session, env);
  const requestedRoute = typeof routeValue === "string" ? routeValue.trim() : "";
  const routeId = requestedRoute && access.routes.some((route) => route.id === requestedRoute)
    ? requestedRoute
    : access.defaultRoute || undefined;
  const allowedSkills = new Set(getPublicCapabilities(config, access.user).skills.map((skill) => skill.id));
  const skillIds = normalizeSelectedSkillIds(skillValue)
    .filter((skillId) => allowedSkills.has(skillId));
  return {
    routeId,
    skillMode: session.kind === "guest" ? "manual" : normalizeConversationSkillMode(skillModeValue) || "manual",
    skillIds: session.kind === "guest" ? [] : skillIds,
  };
}

function agentConversationBranchSourceIdFromPath(url: URL): string {
  const prefix = "/api/agent/conversations/";
  const suffix = "/branches";
  if (!url.pathname.startsWith(prefix) || !url.pathname.endsWith(suffix)) return "";
  const encoded = url.pathname.slice(prefix.length, -suffix.length);
  if (!encoded || encoded.includes("/")) return "";
  try {
    return normalizeAgentConversationId(decodeURIComponent(encoded));
  } catch {
    return "";
  }
}

function normalizeAgentBranchRequestId(value: unknown): string {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  return normalized && normalized.length <= 120 && /^[A-Za-z0-9._:-]+$/.test(normalized) ? normalized : "";
}

function normalizeAgentBranchMessageId(value: unknown): string {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  if (!normalized || normalized.length > 160 || /[\u0000-\u001f\u007f]/.test(normalized)) return "";
  return normalized;
}

function normalizeAgentBranchAction(value: unknown): AgentConversationBranchAction | undefined {
  return value === "branch"
    || value === "edit"
    || value === "resend"
    || value === "regenerate"
    || value === "continue"
    ? value
    : undefined;
}

function branchLaunchForAction(action: AgentConversationBranchAction): AgentConversationBranchLaunch {
  if (action === "branch") return "none";
  if (action === "continue") return "continue";
  return "respond";
}

function branchConversationTitle(title: string, action: AgentConversationBranchAction): string {
  const suffix = branchConversationTitleSuffix(action);
  const cleaned = stripGeneratedBranchTitleSuffix(title.trim()) || "新对话";
  const base = cleaned.slice(0, Math.max(1, 76 - suffix.length));
  return `${base} · ${suffix}`;
}

function branchConversationTitleSuffix(action: AgentConversationBranchAction): string {
  if (action === "edit") return "编辑分支";
  if (action === "resend") return "重发分支";
  if (action === "regenerate") return "重生成分支";
  if (action === "continue") return "续写分支";
  return "分支";
}

function stripGeneratedBranchTitleSuffix(title: string): string {
  return title
    .replace(/(?:\s*·\s*(?:分支|编辑分支|重发分支|重生成分支|续写分支))+$/u, "")
    .trim();
}

function agentConversationBranchResponse(operation: AgentConversationBranchOperation): Response {
  return jsonResponse({
    ok: true,
    requestId: operation.requestId,
    conversation: operation.conversation,
    launch: operation.launch,
    ...(operation.anchorMessageId ? { anchorMessageId: operation.anchorMessageId } : {}),
  }, operation.state === "reserved" ? 202 : 200);
}

function agentConversationBranchReservationError(
  result: Extract<AgentConversationBranchReservationResult, { ok: false }>,
): Response {
  if (result.error === "conversation_conflict") {
    return jsonResponse({
      error: result.error,
      message: "源会话已更新，请刷新后重试",
      current: result.current || null,
    }, 409);
  }
  if (result.error === "conversation_limit_reached") {
    return jsonResponse({ error: result.error, message: `最多保留 ${MAX_AGENT_CONVERSATIONS} 个会话` }, 409);
  }
  if (result.error === "conversation_deleted") {
    return jsonResponse({ error: result.error, message: "源会话已删除" }, 410);
  }
  if (result.error === "branch_request_conflict") {
    return jsonResponse({ error: result.error, message: "分支请求标识已被其他操作使用" }, 409);
  }
  if (result.error === "branch_failed") {
    return jsonResponse({ error: result.error, message: "分支创建未完成，请重新发起" }, 409);
  }
  return jsonResponse({ error: result.error, message: "源会话不存在" }, 404);
}

function agentConversationBranchCopyError(error: string): Response {
  if (error === "conversation_busy") {
    return jsonResponse({ error, message: "源会话仍在处理中，请稍后重试" }, 409);
  }
  if (error === "conversation_conflict") {
    return jsonResponse({ error, message: "源会话已更新，请刷新后重试" }, 409);
  }
  if (error === "message_not_found") {
    return jsonResponse({ error, message: "消息已不存在，请刷新后重试" }, 409);
  }
  if (error === "edited_text_required") {
    return jsonResponse({ error, message: "编辑内容不能为空" }, 400);
  }
  if (error === "branch_copy_conflict") {
    return jsonResponse({ error, message: "目标分支已有不同内容，请重新发起" }, 409);
  }
  if (error === "branch_request_conflict") {
    return jsonResponse({ error, message: "分支请求标识已被其他操作使用" }, 409);
  }
  return jsonResponse({ error, message: "当前消息不支持此操作" }, 409);
}

async function failAgentConversationBranch(
  env: Env,
  label: string,
  root: DurableObjectStub<TeamAgent>,
  operation: AgentConversationBranchOperation,
  fingerprint: string,
): Promise<void> {
  await root.markConversationBranchState(operation.requestId, fingerprint, "failed").catch(() => undefined);
  const deleted = await root.deleteConversation(operation.destinationId, operation.conversation.updatedAt).catch(() => ({ ok: false }));
  if (deleted && "ok" in deleted && deleted.ok) {
    await attemptAgentConversationCleanup(env, label, operation.destinationId, root);
  }
}

function agentConversationMutationError(result: AgentConversationMutationResult): Response {
  if (result.error === "workspace_account_purge_in_progress") {
    return jsonResponse({ error: result.error, message: "账户数据正在清理，请稍后重试" }, 409);
  }
  if (result.error === "conversation_conflict") {
    return jsonResponse({
      error: result.error,
      message: "会话已在其他设备更新，请刷新后重试",
      current: result.current || null,
    }, 409);
  }
  if (result.error === "conversation_limit_reached") {
    return jsonResponse({ error: result.error, message: `最多保留 ${MAX_AGENT_CONVERSATIONS} 个会话` }, 409);
  }
  if (result.error === "conversation_deleted") {
    return jsonResponse({ error: result.error, message: "会话已删除，旧连接不能重新创建它" }, 410);
  }
  return jsonResponse({ error: result.error, message: "会话不存在" }, 404);
}


async function handleListChats(env: Env, session: Session): Promise<Response> {
  const chats = await loadChatSessions(env, session.label);
  return jsonResponse({
    chats,
    maxSessions: MAX_CLOUD_SESSIONS,
    maxMessages: MAX_CLOUD_MESSAGES,
  });
}

async function handlePutChat(request: Request, env: Env, session: Session): Promise<Response> {
  const body = await readJson<{ chat?: unknown }>(request);
  const chat = normalizeCloudChat(body.chat);
  if (!chat) {
    return jsonResponse({ error: "invalid_chat", message: "会话数据无效" }, 400);
  }

  const stored = toStoredChat(chat);
  if (!stored) {
    return jsonResponse({ error: "chat_too_large", message: "会话内容过大，请减少图片后重试" }, 413);
  }

  await migrateLegacyChatIndex(env, session.label);
  const state = getUserState(env, session.label);
  const result = await state.upsertChat(stored);
  let chats = await state.listChats();
  if (!result.accepted) {
    return jsonResponse({
      ok: true,
      accepted: false,
      chat: summarizeChat(chat),
      currentChat: chats.find((item) => item.id === chat.id) || null,
      chats: chats.map(summarizeChat),
    });
  }
  const syncState = await syncLegacyChatToAgent(env, session.label, chat);
  if (syncState === "deleted") {
    await state.deleteChat(chat.id, 0);
    chats = await state.listChats();
    return jsonResponse({ ok: true, accepted: false, chat: summarizeChat(chat), currentChat: null, chats: chats.map(summarizeChat) });
  }
  return jsonResponse({ ok: true, chat: summarizeChat(chat), chats: chats.map(summarizeChat) });
}

async function handleDeleteChat(
  request: Request,
  env: Env,
  session: Session,
  url: URL,
): Promise<Response> {
  const id = (url.searchParams.get("id") || "").trim();
  if (!id) {
    return jsonResponse({ error: "id_required" }, 400);
  }
  const expectedUpdatedAt = Number(url.searchParams.get("expectedUpdatedAt") || "0");
  const normalizedExpectedUpdatedAt = Number.isFinite(expectedUpdatedAt) && expectedUpdatedAt > 0 ? expectedUpdatedAt : 0;
  if (!normalizedExpectedUpdatedAt) {
    return jsonResponse({ error: "expected_updated_at_required", message: "缺少会话版本，请刷新后重试" }, 400);
  }
  await migrateLegacyChatIndex(env, session.label);
  await ensureAgentLegacyImport(env, session.label);
  const state = getUserState(env, session.label);
  const legacyChat = (await state.listChats()).find((chat) => chat.id === id);
  if (legacyChat) await syncLegacyChatToAgent(env, session.label, legacyChat);
  const root = await getTeamAgent(env, session.label);
  const agentResult = await root.deleteConversation(id, normalizedExpectedUpdatedAt);
  if (!agentResult.ok && agentResult.error === "conversation_conflict") {
    return jsonResponse({
      error: "chat_delete_conflict",
      message: "该会话已在其他设备更新，已保留较新版本",
      currentChat: agentResult.current || null,
    }, 409);
  }
  if (!agentResult.ok && agentResult.error !== "conversation_deleted") {
    return agentConversationMutationError(agentResult);
  }
  if (agentResult.ok) await attemptAgentConversationCleanup(env, session.label, id, root);
  const result = await state.deleteChat(id, 0);
  const chats = await state.listChats();
  return jsonResponse({ ok: true, deleted: result.deleted || agentResult.ok || agentResult.error === "conversation_deleted", chats: chats.map(summarizeChat) });
}

async function handleMigrateChats(request: Request, env: Env, session: Session): Promise<Response> {
  const body = await readJson<{ chats?: unknown; mode?: unknown }>(request);
  if (!Array.isArray(body.chats) || !body.chats.length) {
    return jsonResponse({ error: "empty_chats", message: "没有可同步的会话" }, 400);
  }
  if (body.chats.length > MAX_CLOUD_SESSIONS) {
    return jsonResponse({ error: "too_many_chats", message: `最多同步 ${MAX_CLOUD_SESSIONS} 个会话` }, 400);
  }
  const incoming: CloudChat[] = [];
  for (const value of body.chats) {
    const chat = normalizeCloudChat(value);
    if (!chat) return jsonResponse({ error: "invalid_chat", message: "会话数据无效" }, 400);
    if (!toStoredChat(chat)) {
      return jsonResponse({ error: "chat_too_large", message: `会话“${chat.title}”内容过大` }, 413);
    }
    incoming.push(chat);
  }

  const mode = body.mode === "replace" ? "replace" : body.mode === "restore" ? "restore" : "merge";
  const restoreBase = Date.now();
  const preparedIncoming = mode === "restore"
    ? incoming.map((chat, index) => ({ ...chat, updatedAt: restoreBase + index + 1 }))
    : incoming;
  const state = getUserState(env, session.label);
  const storedChats = preparedIncoming.map(toStoredChat) as StoredChat[];
  if (mode === "replace") {
    await state.replaceChats(storedChats);
  } else {
    for (const chat of storedChats) await state.upsertChat(chat);
  }
  for (const chat of preparedIncoming) {
    if (await syncLegacyChatToAgent(env, session.label, chat) === "deleted") {
      await state.deleteChat(chat.id, 0);
    }
  }
  if (mode === "replace") {
    const incomingIds = new Set(preparedIncoming.map((chat) => chat.id));
    const root = await getTeamAgent(env, session.label);
    for (const conversation of await root.listConversations()) {
      if (incomingIds.has(conversation.id)) continue;
      const deleted = await root.deleteConversation(conversation.id, conversation.updatedAt);
      if (deleted.ok) await attemptAgentConversationCleanup(env, session.label, conversation.id, root);
    }
  }
  const chats = await state.listChats();
  return jsonResponse({
    ok: true,
    mode,
    count: chats.length,
    chats,
  });
}

async function handleAdminRouteHealth(request: Request, env: Env): Promise<Response> {
  const body = await readJson<{ routeId?: unknown }>(request);
  const routeId = typeof body.routeId === "string" ? body.routeId.trim() : "";
  if (!routeId) {
    return jsonResponse({ error: "route_id_required" }, 400);
  }

  const config = await loadAppConfig(env);
  const route = config.routes[routeId];
  if (!route) {
    return jsonResponse({ error: "route_not_found", message: "线路不存在" }, 404);
  }

  return jsonResponse(await inspectRouteStatus(env, routeId, route));
}

async function handleGetAdminRouteHealth(env: Env): Promise<Response> {
  const config = await loadAppConfig(env);
  const entries = await Promise.all(Object.entries(config.routes).map(async ([routeId, route]) => (
    [routeId, await inspectRouteStatus(env, routeId, route)] as const
  )));
  return jsonResponse({ routes: Object.fromEntries(entries) });
}

async function handleGetAdminReliability(env: Env): Promise<Response> {
  const config = await loadAppConfig(env);
  const providers = new Map<string, {
    provider: ProviderConfig;
    label: string;
    enabled: boolean;
    routes: AdminReliabilityRouteProjection[];
  }>();

  for (const [providerId, provider] of Object.entries(config.providers)) {
    providers.set(providerId, {
      provider,
      label: provider.label,
      enabled: provider.enabled !== false,
      routes: [],
    });
  }

  for (const [routeId, route] of Object.entries(config.routes)) {
    const offerings = route.offerings?.length
      ? route.offerings
      : route.type && route.baseUrl && route.model
        ? [{ providerId: `legacy:${routeId}`, model: route.model, enabled: route.enabled !== false }]
        : [];
    for (const offering of offerings) {
      const providerId = offering.providerId;
      let entry = providers.get(providerId);
      if (!entry && providerId === `legacy:${routeId}` && route.type && route.baseUrl && route.model) {
        const legacyProvider: ProviderConfig = {
          label: route.label,
          type: route.type,
          baseUrl: route.baseUrl,
          apiKey: route.apiKey,
          apiKeyRef: route.apiKeyRef,
          authHeader: route.authHeader,
          authPrefix: route.authPrefix,
          directEndpoint: route.directEndpoint,
          allowUserKey: route.allowUserKey,
          requiresUserKey: route.requiresUserKey,
          supportsImages: route.supportsImages,
          supportsTools: route.supportsTools,
          concurrency: "unlimited",
          queueTimeoutMs: 0,
          priority: 0,
        };
        entry = { provider: legacyProvider, label: route.label, enabled: route.enabled !== false, routes: [] };
        providers.set(providerId, entry);
      }
      if (!entry || entry.routes.some((item) => item.routeId === routeId)) continue;
      const loadedRecord = await loadProviderRouteReliability(env, routeId, providerId);
      const record = isRecentProviderRouteReliability(loadedRecord) ? loadedRecord : null;
      entry.routes.push({
        routeId,
        model: offering.model,
        enabled: route.enabled !== false && offering.enabled !== false,
        attempts: record?.attempts || 0,
        successes: record?.successes || 0,
        averageLatencyMs: record?.averageLatencyMs || 0,
        ...(record?.lastOutcome ? { lastOutcome: record.lastOutcome } : {}),
        ...(record?.observedAt ? { observedAt: record.observedAt } : {}),
        ...(record?.lastFallback === undefined ? {} : { lastFallback: record.lastFallback }),
        ...(record?.fallbackCount === undefined ? {} : { fallbackCount: record.fallbackCount }),
        ...(record?.streamSamples === undefined ? {} : {
          streamSamples: record.streamSamples,
          progressiveSamples: record.progressiveSamples,
          averageFirstVisibleLatencyMs: record.averageFirstVisibleLatencyMs,
          lastFirstVisibleLatencyMs: record.lastFirstVisibleLatencyMs,
          lastStreamShape: record.lastStreamShape,
        }),
      });
    }
  }

  const projected = await Promise.all([...providers.entries()].map(async ([providerId, entry]) => {
    const credentialStatus = await inspectAdminProviderCredential(env, providerId, entry.provider);
    const concurrency = entry.provider.concurrency || "unlimited";
    return {
      providerId,
      label: entry.label,
      enabled: entry.enabled,
      credentialStatus,
      concurrency,
      ...(entry.provider.maxConcurrent === undefined ? {} : { maxConcurrent: entry.provider.maxConcurrent }),
      queueTimeoutMs: entry.provider.queueTimeoutMs || 0,
      routes: entry.routes.sort((left, right) => left.routeId.localeCompare(right.routeId)),
    } satisfies AdminReliabilityProviderProjection;
  }));

  projected.sort((left, right) => left.label.localeCompare(right.label) || left.providerId.localeCompare(right.providerId));
  return jsonResponse({ generatedAt: new Date().toISOString(), providers: projected });
}

async function inspectAdminProviderCredential(
  env: Env,
  providerId: string,
  provider: ProviderConfig,
): Promise<AdminReliabilityProviderProjection["credentialStatus"]> {
  if (provider.requiresUserKey === true) return "user_key_required";
  if (provider.apiKey || provider.apiKeyRef) {
    const candidate: ResolvedProviderRoute = {
      routeId: `__admin__${providerId}`,
      providerId,
      label: provider.label,
      type: provider.type,
      baseUrl: provider.baseUrl,
      model: "__admin__",
      apiKey: provider.apiKey,
      apiKeyRef: provider.apiKeyRef,
      authHeader: provider.authHeader,
      authPrefix: provider.authPrefix,
      directEndpoint: provider.directEndpoint,
      headers: provider.headers,
      allowUserKey: provider.allowUserKey !== false,
      requiresUserKey: false,
      supportsImages: provider.supportsImages !== false,
      supportsTools: provider.supportsTools === true,
      concurrency: provider.concurrency || "unlimited",
      maxConcurrent: provider.concurrency === "exclusive"
        ? 1
        : provider.concurrency === "bounded" ? provider.maxConcurrent || 1 : MAX_PROVIDER_CONCURRENCY,
      queueTimeoutMs: provider.queueTimeoutMs || 0,
      priority: provider.priority || 0,
    };
    try {
      if (await resolveRouteKey(candidate, env, "")) return "configured";
    } catch {
      return "unavailable";
    }
  }
  return "missing";
}

async function inspectRouteStatus(env: Env, routeId: string, route: RouteConfig): Promise<RouteStatusProjection> {
  const enabled = route.enabled !== false;
  let credentialStatus: RouteStatusProjection["credentialStatus"] = "missing";
  const config = await loadAppConfig(env);
  const candidates = resolveProviderRouteCandidates(routeId, route, config.providers);
  let unavailable = false;
  let userKeyRequired = false;
  for (const candidate of candidates) {
    if (candidate.requiresUserKey) {
      userKeyRequired = true;
      continue;
    }
    try {
      if (await resolveRouteKey(candidate, env, "")) {
        credentialStatus = "configured";
        break;
      }
    } catch {
      unavailable = true;
    }
  }
  if (credentialStatus !== "configured") {
    credentialStatus = userKeyRequired ? "user_key_required" : unavailable ? "unavailable" : "missing";
  }

  const configured = credentialStatus === "configured" || credentialStatus === "user_key_required";
  const storedReliability = await loadRouteReliability(env, routeId);
  const reliability = isRecentRouteReliability(storedReliability) ? storedReliability : null;
  let status: RouteReadinessStatus = "unknown";
  let message = "配置已就绪，暂无近期真实任务记录";

  if (!enabled) {
    status = "disabled";
    message = "线路已停用，不参与用户请求";
  } else if (!configured) {
    status = "unavailable";
    message = credentialStatus === "unavailable" ? "线路密钥当前不可读取" : "未配置可用的线路密钥";
  } else if (reliability) {
    status = reliability.ok ? "healthy" : "unhealthy";
    message = reliability.ok ? "最近真实任务成功" : routeReliabilityMessage(reliability.outcome);
  }

  return {
    routeId,
    status,
    source: "passive",
    enabled,
    configured,
    credentialStatus,
    model: route.label,
    type: candidates[0]?.type || "openai-chat",
    message,
    reliability,
    checkedAt: reliability?.observedAt,
    latencyMs: reliability?.latencyMs,
  };
}

async function withPublicRouteHealth(env: Env, route: PublicRoute): Promise<PublicRoute> {
  const reliability = await loadRouteReliability(env, route.id);
  if (!isRecentRouteReliability(reliability)) return { ...route, healthStatus: "unknown" };
  return {
    ...route,
    healthStatus: reliability.ok ? "healthy" : "unhealthy",
    healthCheckedAt: reliability.observedAt,
    healthSource: "real_task",
    healthOutcome: reliability.outcome,
  };
}

type CloudChat = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  summary: string;
  summaryUntil: number;
  pinned: boolean;
  routeId?: string;
  parentChatId?: string;
  skillIds: string[];
  messages: ChatMessage[];
};

function chatIndexKey(label: string): string {
  return `chats:${encodeURIComponent(label)}:index`;
}

async function handleAdminRouteModels(request: Request, env: Env): Promise<Response> {
  const body = await readJson<{
    providerId?: unknown;
    routeId?: unknown;
  }>(request);
  const providerId = typeof body.providerId === "string" ? body.providerId.trim() : "";
  const routeId = typeof body.routeId === "string" ? body.routeId.trim() : "";
  const config = await loadAppConfig(env);
  const existing = routeId && hasOwn(config.routes, routeId) ? config.routes[routeId] : undefined;
  const existingProvider = providerId && hasOwn(config.providers, providerId)
    ? config.providers[providerId]
    : undefined;
  const legacyCandidate = existing && routeId && isLegacyRouteConfig(existing)
    ? resolveProviderRouteCandidates(routeId, existing, config.providers)[0]
    : undefined;
  if (providerId && !existingProvider) {
    return jsonResponse({ error: "provider_not_found", message: "请先保存服务商配置" }, 404);
  }
  if (!providerId && !routeId) {
    return jsonResponse({ error: "provider_required", message: "必须指定已保存的 providerId" }, 400);
  }
  if (!providerId && !legacyCandidate) {
    return jsonResponse({ error: "route_not_found", message: "未找到可用的已保存线路" }, 404);
  }
  const type = existingProvider?.type || legacyCandidate?.type || "openai-chat";
  const baseUrl = existingProvider?.baseUrl || legacyCandidate?.baseUrl || "";
  const apiKeyRef = existingProvider?.apiKeyRef || legacyCandidate?.apiKeyRef;
  if (!/^https?:\/\//i.test(baseUrl)) {
    return jsonResponse({ error: "invalid_base_url", message: "请填写有效的 http(s) Base URL" }, 400);
  }

  const route: ResolvedProviderRoute = {
    routeId: routeId || "model-discovery",
    providerId: providerId || legacyCandidate?.providerId || "model-discovery",
    label: existingProvider?.label || existing?.label || providerId || routeId || "服务提供商",
    type,
    baseUrl,
    model: legacyCandidate?.model || "model-list",
    apiKeyRef,
    apiKey: existingProvider?.apiKey || legacyCandidate?.apiKey,
    authHeader: existingProvider?.authHeader || legacyCandidate?.authHeader,
    authPrefix: existingProvider?.authPrefix || legacyCandidate?.authPrefix,
    directEndpoint: existingProvider?.directEndpoint || legacyCandidate?.directEndpoint,
    headers: existingProvider?.headers || legacyCandidate?.headers,
    allowUserKey: false,
    requiresUserKey: false,
    supportsImages: true,
    supportsTools: false,
    concurrency: "unlimited",
    maxConcurrent: 100,
    queueTimeoutMs: 10_000,
    priority: 0,
  };
  let apiKey = "";
  try {
    apiKey = await resolveRouteKey(route, env, "");
  } catch (error) {
    return routeSecretAdminErrorResponse(error);
  }
  if (!apiKey) {
    return jsonResponse(
      { error: "missing_key", message: "无法读取线路密钥，请检查 API Key Ref 是否对应 Worker Secret" },
      400,
    );
  }

  const headers = buildHeaders(route.headers);
  setAuthHeader(headers, route, apiKey, type === "anthropic-messages" ? "x-api-key" : "Authorization");
  headers.set("Accept", "application/json");
  if (type === "anthropic-messages" && !headers.has("anthropic-version")) {
    headers.set("anthropic-version", DEFAULT_ANTHROPIC_VERSION);
  }

  const endpoint = routeModelsUrl(route);
  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    const text = await response.text();
    if (!response.ok) {
      return jsonResponse(
        {
          error: "model_list_failed",
          message: formatUpstreamErrorMessage(text) || `上游返回 HTTP ${response.status}`,
          status: response.status,
          endpoint,
        },
        502,
      );
    }
    const payload = JSON.parse(text) as unknown;
    const models = extractModelList(payload);
    if (!models.length) {
      return jsonResponse({ error: "empty_model_list", message: "上游没有返回可识别的模型列表", endpoint }, 502);
    }
    return jsonResponse({ models, count: models.length, endpoint });
  } catch (error) {
    return jsonResponse(
      {
        error: "model_list_failed",
        message: error instanceof Error ? error.message : "拉取模型失败",
        endpoint,
      },
      502,
    );
  }
}

function routeModelsUrl(route: ResolvedProviderRoute): string {
  const base = route.baseUrl.trim().replace(/\/+$/, "");
  if (route.directEndpoint) {
    return base
      .replace(/\/chat\/completions$/i, "/models")
      .replace(/\/messages$/i, "/models");
  }
  if (route.type === "anthropic-messages") {
    return /\/v1$/i.test(base) ? `${base}/models` : `${base}/v1/models`;
  }
  return `${base}/models`;
}

function extractModelList(payload: unknown): string[] {
  if (!isRecord(payload)) return [];
  const candidates = Array.isArray(payload.data)
    ? payload.data
    : Array.isArray(payload.models)
      ? payload.models
      : [];
  const models = candidates
    .map((item) => {
      if (typeof item === "string") return item;
      if (!isRecord(item)) return "";
      if (typeof item.id === "string") return item.id;
      if (typeof item.name === "string") return item.name;
      if (typeof item.model === "string") return item.model;
      return "";
    })
    .map((model) => model.trim())
    .filter((model) => model && model.length <= 200);
  return [...new Set(models)].sort((a, b) => a.localeCompare(b)).slice(0, 500);
}

async function handleAdminMcpDiscovery(request: Request, env: Env): Promise<Response> {
  const body = await readJson<{
    serverId?: unknown;
    label?: unknown;
    endpoint?: unknown;
    auth?: unknown;
    authType?: unknown;
    secretRef?: unknown;
    memberLabel?: unknown;
  }>(request);
  const serverId = normalizeCapabilityId(body.serverId, 80);
  if (!serverId) return jsonResponse({ error: "invalid_mcp_server_id", message: "MCP Server ID 格式无效" }, 400);
  if (body.memberLabel !== undefined) {
    const memberLabel = normalizeMemberLabel(body.memberLabel);
    if (!memberLabel) return jsonResponse({ error: "invalid_member_label", message: "成员 label 无效" }, 400);
    const config = await loadAppConfig(env);
    const configured = config.mcpServers?.[serverId];
    if (!configured || configured.enabled !== true || configured.auth.type !== "oauth2") {
      return jsonResponse({ error: "mcp_oauth_not_available", message: "OAuth MCP 服务未启用" }, 404);
    }
    try {
      const candidate = await getUserState(env, memberLabel).getMcpOAuthDiscoveryCandidate({
        ownerLabel: memberLabel,
        serverId,
        configRevision: configured.auth.configRevision,
      });
      const discovery = candidate
        ? normalizeStoredMcpOAuthDiscovery(JSON.parse(candidate.discoveryJson), serverId)
        : null;
      if (!discovery) {
        return jsonResponse({
          error: "mcp_oauth_discovery_unavailable",
          message: "该成员尚无可审查的 OAuth MCP 发现候选",
        }, 409);
      }
      await appendAdminAudit(env, "mcp.discovery.candidate", `${serverId}:${discovery.tools.length}/${discovery.rejected}`);
      return jsonResponse(discovery);
    } catch (error) {
      if (error instanceof McpOAuthError) return mcpOAuthJsonError(error);
      throw error;
    }
  }
  const auth = normalizeMcpAuthConfig(body);
  if (!auth) {
    return jsonResponse({ error: "invalid_mcp_auth_type", message: "MCP 认证类型无效" }, 400);
  }
  const endpoint = normalizeBoundedText(body.endpoint, 2_048);
  const server = await applyMcpOAuthConfigRevision(serverId, {
    enabled: true,
    label: normalizeBoundedText(body.label, 80) || serverId,
    endpoint,
    auth,
  });
  if (!isValidMcpEndpoint(server.endpoint) || isForbiddenMcpUrl(new URL(server.endpoint))) {
    return jsonResponse({ error: "mcp_endpoint_invalid", message: "MCP 地址必须是可公开访问的 HTTPS 地址" }, 400);
  }
  if ((server.auth.type === "bearer" || server.auth.type === "x-api-key") && !server.auth.secretRef) {
    return jsonResponse({ error: "mcp_auth_unavailable", message: "该认证类型需要有效的 Secret Ref" }, 400);
  }
  if (server.auth.type === "oauth2") {
    return jsonResponse({
      error: "mcp_oauth_discovery_candidate_required",
      message: "OAuth MCP 发现必须由已连接成员生成候选后再由管理员审查",
    }, 409);
  }
  try {
    const discovery = await mcpRuntime(env).discoverTools(serverId, server, request.signal);
    await appendAdminAudit(env, "mcp.discovery", `${serverId}:${discovery.tools.length}/${discovery.rejected}`);
    return jsonResponse(discovery);
  } catch (error) {
    const capabilityError = toCapabilityError(error);
    return jsonResponse({ error: capabilityError.code, message: capabilityError.message }, 502);
  }
}

async function loadChatSessions(env: Env, label: string): Promise<CloudChat[]> {
  await migrateLegacyChatIndex(env, label);
  return getUserState(env, label).listChats();
}

async function migrateLegacyChatIndex(env: Env, label: string): Promise<void> {
  const raw = await env.CHAT_STORE.get(chatIndexKey(label));
  if (!raw?.trim()) return;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    const chats = parsed
      .map((item) => normalizeCloudChat(item))
      .filter((item): item is CloudChat => Boolean(item))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_CLOUD_SESSIONS);
    const stored = chats.map(toStoredChat).filter((chat): chat is StoredChat => Boolean(chat));
    if (stored.length !== chats.length) return;
    await getUserState(env, label).migrateLegacyChats(stored);
    await env.CHAT_STORE.delete(chatIndexKey(label));
  } catch {
    // Keep malformed legacy data for manual recovery instead of deleting it silently.
  }
}

async function ensureAgentLegacyImport(env: Env, label: string): Promise<void> {
  const root = await getTeamAgent(env, label);
  if (await root.hasMigration(AGENT_LEGACY_MIGRATION_ID)) return;
  const [chats, memory] = await Promise.all([
    loadLegacyChatSessionsForAgent(env, label),
    env.CHAT_STORE.get(memoryKey(label)),
  ]);
  for (const chat of chats) {
    await syncLegacyChatToAgent(env, label, chat, root);
  }
  await root.importLegacyMemory(memory || "");
  await root.completeMigration(AGENT_LEGACY_MIGRATION_ID);
}

async function syncLegacyChatToAgent(
  env: Env,
  label: string,
  chat: CloudChat,
  root: DurableObjectStub<TeamAgent> | Promise<DurableObjectStub<TeamAgent>> = getTeamAgent(env, label),
): Promise<"active" | "deleted" | "invalid"> {
  const agentRoot = await root;
  const messages = toAgentUiMessages(chat.messages);
  const conversation: AgentConversationInput = {
    id: chat.id,
    title: chat.title,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    summary: chat.summary,
    pinned: chat.pinned,
    routeId: chat.routeId,
    parentChatId: chat.parentChatId,
    skillIds: chat.skillIds,
    messageCount: messages.length,
  };
  const imported = await agentRoot.importLegacyConversation(conversation);
  if (imported.state !== "active") return imported.state;
  const conversationAgent = await getTeamAgentConversation(env, label, chat.id);
  const synced = await conversationAgent.syncLegacyMessages(messages);
  if (synced.synced) await agentRoot.syncLegacyConversationMetadata(conversation, synced.messageCount);
  return "active";
}

type CleanupRoot = DurableObjectStub<TeamAgent> | TeamAgent;

async function drainAgentConversationCleanup(
  env: Env,
  label: string,
  root: CleanupRoot | Promise<CleanupRoot> = getTeamAgent(env, label),
  now = Date.now(),
  scheduleFailures = true,
): Promise<void> {
  const agentRoot = await root;
  let pending;
  try {
    pending = await agentRoot.listPendingConversationCleanups(3, now, true);
  } catch (error) {
    if (!scheduleFailures) throw error;
    await agentRoot.refreshCleanupSchedule(now + 5_000, scheduleFailures).catch(() => undefined);
    return;
  }
  await Promise.all(pending.map((record) => attemptAgentConversationCleanup(
    env,
    label,
    record.chatId,
    agentRoot,
    now,
    scheduleFailures,
  )));
  if (scheduleFailures) await agentRoot.refreshCleanupSchedule(now, true).catch(() => undefined);
}

async function attemptAgentConversationCleanup(
  env: Env,
  label: string,
  chatId: string,
  root: CleanupRoot | Promise<CleanupRoot> = getTeamAgent(env, label),
  now = Date.now(),
  scheduleFailures = true,
): Promise<boolean> {
  const agentRoot = await root;
  try {
    const conversation = await getTeamAgentConversation(env, label, chatId);
    await conversation.clearConversation();
    await getUserState(env, label).deleteChat(chatId, 0);
    await agentRoot.completeConversationCleanup(chatId);
    return true;
  } catch {
    await agentRoot.recordConversationCleanupFailure(
      chatId,
      "conversation_cleanup_failed",
      now,
      scheduleFailures,
    ).catch(() => undefined);
    return false;
  }
}

async function loadLegacyChatSessionsForAgent(env: Env, label: string): Promise<CloudChat[]> {
  const merged = new Map<string, CloudChat>();
  const durableChats = await getUserState(env, label).listChats();
  for (const chat of durableChats) merged.set(chat.id, chat);
  const raw = await env.CHAT_STORE.get(chatIndexKey(label));
  if (raw?.trim()) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const value of parsed) {
          const chat = normalizeCloudChat(value);
          const current = chat ? merged.get(chat.id) : undefined;
          if (chat && (!current || chat.updatedAt > current.updatedAt)) merged.set(chat.id, chat);
        }
      }
    } catch {
      // Preserve malformed rollback data and continue with the durable source.
    }
  }
  return [...merged.values()]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, Math.min(MAX_CLOUD_SESSIONS, MAX_AGENT_CONVERSATIONS));
}

function toAgentUiMessages(messages: ChatMessage[]): UIMessage[] {
  const output: UIMessage[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (!message) continue;
    const parts: UIMessage["parts"] = [];
    if (typeof message.content === "string") {
      if (message.content.trim()) parts.push({ type: "text", text: message.content });
    } else {
      for (const part of message.content) {
        if (part.type === "text" && part.text.trim()) parts.push({ type: "text", text: part.text });
        if (part.type === "image_url" && part.image_url.url.startsWith("data:image/")) {
          parts.push({
            type: "file",
            mediaType: dataUrlMediaType(part.image_url.url) || "image/*",
            url: part.image_url.url,
          });
        }
      }
    }
    if (!parts.length) continue;
    output.push({
      id: `legacy-${index}-${Math.max(0, Math.floor(message.createdAt || 0))}`,
      role: message.role,
      parts,
      ...(message.role === "assistant" && (message.finishReason === "length" || message.finishReason === "max_tokens")
        ? { metadata: { finishReason: "length" as const } }
        : {}),
    });
  }
  return output;
}

function dataUrlMediaType(value: string): string {
  const parsed = parseDataImage(value);
  return parsed.ok ? parsed.image.mediaType : "";
}

async function purgeAgentUserData(
  env: Env,
  label: string,
  rootInput: CleanupRoot | Promise<CleanupRoot> = getTeamAgent(env, label),
  now = Date.now(),
  scheduleFailures = true,
): Promise<{ operationId: string; generation: number }> {
  const root = await rootInput;
  const purge = await root.beginWorkspaceAccountPurge(crypto.randomUUID());
  if ("error" in purge) throw new Error(purge.error);
  try {
    if (!purge.completed) {
      await deleteWorkspaceObjects(env.WORKSPACE_FILES, purge.objectKeys);
      if (!(await root.completeWorkspaceAccountPurge(purge.operationId, purge.generation))) {
        throw new Error("workspace_account_purge_finalize_failed");
      }
    }
    const conversationIds = await root.getAllConversationIds();
    await Promise.all(conversationIds.map(async (chatId) => {
      const conversation = await getTeamAgentConversation(env, label, chatId);
      await conversation.clearConversation();
    }));
    await root.purgeRootData();
    return { operationId: purge.operationId, generation: purge.generation };
  } catch (error) {
    await root.recordWorkspaceOperationFailure(
      purge.operationId,
      purge.generation,
      "workspace_account_purge_failed",
      now,
      scheduleFailures,
    ).catch(() => undefined);
    throw error;
  }
}

async function attemptMemberAccountCleanup(
  env: Env,
  label: string,
  rootInput: CleanupRoot | Promise<CleanupRoot> = getTeamAgent(env, label),
  now = Date.now(),
  scheduleFailures = true,
  registerRequest = true,
): Promise<number> {
  const root = await rootInput;
  let purge: { operationId: string; generation: number } | undefined;
  try {
    if (registerRequest) await root.registerAccountCleanupRequest(now);
    purge = await purgeAgentUserData(env, label, root, now, scheduleFailures);
    const [revoked] = await Promise.all([
      revokeSessionsByLabel(env, label),
      getUserState(env, label).purgeUserData(),
    ]);
    await Promise.all([
      env.CHAT_STORE.delete(memoryKey(label)),
      env.CHAT_STORE.delete(chatIndexKey(label)),
      feedbackAuditService(env).removeFeedbackByLabel(label),
      ...Array.from({ length: METRICS_DAYS }, (_, index) =>
        env.CHAT_STORE.delete(usageKey(label, utcDayString(index))),
      ),
    ]);
    if (!(await root.releaseWorkspaceAccountPurge(purge.operationId, purge.generation))) {
      throw new Error("workspace_account_purge_release_failed");
    }
    return revoked;
  } catch (error) {
    if (purge) {
      await root.recordWorkspaceOperationFailure(
        purge.operationId,
        purge.generation,
        "account_cleanup_failed",
        now,
        scheduleFailures,
      ).catch(() => undefined);
    }
    throw error;
  }
}

async function drainWorkspaceOperations(
  env: Env,
  root: CleanupRoot,
  label: string,
  now = Date.now(),
  scheduleFailures = true,
): Promise<void> {
  let attemptedAccountCleanup = false;
  let operations;
  try {
    operations = await root.listPendingWorkspaceOperations(3, now, true);
  } catch (error) {
    if (!scheduleFailures) throw error;
    await root.refreshCleanupSchedule(now + 5_000, scheduleFailures).catch(() => undefined);
    return;
  }
  for (const operation of operations) {
    if (operation.kind === "account_purge") {
      if (await root.hasAccountCleanupRequest()) {
        attemptedAccountCleanup = true;
        await attemptMemberAccountCleanup(env, label, root, now, scheduleFailures, false).catch(() => undefined);
      } else {
        try {
          await deleteWorkspaceObjects(env.WORKSPACE_FILES, operation.objectKeys);
          if (!(await root.completeWorkspaceAccountPurge(operation.operationId, operation.generation))) {
            throw new Error("workspace_account_purge_finalize_failed");
          }
        } catch {
          await root.recordWorkspaceOperationFailure(
            operation.operationId,
            operation.generation,
            "workspace_account_purge_failed",
            now,
            scheduleFailures,
          ).catch(() => undefined);
        }
      }
      continue;
    }
    try {
      if (operation.kind === "upload") {
        if (operation.state === "failed") {
          await deleteWorkspaceObjects(env.WORKSPACE_FILES, operation.objectKeys);
          await root.abandonWorkspaceUpload(operation.operationId, operation.generation);
          continue;
        }
        const objectKey = operation.objectKeys[0];
        if (!objectKey) throw new Error("workspace_object_key_missing");
        const object = await env.WORKSPACE_FILES.get(objectKey);
        if (!object) {
          if (now - operation.updatedAt >= WORKSPACE_PENDING_UPLOAD_MISSING_OBJECT_TIMEOUT_MS) {
            await root.recordWorkspaceOperationFailure(
              operation.operationId,
              operation.generation,
              "workspace_object_unavailable",
              now,
              scheduleFailures,
            );
          } else {
            await root.deferWorkspaceOperation(
              operation.operationId,
              operation.generation,
              operation.updatedAt + WORKSPACE_PENDING_UPLOAD_MISSING_OBJECT_TIMEOUT_MS,
            );
          }
          continue;
        }
        const bytes = await object.arrayBuffer();
        if (bytes.byteLength !== operation.size || await sha256HexBytes(bytes) !== operation.checksum) {
          await deleteWorkspaceObjects(env.WORKSPACE_FILES, [objectKey]);
          await root.recordWorkspaceOperationFailure(
            operation.operationId,
            operation.generation,
            "workspace_object_checksum_mismatch",
            now,
            scheduleFailures,
          );
          continue;
        }
        const completed = await root.completeWorkspaceUpload(operation.operationId, operation.generation);
        if (!completed.ok) throw new Error("workspace_upload_finalize_failed");
        continue;
      }

      await deleteWorkspaceObjects(env.WORKSPACE_FILES, operation.objectKeys);
      const completed = await root.completeWorkspaceFileDelete(operation.operationId, operation.generation);
      if (!completed) throw new Error("workspace_operation_finalize_failed");
    } catch {
      await root.recordWorkspaceOperationFailure(
        operation.operationId,
        operation.generation,
        "workspace_reconcile_failed",
        now,
        scheduleFailures,
      ).catch(() => undefined);
    }
  }
  if (
    !attemptedAccountCleanup
    && await root.hasAccountCleanupRequest()
    && !(await root.hasWorkspaceAccountPurgeOperation())
  ) {
    await attemptMemberAccountCleanup(env, label, root, now, scheduleFailures, false).catch(() => undefined);
  }
  if (scheduleFailures) await root.refreshCleanupSchedule(now, true).catch(() => undefined);
}

export async function runTeamAgentCleanupSchedule(
  env: Env,
  label: string,
  root: TeamAgent,
): Promise<void> {
  const now = Date.now();
  const guest = await root.getDueGuestCleanup(now);
  if (guest) {
    await cleanupGuestData(env, label, guest.markerKey, root, now, false);
    return;
  }
  await drainWorkspaceOperations(env, root, label, now, false);
  await drainAgentConversationCleanup(env, label, root, now, false);
}

async function deleteWorkspaceObjects(bucket: R2Bucket, objectKeys: string[]): Promise<void> {
  const unique = [...new Set(objectKeys.filter(Boolean))];
  for (let index = 0; index < unique.length; index += 1_000) {
    await bucket.delete(unique.slice(index, index + 1_000));
  }
}

function agentConversationIdFromPath(url: URL): string {
  const prefix = "/api/agent/conversations/";
  const encoded = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : "";
  if (!encoded || encoded.includes("/")) return "";
  try {
    return normalizeAgentConversationId(decodeURIComponent(encoded));
  } catch {
    return "";
  }
}

function normalizeAgentConversationId(value: unknown): string {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  if (!normalized || normalized.length > 80 || /[\u0000-\u001f\u007f]/.test(normalized)) return "";
  return normalized;
}

function finitePositiveInteger(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function toStoredChat(chat: CloudChat): StoredChat | null {
  const serializedBytes = new TextEncoder().encode(JSON.stringify(chat)).byteLength;
  return serializedBytes <= MAX_CLOUD_SESSION_BYTES ? { ...chat, serializedBytes } : null;
}

function summarizeChat(chat: CloudChat) {
  return {
    id: chat.id,
    title: chat.title,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    summary: chat.summary,
    summaryUntil: chat.summaryUntil,
    pinned: chat.pinned,
    routeId: chat.routeId,
    parentChatId: chat.parentChatId,
    skillIds: chat.skillIds,
    messageCount: chat.messages.length,
  };
}

function normalizeCloudChat(value: unknown): CloudChat | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === "string" ? value.id.trim() : "";
  if (!id || id.length > 80) return null;

  const messages = normalizeCloudMessages(value.messages);
  const createdAt = Number.isFinite(value.createdAt) ? Number(value.createdAt) : Date.now();
  const updatedAt = Number.isFinite(value.updatedAt) ? Number(value.updatedAt) : Date.now();
  const title =
    typeof value.title === "string" && value.title.trim()
      ? value.title.trim().slice(0, 80)
      : deriveTitleFromMessages(messages);
  const summary = typeof value.summary === "string" ? value.summary.trim().slice(0, DEFAULT_SUMMARY_CHARS) : "";
  const summaryUntil = Number.isFinite(value.summaryUntil) ? Number(value.summaryUntil) : 0;
  const pinned = value.pinned === true;
  const routeId = typeof value.routeId === "string" ? value.routeId.trim().slice(0, 80) : undefined;
  const parentChatId = typeof value.parentChatId === "string" ? value.parentChatId.trim().slice(0, 80) : undefined;
  const skillIds = normalizeSelectedSkillIds(value.skillIds);

  return {
    id,
    title,
    createdAt,
    updatedAt,
    summary,
    summaryUntil,
    pinned,
    routeId,
    parentChatId,
    skillIds,
    messages,
  };
}

function normalizeCloudMessages(input: unknown): ChatMessage[] {
  if (!Array.isArray(input)) return [];
  const output: ChatMessage[] = [];
  for (const item of input.slice(-MAX_CLOUD_MESSAGES)) {
    if (!isRecord(item)) continue;
    const role = item.role;
    if (role !== "user" && role !== "assistant" && role !== "system") continue;

    if (typeof item.content === "string") {
      const content = item.content.slice(0, 20_000);
      if (!content.trim() && role !== "assistant") continue;
      output.push({
        role,
        content,
        routeId: role === "assistant" && typeof item.routeId === "string" ? item.routeId.slice(0, 80) : undefined,
        fallback: role === "assistant" && item.fallback === true,
        finishReason:
          role === "assistant" && typeof item.finishReason === "string" ? item.finishReason.slice(0, 40) : undefined,
        toolEvents: role === "assistant" ? normalizeToolEvents(item.toolEvents) : undefined,
        createdAt: Number.isFinite(item.createdAt) ? Number(item.createdAt) : undefined,
      });
      continue;
    }

    if (!Array.isArray(item.content)) continue;
    const parts: ChatPart[] = [];
    for (const part of item.content) {
      if (!isRecord(part)) continue;
      if (part.type === "text" && typeof part.text === "string") {
        parts.push({ type: "text", text: part.text.slice(0, 20_000) });
      }
      if (
        part.type === "image_url" &&
        isRecord(part.image_url) &&
        typeof part.image_url.url === "string" &&
        part.image_url.url.startsWith("data:image/") &&
        part.image_url.url.length < 2_500_000
      ) {
        parts.push({ type: "image_url", image_url: { url: part.image_url.url } });
      }
    }
    if (parts.length) output.push({
      role,
      content: parts,
      routeId: role === "assistant" && typeof item.routeId === "string" ? item.routeId.slice(0, 80) : undefined,
      fallback: role === "assistant" && item.fallback === true,
      finishReason:
        role === "assistant" && typeof item.finishReason === "string" ? item.finishReason.slice(0, 40) : undefined,
      toolEvents: role === "assistant" ? normalizeToolEvents(item.toolEvents) : undefined,
      createdAt: Number.isFinite(item.createdAt) ? Number(item.createdAt) : undefined,
      rating: item.rating === "up" || item.rating === "down" ? item.rating : undefined,
      ratingReason: typeof item.ratingReason === "string" ? item.ratingReason : undefined,
    });
  }
  return output;
}

function deriveTitleFromMessages(messages: ChatMessage[]): string {
  const firstUser = messages.find((message) => message.role === "user");
  if (!firstUser) return "新会话";
  const text = extractText(firstUser.content).replace(/\s+/g, " ").trim();
  if (!text) return "新会话";
  return text.length > 18 ? `${text.slice(0, 18)}…` : text;
}

async function handleToolApproval(request: Request, env: Env, session: Session): Promise<Response> {
  if (request.headers.get("x-chatus-client") !== "web") return jsonResponse({ error: "forbidden" }, 403);
  const body = await readJson<{ runId?: unknown; callId?: unknown; decision?: unknown }>(request);
  const runId = normalizeCapabilityId(body.runId, 100);
  const callId = normalizeCapabilityId(body.callId, 100);
  const decision = body.decision;
  if (!runId || !callId || (decision !== "once" && decision !== "conversation" && decision !== "deny")) {
    return jsonResponse({ error: "invalid_tool_approval" }, 400);
  }
  const result = await getUserState(env, session.label).resolveToolApproval(runId, callId, decision);
  if (result.invalidDecision) return jsonResponse({ error: "invalid_tool_approval_decision" }, 400);
  if (!result.resolved) return jsonResponse({ error: "tool_approval_not_pending" }, 409);
  return jsonResponse({ ok: true });
}

async function handleChat(request: Request, env: Env, session: Session): Promise<Response> {
  const length = Number(request.headers.get("content-length") || "0");
  if (length > MAX_REQUEST_BYTES) {
    return jsonResponse({ error: "request_too_large" }, 413);
  }

  if (request.headers.get("x-chatus-client") !== "web") {
    return jsonResponse({ error: "forbidden" }, 403);
  }

  const config = await loadAppConfig(env);
  const access = await getRouteAccess(config, session, env);
  if (!access.routes.length) {
    return jsonResponse({ error: "no_routes_available" }, 403);
  }

  const body = await readJson<{
    messages?: unknown;
    routeId?: unknown;
    chatId?: unknown;
    skillIds?: unknown;
    userApiKey?: unknown;
    temperature?: unknown;
    sessionSummary?: unknown;
  }>(request);
  const selectedRoute = typeof body.routeId === "string" ? body.routeId : access.defaultRoute;
  if (session.kind === "guest" && selectedRoute !== config.publicAccess.routeId) {
    return jsonResponse({ error: "route_not_allowed", message: "访客只能使用公开模型" }, 403);
  }
  const normalization = normalizeMessages(body.messages, env, { fileInput: session.kind === "member" });
  if (!normalization.ok) {
    return jsonResponse({ error: normalization.error, message: normalization.message }, normalization.status);
  }
  const normalized = trimMessagesForContext(normalization.messages, env);
  if (!normalized.length) {
    return jsonResponse({ error: "empty_messages" }, 400);
  }
  const sessionSummary =
    typeof body.sessionSummary === "string"
      ? body.sessionSummary.trim().slice(0, numberEnv(env.MAX_SUMMARY_CHARS, DEFAULT_SUMMARY_CHARS))
      : "";

  const latestPrompt = getLatestUserPrompt(normalized);
  if (
    latestPrompt &&
    !latestPrompt.hasImages &&
    isBlockedPrompt(latestPrompt.text, getBlockedPrompts(env, access.user))
  ) {
    return jsonResponse({ error: "blocked_prompt", message: BLOCKED_PROMPT_MESSAGE }, 400);
  }

  const hasImages = messagesContainImages(normalized);
  const selectedPublicRoute =
    access.routes.find((route) => route.id === selectedRoute) ||
    access.routes.find((route) => route.id === access.defaultRoute);
  if (hasImages && selectedPublicRoute?.supportsImages === false) {
    return jsonResponse({ error: "image_not_supported", routeId: selectedPublicRoute.id }, 400);
  }

  const routeIds = buildProviderRoutePlan(selectedRoute, config.routes, access).filter((routeId) => {
    if (!hasImages) return true;
    return config.routes[routeId]?.supportsImages !== false;
  });
  if (!routeIds.length) {
    return jsonResponse({ error: hasImages ? "image_not_supported" : "route_not_allowed" }, hasImages ? 400 : 403);
  }

  const admission = await quotaAdmissionService(env).admitTurn(session, access);
  if (!admission.ok) {
    if (admission.error === "rate_limited") {
      await recordChatMetric(env, { kind: "rate_limited", label: session.label });
    }
    return jsonResponse(
      {
        error: admission.error,
        ...(admission.reset ? { reset: admission.reset } : {}),
        ...(admission.scope ? { scope: admission.scope } : {}),
      },
      429,
      {
        "Retry-After": String(admission.retryAfter),
        "X-RateLimit-Remaining": "0",
      },
    );
  }

  const selectedSkills = getSelectedSkills(config, body.skillIds, access.user);
  const messages = await buildMessagesWithSystem(env, session, normalized, sessionSummary, access.user, selectedSkills);

  const userApiKey = typeof body.userApiKey === "string" ? body.userApiKey.trim() : "";
  const toolDefinitions = selectedPublicRoute?.supportsTools
    ? await buildCapabilityToolDefinitions(config, access.user, selectedSkills, secretFingerprint)
    : [];
  if (toolDefinitions.length) {
    const capabilityRouteIds = routeIds.filter((routeId) => config.routes[routeId]?.supportsTools === true);
    if (!capabilityRouteIds.length) {
      return jsonResponse({ error: "route_does_not_support_tools", routeId: selectedPublicRoute?.id }, 400);
    }
    const chatId = normalizeCapabilityId(body.chatId, 80);
    if (!chatId) return jsonResponse({ error: "invalid_chat_id" }, 400);
    return getUserState(env, session.label).runCapabilityChat({
      session,
      access,
      config,
      selectedRoute: selectedPublicRoute?.id || selectedRoute,
      routeIds: capabilityRouteIds,
      messages,
      tools: toolDefinitions,
      userApiKey,
      temperature: body.temperature,
      remaining: admission.remaining,
      chatId,
    });
  }
  const prepared = await providerPlanRuntime(env, config).preparePlan({
    routeIds,
    accessRoutes: access.routes,
    userApiKey,
    accepts: (route) => !hasImages || route.supportsImages,
  });
  if (prepared.userKeyRequiredRouteId) {
    return jsonResponse({ error: "user_api_key_required", routeId: prepared.userKeyRequiredRouteId }, 400);
  }
  const remaining = [...prepared.candidates];
  let lastError: { routeId: string; status: number; message: string } | null = prepared.lastError
    ? { ...prepared.lastError, status: 500 }
    : null;
  let attemptedRoutes = 0;

  while (remaining.length) {
    const acquired = await acquireFirstAvailableProvider(env, remaining, request.signal);
    if (!acquired) {
      lastError = { routeId: remaining[0].routeId, status: 429, message: "当前服务提供商繁忙，请稍后重试" };
      break;
    }
    const { candidate: route, lease } = acquired;
    remaining.splice(remaining.indexOf(route), 1);
    const routeId = route.routeId;
    attemptedRoutes += 1;
    const startedAt = Date.now();
    const fallback = route.planIndex > 0 || attemptedRoutes > 1;
    let handedOff = false;
    try {
      const result = await callRoute({
        route,
        routeId,
        apiKey: route.credential.apiKey,
        usedUserKey: route.credential.usedUserKey,
        messages,
        temperature: body.temperature,
        env,
        signal: request.signal,
      });

      if (result.response) {
        result.response.headers.set("X-RateLimit-Remaining", String(admission.remaining));
        result.response.headers.set("X-Chatus-Route", routeId);
        const response = responseWithProviderLease(result.response, lease, {
          onComplete: async () => {
            await admission.release();
            await recordRouteReliability(env, {
              routeId,
              providerId: route.providerId,
              ok: true,
              fallback,
              startedAt,
            });
            await recordChatMetric(env, { kind: "success", label: session.label, routeId, fallback });
          },
          onError: async (error) => {
            await admission.release();
            await recordRouteReliability(env, {
              routeId,
              providerId: route.providerId,
              ok: false,
              status: providerErrorStatus(error),
              error,
              outcome: upstreamReliabilityOutcome(error),
              fallback,
              startedAt,
              usedUserKey: route.credential.usedUserKey,
            });
            await recordChatMetric(env, { kind: "route_error", label: session.label, routeId });
            await recordChatMetric(env, { kind: "failure", label: session.label });
          },
        }, result.cancelUpstream, request.signal);
        handedOff = true;
        return response;
      }

      lastError = result.error;
      await recordRouteReliability(env, {
        routeId,
        providerId: route.providerId,
        ok: false,
        status: result.error.status,
        fallback,
        startedAt,
        usedUserKey: route.credential.usedUserKey,
      });
      await recordChatMetric(env, { kind: "route_error", label: session.label, routeId });
      if (result.terminal) break;
    } catch (error) {
      if (request.signal.aborted) {
        await admission.release();
        throw error;
      }
      const status = providerErrorStatus(error);
      lastError = {
        routeId,
        status: status || 502,
        message: error instanceof Error ? error.message : "upstream request failed",
      };
      await recordRouteReliability(env, {
        routeId,
        providerId: route.providerId,
        ok: false,
        status,
        error,
        outcome: upstreamReliabilityOutcome(error),
        fallback,
        startedAt,
        usedUserKey: route.credential.usedUserKey,
      });
      await recordChatMetric(env, { kind: "route_error", label: session.label, routeId });
    } finally {
      if (!handedOff) await lease.release();
    }
  }

  await admission.release();
  await recordChatMetric(env, {
    kind: "failure",
    label: session.label,
    // route-level errors already recorded per attempt
  });

  return jsonResponse(
    {
      error: lastError?.status === 429 ? "provider_busy" : "upstream_error",
      routeId: lastError?.routeId,
      status: lastError?.status,
      message: lastError?.message || "no route succeeded",
    },
    lastError?.status === 429 ? 429 : 502,
  );
}

export type TeamAgentTurnInput = {
  messages: ChatMessage[];
  continuation?: boolean;
  routeId?: string;
  skillMode?: ConversationSkillMode;
  skillIds?: string[];
  userApiKey?: string;
  sessionSummary?: string;
  temperature?: number;
  longTermMemory?: string;
  workspaceContext?: string;
  abortSignal?: AbortSignal;
};

export type PreparedTeamAgentTurn =
  | {
      ok: true;
      model: LanguageModelV3;
      messages: ModelMessage[];
      systemMessages: ModelMessage[];
      toolDefinitions: NormalizedToolDefinition[];
      memoryToolEnabled: boolean;
      runTool: CapabilityToolRunner;
      closeTools: () => Promise<void>;
      maxToolSteps: number;
      remaining: number;
      routeId: string;
      skillIds: string[];
      skillSelection?: AgentSkillSelectionMetadata;
      skillSnapshotIds?: string[];
      recordStreamFailure: () => Promise<void>;
      releaseTurn: () => Promise<void>;
    }
  | { ok: false; error: string; message: string; status: number; routeId?: string };

export async function prepareTeamAgentTurn(
  env: Env,
  session: Session,
  input: TeamAgentTurnInput,
): Promise<PreparedTeamAgentTurn> {
  let config = await loadAppConfig(env);
  if (session.expiresAt <= Date.now()) {
    return { ok: false, error: "session_expired", message: "登录会话已过期，请重新连接", status: 401 };
  }
  if (session.kind === "guest" && !config.publicAccess.enabled) {
    return { ok: false, error: "public_access_disabled", message: "公开访问已关闭", status: 403 };
  }
  let access = await getRouteAccess(config, session, env);
  if (!access.routes.length) {
    return { ok: false, error: "no_routes_available", message: "没有可用线路", status: 403 };
  }

  const normalization = normalizeMessages(input.messages, env, { fileInput: session.kind === "member" });
  if (!normalization.ok) return normalization;
  const normalized = trimMessagesForContext(normalization.messages, env);
  if (!normalized.length) {
    return { ok: false, error: "empty_messages", message: "消息不能为空", status: 400 };
  }

  const latestPrompt = getLatestUserPrompt(normalized);
  if (
    latestPrompt &&
    !latestPrompt.hasImages &&
    isBlockedPrompt(latestPrompt.text, getBlockedPrompts(env, access.user))
  ) {
    return { ok: false, error: "blocked_prompt", message: BLOCKED_PROMPT_MESSAGE, status: 400 };
  }

  const selectedRoute = input.routeId || access.defaultRoute;
  if (session.kind === "guest" && selectedRoute !== config.publicAccess.routeId) {
    return { ok: false, error: "route_not_allowed", message: "访客只能使用公开模型", status: 403 };
  }
  let selectedPublicRoute = access.routes.find((route) => route.id === selectedRoute)
    || access.routes.find((route) => route.id === access.defaultRoute);
  let memoryToolEnabled = session.kind === "member" && selectedPublicRoute?.supportsTools === true;
  if (messagesContainImages(normalized) && selectedPublicRoute?.supportsImages === false) {
    return {
      ok: false,
      error: "image_not_supported",
      message: "当前线路不支持图片消息",
      status: 400,
      routeId: selectedPublicRoute.id,
    };
  }

  let skillSelection: AgentSkillSelectionMetadata | undefined;
  let skillSnapshotIds: string[] | undefined;
  let selectedSkillIds = input.skillIds || [];
  if (session.kind === "member" && input.skillMode === "automatic" && selectedPublicRoute) {
    const selectorAttempt = await runAutomaticSkillSelector(env, {
      config,
      access,
      routeId: selectedPublicRoute.id,
      userApiKey: input.userApiKey?.trim() || "",
      latestUserText: latestPrompt?.text || "",
      signal: input.abortSignal,
    });

    config = await loadAppConfig(env);
    access = await getRouteAccess(config, session, env);
    if (!access.routes.length) {
      return { ok: false, error: "no_routes_available", message: "没有可用线路", status: 403 };
    }
    selectedPublicRoute = access.routes.find((route) => route.id === selectedRoute)
      || access.routes.find((route) => route.id === access.defaultRoute);
    memoryToolEnabled = selectedPublicRoute?.supportsTools === true;
    const resolved = resolveAutomaticSkillSelection(
      config,
      access.user,
      selectorAttempt,
      input.skillIds,
    );
    selectedSkillIds = resolved.skillIds;
    skillSelection = resolved.metadata;
    if (resolved.metadata.source === "model") skillSnapshotIds = resolved.skillIds;
  }
  const selectedSkills = getSelectedSkills(config, selectedSkillIds, access.user);
  const messages = await buildMessagesWithSystem(
    env,
    session,
    normalized,
    input.sessionSummary || "",
    access.user,
    selectedSkills,
    input.longTermMemory,
    input.workspaceContext,
  );
  const systemMessageCount = Math.max(0, messages.length - normalized.length);
  const systemMessages = toProviderModelMessages(messages.slice(0, systemMessageCount));
  const toolDefinitions = selectedPublicRoute?.supportsTools
    ? await buildCapabilityToolDefinitions(config, access.user, selectedSkills, secretFingerprint)
    : [];
  const routeIds = buildProviderRoutePlan(selectedRoute, config.routes, access);
  const userApiKey = input.userApiKey?.trim() || "";
  const hasImages = messagesContainImages(normalized);
  const prepared = await providerPlanRuntime(env, config).preparePlan({
    routeIds,
    accessRoutes: access.routes,
    userApiKey,
    accepts: (route, publicRoute) => (
      (!hasImages || (publicRoute.supportsImages && route.supportsImages))
      && (!(toolDefinitions.length || memoryToolEnabled) || route.supportsTools)
    ),
  });
  if (prepared.userKeyRequiredRouteId) {
    return {
      ok: false,
      error: "user_api_key_required",
      message: "需要填写 API Key",
      status: 400,
      routeId: prepared.userKeyRequiredRouteId,
    };
  }
  const candidates: FallbackModelCandidate[] = [];
  const credentials = new Map<string, ProviderCredential>();
  const lastError = prepared.lastError;

  for (const route of prepared.candidates) {
    const routeId = route.routeId;
    credentials.set(routeProviderKey(routeId, route.providerId), route.credential);
    candidates.push({
      routeId,
      providerId: route.providerId,
      model: createProviderLanguageModel(route, route.credential.apiKey),
      usedUserKey: route.credential.usedUserKey,
      acquireLease: (waitMs, signal) => acquireProviderLease(env, route, waitMs, signal),
      settings: {
        temperature: clampNumber(input.temperature, 0, route.type === "anthropic-messages" ? 1 : 2, route.temperature ?? 0.7),
        maxOutputTokens: route.maxTokens || numberEnv(env.DEFAULT_MAX_TOKENS, 4096),
      },
    });
  }

  if (!candidates.length) {
    await recordChatMetric(env, { kind: "failure", label: session.label });
    return {
      ok: false,
      error: "upstream_error",
      message: lastError?.message || "no route succeeded",
      status: 502,
      routeId: lastError?.routeId,
    };
  }

  const admission = await quotaAdmissionService(env).admitTurn(session, access, input.continuation !== true);
  if (!admission.ok) {
    if (admission.error === "rate_limited") {
      await recordChatMetric(env, { kind: "rate_limited", label: session.label });
    }
    return {
      ok: false,
      error: admission.error,
      message: admission.error === "concurrent_turn" ? "当前访客会话已有任务正在运行" : "额度已用完",
      status: 429,
    };
  }

  let streamFailureRecorded = false;
  const recordStreamFailure = async () => {
    if (streamFailureRecorded) return;
    streamFailureRecorded = true;
    await recordChatMetric(env, { kind: "failure", label: session.label });
  };

  const model = createFallbackLanguageModel(candidates, {
    onSuccess: async (event) => {
      await recordRouteReliability(env, {
        routeId: event.routeId,
        providerId: event.providerId,
        ok: true,
        fallback: event.fallback,
        startedAt: event.startedAt,
        firstVisibleLatencyMs: event.firstVisibleLatencyMs,
        streamShape: event.streamShape,
      });
      await recordChatMetric(env, {
        kind: "success",
        label: session.label,
        routeId: event.routeId,
        fallback: event.fallback,
      });
    },
    onFailure: async (event) => {
      const credential = credentials.get(routeProviderKey(event.routeId, event.providerId));
      await recordRouteReliability(env, {
        routeId: event.routeId,
        providerId: event.providerId,
        ok: false,
        fallback: event.fallback,
        startedAt: event.startedAt,
        status: event.status,
        error: event.error,
        outcome: event.protocolError ? "protocol_error" : undefined,
        usedUserKey: credential?.usedUserKey,
      });
      await recordChatMetric(env, { kind: "route_error", label: session.label, routeId: event.routeId });
    },
  });
  const toolRuntime = createAgentCapabilityRuntime(toolDefinitions, env, session.label);

  return {
    ok: true,
    model,
    messages: toProviderModelMessages(messages),
    systemMessages,
    toolDefinitions,
    memoryToolEnabled,
    runTool: toolRuntime.runTool,
    closeTools: toolRuntime.close,
    maxToolSteps: MAX_TOOL_ROUNDS,
    remaining: admission.remaining,
    routeId: selectedPublicRoute?.id || selectedRoute,
    skillIds: selectedSkills.map(({ id }) => id),
    skillSelection,
    skillSnapshotIds,
    recordStreamFailure,
    releaseTurn: admission.release,
  };
}

type AutomaticSkillSelectorAttempt = {
  skillIds?: string[];
  reason?: AgentSkillSelectionReason;
};

async function runAutomaticSkillSelector(
  env: Env,
  args: {
    config: AppConfig;
    access: RouteAccess;
    routeId: string;
    userApiKey: string;
    latestUserText: string;
    signal?: AbortSignal;
  },
): Promise<AutomaticSkillSelectorAttempt> {
  const availableSkills = getPublicCapabilities(args.config, args.access.user).skills;
  if (!availableSkills.length) return { reason: "no_valid_skills" };

  const controller = new AbortController();
  let resolveBoundary: (attempt: AutomaticSkillSelectorAttempt) => void = () => undefined;
  const boundary = new Promise<AutomaticSkillSelectorAttempt>((resolve) => {
    resolveBoundary = resolve;
  });
  const abortAtBoundary = (reason: unknown) => {
    if (!controller.signal.aborted) controller.abort(reason);
    resolveBoundary({ reason: "timeout" });
  };
  const abortFromParent = () => abortAtBoundary(args.signal?.reason);
  if (args.signal?.aborted) return { reason: "timeout" };
  args.signal?.addEventListener("abort", abortFromParent, { once: true });
  const deadline = setTimeout(() => {
    abortAtBoundary(new DOMException("Skill selection timed out", "TimeoutError"));
  }, SKILL_SELECTOR_DEADLINE_MS);
  const attempt = runAutomaticSkillSelectorAttempt(env, args, availableSkills, controller.signal)
    .catch((): AutomaticSkillSelectorAttempt => ({
      reason: controller.signal.aborted ? "timeout" : "provider_error",
    }));

  try {
    return await Promise.race([attempt, boundary]);
  } finally {
    clearTimeout(deadline);
    args.signal?.removeEventListener("abort", abortFromParent);
  }
}

async function runAutomaticSkillSelectorAttempt(
  env: Env,
  args: {
    config: AppConfig;
    access: RouteAccess;
    routeId: string;
    userApiKey: string;
    latestUserText: string;
  },
  availableSkills: ReturnType<typeof getPublicCapabilities>["skills"],
  signal: AbortSignal,
): Promise<AutomaticSkillSelectorAttempt> {
  const prepared = await providerPlanRuntime(env, args.config).preparePlan({
    routeIds: [args.routeId],
    accessRoutes: args.access.routes,
    userApiKey: args.userApiKey,
  });
  if (signal.aborted) return { reason: "timeout" };
  if (!prepared.candidates.length || prepared.userKeyRequiredRouteId) {
    return { reason: "provider_error" };
  }

  const remaining = [...prepared.candidates];
  let attempted = 0;
  let lastReason: AgentSkillSelectionReason = "provider_error";
  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "Select one to three relevant Skills for the current user message. "
        + "Return only strict JSON with exactly this shape: {\"skillIds\":[\"id\"]}. "
        + "Use only IDs from the candidate list. Do not call tools or add prose.",
    },
    {
      role: "user",
      content: JSON.stringify({
        skills: availableSkills.map(({ id, label, description }) => ({ id, label, description })),
        message: args.latestUserText.slice(0, SKILL_SELECTOR_MAX_PROMPT_CHARS),
      }),
    },
  ];

  while (remaining.length && !signal.aborted) {
    let acquired: { candidate: (typeof remaining)[number]; lease: ProviderLease } | null;
    try {
      acquired = await acquireFirstAvailableProvider(env, remaining, signal);
    } catch (error) {
      return { reason: signal.aborted || isAbortLikeError(error) ? "timeout" : "provider_error" };
    }
    if (!acquired) return { reason: signal.aborted ? "timeout" : "provider_busy" };
    const { candidate: route, lease } = acquired;
    remaining.splice(remaining.indexOf(route), 1);
    attempted += 1;
    const startedAt = Date.now();
    const fallback = route.planIndex > 0 || attempted > 1;
    try {
      const text = await completeOnce({
        route,
        apiKey: route.credential.apiKey,
        messages,
        temperature: 0,
        maxTokens: SKILL_SELECTOR_MAX_OUTPUT_TOKENS,
        env,
        signal,
      });
      signal.throwIfAborted();
      const parsed = parseAutomaticSkillSelection(text, args.config, args.access.user);
      if (parsed.skillIds?.length) {
        await recordRouteReliability(env, {
          operation: "skill_selection",
          routeId: route.routeId,
          providerId: route.providerId,
          ok: true,
          fallback,
          startedAt,
        });
        return { skillIds: parsed.skillIds };
      }
      lastReason = parsed.reason || "invalid_response";
      await recordRouteReliability(env, {
        operation: "skill_selection",
        routeId: route.routeId,
        providerId: route.providerId,
        ok: false,
        outcome: "protocol_error",
        fallback,
        startedAt,
      });
    } catch (error) {
      const status = providerErrorStatus(error);
      lastReason = signal.aborted || isAbortLikeError(error) ? "timeout" : "provider_error";
      await recordRouteReliability(env, {
        operation: "skill_selection",
        routeId: route.routeId,
        providerId: route.providerId,
        ok: false,
        status,
        error,
        fallback,
        startedAt,
        usedUserKey: route.credential.usedUserKey,
      });
      if (signal.aborted) return { reason: "timeout" };
      if (
        error instanceof UpstreamRequestError
        && isTerminalProviderFailure(error.status, route.credential.usedUserKey)
      ) {
        break;
      }
    } finally {
      await lease.release();
    }
  }
  return { reason: signal.aborted ? "timeout" : lastReason };
}

function parseAutomaticSkillSelection(
  text: string,
  config: AppConfig,
  user: UserConfig,
): AutomaticSkillSelectorAttempt {
  if (!text.trim()) return { reason: "empty_response" };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { reason: "invalid_response" };
  }
  if (
    !isRecord(value)
    || Object.keys(value).length !== 1
    || !Array.isArray(value.skillIds)
    || value.skillIds.some((id) => typeof id !== "string")
  ) return { reason: "invalid_response" };
  const requested = normalizeSelectedSkillIds(value.skillIds);
  const selected = getSelectedSkills(config, requested, user).map(({ id }) => id);
  return selected.length ? { skillIds: selected } : { reason: "no_valid_skills" };
}

function resolveAutomaticSkillSelection(
  config: AppConfig,
  user: UserConfig,
  attempt: AutomaticSkillSelectorAttempt,
  previousSkillIds: unknown,
): { skillIds: string[]; metadata: AgentSkillSelectionMetadata } {
  const modelSelection = getSelectedSkills(config, attempt.skillIds, user);
  if (modelSelection.length) {
    return {
      skillIds: modelSelection.map(({ id }) => id),
      metadata: {
        mode: "automatic",
        source: "model",
        skills: modelSelection.map(({ id, skill }) => ({ id, label: skill.label })),
      },
    };
  }
  const reason = attempt.skillIds?.length ? "no_valid_skills" : attempt.reason || "provider_error";
  const previous = getSelectedSkills(config, previousSkillIds, user);
  const selected = previous.length
    ? previous
    : getSelectedSkills(
        config,
        getPublicCapabilities(config, user).skills.slice(0, MAX_SELECTED_SKILLS).map(({ id }) => id),
        user,
      );
  const source = previous.length ? "last_success" as const : "admin_default" as const;
  return {
    skillIds: selected.map(({ id }) => id),
    metadata: {
      mode: "automatic",
      source,
      reason,
      skills: selected.map(({ id, skill }) => ({ id, label: skill.label })),
    },
  };
}

function isAbortLikeError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}


async function loadAppConfig(env: Env): Promise<AppConfig> {
  const stored = await env.CHAT_STORE.get(ROUTES_CONFIG_KEY);
  if (stored?.trim()) {
    try {
      return finalizeLoadedAppConfig(env, normalizeAppConfig(JSON.parse(stored)));
    } catch {
      await env.CHAT_STORE.delete(ROUTES_CONFIG_KEY);
    }
  }

  return getAppConfig(env);
}

async function loadEditableConfig(env: Env): Promise<{ config: AppConfig; source: "kv" | "secret" | "default" }> {
  const stored = await env.CHAT_STORE.get(ROUTES_CONFIG_KEY);
  if (stored?.trim()) {
    try {
      return { config: await finalizeLoadedAppConfig(env, normalizeAppConfig(JSON.parse(stored))), source: "kv" };
    } catch {
      await env.CHAT_STORE.delete(ROUTES_CONFIG_KEY);
    }
  }

  if (env.ROUTES_CONFIG?.trim()) {
    try {
      return {
        config: await finalizeLoadedAppConfig(env, normalizeAppConfig(JSON.parse(env.ROUTES_CONFIG))),
        source: "secret",
      };
    } catch {
      return { config: await finalizeLoadedAppConfig(env, getDefaultAppConfig(env)), source: "default" };
    }
  }

  return { config: await finalizeLoadedAppConfig(env, getDefaultAppConfig(env)), source: "default" };
}

async function getAppConfig(env: Env): Promise<AppConfig> {
  if (env.ROUTES_CONFIG?.trim()) {
    try {
      return finalizeLoadedAppConfig(env, normalizeAppConfig(JSON.parse(env.ROUTES_CONFIG)));
    } catch {
      return finalizeLoadedAppConfig(env, getDefaultAppConfig(env));
    }
  }

  return finalizeLoadedAppConfig(env, getDefaultAppConfig(env));
}

async function finalizeLoadedAppConfig(env: Env, config: AppConfig): Promise<AppConfig> {
  const revised = await applyMcpOAuthConfigRevisions(config);
  const overlay = await loadMcpToolDriftOverlay(env);
  return applyMcpToolDriftOverlay(revised, overlay);
}

async function loadMcpToolDriftOverlay(env: Env): Promise<McpToolDriftOverlay> {
  const stored = await env.CHAT_STORE.get(MCP_TOOL_DRIFT_KEY);
  return decodeMcpToolDriftOverlay(stored) || { version: 1, tools: {} };
}

function decodeMcpToolDriftOverlay(stored: string | null): McpToolDriftOverlay | null {
  if (!stored?.trim()) return null;
  try {
    const value: unknown = JSON.parse(stored);
    if (!isRecord(value) || !hasOnlyRecordKeys(value, ["version", "tools"]) || value.version !== 1 || !isRecord(value.tools)) {
      return null;
    }
    const entries = Object.entries(value.tools);
    if (entries.length > MAX_TOOLS) return null;
    const tools: Record<string, McpToolDriftEntry> = {};
    for (const [toolId, entry] of entries) {
      if (
        normalizeCapabilityId(toolId, 160) !== toolId
        || !toolId.startsWith("mcp:")
        || !isRecord(entry)
        || !hasOnlyRecordKeys(entry, ["reviewRevision", "observedAt"])
        || typeof entry.reviewRevision !== "string"
        || !isSecretFingerprint(entry.reviewRevision)
        || typeof entry.observedAt !== "string"
        || !isCanonicalIsoTimestamp(entry.observedAt)
      ) {
        return null;
      }
      tools[toolId] = { reviewRevision: entry.reviewRevision, observedAt: entry.observedAt };
    }
    return { version: 1, tools };
  } catch {
    return null;
  }
}

function applyMcpToolDriftOverlay(config: AppConfig, overlay: McpToolDriftOverlay): AppConfig {
  if (!config.tools || Object.keys(overlay.tools).length === 0) return config;
  let nextTools: Record<string, ToolConfig> | undefined;
  for (const [toolId, drift] of Object.entries(overlay.tools)) {
    const tool = config.tools[toolId];
    if (
      !tool
      || tool.executor.type !== "mcp"
      || tool.reviewRevision !== drift.reviewRevision
      || (tool.enabled !== true && tool.reviewRequired === true)
    ) {
      continue;
    }
    nextTools ||= { ...config.tools };
    nextTools[toolId] = { ...tool, enabled: false, reviewRequired: true };
  }
  return nextTools ? { ...config, tools: nextTools } : config;
}

async function recordMcpToolDrift(env: Env, toolId: string, reviewRevision: string): Promise<void> {
  const config = await loadAppConfig(env);
  const current = config.tools?.[toolId];
  if (
    !current
    || current.executor.type !== "mcp"
    || current.enabled !== true
    || current.reviewRequired === true
    || current.reviewRevision !== reviewRevision
  ) {
    return;
  }
  const overlay = await loadMcpToolDriftOverlay(env);
  const tools = {
    ...overlay.tools,
    [toolId]: { reviewRevision, observedAt: new Date().toISOString() },
  };
  const overflow = Object.entries(tools).length - MAX_TOOLS;
  if (overflow > 0) {
    for (const [staleId] of Object.entries(tools)
      .sort((left, right) => left[1].observedAt.localeCompare(right[1].observedAt))
      .slice(0, overflow)) {
      delete tools[staleId];
    }
  }
  await env.CHAT_STORE.put(MCP_TOOL_DRIFT_KEY, JSON.stringify({ version: 1, tools } satisfies McpToolDriftOverlay));
}

async function reconcileMcpToolDriftOverlay(env: Env, config: AppConfig): Promise<void> {
  const overlay = await loadMcpToolDriftOverlay(env);
  const tools = Object.fromEntries(Object.entries(overlay.tools).filter(([toolId, drift]) => {
    const tool = config.tools?.[toolId];
    return tool?.executor.type === "mcp"
      && tool.reviewRevision === drift.reviewRevision
      && !(tool.enabled === true && tool.reviewRequired !== true);
  }));
  if (Object.keys(tools).length === 0) {
    if (Object.keys(overlay.tools).length > 0) await env.CHAT_STORE.delete(MCP_TOOL_DRIFT_KEY);
    return;
  }
  if (JSON.stringify(tools) !== JSON.stringify(overlay.tools)) {
    await env.CHAT_STORE.put(MCP_TOOL_DRIFT_KEY, JSON.stringify({ version: 1, tools } satisfies McpToolDriftOverlay));
  }
}

function isCanonicalIsoTimestamp(value: string): boolean {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function hasOnlyRecordKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function getDefaultAppConfig(env: Env): AppConfig {
  return normalizeAppConfig({
    routes: {
      default: {
        label: "默认线路",
        type: "openai-chat",
        baseUrl: env.UPSTREAM_BASE_URL || "https://api.openai.com/v1",
        apiKeyRef: "UPSTREAM_API_KEY",
        model: env.MODEL_NAME || "gpt-4o-mini",
        supportsImages: true,
      },
    },
    defaults: {
      defaultRoute: "default",
      allowedRoutes: ["default"],
      allowBringYourOwnKey: false,
      dailyMessageLimit: numberEnv(env.DAILY_MESSAGE_LIMIT, DEFAULT_DAILY_LIMIT),
      blockedPrompts: parsePromptList(env.BLOCKED_PROMPTS),
    },
    tools: { "builtin:text_stats": defaultTextStatsTool() },
  });
}

function validateAppConfig(config: AppConfig): { ok: true } | { ok: false; message: string } {
  const routeIds = Object.keys(config.routes);
  if (!routeIds.length) {
    return { ok: false, message: "至少需要一条有效线路" };
  }
  const enabledRouteIds = routeIds.filter((id) => config.routes[id].enabled !== false);
  if (!enabledRouteIds.length) {
    return { ok: false, message: "至少需要启用一条线路" };
  }
  if (config.publicAccess.enabled) {
    const guestRoute = config.routes[config.publicAccess.routeId];
    if (!guestRoute || guestRoute.enabled === false) {
      return { ok: false, message: "公开访问必须选择一条已启用的逻辑模型" };
    }
  }

  const invalidFallback = routeIds.find((id) => config.routes[id].fallbacks?.some((fallback) => !config.routes[fallback]));
  if (invalidFallback) {
    return { ok: false, message: `线路 ${invalidFallback} 包含不存在的 fallback` };
  }

  for (const [providerId, provider] of Object.entries(config.providers)) {
    if (!/^https?:\/\//i.test(provider.baseUrl)) {
      return { ok: false, message: `服务提供商 ${providerId} 的 Base URL 无效` };
    }
    if (provider.concurrency === "bounded" && (!provider.maxConcurrent || provider.maxConcurrent < 1)) {
      return { ok: false, message: `服务提供商 ${providerId} 的并发上限无效` };
    }
  }
  for (const [routeId, route] of Object.entries(config.routes)) {
    const missingProvider = route.offerings?.find((offering) => !hasOwn(config.providers, offering.providerId));
    if (missingProvider) {
      return { ok: false, message: `逻辑模型 ${routeId} 引用了不存在的服务提供商 ${missingProvider.providerId}` };
    }
    if (!resolveProviderRouteCandidates(routeId, route, config.providers).length) {
      return { ok: false, message: `逻辑模型 ${routeId} 至少需要一个有效服务提供商` };
    }
  }

  const users = Object.entries(config.users || {});
  for (const [label, user] of users) {
    if (!isValidMemberLabel(label)) {
      return { ok: false, message: `用户 ${label} 的 label 无效或使用了访客保留前缀` };
    }
    if (user.defaultRoute && !config.routes[user.defaultRoute]) {
      return { ok: false, message: `用户 ${label} 的默认线路不存在` };
    }

    const missingRoute = user.allowedRoutes?.find((routeId) => !config.routes[routeId]);
    if (missingRoute) {
      return { ok: false, message: `用户 ${label} 允许了不存在的线路 ${missingRoute}` };
    }
    const missingSkill = user.allowedSkills?.find((skillId) => !config.skills?.[skillId]);
    if (missingSkill) return { ok: false, message: `用户 ${label} 允许了不存在的 Skill ${missingSkill}` };
    const missingTool = user.allowedTools?.find((toolId) => !config.tools?.[toolId]);
    if (missingTool) return { ok: false, message: `用户 ${label} 允许了不存在的工具 ${missingTool}` };
    const effective = { ...(config.defaults || {}), ...user };
    const allowed = effective.allowedRoutes?.length ? effective.allowedRoutes : routeIds;
    if (!allowed.some((routeId) => config.routes[routeId]?.enabled !== false)) {
      return { ok: false, message: `用户 ${label} 至少需要一条已启用的允许线路` };
    }
  }

  if (config.defaults?.defaultRoute && !config.routes[config.defaults.defaultRoute]) {
    return { ok: false, message: "默认用户配置的 defaultRoute 不存在" };
  }
  const defaultAllowed = config.defaults?.allowedRoutes?.length ? config.defaults.allowedRoutes : routeIds;
  if (!defaultAllowed.some((routeId) => config.routes[routeId]?.enabled !== false)) {
    return { ok: false, message: "默认用户配置至少需要一条已启用的允许线路" };
  }
  const missingDefaultTool = config.defaults?.allowedTools?.find((toolId) => !config.tools?.[toolId]);
  if (missingDefaultTool) return { ok: false, message: `默认用户配置允许了不存在的工具 ${missingDefaultTool}` };
  const missingDefaultSkill = config.defaults?.allowedSkills?.find((skillId) => !config.skills?.[skillId]);
  if (missingDefaultSkill) return { ok: false, message: `默认用户配置允许了不存在的 Skill ${missingDefaultSkill}` };

  for (const [skillId, skill] of Object.entries(config.skills || {})) {
    const missingTool = skill.toolIds?.find((toolId) => !config.tools?.[toolId]);
    if (missingTool) return { ok: false, message: `Skill ${skillId} 引用了不存在的工具 ${missingTool}` };
  }

  for (const [serverId, server] of Object.entries(config.mcpServers || {})) {
    if (server.enabled !== false && !isExecutableMcpServerConfig(server.endpoint, server.auth)) {
      return { ok: false, message: `MCP 服务 ${serverId} 必须使用有效的 HTTPS 地址` };
    }
    if (
      server.enabled !== false
      && (server.auth.type === "bearer" || server.auth.type === "x-api-key")
      && !MANAGED_SECRET_REF_PATTERN.test(server.auth.secretRef)
    ) {
      return { ok: false, message: `MCP 服务 ${serverId} 使用认证时必须配置 Secret Ref` };
    }
    if (server.enabled !== false && server.auth.type === "oauth2" && !isValidMcpOAuthConfig(server.auth)) {
      return { ok: false, message: `MCP 服务 ${serverId} 的 OAuth 配置无效` };
    }
  }

  for (const [toolId, tool] of Object.entries(config.tools || {})) {
    if (tool.executor.type === "mcp" && !config.mcpServers?.[tool.executor.serverId]) {
      return { ok: false, message: `工具 ${toolId} 引用了不存在的 MCP 服务 ${tool.executor.serverId}` };
    }
  }

  return { ok: true };
}

function validateRawProviderPoolConfiguration(value: unknown): { ok: true } | { ok: false; message: string } {
  if (!isRecord(value)) return { ok: true };
  const rawProviders = value.providers;
  if (rawProviders !== undefined && !isRecord(rawProviders)) {
    return { ok: false, message: "服务提供商配置必须是对象" };
  }
  const providers = isRecord(rawProviders) ? rawProviders : {};
  for (const [providerId, rawProvider] of Object.entries(providers)) {
    if (!PROVIDER_ID_PATTERN.test(providerId)) {
      return { ok: false, message: `服务提供商 ${providerId} 的 ID 无效，只能以字母或数字开头并包含字母、数字、点、下划线和短横线` };
    }
    if (!isRecord(rawProvider)) {
      return { ok: false, message: `服务提供商 ${providerId} 配置无效` };
    }
    if (rawProvider.type !== "openai-chat" && rawProvider.type !== "anthropic-messages") {
      return { ok: false, message: `服务提供商 ${providerId} 的协议无效` };
    }
    if (typeof rawProvider.baseUrl !== "string" || !/^https?:\/\//i.test(rawProvider.baseUrl.trim())) {
      return { ok: false, message: `服务提供商 ${providerId} 的 Base URL 无效` };
    }
    if (
      rawProvider.concurrency !== undefined
      && rawProvider.concurrency !== "unlimited"
      && rawProvider.concurrency !== "exclusive"
      && rawProvider.concurrency !== "bounded"
    ) {
      return { ok: false, message: `服务提供商 ${providerId} 的并发模式无效` };
    }
    if (rawProvider.concurrency === "bounded" && !isProviderCapacity(rawProvider.maxConcurrent)) {
      return { ok: false, message: `服务提供商 ${providerId} 的并发上限必须是 1 到 ${MAX_PROVIDER_CONCURRENCY} 的整数` };
    }
    if (
      rawProvider.queueTimeoutMs !== undefined
      && !isProviderQueueTimeout(rawProvider.queueTimeoutMs)
    ) {
      return { ok: false, message: `服务提供商 ${providerId} 的等待时间必须是 0 到 ${MAX_PROVIDER_QUEUE_TIMEOUT_MS} 毫秒` };
    }
    if (rawProvider.priority !== undefined && !isFiniteConfigNumber(rawProvider.priority)) {
      return { ok: false, message: `服务提供商 ${providerId} 的优先级无效` };
    }
  }

  if (!isRecord(value.routes)) return { ok: true };
  for (const [routeId, rawRoute] of Object.entries(value.routes)) {
    if (!isRecord(rawRoute) || rawRoute.offerings === undefined) continue;
    if (!Array.isArray(rawRoute.offerings)) {
      return { ok: false, message: `逻辑模型 ${routeId} 的服务提供商列表必须是数组` };
    }
    const legacy = (rawRoute.type === "openai-chat" || rawRoute.type === "anthropic-messages")
      && typeof rawRoute.baseUrl === "string"
      && rawRoute.baseUrl.trim()
      && typeof rawRoute.model === "string"
      && rawRoute.model.trim();
    if (!rawRoute.offerings.length && !legacy) {
      return { ok: false, message: `逻辑模型 ${routeId} 至少需要一个服务提供商` };
    }
    const seenProviderIds = new Set<string>();
    for (const rawOffering of rawRoute.offerings) {
      if (!isRecord(rawOffering)) {
        return { ok: false, message: `逻辑模型 ${routeId} 包含无效的服务提供商映射` };
      }
      const providerId = typeof rawOffering.providerId === "string" ? rawOffering.providerId.trim() : "";
      const model = typeof rawOffering.model === "string" ? rawOffering.model.trim() : "";
      if (!providerId || !model) {
        return { ok: false, message: `逻辑模型 ${routeId} 的服务提供商映射需要 providerId 和 model` };
      }
      if (!hasOwn(providers, providerId)) {
        return { ok: false, message: `逻辑模型 ${routeId} 引用了不存在的服务提供商 ${providerId}` };
      }
      if (seenProviderIds.has(providerId)) {
        return { ok: false, message: `逻辑模型 ${routeId} 重复引用了服务提供商 ${providerId}` };
      }
      seenProviderIds.add(providerId);
      if (rawOffering.priority !== undefined && !isFiniteConfigNumber(rawOffering.priority)) {
        return { ok: false, message: `逻辑模型 ${routeId} 的服务提供商优先级无效` };
      }
    }
  }
  return { ok: true };
}

function validateRawMcpConfiguration(value: unknown): { ok: true } | { ok: false; message: string } {
  if (!isRecord(value) || value.mcpServers === undefined) return { ok: true };
  if (!isRecord(value.mcpServers)) return { ok: false, message: "MCP 服务配置必须是对象" };
  if (Object.keys(value.mcpServers).length > MAX_MCP_SERVERS) {
    return { ok: false, message: `MCP 服务数量不能超过 ${MAX_MCP_SERVERS}` };
  }
  for (const [serverId, rawServer] of Object.entries(value.mcpServers)) {
    if (!normalizeCapabilityId(serverId, 80) || !isRecord(rawServer)) {
      return { ok: false, message: `MCP 服务 ${serverId} 配置无效` };
    }
    const endpoint = normalizeBoundedText(rawServer.endpoint, 2_048);
    if (!endpoint) {
      return { ok: false, message: `MCP 服务 ${serverId} 必须配置 endpoint` };
    }
    const disabledRecovery = rawServer.enabled === false;
    if (!disabledRecovery && (!isValidMcpEndpoint(endpoint) || isForbiddenMcpUrl(new URL(endpoint)))) {
      return { ok: false, message: `MCP 服务 ${serverId} 必须使用可公开访问的 HTTPS 地址` };
    }
    const auth = normalizeMcpAuthConfig(rawServer);
    if (!auth && !disabledRecovery) return { ok: false, message: `MCP 服务 ${serverId} 的认证配置无效` };
    if (!disabledRecovery && auth?.type === "oauth2") {
      const normalizedScopes = normalizeOAuthScopes(auth.scopes);
      if (!normalizedScopes.length || JSON.stringify(normalizedScopes) !== JSON.stringify(auth.scopes)) {
        return { ok: false, message: `MCP 服务 ${serverId} 的 OAuth scope 无效` };
      }
    }
    if (
      !disabledRecovery
      && !isRecord(rawServer.auth)
      && rawServer.authType === "none"
      && rawServer.secretRef !== undefined
    ) {
      return { ok: false, message: `MCP 服务 ${serverId} 无需认证时不能配置 Secret Ref` };
    }
  }
  return { ok: true };
}

function validateRawPublicAccessConfiguration(value: unknown): { ok: true } | { ok: false; message: string } {
  if (!isRecord(value) || value.publicAccess === undefined) return { ok: true };
  if (!isRecord(value.publicAccess)) return { ok: false, message: "公开访问配置必须是对象" };
  const input = value.publicAccess;
  const allowed = new Set([
    "enabled",
    "routeId",
    "sessionTtlSeconds",
    "dailyMessageLimit",
    "minuteMessageLimit",
    "sourceDailyMessageLimit",
    "sourceMinuteMessageLimit",
  ]);
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    return { ok: false, message: "公开访问配置包含未知字段" };
  }
  if (typeof input.enabled !== "boolean") return { ok: false, message: "公开访问开关无效" };
  if (typeof input.routeId !== "string" || (input.enabled && !input.routeId.trim())) {
    return { ok: false, message: "公开访问必须选择逻辑模型" };
  }
  const limits: Array<[string, number, number, string]> = [
    ["sessionTtlSeconds", 900, MAX_PUBLIC_SESSION_TTL_SECONDS, "访客会话有效期"],
    ["dailyMessageLimit", 1, MAX_GUEST_DAILY_LIMIT, "访客每日消息额度"],
    ["minuteMessageLimit", 1, MAX_GUEST_MINUTE_LIMIT, "访客每分钟消息额度"],
    ["sourceDailyMessageLimit", 1, MAX_GUEST_SOURCE_DAILY_LIMIT, "来源每日消息额度"],
    ["sourceMinuteMessageLimit", 1, MAX_GUEST_SOURCE_MINUTE_LIMIT, "来源每分钟消息额度"],
  ];
  for (const [key, minimum, maximum, label] of limits) {
    const item = input[key];
    if (typeof item !== "number" || !Number.isInteger(item) || item < minimum || item > maximum) {
      return { ok: false, message: `${label}必须是 ${minimum} 至 ${maximum} 的整数` };
    }
  }
  return { ok: true };
}

function isProviderCapacity(value: unknown): boolean {
  return typeof value === "number"
    && Number.isInteger(value)
    && value >= 1
    && value <= MAX_PROVIDER_CONCURRENCY;
}

function isProviderQueueTimeout(value: unknown): boolean {
  return typeof value === "number"
    && Number.isInteger(value)
    && value >= 0
    && value <= MAX_PROVIDER_QUEUE_TIMEOUT_MS;
}

function isFiniteConfigNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeAppConfig(value: unknown): AppConfig {
  const input = isRecord(value) ? value : {};
  const providers = normalizeProviderRegistry(input.providers);
  const rawRoutes = isRecord(input.routes) ? input.routes : {};
  const routes: Record<string, RouteConfig> = {};

  for (const [id, rawRoute] of Object.entries(rawRoutes)) {
    if (!isRecord(rawRoute)) continue;
    const type = rawRoute.type;
    const legacy = (type === "openai-chat" || type === "anthropic-messages")
      && typeof rawRoute.baseUrl === "string"
      && typeof rawRoute.model === "string";
    const offerings = normalizeModelOfferings(rawRoute.offerings, providers);
    if (!legacy && !offerings.length) continue;

    routes[id] = {
      enabled: rawRoute.enabled !== false,
      label: typeof rawRoute.label === "string" ? rawRoute.label : id,
      offerings: offerings.length ? offerings : undefined,
      type: legacy ? type : undefined,
      baseUrl: legacy ? rawRoute.baseUrl as string : undefined,
      model: legacy ? rawRoute.model as string : undefined,
      apiKey: legacy && typeof rawRoute.apiKey === "string" ? rawRoute.apiKey : undefined,
      apiKeyRef: legacy ? normalizeOptionalText(rawRoute.apiKeyRef) : undefined,
      authHeader: legacy ? normalizeOptionalText(rawRoute.authHeader) : undefined,
      authPrefix: legacy && typeof rawRoute.authPrefix === "string" ? rawRoute.authPrefix : undefined,
      directEndpoint: legacy && rawRoute.directEndpoint === true,
      headers: legacy ? normalizeStringRecord(rawRoute.headers) : undefined,
      maxTokens: normalizePositiveInteger(rawRoute.maxTokens),
      temperature: normalizeNumber(rawRoute.temperature),
      fallbacks: Array.isArray(rawRoute.fallbacks)
        ? normalizeStringIdList(rawRoute.fallbacks, 200, 160)
        : undefined,
      allowUserKey: rawRoute.allowUserKey !== false,
      requiresUserKey: rawRoute.requiresUserKey === true,
      supportsImages: rawRoute.supportsImages !== false,
      supportsTools: rawRoute.supportsTools === true,
    };
  }

  const defaults = normalizeUserConfig(input.defaults);
  const publicAccess = normalizePublicAccessConfig(input.publicAccess);
  const users: Record<string, UserConfig> = {};
  if (isRecord(input.users)) {
    for (const [label, rawUser] of Object.entries(input.users)) {
      const user = normalizeUserConfig(rawUser);
      if (Object.keys(user).length) users[label] = user;
    }
  }

  const skills = normalizeSkillRegistry(input.skills);
  const mcpServers = normalizeMcpServerRegistry(input.mcpServers);
  const tools = normalizeToolRegistry(input.tools, mcpServers);
  if (!tools["builtin:text_stats"]) {
    tools["builtin:text_stats"] = defaultTextStatsTool();
  }

  return {
    routes,
    providers,
    users,
    defaults,
    publicAccess,
    skills,
    tools,
    mcpServers,
  };
}

function normalizePublicAccessConfig(value: unknown): PublicAccessConfig {
  const input = isRecord(value) ? value : {};
  return {
    enabled: input.enabled === true,
    routeId: typeof input.routeId === "string" ? input.routeId.trim().slice(0, 160) : "",
    sessionTtlSeconds: boundedInteger(
      input.sessionTtlSeconds,
      900,
      MAX_PUBLIC_SESSION_TTL_SECONDS,
      DEFAULT_PUBLIC_SESSION_TTL_SECONDS,
    ),
    dailyMessageLimit: boundedInteger(input.dailyMessageLimit, 1, MAX_GUEST_DAILY_LIMIT, DEFAULT_GUEST_DAILY_LIMIT),
    minuteMessageLimit: boundedInteger(input.minuteMessageLimit, 1, MAX_GUEST_MINUTE_LIMIT, DEFAULT_GUEST_MINUTE_LIMIT),
    sourceDailyMessageLimit: boundedInteger(
      input.sourceDailyMessageLimit,
      1,
      MAX_GUEST_SOURCE_DAILY_LIMIT,
      DEFAULT_GUEST_SOURCE_DAILY_LIMIT,
    ),
    sourceMinuteMessageLimit: boundedInteger(
      input.sourceMinuteMessageLimit,
      1,
      MAX_GUEST_SOURCE_MINUTE_LIMIT,
      DEFAULT_GUEST_SOURCE_MINUTE_LIMIT,
    ),
  };
}

function normalizeProviderRegistry(value: unknown): Record<string, ProviderConfig> {
  if (!isRecord(value)) return {};
  const providers: Record<string, ProviderConfig> = {};
  for (const [id, rawProvider] of Object.entries(value)) {
    if (!PROVIDER_ID_PATTERN.test(id)) continue;
    if (!isRecord(rawProvider)) continue;
    const type = rawProvider.type;
    if (
      (type !== "openai-chat" && type !== "anthropic-messages")
      || typeof rawProvider.baseUrl !== "string"
      || !rawProvider.baseUrl.trim()
    ) continue;
    const concurrency = rawProvider.concurrency === "exclusive" || rawProvider.concurrency === "bounded"
      ? rawProvider.concurrency
      : "unlimited";
    providers[id] = {
      enabled: rawProvider.enabled !== false,
      label: typeof rawProvider.label === "string" && rawProvider.label.trim() ? rawProvider.label.trim() : id,
      type,
      baseUrl: rawProvider.baseUrl.trim(),
      apiKey: typeof rawProvider.apiKey === "string" ? rawProvider.apiKey : undefined,
      apiKeyRef: normalizeOptionalText(rawProvider.apiKeyRef),
      authHeader: normalizeOptionalText(rawProvider.authHeader),
      authPrefix: typeof rawProvider.authPrefix === "string" ? rawProvider.authPrefix : undefined,
      directEndpoint: rawProvider.directEndpoint === true,
      headers: normalizeStringRecord(rawProvider.headers),
      allowUserKey: rawProvider.allowUserKey !== false,
      requiresUserKey: rawProvider.requiresUserKey === true,
      supportsImages: rawProvider.supportsImages !== false,
      supportsTools: rawProvider.supportsTools === true,
      concurrency,
      maxConcurrent: concurrency === "bounded"
        ? normalizeBoundedInteger(rawProvider.maxConcurrent, 1, MAX_PROVIDER_CONCURRENCY) ?? 1
        : undefined,
      queueTimeoutMs: normalizeBoundedInteger(rawProvider.queueTimeoutMs, 0, MAX_PROVIDER_QUEUE_TIMEOUT_MS),
      priority: normalizeNumber(rawProvider.priority),
    };
  }
  return providers;
}

function normalizeModelOfferings(
  value: unknown,
  providers: Record<string, ProviderConfig>,
): NonNullable<RouteConfig["offerings"]> {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((rawOffering) => {
    if (!isRecord(rawOffering)) return [];
    const providerId = typeof rawOffering.providerId === "string" ? rawOffering.providerId.trim() : "";
    const model = typeof rawOffering.model === "string" ? rawOffering.model.trim() : "";
    if (!providerId || !model || !hasOwn(providers, providerId) || seen.has(providerId)) return [];
    seen.add(providerId);
    return [{
      providerId,
      model,
      enabled: rawOffering.enabled !== false,
      priority: normalizeNumber(rawOffering.priority),
      supportsImages: typeof rawOffering.supportsImages === "boolean" ? rawOffering.supportsImages : undefined,
      supportsTools: typeof rawOffering.supportsTools === "boolean" ? rawOffering.supportsTools : undefined,
    }];
  });
}

function defaultTextStatsTool(): ToolConfig {
  return {
    enabled: false,
    label: "文本统计",
    description: "统计文本的字符、码点、单词和行数",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string", maxLength: 12_000 } },
      required: ["text"],
      additionalProperties: false,
    },
    confirmation: "auto",
    executor: { type: "builtin", name: "text_stats" },
  };
}

function normalizeUserConfig(value: unknown): UserConfig {
  if (!isRecord(value)) return {};
  const output: UserConfig = {};
  if (typeof value.enabled === "boolean") output.enabled = value.enabled;
  if (typeof value.displayName === "string") {
    const displayName = value.displayName.trim().slice(0, 40);
    if (displayName) output.displayName = displayName;
  }
  if (typeof value.defaultRoute === "string") output.defaultRoute = value.defaultRoute;
  if (Array.isArray(value.allowedRoutes)) {
    output.allowedRoutes = normalizeStringIdList(value.allowedRoutes, 200, 160);
  }
  if (Array.isArray(value.allowedSkills)) {
    output.allowedSkills = normalizeStringIdList(value.allowedSkills, MAX_SKILLS, 80);
  }
  if (Array.isArray(value.allowedTools)) {
    output.allowedTools = normalizeStringIdList(value.allowedTools, MAX_TOOLS, 160);
  }
  if (typeof value.allowBringYourOwnKey === "boolean") {
    output.allowBringYourOwnKey = value.allowBringYourOwnKey;
  }
  const dailyMessageLimit = normalizePositiveInteger(value.dailyMessageLimit);
  if (dailyMessageLimit !== undefined) output.dailyMessageLimit = dailyMessageLimit;
  const minuteMessageLimit = normalizePositiveInteger(value.minuteMessageLimit);
  if (minuteMessageLimit !== undefined) output.minuteMessageLimit = minuteMessageLimit;
  if (value.blockedPrompts !== undefined) output.blockedPrompts = parsePromptList(value.blockedPrompts);
  if (typeof value.systemPrompt === "string") {
    const systemPrompt = value.systemPrompt.trim().slice(0, DEFAULT_USER_SYSTEM_PROMPT_CHARS);
    if (systemPrompt) output.systemPrompt = systemPrompt;
  }
  return output;
}

async function getRouteAccess(config: AppConfig, session: Session, env: Env): Promise<RouteAccess> {
  const guest = session.kind === "guest";
  const user: UserConfig = guest
    ? {
        enabled: true,
        defaultRoute: config.publicAccess.routeId,
        allowedRoutes: config.publicAccess.routeId ? [config.publicAccess.routeId] : [],
        allowedSkills: [],
        allowedTools: [],
        allowBringYourOwnKey: false,
        dailyMessageLimit: config.publicAccess.dailyMessageLimit,
        minuteMessageLimit: config.publicAccess.minuteMessageLimit,
      }
    : getEffectiveUserConfig(config, session.label);
  const allowedIds = guest
    ? (config.publicAccess.routeId ? [config.publicAccess.routeId] : [])
    : user.allowedRoutes?.length ? user.allowedRoutes : Object.keys(config.routes);
  const routes = (await Promise.all(
    allowedIds.map(async (id): Promise<PublicRoute | null> => {
      const route = config.routes[id];
      if (!route || route.enabled === false) return null;
      const candidates = resolveProviderRouteCandidates(id, route, config.providers);
      if (!candidates.length) return null;
      let hasServerKey = false;
      for (const candidate of candidates) {
        if (candidate.requiresUserKey) continue;
        try {
          const credential = await resolveRouteCredential(candidate, env, "");
          if (credential.apiKey && (!guest || credential.source === "managed")) {
            hasServerKey = true;
            break;
          }
        } catch {
          // Another offering may still be usable.
        }
      }
      const allowUserKey = Boolean(!guest && user.allowBringYourOwnKey && route.allowUserKey !== false);
      if (!hasServerKey && !allowUserKey) return null;
      const representative = candidates[0];

      return {
        id,
        label: route.label,
        type: representative.type,
        model: route.label,
        allowUserKey,
        requiresUserKey: Boolean(!hasServerKey),
        supportsImages: candidates.some((candidate) => candidate.supportsImages),
        supportsTools: !guest && candidates.some((candidate) => candidate.supportsTools),
      };
    }),
  )).filter((route): route is PublicRoute => Boolean(route));

  const defaultRoute =
    user.defaultRoute && routes.some((route) => route.id === user.defaultRoute)
      ? user.defaultRoute
      : routes[0]?.id || "";

  return { routes, defaultRoute, user, ...(guest ? { publicAccess: config.publicAccess } : {}) };
}

function getEffectiveUserConfig(config: AppConfig, label: string): UserConfig {
  return { ...(config.defaults || {}), ...(config.users?.[label] || {}) };
}

async function resolveRouteKey(
  route: RouteConfig | ResolvedProviderRoute,
  env: Env,
  userApiKey: string,
): Promise<string> {
  return (await resolveRouteCredential(route, env, userApiKey)).apiKey;
}

async function resolveRouteCredential(
  route: RouteConfig | ResolvedProviderRoute,
  env: Env,
  userApiKey: string,
): Promise<ProviderCredential> {
  return resolveProviderCredential({
    route,
    userApiKey,
    bindings: env,
    isManagedReference: (apiKeyRef) => MANAGED_SECRET_REF_PATTERN.test(apiKeyRef),
    loadManagedSecret: (apiKeyRef) => loadManagedRouteSecret(env, apiKeyRef),
  });
}

function providerPlanRuntime(env: Env, config: AppConfig) {
  return createProviderPlanRuntime({
    routes: config.routes,
    providers: config.providers,
    resolveCredential: (route, userApiKey) => resolveRouteCredential(route, env, userApiKey),
    loadQuality: async (route) => {
      const reliability = await loadProviderRouteReliability(env, route.routeId, route.providerId);
      return isRecentProviderRouteReliability(reliability) ? reliability : null;
    },
    credentialErrorMessage: (error) => (
      error instanceof ManagedSecretError ? error.message : "route key is unavailable"
    ),
  });
}

async function loadManagedRouteSecret(env: Env, apiKeyRef: string): Promise<string | null> {
  return managedSecretService(env).load("route", apiKeyRef);
}

function managedSecretService(env: Env) {
  return createManagedSecretService({
    store: env.CHAT_STORE,
    masterKey: env.ROUTE_KEYS_MASTER_KEY,
    bindings: env,
    fingerprint: secretFingerprint,
    nowIso: () => new Date().toISOString(),
  });
}

function feedbackAuditService(env: Env) {
  return createFeedbackAuditService({
    store: env.CHAT_STORE,
    nowIso: () => new Date().toISOString(),
    createId: () => crypto.randomUUID(),
  });
}

function mcpRuntime(env: Env, ownerLabel?: string) {
  const secrets = managedSecretService(env);
  return createMcpRuntime({
    resolveSecret: (secretRef) => secrets.resolve("mcp", secretRef),
    resolveOAuthAccessToken: async (serverId, server) => {
      if (!ownerLabel || server.auth.type !== "oauth2") {
        throw new McpOAuthError("mcp_oauth_token_unavailable", "OAuth MCP 连接需要成员身份");
      }
      return getUserState(env, ownerLabel).resolveMcpOAuthAccessToken({
        ownerLabel,
        serverId,
        auth: server.auth,
      });
    },
    recordToolDrift: (toolId, reviewRevision) => recordMcpToolDrift(env, toolId, reviewRevision),
    fingerprint: secretFingerprint,
  });
}

async function buildMessagesWithSystem(
  env: Env,
  session: Session,
  normalized: ChatMessage[],
  sessionSummary = "",
  userConfig?: UserConfig,
  selectedSkills: Array<{ id: string; skill: SkillConfig }> = [],
  longTermMemory?: string,
  workspaceContext = "",
): Promise<ChatMessage[]> {
  const systemMessages: ChatMessage[] = [];
  const globalPrompt = env.SYSTEM_PROMPT?.trim();
  if (globalPrompt) {
    systemMessages.push({ role: "system", content: globalPrompt });
  }

  const userPrompt = session.kind === "member" ? userConfig?.systemPrompt?.trim() : "";
  if (userPrompt) {
    systemMessages.push({
      role: "system",
      content: `以下是当前用户专属系统提示词，请优先遵循其中的风格、角色与约束：\n${userPrompt}`,
    });
  }

  for (const { id, skill } of selectedSkills) {
    systemMessages.push({
      role: "system",
      content: `--- Skill: ${skill.label} (${id}) ---\n${skill.instructions}\n--- End Skill: ${id} ---`,
    });
  }

  if (session.kind === "member") {
    let memory = longTermMemory?.trim() || "";
    if (longTermMemory === undefined) {
      await ensureAgentLegacyImport(env, session.label);
      memory = (await (await getTeamAgent(env, session.label)).getMemory()).memory.trim();
    }
    if (memory) {
      systemMessages.push({
        role: "system",
        content: `以下是关于当前用户的长期记忆。它可能包含用户偏好、常用背景和需要长期保持的一般信息。除非用户要求修改或遗忘，否则请在相关时参考：\n${memory}`,
      });
    }
  }

  if (session.kind === "member" && sessionSummary.trim()) {
    systemMessages.push({
      role: "system",
      content: `以下是当前会话的滚动摘要，用于弥补较早消息被裁剪的上下文。请优先参考摘要中的目标、约束和未完成事项：\n${sessionSummary.trim()}`,
    });
  }

  if (session.kind === "member" && workspaceContext.trim()) {
    systemMessages.push({
      role: "system",
      content: `以下文件来自当前会话固定的 workspace 精确版本。仅把 ready 的文本内容作为上下文；unavailable 标记表示该版本本轮不可解析：\n${workspaceContext.trim()}`,
    });
  }

  return [...systemMessages, ...normalized];
}

function agentConversationWorkspaceSourceIdFromPath(url: URL): string {
  const prefix = "/api/agent/conversations/";
  const suffix = "/workspace-files";
  if (!url.pathname.startsWith(prefix) || !url.pathname.endsWith(suffix)) return "";
  const encoded = url.pathname.slice(prefix.length, -suffix.length);
  if (!encoded || encoded.includes("/")) return "";
  try {
    return normalizeAgentConversationId(decodeURIComponent(encoded));
  } catch {
    return "";
  }
}

type WorkspaceFileRoute = {
  fileId: string;
  action: "file" | "versions" | "download" | "retry" | "ingest-retry";
};

function workspaceFileRouteFromUrl(url: URL): WorkspaceFileRoute | undefined {
  const prefix = "/api/workspace/files/";
  if (!url.pathname.startsWith(prefix)) return undefined;
  const parts = url.pathname.slice(prefix.length).split("/");
  if (!parts[0] || parts.length > 2) return undefined;
  let fileId: string;
  try {
    fileId = normalizeWorkspaceEntityId(decodeURIComponent(parts[0]));
  } catch {
    return undefined;
  }
  if (!fileId) return undefined;
  const action = parts.length === 1 || !parts[1]
    ? "file"
    : parts[1] === "versions" || parts[1] === "download" || parts[1] === "retry" || parts[1] === "ingest-retry"
      ? parts[1]
      : undefined;
  return action ? { fileId, action } : undefined;
}

function normalizeDocumentIngestQueueMessage(value: unknown): DocumentIngestMessage | undefined {
  if (!isRecord(value)) return undefined;
  const ownerId = typeof value.ownerId === "string" ? value.ownerId.trim() : "";
  const fileId = normalizeWorkspaceEntityId(value.fileId);
  const versionId = normalizeWorkspaceEntityId(value.versionId);
  const generation = finitePositiveInteger(value.generation);
  return ownerId && ownerId.length <= 120 && fileId && versionId && generation
    ? { ownerId, fileId, versionId, generation }
    : undefined;
}

async function completeWithUserRoute(
  env: Env,
  session: Session,
  args: {
    routeId?: string;
    userApiKey?: string;
    messages: ChatMessage[];
    maxTokens?: number;
    temperature?: number;
    consumeQuota?: boolean;
  },
): Promise<
  | { ok: true; text: string; routeId: string }
  | { ok: false; error: string; message: string; status: number; routeId?: string }
> {
  const config = await loadAppConfig(env);
  const access = await getRouteAccess(config, session, env);
  if (!access.routes.length) {
    return { ok: false, error: "no_routes_available", message: "没有可用线路", status: 403 };
  }

  if (args.consumeQuota) {
    const limitResult = await quotaAdmissionService(env).consumeLimits(session, access.user);
    if (!limitResult.ok) {
      return {
        ok: false,
        error: "rate_limited",
        message: "额度已用完",
        status: 429,
      };
    }
  }

  const selectedRoute = args.routeId || access.defaultRoute;
  const routeIds = buildProviderRoutePlan(selectedRoute, config.routes, access);
  const userApiKey = args.userApiKey?.trim() || "";
  const prepared = await providerPlanRuntime(env, config).preparePlan({
    routeIds,
    accessRoutes: access.routes,
    userApiKey,
  });
  if (prepared.userKeyRequiredRouteId) {
    return {
      ok: false,
      error: "user_api_key_required",
      message: "需要填写 API Key",
      status: 400,
      routeId: prepared.userKeyRequiredRouteId,
    };
  }
  const remaining = [...prepared.candidates];
  let lastError = prepared.lastError?.message || "no route succeeded";
  let lastRouteId = prepared.lastError?.routeId || "";
  let attemptedRoutes = 0;
  let busy = false;

  while (remaining.length) {
    const acquired = await acquireFirstAvailableProvider(env, remaining);
    if (!acquired) {
      busy = true;
      lastError = "当前服务提供商繁忙，请稍后重试";
      lastRouteId = remaining[0].routeId;
      break;
    }
    const { candidate: route, lease } = acquired;
    remaining.splice(remaining.indexOf(route), 1);
    const routeId = route.routeId;
    attemptedRoutes += 1;
    const startedAt = Date.now();
    const fallback = route.planIndex > 0 || attemptedRoutes > 1;
    try {
      const text = await completeOnce({
        route,
        apiKey: route.credential.apiKey,
        messages: args.messages,
        temperature: args.temperature ?? 0.2,
        maxTokens: args.maxTokens,
        env,
      });
      if (text.trim()) {
        await recordRouteReliability(env, {
          routeId,
          providerId: route.providerId,
          ok: true,
          fallback,
          startedAt,
        });
        return { ok: true, text: text.trim(), routeId };
      }
      await recordRouteReliability(env, {
        routeId,
        providerId: route.providerId,
        ok: false,
        outcome: "protocol_error",
        fallback,
        startedAt,
      });
      lastError = "empty completion";
      lastRouteId = routeId;
    } catch (error) {
      await recordRouteReliability(env, {
        routeId,
        providerId: route.providerId,
        ok: false,
        status: error instanceof UpstreamRequestError ? error.status : undefined,
        error,
        fallback,
        startedAt,
        usedUserKey: route.credential.usedUserKey,
      });
      lastError = error instanceof Error ? error.message : "completion failed";
      lastRouteId = routeId;
      if (
        error instanceof UpstreamRequestError
        && isTerminalProviderFailure(error.status, route.credential.usedUserKey)
      ) break;
    } finally {
      await lease.release();
    }
  }

  return {
    ok: false,
    error: busy ? "provider_busy" : "upstream_error",
    message: lastError,
    status: busy ? 429 : 502,
    routeId: lastRouteId || undefined,
  };
}

async function completeOnce(args: {
  route: ResolvedProviderRoute;
  apiKey: string;
  messages: ChatMessage[];
  temperature: number;
  maxTokens?: number;
  env: Env;
  signal?: AbortSignal;
}): Promise<string> {
  const { route, apiKey, messages, temperature, maxTokens, env, signal } = args;
  try {
    const result = await generateText({
      model: createProviderLanguageModel(route, apiKey),
      messages: toProviderModelMessages(messages),
      temperature: clampNumber(temperature, 0, route.type === "anthropic-messages" ? 1 : 2, 0.2),
      maxOutputTokens: maxTokens || route.maxTokens || numberEnv(env.DEFAULT_MAX_TOKENS, 4096),
      maxRetries: 0,
      allowSystemInMessages: true,
      abortSignal: signal,
    });
    return result.text;
  } catch (error) {
    const status = providerErrorStatus(error);
    if (status !== undefined) {
      throw new UpstreamRequestError(status, error instanceof Error ? error.message : "upstream request failed");
    }
    throw error;
  }
}

function formatTranscript(messages: ChatMessage[]): string {
  return messages
    .map((message) => {
      const role = message.role === "assistant" ? "助手" : message.role === "user" ? "用户" : "系统";
      const text = extractText(message.content).trim();
      const images = Array.isArray(message.content)
        ? message.content.filter((part) => part.type === "image_url").length
        : 0;
      const imageHint = images ? ` [含${images}张图片]` : "";
      return `${role}: ${text || "(空)"}${imageHint}`;
    })
    .join("\n");
}

function cleanSuggestionText(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[*•]\s*/, "- ").replace(/^\d+\.\s*/, "- "));
  if (!lines.length || lines.every((line) => /^无[.。!！]?$/.test(line.replace(/^-\s*/, "")))) {
    return "";
  }
  return lines.join("\n");
}

function estimateMessageChars(message: ChatMessage): number {
  if (typeof message.content === "string") return message.content.length;
  let total = 0;
  for (const part of message.content) {
    if (part.type === "text") total += part.text.length;
    if (part.type === "image_url") total += 800;
  }
  return total;
}

function trimMessagesForContext(messages: ChatMessage[], env: Env): ChatMessage[] {
  if (!messages.length) return [];
  const budget = numberEnv(env.MAX_CONTEXT_CHARS, DEFAULT_CONTEXT_CHARS);
  const hardCap = Math.min(messages.length, MAX_MESSAGES);
  const recent = messages.slice(-hardCap);
  while (recent[0]?.role === "assistant") recent.shift();

  let total = 0;
  const kept: ChatMessage[] = [];
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const message = recent[index];
    const cost = Math.max(1, estimateMessageChars(message));
    if (kept.length && total + cost > budget) break;
    kept.push(message);
    total += cost;
  }
  kept.reverse();
  while (kept[0]?.role === "assistant") kept.shift();
  return kept;
}

async function callRoute(args: {
  route: ResolvedProviderRoute;
  routeId: string;
  apiKey: string;
  usedUserKey: boolean;
  messages: ChatMessage[];
  temperature: unknown;
  env: Env;
  signal?: AbortSignal;
}): Promise<{
  response?: Response;
  cancelUpstream?: (reason?: unknown) => Promise<void>;
  error: { routeId: string; status: number; message: string };
  terminal: boolean;
}> {
  const { route, routeId, usedUserKey } = args;
  const attempt = await callProviderStream({
    route,
    apiKey: args.apiKey,
    usedUserKey,
    messages: args.messages,
    temperature: args.temperature,
    defaultMaxTokens: numberEnv(args.env.DEFAULT_MAX_TOKENS, 4096),
    signal: args.signal,
  });

  if (attempt.ok) {
    const headers = securityHeaders({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    return {
      response: new Response(attempt.body, { status: 200, headers }),
      cancelUpstream: attempt.cancelUpstream,
      error: { routeId, status: 0, message: "" },
      terminal: false,
    };
  }
  return {
    error: {
      routeId,
      status: attempt.status,
      message: attempt.message,
    },
    terminal: attempt.terminal,
  };
}

type ProviderStreamLifecycle = {
  onComplete: () => Promise<void>;
  onError: (error: unknown) => Promise<void>;
};

export function responseWithProviderLease(
  response: Response,
  lease: ProviderLease,
  lifecycle: ProviderStreamLifecycle,
  cancelUpstream?: (reason?: unknown) => Promise<void>,
  requestSignal?: AbortSignal,
): Response {
  if (!response.body) {
    void cancelUpstream?.();
    void lease.release();
    return response;
  }
  const reader = response.body.getReader();
  let settled = false;
  let abortHandler: (() => void) | null = null;
  const removeAbortHandler = () => {
    if (!abortHandler || !requestSignal) return;
    requestSignal.removeEventListener("abort", abortHandler);
    abortHandler = null;
  };
  const settle = async (kind: "complete" | "error" | "cancel", error?: unknown) => {
    if (settled) return;
    settled = true;
    removeAbortHandler();
    await lease.release().catch(() => undefined);
    if (kind === "complete") {
      await lifecycle.onComplete().catch(() => undefined);
    } else if (kind === "error") {
      await lifecycle.onError(error).catch(() => undefined);
    }
  };
  const cancelReaders = (reason?: unknown) => Promise.all([
    reader.cancel(reason).catch(() => undefined),
    cancelUpstream?.(reason).catch(() => undefined),
  ]);
  const cancelForAbort = () => {
    void (async () => {
      const cancellation = cancelReaders(requestSignal?.reason);
      await settle("cancel");
      await cancellation;
    })();
  };
  if (requestSignal) {
    abortHandler = cancelForAbort;
    if (requestSignal.aborted) cancelForAbort();
    else requestSignal.addEventListener("abort", abortHandler, { once: true });
  }
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await reader.read();
        if (next.done) {
          await settle("complete");
          controller.close();
          return;
        }
        controller.enqueue(next.value);
      } catch (error) {
        const cancellation = cancelReaders();
        await settle("error", error);
        await cancellation;
        controller.error(error);
      }
    },
    async cancel(reason) {
      const cancellation = cancelReaders(reason);
      await settle("cancel");
      await cancellation;
    },
  }, { highWaterMark: 0 });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

type CapabilityChatArgs = {
  env: Env;
  session: Session;
  access: RouteAccess;
  config: AppConfig;
  selectedRoute: string;
  routeIds: string[];
  messages: ChatMessage[];
  tools: NormalizedToolDefinition[];
  userApiKey: string;
  temperature: unknown;
  remaining: number;
  requestSignal?: AbortSignal;
};

type CapabilityCoordination = {
  runId: string;
  controller: AbortController;
  requestApproval: (
    definition: NormalizedToolDefinition,
    event: ToolEventSummary,
  ) => ToolApprovalDecision | Promise<ToolApprovalDecision>;
  cleanup: () => void;
};

function capabilityErrorResponse(code: string, message: string): Response {
  return jsonResponse({ error: code, message }, code === "invalid_chat_id" ? 400 : 429);
}

function createCapabilityChatResponse(args: CapabilityChatArgs, coordination?: CapabilityCoordination): Response {
  const runId = coordination?.runId || crypto.randomUUID();
  const encoder = new TextEncoder();
  const controller = coordination?.controller || new AbortController();
  const abort = () => controller.abort(args.requestSignal?.reason);
  if (args.requestSignal?.aborted) abort();
  else args.requestSignal?.addEventListener("abort", abort, { once: true });
  let cancelled = false;
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    coordination?.cleanup();
    args.requestSignal?.removeEventListener("abort", abort);
  };

  const stream = new ReadableStream<Uint8Array>({
    start(streamController) {
      let closed = false;
      const emit = (event: CapabilityStreamEvent) => {
        if (closed || controller.signal.aborted) return;
        streamController.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      void runCapabilityLoop(args, runId, emit, controller.signal, coordination?.requestApproval)
        .catch((error) => {
          const capabilityError = toCapabilityError(error);
          emit({
            type: "error",
            code: capabilityError.code,
            message: capabilityError.message,
            retryable: capabilityError.retryable,
          });
        })
        .finally(() => {
          if (!closed && !controller.signal.aborted) emit({ type: "done" });
          closed = true;
          if (!cancelled) streamController.close();
          cleanup();
        });
    },
    cancel() {
      cancelled = true;
      controller.abort("response_cancelled");
      cleanup();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: securityHeaders({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "X-Chatus-Stream": "capability-v1",
      "X-Chatus-Route": args.selectedRoute,
      "X-RateLimit-Remaining": String(args.remaining),
    }),
  });
}

async function runCapabilityLoop(
  args: CapabilityChatArgs,
  runId: string,
  emit: (event: CapabilityStreamEvent) => void,
  signal: AbortSignal,
  requestApproval?: (
    definition: NormalizedToolDefinition,
    event: ToolEventSummary,
  ) => ToolApprovalDecision | Promise<ToolApprovalDecision>,
): Promise<void> {
  const mcpExecution = mcpRuntime(args.env).createExecution();
  try {
    await runCapabilityLoopInner(args, runId, emit, signal, mcpExecution, requestApproval);
  } finally {
    await mcpExecution.close();
  }
}

async function runCapabilityLoopInner(
  args: CapabilityChatArgs,
  runId: string,
  emit: (event: CapabilityStreamEvent) => void,
  signal: AbortSignal,
  mcpExecution: McpRuntimeExecution,
  requestApproval?: (
    definition: NormalizedToolDefinition,
    event: ToolEventSummary,
  ) => ToolApprovalDecision | Promise<ToolApprovalDecision>,
): Promise<void> {
  const aliasMap = new Map(args.tools.map((tool) => [tool.providerName, tool]));
  let selected:
    | {
        routeId: string;
        route: ResolvedProviderRoute;
        lease: ProviderLease;
        history: ProviderToolHistory;
        turn: ModelTurn;
        fallback: boolean;
        startedAt: number;
        apiKey: string;
        usedUserKey: boolean;
      }
    | null = null;
  let attemptedRoutes = 0;
  let lastError: ProviderToolError | null = null;
  const prepared = await providerPlanRuntime(args.env, args.config).preparePlan({
    routeIds: args.routeIds,
    accessRoutes: args.access.routes,
    userApiKey: args.userApiKey,
    accepts: (route) => route.supportsTools,
  });
  if (prepared.userKeyRequiredRouteId) {
    throw new CapabilityError("user_api_key_required", "当前线路需要用户 API Key");
  }
  if (prepared.lastError) {
    lastError = new ProviderToolError(500, prepared.lastError.message, false);
  }
  const remaining = [...prepared.candidates];

  while (remaining.length) {
    assertNotAborted(signal);
    const acquired = await acquireFirstAvailableProvider(args.env, remaining, signal);
    if (!acquired) {
      lastError = new ProviderToolError(429, "当前服务提供商繁忙，请稍后重试", false);
      break;
    }
    const { candidate: route, lease } = acquired;
    remaining.splice(remaining.indexOf(route), 1);
    const routeId = route.routeId;
    attemptedRoutes += 1;
    const history = createProviderToolHistory(route, args.messages);
    const startedAt = Date.now();
    const fallback = route.planIndex > 0 || attemptedRoutes > 1;
    let handedOff = false;
    try {
      const turn = await callProviderToolTurn({
        route,
        apiKey: route.credential.apiKey,
        history,
        tools: args.tools,
        temperature: args.temperature,
        defaultMaxTokens: numberEnv(args.env.DEFAULT_MAX_TOKENS, 4096),
        signal,
        usedUserKey: route.credential.usedUserKey,
      });
      selected = {
        routeId,
        route,
        lease,
        history,
        turn,
        fallback,
        startedAt,
        apiKey: route.credential.apiKey,
        usedUserKey: route.credential.usedUserKey,
      };
      handedOff = true;
      break;
    } catch (error) {
      lastError = error instanceof ProviderToolError
        ? error
        : new ProviderToolError(502, error instanceof Error ? error.message : "provider response is invalid", false);
      await recordRouteReliability(args.env, {
        routeId,
        providerId: route.providerId,
        ok: false,
        status: lastError.status,
        error,
        fallback,
        startedAt,
        usedUserKey: route.credential.usedUserKey,
      });
      await recordChatMetric(args.env, { kind: "route_error", label: args.session.label, routeId });
      if (lastError.terminal) break;
    } finally {
      if (!handedOff) await lease.release();
    }
  }

  if (!selected) {
    await recordChatMetric(args.env, { kind: "failure", label: args.session.label });
    throw new CapabilityError(
      lastError?.status === 429 ? "provider_busy" : "upstream_error",
      lastError?.message || "no route succeeded",
      true,
    );
  }

  try {
    emit({ type: "run", runId, routeId: selected.routeId, fallback: selected.fallback });
    let turn = selected.turn;
    let totalCalls = 0;
    let toolBudgetMs = 0;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    assertNotAborted(signal);
    appendProviderTurn(selected.history, turn.providerTurn);
    if (!turn.toolCalls.length) {
      if (turn.text) emit({ type: "assistant_delta", text: turn.text });
      emit({ type: "finish", finishReason: turn.finishReason || "stop" });
      await recordRouteReliability(args.env, {
        routeId: selected.routeId,
        providerId: selected.route.providerId,
        ok: true,
        fallback: selected.fallback,
        startedAt: selected.startedAt,
      });
      await recordChatMetric(args.env, {
        kind: "success",
        label: args.session.label,
        routeId: selected.routeId,
        fallback: selected.fallback,
      });
      return;
    }

    if (totalCalls + turn.toolCalls.length > MAX_TOOL_CALLS) {
      throw new CapabilityError("tool_call_limit", `单次对话最多执行 ${MAX_TOOL_CALLS} 次工具调用`);
    }
    const results: ProviderToolExecutionResult[] = [];
    for (const call of turn.toolCalls) {
      const definition = aliasMap.get(call.providerName);
      if (!definition || definition.id !== call.toolId) {
        throw new CapabilityError("tool_not_allowed", "模型请求了未授权的工具");
      }
      if (!call.argumentsValid) {
        throw new CapabilityError("tool_arguments_invalid", `工具 ${definition.label} 的参数不是有效 JSON`);
      }
      validateToolArguments(definition, call.arguments);
      totalCalls += 1;
      const startedAt = Date.now();
      const eventId = crypto.randomUUID();
      const baseEvent: ToolEventSummary = {
        id: eventId,
        toolId: definition.id,
        label: definition.label,
        source: definition.config.executor.type,
        status: "pending",
        argumentSummary: summarizeToolArguments(call.arguments),
        createdAt: startedAt,
        updatedAt: startedAt,
      };
      const policy = normalizeToolConfirmation(definition.config);
      let confirmation: "once" | "conversation" | undefined;
      if (policy !== "auto") {
        if (!requestApproval) throw new CapabilityError("tool_confirmation_required", "工具调用需要用户确认");
        const approvalResult = requestApproval(definition, baseEvent);
        let decision: ToolApprovalDecision;
        if (typeof approvalResult === "string") {
          decision = approvalResult;
        } else {
          emit({ type: "confirmation_required", runId, callId: eventId, event: baseEvent });
          decision = await approvalResult;
        }
        if (decision === "deny") {
          emit({ type: "tool", event: { ...baseEvent, status: "denied", updatedAt: Date.now() } });
          results.push({
            providerCallId: call.providerCallId,
            text: JSON.stringify({ error: "tool_denied", message: "The user denied this tool call." }),
            isError: true,
          });
          continue;
        }
        confirmation = decision;
        emit({
          type: "tool",
          event: { ...baseEvent, status: "approved", confirmation, updatedAt: Date.now() },
        });
      }
      const runningEvent: ToolEventSummary = {
        ...baseEvent,
        status: "running",
        confirmation,
        updatedAt: Date.now(),
      };
      emit({ type: "tool", event: runningEvent });
      const result = await executeCapabilityTool(definition, call.arguments, args.env, signal, mcpExecution);
      const duration = Date.now() - startedAt;
      toolBudgetMs += duration;
      if (toolBudgetMs > TOOL_TOTAL_BUDGET_MS) {
        throw new CapabilityError("tool_time_budget_exceeded", "工具累计执行时间超过限制", true);
      }
      emit({
        type: "tool",
        event: {
          ...runningEvent,
          status: "completed",
          resultPreview: result.preview,
          truncated: result.truncated || undefined,
          updatedAt: Date.now(),
        },
      });
      results.push({ providerCallId: call.providerCallId, text: result.text, isError: false });
    }
    appendProviderToolResults(selected.history, results);
    if (round + 1 >= MAX_TOOL_ROUNDS) {
      throw new CapabilityError("tool_round_limit", `单次对话最多执行 ${MAX_TOOL_ROUNDS} 轮工具交互`);
    }
    try {
      turn = await callProviderToolTurn({
        route: selected.route,
        apiKey: selected.apiKey,
        history: selected.history,
        tools: args.tools,
        temperature: args.temperature,
        defaultMaxTokens: numberEnv(args.env.DEFAULT_MAX_TOKENS, 4096),
        signal,
        usedUserKey: selected.usedUserKey,
      });
    } catch (error) {
      await recordRouteReliability(args.env, {
        routeId: selected.routeId,
        providerId: selected.route.providerId,
        ok: false,
        status: error instanceof ProviderToolError ? error.status : undefined,
        error,
        fallback: selected.fallback,
        startedAt: selected.startedAt,
        usedUserKey: selected.usedUserKey,
      });
      await recordChatMetric(args.env, { kind: "route_error", label: args.session.label, routeId: selected.routeId });
      throw new CapabilityError(
        "upstream_error",
        error instanceof Error ? error.message : "模型在工具调用后返回错误",
        true,
      );
    }
    }
  } finally {
    await selected.lease.release();
  }
}

function validateToolArguments(definition: NormalizedToolDefinition, value: unknown): void {
  try {
    const validate = TOOL_SCHEMA_VALIDATOR.getValidator(definition.inputSchema as JsonSchemaType);
    const result = validate(value);
    if (!result.valid) {
      throw new CapabilityError("tool_arguments_invalid", `工具 ${definition.label} 的参数不符合 Schema`);
    }
  } catch (error) {
    if (error instanceof CapabilityError) throw error;
    throw new CapabilityError("tool_arguments_invalid", `工具 ${definition.label} 的参数 Schema 无法验证`);
  }
}

function toolTrustKey(definition: NormalizedToolDefinition): string {
  return JSON.stringify([definition.id, definition.config.reviewRevision || ""]);
}

function createAgentCapabilityRuntime(
  definitions: NormalizedToolDefinition[],
  env: Env,
  ownerLabel: string,
): { runTool: CapabilityToolRunner; close: () => Promise<void> } {
  const allowed = new Map(definitions.map((definition) => [definition.id, definition]));
  const mcpExecution = mcpRuntime(env, ownerLabel).createExecution();
  let callCount = 0;
  let elapsedMs = 0;
  let closed = false;

  const runTool: CapabilityToolRunner = async (definition, input, signal) => {
    if (closed) throw new CapabilityError("tool_runtime_closed", "工具运行时已关闭");
    const allowedDefinition = allowed.get(definition.id);
    if (!allowedDefinition || allowedDefinition.providerName !== definition.providerName) {
      throw new CapabilityError("tool_not_found", "工具不在当前成员的允许列表中");
    }
    callCount += 1;
    if (callCount > MAX_TOOL_CALLS) {
      throw new CapabilityError("tool_call_limit_exceeded", "本轮工具调用次数超过限制");
    }
    const remainingBudgetMs = TOOL_TOTAL_BUDGET_MS - elapsedMs;
    if (remainingBudgetMs <= 0) {
      throw new CapabilityError("tool_budget_exceeded", "本轮工具执行时间超过限制");
    }

    validateToolArguments(allowedDefinition, input);
    const startedAt = Date.now();
    try {
      return await executeCapabilityTool(
        allowedDefinition,
        input,
        env,
        signal || new AbortController().signal,
        mcpExecution,
        Math.min(TOOL_CALL_TIMEOUT_MS, remainingBudgetMs),
      );
    } finally {
      elapsedMs += Date.now() - startedAt;
    }
  };

  const close = async () => {
    if (closed) return;
    closed = true;
    await mcpExecution.close();
  };

  return { runTool, close };
}

async function executeCapabilityTool(
  definition: NormalizedToolDefinition,
  value: unknown,
  env: Env,
  signal: AbortSignal,
  mcpExecution: McpRuntimeExecution,
  timeoutMs = TOOL_CALL_TIMEOUT_MS,
): Promise<CapabilityToolExecutionResult> {
  const callController = new AbortController();
  const abort = () => callController.abort(signal.reason);
  if (signal.aborted) abort();
  else signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => callController.abort("tool_timeout"), Math.max(1, timeoutMs));
  try {
    let result: unknown;
    if (definition.config.executor.type === "builtin") {
      result = executeTextStats(value);
    } else {
      const config = await loadAppConfig(env);
      const currentTool = config.tools?.[definition.id];
      if (
        !currentTool
        || currentTool.enabled !== true
        || currentTool.reviewRequired === true
        || currentTool.executor.type !== "mcp"
        || currentTool.executor.serverId !== definition.config.executor.serverId
        || currentTool.executor.remoteName !== definition.config.executor.remoteName
        || currentTool.reviewRevision !== definition.config.reviewRevision
      ) {
        throw new CapabilityError("mcp_tool_changed", "MCP 工具配置已变化，请重新开始本轮请求");
      }
      const currentDefinition: NormalizedToolDefinition = {
        ...definition,
        label: currentTool.label,
        description: currentTool.description || currentTool.label,
        inputSchema: currentTool.inputSchema,
        config: currentTool,
      };
      validateToolArguments(currentDefinition, value);
      try {
        result = await mcpExecution.executeTool(
          currentDefinition,
          value,
          config.mcpServers?.[currentTool.executor.serverId],
          callController.signal,
        );
      } catch (error) {
        if (error instanceof McpRuntimeError) {
          throw new CapabilityError(error.code, error.message, error.retryable);
        }
        throw error;
      }
    }
    assertNotAborted(callController.signal);
    const text = JSON.stringify(result);
    if (new TextEncoder().encode(text).byteLength > MAX_TOOL_RESULT_BYTES) {
      throw new CapabilityError("tool_result_too_large", "工具结果超过大小限制");
    }
    const preview = redactSensitiveText(text).slice(0, MAX_TOOL_RESULT_PREVIEW_CHARS);
    return { text, preview, truncated: preview.length < text.length };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}

function executeTextStats(value: unknown): Record<string, number> {
  if (!isRecord(value) || typeof value.text !== "string") {
    throw new CapabilityError("tool_arguments_invalid", "文本统计工具需要 text 字符串");
  }
  const text = value.text;
  const words = text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) || [];
  return {
    characters: text.length,
    codePoints: Array.from(text).length,
    words: words.length,
    lines: text ? text.split(/\r\n|\r|\n/).length : 0,
  };
}

function summarizeToolArguments(value: unknown): string {
  const summarize = (item: unknown, depth: number): unknown => {
    if (depth > 2) return "[nested]";
    if (typeof item === "string") return `[string ${Array.from(item).length} chars]`;
    if (typeof item === "number") return "[number]";
    if (typeof item === "boolean") return "[boolean]";
    if (item === null) return "[null]";
    if (Array.isArray(item)) return item.slice(0, 8).map((entry) => summarize(entry, depth + 1));
    if (isRecord(item)) {
      return Object.fromEntries(Object.entries(item).slice(0, 16).map(([key, entry]) => [key, summarize(entry, depth + 1)]));
    }
    return `[${typeof item}]`;
  };
  return JSON.stringify(summarize(value, 0)).slice(0, MAX_TOOL_ARGUMENT_SUMMARY_CHARS);
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [redacted]")
    .replace(/(["']?(?:api[_-]?key|token|secret|authorization)["']?\s*[:=]\s*["']?)[^"'\s,}]+/gi, "$1[redacted]");
}

function assertNotAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  if (signal.reason === "tool_timeout") throw new CapabilityError("tool_execution_failed", "工具执行超时", true);
  throw new CapabilityError("request_cancelled", "请求已取消", true);
}

function toCapabilityError(error: unknown): CapabilityError {
  if (error instanceof CapabilityError) return error;
  if (error instanceof McpRuntimeError) {
    return new CapabilityError(error.code, error.message, error.retryable);
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return new CapabilityError("request_cancelled", "请求已取消", true);
  }
  return new CapabilityError("tool_execution_failed", error instanceof Error ? error.message : "工具执行失败", true);
}

function providerErrorStatus(error: unknown): number | undefined {
  if (!isRecord(error)) return undefined;
  return typeof error.statusCode === "number"
    ? error.statusCode
    : typeof error.status === "number"
      ? error.status
      : undefined;
}

function upstreamReliabilityOutcome(error: unknown): RouteReliabilityOutcome | undefined {
  return error instanceof UpstreamRequestError ? error.outcome : undefined;
}

async function getSession(request: Request, env: Env): Promise<Session | null> {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const session = await getStoredSession(env, token);
  if (!session) {
    await env.CHAT_STORE.delete(`session:${token}`);
    return null;
  }
  if (session.expiresAt <= Date.now()) {
    await env.CHAT_STORE.delete(`session:${token}`);
    if (session.kind === "guest") await cleanupGuestSessionData(env, session);
    return null;
  }
  const config = await loadAppConfig(env);
  if (
    (session.kind === "guest" && !config.publicAccess.enabled)
    || (session.kind === "member" && getEffectiveUserConfig(config, session.label).enabled === false)
  ) {
    await env.CHAT_STORE.delete(`session:${token}`);
    if (session.kind === "guest") await cleanupGuestSessionData(env, session);
    return null;
  }
  return session;
}

async function getStoredSession(env: Env, token: string): Promise<Session | null> {
  const raw = await env.CHAT_STORE.get(`session:${token}`);
  if (!raw) return null;
  try {
    return normalizeStoredSession(JSON.parse(raw));
  } catch {
    return null;
  }
}

function normalizeStoredSession(value: unknown): Session | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === "string" ? value.id.trim() : "";
  const label = typeof value.label === "string" ? value.label.trim() : "";
  const createdAt = value.createdAt;
  const lastSeen = value.lastSeen;
  const expiresAt = value.expiresAt;
  if (
    !id
    || !label
    || (value.kind !== "guest" && value.kind !== "member")
    || typeof createdAt !== "number"
    || !Number.isFinite(createdAt)
    || typeof lastSeen !== "number"
    || !Number.isFinite(lastSeen)
    || typeof expiresAt !== "number"
    || !Number.isFinite(expiresAt)
    || expiresAt <= createdAt
  ) return null;
  if (value.kind === "guest") {
    const sourceKey = typeof value.sourceKey === "string" ? value.sourceKey : "";
    if (!label.startsWith(GUEST_LABEL_PREFIX) || !/^guest-source:[0-9a-f]{64}$/.test(sourceKey)) return null;
    return { id, label, kind: "guest", createdAt, lastSeen, expiresAt, sourceKey };
  }
  if (!isValidMemberLabel(label)) return null;
  return { id, label, kind: "member", createdAt, lastSeen, expiresAt };
}

async function cleanupGuestData(
  env: Env,
  label: string,
  markerKey: string,
  rootInput: CleanupRoot | Promise<CleanupRoot> = getTeamAgent(env, label),
  now = Date.now(),
  scheduleFailures = true,
): Promise<boolean> {
  const root = await rootInput;
  let purge: { operationId: string; generation: number } | undefined;
  try {
    purge = await purgeAgentUserData(env, label, root, now, scheduleFailures);
    await getUserState(env, label).purgeUserData();
    if (!(await root.releaseWorkspaceAccountPurge(purge.operationId, purge.generation, true))) {
      throw new Error("workspace_account_purge_release_failed");
    }
    await env.CHAT_STORE.delete(markerKey);
    if (!(await root.completeGuestCleanup(markerKey))) throw new Error("guest_cleanup_ticket_complete_failed");
    return true;
  } catch {
    if (purge) {
      await root.recordWorkspaceOperationFailure(
        purge.operationId,
        purge.generation,
        "guest_account_cleanup_failed",
        now,
        scheduleFailures,
      ).catch(() => undefined);
    }
    await root.recordGuestCleanupFailure(
      markerKey,
      "guest_cleanup_failed",
      now,
      scheduleFailures,
    ).catch(() => undefined);
    return false;
  }
}

async function cleanupGuestSessionData(env: Env, session: GuestSession): Promise<void> {
  const markerKey = guestCleanupKey(session);
  try {
    await env.CHAT_STORE.put(
      markerKey,
      JSON.stringify({ label: session.label, expiresAt: session.expiresAt }),
    );
    const root = await getTeamAgent(env, session.label, session);
    if (!(await root.registerGuestCleanup(markerKey, session.expiresAt))) {
      throw new Error("guest_cleanup_schedule_failed");
    }
    await cleanupGuestData(env, session.label, markerKey, root);
  } catch {
    console.error(JSON.stringify({
      level: "warn",
      event: "guest_cleanup_deferred",
      error: "guest_cleanup_unavailable",
    }));
  }
}

async function scheduleGuestCleanup(env: Env, session: GuestSession): Promise<void> {
  const markerKey = guestCleanupKey(session);
  await env.CHAT_STORE.put(
    markerKey,
    JSON.stringify({ label: session.label, expiresAt: session.expiresAt }),
  );
  const root = await getTeamAgent(env, session.label, session);
  if (!(await root.registerGuestCleanup(markerKey, session.expiresAt))) {
    throw new Error("guest_cleanup_schedule_failed");
  }
}

async function scheduleGuestCleanupDrain(
  env: Env,
  ctx: ExecutionContext | undefined,
  requestId: string,
): Promise<void> {
  const cleanup = drainExpiredGuestCleanups(env).catch(() => {
    console.error(JSON.stringify({
      level: "warn",
      event: "guest_cleanup_failed",
      requestId,
      error: "guest_cleanup_failed",
    }));
  });
  if (ctx) {
    ctx.waitUntil(cleanup);
    return;
  }
  await cleanup;
}

async function drainExpiredGuestCleanups(env: Env, now = Date.now()): Promise<void> {
  const page = await env.CHAT_STORE.list({ prefix: GUEST_CLEANUP_PREFIX, limit: GUEST_CLEANUP_BATCH_SIZE });
  for (const key of page.keys) {
    const expiresAt = guestCleanupExpiresAt(key.name);
    if (expiresAt === null) continue;
    if (expiresAt > now) break;
    const raw = await env.CHAT_STORE.get(key.name);
    const label = guestCleanupLabel(raw);
    if (!label) continue;
    const root = await getTeamAgent(env, label);
    if (!(await root.registerGuestCleanup(key.name, expiresAt))) continue;
    await cleanupGuestData(env, label, key.name, root, now);
  }
}

function guestCleanupKey(session: Pick<GuestSession, "label" | "expiresAt">): string {
  return `${GUEST_CLEANUP_PREFIX}${String(Math.floor(session.expiresAt)).padStart(13, "0")}:${encodeURIComponent(session.label)}`;
}

function guestCleanupExpiresAt(key: string): number | null {
  const value = key.slice(GUEST_CLEANUP_PREFIX.length, GUEST_CLEANUP_PREFIX.length + 13);
  if (!/^\d{13}$/.test(value)) return null;
  const expiresAt = Number(value);
  return Number.isFinite(expiresAt) ? expiresAt : null;
}

function guestCleanupLabel(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const label = isRecord(parsed) && typeof parsed.label === "string" ? parsed.label.trim() : "";
    return label.startsWith(GUEST_LABEL_PREFIX) ? label : null;
  } catch {
    return null;
  }
}

function sessionCapabilities(session: Session, access: RouteAccess): SessionCapabilities {
  if (session.kind === "member") {
    return { imageInput: true, fileInput: true, memory: true, messageActions: true, feedback: true, accountData: true };
  }
  return {
    imageInput: access.routes.some((route) => route.supportsImages),
    fileInput: false,
    memory: false,
    messageActions: false,
    feedback: false,
    accountData: false,
  };
}

async function getAdminSession(request: Request, env: Env): Promise<AdminSession | null> {
  const token = getCookie(request, ADMIN_COOKIE);
  if (!token) return null;

  const raw = await env.CHAT_STORE.get(`admin:${token}`);
  if (!raw) return null;

  try {
    const session = JSON.parse(raw) as AdminSession;
    const expected = env.ADMIN_TOKEN?.trim() || "";
    if (
      !Number.isFinite(session.createdAt) ||
      !session.tokenFingerprint ||
      !(await secureCompare(session.tokenFingerprint, await secretFingerprint(expected)))
    ) {
      await env.CHAT_STORE.delete(`admin:${token}`);
      return null;
    }
    return session;
  } catch {
    await env.CHAT_STORE.delete(`admin:${token}`);
    return null;
  }
}

async function countActiveSessionsByLabel(env: Env): Promise<Map<string, number>> {
  const output = new Map<string, number>();
  let cursor: string | undefined;

  do {
    const result = await env.CHAT_STORE.list({ prefix: "session:", cursor, limit: 100 });
    cursor = result.list_complete ? undefined : result.cursor;
    const sessions = await Promise.all(result.keys.map((key) => env.CHAT_STORE.get(key.name)));

    for (const raw of sessions) {
      if (!raw) continue;
      try {
        const session = normalizeStoredSession(JSON.parse(raw));
        if (!session || session.expiresAt <= Date.now()) continue;
        output.set(session.label, (output.get(session.label) || 0) + 1);
      } catch {
        // Ignore malformed session records; getSession will clean them when encountered.
      }
    }
  } while (cursor);

  return output;
}

type MessageNormalizationError = {
  ok: false;
  error: ImageValidationErrorCode | FileValidationErrorCode;
  message: string;
  status: 400 | 413;
};

type MessageNormalizationResult =
  | { ok: true; messages: ChatMessage[] }
  | MessageNormalizationError;

type MessageNormalizationOptions = {
  fileInput?: boolean;
};

export function imageInputPolicy(env: Env): ImageInputPolicy {
  return {
    acceptedMediaTypes: [...DEFAULT_IMAGE_INPUT_POLICY.acceptedMediaTypes],
    maxImages: Math.min(
      numberEnv(env.MAX_IMAGES_PER_REQUEST, DEFAULT_IMAGE_INPUT_POLICY.maxImages),
      DEFAULT_IMAGE_INPUT_POLICY.maxImages,
    ),
    maxImageBytes: Math.min(
      numberEnv(env.MAX_IMAGE_BYTES, DEFAULT_IMAGE_INPUT_POLICY.maxImageBytes),
      MAX_INLINE_IMAGE_BYTES_PER_MESSAGE,
    ),
    maxTotalImageBytes: Math.min(
      numberEnv(env.MAX_TOTAL_IMAGE_BYTES, DEFAULT_IMAGE_INPUT_POLICY.maxTotalImageBytes),
      MAX_INLINE_IMAGE_BYTES_PER_MESSAGE,
    ),
  };
}

export function fileInputPolicy(env: Env): FileInputPolicy {
  return {
    acceptedMediaTypes: [...DEFAULT_FILE_INPUT_POLICY.acceptedMediaTypes],
    acceptedExtensions: [...DEFAULT_FILE_INPUT_POLICY.acceptedExtensions],
    maxFiles: Math.min(
      numberEnv(env.MAX_FILES_PER_REQUEST, DEFAULT_FILE_INPUT_POLICY.maxFiles),
      DEFAULT_FILE_INPUT_POLICY.maxFiles,
    ),
    maxFileBytes: Math.min(
      numberEnv(env.MAX_FILE_BYTES, DEFAULT_FILE_INPUT_POLICY.maxFileBytes),
      DEFAULT_FILE_INPUT_POLICY.maxFileBytes,
    ),
    maxTotalBytes: Math.min(
      numberEnv(env.MAX_TOTAL_FILE_BYTES, DEFAULT_FILE_INPUT_POLICY.maxTotalBytes),
      MAX_INLINE_FILE_BYTES_PER_MESSAGE,
    ),
    maxExtractedChars: Math.min(
      numberEnv(env.MAX_FILE_CHARS, DEFAULT_FILE_INPUT_POLICY.maxExtractedChars),
      DEFAULT_FILE_INPUT_POLICY.maxExtractedChars,
    ),
  };
}

export function normalizeMessages(
  input: unknown,
  env: Env,
  options: MessageNormalizationOptions = {},
): MessageNormalizationResult {
  if (!Array.isArray(input)) return { ok: true, messages: [] };

  const maxTextChars = numberEnv(env.MAX_TEXT_CHARS, 12_000);
  const imagePolicy = imageInputPolicy(env);
  const textFilePolicy = fileInputPolicy(env);
  const messages: ChatMessage[] = [];

  for (const item of input.slice(-MAX_MESSAGES)) {
    if (!isRecord(item)) continue;
    const role = item.role;
    if (role !== "system" && role !== "user" && role !== "assistant") continue;

    if (typeof item.content === "string") {
      const content = item.content.slice(0, maxTextChars);
      if (content.trim()) messages.push({ role, content });
      continue;
    }

    if (!Array.isArray(item.content)) continue;
    const parts: ChatPart[] = [];
    let imageCount = 0;
    let totalImageBytes = 0;
    let textFileState = emptyTextFileValidationState();
    for (const part of item.content) {
      if (!isRecord(part)) continue;
      if (part.type === "text" && typeof part.text === "string") {
        parts.push({ type: "text", text: part.text.slice(0, maxTextChars) });
        continue;
      }
      if (part.type === "file") {
        const parsedImage = parseDataImage(part.url, part.mediaType);
        if (parsedImage.ok) {
          if (imageCount >= imagePolicy.maxImages) return imageNormalizationError("too_many_images");
          if (!imagePolicy.acceptedMediaTypes.includes(parsedImage.image.mediaType)) {
            return imageNormalizationError("invalid_image_type");
          }
          if (parsedImage.image.decodedBytes > imagePolicy.maxImageBytes) {
            return imageNormalizationError("image_too_large");
          }
          if (totalImageBytes + parsedImage.image.decodedBytes > imagePolicy.maxTotalImageBytes) {
            return imageNormalizationError("images_too_large");
          }
          imageCount += 1;
          totalImageBytes += parsedImage.image.decodedBytes;
          parts.push({
            type: "image_url",
            image_url: { url: `data:${parsedImage.image.mediaType};base64,${parsedImage.image.data}` },
          });
          continue;
        }
        if (!options.fileInput || role !== "user") return fileNormalizationError("file_not_supported");
        const parsedFile = parseDataTextFile(part.url, part.mediaType, part.filename, textFilePolicy, textFileState);
        if (!parsedFile.ok) return fileNormalizationError(parsedFile.error);
        textFileState = parsedFile.state;
        parts.push({ type: "text", text: parsedFile.file.contextText });
        continue;
      }
      if (part.type !== "image_url") continue;
      if (imageCount >= imagePolicy.maxImages) return imageNormalizationError("too_many_images");
      if (!isRecord(part.image_url)) return imageNormalizationError("invalid_image_data");
      const parsed = parseDataImage(part.image_url.url);
      if (!parsed.ok) return imageNormalizationError(parsed.error);
      if (parsed.image.decodedBytes > imagePolicy.maxImageBytes) {
        return imageNormalizationError("image_too_large");
      }
      if (totalImageBytes + parsed.image.decodedBytes > imagePolicy.maxTotalImageBytes) {
        return imageNormalizationError("images_too_large");
      }
      imageCount += 1;
      totalImageBytes += parsed.image.decodedBytes;
      parts.push({
        type: "image_url",
        image_url: { url: `data:${parsed.image.mediaType};base64,${parsed.image.data}` },
      });
    }
    if (parts.length) messages.push({ role, content: parts });
  }

  return { ok: true, messages };
}

function imageNormalizationError(error: ImageValidationErrorCode): MessageNormalizationError {
  const messages: Record<ImageValidationErrorCode, string> = {
    invalid_image_type: "图片格式不受支持。",
    invalid_image_data: "图片数据无效。",
    image_too_large: "单张图片超过大小限制。",
    too_many_images: "图片数量超过限制。",
    images_too_large: "图片总大小超过限制。",
  };
  return {
    ok: false,
    error,
    message: messages[error],
    status: error === "image_too_large" || error === "images_too_large" ? 413 : 400,
  };
}

function fileNormalizationError(error: FileValidationErrorCode): MessageNormalizationError {
  const messages: Record<FileValidationErrorCode, string> = {
    file_not_supported: "当前会话不支持文件上传。",
    invalid_file_type: "文件格式不受支持。",
    invalid_file_data: "文件内容无法按 UTF-8 文本读取。",
    file_too_large: "单个文件超过大小限制。",
    too_many_files: "文件数量超过限制。",
    files_too_large: "文件总大小超过限制。",
    file_text_too_large: "文件文本内容超过限制。",
  };
  return {
    ok: false,
    error,
    message: messages[error],
    status: error === "file_too_large" || error === "files_too_large" || error === "file_text_too_large" ? 413 : 400,
  };
}

function messagesContainImages(messages: ChatMessage[]): boolean {
  return messages.some((message) =>
    Array.isArray(message.content) && message.content.some((part) => part.type === "image_url"),
  );
}

function getLatestUserPrompt(messages: ChatMessage[]): { text: string; hasImages: boolean } | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "user") continue;

    if (typeof message.content === "string") {
      return { text: message.content, hasImages: false };
    }

    return {
      text: extractText(message.content),
      hasImages: message.content.some((part) => part.type === "image_url"),
    };
  }

  return null;
}

function getBlockedPrompts(env: Env, user: UserConfig): string[] {
  return [...parsePromptList(env.BLOCKED_PROMPTS), ...(user.blockedPrompts || [])];
}

function isBlockedPrompt(prompt: string, blockedPrompts: string[]): boolean {
  const normalizedPrompt = normalizePromptForBlocking(prompt);
  if (!normalizedPrompt) return false;

  return blockedPrompts.some((blocked) => normalizePromptForBlocking(blocked) === normalizedPrompt);
}

function normalizePromptForBlocking(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s\r\n\t]+/g, "")
    .replace(/[!！?？.。,:：;；'"“”‘’`~～\-_—|/\\()[\]{}<>《》]+/g, "");
}

function parsePromptList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()));
  }

  if (typeof value !== "string" || !value.trim()) return [];
  const trimmed = value.trim();
  if (trimmed.startsWith("[")) {
    try {
      return parsePromptList(JSON.parse(trimmed));
    } catch {
      return [];
    }
  }

  return trimmed
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

async function loadAccessCodes(env: Env): Promise<string> {
  const stored = await env.CHAT_STORE.get(ACCESS_CODES_KEY);
  if (stored?.trim()) return stored.trim();
  if (env.ACCESS_CODES_MODE === "managed") return "";
  return env.ACCESS_CODES?.trim() || "";
}

async function loadEditableAccessCodes(env: Env): Promise<{
  accessCodes: string;
  source: "kv" | "secret" | "managed";
}> {
  const stored = await env.CHAT_STORE.get(ACCESS_CODES_KEY);
  if (stored?.trim()) return { accessCodes: stored.trim(), source: "kv" };
  if (env.ACCESS_CODES_MODE === "managed") return { accessCodes: "", source: "managed" };
  return { accessCodes: env.ACCESS_CODES?.trim() || "", source: "secret" };
}

function parseAccessCodes(accessCodes: string): AccessEntry[] {
  return accessCodes
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.indexOf(":");
      const label = separator === -1 ? "friend" : entry.slice(0, separator).trim() || "friend";
      const code = separator === -1 ? entry : entry.slice(separator + 1).trim();
      return { label, code };
    })
    .filter((entry) => Boolean(entry.code));
}

async function findAccessLabel(accessCodes: string, code: string): Promise<string | null> {
  for (const entry of parseAccessCodes(accessCodes)) {
    if (isValidMemberLabel(entry.label) && await secureCompare(code, entry.code)) return entry.label;
  }

  return null;
}

function normalizeStringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const output: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") output[key] = item;
  }
  return Object.keys(output).length ? output : undefined;
}

function normalizePositiveInteger(value: unknown): number | undefined {
  const parsed = parseConfigNumber(value);
  return parsed !== undefined && Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function normalizeBoundedInteger(value: unknown, minimum: number, maximum: number): number | undefined {
  const parsed = parseConfigNumber(value);
  return parsed !== undefined && Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : undefined;
}

function normalizeNumber(value: unknown): number | undefined {
  return parseConfigNumber(value);
}

function parseConfigNumber(value: unknown): number | undefined {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value)
      : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function boundedInteger(value: unknown, minimum: number, maximum: number, fallback: number): number {
  return normalizeBoundedInteger(value, minimum, maximum) ?? fallback;
}

function extractText(content: string | ChatPart[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    return {} as T;
  }
}

function getCookie(request: Request, name: string): string | null {
  const cookie = request.headers.get("Cookie") || "";
  for (const part of cookie.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName === name) return rawValue.join("=");
  }
  return null;
}

function buildSessionCookie(value: string, maxAge: number, secure: boolean): string {
  return buildCookie(SESSION_COOKIE, value, maxAge, secure);
}

function buildAdminCookie(value: string, maxAge: number, secure: boolean): string {
  return buildCookie(ADMIN_COOKIE, value, maxAge, secure);
}

function buildCookie(name: string, value: string, maxAge: number, secure: boolean): string {
  const encoded = value ? encodeURIComponent(value) : "";
  const parts = [
    `${name}=${encoded}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

async function recordChatMetric(
  env: Env,
  args: {
    kind: "success" | "failure" | "route_error" | "rate_limited";
    label: string;
    routeId?: string;
    fallback?: boolean;
  },
): Promise<void> {
  await getUserState(env, args.label).recordMetric(args);
}

function normalizeSkillRegistry(value: unknown): Record<string, SkillConfig> {
  if (!isRecord(value)) return {};
  const output: Record<string, SkillConfig> = {};
  for (const [rawId, rawSkill] of Object.entries(value).slice(0, MAX_SKILLS)) {
    const id = normalizeCapabilityId(rawId, 80);
    if (!id || output[id] || !isRecord(rawSkill)) continue;
    const label = normalizeBoundedText(rawSkill.label, 80) || id;
    const instructions = normalizeBoundedText(rawSkill.instructions, MAX_SKILL_INSTRUCTIONS_CHARS);
    if (!instructions) continue;
    const order = normalizeNumber(rawSkill.order);
    output[id] = {
      enabled: rawSkill.enabled === true,
      label,
      description: normalizeBoundedText(rawSkill.description, 500) || undefined,
      instructions,
      toolIds: normalizeStringIdList(rawSkill.toolIds, MAX_TOOLS, 160),
      order: order === undefined ? undefined : Math.max(-10_000, Math.min(10_000, Math.trunc(order))),
    };
  }
  return output;
}

function normalizeMcpServerRegistry(value: unknown): Record<string, McpServerConfig> {
  if (!isRecord(value)) return {};
  const output: Record<string, McpServerConfig> = {};
  for (const [rawId, rawServer] of Object.entries(value).slice(0, MAX_MCP_SERVERS)) {
    const id = normalizeCapabilityId(rawId, 80);
    if (!id || output[id] || !isRecord(rawServer)) continue;
    const endpoint = normalizeBoundedText(rawServer.endpoint, 2_048);
    if (!endpoint) continue;
    const normalizedAuth = normalizeMcpAuthConfig(rawServer);
    const invalidLegacyNone = !isRecord(rawServer.auth)
      && rawServer.authType === "none"
      && rawServer.secretRef !== undefined;
    const auth = normalizedAuth || { version: 1, type: "none" } as const;
    const executable = normalizedAuth !== null
      && !invalidLegacyNone
      && isExecutableMcpServerConfig(endpoint, auth, false);
    output[id] = {
      enabled: rawServer.enabled === true && executable,
      label: normalizeBoundedText(rawServer.label, 80) || id,
      endpoint,
      auth,
    };
  }
  return output;
}

function normalizeMcpAuthConfig(value: Record<string, unknown>): McpServerConfig["auth"] | null {
  if (isRecord(value.auth)) {
    const rawAuth = value.auth;
    if (rawAuth.version !== 1) return null;
    if (rawAuth.type === "none") return { version: 1, type: "none" };
    if (rawAuth.type === "bearer" || rawAuth.type === "x-api-key") {
      const secretRef = normalizeBoundedText(rawAuth.secretRef, 64);
      return MANAGED_SECRET_REF_PATTERN.test(secretRef)
        ? { version: 1, type: rawAuth.type, secretRef }
        : null;
    }
    if (rawAuth.type !== "oauth2") return null;
    const issuer = normalizeMcpOAuthIssuer(rawAuth.issuer);
    const clientId = normalizeMcpOAuthClientId(rawAuth.clientId);
    const scopes = normalizeOAuthScopes(rawAuth.scopes);
    const callbackPath = rawAuth.callbackPath === MCP_OAUTH_CALLBACK_PATH ? MCP_OAUTH_CALLBACK_PATH : "";
    const configRevision = typeof rawAuth.configRevision === "string" && isSecretFingerprint(rawAuth.configRevision)
      ? rawAuth.configRevision
      : "";
    const rawClientSecretRef = normalizeBoundedText(rawAuth.clientSecretRef, 64);
    if (rawAuth.clientSecretRef !== undefined && !MANAGED_SECRET_REF_PATTERN.test(rawClientSecretRef)) return null;
    if (!issuer || !clientId || !callbackPath) return null;
    return {
      version: 1,
      type: "oauth2",
      issuer,
      clientId,
      scopes,
      callbackPath,
      configRevision,
      ...(rawClientSecretRef ? { clientSecretRef: rawClientSecretRef } : {}),
    };
  }

  const legacyType = value.authType;
  if (legacyType === "none") return { version: 1, type: "none" };
  if (legacyType !== "bearer" && legacyType !== "x-api-key") return null;
  const secretRef = normalizeBoundedText(value.secretRef, 64);
  return MANAGED_SECRET_REF_PATTERN.test(secretRef)
    ? { version: 1, type: legacyType, secretRef }
    : null;
}

async function applyMcpOAuthConfigRevisions(config: AppConfig): Promise<AppConfig> {
  const entries = await Promise.all(Object.entries(config.mcpServers || {}).map(async ([serverId, server]) => (
    [serverId, await applyMcpOAuthConfigRevision(serverId, server)] as const
  )));
  return { ...config, mcpServers: Object.fromEntries(entries) };
}

async function applyMcpOAuthConfigRevision(
  serverId: string,
  server: McpServerConfig,
): Promise<McpServerConfig> {
  if (server.auth.type !== "oauth2") return server;
  const configRevision = await secretFingerprint(JSON.stringify({
    version: server.auth.version,
    type: server.auth.type,
    serverId,
    endpoint: server.endpoint,
    issuer: server.auth.issuer,
    clientId: server.auth.clientId,
    scopes: server.auth.scopes,
    callbackPath: MCP_OAUTH_CALLBACK_PATH,
    clientSecretRef: server.auth.clientSecretRef || "",
  }));
  return { ...server, auth: { ...server.auth, callbackPath: MCP_OAUTH_CALLBACK_PATH, configRevision } };
}

function normalizeMcpOAuthIssuer(value: unknown): string {
  if (typeof value !== "string") return "";
  const issuer = value.trim().replace(/\/$/, "");
  return issuer && isSafeOAuthIssuer(issuer) ? issuer : "";
}

function normalizeMcpOAuthClientId(value: unknown): string {
  if (typeof value !== "string") return "";
  const clientId = value.trim();
  return clientId && clientId.length <= 256 && !/[\u0000-\u001f\u007f]/.test(clientId) ? clientId : "";
}

function isValidMcpOAuthConfig(auth: McpOAuth2AuthConfig, requireConfigRevision = true): boolean {
  const scopes = normalizeOAuthScopes(auth.scopes);
  return normalizeMcpOAuthIssuer(auth.issuer) === auth.issuer
    && normalizeMcpOAuthClientId(auth.clientId) === auth.clientId
    && scopes.length > 0
    && JSON.stringify(scopes) === JSON.stringify(auth.scopes)
    && auth.callbackPath === MCP_OAUTH_CALLBACK_PATH
    && (requireConfigRevision
      ? isSecretFingerprint(auth.configRevision)
      : auth.configRevision === "" || isSecretFingerprint(auth.configRevision))
    && (!auth.clientSecretRef || MANAGED_SECRET_REF_PATTERN.test(auth.clientSecretRef));
}

function isExecutableMcpServerConfig(
  endpoint: string,
  auth: McpServerConfig["auth"],
  requireOAuthRevision = true,
): boolean {
  if (!isValidMcpEndpoint(endpoint) || isForbiddenMcpUrl(new URL(endpoint))) return false;
  if (auth.type === "oauth2") return isValidMcpOAuthConfig(auth, requireOAuthRevision);
  return auth.type === "none" || MANAGED_SECRET_REF_PATTERN.test(auth.secretRef);
}

function normalizeToolRegistry(
  value: unknown,
  mcpServers: Record<string, McpServerConfig>,
): Record<string, ToolConfig> {
  if (!isRecord(value)) return {};
  const output: Record<string, ToolConfig> = {};
  for (const [rawId, rawTool] of Object.entries(value).slice(0, MAX_TOOLS)) {
    const id = normalizeCapabilityId(rawId, 160);
    if (!id || output[id] || !isRecord(rawTool) || !isRecord(rawTool.executor)) continue;
    const schema = normalizeMcpToolSchema(rawTool.inputSchema);
    if (!schema) continue;
    let executor: ToolExecutor | null = null;
    if (rawTool.executor.type === "builtin" && rawTool.executor.name === "text_stats" && id === "builtin:text_stats") {
      executor = { type: "builtin", name: "text_stats" };
    }
    if (rawTool.executor.type === "mcp") {
      const serverId = normalizeCapabilityId(rawTool.executor.serverId, 80);
      const remoteName = normalizeBoundedText(rawTool.executor.remoteName, 128);
      if (
        serverId &&
        mcpServers[serverId] &&
        remoteName &&
        MCP_REMOTE_NAME_PATTERN.test(remoteName) &&
        id === `mcp:${serverId}:${remoteName}`
      ) {
        executor = { type: "mcp", serverId, remoteName };
      }
    }
    if (!executor) continue;
    const confirmation = rawTool.confirmation;
    const schemaFingerprint = normalizeFingerprint(rawTool.schemaFingerprint);
    const securityFingerprint = normalizeFingerprint(rawTool.securityFingerprint);
    const sideEffect = rawTool.sideEffect === "read"
      || rawTool.sideEffect === "write"
      || rawTool.sideEffect === "destructive"
      ? rawTool.sideEffect
      : undefined;
    const reviewRevision = normalizeFingerprint(rawTool.reviewRevision);
    const governanceComplete = executor.type === "builtin"
      || Boolean(schemaFingerprint && securityFingerprint && sideEffect && reviewRevision);
    const reviewRequired = executor.type === "mcp"
      ? rawTool.reviewRequired === true || !governanceComplete
      : undefined;
    output[id] = {
      enabled: rawTool.enabled === true && reviewRequired !== true,
      label: normalizeBoundedText(rawTool.label, 80) || remoteToolLabel(executor),
      description: normalizeBoundedText(rawTool.description, 1_000) || undefined,
      inputSchema: schema,
      confirmation: executor.type === "builtin"
        ? confirmation === "always" ? "always" : "auto"
        : sideEffect === "write" || sideEffect === "destructive" || confirmation === "always"
          ? "always"
          : "first-per-conversation",
      executor,
      schemaFingerprint,
      securityFingerprint,
      sideEffect,
      reviewRevision,
      reviewRequired,
    };
  }
  return output;
}

function normalizeToolEvents(value: unknown): ToolEventSummary[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const output: ToolEventSummary[] = [];
  for (const rawEvent of value.slice(-MAX_TOOL_EVENTS)) {
    if (!isRecord(rawEvent)) continue;
    const id = normalizeCapabilityId(rawEvent.id, 100);
    const toolId = normalizeCapabilityId(rawEvent.toolId, 160);
    const label = normalizeBoundedText(rawEvent.label, 80);
    if (!id || !toolId || !label) continue;
    const source = rawEvent.source === "mcp" ? "mcp" : rawEvent.source === "builtin" ? "builtin" : null;
    const status = normalizeToolEventStatus(rawEvent.status);
    if (!source || !status) continue;
    const createdAt = Number.isFinite(rawEvent.createdAt) ? Number(rawEvent.createdAt) : Date.now();
    const updatedAt = Number.isFinite(rawEvent.updatedAt) ? Number(rawEvent.updatedAt) : createdAt;
    const interrupted = status === "pending" || status === "running" || status === "approved";
    const argumentSummary = normalizeBoundedText(rawEvent.argumentSummary, MAX_TOOL_ARGUMENT_SUMMARY_CHARS);
    const resultPreview = normalizeBoundedText(rawEvent.resultPreview, MAX_TOOL_RESULT_PREVIEW_CHARS);
    const contentTruncated =
      (typeof rawEvent.argumentSummary === "string" && rawEvent.argumentSummary.trim().length > argumentSummary.length) ||
      (typeof rawEvent.resultPreview === "string" && rawEvent.resultPreview.trim().length > resultPreview.length);
    output.push({
      id,
      toolId,
      label,
      source,
      status: interrupted ? "failed" : status,
      argumentSummary: argumentSummary || undefined,
      resultPreview: resultPreview || undefined,
      confirmation: rawEvent.confirmation === "once" || rawEvent.confirmation === "conversation"
        ? rawEvent.confirmation
        : undefined,
      errorCode: interrupted
        ? "interrupted"
        : normalizeBoundedText(rawEvent.errorCode, 80) || undefined,
      createdAt,
      updatedAt,
      truncated: rawEvent.truncated === true || contentTruncated || undefined,
    });
  }
  return output.length ? output : undefined;
}

function normalizeToolEventStatus(value: unknown): ToolEventSummary["status"] | null {
  return value === "pending" || value === "approved" || value === "running" || value === "completed" ||
    value === "failed" || value === "denied" ? value : null;
}

function normalizeSelectedSkillIds(value: unknown): string[] {
  return normalizeStringIdList(value, MAX_SELECTED_SKILLS, 80);
}

function normalizeConversationSkillMode(value: unknown): ConversationSkillMode | undefined {
  return value === "automatic" || value === "manual" ? value : undefined;
}

function normalizeStringIdList(value: unknown, limit: number, maxChars: number): string[] {
  if (!Array.isArray(value)) return [];
  const output: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const id = normalizeCapabilityId(item, maxChars);
    if (!id || output.includes(id)) continue;
    output.push(id);
    if (output.length >= limit) break;
  }
  return output;
}

function normalizeCapabilityId(value: unknown, maxChars: number): string {
  if (typeof value !== "string") return "";
  const id = value.trim();
  return id.length > 0 && id.length <= maxChars && CAPABILITY_ID_PATTERN.test(id) ? id : "";
}

function normalizeBoundedText(value: unknown, maxChars: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxChars) : "";
}

function normalizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.trim() || undefined;
}

function remoteToolLabel(executor: ToolExecutor): string {
  return executor.type === "builtin" ? "文本统计" : executor.remoteName;
}

async function appendAdminAudit(env: Env, action: string, target?: string): Promise<void> {
  await feedbackAuditService(env).appendAdminAudit(action, target);
}

async function revokeSessionsByLabel(env: Env, label: string): Promise<number> {
  let revoked = 0;
  let cursor: string | undefined;
  do {
    const result = await env.CHAT_STORE.list({ prefix: "session:", cursor, limit: 100 });
    cursor = result.list_complete ? undefined : result.cursor;
    const records = await Promise.all(result.keys.map(async (key) => ({ key: key.name, raw: await env.CHAT_STORE.get(key.name) })));
    const matches = records.filter(({ raw }) => {
      if (!raw) return false;
      try {
        return normalizeStoredSession(JSON.parse(raw))?.label === label;
      } catch {
        return false;
      }
    });
    await Promise.all(matches.map(({ key }) => env.CHAT_STORE.delete(key)));
    revoked += matches.length;
  } while (cursor);
  return revoked;
}

function utcDayString(daysAgo = 0): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

function usageKey(label: string, day: string): string {
  return `usage:${encodeURIComponent(label)}:${day}`;
}

function memoryKey(label: string): string {
  return `memory:${encodeURIComponent(label)}`;
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function secureCompare(actual: string, expected: string): Promise<boolean> {
  if (!actual || !expected) return false;
  const encoder = new TextEncoder();
  const [actualHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(actual)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const actualBytes = new Uint8Array(actualHash);
  const expectedBytes = new Uint8Array(expectedHash);
  let diff = actualBytes.length ^ expectedBytes.length;
  for (let index = 0; index < actualBytes.length && index < expectedBytes.length; index += 1) {
    diff |= actualBytes[index] ^ expectedBytes[index];
  }
  return diff === 0;
}

function numberEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function secretFingerprint(value: string): Promise<string> {
  if (!value) return "";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function requireMcpOAuthOwnerLabel(value: string): void {
  if (!MEMBER_LABEL_PATTERN.test(value)) {
    throw new McpOAuthError("mcp_oauth_config_invalid", "OAuth owner 无效");
  }
}

function requireMcpOAuthServerId(value: string): void {
  if (!CAPABILITY_ID_PATTERN.test(value) || value.length > 80) {
    throw new McpOAuthError("mcp_oauth_config_invalid", "OAuth MCP server 无效");
  }
}

function requireMcpOAuthRevision(value: string): void {
  if (!isSecretFingerprint(value)) {
    throw new McpOAuthError("mcp_oauth_config_invalid", "OAuth 配置 revision 无效");
  }
}

function isSecretFingerprint(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

function normalizeFingerprint(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value)
    ? value.toLowerCase()
    : undefined;
}

function isMcpOAuthOpaqueValue(value: string): boolean {
  return /^[A-Za-z0-9_-]{43,128}$/.test(value);
}

function isSafeMcpOAuthCallbackUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && !url.username
      && !url.password
      && !url.search
      && !url.hash
      && url.pathname === MCP_OAUTH_CALLBACK_PATH;
  } catch {
    return false;
  }
}

function requireMatchingMcpOAuthToken(auth: McpOAuth2AuthConfig, token: McpOAuthTokenSet): void {
  requireMcpOAuthRevision(auth.configRevision);
  if (!mcpOAuthTokenMatchesAuth(auth, token)) {
    throw new McpOAuthError("mcp_oauth_review_required", "OAuth token 与当前配置不匹配");
  }
  const normalizedScopes = normalizeOAuthScopes(token.grantedScopes);
  if (JSON.stringify(normalizedScopes) !== JSON.stringify(token.grantedScopes)) {
    throw new McpOAuthError("mcp_oauth_token_invalid", "OAuth granted scope 无效");
  }
}

function mcpOAuthTokenMatchesAuth(auth: McpOAuth2AuthConfig, token: McpOAuthTokenSet): boolean {
  return token.issuer === auth.issuer
    && token.clientId === auth.clientId
    && token.configRevision === auth.configRevision;
}

function parseStoredMcpOAuthScopes(value: string): string[] {
  try {
    return normalizeOAuthScopes(JSON.parse(value));
  } catch {
    return [];
  }
}

function normalizeStoredMcpOAuthDiscovery(value: unknown, expectedServerId: string): McpDiscoveryResult | null {
  if (
    !isRecord(value)
    || !hasOnlyRecordKeys(value, ["serverId", "tools", "rejected"])
    || value.serverId !== expectedServerId
    || !Array.isArray(value.tools)
    || value.tools.length > MAX_TOOLS
    || !Number.isSafeInteger(value.rejected)
    || Number(value.rejected) < 0
    || Number(value.rejected) > 100_000
  ) return null;
  const tools: McpDiscoveredTool[] = [];
  const ids = new Set<string>();
  for (const rawTool of value.tools) {
    if (
      !isRecord(rawTool)
      || !hasOnlyRecordKeys(rawTool, [
        "id",
        "label",
        "description",
        "inputSchema",
        "confirmation",
        "executor",
        "schemaFingerprint",
        "securityFingerprint",
        "sideEffect",
        "reviewRevision",
        "reviewRequired",
      ])
      || !isRecord(rawTool.executor)
      || !hasOnlyRecordKeys(rawTool.executor, ["type", "serverId", "remoteName"])
      || rawTool.executor.type !== "mcp"
      || rawTool.executor.serverId !== expectedServerId
      || typeof rawTool.executor.remoteName !== "string"
      || !MCP_REMOTE_NAME_PATTERN.test(rawTool.executor.remoteName)
      || rawTool.id !== `mcp:${expectedServerId}:${rawTool.executor.remoteName}`
      || typeof rawTool.id !== "string"
      || ids.has(rawTool.id)
      || typeof rawTool.label !== "string"
      || normalizeBoundedText(rawTool.label, 80) !== rawTool.label
      || typeof rawTool.description !== "string"
      || normalizeBoundedText(rawTool.description, 1_000) !== rawTool.description
      || typeof rawTool.schemaFingerprint !== "string"
      || !isSecretFingerprint(rawTool.schemaFingerprint)
      || typeof rawTool.securityFingerprint !== "string"
      || !isSecretFingerprint(rawTool.securityFingerprint)
      || typeof rawTool.reviewRevision !== "string"
      || !isSecretFingerprint(rawTool.reviewRevision)
      || (rawTool.sideEffect !== "read" && rawTool.sideEffect !== "write" && rawTool.sideEffect !== "destructive")
      || rawTool.confirmation !== (rawTool.sideEffect === "read" ? "first-per-conversation" : "always")
      || rawTool.reviewRequired !== true
    ) return null;
    const inputSchema = normalizeMcpToolSchema(rawTool.inputSchema);
    if (!inputSchema) return null;
    ids.add(rawTool.id);
    tools.push({
      id: rawTool.id,
      label: rawTool.label,
      description: rawTool.description,
      inputSchema,
      confirmation: rawTool.sideEffect === "read" ? "first-per-conversation" : "always",
      executor: {
        type: "mcp",
        serverId: expectedServerId,
        remoteName: rawTool.executor.remoteName,
      },
      schemaFingerprint: rawTool.schemaFingerprint,
      securityFingerprint: rawTool.securityFingerprint,
      sideEffect: rawTool.sideEffect,
      reviewRevision: rawTool.reviewRevision,
      reviewRequired: true,
    });
  }
  return { serverId: expectedServerId, tools, rejected: Number(value.rejected) };
}

function disconnectedMcpOAuthConnection(serverId: string): McpOAuthConnectionProjection {
  return {
    serverId,
    connected: false,
    reviewRequired: false,
    grantedScopes: [],
    status: "disconnected",
  };
}

async function handleMcpOAuthStart(
  request: Request,
  env: Env,
  session: Session,
  url: URL,
): Promise<Response> {
  if (session.kind !== "member") return jsonResponse({ error: "capability_not_allowed" }, 403);
  const body = await readJson<{ serverId?: unknown }>(request);
  const serverId = normalizeCapabilityId(body.serverId, 80);
  if (!serverId) return jsonResponse({ error: "invalid_mcp_server_id", message: "MCP Server ID 格式无效" }, 400);
  const config = await loadAppConfig(env);
  const server = config.mcpServers?.[serverId];
  if (!server || server.enabled !== true || server.auth.type !== "oauth2") {
    return jsonResponse({ error: "mcp_oauth_not_available", message: "OAuth MCP 服务未启用" }, 404);
  }
  try {
    const [metadata, pkce, sessionFingerprint] = await Promise.all([
      discoverMcpOAuthMetadata(server.auth),
      createMcpOAuthPkce(),
      mcpOAuthSessionFingerprint(request),
    ]);
    const callbackUrl = new URL(MCP_OAUTH_CALLBACK_PATH, url.origin).toString();
    await getUserState(env, session.label).storeMcpOAuthState({
      ownerLabel: session.label,
      state: pkce.state,
      sessionFingerprint,
      serverId,
      configRevision: server.auth.configRevision,
      verifier: pkce.verifier,
      callbackUrl,
      expiresAt: Date.now() + MCP_OAUTH_STATE_TTL_MS,
    });
    return jsonResponse({
      serverId,
      authorizationUrl: buildMcpOAuthAuthorizationUrl({
        metadata,
        auth: server.auth,
        callbackUrl,
        state: pkce.state,
        challenge: pkce.challenge,
      }),
    });
  } catch (error) {
    return mcpOAuthJsonError(error);
  }
}

async function handleMcpOAuthCallback(
  request: Request,
  env: Env,
  session: Session,
  url: URL,
): Promise<Response> {
  if (session.kind !== "member") return redirectMcpOAuthResult(url, "error");
  const stateValue = url.searchParams.get("state") || "";
  const sessionFingerprint = await mcpOAuthSessionFingerprint(request);
  const consumed = await getUserState(env, session.label).consumeMcpOAuthState({
    ownerLabel: session.label,
    state: stateValue,
    sessionFingerprint,
  });
  if (!consumed || url.searchParams.has("error")) return redirectMcpOAuthResult(url, "error");
  const code = url.searchParams.get("code") || "";
  if (!code || code.length > 8_192) return redirectMcpOAuthResult(url, "error");

  try {
    const config = await loadAppConfig(env);
    const server = config.mcpServers?.[consumed.serverId];
    if (
      !server
      || server.enabled !== true
      || server.auth.type !== "oauth2"
      || server.auth.configRevision !== consumed.configRevision
      || consumed.callbackUrl !== new URL(MCP_OAUTH_CALLBACK_PATH, url.origin).toString()
    ) return redirectMcpOAuthResult(url, "review_required");
    const [metadata, clientSecret] = await Promise.all([
      discoverMcpOAuthMetadata(server.auth),
      server.auth.clientSecretRef
        ? managedSecretService(env).resolve("mcp", server.auth.clientSecretRef)
        : Promise.resolve(undefined),
    ]);
    const token = await exchangeMcpOAuthCode({
      metadata,
      auth: server.auth,
      callbackUrl: consumed.callbackUrl,
      code,
      verifier: consumed.verifier,
      clientSecret: clientSecret || undefined,
    });
    const connection = await getUserState(env, session.label).storeMcpOAuthToken({
      ownerLabel: session.label,
      serverId: consumed.serverId,
      auth: server.auth,
      token,
    });
    await appendAdminAudit(env, "mcp.oauth.connect", `${session.label}:${consumed.serverId}`);
    return redirectMcpOAuthResult(url, connection.reviewRequired ? "review_required" : "connected");
  } catch {
    return redirectMcpOAuthResult(url, "error");
  }
}

async function handleMcpOAuthStatus(env: Env, session: Session): Promise<Response> {
  if (session.kind !== "member") return jsonResponse({ error: "capability_not_allowed" }, 403);
  return jsonResponse({ connections: await listMcpOAuthConnections(env, session) });
}

async function handleMcpOAuthDiscovery(request: Request, env: Env, session: Session): Promise<Response> {
  if (session.kind !== "member") return jsonResponse({ error: "capability_not_allowed" }, 403);
  const body = await readJson<{ serverId?: unknown }>(request);
  const serverId = normalizeCapabilityId(body.serverId, 80);
  if (!serverId) return jsonResponse({ error: "invalid_mcp_server_id", message: "MCP Server ID 格式无效" }, 400);
  const config = await loadAppConfig(env);
  const server = config.mcpServers?.[serverId];
  if (!server || server.enabled !== true || server.auth.type !== "oauth2") {
    return jsonResponse({ error: "mcp_oauth_not_available", message: "OAuth MCP 服务未启用" }, 404);
  }
  try {
    const discovery = await mcpRuntime(env, session.label).discoverTools(serverId, server, request.signal);
    const candidate = await getUserState(env, session.label).storeMcpOAuthDiscoveryCandidate({
      ownerLabel: session.label,
      serverId,
      configRevision: server.auth.configRevision,
      discovery,
    });
    await appendAdminAudit(env, "mcp.oauth.discovery", `${session.label}:${serverId}:${candidate.tools}/${candidate.rejected}`);
    return jsonResponse(candidate);
  } catch (error) {
    if (error instanceof McpOAuthError) return mcpOAuthJsonError(error);
    const capabilityError = toCapabilityError(error);
    return jsonResponse({ error: capabilityError.code, message: capabilityError.message }, 502);
  }
}

async function handleMcpOAuthRevoke(request: Request, env: Env, session: Session): Promise<Response> {
  if (session.kind !== "member") return jsonResponse({ error: "capability_not_allowed" }, 403);
  const body = await readJson<{ serverId?: unknown }>(request);
  const serverId = normalizeCapabilityId(body.serverId, 80);
  if (!serverId) return jsonResponse({ error: "invalid_mcp_server_id", message: "MCP Server ID 格式无效" }, 400);
  await getUserState(env, session.label).revokeMcpOAuthConnection(session.label, serverId);
  await appendAdminAudit(env, "mcp.oauth.revoke", `${session.label}:${serverId}`);
  return jsonResponse({ ok: true, serverId });
}

async function listMcpOAuthConnections(env: Env, session: Session): Promise<PublicMcpOAuthConnection[]> {
  if (session.kind !== "member") return [];
  const config = await loadAppConfig(env);
  const servers = Object.entries(config.mcpServers || {})
    .filter((entry): entry is [string, McpServerConfig & { auth: McpOAuth2AuthConfig }] => (
      entry[1].enabled === true && entry[1].auth.type === "oauth2"
    ))
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  const state = getUserState(env, session.label);
  return Promise.all(servers.map(async ([serverId, server]) => ({
    label: server.label,
    ...await state.getMcpOAuthConnection({
      ownerLabel: session.label,
      serverId,
      auth: server.auth,
    }),
  })));
}

async function mcpOAuthSessionFingerprint(request: Request): Promise<string> {
  const sessionToken = getCookie(request, SESSION_COOKIE);
  return secretFingerprint(`chatus:mcp-oauth-session:v1:${sessionToken}`);
}

function redirectMcpOAuthResult(url: URL, result: "connected" | "review_required" | "error"): Response {
  const target = new URL("/react-chat/", url.origin);
  target.searchParams.set("mcpOAuth", result);
  return Response.redirect(target.toString(), 303);
}

function mcpOAuthJsonError(error: unknown): Response {
  const code = error instanceof McpOAuthError ? error.code : "mcp_oauth_token_unavailable";
  const status = error instanceof McpOAuthError && error.retryable ? 503 : 400;
  return jsonResponse({ error: code, message: "OAuth MCP 暂时无法连接，请检查配置后重试" }, status);
}

function mcpOAuthConnectionProjection(
  serverId: string,
  grantedScopes: string[],
  expiresAt: number | undefined,
  reviewRequired: boolean,
  nowMs: number,
): McpOAuthConnectionProjection {
  const expired = expiresAt !== undefined && expiresAt <= nowMs;
  return {
    serverId,
    connected: !reviewRequired && !expired,
    reviewRequired,
    grantedScopes: [...grantedScopes],
    ...(expiresAt === undefined ? {} : { expiresAt }),
    status: reviewRequired ? "review_required" : expired ? "expired" : "connected",
  };
}

async function sha256HexBytes(value: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return hexBytes(digest);
}

function hexBytes(value: ArrayBuffer): string {
  return [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function workspaceContentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/gu, "_").replace(/["\\]/gu, "_").slice(0, 160) || "download";
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

async function accessCodesFingerprint(value: string): Promise<string> {
  return secretFingerprint(`chatus:access-codes:v1:${value.length}:${value}`);
}

function positiveCount(value: string | null): number {
  const parsed = Number(value || "0");
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function quotaAdmissionService(env: Env) {
  return createQuotaAdmissionService({
    getBucket: (label) => getUserState(env, label),
    readLegacyDayCount: async (label, day) => positiveCount(await env.CHAT_STORE.get(usageKey(label, day))),
    defaultDailyLimit: numberEnv(env.DAILY_MESSAGE_LIMIT, DEFAULT_DAILY_LIMIT),
    defaultMinuteLimit: numberEnv(env.MINUTE_MESSAGE_LIMIT, DEFAULT_MINUTE_LIMIT),
    defaultGuestPolicy: {
      sourceDailyMessageLimit: DEFAULT_GUEST_SOURCE_DAILY_LIMIT,
      sourceMinuteMessageLimit: DEFAULT_GUEST_SOURCE_MINUTE_LIMIT,
    },
    guestTurnLeaseMs: GUEST_TURN_LEASE_MS,
    now: () => Date.now(),
    createToken: randomToken,
  });
}

function getUserState(env: Env, label: string): DurableObjectStub<UserState> {
  return env.USER_STATE.getByName(label);
}

export async function getTeamAgentInstanceName(label: string): Promise<string> {
  const digest = await secretFingerprint(`team-agent:${label.trim()}`);
  return `member-${digest.slice(0, 48)}`;
}

export async function getTeamAgentConversationInstanceName(label: string, chatId: string): Promise<string> {
  const digest = await secretFingerprint(`team-agent:${label.trim()}:conversation:${chatId}`);
  return `chat-${digest.slice(0, 48)}`;
}

async function getTeamAgent(
  env: Env,
  label: string,
  session?: Session,
): Promise<DurableObjectStub<TeamAgent>> {
  const instance = await getTeamAgentInstanceName(label);
  const props: TeamAgentProps = { userLabel: label, scope: "root", ...teamAgentAccessProps(session) };
  const agent = await getAgentByName(env.TEAM_AGENT, instance, { props });
  const identity = await agent.ensureIdentity(props);
  if (!identity.ok) throw new Error(identity.error);
  return agent;
}

async function getTeamAgentConversation(
  env: Env,
  label: string,
  chatId: string,
  session?: Session,
): Promise<DurableObjectStub<TeamAgent>> {
  const [instance, rootInstance] = await Promise.all([
    getTeamAgentConversationInstanceName(label, chatId),
    getTeamAgentInstanceName(label),
  ]);
  const props: TeamAgentProps = {
    userLabel: label,
    scope: "conversation",
    chatId,
    rootInstance,
    ...teamAgentAccessProps(session),
  };
  const agent = await getAgentByName(env.TEAM_AGENT, instance, { props });
  const identity = await agent.ensureIdentity(props);
  if (!identity.ok) throw new Error(identity.error);
  return agent;
}

function teamAgentAccessProps(session?: Session): Pick<TeamAgentProps, "accessKind" | "sessionExpiresAt" | "sourceKey"> {
  if (session?.kind === "guest") {
    return { accessKind: "guest", sessionExpiresAt: session.expiresAt, sourceKey: session.sourceKey };
  }
  return { accessKind: "member", sessionExpiresAt: session?.expiresAt ?? Number.MAX_SAFE_INTEGER };
}


async function getLoginState(env: Env, request: Request, scope: "user" | "admin"): Promise<DurableObjectStub<UserState>> {
  const key = await sourceIdentityDigest(request);
  return env.USER_STATE.get(env.USER_STATE.idFromName(`login:${scope}:${key}`));
}

async function sourceIdentityDigest(request: Request): Promise<string> {
  const source = request.headers.get("CF-Connecting-IP")
    || request.headers.get("X-Forwarded-For")?.split(",", 1)[0]?.trim()
    || "unknown";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function secondsUntilNextUtcDay(nowMs = Date.now()): number {
  const now = new Date(nowMs);
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(60, Math.floor((next - now.getTime()) / 1000));
}

function utcDayStringAt(nowMs: number, daysAgo = 0): string {
  const date = new Date(nowMs);
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function textResponse(body: string, status: number, contentType: string): Response {
  return new Response(body, {
    status,
    headers: securityHeaders({ "Content-Type": `${contentType}; charset=utf-8` }),
  });
}

function jsonResponse(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: sensitiveResponseHeaders({
      "Content-Type": "application/json; charset=utf-8",
      ...headers,
    }),
  });
}

function sensitiveResponseHeaders(init: HeadersInit = {}): Headers {
  const headers = securityHeaders(init);
  headers.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
  headers.set("Pragma", "no-cache");
  headers.set("Expires", "0");
  return headers;
}

function withSecurityHeaders(response: Response): Response {
  const headers = securityHeaders(response.headers);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function withRequestId(response: Response, requestId: string): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Request-ID", requestId);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function securityHeaders(init: HeadersInit = {}): Headers {
  const headers = new Headers(init);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Permissions-Policy", "camera=(), geolocation=(), microphone=()");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  headers.set("Origin-Agent-Cluster", "?1");
  headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  headers.set(
    "Content-Security-Policy",
    "default-src 'self'; connect-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  );
  return headers;
}
