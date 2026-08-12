import { DurableObject } from "cloudflare:workers";
import { getAgentByName } from "agents";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker";
import type { JsonSchemaType } from "@modelcontextprotocol/sdk/validation";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import { generateText, type ModelMessage, type UIMessage } from "ai";
import type { TeamAgent } from "./agent/team-agent";
import type { InstanceCoordinator } from "./instance-coordinator";
import { IDENTITY_REGISTRY_INSTANCE_NAME, type IdentityRegistry } from "./identity-registry";
import {
  CONVERSATION_AGENT_ACCESS_BODY_KEY,
  CONVERSATION_AGENT_ACCESS_HEADER,
  MAX_AGENT_CONVERSATIONS,
  type AgentAccessibleConversationSummary,
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
  type ConversationAgentAccessContextV1,
  type ConversationSkillMode,
  type TeamAgentProps,
} from "./contracts/agent";
import {
  agentErrorMessage,
  createAgentErrorEnvelope,
  normalizeAgentRequestId,
  projectAgentStreamError,
  providerBudgetErrorHttpStatus,
  type AgentErrorCode,
} from "./contracts/agent-error";
import {
  PROVIDER_TURN_RUN_DEADLINE_MS,
  type ProviderTurnProgressV1,
} from "./contracts/provider-turn-progress";
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
import {
  LEGACY_SURFACE_ADMIN_LIMIT,
  LEGACY_SURFACE_MANIFEST,
  decodeLegacySurfaceAdvanceInput,
  decodeLegacySurfaceRollbackInput,
  decodeLegacySurfaceCensusSnapshot,
  legacySurfaceManifestDigest,
  legacySurfaceObjectName,
  type LegacySurfaceAdvanceInputV1,
  type LegacySurfaceAdminSnapshotV1,
  type LegacySurfaceCensusSnapshotV1,
  type LegacySurfaceCallerClass,
  type LegacySurfaceManifestRecordV1,
  type LegacySurfaceProjectionV1,
  type LegacySurfaceRollbackInputV1,
  type LegacySurfaceTransitionResult,
} from "./contracts/legacy-surface";
import type {
  ProviderConfig,
  ProviderCredential,
  ProviderType,
  ResolvedProviderRoute,
  RouteConfig,
} from "./contracts/provider";
import { createProviderTurnId } from "./contracts/provider-attempt";
import {
  PROVIDER_BUDGET_HOLD_REVIEW_AFTER_MS,
  decodeProviderBudgetOperatorActionRequest,
  decodeProviderBudgetPolicyMutationInput,
  decodeProviderPriceCatalogInput,
  decodeProviderReconciliationImportInput,
} from "./contracts/provider-finance";
import type {
  ProviderBudgetOperatorActionInputV1,
  ProviderBudgetPolicyInputV1,
  ProviderBudgetPolicyMutationInputV1,
} from "./contracts/provider-finance";
import type { GuestSession, Session, StoredSession } from "./contracts/session";
import {
  conversationResourceInstanceName,
  decodeStablePrincipalIdentity,
  isPrincipalId,
  isResourceId,
  normalizeMemberAlias,
  principalRootInstanceName,
  principalUserStateInstanceName,
  type ConversationAccessActionV1,
  type ConversationAccessSnapshotV1,
  type ConversationGrantRoleV1,
  type ConversationResourceRouteV1,
  type PrincipalRouteV1,
  type StablePrincipalIdentityV1,
  type StableTeamAgentIdentityV1,
} from "./contracts/identity";
import {
  MAX_WORKSPACE_FILE_BYTES,
  MAX_WORKSPACE_FILES_PER_CONVERSATION,
  MAX_WORKSPACE_LIST_LIMIT,
  decodeDocumentIngestMessage,
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
  createProviderFirstVisibleDeadline,
  raceWithAbort,
} from "./services/provider-first-visible-deadline";
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
  type TurnAdmission,
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
  ProviderToolError,
  ProviderToolRuntimeError,
  setAuthHeader,
  type ProviderToolExecutionResult,
  type ProviderToolHistory,
} from "./services/provider-tool-runtime";
import {
  createProviderPlanRuntime,
  type PreparedProviderRoute,
} from "./services/provider-plan-runtime";
import {
  createProviderAttemptRuntime,
  isProviderAttemptBlockingError,
  type ProviderAttemptHandle,
  type ProviderAttemptRun,
  type ProviderAttemptRuntime,
} from "./services/provider-attempt-runtime";
import {
  callProviderStream,
  UpstreamRequestError,
} from "./services/provider-stream-runtime";
import {
  PROVIDER_USAGE_TOKEN_FIELDS,
  type ProviderTokenUsageV1,
  type ProviderUsageEvidenceSource,
} from "./contracts/provider-finance";
import {
  createFeedbackAuditService,
  isDownFeedbackReason,
  type FeedbackReason,
} from "./services/feedback-audit";
import type { ProviderCoordinator } from "./provider-coordinator";
import type { ProviderAttemptLedger } from "./provider-attempt-ledger";
import {
  acquireInstanceOperationFence,
  INSTANCE_MAINTENANCE_COORDINATOR,
  type InstanceMaintenanceInspection,
  type InstanceOperationFence,
  type InstanceOperationKind,
  type InstanceOperationStateV1,
} from "./services/instance-capture";
import { captureDurableObjectState } from "./services/durable-object-capture";

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

type CapabilityChatRpcArgs = Omit<CapabilityChatArgs, "env" | "requestSignal" | "waitUntil"> & { chatId: string };

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
  requestId?: string;
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
  PROVIDER_ATTEMPT_LEDGER: DurableObjectNamespace<ProviderAttemptLedger>;
  INSTANCE_COORDINATOR: DurableObjectNamespace<InstanceCoordinator>;
  IDENTITY_REGISTRY: DurableObjectNamespace<IdentityRegistry>;
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
  DEPLOYMENT_SHA?: string;
  DOCUMENT_INGEST_QUEUE_NAME?: string;
  DOCUMENT_INGEST_DLQ_NAME?: string;
  PROVIDER_ATTEMPT_LEDGER_MODE?: string;
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
const ADMIN_CONFIG_MUTATION_COORDINATOR = "$admin-config";
const ADMIN_CONFIG_MUTATION_WAIT_MS = 10_000;
const ADMIN_CONFIG_MUTATION_LEASE_TTL_MS = 60_000;
const ADMIN_CONFIG_MUTATION_RENEW_MS = 20_000;
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
const LEGACY_ADMIN_ALIAS_SURFACE_ID = "legacy.browser.admin-alias";
const LEGACY_BROWSER_SHELL_SURFACE_ID = "legacy.browser.shell";
const LEGACY_API_CHAT_POST_SURFACE_ID = "legacy.api.chat-post";
const USER_STATE_STABLE_IDENTITY_STORAGE_KEY = "chatus:stable-user-identity:v1";
const LEGACY_SURFACE_CALLER_HEADER = "x-chatus-legacy-caller";
const LEGACY_SURFACE_DEPLOYMENT_SHA_PATTERN = /^[a-f0-9]{40}$/;
const LEGACY_BROWSER_SHELL_ASSET_PATHS = new Set([
  "/legacy/index.html",
  "/app.js",
  "/markdown.js",
  "/theme.js",
  "/styles.css",
  "/icons.svg",
]);
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

export const USER_STATE_SCHEMA_VERSION = 1;

const USER_STATE_CAPTURE_TABLES = new Set([
  "_chatus_schema_migrations",
  "usage",
  "bursts",
  "login_failures",
  "metrics",
  "chats",
  "deleted_chats",
  "user_state",
  "guest_turn_lease",
  "mcp_oauth_owner",
  "mcp_oauth_states",
  "mcp_oauth_tokens",
  "mcp_oauth_discovery_candidates",
]);

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
        CREATE TABLE IF NOT EXISTS _chatus_schema_migrations (
          id INTEGER PRIMARY KEY,
          applied_at INTEGER NOT NULL
        );
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
        INSERT OR IGNORE INTO _chatus_schema_migrations(id, applied_at) VALUES (1, 0);
      `);
      const instanceName = ctx.id.name;
      if (!instanceName) throw new Error("user_state_instance_name_unavailable");
      const rebuildable = instanceName.startsWith("login:")
        || instanceName.startsWith("guest-source:")
        || instanceName.startsWith("guest-");
      const registered = await env.INSTANCE_COORDINATOR
        .getByName(INSTANCE_MAINTENANCE_COORDINATOR)
        .registerObject({
          version: 1,
          kind: "user_state",
          instanceName,
          rootInstanceName: "",
          schemaVersion: `user-state-v${USER_STATE_SCHEMA_VERSION}`,
          stateClass: rebuildable ? "rebuildable" : "authoritative",
          restoreBehavior: rebuildable ? "rebuild" : "restore",
          registeredAt: Date.now(),
        });
      if (!registered.ok) throw new Error(registered.error);
    });
  }

  async getCaptureSchemaVersion(): Promise<string> {
    const version = this.ctx.storage.sql
      .exec<{ version: number }>("SELECT COALESCE(MAX(id), 0) AS version FROM _chatus_schema_migrations")
      .one().version;
    if (version !== USER_STATE_SCHEMA_VERSION) throw new Error("user_state_schema_version_unsupported");
    return `user-state-v${version}`;
  }

  async captureInstanceState(captureEpoch: string) {
    if (!isCaptureEpoch(captureEpoch)) throw new Error("capture_epoch_invalid");
    const schemaVersion = await this.getCaptureSchemaVersion();
    return captureDurableObjectState(
      this.ctx.storage,
      schemaVersion,
      (table) => USER_STATE_CAPTURE_TABLES.has(table),
    );
  }

  async ensureStableIdentity(input: unknown): Promise<{ ok: true; digest: string; registryRevision: number }> {
    const marker = decodeStablePrincipalIdentity(input);
    if (!marker || this.ctx.id.name !== marker.userStateInstanceName) {
      throw new Error("user_state_stable_identity_invalid");
    }
    const storedValue = await this.ctx.storage.get<unknown>(USER_STATE_STABLE_IDENTITY_STORAGE_KEY);
    const stored = storedValue === undefined ? undefined : decodeStablePrincipalIdentity(storedValue);
    if (storedValue !== undefined && !stored) throw new Error("user_state_stable_identity_corrupt");
    if (stored && !sameStablePrincipalIdentity(stored, marker)) {
      throw new Error("user_state_stable_identity_conflict");
    }
    if (stored && marker.registryRevision < stored.registryRevision) {
      throw new Error("user_state_stable_identity_stale");
    }
    const active = stored && stored.registryRevision >= marker.registryRevision ? stored : marker;
    if (!stored || active.registryRevision !== stored.registryRevision) {
      await this.ctx.storage.put(USER_STATE_STABLE_IDENTITY_STORAGE_KEY, active);
    }
    return {
      ok: true,
      digest: await stablePrincipalIdentityDigest(active),
      registryRevision: active.registryRevision,
    };
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
      { ...args, env: this.runtimeEnv, waitUntil: (promise) => this.ctx.waitUntil(promise) },
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
    await this.ctx.storage.delete(USER_STATE_STABLE_IDENTITY_STORAGE_KEY);
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
      const budgetResponse = url.pathname.startsWith("/api/")
        ? providerBudgetJsonResponse(error)
        : undefined;
      const response = budgetResponse
        || (url.pathname.startsWith("/api/") || url.pathname === "/healthz" || url.pathname.startsWith("/agent")
          ? jsonResponse({ error: "internal_error", requestId }, 500)
          : textResponse("Internal server error", 500, "text/plain"));
      return withRequestId(response, requestId);
    }
  },
  async queue(batch: MessageBatch<DocumentIngestMessage>, env: Env): Promise<void> {
    await handleDocumentIngestBatch(batch, env);
  },
};

async function handleDocumentIngestBatch(batch: MessageBatch<DocumentIngestMessage>, env: Env): Promise<void> {
  if ((await inspectInstanceMaintenance(env)).blocked) {
    for (const message of batch.messages) message.retry();
    return;
  }
  const mainQueue = env.DOCUMENT_INGEST_QUEUE_NAME?.trim() || "";
  const deadLetterQueue = env.DOCUMENT_INGEST_DLQ_NAME?.trim() || "";
  if (!mainQueue || !deadLetterQueue || mainQueue === deadLetterQueue) {
    for (const message of batch.messages) message.retry();
    return;
  }
  if (batch.queue === deadLetterQueue) {
    for (const message of batch.messages) {
      await handleDocumentIngestMessageWithFence(message, env, batch.queue, handleDocumentIngestDlqMessage);
    }
    return;
  }
  if (batch.queue !== mainQueue) {
    for (const message of batch.messages) message.retry();
    return;
  }
  for (const message of batch.messages) {
    await handleDocumentIngestMessageWithFence(message, env, batch.queue, handleDocumentIngestMessage);
  }
}

async function handleDocumentIngestMessageWithFence(
  message: Message<DocumentIngestMessage>,
  env: Env,
  queue: string,
  handler: (message: Message<DocumentIngestMessage>, env: Env) => Promise<void>,
): Promise<void> {
  const operationId = `queue:${await sha256HexBytes(
    new TextEncoder().encode(`${queue}\0${message.id}`),
  )}`;
  const fence = await acquireInstanceOperation(env, operationId, "document_ingest");
  if (!fence) {
    message.retry();
    return;
  }
  try {
    await handler(message, env);
  } finally {
    await fence.release().catch(() => undefined);
  }
}

async function handleDocumentIngestDlqMessage(message: Message<DocumentIngestMessage>, env: Env): Promise<void> {
  const body = decodeDocumentIngestMessage(message.body);
  if (!body) {
    message.ack();
    return;
  }
  try {
    const session = await resolveDocumentIngestOwnerSession(env, body);
    if (!session) {
      message.ack();
      return;
    }
    const root = await resolveDocumentIngestRoot(env, body);
    if (!root) {
      message.ack();
      return;
    }
    await root.recordDocumentIngestDlq(body, "document_ingest_retry_exhausted");
    message.ack();
  } catch {
    message.retry();
  }
}

async function handleDocumentIngestMessage(message: Message<DocumentIngestMessage>, env: Env): Promise<void> {
  const body = decodeDocumentIngestMessage(message.body);
  if (!body) {
    message.ack();
    return;
  }
  let root: DurableObjectStub<TeamAgent>;
  try {
    const session = await resolveDocumentIngestOwnerSession(env, body);
    if (!session) {
      message.ack();
      return;
    }
    const resolvedRoot = await resolveDocumentIngestRoot(env, body);
    if (!resolvedRoot) {
      message.ack();
      return;
    }
    root = resolvedRoot;
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
    return handleRequestWithInstanceOperation(
      env,
      `${requestId}:agent`,
      "agent_turn",
      () => handleTeamAgentRequest(request, env, url, ctx, requestId),
    );
  }
  if (url.pathname.startsWith("/api/")) {
    if (isBlockedMaintenanceRequest(request, url)) {
      return handleRequestWithInstanceOperation(
        env,
        `${requestId}:${url.pathname === MCP_OAUTH_CALLBACK_PATH ? "oauth" : "http"}`,
        url.pathname === MCP_OAUTH_CALLBACK_PATH ? "oauth_callback" : "http_mutation",
        (fence) => handleApi(request, env, url, ctx, requestId, fence),
      );
    }
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
    await recordLegacyBrowserSurfaceUse(LEGACY_BROWSER_SHELL_SURFACE_ID, request, env, url);
    return Response.redirect(new URL("/legacy/", url).toString(), 308);
  }
  if (request.method === "GET" && url.pathname === "/legacy/") {
    await recordLegacyBrowserSurfaceUse(LEGACY_BROWSER_SHELL_SURFACE_ID, request, env, url);
    return fetchRewrittenAsset(request, env, url, "/legacy/");
  }
  if (request.method === "GET" && url.pathname === "/admin.html") {
    await recordLegacyBrowserSurfaceUse(LEGACY_ADMIN_ALIAS_SURFACE_ID, request, env, url);
    const target = new URL("/react-chat/admin", url);
    target.search = url.search;
    return Response.redirect(target.toString(), 308);
  }
  if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    const shellPath = env.DEFAULT_CLIENT === "legacy" ? "/legacy/" : "/react-chat/index.html";
    if (shellPath === "/legacy/") {
      await recordLegacyBrowserSurfaceUse(LEGACY_BROWSER_SHELL_SURFACE_ID, request, env, url);
    }
    return fetchRewrittenAsset(request, env, url, shellPath);
  }
  if (request.method === "GET" && LEGACY_BROWSER_SHELL_ASSET_PATHS.has(url.pathname)) {
    await recordLegacyBrowserSurfaceUse(LEGACY_BROWSER_SHELL_SURFACE_ID, request, env, url);
  }
  const assetResponse = await env.ASSETS.fetch(request);
  return withAssetCacheHeaders(assetResponse, url);
}

async function recordLegacyBrowserSurfaceUse(
  surfaceId: typeof LEGACY_ADMIN_ALIAS_SURFACE_ID | typeof LEGACY_BROWSER_SHELL_SURFACE_ID,
  request: Request,
  env: Env,
  url: URL,
): Promise<void> {
  // Browser rollback routes remain fail-open while their observation store is unavailable.
  await recordLegacySurfaceUse(surfaceId, request, env, url, "read");
}

type LegacySurfaceUseResult =
  | { ok: true; disabled: boolean; writeDisabled: boolean }
  | { ok: false; error: string };

async function recordLegacySurfaceUse(
  surfaceId: string,
  request: Request,
  env: Env,
  url: URL,
  access: "read" | "write",
): Promise<LegacySurfaceUseResult> {
  try {
    const manifest = LEGACY_SURFACE_MANIFEST.find((record) => record.surfaceId === surfaceId);
    if (!manifest) return { ok: false, error: "legacy_surface_not_found" };
    const callerClass = classifyLegacyBrowserSurfaceCaller(request, manifest.callerClasses);
    const deploymentSha = await resolveLegacySurfaceDeploymentSha(env, url);
    if (!deploymentSha) return { ok: false, error: "legacy_surface_unavailable" };
    const manifestDigest = await legacySurfaceManifestDigest();
    const coordinator = env.INSTANCE_COORDINATOR.getByName(legacySurfaceObjectName(manifest.surfaceId));
    const synchronized = await coordinator.syncLegacySurfaceManifest({ version: 1, manifest, manifestDigest });
    if (!synchronized.ok) return synchronized;
    const control = access === "read" ? synchronized.projection.readControl : synchronized.projection.writeControl;
    const disabled = control === "disabled";
    // A disabled write is not an admitted legacy execution. A disabled read is
    // retained as late-caller evidence before the compatibility route rejects it.
    if (!(disabled && access === "write")) {
      const recorded = await coordinator.recordLegacySurfaceUse({
        version: 1,
        surfaceId: manifest.surfaceId,
        callerClass,
        access,
        occurredAt: Date.now(),
        deploymentSha,
      });
      if (!recorded.ok) return recorded;
    }
    return {
      ok: true,
      disabled,
      writeDisabled: synchronized.projection.writeControl === "disabled",
    };
  } catch {
    return { ok: false, error: "legacy_surface_unavailable" };
  }
}

function classifyLegacyBrowserSurfaceCaller(
  request: Request,
  allowedCallerClasses: readonly LegacySurfaceCallerClass[],
): LegacySurfaceCallerClass {
  const declared = request.headers.get(LEGACY_SURFACE_CALLER_HEADER);
  if (declared !== null) {
    return allowedCallerClasses.find((callerClass) => callerClass === declared) ?? "worker_api";
  }
  const fetchMode = request.headers.get("sec-fetch-mode")?.toLowerCase();
  const fetchDestination = request.headers.get("sec-fetch-dest")?.toLowerCase();
  const acceptsHtml = request.headers.get("accept")?.toLowerCase().includes("text/html") === true;
  if (
    fetchMode === "navigate"
    || request.headers.has("sec-fetch-site")
    || fetchDestination === "document"
    || fetchDestination === "script"
    || fetchDestination === "style"
    || fetchDestination === "image"
    || acceptsHtml
  ) return "browser";
  return "worker_api";
}

async function resolveLegacySurfaceDeploymentSha(
  env: Env,
  url: URL,
): Promise<string | undefined> {
  const candidates = [
    env.DEPLOYMENT_SHA,
  ];
  for (const candidate of candidates) {
    if (candidate && LEGACY_SURFACE_DEPLOYMENT_SHA_PATTERN.test(candidate)) return candidate;
  }
  try {
    const release = await env.ASSETS.fetch(new Request(new URL("/release.json", url)));
    if (!release.ok) return undefined;
    const body: unknown = await release.json();
    const commit = isRecord(body) && typeof body.commit === "string" ? body.commit : "";
    return LEGACY_SURFACE_DEPLOYMENT_SHA_PATTERN.test(commit) ? commit : undefined;
  } catch {
    return undefined;
  }
}

async function inspectInstanceMaintenance(env: Env): Promise<InstanceMaintenanceInspection> {
  try {
    return await env.INSTANCE_COORDINATOR
      .getByName(INSTANCE_MAINTENANCE_COORDINATOR)
      .inspectMaintenance();
  } catch {
    return { blocked: true, error: "instance_maintenance_state_invalid" };
  }
}

async function acquireInstanceOperation(
  env: Env,
  operationId: string,
  kind: InstanceOperationKind,
): Promise<InstanceOperationFence | undefined> {
  const coordinator = env.INSTANCE_COORDINATOR.getByName(INSTANCE_MAINTENANCE_COORDINATOR);
  return acquireInstanceOperationFence(coordinator, {
    version: 1,
    operationId,
    kind,
    startedAt: Date.now(),
  });
}

async function acquireBackgroundInstanceOperation(
  env: Env,
  scope: string,
): Promise<InstanceOperationFence | undefined> {
  return acquireInstanceOperation(env, `${scope}:${crypto.randomUUID()}`, "background_cleanup");
}

function requireInstanceFence(fence: InstanceOperationFence | undefined): InstanceOperationFence {
  if (!fence) throw new Error("instance_operation_fence_required");
  return fence;
}

async function handleRequestWithInstanceOperation(
  env: Env,
  operationId: string,
  kind: InstanceOperationKind,
  handler: (fence: InstanceOperationFence) => Promise<Response>,
): Promise<Response> {
  const fence = await acquireInstanceOperation(env, operationId, kind);
  if (!fence) {
    const maintenance = await inspectInstanceMaintenance(env);
    return instanceMaintenanceResponse(maintenance.blocked
      ? maintenance
      : { blocked: true, error: "instance_maintenance_state_invalid" });
  }
  let response: Response;
  try {
    response = await handler(fence);
  } catch (error) {
    await fence.release().catch(() => undefined);
    throw error;
  }
  return responseWithInstanceOperationFence(response, fence);
}

async function responseWithInstanceOperationFence(
  response: Response,
  fence: InstanceOperationFence,
): Promise<Response> {
  return responseWithRelease(response, fence.release);
}

async function responseWithRelease(
  response: Response,
  release: () => Promise<void>,
): Promise<Response> {
  const isEventStream = response.headers.get("Content-Type")?.toLowerCase().includes("text/event-stream") === true;
  if (response.webSocket) {
    const settle = () => void release().catch(() => undefined);
    response.webSocket.addEventListener("close", settle, { once: true });
    response.webSocket.addEventListener("error", settle, { once: true });
    return response;
  }
  if (!response.body || !isEventStream) {
    await release();
    return response;
  }
  const reader = response.body.getReader();
  let settled = false;
  const settle = async () => {
    if (settled) return;
    settled = true;
    await release().catch(() => undefined);
  };
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await reader.read();
        if (next.done) {
          await settle();
          controller.close();
        } else {
          controller.enqueue(next.value);
        }
      } catch (error) {
        await settle();
        controller.error(error);
      }
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => undefined);
      await settle();
    },
  }, { highWaterMark: 0 });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

function isBlockedMaintenanceRequest(request: Request, url: URL): boolean {
  if (
    (url.pathname === "/api/logout" || url.pathname === "/api/admin/logout")
    && request.method === "POST"
  ) return false;
  if (request.method === "GET" || request.method === "HEAD") {
    return url.pathname === MCP_OAUTH_CALLBACK_PATH || url.pathname === "/api/mcp/oauth/status";
  }
  return request.method !== "OPTIONS";
}

function instanceMaintenanceResponse(inspection: Extract<InstanceMaintenanceInspection, { blocked: true }>): Response {
  return jsonResponse({
    error: "instance_maintenance",
    message: agentErrorMessage("instance_maintenance"),
    ...(inspection.state ? { revision: inspection.state.revision } : {}),
  }, 503, { "Retry-After": "5" });
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
  const maintenance = await inspectInstanceMaintenance(env);
  try {
    const [config, accessCodes, kvProbe] = await Promise.all([
      loadAppConfig(env),
      loadAccessCodes(env),
      env.CHAT_STORE.get("health:probe"),
    ]);
    void kvProbe;
    const configured = Object.values(config.routes).some((route) => route.enabled !== false);
    const memberAccessConfigured = parseAccessCodes(accessCodes).length > 0;
    if (maintenance.blocked) {
      if (maintenance.state) {
        return jsonResponse({
          status: "maintenance",
          checks: {
            kv: true,
            configured,
            memberAccessConfigured,
            maintenance: true,
          },
        });
      }
      return jsonResponse({
        status: "degraded",
        checks: {
          kv: true,
          durableObject: false,
          legacyDurableObject: false,
          teamAgent: false,
          configured,
          memberAccessConfigured,
        },
      }, 503);
    }
    const [legacyDurableObject, teamAgent] = await Promise.all([
      getUserState(env, "health:probe").healthCheck(),
      getTeamAgent(env, "health:probe").then((agent) => agent.healthCheck()),
    ]);
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
  const maintenance = await inspectInstanceMaintenance(env);
  if (maintenance.blocked) return instanceMaintenanceResponse(maintenance);
  await scheduleGuestCleanupDrain(env, ctx, requestId);

  const session = await getSession(request, env);
  if (!session) return jsonResponse({ error: "unauthorized" }, 401);

  const chatId = normalizeAgentConversationId(url.searchParams.get("chatId"));
  if (!chatId) {
    return jsonResponse({ error: "invalid_chat_id", message: "会话 ID 无效" }, 400);
  }
  if (session.kind === "member") {
    const resourceId = url.searchParams.get("resourceId");
    if (!resourceId) {
      await ensureAgentLegacyImport(env, session.label, session);
      const root = await getTeamAgent(env, session.label, session);
      await drainAgentConversationCleanup(env, session.label, root, Date.now(), true, session);
      const now = Date.now();
      const created = await root.createConversation({
        id: chatId,
        title: "新对话",
        createdAt: now,
        updatedAt: now,
        summary: "",
        pinned: false,
        skillMode: "automatic",
        skillIds: [],
      });
      if (!created.ok) return agentConversationMutationError(created);
    }
    const resolved = await resolveConversationAccessForMember(
      env,
      session,
      chatId,
      "conversation.read",
      resourceId,
      !resourceId,
    );
    if (!resolved.ok) return resolved.response;
    const summary = await env.TEAM_AGENT.getByName(resolved.access.ownerRootInstanceName)
      .getConversationSummary(chatId)
      .catch(() => undefined);
    if (!summary) return conversationAccessErrorResponse(new Error("conversation_not_found"));
    const headers = new Headers(request.headers);
    headers.delete(CONVERSATION_AGENT_ACCESS_HEADER);
    headers.set(
      CONVERSATION_AGENT_ACCESS_HEADER,
      JSON.stringify(conversationAgentAccessContext(session, resolved.access)),
    );
    return env.TEAM_AGENT.getByName(resolved.access.agentInstanceName)
      .fetch(new Request(request, { headers }));
  }
  await ensureAgentLegacyImport(env, session.label, session);
  const root = await getTeamAgent(env, session.label, session);
  await drainAgentConversationCleanup(env, session.label, root, Date.now(), true, session);
  const now = Date.now();
  const created = await root.createConversation({
    id: chatId,
    title: "新对话",
    createdAt: now,
    updatedAt: now,
    summary: "",
    pinned: false,
    skillMode: "manual",
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
  executionContext: ExecutionContext | undefined,
  requestId: string,
  instanceFence?: InstanceOperationFence,
): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: sensitiveResponseHeaders() });
  }
  if (request.method !== "GET" && request.method !== "HEAD" && hasInvalidOrigin(request, url)) {
    return jsonResponse({ error: "invalid_origin" }, 403);
  }
  const maintenance = await inspectInstanceMaintenance(env);
  if (maintenance.blocked && isBlockedMaintenanceRequest(request, url)) {
    return instanceMaintenanceResponse(maintenance);
  }
  if (!maintenance.blocked) await scheduleGuestCleanupDrain(env, executionContext, requestId);

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
    return handleAdminApi(request, env, url, requestId, instanceFence, executionContext);
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
    return jsonResponse(await buildSessionProjection(env, session, maintenance.blocked));
  }

  if (url.pathname === "/api/chat" && request.method === "POST") {
    const legacyRead = await recordLegacySurfaceUse(
      LEGACY_API_CHAT_POST_SURFACE_ID,
      request,
      env,
      url,
      "read",
    );
    if (!legacyRead.ok) return jsonResponse({ error: "legacy_surface_unavailable" }, 503);
    if (legacyRead.disabled) {
      return jsonResponse({ error: "legacy_surface_read_disabled", message: "兼容接口已停用" }, 410);
    }
    if (legacyRead.writeDisabled) {
      return jsonResponse({ error: "legacy_surface_write_disabled", message: "兼容接口已停止接收新消息" }, 410);
    }
    return handleChat(request, env, session, requireInstanceFence(instanceFence), executionContext);
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
    && url.pathname.endsWith("/shares")
    && request.method === "GET"
  ) {
    return handleListConversationShares(env, session, url);
  }
  if (
    url.pathname.startsWith("/api/agent/conversations/")
    && url.pathname.endsWith("/shares")
    && request.method === "PUT"
  ) {
    return handleUpsertConversationShare(request, env, session, url, executionContext);
  }
  if (
    url.pathname.startsWith("/api/agent/conversations/")
    && url.pathname.endsWith("/shares/revoke")
    && request.method === "POST"
  ) {
    return handleRevokeConversationShare(request, env, session, url, executionContext);
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
    return handleMemorySuggest(request, env, session, requireInstanceFence(instanceFence), executionContext);
  }

  if (url.pathname === "/api/session-summary" && request.method === "POST") {
    return handleSessionSummary(request, env, session, requireInstanceFence(instanceFence), executionContext);
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
      const root = await getTeamAgent(env, session.label, session);
      const revoked = await attemptMemberAccountCleanup(
        env,
        session.label,
        root,
        Date.now(),
        true,
        true,
        session.kind === "member" ? session : undefined,
      );
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
  const sessionId = crypto.randomUUID();
  let principal: PrincipalRouteV1;
  try {
    principal = await resolveOrCreatePrincipalForAlias(env, {
      alias: label,
      origin: "legacy",
      operationId: `login:${sessionId}`,
    });
    principal = await ensurePrincipalAuthority(env, principal);
  } catch {
    return jsonResponse({ error: "identity_unavailable", message: "成员身份尚未完成协调，请稍后重试" }, 503);
  }
  const session: Session = {
    id: sessionId,
    label,
    kind: "member",
    principalId: principal.principalId,
    rootInstanceName: principal.rootInstanceName,
    userStateInstanceName: principal.userStateInstanceName,
    registryRevision: principal.registryRevision,
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

async function handleAdminApi(
  request: Request,
  env: Env,
  url: URL,
  requestId: string,
  instanceFence?: InstanceOperationFence,
  executionContext?: ExecutionContext,
): Promise<Response> {
  if (url.pathname === "/api/admin/session" && request.method === "GET") {
    return jsonResponse({ authenticated: true });
  }

  if (url.pathname === "/api/admin/config" && request.method === "GET") {
    return handleGetAdminConfig(env);
  }

  if (url.pathname === "/api/admin/legacy-routes/migrate" && request.method === "POST") {
    return withAdminConfigMutationLock(env, () => handleMigrateLegacyRoutes(request, env));
  }

  if (url.pathname === "/api/admin/setup-status" && request.method === "GET") {
    return handleGetAdminSetupStatus(env);
  }

  if (url.pathname === "/api/admin/setup-smoke" && request.method === "POST") {
    return handleAdminSetupSmoke(env);
  }

  if (url.pathname === "/api/admin/identity" && request.method === "GET") {
    return handleGetAdminIdentity(env, url);
  }

  if (url.pathname === "/api/admin/identity/reconcile" && request.method === "POST") {
    requireInstanceFence(instanceFence);
    return handleAdminIdentityReconcile(request, env);
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
    return withAdminConfigMutationLock(env, () => handleRemoveAdminMemberConfig(request, env, memberConfigLabel));
  }

  if (url.pathname === "/api/admin/config" && request.method === "PUT") {
    return withAdminConfigMutationLock(env, () => handlePutAdminConfig(request, env));
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
    return withAdminConfigMutationLock(env, () => handleCreateAdminUser(request, env));
  }

  if (url.pathname === "/api/admin/config" && request.method === "DELETE") {
    return withAdminConfigMutationLock(env, async () => {
      const body = await readJson<{ expectedRevision?: unknown }>(request);
      const conflict = await configRevisionConflict(env, body.expectedRevision);
      if (conflict) return conflict;
      await env.CHAT_STORE.delete(ROUTES_CONFIG_KEY);
      await appendAdminAudit(env, "config.reset");
      return jsonResponse({ ok: true });
    });
  }

  if (url.pathname === "/api/admin/access-codes" && request.method === "GET") {
    return handleGetAdminAccessCodes(env);
  }

  if (url.pathname === "/api/admin/access-codes" && request.method === "PUT") {
    return handlePutAdminAccessCodes(request, env);
  }

  if (url.pathname === "/api/admin/access-codes" && request.method === "DELETE") {
    return handleResetAdminAccessCodes(request, env);
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
    const entries = (await feedbackAuditService(env).listFeedback()).map(({ principalId: _principalId, ...entry }) => entry);
    return jsonResponse({ entries });
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

  if (url.pathname === "/api/admin/provider-attempts" && request.method === "GET") {
    return handleAdminProviderAttempts(env, url);
  }

  if (url.pathname === "/api/admin/provider-finance" && request.method === "GET") {
    return handleAdminProviderFinance(env, url);
  }

  if (url.pathname === "/api/admin/legacy-surfaces" && request.method === "GET") {
    return handleGetAdminLegacySurfaces(env, url, requestId);
  }

  const legacySurfaceCensus = legacySurfaceCensusFromAdminPath(url.pathname);
  if (legacySurfaceCensus && request.method === "GET") {
    return handleGetAdminLegacySurfaceCensus(env, url, legacySurfaceCensus.surfaceId);
  }

  const legacySurfaceMutation = legacySurfaceMutationFromAdminPath(url.pathname);
  if (legacySurfaceMutation && request.method === "POST") {
    requireInstanceFence(instanceFence);
    const manifest = LEGACY_SURFACE_MANIFEST.find(
      ({ surfaceId }) => surfaceId === legacySurfaceMutation.surfaceId,
    );
    if (!manifest) return legacySurfaceErrorResponse("legacy_surface_not_found");
    return handleAdminLegacySurfaceMutation(request, env, manifest, legacySurfaceMutation.action);
  }

  if (url.pathname === "/api/admin/provider-finance/prices" && request.method === "POST") {
    requireInstanceFence(instanceFence);
    return handleAdminProviderFinancePrice(request, env);
  }

  if (url.pathname === "/api/admin/provider-finance/reconciliations" && request.method === "POST") {
    requireInstanceFence(instanceFence);
    return handleAdminProviderFinanceReconciliation(request, env);
  }

  if (url.pathname === "/api/admin/provider-finance/budgets" && request.method === "POST") {
    requireInstanceFence(instanceFence);
    return handleAdminProviderBudgetPolicy(request, env);
  }

  const budgetReservationMatch = /^\/api\/admin\/provider-finance\/budget-reservations\/([^/]+)\/reconcile$/
    .exec(url.pathname);
  if (budgetReservationMatch && request.method === "POST") {
    requireInstanceFence(instanceFence);
    return handleAdminProviderBudgetReconciliation(request, env, budgetReservationMatch[1]);
  }

  if (url.pathname === "/api/admin/route-models" && request.method === "POST") {
    return handleAdminRouteModels(request, env, requireInstanceFence(instanceFence), executionContext);
  }

  if (url.pathname === "/api/admin/mcp-discovery" && request.method === "POST") {
    return handleAdminMcpDiscovery(request, env);
  }

  return jsonResponse({ error: "not_found" }, 404);
}

async function handleGetAdminIdentity(env: Env, url: URL): Promise<Response> {
  const rawLimit = url.searchParams.get("limit");
  const limit = rawLimit === null ? 50 : finitePositiveInteger(rawLimit);
  if (!limit || limit > 50) return jsonResponse({ error: "identity_limit_invalid" }, 400);
  try {
    const inspection = await env.IDENTITY_REGISTRY
      .getByName(IDENTITY_REGISTRY_INSTANCE_NAME)
      .inspect();
    return jsonResponse({ ...inspection, limit });
  } catch {
    return jsonResponse({ error: "identity_inspection_unavailable" }, 503);
  }
}

async function handleAdminIdentityReconcile(request: Request, env: Env): Promise<Response> {
  const body = await readJson<unknown>(request);
  const input = decodeAdminIdentityReconcileRequest(body);
  if (!input) return jsonResponse({ error: "identity_reconciliation_input_invalid" }, 400);
  try {
    const registry = env.IDENTITY_REGISTRY.getByName(IDENTITY_REGISTRY_INSTANCE_NAME);
    const lookup = await registry.lookupActivePrincipalAlias({ version: 1, alias: input.label });
    if (!lookup.found) return jsonResponse({ error: "identity_alias_missing" }, 404);
    if (lookup.route.registryRevision !== input.expectedRegistryRevision) {
      return jsonResponse({ error: "identity_registry_revision_conflict" }, 409);
    }
    let principal = lookup.route;
    const session = memberSessionForRoute(principal);
    const root = await getTeamAgent(env, principal.alias, session);
    const allConversations = await root.listConversations();
    const boundedConversations = allConversations.slice(0, input.limit);
    for (const conversation of boundedConversations) {
      const resourceLookup = await registry.lookupConversationResource({
        version: 1,
        principalId: principal.principalId,
        conversationId: conversation.id,
      });
      const resource = resourceLookup.found
        ? resourceLookup.route
        : await ensureConversationResource(
            env,
            principal,
            conversation.id,
            principal.origin === "legacy"
              ? await getTeamAgentConversationInstanceName(principal.alias, conversation.id)
              : undefined,
          );
      await ensureConversationAuthority(env, session, resource);
    }

    if (allConversations.length <= input.limit) {
      principal = await ensurePrincipalAuthority(env, principal);
    } else {
      const rootMarker = stableTeamAgentMarker(session, {
        scope: "root",
        resourceId: "",
        resourceRegistryRevision: 0,
        pinnedInstanceName: principal.rootInstanceName,
      });
      const [rootEvidence, userStateEvidence] = await Promise.all([
        root.ensureStableIdentity(rootMarker),
        getUserState(env, principal.alias, session).ensureStableIdentity(stablePrincipalMarker(session)),
      ]);
      await Promise.all([
        registry.recordStableIdentityMarker({
          version: 1,
          entityType: "principal",
          entityId: principal.principalId,
          markerKind: "root",
          pinnedInstanceName: principal.rootInstanceName,
          expectedRegistryRevision: principal.registryRevision,
          expectedPrincipalRevision: principal.registryRevision,
          digest: rootEvidence.digest,
          recordedAt: Date.now(),
        }),
        registry.recordStableIdentityMarker({
          version: 1,
          entityType: "principal",
          entityId: principal.principalId,
          markerKind: "user_state",
          pinnedInstanceName: principal.userStateInstanceName,
          expectedRegistryRevision: principal.registryRevision,
          expectedPrincipalRevision: principal.registryRevision,
          digest: userStateEvidence.digest,
          recordedAt: Date.now(),
        }),
      ]);
    }

    const conversations = [];
    for (const conversation of boundedConversations) {
      const resource = await registry.resolveConversationResource({
        version: 1,
        principalId: principal.principalId,
        conversationId: conversation.id,
      });
      conversations.push({
        conversationId: resource.conversationId,
        expectedAgentInstance: resource.agentInstanceName,
      });
    }
    const result = await registry.reconcilePrincipalIdentity({
      version: 1,
      operationId: input.operationId,
      principalId: principal.principalId,
      expectedRegistryRevision: principal.registryRevision,
      conversations,
    });
    await appendAdminAudit(env, "identity.reconcile", principal.principalId);
    return jsonResponse(result);
  } catch (error) {
    return identityReconciliationErrorResponse(error);
  }
}

function decodeAdminIdentityReconcileRequest(value: unknown): {
  label: string;
  operationId: string;
  expectedRegistryRevision: number;
  limit: number;
} | undefined {
  if (!isRecord(value) || Object.keys(value).length !== 4 || Object.keys(value).some((key) => (
    key !== "label"
    && key !== "operationId"
    && key !== "expectedRegistryRevision"
    && key !== "limit"
  ))) return undefined;
  const label = normalizeMemberAlias(value.label);
  const operationId = normalizeWorkspaceOperationId(value.operationId);
  const expectedRegistryRevision = finitePositiveInteger(value.expectedRegistryRevision);
  const limit = finitePositiveInteger(value.limit);
  return label && operationId && expectedRegistryRevision && limit <= 50
    ? { label, operationId, expectedRegistryRevision, limit }
    : undefined;
}

function identityReconciliationErrorResponse(error: unknown): Response {
  const code = error instanceof Error ? error.message : "";
  const status = code === "identity_registry_revision_conflict" || code.startsWith("identity_marker_")
    || code.startsWith("identity_agent_")
    ? 409
    : code === "identity_alias_missing" || code === "identity_principal_missing"
      ? 404
      : 503;
  const allowed = new Set([
    "identity_alias_missing",
    "identity_principal_missing",
    "identity_registry_revision_conflict",
    "identity_marker_route_conflict",
    "identity_marker_conflict",
    "identity_marker_missing",
    "identity_reconciliation_input_invalid",
    "identity_principal_reconciliation_incomplete",
    "identity_resource_reconciliation_incomplete",
  ]);
  return jsonResponse({ error: allowed.has(code) ? code : "identity_reconciliation_unavailable" }, status);
}

type LegacySurfaceMutationAction = "advance" | "rollback";

type LegacySurfaceInspection =
  | { ok: true; projections: LegacySurfaceProjectionV1[]; syncRequired: boolean }
  | { ok: false; response: Response };

async function handleGetAdminLegacySurfaces(
  env: Env,
  url: URL,
  requestId: string,
  syncFenceHeld = false,
): Promise<Response> {
  const limit = parseLegacySurfaceAdminLimit(url);
  if (limit === undefined) return jsonResponse({ error: "invalid_limit" }, 400);

  try {
    const manifestDigest = await legacySurfaceManifestDigest();
    let inspection = await inspectBundledLegacySurfaces(env, manifestDigest);
    if (!inspection.ok) return inspection.response;

    if (inspection.syncRequired && !syncFenceHeld) {
      return handleRequestWithInstanceOperation(
        env,
        `${requestId}:legacy-surface-sync`,
        "http_mutation",
        () => handleGetAdminLegacySurfaces(env, url, requestId, true),
      );
    }
    if (inspection.syncRequired) {
      const syncError = await syncBundledLegacySurfaces(env, manifestDigest);
      if (syncError) return syncError;
      inspection = await inspectBundledLegacySurfaces(env, manifestDigest);
      if (!inspection.ok) return inspection.response;
      if (inspection.syncRequired) return legacySurfaceErrorResponse("legacy_surface_state_invalid");
    }

    const snapshot: LegacySurfaceAdminSnapshotV1 = {
      version: 1,
      manifestDigest,
      generatedAt: Date.now(),
      total: inspection.projections.length,
      surfaces: inspection.projections.slice(0, limit),
    };
    return jsonResponse(snapshot);
  } catch {
    return legacySurfaceErrorResponse("legacy_surface_unavailable");
  }
}

async function inspectBundledLegacySurfaces(
  env: Env,
  manifestDigest: string,
): Promise<LegacySurfaceInspection> {
  const projections: LegacySurfaceProjectionV1[] = [];
  let syncRequired = false;
  try {
    for (const manifest of LEGACY_SURFACE_MANIFEST) {
      const result = await env.INSTANCE_COORDINATOR
        .getByName(legacySurfaceObjectName(manifest.surfaceId))
        .inspectLegacySurface({ version: 1, manifest, manifestDigest });
      if (!result.ok) {
        if (result.error === "legacy_surface_not_found" || result.error === "legacy_surface_manifest_conflict") {
          syncRequired = true;
          continue;
        }
        return { ok: false, response: legacySurfaceErrorResponse(result.error) };
      }
      if (
        result.projection.manifestVersion !== manifest.manifestVersion
        || result.projection.manifestDigest !== manifestDigest
      ) {
        syncRequired = true;
      }
      projections.push(result.projection);
    }
    return { ok: true, projections, syncRequired };
  } catch {
    return { ok: false, response: legacySurfaceErrorResponse("legacy_surface_unavailable") };
  }
}

async function syncBundledLegacySurfaces(env: Env, manifestDigest: string): Promise<Response | undefined> {
  try {
    for (const manifest of LEGACY_SURFACE_MANIFEST) {
      const result = await env.INSTANCE_COORDINATOR
        .getByName(legacySurfaceObjectName(manifest.surfaceId))
        .syncLegacySurfaceManifest({ version: 1, manifest, manifestDigest });
      if (!result.ok) return legacySurfaceErrorResponse(result.error);
    }
    return undefined;
  } catch {
    return legacySurfaceErrorResponse("legacy_surface_unavailable");
  }
}

async function handleAdminLegacySurfaceMutation(
  request: Request,
  env: Env,
  manifest: LegacySurfaceManifestRecordV1,
  action: LegacySurfaceMutationAction,
): Promise<Response> {
  const body: unknown = await readJson<unknown>(request);
  const input = action === "advance"
    ? decodeLegacySurfaceAdvanceInput(body)
    : decodeLegacySurfaceRollbackInput(body);
  if (!input || input.surfaceId !== manifest.surfaceId) {
    return jsonResponse({ error: "invalid_legacy_surface_request" }, 400);
  }

  try {
    const manifestDigest = await legacySurfaceManifestDigest();
    const coordinator = env.INSTANCE_COORDINATOR.getByName(legacySurfaceObjectName(manifest.surfaceId));
    const synchronized = await coordinator.syncLegacySurfaceManifest({ version: 1, manifest, manifestDigest });
    if (!synchronized.ok) return legacySurfaceErrorResponse(synchronized.error);

    const result = action === "advance"
      ? await coordinator.advanceLegacySurface(input)
      : await coordinator.rollbackLegacySurface(input);
    if (!result.ok) return legacySurfaceErrorResponse(result.error);

    await appendAdminAudit(
      env,
      `legacy-surface.${action}`,
      legacySurfaceAuditTarget(action, input, result),
    );
    return jsonResponse(result);
  } catch {
    return legacySurfaceErrorResponse("legacy_surface_unavailable");
  }
}

function legacySurfaceMutationFromAdminPath(pathname: string): {
  surfaceId: string;
  action: LegacySurfaceMutationAction;
} | undefined {
  const match = /^\/api\/admin\/legacy-surfaces\/([^/]+)\/(advance|rollback)$/.exec(pathname);
  if (!match) return undefined;
  try {
    const surfaceId = decodeURIComponent(match[1]);
    return surfaceId && !surfaceId.includes("/")
      ? { surfaceId, action: match[2] as LegacySurfaceMutationAction }
      : { surfaceId: "", action: match[2] as LegacySurfaceMutationAction };
  } catch {
    return { surfaceId: "", action: match[2] as LegacySurfaceMutationAction };
  }
}

function parseLegacySurfaceAdminLimit(url: URL): number | undefined {
  if ([...url.searchParams.keys()].some((key) => key !== "limit")) return undefined;
  const values = url.searchParams.getAll("limit");
  if (values.length === 0) return LEGACY_SURFACE_ADMIN_LIMIT;
  if (values.length !== 1 || !/^(?:[1-9]|[1-9][0-9]|100)$/.test(values[0])) return undefined;
  return Number(values[0]);
}

function legacySurfaceCensusFromAdminPath(pathname: string): { surfaceId: string } | undefined {
  const match = /^\/api\/admin\/legacy-surfaces\/([^/]+)\/census$/.exec(pathname);
  if (!match) return undefined;
  try {
    const surfaceId = decodeURIComponent(match[1]);
    return surfaceId && !surfaceId.includes("/") ? { surfaceId } : { surfaceId: "" };
  } catch {
    return { surfaceId: "" };
  }
}

function parseLegacySurfaceCensusDays(url: URL): number | undefined {
  if ([...url.searchParams.keys()].some((key) => key !== "days")) return undefined;
  const values = url.searchParams.getAll("days");
  if (values.length !== 1 || !/^(?:[1-9]|[1-9][0-9]|100)$/.test(values[0])) return undefined;
  return Number(values[0]);
}

async function handleGetAdminLegacySurfaceCensus(
  env: Env,
  url: URL,
  surfaceId: string,
): Promise<Response> {
  const days = parseLegacySurfaceCensusDays(url);
  if (days === undefined) return jsonResponse({ error: "invalid_days" }, 400);
  if (!surfaceId) return legacySurfaceErrorResponse("legacy_surface_not_found");
  const manifest = LEGACY_SURFACE_MANIFEST.find((record) => record.surfaceId === surfaceId);
  if (!manifest) return legacySurfaceErrorResponse("legacy_surface_not_found");
  try {
    const manifestDigest = await legacySurfaceManifestDigest();
    const coordinator = env.INSTANCE_COORDINATOR.getByName(legacySurfaceObjectName(surfaceId));
    const inspected = await coordinator.inspectLegacySurface({ version: 1, manifest, manifestDigest });
    if (!inspected.ok) return legacySurfaceErrorResponse(inspected.error);
    const result = await coordinator.censusLegacySurface(days);
    if (!result.ok) return legacySurfaceErrorResponse(result.error);
    const snapshot: LegacySurfaceCensusSnapshotV1 = {
      version: 1,
      surfaceId,
      generatedAt: Date.now(),
      days,
      rows: result.rows,
    };
    if (!decodeLegacySurfaceCensusSnapshot(snapshot)) return legacySurfaceErrorResponse("legacy_surface_state_invalid");
    return jsonResponse(snapshot);
  } catch {
    return legacySurfaceErrorResponse("legacy_surface_unavailable");
  }
}

function legacySurfaceAuditTarget(
  action: LegacySurfaceMutationAction,
  input: LegacySurfaceAdvanceInputV1 | LegacySurfaceRollbackInputV1,
  result: Extract<LegacySurfaceTransitionResult, { ok: true }>,
): string {
  const target = action === "advance"
    ? (input as LegacySurfaceAdvanceInputV1).targetPhase
    : `${(input as LegacySurfaceRollbackInputV1).scope}>${result.projection.phase}`;
  const evidence = input.evidence[0];
  return [
    input.surfaceId,
    target,
    result.replayed ? "replay" : "ok",
    `r${result.projection.revision}`,
    ...(evidence ? [`e=${evidence.evidenceId}:${evidence.digest.slice(0, 12)}`] : []),
  ].join("|").slice(0, 100);
}

function legacySurfaceErrorResponse(error: string): Response {
  switch (error) {
    case "legacy_surface_not_found":
      return jsonResponse({ error }, 404);
    case "legacy_surface_conflict":
    case "legacy_surface_manifest_conflict":
      return jsonResponse({ error }, 409);
    case "legacy_surface_gate_blocked":
      return jsonResponse({ error }, 422);
    case "legacy_surface_state_invalid":
    case "legacy_surface_unavailable":
    default:
      return jsonResponse({ error: error === "legacy_surface_state_invalid" ? error : "legacy_surface_unavailable" }, 503);
  }
}

async function withAdminConfigMutationLock(env: Env, mutation: () => Promise<Response>): Promise<Response> {
  const requestId = crypto.randomUUID();
  const coordinator = env.PROVIDER_COORDINATOR.getByName(ADMIN_CONFIG_MUTATION_COORDINATOR);
  let lease: Awaited<ReturnType<typeof coordinator.acquire>>;
  try {
    lease = await coordinator.acquire({
      requestId,
      capacity: 1,
      waitMs: ADMIN_CONFIG_MUTATION_WAIT_MS,
      leaseTtlMs: ADMIN_CONFIG_MUTATION_LEASE_TTL_MS,
    });
  } catch {
    return jsonResponse({ error: "config_mutation_unavailable", message: "配置更新暂时不可用，请稍后重试。" }, 503);
  }
  if (!lease.ok) {
    return jsonResponse({
      error: "config_mutation_busy",
      message: "另一项配置更新仍在进行，请稍后重试。",
      retryAfter: Math.max(1, Math.ceil(lease.retryAfterMs / 1_000)),
    }, 409);
  }
  const renewalTimer = setInterval(() => {
    void coordinator.renew({
      token: lease.token,
      requestId,
      leaseTtlMs: ADMIN_CONFIG_MUTATION_LEASE_TTL_MS,
    }).catch(() => undefined);
  }, ADMIN_CONFIG_MUTATION_RENEW_MS);
  try {
    return await mutation();
  } finally {
    clearInterval(renewalTimer);
    await coordinator.release({ token: lease.token, requestId }).catch(() => undefined);
  }
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

async function buildSessionProjection(
  env: Env,
  session: Session,
  maintenanceReadOnly = false,
): Promise<Record<string, unknown>> {
  const config = await loadAppConfig(env);
  const access = await getRouteAccess(config, session, env);
  const capabilities = getPublicCapabilities(config, access.user);
  const policy = sessionCapabilities(session, access);
  const [usage, routes, mcpConnections] = await Promise.all([
    maintenanceReadOnly
      ? readLegacyQuotaUsage(env, session, access.user)
      : quotaAdmissionService(env).getUsage(session, access.user),
    Promise.all(access.routes.map((route) => withPublicRouteHealth(env, route))),
    session.kind === "member" && !maintenanceReadOnly
      ? listMcpOAuthConnections(env, session)
      : Promise.resolve([]),
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
      instance: await getAgentClientInstanceName(session),
    },
  };
}

async function readLegacyQuotaUsage(
  env: Env,
  session: Session,
  user: { dailyMessageLimit?: number },
): Promise<{ used: number; limit: number; remaining: number }> {
  const day = new Date().toISOString().slice(0, 10);
  const used = await readPrincipalScopedLegacyDayCount(env, session.label, day, session);
  const limit = user.dailyMessageLimit || numberEnv(env.DAILY_MESSAGE_LIMIT, DEFAULT_DAILY_LIMIT);
  return { used, limit, remaining: Math.max(0, limit - used) };
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
  const existingConfiguredMember = Object.keys(config.users || {}).some((key) => key.trim() === label);
  await reserveMemberPrincipalBeforeCredential(
    env,
    label,
    existingConfiguredMember ? "legacy" : "native",
    "member-access-create",
    current.revision,
  );
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
  await reserveMemberPrincipalBeforeCredential(
    env,
    label,
    "legacy",
    "member-access-rotate",
    current.revision,
  );
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
  const principal = await reserveMemberPrincipalBeforeCredential(
    env,
    label,
    "legacy",
    "member-access-revoke",
    current.revision,
  );
  const nextAccessCodes = serializeAccessCodes(nextEntries);
  await env.CHAT_STORE.put(ACCESS_CODES_KEY, nextAccessCodes);
  const sessionRevocation = await revokeMemberSessionsWithRetry(env, label);
  await retireMemberPrincipalAlias(env, principal, "member-access-retire", current.revision);
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

type LegacyRouteMigrationStatus = {
  routeId: string;
  status: "ready" | "migrated" | "already_migrated" | "blocked" | "missing" | "not_legacy";
  reason?: "inline_credential_only" | "credential_unavailable" | "invalid_credential_contract";
};

type LegacyRouteMigrationResponse = {
  revision: string;
  migrated: string[];
  alreadyMigrated: string[];
  statuses: LegacyRouteMigrationStatus[];
};

async function handleMigrateLegacyRoutes(request: Request, env: Env): Promise<Response> {
  const body = await readJson<{ routeIds?: unknown; expectedRevision?: unknown }>(request);
  const expectedRevision = typeof body.expectedRevision === "string" ? body.expectedRevision.trim() : "";
  if (!expectedRevision) {
    return jsonResponse({ error: "expected_config_revision_required", message: "配置版本已失效，请刷新后重试。" }, 400);
  }

  const editable = await loadEditableConfig(env);
  const currentRevision = await configRevision(editable.config);
  if (currentRevision !== expectedRevision) {
    return jsonResponse({
      error: "config_conflict",
      message: "配置已在其他窗口更新，请刷新后重试。",
      currentRevision,
    }, 409);
  }

  const routeIds = normalizeLegacyMigrationRouteIds(body.routeIds);
  if (!routeIds.ok) return jsonResponse({ error: "invalid_route_ids", message: routeIds.message }, 400);
  if (!routeIds.ids.length) return jsonResponse({ error: "route_ids_required", message: "至少选择一条旧线路。" }, 400);

  const statuses: LegacyRouteMigrationStatus[] = [];
  const candidates: Array<{
    routeId: string;
    route: RouteConfig;
    mode: "convert" | "strip_shadow";
    credentialRef?: string;
    byok: boolean;
  }> = [];
  for (const routeId of routeIds.ids) {
    const route = editable.config.routes[routeId];
    if (!route) {
      statuses.push({ routeId, status: "missing" });
      continue;
    }
    if (!isLegacyRouteConfig(route)) {
      statuses.push({
        routeId,
        status: route.offerings?.length && !hasLegacyTransportShadow(route) ? "already_migrated" : "not_legacy",
      });
      continue;
    }

    if (route.offerings?.length) {
      statuses.push({ routeId, status: "ready" });
      candidates.push({ routeId, route, mode: "strip_shadow", byok: false });
      continue;
    }

    if (route.requiresUserKey === true && route.allowUserKey === false) {
      statuses.push({ routeId, status: "blocked", reason: "invalid_credential_contract" });
      continue;
    }
    const byok = route.requiresUserKey === true;
    if (!byok) {
      const withoutInlineKey: RouteConfig = { ...route, apiKey: undefined };
      try {
        const credential = await resolveRouteCredential(withoutInlineKey, env, "");
        if (credential.source !== "managed" && credential.source !== "worker") {
          statuses.push({
            routeId,
            status: "blocked",
            reason: route.apiKey && !route.apiKeyRef ? "inline_credential_only" : "credential_unavailable",
          });
          continue;
        }
      } catch (error) {
        if (error instanceof ManagedSecretError) {
          statuses.push({ routeId, status: "blocked", reason: "credential_unavailable" });
          continue;
        }
        throw error;
      }
    }
    statuses.push({ routeId, status: "ready" });
    candidates.push({ routeId, route, mode: "convert", credentialRef: route.apiKeyRef?.trim() || undefined, byok });
  }

  if (statuses.some((status) => status.status === "blocked" || status.status === "missing" || status.status === "not_legacy")) {
    return jsonResponse({
      error: "legacy_route_migration_blocked",
      message: "部分旧线路无法安全迁移；已取消全部写入。",
      statuses,
    }, 422);
  }

  const providers = { ...editable.config.providers };
  const routes = { ...editable.config.routes };
  const migrated: string[] = [];
  const alreadyMigrated = statuses.filter((status) => status.status === "already_migrated").map((status) => status.routeId);
  for (const candidate of candidates) {
    const route = candidate.route;
    let migratedRoute: RouteConfig;
    if (candidate.mode === "strip_shadow") {
      migratedRoute = stripLegacyTransportShadow(route);
    } else {
      const providerId = allocateMigratedProviderId(providers, candidate.routeId);
      const provider: ProviderConfig = {
        enabled: true,
        label: route.label,
        type: route.type!,
        baseUrl: route.baseUrl!,
        ...(candidate.credentialRef ? { apiKeyRef: candidate.credentialRef } : {}),
        ...(route.authHeader ? { authHeader: route.authHeader } : {}),
        ...(route.authPrefix === undefined ? {} : { authPrefix: route.authPrefix }),
        directEndpoint: route.directEndpoint === true,
        ...(route.headers ? { headers: { ...route.headers } } : {}),
        allowUserKey: route.allowUserKey !== false,
        requiresUserKey: candidate.byok,
        supportsImages: route.supportsImages !== false,
        supportsTools: route.supportsTools === true,
        concurrency: "unlimited",
      };
      providers[providerId] = provider;
      migratedRoute = stripLegacyTransportShadow({
        ...route,
        offerings: [{
          providerId,
          model: route.model!,
          enabled: true,
          supportsImages: route.supportsImages,
          supportsTools: route.supportsTools,
        }],
      });
    }
    routes[candidate.routeId] = migratedRoute;
    migrated.push(candidate.routeId);
    const statusIndex = statuses.findIndex((status) => status.routeId === candidate.routeId);
    statuses[statusIndex] = { routeId: candidate.routeId, status: "migrated" };
  }

  if (!migrated.length) {
    const response: LegacyRouteMigrationResponse = {
      revision: currentRevision,
      migrated: [],
      alreadyMigrated,
      statuses,
    };
    return jsonResponse(response);
  }

  const nextConfig = await applyMcpOAuthConfigRevisions(normalizeAppConfig({ ...editable.config, providers, routes }));
  const validation = validateAppConfig(nextConfig);
  if (!validation.ok) {
    return jsonResponse({ error: "invalid_config", message: validation.message }, 400);
  }
  await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify(nextConfig));
  await reconcileMcpToolDriftOverlay(env, nextConfig);
  await appendAdminAudit(env, "legacy-routes.migrate", migrated.join(","));
  const revision = await configRevision(nextConfig);
  const response: LegacyRouteMigrationResponse = {
    revision,
    migrated,
    alreadyMigrated,
    statuses,
  };
  return jsonResponse(response);
}

function normalizeLegacyMigrationRouteIds(value: unknown): { ok: true; ids: string[] } | { ok: false; message: string } {
  if (!Array.isArray(value) || value.length > 200) {
    return { ok: false, message: "旧线路列表无效。" };
  }
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return { ok: false, message: "旧线路列表无效。" };
    const id = item.trim();
    if (!id || id.length > 160 || !CAPABILITY_ID_PATTERN.test(id)) {
      return { ok: false, message: "旧线路 ID 无效。" };
    }
    if (!ids.includes(id)) ids.push(id);
  }
  ids.sort(compareStableText);
  return { ok: true, ids };
}

function hasLegacyTransportShadow(route: RouteConfig): boolean {
  return route.type !== undefined
    || route.baseUrl !== undefined
    || route.model !== undefined
    || route.apiKey !== undefined
    || route.apiKeyRef !== undefined
    || route.authHeader !== undefined
    || route.authPrefix !== undefined
    || route.directEndpoint === true
    || route.headers !== undefined;
}

function stripLegacyTransportShadow(route: RouteConfig): RouteConfig {
  const stripped = { ...route };
  delete stripped.type;
  delete stripped.baseUrl;
  delete stripped.model;
  delete stripped.apiKey;
  delete stripped.apiKeyRef;
  delete stripped.authHeader;
  delete stripped.authPrefix;
  delete stripped.directEndpoint;
  delete stripped.headers;
  return stripped;
}

function compareStableText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function allocateMigratedProviderId(providers: Record<string, ProviderConfig>, routeId: string): string {
  const normalized = routeId.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[^A-Za-z0-9]+/, "").slice(0, 68) || "route";
  const base = `${normalized}-provider`.slice(0, 80);
  if (!hasOwn(providers, base)) return base;
  const allocationLimit = Object.keys(providers).length + 2;
  for (let index = 2; index <= allocationLimit; index += 1) {
    const suffix = `-${index}`;
    const candidate = `${base.slice(0, 80 - suffix.length)}${suffix}`;
    if (!hasOwn(providers, candidate)) return candidate;
  }
  throw new Error("provider_id_allocation_failed");
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
  const current = await loadAccessCodeSnapshot(env);
  if (typeof body.expectedRevision === "string" && body.expectedRevision !== current.revision) {
    return jsonResponse({
      error: "access_codes_conflict",
      message: "访问码已在其他标签页或设备更新，请刷新后重试",
      currentRevision: current.revision,
    }, 409);
  }
  const accessCodes = typeof body.accessCodes === "string" ? body.accessCodes.trim() : "";
  const entries = parseAccessCodes(accessCodes);
  if (!entries.length) {
    return jsonResponse({ error: "invalid_access_codes", message: "至少需要一个 label:code 访问码" }, 400);
  }

  const { config } = await loadEditableConfig(env);
  const configuredLabels = new Set(Object.keys(config.users || {}).map((label) => label.trim()));
  const currentByLabel = new Map(current.entries.map((entry) => [entry.label, entry.code]));
  const nextByLabel = new Map(entries.map((entry) => [entry.label, entry.code]));
  const affected = new Map<string, PrincipalRouteV1>();
  for (const label of new Set([...currentByLabel.keys(), ...nextByLabel.keys()])) {
    const currentCode = currentByLabel.get(label);
    const nextCode = nextByLabel.get(label);
    if (currentCode === nextCode) continue;
    const principal = await reserveMemberPrincipalBeforeCredential(
      env,
      label,
      currentCode !== undefined || configuredLabels.has(label) ? "legacy" : "native",
      "access-bulk-mutation",
      current.revision,
    );
    affected.set(label, principal);
  }
  await env.CHAT_STORE.put(ACCESS_CODES_KEY, accessCodes);
  for (const [label, principal] of affected) {
    if (!currentByLabel.has(label)) continue;
    await revokeMemberSessionsWithRetry(env, label);
    if (!nextByLabel.has(label)) {
      await retireMemberPrincipalAlias(env, principal, "access-bulk-retire", current.revision);
    }
  }
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
      const principal = await ensureExistingMemberPrincipal(env, label, "admin-stats");
      const session = memberSessionForRoute(principal);
      if (principal.lifecycleState === "active") await ensureAgentLegacyImport(env, label, session);
      const [state, legacyUsage, memory] = await Promise.all([
        getUserState(env, label, session).getStats(days),
        principal.origin === "legacy"
          ? Promise.all(days.map((dayKey) => env.CHAT_STORE.get(usageKey(label, dayKey))))
          : Promise.resolve(days.map(() => null)),
        getTeamAgent(env, label, session).then((root) => root.getMemory()),
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
  await ensureAgentLegacyImport(env, session.label, session);
  const root = await getTeamAgent(env, session.label, session);
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
  await ensureAgentLegacyImport(env, session.label, session);
  const root = await getTeamAgent(env, session.label, session);
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
  const principal = await ensureExistingMemberPrincipal(env, label, "admin-memory-read");
  const session = memberSessionForRoute(principal);
  if (principal.lifecycleState === "active") await ensureAgentLegacyImport(env, label, session);
  const root = await getTeamAgent(env, label, session);
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
  const principal = await ensureExistingMemberPrincipal(env, label, "admin-memory-write");
  const session = memberSessionForRoute(principal);
  if (principal.lifecycleState === "active") await ensureAgentLegacyImport(env, label, session);
  const memory = typeof body.memory === "string" ? body.memory.trim().slice(0, maxChars) : "";
  const root = await getTeamAgent(env, label, session);
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
  const principal = await ensureExistingMemberPrincipal(env, label, "admin-usage-reset");
  const session = memberSessionForRoute(principal);
  await Promise.all([
    ...(principal.origin === "legacy" ? [env.CHAT_STORE.delete(usageKey(label, day))] : []),
    getUserState(env, label, session).resetUsage(day),
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
  await reserveMemberPrincipalBeforeCredential(
    env,
    label,
    "native",
    "admin-user-create",
    await accessCodesFingerprint(accessCodes),
  );
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
  if (session.kind !== "member") return jsonResponse({ error: "member_required" }, 403);
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
    principalId: session.principalId,
    rating: body.rating,
    reason,
    routeId,
    chatId,
    messageId,
  });
  return jsonResponse({ ok: true, rating: body.rating });
}

async function handleMemorySuggest(
  request: Request,
  env: Env,
  session: Session,
  instanceFence: InstanceOperationFence,
  ctx?: ExecutionContext,
): Promise<Response> {
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

  await ensureAgentLegacyImport(env, session.label, session);
  const existing = (await (await getTeamAgent(env, session.label, session)).getMemory()).memory.trim();
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
    providerRun: createProviderAttemptRuntime({
      ledger: env.PROVIDER_ATTEMPT_LEDGER,
      mode: env.PROVIDER_ATTEMPT_LEDGER_MODE,
      operation: instanceFence.operation,
      turnId: createProviderTurnId(),
      waitUntil: ctx ? (promise) => ctx.waitUntil(promise) : undefined,
    }).createRun("memory_suggestion"),
  });
  if (!result.ok) {
    return jsonResponse({ error: result.error, message: result.message, routeId: result.routeId }, result.status);
  }

  const suggestion = cleanSuggestionText(result.text);
  return jsonResponse({ suggestion, routeId: result.routeId });
}

async function handleSessionSummary(
  request: Request,
  env: Env,
  session: Session,
  instanceFence: InstanceOperationFence,
  ctx?: ExecutionContext,
): Promise<Response> {
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
    providerRun: createProviderAttemptRuntime({
      ledger: env.PROVIDER_ATTEMPT_LEDGER,
      mode: env.PROVIDER_ATTEMPT_LEDGER_MODE,
      operation: instanceFence.operation,
      turnId: createProviderTurnId(),
      waitUntil: ctx ? (promise) => ctx.waitUntil(promise) : undefined,
    }).createRun("conversation_summary"),
  });
  if (!result.ok) {
    return jsonResponse({ error: result.error, message: result.message, routeId: result.routeId }, result.status);
  }

  const summary = result.text.trim().slice(0, maxSummary);
  return jsonResponse({ summary, routeId: result.routeId, maxChars: maxSummary });
}

type ConversationAccessCarrier = Pick<
  ConversationAccessSnapshotV1,
  "resourceId" | "role" | "accessRevision"
>;

type ConversationAccessResolution =
  | { ok: true; access: ConversationAccessSnapshotV1 }
  | { ok: false; response: Response };

type ConversationShareUpsertInput = {
  operationId: string;
  resourceId: string;
  granteeLabel: string;
  role: ConversationGrantRoleV1;
  expectedAccessRevision: number;
};

type ConversationShareRevokeInput = {
  operationId: string;
  resourceId: string;
  granteePrincipalId: string;
  expectedAccessRevision: number;
};

function conversationAgentAccessContext(
  session: Extract<Session, { kind: "member" }>,
  access: ConversationAccessSnapshotV1,
): ConversationAgentAccessContextV1 {
  return {
    version: 1,
    access,
    actor: {
      label: session.label,
      principalId: session.principalId,
      rootInstanceName: session.rootInstanceName,
      userStateInstanceName: session.userStateInstanceName,
      registryRevision: session.registryRevision,
      sessionExpiresAt: session.expiresAt,
    },
  };
}

async function resolveConversationAccessForMember(
  env: Env,
  session: Extract<Session, { kind: "member" }>,
  conversationId: string,
  action: ConversationAccessActionV1,
  resourceIdValue: unknown,
  allowOwnerFallback: boolean,
  expectedAccessRevision?: number,
): Promise<ConversationAccessResolution> {
  let resourceId: string;
  if (resourceIdValue === undefined || resourceIdValue === null || resourceIdValue === "") {
    if (!allowOwnerFallback) {
      return { ok: false, response: jsonResponse({
        error: "conversation_access_input_invalid",
        message: "缺少会话资源标识，请刷新后重试",
      }, 400) };
    }
    try {
      resourceId = (await resolveOrCreateConversationRoute(env, session, conversationId)).resourceId;
    } catch (error) {
      return { ok: false, response: conversationAccessErrorResponse(error) };
    }
  } else if (isResourceId(resourceIdValue)) {
    resourceId = resourceIdValue;
  } else {
    return { ok: false, response: jsonResponse({
      error: "conversation_access_input_invalid",
      message: "会话资源标识无效",
    }, 400) };
  }
  try {
    const access = await env.IDENTITY_REGISTRY.getByName(IDENTITY_REGISTRY_INSTANCE_NAME)
      .resolveConversationAccess({
        version: 1,
        actorPrincipalId: session.principalId,
        resourceId,
        conversationId,
        action,
        ...(expectedAccessRevision === undefined ? {} : { expectedAccessRevision }),
      });
    return { ok: true, access };
  } catch (error) {
    return { ok: false, response: conversationAccessErrorResponse(error) };
  }
}

function conversationAccessErrorResponse(error: unknown): Response {
  const code = error instanceof Error ? error.message : "conversation_acl_unavailable";
  if (code === "conversation_not_found") {
    return jsonResponse({ error: code, message: "会话不存在" }, 404);
  }
  if (code === "conversation_action_denied") {
    return jsonResponse({ error: code, message: "当前共享角色不允许此操作" }, 403);
  }
  if (code === "conversation_access_revision_conflict") {
    return jsonResponse({ error: code, message: "共享状态已更新，请刷新后重试" }, 409);
  }
  if (code === "conversation_acl_operation_conflict") {
    return jsonResponse({ error: code, message: "共享操作标识已用于其他请求" }, 409);
  }
  if (code === "conversation_acl_target_unavailable") {
    return jsonResponse({ error: "acl_target_unavailable", message: "目标成员不可用" }, 404);
  }
  if (code === "conversation_acl_target_invalid" || code.endsWith("_input_invalid")) {
    return jsonResponse({ error: code, message: "共享请求无效" }, 400);
  }
  return jsonResponse({
    error: "conversation_acl_unavailable",
    message: "共享授权服务暂时不可用，请稍后重试",
  }, 503);
}

function accessibleConversationSummary(
  conversation: AgentConversationSummary,
  access: ConversationAccessCarrier,
): AgentAccessibleConversationSummary {
  if (access.role !== "owner") {
    const { parentChatId: _parentChatId, workspaceFiles: _workspaceFiles, ...shared } = conversation;
    return {
      ...shared,
      workspaceFiles: [],
      resourceId: access.resourceId,
      accessRole: access.role,
      accessRevision: access.accessRevision,
    };
  }
  return {
    ...conversation,
    resourceId: access.resourceId,
    accessRole: access.role,
    accessRevision: access.accessRevision,
  };
}

function compareAccessibleConversations(
  left: AgentAccessibleConversationSummary,
  right: AgentAccessibleConversationSummary,
): number {
  if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
  if (left.updatedAt !== right.updatedAt) return right.updatedAt - left.updatedAt;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function normalizeConversationShareUpsert(value: unknown): ConversationShareUpsertInput | undefined {
  if (!isRecord(value) || !hasOnlyExactKeys(value, [
    "version", "operationId", "resourceId", "granteeLabel", "role", "expectedAccessRevision",
  ])) return undefined;
  const operationId = normalizeWorkspaceOperationId(value.operationId);
  const granteeLabel = normalizeMemberAlias(value.granteeLabel);
  const expectedAccessRevision = finitePositiveInteger(value.expectedAccessRevision);
  const role = value.role === "editor" || value.role === "viewer" ? value.role : undefined;
  if (
    value.version !== 1 || !operationId || !isResourceId(value.resourceId) || !granteeLabel
    || !role || !expectedAccessRevision
  ) return undefined;
  return {
    operationId,
    resourceId: value.resourceId,
    granteeLabel,
    role,
    expectedAccessRevision,
  };
}

function normalizeConversationShareRevoke(value: unknown): ConversationShareRevokeInput | undefined {
  if (!isRecord(value) || !hasOnlyExactKeys(value, [
    "version", "operationId", "resourceId", "granteePrincipalId", "expectedAccessRevision",
  ])) return undefined;
  const operationId = normalizeWorkspaceOperationId(value.operationId);
  const expectedAccessRevision = finitePositiveInteger(value.expectedAccessRevision);
  if (
    value.version !== 1 || !operationId || !isResourceId(value.resourceId)
    || !isPrincipalId(value.granteePrincipalId) || !expectedAccessRevision
  ) return undefined;
  return {
    operationId,
    resourceId: value.resourceId,
    granteePrincipalId: value.granteePrincipalId,
    expectedAccessRevision,
  };
}

async function handleListAgentConversations(env: Env, session: Session): Promise<Response> {
  await ensureAgentLegacyImport(env, session.label, session);
  const root = await getTeamAgent(env, session.label, session);
  await drainAgentConversationCleanup(env, session.label, root, Date.now(), true, session);
  const ownedConversations = await root.listConversations();
  if (session.kind !== "member") {
    return jsonResponse({ conversations: ownedConversations, maxConversations: MAX_AGENT_CONVERSATIONS });
  }
  let accessRoutes;
  try {
    accessRoutes = await env.IDENTITY_REGISTRY.getByName(IDENTITY_REGISTRY_INSTANCE_NAME)
      .listConversationAccessRoutes({
        version: 1,
        actorPrincipalId: session.principalId,
        limit: MAX_AGENT_CONVERSATIONS,
      });
  } catch {
    return jsonResponse({ conversations: ownedConversations, maxConversations: MAX_AGENT_CONVERSATIONS });
  }
  const conversations = (await Promise.all(accessRoutes.routes.map(async (access) => {
    try {
      const summary = access.ownerPrincipalId === session.principalId
        ? await root.getConversationSummary(access.conversationId)
        : await env.TEAM_AGENT.getByName(access.ownerRootInstanceName)
          .getConversationSummary(access.conversationId);
      return summary ? accessibleConversationSummary(summary, access) : undefined;
    } catch {
      return undefined;
    }
  }))).filter((conversation): conversation is AgentAccessibleConversationSummary => Boolean(conversation));
  conversations.sort(compareAccessibleConversations);
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
  await ensureAgentLegacyImport(env, session.label, session);
  const now = Date.now();
  const id = normalizeAgentConversationId(body.id) || crypto.randomUUID();
  const root = await getTeamAgent(env, session.label, session);
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
  if (session.kind !== "member") {
    return jsonResponse({ ok: true, conversation: result.conversation }, result.created ? 201 : 200);
  }
  const resource = await resolveOrCreateConversationRoute(env, session, result.conversation.id);
  const access = await env.IDENTITY_REGISTRY.getByName(IDENTITY_REGISTRY_INSTANCE_NAME)
    .resolveConversationAccess({
      version: 1,
      actorPrincipalId: session.principalId,
      resourceId: resource.resourceId,
      conversationId: result.conversation.id,
      action: "conversation.read",
    });
  return jsonResponse({
    ok: true,
    conversation: accessibleConversationSummary(result.conversation, access),
  }, result.created ? 201 : 200);
}

async function handleListConversationShares(env: Env, session: Session, url: URL): Promise<Response> {
  if (session.kind !== "member") return jsonResponse({ error: "capability_not_allowed" }, 403);
  const conversationId = agentConversationSubresourceIdFromPath(url, "/shares");
  if (!conversationId) return jsonResponse({ error: "invalid_chat_id", message: "会话 ID 无效" }, 400);
  const resolved = await resolveConversationAccessForMember(
    env,
    session,
    conversationId,
    "conversation.acl.read",
    url.searchParams.get("resourceId"),
    true,
  );
  if (!resolved.ok) return resolved.response;
  try {
    return jsonResponse(await env.IDENTITY_REGISTRY.getByName(IDENTITY_REGISTRY_INSTANCE_NAME)
      .listConversationGrants({
        version: 1,
        actorPrincipalId: session.principalId,
        resourceId: resolved.access.resourceId,
      }));
  } catch (error) {
    return conversationAccessErrorResponse(error);
  }
}

async function handleUpsertConversationShare(
  request: Request,
  env: Env,
  session: Session,
  url: URL,
  executionContext: ExecutionContext | undefined,
): Promise<Response> {
  if (session.kind !== "member") return jsonResponse({ error: "capability_not_allowed" }, 403);
  const conversationId = agentConversationSubresourceIdFromPath(url, "/shares");
  if (!conversationId) return jsonResponse({ error: "invalid_chat_id", message: "会话 ID 无效" }, 400);
  const body = await readJson<unknown>(request);
  const input = normalizeConversationShareUpsert(body);
  if (!input) return jsonResponse({ error: "conversation_acl_input_invalid", message: "共享设置无效" }, 400);
  const resolved = await resolveConversationAccessForMember(
    env,
    session,
    conversationId,
    "conversation.acl.mutate",
    input.resourceId,
    false,
    input.expectedAccessRevision,
  );
  if (!resolved.ok) return resolved.response;
  const registry = env.IDENTITY_REGISTRY.getByName(IDENTITY_REGISTRY_INSTANCE_NAME);
  try {
    const target = await registry.lookupActivePrincipalAlias({ version: 1, alias: input.granteeLabel });
    if (!target.found) return conversationAccessErrorResponse(new Error("conversation_acl_target_unavailable"));
    const result = await registry.upsertConversationGrant({
      version: 1,
      operationId: input.operationId,
      actorPrincipalId: session.principalId,
      resourceId: resolved.access.resourceId,
      targetPrincipalId: target.route.principalId,
      role: input.role,
      expectedAccessRevision: input.expectedAccessRevision,
    });
    if (result.changed) {
      await scheduleConversationAccessInvalidation(
        env,
        executionContext,
        resolved.access.agentInstanceName,
        resolved.access.resourceId,
        result.accessRevision,
      );
    }
    return jsonResponse({ ok: true, ...result });
  } catch (error) {
    return conversationAccessErrorResponse(error);
  }
}

async function handleRevokeConversationShare(
  request: Request,
  env: Env,
  session: Session,
  url: URL,
  executionContext: ExecutionContext | undefined,
): Promise<Response> {
  if (session.kind !== "member") return jsonResponse({ error: "capability_not_allowed" }, 403);
  const conversationId = agentConversationSubresourceIdFromPath(url, "/shares/revoke");
  if (!conversationId) return jsonResponse({ error: "invalid_chat_id", message: "会话 ID 无效" }, 400);
  const body = await readJson<unknown>(request);
  const input = normalizeConversationShareRevoke(body);
  if (!input) return jsonResponse({ error: "conversation_acl_input_invalid", message: "共享撤销请求无效" }, 400);
  const resolved = await resolveConversationAccessForMember(
    env,
    session,
    conversationId,
    "conversation.acl.mutate",
    input.resourceId,
    false,
    input.expectedAccessRevision,
  );
  if (!resolved.ok) return resolved.response;
  try {
    const result = await env.IDENTITY_REGISTRY.getByName(IDENTITY_REGISTRY_INSTANCE_NAME)
      .revokeConversationGrant({
        version: 1,
        operationId: input.operationId,
        actorPrincipalId: session.principalId,
        resourceId: resolved.access.resourceId,
        targetPrincipalId: input.granteePrincipalId,
        expectedAccessRevision: input.expectedAccessRevision,
      });
    if (result.changed) {
      await scheduleConversationAccessInvalidation(
        env,
        executionContext,
        resolved.access.agentInstanceName,
        resolved.access.resourceId,
        result.accessRevision,
      );
    }
    return jsonResponse({ ok: true, ...result });
  } catch (error) {
    return conversationAccessErrorResponse(error);
  }
}

export async function scheduleConversationAccessInvalidation(
  env: Env,
  executionContext: ExecutionContext | undefined,
  agentInstanceName: string,
  resourceId: string,
  accessRevision: number,
): Promise<void> {
  const invalidation = env.TEAM_AGENT.getByName(agentInstanceName)
    .applyConversationAccessRevision({ version: 1, resourceId, accessRevision })
    .then(() => undefined, () => undefined);
  if (executionContext) {
    executionContext.waitUntil(invalidation);
    return;
  }
  await invalidation;
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
    resourceId?: unknown;
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

  const access = session.kind === "member"
    ? await resolveConversationAccessForMember(
      env,
      session,
      sourceId,
      "conversation.branch.create",
      body.resourceId,
      true,
    )
    : undefined;
  if (access && !access.ok) return access.response;

  await ensureAgentLegacyImport(env, session.label, session);
  const root = access?.ok
    ? env.TEAM_AGENT.getByName(access.access.ownerRootInstanceName)
    : await getTeamAgent(env, session.label, session);
  await drainAgentConversationCleanup(env, session.label, root, Date.now(), true, session);
  const source = await root.getConversationSummary(sourceId);
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

  const sourceAgent = access?.ok
    ? env.TEAM_AGENT.getByName(access.access.agentInstanceName)
    : await getTeamAgentConversation(env, session.label, sourceId, session);
  const destinationResource = session.kind === "member"
    ? await resolveOrCreateConversationRoute(env, session, reservation.operation.destinationId)
    : undefined;
  const destinationAccess = session.kind === "member" && destinationResource
    ? await env.IDENTITY_REGISTRY.getByName(IDENTITY_REGISTRY_INSTANCE_NAME)
      .resolveConversationAccess({
        version: 1,
        actorPrincipalId: session.principalId,
        resourceId: destinationResource.resourceId,
        conversationId: reservation.operation.destinationId,
        action: "conversation.message.send",
      })
    : undefined;
  const copied = await sourceAgent.copyConversationBranchTo({
    sourceMessageId,
    sourceMessageCount: reservation.operation.sourceMessageCount,
    action,
    ...(editedText === undefined ? {} : { editedText }),
    replacementMessageId: `branch-${requestId}`,
    requestId,
    fingerprint,
    destinationId: reservation.operation.destinationId,
    destinationInstance: destinationResource?.agentInstanceName
      ?? await getTeamAgentConversationInstanceName(session.label, reservation.operation.destinationId),
    body: {
      routeId: settings.routeId,
      skillMode: settings.skillMode,
      skillIds: settings.skillIds,
      ...(destinationAccess && session.kind === "member"
        ? { [CONVERSATION_AGENT_ACCESS_BODY_KEY]: conversationAgentAccessContext(session, destinationAccess) }
        : {}),
    },
  });
  if ("error" in copied) {
    await failAgentConversationBranch(env, session, root, reservation.operation, fingerprint);
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
    resourceId?: unknown;
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
  const settingsMutation = hasOwn(body, "routeId") || hasOwn(body, "skillMode") || hasOwn(body, "skillIds");
  const access = session.kind === "member"
    ? await resolveConversationAccessForMember(
      env,
      session,
      id,
      settingsMutation ? "conversation.settings.update" : "conversation.title.update",
      body.resourceId,
      true,
    )
    : undefined;
  if (access && !access.ok) return access.response;
  await ensureAgentLegacyImport(env, session.label, session);
  const root = access?.ok
    ? env.TEAM_AGENT.getByName(access.access.ownerRootInstanceName)
    : await getTeamAgent(env, session.label, session);
  const current = await root.getConversationSummary(id);
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
  return jsonResponse({
    ok: true,
    conversation: access?.ok
      ? accessibleConversationSummary(result.conversation, access.access)
      : result.conversation,
  });
}

async function handleDeleteAgentConversation(env: Env, session: Session, url: URL): Promise<Response> {
  const id = agentConversationIdFromPath(url);
  if (!id) return jsonResponse({ error: "invalid_chat_id", message: "会话 ID 无效" }, 400);
  const expectedUpdatedAt = finitePositiveInteger(url.searchParams.get("expectedUpdatedAt"));
  if (!expectedUpdatedAt) {
    return jsonResponse({ error: "expected_updated_at_required", message: "缺少会话版本，请刷新后重试" }, 400);
  }
  const access = session.kind === "member"
    ? await resolveConversationAccessForMember(
      env,
      session,
      id,
      "conversation.delete",
      url.searchParams.get("resourceId"),
      true,
    )
    : undefined;
  if (access && !access.ok) return access.response;
  await ensureAgentLegacyImport(env, session.label, session);
  const root = access?.ok
    ? env.TEAM_AGENT.getByName(access.access.ownerRootInstanceName)
    : await getTeamAgent(env, session.label, session);
  const result = await root.deleteConversation(id, expectedUpdatedAt);
  if (!result.ok) return agentConversationMutationError(result);
  const cleanupPending = !(await attemptAgentConversationCleanup(
    env,
    session.label,
    id,
    root,
    Date.now(),
    true,
    session,
  ));
  const conversations = await root.listConversations();
  return jsonResponse({ ok: true, deleted: true, cleanupPending, conversations }, cleanupPending ? 202 : 200);
}

async function handleGetAgentMemory(env: Env, session: Session): Promise<Response> {
  await ensureAgentLegacyImport(env, session.label, session);
  const root = await getTeamAgent(env, session.label, session);
  const record = await root.getMemory();
  return jsonResponse({ ...record, maxChars: numberEnv(env.MAX_MEMORY_CHARS, DEFAULT_MEMORY_CHARS) });
}

async function handlePutAgentMemory(request: Request, env: Env, session: Session): Promise<Response> {
  const body = await readJson<{ memory?: unknown; expectedRevision?: unknown }>(request);
  if (typeof body.expectedRevision !== "string") {
    return jsonResponse({ error: "expected_revision_required", message: "缺少记忆版本，请刷新后重试" }, 400);
  }
  await ensureAgentLegacyImport(env, session.label, session);
  const expectedRevision = body.expectedRevision;
  const root = await getTeamAgent(env, session.label, session);
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
  await ensureAgentLegacyImport(env, session.label, session);
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
  await ensureAgentLegacyImport(env, session.label, session);
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
  if (session.kind !== "member") {
    return jsonResponse({ error: "workspace_member_required", message: "Workspace 仅对成员开放" }, 403);
  }
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

  await ensureAgentLegacyImport(env, session.label, session);
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
    const queued = await enqueueWorkspaceDocument(env, root, session.label, reservation.reservation.file, session);
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
    const queued = await enqueueWorkspaceDocument(env, root, session.label, completed.file, session);
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
  session: Session,
): Promise<boolean> {
  if (session.kind !== "member") return false;
  const version = file.currentVersion;
  if (!version || version.ingestStatus !== "queued") return version?.ingestStatus === "ready";
  const message: DocumentIngestMessage = {
    ownerId,
    principalId: session.principalId,
    rootInstanceName: session.rootInstanceName,
    userStateInstanceName: session.userStateInstanceName,
    registryRevision: session.registryRevision,
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
  if (session.kind !== "member") {
    return jsonResponse({ error: "workspace_member_required", message: "Workspace 仅对成员开放" }, 403);
  }
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
  if (
    !isRecord(body)
    || !hasOnlyExactKeys(body, ["expectedUpdatedAt", "files", "resourceId"])
    || !("expectedUpdatedAt" in body)
    || !("files" in body)
  ) {
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
  const access = session.kind === "member"
    ? await resolveConversationAccessForMember(
      env,
      session,
      conversationId,
      "conversation.workspace_refs.mutate",
      body.resourceId,
      true,
    )
    : undefined;
  if (access && !access.ok) return access.response;
  const root = access?.ok
    ? env.TEAM_AGENT.getByName(access.access.ownerRootInstanceName)
    : await getTeamAgent(env, session.label, session);
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
    await ensureAgentLegacyImport(env, session.label, session);
    const root = await getTeamAgent(env, session.label, session);
    await drainAgentConversationCleanup(env, session.label, root, Date.now(), true, session);
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
      const agent = await getTeamAgentConversation(env, session.label, conversation.id, session);
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

function agentConversationSubresourceIdFromPath(url: URL, suffix: string): string {
  const prefix = "/api/agent/conversations/";
  if (!suffix.startsWith("/") || !url.pathname.startsWith(prefix) || !url.pathname.endsWith(suffix)) return "";
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
  session: Session,
  root: DurableObjectStub<TeamAgent>,
  operation: AgentConversationBranchOperation,
  fingerprint: string,
): Promise<void> {
  await root.markConversationBranchState(operation.requestId, fingerprint, "failed").catch(() => undefined);
  const deleted = await root.deleteConversation(operation.destinationId, operation.conversation.updatedAt).catch(() => ({ ok: false }));
  if (deleted && "ok" in deleted && deleted.ok) {
    await attemptAgentConversationCleanup(
      env,
      session.label,
      operation.destinationId,
      root,
      Date.now(),
      true,
      session,
    );
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
  const chats = await loadChatSessions(env, session.label, session);
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

  await migrateLegacyChatIndex(env, session.label, session);
  const state = getUserState(env, session.label, session);
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
  const syncState = await syncLegacyChatToAgent(env, session.label, chat, getTeamAgent(env, session.label, session), session);
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
  await migrateLegacyChatIndex(env, session.label, session);
  await ensureAgentLegacyImport(env, session.label, session);
  const state = getUserState(env, session.label, session);
  const legacyChat = (await state.listChats()).find((chat) => chat.id === id);
  if (legacyChat) await syncLegacyChatToAgent(env, session.label, legacyChat, getTeamAgent(env, session.label, session), session);
  const root = await getTeamAgent(env, session.label, session);
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
  if (agentResult.ok) {
    await attemptAgentConversationCleanup(env, session.label, id, root, Date.now(), true, session);
  }
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
  const state = getUserState(env, session.label, session);
  const storedChats = preparedIncoming.map(toStoredChat) as StoredChat[];
  if (mode === "replace") {
    await state.replaceChats(storedChats);
  } else {
    for (const chat of storedChats) await state.upsertChat(chat);
  }
  for (const chat of preparedIncoming) {
    if (await syncLegacyChatToAgent(env, session.label, chat, getTeamAgent(env, session.label, session), session) === "deleted") {
      await state.deleteChat(chat.id, 0);
    }
  }
  if (mode === "replace") {
    const incomingIds = new Set(preparedIncoming.map((chat) => chat.id));
    const root = await getTeamAgent(env, session.label, session);
    for (const conversation of await root.listConversations()) {
      if (incomingIds.has(conversation.id)) continue;
      const deleted = await root.deleteConversation(conversation.id, conversation.updatedAt);
      if (deleted.ok) {
        await attemptAgentConversationCleanup(
          env,
          session.label,
          conversation.id,
          root,
          Date.now(),
          true,
          session,
        );
      }
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
        ...(record?.requestId ? { requestId: record.requestId } : {}),
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

async function handleAdminRouteModels(
  request: Request,
  env: Env,
  instanceFence: InstanceOperationFence,
  ctx?: ExecutionContext,
): Promise<Response> {
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
  let credential: ProviderCredential;
  try {
    credential = await resolveRouteCredential(route, env, "");
  } catch (error) {
    return routeSecretAdminErrorResponse(error);
  }
  if (!credential.apiKey || credential.source === "missing") {
    return jsonResponse(
      { error: "missing_key", message: "无法读取线路密钥，请检查 API Key Ref 是否对应 Worker Secret" },
      400,
    );
  }

  const headers = buildHeaders(route.headers);
  setAuthHeader(
    headers,
    route,
    credential.apiKey,
    type === "anthropic-messages" ? "x-api-key" : "Authorization",
  );
  headers.set("Accept", "application/json");
  if (type === "anthropic-messages" && !headers.has("anthropic-version")) {
    headers.set("anthropic-version", DEFAULT_ANTHROPIC_VERSION);
  }

  const endpoint = routeModelsUrl(route);
  const providerRun = createProviderAttemptRuntime({
    ledger: env.PROVIDER_ATTEMPT_LEDGER,
    mode: env.PROVIDER_ATTEMPT_LEDGER_MODE,
    operation: instanceFence.operation,
    turnId: createProviderTurnId(),
    waitUntil: ctx ? (promise) => ctx.waitUntil(promise) : undefined,
  }).createRun("model_discovery");
  let attemptHandle: ProviderAttemptHandle | undefined;
  try {
    attemptHandle = await providerRun.start({
      logicalRouteId: route.routeId,
      providerId: route.providerId,
      model: route.model,
      credentialClass: credential.source,
      fallbackIndex: 0,
    });
    const response = await fetch(endpoint, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    const text = await response.text();
    if (!response.ok) {
      await attemptHandle.fail({ status: response.status });
      attemptHandle = undefined;
      const error = projectAgentStreamError({ status: response.status });
      return jsonResponse(
        {
          error,
          message: agentErrorMessage(error),
          status: response.status,
        },
        502,
      );
    }
    let payload: unknown;
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      const protocolError = new Error("Provider model discovery response was invalid.");
      protocolError.name = "ProviderProtocolError";
      await attemptHandle.fail(protocolError);
      attemptHandle = undefined;
      return jsonResponse({
        error: "provider_protocol_error",
        message: agentErrorMessage("provider_protocol_error"),
      }, 502);
    }
    const models = extractModelList(payload);
    if (!models.length) {
      const protocolError = new Error("Provider model discovery returned no models.");
      protocolError.name = "ProviderProtocolError";
      await attemptHandle.fail(protocolError);
      attemptHandle = undefined;
      return jsonResponse({
        error: "provider_protocol_error",
        message: agentErrorMessage("provider_protocol_error"),
      }, 502);
    }
    await attemptHandle.succeed();
    attemptHandle = undefined;
    return jsonResponse({ models, count: models.length, endpoint });
  } catch (error) {
    const budgetResponse = providerBudgetJsonResponse(error);
    if (budgetResponse) return budgetResponse;
    await attemptHandle?.fail(error);
    const projected = projectAgentStreamError(error);
    return jsonResponse(
      {
        error: projected,
        message: agentErrorMessage(projected),
      },
      502,
    );
  }
}

async function handleAdminProviderAttempts(env: Env, url: URL): Promise<Response> {
  const providerId = url.searchParams.get("providerId")?.trim() || "";
  const parsedLimit = Number(url.searchParams.get("limit") || "25");
  if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
    return jsonResponse({ error: "invalid_limit" }, 400);
  }
  const config = await loadAppConfig(env);
  const configuredProviderIds = new Set(Object.keys(config.providers));
  for (const [routeId, route] of Object.entries(config.routes)) {
    for (const candidate of resolveProviderRouteCandidates(routeId, route, config.providers)) {
      configuredProviderIds.add(candidate.providerId);
    }
  }
  if (!providerId || !configuredProviderIds.has(providerId)) {
    return jsonResponse({ error: providerId ? "provider_not_found" : "provider_id_required" }, providerId ? 404 : 400);
  }
  const attempts = await env.PROVIDER_ATTEMPT_LEDGER.getByName(providerId).listRecent({ limit: parsedLimit });
  return jsonResponse({ providerId, attempts });
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
      const principal = await ensureExistingMemberPrincipal(env, memberLabel, "admin-mcp-discovery");
      const session = memberSessionForRoute(principal);
      const candidate = await getUserState(env, memberLabel, session).getMcpOAuthDiscoveryCandidate({
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

async function loadChatSessions(env: Env, label: string, session?: Session): Promise<CloudChat[]> {
  await migrateLegacyChatIndex(env, label, session);
  return getUserState(env, label, session).listChats();
}

async function resolveDocumentIngestOwnerSession(
  env: Env,
  message: DocumentIngestMessage,
): Promise<Extract<Session, { kind: "member" }> | undefined> {
  const lookup = await env.IDENTITY_REGISTRY.getByName(IDENTITY_REGISTRY_INSTANCE_NAME)
    .lookupActivePrincipalAlias({ version: 1, alias: message.ownerId });
  if (
    !lookup.found
    || lookup.route.principalId !== message.principalId
    || lookup.route.rootInstanceName !== message.rootInstanceName
    || lookup.route.userStateInstanceName !== message.userStateInstanceName
    || lookup.route.registryRevision !== message.registryRevision
  ) return undefined;
  return memberSessionForRoute(lookup.route);
}

async function resolveDocumentIngestRoot(
  env: Env,
  message: DocumentIngestMessage,
): Promise<DurableObjectStub<TeamAgent> | undefined> {
  const root = env.TEAM_AGENT.getByName(message.rootInstanceName);
  const marker = await root.getStableIdentity();
  return marker
    && marker.scope === "root"
    && marker.resourceId === ""
    && marker.principalId === message.principalId
    && marker.rootInstanceName === message.rootInstanceName
    && marker.userStateInstanceName === message.userStateInstanceName
    && marker.registryRevision === message.registryRevision
    ? root
    : undefined;
}

async function handleResetAdminAccessCodes(request: Request, env: Env): Promise<Response> {
  const body = await readJson<{ expectedRevision?: unknown }>(request);
  const current = await requireAccessCodeMutationSnapshot(env, body.expectedRevision);
  if (current instanceof Response) return current;
  const principals = new Map<string, PrincipalRouteV1>();
  for (const entry of current.entries) {
    principals.set(entry.label, await reserveMemberPrincipalBeforeCredential(
      env,
      entry.label,
      "legacy",
      "access-reset",
      current.revision,
    ));
  }
  await env.CHAT_STORE.delete(ACCESS_CODES_KEY);
  for (const [label, principal] of principals) {
    await revokeMemberSessionsWithRetry(env, label);
    await retireMemberPrincipalAlias(env, principal, "access-reset-retire", current.revision);
  }
  await appendAdminAudit(env, "access.reset");
  return jsonResponse({ ok: true });
}

async function migrateLegacyChatIndex(env: Env, label: string, session?: Session): Promise<void> {
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
    await getUserState(env, label, session).migrateLegacyChats(stored);
    await env.CHAT_STORE.delete(chatIndexKey(label));
  } catch {
    // Keep malformed legacy data for manual recovery instead of deleting it silently.
  }
}

async function ensureAgentLegacyImport(env: Env, label: string, session?: Session): Promise<void> {
  const instanceFence = await acquireBackgroundInstanceOperation(env, "legacy-import");
  if (!instanceFence) return;
  try {
    const root = await getTeamAgent(env, label, session);
    if (await root.hasMigration(AGENT_LEGACY_MIGRATION_ID)) return;
    if (session?.kind === "member") {
      const principal = await env.IDENTITY_REGISTRY.getByName(IDENTITY_REGISTRY_INSTANCE_NAME)
        .resolvePrincipalSession({ version: 1, principalId: session.principalId, alias: session.label });
      if (principal.origin === "native") {
        await root.completeMigration(AGENT_LEGACY_MIGRATION_ID);
        return;
      }
    }
    const [chats, memory] = await Promise.all([
      loadLegacyChatSessionsForAgent(env, label, session),
      env.CHAT_STORE.get(memoryKey(label)),
    ]);
    for (const chat of chats) {
      await syncLegacyChatToAgent(env, label, chat, root, session);
    }
    await root.importLegacyMemory(memory || "");
    await root.completeMigration(AGENT_LEGACY_MIGRATION_ID);
  } finally {
    await instanceFence.release().catch(() => undefined);
  }
}

async function syncLegacyChatToAgent(
  env: Env,
  label: string,
  chat: CloudChat,
  root: DurableObjectStub<TeamAgent> | Promise<DurableObjectStub<TeamAgent>> = getTeamAgent(env, label),
  session?: Session,
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
  const conversationAgent = await getTeamAgentConversation(env, label, chat.id, session);
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
  session?: Session,
): Promise<void> {
  const instanceFence = await acquireBackgroundInstanceOperation(env, "conversation-cleanup");
  if (!instanceFence) return;
  try {
    const agentRoot = await root;
    const cleanupSession = session ?? await memberSessionFromRootStableIdentity(agentRoot, label);
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
      cleanupSession,
    )));
    if (scheduleFailures) await agentRoot.refreshCleanupSchedule(now, true).catch(() => undefined);
  } finally {
    await instanceFence.release().catch(() => undefined);
  }
}

async function attemptAgentConversationCleanup(
  env: Env,
  label: string,
  chatId: string,
  root: CleanupRoot | Promise<CleanupRoot> = getTeamAgent(env, label),
  now = Date.now(),
  scheduleFailures = true,
  session?: Session,
): Promise<boolean> {
  const agentRoot = await root;
  try {
    const conversation = await getTeamAgentConversation(env, label, chatId, session);
    await conversation.clearConversation();
    await getUserState(env, label, session).deleteChat(chatId, 0);
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

async function memberSessionFromRootStableIdentity(
  root: CleanupRoot,
  label: string,
): Promise<Extract<Session, { kind: "member" }> | undefined> {
  const marker = await root.getStableIdentity();
  if (!marker || marker.scope !== "root" || marker.resourceId !== "") return undefined;
  const now = Date.now();
  return {
    id: `identity-cleanup-${marker.principalId}`,
    label,
    kind: "member",
    principalId: marker.principalId,
    rootInstanceName: marker.rootInstanceName,
    userStateInstanceName: marker.userStateInstanceName,
    registryRevision: marker.registryRevision,
    createdAt: now,
    lastSeen: now,
    expiresAt: Number.MAX_SAFE_INTEGER,
  };
}

async function loadLegacyChatSessionsForAgent(env: Env, label: string, session?: Session): Promise<CloudChat[]> {
  const merged = new Map<string, CloudChat>();
  const durableChats = await getUserState(env, label, session).listChats();
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
  session?: Extract<Session, { kind: "member" }>,
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
    const cleanupSession = session ?? (
      typeof root.getStableIdentity === "function"
        ? await memberSessionFromRootStableIdentity(root, label)
        : undefined
    );
    const conversationIds = await root.getAllConversationIds();
    await Promise.all(conversationIds.map(async (chatId) => {
      const conversation = await getTeamAgentConversation(env, label, chatId, cleanupSession);
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
  session?: Extract<Session, { kind: "member" }>,
): Promise<number> {
  const root = await rootInput;
  const cleanupSession = session ?? (
    typeof root.getStableIdentity === "function"
      ? await memberSessionFromRootStableIdentity(root, label)
        : undefined
  );
  if (!cleanupSession) throw new Error("identity_cleanup_session_missing");
  const legacyRoute = await isLegacyPrincipalSessionRoute(label, cleanupSession);
  let purge: { operationId: string; generation: number } | undefined;
  try {
    if (registerRequest) await root.registerAccountCleanupRequest(now);
    purge = await purgeAgentUserData(env, label, root, now, scheduleFailures, cleanupSession);
    const [revoked] = await Promise.all([
      revokeSessionsByPrincipal(env, cleanupSession),
      getUserState(env, label, cleanupSession).purgeUserData(),
    ]);
    await Promise.all([
      feedbackAuditService(env).removeFeedbackByPrincipal(
        cleanupSession.principalId,
        label,
        legacyRoute,
      ),
      ...(legacyRoute ? [
        env.CHAT_STORE.delete(memoryKey(label)),
        env.CHAT_STORE.delete(chatIndexKey(label)),
        ...Array.from({ length: METRICS_DAYS }, (_, index) =>
          env.CHAT_STORE.delete(usageKey(label, utcDayString(index))),
        ),
      ] : []),
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
  const instanceFence = await acquireBackgroundInstanceOperation(env, "workspace-cleanup");
  if (!instanceFence) return;
  try {
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
  } finally {
    await instanceFence.release().catch(() => undefined);
  }
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
  const result = await getUserState(env, session.label, session).resolveToolApproval(runId, callId, decision);
  if (result.invalidDecision) return jsonResponse({ error: "invalid_tool_approval_decision" }, 400);
  if (!result.resolved) return jsonResponse({ error: "tool_approval_not_pending" }, 409);
  return jsonResponse({ ok: true });
}

async function handleChat(
  request: Request,
  env: Env,
  session: Session,
  instanceFence: InstanceOperationFence,
  ctx?: ExecutionContext,
): Promise<Response> {
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

  const legacyWrite = await recordLegacySurfaceUse(
    LEGACY_API_CHAT_POST_SURFACE_ID,
    request,
    env,
    new URL(request.url),
    "write",
  );
  if (!legacyWrite.ok || legacyWrite.disabled) {
    await Promise.allSettled([admission.release(), admission.refundQuota()]);
    return legacyWrite.ok
      ? jsonResponse({ error: "legacy_surface_write_disabled", message: "兼容接口已停止接收新消息" }, 410)
      : jsonResponse({ error: "legacy_surface_unavailable" }, 503);
  }

  const selectedSkills = getSelectedSkills(config, body.skillIds, access.user);
  const messages = await buildMessagesWithSystem(env, session, normalized, sessionSummary, access.user, selectedSkills);
  const providerAttempts = createProviderAttemptRuntime({
    ledger: env.PROVIDER_ATTEMPT_LEDGER,
    mode: env.PROVIDER_ATTEMPT_LEDGER_MODE,
    operation: instanceFence.operation,
    turnId: createProviderTurnId(),
    waitUntil: ctx ? (promise) => ctx.waitUntil(promise) : undefined,
  });

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
    try {
      const response = await getUserState(env, session.label, session).runCapabilityChat({
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
        turnId: providerAttempts.turnId,
        operation: instanceFence.operation,
      });
      return responseWithRelease(response, admission.release);
    } catch (error) {
      await admission.release().catch(() => undefined);
      throw error;
    }
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
  let lastError: {
    routeId: string;
    status: number;
    message: string;
    error?: unknown;
    code?: AgentErrorCode;
  } | null = prepared.lastError
    ? { ...prepared.lastError, status: 500, error: { status: 500 } }
    : null;
  let attemptedRoutes = 0;
  const providerRun = providerAttempts.createRun("main_answer");

  while (remaining.length) {
    const acquired = await acquireFirstAvailableProvider(env, remaining, request.signal);
    if (!acquired) {
      lastError = {
        routeId: remaining[0].routeId,
        status: 429,
        message: "当前服务提供商繁忙，请稍后重试",
        code: "provider_busy",
      };
      break;
    }
    const { candidate: route, lease } = acquired;
    remaining.splice(remaining.indexOf(route), 1);
    const routeId = route.routeId;
    attemptedRoutes += 1;
    const startedAt = Date.now();
    const fallback = route.planIndex > 0 || attemptedRoutes > 1;
    let handedOff = false;
    let attemptHandle: ProviderAttemptHandle | undefined;
    try {
      if (route.credential.source === "missing") throw new Error("provider_credential_missing");
      attemptHandle = await providerRun.start({
        logicalRouteId: routeId,
        providerId: route.providerId,
        model: route.model,
        credentialClass: route.credential.source,
        fallbackIndex: route.planIndex,
        startedAt,
      });
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
          attempt: attemptHandle,
          usage: result.usage,
          usageSource: result.usageSource,
          onComplete: async () => {
            await admission.release();
            await recordRouteReliability(env, {
              routeId,
              providerId: route.providerId,
              ok: true,
              fallback,
              startedAt,
              usedUserKey: route.credential.usedUserKey,
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
          onCancel: admission.release,
        }, result.cancelUpstream, request.signal);
        handedOff = true;
        return response;
      }

      lastError = { ...result.error, error: { status: result.error.status } };
      await attemptHandle.fail({ status: result.error.status });
      attemptHandle = undefined;
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
      if (isProviderAttemptBlockingError(error)) {
        await admission.release();
        return providerBudgetJsonResponse(error) || jsonResponse({
          error: "provider_budget_unavailable",
          message: agentErrorMessage("provider_budget_unavailable"),
        }, 503);
      }
      try {
        await attemptHandle?.fail(error);
        attemptHandle = undefined;
      } catch (attemptError) {
        await admission.release().catch(() => undefined);
        throw attemptError;
      }
      if (request.signal.aborted) {
        await admission.release();
        throw error;
      }
      const status = providerErrorStatus(error);
      lastError = {
        routeId,
        status: status || 502,
        message: error instanceof Error ? error.message : "upstream request failed",
        error,
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

  const publicError = lastError?.code
    || projectAgentStreamError(lastError?.error || { status: lastError?.status || 502 });
  return jsonResponse(
    {
      error: publicError,
      routeId: lastError?.routeId,
      status: lastError?.status,
      message: agentErrorMessage(publicError),
    },
    publicError === "provider_busy" || publicError === "upstream_rate_limited" ? 429 : 502,
  );
}

export type TeamAgentTurnInput = {
  messages: ChatMessage[];
  allowFileInput?: boolean;
  disableTools?: boolean;
  continuation?: boolean;
  routeId?: string;
  skillMode?: ConversationSkillMode;
  skillIds?: string[];
  userApiKey?: string;
  sessionSummary?: string;
  temperature?: number;
  longTermMemory?: string;
  workspaceContext?: string;
  requestId?: string;
  onProviderProgress?: (progress: ProviderTurnProgressV1) => void;
  abortSignal?: AbortSignal;
  waitUntil?: (promise: Promise<unknown>) => void;
  turnId: string;
  operation: InstanceOperationStateV1;
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
  const providerAttempts = createProviderAttemptRuntime({
    ledger: env.PROVIDER_ATTEMPT_LEDGER,
    mode: env.PROVIDER_ATTEMPT_LEDGER_MODE,
    operation: input.operation,
    turnId: input.turnId,
    waitUntil: input.waitUntil,
  });
  if ((await inspectInstanceMaintenance(env)).blocked) {
    return {
      ok: false,
      error: "instance_maintenance",
      message: agentErrorMessage("instance_maintenance"),
      status: 503,
    };
  }
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

  const normalization = normalizeMessages(input.messages, env, {
    fileInput: input.allowFileInput ?? session.kind === "member",
  });
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
  let memoryToolEnabled = input.disableTools !== true
    && session.kind === "member"
    && selectedPublicRoute?.supportsTools === true;
  if (messagesContainImages(normalized) && selectedPublicRoute?.supportsImages === false) {
    return {
      ok: false,
      error: "image_not_supported",
      message: "当前线路不支持图片消息",
      status: 400,
      routeId: selectedPublicRoute.id,
    };
  }

  let admission: TurnAdmission | undefined;
  const admitOnce = async (): Promise<TurnAdmission> => {
    if (!admission) {
      admission = await quotaAdmissionService(env).admitTurn(
        session,
        access,
        input.continuation !== true,
      );
    }
    return admission;
  };
  const rejectAdmission = async (
    rejected: Extract<TurnAdmission, { ok: false }>,
  ): Promise<PreparedTeamAgentTurn> => {
    if (rejected.error === "rate_limited") {
      await recordChatMetric(env, { kind: "rate_limited", label: session.label });
    }
    return {
      ok: false,
      error: rejected.error,
      message: agentErrorMessage(rejected.error),
      status: 429,
    };
  };
  const cancelTurn = async (): Promise<PreparedTeamAgentTurn> => {
    if (admission?.ok) await admission.release();
    return {
      ok: false,
      error: "request_cancelled",
      message: agentErrorMessage("request_cancelled"),
      status: 499,
    };
  };

  if (input.abortSignal?.aborted) return cancelTurn();

  let skillSelection: AgentSkillSelectionMetadata | undefined;
  let skillSnapshotIds: string[] | undefined;
  let selectedSkillIds = input.skillIds || [];
  if (session.kind === "member" && input.skillMode === "automatic" && selectedPublicRoute) {
    const availableSkills = getPublicCapabilities(config, access.user).skills;
    if (availableSkills.length) {
      const selectorAdmission = await admitOnce();
      if (!selectorAdmission.ok) return rejectAdmission(selectorAdmission);
      if (input.abortSignal?.aborted) return cancelTurn();
    }
    let selectorAttempt: AutomaticSkillSelectorAttempt;
    try {
      selectorAttempt = await runAutomaticSkillSelector(env, {
        config,
        access,
        routeId: selectedPublicRoute.id,
        userApiKey: input.userApiKey?.trim() || "",
        latestUserText: latestPrompt?.text || "",
        availableSkills,
        signal: input.abortSignal,
        providerAttempts,
      });
    } catch (error) {
      if (admission?.ok) await admission.release().catch(() => undefined);
      throw error;
    }
    if (input.abortSignal?.aborted) return cancelTurn();

    config = await loadAppConfig(env);
    access = await getRouteAccess(config, session, env);
    if (!access.routes.length) {
      if (admission?.ok) await admission.release();
      return { ok: false, error: "no_routes_available", message: "没有可用线路", status: 403 };
    }
    selectedPublicRoute = access.routes.find((route) => route.id === selectedRoute)
      || access.routes.find((route) => route.id === access.defaultRoute);
    memoryToolEnabled = input.disableTools !== true && selectedPublicRoute?.supportsTools === true;
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
  if (input.abortSignal?.aborted) return cancelTurn();
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
  const toolDefinitions = input.disableTools !== true && selectedPublicRoute?.supportsTools
    ? await buildCapabilityToolDefinitions(config, access.user, selectedSkills, secretFingerprint)
    : [];
  const routeIds = buildProviderRoutePlan(selectedRoute, config.routes, access);
  const userApiKey = input.userApiKey?.trim() || "";
  const hasImages = messagesContainImages(normalized);
  const initialRunDeadline = createProviderFirstVisibleDeadline(input.abortSignal, {
    timeoutMs: PROVIDER_TURN_RUN_DEADLINE_MS,
  });
  const progressRequestId = normalizeAgentRequestId(input.requestId);
  let progressSequence = 0;
  const emitProviderProgress = progressRequestId && input.onProviderProgress
    ? (progress: Omit<ProviderTurnProgressV1, "type" | "version" | "requestId" | "sequence">) => {
        try {
          input.onProviderProgress?.({
            type: "chatus_provider_turn_progress",
            version: 1,
            requestId: progressRequestId,
            sequence: ++progressSequence,
            ...progress,
          });
        } catch {
          // Ephemeral progress must never change Provider routing.
        }
      }
    : undefined;
  emitProviderProgress?.({
    phase: "planning",
    attempt: 0,
    candidateCount: 0,
    startedAt: initialRunDeadline.startedAt,
    deadlineAt: initialRunDeadline.deadlineAt,
  });
  const rejectRunDeadline = async (): Promise<PreparedTeamAgentTurn> => {
    initialRunDeadline.dispose();
    if (input.abortSignal?.aborted) return cancelTurn();
    if (admission?.ok) await admission.release().catch(() => undefined);
    await recordChatMetric(env, { kind: "failure", label: session.label });
    return {
      ok: false,
      error: "upstream_timeout",
      message: agentErrorMessage("upstream_timeout"),
      status: 504,
    };
  };
  let prepared: Awaited<ReturnType<ReturnType<typeof providerPlanRuntime>["preparePlan"]>>;
  try {
    prepared = await raceWithAbort(providerPlanRuntime(env, config).preparePlan({
      routeIds,
      accessRoutes: access.routes,
      userApiKey,
      accepts: (route, publicRoute) => (
        (!hasImages || (publicRoute.supportsImages && route.supportsImages))
        && (!(toolDefinitions.length || memoryToolEnabled) || route.supportsTools)
      ),
    }), initialRunDeadline.signal);
  } catch (error) {
    if (initialRunDeadline.signal.aborted) return rejectRunDeadline();
    initialRunDeadline.dispose();
    throw error;
  }
  if (initialRunDeadline.signal.aborted) return rejectRunDeadline();
  if (prepared.userKeyRequiredRouteId) {
    initialRunDeadline.dispose();
    if (admission?.ok) await admission.release();
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
      modelName: route.model,
      credentialClass: route.credential.source === "missing" ? undefined : route.credential.source,
      usedUserKey: route.credential.usedUserKey,
      acquireLease: (waitMs, signal) => acquireProviderLease(env, route, waitMs, signal),
      settings: {
        temperature: clampNumber(input.temperature, 0, route.type === "anthropic-messages" ? 1 : 2, route.temperature ?? 0.7),
        maxOutputTokens: route.maxTokens || numberEnv(env.DEFAULT_MAX_TOKENS, 4096),
      },
    });
  }

  if (!candidates.length) {
    initialRunDeadline.dispose();
    if (admission?.ok) await admission.release();
    await recordChatMetric(env, { kind: "failure", label: session.label });
    return {
      ok: false,
      error: "upstream_error",
      message: lastError?.message || "no route succeeded",
      status: 502,
      routeId: lastError?.routeId,
    };
  }

  if (initialRunDeadline.signal.aborted) return rejectRunDeadline();
  const admissionPromise = admitOnce();
  let turnAdmission: TurnAdmission;
  try {
    turnAdmission = await raceWithAbort(admissionPromise, initialRunDeadline.signal);
  } catch (error) {
    if (initialRunDeadline.signal.aborted) {
      void admissionPromise.then(async (lateAdmission) => {
        if (lateAdmission.ok) await lateAdmission.release();
      }).catch(() => undefined);
      return rejectRunDeadline();
    }
    initialRunDeadline.dispose();
    throw error;
  }
  if (!turnAdmission.ok) {
    initialRunDeadline.dispose();
    return rejectAdmission(turnAdmission);
  }
  if (initialRunDeadline.signal.aborted) return rejectRunDeadline();

  let streamFailureRecorded = false;
  const recordStreamFailure = async () => {
    if (streamFailureRecorded) return;
    streamFailureRecorded = true;
    await recordChatMetric(env, { kind: "failure", label: session.label });
  };

  let providerRunIndex = 0;
  const model = createFallbackLanguageModel(candidates, {
    onSuccess: async (event) => {
      const credential = credentials.get(routeProviderKey(event.routeId, event.providerId));
      if (credential) {
        await recordRouteReliability(env, {
          requestId: input.requestId,
          routeId: event.routeId,
          providerId: event.providerId,
          ok: true,
          fallback: event.fallback,
          startedAt: event.startedAt,
          usedUserKey: credential.usedUserKey,
          firstVisibleLatencyMs: event.firstVisibleLatencyMs,
          streamShape: event.streamShape,
        });
      }
      await recordChatMetric(env, {
        kind: "success",
        label: session.label,
        routeId: event.routeId,
        fallback: event.fallback,
      });
    },
    onFailure: async (event) => {
      const credential = credentials.get(routeProviderKey(event.routeId, event.providerId));
      if (credential) {
        await recordRouteReliability(env, {
          requestId: input.requestId,
          routeId: event.routeId,
          providerId: event.providerId,
          ok: false,
          fallback: event.fallback,
          startedAt: event.startedAt,
          status: event.status,
          error: event.error,
          outcome: event.protocolError ? "protocol_error" : undefined,
          usedUserKey: credential.usedUserKey,
        });
      }
      await recordChatMetric(env, { kind: "route_error", label: session.label, routeId: event.routeId });
    },
  }, {
    createRun: () => providerAttempts.createRun(
      providerRunIndex++ === 0 && input.continuation !== true ? "main_answer" : "tool_continuation"
    ),
    initialRunDeadline,
    onProgress: (progress) => emitProviderProgress?.(progress),
  });
  const toolRuntime = input.disableTools === true
    ? {
        runTool: (async () => {
          throw new CapabilityError("tool_not_allowed", "当前共享会话不允许工具调用");
        }) satisfies CapabilityToolRunner,
        close: async () => undefined,
      }
    : createAgentCapabilityRuntime(toolDefinitions, env, session);

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
    remaining: turnAdmission.remaining,
    routeId: selectedPublicRoute?.id || selectedRoute,
    skillIds: selectedSkills.map(({ id }) => id),
    skillSelection,
    skillSnapshotIds,
    recordStreamFailure,
    releaseTurn: async () => {
      initialRunDeadline.dispose();
      await turnAdmission.release();
    },
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
    availableSkills: ReturnType<typeof getPublicCapabilities>["skills"];
    signal?: AbortSignal;
    providerAttempts: ProviderAttemptRuntime;
  },
): Promise<AutomaticSkillSelectorAttempt> {
  const availableSkills = args.availableSkills;
  if (!availableSkills.length) return { reason: "no_valid_skills" };

  const controller = new AbortController();
  let activeAttempt: ProviderAttemptHandle | undefined;
  let resolveBoundary: (attempt: AutomaticSkillSelectorAttempt) => void = () => undefined;
  const boundary = new Promise<AutomaticSkillSelectorAttempt>((resolve) => {
    resolveBoundary = resolve;
  });
  const abortAtBoundary = (reason: unknown, terminal: "cancel" | "timeout") => {
    if (controller.signal.aborted) return;
    controller.abort(reason);
    const attemptHandle = activeAttempt;
    activeAttempt = undefined;
    if (attemptHandle) {
      void (terminal === "timeout" ? attemptHandle.timeout() : attemptHandle.cancel())
        .catch(() => undefined);
    }
    resolveBoundary({ reason: "timeout" });
  };
  const abortFromParent = () => abortAtBoundary(args.signal?.reason, "cancel");
  if (args.signal?.aborted) return { reason: "timeout" };
  args.signal?.addEventListener("abort", abortFromParent, { once: true });
  const deadline = setTimeout(() => {
    abortAtBoundary(new DOMException("Skill selection timed out", "TimeoutError"), "timeout");
  }, SKILL_SELECTOR_DEADLINE_MS);
  const attempt = runAutomaticSkillSelectorAttempt(
    env,
    args,
    availableSkills,
    controller.signal,
    {
      started(handle) {
        activeAttempt = handle;
      },
      settled(handle) {
        if (activeAttempt === handle) activeAttempt = undefined;
      },
    },
  )
    .catch((error): AutomaticSkillSelectorAttempt => {
      if (isProviderAttemptBlockingError(error)) throw error;
      return { reason: controller.signal.aborted ? "timeout" : "provider_error" };
    });

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
    providerAttempts: ProviderAttemptRuntime;
  },
  availableSkills: ReturnType<typeof getPublicCapabilities>["skills"],
  signal: AbortSignal,
  attemptLifecycle: {
    started(handle: ProviderAttemptHandle): void;
    settled(handle: ProviderAttemptHandle): void;
  },
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
  const providerRun = args.providerAttempts.createRun("automatic_skill");
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
    let attemptHandle: ProviderAttemptHandle | undefined;
    try {
      if (route.credential.source === "missing") throw new Error("provider_credential_missing");
      attemptHandle = await providerRun.start({
        logicalRouteId: route.routeId,
        providerId: route.providerId,
        model: route.model,
        credentialClass: route.credential.source,
        fallbackIndex: route.planIndex,
        startedAt,
      });
      attemptLifecycle.started(attemptHandle);
      signal.throwIfAborted();
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
        const settledHandle = attemptHandle;
        await settledHandle.succeed();
        attemptLifecycle.settled(settledHandle);
        attemptHandle = undefined;
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
      const protocolError = new Error("Automatic Skill selection response was invalid.");
      protocolError.name = "ProviderProtocolError";
      const settledHandle = attemptHandle;
      await settledHandle.fail(protocolError);
      attemptLifecycle.settled(settledHandle);
      attemptHandle = undefined;
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
      if (isProviderAttemptBlockingError(error)) throw error;
      const settledHandle = attemptHandle;
      await settledHandle?.fail(error);
      if (settledHandle) attemptLifecycle.settled(settledHandle);
      attemptHandle = undefined;
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
      // Preserve the malformed value so a read cannot delete a concurrent administrative repair.
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
      // Preserve the malformed value so a read cannot delete a concurrent administrative repair.
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
      directEndpoint: legacy && rawRoute.directEndpoint === true ? true : undefined,
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

function mcpRuntime(env: Env, session?: Session) {
  const ownerLabel = session?.kind === "member" ? session.label : undefined;
  const secrets = managedSecretService(env);
  return createMcpRuntime({
    resolveSecret: (secretRef) => secrets.resolve("mcp", secretRef),
    resolveOAuthAccessToken: async (serverId, server) => {
      if (!ownerLabel || server.auth.type !== "oauth2") {
        throw new McpOAuthError("mcp_oauth_token_unavailable", "OAuth MCP 连接需要成员身份");
      }
      return getUserState(env, ownerLabel, session).resolveMcpOAuthAccessToken({
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
      await ensureAgentLegacyImport(env, session.label, session);
      memory = (await (await getTeamAgent(env, session.label, session)).getMemory()).memory.trim();
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
    providerRun: ProviderAttemptRun;
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
    let attemptHandle: ProviderAttemptHandle | undefined;
    try {
      if (route.credential.source === "missing") throw new Error("provider_credential_missing");
      attemptHandle = await args.providerRun.start({
        logicalRouteId: routeId,
        providerId: route.providerId,
        model: route.model,
        credentialClass: route.credential.source,
        fallbackIndex: route.planIndex,
        startedAt,
      });
      const text = await completeOnce({
        route,
        apiKey: route.credential.apiKey,
        messages: args.messages,
        temperature: args.temperature ?? 0.2,
        maxTokens: args.maxTokens,
        env,
      });
      if (text.trim()) {
        await attemptHandle.succeed();
        attemptHandle = undefined;
        await recordRouteReliability(env, {
          routeId,
          providerId: route.providerId,
          ok: true,
          fallback,
          startedAt,
          usedUserKey: route.credential.usedUserKey,
        });
        return { ok: true, text: text.trim(), routeId };
      }
      const protocolError = new Error("Provider completion was empty.");
      protocolError.name = "ProviderProtocolError";
      await attemptHandle.fail(protocolError);
      attemptHandle = undefined;
      await recordRouteReliability(env, {
        routeId,
        providerId: route.providerId,
        ok: false,
        outcome: "protocol_error",
        fallback,
        startedAt,
        usedUserKey: route.credential.usedUserKey,
      });
      lastError = "empty completion";
      lastRouteId = routeId;
    } catch (error) {
      const budgetError = providerBudgetResult(error, routeId);
      if (budgetError) return budgetError;
      await attemptHandle?.fail(error);
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
  usage?: Promise<ProviderTokenUsageV1>;
  usageSource?: Extract<ProviderUsageEvidenceSource, "openai_sse" | "anthropic_sse">;
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
      usage: attempt.usage,
      usageSource: route.type === "anthropic-messages" ? "anthropic_sse" : "openai_sse",
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
  attempt?: ProviderAttemptHandle;
  usage?: Promise<ProviderTokenUsageV1>;
  usageSource?: Extract<ProviderUsageEvidenceSource, "openai_sse" | "anthropic_sse">;
  onComplete: () => Promise<void>;
  onError: (error: unknown) => Promise<void>;
  onCancel?: () => Promise<void>;
};

export function responseWithProviderLease(
  response: Response,
  lease: ProviderLease,
  lifecycle: ProviderStreamLifecycle,
  cancelUpstream?: (reason?: unknown) => Promise<void>,
  requestSignal?: AbortSignal,
): Response {
  const reader = response.body?.getReader();
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
    let attemptError: unknown;
    try {
      if (kind === "complete") {
        await recordProviderStreamUsage(lifecycle.attempt, lifecycle.usage, lifecycle.usageSource);
        await lifecycle.attempt?.succeed();
      }
      else if (kind === "error") await lifecycle.attempt?.fail(error);
      else await lifecycle.attempt?.cancel();
    } catch (caught) {
      attemptError = caught;
    }
    await lease.release().catch(() => undefined);
    if (kind === "complete") {
      await lifecycle.onComplete().catch(() => undefined);
    } else if (kind === "error") {
      await lifecycle.onError(error).catch(() => undefined);
    } else {
      await lifecycle.onCancel?.().catch(() => undefined);
    }
    if (attemptError) throw attemptError;
  };
  if (!reader) {
    const error = new Error("Provider stream response body is unavailable.");
    error.name = "ProviderProtocolError";
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        await cancelUpstream?.(error).catch(() => undefined);
        try {
          await settle("error", error);
          controller.error(error);
        } catch (ledgerError) {
          controller.error(ledgerError);
        }
      },
    });
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }
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
  turnId: string;
  operation: InstanceOperationStateV1;
  requestSignal?: AbortSignal;
  waitUntil?: (promise: Promise<unknown>) => void;
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
  const providerAttempts = createProviderAttemptRuntime({
    ledger: args.env.PROVIDER_ATTEMPT_LEDGER,
    mode: args.env.PROVIDER_ATTEMPT_LEDGER_MODE,
    operation: args.operation,
    turnId: args.turnId,
    waitUntil: args.waitUntil,
  });
  const initialProviderRun = providerAttempts.createRun("legacy_capability");
  const aliasMap = new Map(args.tools.map((tool) => [tool.providerName, tool]));
  let selected:
    | {
        routeId: string;
        route: PreparedProviderRoute;
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
    let attemptHandle: ProviderAttemptHandle | undefined;
    try {
      if (route.credential.source === "missing") throw new Error("provider_credential_missing");
      const startedAttempt = await initialProviderRun.start({
        logicalRouteId: routeId,
        providerId: route.providerId,
        model: route.model,
        credentialClass: route.credential.source,
        fallbackIndex: route.planIndex,
        startedAt,
      });
      attemptHandle = startedAttempt;
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
      await recordProviderToolUsage(startedAttempt, turn);
      await startedAttempt.succeed();
      attemptHandle = undefined;
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
      if (isProviderAttemptBlockingError(error)) throw error;
      await attemptHandle?.fail(error);
      lastError = error instanceof ProviderToolError
        ? error
        : new ProviderToolError(
          502,
          error instanceof Error ? error.message : "provider response is invalid",
          false,
          error instanceof ProviderToolRuntimeError && error.code === "provider_protocol_error"
            ? "protocol_error"
            : undefined,
        );
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
    const publicError = lastError ? projectAgentStreamError(lastError) : "upstream_error";
    throw new CapabilityError(
      publicError,
      agentErrorMessage(publicError),
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
        usedUserKey: selected.usedUserKey,
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
    let continuationAttempt: ProviderAttemptHandle | undefined;
    try {
      const continuationRun = providerAttempts.createRun("tool_continuation");
      if (selected.route.credential.source === "missing") throw new Error("provider_credential_missing");
      const startedAttempt = await continuationRun.start({
        logicalRouteId: selected.routeId,
        providerId: selected.route.providerId,
        model: selected.route.model,
        credentialClass: selected.route.credential.source,
        fallbackIndex: selected.route.planIndex,
        startedAt: Date.now(),
      });
      continuationAttempt = startedAttempt;
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
      await recordProviderToolUsage(startedAttempt, turn);
      await startedAttempt.succeed();
      continuationAttempt = undefined;
    } catch (error) {
      if (isProviderAttemptBlockingError(error)) throw error;
      await continuationAttempt?.fail(error);
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
      const publicError = projectAgentStreamError(error);
      throw new CapabilityError(
        publicError,
        agentErrorMessage(publicError),
        true,
      );
    }
    }
  } finally {
    await selected.lease.release();
  }
}

async function recordProviderStreamUsage(
  attempt: ProviderAttemptHandle | undefined,
  usagePromise: Promise<ProviderTokenUsageV1> | undefined,
  source: Extract<ProviderUsageEvidenceSource, "openai_sse" | "anthropic_sse"> | undefined,
): Promise<void> {
  if (!attempt || !usagePromise || !source) return;
  try {
    const usage = await usagePromise;
    const hasKnownUsage = PROVIDER_USAGE_TOKEN_FIELDS.some((field) => usage[field] !== null);
    await attempt.recordUsage({ ...usage, mode: hasKnownUsage ? "cumulative" : "missing", source });
  } catch {
    // Usage evidence retries independently and must not change the stream result.
  }
}

async function handleAdminProviderFinance(env: Env, url: URL): Promise<Response> {
  const parsedLimit = Number(url.searchParams.get("limit") || "25");
  const parsedPeriodStart = Number(url.searchParams.get("periodStart") || `${Date.now() - 30 * 24 * 60 * 60 * 1_000}`);
  if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
    return jsonResponse({ error: "invalid_limit" }, 400);
  }
  if (!Number.isSafeInteger(parsedPeriodStart) || parsedPeriodStart < 0 || parsedPeriodStart > Date.now()) {
    return jsonResponse({ error: "invalid_period_start" }, 400);
  }
  const config = await loadAppConfig(env);
  const providers = configuredProviderLabels(config);
  const snapshots = await Promise.all([...providers.entries()].map(async ([providerId, label]) => ({
    label,
    ...await env.PROVIDER_ATTEMPT_LEDGER.getByName(providerId).getFinanceSnapshot({
      periodStart: parsedPeriodStart,
      limit: parsedLimit,
    }),
  })));
  const generatedAt = Date.now();
  return jsonResponse({
    version: 1,
    generatedAt,
    periodStart: parsedPeriodStart,
    hardBudgetEnforcement: "instance_provider_v1",
    providers: snapshots.sort((left, right) => left.providerId.localeCompare(right.providerId)),
  });
}

async function handleAdminProviderFinancePrice(request: Request, env: Env): Promise<Response> {
  const body = await readJson<Record<string, unknown>>(request);
  const input = decodeProviderPriceCatalogInput(body);
  if (!input) return jsonResponse({ error: "provider_price_catalog_invalid" }, 400);
  const config = await loadAppConfig(env);
  if (!configuredProviderLabels(config).has(input.providerId)) {
    return jsonResponse({ error: "provider_not_found" }, 404);
  }
  try {
    const result = await env.PROVIDER_ATTEMPT_LEDGER.getByName(input.providerId).addPriceCatalog(input);
    if (result.created) await appendAdminAudit(env, "provider-price.create", input.providerId);
    return jsonResponse(result, result.created ? 201 : 200);
  } catch (error) {
    const code = error instanceof Error ? error.message : "provider_price_catalog_unavailable";
    if (code === "provider_price_catalog_overlap" || code === "provider_price_catalog_conflict") {
      return jsonResponse({ error: code }, 409);
    }
    if (code === "provider_price_catalog_invalid") return jsonResponse({ error: code }, 400);
    throw error;
  }
}

async function handleAdminProviderFinanceReconciliation(request: Request, env: Env): Promise<Response> {
  const body = await readJson<Record<string, unknown>>(request);
  const input = decodeProviderReconciliationImportInput(body);
  if (!input) return jsonResponse({ error: "provider_reconciliation_invalid" }, 400);
  const config = await loadAppConfig(env);
  if (!configuredProviderLabels(config).has(input.providerId)) {
    return jsonResponse({ error: "provider_not_found" }, 404);
  }
  try {
    const result = await env.PROVIDER_ATTEMPT_LEDGER.getByName(input.providerId).importReconciliation(input);
    if (result.created) await appendAdminAudit(env, "provider-reconciliation.import", input.providerId);
    return jsonResponse(result, result.created ? 201 : 200);
  } catch (error) {
    const code = error instanceof Error ? error.message : "provider_reconciliation_unavailable";
    if (code === "provider_reconciliation_conflict") return jsonResponse({ error: code }, 409);
    if (code === "provider_reconciliation_invalid") return jsonResponse({ error: code }, 400);
    throw error;
  }
}

async function handleAdminProviderBudgetPolicy(request: Request, env: Env): Promise<Response> {
  const body = await readJson<Record<string, unknown>>(request);
  const requestInput = decodeProviderBudgetPolicyMutationInput(body);
  if (!requestInput) return jsonResponse({ error: "provider_budget_policy_invalid" }, 400);
  const config = await loadAppConfig(env);
  if (!configuredProviderLabels(config).has(requestInput.providerId)) {
    return jsonResponse({ error: "provider_not_found" }, 404);
  }
  const input = await createServerProviderBudgetPolicyInput(requestInput);
  try {
    const result = await env.PROVIDER_ATTEMPT_LEDGER.getByName(input.providerId).addBudgetPolicy(input);
    if (result.created) await appendAdminAudit(env, "provider-budget-policy.create", input.providerId);
    return jsonResponse(result, result.created ? 201 : 200);
  } catch (error) {
    const code = error instanceof Error ? error.message : "provider_budget_policy_unavailable";
    if (
      code === "provider_budget_policy_conflict"
      || code === "provider_budget_policy_overlap"
      || code === "provider_budget_policy_transition"
    ) {
      return jsonResponse({ error: code }, 409);
    }
    if (code === "provider_budget_policy_invalid") return jsonResponse({ error: code }, 400);
    throw error;
  }
}

async function handleAdminProviderBudgetReconciliation(
  request: Request,
  env: Env,
  reservationId: string,
): Promise<Response> {
  const body = await readJson<Record<string, unknown>>(request);
  const requestInput = decodeProviderBudgetOperatorActionRequest(body);
  if (!requestInput || requestInput.reservationId !== reservationId) {
    return jsonResponse({ error: "provider_budget_action_invalid" }, 400);
  }
  const config = await loadAppConfig(env);
  if (!configuredProviderLabels(config).has(requestInput.providerId)) {
    return jsonResponse({ error: "provider_not_found" }, 404);
  }
  const input: ProviderBudgetOperatorActionInputV1 = {
    ...requestInput,
    idempotencyKey: `provider-budget-action:v1:${requestInput.reservationId}:${requestInput.action}`,
    at: Date.now(),
  };
  try {
    const result = await env.PROVIDER_ATTEMPT_LEDGER
      .getByName(input.providerId)
      .reconcileBudgetReservation(input);
    if (result.updated) await appendAdminAudit(env, `provider-budget.${input.action}`, input.providerId);
    return jsonResponse(result);
  } catch (error) {
    const code = error instanceof Error ? error.message : "provider_budget_action_unavailable";
    if (code === "provider_budget_action_conflict") return jsonResponse({ error: code }, 409);
    if (code === "provider_budget_reservation_missing") return jsonResponse({ error: code }, 404);
    if (code === "provider_budget_action_invalid") return jsonResponse({ error: code }, 400);
    throw error;
  }
}

async function createServerProviderBudgetPolicyInput(
  requestInput: ProviderBudgetPolicyMutationInputV1,
): Promise<ProviderBudgetPolicyInputV1> {
  const identitySource = new TextEncoder().encode(JSON.stringify([
    requestInput.providerId,
    requestInput.currency,
    requestInput.periodStart,
    requestInput.periodEnd,
  ]));
  const identity = (await sha256HexBytes(identitySource)).slice(0, 32);
  const policyId = `policy_${identity}`;
  const policyVersion = requestInput.expectedPreviousVersion + 1;
  return {
    ...requestInput,
    policyId,
    idempotencyKey: `provider-budget-policy:v1:${policyId}:v${policyVersion}`,
    holdReviewAfterMs: PROVIDER_BUDGET_HOLD_REVIEW_AFTER_MS,
    allowUnknownPrice: false,
    approver: "authenticated-admin",
    createdAt: Date.now(),
  };
}

function configuredProviderLabels(config: AppConfig): Map<string, string> {
  const providers = new Map(Object.entries(config.providers).map(([providerId, provider]) => [
    providerId,
    provider.label || providerId,
  ]));
  for (const [routeId, route] of Object.entries(config.routes)) {
    for (const candidate of resolveProviderRouteCandidates(routeId, route, config.providers)) {
      if (!providers.has(candidate.providerId)) providers.set(candidate.providerId, candidate.label || candidate.providerId);
    }
  }
  return providers;
}

async function recordProviderToolUsage(attempt: ProviderAttemptHandle, turn: ModelTurn): Promise<void> {
  try {
    await attempt.recordUsage({ ...turn.usage, source: "provider_tool" });
  } catch {
    // Usage evidence retries independently and must not change the tool turn outcome.
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
  session: Session,
): { runTool: CapabilityToolRunner; close: () => Promise<void> } {
  const allowed = new Map(definitions.map((definition) => [definition.id, definition]));
  const mcpExecution = mcpRuntime(env, session).createExecution();
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
  let code: string;
  let retryable = true;
  if (error instanceof CapabilityError) {
    code = error.code;
    retryable = error.retryable;
  } else if (error instanceof McpRuntimeError) {
    code = error.code;
    retryable = error.retryable;
  } else if (error instanceof DOMException && error.name === "AbortError") {
    code = "request_cancelled";
  } else {
    const projected = projectAgentStreamError(error);
    code = providerBudgetErrorHttpStatus(projected) ? projected : "tool_execution_failed";
  }
  const envelope = createAgentErrorEnvelope(code);
  return new CapabilityError(envelope.error, envelope.message, retryable);
}

function providerBudgetResult(
  error: unknown,
  routeId?: string,
): { ok: false; error: AgentErrorCode; message: string; status: number; routeId?: string } | undefined {
  const projected = projectAgentStreamError(error);
  const status = providerBudgetErrorHttpStatus(projected);
  if (!status) return undefined;
  return {
    ok: false,
    error: projected,
    message: agentErrorMessage(projected),
    status,
    ...(routeId ? { routeId } : {}),
  };
}

function providerBudgetJsonResponse(error: unknown): Response | undefined {
  const result = providerBudgetResult(error);
  return result ? jsonResponse({ error: result.error, message: result.message }, result.status) : undefined;
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
  const stored = await getStoredSession(env, token);
  if (!stored) {
    await env.CHAT_STORE.delete(`session:${token}`);
    return null;
  }
  let session: Session;
  if (stored.kind === "member") {
    try {
      let principal: PrincipalRouteV1;
      if (isPrincipalBoundMemberSession(stored)) {
        const lookup = await env.IDENTITY_REGISTRY.getByName(IDENTITY_REGISTRY_INSTANCE_NAME)
          .lookupActivePrincipalAlias({ version: 1, alias: stored.label });
        if (!lookup.found || lookup.route.principalId !== stored.principalId) {
          throw new Error("identity_session_conflict");
        }
        principal = lookup.route;
      } else {
        principal = await resolveOrCreatePrincipalForAlias(env, {
          alias: stored.label,
          origin: "legacy",
          operationId: `legacy-session:${stored.id}`,
        });
      }
      if (!isPrincipalBoundMemberSession(stored) && principal.origin !== "legacy") {
        throw new Error("identity_legacy_session_reuse_conflict");
      }
      principal = await ensurePrincipalAuthority(env, principal);
      session = {
        ...stored,
        principalId: principal.principalId,
        rootInstanceName: principal.rootInstanceName,
        userStateInstanceName: principal.userStateInstanceName,
        registryRevision: principal.registryRevision,
      };
      if (!isPrincipalBoundMemberSession(stored) || !sameSessionPrincipalRoute(stored, session)) {
        const remainingTtl = Math.max(1, Math.ceil((stored.expiresAt - Date.now()) / 1_000));
        await env.CHAT_STORE.put(`session:${token}`, JSON.stringify(session), { expirationTtl: remainingTtl });
      }
    } catch {
      await env.CHAT_STORE.delete(`session:${token}`);
      return null;
    }
  } else {
    session = stored;
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

async function getStoredSession(env: Env, token: string): Promise<StoredSession | null> {
  const raw = await env.CHAT_STORE.get(`session:${token}`);
  if (!raw) return null;
  try {
    return normalizeStoredSession(JSON.parse(raw));
  } catch {
    return null;
  }
}

function normalizeStoredSession(value: unknown): StoredSession | null {
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
  const principalId = typeof value.principalId === "string" ? value.principalId : "";
  const rootInstanceName = typeof value.rootInstanceName === "string" ? value.rootInstanceName.trim() : "";
  const userStateInstanceName = typeof value.userStateInstanceName === "string" ? value.userStateInstanceName.trim() : "";
  const registryRevision = value.registryRevision;
  if (
    principalId || rootInstanceName || userStateInstanceName || registryRevision !== undefined
  ) {
    if (
      !isPrincipalId(principalId) || !isIdentityInstanceName(rootInstanceName)
      || !isIdentityInstanceName(userStateInstanceName)
      || typeof registryRevision !== "number" || !Number.isSafeInteger(registryRevision) || registryRevision <= 0
    ) return null;
    return {
      id,
      label,
      kind: "member",
      principalId,
      rootInstanceName,
      userStateInstanceName,
      registryRevision,
      createdAt,
      lastSeen,
      expiresAt,
    };
  }
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
  const activePrincipals = new Map<string, PrincipalRouteV1 | null>();
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
        if (session.kind === "member") {
          let active = activePrincipals.get(session.label);
          if (active === undefined) {
            const lookup = await env.IDENTITY_REGISTRY.getByName(IDENTITY_REGISTRY_INSTANCE_NAME)
              .lookupActivePrincipalAlias({ version: 1, alias: session.label });
            active = lookup.found ? lookup.route : null;
            activePrincipals.set(session.label, active);
          }
          if (!active) continue;
          if (isPrincipalBoundMemberSession(session)) {
            if (session.principalId !== active.principalId) continue;
          } else if (active.origin !== "legacy") {
            continue;
          }
        }
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
  let session: Extract<Session, { kind: "member" }> | undefined;
  if (!args.label.startsWith(GUEST_LABEL_PREFIX)) {
    const lookup = await env.IDENTITY_REGISTRY.getByName(IDENTITY_REGISTRY_INSTANCE_NAME)
      .lookupActivePrincipalAlias({ version: 1, alias: args.label });
    if (lookup.found) session = memberSessionForRoute(lookup.route);
  }
  await getUserState(env, args.label, session).recordMetric(args);
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
  return revokeSessionsMatching(env, (session) => session.label === label);
}

async function revokeSessionsByPrincipal(
  env: Env,
  principal: Extract<Session, { kind: "member" }>,
): Promise<number> {
  const active = await env.IDENTITY_REGISTRY.getByName(IDENTITY_REGISTRY_INSTANCE_NAME)
    .lookupActivePrincipalAlias({ version: 1, alias: principal.label });
  const includeLegacyUnbound = active.found && active.route.principalId === principal.principalId;
  return revokeSessionsMatching(env, (session) => (
    isPrincipalBoundMemberSession(session)
      ? session.principalId === principal.principalId
      : includeLegacyUnbound && session.kind === "member" && session.label === principal.label
  ));
}

async function revokeSessionsMatching(
  env: Env,
  matches: (session: StoredSession) => boolean,
): Promise<number> {
  let revoked = 0;
  let cursor: string | undefined;
  do {
    const result = await env.CHAT_STORE.list({ prefix: "session:", cursor, limit: 100 });
    cursor = result.list_complete ? undefined : result.cursor;
    const records = await Promise.all(result.keys.map(async (key) => ({ key: key.name, raw: await env.CHAT_STORE.get(key.name) })));
    const matchedRecords = records.filter(({ raw }) => {
      if (!raw) return false;
      try {
        const session = normalizeStoredSession(JSON.parse(raw));
        return Boolean(session && matches(session));
      } catch {
        return false;
      }
    });
    await Promise.all(matchedRecords.map(({ key }) => env.CHAT_STORE.delete(key)));
    revoked += matchedRecords.length;
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
    await getUserState(env, session.label, session).storeMcpOAuthState({
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
  const consumed = await getUserState(env, session.label, session).consumeMcpOAuthState({
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
    const connection = await getUserState(env, session.label, session).storeMcpOAuthToken({
      ownerLabel: session.label,
      serverId: consumed.serverId,
      auth: server.auth,
      token,
    });
    await appendAdminAudit(env, "mcp.oauth.connect", consumed.serverId);
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
    const discovery = await mcpRuntime(env, session).discoverTools(serverId, server, request.signal);
    const candidate = await getUserState(env, session.label, session).storeMcpOAuthDiscoveryCandidate({
      ownerLabel: session.label,
      serverId,
      configRevision: server.auth.configRevision,
      discovery,
    });
    await appendAdminAudit(env, "mcp.oauth.discovery", `${serverId}:${candidate.tools}/${candidate.rejected}`);
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
  await getUserState(env, session.label, session).revokeMcpOAuthConnection(session.label, serverId);
  await appendAdminAudit(env, "mcp.oauth.revoke", serverId);
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
  const state = getUserState(env, session.label, session);
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

async function readPrincipalScopedLegacyDayCount(
  env: Env,
  label: string,
  day: string,
  session?: Session,
): Promise<number> {
  if (session?.kind === "member" && !(await isLegacyPrincipalSessionRoute(label, session))) return 0;
  return positiveCount(await env.CHAT_STORE.get(usageKey(label, day)));
}

function quotaAdmissionService(env: Env) {
  return createQuotaAdmissionService({
    getBucket: (label, session) => getUserState(env, label, session),
    readLegacyDayCount: (label, day, session) => readPrincipalScopedLegacyDayCount(env, label, day, session),
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

async function resolveOrCreatePrincipalForAlias(
  env: Env,
  input: { alias: string; origin: "legacy" | "native"; operationId: string },
): Promise<PrincipalRouteV1> {
  const registry = env.IDENTITY_REGISTRY.getByName(IDENTITY_REGISTRY_INSTANCE_NAME);
  if (input.origin === "native") {
    return registry.resolveOrCreatePrincipal({
      version: 1,
      operationId: input.operationId,
      alias: input.alias,
      origin: "native",
    });
  }
  return registry.resolveOrCreatePrincipal({
    version: 1,
    operationId: input.operationId,
    alias: input.alias,
    origin: "legacy",
    legacyRootInstance: await getTeamAgentInstanceName(input.alias),
    legacyUserStateInstance: input.alias,
  });
}

async function identityOperationId(kind: string, ...parts: string[]): Promise<string> {
  return `${kind}:${await secretFingerprint(["chatus:identity-operation:v1", kind, ...parts].join(":"))}`;
}

async function ensureExistingMemberPrincipal(
  env: Env,
  label: string,
  operationKind: string,
): Promise<PrincipalRouteV1> {
  const registry = env.IDENTITY_REGISTRY.getByName(IDENTITY_REGISTRY_INSTANCE_NAME);
  const lookup = await registry.lookupActivePrincipalAlias({ version: 1, alias: label });
  if (lookup.found) return ensurePrincipalAuthority(env, lookup.route);
  const historical = await registry.lookupPrincipalAlias({ version: 1, alias: label });
  if (historical.found) return historical.route;
  const principal = await resolveOrCreatePrincipalForAlias(env, {
    alias: label,
    origin: "legacy",
    operationId: await identityOperationId(operationKind, label),
  });
  return ensurePrincipalAuthority(env, principal);
}

async function reserveMemberPrincipalBeforeCredential(
  env: Env,
  label: string,
  origin: "legacy" | "native",
  operationKind: string,
  mutationRevision: string,
): Promise<PrincipalRouteV1> {
  const principal = await resolveOrCreatePrincipalForAlias(env, {
    alias: label,
    origin,
    operationId: await identityOperationId(operationKind, label, mutationRevision),
  });
  return ensurePrincipalAuthority(env, principal);
}

async function retireMemberPrincipalAlias(
  env: Env,
  principal: PrincipalRouteV1,
  operationKind: string,
  mutationRevision: string,
): Promise<void> {
  await env.IDENTITY_REGISTRY.getByName(IDENTITY_REGISTRY_INSTANCE_NAME).retirePrincipalAlias({
    version: 1,
    operationId: await identityOperationId(operationKind, principal.principalId, mutationRevision),
    principalId: principal.principalId,
    alias: principal.alias,
    retiredAt: Date.now(),
  });
}

async function ensurePrincipalAuthority(env: Env, initial: PrincipalRouteV1): Promise<PrincipalRouteV1> {
  const registry = env.IDENTITY_REGISTRY.getByName(IDENTITY_REGISTRY_INSTANCE_NAME);
  let principal = await registry.resolvePrincipalSession({
    version: 1,
    principalId: initial.principalId,
    alias: initial.alias,
  });
  await assertPrincipalRouteParity(principal);
  let conversationsBackfilled = false;
  for (let step = 0; step < 4; step += 1) {
    const session = memberSessionForRoute(principal);
    const root = await getTeamAgent(env, principal.alias, session);
    if (!conversationsBackfilled) {
      await ensureExistingConversationResources(env, principal, session, root);
      conversationsBackfilled = true;
    }
    const rootMarker = stableTeamAgentMarker(session, {
      scope: "root",
      resourceId: "",
      resourceRegistryRevision: 0,
      pinnedInstanceName: principal.rootInstanceName,
    });
    const [rootEvidence, userStateEvidence] = await Promise.all([
      root.ensureStableIdentity(rootMarker),
      getUserState(env, principal.alias, session).ensureStableIdentity(stablePrincipalMarker(session)),
    ]);
    await Promise.all([
      registry.recordStableIdentityMarker({
        version: 1,
        entityType: "principal",
        entityId: principal.principalId,
        markerKind: "root",
        pinnedInstanceName: principal.rootInstanceName,
        expectedRegistryRevision: principal.registryRevision,
        expectedPrincipalRevision: principal.registryRevision,
        digest: rootEvidence.digest,
        recordedAt: Date.now(),
      }),
      registry.recordStableIdentityMarker({
        version: 1,
        entityType: "principal",
        entityId: principal.principalId,
        markerKind: "user_state",
        pinnedInstanceName: principal.userStateInstanceName,
        expectedRegistryRevision: principal.registryRevision,
        expectedPrincipalRevision: principal.registryRevision,
        digest: userStateEvidence.digest,
        recordedAt: Date.now(),
      }),
    ]);
    if (principal.migrationState === "authoritative") return principal;
    const nextState = principal.migrationState === "backfilled" ? "reconciled" : "authoritative";
    await registry.advanceIdentityState({
      version: 1,
      operationId: `principal-state:${principal.principalId}:${principal.registryRevision}:${nextState}`,
      entityType: "principal",
      entityId: principal.principalId,
      expectedRegistryRevision: principal.registryRevision,
      from: principal.migrationState,
      to: nextState,
    });
    principal = await registry.resolvePrincipalSession({
      version: 1,
      principalId: principal.principalId,
      alias: principal.alias,
    });
  }
  throw new Error("identity_principal_reconciliation_incomplete");
}

async function ensureExistingConversationResources(
  env: Env,
  principal: PrincipalRouteV1,
  session: Extract<Session, { kind: "member" }>,
  root: DurableObjectStub<TeamAgent>,
): Promise<void> {
  const registry = env.IDENTITY_REGISTRY.getByName(IDENTITY_REGISTRY_INSTANCE_NAME);
  const conversations = await root.listConversations();
  for (const conversation of conversations) {
    const lookup = await registry.lookupConversationResource({
      version: 1,
      principalId: principal.principalId,
      conversationId: conversation.id,
    });
    let resource: ConversationResourceRouteV1;
    if (lookup.found) {
      resource = lookup.route;
    } else {
      const legacyAgentInstance = principal.origin === "legacy"
        ? await getTeamAgentConversationInstanceName(principal.alias, conversation.id)
        : undefined;
      resource = await ensureConversationResource(env, principal, conversation.id, legacyAgentInstance);
    }
    await ensureConversationAuthority(env, session, resource);
  }
}

async function resolveOrCreateConversationRoute(
  env: Env,
  session: Extract<Session, { kind: "member" }>,
  conversationId: string,
): Promise<ConversationResourceRouteV1> {
  const registry = env.IDENTITY_REGISTRY.getByName(IDENTITY_REGISTRY_INSTANCE_NAME);
  const lookup = await registry.lookupConversationResource({
    version: 1,
    principalId: session.principalId,
    conversationId,
  });
  if (lookup.found) return ensureConversationAuthority(env, session, lookup.route);
  const principal = await registry.resolvePrincipalSession({
    version: 1,
    principalId: session.principalId,
    alias: session.label,
  });
  const resource = await ensureConversationResource(env, principal, conversationId);
  return ensureConversationAuthority(env, session, resource);
}

async function ensureConversationResource(
  env: Env,
  principal: PrincipalRouteV1,
  conversationId: string,
  legacyAgentInstance?: string,
): Promise<ConversationResourceRouteV1> {
  const fingerprint = await secretFingerprint([
    "chatus:identity-resource:v1",
    principal.principalId,
    conversationId,
    legacyAgentInstance || "native",
  ].join(":"));
  return env.IDENTITY_REGISTRY.getByName(IDENTITY_REGISTRY_INSTANCE_NAME).ensureConversationResource({
    version: 1,
    operationId: `resource:${fingerprint}`,
    principalId: principal.principalId,
    conversationId,
    ...(legacyAgentInstance ? { legacyAgentInstance } : {}),
  });
}

async function ensureConversationAuthority(
  env: Env,
  session: Extract<Session, { kind: "member" }>,
  initial: ConversationResourceRouteV1,
): Promise<ConversationResourceRouteV1> {
  const registry = env.IDENTITY_REGISTRY.getByName(IDENTITY_REGISTRY_INSTANCE_NAME);
  const principal = await registry.resolvePrincipalSession({
    version: 1,
    principalId: session.principalId,
    alias: session.label,
  });
  if (
    principal.rootInstanceName !== session.rootInstanceName
    || principal.userStateInstanceName !== session.userStateInstanceName
    || principal.registryRevision !== session.registryRevision
  ) throw new Error("identity_session_conflict");
  let resource = initial;
  for (let step = 0; step < 4; step += 1) {
    await assertConversationRouteParity(principal, resource);
    const props: TeamAgentProps = {
      userLabel: session.label,
      scope: "conversation",
      chatId: resource.conversationId,
      rootInstance: session.rootInstanceName,
      ...teamAgentAccessProps(session),
    };
    const agent = await getAgentByName(env.TEAM_AGENT, resource.agentInstanceName, { props });
    const legacyIdentity = await agent.ensureIdentity(props);
    if (!legacyIdentity.ok) throw new Error(legacyIdentity.error);
    const evidence = await agent.ensureStableIdentity(stableTeamAgentMarker(session, {
      scope: "conversation",
      resourceId: resource.resourceId,
      resourceRegistryRevision: resource.registryRevision,
      pinnedInstanceName: resource.agentInstanceName,
    }));
    await registry.recordStableIdentityMarker({
      version: 1,
      entityType: "resource",
      entityId: resource.resourceId,
      markerKind: "conversation",
      pinnedInstanceName: resource.agentInstanceName,
      expectedRegistryRevision: resource.registryRevision,
      expectedPrincipalRevision: principal.registryRevision,
      digest: evidence.digest,
      recordedAt: Date.now(),
    });
    if (resource.migrationState === "authoritative") return resource;
    const nextState = resource.migrationState === "backfilled" ? "reconciled" : "authoritative";
    await registry.advanceIdentityState({
      version: 1,
      operationId: `resource-state:${resource.resourceId}:${resource.registryRevision}:${nextState}`,
      entityType: "resource",
      entityId: resource.resourceId,
      expectedRegistryRevision: resource.registryRevision,
      from: resource.migrationState,
      to: nextState,
    });
    resource = await registry.resolveConversationResource({
      version: 1,
      principalId: session.principalId,
      conversationId: resource.conversationId,
    });
  }
  throw new Error("identity_resource_reconciliation_incomplete");
}

function stablePrincipalMarker(session: Extract<Session, { kind: "member" }>): StablePrincipalIdentityV1 {
  return {
    version: 1,
    principalId: session.principalId,
    rootInstanceName: session.rootInstanceName,
    userStateInstanceName: session.userStateInstanceName,
    registryRevision: session.registryRevision,
  };
}

export async function assertPrincipalRouteParity(principal: PrincipalRouteV1): Promise<void> {
  const expectedRoot = principal.origin === "legacy"
    ? await getTeamAgentInstanceName(principal.alias)
    : principalRootInstanceName(principal.principalId);
  const expectedUserState = principal.origin === "legacy"
    ? principal.alias
    : principalUserStateInstanceName(principal.principalId);
  if (
    principal.rootInstanceName !== expectedRoot
    || principal.userStateInstanceName !== expectedUserState
  ) throw new Error("identity_principal_route_conflict");
}

export async function assertConversationRouteParity(
  principal: PrincipalRouteV1,
  resource: ConversationResourceRouteV1,
): Promise<void> {
  if (resource.principalId !== principal.principalId) {
    throw new Error("identity_resource_owner_conflict");
  }
  const nativeRoute = conversationResourceInstanceName(resource.resourceId);
  if (resource.agentInstanceName === nativeRoute) return;
  const legacyRoute = principal.origin === "legacy"
    ? await getTeamAgentConversationInstanceName(principal.alias, resource.conversationId)
    : "";
  if (resource.agentInstanceName !== legacyRoute) {
    throw new Error("identity_resource_route_conflict");
  }
}

function stableTeamAgentMarker(
  session: Extract<Session, { kind: "member" }>,
  input: Pick<
    StableTeamAgentIdentityV1,
    "scope" | "resourceId" | "resourceRegistryRevision" | "pinnedInstanceName"
  >,
): StableTeamAgentIdentityV1 {
  return { ...stablePrincipalMarker(session), ...input };
}

function memberSessionForRoute(route: PrincipalRouteV1): Extract<Session, { kind: "member" }> {
  const now = Date.now();
  return {
    id: `identity-${route.principalId}`,
    label: route.alias,
    kind: "member",
    principalId: route.principalId,
    rootInstanceName: route.rootInstanceName,
    userStateInstanceName: route.userStateInstanceName,
    registryRevision: route.registryRevision,
    createdAt: now,
    lastSeen: now,
    expiresAt: Number.MAX_SAFE_INTEGER,
  };
}

function isPrincipalBoundMemberSession(
  session: StoredSession,
): session is Extract<Session, { kind: "member" }> {
  return session.kind === "member" && "principalId" in session && isPrincipalId(session.principalId);
}

function sameSessionPrincipalRoute(
  left: Extract<Session, { kind: "member" }>,
  right: Extract<Session, { kind: "member" }>,
): boolean {
  return left.principalId === right.principalId
    && left.rootInstanceName === right.rootInstanceName
    && left.userStateInstanceName === right.userStateInstanceName
    && left.registryRevision === right.registryRevision;
}

function isIdentityInstanceName(value: string): boolean {
  return value.length > 0 && value.length <= 160 && /^[A-Za-z0-9$][A-Za-z0-9$:._/-]*$/.test(value);
}

function getUserState(env: Env, label: string, session?: Session): DurableObjectStub<UserState> {
  const instanceName = session?.kind === "member" ? session.userStateInstanceName : label;
  return env.USER_STATE.getByName(instanceName);
}

export async function getTeamAgentInstanceName(label: string): Promise<string> {
  const digest = await secretFingerprint(`team-agent:${label.trim()}`);
  return `member-${digest.slice(0, 48)}`;
}

async function isLegacyPrincipalSessionRoute(
  label: string,
  session: Extract<Session, { kind: "member" }>,
): Promise<boolean> {
  return session.rootInstanceName === await getTeamAgentInstanceName(label)
    && session.userStateInstanceName === label;
}

async function getAgentClientInstanceName(session: Session): Promise<string> {
  if (session.kind === "guest") return getTeamAgentInstanceName(session.label);
  const digest = await secretFingerprint(`team-agent-client:${session.principalId}`);
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
  const instance = session?.kind === "member"
    ? session.rootInstanceName
    : await getTeamAgentInstanceName(label);
  const props: TeamAgentProps = { userLabel: label, scope: "root", ...teamAgentAccessProps(session) };
  const agent = await getAgentByName(env.TEAM_AGENT, instance, { props });
  const identity = await agent.ensureIdentity(props);
  if (!identity.ok) throw new Error(identity.error);
  if (session?.kind === "member") {
    await agent.ensureStableIdentity(stableTeamAgentMarker(session, {
      scope: "root",
      resourceId: "",
      resourceRegistryRevision: 0,
      pinnedInstanceName: instance,
    }));
  }
  return agent;
}

async function getTeamAgentConversation(
  env: Env,
  label: string,
  chatId: string,
  session?: Session,
): Promise<DurableObjectStub<TeamAgent>> {
  const resource = session?.kind === "member"
    ? await resolveOrCreateConversationRoute(env, session, chatId)
    : undefined;
  const [instance, rootInstance] = resource
    ? [resource.agentInstanceName, session!.kind === "member" ? session!.rootInstanceName : ""]
    : await Promise.all([
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
  if (session?.kind === "member" && resource) {
    await agent.ensureStableIdentity(stableTeamAgentMarker(session, {
      scope: "conversation",
      resourceId: resource.resourceId,
      resourceRegistryRevision: resource.registryRevision,
      pinnedInstanceName: instance,
    }));
  }
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

function sameStablePrincipalIdentity(
  left: StablePrincipalIdentityV1,
  right: StablePrincipalIdentityV1,
): boolean {
  return left.principalId === right.principalId
    && left.rootInstanceName === right.rootInstanceName
    && left.userStateInstanceName === right.userStateInstanceName;
}

function stablePrincipalIdentityDigest(marker: StablePrincipalIdentityV1): Promise<string> {
  return secretFingerprint([
    "chatus:stable-principal-identity:v1",
    marker.principalId,
    marker.rootInstanceName,
    marker.userStateInstanceName,
    String(marker.registryRevision),
  ].join(":"));
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

function hasOnlyExactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function isCaptureEpoch(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 160
    && /^[A-Za-z0-9][A-Za-z0-9:._/-]*$/.test(value);
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
