import { DurableObject } from "cloudflare:workers";
import { getAgentByName } from "agents";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
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
  type TeamAgentProps,
} from "./contracts/agent";
import type {
  CapabilityAssignment,
  CapabilityToolExecutionResult,
  CapabilityToolRunner,
  CapabilityStreamEvent,
  McpServerConfig,
  ModelTurn,
  NormalizedToolCall,
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
  buildResolvedProviderPlan,
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

type CapabilityChatRpcArgs = Omit<CapabilityChatArgs, "env" | "requestSignal"> & { chatId: string };

type PendingToolApproval = {
  callId: string;
  toolId: string;
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

type EncryptedSecret = {
  version: 1;
  algorithm: "AES-GCM";
  iv: string;
  ciphertext: string;
  updatedAt: string;
};

type EncryptedRouteSecret = EncryptedSecret;

type RouteSecretSource = "managed" | "worker" | "legacy" | "missing";

type RouteSecretMetadata = {
  apiKeyRef: string;
  source: RouteSecretSource;
  status: "configured" | "unavailable" | "missing";
  managed: boolean;
  environmentFallback: boolean;
  updatedAt?: string;
  revision?: string;
  message?: string;
};

type McpSecretMetadata = Omit<RouteSecretMetadata, "apiKeyRef"> & { secretRef: string };

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: {
        type: "base64";
        media_type: string;
        data: string;
      };
    };

export type Env = {
  ASSETS: Fetcher;
  CHAT_STORE: KVNamespace;
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
const MAX_SSE_PREFLIGHT_BYTES = 256 * 1024;
const AGENT_LEGACY_MIGRATION_ID = "legacy-user-state-v1";
const ADMIN_SESSION_TTL_SECONDS = 604_800;
const ADMIN_AUDIT_KEY = "config:admin_audit";
const FEEDBACK_KEY = "feedback:recent";
const MAX_FEEDBACK_ENTRIES = 100;
const DEFAULT_ANTHROPIC_VERSION = "2023-06-01";
const BLOCKED_PROMPT_MESSAGE = "不要用这种方式测活，必须使用一个小任务之类的";
const ROUTES_CONFIG_KEY = "config:routes_config";
const ACCESS_CODES_KEY = "config:access_codes";
const ROUTE_SECRET_PREFIX = "route-secret:";
const ROUTE_SECRET_AAD_PREFIX = "chatus:route-secret:v1:";
const MCP_SECRET_PREFIX = "mcp-secret:";
const MCP_SECRET_AAD_PREFIX = "chatus:mcp-secret:v1:";
const ROUTE_SECRET_REF_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;
const MAX_ROUTE_SECRET_CHARS = 8_192;
const MAX_SKILLS = 50;
const MAX_TOOLS = 200;
const MAX_MCP_SERVERS = 20;
const MAX_SELECTED_SKILLS = 3;
const MAX_SKILL_INSTRUCTIONS_CHARS = 8_000;
const MAX_TOOL_SCHEMA_CHARS = 32_768;
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
const GUEST_CLEANUP_RETENTION_SECONDS = 7 * 86_400;
const GUEST_CLEANUP_BATCH_SIZE = 10;
const MAX_GUEST_DAILY_LIMIT = 1_000;
const MAX_GUEST_MINUTE_LIMIT = 60;
const MAX_GUEST_SOURCE_DAILY_LIMIT = 10_000;
const MAX_GUEST_SOURCE_MINUTE_LIMIT = 600;
const GUEST_TURN_LEASE_MS = 10 * 60_000;
const MCP_REMOTE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MAX_TOOL_ROUNDS = 4;
const MAX_TOOL_CALLS = 8;
const TOOL_CALL_TIMEOUT_MS = 15_000;
const TOOL_TOTAL_BUDGET_MS = 45_000;
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

class RouteSecretError extends Error {
  constructor(
    readonly code: "master_key_unavailable" | "invalid_record" | "decrypt_failed",
    message: string,
  ) {
    super(message);
    this.name = "RouteSecretError";
  }
}

class UpstreamRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly outcome?: RouteReliabilityOutcome,
  ) {
    super(message);
    this.name = "UpstreamRequestError";
  }
}

type UsageResult =
  | { ok: true; remaining: number }
  | { ok: false; retryAfter: number; reset: "daily" | "minute"; scope?: "session" | "source" };

type TurnAdmission =
  | { ok: true; remaining: number; release: () => Promise<void> }
  | {
      ok: false;
      error: "rate_limited" | "concurrent_turn";
      retryAfter: number;
      reset?: "daily" | "minute";
      scope?: "session" | "source";
    };

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

export class UserState extends DurableObject<Env> {
  private readonly runtimeEnv: Env;
  private readonly activeCapabilityRuns = new Map<string, ActiveCapabilityRun>();
  private readonly conversationTrust = new Map<string, { toolIds: Set<string>; lastSeenAt: number }>();

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
        CREATE INDEX IF NOT EXISTS chats_updated_at ON chats(updated_at DESC);
      `);
    });
  }

  async consumeLimits(
    dailyLimit: number,
    minuteLimit: number,
    nowMs: number,
    legacyDayCount = 0,
  ): Promise<UsageResult> {
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
  ): Promise<{ resolved: boolean }> {
    const active = this.activeCapabilityRuns.get(runId);
    const pending = active?.pendingApproval;
    if (!active || !pending || pending.callId !== callId) return { resolved: false };
    active.pendingApproval = undefined;
    clearTimeout(pending.timer);
    if (decision === "conversation") {
      const trust = this.conversationTrust.get(active.chatId) || { toolIds: new Set<string>(), lastSeenAt: Date.now() };
      trust.toolIds.add(pending.toolId);
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
    const trust = this.conversationTrust.get(active.chatId);
    if (policy === "first-per-conversation" && trust?.toolIds.has(definition.id)) {
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
      }, 120_000);
      active.pendingApproval = { callId: event.id, toolId: definition.id, resolve, reject, timer };
      active.controller.signal.addEventListener("abort", () => {
        if (active.pendingApproval?.callId === event.id) active.pendingApproval = undefined;
        clearTimeout(timer);
        reject(new CapabilityError("request_cancelled", "工具会话已取消", true));
      }, { once: true });
    });
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
    for (const runId of [...this.activeCapabilityRuns.keys()]) this.cleanupCapabilityRun(runId);
    this.conversationTrust.clear();
    this.ctx.storage.sql.exec("DELETE FROM chats");
    this.ctx.storage.sql.exec("DELETE FROM deleted_chats");
    this.ctx.storage.sql.exec("DELETE FROM usage");
    this.ctx.storage.sql.exec("DELETE FROM bursts");
    this.ctx.storage.sql.exec("DELETE FROM metrics");
    this.ctx.storage.sql.exec("DELETE FROM guest_turn_lease");
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
};

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
    const [revoked, feedback] = await Promise.all([
      revokeSessionsByLabel(env, session.label),
      loadFeedback(env),
      getUserState(env, session.label).purgeUserData(),
      purgeAgentUserData(env, session.label),
    ]);
    await Promise.all([
      env.CHAT_STORE.delete(memoryKey(session.label)),
      env.CHAT_STORE.put(FEEDBACK_KEY, JSON.stringify(feedback.filter((entry) => entry.label !== session.label))),
      ...Array.from({ length: METRICS_DAYS }, (_, index) =>
        env.CHAT_STORE.delete(usageKey(session.label, utcDayString(index))),
      ),
    ]);
    return jsonResponse({ ok: true, revoked }, 200, {
      "Set-Cookie": buildSessionCookie("", 0, url.protocol === "https:"),
    });
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
    return jsonResponse({ entries: await loadAdminAudit(env) });
  }
  if (url.pathname === "/api/admin/feedback" && request.method === "GET") {
    return jsonResponse({ entries: await loadFeedback(env) });
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
  const [usage, routes] = await Promise.all([
    getUsage(env, session, access.user),
    Promise.all(access.routes.map((route) => withPublicRouteHealth(env, route))),
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
  const editable = await loadEditableConfig(env);
  const normalized = mergeHiddenCredentialShadows(
    editable.config,
    normalizeAppConfig(body.config),
    body.config,
  );
  const validation = validateAppConfig(normalized);
  if (!validation.ok) {
    return jsonResponse({ error: "invalid_config", message: validation.message }, 400);
  }

  await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify(normalized));
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
  const refs = new Set(
    [...Object.values(config.providers), ...Object.values(config.routes)]
      .map((item) => item.apiKeyRef?.trim() || "")
      .filter((ref) => ROUTE_SECRET_REF_PATTERN.test(ref)),
  );
  let cursor: string | undefined;
  do {
    const page = await env.CHAT_STORE.list({ prefix: ROUTE_SECRET_PREFIX, cursor, limit: 100 });
    for (const key of page.keys) {
      const encodedRef = key.name.slice(ROUTE_SECRET_PREFIX.length);
      try {
        const ref = decodeURIComponent(encodedRef);
        if (ROUTE_SECRET_REF_PATTERN.test(ref)) refs.add(ref);
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
  if (!ROUTE_SECRET_REF_PATTERN.test(apiKeyRef)) {
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
  if (apiKey.length > MAX_ROUTE_SECRET_CHARS) {
    return jsonResponse({ error: "api_key_too_long", message: "线路密钥长度超出限制" }, 400);
  }

  const conflict = await routeSecretRevisionConflict(env, apiKeyRef, body.expectedRevision);
  if (conflict) return conflict;

  try {
    const record = await encryptRouteSecret(env, apiKeyRef, apiKey);
    await env.CHAT_STORE.put(routeSecretKey(apiKeyRef), JSON.stringify(record));
    await appendAdminAudit(env, "route-secret.update", apiKeyRef);
    return jsonResponse({ ok: true, item: await inspectRouteSecret(env, apiKeyRef) });
  } catch (error) {
    return routeSecretAdminErrorResponse(error);
  }
}

async function handleDeleteAdminRouteSecret(request: Request, env: Env, apiKeyRef: string): Promise<Response> {
  if (!ROUTE_SECRET_REF_PATTERN.test(apiKeyRef)) {
    return jsonResponse({
      error: "invalid_api_key_ref",
      message: "API Key Ref 必须以大写字母开头，且只能包含大写字母、数字和下划线",
    }, 400);
  }
  const body = await readJson<{ expectedRevision?: unknown }>(request);
  const conflict = await routeSecretRevisionConflict(env, apiKeyRef, body.expectedRevision);
  if (conflict) return conflict;
  await env.CHAT_STORE.delete(routeSecretKey(apiKeyRef));
  await appendAdminAudit(env, "route-secret.delete", apiKeyRef);
  return jsonResponse({ ok: true, item: await inspectRouteSecret(env, apiKeyRef) });
}

async function handleGetAdminMcpSecrets(env: Env): Promise<Response> {
  const config = await loadAppConfig(env);
  const refs = new Set(
    Object.values(config.mcpServers || {})
      .map((server) => server.secretRef?.trim() || "")
      .filter((ref) => ROUTE_SECRET_REF_PATTERN.test(ref)),
  );
  let cursor: string | undefined;
  do {
    const page = await env.CHAT_STORE.list({ prefix: MCP_SECRET_PREFIX, cursor, limit: 100 });
    for (const key of page.keys) {
      const encodedRef = key.name.slice(MCP_SECRET_PREFIX.length);
      try {
        const ref = decodeURIComponent(encodedRef);
        if (ROUTE_SECRET_REF_PATTERN.test(ref)) refs.add(ref);
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
  if (!ROUTE_SECRET_REF_PATTERN.test(secretRef)) {
    return jsonResponse({
      error: "invalid_secret_ref",
      message: "Secret Ref 必须以大写字母开头，且只能包含大写字母、数字和下划线",
    }, 400);
  }
  const body = await readJson<{ secret?: unknown; expectedRevision?: unknown }>(request);
  const secret = typeof body.secret === "string" ? body.secret.trim() : "";
  if (!secret) return jsonResponse({ error: "secret_required", message: "请输入要保存的 MCP 密钥" }, 400);
  if (secret.length > MAX_ROUTE_SECRET_CHARS) {
    return jsonResponse({ error: "secret_too_long", message: "MCP 密钥长度超出限制" }, 400);
  }
  const conflict = await managedSecretRevisionConflict(env, "mcp", secretRef, body.expectedRevision);
  if (conflict) return conflict;
  try {
    const record = await encryptManagedSecret(env, "mcp", secretRef, secret);
    await env.CHAT_STORE.put(managedSecretKey("mcp", secretRef), JSON.stringify(record));
    await appendAdminAudit(env, "mcp-secret.update", secretRef);
    return jsonResponse({ ok: true, item: await inspectMcpSecret(env, secretRef) });
  } catch (error) {
    return routeSecretAdminErrorResponse(error);
  }
}

async function handleDeleteAdminMcpSecret(request: Request, env: Env, secretRef: string): Promise<Response> {
  if (!ROUTE_SECRET_REF_PATTERN.test(secretRef)) {
    return jsonResponse({
      error: "invalid_secret_ref",
      message: "Secret Ref 必须以大写字母开头，且只能包含大写字母、数字和下划线",
    }, 400);
  }
  const body = await readJson<{ expectedRevision?: unknown }>(request);
  const conflict = await managedSecretRevisionConflict(env, "mcp", secretRef, body.expectedRevision);
  if (conflict) return conflict;
  await env.CHAT_STORE.delete(managedSecretKey("mcp", secretRef));
  await appendAdminAudit(env, "mcp-secret.delete", secretRef);
  return jsonResponse({ ok: true, item: await inspectMcpSecret(env, secretRef) });
}

async function inspectMcpSecret(env: Env, secretRef: string): Promise<McpSecretMetadata> {
  const raw = await env.CHAT_STORE.get(managedSecretKey("mcp", secretRef));
  const environmentFallback = typeof env[secretRef] === "string" && Boolean(String(env[secretRef]).trim());
  if (!raw) {
    return {
      secretRef,
      source: environmentFallback ? "worker" : "missing",
      status: environmentFallback ? "configured" : "missing",
      managed: false,
      environmentFallback,
    };
  }
  const revision = await secretFingerprint(raw);
  try {
    const record = parseEncryptedSecret(raw, "mcp");
    await decryptManagedSecretRecord(env, "mcp", secretRef, record);
    return {
      secretRef,
      source: "managed",
      status: "configured",
      managed: true,
      environmentFallback,
      updatedAt: record.updatedAt,
      revision,
    };
  } catch (error) {
    return {
      secretRef,
      source: "managed",
      status: "unavailable",
      managed: true,
      environmentFallback,
      revision,
      message: error instanceof RouteSecretError ? error.message : "后台 MCP 密钥不可用",
    };
  }
}

async function managedSecretRevisionConflict(
  env: Env,
  namespace: "route" | "mcp",
  secretRef: string,
  expectedValue: unknown,
): Promise<Response | null> {
  const expectedRevision = typeof expectedValue === "string" ? expectedValue : "";
  if (!expectedRevision) return null;
  const raw = await env.CHAT_STORE.get(managedSecretKey(namespace, secretRef));
  const currentRevision = raw ? await secretFingerprint(raw) : "";
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
  try {
    await importRouteMasterKey(env);
    return { ready: true };
  } catch (error) {
    return {
      ready: false,
      message: error instanceof RouteSecretError ? error.message : "线路密钥主密钥不可用",
    };
  }
}

async function inspectRouteSecret(env: Env, apiKeyRef: string): Promise<RouteSecretMetadata> {
  const raw = await env.CHAT_STORE.get(routeSecretKey(apiKeyRef));
  const environmentFallback = typeof env[apiKeyRef] === "string" && Boolean(String(env[apiKeyRef]).trim());
  if (!raw) {
    return {
      apiKeyRef,
      source: environmentFallback ? "worker" : "missing",
      status: environmentFallback ? "configured" : "missing",
      managed: false,
      environmentFallback,
    };
  }

  const revision = await secretFingerprint(raw);
  try {
    const record = parseEncryptedRouteSecret(raw);
    await decryptRouteSecretRecord(env, apiKeyRef, record);
    return {
      apiKeyRef,
      source: "managed",
      status: "configured",
      managed: true,
      environmentFallback,
      updatedAt: record.updatedAt,
      revision,
    };
  } catch (error) {
    return {
      apiKeyRef,
      source: "managed",
      status: "unavailable",
      managed: true,
      environmentFallback,
      revision,
      message: error instanceof RouteSecretError ? error.message : "后台线路密钥不可用",
    };
  }
}

function routeSecretAdminErrorResponse(error: unknown): Response {
  if (error instanceof RouteSecretError) {
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
  const allowedReasons = new Set(["inaccurate", "misunderstood", "verbose", "format", "other"]);
  const reason = body.rating === "down" && typeof body.reason === "string" && allowedReasons.has(body.reason) ? body.reason : "";
  if (body.rating === "down" && !reason) return jsonResponse({ error: "feedback_reason_required" }, 400);
  const routeId = typeof body.routeId === "string" ? body.routeId.trim().slice(0, 100) : "";
  const chatId = typeof body.chatId === "string" ? body.chatId.trim().slice(0, 100) : "";
  const messageId = typeof body.messageId === "string" ? body.messageId.trim().slice(0, 100) : "";
  if (!routeId || !chatId || !messageId) return jsonResponse({ error: "feedback_metadata_required" }, 400);
  const config = await loadAppConfig(env);
  if (!config.routes[routeId]) return jsonResponse({ error: "route_not_found" }, 404);
  const entries = await loadFeedback(env);
  const id = `${session.label}:${chatId}:${messageId}`;
  const entry = { id, label: session.label, rating: body.rating, reason, routeId, chatId, messageId, at: new Date().toISOString() };
  const next = [entry, ...entries.filter((item) => item.id !== id)].slice(0, MAX_FEEDBACK_ENTRIES);
  await env.CHAT_STORE.put(FEEDBACK_KEY, JSON.stringify(next));
  return jsonResponse({ ok: true, rating: body.rating });
}

async function loadFeedback(env: Env): Promise<Array<{ id: string; label: string; rating: "up" | "down"; reason?: string; routeId: string; chatId: string; messageId: string; at: string }>> {
  const raw = await env.CHAT_STORE.get(FEEDBACK_KEY);
  if (!raw) return [];
  try {
    const entries = JSON.parse(raw);
    return Array.isArray(entries) ? entries.slice(0, MAX_FEEDBACK_ENTRIES) : [];
  } catch {
    return [];
  }
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
  const body = await readJson<{ id?: unknown; title?: unknown; routeId?: unknown; skillIds?: unknown }>(request);
  const settings = await validateAgentConversationSettings(env, session, body.routeId, body.skillIds, true);
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
  const settings = await repairAgentConversationSettings(env, session, source.routeId, source.skillIds);
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
    title: branchConversationTitle(source.title),
    routeId: settings.routeId,
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
    body: { routeId: settings.routeId, skillIds: settings.skillIds },
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
    skillIds?: unknown;
    expectedUpdatedAt?: unknown;
  }>(request);
  const expectedUpdatedAt = finitePositiveInteger(body.expectedUpdatedAt);
  if (!expectedUpdatedAt) {
    return jsonResponse({ error: "expected_updated_at_required", message: "缺少会话版本，请刷新后重试" }, 400);
  }
  const settings = await validateAgentConversationSettings(env, session, body.routeId, body.skillIds, false);
  if (!settings.ok) return settings.response;
  await ensureAgentLegacyImport(env, session.label);
  const root = await getTeamAgent(env, session.label);
  const result = await root.updateConversation({
    id,
    expectedUpdatedAt,
    title: typeof body.title === "string" ? body.title : undefined,
    routeId: settings.routeId,
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
  await getUserState(env, session.label).deleteChat(id, 0).catch(() => undefined);
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

async function handleExportUserData(env: Env, session: Session): Promise<Response> {
  try {
    await ensureAgentLegacyImport(env, session.label);
    await drainAgentConversationCleanup(env, session.label);
    const root = await getTeamAgent(env, session.label);
    const [memory, conversations] = await Promise.all([
      root.getMemory(),
      root.listConversations(),
    ]);
    const exportedConversations: Array<AgentConversationSummary & {
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
      const exported = {
        ...conversation,
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
  skillValue: unknown,
  useDefaults: boolean,
): Promise<
  | { ok: true; routeId?: string; skillIds?: string[] }
  | { ok: false; response: Response }
> {
  const config = await loadAppConfig(env);
  const access = await getRouteAccess(config, session, env);
  const requestedRoute = typeof routeValue === "string" ? routeValue.trim() : "";
  if (requestedRoute && !access.routes.some((route) => route.id === requestedRoute)) {
    return { ok: false, response: jsonResponse({ error: "route_not_allowed", message: "该线路不可用" }, 403) };
  }
  let skillIds: string[] | undefined;
  if (skillValue !== undefined) {
    const requestedSkills = normalizeSelectedSkillIds(skillValue);
    const allowedSkills = new Set(getPublicCapabilities(config, access.user).skills.map((skill) => skill.id));
    if (requestedSkills.some((id) => !allowedSkills.has(id))) {
      return { ok: false, response: jsonResponse({ error: "skill_not_allowed", message: "包含未分配的 Skill" }, 403) };
    }
    skillIds = requestedSkills;
  } else if (useDefaults) {
    skillIds = [];
  }
  return {
    ok: true,
    routeId: requestedRoute || (useDefaults ? access.defaultRoute : undefined),
    skillIds,
  };
}

async function repairAgentConversationSettings(
  env: Env,
  session: Session,
  routeValue: unknown,
  skillValue: unknown,
): Promise<{ routeId?: string; skillIds: string[] }> {
  const config = await loadAppConfig(env);
  const access = await getRouteAccess(config, session, env);
  const requestedRoute = typeof routeValue === "string" ? routeValue.trim() : "";
  const routeId = requestedRoute && access.routes.some((route) => route.id === requestedRoute)
    ? requestedRoute
    : access.defaultRoute || undefined;
  const allowedSkills = new Set(getPublicCapabilities(config, access.user).skills.map((skill) => skill.id));
  const skillIds = normalizeSelectedSkillIds(skillValue)
    .filter((skillId) => allowedSkills.has(skillId));
  return { routeId, skillIds };
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

function branchConversationTitle(title: string): string {
  const base = title.trim().slice(0, 68) || "新对话";
  return `${base} · 分支`;
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
    authType?: unknown;
    secretRef?: unknown;
  }>(request);
  const serverId = normalizeCapabilityId(body.serverId, 80);
  if (!serverId) return jsonResponse({ error: "invalid_mcp_server_id", message: "MCP Server ID 格式无效" }, 400);
  const authType = body.authType;
  if (authType !== "none" && authType !== "bearer" && authType !== "x-api-key") {
    return jsonResponse({ error: "invalid_mcp_auth_type", message: "MCP 认证类型无效" }, 400);
  }
  const endpoint = normalizeBoundedText(body.endpoint, 2_048);
  const secretRef = normalizeBoundedText(body.secretRef, 64);
  const server: McpServerConfig = {
    enabled: true,
    label: normalizeBoundedText(body.label, 80) || serverId,
    endpoint,
    authType,
    secretRef: secretRef && ROUTE_SECRET_REF_PATTERN.test(secretRef) ? secretRef : undefined,
  };
  if (!isValidMcpEndpoint(server.endpoint) || isForbiddenMcpUrl(new URL(server.endpoint))) {
    return jsonResponse({ error: "mcp_endpoint_invalid", message: "MCP 地址必须是可公开访问的 HTTPS 地址" }, 400);
  }
  if (server.authType !== "none" && !server.secretRef) {
    return jsonResponse({ error: "mcp_auth_unavailable", message: "该认证类型需要有效的 Secret Ref" }, 400);
  }
  try {
    const discovery = await discoverMcpTools(serverId, server, env, request.signal);
    await appendAdminAudit(env, "mcp.discovery", `${serverId}:${discovery.tools.length}/${discovery.rejected}`);
    return jsonResponse(discovery);
  } catch (error) {
    const capabilityError = toCapabilityError(error);
    return jsonResponse({ error: capabilityError.code, message: capabilityError.message }, 502);
  }
}

async function discoverMcpTools(
  serverId: string,
  server: McpServerConfig,
  env: Env,
  signal: AbortSignal,
): Promise<{
  serverId: string;
  tools: Array<{
    id: string;
    label: string;
    description: string;
    inputSchema: Record<string, unknown>;
    confirmation: "first-per-conversation";
    executor: { type: "mcp"; serverId: string; remoteName: string };
    schemaFingerprint: string;
  }>;
  rejected: number;
}> {
  const session = await openMcpSession(serverId, server, env, signal);
  try {
    const tools: Array<{
      id: string;
      label: string;
      description: string;
      inputSchema: Record<string, unknown>;
      confirmation: "first-per-conversation";
      executor: { type: "mcp"; serverId: string; remoteName: string };
      schemaFingerprint: string;
    }> = [];
    let cursor: string | undefined;
    let rejected = 0;
    for (let page = 0; page < 10 && tools.length < MAX_TOOLS; page += 1) {
      const result = await session.client.listTools(cursor ? { cursor } : undefined, {
        signal,
        timeout: TOOL_CALL_TIMEOUT_MS,
        maxTotalTimeout: TOOL_CALL_TIMEOUT_MS,
      });
      for (const remoteTool of result.tools) {
        const remoteName = normalizeBoundedText(remoteTool.name, 128);
        const inputSchema = normalizeJsonRecord(remoteTool.inputSchema, MAX_TOOL_SCHEMA_CHARS);
        const readOnly = remoteTool.annotations?.readOnlyHint === true && remoteTool.annotations?.destructiveHint !== true;
        const taskSupport = remoteTool.execution?.taskSupport || "forbidden";
        if (!remoteName || !MCP_REMOTE_NAME_PATTERN.test(remoteName) || !inputSchema || !readOnly || taskSupport === "required") {
          rejected += 1;
          continue;
        }
        const id = `mcp:${serverId}:${remoteName}`;
        tools.push({
          id,
          label: normalizeBoundedText(remoteTool.title, 80) || remoteName,
          description: normalizeBoundedText(remoteTool.description, 1_000),
          inputSchema,
          confirmation: "first-per-conversation",
          executor: { type: "mcp", serverId, remoteName },
          schemaFingerprint: await jsonFingerprint(inputSchema),
        });
        if (tools.length >= MAX_TOOLS) break;
      }
      cursor = result.nextCursor;
      if (!cursor) return { serverId, tools, rejected };
    }
    if (cursor) throw new CapabilityError("mcp_protocol_error", "MCP 工具列表分页超过限制");
    return { serverId, tools, rejected };
  } finally {
    await closeMcpSession(session);
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

async function drainAgentConversationCleanup(env: Env, label: string): Promise<void> {
  const root = await getTeamAgent(env, label);
  const pending = await root.listPendingConversationCleanups(3).catch(() => []);
  await Promise.all(pending.map((record) => attemptAgentConversationCleanup(env, label, record.chatId, root)));
}

async function attemptAgentConversationCleanup(
  env: Env,
  label: string,
  chatId: string,
  root: DurableObjectStub<TeamAgent> | Promise<DurableObjectStub<TeamAgent>> = getTeamAgent(env, label),
): Promise<boolean> {
  const agentRoot = await root;
  try {
    const conversation = await getTeamAgentConversation(env, label, chatId);
    await conversation.clearConversation();
    await agentRoot.completeConversationCleanup(chatId);
    return true;
  } catch {
    await agentRoot.recordConversationCleanupFailure(chatId).catch(() => undefined);
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

async function purgeAgentUserData(env: Env, label: string): Promise<void> {
  const root = await getTeamAgent(env, label);
  const conversationIds = await root.getAllConversationIds();
  await Promise.all(conversationIds.map(async (chatId) => {
    const conversation = await getTeamAgentConversation(env, label, chatId);
    await conversation.clearConversation();
  }));
  await root.purgeRootData();
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

  const admission = await admitTurn(env, session, access);
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
  const providerPlan = (await buildRuntimeProviderPlan(env, config, routeIds))
    .filter((route) => !hasImages || route.supportsImages);
  const prepared = await prepareProviderPlan(env, access, providerPlan, userApiKey);
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
  skillIds?: string[];
  userApiKey?: string;
  sessionSummary?: string;
  temperature?: number;
  longTermMemory?: string;
};

export type PreparedTeamAgentTurn =
  | {
      ok: true;
      model: LanguageModelV3;
      messages: ModelMessage[];
      systemMessages: ModelMessage[];
      toolDefinitions: NormalizedToolDefinition[];
      runTool: CapabilityToolRunner;
      closeTools: () => Promise<void>;
      maxToolSteps: number;
      remaining: number;
      routeId: string;
      skillIds: string[];
      recordStreamFailure: () => Promise<void>;
      releaseTurn: () => Promise<void>;
    }
  | { ok: false; error: string; message: string; status: number; routeId?: string };

export async function prepareTeamAgentTurn(
  env: Env,
  session: Session,
  input: TeamAgentTurnInput,
): Promise<PreparedTeamAgentTurn> {
  const config = await loadAppConfig(env);
  if (session.expiresAt <= Date.now()) {
    return { ok: false, error: "session_expired", message: "登录会话已过期，请重新连接", status: 401 };
  }
  if (session.kind === "guest" && !config.publicAccess.enabled) {
    return { ok: false, error: "public_access_disabled", message: "公开访问已关闭", status: 403 };
  }
  const access = await getRouteAccess(config, session, env);
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
  const selectedPublicRoute = access.routes.find((route) => route.id === selectedRoute)
    || access.routes.find((route) => route.id === access.defaultRoute);
  if (messagesContainImages(normalized) && selectedPublicRoute?.supportsImages === false) {
    return {
      ok: false,
      error: "image_not_supported",
      message: "当前线路不支持图片消息",
      status: 400,
      routeId: selectedPublicRoute.id,
    };
  }

  const selectedSkills = getSelectedSkills(config, input.skillIds, access.user);
  const messages = await buildMessagesWithSystem(
    env,
    session,
    normalized,
    input.sessionSummary || "",
    access.user,
    selectedSkills,
    input.longTermMemory,
  );
  const systemMessageCount = Math.max(0, messages.length - normalized.length);
  const systemMessages = toProviderModelMessages(messages.slice(0, systemMessageCount));
  const toolDefinitions = selectedPublicRoute?.supportsTools
    ? await buildCapabilityToolDefinitions(config, access.user, selectedSkills, secretFingerprint)
    : [];
  const routeIds = buildProviderRoutePlan(selectedRoute, config.routes, access);
  const providerPlan = await buildRuntimeProviderPlan(env, config, routeIds);
  const userApiKey = input.userApiKey?.trim() || "";
  const candidates: FallbackModelCandidate[] = [];
  const credentials = new Map<string, ProviderCredential>();
  let lastError: { routeId: string; message: string } | null = null;

  for (const route of providerPlan) {
    const routeId = route.routeId;
    const publicRoute = access.routes.find((item) => item.id === routeId);
    if (!publicRoute) continue;
    if (messagesContainImages(normalized) && !publicRoute.supportsImages) continue;
    if (messagesContainImages(normalized) && !route.supportsImages) continue;
    if (toolDefinitions.length && !route.supportsTools) continue;

    let credential: ProviderCredential;
    try {
      credential = await resolveRouteCredential(route, env, publicRoute.allowUserKey ? userApiKey : "");
    } catch (error) {
      lastError = {
        routeId,
        message: error instanceof RouteSecretError ? error.message : "route key is unavailable",
      };
      continue;
    }
    if (!credential.apiKey) {
      if (publicRoute.requiresUserKey) {
        return { ok: false, error: "user_api_key_required", message: "需要填写 API Key", status: 400, routeId };
      }
      lastError = { routeId, message: "route key is not configured" };
      continue;
    }

    credentials.set(routeProviderKey(routeId, route.providerId), credential);
    candidates.push({
      routeId,
      providerId: route.providerId,
      model: createProviderLanguageModel(route, credential.apiKey),
      usedUserKey: credential.usedUserKey,
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

  const admission = await admitTurn(env, session, access, input.continuation !== true);
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
  const toolRuntime = createAgentCapabilityRuntime(toolDefinitions, env);

  return {
    ok: true,
    model,
    messages: toProviderModelMessages(messages),
    systemMessages,
    toolDefinitions,
    runTool: toolRuntime.runTool,
    closeTools: toolRuntime.close,
    maxToolSteps: MAX_TOOL_ROUNDS,
    remaining: admission.remaining,
    routeId: selectedPublicRoute?.id || selectedRoute,
    skillIds: selectedSkills.map(({ id }) => id),
    recordStreamFailure,
    releaseTurn: admission.release,
  };
}


async function loadAppConfig(env: Env): Promise<AppConfig> {
  const stored = await env.CHAT_STORE.get(ROUTES_CONFIG_KEY);
  if (stored?.trim()) {
    try {
      return normalizeAppConfig(JSON.parse(stored));
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
      return { config: normalizeAppConfig(JSON.parse(stored)), source: "kv" };
    } catch {
      await env.CHAT_STORE.delete(ROUTES_CONFIG_KEY);
    }
  }

  if (env.ROUTES_CONFIG?.trim()) {
    try {
      return { config: normalizeAppConfig(JSON.parse(env.ROUTES_CONFIG)), source: "secret" };
    } catch {
      return { config: getDefaultAppConfig(env), source: "default" };
    }
  }

  return { config: getDefaultAppConfig(env), source: "default" };
}

function getAppConfig(env: Env): AppConfig {
  if (env.ROUTES_CONFIG?.trim()) {
    try {
      return normalizeAppConfig(JSON.parse(env.ROUTES_CONFIG));
    } catch {
      return getDefaultAppConfig(env);
    }
  }

  return getDefaultAppConfig(env);
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
    if (!isValidMcpEndpoint(server.endpoint)) {
      return { ok: false, message: `MCP 服务 ${serverId} 必须使用有效的 HTTPS 地址` };
    }
    if (server.authType !== "none" && !server.secretRef) {
      return { ok: false, message: `MCP 服务 ${serverId} 使用认证时必须配置 Secret Ref` };
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
      apiKeyRef: legacy && typeof rawRoute.apiKeyRef === "string" ? rawRoute.apiKeyRef : undefined,
      authHeader: legacy && typeof rawRoute.authHeader === "string" ? rawRoute.authHeader : undefined,
      authPrefix: legacy && typeof rawRoute.authPrefix === "string" ? rawRoute.authPrefix : undefined,
      directEndpoint: legacy && rawRoute.directEndpoint === true,
      headers: legacy ? normalizeStringRecord(rawRoute.headers) : undefined,
      maxTokens: normalizePositiveNumber(rawRoute.maxTokens),
      temperature: normalizeNumber(rawRoute.temperature),
      fallbacks: Array.isArray(rawRoute.fallbacks)
        ? rawRoute.fallbacks.filter((item): item is string => typeof item === "string")
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
      apiKeyRef: typeof rawProvider.apiKeyRef === "string" ? rawProvider.apiKeyRef : undefined,
      authHeader: typeof rawProvider.authHeader === "string" ? rawProvider.authHeader : undefined,
      authPrefix: typeof rawProvider.authPrefix === "string" ? rawProvider.authPrefix : undefined,
      directEndpoint: rawProvider.directEndpoint === true,
      headers: normalizeStringRecord(rawProvider.headers),
      allowUserKey: rawProvider.allowUserKey !== false,
      requiresUserKey: rawProvider.requiresUserKey === true,
      supportsImages: rawProvider.supportsImages !== false,
      supportsTools: rawProvider.supportsTools === true,
      concurrency,
      maxConcurrent: concurrency === "bounded" ? normalizePositiveNumber(rawProvider.maxConcurrent) : undefined,
      queueTimeoutMs: normalizeNonNegativeNumber(rawProvider.queueTimeoutMs),
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
  const dailyMessageLimit = normalizePositiveNumber(value.dailyMessageLimit);
  if (dailyMessageLimit !== undefined) output.dailyMessageLimit = dailyMessageLimit;
  const minuteMessageLimit = normalizePositiveNumber(value.minuteMessageLimit);
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

function isValidMcpEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.hash;
  } catch {
    return false;
  }
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
    isManagedReference: (apiKeyRef) => ROUTE_SECRET_REF_PATTERN.test(apiKeyRef),
    loadManagedSecret: (apiKeyRef) => loadManagedRouteSecret(env, apiKeyRef),
  });
}

async function buildRuntimeProviderPlan(
  env: Env,
  config: AppConfig,
  routeIds: string[],
): Promise<ResolvedProviderRoute[]> {
  const rawCandidates = routeIds.flatMap((routeId) => {
    const route = config.routes[routeId];
    return route ? resolveProviderRouteCandidates(routeId, route, config.providers) : [];
  });
  const qualityEntries = await Promise.all(rawCandidates.map(async (candidate) => {
    const reliability = await loadProviderRouteReliability(env, candidate.routeId, candidate.providerId);
    return [
      routeProviderKey(candidate.routeId, candidate.providerId),
      isRecentProviderRouteReliability(reliability) ? reliability : null,
    ] as const;
  }));
  return buildResolvedProviderPlan(routeIds, config.routes, config.providers, new Map(qualityEntries));
}

async function loadManagedRouteSecret(env: Env, apiKeyRef: string): Promise<string | null> {
  const raw = await env.CHAT_STORE.get(routeSecretKey(apiKeyRef));
  if (!raw) return null;
  return decryptRouteSecretRecord(env, apiKeyRef, parseEncryptedRouteSecret(raw));
}

async function resolveMcpSecret(env: Env, secretRef: string): Promise<string> {
  const raw = await env.CHAT_STORE.get(managedSecretKey("mcp", secretRef));
  if (raw) return decryptManagedSecretRecord(env, "mcp", secretRef, parseEncryptedSecret(raw, "mcp"));
  return typeof env[secretRef] === "string" ? String(env[secretRef]).trim() : "";
}

async function encryptRouteSecret(env: Env, apiKeyRef: string, apiKey: string): Promise<EncryptedRouteSecret> {
  return encryptManagedSecret(env, "route", apiKeyRef, apiKey);
}

async function encryptManagedSecret(
  env: Env,
  namespace: "route" | "mcp",
  secretRef: string,
  secret: string,
): Promise<EncryptedSecret> {
  const key = await importRouteMasterKey(env);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const plaintext = new TextEncoder().encode(secret);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: managedSecretAdditionalData(namespace, secretRef),
    },
    key,
    plaintext,
  );
  return {
    version: 1,
    algorithm: "AES-GCM",
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    updatedAt: new Date().toISOString(),
  };
}

async function decryptRouteSecretRecord(
  env: Env,
  apiKeyRef: string,
  record: EncryptedRouteSecret,
): Promise<string> {
  return decryptManagedSecretRecord(env, "route", apiKeyRef, record);
}

async function decryptManagedSecretRecord(
  env: Env,
  namespace: "route" | "mcp",
  secretRef: string,
  record: EncryptedSecret,
): Promise<string> {
  const key = await importRouteMasterKey(env);
  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: base64ToBytes(record.iv),
        additionalData: managedSecretAdditionalData(namespace, secretRef),
      },
      key,
      base64ToBytes(record.ciphertext),
    );
    const secret = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(plaintext);
    if (!secret) throw new Error("empty managed secret");
    return secret;
  } catch (error) {
    if (error instanceof RouteSecretError) throw error;
    throw new RouteSecretError(
      "decrypt_failed",
      namespace === "route"
        ? "后台线路密钥无法解密；如主密钥已轮换，请重新录入该密钥"
        : "后台 MCP 密钥无法解密；如主密钥已轮换，请重新录入该密钥",
    );
  }
}

async function importRouteMasterKey(env: Env): Promise<CryptoKey> {
  const encoded = env.ROUTE_KEYS_MASTER_KEY?.trim() || "";
  if (!encoded) {
    throw new RouteSecretError(
      "master_key_unavailable",
      "未配置 ROUTE_KEYS_MASTER_KEY，暂时无法保存后台线路密钥",
    );
  }

  let raw: Uint8Array;
  try {
    raw = base64ToBytes(encoded);
  } catch {
    throw new RouteSecretError(
      "master_key_unavailable",
      "ROUTE_KEYS_MASTER_KEY 格式无效，应为 32 字节随机值的 Base64 编码",
    );
  }
  if (raw.byteLength !== 32) {
    throw new RouteSecretError(
      "master_key_unavailable",
      "ROUTE_KEYS_MASTER_KEY 长度无效，应为 32 字节随机值的 Base64 编码",
    );
  }

  try {
    return await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  } catch {
    throw new RouteSecretError("master_key_unavailable", "ROUTE_KEYS_MASTER_KEY 无法导入");
  }
}

function parseEncryptedRouteSecret(raw: string): EncryptedRouteSecret {
  return parseEncryptedSecret(raw, "route");
}

function parseEncryptedSecret(raw: string, namespace: "route" | "mcp"): EncryptedSecret {
  try {
    const parsed = JSON.parse(raw);
    if (
      !isRecord(parsed) ||
      parsed.version !== 1 ||
      parsed.algorithm !== "AES-GCM" ||
      typeof parsed.iv !== "string" ||
      typeof parsed.ciphertext !== "string" ||
      typeof parsed.updatedAt !== "string" ||
      !Number.isFinite(Date.parse(parsed.updatedAt)) ||
      base64ToBytes(parsed.iv).byteLength !== 12 ||
      base64ToBytes(parsed.ciphertext).byteLength < 16
    ) {
      throw new Error("invalid encrypted secret");
    }
    return parsed as EncryptedRouteSecret;
  } catch {
    throw new RouteSecretError(
      "invalid_record",
      namespace === "route" ? "后台线路密钥记录损坏，请删除后重新录入" : "后台 MCP 密钥记录损坏，请删除后重新录入",
    );
  }
}

function routeSecretAdditionalData(apiKeyRef: string): Uint8Array {
  return managedSecretAdditionalData("route", apiKeyRef);
}

function routeSecretKey(apiKeyRef: string): string {
  return managedSecretKey("route", apiKeyRef);
}

function managedSecretAdditionalData(namespace: "route" | "mcp", secretRef: string): Uint8Array {
  const prefix = namespace === "route" ? ROUTE_SECRET_AAD_PREFIX : MCP_SECRET_AAD_PREFIX;
  return new TextEncoder().encode(`${prefix}${secretRef}`);
}

function managedSecretKey(namespace: "route" | "mcp", secretRef: string): string {
  const prefix = namespace === "route" ? ROUTE_SECRET_PREFIX : MCP_SECRET_PREFIX;
  return `${prefix}${encodeURIComponent(secretRef)}`;
}

function base64ToBytes(value: string): Uint8Array {
  if (!value || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error("invalid base64");
  }
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function bytesToBase64(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function buildMessagesWithSystem(
  env: Env,
  session: Session,
  normalized: ChatMessage[],
  sessionSummary = "",
  userConfig?: UserConfig,
  selectedSkills: Array<{ id: string; skill: SkillConfig }> = [],
  longTermMemory?: string,
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

  return [...systemMessages, ...normalized];
}

type PreparedProviderRoute = ResolvedProviderRoute & {
  credential: ProviderCredential;
  publicRoute: PublicRoute;
  planIndex: number;
};

async function prepareProviderPlan(
  env: Env,
  access: RouteAccess,
  providerPlan: ResolvedProviderRoute[],
  userApiKey: string,
): Promise<{
  candidates: PreparedProviderRoute[];
  lastError: { routeId: string; message: string } | null;
  userKeyRequiredRouteId?: string;
}> {
  const candidates: PreparedProviderRoute[] = [];
  let lastError: { routeId: string; message: string } | null = null;

  for (const [planIndex, route] of providerPlan.entries()) {
    const publicRoute = access.routes.find((item) => item.id === route.routeId);
    if (!publicRoute) continue;
    let credential: ProviderCredential;
    try {
      credential = await resolveRouteCredential(route, env, publicRoute.allowUserKey ? userApiKey : "");
    } catch (error) {
      lastError = {
        routeId: route.routeId,
        message: error instanceof RouteSecretError ? error.message : "route key is unavailable",
      };
      continue;
    }
    if (!credential.apiKey) {
      if (publicRoute.requiresUserKey) {
        return { candidates, lastError, userKeyRequiredRouteId: route.routeId };
      }
      lastError = { routeId: route.routeId, message: "route key is not configured" };
      continue;
    }
    candidates.push({ ...route, credential, publicRoute, planIndex });
  }

  return { candidates, lastError };
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
    const limitResult = await consumeLimits(env, session, access.user);
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
  const providerPlan = await buildRuntimeProviderPlan(env, config, routeIds);
  const userApiKey = args.userApiKey?.trim() || "";
  const prepared = await prepareProviderPlan(env, access, providerPlan, userApiKey);
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
}): Promise<string> {
  const { route, apiKey, messages, temperature, maxTokens, env } = args;
  try {
    const result = await generateText({
      model: createProviderLanguageModel(route, apiKey),
      messages: toProviderModelMessages(messages),
      temperature: clampNumber(temperature, 0, route.type === "anthropic-messages" ? 1 : 2, 0.2),
      maxOutputTokens: maxTokens || route.maxTokens || numberEnv(env.DEFAULT_MAX_TOKENS, 4096),
      maxRetries: 0,
      allowSystemInMessages: true,
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
  const response =
    route.type === "anthropic-messages"
      ? await callAnthropicMessages(args)
      : await callOpenAiChat(args);

  if (response.ok && response.body) {
    const normalizedBody =
      route.type === "anthropic-messages" ? transformAnthropicStream(response.body) : response.body;
    const preparedStream = await prepareValidatedOpenAiSseStream(normalizedBody);
    const headers = securityHeaders({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    return {
      response: new Response(preparedStream.body, { status: 200, headers }),
      cancelUpstream: preparedStream.cancel,
      error: { routeId, status: 0, message: "" },
      terminal: false,
    };
  }

  const message = await response.text().catch(() => "");
  const terminal = isTerminalProviderFailure(response.status, usedUserKey);
  return {
    error: {
      routeId,
      status: response.status,
      message: formatUpstreamErrorMessage(message),
    },
    terminal,
  };
}

type ProviderStreamLifecycle = {
  onComplete: () => Promise<void>;
  onError: (error: unknown) => Promise<void>;
};

class OpenAiSseValidator {
  private readonly decoder = new TextDecoder();
  private buffer = "";
  private visibleContent = false;
  private terminal = false;

  get hasVisibleContent(): boolean {
    return this.visibleContent;
  }

  get isTerminal(): boolean {
    return this.terminal;
  }

  push(chunk: Uint8Array): void {
    this.buffer += this.decoder.decode(chunk, { stream: true });
    this.consumeFrames();
  }

  finish(): void {
    this.buffer += this.decoder.decode();
    this.consumeFrames();
    if (this.buffer.trim()) {
      throw protocolStreamError("upstream returned an incomplete SSE event");
    }
    if (!this.visibleContent) {
      throw protocolStreamError("upstream stream ended before visible content");
    }
  }

  private consumeFrames(): void {
    while (true) {
      const separator = /\r?\n\r?\n/.exec(this.buffer);
      if (!separator) return;
      const frame = this.buffer.slice(0, separator.index);
      this.buffer = this.buffer.slice(separator.index + separator[0].length);
      const kind = inspectOpenAiSseFrame(frame);
      if (kind === "content") this.visibleContent = true;
      if (kind === "done") {
        if (!this.visibleContent) {
          throw protocolStreamError("upstream stream ended before visible content");
        }
        this.terminal = true;
        return;
      }
    }
  }
}

async function prepareValidatedOpenAiSseStream(
  source: ReadableStream<Uint8Array>,
): Promise<{
  body: ReadableStream<Uint8Array>;
  cancel: (reason?: unknown) => Promise<void>;
}> {
  const reader = source.getReader();
  const validator = new OpenAiSseValidator();
  const prefix: Uint8Array[] = [];
  let prefixBytes = 0;
  let cancelled = false;
  const cancel = async (reason?: unknown) => {
    if (cancelled) return;
    cancelled = true;
    await reader.cancel(reason).catch(() => undefined);
  };

  try {
    while (!validator.hasVisibleContent) {
      const next = await reader.read();
      if (next.done) {
        validator.finish();
        break;
      }
      if (!next.value.byteLength) continue;
      prefixBytes += next.value.byteLength;
      if (prefixBytes > MAX_SSE_PREFLIGHT_BYTES) {
        throw protocolStreamError("upstream produced too much metadata before visible content");
      }
      prefix.push(next.value);
      validator.push(next.value);
    }
  } catch (error) {
    await cancel();
    throw error;
  }

  let prefixIndex = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (prefixIndex < prefix.length) {
        controller.enqueue(prefix[prefixIndex]);
        prefixIndex += 1;
        return;
      }
      if (validator.isTerminal) {
        await cancel();
        controller.close();
        return;
      }
      try {
        const next = await reader.read();
        if (next.done) {
          validator.finish();
          controller.close();
          return;
        }
        if (!next.value.byteLength) return;
        validator.push(next.value);
        controller.enqueue(next.value);
      } catch (error) {
        await cancel();
        controller.error(error);
      }
    },
    async cancel(reason) {
      await cancel(reason);
    },
  }, { highWaterMark: 0 });
  return { body, cancel };
}

function inspectOpenAiSseFrame(frame: string): "ignore" | "content" | "done" {
  const dataLines = frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).replace(/^ /, ""));
  if (!dataLines.length) return "ignore";
  const payload = dataLines.join("\n").trim();
  if (!payload) return "ignore";
  if (payload === "[DONE]") return "done";

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw protocolStreamError("upstream returned an invalid SSE event");
  }
  if (!isRecord(parsed)) {
    throw protocolStreamError("upstream returned an invalid SSE payload");
  }
  if (Object.prototype.hasOwnProperty.call(parsed, "error") && parsed.error !== undefined) {
    throw protocolStreamError("upstream returned an error event");
  }
  if (!Array.isArray(parsed.choices) || !parsed.choices.length || !isRecord(parsed.choices[0])) {
    return "ignore";
  }
  const choice = parsed.choices[0];
  const delta = isRecord(choice.delta) ? choice.delta : {};
  const message = isRecord(choice.message) ? choice.message : {};
  const text = typeof delta.content === "string"
    ? delta.content
    : typeof message.content === "string"
      ? message.content
      : typeof choice.text === "string"
        ? choice.text
        : "";
  return text ? "content" : "ignore";
}

function protocolStreamError(message: string): UpstreamRequestError {
  return new UpstreamRequestError(502, message, "protocol_error");
}

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

type ToolProviderHistory =
  | { type: "openai-chat"; messages: unknown[] }
  | { type: "anthropic-messages"; system: string; messages: unknown[] };

type ToolExecutionResult = {
  providerCallId: string;
  text: string;
  isError: boolean;
};

type ActiveMcpSession = {
  client: Client;
  transport: StreamableHTTPClientTransport;
  tools: Map<string, { schemaFingerprint: string; taskSupport: string }>;
};

class ProviderToolError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly terminal: boolean,
  ) {
    super(message);
    this.name = "ProviderToolError";
  }
}

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
  const mcpSessions = new Map<string, ActiveMcpSession>();
  try {
    await runCapabilityLoopInner(args, runId, emit, signal, mcpSessions, requestApproval);
  } finally {
    await Promise.all([...mcpSessions.values()].map((session) => closeMcpSession(session)));
  }
}

async function runCapabilityLoopInner(
  args: CapabilityChatArgs,
  runId: string,
  emit: (event: CapabilityStreamEvent) => void,
  signal: AbortSignal,
  mcpSessions: Map<string, ActiveMcpSession>,
  requestApproval?: (
    definition: NormalizedToolDefinition,
    event: ToolEventSummary,
  ) => ToolApprovalDecision | Promise<ToolApprovalDecision>,
): Promise<void> {
  const aliasMap = new Map(args.tools.map((tool) => [tool.providerName, tool]));
  const providerPlan = (await buildRuntimeProviderPlan(args.env, args.config, args.routeIds))
    .filter((route) => route.supportsTools);
  let selected:
    | {
        routeId: string;
        route: ResolvedProviderRoute;
        lease: ProviderLease;
        history: ToolProviderHistory;
        turn: ModelTurn;
        fallback: boolean;
        startedAt: number;
        apiKey: string;
        usedUserKey: boolean;
      }
    | null = null;
  let attemptedRoutes = 0;
  let lastError: ProviderToolError | null = null;
  const prepared = await prepareProviderPlan(args.env, args.access, providerPlan, args.userApiKey);
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
    const history = createToolProviderHistory(route, args.messages);
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
        env: args.env,
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
    const results: ToolExecutionResult[] = [];
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
      const result = await executeCapabilityTool(definition, call.arguments, args.env, signal, mcpSessions);
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
        env: args.env,
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

function createToolProviderHistory(route: ResolvedProviderRoute, messages: ChatMessage[]): ToolProviderHistory {
  if (route.type === "anthropic-messages") {
    const anthropic = toAnthropicMessages(messages);
    return { type: route.type, system: anthropic.system, messages: anthropic.messages };
  }
  return { type: route.type, messages: messages.map((message) => ({ role: message.role, content: message.content })) };
}

async function callProviderToolTurn(args: {
  route: ResolvedProviderRoute;
  apiKey: string;
  history: ToolProviderHistory;
  tools: NormalizedToolDefinition[];
  temperature: unknown;
  env: Env;
  signal: AbortSignal;
  usedUserKey: boolean;
}): Promise<ModelTurn> {
  const response = args.route.type === "anthropic-messages"
    ? await callAnthropicToolTurn(args)
    : await callOpenAiToolTurn(args);
  const text = await response.text();
  if (!response.ok) {
    const terminal = isTerminalProviderFailure(response.status, args.usedUserKey);
    throw new ProviderToolError(response.status, formatUpstreamErrorMessage(text), terminal);
  }
  try {
    const payload = JSON.parse(text) as unknown;
    return args.route.type === "anthropic-messages"
      ? parseAnthropicToolTurn(payload, args.tools)
      : parseOpenAiToolTurn(payload, args.tools);
  } catch (error) {
    if (error instanceof CapabilityError) throw error;
    throw new ProviderToolError(502, "上游返回了无法识别的工具响应", false);
  }
}

async function callOpenAiToolTurn(args: {
  route: ResolvedProviderRoute;
  apiKey: string;
  history: ToolProviderHistory;
  tools: NormalizedToolDefinition[];
  temperature: unknown;
  signal: AbortSignal;
}): Promise<Response> {
  if (args.history.type !== "openai-chat") throw new CapabilityError("provider_protocol_error", "Provider history mismatch");
  const headers = buildHeaders(args.route.headers);
  setAuthHeader(headers, args.route, args.apiKey, "Authorization");
  headers.set("Content-Type", "application/json");
  headers.set("Accept", "application/json");
  return fetch(args.route.directEndpoint ? args.route.baseUrl : routeUrl(args.route, "/chat/completions"), {
    method: "POST",
    headers,
    signal: args.signal,
    body: JSON.stringify({
      model: args.route.model,
      messages: args.history.messages,
      tools: args.tools.map((tool) => ({
        type: "function",
        function: {
          name: tool.providerName,
          description: tool.description,
          parameters: tool.inputSchema,
        },
      })),
      tool_choice: "auto",
      stream: false,
      temperature: clampNumber(args.temperature, 0, 2, args.route.temperature ?? 0.7),
      ...(args.route.maxTokens ? { max_tokens: args.route.maxTokens } : {}),
    }),
  });
}

async function callAnthropicToolTurn(args: {
  route: ResolvedProviderRoute;
  apiKey: string;
  history: ToolProviderHistory;
  tools: NormalizedToolDefinition[];
  temperature: unknown;
  env: Env;
  signal: AbortSignal;
}): Promise<Response> {
  if (args.history.type !== "anthropic-messages") throw new CapabilityError("provider_protocol_error", "Provider history mismatch");
  const headers = buildHeaders(args.route.headers);
  setAuthHeader(headers, args.route, args.apiKey, "x-api-key");
  headers.set("Content-Type", "application/json");
  headers.set("Accept", "application/json");
  if (!headers.has("anthropic-version")) headers.set("anthropic-version", DEFAULT_ANTHROPIC_VERSION);
  return fetch(args.route.directEndpoint ? args.route.baseUrl : routeUrl(args.route, "/v1/messages"), {
    method: "POST",
    headers,
    signal: args.signal,
    body: JSON.stringify({
      model: args.route.model,
      messages: args.history.messages,
      tools: args.tools.map((tool) => ({
        name: tool.providerName,
        description: tool.description,
        input_schema: tool.inputSchema,
      })),
      stream: false,
      max_tokens: args.route.maxTokens || numberEnv(args.env.DEFAULT_MAX_TOKENS, 4096),
      temperature: clampNumber(args.temperature, 0, 1, args.route.temperature ?? 0.7),
      ...(args.history.system ? { system: args.history.system } : {}),
    }),
  });
}

function parseOpenAiToolTurn(value: unknown, tools: NormalizedToolDefinition[]): ModelTurn {
  if (!isRecord(value) || !Array.isArray(value.choices) || !isRecord(value.choices[0])) {
    throw new CapabilityError("provider_protocol_error", "OpenAI-compatible 响应缺少 choices");
  }
  const choice = value.choices[0];
  if (!isRecord(choice.message)) throw new CapabilityError("provider_protocol_error", "OpenAI-compatible 响应缺少 message");
  const message = choice.message;
  const text = typeof message.content === "string" ? message.content : "";
  const aliasMap = new Map(tools.map((tool) => [tool.providerName, tool.id]));
  const toolCalls: NormalizedToolCall[] = [];
  if (Array.isArray(message.tool_calls)) {
    for (const rawCall of message.tool_calls) {
      if (!isRecord(rawCall) || !isRecord(rawCall.function)) {
        throw new CapabilityError("provider_protocol_error", "OpenAI-compatible tool_call 格式无效");
      }
      const providerCallId = typeof rawCall.id === "string" ? rawCall.id : "";
      const providerName = typeof rawCall.function.name === "string" ? rawCall.function.name : "";
      const rawArguments = typeof rawCall.function.arguments === "string" ? rawCall.function.arguments : "";
      if (!providerCallId || !providerName || !aliasMap.has(providerName)) {
        throw new CapabilityError("tool_not_allowed", "模型请求了未授权的工具");
      }
      let parsedArguments: unknown;
      let argumentsValid = true;
      try {
        parsedArguments = JSON.parse(rawArguments);
      } catch {
        parsedArguments = null;
        argumentsValid = false;
      }
      toolCalls.push({
        providerCallId,
        providerName,
        toolId: aliasMap.get(providerName) || "",
        arguments: parsedArguments,
        argumentsValid,
      });
    }
  }
  return {
    text,
    toolCalls,
    finishReason: typeof choice.finish_reason === "string" ? choice.finish_reason : "",
    providerTurn: {
      role: "assistant",
      content: text || null,
      ...(Array.isArray(message.tool_calls) ? { tool_calls: message.tool_calls } : {}),
    },
  };
}

function parseAnthropicToolTurn(value: unknown, tools: NormalizedToolDefinition[]): ModelTurn {
  if (!isRecord(value) || !Array.isArray(value.content)) {
    throw new CapabilityError("provider_protocol_error", "Anthropic 响应缺少 content");
  }
  const aliasMap = new Map(tools.map((tool) => [tool.providerName, tool.id]));
  const textParts: string[] = [];
  const toolCalls: NormalizedToolCall[] = [];
  const providerContent: unknown[] = [];
  for (const block of value.content) {
    if (!isRecord(block) || typeof block.type !== "string") {
      throw new CapabilityError("provider_protocol_error", "Anthropic content block 格式无效");
    }
    if (block.type === "text" && typeof block.text === "string") {
      textParts.push(block.text);
      providerContent.push({ type: "text", text: block.text });
      continue;
    }
    if (block.type === "tool_use") {
      const providerCallId = typeof block.id === "string" ? block.id : "";
      const providerName = typeof block.name === "string" ? block.name : "";
      if (!providerCallId || !providerName || !aliasMap.has(providerName)) {
        throw new CapabilityError("tool_not_allowed", "模型请求了未授权的工具");
      }
      toolCalls.push({
        providerCallId,
        providerName,
        toolId: aliasMap.get(providerName) || "",
        arguments: block.input,
        argumentsValid: true,
      });
      providerContent.push({ type: "tool_use", id: providerCallId, name: providerName, input: block.input });
      continue;
    }
    throw new CapabilityError("provider_protocol_error", `Anthropic 返回了不支持的 ${block.type} 内容块`);
  }
  return {
    text: textParts.join(""),
    toolCalls,
    finishReason: typeof value.stop_reason === "string" ? value.stop_reason : "",
    providerTurn: { role: "assistant", content: providerContent },
  };
}

function appendProviderTurn(history: ToolProviderHistory, providerTurn: unknown): void {
  history.messages.push(providerTurn);
}

function appendProviderToolResults(history: ToolProviderHistory, results: ToolExecutionResult[]): void {
  if (history.type === "openai-chat") {
    for (const result of results) {
      history.messages.push({ role: "tool", tool_call_id: result.providerCallId, content: result.text });
    }
    return;
  }
  history.messages.push({
    role: "user",
    content: results.map((result) => ({
      type: "tool_result",
      tool_use_id: result.providerCallId,
      content: result.text,
      ...(result.isError ? { is_error: true } : {}),
    })),
  });
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

async function openMcpSession(
  serverId: string,
  server: McpServerConfig,
  env: Env,
  signal: AbortSignal,
): Promise<ActiveMcpSession> {
  let endpoint: URL;
  try {
    endpoint = new URL(server.endpoint);
  } catch {
    throw new CapabilityError("mcp_endpoint_invalid", `MCP 服务 ${serverId} 的地址无效`);
  }
  if (!isValidMcpEndpoint(server.endpoint) || isForbiddenMcpUrl(endpoint)) {
    throw new CapabilityError("mcp_endpoint_invalid", `MCP 服务 ${serverId} 的地址不允许访问`);
  }
  const headers = new Headers();
  if (server.authType !== "none") {
    const secretRef = server.secretRef || "";
    if (!secretRef) throw new CapabilityError("mcp_auth_unavailable", `MCP 服务 ${serverId} 缺少 Secret Ref`);
    const secret = await resolveMcpSecret(env, secretRef);
    if (!secret) throw new CapabilityError("mcp_auth_unavailable", `MCP 服务 ${serverId} 的认证密钥不可用`);
    if (server.authType === "bearer") headers.set("Authorization", `Bearer ${secret}`);
    else headers.set("X-API-Key", secret);
  }
  const transport = new StreamableHTTPClientTransport(endpoint, {
    requestInit: { headers },
    fetch: createMcpFetch(endpoint),
    reconnectionOptions: {
      maxReconnectionDelay: 1_000,
      initialReconnectionDelay: 250,
      reconnectionDelayGrowFactor: 1,
      maxRetries: 0,
    },
  });
  const client = new Client(
    { name: "chatus", version: "0.1.0" },
    { jsonSchemaValidator: TOOL_SCHEMA_VALIDATOR },
  );
  try {
    await client.connect(transport, {
      signal,
      timeout: TOOL_CALL_TIMEOUT_MS,
      maxTotalTimeout: TOOL_CALL_TIMEOUT_MS,
    });
    return { client, transport, tools: new Map() };
  } catch (error) {
    await transport.close().catch(() => undefined);
    if (error instanceof CapabilityError) throw error;
    throw new CapabilityError("mcp_protocol_error", `无法连接 MCP 服务 ${serverId}`, true);
  }
}

function createMcpFetch(endpoint: URL): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  const endpointOrigin = endpoint.origin;
  return async (input, init = {}) => {
    const requestUrl = input instanceof URL
      ? input
      : typeof input === "string"
        ? new URL(input)
        : new URL(input.url);
    if (requestUrl.origin !== endpointOrigin || !isValidMcpEndpoint(requestUrl.toString()) || isForbiddenMcpUrl(requestUrl)) {
      throw new CapabilityError("mcp_endpoint_invalid", "MCP 请求试图访问未授权的地址");
    }
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    const response = await fetch(requestUrl, { ...init, headers, redirect: "manual" });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel().catch(() => undefined);
      throw new CapabilityError("mcp_redirect_rejected", "MCP 服务返回了不允许的重定向");
    }
    const length = Number(response.headers.get("Content-Length") || "0");
    if (length > 256 * 1024) {
      await response.body?.cancel().catch(() => undefined);
      throw new CapabilityError("mcp_protocol_error", "MCP 响应超过协议大小限制");
    }
    if (!response.body) return response;
    const boundedBody = createBoundedReadableStream(response.body, 256 * 1024);
    return new Response(boundedBody, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}

function createBoundedReadableStream(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let total = 0;
  return new ReadableStream({
    async pull(controller) {
      const { value, done } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        controller.error(new CapabilityError("mcp_protocol_error", "MCP 响应超过协议大小限制"));
        return;
      }
      controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

function isForbiddenMcpUrl(url: URL): boolean {
  if (url.protocol !== "https:" || url.username || url.password || url.hash) return true;
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost")) return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return isForbiddenIpv4(hostname);
  if (hostname.includes(":")) return isForbiddenIpv6(hostname);
  return false;
}

function isForbiddenIpv4(hostname: string): boolean {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0) || a >= 224;
}

function isForbiddenIpv6(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb") ||
    normalized.startsWith("ff") || normalized.startsWith("2001:db8:")) return true;
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? isForbiddenIpv4(mapped[1]) : false;
}

async function executeMcpTool(
  definition: NormalizedToolDefinition,
  value: unknown,
  env: Env,
  signal: AbortSignal,
  sessions: Map<string, ActiveMcpSession>,
): Promise<unknown> {
  const executor = definition.config.executor;
  if (executor.type !== "mcp") throw new CapabilityError("tool_execution_failed", "工具执行器类型无效");
  if (!isRecord(value)) throw new CapabilityError("tool_arguments_invalid", "MCP 工具参数必须是对象");
  const config = await loadAppConfig(env);
  const server = config.mcpServers?.[executor.serverId];
  if (!server || server.enabled !== true) throw new CapabilityError("tool_not_found", "MCP 服务未启用");
  let session = sessions.get(executor.serverId);
  if (!session) {
    session = await openMcpSession(executor.serverId, server, env, signal);
    try {
      await loadRuntimeMcpTools(session, signal);
    } catch (error) {
      await closeMcpSession(session);
      throw error;
    }
    sessions.set(executor.serverId, session);
  }
  const remote = session.tools.get(executor.remoteName);
  if (!remote) throw new CapabilityError("mcp_tool_changed", "MCP 工具已不存在，请管理员重新发现");
  if (!definition.config.schemaFingerprint || remote.schemaFingerprint !== definition.config.schemaFingerprint) {
    throw new CapabilityError("mcp_tool_changed", "MCP 工具 Schema 已变化，请管理员重新发现并启用");
  }
  if (remote.taskSupport === "required") {
    throw new CapabilityError("mcp_tool_unsupported", "首版不支持必须使用 Task 的 MCP 工具");
  }
  let result: unknown;
  try {
    result = await session.client.callTool(
      { name: executor.remoteName, arguments: value },
      undefined,
      { signal, timeout: TOOL_CALL_TIMEOUT_MS, maxTotalTimeout: TOOL_CALL_TIMEOUT_MS },
    );
  } catch {
    throw new CapabilityError("tool_execution_failed", `MCP 工具 ${definition.label} 执行失败`, true);
  }
  return normalizeMcpToolResult(result);
}

async function loadRuntimeMcpTools(session: ActiveMcpSession, signal: AbortSignal): Promise<void> {
  let cursor: string | undefined;
  for (let page = 0; page < 10; page += 1) {
    const result = await session.client.listTools(cursor ? { cursor } : undefined, {
      signal,
      timeout: TOOL_CALL_TIMEOUT_MS,
      maxTotalTimeout: TOOL_CALL_TIMEOUT_MS,
    });
    for (const tool of result.tools) {
      const inputSchema = normalizeJsonRecord(tool.inputSchema, MAX_TOOL_SCHEMA_CHARS);
      if (!inputSchema || !MCP_REMOTE_NAME_PATTERN.test(tool.name)) continue;
      session.tools.set(tool.name, {
        schemaFingerprint: await jsonFingerprint(inputSchema),
        taskSupport: tool.execution?.taskSupport || "forbidden",
      });
      if (session.tools.size > MAX_TOOLS) throw new CapabilityError("mcp_protocol_error", "MCP 工具数量超过限制");
    }
    cursor = result.nextCursor;
    if (!cursor) return;
  }
  throw new CapabilityError("mcp_protocol_error", "MCP 工具列表分页超过限制");
}

function normalizeMcpToolResult(value: unknown): unknown {
  if (!isRecord(value) || "toolResult" in value || !Array.isArray(value.content)) {
    throw new CapabilityError("mcp_protocol_error", "MCP 工具返回了不支持的结果格式");
  }
  if (value.isError === true) throw new CapabilityError("tool_execution_failed", "MCP 工具报告执行失败");
  const text: string[] = [];
  for (const block of value.content) {
    if (!isRecord(block) || block.type !== "text" || typeof block.text !== "string") {
      throw new CapabilityError("mcp_tool_unsupported", "MCP 工具返回了首版不支持的非文本内容");
    }
    text.push(block.text);
  }
  const structuredContent = isRecord(value.structuredContent) ? value.structuredContent : undefined;
  if (structuredContent && text.length) return { structuredContent, content: text.join("\n") };
  if (structuredContent) return structuredContent;
  return { content: text.join("\n") };
}

async function closeMcpSession(session: ActiveMcpSession): Promise<void> {
  await session.transport.terminateSession().catch(() => undefined);
  await session.client.close().catch(() => undefined);
}

async function jsonFingerprint(value: unknown): Promise<string> {
  return secretFingerprint(stableJsonStringify(value));
}

function stableJsonStringify(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize);
    if (isRecord(item)) {
      return Object.fromEntries(Object.keys(item).sort().map((key) => [key, normalize(item[key])]));
    }
    return item;
  };
  return JSON.stringify(normalize(value));
}

function createAgentCapabilityRuntime(
  definitions: NormalizedToolDefinition[],
  env: Env,
): { runTool: CapabilityToolRunner; close: () => Promise<void> } {
  const allowed = new Map(definitions.map((definition) => [definition.id, definition]));
  const mcpSessions = new Map<string, ActiveMcpSession>();
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
        mcpSessions,
        Math.min(TOOL_CALL_TIMEOUT_MS, remainingBudgetMs),
      );
    } finally {
      elapsedMs += Date.now() - startedAt;
    }
  };

  const close = async () => {
    if (closed) return;
    closed = true;
    const sessions = [...mcpSessions.values()];
    mcpSessions.clear();
    await Promise.all(sessions.map((session) => closeMcpSession(session)));
  };

  return { runTool, close };
}

async function executeCapabilityTool(
  definition: NormalizedToolDefinition,
  value: unknown,
  env: Env,
  signal: AbortSignal,
  mcpSessions: Map<string, ActiveMcpSession>,
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
      result = await executeMcpTool(definition, value, env, callController.signal, mcpSessions);
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
  if (error instanceof DOMException && error.name === "AbortError") {
    return new CapabilityError("request_cancelled", "请求已取消", true);
  }
  return new CapabilityError("tool_execution_failed", error instanceof Error ? error.message : "工具执行失败", true);
}

function formatUpstreamErrorMessage(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return "upstream returned an empty error";

  try {
    const parsed = JSON.parse(trimmed);
    const message = findErrorMessage(parsed);
    return message || trimmed.slice(0, 500);
  } catch {
    return trimmed.slice(0, 500);
  }
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

function findErrorMessage(value: unknown): string {
  if (!isRecord(value)) return "";
  if (typeof value.message === "string") return value.message;
  if (isRecord(value.error)) return findErrorMessage(value.error);
  return "";
}

async function callOpenAiChat(args: {
  route: ResolvedProviderRoute;
  apiKey: string;
  messages: ChatMessage[];
  temperature: unknown;
  signal?: AbortSignal;
}): Promise<Response> {
  const { route, apiKey, messages, temperature } = args;
  const headers = buildHeaders(route.headers);
  setAuthHeader(headers, route, apiKey, "Authorization");
  headers.set("Content-Type", "application/json");
  headers.set("Accept", "text/event-stream");

  return fetch(routeUrl(route, "/chat/completions"), {
    method: "POST",
    headers,
    signal: args.signal,
    body: JSON.stringify({
      model: route.model,
      messages,
      stream: true,
      temperature: clampNumber(temperature, 0, 2, route.temperature ?? 0.7),
      ...(route.maxTokens ? { max_tokens: route.maxTokens } : {}),
    }),
  });
}

async function callAnthropicMessages(args: {
  route: ResolvedProviderRoute;
  apiKey: string;
  messages: ChatMessage[];
  temperature: unknown;
  env: Env;
  signal?: AbortSignal;
}): Promise<Response> {
  const { route, apiKey, messages, temperature, env } = args;
  const headers = buildHeaders(route.headers);
  setAuthHeader(headers, route, apiKey, "x-api-key");
  headers.set("Content-Type", "application/json");
  headers.set("Accept", "text/event-stream");
  if (!headers.has("anthropic-version")) {
    headers.set("anthropic-version", DEFAULT_ANTHROPIC_VERSION);
  }

  const anthropic = toAnthropicMessages(messages);

  return fetch(routeUrl(route, "/v1/messages"), {
    method: "POST",
    headers,
    signal: args.signal,
    body: JSON.stringify({
      model: route.model,
      messages: anthropic.messages,
      stream: true,
      max_tokens: route.maxTokens || numberEnv(env.DEFAULT_MAX_TOKENS, 4096),
      temperature: clampNumber(temperature, 0, 1, route.temperature ?? 0.7),
      ...(anthropic.system ? { system: anthropic.system } : {}),
    }),
  });
}

function toAnthropicMessages(messages: ChatMessage[]): {
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string | AnthropicContentBlock[] }>;
} {
  const system: string[] = [];
  const converted: Array<{ role: "user" | "assistant"; content: string | AnthropicContentBlock[] }> = [];

  for (const message of messages) {
    if (message.role === "system") {
      system.push(extractText(message.content));
      continue;
    }

    if (typeof message.content === "string") {
      converted.push({ role: message.role, content: message.content });
      continue;
    }

    const content: AnthropicContentBlock[] = [];
    for (const part of message.content) {
      if (part.type === "text") {
        content.push({ type: "text", text: part.text });
        continue;
      }

      const dataImage = parseDataImage(part.image_url.url);
      if (!dataImage.ok) throw new Error(dataImage.error);
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: dataImage.image.mediaType,
          data: dataImage.image.data,
        },
      });
    }

    converted.push({ role: message.role, content: content.length ? content : "" });
  }

  return {
    system: system.filter(Boolean).join("\n\n"),
    messages: converted,
  };
}

function transformAnthropicStream(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let eventName = "";
  let doneSent = false;

  return new ReadableStream({
    async pull(controller) {
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          if (buffer.trim()) {
            throw protocolStreamError("upstream returned an incomplete Anthropic SSE event");
          }
          controller.close();
          return;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("event:")) {
            eventName = line.slice(6).trim();
            continue;
          }

          if (!line.startsWith("data:")) {
            if (!line.trim()) eventName = "";
            continue;
          }

          const payload = line.slice(5).trim();
          if (!payload) continue;

          const chunk = anthropicPayloadToOpenAiChunk(payload, eventName);
          if (chunk) {
            if (chunk === "data: [DONE]\n\n") {
              if (!doneSent) {
                controller.enqueue(encoder.encode(chunk));
                doneSent = true;
              }
              controller.close();
              await reader.cancel().catch(() => undefined);
              return;
            }

            controller.enqueue(encoder.encode(chunk));
            return;
          }
        }
      }
    },
    cancel() {
      return reader.cancel();
    },
  });
}

function anthropicPayloadToOpenAiChunk(payload: string, eventName: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw protocolStreamError("upstream returned an invalid Anthropic SSE event");
  }
  if (!isRecord(parsed)) {
    throw protocolStreamError("upstream returned an invalid Anthropic SSE payload");
  }

  if (parsed.type === "content_block_delta" && isRecord(parsed.delta)) {
    if (parsed.delta.type === "text_delta" && typeof parsed.delta.text === "string") {
      return openAiSseChunk(parsed.delta.text);
    }

    return "";
  }

  if (parsed.type === "error" || eventName === "error") {
    throw protocolStreamError("upstream returned an Anthropic error event");
  }

  if (parsed.type === "message_delta" && isRecord(parsed.delta) && typeof parsed.delta.stop_reason === "string") {
    return openAiFinishChunk(parsed.delta.stop_reason === "max_tokens" ? "length" : parsed.delta.stop_reason);
  }

  if (parsed.type === "message_stop" || eventName === "message_stop") {
    return "data: [DONE]\n\n";
  }

  return "";
}

function openAiSseChunk(text: string): string {
  return `data: ${JSON.stringify({
    choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
  })}\n\n`;
}

function openAiFinishChunk(finishReason: string): string {
  return `data: ${JSON.stringify({
    choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
  })}\n\n`;
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

async function cleanupGuestData(env: Env, label: string): Promise<void> {
  await Promise.allSettled([
    getUserState(env, label).purgeUserData(),
    purgeAgentUserData(env, label),
  ]);
}

async function cleanupGuestSessionData(env: Env, session: GuestSession): Promise<void> {
  await Promise.allSettled([
    cleanupGuestData(env, session.label),
    env.CHAT_STORE.delete(guestCleanupKey(session)),
  ]);
}

async function scheduleGuestCleanup(env: Env, session: GuestSession): Promise<void> {
  const ttl = Math.max(
    60,
    Math.ceil((session.expiresAt - Date.now()) / 1_000) + GUEST_CLEANUP_RETENTION_SECONDS,
  );
  await env.CHAT_STORE.put(
    guestCleanupKey(session),
    JSON.stringify({ label: session.label, expiresAt: session.expiresAt }),
    { expirationTtl: ttl },
  );
}

async function scheduleGuestCleanupDrain(
  env: Env,
  ctx: ExecutionContext | undefined,
  requestId: string,
): Promise<void> {
  const cleanup = drainExpiredGuestCleanups(env).catch((error) => {
    console.error(JSON.stringify({
      level: "warn",
      event: "guest_cleanup_failed",
      requestId,
      error: error instanceof Error ? error.name : "UnknownError",
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
    if (expiresAt !== null && expiresAt > now) break;
    const raw = await env.CHAT_STORE.get(key.name);
    const label = guestCleanupLabel(raw);
    if (label) await cleanupGuestData(env, label);
    await env.CHAT_STORE.delete(key.name);
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

async function consumeLimits(
  env: Env,
  session: Session,
  user: UserConfig,
  publicAccess?: PublicAccessConfig,
): Promise<UsageResult> {
  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  const dailyLimit = user.dailyMessageLimit || numberEnv(env.DAILY_MESSAGE_LIMIT, DEFAULT_DAILY_LIMIT);
  const minuteLimit = user.minuteMessageLimit || numberEnv(env.MINUTE_MESSAGE_LIMIT, 12);
  const legacyDayCount = positiveCount(await env.CHAT_STORE.get(usageKey(session.label, day)));
  const personalState = getUserState(env, session.label);
  const personal = await personalState.consumeLimits(dailyLimit, minuteLimit, now, legacyDayCount);
  if (!personal.ok || session.kind === "member") {
    return personal.ok ? personal : { ...personal, scope: "session" };
  }

  const policy = publicAccess || normalizePublicAccessConfig(undefined);
  const sourceState = getUserState(env, session.sourceKey);
  const source = await sourceState.consumeLimits(
    policy.sourceDailyMessageLimit,
    policy.sourceMinuteMessageLimit,
    now,
  );
  if (!source.ok) {
    await personalState.refundLimits(now);
    return { ...source, scope: "source" };
  }
  return personal;
}

async function admitTurn(
  env: Env,
  session: Session,
  access: RouteAccess,
  consumeQuota = true,
): Promise<TurnAdmission> {
  const now = Date.now();
  const limits = consumeQuota
    ? await consumeLimits(env, session, access.user, access.publicAccess)
    : { ok: true as const, remaining: (await getUsage(env, session, access.user)).remaining };
  if (!limits.ok) {
    return {
      ok: false,
      error: "rate_limited",
      retryAfter: limits.retryAfter,
      reset: limits.reset === "daily" ? "daily" : "minute",
      scope: limits.scope,
    };
  }
  if (session.kind === "member") return { ok: true, remaining: limits.remaining, release: async () => undefined };

  const token = randomToken();
  const state = getUserState(env, session.label);
  const lease = await state.acquireGuestTurn(token, now, GUEST_TURN_LEASE_MS);
  if (!lease.ok) {
    if (consumeQuota) await refundGuestLimits(env, session, now);
    return { ok: false, error: "concurrent_turn", retryAfter: lease.retryAfter };
  }
  let released = false;
  return {
    ok: true,
    remaining: limits.remaining,
    release: async () => {
      if (released) return;
      released = true;
      await state.releaseGuestTurn(token);
    },
  };
}

async function refundGuestLimits(env: Env, session: GuestSession, nowMs: number): Promise<void> {
  await Promise.all([
    getUserState(env, session.label).refundLimits(nowMs),
    getUserState(env, session.sourceKey).refundLimits(nowMs),
  ]);
}

async function getUsage(env: Env, session: Session, user: UserConfig) {
  const day = new Date().toISOString().slice(0, 10);
  const dailyLimit = user.dailyMessageLimit || numberEnv(env.DAILY_MESSAGE_LIMIT, DEFAULT_DAILY_LIMIT);
  const legacyUsed = positiveCount(await env.CHAT_STORE.get(usageKey(session.label, day)));
  const used = await getUserState(env, session.label).getUsage(day, legacyUsed);
  return { used, limit: dailyLimit, remaining: Math.max(0, dailyLimit - used) };
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

function buildHeaders(input?: Record<string, string>): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(input || {})) {
    headers.set(key, value);
  }
  return headers;
}

function setAuthHeader(
  headers: Headers,
  route: RouteConfig | ResolvedProviderRoute,
  apiKey: string,
  defaultHeader: string,
) {
  const header = route.authHeader || defaultHeader;
  if (headers.has(header)) return;
  const lower = header.toLowerCase();
  const prefix =
    route.authPrefix !== undefined ? route.authPrefix : lower === "authorization" ? "Bearer " : "";
  headers.set(header, `${prefix}${apiKey}`);
}

function routeUrl(route: ResolvedProviderRoute, suffix: string): string {
  const base = route.baseUrl.trim().replace(/\/+$/, "");
  return route.directEndpoint ? base : `${base}${suffix}`;
}

function normalizeStringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const output: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") output[key] = item;
  }
  return Object.keys(output).length ? output : undefined;
}

function normalizePositiveNumber(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function normalizeNonNegativeNumber(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function normalizeNumber(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function boundedInteger(value: unknown, minimum: number, maximum: number, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum
    ? value
    : fallback;
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
    const authType = rawServer.authType;
    if (authType !== "none" && authType !== "bearer" && authType !== "x-api-key") continue;
    const endpoint = normalizeBoundedText(rawServer.endpoint, 2_048);
    if (!endpoint) continue;
    const secretRef = normalizeBoundedText(rawServer.secretRef, 64);
    output[id] = {
      enabled: rawServer.enabled === true,
      label: normalizeBoundedText(rawServer.label, 80) || id,
      endpoint,
      authType,
      secretRef: secretRef && ROUTE_SECRET_REF_PATTERN.test(secretRef) ? secretRef : undefined,
    };
  }
  return output;
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
    const schema = normalizeJsonRecord(rawTool.inputSchema, MAX_TOOL_SCHEMA_CHARS);
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
    output[id] = {
      enabled: rawTool.enabled === true,
      label: normalizeBoundedText(rawTool.label, 80) || remoteToolLabel(executor),
      description: normalizeBoundedText(rawTool.description, 1_000) || undefined,
      inputSchema: schema,
      confirmation: executor.type === "builtin"
        ? confirmation === "always" ? "always" : "auto"
        : confirmation === "always" ? "always" : "first-per-conversation",
      executor,
      schemaFingerprint:
        typeof rawTool.schemaFingerprint === "string" && /^[a-f0-9]{64}$/i.test(rawTool.schemaFingerprint)
          ? rawTool.schemaFingerprint.toLowerCase()
          : undefined,
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

function normalizeJsonRecord(value: unknown, maxChars: number): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length > maxChars) return null;
    const parsed = JSON.parse(serialized);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function remoteToolLabel(executor: ToolExecutor): string {
  return executor.type === "builtin" ? "文本统计" : executor.remoteName;
}

type AdminAuditEntry = {
  id: string;
  action: string;
  target?: string;
  at: string;
};

async function loadAdminAudit(env: Env): Promise<AdminAuditEntry[]> {
  const raw = await env.CHAT_STORE.get(ADMIN_AUDIT_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is AdminAuditEntry =>
      isRecord(entry) && typeof entry.id === "string" && typeof entry.action === "string" && typeof entry.at === "string"
    ).slice(0, 100);
  } catch {
    return [];
  }
}

async function appendAdminAudit(env: Env, action: string, target?: string): Promise<void> {
  try {
    const entries = await loadAdminAudit(env);
    entries.unshift({ id: crypto.randomUUID(), action, ...(target ? { target: target.slice(0, 100) } : {}), at: new Date().toISOString() });
    await env.CHAT_STORE.put(ADMIN_AUDIT_KEY, JSON.stringify(entries.slice(0, 100)));
  } catch {
    // Audit persistence must not block the requested admin operation.
  }
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

async function accessCodesFingerprint(value: string): Promise<string> {
  return secretFingerprint(`chatus:access-codes:v1:${value.length}:${value}`);
}

function positiveCount(value: string | null): number {
  const parsed = Number(value || "0");
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
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

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
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
