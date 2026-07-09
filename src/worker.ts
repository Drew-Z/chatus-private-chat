type ChatRole = "system" | "user" | "assistant";

type ChatPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

type ChatMessage = {
  role: ChatRole;
  content: string | ChatPart[];
};

type Session = {
  id: string;
  label: string;
  createdAt: number;
  lastSeen: number;
};

type ProviderType = "openai-chat" | "anthropic-messages";

type RouteConfig = {
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
  SESSION_TTL_SECONDS?: string;
  DEFAULT_MAX_TOKENS?: string;
  BLOCKED_PROMPTS?: string;
  [key: string]: unknown;
};

const SESSION_COOKIE = "chatus_session";
const MAX_MESSAGES = 24;
const MAX_REQUEST_BYTES = 7_000_000;
const DEFAULT_ANTHROPIC_VERSION = "2023-06-01";
const BLOCKED_PROMPT_MESSAGE = "不要用这种方式测活，必须使用一个小任务之类的";

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
};

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: securityHeaders() });
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
    const config = getAppConfig(env);
    const access = getRouteAccess(config, session.label, env);
    const usage = await getUsage(env, session, access.user);
    return jsonResponse({
      authenticated: true,
      user: session.label,
      usage,
      routes: access.routes,
      defaultRoute: access.defaultRoute,
      allowBringYourOwnKey: Boolean(access.user.allowBringYourOwnKey),
    });
  }

  if (url.pathname === "/api/chat" && request.method === "POST") {
    return handleChat(request, env, session);
  }

  return jsonResponse({ error: "not_found" }, 404);
}

async function handleLogin(request: Request, env: Env, url: URL): Promise<Response> {
  if (!env.ACCESS_CODES?.trim()) {
    return jsonResponse({ error: "server_not_configured" }, 503);
  }

  const body = await readJson<{ code?: string }>(request);
  const code = body.code?.trim() || "";
  const label = findAccessLabel(env.ACCESS_CODES, code);

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

async function handleChat(request: Request, env: Env, session: Session): Promise<Response> {
  const length = Number(request.headers.get("content-length") || "0");
  if (length > MAX_REQUEST_BYTES) {
    return jsonResponse({ error: "request_too_large" }, 413);
  }

  if (request.headers.get("x-chatus-client") !== "web") {
    return jsonResponse({ error: "forbidden" }, 403);
  }

  const config = getAppConfig(env);
  const access = getRouteAccess(config, session.label, env);
  if (!access.routes.length) {
    return jsonResponse({ error: "no_routes_available" }, 403);
  }

  const body = await readJson<{
    messages?: unknown;
    routeId?: unknown;
    userApiKey?: unknown;
    temperature?: unknown;
  }>(request);
  const selectedRoute = typeof body.routeId === "string" ? body.routeId : access.defaultRoute;
  const normalized = normalizeMessages(body.messages, env);
  if (!normalized.length) {
    return jsonResponse({ error: "empty_messages" }, 400);
  }

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
    return jsonResponse(
      { error: "rate_limited", reset: limitResult.reset },
      429,
      {
        "Retry-After": String(limitResult.retryAfter),
        "X-RateLimit-Remaining": "0",
      },
    );
  }

  const messages = env.SYSTEM_PROMPT?.trim()
    ? [{ role: "system" as const, content: env.SYSTEM_PROMPT.trim() }, ...normalized]
    : normalized;

  const userApiKey = typeof body.userApiKey === "string" ? body.userApiKey.trim() : "";
  let lastError: { routeId: string; status: number; message: string } | null = null;

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
      result.response.headers.set("X-RateLimit-Remaining", String(limitResult.remaining));
      result.response.headers.set("X-Chatus-Route", routeId);
      return result.response;
    }

    lastError = result.error;
    if (result.terminal) break;
  }

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

function getAppConfig(env: Env): AppConfig {
  if (env.ROUTES_CONFIG?.trim()) {
    try {
      return normalizeAppConfig(JSON.parse(env.ROUTES_CONFIG));
    } catch {
      return normalizeAppConfig({});
    }
  }

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
      blockedPrompts: parsePromptList(env.BLOCKED_PROMPTS),
    },
  });
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
  return {
    defaultRoute: typeof value.defaultRoute === "string" ? value.defaultRoute : undefined,
    allowedRoutes: Array.isArray(value.allowedRoutes)
      ? value.allowedRoutes.filter((item): item is string => typeof item === "string")
      : undefined,
    allowBringYourOwnKey: value.allowBringYourOwnKey === true,
    dailyMessageLimit: normalizePositiveNumber(value.dailyMessageLimit),
    minuteMessageLimit: normalizePositiveNumber(value.minuteMessageLimit),
    blockedPrompts: parsePromptList(value.blockedPrompts),
  };
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
      if (!route) return null;
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
    session.lastSeen = Date.now();
    await env.CHAT_STORE.put(`session:${token}`, JSON.stringify(session), {
      expirationTtl: numberEnv(env.SESSION_TTL_SECONDS, 2_592_000),
    });
    return session;
  } catch {
    await env.CHAT_STORE.delete(`session:${token}`);
    return null;
  }
}

async function consumeLimits(
  env: Env,
  session: Session,
  user: UserConfig,
): Promise<{ ok: true; remaining: number } | { ok: false; retryAfter: number; reset: string }> {
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const minute = Math.floor(Date.now() / 60_000);
  const dailyLimit = user.dailyMessageLimit || numberEnv(env.DAILY_MESSAGE_LIMIT, 80);
  const minuteLimit = user.minuteMessageLimit || numberEnv(env.MINUTE_MESSAGE_LIMIT, 12);
  const dayKey = `usage:${session.id}:${day}`;
  const minuteKey = `burst:${session.id}:${minute}`;

  const [dayCountRaw, minuteCountRaw] = await Promise.all([
    env.CHAT_STORE.get(dayKey),
    env.CHAT_STORE.get(minuteKey),
  ]);
  const dayCount = Number(dayCountRaw || "0");
  const minuteCount = Number(minuteCountRaw || "0");

  if (dayCount >= dailyLimit) {
    return { ok: false, retryAfter: secondsUntilNextUtcDay(), reset: "daily" };
  }

  if (minuteCount >= minuteLimit) {
    return { ok: false, retryAfter: 60, reset: "minute" };
  }

  await Promise.all([
    env.CHAT_STORE.put(dayKey, String(dayCount + 1), { expirationTtl: 172_800 }),
    env.CHAT_STORE.put(minuteKey, String(minuteCount + 1), { expirationTtl: 120 }),
  ]);

  return { ok: true, remaining: Math.max(0, dailyLimit - dayCount - 1) };
}

async function getUsage(env: Env, session: Session, user: UserConfig) {
  const day = new Date().toISOString().slice(0, 10);
  const dailyLimit = user.dailyMessageLimit || numberEnv(env.DAILY_MESSAGE_LIMIT, 80);
  const used = Number((await env.CHAT_STORE.get(`usage:${session.id}:${day}`)) || "0");
  return { used, limit: dailyLimit, remaining: Math.max(0, dailyLimit - used) };
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

function findAccessLabel(accessCodes: string, code: string): string | null {
  for (const entry of accessCodes.split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf(":");
    const label = separator === -1 ? "friend" : trimmed.slice(0, separator).trim() || "friend";
    const expected = separator === -1 ? trimmed : trimmed.slice(separator + 1).trim();
    if (expected && code === expected) return label;
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
  const encoded = value ? encodeURIComponent(value) : "";
  const parts = [
    `${SESSION_COOKIE}=${encoded}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function numberEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function secondsUntilNextUtcDay(): number {
  const now = new Date();
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(60, Math.floor((next - now.getTime()) / 1000));
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
