import { DurableObject } from "cloudflare:workers";

type ChatRole = "system" | "user" | "assistant";

type ChatPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

type ChatMessage = {
  role: ChatRole;
  content: string | ChatPart[];
  routeId?: string;
  fallback?: boolean;
  createdAt?: number;
  rating?: "up" | "down";
};

type Session = {
  id: string;
  label: string;
  createdAt: number;
  lastSeen: number;
};

type AdminSession = {
  createdAt: number;
  lastSeen: number;
};

type AccessEntry = {
  label: string;
  code: string;
};

type ProviderType = "openai-chat" | "anthropic-messages";

type RouteConfig = {
  enabled?: boolean;
  label: string;
  type: ProviderType;
  baseUrl: string;
  model: string;
  apiKey?: string;
  apiKeyRef?: string;
  authHeader?: string;
  authPrefix?: string;
  directEndpoint?: boolean;
  headers?: Record<string, string>;
  maxTokens?: number;
  temperature?: number;
  fallbacks?: string[];
  allowUserKey?: boolean;
  requiresUserKey?: boolean;
  supportsImages?: boolean;
};

type UserConfig = {
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
  users?: Record<string, UserConfig>;
  defaults?: UserConfig;
};

type PublicRoute = {
  id: string;
  label: string;
  type: ProviderType;
  model: string;
  allowUserKey: boolean;
  requiresUserKey: boolean;
  supportsImages: boolean;
  healthStatus?: "healthy" | "unhealthy" | "unknown";
  healthCheckedAt?: string;
};

type RouteAccess = {
  routes: PublicRoute[];
  defaultRoute: string;
  user: UserConfig;
};

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

type Env = {
  ASSETS: Fetcher;
  CHAT_STORE: KVNamespace;
  USER_STATE: DurableObjectNamespace<UserState>;
  ACCESS_CODES: string;
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
  MAX_MEMORY_CHARS?: string;
  MAX_SUMMARY_CHARS?: string;
  MAX_CONTEXT_CHARS?: string;
  SESSION_TTL_SECONDS?: string;
  DEFAULT_MAX_TOKENS?: string;
  BLOCKED_PROMPTS?: string;
  ADMIN_TOKEN?: string;
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
const ADMIN_SESSION_TTL_SECONDS = 604_800;
const ADMIN_AUDIT_KEY = "config:admin_audit";
const FEEDBACK_KEY = "feedback:recent";
const MAX_FEEDBACK_ENTRIES = 100;
const DEFAULT_ANTHROPIC_VERSION = "2023-06-01";
const BLOCKED_PROMPT_MESSAGE = "不要用这种方式测活，必须使用一个小任务之类的";
const ROUTES_CONFIG_KEY = "config:routes_config";
const ACCESS_CODES_KEY = "config:access_codes";

type UsageResult =
  | { ok: true; remaining: number }
  | { ok: false; retryAfter: number; reset: "daily" | "minute" };

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
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
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
    for (const chat of chats.slice(0, MAX_CLOUD_SESSIONS)) this.writeChat(chat);
  }

  async migrateLegacyChats(chats: StoredChat[]): Promise<boolean> {
    const count = this.ctx.storage.sql.exec<{ count: number }>("SELECT COUNT(*) AS count FROM chats").one().count;
    if (count > 0) return false;
    for (const chat of chats.slice(0, MAX_CLOUD_SESSIONS)) this.writeChat(chat);
    return true;
  }

  async deleteChat(id: string): Promise<boolean> {
    const before = this.ctx.storage.sql.exec<{ count: number }>("SELECT COUNT(*) AS count FROM chats WHERE id = ?", id).one().count;
    this.ctx.storage.sql.exec("DELETE FROM chats WHERE id = ?", id);
    return before > 0;
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
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/robots.txt") {
      return textResponse("User-agent: *\nDisallow: /\n", 200, "text/plain");
    }

    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, env, url);
    }

    const assetResponse = await env.ASSETS.fetch(request);
    return withSecurityHeaders(assetResponse);
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runScheduledRouteHealthChecks(env));
  },
};

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: securityHeaders() });
  }

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

  const session = await getSession(request, env);
  if (!session) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  if (url.pathname === "/api/session" && request.method === "GET") {
    const config = await loadAppConfig(env);
    const access = getRouteAccess(config, session.label, env);
    const [usage, routes] = await Promise.all([
      getUsage(env, session, access.user),
      Promise.all(access.routes.map((route) => withPublicRouteHealth(env, route))),
    ]);
    return jsonResponse({
      authenticated: true,
      user: session.label,
      usage,
      routes,
      defaultRoute: access.defaultRoute,
      allowBringYourOwnKey: Boolean(access.user.allowBringYourOwnKey),
      hasUserSystemPrompt: Boolean(access.user.systemPrompt?.trim()),
    });
  }

  if (url.pathname === "/api/chat" && request.method === "POST") {
    return handleChat(request, env, session);
  }
  if (url.pathname === "/api/feedback" && request.method === "POST") {
    return handleFeedback(request, env, session);
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

  if (url.pathname === "/api/user-data" && request.method === "DELETE") {
    await getUserState(env, session.label).replaceChats([]);
    const feedback = await loadFeedback(env);
    await Promise.all([
      env.CHAT_STORE.delete(memoryKey(session.label)),
      env.CHAT_STORE.put(FEEDBACK_KEY, JSON.stringify(feedback.filter((entry) => entry.label !== session.label))),
    ]);
    return jsonResponse({ ok: true });
  }

  return jsonResponse({ error: "not_found" }, 404);
}

async function handleLogin(request: Request, env: Env, url: URL): Promise<Response> {
  const accessCodes = await loadAccessCodes(env);
  if (!accessCodes.trim()) {
    return jsonResponse({ error: "server_not_configured" }, 503);
  }

  const body = await readJson<{ code?: string }>(request);
  const code = body.code?.trim() || "";
  const label = await findAccessLabel(accessCodes, code);

  if (!label) {
    return jsonResponse({ error: "invalid_code" }, 401);
  }

  const now = Date.now();
  const session: Session = {
    id: crypto.randomUUID(),
    label,
    createdAt: now,
    lastSeen: now,
  };
  const token = randomToken();
  const ttl = numberEnv(env.SESSION_TTL_SECONDS, 2_592_000);

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
    await env.CHAT_STORE.delete(`session:${token}`);
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
  const expected = env.ADMIN_TOKEN?.trim() || "";
  if (!expected) {
    return jsonResponse({ error: "admin_not_configured" }, 503);
  }

  const body = await readJson<{ token?: string }>(request);
  const token = body.token?.trim() || "";
  if (!(await secureCompare(token, expected))) {
    return jsonResponse({ error: "invalid_token" }, 401);
  }

  const now = Date.now();
  const sessionToken = randomToken();
  const session: AdminSession = { createdAt: now, lastSeen: now };
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

  if (url.pathname === "/api/admin/config" && request.method === "PUT") {
    return handlePutAdminConfig(request, env);
  }

  if (url.pathname === "/api/admin/config" && request.method === "DELETE") {
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
    const revoked = await revokeSessionsByLabel(env, label);
    await appendAdminAudit(env, "sessions.revoke", label);
    return jsonResponse({ ok: true, label, revoked });
  }

  if (url.pathname === "/api/admin/route-health" && request.method === "POST") {
    return handleAdminRouteHealth(request, env);
  }

  if (url.pathname === "/api/admin/route-health" && request.method === "GET") {
    return handleGetAdminRouteHealth(env);
  }

  if (url.pathname === "/api/admin/route-models" && request.method === "POST") {
    return handleAdminRouteModels(request, env);
  }

  return jsonResponse({ error: "not_found" }, 404);
}

async function handleGetAdminConfig(env: Env): Promise<Response> {
  const { config, source } = await loadEditableConfig(env);
  return jsonResponse({ config, source });
}

async function handlePutAdminConfig(request: Request, env: Env): Promise<Response> {
  const body = await readJson<{ config?: unknown }>(request);
  const normalized = normalizeAppConfig(body.config);
  const validation = validateAppConfig(normalized);
  if (!validation.ok) {
    return jsonResponse({ error: "invalid_config", message: validation.message }, 400);
  }

  await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify(normalized));
  await appendAdminAudit(env, "config.update");
  return jsonResponse({ ok: true, config: normalized, source: "kv" });
}

async function handleGetAdminAccessCodes(env: Env): Promise<Response> {
  const { accessCodes, source } = await loadEditableAccessCodes(env);
  return jsonResponse({
    accessCodes,
    entries: parseAccessCodes(accessCodes).map(({ label }) => ({ label })),
    source,
  });
}

async function handlePutAdminAccessCodes(request: Request, env: Env): Promise<Response> {
  const body = await readJson<{ accessCodes?: unknown }>(request);
  const accessCodes = typeof body.accessCodes === "string" ? body.accessCodes.trim() : "";
  const entries = parseAccessCodes(accessCodes);
  if (!entries.length) {
    return jsonResponse({ error: "invalid_access_codes", message: "至少需要一个 label:code 访问码" }, 400);
  }

  await env.CHAT_STORE.put(ACCESS_CODES_KEY, accessCodes);
  await appendAdminAudit(env, "access.update", `${entries.length} entries`);
  return jsonResponse({ ok: true, entries: entries.map(({ label }) => ({ label })), source: "kv" });
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
      const [state, legacyUsage, memory] = await Promise.all([
        getUserState(env, label).getStats(days),
        Promise.all(days.map((dayKey) => env.CHAT_STORE.get(usageKey(label, dayKey)))),
        env.CHAT_STORE.get(memoryKey(label)),
      ]);
      stateByLabel.set(label, state);
      legacyUsageByLabel.set(
        label,
        Object.fromEntries(days.map((dayKey, index) => [dayKey, positiveCount(legacyUsage[index])])),
      );
      memoryByLabel.set(label, memory || "");
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
  const memory = (await env.CHAT_STORE.get(memoryKey(session.label))) || "";
  return jsonResponse({
    memory,
    maxChars: numberEnv(env.MAX_MEMORY_CHARS, DEFAULT_MEMORY_CHARS),
  });
}

async function handlePutMemory(request: Request, env: Env, session: Session): Promise<Response> {
  const maxChars = numberEnv(env.MAX_MEMORY_CHARS, DEFAULT_MEMORY_CHARS);
  const body = await readJson<{ memory?: unknown }>(request);
  const memory = typeof body.memory === "string" ? body.memory.trim().slice(0, maxChars) : "";

  if (memory) {
    await env.CHAT_STORE.put(memoryKey(session.label), memory);
  } else {
    await env.CHAT_STORE.delete(memoryKey(session.label));
  }

  return jsonResponse({ ok: true, memory, maxChars });
}

async function handleAdminGetMemory(request: Request, env: Env, url: URL): Promise<Response> {
  const label = (url.searchParams.get("label") || "").trim();
  if (!label) {
    return jsonResponse({ error: "label_required" }, 400);
  }
  const memory = (await env.CHAT_STORE.get(memoryKey(label))) || "";
  return jsonResponse({
    label,
    memory,
    maxChars: numberEnv(env.MAX_MEMORY_CHARS, DEFAULT_MEMORY_CHARS),
  });
}

async function handleAdminPutMemory(request: Request, env: Env): Promise<Response> {
  const maxChars = numberEnv(env.MAX_MEMORY_CHARS, DEFAULT_MEMORY_CHARS);
  const body = await readJson<{ label?: unknown; memory?: unknown }>(request);
  const label = typeof body.label === "string" ? body.label.trim() : "";
  if (!label) {
    return jsonResponse({ error: "label_required" }, 400);
  }
  const memory = typeof body.memory === "string" ? body.memory.trim().slice(0, maxChars) : "";
  if (memory) {
    await env.CHAT_STORE.put(memoryKey(label), memory);
  } else {
    await env.CHAT_STORE.delete(memoryKey(label));
  }
  await appendAdminAudit(env, memory ? "memory.update" : "memory.clear", label);
  return jsonResponse({ ok: true, label, memory, maxChars });
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

async function handleFeedback(request: Request, env: Env, session: Session): Promise<Response> {
  const body = await readJson<{ rating?: unknown; routeId?: unknown; chatId?: unknown; messageId?: unknown }>(request);
  if (body.rating !== "up" && body.rating !== "down") return jsonResponse({ error: "invalid_rating" }, 400);
  const routeId = typeof body.routeId === "string" ? body.routeId.trim().slice(0, 100) : "";
  const chatId = typeof body.chatId === "string" ? body.chatId.trim().slice(0, 100) : "";
  const messageId = typeof body.messageId === "string" ? body.messageId.trim().slice(0, 100) : "";
  if (!routeId || !chatId || !messageId) return jsonResponse({ error: "feedback_metadata_required" }, 400);
  const config = await loadAppConfig(env);
  if (!config.routes[routeId]) return jsonResponse({ error: "route_not_found" }, 404);
  const entries = await loadFeedback(env);
  const id = `${session.label}:${chatId}:${messageId}`;
  const entry = { id, label: session.label, rating: body.rating, routeId, chatId, messageId, at: new Date().toISOString() };
  const next = [entry, ...entries.filter((item) => item.id !== id)].slice(0, MAX_FEEDBACK_ENTRIES);
  await env.CHAT_STORE.put(FEEDBACK_KEY, JSON.stringify(next));
  return jsonResponse({ ok: true, rating: body.rating });
}

async function loadFeedback(env: Env): Promise<Array<{ id: string; label: string; rating: "up" | "down"; routeId: string; chatId: string; messageId: string; at: string }>> {
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
  const normalized = normalizeMessages(body.messages, env);
  if (!normalized.length) {
    return jsonResponse({ error: "empty_messages" }, 400);
  }

  const existing = ((await env.CHAT_STORE.get(memoryKey(session.label))) || "").trim();
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
  const normalized = normalizeMessages(body.messages, env);
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
    consumeQuota: true,
  });
  if (!result.ok) {
    return jsonResponse({ error: result.error, message: result.message, routeId: result.routeId }, result.status);
  }

  const summary = result.text.trim().slice(0, maxSummary);
  return jsonResponse({ summary, routeId: result.routeId, maxChars: maxSummary });
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
  const result = await getUserState(env, session.label).upsertChat(stored);
  const chats = await getUserState(env, session.label).listChats();
  if (!result.accepted) {
    return jsonResponse({ ok: true, accepted: false, chat: summarizeChat(chat), chats: chats.map(summarizeChat) });
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
  await migrateLegacyChatIndex(env, session.label);
  const deleted = await getUserState(env, session.label).deleteChat(id);
  const chats = await getUserState(env, session.label).listChats();
  return jsonResponse({ ok: true, deleted, chats: chats.map(summarizeChat) });
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

  const mode = body.mode === "replace" ? "replace" : "merge";
  const existing = mode === "replace" ? [] : await loadChatSessions(env, session.label);
  const byId = new Map<string, CloudChat>();
  for (const chat of existing) byId.set(chat.id, chat);
  for (const chat of incoming) {
    const prev = byId.get(chat.id);
    if (!prev || chat.updatedAt >= prev.updatedAt) byId.set(chat.id, chat);
  }

  const chats = [...byId.values()]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_CLOUD_SESSIONS);
  const storedChats = chats.map(toStoredChat);
  if (storedChats.some((chat) => !chat)) {
    return jsonResponse({ error: "chat_too_large", message: "部分会话内容过大" }, 413);
  }
  await getUserState(env, session.label).replaceChats(storedChats as StoredChat[]);
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

  const result = await checkRouteHealth(env, routeId, route);
  return jsonResponse(result, result.ok ? 200 : healthCheckStatus("error" in result ? result.error : ""));
}

async function checkRouteHealth(env: Env, routeId: string, route: RouteConfig) {
  const apiKey = resolveRouteKey(route, env, "");
  if (!apiKey) {
    const result = {
      ok: false,
      routeId,
      error: "missing_key",
      message: "线路 key 未配置（检查 apiKeyRef / secret）",
      checkedAt: new Date().toISOString(),
    };
    await saveRouteHealth(env, routeId, result);
    return result;
  }

  const started = Date.now();
  try {
    const text = await completeOnce({
      route,
      apiKey,
      messages: [
        { role: "user", content: "请完成一个小任务：计算 17 × 23，并只返回最终数字。" },
      ],
      temperature: 0,
      maxTokens: 32,
      env,
    });
    if (!text.includes("391")) {
      const result = {
        ok: false,
        routeId,
        latencyMs: Date.now() - started,
        error: "task_validation_failed",
        message: "线路已响应，但小任务答案未通过校验",
        sample: text.slice(0, 80),
        model: route.model,
        type: route.type,
        checkedAt: new Date().toISOString(),
      };
      await saveRouteHealth(env, routeId, result);
      return result;
    }
    const result = {
      ok: true,
      routeId,
      latencyMs: Date.now() - started,
      sample: text.slice(0, 80),
      model: route.model,
      type: route.type,
      checkedAt: new Date().toISOString(),
    };
    await saveRouteHealth(env, routeId, result);
    return result;
  } catch (error) {
    const result = {
      ok: false,
      routeId,
      latencyMs: Date.now() - started,
      error: "upstream_error",
      message: error instanceof Error ? error.message : "health check failed",
      model: route.model,
      type: route.type,
      checkedAt: new Date().toISOString(),
    };
    await saveRouteHealth(env, routeId, result);
    return result;
  }
}

function healthCheckStatus(error: unknown): number {
  return error === "missing_key" ? 400 : 502;
}

async function runScheduledRouteHealthChecks(env: Env): Promise<void> {
  const config = await loadAppConfig(env);
  const entries = Object.entries(config.routes).filter(([, route]) => route.enabled !== false);
  let cursor = 0;
  const worker = async () => {
    while (cursor < entries.length) {
      const entry = entries[cursor++];
      if (!entry) return;
      await checkRouteHealth(env, entry[0], entry[1]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(2, entries.length) }, () => worker()));
}

async function handleGetAdminRouteHealth(env: Env): Promise<Response> {
  const config = await loadAppConfig(env);
  const entries = await Promise.all(Object.keys(config.routes).map(async (routeId) => {
    const raw = await env.CHAT_STORE.get(routeHealthKey(routeId));
    if (!raw) return [routeId, null] as const;
    try {
      return [routeId, JSON.parse(raw)] as const;
    } catch {
      return [routeId, null] as const;
    }
  }));
  return jsonResponse({ routes: Object.fromEntries(entries) });
}

async function saveRouteHealth(env: Env, routeId: string, result: unknown): Promise<void> {
  await env.CHAT_STORE.put(routeHealthKey(routeId), JSON.stringify(result));
}

function routeHealthKey(routeId: string): string {
  return `route-health:${encodeURIComponent(routeId)}`;
}

async function withPublicRouteHealth(env: Env, route: PublicRoute): Promise<PublicRoute> {
  const raw = await env.CHAT_STORE.get(routeHealthKey(route.id));
  if (!raw) return { ...route, healthStatus: "unknown" };
  try {
    const health = JSON.parse(raw) as { ok?: unknown; checkedAt?: unknown };
    const checkedAt = typeof health.checkedAt === "string" ? health.checkedAt : "";
    const checkedTime = Date.parse(checkedAt);
    if (!Number.isFinite(checkedTime) || Date.now() - checkedTime > 86_400_000) {
      return { ...route, healthStatus: "unknown" };
    }
    return {
      ...route,
      healthStatus: health.ok === true ? "healthy" : "unhealthy",
      healthCheckedAt: checkedAt,
    };
  } catch {
    return { ...route, healthStatus: "unknown" };
  }
}

type CloudChat = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  summary: string;
  summaryUntil: number;
  pinned: boolean;
  messages: ChatMessage[];
};

function chatIndexKey(label: string): string {
  return `chats:${encodeURIComponent(label)}:index`;
}

async function handleAdminRouteModels(request: Request, env: Env): Promise<Response> {
  const body = await readJson<{
    routeId?: unknown;
    type?: unknown;
    baseUrl?: unknown;
    apiKeyRef?: unknown;
  }>(request);
  const routeId = typeof body.routeId === "string" ? body.routeId.trim() : "";
  const config = await loadAppConfig(env);
  const existing = routeId ? config.routes[routeId] : undefined;
  const type = body.type === "anthropic-messages" ? "anthropic-messages" : "openai-chat";
  const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl.trim() : existing?.baseUrl || "";
  const apiKeyRef = typeof body.apiKeyRef === "string" ? body.apiKeyRef.trim() : existing?.apiKeyRef;
  if (!/^https?:\/\//i.test(baseUrl)) {
    return jsonResponse({ error: "invalid_base_url", message: "请填写有效的 http(s) Base URL" }, 400);
  }

  const route: RouteConfig = {
    ...(existing || {}),
    label: existing?.label || routeId || "临时线路",
    type,
    baseUrl,
    model: existing?.model || "model-list",
    apiKeyRef,
  };
  const apiKey = resolveRouteKey(route, env, "");
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

function routeModelsUrl(route: RouteConfig): string {
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

  return {
    id,
    title,
    createdAt,
    updatedAt,
    summary,
    summaryUntil,
    pinned,
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
      createdAt: Number.isFinite(item.createdAt) ? Number(item.createdAt) : undefined,
      rating: item.rating === "up" || item.rating === "down" ? item.rating : undefined,
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

async function handleChat(request: Request, env: Env, session: Session): Promise<Response> {
  const length = Number(request.headers.get("content-length") || "0");
  if (length > MAX_REQUEST_BYTES) {
    return jsonResponse({ error: "request_too_large" }, 413);
  }

  if (request.headers.get("x-chatus-client") !== "web") {
    return jsonResponse({ error: "forbidden" }, 403);
  }

  const config = await loadAppConfig(env);
  const access = getRouteAccess(config, session.label, env);
  if (!access.routes.length) {
    return jsonResponse({ error: "no_routes_available" }, 403);
  }

  const body = await readJson<{
    messages?: unknown;
    routeId?: unknown;
    userApiKey?: unknown;
    temperature?: unknown;
    sessionSummary?: unknown;
  }>(request);
  const selectedRoute = typeof body.routeId === "string" ? body.routeId : access.defaultRoute;
  const normalized = trimMessagesForContext(normalizeMessages(body.messages, env), env);
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
    return jsonResponse({ error: "route_does_not_support_images", routeId: selectedPublicRoute.id }, 400);
  }

  const routeIds = buildRoutePlan(selectedRoute, config, access).filter((routeId) => {
    if (!hasImages) return true;
    return config.routes[routeId]?.supportsImages !== false;
  });
  if (!routeIds.length) {
    return jsonResponse({ error: hasImages ? "route_does_not_support_images" : "route_not_allowed" }, 403);
  }

  const limitResult = await consumeLimits(env, session, access.user);
  if (!limitResult.ok) {
    await recordChatMetric(env, {
      kind: "rate_limited",
      label: session.label,
    });
    return jsonResponse(
      { error: "rate_limited", reset: limitResult.reset },
      429,
      {
        "Retry-After": String(limitResult.retryAfter),
        "X-RateLimit-Remaining": "0",
      },
    );
  }

  const messages = await buildMessagesWithSystem(env, session, normalized, sessionSummary, access.user);

  const userApiKey = typeof body.userApiKey === "string" ? body.userApiKey.trim() : "";
  let lastError: { routeId: string; status: number; message: string } | null = null;
  let attemptedRoutes = 0;

  for (const routeId of routeIds) {
    const route = config.routes[routeId];
    const publicRoute = access.routes.find((item) => item.id === routeId);
    if (!route || !publicRoute) continue;

    const key = resolveRouteKey(route, env, publicRoute.allowUserKey ? userApiKey : "");
    if (!key) {
      if (publicRoute.requiresUserKey) {
        return jsonResponse({ error: "user_api_key_required", routeId }, 400);
      }
      lastError = { routeId, status: 500, message: "route key is not configured" };
      continue;
    }

    attemptedRoutes += 1;
    const result = await callRoute({
      route,
      routeId,
      apiKey: key,
      usedUserKey: Boolean(userApiKey && publicRoute.allowUserKey),
      messages,
      temperature: body.temperature,
      env,
    });

    if (result.response) {
      await recordChatMetric(env, {
        kind: "success",
        label: session.label,
        routeId,
        fallback: routeId !== selectedRoute && attemptedRoutes > 1,
      });
      result.response.headers.set("X-RateLimit-Remaining", String(limitResult.remaining));
      result.response.headers.set("X-Chatus-Route", routeId);
      return result.response;
    }

    lastError = result.error;
    await recordChatMetric(env, {
      kind: "route_error",
      label: session.label,
      routeId,
    });
    if (result.terminal) break;
  }

  await recordChatMetric(env, {
    kind: "failure",
    label: session.label,
    // route-level errors already recorded per attempt
  });

  return jsonResponse(
    {
      error: "upstream_error",
      routeId: lastError?.routeId,
      status: lastError?.status,
      message: lastError?.message || "no route succeeded",
    },
    502,
  );
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

  const invalidFallback = routeIds.find((id) => config.routes[id].fallbacks?.some((fallback) => !config.routes[fallback]));
  if (invalidFallback) {
    return { ok: false, message: `线路 ${invalidFallback} 包含不存在的 fallback` };
  }

  const users = Object.entries(config.users || {});
  for (const [label, user] of users) {
    if (user.defaultRoute && !config.routes[user.defaultRoute]) {
      return { ok: false, message: `用户 ${label} 的默认线路不存在` };
    }

    const missingRoute = user.allowedRoutes?.find((routeId) => !config.routes[routeId]);
    if (missingRoute) {
      return { ok: false, message: `用户 ${label} 允许了不存在的线路 ${missingRoute}` };
    }
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

  return { ok: true };
}

function normalizeAppConfig(value: unknown): AppConfig {
  const input = isRecord(value) ? value : {};
  const rawRoutes = isRecord(input.routes) ? input.routes : {};
  const routes: Record<string, RouteConfig> = {};

  for (const [id, rawRoute] of Object.entries(rawRoutes)) {
    if (!isRecord(rawRoute)) continue;
    const type = rawRoute.type;
    if (type !== "openai-chat" && type !== "anthropic-messages") continue;
    if (typeof rawRoute.baseUrl !== "string" || typeof rawRoute.model !== "string") continue;

    routes[id] = {
      enabled: rawRoute.enabled !== false,
      label: typeof rawRoute.label === "string" ? rawRoute.label : id,
      type,
      baseUrl: rawRoute.baseUrl,
      model: rawRoute.model,
      apiKey: typeof rawRoute.apiKey === "string" ? rawRoute.apiKey : undefined,
      apiKeyRef: typeof rawRoute.apiKeyRef === "string" ? rawRoute.apiKeyRef : undefined,
      authHeader: typeof rawRoute.authHeader === "string" ? rawRoute.authHeader : undefined,
      authPrefix: typeof rawRoute.authPrefix === "string" ? rawRoute.authPrefix : undefined,
      directEndpoint: rawRoute.directEndpoint === true,
      headers: normalizeStringRecord(rawRoute.headers),
      maxTokens: normalizePositiveNumber(rawRoute.maxTokens),
      temperature: normalizeNumber(rawRoute.temperature),
      fallbacks: Array.isArray(rawRoute.fallbacks)
        ? rawRoute.fallbacks.filter((item): item is string => typeof item === "string")
        : undefined,
      allowUserKey: rawRoute.allowUserKey !== false,
      requiresUserKey: rawRoute.requiresUserKey === true,
      supportsImages: rawRoute.supportsImages !== false,
    };
  }

  const defaults = normalizeUserConfig(input.defaults);
  const users: Record<string, UserConfig> = {};
  if (isRecord(input.users)) {
    for (const [label, rawUser] of Object.entries(input.users)) {
      const user = normalizeUserConfig(rawUser);
      if (Object.keys(user).length) users[label] = user;
    }
  }

  return {
    routes,
    users,
    defaults,
  };
}

function normalizeUserConfig(value: unknown): UserConfig {
  if (!isRecord(value)) return {};
  const output: UserConfig = {};
  if (typeof value.defaultRoute === "string") output.defaultRoute = value.defaultRoute;
  if (Array.isArray(value.allowedRoutes)) {
    output.allowedRoutes = value.allowedRoutes.filter((item): item is string => typeof item === "string");
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

function getRouteAccess(config: AppConfig, label: string, env: Env): RouteAccess {
  const user = {
    ...config.defaults,
    ...(config.users?.[label] || {}),
  };
  const allowedIds = user.allowedRoutes?.length ? user.allowedRoutes : Object.keys(config.routes);
  const routes = allowedIds
    .map((id): PublicRoute | null => {
      const route = config.routes[id];
      if (!route || route.enabled === false) return null;
      const hasServerKey = !route.requiresUserKey && Boolean(resolveRouteKey(route, env, ""));
      const allowUserKey = Boolean(user.allowBringYourOwnKey && route.allowUserKey !== false);
      if (!hasServerKey && !allowUserKey) return null;

      return {
        id,
        label: route.label,
        type: route.type,
        model: route.model,
        allowUserKey,
        requiresUserKey: Boolean(route.requiresUserKey || !hasServerKey),
        supportsImages: route.supportsImages !== false,
      };
    })
    .filter((route): route is PublicRoute => Boolean(route));

  const defaultRoute =
    user.defaultRoute && routes.some((route) => route.id === user.defaultRoute)
      ? user.defaultRoute
      : routes[0]?.id || "";

  return { routes, defaultRoute, user };
}

function buildRoutePlan(selectedRoute: string, config: AppConfig, access: RouteAccess): string[] {
  const allowed = new Set(access.routes.map((route) => route.id));
  const selected = allowed.has(selectedRoute) ? selectedRoute : access.defaultRoute;
  const route = config.routes[selected];
  const plan = [selected, ...(route?.fallbacks || [])].filter((id) => allowed.has(id));
  return [...new Set(plan)];
}

function resolveRouteKey(route: RouteConfig, env: Env, userApiKey: string): string {
  if (userApiKey && route.allowUserKey !== false) return userApiKey;
  if (route.requiresUserKey) return "";
  if (route.apiKey) return route.apiKey;
  if (route.apiKeyRef && typeof env[route.apiKeyRef] === "string") {
    return String(env[route.apiKeyRef]);
  }
  return "";
}

async function buildMessagesWithSystem(
  env: Env,
  session: Session,
  normalized: ChatMessage[],
  sessionSummary = "",
  userConfig?: UserConfig,
): Promise<ChatMessage[]> {
  const systemMessages: ChatMessage[] = [];
  const globalPrompt = env.SYSTEM_PROMPT?.trim();
  if (globalPrompt) {
    systemMessages.push({ role: "system", content: globalPrompt });
  }

  const userPrompt = userConfig?.systemPrompt?.trim();
  if (userPrompt) {
    systemMessages.push({
      role: "system",
      content: `以下是当前用户专属系统提示词，请优先遵循其中的风格、角色与约束：\n${userPrompt}`,
    });
  }

  const memory = (await env.CHAT_STORE.get(memoryKey(session.label)))?.trim();
  if (memory) {
    systemMessages.push({
      role: "system",
      content: `以下是关于当前用户的长期记忆。它可能包含用户偏好、常用背景和需要长期保持的一般信息。除非用户要求修改或遗忘，否则请在相关时参考：\n${memory}`,
    });
  }

  if (sessionSummary.trim()) {
    systemMessages.push({
      role: "system",
      content: `以下是当前会话的滚动摘要，用于弥补较早消息被裁剪的上下文。请优先参考摘要中的目标、约束和未完成事项：\n${sessionSummary.trim()}`,
    });
  }

  return [...systemMessages, ...normalized];
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
  const access = getRouteAccess(config, session.label, env);
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
  const routeIds = buildRoutePlan(selectedRoute, config, access);
  const userApiKey = args.userApiKey?.trim() || "";
  let lastError = "no route succeeded";
  let lastRouteId = "";

  for (const routeId of routeIds) {
    const route = config.routes[routeId];
    const publicRoute = access.routes.find((item) => item.id === routeId);
    if (!route || !publicRoute) continue;

    const key = resolveRouteKey(route, env, publicRoute.allowUserKey ? userApiKey : "");
    if (!key) {
      if (publicRoute.requiresUserKey) {
        return {
          ok: false,
          error: "user_api_key_required",
          message: "需要填写 API Key",
          status: 400,
          routeId,
        };
      }
      lastError = "route key is not configured";
      lastRouteId = routeId;
      continue;
    }

    try {
      const text = await completeOnce({
        route,
        apiKey: key,
        messages: args.messages,
        temperature: args.temperature ?? 0.2,
        maxTokens: args.maxTokens,
        env,
      });
      if (text.trim()) {
        return { ok: true, text: text.trim(), routeId };
      }
      lastError = "empty completion";
      lastRouteId = routeId;
    } catch (error) {
      lastError = error instanceof Error ? error.message : "completion failed";
      lastRouteId = routeId;
    }
  }

  return {
    ok: false,
    error: "upstream_error",
    message: lastError,
    status: 502,
    routeId: lastRouteId || undefined,
  };
}

async function completeOnce(args: {
  route: RouteConfig;
  apiKey: string;
  messages: ChatMessage[];
  temperature: number;
  maxTokens?: number;
  env: Env;
}): Promise<string> {
  const { route, apiKey, messages, temperature, maxTokens, env } = args;
  if (route.type === "anthropic-messages") {
    const headers = buildHeaders(route.headers);
    setAuthHeader(headers, route, apiKey, "x-api-key");
    headers.set("Content-Type", "application/json");
    if (!headers.has("anthropic-version")) {
      headers.set("anthropic-version", DEFAULT_ANTHROPIC_VERSION);
    }
    const anthropic = toAnthropicMessages(messages);
    const response = await fetch(routeUrl(route, "/v1/messages"), {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: route.model,
        messages: anthropic.messages,
        stream: false,
        max_tokens: maxTokens || route.maxTokens || numberEnv(env.DEFAULT_MAX_TOKENS, 4096),
        temperature: clampNumber(temperature, 0, 1, 0.2),
        ...(anthropic.system ? { system: anthropic.system } : {}),
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(formatUpstreamErrorMessage(JSON.stringify(payload)));
    }
    return extractAnthropicText(payload);
  }

  const headers = buildHeaders(route.headers);
  setAuthHeader(headers, route, apiKey, "Authorization");
  headers.set("Content-Type", "application/json");
  const response = await fetch(routeUrl(route, "/chat/completions"), {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: route.model,
      messages,
      stream: false,
      temperature: clampNumber(temperature, 0, 2, 0.2),
      max_tokens: maxTokens || route.maxTokens || numberEnv(env.DEFAULT_MAX_TOKENS, 4096),
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(formatUpstreamErrorMessage(JSON.stringify(payload)));
  }
  return extractOpenAiText(payload);
}

function extractOpenAiText(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.choices) || !payload.choices[0]) return "";
  const choice = payload.choices[0];
  if (!isRecord(choice)) return "";
  if (isRecord(choice.message) && typeof choice.message.content === "string") {
    return choice.message.content;
  }
  if (typeof choice.text === "string") return choice.text;
  return "";
}

function extractAnthropicText(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.content)) return "";
  return payload.content
    .map((block) => {
      if (!isRecord(block)) return "";
      if (block.type === "text" && typeof block.text === "string") return block.text;
      return "";
    })
    .filter(Boolean)
    .join("\n");
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
  route: RouteConfig;
  routeId: string;
  apiKey: string;
  usedUserKey: boolean;
  messages: ChatMessage[];
  temperature: unknown;
  env: Env;
}): Promise<{
  response?: Response;
  error: { routeId: string; status: number; message: string };
  terminal: boolean;
}> {
  const { route, routeId, usedUserKey } = args;
  const response =
    route.type === "anthropic-messages"
      ? await callAnthropicMessages(args)
      : await callOpenAiChat(args);

  if (response.ok && response.body) {
    const body =
      route.type === "anthropic-messages" ? transformAnthropicStream(response.body) : response.body;
    const headers = securityHeaders({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    return {
      response: new Response(body, { status: 200, headers }),
      error: { routeId, status: 0, message: "" },
      terminal: false,
    };
  }

  const message = await response.text().catch(() => "");
  const terminal =
    response.status === 400 ||
    response.status === 422 ||
    (usedUserKey && (response.status === 401 || response.status === 403));
  return {
    error: {
      routeId,
      status: response.status,
      message: formatUpstreamErrorMessage(message),
    },
    terminal,
  };
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

function findErrorMessage(value: unknown): string {
  if (!isRecord(value)) return "";
  if (typeof value.message === "string") return value.message;
  if (isRecord(value.error)) return findErrorMessage(value.error);
  return "";
}

async function callOpenAiChat(args: {
  route: RouteConfig;
  apiKey: string;
  messages: ChatMessage[];
  temperature: unknown;
}): Promise<Response> {
  const { route, apiKey, messages, temperature } = args;
  const headers = buildHeaders(route.headers);
  setAuthHeader(headers, route, apiKey, "Authorization");
  headers.set("Content-Type", "application/json");
  headers.set("Accept", "text/event-stream");

  return fetch(routeUrl(route, "/chat/completions"), {
    method: "POST",
    headers,
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
  route: RouteConfig;
  apiKey: string;
  messages: ChatMessage[];
  temperature: unknown;
  env: Env;
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
      if (!dataImage) continue;
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: dataImage.mediaType,
          data: dataImage.data,
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
          if (!doneSent) {
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            doneSent = true;
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
  try {
    const parsed = JSON.parse(payload);
    if (!isRecord(parsed)) return "";

    if (parsed.type === "content_block_delta" && isRecord(parsed.delta)) {
      if (parsed.delta.type === "text_delta" && typeof parsed.delta.text === "string") {
        return openAiSseChunk(parsed.delta.text);
      }

      return "";
    }

    if (parsed.type === "error" && isRecord(parsed.error)) {
      const message = typeof parsed.error.message === "string" ? parsed.error.message : "upstream error";
      return openAiSseChunk(`\n[upstream error: ${message}]`);
    }

    if (parsed.type === "message_stop" || eventName === "message_stop") {
      return "data: [DONE]\n\n";
    }

    return "";
  } catch {
    return "";
  }
}

function openAiSseChunk(text: string): string {
  return `data: ${JSON.stringify({
    choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
  })}\n\n`;
}

async function getSession(request: Request, env: Env): Promise<Session | null> {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return null;

  const raw = await env.CHAT_STORE.get(`session:${token}`);
  if (!raw) return null;

  try {
    const session = JSON.parse(raw) as Session;
    return session.id && session.label ? session : null;
  } catch {
    await env.CHAT_STORE.delete(`session:${token}`);
    return null;
  }
}

async function getAdminSession(request: Request, env: Env): Promise<AdminSession | null> {
  const token = getCookie(request, ADMIN_COOKIE);
  if (!token) return null;

  const raw = await env.CHAT_STORE.get(`admin:${token}`);
  if (!raw) return null;

  try {
    const session = JSON.parse(raw) as AdminSession;
    return Number.isFinite(session.createdAt) ? session : null;
  } catch {
    await env.CHAT_STORE.delete(`admin:${token}`);
    return null;
  }
}

async function consumeLimits(
  env: Env,
  session: Session,
  user: UserConfig,
): Promise<{ ok: true; remaining: number } | { ok: false; retryAfter: number; reset: string }> {
  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  const dailyLimit = user.dailyMessageLimit || numberEnv(env.DAILY_MESSAGE_LIMIT, DEFAULT_DAILY_LIMIT);
  const minuteLimit = user.minuteMessageLimit || numberEnv(env.MINUTE_MESSAGE_LIMIT, 12);
  const legacyDayCount = positiveCount(await env.CHAT_STORE.get(usageKey(session.label, day)));
  return getUserState(env, session.label).consumeLimits(dailyLimit, minuteLimit, now, legacyDayCount);
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
        const session = JSON.parse(raw) as Session;
        if (!session.label) continue;
        output.set(session.label, (output.get(session.label) || 0) + 1);
      } catch {
        // Ignore malformed session records; getSession will clean them when encountered.
      }
    }
  } while (cursor);

  return output;
}

function normalizeMessages(input: unknown, env: Env): ChatMessage[] {
  if (!Array.isArray(input)) return [];

  const maxTextChars = numberEnv(env.MAX_TEXT_CHARS, 12_000);
  const maxImageBytes = numberEnv(env.MAX_IMAGE_BYTES, 2_500_000);
  const maxImages = numberEnv(env.MAX_IMAGES_PER_REQUEST, 4);
  let imageCount = 0;

  return input
    .slice(-MAX_MESSAGES)
    .map((item): ChatMessage | null => {
      if (!isRecord(item)) return null;
      const role = item.role;
      if (role !== "system" && role !== "user" && role !== "assistant") return null;

      if (typeof item.content === "string") {
        const content = item.content.slice(0, maxTextChars);
        if (!content.trim()) return null;
        return {
          role,
          content,
        };
      }

      if (!Array.isArray(item.content)) return null;

      const parts: ChatPart[] = [];
      for (const part of item.content) {
        if (!isRecord(part)) continue;

        if (part.type === "text" && typeof part.text === "string") {
          parts.push({ type: "text", text: part.text.slice(0, maxTextChars) });
        }

        if (part.type === "image_url" && isRecord(part.image_url) && typeof part.image_url.url === "string") {
          if (imageCount >= maxImages) continue;
          const url = part.image_url.url;
          if (isAllowedDataImage(url, maxImageBytes)) {
            imageCount += 1;
            parts.push({ type: "image_url", image_url: { url } });
          }
        }
      }

      return parts.length ? { role, content: parts } : null;
    })
    .filter((message): message is ChatMessage => Boolean(message));
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
  return env.ACCESS_CODES?.trim() || "";
}

async function loadEditableAccessCodes(env: Env): Promise<{ accessCodes: string; source: "kv" | "secret" }> {
  const stored = await env.CHAT_STORE.get(ACCESS_CODES_KEY);
  if (stored?.trim()) return { accessCodes: stored.trim(), source: "kv" };
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
    if (await secureCompare(code, entry.code)) return entry.label;
  }

  return null;
}

function isAllowedDataImage(value: string, maxBytes: number): boolean {
  const dataImage = parseDataImage(value);
  if (!dataImage) return false;

  const base64Length = dataImage.data.length;
  const approximateBytes = Math.floor((base64Length * 3) / 4);
  return approximateBytes <= maxBytes;
}

function parseDataImage(value: string): { mediaType: string; data: string } | null {
  const match = value.match(/^(data:(image\/(?:png|jpe?g|webp|gif));base64,)([A-Za-z0-9+/=]+)$/i);
  if (!match) return null;

  return { mediaType: match[2], data: match[3] };
}

function buildHeaders(input?: Record<string, string>): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(input || {})) {
    headers.set(key, value);
  }
  return headers;
}

function setAuthHeader(headers: Headers, route: RouteConfig, apiKey: string, defaultHeader: string) {
  const header = route.authHeader || defaultHeader;
  if (headers.has(header)) return;
  const lower = header.toLowerCase();
  const prefix =
    route.authPrefix !== undefined ? route.authPrefix : lower === "authorization" ? "Bearer " : "";
  headers.set(header, `${prefix}${apiKey}`);
}

function routeUrl(route: RouteConfig, suffix: string): string {
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

function normalizeNumber(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
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
        return (JSON.parse(raw) as Session).label === label;
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

function positiveCount(value: string | null): number {
  const parsed = Number(value || "0");
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function getUserState(env: Env, label: string): DurableObjectStub<UserState> {
  return env.USER_STATE.getByName(label);
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
  return Boolean(value) && typeof value === "object";
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
    headers: securityHeaders({
      "Content-Type": "application/json; charset=utf-8",
      ...headers,
    }),
  });
}

function withSecurityHeaders(response: Response): Response {
  const headers = securityHeaders(response.headers);
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
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Permissions-Policy", "camera=(), geolocation=(), microphone=()");
  headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  headers.set(
    "Content-Security-Policy",
    "default-src 'self'; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  );
  return headers;
}
