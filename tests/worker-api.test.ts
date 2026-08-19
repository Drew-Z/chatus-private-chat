import { env, exports } from "cloudflare:workers";
import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { getAgentByName } from "agents";
import type { UIMessage } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TeamAgent } from "../src/agent/team-agent";
import {
  CONVERSATION_AGENT_ACCESS_BODY_KEY,
  type ConversationAgentAccessContextV1,
} from "../src/contracts/agent";
import {
  conversationResourceInstanceName,
  principalRootInstanceName,
  principalUserStateInstanceName,
  type ConversationAccessActionV1,
  type ConversationResourceRouteV1,
  type PrincipalRouteV1,
} from "../src/contracts/identity";
import {
  isAdminCapabilityCatalogSnapshot,
  isAdminCapabilityPackInstallResponse,
  isAdminConfigSnapshot,
  isAdminLegacyRouteMigrationResponse,
  isAdminLegacySurfaceSnapshot,
} from "../client/src/lib/api";
import {
  LEGACY_SURFACE_MANIFEST,
  legacySurfaceManifestDigest,
  legacySurfaceObjectName,
  stableJson,
} from "../src/contracts/legacy-surface";
import { IDENTITY_REGISTRY_INSTANCE_NAME } from "../src/identity-registry";
import { providerOfferingId } from "../src/contracts/provider-attempt";
import { PROVIDER_BUDGET_HOLD_REVIEW_AFTER_MS } from "../src/contracts/provider-finance";
import { resolveProviderRouteCandidates } from "../src/services/provider-router";
import {
  ProviderAttemptLedgerError,
  createProviderAttemptRuntime,
} from "../src/services/provider-attempt-runtime";
import worker, {
  assertConversationRouteParity,
  assertPrincipalRouteParity,
  getTeamAgentConversationInstanceName,
  getTeamAgentInstanceName,
  responseWithProviderLease,
  runTeamAgentCleanupSchedule,
  scheduleConversationAccessInvalidation,
} from "../src/worker";
import wranglerConfig from "../wrangler.jsonc?raw";

const ACCESS_CODES_KEY = "config:access_codes";
const ROUTES_CONFIG_KEY = "config:routes_config";
const SETUP_SMOKE_KEY = "config:setup_smoke";
const ADMIN_AUDIT_KEY = "config:admin_audit";
const FEEDBACK_KEY = "feedback:recent";
const ROUTE_SECRET_PREFIX = "route-secret:";
const MCP_SECRET_PREFIX = "mcp-secret:";
const GUEST_CLEANUP_PREFIX = "guest-cleanup:";
const ROUTE_RELIABILITY_PREFIX = "route-reliability:";
const PROVIDER_ROUTE_RELIABILITY_PREFIX = "route-provider-reliability:";

async function clearRouteSecrets() {
  let cursor: string | undefined;
  do {
    const page = await env.CHAT_STORE.list({ prefix: ROUTE_SECRET_PREFIX, cursor, limit: 100 });
    await Promise.all(page.keys.map((key) => env.CHAT_STORE.delete(key.name)));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
}

async function clearMcpSecrets() {
  let cursor: string | undefined;
  do {
    const page = await env.CHAT_STORE.list({ prefix: MCP_SECRET_PREFIX, cursor, limit: 100 });
    await Promise.all(page.keys.map((key) => env.CHAT_STORE.delete(key.name)));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
}

async function clearGuestCleanups() {
  let cursor: string | undefined;
  do {
    const page = await env.CHAT_STORE.list({ prefix: GUEST_CLEANUP_PREFIX, cursor, limit: 100 });
    await Promise.all(page.keys.map((key) => env.CHAT_STORE.delete(key.name)));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
}

async function clearRouteReliability() {
  for (const prefix of [ROUTE_RELIABILITY_PREFIX, PROVIDER_ROUTE_RELIABILITY_PREFIX]) {
    let cursor: string | undefined;
    do {
      const page = await env.CHAT_STORE.list({ prefix, cursor, limit: 100 });
      await Promise.all(page.keys.map((key) => env.CHAT_STORE.delete(key.name)));
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
  }
}

async function login(label = `tester-${crypto.randomUUID()}`) {
  await env.CHAT_STORE.put(ACCESS_CODES_KEY, `${label}:test-access-code`);
  const response = await exports.default.fetch(
    new Request("https://example.test/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "test-access-code" }),
    }),
  );
  expect(response.status).toBe(200);
  const cookie = response.headers.get("Set-Cookie")?.split(";", 1)[0];
  expect(cookie).toMatch(/^chatus_session=/);
  return { cookie: cookie!, label };
}

async function loginWithCode(code: string, ip = `code-${crypto.randomUUID()}`): Promise<string | null> {
  const response = await exports.default.fetch(
    new Request("https://example.test/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
      body: JSON.stringify({ code }),
    }),
  );
  if (response.status !== 200) return null;
  return response.headers.get("Set-Cookie")?.split(";", 1)[0] || null;
}

function apiRequest(path: string, cookie: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cookie", cookie);
  return exports.default.fetch(new Request(`https://example.test${path}`, { ...init, headers }));
}

async function readCapabilityEvents(response: Response): Promise<any[]> {
  const text = await response.text();
  return text
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)));
}

async function seedMcpOAuthData(label: string, serverId: string, stateInstanceName = label) {
  const state = env.USER_STATE.getByName(stateInstanceName);
  const now = Date.now();
  const auth = {
    version: 1 as const,
    type: "oauth2" as const,
    issuer: "https://export-issuer.example",
    clientId: "chatus-export-test",
    scopes: ["tools.read"],
    callbackPath: "/api/mcp/oauth/callback",
    configRevision: "a".repeat(64),
  };
  const accessToken = `oauth-access-${serverId}`;
  const refreshToken = `oauth-refresh-${serverId}`;
  await state.storeMcpOAuthToken({
    ownerLabel: label,
    serverId,
    auth,
    token: {
      accessToken,
      refreshToken,
      expiresAt: now + 60 * 60_000,
      grantedScopes: [...auth.scopes],
      issuer: auth.issuer,
      clientId: auth.clientId,
      configRevision: auth.configRevision,
    },
    nowMs: now,
  });
  await state.storeMcpOAuthState({
    ownerLabel: label,
    state: "s".repeat(43),
    sessionFingerprint: "b".repeat(64),
    serverId,
    configRevision: auth.configRevision,
    verifier: "v".repeat(43),
    callbackUrl: "https://example.test/api/mcp/oauth/callback",
    expiresAt: now + 60_000,
    nowMs: now,
  });
  await state.storeMcpOAuthDiscoveryCandidate({
    ownerLabel: label,
    serverId,
    configRevision: auth.configRevision,
    discovery: {
      serverId,
      rejected: 0,
      tools: [{
        id: `mcp:${serverId}:lookup`,
        label: "Lookup",
        description: "Secret-free candidate",
        inputSchema: { type: "object", properties: {} },
        confirmation: "first-per-conversation",
        executor: { type: "mcp", serverId, remoteName: "lookup" },
        schemaFingerprint: "c".repeat(64),
        securityFingerprint: "d".repeat(64),
        sideEffect: "read",
        reviewRevision: "e".repeat(64),
        reviewRequired: true,
      }],
    },
    nowMs: now,
  });
  return { state, accessToken, refreshToken };
}

async function readUntilCapabilityConfirmation(response: Response): Promise<{
  reader: ReadableStreamDefaultReader<Uint8Array>;
  decoder: TextDecoder;
  buffer: string;
  events: any[];
  confirmation: any;
}> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events: any[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) throw new Error("Capability stream ended before confirmation");
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() || "";
    for (const frame of frames) {
      const line = frame.split(/\r?\n/).find((entry) => entry.startsWith("data: "));
      if (!line) continue;
      const event = JSON.parse(line.slice(6));
      events.push(event);
      if (event.type === "confirmation_required") {
        return { reader, decoder, buffer, events, confirmation: event };
      }
    }
  }
}

async function drainCapabilityReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder,
  initialBuffer: string,
): Promise<any[]> {
  let buffer = initialBuffer;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
  }
  buffer += decoder.decode();
  return buffer
    .split("\n\n")
    .map((frame) => frame.split(/\r?\n/).find((entry) => entry.startsWith("data: ")))
    .filter((line): line is string => Boolean(line))
    .map((line) => JSON.parse(line.slice(6)));
}

function openAiTextEvent(text: string): string {
  return `data: ${JSON.stringify({
    choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
  })}\n\n`;
}

function openAiTextSse(text: string): string {
  return `${openAiTextEvent(text)}data: [DONE]\n\n`;
}

function openAiTextResponse(text: string): Response {
  return new Response(openAiTextSse(text), {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function openAiUiTextResponse(text: string, model = "parity-model"): Response {
  const chunks = [
    {
      id: "chatcmpl-parity",
      object: "chat.completion.chunk",
      created: 1,
      model,
      choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
    },
    {
      id: "chatcmpl-parity",
      object: "chat.completion.chunk",
      created: 1,
      model,
      choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
    },
    {
      id: "chatcmpl-parity",
      object: "chat.completion.chunk",
      created: 1,
      model,
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    },
  ];
  return new Response(`${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function openAiUiToolCallResponse(
  name: string,
  input: Record<string, unknown>,
  model = "parity-model",
): Response {
  const chunks = [
    {
      id: "chatcmpl-parity-tool",
      object: "chat.completion.chunk",
      created: 1,
      model,
      choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
    },
    {
      id: "chatcmpl-parity-tool",
      object: "chat.completion.chunk",
      created: 1,
      model,
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{
            index: 0,
            id: "call-parity-text-stats",
            type: "function",
            function: { name, arguments: JSON.stringify(input) },
          }],
        },
        finish_reason: null,
      }],
    },
    {
      id: "chatcmpl-parity-tool",
      object: "chat.completion.chunk",
      created: 1,
      model,
      choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    },
  ];
  return new Response(`${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}


async function adminLogin() {
  const response = await exports.default.fetch(
    new Request("https://example.test/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "test-admin-token" }),
    }),
  );
  expect(response.status).toBe(200);
  const cookie = response.headers.get("Set-Cookie")?.split(";", 1)[0];
  expect(cookie).toMatch(/^chatus_admin=/);
  return cookie!;
}

async function putRouteSecret(cookie: string, apiKeyRef: string, apiKey: string, expectedRevision?: string) {
  return apiRequest(`/api/admin/route-secrets/${encodeURIComponent(apiKeyRef)}`, cookie, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey, expectedRevision }),
  });
}

const PUBLIC_ROUTE_ID = "public-model";
const MEMBER_ROUTE_ID = "member-model";

async function configurePublicAccess(options: {
  managed?: boolean;
  apiKeyRef?: string;
  legacyApiKey?: string;
  dailyMessageLimit?: number;
  minuteMessageLimit?: number;
  sourceDailyMessageLimit?: number;
  sourceMinuteMessageLimit?: number;
} = {}) {
  const apiKeyRef = options.apiKeyRef || "PUBLIC_GUEST_TEST_KEY";
  if (options.managed !== false) {
    const cookie = await adminLogin();
    const saved = await putRouteSecret(cookie, apiKeyRef, "public-guest-managed-test-key");
    expect(saved.status).toBe(200);
  }
  const config = {
    providers: {
      public: {
        label: "Public provider",
        type: "openai-chat",
        baseUrl: "https://public-provider.example/v1",
        apiKeyRef,
        ...(options.legacyApiKey ? { apiKey: options.legacyApiKey } : {}),
        supportsImages: true,
      },
    },
    routes: {
      [PUBLIC_ROUTE_ID]: {
        label: "Public model",
        offerings: [{ providerId: "public", model: "public-upstream-model" }],
        fallbacks: [MEMBER_ROUTE_ID],
        supportsImages: true,
      },
      [MEMBER_ROUTE_ID]: {
        label: "Member model",
        type: "openai-chat",
        baseUrl: "https://member-provider.example/v1",
        model: "member-upstream-model",
        apiKey: "member-test-key",
      },
    },
    defaults: { defaultRoute: MEMBER_ROUTE_ID, allowedRoutes: [MEMBER_ROUTE_ID, PUBLIC_ROUTE_ID] },
    publicAccess: {
      enabled: true,
      routeId: PUBLIC_ROUTE_ID,
      sessionTtlSeconds: 86_400,
      dailyMessageLimit: options.dailyMessageLimit || 20,
      minuteMessageLimit: options.minuteMessageLimit || 6,
      sourceDailyMessageLimit: options.sourceDailyMessageLimit || 200,
      sourceMinuteMessageLimit: options.sourceMinuteMessageLimit || 30,
    },
    skills: {
      private: {
        enabled: true,
        label: "Private Skill",
        instructions: "Member-only instructions",
        toolIds: [],
      },
    },
    tools: {},
    mcpServers: {},
  };
  await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify(config));
  return config;
}

function setupReadyConfig(options: {
  apiKeyRef?: string;
  includeOffering?: boolean;
  includeMember?: boolean;
  memberEnabled?: boolean;
  allowedRoutes?: string[];
} = {}) {
  const includeOffering = options.includeOffering !== false;
  const includeMember = options.includeMember !== false;
  return {
    providers: {
      setup: {
        label: "Setup provider",
        type: "openai-chat",
        baseUrl: "https://setup-provider.example/v1",
        apiKeyRef: options.apiKeyRef || "TEST_ROUTE_KEY",
      },
    },
    routes: {
      setup: {
        label: "Setup model",
        ...(includeOffering ? { offerings: [{ providerId: "setup", model: "setup-upstream-model" }] } : {}),
      },
    },
    defaults: { defaultRoute: "setup", allowedRoutes: ["setup"] },
    ...(includeMember ? {
      users: {
        member: {
          enabled: options.memberEnabled !== false,
          defaultRoute: "setup",
          allowedRoutes: options.allowedRoutes || ["setup"],
        },
      },
    } : {}),
  };
}

function capabilityBudgetConfig(providerId: string, routeId: string, model: string) {
  return {
    providers: {
      [providerId]: {
        label: "Capability budget provider",
        type: "openai-chat",
        baseUrl: `https://${providerId}.example/v1`,
        apiKeyRef: "TEST_ROUTE_KEY",
        supportsTools: true,
      },
    },
    routes: {
      [routeId]: {
        label: "Capability budget route",
        offerings: [{ providerId, model, supportsTools: true }],
        supportsTools: true,
      },
    },
    defaults: {
      defaultRoute: routeId,
      allowedRoutes: [routeId],
      allowedSkills: ["budget-analyze"],
      allowedTools: ["builtin:text_stats"],
    },
    tools: {
      "builtin:text_stats": {
        enabled: true,
        label: "Text stats",
        inputSchema: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"],
          additionalProperties: false,
        },
        executor: { type: "builtin", name: "text_stats" },
      },
    },
    skills: {
      "budget-analyze": {
        enabled: true,
        label: "Budget analyze",
        instructions: "Use text statistics when useful.",
        toolIds: ["builtin:text_stats"],
      },
    },
  };
}

async function createGuestSession(source: string, cookie?: string) {
  const headers = new Headers({ "CF-Connecting-IP": source });
  if (cookie) headers.set("Cookie", cookie);
  const response = await exports.default.fetch(new Request("https://example.test/api/guest-session", {
    method: "POST",
    headers,
  }));
  const payload = await response.clone().json() as any;
  const issuedCookie = response.headers.get("Set-Cookie")?.split(";", 1)[0] || cookie || "";
  return { response, payload, cookie: issuedCookie };
}

function sessionToken(cookie: string): string {
  return cookie.slice(cookie.indexOf("=") + 1);
}

function guestChat(cookie: string, routeId = PUBLIC_ROUTE_ID, body: Record<string, unknown> = {}) {
  return apiRequest("/api/chat", cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Chatus-Client": "web" },
    body: JSON.stringify({ routeId, messages: [{ role: "user", content: "local guest test" }], ...body }),
  });
}

async function resolveTestPrincipal(label: string): Promise<PrincipalRouteV1 | undefined> {
  const result = await env.IDENTITY_REGISTRY.getByName(IDENTITY_REGISTRY_INSTANCE_NAME).lookupActivePrincipalAlias({
    version: 1,
    alias: label,
  });
  return result.found ? result.route : undefined;
}

async function reserveNativeTestPrincipal(label: string): Promise<PrincipalRouteV1> {
  return env.IDENTITY_REGISTRY.getByName(IDENTITY_REGISTRY_INSTANCE_NAME).resolveOrCreatePrincipal({
    version: 1,
    operationId: `test-principal:${crypto.randomUUID()}`,
    alias: label,
    origin: "native",
  });
}

function stablePrincipalTestMarker(principal: PrincipalRouteV1) {
  return {
    version: 1 as const,
    principalId: principal.principalId,
    rootInstanceName: principal.rootInstanceName,
    userStateInstanceName: principal.userStateInstanceName,
    registryRevision: principal.registryRevision,
  };
}

async function getRootAgent(label: string) {
  const principal = await resolveTestPrincipal(label);
  const instance = principal?.rootInstanceName ?? await getTeamAgentInstanceName(label);
  const props = { userLabel: label, scope: "root" as const };
  const agent = await getAgentByName(env.TEAM_AGENT, instance, { props }) as DurableObjectStub<TeamAgent>;
  if (principal) {
    const marker = stablePrincipalTestMarker(principal);
    const identity = await agent.ensureIdentity(props);
    if (!identity.ok) throw new Error(identity.error);
    await Promise.all([
      agent.ensureStableIdentity({
        ...marker,
        scope: "root",
        resourceId: "",
        resourceRegistryRevision: 0,
        pinnedInstanceName: instance,
      }),
      env.USER_STATE.getByName(principal.userStateInstanceName).ensureStableIdentity(marker),
    ]);
  }
  return agent;
}

async function getConversationAgent(label: string, chatId: string) {
  const principal = await resolveTestPrincipal(label);
  let resource: ConversationResourceRouteV1 | undefined;
  if (principal) {
    const registry = env.IDENTITY_REGISTRY.getByName(IDENTITY_REGISTRY_INSTANCE_NAME);
    const lookup = await registry.lookupConversationResource({
      version: 1,
      principalId: principal.principalId,
      conversationId: chatId,
    });
    if (lookup.found) {
      resource = lookup.route;
    } else {
      resource = await registry.ensureConversationResource({
        version: 1,
        operationId: `test-resource:${crypto.randomUUID()}`,
        principalId: principal.principalId,
        conversationId: chatId,
      });
    }
  }
  const [instance, rootInstance] = resource && principal
    ? [resource.agentInstanceName, principal.rootInstanceName]
    : await Promise.all([
        getTeamAgentConversationInstanceName(label, chatId),
        getTeamAgentInstanceName(label),
      ]);
  const props = { userLabel: label, scope: "conversation" as const, chatId, rootInstance };
  const agent = await getAgentByName(env.TEAM_AGENT, instance, { props }) as DurableObjectStub<TeamAgent>;
  if (principal && resource) {
    await agent.ensureIdentity(props);
    await agent.ensureStableIdentity({
      ...stablePrincipalTestMarker(principal),
      scope: "conversation",
      resourceId: resource.resourceId,
      resourceRegistryRevision: resource.registryRevision,
      pinnedInstanceName: instance,
    });
  }
  return agent;
}

async function createMemberConversationAgent(
  label: string,
  chatId: string,
  routeId: string,
  skillIds: string[] = [],
) {
  await reserveNativeTestPrincipal(label);
  const root = await getRootAgent(label);
  const now = Date.now();
  const created = await root.createConversation({
    id: chatId,
    title: "Parity conversation",
    createdAt: now,
    updatedAt: now,
    summary: "",
    pinned: false,
    routeId,
    skillMode: "manual",
    skillIds,
  });
  if (!created.ok) throw new Error(created.error);
  const agent = await getConversationAgent(label, chatId);
  const access = await ownerConversationAccessContext(label, chatId);
  return { agent, access };
}

async function ownerConversationAccessContext(
  label: string,
  chatId: string,
): Promise<ConversationAgentAccessContextV1> {
  return conversationAccessContext(label, chatId);
}

async function conversationAccessContext(
  label: string,
  chatId: string,
  exactResourceId?: string,
  action: ConversationAccessActionV1 = "conversation.message.send",
): Promise<ConversationAgentAccessContextV1> {
  const principal = await resolveTestPrincipal(label);
  if (!principal) throw new Error("missing_agent_test_principal");
  const registry = env.IDENTITY_REGISTRY.getByName(IDENTITY_REGISTRY_INSTANCE_NAME);
  let resourceId = exactResourceId;
  if (!resourceId) {
    const resource = await registry.lookupConversationResource({
      version: 1,
      principalId: principal.principalId,
      conversationId: chatId,
    });
    if (!resource.found) throw new Error("missing_agent_test_resource");
    resourceId = resource.route.resourceId;
  }
  const access = await registry.resolveConversationAccess({
    version: 1,
    actorPrincipalId: principal.principalId,
    resourceId,
    conversationId: chatId,
    action,
  });
  return {
    version: 1,
    access,
    actor: {
      label,
      principalId: principal.principalId,
      rootInstanceName: principal.rootInstanceName,
      userStateInstanceName: principal.userStateInstanceName,
      registryRevision: principal.registryRevision,
      sessionExpiresAt: Date.now() + 60_000,
    },
  };
}

async function runSharedEditorTurn(
  agent: DurableObjectStub<TeamAgent>,
  messages: UIMessage[],
  requestId: string,
  access: ConversationAgentAccessContextV1,
  body: Record<string, unknown> = {},
): Promise<{ status: number; contentType: string; body: string }> {
  return runInDurableObject(agent, async (instance) => {
    await instance.persistMessages(messages, [], { _deleteStaleRows: true });
    (instance as any).registerConversationAccessTurn(
      requestId,
      access.access,
      Math.max(0, messages.length - 1),
    );
    const response = await instance.onChatMessage(async () => undefined, {
      requestId,
      body: { ...body, [CONVERSATION_AGENT_ACCESS_BODY_KEY]: access },
    });
    return {
      status: response.status,
      contentType: response.headers.get("Content-Type") || "",
      body: await response.text(),
    };
  });
}

async function runAgentTurn(
  agent: DurableObjectStub<TeamAgent>,
  messages: UIMessage[],
  requestId: string,
  access?: ConversationAgentAccessContextV1,
): Promise<{ status: number; contentType: string; body: string }> {
  const imported = await agent.importLegacyMessages(messages);
  if (!imported.imported) throw new Error("agent_parity_import_failed");
  return runInDurableObject(agent, async (instance) => {
    const response = await instance.onChatMessage(async () => undefined, {
      requestId,
      body: access ? { [CONVERSATION_AGENT_ACCESS_BODY_KEY]: access } : undefined,
    });
    return {
      status: response.status,
      contentType: response.headers.get("Content-Type") || "",
      body: await response.text(),
    };
  });
}

async function getPersistedAgentMessages(agent: DurableObjectStub<TeamAgent>): Promise<UIMessage[]> {
  return runInDurableObject(agent, async (_instance, state) => {
    const rows = state.storage.sql.exec<{ message: string }>(
      "SELECT message FROM cf_ai_chat_agent_messages ORDER BY created_at, id",
    ).toArray();
    return rows.map((row) => JSON.parse(row.message) as UIMessage);
  });
}

async function getVisionEvidenceRows(agent: DurableObjectStub<TeamAgent>): Promise<Array<{
  source_message_id: string;
  evidence_json: string;
}>> {
  return runInDurableObject(agent, async (_instance, state) => state.storage.sql.exec<{
    source_message_id: string;
    evidence_json: string;
  }>(
    "SELECT source_message_id, evidence_json FROM chatus_vision_evidence ORDER BY source_message_id",
  ).toArray());
}

async function seedProviderAttempt(providerId: string) {
  const runtime = createProviderAttemptRuntime({
    ledger: env.PROVIDER_ATTEMPT_LEDGER,
    mode: "required",
    operation: {
      version: 1,
      operationId: `provider-operation-${crypto.randomUUID()}`,
      fenceId: crypto.randomUUID(),
      kind: "provider_turn",
      startedAt: Date.now(),
    },
  });
  const run = runtime.createRun("main_answer");
  const handle = await run.start({
    logicalRouteId: "retained-evidence",
    providerId,
    model: "fake-model",
    credentialClass: "managed",
    fallbackIndex: 0,
  });
  await handle.succeed();
  return {
    providerId,
    turnId: runtime.turnId,
    runId: run.runId,
    attemptId: handle.attemptId!,
  };
}

async function seedHardProviderBudget(input: {
  providerId: string;
  routeId: string;
  model: string;
  knownPrice: boolean;
  exhausted?: boolean;
}) {
  const ledger = env.PROVIDER_ATTEMPT_LEDGER.getByName(input.providerId);
  const periodStart = Date.now() - 1_000;
  if (input.knownPrice) {
    await ledger.addPriceCatalog({
      version: 1,
      catalogVersionId: `catalog-${crypto.randomUUID()}`,
      providerId: input.providerId,
      offeringId: providerOfferingId(input.routeId, input.providerId),
      model: input.model,
      currency: "USD",
      precision: 6,
      unit: "million_tokens",
      inputNoCachePriceMicros: 1_000_000,
      cacheReadInputPriceMicros: 0,
      cacheWriteInputPriceMicros: 0,
      outputTextPriceMicros: 2_000_000,
      reasoningOutputPriceMicros: 0,
      effectiveFrom: periodStart,
      effectiveTo: null,
      approver: "test-finance-admin",
      provenance: "local fake Provider price",
      createdAt: periodStart,
    });
  }
  const policyId = `policy-${crypto.randomUUID()}`;
  const shadowPolicy = {
    version: 1,
    policyId,
    idempotencyKey: `provider-budget-policy:v1:${crypto.randomUUID()}`,
    providerId: input.providerId,
    currency: "USD",
    mode: "shadow" as const,
    periodStart,
    periodEnd: periodStart + 24 * 60 * 60 * 1_000,
    limitMicros: 500,
    maxAttemptReserveMicros: 500,
    holdReviewAfterMs: PROVIDER_BUDGET_HOLD_REVIEW_AFTER_MS,
    allowUnknownPrice: false,
    approver: "test-finance-admin",
    createdAt: periodStart,
    expectedPreviousVersion: 0,
  };
  await ledger.addBudgetPolicy(shadowPolicy);
  await ledger.addBudgetPolicy({
    ...shadowPolicy,
    idempotencyKey: `provider-budget-policy:v1:${crypto.randomUUID()}`,
    mode: "hard",
    createdAt: periodStart + 1,
    expectedPreviousVersion: 1,
  });
  if (input.exhausted) {
    const runtime = createProviderAttemptRuntime({
      ledger: env.PROVIDER_ATTEMPT_LEDGER,
      mode: "required",
      operation: {
        version: 1,
        operationId: `budget-seed-${crypto.randomUUID()}`,
        fenceId: crypto.randomUUID(),
        kind: "provider_turn",
        startedAt: periodStart + 1,
      },
    });
    await runtime.createRun("main_answer").start({
      logicalRouteId: input.routeId,
      providerId: input.providerId,
      model: input.model,
      credentialClass: "managed",
      fallbackIndex: 0,
      startedAt: periodStart + 2,
    });
  }
  return { ledger, periodStart };
}

describe("Worker API", () => {
  afterEach(() => vi.restoreAllMocks());

  beforeEach(async () => {
    await Promise.all([
      env.CHAT_STORE.delete(ACCESS_CODES_KEY),
      env.CHAT_STORE.delete(ROUTES_CONFIG_KEY),
      env.CHAT_STORE.delete(SETUP_SMOKE_KEY),
      env.CHAT_STORE.delete(ADMIN_AUDIT_KEY),
      env.CHAT_STORE.delete(FEEDBACK_KEY),
      clearRouteSecrets(),
      clearMcpSecrets(),
      clearGuestCleanups(),
      clearRouteReliability(),
    ]);
  });

  it("creates a cookie session and restores it", async () => {
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      routes: {
        default: {
          label: "Default",
          type: "openai-chat",
          baseUrl: "https://session.example/v1",
          model: "session-model",
          apiKey: "session-key",
        },
      },
      defaults: { defaultRoute: "default", allowedRoutes: ["default"] },
    }));
    const { cookie, label } = await login();
    await env.CHAT_STORE.put("route-reliability:default", JSON.stringify({
      version: 2,
      source: "real_task",
      routeId: "default",
      ok: false,
      outcome: "upstream_server",
      observedAt: new Date().toISOString(),
      latencyMs: 120,
      fallback: false,
      httpStatusClass: "5xx",
    }));
    const response = await apiRequest("/api/session", cookie);
    expect(response.status, await response.clone().text()).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      authenticated: true,
      user: label,
      routes: [{ id: "default", healthStatus: "unhealthy", healthSource: "real_task" }],
      imageInput: {
        acceptedMediaTypes: ["image/png", "image/jpeg", "image/webp", "image/gif"],
        maxImages: 4,
        maxImageBytes: 1_300_000,
        maxTotalImageBytes: 1_300_000,
      },
      agent: { transport: "cloudflare-ai-chat", className: "team-agent", basePath: "agent" },
    });
  });

  it("derives every image mode and the session image capability from current assignment", async () => {
    const deniedLabel = `image-mode-denied-${crypto.randomUUID()}`;
    const noneOnlyLabel = `image-mode-none-${crypto.randomUUID()}`;
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      providers: {
        native: {
          label: "Native image",
          type: "openai-chat",
          baseUrl: "https://native-mode.example/v1",
          apiKey: "native-mode-key",
          supportsImages: true,
          supportsTools: false,
        },
        tool: {
          label: "Tool text",
          type: "openai-chat",
          baseUrl: "https://tool-mode.example/v1",
          apiKey: "tool-mode-key",
          supportsImages: false,
          supportsTools: true,
        },
        plain: {
          label: "Plain text",
          type: "openai-chat",
          baseUrl: "https://plain-mode.example/v1",
          apiKey: "plain-mode-key",
          supportsImages: false,
          supportsTools: false,
        },
        vision: {
          label: "Vision helper",
          type: "openai-chat",
          baseUrl: "https://vision-mode.example/v1",
          apiKey: "vision-mode-key",
          supportsImages: true,
          supportsTools: false,
        },
      },
      routes: {
        native: { label: "Native image", offerings: [{ providerId: "native", model: "native-model" }] },
        tool: {
          label: "Tool text",
          offerings: [{ providerId: "tool", model: "tool-model" }],
          supportsTools: true,
        },
        plain: { label: "Plain text", offerings: [{ providerId: "plain", model: "plain-model" }] },
        vision: { label: "Vision helper", offerings: [{ providerId: "vision", model: "vision-model" }] },
      },
      defaults: {
        defaultRoute: "native",
        allowedRoutes: ["native", "tool", "plain"],
        allowedAugmentations: ["vision_assist"],
      },
      users: {
        [deniedLabel]: { allowedAugmentations: [] },
        [noneOnlyLabel]: { allowedRoutes: ["tool", "plain"], allowedAugmentations: [] },
      },
      visionAssist: { enabled: true, routeId: "vision", maxOutputChars: 1_024 },
    }));
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const routeModes = (session: any) => Object.fromEntries(session.routes.map((route: any) => [route.id, {
      supportsImages: route.supportsImages,
      supportsTools: route.supportsTools,
      imageMode: route.imageMode,
    }]));

    const assigned = await login(`image-mode-assigned-${crypto.randomUUID()}`);
    const assignedSession = await apiRequest("/api/session", assigned.cookie).then((response) => response.json()) as any;
    expect(routeModes(assignedSession)).toEqual({
      native: { supportsImages: true, supportsTools: false, imageMode: "native" },
      tool: { supportsImages: false, supportsTools: true, imageMode: "assisted_tool" },
      plain: { supportsImages: false, supportsTools: false, imageMode: "assisted_preanswer" },
    });
    expect(assignedSession.capabilities.imageInput).toBe(true);

    const denied = await login(deniedLabel);
    const deniedSession = await apiRequest("/api/session", denied.cookie).then((response) => response.json()) as any;
    expect(routeModes(deniedSession)).toEqual({
      native: { supportsImages: true, supportsTools: false, imageMode: "native" },
      tool: { supportsImages: false, supportsTools: true, imageMode: "none" },
      plain: { supportsImages: false, supportsTools: false, imageMode: "none" },
    });
    expect(deniedSession.capabilities.imageInput).toBe(true);

    const noneOnly = await login(noneOnlyLabel);
    const noneOnlySession = await apiRequest("/api/session", noneOnly.cookie).then((response) => response.json()) as any;
    expect(routeModes(noneOnlySession)).toEqual({
      tool: { supportsImages: false, supportsTools: true, imageMode: "none" },
      plain: { supportsImages: false, supportsTools: false, imageMode: "none" },
    });
    expect(noneOnlySession.capabilities.imageInput).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("issues isolated guest identities with one secret-free logical model", async () => {
    await configurePublicAccess();
    const source = `guest-source-${crypto.randomUUID()}`;
    const first = await createGuestSession(source);
    const second = await createGuestSession(source);

    expect(first.response.status).toBe(200);
    expect(second.response.status).toBe(200);
    expect(first.cookie).toMatch(/^chatus_session=/);
    expect(second.cookie).toMatch(/^chatus_session=/);
    expect(second.cookie).not.toBe(first.cookie);
    expect(first.payload).toMatchObject({
      authenticated: true,
      access: "guest",
      displayName: "访客",
      routes: [{ id: PUBLIC_ROUTE_ID, supportsImages: true, supportsTools: false }],
      defaultRoute: PUBLIC_ROUTE_ID,
      allowBringYourOwnKey: false,
      hasUserSystemPrompt: false,
      availableCapabilities: [],
      skills: [],
      tools: [],
      capabilities: {
        imageInput: true,
        memory: false,
        messageActions: false,
        feedback: false,
        accountData: false,
      },
    });
    expect(second.payload.user).not.toBe(first.payload.user);
    expect(second.payload.agent.instance).not.toBe(first.payload.agent.instance);
    const projection = JSON.stringify(first.payload);
    expect(projection).not.toContain("public-provider");
    expect(projection).not.toContain("public-upstream-model");
    expect(projection).not.toContain("PUBLIC_GUEST_TEST_KEY");

    const firstStored = await env.CHAT_STORE.get<any>(`session:${sessionToken(first.cookie)}`, "json");
    const secondStored = await env.CHAT_STORE.get<any>(`session:${sessionToken(second.cookie)}`, "json");
    expect(firstStored).toMatchObject({ kind: "guest", label: first.payload.user });
    expect(firstStored.sourceKey).toMatch(/^guest-source:[0-9a-f]{64}$/);
    expect(secondStored.sourceKey).toBe(firstStored.sourceKey);
    expect(secondStored.label).not.toBe(firstStored.label);

    const firstCreated = await apiRequest("/api/agent/conversations", first.cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "same-chat-id", title: "First guest" }),
    });
    const secondCreated = await apiRequest("/api/agent/conversations", second.cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "same-chat-id", title: "Second guest" }),
    });
    expect(firstCreated.status).toBe(201);
    expect(secondCreated.status).toBe(201);
    await expect(firstCreated.clone().json()).resolves.toMatchObject({
      conversation: { skillIds: [] },
    });
    await expect(apiRequest("/api/agent/conversations", first.cookie).then((response) => response.json()))
      .resolves.toMatchObject({ conversations: [expect.objectContaining({ title: "First guest" })] });
    await expect(apiRequest("/api/agent/conversations", second.cookie).then((response) => response.json()))
      .resolves.toMatchObject({ conversations: [expect.objectContaining({ title: "Second guest" })] });
  });

  it("requires a managed credential before exposing the guest route", async () => {
    await configurePublicAccess({ managed: false, apiKeyRef: "LEGACY_ONLY_GUEST_KEY", legacyApiKey: "legacy-test-key" });
    const legacy = await createGuestSession(`legacy-source-${crypto.randomUUID()}`);
    expect(legacy.response.status).toBe(200);
    expect(legacy.payload).toMatchObject({ routes: [], defaultRoute: "", capabilities: { imageInput: false } });

    await configurePublicAccess({ managed: false, apiKeyRef: "TEST_ROUTE_KEY" });
    const workerSecret = await createGuestSession(`worker-secret-source-${crypto.randomUUID()}`);
    expect(workerSecret.payload).toMatchObject({ routes: [], defaultRoute: "" });

    const adminCookie = await adminLogin();
    expect((await putRouteSecret(adminCookie, "TEST_ROUTE_KEY", "managed-public-test-key")).status).toBe(200);
    const refreshed = await apiRequest("/api/session", workerSecret.cookie).then((response) => response.json()) as any;
    expect(refreshed.routes).toEqual([expect.objectContaining({ id: PUBLIC_ROUTE_ID })]);
  });

  it("rejects forged guest routes and member-only APIs before provider execution", async () => {
    await configurePublicAccess();
    const guest = await createGuestSession(`guest-policy-${crypto.randomUUID()}`);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const forged = await guestChat(guest.cookie, MEMBER_ROUTE_ID);
    expect(forged.status).toBe(403);
    await expect(forged.json()).resolves.toMatchObject({ error: "route_not_allowed" });

    const denied = [
      ["/api/agent/memory", "GET"],
      ["/api/feedback", "POST"],
      ["/api/agent/conversations/chat-1/branches", "POST"],
      ["/api/user-data/export", "GET"],
      ["/api/sessions/revoke-all", "POST"],
      ["/api/chats", "GET"],
    ] as const;
    for (const [path, method] of denied) {
      const response = await apiRequest(path, guest.cookie, { method });
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({ error: "capability_not_allowed" });
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not let guest chat inject a session summary into provider messages", async () => {
    await configurePublicAccess();
    const guest = await createGuestSession(`guest-summary-${crypto.randomUUID()}`);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => openAiTextResponse("local response"));

    const response = await guestChat(guest.cookie, PUBLIC_ROUTE_ID, {
      sessionSummary: "GUEST SUMMARY MUST NOT REACH PROVIDER",
      skillIds: ["private"],
    });
    expect(response.status, await response.clone().text()).toBe(200);
    await response.text();

    expect(fetchSpy).toHaveBeenCalledOnce();
    const providerPayload = String(fetchSpy.mock.calls[0]?.[1]?.body || "");
    expect(providerPayload).not.toContain("GUEST SUMMARY MUST NOT REACH PROVIDER");
    expect(providerPayload).not.toContain("Member-only instructions");
  });

  it("invalidates old and expired guest sessions and cleans expired guest state", async () => {
    const oldToken = `old-${crypto.randomUUID()}`;
    await env.CHAT_STORE.put(`session:${oldToken}`, JSON.stringify({
      id: crypto.randomUUID(),
      label: "old-member",
      createdAt: Date.now(),
      lastSeen: Date.now(),
    }));
    const oldResponse = await apiRequest("/api/session", `chatus_session=${oldToken}`);
    expect(oldResponse.status).toBe(401);
    await expect(env.CHAT_STORE.get(`session:${oldToken}`)).resolves.toBeNull();

    const now = Date.now();
    const expiredToken = `expired-${crypto.randomUUID()}`;
    const expiredLabel = `guest-${crypto.randomUUID()}`;
    const expiredState = env.USER_STATE.getByName(expiredLabel);
    await expiredState.upsertChat({
      id: "expired-chat",
      title: "Expired",
      createdAt: now - 4_000,
      updatedAt: now - 3_000,
      summary: "",
      summaryUntil: 0,
      routeId: PUBLIC_ROUTE_ID,
      messages: [],
      serializedBytes: 20,
    });
    await env.CHAT_STORE.put(`session:${expiredToken}`, JSON.stringify({
      id: crypto.randomUUID(),
      label: expiredLabel,
      kind: "guest",
      createdAt: now - 3_000,
      lastSeen: now - 2_000,
      expiresAt: now - 1_000,
      sourceKey: `guest-source:${"a".repeat(64)}`,
    }));
    const expiredResponse = await apiRequest("/api/session", `chatus_session=${expiredToken}`);
    expect(expiredResponse.status).toBe(401);
    await expect(env.CHAT_STORE.get(`session:${expiredToken}`)).resolves.toBeNull();
    await expect(expiredState.listChats()).resolves.toEqual([]);

    const ttlExpiredLabel = `guest-${crypto.randomUUID()}`;
    const ttlExpiredState = env.USER_STATE.getByName(ttlExpiredLabel);
    await ttlExpiredState.upsertChat({
      id: "ttl-expired-chat",
      title: "TTL expired",
      createdAt: now - 4_000,
      updatedAt: now - 3_000,
      summary: "",
      summaryUntil: 0,
      routeId: PUBLIC_ROUTE_ID,
      messages: [],
      serializedBytes: 20,
    });
    const cleanupKey = `${GUEST_CLEANUP_PREFIX}${String(now - 1_000).padStart(13, "0")}:${encodeURIComponent(ttlExpiredLabel)}`;
    await env.CHAT_STORE.put(cleanupKey, JSON.stringify({ label: ttlExpiredLabel, expiresAt: now - 1_000 }));
    const crossOriginCleanup = await exports.default.fetch(new Request("https://example.test/api/guest-session", {
      method: "POST",
      headers: { Origin: "https://other.example" },
    }));
    expect(crossOriginCleanup.status).toBe(403);
    await expect(ttlExpiredState.listChats()).resolves.toHaveLength(1);
    await expect(env.CHAT_STORE.get(cleanupKey)).resolves.not.toBeNull();

    const cleanupTrigger = await exports.default.fetch(new Request("https://example.test/api/session"));
    expect(cleanupTrigger.status).toBe(401);
    await vi.waitFor(async () => {
      await expect(ttlExpiredState.listChats()).resolves.toEqual([]);
      await expect(env.CHAT_STORE.get(cleanupKey)).resolves.toBeNull();
    });
  });

  it("keeps an expired guest unauthorized and retains cleanup ownership when TeamAgent is unavailable", async () => {
    const now = Date.now();
    const token = `expired-unavailable-${crypto.randomUUID()}`;
    const label = `guest-${crypto.randomUUID()}`;
    const expiresAt = now - 1_000;
    const markerKey = `${GUEST_CLEANUP_PREFIX}${String(expiresAt).padStart(13, "0")}:${encodeURIComponent(label)}`;
    await env.CHAT_STORE.put(`session:${token}`, JSON.stringify({
      id: crypto.randomUUID(),
      label,
      kind: "guest",
      createdAt: now - 3_000,
      lastSeen: now - 2_000,
      expiresAt,
      sourceKey: `guest-source:${"b".repeat(64)}`,
    }));
    const unavailableTeamAgent = new Proxy(env.TEAM_AGENT, {
      get(target, property, receiver) {
        if (property === "get") {
          return () => { throw new Error("synthetic_team_agent_unavailable"); };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const customEnv = new Proxy(env, {
      get(target, property, receiver) {
        if (property === "TEAM_AGENT") return unavailableTeamAgent;
        return Reflect.get(target, property, receiver);
      },
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await worker.fetch(
      new Request("https://example.test/api/session", {
        headers: { Cookie: `chatus_session=${token}` },
      }),
      customEnv,
    );

    expect(response.status).toBe(401);
    await expect(env.CHAT_STORE.get(`session:${token}`)).resolves.toBeNull();
    await expect(env.CHAT_STORE.get(markerKey)).resolves.not.toBeNull();
    const [marker] = (await env.CHAT_STORE.list({ prefix: markerKey })).keys;
    expect(marker?.expiration).toBeUndefined();
    expect(consoleError).toHaveBeenCalledWith(JSON.stringify({
      level: "warn",
      event: "guest_cleanup_deferred",
      error: "guest_cleanup_unavailable",
    }));
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(label);
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(markerKey);
  });

  it("retains guest cleanup ownership across TeamAgent and UserState failures, then converges after eviction", async () => {
    const now = Date.now();
    const label = `guest-${crypto.randomUUID()}`;
    const chatId = `guest-cleanup-${crypto.randomUUID()}`;
    const expiresAt = now - 1_000;
    const markerKey = `${GUEST_CLEANUP_PREFIX}${String(expiresAt).padStart(13, "0")}:${encodeURIComponent(label)}`;
    const root = await getRootAgent(label);
    const conversation = await getConversationAgent(label, chatId);
    const userState = env.USER_STATE.getByName(label);
    await env.CHAT_STORE.put(markerKey, JSON.stringify({ label, expiresAt }));
    await root.createConversation({
      id: chatId,
      title: "Guest cleanup",
      createdAt: now - 3_000,
      updatedAt: now - 2_000,
      summary: "",
      pinned: false,
      skillIds: [],
      messageCount: 1,
    });
    await conversation.importLegacyMessages([{
      id: "guest-cleanup-message",
      role: "user",
      parts: [{ type: "text", text: "synthetic guest cleanup payload" }],
    }]);
    await userState.upsertChat({
      id: chatId,
      title: "Guest cleanup",
      createdAt: now - 3_000,
      updatedAt: now - 2_000,
      summary: "",
      summaryUntil: 0,
      routeId: "",
      messages: [],
      serializedBytes: 20,
    });
    await expect(root.registerGuestCleanup(markerKey, now + 60_000)).resolves.toBe(true);
    const [listedMarker] = (await env.CHAT_STORE.list({ prefix: markerKey })).keys;
    expect(listedMarker?.expiration).toBeUndefined();
    const cleanupRoot = (overrides: Partial<Pick<
      TeamAgent,
      "getDueGuestCleanup" | "completeWorkspaceAccountPurge"
    >> = {}) => ({
      getDueGuestCleanup: overrides.getDueGuestCleanup
        || ((dueAt: number) => root.getDueGuestCleanup(dueAt)),
      beginWorkspaceAccountPurge: (operationId: string) => root.beginWorkspaceAccountPurge(operationId),
      completeWorkspaceAccountPurge: overrides.completeWorkspaceAccountPurge
        || ((operationId: string, generation: number) => root.completeWorkspaceAccountPurge(operationId, generation)),
      getAllConversationIds: () => root.getAllConversationIds(),
      purgeRootData: () => root.purgeRootData(),
      recordWorkspaceOperationFailure: (...args: Parameters<TeamAgent["recordWorkspaceOperationFailure"]>) => (
        root.recordWorkspaceOperationFailure(...args)
      ),
      releaseWorkspaceAccountPurge: (...args: Parameters<TeamAgent["releaseWorkspaceAccountPurge"]>) => (
        root.releaseWorkspaceAccountPurge(...args)
      ),
      completeGuestCleanup: (key: string) => root.completeGuestCleanup(key),
      recordGuestCleanupFailure: (...args: Parameters<TeamAgent["recordGuestCleanupFailure"]>) => (
        root.recordGuestCleanupFailure(...args)
      ),
    }) as unknown as TeamAgent;

    const initialGuest = await root.getDueGuestCleanup(now + 60_000);
    expect(initialGuest).toMatchObject({ markerKey, attempts: 0 });
    await runInDurableObject(root, async (_instance, state) => {
      state.storage.sql.exec("DELETE FROM cf_agents_schedules WHERE callback = 'runCleanupSchedule'");
      await state.storage.deleteAlarm();
    });
    const failingRoot = cleanupRoot({
      getDueGuestCleanup: async () => initialGuest,
      completeWorkspaceAccountPurge: async () => { throw new Error("synthetic_team_agent_purge_failure"); },
    });
    await runTeamAgentCleanupSchedule(env, label, failingRoot);
    await runInDurableObject(root, async (_instance, state) => {
      state.storage.sql.exec("DELETE FROM cf_agents_schedules WHERE callback = 'runCleanupSchedule'");
      await state.storage.deleteAlarm();
    });
    await expect(env.CHAT_STORE.get(markerKey)).resolves.not.toBeNull();
    await expect(userState.listChats()).resolves.toHaveLength(1);
    await expect(root.inspectCleanupReliability()).resolves.toMatchObject({
      guest: { pending: 1, terminal: 0, maxAttempts: 1 },
      account: { pending: 1, terminal: 0, maxAttempts: 1 },
    });

    let userStateFailureInjected = false;
    const failingUserState = new Proxy(env.USER_STATE, {
      get(target, property) {
        if (property === "getByName") {
          return (name: string) => {
            if (name === label) {
              return {
                purgeUserData: async () => {
                  userStateFailureInjected = true;
                  throw new Error("synthetic_guest_user_state_failure");
                },
              };
            }
            return target.getByName(name);
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const dueGuest = await root.getDueGuestCleanup(Date.now() + 10 * 60_000);
    expect(dueGuest).toMatchObject({ markerKey, attempts: 1 });
    await runTeamAgentCleanupSchedule(
      { ...env, USER_STATE: failingUserState },
      label,
      {
        ...cleanupRoot(),
        getDueGuestCleanup: async () => dueGuest,
      } as unknown as TeamAgent,
    );
    await runInDurableObject(root, async (_instance, state) => {
      const ticket = await state.storage.get<any>("chatus:guest-cleanup-ticket:v1");
      await state.storage.put("chatus:guest-cleanup-ticket:v1", { ...ticket, nextAttemptAt: 1 });
      state.storage.sql.exec("UPDATE workspace_file_operations SET next_attempt_at = 1 WHERE kind = 'account_purge'");
      state.storage.sql.exec("DELETE FROM cf_agents_schedules WHERE callback = 'runCleanupSchedule'");
      await state.storage.deleteAlarm();
    });
    expect(userStateFailureInjected).toBe(true);
    await expect(env.CHAT_STORE.get(markerKey)).resolves.not.toBeNull();
    await expect(userState.listChats()).resolves.toHaveLength(1);
    await expect(conversation.getConversationMessageCount()).resolves.toBe(0);
    await expect(root.inspectCleanupReliability()).resolves.toMatchObject({
      guest: { pending: 1, terminal: 0, maxAttempts: 2 },
      account: { pending: 1, terminal: 0, maxAttempts: 2 },
    });

    await runInDurableObject(root, async (instance, state) => {
      await instance.refreshCleanupSchedule(Date.now() + 60_000, true);
      state.storage.sql.exec("UPDATE cf_agents_schedules SET time = 1 WHERE callback = 'runCleanupSchedule'");
    });

    await evictDurableObject(root);
    const rootInstance = await getTeamAgentInstanceName(label);
    const restored = await getAgentByName(env.TEAM_AGENT, rootInstance) as DurableObjectStub<TeamAgent>;
    await expect(runDurableObjectAlarm(restored)).resolves.toBe(true);
    await expect(env.CHAT_STORE.get(markerKey)).resolves.toBeNull();
    await expect(userState.listChats()).resolves.toEqual([]);
    await expect(env.WORKSPACE_FILES.list()).resolves.toMatchObject({ objects: [] });
    await expect(runInDurableObject(restored, async (_instance, state) => Promise.all([
      state.storage.get("chatus:guest-cleanup-ticket:v1"),
      state.storage.get("chatus:agent-identity:v1"),
    ]))).resolves.toEqual([undefined, undefined]);
  });

  it("rotates a guest identity into a member session without migrating guest history", async () => {
    await configurePublicAccess();
    const guest = await createGuestSession(`guest-login-${crypto.randomUUID()}`);
    const created = await apiRequest("/api/agent/conversations", guest.cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Guest-only conversation",
        skillMode: "automatic",
        skillIds: ["forged"],
      }),
    });
    expect(created.status).toBe(201);
    const createdPayload = await created.clone().json() as any;
    expect(createdPayload).toMatchObject({
      conversation: { skillMode: "manual", skillIds: [] },
    });
    const guestRoot = await getRootAgent(guest.payload.user);
    const corrupted = await guestRoot.updateConversation({
      id: createdPayload.conversation.id,
      expectedUpdatedAt: createdPayload.conversation.updatedAt,
      skillMode: "automatic",
      skillIds: ["forged"],
    });
    expect(corrupted.ok).toBe(true);
    const repaired = await apiRequest(
      `/api/agent/conversations/${encodeURIComponent(createdPayload.conversation.id)}`,
      guest.cookie,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skillMode: "automatic",
          expectedUpdatedAt: corrupted.conversation?.updatedAt,
        }),
      },
    );
    expect(repaired.status).toBe(200);
    await expect(repaired.json()).resolves.toMatchObject({
      conversation: { skillMode: "manual", skillIds: [] },
    });
    await env.CHAT_STORE.put(ACCESS_CODES_KEY, "bill:test-access-code");

    const loginResponse = await exports.default.fetch(new Request("https://example.test/api/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cookie": guest.cookie,
        "CF-Connecting-IP": `member-login-${crypto.randomUUID()}`,
      },
      body: JSON.stringify({ code: "test-access-code" }),
    }));
    expect(loginResponse.status).toBe(200);
    const memberCookie = loginResponse.headers.get("Set-Cookie")?.split(";", 1)[0] || "";
    expect(memberCookie).toMatch(/^chatus_session=/);
    expect(memberCookie).not.toBe(guest.cookie);
    await expect(env.CHAT_STORE.get(`session:${sessionToken(guest.cookie)}`)).resolves.toBeNull();
    expect((await apiRequest("/api/session", guest.cookie)).status).toBe(401);
    await expect(apiRequest("/api/session", memberCookie).then((response) => response.json()))
      .resolves.toMatchObject({ access: "member", user: "bill" });
    await expect(apiRequest("/api/agent/conversations", memberCookie).then((response) => response.json()))
      .resolves.toMatchObject({ conversations: [] });
  });

  it("enforces per-guest and source quotas without exposing source identity", async () => {
    const source = `quota-source-${crypto.randomUUID()}`;
    await configurePublicAccess({ dailyMessageLimit: 1, minuteMessageLimit: 6, sourceDailyMessageLimit: 10, sourceMinuteMessageLimit: 10 });
    const guest = await createGuestSession(source);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => openAiTextResponse("local response"));
    const first = await guestChat(guest.cookie);
    expect(first.status, await first.clone().text()).toBe(200);
    await first.text();
    const personal = await guestChat(guest.cookie);
    expect(personal.status).toBe(429);
    await expect(personal.json()).resolves.toMatchObject({ error: "rate_limited", scope: "session" });

    await configurePublicAccess({ dailyMessageLimit: 10, minuteMessageLimit: 10, sourceDailyMessageLimit: 1, sourceMinuteMessageLimit: 10 });
    const sourceOne = await createGuestSession(`${source}-shared`);
    const sourceTwo = await createGuestSession(`${source}-shared`);
    const sourceFirst = await guestChat(sourceOne.cookie);
    expect(sourceFirst.status).toBe(200);
    await sourceFirst.text();
    const sourceLimited = await guestChat(sourceTwo.cookie);
    expect(sourceLimited.status).toBe(429);
    const limitedPayload = await sourceLimited.json() as any;
    expect(limitedPayload).toMatchObject({ error: "rate_limited", scope: "source" });
    expect(JSON.stringify(limitedPayload)).not.toContain(source);

    const otherSource = await createGuestSession(`${source}-other`);
    const allowed = await guestChat(otherSource.cookie);
    expect(allowed.status).toBe(200);
    await allowed.text();
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("rejects invalid or unsupported images before any provider request", async () => {
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      routes: {
        images: {
          label: "Images",
          type: "openai-chat",
          baseUrl: "https://images.example/v1",
          model: "image-model",
          apiKey: "image-key",
          supportsImages: true,
        },
        text: {
          label: "Text",
          type: "openai-chat",
          baseUrl: "https://text.example/v1",
          model: "text-model",
          apiKey: "text-key",
          supportsImages: false,
        },
      },
      defaults: { defaultRoute: "images", allowedRoutes: ["images", "text"] },
    }));
    const { cookie } = await login();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const request = (routeId: string, urls: string[]) => apiRequest("/api/chat", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Chatus-Client": "web" },
      body: JSON.stringify({
        routeId,
        messages: [{
          role: "user",
          content: urls.map((url) => ({ type: "image_url", image_url: { url } })),
        }],
      }),
    });

    const remote = await request("images", ["https://example.test/image.png"]);
    expect(remote.status).toBe(400);
    await expect(remote.json()).resolves.toMatchObject({ error: "invalid_image_data" });

    const unsupported = await request("images", ["data:image/svg+xml;base64,PHN2Zz4="]);
    expect(unsupported.status).toBe(400);
    await expect(unsupported.json()).resolves.toMatchObject({ error: "invalid_image_type" });

    const tooMany = await request("images", Array.from({ length: 5 }, () => "data:image/png;base64,QQ=="));
    expect(tooMany.status).toBe(400);
    await expect(tooMany.json()).resolves.toMatchObject({ error: "too_many_images" });

    const incapable = await request("text", ["data:image/png;base64,QQ=="]);
    expect(incapable.status).toBe(400);
    await expect(incapable.json()).resolves.toMatchObject({ error: "image_not_supported" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends text file attachments to providers as deterministic text context", async () => {
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      routes: {
        files: {
          label: "Files",
          type: "openai-chat",
          baseUrl: "https://files.example/v1",
          model: "file-model",
          apiKey: "file-key",
        },
      },
      defaults: { defaultRoute: "files", allowedRoutes: ["files"] },
    }));
    const { cookie } = await login();
    let providerBody: any = null;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      providerBody = JSON.parse(String(init?.body));
      return openAiTextResponse("local response");
    });

    const response = await apiRequest("/api/chat", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Chatus-Client": "web" },
      body: JSON.stringify({
        routeId: "files",
        messages: [{
          role: "user",
          content: [
            { type: "text", text: "Read this file." },
            {
              type: "file",
              mediaType: "text/markdown",
              filename: "notes.md",
              url: "data:text/markdown;base64,IyBOb3Rlcw==",
            },
          ],
        }],
      }),
    });

    expect(response.status, await response.clone().text()).toBe(200);
    await response.text();
    expect(providerBody?.messages.at(-1)).toMatchObject({ role: "user" });
    const content = providerBody?.messages.at(-1)?.content;
    expect(content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "text", text: "Read this file." }),
      expect.objectContaining({ type: "text", text: expect.stringContaining("<attached_file name=\"notes.md\" mediaType=\"text/markdown\" bytes=\"7\">") }),
    ]));
    expect(content[1].text).toContain("# Notes");
    expect(JSON.stringify(providerBody)).not.toContain("data:text/markdown;base64");
  });

  it("keeps legacy and TeamAgent file, Skill, streaming, and attempt identity behavior in parity", async () => {
    const suffix = crypto.randomUUID();
    const providerId = `parity-context-${suffix}`;
    const routeId = `parity-context-${suffix}`;
    const model = "parity-context-model";
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      providers: {
        [providerId]: {
          label: "Parity context provider",
          type: "openai-chat",
          baseUrl: `https://${providerId}.example/v1`,
          apiKey: "parity-context-key",
        },
      },
      routes: {
        [routeId]: {
          label: "Parity context route",
          offerings: [{ providerId, model }],
        },
      },
      defaults: {
        defaultRoute: routeId,
        allowedRoutes: [routeId],
        allowedSkills: ["skill-2", "skill-4"],
      },
      skills: {
        "skill-1": { enabled: true, label: "Skill 1", instructions: "instruction-1", order: 1 },
        "skill-2": { enabled: true, label: "Skill 2", instructions: "instruction-2", order: 2 },
        "skill-4": { enabled: true, label: "Skill 4", instructions: "instruction-4", order: 4 },
      },
      tools: {},
      mcpServers: {},
    }));
    const legacy = await login(`legacy-parity-context-${suffix}`);
    const providerBodies: any[] = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      providerBodies.push(JSON.parse(String(init?.body || "{}")));
      return openAiUiTextResponse("parity context complete", model);
    });
    const parts = [
      { type: "text" as const, text: "Read this file with the assigned Skills." },
      {
        type: "file" as const,
        mediaType: "text/markdown",
        filename: "notes.md",
        url: "data:text/markdown;base64,IyBOb3Rlcw==",
      },
    ];

    const legacyResponse = await apiRequest("/api/chat", legacy.cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Chatus-Client": "web" },
      body: JSON.stringify({
        routeId,
        skillIds: ["skill-4", "skill-2", "skill-1"],
        messages: [{ role: "user", content: parts }],
      }),
    });
    expect(legacyResponse.status, await legacyResponse.clone().text()).toBe(200);
    await expect(legacyResponse.text()).resolves.toContain("parity context complete");

    const { agent, access } = await createMemberConversationAgent(
      `agent-parity-context-${suffix}`,
      `agent-parity-context-chat-${suffix}`,
      routeId,
      ["skill-4", "skill-2", "skill-1"],
    );
    const agentResponse = await runAgentTurn(agent, [{
      id: `agent-parity-context-user-${suffix}`,
      role: "user",
      parts,
    }], "turn_parity-context-123", access);
    expect(agentResponse.status).toBe(200);
    expect(agentResponse.contentType).toContain("text/event-stream");
    expect(agentResponse.body).toContain("parity context complete");
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    expect(providerBodies).toHaveLength(2);
    for (const providerBody of providerBodies) {
      const serialized = JSON.stringify(providerBody);
      expect(serialized).toContain("<attached_file name=\\\"notes.md\\\" mediaType=\\\"text/markdown\\\" bytes=\\\"7\\\">");
      expect(serialized).toContain("# Notes");
      expect(serialized).not.toContain("data:text/markdown;base64");
      expect(serialized.indexOf("instruction-2")).toBeLessThan(serialized.indexOf("instruction-4"));
      expect(serialized).not.toContain("instruction-1");
    }

    const attempts = await env.PROVIDER_ATTEMPT_LEDGER.getByName(providerId).listRecent({ limit: 10 });
    expect(attempts).toHaveLength(2);
    expect(attempts.every((attempt) => (
      attempt.runKind === "main_answer"
      && attempt.logicalRouteId === routeId
      && attempt.providerId === providerId
      && attempt.model === model
      && attempt.status === "succeeded"
    ))).toBe(true);
    expect(new Set(attempts.map(({ turnId }) => turnId))).toHaveProperty("size", 2);
    expect(new Set(attempts.map(({ runId }) => runId))).toHaveProperty("size", 2);
    expect(new Set(attempts.map(({ attemptId }) => attemptId))).toHaveProperty("size", 2);
  });

  it("keeps legacy and TeamAgent builtin tool results and continuation attempts in parity", async () => {
    const suffix = crypto.randomUUID();
    const providerId = `parity-tool-${suffix}`;
    const routeId = `parity-tool-${suffix}`;
    const model = "parity-tool-model";
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      providers: {
        [providerId]: {
          label: "Parity tool provider",
          type: "openai-chat",
          baseUrl: `https://${providerId}.example/v1`,
          apiKey: "parity-tool-key",
          supportsTools: true,
        },
      },
      routes: {
        [routeId]: {
          label: "Parity tool route",
          offerings: [{ providerId, model, supportsTools: true }],
          supportsTools: true,
        },
      },
      defaults: {
        defaultRoute: routeId,
        allowedRoutes: [routeId],
        allowedSkills: ["analyze"],
        allowedTools: ["builtin:text_stats"],
      },
      skills: {
        analyze: {
          enabled: true,
          label: "Analyze",
          instructions: "Use text statistics when the user asks for counts.",
          toolIds: ["builtin:text_stats"],
        },
      },
      tools: {
        "builtin:text_stats": {
          enabled: true,
          label: "Text stats",
          inputSchema: {
            type: "object",
            properties: { text: { type: "string" } },
            required: ["text"],
            additionalProperties: false,
          },
          executor: { type: "builtin", name: "text_stats" },
        },
      },
    }));
    const providerBodies: any[] = [];
    let legacyCalls = 0;
    let agentCalls = 0;
    const toolInput = { text: "hello world\nagain" };
    const toolResult = { characters: 17, codePoints: 17, words: 3, lines: 2 };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const body = JSON.parse(String(init?.body || "{}"));
      providerBodies.push(body);
      if (body.stream === false) {
        legacyCalls += 1;
        if (legacyCalls === 1) {
          const name = body.tools[0].function.name;
          return new Response(JSON.stringify({
            choices: [{
              message: {
                role: "assistant",
                content: null,
                tool_calls: [{
                  id: "call-legacy-parity-text-stats",
                  type: "function",
                  function: { name, arguments: JSON.stringify(toolInput) },
                }],
              },
              finish_reason: "tool_calls",
            }],
          }), { headers: { "Content-Type": "application/json" } });
        }
        return new Response(JSON.stringify({
          choices: [{ message: { role: "assistant", content: "tool parity complete" }, finish_reason: "stop" }],
        }), { headers: { "Content-Type": "application/json" } });
      }
      agentCalls += 1;
      return agentCalls === 1
        ? openAiUiToolCallResponse(body.tools[0].function.name, toolInput, model)
        : openAiUiTextResponse("tool parity complete", model);
    });

    const legacy = await login(`legacy-parity-tool-${suffix}`);
    const legacyResponse = await apiRequest("/api/chat", legacy.cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Chatus-Client": "web" },
      body: JSON.stringify({
        routeId,
        chatId: `legacy-parity-tool-chat-${suffix}`,
        skillIds: ["analyze"],
        messages: [{ role: "user", content: "统计 hello world 和 again" }],
      }),
    });
    expect(legacyResponse.status).toBe(200);
    const legacyEvents = await readCapabilityEvents(legacyResponse);
    const legacyTool = legacyEvents.find((event) => (
      event.type === "tool" && event.event?.status === "completed"
    ));
    expect(legacyTool?.event?.toolId).toBe("builtin:text_stats");
    expect(JSON.parse(legacyTool.event.resultPreview)).toEqual(toolResult);
    expect(legacyEvents).toContainEqual({ type: "assistant_delta", text: "tool parity complete" });

    const { agent, access } = await createMemberConversationAgent(
      `agent-parity-tool-${suffix}`,
      `agent-parity-tool-chat-${suffix}`,
      routeId,
      ["analyze"],
    );
    const agentResponse = await runAgentTurn(agent, [{
      id: `agent-parity-tool-user-${suffix}`,
      role: "user",
      parts: [{ type: "text", text: "统计 hello world 和 again" }],
    }], "turn_parity-tool-123", access);
    expect(agentResponse.status).toBe(200);
    expect(agentResponse.body).toContain("text_stats_");
    expect(agentResponse.body).toContain("characters");
    expect(agentResponse.body).toContain("tool parity complete");
    expect(fetchSpy).toHaveBeenCalledTimes(4);

    const legacyContinuation = providerBodies.filter(({ stream }) => stream === false)[1];
    const agentContinuation = providerBodies.filter(({ stream }) => stream === true)[1];
    for (const continuation of [legacyContinuation, agentContinuation]) {
      const serialized = JSON.stringify(continuation.messages);
      expect(serialized).toContain("characters");
      expect(serialized).toContain("codePoints");
      expect(serialized).toContain("words");
      expect(serialized).toContain("lines");
      expect(serialized).toContain("17");
      expect(serialized).toContain("3");
      expect(serialized).toContain("2");
    }

    const attempts = await env.PROVIDER_ATTEMPT_LEDGER.getByName(providerId).listRecent({ limit: 10 });
    expect(attempts).toHaveLength(4);
    expect(attempts.map(({ runKind }) => runKind).sort()).toEqual([
      "legacy_capability",
      "main_answer",
      "tool_continuation",
      "tool_continuation",
    ]);
    expect(attempts.every(({ status }) => status === "succeeded")).toBe(true);
    expect(new Set(attempts.map(({ turnId }) => turnId))).toHaveProperty("size", 2);
    expect(new Set(attempts.map(({ runId }) => runId))).toHaveProperty("size", 4);
  });

  it("keeps legacy and TeamAgent one-message member quota denials in parity", async () => {
    const suffix = crypto.randomUUID();
    const providerId = `parity-quota-${suffix}`;
    const routeId = `parity-quota-${suffix}`;
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      providers: {
        [providerId]: {
          label: "Parity quota provider",
          type: "openai-chat",
          baseUrl: `https://${providerId}.example/v1`,
          apiKey: "parity-quota-key",
        },
      },
      routes: {
        [routeId]: {
          label: "Parity quota route",
          offerings: [{ providerId, model: "parity-quota-model" }],
        },
      },
      defaults: {
        defaultRoute: routeId,
        allowedRoutes: [routeId],
        dailyMessageLimit: 1,
        minuteMessageLimit: 10,
      },
    }));
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => (
      openAiUiTextResponse("parity quota admitted", "parity-quota-model")
    ));
    const legacy = await login(`legacy-parity-quota-${suffix}`);
    const legacyRequest = () => apiRequest("/api/chat", legacy.cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Chatus-Client": "web" },
      body: JSON.stringify({ routeId, messages: [{ role: "user", content: "one message only" }] }),
    });
    const legacyFirst = await legacyRequest();
    expect(legacyFirst.status, await legacyFirst.clone().text()).toBe(200);
    await legacyFirst.text();
    const legacySecond = await legacyRequest();
    expect(legacySecond.status).toBe(429);
    await expect(legacySecond.json()).resolves.toMatchObject({ error: "rate_limited", scope: "session" });

    const agentLabel = `agent-parity-quota-${suffix}`;
    const agentChatId = `agent-parity-quota-chat-${suffix}`;
    const { agent, access } = await createMemberConversationAgent(
      agentLabel,
      agentChatId,
      routeId,
    );
    const firstUser: UIMessage = {
      id: `agent-parity-quota-user-1-${suffix}`,
      role: "user",
      parts: [{ type: "text", text: "one message only" }],
    };
    const agentFirst = await runAgentTurn(agent, [firstUser], "turn_parity-quota-123", access);
    expect(agentFirst.status).toBe(200);
    expect(agentFirst.body).toContain("parity quota admitted");
    const agentSecond = await runInDurableObject(agent, async (instance) => {
      await instance.persistMessages([
        firstUser,
        { id: `agent-parity-quota-assistant-${suffix}`, role: "assistant", parts: [{ type: "text", text: "done" }] },
        { id: `agent-parity-quota-user-2-${suffix}`, role: "user", parts: [{ type: "text", text: "second message" }] },
      ], [], { _deleteStaleRows: true });
      const response = await instance.onChatMessage(async () => undefined, {
        requestId: "turn_parity-quota-456",
        body: { [CONVERSATION_AGENT_ACCESS_BODY_KEY]: access },
      });
      return { status: response.status, body: await response.text() };
    });
    expect(agentSecond.status).toBe(429);
    expect(agentSecond.body).toContain("rate_limited");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("keeps legacy and TeamAgent guest route admission denials in parity", async () => {
    const suffix = crypto.randomUUID();
    await configurePublicAccess();
    const guest = await createGuestSession(`parity-guest-source-${suffix}`);
    const stored = await env.CHAT_STORE.get(`session:${sessionToken(guest.cookie)}`, "json") as any;
    if (!stored?.label || !stored?.sourceKey) throw new Error("missing_guest_parity_session");
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const legacyDenied = await guestChat(guest.cookie, MEMBER_ROUTE_ID);
    expect(legacyDenied.status).toBe(403);
    await expect(legacyDenied.json()).resolves.toMatchObject({ error: "route_not_allowed" });

    const [rootInstance, conversationInstance] = await Promise.all([
      getTeamAgentInstanceName(stored.label),
      getTeamAgentConversationInstanceName(stored.label, `guest-parity-chat-${suffix}`),
    ]);
    const guestProps = {
      userLabel: stored.label,
      accessKind: "guest" as const,
      sessionExpiresAt: stored.expiresAt,
      sourceKey: stored.sourceKey,
    };
    const root = await getAgentByName(env.TEAM_AGENT, rootInstance, {
      props: { ...guestProps, scope: "root" as const },
    }) as DurableObjectStub<TeamAgent>;
    const now = Date.now();
    const created = await root.createConversation({
      id: `guest-parity-chat-${suffix}`,
      title: "Guest parity",
      createdAt: now,
      updatedAt: now,
      summary: "",
      pinned: false,
      routeId: MEMBER_ROUTE_ID,
      skillMode: "manual",
      skillIds: [],
    });
    expect(created.ok).toBe(true);
    const agent = await getAgentByName(env.TEAM_AGENT, conversationInstance, {
      props: {
        ...guestProps,
        scope: "conversation" as const,
        chatId: `guest-parity-chat-${suffix}`,
        rootInstance,
      },
    }) as DurableObjectStub<TeamAgent>;
    const agentDenied = await runAgentTurn(agent, [{
      id: `guest-parity-user-${suffix}`,
      role: "user",
      parts: [{ type: "text", text: "do not widen guest access" }],
    }], "turn_parity-guest-123");
    expect(agentDenied.status).toBe(403);
    expect(agentDenied.body).toContain("route_not_allowed");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("keeps legacy and TeamAgent pre-visible fallback telemetry in parity", async () => {
    const suffix = crypto.randomUUID();
    const routeId = `parity-fallback-${suffix}`;
    const primaryId = `parity-primary-${suffix}`;
    const backupId = `parity-backup-${suffix}`;
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      providers: {
        [primaryId]: {
          label: "Parity primary",
          type: "openai-chat",
          baseUrl: `https://${primaryId}.example/v1`,
          apiKey: "parity-primary-key",
          concurrency: "exclusive",
          priority: 100,
        },
        [backupId]: {
          label: "Parity backup",
          type: "openai-chat",
          baseUrl: `https://${backupId}.example/v1`,
          apiKey: "parity-backup-key",
          concurrency: "exclusive",
          priority: 10,
        },
      },
      routes: {
        [routeId]: {
          label: "Parity fallback route",
          offerings: [
            { providerId: primaryId, model: "parity-primary-model" },
            { providerId: backupId, model: "parity-backup-model" },
          ],
        },
      },
      defaults: { defaultRoute: routeId, allowedRoutes: [routeId] },
    }));
    const privateMarker = `PRIVATE_FALLBACK_${suffix}`;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => (
      String(input).includes(primaryId)
        ? new Response(privateMarker, { status: 503 })
        : openAiUiTextResponse("parity fallback complete", "parity-backup-model")
    ));

    const legacy = await login(`legacy-parity-fallback-${suffix}`);
    const legacyResponse = await apiRequest("/api/chat", legacy.cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Chatus-Client": "web" },
      body: JSON.stringify({
        routeId,
        providerId: "forged-provider",
        turnId: `turn_forged-${suffix}`,
        runId: `run_forged-${suffix}`,
        messages: [{ role: "user", content: "use the local fallback" }],
      }),
    });
    expect(legacyResponse.status, await legacyResponse.clone().text()).toBe(200);
    const legacyBody = await legacyResponse.text();
    expect(legacyBody).toContain("parity fallback complete");
    expect(legacyBody).not.toContain(privateMarker);

    const { agent, access } = await createMemberConversationAgent(
      `agent-parity-fallback-${suffix}`,
      `agent-parity-fallback-chat-${suffix}`,
      routeId,
    );
    const agentResponse = await runAgentTurn(agent, [{
      id: `agent-parity-fallback-user-${suffix}`,
      role: "user",
      parts: [{ type: "text", text: "use the local fallback" }],
    }], "turn_parity-fallback-123", access);
    expect(agentResponse.status).toBe(200);
    expect(agentResponse.body).toContain("parity fallback complete");
    expect(agentResponse.body).not.toContain(privateMarker);
    expect(fetchSpy).toHaveBeenCalledTimes(4);
    expect(fetchSpy.mock.calls.filter(([input]) => String(input).includes(primaryId))).toHaveLength(2);
    expect(fetchSpy.mock.calls.filter(([input]) => String(input).includes(backupId))).toHaveLength(2);

    const attempts = [
      ...await env.PROVIDER_ATTEMPT_LEDGER.getByName(primaryId).listRecent({ limit: 10 }),
      ...await env.PROVIDER_ATTEMPT_LEDGER.getByName(backupId).listRecent({ limit: 10 }),
    ];
    expect(attempts).toHaveLength(4);
    const byTurn = new Map<string, typeof attempts>();
    for (const attempt of attempts) {
      const group = byTurn.get(attempt.turnId) || [];
      group.push(attempt);
      byTurn.set(attempt.turnId, group);
    }
    expect(byTurn.size).toBe(2);
    for (const group of byTurn.values()) {
      expect(group).toHaveLength(2);
      expect(new Set(group.map(({ runId }) => runId))).toHaveProperty("size", 1);
      expect(new Set(group.map(({ attemptId }) => attemptId))).toHaveProperty("size", 2);
      expect(group.find(({ providerId }) => providerId === primaryId)).toMatchObject({
        fallbackIndex: 0,
        status: "failed",
        errorClass: "upstream_unavailable",
      });
      expect(group.find(({ providerId }) => providerId === backupId)).toMatchObject({
        fallbackIndex: 1,
        status: "succeeded",
      });
    }
    expect(JSON.stringify(attempts)).not.toContain("forged-");
    await expect(env.CHAT_STORE.get(
      `${PROVIDER_ROUTE_RELIABILITY_PREFIX}${routeId}:${encodeURIComponent(primaryId)}`,
      "json",
    )).resolves.toMatchObject({ attempts: 2, successes: 0, lastOutcome: "upstream_server" });
    await expect(env.CHAT_STORE.get(
      `${PROVIDER_ROUTE_RELIABILITY_PREFIX}${routeId}:${encodeURIComponent(backupId)}`,
      "json",
    )).resolves.toMatchObject({ attempts: 2, successes: 2, lastOutcome: "success" });
  });

  it("keeps legacy and TeamAgent secret-safe Provider error classification in parity", async () => {
    const suffix = crypto.randomUUID();
    const providerId = `parity-error-${suffix}`;
    const routeId = `parity-error-${suffix}`;
    const endpoint = `https://${providerId}.example/v1`;
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      providers: {
        [providerId]: {
          label: "Parity error provider",
          type: "openai-chat",
          baseUrl: endpoint,
          apiKey: "parity-error-key",
        },
      },
      routes: {
        [routeId]: {
          label: "Parity error route",
          offerings: [{ providerId, model: "parity-error-model" }],
        },
      },
      defaults: { defaultRoute: routeId, allowedRoutes: [routeId] },
    }));
    const privateMarker = `PRIVATE_RATE_LIMIT_${suffix}`;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => (
      new Response(privateMarker, { status: 429 })
    ));

    const legacy = await login(`legacy-parity-error-${suffix}`);
    const legacyResponse = await apiRequest("/api/chat", legacy.cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Chatus-Client": "web" },
      body: JSON.stringify({ routeId, messages: [{ role: "user", content: "classify locally" }] }),
    });
    expect(legacyResponse.status).toBe(429);
    const legacyBody = await legacyResponse.text();
    expect(JSON.parse(legacyBody)).toMatchObject({ error: "upstream_rate_limited", status: 429 });

    const { agent, access } = await createMemberConversationAgent(
      `agent-parity-error-${suffix}`,
      `agent-parity-error-chat-${suffix}`,
      routeId,
    );
    const agentResponse = await runAgentTurn(agent, [{
      id: `agent-parity-error-user-${suffix}`,
      role: "user",
      parts: [{ type: "text", text: "classify locally" }],
    }], "turn_parity-error-123", access);
    expect(agentResponse.status).toBe(200);
    expect(agentResponse.body).toContain("upstream_rate_limited");
    expect(agentResponse.body).toContain("上游模型暂时限流，请稍后重试或切换模型。");
    for (const body of [legacyBody, agentResponse.body]) {
      expect(body).not.toContain(privateMarker);
      expect(body).not.toContain(endpoint);
      expect(body).not.toContain("parity-error-key");
    }
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const attempts = await env.PROVIDER_ATTEMPT_LEDGER.getByName(providerId).listRecent({ limit: 10 });
    expect(attempts).toHaveLength(2);
    expect(attempts.every(({ status, errorClass }) => (
      status === "failed" && errorClass === "upstream_rate_limited"
    ))).toBe(true);
  });

  it("keeps legacy and TeamAgent visible-stream cancellation cleanup in parity", async () => {
    const suffix = crypto.randomUUID();
    const providerId = `parity-cancel-${suffix}`;
    const routeId = `parity-cancel-${suffix}`;
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      providers: {
        [providerId]: {
          label: "Parity cancellation provider",
          type: "openai-chat",
          baseUrl: `https://${providerId}.example/v1`,
          apiKey: "parity-cancel-key",
          concurrency: "exclusive",
        },
      },
      routes: {
        [routeId]: {
          label: "Parity cancellation route",
          offerings: [{ providerId, model: "parity-cancel-model" }],
        },
      },
      defaults: { defaultRoute: routeId, allowedRoutes: [routeId] },
    }));
    let upstreamCancellations = 0;
    const encoder = new TextEncoder();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(openAiTextEvent("parity cancellation visible")));
        },
        cancel() {
          upstreamCancellations += 1;
        },
      }),
      { status: 200, headers: { "Content-Type": "text/event-stream" } },
    ));
    const readVisibleAndCancel = async (
      response: Response,
      needle: string,
      abortController?: AbortController,
    ): Promise<string> => {
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let text = "";
      for (let index = 0; index < 20 && !text.includes(needle); index += 1) {
        const next = await reader.read();
        if (next.done) break;
        text += decoder.decode(next.value, { stream: true });
      }
      expect(text).toContain(needle);
      abortController?.abort("parity cancellation");
      await reader.cancel("parity cancellation");
      return text;
    };

    const legacy = await login(`legacy-parity-cancel-${suffix}`);
    const legacyResponse = await worker.fetch(new Request("https://example.test/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Chatus-Client": "web",
        Cookie: legacy.cookie,
      },
      body: JSON.stringify({ routeId, messages: [{ role: "user", content: "cancel after output" }] }),
    }), env);
    expect(legacyResponse.status).toBe(200);
    await readVisibleAndCancel(legacyResponse, "parity cancellation visible");
    await vi.waitFor(async () => {
      await expect(env.PROVIDER_COORDINATOR.getByName(providerId).inspect()).resolves.toMatchObject({ active: 0 });
    });
    await vi.waitFor(async () => {
      const attempts = await env.PROVIDER_ATTEMPT_LEDGER.getByName(providerId).listRecent({ limit: 10 });
      expect(attempts).toHaveLength(1);
      expect(attempts[0]?.status).toBe("cancelled");
    });

    const { agent, access } = await createMemberConversationAgent(
      `agent-parity-cancel-${suffix}`,
      `agent-parity-cancel-chat-${suffix}`,
      routeId,
    );
    await agent.importLegacyMessages([{
      id: `agent-parity-cancel-user-${suffix}`,
      role: "user",
      parts: [{ type: "text", text: "cancel after output" }],
    }]);
    const agentBody = await runInDurableObject(agent, async (instance) => {
      const agentAbortController = new AbortController();
      const response = await instance.onChatMessage(async () => undefined, {
        requestId: "turn_parity-cancel-123",
        abortSignal: agentAbortController.signal,
        body: { [CONVERSATION_AGENT_ACCESS_BODY_KEY]: access },
      });
      return readVisibleAndCancel(response, "parity cancellation visible", agentAbortController);
    });
    expect(agentBody).toContain("parity cancellation visible");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(upstreamCancellations).toBe(2));
    await vi.waitFor(async () => {
      await expect(env.PROVIDER_COORDINATOR.getByName(providerId).inspect()).resolves.toMatchObject({ active: 0 });
    });
    await vi.waitFor(async () => {
      const attempts = await env.PROVIDER_ATTEMPT_LEDGER.getByName(providerId).listRecent({ limit: 10 });
      expect(attempts).toHaveLength(2);
      expect(attempts.every(({ status }) => status === "cancelled")).toBe(true);
    });
  });

  it("isolates TeamAgent instances by authenticated member identity", async () => {
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      routes: {
        default: {
          label: "Default",
          type: "openai-chat",
          baseUrl: "https://agent-session.example/v1",
          model: "agent-session-model",
          apiKey: "agent-session-key",
        },
      },
      defaults: { defaultRoute: "default", allowedRoutes: ["default"] },
    }));
    const first = await login(`member-a-${crypto.randomUUID()}`);
    const second = await login(`member-b-${crypto.randomUUID()}`);
    const firstSession = await (await apiRequest("/api/session", first.cookie)).json() as any;
    const firstAgain = await (await apiRequest("/api/session", first.cookie)).json() as any;
    const secondSession = await (await apiRequest("/api/session", second.cookie)).json() as any;

    expect(firstSession.agent).toMatchObject({
      transport: "cloudflare-ai-chat",
      className: "team-agent",
      basePath: "agent",
    });
    expect(firstSession.agent.instance).toMatch(/^member-[0-9a-f]{48}$/);
    expect(firstAgain.agent.instance).toBe(firstSession.agent.instance);
    expect(secondSession.agent.instance).not.toBe(firstSession.agent.instance);
    expect(firstSession.agent.instance).not.toContain(first.label);
    expect(secondSession.agent.instance).not.toContain(second.label);

    const firstChat = await getTeamAgentConversationInstanceName(first.label, "chat-a");
    const firstOtherChat = await getTeamAgentConversationInstanceName(first.label, "chat-b");
    const secondChat = await getTeamAgentConversationInstanceName(second.label, "chat-a");
    expect(firstChat).toMatch(/^chat-[0-9a-f]{48}$/);
    expect(firstOtherChat).not.toBe(firstChat);
    expect(secondChat).not.toBe(firstChat);
    expect(firstChat).not.toContain(first.label);

    const unauthorized = await exports.default.fetch(new Request("https://example.test/agent"));
    expect(unauthorized.status).toBe(401);
    const crossOrigin = await apiRequest("/agent", first.cookie, { headers: { Origin: "https://evil.example" } });
    expect(crossOrigin.status).toBe(403);
    await expect(crossOrigin.json()).resolves.toMatchObject({ error: "invalid_origin" });
    const missingChat = await apiRequest("/agent", first.cookie);
    expect(missingChat.status).toBe(400);
    await expect(missingChat.json()).resolves.toMatchObject({ error: "invalid_chat_id" });
  });

  it("persists an image at the projected per-image limit without truncating its file part", async () => {
    const label = `agent-image-limit-${crypto.randomUUID()}`;
    const chatId = `image-limit-${crypto.randomUUID()}`;
    const agent = await getConversationAgent(label, chatId);
    const base64 = `${"A".repeat(1_733_334)}==`;
    const imported = await agent.importLegacyMessages([{
      id: "image-limit-user",
      role: "user",
      parts: [{
        type: "file",
        mediaType: "image/png",
        filename: "limit.png",
        url: `data:image/png;base64,${base64}`,
      }],
    }]);
    expect(imported).toEqual({ imported: true, messageCount: 1 });
    const stored = await runInDurableObject(agent, async (_instance, state) => {
      const [row] = state.storage.sql.exec<{ bytes: number }>(
        "SELECT length(message) AS bytes FROM cf_ai_chat_agent_messages WHERE id = 'image-limit-user'",
      ).toArray();
      return row?.bytes || 0;
    });
    expect(stored).toBeGreaterThan(base64.length);
    await evictDurableObject(agent);
    const restored = await getConversationAgent(label, chatId);
    await expect(restored.getConversationMessageCount()).resolves.toBe(1);
    const [restoredMessage] = await getPersistedAgentMessages(restored);
    const restoredFile = restoredMessage?.parts.find((part) => part.type === "file");
    expect(restoredFile).toMatchObject({
      type: "file",
      mediaType: "image/png",
      filename: "limit.png",
    });
    expect(restoredFile?.type === "file" ? restoredFile.url.length : 0)
      .toBe("data:image/png;base64,".length + base64.length);
  });

  it("removes a forged Agent image turn and returns an exact error before provider execution", async () => {
    const label = `agent-image-reject-${crypto.randomUUID()}`;
    const chatId = `image-reject-${crypto.randomUUID()}`;
    await reserveNativeTestPrincipal(label);
    const agent = await getConversationAgent(label, chatId);
    const access = await ownerConversationAccessContext(label, chatId);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const rejected = await runInDurableObject(agent, async (instance) => {
      await instance.persistMessages([{
        id: "forged-image-user",
        role: "user",
        parts: [
          { type: "text", text: "do not execute this turn" },
          { type: "file", mediaType: "image/png", filename: "remote.png", url: "https://example.test/image.png" },
        ],
      }], [], { _deleteStaleRows: true });
      const response = await instance.onChatMessage(async () => undefined, {
        body: { [CONVERSATION_AGENT_ACCESS_BODY_KEY]: access },
      });
      return { status: response.status, body: await response.text() };
    });
    expect(rejected.status).toBe(400);
    expect(rejected.body).toContain("invalid_image_data");
    expect(fetchSpy).not.toHaveBeenCalled();
    await expect(agent.getConversationMessageCount()).resolves.toBe(0);
  });

  it("projects Automatic Skill budget denial through the TeamAgent SSE envelope", async () => {
    const providerId = `agent-budget-${crypto.randomUUID()}`;
    const endpoint = `https://${providerId}.example/v1`;
    const routeId = "agent-budget";
    const model = "agent-budget-model";
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      providers: {
        [providerId]: {
          label: "Agent budget provider",
          type: "openai-chat",
          baseUrl: endpoint,
          apiKeyRef: "TEST_ROUTE_KEY",
        },
      },
      routes: {
        [routeId]: { label: "Agent budget route", offerings: [{ providerId, model }] },
      },
      defaults: {
        defaultRoute: routeId,
        allowedRoutes: [routeId],
        allowedSkills: ["automatic-budget-skill"],
      },
      skills: {
        "automatic-budget-skill": {
          enabled: true,
          label: "Automatic budget Skill",
          description: "Selected only by the local fake selector.",
          instructions: "Use the selected Skill.",
          toolIds: [],
        },
      },
      tools: {},
      mcpServers: {},
    }));
    await seedHardProviderBudget({ providerId, routeId, model, knownPrice: false });
    const label = `agent-budget-member-${crypto.randomUUID()}`;
    const chatId = `agent-budget-chat-${crypto.randomUUID()}`;
    await reserveNativeTestPrincipal(label);
    const root = await getRootAgent(label);
    await root.createConversation({
      id: chatId,
      title: "Agent budget SSE",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      summary: "",
      pinned: false,
      routeId,
      skillMode: "automatic",
      skillIds: [],
    });
    const agent = await getConversationAgent(label, chatId);
    const access = await ownerConversationAccessContext(label, chatId);
    await agent.importLegacyMessages([{
      id: "agent-budget-user",
      role: "user",
      parts: [{ type: "text", text: "Select a Skill without calling the Provider." }],
    }] as UIMessage[]);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const requestId = "turn_budget-123";
    const result = await runInDurableObject(agent, async (instance) => {
      const response = await instance.onChatMessage(async () => undefined, {
        requestId,
        body: { [CONVERSATION_AGENT_ACCESS_BODY_KEY]: access },
      });
      return {
        status: response.status,
        requestId: response.headers.get("X-Request-ID"),
        contentType: response.headers.get("Content-Type"),
        body: await response.text(),
      };
    });
    expect(result.status).toBe(503);
    expect(result.requestId).toBe(requestId);
    expect(result.contentType).toContain("text/event-stream");
    expect(result.body).toContain("provider_budget_policy_unknown");
    expect(result.body).toContain("当前 Provider 缺少可验证的价格策略，请联系管理员完成配置。");
    expect(result.body).not.toContain(providerId);
    expect(result.body).not.toContain(endpoint);
    expect(result.body).not.toContain("TEST_ROUTE_KEY");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects cross-origin authenticated mutations before admin or user dispatch", async () => {
    const adminCookie = await adminLogin();
    const adminSessionKey = `admin:${adminCookie.slice("chatus_admin=".length)}`;
    const currentConfig = await apiRequest("/api/admin/config", adminCookie).then((response) => response.json()) as any;
    const currentMembers = await apiRequest("/api/admin/members", adminCookie).then((response) => response.json()) as any;
    await env.CHAT_STORE.put(`${ROUTE_SECRET_PREFIX}BLOCKED_ROUTE`, "sentinel-route");
    await env.CHAT_STORE.put(`${MCP_SECRET_PREFIX}BLOCKED_MCP`, "sentinel-mcp");

    const attempts: Array<{ path: string; init: RequestInit }> = [
      {
        path: "/api/admin/logout",
        init: { method: "POST" },
      },
      {
        path: "/api/admin/config",
        init: {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ config: currentConfig.config, expectedRevision: currentConfig.revision }),
        },
      },
      {
        path: "/api/admin/route-secrets/BLOCKED_ROUTE",
        init: {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apiKey: "should-not-save" }),
        },
      },
      {
        path: "/api/admin/route-secrets/BLOCKED_ROUTE",
        init: { method: "DELETE", headers: { "Content-Type": "application/json" }, body: "{}" },
      },
      {
        path: "/api/admin/mcp-secrets/BLOCKED_MCP",
        init: {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ secret: "should-not-save" }),
        },
      },
      {
        path: "/api/admin/mcp-secrets/BLOCKED_MCP",
        init: { method: "DELETE", headers: { "Content-Type": "application/json" }, body: "{}" },
      },
      {
        path: "/api/admin/members",
        init: {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label: "blocked-member", expectedAccessRevision: currentMembers.accessRevision }),
        },
      },
      {
        path: "/api/admin/members/blocked-member/access-code",
        init: {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expectedAccessRevision: currentMembers.accessRevision }),
        },
      },
      {
        path: "/api/admin/members/blocked-member/config",
        init: {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expectedConfigRevision: currentConfig.revision }),
        },
      },
    ];

    for (const attempt of attempts) {
      const headers = new Headers(attempt.init.headers);
      headers.set("Origin", "https://evil.example");
      const response = await apiRequest(attempt.path, adminCookie, { ...attempt.init, headers });
      expect(response.status, attempt.path).toBe(403);
      await expect(response.json(), attempt.path).resolves.toMatchObject({ error: "invalid_origin" });
      if (attempt.path === "/api/admin/logout") expect(response.headers.get("Set-Cookie")).toBeNull();
    }

    await expect(env.CHAT_STORE.get(adminSessionKey)).resolves.not.toBeNull();
    expect((await apiRequest("/api/admin/session", adminCookie)).status).toBe(200);

    await expect(env.CHAT_STORE.get(ACCESS_CODES_KEY)).resolves.toBeNull();

    const member = await login(`origin-member-${crypto.randomUUID()}`);
    const memory = await apiRequest("/api/agent/memory", member.cookie).then((response) => response.json()) as any;
    const memberMutation = await apiRequest("/api/agent/memory", member.cookie, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
      body: JSON.stringify({ memory: "should-not-save", expectedRevision: memory.revision }),
    });
    expect(memberMutation.status).toBe(403);
    await expect(memberMutation.json()).resolves.toMatchObject({ error: "invalid_origin" });
    await expect(apiRequest("/api/agent/memory", member.cookie).then((response) => response.json()))
      .resolves.toMatchObject({ memory: "", revision: memory.revision });

    await expect(env.CHAT_STORE.get(ROUTES_CONFIG_KEY)).resolves.toBeNull();
    await expect(env.CHAT_STORE.get(`${ROUTE_SECRET_PREFIX}BLOCKED_ROUTE`)).resolves.toBe("sentinel-route");
    await expect(env.CHAT_STORE.get(`${MCP_SECRET_PREFIX}BLOCKED_MCP`)).resolves.toBe("sentinel-mcp");
    await expect(env.CHAT_STORE.get(ADMIN_AUDIT_KEY)).resolves.toBeNull();
  });

  it("revokes an admin session before clearing the cookie and fails closed when KV deletion fails", async () => {
    const adminCookie = await adminLogin();
    const adminToken = adminCookie.slice("chatus_admin=".length);
    const adminKey = `admin:${adminToken}`;
    await expect(env.CHAT_STORE.get(adminKey)).resolves.not.toBeNull();

    const failingStore = new Proxy(env.CHAT_STORE, {
      get(target, property) {
        if (property === "delete") {
          return async (key: string) => {
            if (key === adminKey) throw new Error("synthetic_admin_delete_failure");
            return target.delete(key);
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const failed = await worker.fetch(new Request("https://example.test/api/admin/logout", {
      method: "POST",
      headers: { Cookie: adminCookie },
    }), { ...env, CHAT_STORE: failingStore });
    expect(failed.status).toBe(500);
    expect(failed.headers.get("Set-Cookie")).toBeNull();
    await expect(env.CHAT_STORE.get(adminKey)).resolves.not.toBeNull();
    expect((await apiRequest("/api/admin/session", adminCookie)).status).toBe(200);

    const revoked = await apiRequest("/api/admin/logout", adminCookie, { method: "POST" });
    expect(revoked.status).toBe(200);
    await expect(revoked.json()).resolves.toEqual({ ok: true });
    expect(revoked.headers.get("Set-Cookie")).toContain("chatus_admin=");
    expect(revoked.headers.get("Set-Cookie")).toContain("Max-Age=0");
    await expect(env.CHAT_STORE.get(adminKey)).resolves.toBeNull();
    expect((await apiRequest("/api/admin/session", adminCookie)).status).toBe(401);
  });

  it("revokes a member session before clearing the cookie and fails closed when KV deletion fails", async () => {
    const { cookie } = await login(`logout-member-${crypto.randomUUID()}`);
    const sessionKey = `session:${sessionToken(cookie)}`;
    await expect(env.CHAT_STORE.get(sessionKey)).resolves.not.toBeNull();

    const failingStore = new Proxy(env.CHAT_STORE, {
      get(target, property) {
        if (property === "delete") {
          return async (key: string) => {
            if (key === sessionKey) throw new Error("synthetic_member_delete_failure");
            return target.delete(key);
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const failed = await worker.fetch(new Request("https://example.test/api/logout", {
      method: "POST",
      headers: { Cookie: cookie },
    }), { ...env, CHAT_STORE: failingStore });
    expect(failed.status).toBe(500);
    expect(failed.headers.get("Set-Cookie")).toBeNull();
    await expect(env.CHAT_STORE.get(sessionKey)).resolves.not.toBeNull();
    expect((await apiRequest("/api/session", cookie)).status).toBe(200);

    const revoked = await apiRequest("/api/logout", cookie, { method: "POST" });
    expect(revoked.status).toBe(200);
    await expect(revoked.json()).resolves.toEqual({ ok: true });
    expect(revoked.headers.get("Set-Cookie")).toContain("chatus_session=");
    expect(revoked.headers.get("Set-Cookie")).toContain("Max-Age=0");
    await expect(env.CHAT_STORE.get(sessionKey)).resolves.toBeNull();
    expect((await apiRequest("/api/session", cookie)).status).toBe(401);
  });

  it("restores private TeamAgent identity after Durable Object eviction", async () => {
    const label = `agent-wake-${crypto.randomUUID()}`;
    const chatId = `chat-wake-${crypto.randomUUID()}`;
    const root = await getRootAgent(label);
    const conversation = await getConversationAgent(label, chatId);

    await expect(root.getMemory()).resolves.toMatchObject({ memory: "" });
    await expect(conversation.getConversationMessageCount()).resolves.toBe(0);
    await evictDurableObject(root);
    await evictDurableObject(conversation);

    const [rootInstance, conversationInstance] = await Promise.all([
      getTeamAgentInstanceName(label),
      getTeamAgentConversationInstanceName(label, chatId),
    ]);
    const restoredRoot = await getAgentByName(env.TEAM_AGENT, rootInstance) as DurableObjectStub<TeamAgent>;
    const restoredConversation = await getAgentByName(
      env.TEAM_AGENT,
      conversationInstance,
    ) as DurableObjectStub<TeamAgent>;

    await expect(restoredRoot.getMemory()).resolves.toMatchObject({ memory: "" });
    await expect(restoredConversation.getConversationMessageCount()).resolves.toBe(0);
  });

  it("keeps transcripts isolated between conversations owned by the same member", async () => {
    const label = `agent-conversation-isolation-${crypto.randomUUID()}`;
    const first = await getConversationAgent(label, `first-${crypto.randomUUID()}`);
    const second = await getConversationAgent(label, `second-${crypto.randomUUID()}`);

    await first.importLegacyMessages([{
      id: "first-user",
      role: "user",
      parts: [{ type: "text", text: "first conversation only" }],
    }]);
    await second.importLegacyMessages([{
      id: "second-user",
      role: "user",
      parts: [{ type: "text", text: "second conversation only" }],
    }]);

    const [firstExport, secondExport] = await Promise.all([
      first.exportMessages(),
      second.exportMessages(),
    ]);
    expect(firstExport.messages).toEqual([
      expect.objectContaining({ id: "first-user" }),
    ]);
    expect(secondExport.messages).toEqual([
      expect.objectContaining({ id: "second-user" }),
    ]);
    expect(JSON.stringify(firstExport.messages)).not.toContain("second conversation only");
    expect(JSON.stringify(secondExport.messages)).not.toContain("first conversation only");
  });

  it("bootstraps identity for an already-started Agent without initialization props", async () => {
    const label = `agent-bootstrap-${crypto.randomUUID()}`;
    const instance = await getTeamAgentInstanceName(label);
    const agent = await getAgentByName(env.TEAM_AGENT, instance) as DurableObjectStub<TeamAgent>;

    await expect(agent.healthCheck()).resolves.toMatchObject({ ok: true });
    await expect(agent.ensureIdentity({ userLabel: label, scope: "root" })).resolves.toEqual({ ok: true });
    await expect(agent.getMemory()).resolves.toMatchObject({ memory: "" });
    await evictDurableObject(agent);

    const restored = await getAgentByName(env.TEAM_AGENT, instance) as DurableObjectStub<TeamAgent>;
    await expect(restored.getMemory()).resolves.toMatchObject({ memory: "" });
  });

  it("rejects conflicting TeamAgent identity without replacing the original scope", async () => {
    const label = `agent-identity-${crypto.randomUUID()}`;
    const root = await getRootAgent(label);

    await expect(root.ensureIdentity({
      userLabel: label,
      scope: "conversation",
      chatId: `conflict-${crypto.randomUUID()}`,
      rootInstance: await getTeamAgentInstanceName(label),
    })).resolves.toEqual({ ok: false, error: "agent_identity_conflict" });
    await expect(root.getMemory()).resolves.toMatchObject({ memory: "" });
  });

  it("advances stable TeamAgent registry revisions without changing the resource binding", async () => {
    const label = `agent-stable-revision-${crypto.randomUUID()}`;
    const chatId = `stable-revision-${crypto.randomUUID()}`;
    const principal = await reserveNativeTestPrincipal(label);
    const conversation = await getConversationAgent(label, chatId);
    const resource = await env.IDENTITY_REGISTRY.getByName(IDENTITY_REGISTRY_INSTANCE_NAME)
      .resolveConversationResource({
        version: 1,
        principalId: principal.principalId,
        conversationId: chatId,
      });
    const marker = {
      ...stablePrincipalTestMarker(principal),
      scope: "conversation" as const,
      resourceId: resource.resourceId,
      resourceRegistryRevision: resource.registryRevision,
      pinnedInstanceName: resource.agentInstanceName,
    };

    const initial = await conversation.ensureStableIdentity(marker);
    const advanced = await conversation.ensureStableIdentity({
      ...marker,
      resourceRegistryRevision: marker.resourceRegistryRevision + 1,
    });
    expect(advanced.digest).not.toBe(initial.digest);
  });

  it("fails closed when pinned principal or conversation routes drift", async () => {
    const legacyAlias = `identity-parity-${crypto.randomUUID().slice(0, 12)}`;
    const legacyPrincipal: PrincipalRouteV1 = {
      version: 1,
      principalId: `prn_${crypto.randomUUID()}`,
      alias: legacyAlias,
      origin: "legacy",
      lifecycleState: "active",
      migrationState: "authoritative",
      rootInstanceName: await getTeamAgentInstanceName(legacyAlias),
      userStateInstanceName: legacyAlias,
      registryRevision: 3,
    };
    await expect(assertPrincipalRouteParity(legacyPrincipal)).resolves.toBeUndefined();
    await expect(assertPrincipalRouteParity({
      ...legacyPrincipal,
      rootInstanceName: "member-wrong-root",
    })).rejects.toThrow("identity_principal_route_conflict");

    const legacyResource: ConversationResourceRouteV1 = {
      version: 1,
      resourceId: `res_${crypto.randomUUID()}`,
      principalId: legacyPrincipal.principalId,
      conversationId: `conversation-${crypto.randomUUID()}`,
      migrationState: "authoritative",
      agentInstanceName: "",
      registryRevision: 3,
    };
    legacyResource.agentInstanceName = await getTeamAgentConversationInstanceName(
      legacyAlias,
      legacyResource.conversationId,
    );
    await expect(assertConversationRouteParity(legacyPrincipal, legacyResource)).resolves.toBeUndefined();
    await expect(assertConversationRouteParity(legacyPrincipal, {
      ...legacyResource,
      agentInstanceName: "conversation-wrong-route",
    })).rejects.toThrow("identity_resource_route_conflict");

    const nativePrincipal: PrincipalRouteV1 = {
      ...legacyPrincipal,
      principalId: `prn_${crypto.randomUUID()}`,
      alias: `identity-native-${crypto.randomUUID().slice(0, 12)}`,
      origin: "native",
      rootInstanceName: "",
      userStateInstanceName: "",
    };
    nativePrincipal.rootInstanceName = principalRootInstanceName(nativePrincipal.principalId);
    nativePrincipal.userStateInstanceName = principalUserStateInstanceName(nativePrincipal.principalId);
    const nativeResource: ConversationResourceRouteV1 = {
      ...legacyResource,
      resourceId: `res_${crypto.randomUUID()}`,
      principalId: nativePrincipal.principalId,
      agentInstanceName: "",
    };
    nativeResource.agentInstanceName = conversationResourceInstanceName(nativeResource.resourceId);
    await expect(assertPrincipalRouteParity(nativePrincipal)).resolves.toBeUndefined();
    await expect(assertConversationRouteParity(nativePrincipal, nativeResource)).resolves.toBeUndefined();
  });

  it("keeps a pre-registry conversation usable after principal authority advances", async () => {
    const label = `identity-existing-${crypto.randomUUID().slice(0, 12)}`;
    const conversationId = `identity-existing-chat-${crypto.randomUUID()}`;
    const root = await getRootAgent(label);
    const now = Date.now();
    const created = await root.createConversation({
      id: conversationId,
      title: "Existing conversation",
      createdAt: now,
      updatedAt: now,
      summary: "",
      pinned: false,
      routeId: "default",
      skillMode: "manual",
      skillIds: [],
    });
    expect(created.ok).toBe(true);
    await getConversationAgent(label, conversationId);

    const member = await login(label);
    const principal = await resolveTestPrincipal(label);
    expect(principal).toMatchObject({ migrationState: "authoritative", registryRevision: 3 });
    const response = await apiRequest(
      `/api/agent/conversations/${encodeURIComponent(conversationId)}?expectedUpdatedAt=${created.conversation?.updatedAt}`,
      member.cookie,
      { method: "DELETE" },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, deleted: true, cleanupPending: false });
  });

  it("rejects an established member Agent turn after its alias is retired", async () => {
    const member = await login(`identity-retired-turn-${crypto.randomUUID().slice(0, 12)}`);
    const principal = await resolveTestPrincipal(member.label);
    if (!principal) throw new Error("missing_identity_test_principal");
    const conversationId = `identity-retired-turn-chat-${crypto.randomUUID()}`;
    const root = await getRootAgent(member.label);
    const now = Date.now();
    const created = await root.createConversation({
      id: conversationId,
      title: "Retired connection",
      createdAt: now,
      updatedAt: now,
      summary: "",
      pinned: false,
      routeId: "default",
      skillMode: "manual",
      skillIds: [],
    });
    expect(created.ok).toBe(true);
    const agent = await getConversationAgent(member.label, conversationId);
    const access = await ownerConversationAccessContext(member.label, conversationId);
    await agent.importLegacyMessages([{ id: "retired-turn-message", role: "user", parts: [{ type: "text", text: "blocked" }] }]);
    await env.IDENTITY_REGISTRY.getByName(IDENTITY_REGISTRY_INSTANCE_NAME).retirePrincipalAlias({
      version: 1,
      operationId: `retired-turn:${crypto.randomUUID()}`,
      principalId: principal.principalId,
      alias: member.label,
      retiredAt: Date.now(),
    });
    const providerFetch = vi.spyOn(globalThis, "fetch");
    const response = await runInDurableObject(agent, (instance) => (
      instance.onChatMessage(async () => undefined, {
        requestId: `retired-turn-${crypto.randomUUID()}`,
        body: { [CONVERSATION_AGENT_ACCESS_BODY_KEY]: access },
      })
    ));
    expect(response.status).toBe(401);
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("persists only the safe truncated-output marker from Agent message metadata", async () => {
    const label = `agent-metadata-${crypto.randomUUID()}`;
    const conversation = await getConversationAgent(label, `metadata-${crypto.randomUUID()}`);
    await conversation.importLegacyMessages([
      {
        id: "assistant-length",
        role: "assistant",
        metadata: {
          finishReason: "length",
          providerTrace: "sensitive-metadata-marker",
          internal: { credentialReference: "omit" },
        },
        parts: [{ type: "text", text: "truncated response" }],
      },
      {
        id: "assistant-stop",
        role: "assistant",
        metadata: { finishReason: "stop", providerTrace: "sensitive-metadata-marker" },
        parts: [{ type: "text", text: "complete response" }],
      },
      {
        id: "user-web-research",
        role: "user",
        metadata: {
          capabilityIds: ["chatus:web_research"],
          privateQueryMarker: "must-not-persist",
        },
        parts: [{ type: "text", text: "Find current release notes" }],
      },
      {
        id: "assistant-web-research",
        role: "assistant",
        metadata: {
          webResearch: {
            version: 1,
            sources: [{ url: "https://example.com/release", title: "Release notes", snippet: "Current facts" }],
          },
          providerTrace: "sensitive-metadata-marker",
        },
        parts: [{ type: "text", text: "The current release is documented." }],
      },
    ] as UIMessage[]);

    const persisted = await getPersistedAgentMessages(conversation);
    expect(persisted.find((message) => message.id === "assistant-length")?.metadata).toEqual({
      finishReason: "length",
    });
    expect(persisted.find((message) => message.id === "assistant-stop")).not.toHaveProperty("metadata");
    expect(persisted.find((message) => message.id === "user-web-research")?.metadata).toEqual({
      capabilityIds: ["chatus:web_research"],
    });
    expect(persisted.find((message) => message.id === "assistant-web-research")?.metadata).toEqual({
      webResearch: {
        version: 1,
        sources: [{ url: "https://example.com/release", title: "Release notes", snippet: "Current facts" }],
      },
    });
    expect(JSON.stringify(persisted)).not.toContain("sensitive-metadata-marker");
    expect(JSON.stringify(persisted)).not.toContain("credentialReference");
    expect(JSON.stringify(persisted)).not.toContain("privateQueryMarker");
  });

  it("defaults new member conversations to automatic while preserving exact manual Skills", async () => {
    const label = `agent-skill-default-${crypto.randomUUID()}`;
    const config = {
      routes: {
        default: {
          label: "Default",
          type: "openai-chat",
          baseUrl: "https://skill-default.example/v1",
          model: "skill-default-model",
        },
      },
      defaults: { defaultRoute: "default", allowedRoutes: ["default"] },
      users: { [label]: { displayName: "Skill default tester" } },
      skills: {
        disabled: {
          enabled: false,
          label: "Disabled",
          instructions: "Disabled instructions",
          toolIds: [],
          order: 0,
        },
        alpha: {
          enabled: true,
          label: "Alpha",
          instructions: "Alpha instructions",
          toolIds: [],
          order: 1,
        },
        beta: {
          enabled: true,
          label: "Beta",
          instructions: "Beta instructions",
          toolIds: [],
          order: 2,
        },
        gamma: {
          enabled: true,
          label: "Gamma",
          instructions: "Gamma instructions",
          toolIds: [],
          order: 3,
        },
        delta: {
          enabled: true,
          label: "Delta",
          instructions: "Delta instructions",
          toolIds: [],
          order: 4,
        },
      },
      tools: {},
      mcpServers: {},
    };
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify(config));
    const { cookie } = await login(label);

    const createConversation = async (body: Record<string, unknown>) => {
      const response = await apiRequest("/api/agent/conversations", cookie, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return { response, payload: await response.clone().json() as any };
    };

    const omitted = await createConversation({ title: "Server default" });
    expect(omitted.response.status).toBe(201);
    expect(omitted.payload.conversation).toMatchObject({ skillMode: "automatic", skillIds: [] });

    const explicitEmpty = await createConversation({ title: "Explicit empty", skillMode: "manual", skillIds: [] });
    expect(explicitEmpty.response.status).toBe(201);
    expect(explicitEmpty.payload.conversation).toMatchObject({ skillMode: "manual", skillIds: [] });

    const explicitSelection = await createConversation({
      title: "Explicit selection",
      skillMode: "manual",
      skillIds: ["delta", "beta", "delta"],
    });
    expect(explicitSelection.response.status).toBe(201);
    expect(explicitSelection.payload.conversation).toMatchObject({
      skillMode: "manual",
      skillIds: ["delta", "beta"],
    });

    const unauthorized = await createConversation({ skillIds: ["missing"] });
    expect(unauthorized.response.status).toBe(403);
    expect(unauthorized.payload).toMatchObject({ error: "skill_not_allowed" });

    const preservedResponse = await apiRequest(
      `/api/agent/conversations/${encodeURIComponent(explicitSelection.payload.conversation.id)}`,
      cookie,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Still explicit",
          expectedUpdatedAt: explicitSelection.payload.conversation.updatedAt,
        }),
      },
    );
    expect(preservedResponse.status).toBe(200);
    const preserved = await preservedResponse.json() as any;
    expect(preserved.conversation.skillIds).toEqual(["delta", "beta"]);

    const clearedResponse = await apiRequest(
      `/api/agent/conversations/${encodeURIComponent(preserved.conversation.id)}`,
      cookie,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skillMode: "manual",
          skillIds: [],
          expectedUpdatedAt: preserved.conversation.updatedAt,
        }),
      },
    );
    expect(clearedResponse.status).toBe(200);
    await expect(clearedResponse.json()).resolves.toMatchObject({ conversation: { skillIds: [] } });

    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      ...config,
      users: { [label]: { displayName: "Skill default tester", allowedSkills: ["delta", "beta"] } },
    }));
    const assigned = await createConversation({ title: "Assigned subset", skillMode: "manual" });
    expect(assigned.response.status).toBe(201);
    expect(assigned.payload.conversation).toMatchObject({ skillMode: "manual", skillIds: ["beta", "delta"] });

    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      ...config,
      users: { [label]: { displayName: "Skill default tester", allowedSkills: [] } },
    }));
    const denied = await createConversation({ title: "Denied Skills", skillMode: "manual" });
    expect(denied.response.status).toBe(201);
    expect(denied.payload.conversation).toMatchObject({ skillMode: "manual", skillIds: [] });
  });

  it("imports legacy chats and memory into Agent storage exactly once", async () => {
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      routes: {
        default: {
          label: "Default",
          type: "openai-chat",
          baseUrl: "https://agent-import.example/v1",
          model: "agent-import-model",
          apiKey: "agent-import-key",
        },
      },
      defaults: { defaultRoute: "default", allowedRoutes: ["default"] },
    }));
    const { cookie, label } = await login(`agent-import-${crypto.randomUUID()}`);
    const legacyMemoryKey = `memory:${encodeURIComponent(label)}`;
    await env.CHAT_STORE.put(legacyMemoryKey, "legacy preference");
    const legacyChatId = `legacy-${crypto.randomUUID()}`;
    const saved = await apiRequest("/api/chats", cookie, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat: {
          id: legacyChatId,
          title: "Imported work",
          createdAt: 10,
          updatedAt: 20,
          routeId: "default",
          skillIds: [],
          messages: [
            { role: "user", content: "Prepare release notes" },
            { role: "assistant", content: "Draft ready", finishReason: "max_tokens" },
          ],
        },
      }),
    });
    expect(saved.status).toBe(200);

    const firstList = await apiRequest("/api/agent/conversations", cookie).then((response) => response.json()) as any;
    expect(firstList.conversations).toEqual([
      expect.objectContaining({ id: legacyChatId, title: "Imported work", skillMode: "manual", messageCount: 2 }),
    ]);
    const importedMessages = await getPersistedAgentMessages(await getConversationAgent(label, legacyChatId));
    expect(importedMessages.find((message) => message.role === "assistant")?.metadata).toEqual({
      finishReason: "length",
    });
    const secondList = await apiRequest("/api/agent/conversations", cookie).then((response) => response.json()) as any;
    expect(secondList.conversations).toHaveLength(1);

    const laterLegacyChatId = `legacy-later-${crypto.randomUUID()}`;
    const laterSave = await apiRequest("/api/chats", cookie, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat: {
          id: laterLegacyChatId,
          title: "Later legacy work",
          createdAt: 30,
          updatedAt: 40,
          routeId: "default",
          skillIds: [],
          messages: [{ role: "user", content: "Continue from legacy" }],
        },
      }),
    });
    expect(laterSave.status).toBe(200);
    const afterLaterSave = await apiRequest("/api/agent/conversations", cookie).then((response) => response.json()) as any;
    expect(afterLaterSave.conversations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: legacyChatId, messageCount: 2 }),
      expect.objectContaining({ id: laterLegacyChatId, skillMode: "manual", messageCount: 1 }),
    ]));

    const importedMemory = await apiRequest("/api/agent/memory", cookie).then((response) => response.json()) as any;
    expect(importedMemory).toMatchObject({ memory: "legacy preference" });
    expect(importedMemory.revision).toMatch(/^[0-9a-f]{64}$/);

    const createdResponse = await apiRequest("/api/agent/conversations", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ routeId: "default", skillIds: [] }),
    });
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json() as any;
    const renamedResponse = await apiRequest(`/api/agent/conversations/${encodeURIComponent(created.conversation.id)}`, cookie, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Renamed work", expectedUpdatedAt: created.conversation.updatedAt }),
    });
    expect(renamedResponse.status).toBe(200);
    const renamed = await renamedResponse.json() as any;
    expect(renamed.conversation.title).toBe("Renamed work");
    const staleRename = await apiRequest(`/api/agent/conversations/${encodeURIComponent(created.conversation.id)}`, cookie, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Stale title", expectedUpdatedAt: created.conversation.updatedAt }),
    });
    expect(staleRename.status).toBe(409);

    const memoryUpdate = await apiRequest("/api/agent/memory", cookie, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memory: "agent preference", expectedRevision: importedMemory.revision }),
    });
    expect(memoryUpdate.status).toBe(200);
    const updatedMemory = await memoryUpdate.json() as any;
    await expect(apiRequest("/api/memory", cookie).then((response) => response.json())).resolves.toMatchObject({
      memory: "agent preference",
      revision: updatedMemory.revision,
    });
    const legacyMemoryUpdate = await apiRequest("/api/memory", cookie, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memory: "legacy client preference", expectedRevision: updatedMemory.revision }),
    });
    expect(legacyMemoryUpdate.status).toBe(200);
    const legacyUpdatedMemory = await legacyMemoryUpdate.json() as any;
    await expect(apiRequest("/api/agent/memory", cookie).then((response) => response.json())).resolves.toMatchObject({
      memory: "legacy client preference",
      revision: legacyUpdatedMemory.revision,
    });
    const staleAgentMemoryUpdate = await apiRequest("/api/agent/memory", cookie, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memory: "stale agent preference", expectedRevision: updatedMemory.revision }),
    });
    expect(staleAgentMemoryUpdate.status).toBe(409);
    await expect(env.CHAT_STORE.get(legacyMemoryKey)).resolves.toBe("legacy preference");
  });

  it("enforces exact conversation ACL roles across list, share, title, and owner-only paths", async () => {
    const owner = await login(`acl-owner-${crypto.randomUUID().slice(0, 12)}`);
    const collaborator = await login(`acl-collaborator-${crypto.randomUUID().slice(0, 12)}`);
    const outsider = await login(`acl-outsider-${crypto.randomUUID().slice(0, 12)}`);
    const conversationId = `acl-chat-${crypto.randomUUID()}`;
    const createdResponse = await apiRequest("/api/agent/conversations", owner.cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: conversationId, title: "Shared release work" }),
    });
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json() as any;
    expect(created.conversation).toMatchObject({
      id: conversationId,
      accessRole: "owner",
      accessRevision: 1,
      resourceId: expect.stringMatching(/^res_/),
    });
    const resourceId = created.conversation.resourceId as string;

    const grantViewer = await apiRequest(`/api/agent/conversations/${encodeURIComponent(conversationId)}/shares`, owner.cookie, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        version: 1,
        operationId: `grant-viewer-${crypto.randomUUID()}`,
        resourceId,
        granteeLabel: collaborator.label,
        role: "viewer",
        expectedAccessRevision: 1,
      }),
    });
    expect(grantViewer.status).toBe(200);
    const viewerGrant = await grantViewer.json() as any;
    expect(viewerGrant).toMatchObject({
      ok: true,
      changed: true,
      accessRevision: 2,
      grants: [{ alias: collaborator.label, role: "viewer", grantRevision: 2 }],
    });
    const granteePrincipalId = viewerGrant.grants[0].principalId as string;

    const collaboratorList = await apiRequest("/api/agent/conversations", collaborator.cookie)
      .then((response) => response.json()) as any;
    expect(collaboratorList.conversations).toEqual([
      expect.objectContaining({
        id: conversationId,
        title: "Shared release work",
        resourceId,
        accessRole: "viewer",
        accessRevision: 2,
        workspaceFiles: [],
      }),
    ]);
    expect(collaboratorList.conversations[0]).not.toHaveProperty("parentChatId");
    const outsiderList = await apiRequest("/api/agent/conversations", outsider.cookie)
      .then((response) => response.json()) as any;
    expect(outsiderList.conversations).toEqual([]);

    const viewerRename = await apiRequest(`/api/agent/conversations/${encodeURIComponent(conversationId)}`, collaborator.cookie, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resourceId,
        title: "Viewer forged title",
        expectedUpdatedAt: created.conversation.updatedAt,
      }),
    });
    expect(viewerRename.status).toBe(403);
    await expect(viewerRename.json()).resolves.toMatchObject({ error: "conversation_action_denied" });

    const viewerShares = await apiRequest(
      `/api/agent/conversations/${encodeURIComponent(conversationId)}/shares?resourceId=${encodeURIComponent(resourceId)}`,
      collaborator.cookie,
    );
    expect(viewerShares.status).toBe(403);

    const staleRoleChange = await apiRequest(`/api/agent/conversations/${encodeURIComponent(conversationId)}/shares`, owner.cookie, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        version: 1,
        operationId: `stale-editor-${crypto.randomUUID()}`,
        resourceId,
        granteeLabel: collaborator.label,
        role: "editor",
        expectedAccessRevision: 1,
      }),
    });
    expect(staleRoleChange.status).toBe(409);

    const grantEditor = await apiRequest(`/api/agent/conversations/${encodeURIComponent(conversationId)}/shares`, owner.cookie, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        version: 1,
        operationId: `grant-editor-${crypto.randomUUID()}`,
        resourceId,
        granteeLabel: collaborator.label,
        role: "editor",
        expectedAccessRevision: 2,
      }),
    });
    expect(grantEditor.status).toBe(200);
    await expect(grantEditor.clone().json()).resolves.toMatchObject({
      changed: true,
      accessRevision: 3,
      grants: [{ role: "editor", grantRevision: 3 }],
    });

    const editorRename = await apiRequest(`/api/agent/conversations/${encodeURIComponent(conversationId)}`, collaborator.cookie, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resourceId,
        title: "Editor title",
        expectedUpdatedAt: created.conversation.updatedAt,
      }),
    });
    expect(editorRename.status).toBe(200);
    const renamed = await editorRename.json() as any;
    expect(renamed.conversation).toMatchObject({
      title: "Editor title",
      resourceId,
      accessRole: "editor",
      accessRevision: 3,
    });

    const editorSettings = await apiRequest(`/api/agent/conversations/${encodeURIComponent(conversationId)}`, collaborator.cookie, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resourceId,
        routeId: "forged-route",
        expectedUpdatedAt: renamed.conversation.updatedAt,
      }),
    });
    expect(editorSettings.status).toBe(403);

    const editorBranch = await apiRequest(`/api/agent/conversations/${encodeURIComponent(conversationId)}/branches`, collaborator.cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resourceId,
        requestId: `editor-branch-${crypto.randomUUID()}`,
        action: "branch",
        sourceMessageId: "message-1",
        expectedUpdatedAt: renamed.conversation.updatedAt,
      }),
    });
    expect(editorBranch.status).toBe(403);

    const editorWorkspaceRefs = await apiRequest(
      `/api/agent/conversations/${encodeURIComponent(conversationId)}/workspace-files`,
      collaborator.cookie,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resourceId,
          expectedUpdatedAt: renamed.conversation.updatedAt,
          files: [],
        }),
      },
    );
    expect(editorWorkspaceRefs.status).toBe(403);

    const editorDelete = await apiRequest(
      `/api/agent/conversations/${encodeURIComponent(conversationId)}?resourceId=${encodeURIComponent(resourceId)}&expectedUpdatedAt=${renamed.conversation.updatedAt}`,
      collaborator.cookie,
      { method: "DELETE" },
    );
    expect(editorDelete.status).toBe(403);

    const outsiderRename = await apiRequest(`/api/agent/conversations/${encodeURIComponent(conversationId)}`, outsider.cookie, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resourceId, title: "Forged", expectedUpdatedAt: renamed.conversation.updatedAt }),
    });
    expect(outsiderRename.status).toBe(404);
    await expect(outsiderRename.json()).resolves.toMatchObject({ error: "conversation_not_found" });

    const ownerShares = await apiRequest(
      `/api/agent/conversations/${encodeURIComponent(conversationId)}/shares?resourceId=${encodeURIComponent(resourceId)}`,
      owner.cookie,
    );
    expect(ownerShares.status).toBe(200);
    await expect(ownerShares.json()).resolves.toMatchObject({
      resourceId,
      accessRevision: 3,
      grants: [{ principalId: granteePrincipalId, alias: collaborator.label, role: "editor" }],
    });

    const revoked = await apiRequest(`/api/agent/conversations/${encodeURIComponent(conversationId)}/shares/revoke`, owner.cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        version: 1,
        operationId: `revoke-editor-${crypto.randomUUID()}`,
        resourceId,
        granteePrincipalId,
        expectedAccessRevision: 3,
      }),
    });
    expect(revoked.status).toBe(200);
    await expect(revoked.json()).resolves.toMatchObject({ changed: true, accessRevision: 4, grants: [] });

    const revokedList = await apiRequest("/api/agent/conversations", collaborator.cookie)
      .then((response) => response.json()) as any;
    expect(revokedList.conversations).toEqual([]);
    const revokedRename = await apiRequest(`/api/agent/conversations/${encodeURIComponent(conversationId)}`, collaborator.cookie, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resourceId, title: "Stale tab", expectedUpdatedAt: renamed.conversation.updatedAt }),
    });
    expect(revokedRename.status).toBe(404);
  });

  it("keeps authoritative grant and revoke results when derived Agent invalidation fails", async () => {
    const suffix = crypto.randomUUID();
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      routes: {
        default: {
          label: "ACL invalidation",
          type: "openai-chat",
          baseUrl: "https://acl-invalidation-provider.example/v1",
          model: "acl-invalidation-model",
          apiKey: "acl-invalidation-key",
        },
      },
      defaults: { defaultRoute: "default", allowedRoutes: ["default"] },
    }));
    const owner = await login(`acl-invalidation-owner-${suffix}`);
    const collaborator = await login(`acl-invalidation-collaborator-${suffix}`);
    const conversationId = `acl-invalidation-chat-${suffix}`;
    const createdResponse = await apiRequest("/api/agent/conversations", owner.cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: conversationId }),
    });
    expect(createdResponse.status).toBe(201);
    const resourceId = ((await createdResponse.json() as any).conversation.resourceId) as string;
    const failingTeamAgent = {
      getByName: () => ({
        applyConversationAccessRevision: async () => {
          throw new Error("synthetic_invalidation_failure");
        },
      }),
    } as unknown as typeof env.TEAM_AGENT;

    const grantedResponse = await apiRequest(
      `/api/agent/conversations/${encodeURIComponent(conversationId)}/shares`,
      owner.cookie,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version: 1,
          operationId: `acl-invalidation-grant-${suffix}`,
          resourceId,
          granteeLabel: collaborator.label,
          role: "viewer",
          expectedAccessRevision: 1,
        }),
      },
    );
    expect(grantedResponse.status, await grantedResponse.clone().text()).toBe(200);
    const granted = await grantedResponse.json() as any;
    expect(granted).toMatchObject({ changed: true, accessRevision: 2 });
    const granteePrincipalId = granted.grants[0].principalId as string;
    await expect(scheduleConversationAccessInvalidation(
      { TEAM_AGENT: failingTeamAgent } as any,
      undefined,
      "synthetic-agent-instance",
      resourceId,
      2,
    )).resolves.toBeUndefined();
    await expect(apiRequest("/api/agent/conversations", collaborator.cookie).then((response) => response.json()))
      .resolves.toMatchObject({
        conversations: [expect.objectContaining({ resourceId, accessRole: "viewer", accessRevision: 2 })],
      });

    const revokedResponse = await apiRequest(
      `/api/agent/conversations/${encodeURIComponent(conversationId)}/shares/revoke`,
      owner.cookie,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version: 1,
          operationId: `acl-invalidation-revoke-${suffix}`,
          resourceId,
          granteePrincipalId,
          expectedAccessRevision: 2,
        }),
      },
    );
    expect(revokedResponse.status, await revokedResponse.clone().text()).toBe(200);
    await expect(revokedResponse.json()).resolves.toMatchObject({
      changed: true,
      accessRevision: 3,
      grants: [],
    });
    await expect(scheduleConversationAccessInvalidation(
      { TEAM_AGENT: failingTeamAgent } as any,
      undefined,
      "synthetic-agent-instance",
      resourceId,
      3,
    )).resolves.toBeUndefined();
    await expect(apiRequest("/api/agent/conversations", collaborator.cookie).then((response) => response.json()))
      .resolves.toMatchObject({ conversations: [] });
  });

  it("isolates viewer and editor Agent turns from principal context, credentials, and tools", async () => {
    const suffix = crypto.randomUUID();
    const providerId = `acl-isolation-provider-${suffix}`;
    const routeId = `acl-isolation-route-${suffix}`;
    const model = "acl-isolation-model";
    const managedKey = `managed-key-${suffix}`;
    const serverId = `acl-isolation-mcp-${suffix}`;
    const remoteToolId = `mcp:${serverId}:lookup`;
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      providers: {
        [providerId]: {
          label: "ACL isolation Provider",
          type: "openai-chat",
          baseUrl: `https://${providerId}.example/v1`,
          apiKey: managedKey,
        },
      },
      routes: {
        [routeId]: {
          label: "ACL isolation route",
          offerings: [{ providerId, model, supportsTools: true }],
          supportsTools: true,
        },
      },
      defaults: {
        defaultRoute: routeId,
        allowedRoutes: [routeId],
        allowedSkills: ["acl-isolation-skill"],
        allowedTools: [remoteToolId],
        dailyMessageLimit: 5,
        minuteMessageLimit: 5,
      },
      skills: {
        "acl-isolation-skill": {
          enabled: true,
          label: "ACL isolation Skill",
          instructions: "Use the configured conversation guidance without invoking tools.",
          toolIds: [remoteToolId],
        },
      },
      tools: {
        [remoteToolId]: {
          enabled: true,
          label: "Private lookup",
          inputSchema: { type: "object", properties: {} },
          confirmation: "auto",
          reviewRequired: false,
          executor: { type: "mcp", serverId, remoteName: "lookup" },
        },
      },
      mcpServers: {
        [serverId]: {
          enabled: true,
          label: "Private MCP",
          endpoint: `https://${serverId}.example/rpc`,
          authType: "oauth2",
          auth: {
            issuer: "https://acl-isolation-issuer.example",
            clientId: "acl-isolation-client",
            scopes: ["tools.read"],
            callbackPath: "/api/mcp/oauth/callback",
          },
        },
      },
    }));

    const owner = await login(`acl-agent-owner-${suffix}`);
    const collaborator = await login(`acl-agent-editor-${suffix}`);
    const [ownerPrincipal, collaboratorPrincipal] = await Promise.all([
      resolveTestPrincipal(owner.label),
      resolveTestPrincipal(collaborator.label),
    ]);
    if (!ownerPrincipal || !collaboratorPrincipal) throw new Error("missing_acl_agent_principal");

    const ownerMemory = `OWNER_MEMORY_MUST_NOT_LEAK_${suffix}`;
    const collaboratorMemory = `EDITOR_MEMORY_MUST_NOT_LEAK_${suffix}`;
    const ownerRoot = await getRootAgent(owner.label);
    const collaboratorRoot = await getRootAgent(collaborator.label);
    const [ownerMemoryState, collaboratorMemoryState] = await Promise.all([
      ownerRoot.getMemory(),
      collaboratorRoot.getMemory(),
    ]);
    await Promise.all([
      ownerRoot.putMemory(ownerMemory, ownerMemoryState.revision),
      collaboratorRoot.putMemory(collaboratorMemory, collaboratorMemoryState.revision),
    ]);
    const [ownerOAuth, collaboratorOAuth] = await Promise.all([
      seedMcpOAuthData(owner.label, serverId, ownerPrincipal.userStateInstanceName),
      seedMcpOAuthData(collaborator.label, serverId, collaboratorPrincipal.userStateInstanceName),
    ]);

    const conversationId = `acl-agent-chat-${suffix}`;
    const createdResponse = await apiRequest("/api/agent/conversations", owner.cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: conversationId,
        title: "Isolated shared conversation",
        routeId,
        skillMode: "manual",
        skillIds: ["acl-isolation-skill"],
      }),
    });
    expect(createdResponse.status, await createdResponse.clone().text()).toBe(201);
    const created = (await createdResponse.json() as any).conversation;
    const resourceId = created.resourceId as string;

    const workspaceCanary = `OWNER_WORKSPACE_MUST_NOT_LEAK_${suffix}`;
    const uploadForm = new FormData();
    uploadForm.set("file", new File([workspaceCanary], "private.txt", { type: "text/plain" }));
    uploadForm.set("relativePath", `acl/${suffix}/private.txt`);
    uploadForm.set("operationId", `acl-isolation-upload-${suffix}`);
    const uploadedResponse = await apiRequest("/api/workspace/files", owner.cookie, {
      method: "POST",
      body: uploadForm,
    });
    expect(uploadedResponse.status, await uploadedResponse.clone().text()).toBe(201);
    const uploaded = await uploadedResponse.json() as any;
    const linkedResponse = await apiRequest(
      `/api/agent/conversations/${encodeURIComponent(conversationId)}/workspace-files`,
      owner.cookie,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resourceId,
          expectedUpdatedAt: created.updatedAt,
          files: [{
            fileId: uploaded.file.id,
            versionId: uploaded.file.currentVersion.id,
          }],
        }),
      },
    );
    expect(linkedResponse.status, await linkedResponse.clone().text()).toBe(200);

    const grantViewerResponse = await apiRequest(
      `/api/agent/conversations/${encodeURIComponent(conversationId)}/shares`,
      owner.cookie,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version: 1,
          operationId: `acl-isolation-viewer-${suffix}`,
          resourceId,
          granteeLabel: collaborator.label,
          role: "viewer",
          expectedAccessRevision: 1,
        }),
      },
    );
    expect(grantViewerResponse.status).toBe(200);
    const viewerGrant = await grantViewerResponse.json() as any;
    const granteePrincipalId = viewerGrant.grants[0].principalId as string;

    let providerCalls = 0;
    let remoteMcpCalls = 0;
    let providerBody: Record<string, unknown> | undefined;
    let providerAuthorization = "";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const target = String(input);
      if (target.includes(serverId)) {
        remoteMcpCalls += 1;
        return new Response("unexpected remote MCP call", { status: 500 });
      }
      providerCalls += 1;
      providerBody = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
      providerAuthorization = new Headers(init?.headers).get("Authorization") || "";
      return openAiUiTextResponse("editor isolated response", model);
    });

    const agent = await getConversationAgent(owner.label, conversationId);
    const baseline: UIMessage = {
      id: `acl-isolation-baseline-${suffix}`,
      role: "assistant",
      parts: [{ type: "text", text: "Existing shared transcript" }],
    };
    await agent.importLegacyMessages([baseline]);
    const viewerAccess = await conversationAccessContext(
      collaborator.label,
      conversationId,
      resourceId,
      "conversation.read",
    );
    const viewerDenied = await runInDurableObject(agent, async (instance) => {
      const response = await instance.onChatMessage(async () => undefined, {
        requestId: `acl-viewer-turn-${suffix}`,
        body: { [CONVERSATION_AGENT_ACCESS_BODY_KEY]: viewerAccess },
      });
      return { status: response.status, body: await response.text() };
    });
    expect(viewerDenied.status).toBe(403);
    expect(viewerDenied.body).toContain("conversation_action_denied");
    expect(providerCalls).toBe(0);
    expect(remoteMcpCalls).toBe(0);
    await expect(agent.getConversationMessageCount()).resolves.toBe(1);

    const grantEditorResponse = await apiRequest(
      `/api/agent/conversations/${encodeURIComponent(conversationId)}/shares`,
      owner.cookie,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version: 1,
          operationId: `acl-isolation-editor-${suffix}`,
          resourceId,
          granteeLabel: collaborator.label,
          role: "editor",
          expectedAccessRevision: 2,
        }),
      },
    );
    expect(grantEditorResponse.status).toBe(200);
    const editorAccess = await conversationAccessContext(collaborator.label, conversationId, resourceId);
    const forgedApiKey = `FORGED_EDITOR_API_KEY_${suffix}`;
    const forgedSummary = `FORGED_EDITOR_SUMMARY_${suffix}`;
    const editorResponse = await runSharedEditorTurn(
      agent,
      [
        baseline,
        {
          id: `acl-isolation-user-${suffix}`,
          role: "user",
          parts: [{ type: "text", text: "Use only the shared conversation context." }],
        },
      ],
      `acl-editor-turn-${suffix}`,
      editorAccess,
      {
        routeId: "forged-editor-route",
        skillMode: "automatic",
        skillIds: ["forged-editor-skill"],
        userApiKey: forgedApiKey,
        sessionSummary: forgedSummary,
        temperature: 0.01,
      },
    );
    expect(editorResponse.status, editorResponse.body).toBe(200);
    expect(editorResponse.contentType).toContain("text/event-stream");
    expect(editorResponse.body).toContain("editor isolated response");
    expect(providerCalls).toBe(1);
    expect(remoteMcpCalls).toBe(0);
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(providerAuthorization).toContain(managedKey);
    expect(providerAuthorization).not.toContain(forgedApiKey);
    expect(providerBody?.tools === undefined || (Array.isArray(providerBody.tools) && providerBody.tools.length === 0))
      .toBe(true);

    const serializedProviderBody = JSON.stringify(providerBody);
    for (const canary of [
      ownerMemory,
      collaboratorMemory,
      workspaceCanary,
      forgedApiKey,
      forgedSummary,
      ownerOAuth.accessToken,
      ownerOAuth.refreshToken,
      collaboratorOAuth.accessToken,
      collaboratorOAuth.refreshToken,
      remoteToolId,
    ]) {
      expect(serializedProviderBody).not.toContain(canary);
    }

    const day = new Date().toISOString().slice(0, 10);
    const ownerState = env.USER_STATE.getByName(ownerPrincipal.userStateInstanceName);
    const collaboratorState = env.USER_STATE.getByName(collaboratorPrincipal.userStateInstanceName);
    await vi.waitFor(async () => {
      await expect(collaboratorState.getUsage(day, 0)).resolves.toBe(1);
      const stats = await collaboratorState.getStats([day]);
      expect(stats.metrics).toEqual(expect.arrayContaining([
        expect.objectContaining({ day, kind: "req", count: 1 }),
        expect.objectContaining({ day, kind: "route_ok", routeId, count: 1 }),
      ]));
    });
    await expect(ownerState.getUsage(day, 0)).resolves.toBe(0);
    await expect(ownerState.getStats([day])).resolves.toEqual({ usage: { [day]: 0 }, metrics: [] });

    const revokeResponse = await apiRequest(
      `/api/agent/conversations/${encodeURIComponent(conversationId)}/shares/revoke`,
      owner.cookie,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version: 1,
          operationId: `acl-isolation-revoke-${suffix}`,
          resourceId,
          granteePrincipalId,
          expectedAccessRevision: 3,
        }),
      },
    );
    expect(revokeResponse.status).toBe(200);
    const staleReconnect = await apiRequest(
      `/agent?chatId=${encodeURIComponent(conversationId)}&resourceId=${encodeURIComponent(resourceId)}`,
      collaborator.cookie,
    );
    expect(staleReconnect.status).toBe(404);
    await expect(staleReconnect.json()).resolves.toMatchObject({ error: "conversation_not_found" });
  });

  it("fences and rolls back an editor stream revoked without derived Agent invalidation", async () => {
    const suffix = crypto.randomUUID();
    const providerId = `acl-race-provider-${suffix}`;
    const routeId = `acl-race-route-${suffix}`;
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      providers: {
        [providerId]: {
          label: "ACL race Provider",
          type: "openai-chat",
          baseUrl: `https://${providerId}.example/v1`,
          apiKey: `acl-race-managed-key-${suffix}`,
        },
      },
      routes: {
        [routeId]: {
          label: "ACL race route",
          offerings: [{ providerId, model: "acl-race-model" }],
        },
      },
      defaults: { defaultRoute: routeId, allowedRoutes: [routeId] },
      skills: {},
      tools: {},
      mcpServers: {},
    }));

    const owner = await login(`acl-race-owner-${suffix}`);
    const collaborator = await login(`acl-race-editor-${suffix}`);
    const conversationId = `acl-race-chat-${suffix}`;
    const createdResponse = await apiRequest("/api/agent/conversations", owner.cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: conversationId, title: "Revocation race", routeId }),
    });
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json() as any).conversation;
    const resourceId = created.resourceId as string;
    const grantResponse = await apiRequest(
      `/api/agent/conversations/${encodeURIComponent(conversationId)}/shares`,
      owner.cookie,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version: 1,
          operationId: `acl-race-grant-${suffix}`,
          resourceId,
          granteeLabel: collaborator.label,
          role: "editor",
          expectedAccessRevision: 1,
        }),
      },
    );
    expect(grantResponse.status).toBe(200);
    const grant = await grantResponse.json() as any;
    const granteePrincipalId = grant.grants[0].principalId as string;
    const collaboratorPrincipal = await resolveTestPrincipal(collaborator.label);
    if (!collaboratorPrincipal) throw new Error("missing_acl_race_principal");
    const access = await conversationAccessContext(collaborator.label, conversationId, resourceId);
    const agent = await getConversationAgent(owner.label, conversationId);
    const requestId = `acl-race-turn-${suffix}`;
    const baseline: UIMessage = {
      id: `acl-race-baseline-${suffix}`,
      role: "assistant",
      parts: [{ type: "text", text: "Authoritative baseline" }],
    };
    const submitted: UIMessage = {
      id: `acl-race-user-${suffix}`,
      role: "user",
      parts: [{ type: "text", text: "Begin the revocable turn." }],
    };
    const encoder = new TextEncoder();
    let providerController: ReadableStreamDefaultController<Uint8Array> | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          providerController = controller;
          controller.enqueue(encoder.encode(openAiTextEvent("visible before revoke")));
        },
      }),
      { status: 200, headers: { "Content-Type": "text/event-stream" } },
    ));

    let releaseAfterRevoke: (() => void) | undefined;
    const afterRevoke = new Promise<void>((resolve) => { releaseAfterRevoke = resolve; });
    let reportVisible: (() => void) | undefined;
    const visible = new Promise<void>((resolve) => { reportVisible = resolve; });
    const turn = runInDurableObject(agent, async (instance, state) => {
      await instance.persistMessages([baseline, submitted], [], { _deleteStaleRows: true });
      (instance as any).registerConversationAccessTurn(requestId, access.access, 1);
      const response = await instance.onChatMessage(async () => undefined, {
        requestId,
        body: { [CONVERSATION_AGENT_ACCESS_BODY_KEY]: access },
      });
      expect(response.status).toBe(200);
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let streamed = "";
      while (!streamed.includes("visible before revoke")) {
        const next = await reader.read();
        if (next.done) break;
        streamed += decoder.decode(next.value, { stream: true });
      }
      reportVisible?.();
      await afterRevoke;
      let streamError = "";
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          streamed += decoder.decode(next.value, { stream: true });
        }
      } catch (error) {
        streamError = error instanceof Error ? error.message : String(error);
      }

      await instance.persistMessages([
        baseline,
        submitted,
        {
          id: `acl-race-tentative-assistant-${suffix}`,
          role: "assistant",
          parts: [{ type: "text", text: "Tentative output must be removed" }],
        },
      ], [], { _deleteStaleRows: true });
      await (instance as any).onChatResponse({ requestId });
      const persisted = state.storage.sql.exec<{ message: string }>(
        "SELECT message FROM cf_ai_chat_agent_messages ORDER BY created_at, id",
      ).toArray().map((row) => JSON.parse(row.message) as UIMessage);
      const accessTurns = state.storage.sql.exec<{ count: number }>(
        "SELECT COUNT(*) AS count FROM chatus_conversation_access_turns",
      ).one().count;
      const providerStates = state.storage.sql.exec<{ count: number }>(
        "SELECT COUNT(*) AS count FROM chatus_provider_turn_state",
      ).one().count;
      return { streamed, streamError, persisted, accessTurns, providerStates };
    });

    await visible;
    const registry = env.IDENTITY_REGISTRY.getByName(IDENTITY_REGISTRY_INSTANCE_NAME);
    const revoked = await registry.revokeConversationGrant({
      version: 1,
      operationId: `acl-race-revoke-${suffix}`,
      actorPrincipalId: (await resolveTestPrincipal(owner.label))!.principalId,
      resourceId,
      targetPrincipalId: granteePrincipalId,
      expectedAccessRevision: 2,
    });
    expect(revoked).toMatchObject({ changed: true, accessRevision: 3, grants: [] });
    providerController?.enqueue(encoder.encode(openAiTextEvent("output after revoke must be fenced")));
    providerController?.enqueue(encoder.encode("data: [DONE]\n\n"));
    providerController?.close();
    releaseAfterRevoke?.();

    const result = await turn;
    expect(result.streamed).toContain("visible before revoke");
    expect(result.streamed).not.toContain("output after revoke must be fenced");
    expect(result.streamError).toContain("conversation_not_found");
    expect(result.persisted).toEqual([baseline]);
    expect(result.accessTurns).toBe(0);
    expect(result.providerStates).toBe(0);
    await expect((await getRootAgent(owner.label)).getConversationSummary(conversationId)).resolves.toMatchObject({
      updatedAt: created.updatedAt,
      messageCount: 0,
    });
    const day = new Date().toISOString().slice(0, 10);
    await expect(env.USER_STATE.getByName(collaboratorPrincipal.userStateInstanceName).getUsage(day, 0))
      .resolves.toBe(1);
  });

  it("creates durable idempotent conversation branches without changing the source transcript", async () => {
    const { cookie, label } = await login(`agent-branch-${crypto.randomUUID()}`);
    const sourceId = `branch-source-${crypto.randomUUID()}`;
    const createdResponse = await apiRequest("/api/agent/conversations", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: sourceId }),
    });
    expect(createdResponse.status).toBe(201);
    const sourceAgent = await getConversationAgent(label, sourceId);
    const sourceMessages: UIMessage[] = [
      {
        id: "branch-user-1",
        role: "user",
        parts: [
          { type: "text", text: "first synthetic turn" },
          {
            type: "file",
            mediaType: "image/png",
            filename: "branch.png",
            url: "data:image/png;base64,QQ==",
          },
        ],
      },
      { id: "branch-assistant-1", role: "assistant", parts: [{ type: "text", text: "first synthetic reply" }] },
      { id: "branch-user-2", role: "user", parts: [{ type: "text", text: "second synthetic turn" }] },
    ];
    const exportedSourceMessages = [
      {
        id: "branch-user-1",
        role: "user",
        parts: [
          { type: "text", text: "first synthetic turn" },
          { type: "file", mediaType: "image/png", name: "branch.png" },
        ],
      },
      sourceMessages[1],
      sourceMessages[2],
    ];
    await sourceAgent.importLegacyMessages(sourceMessages);
    const retainedEvidence = {
      version: 1 as const,
      description: "A synthetic branch image.",
      ocrText: ["branch evidence"],
      limitations: ["Synthetic test evidence."],
    };
    await sourceAgent.importVisionEvidence([{
      sourceMessageId: "branch-user-1",
      evidence: retainedEvidence,
    }]);
    await runInDurableObject(sourceAgent, async (_instance, state) => {
      state.storage.sql.exec(
        "INSERT INTO chatus_vision_evidence(source_message_id, evidence_json, created_at, updated_at) VALUES (?, ?, ?, ?)",
        "orphan-evidence",
        JSON.stringify(retainedEvidence),
        1,
        1,
      );
      state.storage.sql.exec(
        "INSERT INTO chatus_vision_evidence(source_message_id, evidence_json, created_at, updated_at) VALUES (?, ?, ?, ?)",
        "malformed-evidence",
        JSON.stringify({ version: 1, description: "malformed" }),
        1,
        2,
      );
    });
    await sourceAgent.captureInstanceState(`epoch-vision-revalidate-${crypto.randomUUID()}`);
    await expect(getVisionEvidenceRows(sourceAgent)).resolves.toEqual([{
      source_message_id: "branch-user-1",
      evidence_json: JSON.stringify(retainedEvidence),
    }]);
    const root = await getRootAgent(label);
    await root.recordConversationActivity({ id: sourceId, messageCount: sourceMessages.length });
    const source = (await root.listConversations()).find((conversation) => conversation.id === sourceId)!;
    const requestId = `branch-request-${crypto.randomUUID()}`;
    const requestBody = {
      requestId,
      action: "branch",
      sourceMessageId: "branch-assistant-1",
      expectedUpdatedAt: source.updatedAt,
    };

    const unauthenticated = await exports.default.fetch(new Request(
      `https://example.test/api/agent/conversations/${encodeURIComponent(sourceId)}/branches`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestBody) },
    ));
    expect(unauthenticated.status).toBe(401);
    const crossOrigin = await apiRequest(`/api/agent/conversations/${encodeURIComponent(sourceId)}/branches`, cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://other.example" },
      body: JSON.stringify(requestBody),
    });
    expect(crossOrigin.status).toBe(403);

    const branchedResponse = await apiRequest(`/api/agent/conversations/${encodeURIComponent(sourceId)}/branches`, cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });
    expect(branchedResponse.status).toBe(200);
    const branched = await branchedResponse.json() as any;
    expect(branched).toEqual({
      ok: true,
      requestId,
      conversation: expect.objectContaining({
        id: expect.any(String),
        title: expect.stringMatching(/ · 分支$/u),
        parentChatId: sourceId,
        skillMode: "automatic",
        messageCount: 2,
      }),
      launch: "none",
    });
    expect(branched.conversation.id).not.toBe(sourceId);
    const destinationAgent = await getConversationAgent(label, branched.conversation.id);
    await expect(destinationAgent.exportMessages()).resolves.toMatchObject({
      messages: exportedSourceMessages.slice(0, 2),
      truncated: false,
    });
    const branchedImageMessage = (await getPersistedAgentMessages(destinationAgent))
      .find((message) => message.id === "branch-user-1");
    expect(branchedImageMessage?.parts.find((part) => part.type === "file")).toEqual({
      type: "file",
      mediaType: "image/png",
      filename: "branch.png",
      url: "data:image/png;base64,QQ==",
    });
    await expect(getVisionEvidenceRows(destinationAgent)).resolves.toEqual([{
      source_message_id: "branch-user-1",
      evidence_json: JSON.stringify(retainedEvidence),
    }]);
    await expect(sourceAgent.exportMessages()).resolves.toMatchObject({
      messages: exportedSourceMessages,
      truncated: false,
    });

    const repeated = await apiRequest(`/api/agent/conversations/${encodeURIComponent(sourceId)}/branches`, cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });
    expect(repeated.status).toBe(200);
    await expect(repeated.json()).resolves.toMatchObject({
      requestId,
      conversation: { id: branched.conversation.id },
    });
    expect(await root.listConversations()).toHaveLength(2);

    const renamed = await root.updateConversation({
      id: sourceId,
      expectedUpdatedAt: (await root.listConversations()).find((conversation) => conversation.id === sourceId)!.updatedAt,
      title: "Release notes · 分支",
    });
    expect(renamed.ok).toBe(true);
    const titleCases: Array<{
      action: "branch" | "edit" | "resend" | "regenerate" | "continue";
      sourceMessageId: string;
      expectedSuffix: string;
      launch: "none" | "respond" | "continue";
    }> = [
      { action: "branch", sourceMessageId: "branch-assistant-1", expectedSuffix: " · 分支", launch: "none" },
      { action: "edit", sourceMessageId: "branch-user-1", expectedSuffix: " · 编辑分支", launch: "respond" },
      { action: "resend", sourceMessageId: "branch-user-1", expectedSuffix: " · 重发分支", launch: "respond" },
      { action: "regenerate", sourceMessageId: "branch-assistant-1", expectedSuffix: " · 重生成分支", launch: "respond" },
      { action: "continue", sourceMessageId: "branch-assistant-1", expectedSuffix: " · 续写分支", launch: "continue" },
    ];
    for (const titleCase of titleCases) {
      const titleRequestId = `branch-title-${titleCase.action}-${crypto.randomUUID()}`;
      const response = await apiRequest(`/api/agent/conversations/${encodeURIComponent(sourceId)}/branches`, cookie, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: titleRequestId,
          action: titleCase.action,
          sourceMessageId: titleCase.sourceMessageId,
          expectedUpdatedAt: renamed.conversation!.updatedAt,
          ...(titleCase.action === "edit" ? { editedText: "edited synthetic turn" } : {}),
        }),
      });
      expect(response.status).toBe(200);
      const payload = await response.json() as any;
      expect(payload).toMatchObject({
        requestId: titleRequestId,
        launch: titleCase.launch,
        conversation: {
          parentChatId: sourceId,
          title: `Release notes${titleCase.expectedSuffix}`,
        },
      });
      expect(payload.conversation.title).not.toContain("分支 ·");
      const actionAgent = await getConversationAgent(label, payload.conversation.id);
      const actionMessages = await getPersistedAgentMessages(actionAgent);
      const actionEvidence = await getVisionEvidenceRows(actionAgent);
      const imageMessageId = actionMessages.find((message) => message.role === "user"
        && message.parts.some((part) => part.type === "file" && part.mediaType?.startsWith("image/")))?.id;
      expect(actionEvidence).toEqual(imageMessageId ? [{
        source_message_id: imageMessageId,
        evidence_json: JSON.stringify(retainedEvidence),
      }] : []);
      if (titleCase.action === "edit") expect(imageMessageId).not.toBe("branch-user-1");
      else expect(imageMessageId).toBe("branch-user-1");
    }
    const expectedConversationCount = 2 + titleCases.length;
    expect(await root.listConversations()).toHaveLength(expectedConversationCount);

    const conflictingRequest = await apiRequest(`/api/agent/conversations/${encodeURIComponent(sourceId)}/branches`, cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...requestBody, sourceMessageId: "branch-user-1" }),
    });
    expect(conflictingRequest.status).toBe(409);
    await expect(conflictingRequest.json()).resolves.toMatchObject({ error: "branch_request_conflict" });

    const staleRequest = await apiRequest(`/api/agent/conversations/${encodeURIComponent(sourceId)}/branches`, cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...requestBody, requestId: `stale-${crypto.randomUUID()}`, expectedUpdatedAt: source.updatedAt - 1 }),
    });
    expect(staleRequest.status).toBe(409);
    await expect(staleRequest.json()).resolves.toMatchObject({ error: "conversation_conflict" });
    expect(await root.listConversations()).toHaveLength(expectedConversationCount);
  });

  it("preserves Agent conversation tombstones and retries persisted transcript cleanup", async () => {
    const { cookie, label } = await login(`agent-delete-${crypto.randomUUID()}`);
    const chatId = `agent-delete-${crypto.randomUUID()}`;
    const createdResponse = await apiRequest("/api/agent/conversations", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: chatId }),
    });
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json() as any;
    const unversionedLegacyDelete = await apiRequest(`/api/chats?id=${encodeURIComponent(chatId)}`, cookie, { method: "DELETE" });
    expect(unversionedLegacyDelete.status).toBe(400);
    const conversationAgent = await getConversationAgent(label, chatId);
    const seededMessages: UIMessage[] = [{
      id: "cleanup-user",
      role: "user",
      parts: [
        { type: "text", text: "cleanup me" },
        { type: "file", mediaType: "image/png", filename: "cleanup.png", url: "data:image/png;base64,QQ==" },
      ],
    }];
    await conversationAgent.importLegacyMessages(seededMessages);
    await conversationAgent.importVisionEvidence([{
      sourceMessageId: "cleanup-user",
      evidence: {
        version: 1,
        description: "Evidence to remove with the conversation.",
        ocrText: [],
        limitations: [],
      },
    }]);
    await expect(conversationAgent.getConversationMessageCount()).resolves.toBe(1);
    const root = await getRootAgent(label);
    const deleted = await root.deleteConversation(chatId, created.conversation.updatedAt);
    expect(deleted.ok).toBe(true);
    await root.recordConversationCleanupFailure(chatId);
    await expect(root.listPendingConversationCleanups()).resolves.toEqual([
      expect.objectContaining({ chatId, attempts: 1 }),
    ]);
    const beforeDue = await apiRequest("/api/agent/conversations", cookie);
    expect(beforeDue.status).toBe(200);
    await expect(root.listPendingConversationCleanups()).resolves.toHaveLength(1);
    await expect(conversationAgent.getConversationMessageCount()).resolves.toBe(1);
    await runInDurableObject(root, async (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE chatus_conversation_cleanup SET next_attempt_at = 1 WHERE chat_id = ?",
        chatId,
      );
    });

    const listed = await apiRequest("/api/agent/conversations", cookie);
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toMatchObject({ conversations: [] });
    await expect(root.listPendingConversationCleanups()).resolves.toEqual([]);
    await expect(conversationAgent.getConversationMessageCount()).resolves.toBe(0);
    await expect(getPersistedAgentMessages(conversationAgent)).resolves.toEqual([]);
    await expect(getVisionEvidenceRows(conversationAgent)).resolves.toEqual([]);
    await expect(root.inspectCleanupReliability()).resolves.toMatchObject({ scheduledAt: 0 });

    const staleReconnect = await apiRequest(`/agent?chatId=${encodeURIComponent(chatId)}`, cookie);
    expect(staleReconnect.status).toBe(410);
    await expect(staleReconnect.json()).resolves.toMatchObject({ error: "conversation_deleted" });
    const explicitRecreate = await apiRequest("/api/agent/conversations", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: chatId }),
    });
    expect(explicitRecreate.status).toBe(410);

    const legacyResurrection = await apiRequest("/api/chats", cookie, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat: { id: chatId, title: "Stale legacy tab", createdAt: 10, updatedAt: Date.now(), messages: [] },
      }),
    });
    await expect(legacyResurrection.json()).resolves.toMatchObject({ accepted: false, currentChat: null, chats: [] });
  });

  it("rotates failed cleanup retries behind unattempted conversations", async () => {
    const { label } = await login(`agent-cleanup-order-${crypto.randomUUID()}`);
    const root = await getRootAgent(label);
    const chatIds = Array.from({ length: 4 }, (_, index) => `cleanup-order-${index}-${crypto.randomUUID()}`);
    const baseTimestamp = Date.now() + 60_000;

    for (const [index, chatId] of chatIds.entries()) {
      const updatedAt = baseTimestamp + index;
      const created = await root.createConversation({
        id: chatId,
        title: `Cleanup ${index}`,
        createdAt: updatedAt,
        updatedAt,
        summary: "",
        pinned: false,
        skillIds: [],
        messageCount: 0,
      });
      expect(created.ok).toBe(true);
      await expect(root.deleteConversation(chatId, updatedAt)).resolves.toMatchObject({ ok: true });
    }

    const firstBatch = await root.listPendingConversationCleanups(3);
    expect(firstBatch.map((record) => record.chatId)).toEqual(chatIds.slice(0, 3));
    await Promise.all(firstBatch.map((record) => root.recordConversationCleanupFailure(record.chatId)));

    const rotatedBatch = await root.listPendingConversationCleanups(3);
    expect(rotatedBatch[0]?.chatId).toBe(chatIds[3]);
  });

  it("filters conversation cleanup by due time and retains exhausted work without leaking identifiers", async () => {
    const { label } = await login(`agent-cleanup-retry-${crypto.randomUUID()}`);
    const root = await getRootAgent(label);
    const chatId = `cleanup-private-${crypto.randomUUID()}`;
    const createdAt = Date.now();
    const created = await root.createConversation({
      id: chatId,
      title: "Cleanup retry",
      createdAt,
      updatedAt: createdAt,
      summary: "",
      pinned: false,
      skillIds: [],
      messageCount: 0,
    });
    expect(created.ok).toBe(true);
    await expect(root.deleteConversation(chatId, createdAt)).resolves.toMatchObject({ ok: true });

    const queued = await root.listPendingConversationCleanups(3);
    expect(queued).toEqual([expect.objectContaining({ chatId, attempts: 0 })]);
    expect(await root.listPendingConversationCleanups(3, queued[0]!.nextAttemptAt - 1, true)).toEqual([]);
    expect(await root.listPendingConversationCleanups(3, queued[0]!.nextAttemptAt, true)).toHaveLength(1);

    const expectedDelays = [5_000, 10_000, 20_000, 40_000, 80_000, 160_000, 300_000];
    for (const [index, delay] of expectedDelays.entries()) {
      const failedAt = 100_000 + index * 1_000_000;
      await root.recordConversationCleanupFailure(
        chatId,
        index === 0 ? "synthetic raw cleanup error" : "conversation_cleanup_failed",
        failedAt,
        false,
      );
      const [record] = await root.listPendingConversationCleanups(3);
      expect(record).toMatchObject({
        chatId,
        attempts: index + 1,
        nextAttemptAt: failedAt + delay,
        lastError: "conversation_cleanup_failed",
      });
      expect(await root.listPendingConversationCleanups(3, failedAt + delay - 1, true)).toEqual([]);
    }
    await root.recordConversationCleanupFailure(
      chatId,
      "conversation_cleanup_failed",
      9_000_000,
      false,
    );

    expect(await root.listPendingConversationCleanups()).toEqual([]);
    const summary = await root.inspectCleanupReliability();
    expect(summary.conversation).toEqual({
      pending: 1,
      terminal: 1,
      oldestDueAt: 0,
      maxAttempts: 8,
    });
    expect(summary.scheduledAt).toBeGreaterThan(Date.now() - 60_000);
    const evidence = JSON.stringify(summary);
    expect(evidence).not.toContain(chatId);
    expect(evidence).not.toContain(label);
  });

  it("retries conversation cleanup after UserState failure and Durable Object eviction", async () => {
    const { label } = await login(`agent-cleanup-eviction-${crypto.randomUUID()}`);
    const chatId = `cleanup-eviction-${crypto.randomUUID()}`;
    const root = await getRootAgent(label);
    const conversation = await getConversationAgent(label, chatId);
    const userState = env.USER_STATE.getByName(label);
    const createdAt = Date.now();
    await expect(root.createConversation({
      id: chatId,
      title: "Eviction cleanup",
      createdAt,
      updatedAt: createdAt,
      summary: "",
      pinned: false,
      skillIds: [],
      messageCount: 1,
    })).resolves.toMatchObject({ ok: true });
    await conversation.importLegacyMessages([{
      id: "cleanup-eviction-message",
      role: "user",
      parts: [{ type: "text", text: "synthetic cleanup payload" }],
    }]);
    await userState.upsertChat({
      id: chatId,
      title: "Eviction cleanup",
      createdAt,
      updatedAt: createdAt,
      summary: "",
      summaryUntil: 0,
      routeId: "",
      messages: [],
      serializedBytes: 20,
    });
    await root.deleteConversation(chatId, createdAt);
    await runInDurableObject(root, async (instance, state) => {
      state.storage.sql.exec("UPDATE chatus_conversation_cleanup SET next_attempt_at = 1 WHERE chat_id = ?", chatId);
      const failingUserState = new Proxy(env.USER_STATE, {
        get(target, property) {
          if (property === "getByName") {
            return (name: string) => {
              const stub = target.getByName(name);
              if (name !== label) return stub;
              return new Proxy(stub, {
                get(stubTarget, stubProperty) {
                  if (stubProperty === "deleteChat") {
                    return async () => { throw new Error("synthetic_user_state_cleanup_failure"); };
                  }
                  const value = Reflect.get(stubTarget, stubProperty, stubTarget);
                  return typeof value === "function" ? value.bind(stubTarget) : value;
                },
              });
            };
          }
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      await runTeamAgentCleanupSchedule({ ...env, USER_STATE: failingUserState }, label, instance);
      state.storage.sql.exec("UPDATE chatus_conversation_cleanup SET next_attempt_at = 1 WHERE chat_id = ?", chatId);
      state.storage.sql.exec("UPDATE cf_agents_schedules SET time = 1 WHERE callback = 'runCleanupSchedule'");
    });

    await expect(conversation.getConversationMessageCount()).resolves.toBe(0);
    await expect(userState.listChats()).resolves.toHaveLength(1);
    await expect(root.listPendingConversationCleanups()).resolves.toEqual([
      expect.objectContaining({ chatId, attempts: 1 }),
    ]);

    await evictDurableObject(root);
    const rootInstance = await getTeamAgentInstanceName(label);
    const restored = await getAgentByName(env.TEAM_AGENT, rootInstance) as DurableObjectStub<TeamAgent>;
    await expect(runDurableObjectAlarm(restored)).resolves.toBe(true);
    await expect(userState.listChats()).resolves.toEqual([]);
    await expect(restored.listPendingConversationCleanups()).resolves.toEqual([]);
    await expect(conversation.getConversationMessageCount()).resolves.toBe(0);
  });

  it("applies legacy replace semantics to the authoritative Agent conversation index", async () => {
    const { cookie } = await login(`agent-replace-${crypto.randomUUID()}`);
    const firstId = `replace-a-${crypto.randomUUID()}`;
    const removedId = `replace-b-${crypto.randomUUID()}`;
    for (const [id, updatedAt] of [[firstId, 20], [removedId, 30]] as const) {
      const saved = await apiRequest("/api/chats", cookie, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat: { id, title: id, createdAt: 10, updatedAt, messages: [] } }),
      });
      expect(saved.status).toBe(200);
    }
    await expect(apiRequest("/api/agent/conversations", cookie).then((response) => response.json()))
      .resolves.toMatchObject({ conversations: expect.arrayContaining([
        expect.objectContaining({ id: firstId }),
        expect.objectContaining({ id: removedId }),
      ]) });

    const replaced = await apiRequest("/api/chats/migrate", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "replace",
        chats: [{ id: firstId, title: "kept", createdAt: 10, updatedAt: 40, messages: [] }],
      }),
    });
    expect(replaced.status).toBe(200);
    await expect(apiRequest("/api/agent/conversations", cookie).then((response) => response.json()))
      .resolves.toMatchObject({ conversations: [expect.objectContaining({ id: firstId, title: "kept" })] });
    const staleRemovedReconnect = await apiRequest(`/agent?chatId=${encodeURIComponent(removedId)}`, cookie);
    expect(staleRemovedReconnect.status).toBe(410);
  });

  it("normalizes capability registries and projects only assigned Skills and tools", async () => {
    const memberLabel = `capability-member-${crypto.randomUUID()}`;
    const adminCookie = await adminLogin();
    const configResponse = await apiRequest("/api/admin/config", adminCookie, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        config: {
          routes: {
            capable: {
              label: "Capable",
              type: "openai-chat",
              baseUrl: "https://capable.example/v1",
              model: "capable-model",
              apiKey: "capable-key",
              supportsTools: true,
            },
          },
          defaults: {
            defaultRoute: "capable",
            allowedRoutes: ["capable"],
            allowedTools: ["builtin:text_stats"],
          },
          users: {
            [memberLabel]: { allowedSkills: ["first"] },
          },
          mcpServers: {
            remote: {
              enabled: true,
              label: "Remote",
              endpoint: "https://mcp.example/rpc",
              authType: "none",
            },
          },
          tools: {
            "builtin:text_stats": {
              enabled: true,
              label: "Text stats",
              inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
              executor: { type: "builtin", name: "text_stats" },
            },
            "mcp:remote:lookup": {
              enabled: true,
              label: "Lookup",
              inputSchema: { type: "object", properties: {} },
              confirmation: "auto",
              executor: { type: "mcp", serverId: "remote", remoteName: "lookup" },
            },
            malformed: { enabled: true, inputSchema: "not-a-schema", executor: { type: "builtin", name: "other" } },
          },
          skills: {
            later: {
              enabled: true,
              label: "Later",
              instructions: "Later instructions",
              order: 20,
              toolIds: ["builtin:text_stats", "mcp:remote:lookup"],
            },
            first: {
              enabled: true,
              label: "First",
              instructions: "First instructions",
              order: 10,
              toolIds: ["builtin:text_stats"],
            },
            disabled: { enabled: false, label: "Disabled", instructions: "Hidden" },
            malformed: { enabled: true, label: "Malformed" },
          },
        },
      }),
    });
    expect(configResponse.status).toBe(200);
    const saved = await configResponse.json() as any;
    expect(saved.config.mcpServers.remote).toMatchObject({ auth: { version: 1, type: "none" } });
    expect(saved.config.mcpServers.remote).not.toHaveProperty("authType");
    expect(saved.config.tools).not.toHaveProperty("malformed");
    expect(saved.config.skills).not.toHaveProperty("malformed");
    expect(saved.config.tools["mcp:remote:lookup"].confirmation).toBe("first-per-conversation");
    expect(saved.config.users[memberLabel].allowedSkills).toEqual(["first"]);

    const { cookie } = await login(memberLabel);
    const session = await apiRequest("/api/session", cookie).then((response) => response.json()) as any;
    expect(session.routes).toMatchObject([{ id: "capable", supportsTools: true }]);
    expect(session.tools).toEqual([
      expect.objectContaining({ id: "builtin:text_stats", source: "builtin", confirmation: "auto" }),
    ]);
    expect(session.skills).toMatchObject([{ id: "first", toolIds: ["builtin:text_stats"] }]);
    expect(JSON.stringify(session)).not.toContain("mcp.example");
    expect(JSON.stringify(session)).not.toContain("inputSchema");

    const legacyMember = await login(`legacy-capability-member-${crypto.randomUUID()}`);
    const legacySession = await apiRequest("/api/session", legacyMember.cookie).then((response) => response.json()) as any;
    expect(legacySession.skills.map((skill: any) => skill.id)).toEqual(["first", "later"]);
  });

  it("seeds catalog workflows only for the truly unconfigured default", async () => {
    const adminCookie = await adminLogin();
    const expectedIds = [
      "chatus:writing",
      "chatus:summarize",
      "chatus:translate",
      "chatus:code_explanation",
      "chatus:structured_output",
    ];
    const unconfigured = await apiRequest("/api/admin/config", adminCookie).then((response) => response.json()) as any;
    expect(unconfigured.source).toBe("default");
    expect(Object.keys(unconfigured.config.skills)).toEqual(expectedIds);
    expect(unconfigured.config.defaults.allowedSkills).toEqual(expectedIds);

    const storedConfig = {
      routes: {
        stored: {
          label: "Stored",
          type: "openai-chat",
          baseUrl: "https://stored.example/v1",
          model: "stored-model",
          apiKey: "stored-test-key",
        },
      },
      defaults: { defaultRoute: "stored", allowedRoutes: ["stored"] },
    };
    const secretEnv = { ...env, ROUTES_CONFIG: JSON.stringify(storedConfig) } as any;
    const secretResponse = await worker.fetch(new Request("https://example.test/api/admin/config", {
      headers: { Cookie: adminCookie },
    }), secretEnv);
    const secret = await secretResponse.json() as any;
    expect(secret.source).toBe("secret");
    expect(secret.config.skills).toEqual({});
    expect(secret.config.defaults).not.toHaveProperty("allowedSkills");

    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify(storedConfig));
    const kv = await apiRequest("/api/admin/config", adminCookie).then((response) => response.json()) as any;
    expect(kv.source).toBe("kv");
    expect(kv.config.skills).toEqual({});
    expect(kv.config.defaults).not.toHaveProperty("allowedSkills");
  });

  it("previews and installs catalog workflows with revision, assignment, and audit boundaries", async () => {
    const deniedLabel = `catalog-denied-${crypto.randomUUID()}`;
    const visionLabel = `catalog-vision-${crypto.randomUUID()}`;
    const baseConfig = {
      routes: {
        default: {
          label: "Default",
          type: "openai-chat",
          baseUrl: "https://catalog.example/v1",
          model: "catalog-model",
          apiKey: "catalog-test-key",
        },
      },
      defaults: {
        defaultRoute: "default",
        allowedRoutes: ["default"],
        allowedSkills: ["custom"],
      },
      users: {
        [deniedLabel]: { allowedSkills: [], allowedAugmentations: [] },
        [visionLabel]: { allowedSkills: [], allowedAugmentations: ["vision_assist"] },
      },
      skills: {
        custom: { enabled: true, label: "Custom", instructions: "Custom instructions.", toolIds: [] },
      },
    };
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify(baseConfig));
    const adminCookie = await adminLogin();
    const initial = await apiRequest("/api/admin/config", adminCookie).then((response) => response.json()) as any;

    const previewResponse = await apiRequest("/api/admin/capability-packs", adminCookie);
    const preview = await previewResponse.json() as any;
    expect(previewResponse.status).toBe(200);
    expect(isAdminCapabilityCatalogSnapshot(preview)).toBe(true);
    expect(preview.packs[0].items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "chatus:writing", status: "missing", installable: true }),
      expect.objectContaining({ id: "chatus:web_research", status: "requires_setup", installable: false }),
      expect.objectContaining({ id: "chatus:vision_assist", status: "requires_setup", installable: false }),
    ]));
    const readyConfig: any = structuredClone(baseConfig);
    readyConfig.routes.default.supportsImages = true;
    readyConfig.visionAssist = { enabled: true, routeId: "default", maxOutputChars: 6_000 };
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify(readyConfig));
    const readyPreview = await apiRequest("/api/admin/capability-packs", adminCookie).then((response) => response.json()) as any;
    expect(readyPreview.packs[0].items).toContainEqual(expect.objectContaining({
      id: "chatus:vision_assist",
      status: "installed",
      installable: false,
    }));
    readyConfig.visionAssist.enabled = false;
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify(readyConfig));
    const disabledPreview = await apiRequest("/api/admin/capability-packs", adminCookie).then((response) => response.json()) as any;
    expect(disabledPreview.packs[0].items).toContainEqual(expect.objectContaining({
      id: "chatus:vision_assist",
      status: "disabled",
      installable: false,
    }));
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify(baseConfig));

    const duplicate = await apiRequest("/api/admin/capability-packs/install", adminCookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        packId: "chatus:starter-capabilities",
        itemIds: ["chatus:writing", "chatus:writing"],
        expectedRevision: initial.revision,
      }),
    });
    expect(duplicate.status).toBe(400);

    const unknown = await apiRequest("/api/admin/capability-packs/install", adminCookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        packId: "chatus:starter-capabilities",
        itemIds: ["chatus:unknown"],
        expectedRevision: initial.revision,
      }),
    });
    expect(unknown.status).toBe(400);
    await expect(unknown.json()).resolves.toMatchObject({ error: "invalid_capability_pack_items" });
    expect(await env.CHAT_STORE.get<any>(ROUTES_CONFIG_KEY, "json")).toEqual(baseConfig);
    expect(await env.CHAT_STORE.get(ADMIN_AUDIT_KEY)).toBeNull();

    const changedConfig: any = structuredClone(baseConfig);
    changedConfig.defaults.dailyMessageLimit = 21;
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify(changedConfig));
    const stale = await apiRequest("/api/admin/capability-packs/install", adminCookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        packId: "chatus:starter-capabilities",
        itemIds: ["chatus:writing"],
        expectedRevision: initial.revision,
      }),
    });
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({ error: "config_conflict" });
    expect((await env.CHAT_STORE.get<any>(ROUTES_CONFIG_KEY, "json")).skills).not.toHaveProperty("chatus:writing");

    const latest = await apiRequest("/api/admin/config", adminCookie).then((response) => response.json()) as any;
    const selected = ["chatus:writing", "chatus:summarize"];
    const installResponse = await apiRequest("/api/admin/capability-packs/install", adminCookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        packId: "chatus:starter-capabilities",
        itemIds: selected,
        expectedRevision: latest.revision,
      }),
    });
    const installed = await installResponse.json() as any;
    expect(installResponse.status, JSON.stringify(installed)).toBe(200);
    expect(isAdminCapabilityPackInstallResponse(installed, selected)).toBe(true);
    expect(installed.installed).toEqual(selected);
    expect(installed.skipped).toEqual([]);
    expect(installed.config.defaults.allowedSkills).toEqual(["custom", ...selected]);
    expect(installed.config.skills["chatus:writing"]).toMatchObject({
      origin: "chatus",
      activation: "automatic",
      toolIds: [],
    });

    const stored = await env.CHAT_STORE.get<any>(ROUTES_CONFIG_KEY, "json");
    expect(stored.defaults.allowedSkills).toEqual(["custom", ...selected]);
    expect(stored.users[deniedLabel].allowedSkills).toEqual([]);
    expect(stored.users[deniedLabel].allowedAugmentations).toEqual([]);
    const audit = await env.CHAT_STORE.get<any>(ADMIN_AUDIT_KEY, "json");
    expect(audit[0]).toMatchObject({ action: "capability-pack.install", target: "chatus:starter-capabilities:2" });
    expect(JSON.stringify(audit)).not.toContain("Custom instructions");
    expect(JSON.stringify(audit)).not.toContain("catalog-test-key");

    const denied = await login(deniedLabel);
    const deniedSession = await apiRequest("/api/session", denied.cookie).then((response) => response.json()) as any;
    expect(deniedSession.availableCapabilities).toEqual([]);
    const vision = await login(visionLabel);
    const visionSession = await apiRequest("/api/session", vision.cookie).then((response) => response.json()) as any;
    expect(visionSession.availableCapabilities).toEqual([expect.objectContaining({
      id: "chatus:vision_assist",
      activation: "route_augmentation",
      availability: "requires_setup",
      unavailableReason: "helper_unavailable",
    })]);

    const invalidActivation = structuredClone(installed.config);
    invalidActivation.skills.custom.activation = "scheduled";
    const invalidActivationResponse = await apiRequest("/api/admin/config", adminCookie, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: invalidActivation, expectedRevision: installed.revision }),
    });
    expect(invalidActivationResponse.status).toBe(400);

    const invalidBuiltinRole = structuredClone(installed.config);
    invalidBuiltinRole.tools["builtin:text_stats"].capabilityRole = "web_search";
    const invalidBuiltinRoleResponse = await apiRequest("/api/admin/config", adminCookie, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: invalidBuiltinRole, expectedRevision: installed.revision }),
    });
    expect(invalidBuiltinRoleResponse.status).toBe(400);
  });

  it("refuses a catalog ID collision without changing configuration or audit", async () => {
    const rawConfig = {
      routes: {
        default: {
          label: "Default",
          type: "openai-chat",
          baseUrl: "https://collision.example/v1",
          model: "collision-model",
          apiKey: "collision-test-key",
        },
      },
      defaults: { defaultRoute: "default", allowedRoutes: ["default"] },
      skills: {
        "chatus:writing": {
          enabled: true,
          label: "Administrator writing",
          instructions: "Keep this administrator-owned definition.",
          toolIds: [],
        },
      },
    };
    const raw = JSON.stringify(rawConfig);
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, raw);
    const adminCookie = await adminLogin();
    const snapshot = await apiRequest("/api/admin/config", adminCookie).then((response) => response.json()) as any;
    const preview = await apiRequest("/api/admin/capability-packs", adminCookie).then((response) => response.json()) as any;
    expect(preview.packs[0].items).toContainEqual(expect.objectContaining({
      id: "chatus:writing",
      status: "conflict",
      installable: false,
    }));

    const response = await apiRequest("/api/admin/capability-packs/install", adminCookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        packId: "chatus:starter-capabilities",
        itemIds: ["chatus:writing"],
        expectedRevision: snapshot.revision,
      }),
    });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "capability_pack_collision",
      itemIds: ["chatus:writing"],
    });
    expect(await env.CHAT_STORE.get(ROUTES_CONFIG_KEY)).toBe(raw);
    expect(await env.CHAT_STORE.get(ADMIN_AUDIT_KEY)).toBeNull();
  });

  it("adds the disabled built-in tool to legacy editable configs without granting it", async () => {
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      routes: {
        default: {
          label: "Default",
          type: "openai-chat",
          baseUrl: "https://legacy.example/v1",
          model: "legacy-model",
          apiKey: "legacy-key",
          supportsTools: true,
        },
      },
      defaults: { defaultRoute: "default", allowedRoutes: ["default"] },
    }));
    const adminCookie = await adminLogin();
    const editable = await apiRequest("/api/admin/config", adminCookie).then((response) => response.json()) as any;
    expect(editable.config.tools["builtin:text_stats"]).toMatchObject({
      enabled: false,
      confirmation: "auto",
      executor: { type: "builtin", name: "text_stats" },
    });

    const { cookie } = await login();
    const session = await apiRequest("/api/session", cookie).then((response) => response.json()) as any;
    expect(session.tools).toEqual([]);
  });

  it("filters selected Skills by assignment, caps input, and composes them in administrator order", async () => {
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      routes: {
        default: {
          label: "Default",
          type: "openai-chat",
          baseUrl: "https://skills.example/v1",
          model: "skills-model",
          apiKey: "skills-key",
        },
      },
      defaults: {
        defaultRoute: "default",
        allowedRoutes: ["default"],
        allowedSkills: ["skill-2", "skill-4"],
      },
      skills: Object.fromEntries([1, 2, 3, 4].map((order) => [`skill-${order}`, {
        enabled: true,
        label: `Skill ${order}`,
        instructions: `instruction-${order}`,
        order,
      }])),
    }));
    const { cookie } = await login();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementationOnce(async () =>
      openAiTextResponse("技能已应用"));
    const response = await apiRequest("/api/chat", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Chatus-Client": "web" },
      body: JSON.stringify({
        routeId: "default",
        skillIds: ["skill-4", "skill-2", "skill-3", "skill-1"],
        messages: [{ role: "user", content: "完成一个带技能的小任务" }],
      }),
    });
    expect(response.status).toBe(200);
    const upstream = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as any;
    const system = upstream.messages.filter((message: any) => message.role === "system").map((message: any) => message.content).join("\n");
    expect(system.indexOf("instruction-2")).toBeLessThan(system.indexOf("instruction-4"));
    expect(system).not.toContain("instruction-1");
    expect(system).not.toContain("instruction-3");
    await expect(response.text()).resolves.toContain("技能已应用");
  });

  it("completes an OpenAI-compatible built-in tool round trip", async () => {
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      routes: {
        tools: {
          label: "Tools",
          type: "openai-chat",
          baseUrl: "https://tools-openai.example/v1",
          model: "tools-model",
          apiKey: "tools-key",
          supportsTools: true,
        },
      },
      defaults: {
        defaultRoute: "tools",
        allowedRoutes: ["tools"],
        allowedTools: ["builtin:text_stats"],
      },
      tools: {
        "builtin:text_stats": {
          enabled: true,
          label: "Text stats",
          inputSchema: {
            type: "object",
            properties: { text: { type: "string" } },
            required: ["text"],
            additionalProperties: false,
          },
          executor: { type: "builtin", name: "text_stats" },
        },
      },
      skills: {
        analyze: {
          enabled: true,
          label: "Analyze",
          instructions: "Use text statistics when useful.",
          toolIds: ["builtin:text_stats"],
        },
      },
    }));
    const { cookie } = await login();
    let providerName = "";
    const requestBodies: any[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      requestBodies.push(body);
      if (requestBodies.length === 1) {
        providerName = body.tools[0].function.name;
        return new Response(JSON.stringify({
          choices: [{
            message: {
              role: "assistant",
              content: null,
              tool_calls: [{
                id: "call-openai-1",
                type: "function",
                function: { name: providerName, arguments: JSON.stringify({ text: "Hello\n世界" }) },
              }],
            },
            finish_reason: "tool_calls",
          }],
        }), { headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({
        choices: [{ message: { role: "assistant", content: "统计完成" }, finish_reason: "stop" }],
      }), { headers: { "Content-Type": "application/json" } });
    });

    const response = await apiRequest("/api/chat", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Chatus-Client": "web" },
      body: JSON.stringify({
        routeId: "tools",
        chatId: "chat-tools-openai",
        skillIds: ["analyze"],
        messages: [{ role: "user", content: "统计这段文本" }],
      }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Chatus-Stream")).toBe("capability-v1");
    const events = await readCapabilityEvents(response);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "run", routeId: "tools", fallback: false }),
      expect.objectContaining({ type: "tool", event: expect.objectContaining({ status: "running", toolId: "builtin:text_stats" }) }),
      expect.objectContaining({ type: "tool", event: expect.objectContaining({ status: "completed", resultPreview: expect.stringContaining('"words":2') }) }),
      { type: "assistant_delta", text: "统计完成" },
      { type: "finish", finishReason: "stop" },
      { type: "done" },
    ]));
    expect(requestBodies).toHaveLength(2);
    expect(requestBodies[0]).toMatchObject({ stream: false, tool_choice: "auto" });
    expect(requestBodies[1].messages.at(-1)).toMatchObject({
      role: "tool",
      tool_call_id: "call-openai-1",
      content: JSON.stringify({ characters: 8, codePoints: 8, words: 2, lines: 2 }),
    });
    expect(providerName).toMatch(/^text_stats_[a-f0-9]{10}$/);
    const toolAttempts = await env.PROVIDER_ATTEMPT_LEDGER.getByName("legacy:tools").listRecent({ limit: 10 });
    expect(toolAttempts).toHaveLength(2);
    expect(toolAttempts.map(({ runKind }) => runKind).sort()).toEqual([
      "legacy_capability",
      "tool_continuation",
    ]);
    expect(new Set(toolAttempts.map(({ turnId }) => turnId))).toHaveProperty("size", 1);
    expect(new Set(toolAttempts.map(({ runId }) => runId))).toHaveProperty("size", 2);
    expect(toolAttempts.every(({ status }) => status === "succeeded")).toBe(true);
  });

  it("projects an initial legacy capability budget denial with zero Provider calls", async () => {
    const providerId = `capability-budget-initial-${crypto.randomUUID()}`;
    const routeId = "capability-budget-initial";
    const model = "capability-budget-model";
    await env.CHAT_STORE.put(
      ROUTES_CONFIG_KEY,
      JSON.stringify(capabilityBudgetConfig(providerId, routeId, model)),
    );
    await seedHardProviderBudget({ providerId, routeId, model, knownPrice: false });
    const { cookie } = await login();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const response = await apiRequest("/api/chat", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Chatus-Client": "web" },
      body: JSON.stringify({
        routeId,
        chatId: "capability-budget-initial-chat",
        skillIds: ["budget-analyze"],
        messages: [{ role: "user", content: "Do not exceed the configured budget." }],
      }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Chatus-Stream")).toBe("capability-v1");
    const events = await readCapabilityEvents(response);
    expect(events).toContainEqual({
      type: "error",
      code: "provider_budget_policy_unknown",
      message: "当前 Provider 缺少可验证的价格策略，请联系管理员完成配置。",
      retryable: true,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(JSON.stringify(events)).not.toContain(providerId);
    expect(JSON.stringify(events)).not.toContain("TEST_ROUTE_KEY");
  });

  it("blocks a legacy tool continuation after the first attempt consumes the hard budget", async () => {
    const providerId = `capability-budget-continuation-${crypto.randomUUID()}`;
    const routeId = "capability-budget-continuation";
    const model = "capability-budget-model";
    await env.CHAT_STORE.put(
      ROUTES_CONFIG_KEY,
      JSON.stringify(capabilityBudgetConfig(providerId, routeId, model)),
    );
    await seedHardProviderBudget({ providerId, routeId, model, knownPrice: true });
    const { cookie } = await login();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementationOnce(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as any;
      return new Response(JSON.stringify({
        choices: [{
          message: {
            role: "assistant",
            content: null,
            tool_calls: [{
              id: "call-budget-continuation",
              type: "function",
              function: {
                name: body.tools[0].function.name,
                arguments: JSON.stringify({ text: "local continuation" }),
              },
            }],
          },
          finish_reason: "tool_calls",
        }],
      }), { headers: { "Content-Type": "application/json" } });
    });
    const response = await apiRequest("/api/chat", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Chatus-Client": "web" },
      body: JSON.stringify({
        routeId,
        chatId: "capability-budget-continuation-chat",
        skillIds: ["budget-analyze"],
        messages: [{ role: "user", content: "Run one local tool and stop before a second Provider call." }],
      }),
    });
    const events = await readCapabilityEvents(response);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "tool",
        event: expect.objectContaining({ status: "completed", toolId: "builtin:text_stats" }),
      }),
      {
        type: "error",
        code: "provider_budget_exceeded",
        message: "当前 Provider 预算已用尽，请联系管理员调整预算或稍后再试。",
        retryable: true,
      },
    ]));
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(JSON.stringify(events)).not.toContain(providerId);
    expect(JSON.stringify(events)).not.toContain("TEST_ROUTE_KEY");
  });

  it("completes an Anthropic built-in tool round trip", async () => {
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      routes: {
        tools: {
          label: "Tools",
          type: "anthropic-messages",
          baseUrl: "https://tools-anthropic.example",
          model: "claude-tools",
          apiKey: "anthropic-key",
          supportsTools: true,
        },
      },
      defaults: {
        defaultRoute: "tools",
        allowedRoutes: ["tools"],
        allowedTools: ["builtin:text_stats"],
      },
      tools: {
        "builtin:text_stats": {
          enabled: true,
          label: "Text stats",
          inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
          executor: { type: "builtin", name: "text_stats" },
        },
      },
      skills: {
        analyze: { enabled: true, label: "Analyze", instructions: "Analyze text.", toolIds: ["builtin:text_stats"] },
      },
    }));
    const { cookie } = await login();
    const requestBodies: any[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      requestBodies.push(body);
      if (requestBodies.length === 1) {
        return new Response(JSON.stringify({
          content: [{ type: "tool_use", id: "toolu-1", name: body.tools[0].name, input: { text: "one two" } }],
          stop_reason: "tool_use",
        }), { headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({
        content: [{ type: "text", text: "Anthropic 完成" }],
        stop_reason: "end_turn",
      }), { headers: { "Content-Type": "application/json" } });
    });
    const response = await apiRequest("/api/chat", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Chatus-Client": "web" },
      body: JSON.stringify({
        routeId: "tools",
        chatId: "chat-tools-anthropic",
        skillIds: ["analyze"],
        messages: [{ role: "user", content: "统计单词" }],
      }),
    });
    const events = await readCapabilityEvents(response);
    expect(events).toEqual(expect.arrayContaining([
      { type: "assistant_delta", text: "Anthropic 完成" },
      { type: "finish", finishReason: "end_turn" },
      { type: "done" },
    ]));
    expect(requestBodies).toHaveLength(2);
    expect(requestBodies[0].stream).toBe(false);
    expect(requestBodies[1].messages.slice(-2)).toMatchObject([
      { role: "assistant", content: [{ type: "tool_use", id: "toolu-1" }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu-1", content: expect.stringContaining('"words":2') }] },
    ]);
  });

  it("releases an exclusive provider lease when the legacy stream request throws", async () => {
    const providerId = `network-failure-${crypto.randomUUID()}`;
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      providers: {
        [providerId]: {
          label: "Exclusive network provider",
          type: "openai-chat",
          baseUrl: "https://network-failure.example/v1",
          apiKey: "network-key",
          concurrency: "exclusive",
        },
      },
      routes: {
        model: {
          label: "Network model",
          offerings: [{ providerId, model: "network-model" }],
        },
      },
      defaults: { defaultRoute: "model", allowedRoutes: ["model"] },
    }));
    const { cookie } = await login();
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("network unavailable"));

    const response = await apiRequest("/api/chat", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Chatus-Client": "web" },
      body: JSON.stringify({ routeId: "model", messages: [{ role: "user", content: "测试网络异常" }] }),
    });

    expect(response.status).toBe(502);
    await expect(env.PROVIDER_COORDINATOR.getByName(providerId).inspect()).resolves.toMatchObject({ active: 0 });
  });

  it("falls back when an HTTP 200 Anthropic stream starts with an error event", async () => {
    const primaryId = `anthropic-error-${crypto.randomUUID()}`;
    const backupId = `openai-backup-${crypto.randomUUID()}`;
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      providers: {
        [primaryId]: {
          label: "Anthropic primary",
          type: "anthropic-messages",
          baseUrl: "https://anthropic-stream-error.example",
          apiKey: "anthropic-primary-key",
          concurrency: "exclusive",
          priority: 100,
        },
        [backupId]: {
          label: "OpenAI backup",
          type: "openai-chat",
          baseUrl: "https://openai-stream-backup.example/v1",
          apiKey: "openai-backup-key",
          concurrency: "exclusive",
          priority: 10,
        },
      },
      routes: {
        model: {
          label: "Fallback model",
          offerings: [
            { providerId: primaryId, model: "anthropic-primary" },
            { providerId: backupId, model: "openai-backup" },
          ],
        },
      },
      defaults: { defaultRoute: "model", allowedRoutes: ["model"] },
    }));
    const { cookie } = await login();
    const usageBefore = (await apiRequest("/api/session", cookie).then((item) => item.json()) as any).usage.used;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("anthropic-stream-error.example")) {
        return new Response(
          'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"busy"}}\n\n',
          { status: 200, headers: { "Content-Type": "text/event-stream" } },
        );
      }
      return openAiTextResponse("备用服务商完成");
    });

    const response = await apiRequest("/api/chat", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Chatus-Client": "web" },
      body: JSON.stringify({
        routeId: "model",
        providerId: "forged-provider",
        model: "forged-model",
        turnId: `turn_${crypto.randomUUID()}`,
        runId: `run_${crypto.randomUUID()}`,
        attemptId: `attempt_${crypto.randomUUID()}`,
        messages: [{ role: "user", content: "执行回退测试" }],
      }),
    });
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain("备用服务商完成");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(String(fetchSpy.mock.calls[0][0])).toContain("anthropic-stream-error.example");
    expect(String(fetchSpy.mock.calls[1][0])).toContain("openai-stream-backup.example");
    await expect(env.CHAT_STORE.get(
      `${PROVIDER_ROUTE_RELIABILITY_PREFIX}model:${encodeURIComponent(primaryId)}`,
      "json",
    )).resolves.toMatchObject({ attempts: 1, successes: 0, lastOutcome: "protocol_error" });
    await expect(env.CHAT_STORE.get(
      `${PROVIDER_ROUTE_RELIABILITY_PREFIX}model:${encodeURIComponent(backupId)}`,
      "json",
    )).resolves.toMatchObject({ attempts: 1, successes: 1, lastOutcome: "success" });
    await expect(env.CHAT_STORE.get(`${ROUTE_RELIABILITY_PREFIX}model`, "json")).resolves.toMatchObject({
      ok: true,
      outcome: "success",
      fallback: true,
    });
    await expect(env.PROVIDER_COORDINATOR.getByName(primaryId).inspect()).resolves.toMatchObject({ active: 0 });
    await expect(env.PROVIDER_COORDINATOR.getByName(backupId).inspect()).resolves.toMatchObject({ active: 0 });
    const [primaryAttempt] = await env.PROVIDER_ATTEMPT_LEDGER.getByName(primaryId).listRecent();
    const [backupAttempt] = await env.PROVIDER_ATTEMPT_LEDGER.getByName(backupId).listRecent();
    expect(primaryAttempt).toMatchObject({
      logicalRouteId: "model",
      providerId: primaryId,
      model: "anthropic-primary",
      fallbackIndex: 0,
      status: "failed",
      errorClass: "provider_protocol_error",
    });
    expect(backupAttempt).toMatchObject({
      turnId: primaryAttempt.turnId,
      runId: primaryAttempt.runId,
      logicalRouteId: "model",
      providerId: backupId,
      model: "openai-backup",
      fallbackIndex: 1,
      status: "succeeded",
    });
    expect(JSON.stringify([primaryAttempt, backupAttempt])).not.toContain("forged-");
    const usageAfter = (await apiRequest("/api/session", cookie).then((item) => item.json()) as any).usage.used;
    expect(usageAfter).toBe(usageBefore + 1);
  });

  it("rejects an empty DONE-only stream and records a protocol failure", async () => {
    const providerId = `empty-stream-${crypto.randomUUID()}`;
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      providers: {
        [providerId]: {
          label: "Empty provider",
          type: "openai-chat",
          baseUrl: "https://empty-stream.example/v1",
          apiKey: "empty-stream-key",
          concurrency: "exclusive",
        },
      },
      routes: {
        model: { label: "Empty model", offerings: [{ providerId, model: "empty-model" }] },
      },
      defaults: { defaultRoute: "model", allowedRoutes: ["model"] },
    }));
    const { cookie } = await login();
    vi.spyOn(globalThis, "fetch").mockImplementationOnce(async () => new Response("data: [DONE]\n\n", {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    }));

    const response = await apiRequest("/api/chat", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Chatus-Client": "web" },
      body: JSON.stringify({ routeId: "model", messages: [{ role: "user", content: "测试空流" }] }),
    });
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ error: "provider_protocol_error", status: 502 });
    await expect(env.CHAT_STORE.get(`${ROUTE_RELIABILITY_PREFIX}model`, "json")).resolves.toMatchObject({
      ok: false,
      outcome: "protocol_error",
    });
    await expect(env.PROVIDER_COORDINATOR.getByName(providerId).inspect()).resolves.toMatchObject({ active: 0 });
  });

  it("projects a required budget-ledger outage before legacy chat Provider execution", async () => {
    const providerId = `budget-ledger-outage-${crypto.randomUUID()}`;
    const endpoint = `https://${providerId}.example/v1`;
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      providers: {
        [providerId]: {
          label: "Unavailable budget ledger provider",
          type: "openai-chat",
          baseUrl: endpoint,
          apiKeyRef: "TEST_ROUTE_KEY",
        },
      },
      routes: {
        budgeted: {
          label: "Budgeted route",
          offerings: [{ providerId, model: "budgeted-model" }],
        },
      },
      defaults: { defaultRoute: "budgeted", allowedRoutes: ["budgeted"] },
    }));
    const { cookie } = await login();
    const startBudgetedAttempt = vi.fn(async () => {
      throw new Error("PRIVATE_BUDGET_LEDGER_OUTAGE");
    });
    const unavailableEnv = new Proxy(env, {
      get(target, property, receiver) {
        if (property === "PROVIDER_ATTEMPT_LEDGER") {
          return { getByName: () => ({ startBudgetedAttempt }) };
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const response = await worker.fetch(new Request("https://example.test/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Chatus-Client": "web",
        Cookie: cookie,
      },
      body: JSON.stringify({
        routeId: "budgeted",
        messages: [{ role: "user", content: "Do not call the Provider while the budget ledger is unavailable." }],
      }),
    }), unavailableEnv);
    const text = await response.text();
    expect(response.status, text).toBe(503);
    expect(JSON.parse(text)).toEqual({
      error: "provider_budget_unavailable",
      message: "Provider 预算账本暂时不可用，请稍后重试。",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(text).not.toContain("PRIVATE_BUDGET_LEDGER_OUTAGE");
    expect(text).not.toContain(providerId);
    expect(text).not.toContain(endpoint);
  });

  it("releases a provider lease when visible stream output fails", async () => {
    let pulls = 0;
    let released = 0;
    let upstreamCancelled = false;
    let completed = 0;
    const failures: unknown[] = [];
    const failure = new Error("invalid SSE event");
    const encoder = new TextEncoder();
    const response = responseWithProviderLease(
      new Response(new ReadableStream<Uint8Array>({
        pull(controller) {
          if (pulls++ === 0) {
            controller.enqueue(encoder.encode(openAiTextEvent("已输出")));
            return;
          }
          controller.error(failure);
        },
      }), { status: 200, headers: { "Content-Type": "text/event-stream" } }),
      {
        providerId: "test-provider",
        requestId: "test-request",
        release: async () => { released += 1; },
      },
      {
        onComplete: async () => { completed += 1; },
        onError: async (error) => { failures.push(error); },
      },
      async () => { upstreamCancelled = true; },
    );

    const reader = response.body!.getReader();
    await expect(reader.read()).resolves.toMatchObject({ done: false });
    await expect(reader.read()).rejects.toBe(failure);
    expect(released).toBe(1);
    expect(upstreamCancelled).toBe(true);
    expect(completed).toBe(0);
    expect(failures).toEqual([failure]);
  });

  it("runs lease and admission cleanup before surfacing a terminal ledger failure", async () => {
    const ledgerError = new ProviderAttemptLedgerError();
    let released = 0;
    let admissionReleased = 0;
    const response = responseWithProviderLease(
      new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(openAiTextEvent("已完成")));
          controller.close();
        },
      }), { status: 200, headers: { "Content-Type": "text/event-stream" } }),
      {
        providerId: "test-provider",
        requestId: "test-request",
        release: async () => { released += 1; },
      },
      {
        attempt: {
          succeed: async () => { throw ledgerError; },
          fail: async () => undefined,
          cancel: async () => undefined,
          timeout: async () => undefined,
        },
        onComplete: async () => { admissionReleased += 1; },
        onError: async () => undefined,
      },
    );

    const reader = response.body!.getReader();
    await expect(reader.read()).resolves.toMatchObject({ done: false });
    await expect(reader.read()).rejects.toBe(ledgerError);
    expect(released).toBe(1);
    expect(admissionReleased).toBe(1);
  });

  it("records and surfaces a bodyless provider response as a protocol failure", async () => {
    const ledgerError = new ProviderAttemptLedgerError();
    let released = 0;
    let admissionReleased = 0;
    let upstreamCancelled = 0;
    const failures: unknown[] = [];
    const response = responseWithProviderLease(
      new Response(null, { status: 200, headers: { "Content-Type": "text/event-stream" } }),
      {
        providerId: "test-provider",
        requestId: "test-request",
        release: async () => { released += 1; },
      },
      {
        attempt: {
          succeed: async () => undefined,
          fail: async (error) => {
            failures.push(error);
            throw ledgerError;
          },
          cancel: async () => undefined,
          timeout: async () => undefined,
        },
        onComplete: async () => undefined,
        onError: async (error) => {
          failures.push(error);
          admissionReleased += 1;
        },
      },
      async () => { upstreamCancelled += 1; },
    );

    await expect(response.body!.getReader().read()).rejects.toBe(ledgerError);
    expect(failures).toHaveLength(2);
    expect(failures[0]).toMatchObject({ name: "ProviderProtocolError" });
    expect(failures[1]).toBe(failures[0]);
    expect(released).toBe(1);
    expect(admissionReleased).toBe(1);
    expect(upstreamCancelled).toBe(1);
  });

  it("releases a provider lease on stream cancellation without recording success or failure", async () => {
    let released = 0;
    let upstreamCancelled = false;
    let completed = 0;
    let failed = 0;
    const encoder = new TextEncoder();
    const response = responseWithProviderLease(
      new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(openAiTextEvent("开始输出")));
        },
      }), { status: 200, headers: { "Content-Type": "text/event-stream" } }),
      {
        providerId: "test-provider",
        requestId: "test-request",
        release: async () => { released += 1; },
      },
      {
        onComplete: async () => { completed += 1; },
        onError: async () => { failed += 1; },
      },
      async () => { upstreamCancelled = true; },
    );

    const reader = response.body!.getReader();
    await expect(reader.read()).resolves.toMatchObject({ done: false });
    await reader.cancel("test cancellation");
    expect(released).toBe(1);
    expect(upstreamCancelled).toBe(true);
    expect(completed).toBe(0);
    expect(failed).toBe(0);
  });

  it("releases an exclusive provider lease after a terminal capability-provider error", async () => {
    const providerId = `terminal-tools-${crypto.randomUUID()}`;
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      providers: {
        [providerId]: {
          label: "Exclusive tools provider",
          type: "openai-chat",
          baseUrl: "https://terminal-tools.example/v1",
          apiKey: "tools-key",
          concurrency: "exclusive",
          supportsTools: true,
        },
      },
      routes: {
        tools: {
          label: "Tools model",
          offerings: [{ providerId, model: "tools-model", supportsTools: true }],
          supportsTools: true,
        },
      },
      defaults: {
        defaultRoute: "tools",
        allowedRoutes: ["tools"],
        allowedTools: ["builtin:text_stats"],
      },
      tools: {
        "builtin:text_stats": {
          enabled: true,
          label: "Text stats",
          inputSchema: { type: "object", properties: { text: { type: "string" } } },
          executor: { type: "builtin", name: "text_stats" },
        },
      },
      skills: {
        analyze: {
          enabled: true,
          label: "Analyze",
          instructions: "Use text statistics.",
          toolIds: ["builtin:text_stats"],
        },
      },
    }));
    const { cookie } = await login();
    const providerBodyMarker = `PRIVATE_CAPABILITY_BODY_${crypto.randomUUID()}`;
    vi.spyOn(globalThis, "fetch").mockImplementationOnce(async () => new Response(
      JSON.stringify({ error: { message: providerBodyMarker } }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    ));

    const response = await apiRequest("/api/chat", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Chatus-Client": "web" },
      body: JSON.stringify({
        routeId: "tools",
        chatId: "terminal-tools-chat",
        skillIds: ["analyze"],
        messages: [{ role: "user", content: "测试终止错误" }],
      }),
    });
    const events = await readCapabilityEvents(response);

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "error",
        code: "upstream_request_rejected",
        message: "当前模型无法处理这次请求，请调整内容、切换模型或联系管理员。",
      }),
      { type: "done" },
    ]));
    expect(JSON.stringify(events)).not.toContain(providerBodyMarker);
    expect(JSON.stringify(events)).not.toContain("terminal-tools.example");
    await expect(env.PROVIDER_COORDINATOR.getByName(providerId).inspect()).resolves.toMatchObject({ active: 0 });
  });

  it("reports core binding health without exposing configuration details", async () => {
    await env.CHAT_STORE.put(ACCESS_CODES_KEY, "health-user:health-access-code");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const response = await exports.default.fetch(new Request("https://example.test/healthz"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    const payload = await response.json();
    expect(payload).toEqual({
      status: "ok",
      checks: {
        kv: true,
        durableObject: true,
        legacyDurableObject: true,
        teamAgent: true,
        configured: true,
        memberAccessConfigured: true,
      },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("health-access-code");
    expect(serialized).not.toContain("baseUrl");
    expect(serialized).not.toContain("model");
  });

  it("keeps model-free health ready during access-code bootstrap", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const response = await exports.default.fetch(new Request("https://example.test/healthz"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      checks: {
        configured: true,
        memberAccessConfigured: false,
      },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("projects default setup state with exact secret-free keys and no upstream request", async () => {
    const cookie = await adminLogin();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const response = await apiRequest("/api/admin/setup-status", cookie);
    expect(response.status).toBe(200);
    const payload = await response.json() as any;

    expect(Object.keys(payload).sort()).toEqual(["configSource", "ready", "steps"]);
    expect(Object.keys(payload.steps)).toEqual(["health", "provider", "model", "member", "permission", "smoke"]);
    for (const step of Object.values(payload.steps) as any[]) {
      expect(Object.keys(step).sort()).toEqual(["count", "ready", "status"]);
      expect(typeof step.ready).toBe("boolean");
      expect(Number.isInteger(step.count)).toBe(true);
      expect(["ready", "incomplete", "blocked", "not_run", "stale"]).toContain(step.status);
    }
    expect(payload).toMatchObject({
      ready: false,
      configSource: "default",
      steps: {
        health: { ready: true, status: "ready" },
        provider: { ready: false, status: "incomplete", count: 0 },
        model: { ready: false, status: "incomplete", count: 0 },
        member: { ready: false, status: "incomplete", count: 0 },
        permission: { ready: false, status: "incomplete", count: 0 },
        smoke: { ready: false, status: "blocked", count: 0 },
      },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    const serialized = JSON.stringify(payload);
    for (const forbidden of [
      "setup-provider.example",
      "setup-upstream-model",
      "test-admin-token",
      "TEST_ROUTE_KEY",
      "accessCode",
      "baseUrl",
      "apiKey",
      "modelName",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("supports Secret and KV setup sources without model calls", async () => {
    const cookie = await adminLogin();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const secretEnv = {
      ...env,
      ROUTES_CONFIG: JSON.stringify(setupReadyConfig()),
      ACCESS_CODES: "member:secret-member-code",
    } as any;
    const secretResponse = await worker.fetch(new Request("https://example.test/api/admin/setup-status", {
      headers: { Cookie: cookie },
    }), secretEnv);
    expect(secretResponse.status).toBe(200);
    await expect(secretResponse.json()).resolves.toMatchObject({
      ready: false,
      configSource: "secret",
      steps: {
        provider: { ready: true, count: 1 },
        model: { ready: true, count: 1 },
        member: { ready: true, count: 1 },
        permission: { ready: true, count: 1 },
        smoke: { ready: false, status: "not_run" },
      },
    });

    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify(setupReadyConfig()));
    await env.CHAT_STORE.put(ACCESS_CODES_KEY, "member:kv-member-code");
    const kvResponse = await apiRequest("/api/admin/setup-status", cookie);
    expect(kvResponse.status).toBe(200);
    await expect(kvResponse.json()).resolves.toMatchObject({
      ready: false,
      configSource: "kv",
      steps: {
        provider: { ready: true, count: 1 },
        model: { ready: true, count: 1 },
        member: { ready: true, count: 1 },
        permission: { ready: true, count: 1 },
        smoke: { ready: false, status: "not_run" },
      },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reports missing credential, offering, member, and explicit permission setup states", async () => {
    const cookie = await adminLogin();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const cases = [
      {
        config: setupReadyConfig({ apiKeyRef: "MISSING_SETUP_KEY" }),
        accessCodes: "member:member-code",
        expected: { provider: { ready: false, count: 0 }, model: { ready: true, count: 1 } },
      },
      {
        config: setupReadyConfig({ includeOffering: false }),
        accessCodes: "member:member-code",
        expected: { model: { ready: false, count: 0 } },
      },
      {
        config: setupReadyConfig({ includeMember: false }),
        accessCodes: "",
        expected: { member: { ready: false, count: 0 }, permission: { ready: false, count: 0 } },
      },
      {
        config: setupReadyConfig({ memberEnabled: false }),
        accessCodes: "member:member-code",
        expected: { member: { ready: true, count: 1 }, permission: { ready: false, count: 0 } },
      },
    ];

    for (const item of cases) {
      await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify(item.config));
      if (item.accessCodes) await env.CHAT_STORE.put(ACCESS_CODES_KEY, item.accessCodes);
      else await env.CHAT_STORE.delete(ACCESS_CODES_KEY);
      const response = await apiRequest("/api/admin/setup-status", cookie);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ ready: false, steps: item.expected });
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("runs local setup smoke and marks it stale after a relevant mutation", async () => {
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify(setupReadyConfig()));
    await env.CHAT_STORE.put(ACCESS_CODES_KEY, "member:member-code");
    const cookie = await adminLogin();
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const smokeResponse = await apiRequest("/api/admin/setup-smoke", cookie, { method: "POST" });
    expect(smokeResponse.status).toBe(200);
    await expect(smokeResponse.json()).resolves.toMatchObject({
      ready: true,
      steps: { smoke: { ready: true, status: "ready", count: 1 } },
    });
    expect(await env.CHAT_STORE.get(SETUP_SMOKE_KEY)).toContain("fingerprint");

    await env.CHAT_STORE.put(ACCESS_CODES_KEY, "member:rotated-member-code");
    const staleResponse = await apiRequest("/api/admin/setup-status", cookie);
    expect(staleResponse.status).toBe(200);
    await expect(staleResponse.json()).resolves.toMatchObject({
      ready: false,
      steps: { smoke: { ready: false, status: "stale", count: 0 } },
    });

    const rerunResponse = await apiRequest("/api/admin/setup-smoke", cookie, { method: "POST" });
    expect(rerunResponse.status).toBe(200);
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      ...setupReadyConfig(),
      defaults: { defaultRoute: "setup", allowedRoutes: ["setup"], dailyMessageLimit: 321 },
    }));
    const configStaleResponse = await apiRequest("/api/admin/setup-status", cookie);
    await expect(configStaleResponse.json()).resolves.toMatchObject({
      ready: false,
      steps: { smoke: { ready: false, status: "stale", count: 0 } },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses setup smoke until every local prerequisite is ready", async () => {
    const cookie = await adminLogin();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const response = await apiRequest("/api/admin/setup-smoke", cookie, { method: "POST" });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "setup_incomplete",
      message: "请先完成无模型 smoke 之前的配置步骤",
    });
    await expect(env.CHAT_STORE.get(SETUP_SMOKE_KEY)).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns a display name without changing the stable user label", async () => {
    const label = `named-${crypto.randomUUID()}`;
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      routes: {
        default: {
          label: "Default",
          type: "openai-chat",
          baseUrl: "https://named.example/v1",
          model: "named-model",
          apiKey: "named-key",
        },
      },
      defaults: { defaultRoute: "default", allowedRoutes: ["default"] },
      users: { [label]: { displayName: "小林" } },
    }));
    const { cookie } = await login(label);
    const response = await apiRequest("/api/session", cookie);
    await expect(response.json()).resolves.toMatchObject({
      authenticated: true,
      user: label,
      displayName: "小林",
      routes: [{ id: "default" }],
    });
  });

  it("blocks disabled users from new and existing sessions", async () => {
    const label = `paused-${crypto.randomUUID()}`;
    const { cookie } = await login(label);
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      routes: {
        default: {
          label: "Default",
          type: "openai-chat",
          baseUrl: "https://paused.example/v1",
          model: "paused-model",
          apiKey: "paused-key",
        },
      },
      defaults: { defaultRoute: "default", allowedRoutes: ["default"] },
      users: { [label]: { enabled: false, displayName: "暂停用户" } },
    }));

    expect((await apiRequest("/api/session", cookie)).status).toBe(401);
    const relogin = await exports.default.fetch(new Request("https://example.test/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "test-access-code" }),
    }));
    expect(relogin.status).toBe(403);
    await expect(relogin.json()).resolves.toMatchObject({ error: "user_disabled" });
  });

  it("rate limits repeated failed login attempts by client IP", async () => {
    await env.CHAT_STORE.put(ACCESS_CODES_KEY, "friend:correct-access-code");
    const ip = `test-${crypto.randomUUID()}`;
    const attempt = () => exports.default.fetch(new Request("https://example.test/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
      body: JSON.stringify({ code: "wrong-access-code" }),
    }));

    for (let index = 0; index < 8; index += 1) {
      expect((await attempt()).status).toBe(401);
    }
    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
    await expect(blocked.json()).resolves.toMatchObject({ error: "login_rate_limited" });
  });

  it("rate limits failed admin logins independently from user access codes", async () => {
    const ip = `admin-${crypto.randomUUID()}`;
    const attempt = (token = "wrong-admin-token") => exports.default.fetch(new Request("https://example.test/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
      body: JSON.stringify({ token }),
    }));

    for (let index = 0; index < 5; index += 1) {
      expect((await attempt()).status).toBe(401);
    }
    const blocked = await attempt("test-admin-token");
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
    await expect(blocked.json()).resolves.toMatchObject({ error: "admin_login_rate_limited" });

    await env.CHAT_STORE.put(ACCESS_CODES_KEY, "friend:valid-user-code");
    const userLogin = await exports.default.fetch(new Request("https://example.test/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
      body: JSON.stringify({ code: "valid-user-code" }),
    }));
    expect(userLogin.status).toBe(200);
  });

  it("keeps a fresh admin login source out of the durable object recovery registry", async () => {
    const registry = env.INSTANCE_COORDINATOR.getByName("$instance-maintenance");
    const before = await registry.listRegisteredObjects();
    const response = await exports.default.fetch(new Request("https://example.test/api/admin/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "CF-Connecting-IP": `admin-registry-${crypto.randomUUID()}`,
      },
      body: JSON.stringify({ token: "test-admin-token" }),
    }));
    expect(response.status).toBe(200);
    const cookie = response.headers.get("Set-Cookie")?.split(";", 1)[0] || "";
    expect(cookie).toContain("chatus_admin=");
    expect((await apiRequest("/api/admin/logout", cookie, { method: "POST" })).status).toBe(200);
    await expect(registry.listRegisteredObjects()).resolves.toEqual(before);
  });

  it("lets a user revoke every active device session without deleting data", async () => {
    const label = `self-revoke-${crypto.randomUUID()}`;
    const first = await login(label);
    const second = await login(label);
    await env.CHAT_STORE.put(`memory:${encodeURIComponent(label)}`, "keep this memory");

    const revoked = await apiRequest("/api/sessions/revoke-all", first.cookie, { method: "POST" });
    expect(revoked.status).toBe(200);
    expect(revoked.headers.get("Set-Cookie")).toContain("Max-Age=0");
    await expect(revoked.json()).resolves.toMatchObject({ ok: true, revoked: 2 });
    expect((await apiRequest("/api/session", first.cookie)).status).toBe(401);
    expect((await apiRequest("/api/session", second.cookie)).status).toBe(401);
    expect(await env.CHAT_STORE.get(`memory:${encodeURIComponent(label)}`)).toBe("keep this memory");
  });

  it("creates a configured user and access code in one admin operation", async () => {
    const cookie = await adminLogin();
    const label = `invite-${crypto.randomUUID()}`;
    const response = await apiRequest("/api/admin/users", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label,
        user: { displayName: "新朋友", defaultRoute: "default", allowedRoutes: ["default"], dailyMessageLimit: 321 },
      }),
    });
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ label, config: { users: { [label]: { displayName: "新朋友", dailyMessageLimit: 321 } } } });
    expect(payload.accessCode).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(payload.configRevision).toMatch(/^[0-9a-f]{64}$/);
    expect(payload.accessRevision).toMatch(/^[0-9a-f]{64}$/);
    for (const route of Object.values(payload.config.routes) as Array<Record<string, unknown>>) {
      expect(route).not.toHaveProperty("apiKey");
      expect(route).not.toHaveProperty("headers");
    }
    for (const provider of Object.values(payload.config.providers) as Array<Record<string, unknown>>) {
      expect(provider).not.toHaveProperty("apiKey");
      expect(provider).not.toHaveProperty("headers");
    }

    const accessCodes = await env.CHAT_STORE.get(ACCESS_CODES_KEY);
    expect(accessCodes).toContain(`${label}:${payload.accessCode}`);
    const duplicate = await apiRequest("/api/admin/users", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label, user: {} }),
    });
    expect(duplicate.status).toBe(409);

    const audit = JSON.parse((await env.CHAT_STORE.get(ADMIN_AUDIT_KEY)) || "[]");
    expect(audit[0]).toMatchObject({ action: "user.create", target: label });
    expect(JSON.stringify(audit)).not.toContain(payload.accessCode);
  });

  it("hides disabled routes from users and fallback plans", async () => {
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      routes: {
        active: {
          label: "Active",
          type: "openai-chat",
          baseUrl: "https://active.example/v1",
          model: "active-model",
          apiKey: "active-key",
          fallbacks: ["disabled"],
        },
        disabled: {
          enabled: false,
          label: "Disabled",
          type: "openai-chat",
          baseUrl: "https://disabled.example/v1",
          model: "disabled-model",
          apiKey: "disabled-key",
        },
      },
      defaults: { defaultRoute: "disabled", allowedRoutes: ["active", "disabled"] },
    }));
    const { cookie } = await login();

    const session = await apiRequest("/api/session", cookie);
    await expect(session.json()).resolves.toMatchObject({
      defaultRoute: "active",
      routes: [{ id: "active" }],
    });

    const providerBodyMarker = `PRIVATE_PROVIDER_BODY_${crypto.randomUUID()}`;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementationOnce(async () =>
      new Response(providerBodyMarker, { status: 502 }));
    const chat = await apiRequest("/api/chat", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Chatus-Client": "web" },
      body: JSON.stringify({ routeId: "active", messages: [{ role: "user", content: "计算 8 加 9，并解释步骤" }] }),
    });
    const chatPayload = await chat.clone().json();
    expect(chat.status, JSON.stringify(chatPayload)).toBe(502);
    expect(chatPayload).toMatchObject({
      error: "upstream_unavailable",
      message: "模型服务暂时不可用，请稍后重试或切换模型。",
      routeId: "active",
      status: 502,
    });
    expect(JSON.stringify(chatPayload)).not.toContain(providerBodyMarker);
    expect(JSON.stringify(chatPayload)).not.toContain("active.example");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("active.example");
  });

  it("classifies legacy chat Provider failures without exposing response bodies", async () => {
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      routes: {
        classified: {
          label: "Classified",
          type: "openai-chat",
          baseUrl: "https://classified.example/v1",
          model: "classified-model",
          apiKey: "classified-key",
        },
      },
      defaults: { defaultRoute: "classified", allowedRoutes: ["classified"] },
    }));
    const { cookie } = await login();
    const cases = [
      { status: 400, code: "upstream_request_rejected", responseStatus: 502 },
      { status: 401, code: "upstream_authentication_failed", responseStatus: 502 },
      { status: 429, code: "upstream_rate_limited", responseStatus: 429 },
      { status: 503, code: "upstream_unavailable", responseStatus: 502 },
    ];
    const fetchMock = vi.spyOn(globalThis, "fetch");
    for (const item of cases) {
      const marker = `PRIVATE_PROVIDER_${item.status}_${crypto.randomUUID()}`;
      fetchMock.mockImplementationOnce(async () => new Response(marker, { status: item.status }));
      const response = await apiRequest("/api/chat", cookie, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Chatus-Client": "web" },
        body: JSON.stringify({ routeId: "classified", messages: [{ role: "user", content: `测试 ${item.status}` }] }),
      });
      const text = await response.text();
      expect(response.status, text).toBe(item.responseStatus);
      expect(JSON.parse(text)).toMatchObject({ error: item.code, status: item.status });
      expect(text).not.toContain(marker);
      expect(text).not.toContain("classified.example");
    }
  });

  it("does not register scheduled route health checks", () => {
    expect(worker).not.toHaveProperty("scheduled");
    expect(wranglerConfig).not.toMatch(/"crons"\s*:/);
  });

  it("stores privacy-safe answer feedback and updates duplicate ratings", async () => {
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      routes: {
        feedback: {
          label: "Feedback",
          type: "openai-chat",
          baseUrl: "https://feedback.example/v1",
          model: "feedback-model",
          apiKey: "feedback-key",
        },
      },
      defaults: { defaultRoute: "feedback", allowedRoutes: ["feedback"] },
    }));
    const { cookie, label } = await login();
    const metadata = { routeId: "feedback", chatId: "chat-1", messageId: "message-1" };

    const first = await apiRequest("/api/feedback", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...metadata, rating: "down", reason: "inaccurate", content: "private conversation text" }),
    });
    expect(first.status).toBe(200);
    await expect(env.CHAT_STORE.get(FEEDBACK_KEY, "json")).resolves.toMatchObject([
      { label, rating: "down", reason: "inaccurate", ...metadata },
    ]);
    const second = await apiRequest("/api/feedback", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...metadata, rating: "up" }),
    });
    expect(second.status).toBe(200);

    const adminCookie = await adminLogin();
    const response = await apiRequest("/api/admin/feedback", adminCookie);
    const payload = await response.json();
    expect(payload.entries).toHaveLength(1);
    expect(payload.entries[0]).toMatchObject({ label, rating: "up", ...metadata });
    expect(JSON.stringify(payload)).not.toContain("private conversation text");

    const deleted = await apiRequest("/api/user-data", cookie, { method: "DELETE" });
    expect(deleted.status).toBe(200);
    const afterDelete = await apiRequest("/api/admin/feedback", adminCookie);
    await expect(afterDelete.json()).resolves.toMatchObject({ entries: [] });
  });

  it("adds hardened security headers to assets and session cookies", async () => {
    const assetResponse = await exports.default.fetch(new Request("https://example.test/"));
    expect(assetResponse.headers.get("Content-Security-Policy")).toContain("default-src 'self'");
    expect(assetResponse.headers.get("Content-Security-Policy")).not.toContain("'unsafe-inline'");
    expect(assetResponse.headers.get("X-Frame-Options")).toBe("DENY");
    expect(assetResponse.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(assetResponse.headers.get("Strict-Transport-Security")).toBe("max-age=31536000; includeSubDomains");
    expect(assetResponse.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(assetResponse.headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
    expect(assetResponse.headers.get("Cross-Origin-Resource-Policy")).toBe("same-origin");
    expect(assetResponse.headers.get("Origin-Agent-Cluster")).toBe("?1");
    expect(assetResponse.headers.get("X-Request-ID")).toMatch(/^[0-9a-f-]{36}$/i);

    await env.CHAT_STORE.put(ACCESS_CODES_KEY, "security-user:test-access-code");
    const loginResponse = await exports.default.fetch(
      new Request("https://example.test/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "test-access-code" }),
      }),
    );
    const cookie = loginResponse.headers.get("Set-Cookie") || "";
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(loginResponse.headers.get("Cache-Control")).toContain("no-store");
    expect(loginResponse.headers.get("Pragma")).toBe("no-cache");
    expect(loginResponse.headers.get("Strict-Transport-Security")).toContain("max-age=31536000");
    expect(loginResponse.headers.get("X-Request-ID")).toMatch(/^[0-9a-f-]{36}$/i);

    const sessionResponse = await exports.default.fetch(new Request("https://example.test/api/session", {
      headers: { Cookie: cookie.split(";", 1)[0] },
    }));
    expect(sessionResponse.headers.get("Cache-Control")).toContain("private");
    expect(sessionResponse.headers.get("Expires")).toBe("0");
    expect(sessionResponse.headers.get("X-Request-ID")).toMatch(/^[0-9a-f-]{36}$/i);
    expect(sessionResponse.headers.get("X-Request-ID")).not.toBe(loginResponse.headers.get("X-Request-ID"));
  });

  it("serves the React client by default and preserves the legacy rollback shell", async () => {
    const root = await exports.default.fetch(new Request("https://example.test/"));
    expect(root.status).toBe(200);
    const rootHtml = await root.text();
    expect(rootHtml).toContain('id="root"');
    expect(rootHtml).toContain("/react-chat/assets/");
    expect(rootHtml).not.toContain('id="loginView"');

    const index = await exports.default.fetch(new Request("https://example.test/index.html"));
    expect(await index.text()).toContain('id="root"');

    const reactRedirect = await exports.default.fetch(new Request("https://example.test/react-chat", { redirect: "manual" }));
    expect(reactRedirect.status).toBe(308);
    expect(reactRedirect.headers.get("Location")).toBe("https://example.test/react-chat/");

    const legacyRedirect = await exports.default.fetch(new Request("https://example.test/legacy", { redirect: "manual" }));
    expect(legacyRedirect.status).toBe(308);
    expect(legacyRedirect.headers.get("Location")).toBe("https://example.test/legacy/");

    const legacy = await exports.default.fetch(new Request("https://example.test/legacy/"));
    expect(legacy.status).toBe(200);
    const legacyHtml = await legacy.text();
    expect(legacyHtml).toContain('id="loginView"');
    expect(legacyHtml).toContain('/app.js?v=development');
  });

  it("records content-free exact-SHA evidence for every legacy browser shell caller", async () => {
    const browserShell = LEGACY_SURFACE_MANIFEST.find(({ surfaceId }) => surfaceId === "legacy.browser.shell");
    if (!browserShell) throw new Error("missing_browser_shell_manifest");
    const browserShellStub = env.INSTANCE_COORDINATOR.getByName(legacySurfaceObjectName(browserShell.surfaceId));
    await runInDurableObject(browserShellStub, async (_instance, state) => {
      state.storage.sql.exec("DELETE FROM legacy_surface_daily");
    });

    const responses = await Promise.all([
      exports.default.fetch(new Request("https://example.test/legacy", {
        redirect: "manual",
        headers: { "x-chatus-legacy-caller": "browser" },
      })),
      exports.default.fetch(new Request("https://example.test/legacy/", {
        headers: { "x-chatus-legacy-caller": "test" },
      })),
      exports.default.fetch(new Request("https://example.test/app.js?v=development", {
        headers: { "x-chatus-legacy-caller": "deployment" },
      })),
      exports.default.fetch(new Request("https://example.test/markdown.js?v=development", {
        headers: { "x-chatus-legacy-caller": "service_worker" },
      })),
      exports.default.fetch(new Request("https://example.test/styles.css?v=development", {
        headers: { "sec-fetch-dest": "style", "sec-fetch-site": "same-origin" },
      })),
      exports.default.fetch(new Request("https://example.test/theme.js?v=development", {
        headers: { "x-chatus-legacy-caller": "not-declared" },
      })),
    ]);
    expect(responses.map(({ status }) => status)).toEqual([308, 200, 200, 200, 200, 200]);

    await expect(runInDurableObject(browserShellStub, async (_instance, state) => (
      state.storage.sql.exec<{ caller_class: string; access: string; count: number; deployment_sha: string }>(
        "SELECT caller_class, access, count, deployment_sha FROM legacy_surface_daily ORDER BY caller_class",
      ).toArray()
    ))).resolves.toEqual([
      { caller_class: "browser", access: "read", count: 2, deployment_sha: "0".repeat(40) },
      { caller_class: "deployment", access: "read", count: 1, deployment_sha: "0".repeat(40) },
      { caller_class: "service_worker", access: "read", count: 1, deployment_sha: "0".repeat(40) },
      { caller_class: "test", access: "read", count: 1, deployment_sha: "0".repeat(40) },
      { caller_class: "worker_api", access: "read", count: 1, deployment_sha: "0".repeat(40) },
    ]);
  });

  it("rehearses reversible legacy browser shell read disable across routes and assets", async () => {
    const browserShell = LEGACY_SURFACE_MANIFEST.find(({ surfaceId }) => surfaceId === "legacy.browser.shell");
    if (!browserShell) throw new Error("missing_browser_shell_manifest");
    const browserShellStub = env.INSTANCE_COORDINATOR.getByName(legacySurfaceObjectName(browserShell.surfaceId));
    const manifestDigest = await legacySurfaceManifestDigest();
    await browserShellStub.syncLegacySurfaceManifest({ version: 1, manifest: browserShell, manifestDigest });
    const originalSnapshot = await browserShellStub.captureLegacySurfaceState({
      version: 1,
      surfaceId: browserShell.surfaceId,
      captureEpoch: `browser-shell-route-rehearsal-${crypto.randomUUID()}`,
      manifestDigest,
    });

    try {
      await runInDurableObject(browserShellStub, async (_instance, state) => {
        state.storage.sql.exec("DELETE FROM legacy_surface_daily");
        state.storage.sql.exec(
          "UPDATE legacy_surface_state SET revision = 9, phase = 'read_disabled', read_control = 'disabled', write_control = 'disabled', last_transition_at = ? WHERE id = 1",
          Date.now() - 1,
        );
      });

      const blocked = await Promise.all([
        exports.default.fetch(new Request("https://example.test/legacy", {
          redirect: "manual",
          headers: { "x-chatus-legacy-caller": "browser" },
        })),
        exports.default.fetch(new Request("https://example.test/legacy/", {
          headers: { "x-chatus-legacy-caller": "test" },
        })),
        exports.default.fetch(new Request("https://example.test/app.js?v=development", {
          headers: { "x-chatus-legacy-caller": "service_worker" },
        })),
      ]);
      expect(blocked.map(({ status }) => status)).toEqual([410, 410, 410]);
      for (const response of blocked) {
        await expect(response.json()).resolves.toMatchObject({ error: "legacy_surface_read_disabled" });
      }

      const rollbackRequestedAt = Date.now();
      const rollback = await browserShellStub.rollbackLegacySurface({
        version: 1,
        surfaceId: browserShell.surfaceId,
        expectedRevision: 9,
        operationId: `browser-shell-routing-switch-${crypto.randomUUID()}`,
        scope: "read",
        reason: "runtime_regression",
        requestedAt: rollbackRequestedAt,
        evidence: [{
          version: 1,
          kind: "rollback_rehearsal",
          evidenceId: `browser-shell-route-rehearsal-${crypto.randomUUID()}`,
          digest: "b".repeat(64),
          deploymentSha: "0".repeat(40),
          observedAt: rollbackRequestedAt,
          count: 1,
          result: "passed",
        }],
      });
      expect(rollback).toMatchObject({
        ok: true,
        replayed: false,
        projection: {
          phase: "recovery_proven",
          readControl: "enabled",
          writeControl: "disabled",
        },
      });

      const restored = await Promise.all([
        exports.default.fetch(new Request("https://example.test/legacy", { redirect: "manual" })),
        exports.default.fetch(new Request("https://example.test/legacy/")),
        exports.default.fetch(new Request("https://example.test/app.js?v=development")),
      ]);
      expect(restored.map(({ status }) => status)).toEqual([308, 200, 200]);
    } finally {
      await runInDurableObject(browserShellStub, async (_instance, state) => {
        state.storage.transactionSync(() => {
          state.storage.sql.exec("DELETE FROM legacy_surface_daily");
          state.storage.sql.exec("DELETE FROM legacy_surface_operations");
          state.storage.sql.exec("DELETE FROM legacy_surface_events");
          state.storage.sql.exec("DELETE FROM legacy_surface_state");
          state.storage.sql.exec("DELETE FROM legacy_surface_manifest");
        });
      });
      await expect(browserShellStub.restoreLegacySurfaceState({ version: 1, snapshot: originalSnapshot }))
        .resolves.toMatchObject({ ok: true, restored: true });
    }
  });

  it("records separate legacy chat POST evidence and enforces read/write controls before Provider I/O", async () => {
    const legacyChatPost = LEGACY_SURFACE_MANIFEST.find(({ surfaceId }) => surfaceId === "legacy.api.chat-post");
    if (!legacyChatPost) throw new Error("missing_legacy_chat_post_manifest");
    const legacyChatPostStub = env.INSTANCE_COORDINATOR.getByName(legacySurfaceObjectName(legacyChatPost.surfaceId));
    const manifestDigest = await legacySurfaceManifestDigest();
    await legacyChatPostStub.syncLegacySurfaceManifest({
      version: 1,
      manifest: legacyChatPost,
      manifestDigest,
    });
    const originalSnapshot = await legacyChatPostStub.captureLegacySurfaceState({
      version: 1,
      surfaceId: legacyChatPost.surfaceId,
      captureEpoch: `chat-post-route-rehearsal-${crypto.randomUUID()}`,
      manifestDigest,
    });
    await runInDurableObject(legacyChatPostStub, async (_instance, state) => {
      state.storage.sql.exec("DELETE FROM legacy_surface_daily");
    });
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      routes: {
        primary: {
          label: "Primary",
          type: "openai-chat",
          baseUrl: "https://provider.example/v1",
          model: "model-a",
          apiKey: "hidden-server-key",
        },
      },
      defaults: { defaultRoute: "primary", allowedRoutes: ["primary"] },
    }));
    const { cookie } = await login();
    const usageBefore = (await apiRequest("/api/session", cookie).then((item) => item.json()) as any).usage.used;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => openAiTextResponse("local response"));

    const response = await apiRequest("/api/chat", cookie, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Chatus-Client": "web",
        "x-chatus-legacy-caller": "test",
      },
      body: JSON.stringify({
        routeId: "primary",
        messages: [{ role: "user", content: "local legacy chat test" }],
      }),
    });
    expect(response.status, await response.clone().text()).toBe(200);
    await response.text();

    await expect(runInDurableObject(legacyChatPostStub, async (_instance, state) => (
      state.storage.sql.exec<{ caller_class: string; access: string; count: number; deployment_sha: string }>(
        "SELECT caller_class, access, count, deployment_sha FROM legacy_surface_daily ORDER BY access",
      ).toArray()
    ))).resolves.toEqual([
      { caller_class: "test", access: "read", count: 1, deployment_sha: "0".repeat(40) },
      { caller_class: "test", access: "write", count: 1, deployment_sha: "0".repeat(40) },
    ]);

    try {
      await runInDurableObject(legacyChatPostStub, async (_instance, state) => {
        state.storage.sql.exec(
          "UPDATE legacy_surface_state SET revision = 5, phase = 'write_disabled', read_control = 'enabled', write_control = 'disabled', last_transition_at = ? WHERE id = 1",
          Date.now() - 1,
        );
      });
      const writeBlocked = await apiRequest("/api/chat", cookie, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Chatus-Client": "web",
          "x-chatus-legacy-caller": "test",
        },
        body: JSON.stringify({
          routeId: "primary",
          messages: [{ role: "user", content: "must not execute" }],
        }),
      });
      expect(writeBlocked.status).toBe(410);
      await expect(writeBlocked.json()).resolves.toMatchObject({ error: "legacy_surface_write_disabled" });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const usageAfterWriteBlock = (await apiRequest("/api/session", cookie).then((item) => item.json()) as any).usage.used;
      expect(usageAfterWriteBlock).toBe(usageBefore + 1);

      const rollbackRequestedAt = Date.now();
      const rollback = await legacyChatPostStub.rollbackLegacySurface({
        version: 1,
        surfaceId: legacyChatPost.surfaceId,
        expectedRevision: 5,
        operationId: `chat-post-routing-switch-${crypto.randomUUID()}`,
        scope: "write",
        reason: "runtime_regression",
        requestedAt: rollbackRequestedAt,
        evidence: [{
          version: 1,
          kind: "rollback_rehearsal",
          evidenceId: `chat-post-route-rehearsal-${crypto.randomUUID()}`,
          digest: "a".repeat(64),
          deploymentSha: "0".repeat(40),
          observedAt: rollbackRequestedAt,
          count: 1,
          result: "passed",
        }],
      });
      expect(rollback).toMatchObject({
        ok: true,
        replayed: false,
        projection: {
          phase: "shadowing",
          readControl: "enabled",
          writeControl: "enabled",
        },
      });
      const routeRestored = await apiRequest("/api/chat", cookie, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Chatus-Client": "web",
          "x-chatus-legacy-caller": "test",
        },
        body: JSON.stringify({
          routeId: "primary",
          messages: [{ role: "user", content: "execute after routing rollback" }],
        }),
      });
      expect(routeRestored.status, await routeRestored.clone().text()).toBe(200);
      await routeRestored.text();
      expect(fetchSpy).toHaveBeenCalledTimes(2);

      await runInDurableObject(legacyChatPostStub, async (_instance, state) => {
        state.storage.sql.exec(
          "UPDATE legacy_surface_state SET phase = 'read_disabled', read_control = 'disabled', write_control = 'disabled' WHERE id = 1",
        );
      });
      const readBlocked = await apiRequest("/api/chat", cookie, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Chatus-Client": "web",
          "x-chatus-legacy-caller": "test",
        },
        body: JSON.stringify({
          routeId: "primary",
          messages: [{ role: "user", content: "must not dispatch" }],
        }),
      });
      expect(readBlocked.status).toBe(410);
      await expect(readBlocked.json()).resolves.toMatchObject({ error: "legacy_surface_read_disabled" });
      expect(fetchSpy).toHaveBeenCalledTimes(2);

      await expect(runInDurableObject(legacyChatPostStub, async (_instance, state) => (
        state.storage.sql.exec<{ access: string; count: number }>(
          "SELECT access, count FROM legacy_surface_daily WHERE caller_class = 'test' ORDER BY access",
        ).toArray()
      ))).resolves.toEqual([
        { access: "read", count: 4 },
        { access: "write", count: 2 },
      ]);
    } finally {
      await runInDurableObject(legacyChatPostStub, async (_instance, state) => {
        state.storage.transactionSync(() => {
          state.storage.sql.exec("DELETE FROM legacy_surface_daily");
          state.storage.sql.exec("DELETE FROM legacy_surface_operations");
          state.storage.sql.exec("DELETE FROM legacy_surface_events");
          state.storage.sql.exec("DELETE FROM legacy_surface_state");
          state.storage.sql.exec("DELETE FROM legacy_surface_manifest");
        });
      });
      await expect(legacyChatPostStub.restoreLegacySurfaceState({ version: 1, snapshot: originalSnapshot }))
        .resolves.toMatchObject({ ok: true, restored: true });
    }
  });

  it("serves the typed admin shell and a secret-free member projection", async () => {
    await env.CHAT_STORE.put(ACCESS_CODES_KEY, "bill:bill-secret,alice:alice-secret");
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      routes: {
        primary: {
          label: "Primary",
          type: "openai-chat",
          baseUrl: "https://provider.example/v1",
          model: "model-a",
          apiKey: "hidden-server-key",
        },
      },
      users: { bill: { displayName: "Bill", allowedSkills: [] } },
      defaults: { defaultRoute: "primary", allowedRoutes: ["primary"] },
    }));
    const cookie = await adminLogin();
    const members = await apiRequest("/api/admin/members", cookie);
    expect(members.status).toBe(200);
    const memberPayload = await members.json() as { members: Array<Record<string, unknown>>; accessRevision: string; accessSource: string };
    expect(memberPayload.members).toEqual([
      { label: "alice", displayName: "alice", configured: false, hasAccessCode: true },
      { label: "bill", displayName: "Bill", configured: true, hasAccessCode: true },
    ]);
    expect(memberPayload.accessRevision).toMatch(/^[0-9a-f]{64}$/);
    expect(memberPayload.accessSource).toBe("kv");
    expect(JSON.stringify(memberPayload)).not.toContain("bill-secret");
    expect(JSON.stringify(memberPayload)).not.toContain("alice-secret");

    const typedAdmin = await exports.default.fetch(new Request("https://example.test/react-chat/admin"));
    expect(typedAdmin.status).toBe(200);
    expect(await typedAdmin.text()).toContain('id="root"');
    const typedAdminSlash = await exports.default.fetch(new Request("https://example.test/react-chat/admin/"));
    expect(typedAdminSlash.status).toBe(200);
    expect(await typedAdminSlash.text()).toContain('id="root"');

    const adminAlias = LEGACY_SURFACE_MANIFEST.find(({ surfaceId }) => surfaceId === "legacy.browser.admin-alias");
    if (!adminAlias) throw new Error("missing_admin_alias_manifest");
    const adminAliasStub = env.INSTANCE_COORDINATOR.getByName(legacySurfaceObjectName(adminAlias.surfaceId));
    await runInDurableObject(adminAliasStub, async (_instance, state) => {
      state.storage.sql.exec("DELETE FROM legacy_surface_daily");
    });
    const fullAdmin = await exports.default.fetch(new Request("https://example.test/admin.html", {
      redirect: "manual",
      headers: {
        "x-chatus-legacy-caller": "test",
      },
    }));
    expect(fullAdmin.status).toBe(308);
    expect(fullAdmin.headers.get("Location")).toBe("https://example.test/react-chat/admin");
    const queriedAdmin = await exports.default.fetch(new Request("https://example.test/admin.html?return=setup", {
      redirect: "manual",
      headers: {
        "x-chatus-legacy-caller": "test",
      },
    }));
    expect(queriedAdmin.status).toBe(308);
    expect(queriedAdmin.headers.get("Location")).toBe("https://example.test/react-chat/admin?return=setup");
    const unclassifiedAdmin = await exports.default.fetch(new Request("https://example.test/admin.html", {
      redirect: "manual",
      headers: { "x-chatus-legacy-caller": "not-declared" },
    }));
    expect(unclassifiedAdmin.status).toBe(308);
    await expect(runInDurableObject(adminAliasStub, async (_instance, state) => (
      state.storage.sql.exec<{ caller_class: string; access: string; count: number; deployment_sha: string }>(
        "SELECT caller_class, access, count, deployment_sha FROM legacy_surface_daily ORDER BY caller_class",
      ).toArray()
    ))).resolves.toEqual([
      {
        caller_class: "test",
        access: "read",
        count: 2,
        deployment_sha: "0".repeat(40),
      },
      {
        caller_class: "worker_api",
        access: "read",
        count: 1,
        deployment_sha: "0".repeat(40),
      },
    ]);
  });

  it("resets both current-day usage stores and records a bounded admin audit entry", async () => {
    const label = `usage-reset-${crypto.randomUUID()}`;
    const day = new Date().toISOString().slice(0, 10);
    const usageStoreKey = `usage:${encodeURIComponent(label)}:${day}`;
    const state = env.USER_STATE.getByName(label);

    await env.CHAT_STORE.put(usageStoreKey, "4");
    await state.consumeLimits(10, 10, Date.now(), 0);
    await expect(state.getUsage(day, 0)).resolves.toBe(1);

    const adminCookie = await adminLogin();
    const blankLabel = await apiRequest("/api/admin/usage", adminCookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "   " }),
    });
    expect(blankLabel.status).toBe(400);
    await expect(blankLabel.json()).resolves.toEqual({ error: "label_required" });
    await expect(env.CHAT_STORE.get(ADMIN_AUDIT_KEY)).resolves.toBeNull();

    const response = await apiRequest("/api/admin/usage", adminCookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, label, day });
    await expect(env.CHAT_STORE.get(usageStoreKey)).resolves.toBeNull();
    await expect(state.getUsage(day, 0)).resolves.toBe(0);
    await expect(env.CHAT_STORE.get(ADMIN_AUDIT_KEY, "json")).resolves.toEqual([
      expect.objectContaining({ action: "usage.reset", target: label }),
    ]);
  });

  it("bootstraps the first KV member without importing a deployment access-code secret", async () => {
    const adminCookie = await adminLogin();
    const managedEnv = {
      ...env,
      ACCESS_CODES_MODE: "managed",
      ACCESS_CODES: "legacy:legacy-access-code",
    } as any;
    const membersResponse = await worker.fetch(new Request("https://example.test/api/admin/members", {
      headers: { Cookie: adminCookie },
    }), managedEnv);
    expect(membersResponse.status).toBe(200);
    const members = await membersResponse.json() as any;
    expect(members).toMatchObject({ members: [], accessSource: "managed" });
    expect(members.accessRevision).toMatch(/^[0-9a-f]{64}$/);

    const label = `bootstrap-${crypto.randomUUID()}`;
    const createdResponse = await worker.fetch(new Request("https://example.test/api/admin/members", {
      method: "POST",
      headers: { Cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ label, expectedAccessRevision: members.accessRevision }),
    }), managedEnv);
    expect(createdResponse.status).toBe(200);
    const created = await createdResponse.json() as any;
    expect(created.member).toMatchObject({ label, hasAccessCode: true });
    expect(await env.CHAT_STORE.get(ACCESS_CODES_KEY)).toBe(`${label}:${created.accessCode}`);
    expect(await loginWithCode("legacy-access-code")).toBeNull();
    expect(await loginWithCode(created.accessCode)).toMatch(/^chatus_session=/);
  });

  it("creates, rotates, and revokes member access through revisioned secret-safe endpoints", async () => {
    await env.CHAT_STORE.put(ACCESS_CODES_KEY, "owner:owner-code");
    const adminCookie = await adminLogin();
    const label = `lifecycle-${crypto.randomUUID()}`;
    const initial = await apiRequest("/api/admin/members", adminCookie).then((response) => response.json()) as any;

    const missingRevision = await apiRequest("/api/admin/members", adminCookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label }),
    });
    expect(missingRevision.status).toBe(400);
    await expect(missingRevision.json()).resolves.toMatchObject({ error: "expected_access_revision_required" });
    await expect(env.CHAT_STORE.get(ACCESS_CODES_KEY)).resolves.toBe("owner:owner-code");

    const created = await apiRequest("/api/admin/members", adminCookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label, expectedAccessRevision: initial.accessRevision }),
    });
    expect(created.status).toBe(200);
    const createdPayload = await created.json() as any;
    expect(Object.keys(createdPayload).sort()).toEqual([
      "accessCode",
      "accessRevision",
      "member",
      "sessionRevocation",
    ]);
    expect(createdPayload.member).toEqual({ label, displayName: label, configured: false, hasAccessCode: true });
    expect(createdPayload.accessCode).toMatch(/^[0-9a-f]{64}$/);
    expect(createdPayload.sessionRevocation).toEqual({ revoked: 0, complete: true });
    expect(JSON.stringify(createdPayload).split(createdPayload.accessCode)).toHaveLength(2);

    const listedAfterCreate = await apiRequest("/api/admin/members", adminCookie).then((response) => response.json()) as any;
    expect(Object.keys(listedAfterCreate).sort()).toEqual(["accessRevision", "accessSource", "members"]);
    expect(listedAfterCreate.members).toContainEqual(createdPayload.member);
    expect(JSON.stringify(listedAfterCreate)).not.toContain(createdPayload.accessCode);
    expect(JSON.stringify(listedAfterCreate)).not.toContain("owner-code");

    const firstSession = await loginWithCode(createdPayload.accessCode);
    const secondSession = await loginWithCode(createdPayload.accessCode);
    expect(firstSession).toMatch(/^chatus_session=/);
    expect(secondSession).toMatch(/^chatus_session=/);

    const beforeConcurrentUpdate = await env.CHAT_STORE.get(ACCESS_CODES_KEY);
    await env.CHAT_STORE.put(ACCESS_CODES_KEY, `${beforeConcurrentUpdate},other:other-code`);
    const staleRotate = await apiRequest(`/api/admin/members/${encodeURIComponent(label)}/access-code`, adminCookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedAccessRevision: createdPayload.accessRevision }),
    });
    expect(staleRotate.status).toBe(409);
    await expect(staleRotate.json()).resolves.toMatchObject({ error: "access_codes_conflict" });
    expect((await apiRequest("/api/session", firstSession!)).status).toBe(200);

    const current = await apiRequest("/api/admin/members", adminCookie).then((response) => response.json()) as any;
    const rotated = await apiRequest(`/api/admin/members/${encodeURIComponent(label)}/access-code`, adminCookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedAccessRevision: current.accessRevision }),
    });
    expect(rotated.status).toBe(200);
    const rotatedPayload = await rotated.json() as any;
    expect(Object.keys(rotatedPayload).sort()).toEqual([
      "accessCode",
      "accessRevision",
      "member",
      "sessionRevocation",
    ]);
    expect(rotatedPayload.accessCode).toMatch(/^[0-9a-f]{64}$/);
    expect(rotatedPayload.accessCode).not.toBe(createdPayload.accessCode);
    expect(rotatedPayload.sessionRevocation).toEqual({ revoked: 2, complete: true });
    expect((await apiRequest("/api/session", firstSession!)).status).toBe(401);
    expect((await apiRequest("/api/session", secondSession!)).status).toBe(401);
    expect(await loginWithCode(createdPayload.accessCode)).toBeNull();

    const rotatedSession = await loginWithCode(rotatedPayload.accessCode);
    expect(rotatedSession).toMatch(/^chatus_session=/);
    const retiredPrincipal = await resolveTestPrincipal(label);
    expect(retiredPrincipal).toBeDefined();
    const retiredProjection = await apiRequest("/api/session", rotatedSession!).then((response) => response.json()) as any;
    const revoked = await apiRequest(`/api/admin/members/${encodeURIComponent(label)}/access-code`, adminCookie, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedAccessRevision: rotatedPayload.accessRevision }),
    });
    expect(revoked.status).toBe(200);
    const revokedPayload = await revoked.json() as any;
    expect(Object.keys(revokedPayload).sort()).toEqual(["accessRevision", "member", "sessionRevocation"]);
    expect(revokedPayload.member).toBeNull();
    expect(revokedPayload.sessionRevocation).toEqual({ revoked: 1, complete: true });
    expect(revokedPayload).not.toHaveProperty("accessCode");
    expect((await apiRequest("/api/session", rotatedSession!)).status).toBe(401);
    expect(await loginWithCode(rotatedPayload.accessCode)).toBeNull();

    const stored = await env.CHAT_STORE.get(ACCESS_CODES_KEY);
    expect(stored).toBe("owner:owner-code,other:other-code");
    const listedAfterRevoke = await apiRequest("/api/admin/members", adminCookie).then((response) => response.json()) as any;
    expect(listedAfterRevoke.members.some((member: any) => member.label === label)).toBe(false);
    expect(JSON.stringify(listedAfterRevoke)).not.toContain(createdPayload.accessCode);
    expect(JSON.stringify(listedAfterRevoke)).not.toContain(rotatedPayload.accessCode);

    const audit = JSON.parse((await env.CHAT_STORE.get(ADMIN_AUDIT_KEY)) || "[]");
    expect(audit.map((entry: any) => entry.action)).toEqual(expect.arrayContaining([
      "member.access.create",
      "member.access.rotate",
      "member.access.revoke",
    ]));
    expect(JSON.stringify(audit)).not.toContain(createdPayload.accessCode);
    expect(JSON.stringify(audit)).not.toContain(rotatedPayload.accessCode);

    const recreated = await apiRequest("/api/admin/members", adminCookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label, expectedAccessRevision: listedAfterRevoke.accessRevision }),
    });
    expect(recreated.status).toBe(200);
    const recreatedPayload = await recreated.json() as any;
    const replacementSession = await loginWithCode(recreatedPayload.accessCode);
    expect(replacementSession).toMatch(/^chatus_session=/);
    const replacementPrincipal = await resolveTestPrincipal(label);
    expect(replacementPrincipal).toBeDefined();
    expect(replacementPrincipal?.principalId).not.toBe(retiredPrincipal?.principalId);
    expect(replacementPrincipal?.rootInstanceName).not.toBe(retiredPrincipal?.rootInstanceName);
    expect(replacementPrincipal?.userStateInstanceName).not.toBe(retiredPrincipal?.userStateInstanceName);
    const replacementProjection = await apiRequest("/api/session", replacementSession!).then((response) => response.json()) as any;
    expect(replacementProjection.agent.instance).not.toBe(retiredProjection.agent.instance);
  });

  it("retires member authority even when session-key cleanup remains incomplete", async () => {
    const label = `lifecycle-incomplete-${crypto.randomUUID()}`;
    await env.CHAT_STORE.put(ACCESS_CODES_KEY, `owner:owner-code,${label}:member-code`);
    const memberCookie = await loginWithCode("member-code");
    expect(memberCookie).toMatch(/^chatus_session=/);
    const sessionKey = `session:${sessionToken(memberCookie!)}`;
    const principal = await resolveTestPrincipal(label);
    expect(principal).toBeDefined();
    const adminCookie = await adminLogin();
    const members = await apiRequest("/api/admin/members", adminCookie).then((response) => response.json()) as any;
    const failingStore = new Proxy(env.CHAT_STORE, {
      get(target, property) {
        if (property === "delete") {
          return async (key: string) => {
            if (key === sessionKey) throw new Error("synthetic_session_delete_failure");
            return target.delete(key);
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    const revoked = await worker.fetch(new Request(
      `https://example.test/api/admin/members/${encodeURIComponent(label)}/access-code`,
      {
        method: "DELETE",
        headers: { Cookie: adminCookie, "Content-Type": "application/json" },
        body: JSON.stringify({ expectedAccessRevision: members.accessRevision }),
      },
    ), { ...env, CHAT_STORE: failingStore });
    expect(revoked.status).toBe(200);
    const payload = await revoked.json() as any;
    expect(payload.sessionRevocation).toEqual({ revoked: 0, complete: false });
    await expect(env.CHAT_STORE.get(sessionKey)).resolves.not.toBeNull();
    await expect(env.IDENTITY_REGISTRY.getByName(IDENTITY_REGISTRY_INSTANCE_NAME).lookupActivePrincipalAlias({
      version: 1,
      alias: label,
    })).resolves.toEqual({ version: 1, found: false });

    expect((await apiRequest("/api/session", memberCookie!)).status).toBe(401);
    await expect(env.CHAT_STORE.get(sessionKey)).resolves.toBeNull();
    const recreated = await apiRequest("/api/admin/members", adminCookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label, expectedAccessRevision: payload.accessRevision }),
    });
    expect(recreated.status).toBe(200);
    const replacement = await resolveTestPrincipal(label);
    expect(replacement?.principalId).not.toBe(principal?.principalId);
  });

  it("keeps a replacement principal intact while delayed cleanup finishes the retired principal", async () => {
    const label = `cleanup-reuse-${crypto.randomUUID()}`;
    await env.CHAT_STORE.put(ACCESS_CODES_KEY, `owner:owner-code,${label}:old-code`);
    const oldCookie = await loginWithCode("old-code");
    expect(oldCookie).toMatch(/^chatus_session=/);
    const oldPrincipal = await resolveTestPrincipal(label);
    expect(oldPrincipal).toBeDefined();
    const oldRoot = await getRootAgent(label);
    const legacyUsageKey = `usage:${encodeURIComponent(label)}:${new Date().toISOString().slice(0, 10)}`;
    await env.CHAT_STORE.put(legacyUsageKey, "9");
    await oldRoot.registerAccountCleanupRequest(Date.now());

    const adminCookie = await adminLogin();
    const members = await apiRequest("/api/admin/members", adminCookie).then((response) => response.json()) as any;
    const revoked = await apiRequest(`/api/admin/members/${encodeURIComponent(label)}/access-code`, adminCookie, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedAccessRevision: members.accessRevision }),
    });
    expect(revoked.status).toBe(200);
    const revokedPayload = await revoked.json() as any;
    const recreated = await apiRequest("/api/admin/members", adminCookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label, expectedAccessRevision: revokedPayload.accessRevision }),
    });
    expect(recreated.status).toBe(200);
    const recreatedPayload = await recreated.json() as any;
    const replacementCookie = await loginWithCode(recreatedPayload.accessCode);
    expect(replacementCookie).toMatch(/^chatus_session=/);
    const replacementPrincipal = await resolveTestPrincipal(label);
    expect(replacementPrincipal?.principalId).not.toBe(oldPrincipal?.principalId);
    await expect(apiRequest("/api/session", replacementCookie!).then((response) => response.json()))
      .resolves.toMatchObject({ usage: { used: 0 } });

    const feedback = await apiRequest("/api/feedback", replacementCookie!, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rating: "up",
        routeId: "default",
        chatId: "replacement-chat",
        messageId: "replacement-message",
      }),
    });
    expect(feedback.status).toBe(200);
    const replacementMemory = await apiRequest("/api/agent/memory", replacementCookie!).then((response) => response.json()) as any;
    const savedMemory = await apiRequest("/api/agent/memory", replacementCookie!, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memory: "replacement principal memory", expectedRevision: replacementMemory.revision }),
    });
    expect(savedMemory.status).toBe(200);

    await runInDurableObject(oldRoot, async (instance) => {
      await runTeamAgentCleanupSchedule(env, label, instance);
    });

    expect((await apiRequest("/api/session", replacementCookie!)).status).toBe(200);
    await expect(env.CHAT_STORE.get(legacyUsageKey)).resolves.toBeNull();
    await expect(apiRequest("/api/agent/memory", replacementCookie!).then((response) => response.json()))
      .resolves.toMatchObject({ memory: "replacement principal memory" });
    const feedbackAfterCleanup = await apiRequest("/api/admin/feedback", adminCookie).then((response) => response.json()) as any;
    expect(feedbackAfterCleanup.entries).toContainEqual(expect.objectContaining({
      label,
      chatId: "replacement-chat",
      messageId: "replacement-message",
    }));
  });

  it("exposes bounded content-free identity inspection and idempotent reconciliation", async () => {
    await env.CHAT_STORE.put(ACCESS_CODES_KEY, "owner:owner-code");
    const adminCookie = await adminLogin();
    const label = `identity-admin-${crypto.randomUUID()}`;
    const members = await apiRequest("/api/admin/members", adminCookie).then((response) => response.json()) as any;
    const created = await apiRequest("/api/admin/members", adminCookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label, expectedAccessRevision: members.accessRevision }),
    });
    expect(created.status).toBe(200);
    const createdPayload = await created.json() as any;
    const principal = await resolveTestPrincipal(label);
    expect(principal).toBeDefined();
    if (!principal) throw new Error("missing_identity_test_principal");

    const inspection = await apiRequest("/api/admin/identity?limit=20", adminCookie);
    expect(inspection.status).toBe(200);
    const inspectionPayload = await inspection.json() as any;
    expect(Object.keys(inspectionPayload).sort()).toEqual([
      "acl", "aliases", "limit", "migration", "principals", "resources", "schemaVersion", "version",
    ]);
    expect(inspectionPayload).toMatchObject({ version: 1, schemaVersion: "identity-registry-v2", limit: 20 });
    expect(JSON.stringify(inspectionPayload)).not.toContain(label);

    const input = {
      label,
      operationId: `admin-reconcile:${crypto.randomUUID()}`,
      expectedRegistryRevision: principal.registryRevision,
      limit: 20,
    };
    const reconciled = await apiRequest("/api/admin/identity/reconcile", adminCookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    expect(reconciled.status).toBe(200);
    const payload = await reconciled.json() as any;
    expect(Object.keys(payload).sort()).toEqual([
      "authoritative", "checkedConversations", "digest", "eligibleForAuthority", "issues",
      "migrationState", "operationId", "principalId", "registryRevision", "totalResources", "version",
    ]);
    expect(payload).toMatchObject({
      version: 1,
      operationId: input.operationId,
      principalId: principal.principalId,
      migrationState: "authoritative",
      checkedConversations: 0,
      totalResources: 0,
      issues: [],
      eligibleForAuthority: true,
      authoritative: true,
    });
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain(label);
    expect(serialized).not.toContain(principal.rootInstanceName);
    expect(serialized).not.toContain(principal.userStateInstanceName);
    expect(serialized).not.toContain(createdPayload.accessCode);

    const replay = await apiRequest("/api/admin/identity/reconcile", adminCookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toEqual(payload);
    const injected = await apiRequest("/api/admin/identity/reconcile", adminCookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, rootInstanceName: principal.rootInstanceName }),
    });
    expect(injected.status).toBe(400);
    await expect(injected.json()).resolves.toEqual({ error: "identity_reconciliation_input_invalid" });

    const stale = await apiRequest("/api/admin/identity/reconcile", adminCookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...input,
        operationId: `admin-reconcile-stale:${crypto.randomUUID()}`,
        expectedRegistryRevision: principal.registryRevision + 1,
      }),
    });
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toEqual({ error: "identity_registry_revision_conflict" });
  });

  it("keeps ACL, sharing, transfer, and shared discovery endpoints unavailable", async () => {
    const member = await login(`identity-negative-${crypto.randomUUID()}`);
    const adminCookie = await adminLogin();
    const cases = [
      ["/api/acl", member.cookie],
      ["/api/shares", member.cookie],
      ["/api/transfers", member.cookie],
      ["/api/shared-resources", member.cookie],
      ["/api/admin/acl", adminCookie],
    ] as const;
    for (const [path, cookie] of cases) {
      const response = await apiRequest(path, cookie, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ principalId: `prn_${crypto.randomUUID()}`, role: "owner" }),
      });
      expect(response.status, path).toBe(404);
      await expect(response.json()).resolves.toEqual({ error: "not_found" });
    }
  });

  it("refuses to revoke the last access code instead of falling back to the deployment secret", async () => {
    await env.CHAT_STORE.put(ACCESS_CODES_KEY, "only:only-code");
    const memberCookie = await loginWithCode("only-code");
    const adminCookie = await adminLogin();
    const initial = await apiRequest("/api/admin/members", adminCookie).then((response) => response.json()) as any;

    const revoked = await apiRequest("/api/admin/members/only/access-code", adminCookie, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedAccessRevision: initial.accessRevision }),
    });
    expect(revoked.status).toBe(409);
    await expect(revoked.json()).resolves.toMatchObject({ error: "last_access_code" });
    await expect(env.CHAT_STORE.get(ACCESS_CODES_KEY)).resolves.toBe("only:only-code");
    expect((await apiRequest("/api/session", memberCookie!)).status).toBe(200);
  });

  it("keeps configured member assignments when access is issued and later revoked", async () => {
    await env.CHAT_STORE.put(ACCESS_CODES_KEY, "owner:owner-code");
    const adminCookie = await adminLogin();
    const label = `configured-${crypto.randomUUID()}`;
    const configSnapshot = await apiRequest("/api/admin/config", adminCookie).then((response) => response.json()) as any;
    const configSave = await apiRequest("/api/admin/config", adminCookie, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        config: {
          ...configSnapshot.config,
          users: { ...configSnapshot.config.users, [label]: { displayName: "Configured member" } },
        },
        expectedRevision: configSnapshot.revision,
      }),
    });
    expect(configSave.status).toBe(200);

    const initial = await apiRequest("/api/admin/members", adminCookie).then((response) => response.json()) as any;
    expect(initial.members).toContainEqual({
      label,
      displayName: "Configured member",
      configured: true,
      hasAccessCode: false,
    });
    const created = await apiRequest("/api/admin/members", adminCookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label, expectedAccessRevision: initial.accessRevision }),
    }).then((response) => response.json()) as any;
    expect(created.member).toEqual({
      label,
      displayName: "Configured member",
      configured: true,
      hasAccessCode: true,
    });

    const revoked = await apiRequest(`/api/admin/members/${encodeURIComponent(label)}/access-code`, adminCookie, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedAccessRevision: created.accessRevision }),
    }).then((response) => response.json()) as any;
    expect(revoked.member).toEqual({
      label,
      displayName: "Configured member",
      configured: true,
      hasAccessCode: false,
    });
    const storedConfig = JSON.parse((await env.CHAT_STORE.get(ROUTES_CONFIG_KEY)) || "{}");
    expect(storedConfig.users[label]).toEqual({ displayName: "Configured member" });
  });

  it("removes only custom member configuration through a required current revision", async () => {
    const label = `reset-config-${crypto.randomUUID()}`;
    const providerSecret = `provider-secret-${crypto.randomUUID()}`;
    const memory = `member-memory-${crypto.randomUUID()}`;
    await env.CHAT_STORE.put(ACCESS_CODES_KEY, `owner:owner-code,${label}:member-code`);
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      routes: {
        default: {
          label: "Default",
          type: "openai-chat",
          baseUrl: "https://member-config.example/v1",
          model: "member-config-model",
          apiKey: providerSecret,
        },
      },
      defaults: { defaultRoute: "default", allowedRoutes: ["default"] },
      users: {
        [label]: { displayName: "Configured member", allowedRoutes: ["default"], allowedSkills: [] },
        [`${label} `]: { displayName: "Duplicate configured member" },
        retained: { displayName: "Retained member" },
      },
    }));
    await env.CHAT_STORE.put(`memory:${encodeURIComponent(label)}`, memory);
    const memberCookie = await loginWithCode("member-code");
    expect(memberCookie).toBeTruthy();
    const adminCookie = await adminLogin();
    const initial = await apiRequest("/api/admin/config", adminCookie).then((response) => response.json()) as any;

    const missingRevision = await apiRequest(`/api/admin/members/${encodeURIComponent(label)}/config`, adminCookie, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(missingRevision.status).toBe(400);
    await expect(missingRevision.json()).resolves.toMatchObject({ error: "expected_config_revision_required" });

    const concurrentConfig = JSON.parse((await env.CHAT_STORE.get(ROUTES_CONFIG_KEY)) || "{}");
    concurrentConfig.users.concurrent = { displayName: "Concurrent member" };
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify(concurrentConfig));
    const stale = await apiRequest(`/api/admin/members/${encodeURIComponent(label)}/config`, adminCookie, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedConfigRevision: initial.revision }),
    });
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({ error: "config_conflict" });
    await expect(env.CHAT_STORE.get<any>(ROUTES_CONFIG_KEY, "json")).resolves.toMatchObject({
      users: {
        [label]: { displayName: "Configured member" },
        [`${label} `]: { displayName: "Duplicate configured member" },
        concurrent: { displayName: "Concurrent member" },
      },
    });

    const current = await apiRequest("/api/admin/config", adminCookie).then((response) => response.json()) as any;
    const removed = await apiRequest(`/api/admin/members/${encodeURIComponent(label)}/config`, adminCookie, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedConfigRevision: current.revision }),
    });
    expect(removed.status).toBe(200);
    const removedPayload = await removed.json() as any;
    expect(Object.keys(removedPayload).sort()).toEqual(["config", "member", "revision", "source"]);
    expect(removedPayload.member).toEqual({
      label,
      displayName: label,
      configured: false,
      hasAccessCode: true,
    });
    expect(removedPayload.source).toBe("kv");
    expect(removedPayload.config.users[label]).toBeUndefined();
    expect(removedPayload.config.users[`${label} `]).toBeUndefined();
    expect(removedPayload.config.users.retained).toEqual({ displayName: "Retained member" });
    expect(removedPayload.config.users.concurrent).toEqual({ displayName: "Concurrent member" });
    expect(removedPayload.config.routes.default).toMatchObject({ hasLegacyKey: true });
    expect(JSON.stringify(removedPayload)).not.toContain(providerSecret);

    const stored = await env.CHAT_STORE.get<any>(ROUTES_CONFIG_KEY, "json");
    expect(stored.users[label]).toBeUndefined();
    expect(stored.users[`${label} `]).toBeUndefined();
    expect(stored.routes.default.apiKey).toBe(providerSecret);
    await expect(env.CHAT_STORE.get(ACCESS_CODES_KEY)).resolves.toBe(`owner:owner-code,${label}:member-code`);
    expect((await apiRequest("/api/session", memberCookie!)).status).toBe(200);
    await expect(env.CHAT_STORE.get(`memory:${encodeURIComponent(label)}`)).resolves.toBe(memory);

    const audit = await apiRequest("/api/admin/audit", adminCookie).then((response) => response.text());
    expect(audit).toContain("member.config.remove");
    expect(audit).toContain(label);
    expect(audit).not.toContain(providerSecret);
    expect(audit).not.toContain("member-code");
  });

  it("caches only fingerprinted JavaScript and CSS assets as immutable", async () => {
    const fingerprint = "a".repeat(40);
    const fingerprinted = await exports.default.fetch(new Request(`https://example.test/app.js?v=${fingerprint}`));
    expect(fingerprinted.headers.get("Cache-Control")).toContain("max-age=31536000");
    expect(fingerprinted.headers.get("Cache-Control")).toContain("immutable");

    const plain = await exports.default.fetch(new Request("https://example.test/app.js"));
    expect(plain.headers.get("Cache-Control") || "").not.toContain("immutable");

    const release = await exports.default.fetch(new Request(`https://example.test/release.json?v=${fingerprint}`));
    expect(release.headers.get("Cache-Control") || "").not.toContain("immutable");

    const root = await exports.default.fetch(new Request("https://example.test/"));
    const rootHtml = await root.text();
    const viteAsset = rootHtml.match(/(?:src|href)="(\/react-chat\/assets\/[^"]+\.(?:js|css))"/)?.[1];
    expect(viteAsset).toBeTruthy();
    const viteFingerprinted = await exports.default.fetch(new Request(`https://example.test${viteAsset}`));
    expect(viteFingerprinted.status).toBe(200);
    expect(viteFingerprinted.headers.get("Cache-Control")).toContain("immutable");

    const reactHtml = await exports.default.fetch(new Request("https://example.test/react-chat/index.html"));
    expect(reactHtml.headers.get("Cache-Control") || "").not.toContain("immutable");
  });

  it("invalidates an admin session when its token fingerprint no longer matches", async () => {
    const cookie = await adminLogin();
    const sessionToken = cookie.split("=", 2)[1];
    const key = `admin:${sessionToken}`;
    const session = await env.CHAT_STORE.get<Record<string, unknown>>(key, "json");
    expect(session?.tokenFingerprint).toMatch(/^[0-9a-f]{64}$/);
    await env.CHAT_STORE.put(key, JSON.stringify({ ...session, tokenFingerprint: "0".repeat(64) }));

    const response = await apiRequest("/api/admin/session", cookie);
    expect(response.status).toBe(401);
    await expect(env.CHAT_STORE.get(key)).resolves.toBeNull();
  });

  it("blocks trivial probe prompts before contacting an upstream", async () => {
    const { cookie, label } = await login();
    await env.CHAT_STORE.put(
      ROUTES_CONFIG_KEY,
      JSON.stringify({
        defaults: { defaultRoute: "test", allowedRoutes: ["test"], blockedPrompts: ["你好", "hi"] },
        users: { [label]: { allowedRoutes: ["test"] } },
        routes: {
          test: {
            label: "Test",
            type: "openai-chat",
            baseUrl: "https://upstream.invalid/v1",
            model: "test-model",
            apiKey: "test-key",
          },
        },
      }),
    );

    const response = await apiRequest("/api/chat", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Chatus-Client": "web" },
      body: JSON.stringify({ routeId: "test", messages: [{ role: "user", content: "你好！" }] }),
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "blocked_prompt" });
  });

  it("stores, restores and deletes an isolated cloud chat", async () => {
    const { cookie } = await login();
    const chat = {
      id: "chat-1",
      title: "测试会话",
      createdAt: 10,
      updatedAt: 20,
      summary: "",
      summaryUntil: 0,
      pinned: true,
      skillIds: ["writer", "writer", "analyst", "research", "ignored"],
      messages: [
        { role: "user", content: "完成一个小任务" },
        {
          role: "assistant",
          content: "已完成",
          routeId: "backup",
          fallback: true,
          createdAt: 123456,
          toolEvents: [{
            id: "call-1",
            toolId: "builtin:text_stats",
            label: "文本统计",
            source: "builtin",
            status: "running",
            argumentSummary: "text: private raw value",
            resultPreview: "x".repeat(2_100),
            createdAt: 100,
            updatedAt: 110,
          }],
        },
      ],
    };
    const put = await apiRequest("/api/chats", cookie, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat }),
    });
    expect(put.status).toBe(200);

    const stale = await apiRequest("/api/chats", cookie, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat: { ...chat, title: "旧设备版本", updatedAt: 19 } }),
    });
    expect(stale.status).toBe(200);
    await expect(stale.json()).resolves.toMatchObject({
      accepted: false,
      currentChat: { id: "chat-1", title: "测试会话", updatedAt: 20 },
    });

    const list = await apiRequest("/api/chats", cookie);
    expect(list.status).toBe(200);
    const storedChat = await list.json() as any;
    expect(storedChat).toMatchObject({
      chats: [{
        id: "chat-1",
        title: "测试会话",
        pinned: true,
        skillIds: ["writer", "analyst", "research"],
        messages: [{ role: "user" }, {
          routeId: "backup",
          fallback: true,
          createdAt: 123456,
          toolEvents: [{ status: "failed", errorCode: "interrupted", truncated: true }],
        }],
      }],
    });
    expect(storedChat.chats[0].messages[1].toolEvents[0].resultPreview).toHaveLength(2_000);

    await apiRequest("/api/chats", cookie, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat: { ...chat, title: "其他设备更新", updatedAt: 21 } }),
    });
    const conflictedRemove = await apiRequest("/api/chats?id=chat-1&expectedUpdatedAt=20", cookie, { method: "DELETE" });
    expect(conflictedRemove.status).toBe(409);
    await expect(conflictedRemove.json()).resolves.toMatchObject({
      error: "chat_delete_conflict",
      currentChat: { id: "chat-1", title: "其他设备更新", updatedAt: 21 },
    });

    const remove = await apiRequest("/api/chats?id=chat-1&expectedUpdatedAt=21", cookie, { method: "DELETE" });
    expect(remove.status).toBe(200);
    await expect(remove.json()).resolves.toMatchObject({ deleted: true, chats: [] });

    const delayedSave = await apiRequest("/api/chats", cookie, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat: { ...chat, title: "延迟上传", updatedAt: 21 } }),
    });
    await expect(delayedSave.json()).resolves.toMatchObject({ accepted: false, currentChat: null, chats: [] });

    const staleMerge = await apiRequest("/api/chats/migrate", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "merge", chats: [{ ...chat, title: "旧设备迁移", updatedAt: 21 }] }),
    });
    await expect(staleMerge.json()).resolves.toMatchObject({ mode: "merge", chats: [] });
  });

  it("rehearses legacy cloud-chat write and compatibility-read rollback without hidden mutation", async () => {
    const cloudChats = LEGACY_SURFACE_MANIFEST.find(({ surfaceId }) => surfaceId === "legacy.api.cloud-chats");
    if (!cloudChats) throw new Error("missing_legacy_cloud_chats_manifest");
    const cloudChatsStub = env.INSTANCE_COORDINATOR.getByName(legacySurfaceObjectName(cloudChats.surfaceId));
    const manifestDigest = await legacySurfaceManifestDigest();
    await cloudChatsStub.syncLegacySurfaceManifest({ version: 1, manifest: cloudChats, manifestDigest });
    const originalSnapshot = await cloudChatsStub.captureLegacySurfaceState({
      version: 1,
      surfaceId: cloudChats.surfaceId,
      captureEpoch: `cloud-chats-route-rehearsal-${crypto.randomUUID()}`,
      manifestDigest,
    });

    try {
      await runInDurableObject(cloudChatsStub, async (_instance, state) => {
        state.storage.sql.exec("DELETE FROM legacy_surface_daily");
      });
      const { cookie } = await login();
      const chat = {
        id: "legacy-census-chat",
        title: "Census fixture",
        createdAt: 10,
        updatedAt: 20,
        messages: [],
      };

      const put = await apiRequest("/api/chats", cookie, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-chatus-legacy-caller": "browser" },
        body: JSON.stringify({ chat }),
      });
      expect(put.status, await put.clone().text()).toBe(200);
      expect((await apiRequest("/api/chats", cookie, {
        headers: { "x-chatus-legacy-caller": "agent_runtime" },
      })).status).toBe(200);
      const migrate = await apiRequest("/api/chats/migrate", cookie, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-chatus-legacy-caller": "operator" },
        body: JSON.stringify({
          mode: "merge",
          chats: [{ ...chat, id: "legacy-census-migrate", updatedAt: 30 }],
        }),
      });
      expect(migrate.status, await migrate.clone().text()).toBe(200);
      const remove = await apiRequest(
        "/api/chats?id=legacy-census-chat&expectedUpdatedAt=20",
        cookie,
        { method: "DELETE", headers: { "x-chatus-legacy-caller": "test" } },
      );
      expect(remove.status, await remove.clone().text()).toBe(200);
      expect((await apiRequest("/api/chats", cookie)).status).toBe(200);

      await expect(runInDurableObject(cloudChatsStub, async (_instance, state) => (
        state.storage.sql.exec<{ caller_class: string; access: string; count: number; deployment_sha: string }>(
          "SELECT caller_class, access, count, deployment_sha FROM legacy_surface_daily ORDER BY caller_class, access",
        ).toArray()
      ))).resolves.toEqual([
        { caller_class: "agent_runtime", access: "read", count: 1, deployment_sha: "0".repeat(40) },
        { caller_class: "browser", access: "read", count: 1, deployment_sha: "0".repeat(40) },
        { caller_class: "browser", access: "write", count: 1, deployment_sha: "0".repeat(40) },
        { caller_class: "operator", access: "read", count: 1, deployment_sha: "0".repeat(40) },
        { caller_class: "operator", access: "write", count: 1, deployment_sha: "0".repeat(40) },
        { caller_class: "test", access: "read", count: 1, deployment_sha: "0".repeat(40) },
        { caller_class: "test", access: "write", count: 1, deployment_sha: "0".repeat(40) },
        { caller_class: "worker_api", access: "read", count: 1, deployment_sha: "0".repeat(40) },
      ]);

      await runInDurableObject(cloudChatsStub, async (_instance, state) => {
        state.storage.sql.exec(
          "UPDATE legacy_surface_state SET revision = 5, phase = 'write_disabled', read_control = 'enabled', write_control = 'disabled', last_transition_at = ? WHERE id = 1",
          Date.now() - 1,
        );
      });
      const blockedWrite = await apiRequest("/api/chats", cookie, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-chatus-legacy-caller": "worker_api" },
        body: JSON.stringify({ chat: { ...chat, id: "must-not-persist", updatedAt: 40 } }),
      });
      expect(blockedWrite.status).toBe(410);
      await expect(blockedWrite.json()).resolves.toMatchObject({ error: "legacy_surface_write_disabled" });
      const afterBlockedWrite = await apiRequest("/api/chats", cookie, {
        headers: { "x-chatus-legacy-caller": "worker_api" },
      });
      expect(afterBlockedWrite.status).toBe(200);
      await expect(afterBlockedWrite.json()).resolves.not.toMatchObject({
        chats: expect.arrayContaining([expect.objectContaining({ id: "must-not-persist" })]),
      });
      const agentAfterBlockedWrite = await apiRequest("/api/agent/conversations", cookie);
      expect(agentAfterBlockedWrite.status).toBe(200);
      await expect(agentAfterBlockedWrite.json()).resolves.not.toMatchObject({
          conversations: expect.arrayContaining([expect.objectContaining({ id: "must-not-persist" })]),
        });

      const writeRollbackRequestedAt = Date.now();
      const writeRollback = await cloudChatsStub.rollbackLegacySurface({
        version: 1,
        surfaceId: cloudChats.surfaceId,
        expectedRevision: 5,
        operationId: `cloud-chats-write-routing-switch-${crypto.randomUUID()}`,
        scope: "write",
        reason: "runtime_regression",
        requestedAt: writeRollbackRequestedAt,
        evidence: [{
          version: 1,
          kind: "rollback_rehearsal",
          evidenceId: `cloud-chats-write-rehearsal-${crypto.randomUUID()}`,
          digest: "c".repeat(64),
          deploymentSha: "0".repeat(40),
          observedAt: writeRollbackRequestedAt,
          count: 1,
          result: "passed",
        }],
      });
      expect(writeRollback).toMatchObject({
        ok: true,
        replayed: false,
        projection: {
          phase: "shadowing",
          readControl: "enabled",
          writeControl: "enabled",
        },
      });
      const restoredWrite = await apiRequest("/api/chats", cookie, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-chatus-legacy-caller": "test" },
        body: JSON.stringify({ chat: { ...chat, id: "restored-after-write-rollback", updatedAt: 40 } }),
      });
      expect(restoredWrite.status, await restoredWrite.clone().text()).toBe(200);
      const agentAfterWriteRollback = await apiRequest("/api/agent/conversations", cookie);
      expect(agentAfterWriteRollback.status).toBe(200);
      await expect(agentAfterWriteRollback.json()).resolves.toMatchObject({
          conversations: expect.arrayContaining([expect.objectContaining({ id: "restored-after-write-rollback" })]),
        });

      await runInDurableObject(cloudChatsStub, async (_instance, state) => {
        state.storage.sql.exec(
          "UPDATE legacy_surface_state SET revision = 9, phase = 'read_disabled', read_control = 'disabled', write_control = 'disabled', last_transition_at = ? WHERE id = 1",
          Date.now() - 1,
        );
      });
      const blockedRead = await apiRequest("/api/chats", cookie, {
        headers: { "x-chatus-legacy-caller": "test" },
      });
      expect(blockedRead.status).toBe(410);
      await expect(blockedRead.json()).resolves.toMatchObject({ error: "legacy_surface_read_disabled" });

      const readRollbackRequestedAt = Date.now();
      const readRollback = await cloudChatsStub.rollbackLegacySurface({
        version: 1,
        surfaceId: cloudChats.surfaceId,
        expectedRevision: 9,
        operationId: `cloud-chats-read-routing-switch-${crypto.randomUUID()}`,
        scope: "read",
        reason: "runtime_regression",
        requestedAt: readRollbackRequestedAt,
        evidence: [{
          version: 1,
          kind: "rollback_rehearsal",
          evidenceId: `cloud-chats-read-rehearsal-${crypto.randomUUID()}`,
          digest: "d".repeat(64),
          deploymentSha: "0".repeat(40),
          observedAt: readRollbackRequestedAt,
          count: 1,
          result: "passed",
        }],
      });
      expect(readRollback).toMatchObject({
        ok: true,
        replayed: false,
        projection: {
          phase: "recovery_proven",
          readControl: "enabled",
          writeControl: "disabled",
        },
      });
      const restoredRead = await apiRequest("/api/chats", cookie, {
        headers: { "x-chatus-legacy-caller": "test" },
      });
      expect(restoredRead.status).toBe(200);
      await expect(restoredRead.json()).resolves.toMatchObject({
        chats: expect.arrayContaining([expect.objectContaining({ id: "restored-after-write-rollback" })]),
      });
      const stillBlockedWrite = await apiRequest("/api/chats", cookie, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-chatus-legacy-caller": "test" },
        body: JSON.stringify({ chat: { ...chat, id: "blocked-after-read-rollback", updatedAt: 50 } }),
      });
      expect(stillBlockedWrite.status).toBe(410);
      await expect(stillBlockedWrite.json()).resolves.toMatchObject({ error: "legacy_surface_write_disabled" });
    } finally {
      await runInDurableObject(cloudChatsStub, async (_instance, state) => {
        state.storage.transactionSync(() => {
          state.storage.sql.exec("DELETE FROM legacy_surface_daily");
          state.storage.sql.exec("DELETE FROM legacy_surface_operations");
          state.storage.sql.exec("DELETE FROM legacy_surface_events");
          state.storage.sql.exec("DELETE FROM legacy_surface_state");
          state.storage.sql.exec("DELETE FROM legacy_surface_manifest");
        });
      });
      await expect(cloudChatsStub.restoreLegacySurfaceState({ version: 1, snapshot: originalSnapshot }))
        .resolves.toMatchObject({ ok: true, restored: true });
    }
  });

  it("deletes all user conversations and long-term memory", async () => {
    const { cookie, label } = await login();
    const providerEvidence = await seedProviderAttempt(`retained-${crypto.randomUUID()}`);
    await apiRequest("/api/memory", cookie, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memory: "偏好简洁回答" }),
    });
    await apiRequest("/api/chats", cookie, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat: { id: "delete-me", title: "待删除", createdAt: 10, updatedAt: 20, messages: [] } }),
    });
    await apiRequest("/api/agent/conversations", cookie);
    const agentMemory = await apiRequest("/api/agent/memory", cookie).then((response) => response.json()) as any;
    await apiRequest("/api/agent/memory", cookie, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memory: "Agent memory", expectedRevision: agentMemory.revision }),
    });
    const agentChat = await apiRequest("/api/agent/conversations", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(agentChat.status).toBe(201);
    const agentConversation = (await agentChat.json() as { conversation: { id: string } }).conversation;
    const rootAgent = await getRootAgent(label);
    const conversationAgent = await getConversationAgent(label, agentConversation.id);
    const oauthData = await seedMcpOAuthData(label, "purge-oauth");
    await expect(conversationAgent.getConversationMessageCount()).resolves.toBe(0);

    const identityStorageKey = "chatus:agent-identity:v1";
    const legacyChatIndexKey = `chats:${encodeURIComponent(label)}:index`;
    const preservedConfig = await configurePublicAccess({ managed: false, legacyApiKey: "purge-preserved-test-key" });
    const preservedRouteSecretKey = `${ROUTE_SECRET_PREFIX}PURGE_PRESERVED_TEST_KEY`;
    const preservedRouteSecretRecord = JSON.stringify({
      version: 1,
      algorithm: "AES-GCM",
      iv: "synthetic-test-iv",
      ciphertext: "synthetic-test-ciphertext",
      updatedAt: "2026-07-26T00:00:00.000Z",
    });
    await env.CHAT_STORE.put(legacyChatIndexKey, "malformed legacy residue");
    await env.CHAT_STORE.put(preservedRouteSecretKey, preservedRouteSecretRecord);
    await runInDurableObject(rootAgent, async (_instance, state) => {
      await expect(state.storage.get(identityStorageKey)).resolves.toMatchObject({ userLabel: label, scope: "root" });
    });
    await runInDurableObject(conversationAgent, async (_instance, state) => {
      await expect(state.storage.get(identityStorageKey)).resolves.toMatchObject({
        userLabel: label,
        scope: "conversation",
        chatId: agentConversation.id,
      });
      const now = Date.now();
      state.storage.sql.exec(
        `INSERT INTO chatus_conversation_branch_launches(
          request_id, fingerprint, state, body_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        "delete-launch-residue",
        "delete-launch-fingerprint",
        "ready",
        "{}",
        now,
        now,
      );
    });

    const remove = await apiRequest("/api/user-data", cookie, { method: "DELETE" });
    expect(remove.status).toBe(200);
    expect(remove.headers.get("Set-Cookie")).toContain("Max-Age=0");
    expect((await apiRequest("/api/chats", cookie)).status).toBe(401);
    expect((await apiRequest("/api/memory", cookie)).status).toBe(401);
    await expect(env.CHAT_STORE.get(legacyChatIndexKey)).resolves.toBeNull();
    await expect(env.CHAT_STORE.get(ROUTES_CONFIG_KEY, "json")).resolves.toEqual(preservedConfig);
    await expect(env.CHAT_STORE.get(preservedRouteSecretKey)).resolves.toBe(preservedRouteSecretRecord);
    const retainedAttempts = await env.PROVIDER_ATTEMPT_LEDGER
      .getByName(providerEvidence.providerId)
      .listRecent();
    expect(retainedAttempts).toEqual([expect.objectContaining({
      attemptId: providerEvidence.attemptId,
      turnId: providerEvidence.turnId,
      runId: providerEvidence.runId,
      status: "succeeded",
    })]);
    expect(JSON.stringify(retainedAttempts)).not.toContain(label);
    await runInDurableObject(oauthData.state, async (_instance, state) => {
      for (const table of [
        "mcp_oauth_states",
        "mcp_oauth_tokens",
        "mcp_oauth_discovery_candidates",
        "mcp_oauth_owner",
      ]) {
        expect(state.storage.sql.exec<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`).one().count).toBe(0);
      }
    });
    await runInDurableObject(rootAgent, async (_instance, state) => {
      await expect(state.storage.get(identityStorageKey)).resolves.toBeUndefined();
    });
    await runInDurableObject(conversationAgent, async (_instance, state) => {
      await expect(state.storage.get(identityStorageKey)).resolves.toBeUndefined();
      const rows = state.storage.sql.exec<{ count: number }>(
        "SELECT COUNT(*) AS count FROM chatus_conversation_branch_launches",
      ).toArray();
      expect(rows).toEqual([{ count: 0 }]);
    });

    const next = await login(label);
    await expect(apiRequest("/api/chats", next.cookie).then((response) => response.json())).resolves.toMatchObject({ chats: [] });
    await expect(apiRequest("/api/memory", next.cookie).then((response) => response.json())).resolves.toMatchObject({ memory: "" });
    await expect(apiRequest("/api/agent/conversations", next.cookie).then((response) => response.json()))
      .resolves.toMatchObject({ conversations: [] });
    await expect(apiRequest("/api/agent/memory", next.cookie).then((response) => response.json()))
      .resolves.toMatchObject({ memory: "", revision: "" });
    const staleUpload = await apiRequest("/api/chats", next.cookie, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat: { id: "delete-me", title: "旧设备副本", createdAt: 10, updatedAt: 20, messages: [] } }),
    });
    await expect(staleUpload.json()).resolves.toMatchObject({ accepted: false, currentChat: null, chats: [] });

    const restored = await apiRequest("/api/chats/migrate", next.cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "restore",
        chats: [{ id: "delete-me", title: "从备份恢复", createdAt: 10, updatedAt: 20, messages: [] }],
      }),
    }).then((response) => response.json());
    expect(restored).toMatchObject({ mode: "restore", chats: [{ id: "delete-me", title: "从备份恢复" }] });
    expect(restored.chats[0].updatedAt).toBeGreaterThan(20);

    const oldDeviceMerge = await apiRequest("/api/chats/migrate", next.cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "merge",
        chats: [{ id: "other-old-chat", title: "旧设备残留", createdAt: 10, updatedAt: 20, messages: [] }],
      }),
    }).then((response) => response.json());
    expect(oldDeviceMerge.chats).toHaveLength(1);
    expect(oldDeviceMerge.chats[0]).toMatchObject({ id: "delete-me", title: "从备份恢复" });
  });

  it("exports bounded user conversations and memory without message metadata or file URLs", async () => {
    const { cookie, label } = await login();
    const providerEvidence = await seedProviderAttempt(`export-excluded-${crypto.randomUUID()}`);
    const oauthData = await seedMcpOAuthData(label, "export-oauth");
    await apiRequest("/api/agent/memory", cookie, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memory: "偏好简洁回答", expectedRevision: "" }),
    });
    const created = await apiRequest("/api/agent/conversations", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "可导出会话" }),
    });
    expect(created.status).toBe(201);
    const conversation = (await created.json() as any).conversation;
    const agent = await getConversationAgent(label, conversation.id);
    await agent.importLegacyMessages([
      {
        id: "message-1",
        role: "user",
        metadata: { internal: "omit" },
        parts: [
          { type: "text", text: "导出文本" },
          { type: "file", mediaType: "image/png", url: "data:image/png;base64,QQ==", filename: "user-image.png" },
        ],
      },
      {
        id: "message-2",
        role: "assistant",
        parts: [{ type: "file", mediaType: "image/png", url: "data:image/png;base64,omit", filename: "image.png" }],
      },
    ] as any);

    const response = await apiRequest("/api/user-data/export", cookie);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(response.headers.get("Content-Disposition")).toContain("chatus-user-data.json");
    const payload = await response.json() as any;
    expect(payload).toMatchObject({
      schema: "chatus-user-data",
      version: 1,
      account: { label },
      memory: { text: "偏好简洁回答" },
      conversations: [{
        id: conversation.id,
        messagesTruncated: false,
        messages: [
          {
            id: "message-1",
            role: "user",
            parts: [
              { type: "text", text: "导出文本" },
              { type: "file", mediaType: "image/png", name: "user-image.png" },
            ],
          },
          { id: "message-2", role: "assistant", parts: [{ type: "file", mediaType: "image/png", name: "image.png" }] },
        ],
      }],
      truncated: false,
    });
    expect(JSON.stringify(payload)).not.toContain("internal");
    expect(JSON.stringify(payload)).not.toContain("data:image");
    expect(JSON.stringify(payload)).not.toContain("omit");
    expect(JSON.stringify(payload)).not.toContain(oauthData.accessToken);
    expect(JSON.stringify(payload)).not.toContain(oauthData.refreshToken);
    expect(JSON.stringify(payload)).not.toContain("ciphertext");
    expect(JSON.stringify(payload)).not.toContain("mcp_oauth");
    expect(JSON.stringify(payload)).not.toContain("export-issuer.example");
    expect(JSON.stringify(payload)).not.toContain(providerEvidence.providerId);
    expect(JSON.stringify(payload)).not.toContain(providerEvidence.turnId);
    expect(JSON.stringify(payload)).not.toContain(providerEvidence.runId);
    expect(JSON.stringify(payload)).not.toContain(providerEvidence.attemptId);
  });

  it("keeps user exports isolated and requires an authenticated session", async () => {
    const unauthorized = await exports.default.fetch(new Request("https://example.test/api/user-data/export"));
    expect(unauthorized.status).toBe(401);

    const first = await login(`export-first-${crypto.randomUUID()}`);
    const firstRoot = await getRootAgent(first.label);
    const firstConversationId = crypto.randomUUID();
    await firstRoot.createConversation({
      id: firstConversationId,
      title: "First export",
      createdAt: 10,
      updatedAt: 10,
      summary: "",
      pinned: false,
      skillIds: [],
    });
    await (await getConversationAgent(first.label, firstConversationId)).importLegacyMessages([{
      id: "first-message",
      role: "user",
      parts: [{ type: "text", text: "first-user-export-marker" }],
    }] as UIMessage[]);

    const second = await login(`export-second-${crypto.randomUUID()}`);
    const secondRoot = await getRootAgent(second.label);
    const secondConversationId = crypto.randomUUID();
    await secondRoot.createConversation({
      id: secondConversationId,
      title: "Second export",
      createdAt: 20,
      updatedAt: 20,
      summary: "",
      pinned: false,
      skillIds: [],
    });
    await (await getConversationAgent(second.label, secondConversationId)).importLegacyMessages([{
      id: "second-message",
      role: "user",
      parts: [{ type: "text", text: "second-user-export-marker" }],
    }] as UIMessage[]);

    const response = await apiRequest("/api/user-data/export", first.cookie);
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).toContain("first-user-export-marker");
    expect(body).not.toContain("second-user-export-marker");
    expect(body).not.toContain(second.label);
  });

  it("bounds large user exports and marks omitted earlier messages", async () => {
    const { cookie, label } = await login();
    const root = await getRootAgent(label);
    const conversationId = crypto.randomUUID();
    await root.createConversation({
      id: conversationId,
      title: "Bounded export",
      createdAt: 10,
      updatedAt: 10,
      summary: "",
      pinned: false,
      skillIds: [],
    });
    const agent = await getConversationAgent(label, conversationId);
    await agent.importLegacyMessages(Array.from({ length: 40 }, (_, index) => ({
      id: `large-message-${index}`,
      role: "user",
      parts: [{ type: "text", text: `${index}:`.padEnd(20_000, "x") }],
    })) as UIMessage[]);

    const response = await apiRequest("/api/user-data/export", cookie);
    const body = await response.text();
    const payload = JSON.parse(body) as any;
    expect(response.status).toBe(200);
    expect(new TextEncoder().encode(body).byteLength).toBeLessThanOrEqual(5_000_000);
    expect(payload.truncated).toBe(true);
    expect(payload.conversations[0].messagesTruncated).toBe(true);
    expect(payload.conversations[0].messages.length).toBeLessThan(40);
    expect(payload.conversations[0].messages.at(-1).id).toBe("large-message-39");
    expect(body).not.toContain("large-message-0");
  });

  it("rejects auxiliary model calls without the web client marker", async () => {
    const { cookie } = await login();
    const response = await apiRequest("/api/session-summary", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "请总结这个任务" }] }),
    });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "forbidden" });
  });

  it("does not charge the user message quota for automatic session summaries", async () => {
    const routeConfig = {
      routes: {
        default: {
          label: "Default",
          type: "openai-chat",
          baseUrl: "https://summary.example/v1",
          model: "summary-model",
          apiKey: "summary-key",
        },
      },
      defaults: { defaultRoute: "default", allowedRoutes: ["default"], dailyMessageLimit: 5 },
    };
    const adminCookie = await adminLogin();
    const currentConfig = await apiRequest("/api/admin/config", adminCookie).then((response) => response.json());
    const savedConfig = await apiRequest("/api/admin/config", adminCookie, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: routeConfig, expectedRevision: currentConfig.revision }),
    });
    expect(savedConfig.status).toBe(200);
    const { cookie } = await login();
    const before = await apiRequest("/api/session", cookie).then((response) => response.json());
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({
      id: "chatcmpl-summary-test",
      object: "chat.completion",
      created: 1,
      model: "summary-model",
      choices: [{ index: 0, message: { role: "assistant", content: "用户正在测试长期会话摘要。" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const response = await apiRequest("/api/session-summary", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Chatus-Client": "web" },
      body: JSON.stringify({ messages: [{ role: "user", content: "请持续记住这个测试任务" }] }),
    });
    const summaryPayload = await response.json();
    expect(response.status, JSON.stringify(summaryPayload)).toBe(200);
    expect(summaryPayload).toMatchObject({ summary: "用户正在测试长期会话摘要。" });
    const after = await apiRequest("/api/session", cookie).then((sessionResponse) => sessionResponse.json());
    expect(after.usage.remaining).toBe(before.usage.remaining);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("persists content-free attempts for memory suggestions and conversation summaries", async () => {
    const providerId = `auxiliary-${crypto.randomUUID()}`;
    const endpoint = `https://${providerId}.example/v1`;
    const promptMarker = `PRIVATE_AUXILIARY_PROMPT_${crypto.randomUUID()}`;
    const memoryMarker = `PRIVATE_MEMORY_COMPLETION_${crypto.randomUUID()}`;
    const summaryMarker = `PRIVATE_SUMMARY_COMPLETION_${crypto.randomUUID()}`;
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      providers: {
        [providerId]: {
          label: "Auxiliary provider",
          type: "openai-chat",
          baseUrl: endpoint,
          apiKeyRef: "TEST_ROUTE_KEY",
        },
      },
      routes: {
        auxiliary: {
          label: "Auxiliary",
          offerings: [{ providerId, model: "auxiliary-model" }],
        },
      },
      defaults: {
        defaultRoute: "auxiliary",
        allowedRoutes: ["auxiliary"],
        dailyMessageLimit: 5,
      },
    }));
    const { cookie } = await login();
    const adminCookie = await adminLogin();
    const before = await apiRequest("/api/session", cookie).then((response) => response.json()) as any;
    const completionResponse = (text: string) => new Response(JSON.stringify({
      id: `chatcmpl-${crypto.randomUUID()}`,
      object: "chat.completion",
      created: 1,
      model: "auxiliary-model",
      choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(async () => completionResponse(`- ${memoryMarker}`))
      .mockImplementationOnce(async () => completionResponse(summaryMarker));

    const memory = await apiRequest("/api/memory/suggest", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Chatus-Client": "web" },
      body: JSON.stringify({
        routeId: "auxiliary",
        messages: [{ role: "user", content: promptMarker }],
      }),
    });
    expect(memory.status, await memory.clone().text()).toBe(200);
    await expect(memory.json()).resolves.toMatchObject({ suggestion: `- ${memoryMarker}` });

    const summary = await apiRequest("/api/session-summary", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Chatus-Client": "web" },
      body: JSON.stringify({
        routeId: "auxiliary",
        messages: [{ role: "user", content: promptMarker }],
      }),
    });
    expect(summary.status, await summary.clone().text()).toBe(200);
    await expect(summary.json()).resolves.toMatchObject({ summary: summaryMarker });

    const after = await apiRequest("/api/session", cookie).then((response) => response.json()) as any;
    expect(after.usage.remaining).toBe(before.usage.remaining - 1);
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    const diagnostics = await apiRequest(
      `/api/admin/provider-attempts?providerId=${encodeURIComponent(providerId)}&limit=10`,
      adminCookie,
    );
    expect(diagnostics.status, await diagnostics.clone().text()).toBe(200);
    const payload = await diagnostics.json() as any;
    expect(payload.providerId).toBe(providerId);
    expect(payload.attempts).toHaveLength(2);
    expect(payload.attempts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        runKind: "memory_suggestion",
        logicalRouteId: "auxiliary",
        providerId,
        model: "auxiliary-model",
        status: "succeeded",
      }),
      expect.objectContaining({
        runKind: "conversation_summary",
        logicalRouteId: "auxiliary",
        providerId,
        model: "auxiliary-model",
        status: "succeeded",
      }),
    ]));
    expect(new Set(payload.attempts.map((attempt: any) => attempt.runId)).size).toBe(2);
    expect(new Set(payload.attempts.map((attempt: any) => attempt.turnId)).size).toBe(2);
    expect(JSON.stringify(payload)).not.toContain(promptMarker);
    expect(JSON.stringify(payload)).not.toContain(memoryMarker);
    expect(JSON.stringify(payload)).not.toContain(summaryMarker);
    expect(JSON.stringify(payload)).not.toContain("test-route-key");
    expect(JSON.stringify(payload)).not.toContain(endpoint);

    const monitorResponse = await apiRequest("/api/admin/model-monitor?window=24h&bucket=hour", adminCookie);
    expect(monitorResponse.status, await monitorResponse.clone().text()).toBe(200);
    const monitor = await monitorResponse.json() as any;
    expect(monitor).toMatchObject({ version: 1, window: "24h" });
    expect(monitor.totals).toMatchObject({ attempts: 2, succeeded: 2, failures: 0, inFlight: 0 });
    expect(monitor.routes).toEqual(expect.arrayContaining([expect.objectContaining({ id: "auxiliary", attempts: 2 })]));
    expect(JSON.stringify(monitor)).not.toContain(promptMarker);
    expect(JSON.stringify(monitor)).not.toContain(endpoint);

    const availabilityResponse = await apiRequest("/api/model-availability", cookie);
    expect(availabilityResponse.status, await availabilityResponse.clone().text()).toBe(200);
    const availability = await availabilityResponse.json() as any;
    expect(availability.routes).toEqual([expect.objectContaining({
      routeId: "auxiliary",
      status: "unknown",
      confidence: "limited",
    })]);
    expect(JSON.stringify(availability)).not.toContain(providerId);
    expect(JSON.stringify(availability)).not.toContain(endpoint);
  });

  it("projects authenticated content-free capability monitoring with strict query bounds", async () => {
    const privateMarker = `PRIVATE_CAPABILITY_MARKER_${crypto.randomUUID()}`;
    await env.PROVIDER_COORDINATOR.getByName("$capability-monitoring-v1").recordCapabilityMonitoringEvent({
      version: 1,
      capabilityId: "chatus:tool_execution",
      kind: "tool",
      status: "denied",
      latencyMs: null,
      occurredAt: Date.now(),
    });

    expect((await exports.default.fetch(new Request(
      "https://example.test/api/admin/capability-monitor?window=24h&bucket=hour",
    ))).status).toBe(401);
    const adminCookie = await adminLogin();
    const invalid = await apiRequest("/api/admin/capability-monitor?window=7d&bucket=hour", adminCookie);
    expect(invalid.status).toBe(400);

    const response = await apiRequest("/api/admin/capability-monitor?window=24h&bucket=hour", adminCookie);
    expect(response.status, await response.clone().text()).toBe(200);
    const snapshot = await response.json() as any;
    expect(snapshot).toMatchObject({
      version: 1,
      window: "24h",
      bucket: "hour",
      evidence: "fresh",
      stale: false,
    });
    expect(snapshot.capabilities).toEqual(expect.arrayContaining([expect.objectContaining({
      capabilityId: "chatus:tool_execution",
      kind: "tool",
      denied: expect.any(Number),
    })]));
    expect(JSON.stringify(snapshot)).not.toContain(privateMarker);
    expect(JSON.stringify(snapshot)).not.toContain("providerId");
    expect(JSON.stringify(snapshot)).not.toContain("member");
  });

  it("projects hard budget policy denial for memory suggestions and summaries without Provider calls", async () => {
    const providerId = `auxiliary-budget-${crypto.randomUUID()}`;
    const endpoint = `https://${providerId}.example/v1`;
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      providers: {
        [providerId]: {
          label: "Auxiliary budget provider",
          type: "openai-chat",
          baseUrl: endpoint,
          apiKeyRef: "TEST_ROUTE_KEY",
        },
      },
      routes: {
        auxiliary: {
          label: "Auxiliary budget route",
          offerings: [{ providerId, model: "auxiliary-budget-model" }],
        },
      },
      defaults: { defaultRoute: "auxiliary", allowedRoutes: ["auxiliary"], dailyMessageLimit: 5 },
    }));
    await seedHardProviderBudget({
      providerId,
      routeId: "auxiliary",
      model: "auxiliary-budget-model",
      knownPrice: false,
    });
    const { cookie } = await login();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const request = (path: string) => apiRequest(path, cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Chatus-Client": "web" },
      body: JSON.stringify({
        routeId: "auxiliary",
        messages: [{ role: "user", content: "local budget denial" }],
      }),
    });

    for (const path of ["/api/memory/suggest", "/api/session-summary"]) {
      const response = await request(path);
      const text = await response.text();
      expect(response.status, text).toBe(503);
      expect(JSON.parse(text)).toEqual({
        error: "provider_budget_policy_unknown",
        message: "当前 Provider 缺少可验证的价格策略，请联系管理员完成配置。",
        routeId: "auxiliary",
      });
      expect(text).not.toContain(providerId);
      expect(text).not.toContain(endpoint);
      expect(text).not.toContain("TEST_ROUTE_KEY");
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("requires an admin session for managed route-secret APIs", async () => {
    expect((await exports.default.fetch(new Request("https://example.test/api/admin/setup-status"))).status).toBe(401);
    expect((await exports.default.fetch(new Request("https://example.test/api/admin/setup-smoke", {
      method: "POST",
    }))).status).toBe(401);
    expect((await exports.default.fetch(new Request("https://example.test/api/admin/route-secrets"))).status).toBe(401);
    expect((await exports.default.fetch(new Request("https://example.test/api/admin/reliability"))).status).toBe(401);
    expect((await exports.default.fetch(new Request(
      "https://example.test/api/admin/provider-attempts?providerId=test",
    ))).status).toBe(401);
    expect((await exports.default.fetch(new Request(
      "https://example.test/api/admin/provider-finance",
    ))).status).toBe(401);
    expect((await exports.default.fetch(new Request(
      "https://example.test/api/admin/legacy-surfaces",
    ))).status).toBe(401);
    expect((await exports.default.fetch(new Request(
      "https://example.test/api/admin/legacy-surfaces/legacy.api.chat-post/census?days=30",
    ))).status).toBe(401);
    expect((await exports.default.fetch(new Request(
      `https://example.test/api/admin/legacy-surfaces/${LEGACY_SURFACE_MANIFEST[0].surfaceId}/advance`,
      { method: "POST" },
    ))).status).toBe(401);
    expect((await exports.default.fetch(new Request("https://example.test/api/admin/route-secrets/PRIVATE_TEST_KEY", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: "test-private-value" }),
    }))).status).toBe(401);
    expect((await exports.default.fetch(new Request("https://example.test/api/admin/route-secrets/PRIVATE_TEST_KEY", {
      method: "DELETE",
    }))).status).toBe(401);
    expect((await exports.default.fetch(new Request("https://example.test/api/admin/mcp-secrets"))).status).toBe(401);
    expect((await exports.default.fetch(new Request("https://example.test/api/admin/mcp-secrets/PRIVATE_TEST_KEY", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: "test-private-value" }),
    }))).status).toBe(401);
  });

  it("serves the bounded legacy-surface registry and rejects invalid control-plane mutations", async () => {
    const cookie = await adminLogin();
    const coldSurface = LEGACY_SURFACE_MANIFEST.find(
      ({ surfaceId }) => surfaceId === "legacy.auth.access-secret-fallback",
    );
    if (!coldSurface) throw new Error("missing cold legacy-surface fixture");
    const coldCensus = await apiRequest(
      `/api/admin/legacy-surfaces/${encodeURIComponent(coldSurface.surfaceId)}/census?days=30`,
      cookie,
    );
    expect(coldCensus.status, await coldCensus.clone().text()).toBe(200);
    await expect(coldCensus.json()).resolves.toMatchObject({
      version: 1,
      surfaceId: coldSurface.surfaceId,
      days: 30,
      rows: [],
    });
    await expect(
      env.INSTANCE_COORDINATOR
        .getByName(legacySurfaceObjectName(coldSurface.surfaceId))
        .inspectLegacySurface(),
    ).resolves.toEqual({ ok: false, error: "legacy_surface_not_found" });

    const initial = await apiRequest("/api/admin/legacy-surfaces", cookie);
    expect(initial.status, await initial.clone().text()).toBe(200);
    const snapshot: unknown = await initial.json();
    expect(isAdminLegacySurfaceSnapshot(snapshot)).toBe(true);
    if (!isAdminLegacySurfaceSnapshot(snapshot)) throw new Error("invalid legacy-surface snapshot fixture");
    expect(Object.keys(snapshot).sort()).toEqual(["generatedAt", "manifestDigest", "surfaces", "total", "version"]);
    expect(snapshot).toMatchObject({
      version: 1,
      manifestDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      total: LEGACY_SURFACE_MANIFEST.length,
    });
    expect(Number.isSafeInteger(snapshot.generatedAt)).toBe(true);
    expect(snapshot.surfaces.map((surface) => surface.surfaceId)).toEqual(
      LEGACY_SURFACE_MANIFEST.map(({ surfaceId }) => surfaceId),
    );
    for (const surface of snapshot.surfaces) {
      const isInstrumentedSurface = surface.surfaceId === "legacy.api.chat-post"
        || surface.surfaceId === "legacy.api.cloud-chats"
        || surface.surfaceId === "legacy.browser.admin-alias"
        || surface.surfaceId === "legacy.browser.shell";
      expect(Object.keys(surface).sort()).toEqual([
        "allowedActions",
        "blockerCodes",
        "evidence",
        "lastDeploymentSha",
        "lastTransitionAt",
        "manifestDigest",
        "manifestVersion",
        "observationRequiredUntil",
        "observationStartedAt",
        "owner",
        "phase",
        "readControl",
        "revision",
        "surfaceId",
        "version",
        "writeControl",
      ]);
      expect(surface).toMatchObject({
        version: 1,
        phase: "discovered",
        readControl: "enabled",
        writeControl: "enabled",
        owner: surface.surfaceId === "legacy.api.chat-post" || surface.surfaceId === "legacy.api.cloud-chats"
          ? "data"
          : isInstrumentedSurface ? "frontend" : "unassigned",
        allowedActions: isInstrumentedSurface
          ? [{ kind: "advance", targetPhase: "instrumented" }]
          : [],
      });
      expect(surface.manifestDigest).toBe(snapshot.manifestDigest);
    }

    const censusSurface = LEGACY_SURFACE_MANIFEST[0];
    const censusOccurredAt = Date.now();
    const censusStub = env.INSTANCE_COORDINATOR.getByName(legacySurfaceObjectName(censusSurface.surfaceId));
    const censusSnapshot = await censusStub.captureLegacySurfaceState({
      version: 1,
      surfaceId: censusSurface.surfaceId,
      captureEpoch: `worker-api-census-${crypto.randomUUID()}`,
      manifestDigest: snapshot.manifestDigest,
    });
    await runInDurableObject(censusStub, async (_instance, state) => {
      state.storage.sql.exec("DELETE FROM legacy_surface_daily");
    });
    try {
      await censusStub.recordLegacySurfaceUse({
        version: 1,
        surfaceId: censusSurface.surfaceId,
        callerClass: "worker_api",
        access: "write",
        occurredAt: censusOccurredAt,
        deploymentSha: "d".repeat(40),
      });
    const censusResponse = await apiRequest(
      `/api/admin/legacy-surfaces/${encodeURIComponent(censusSurface.surfaceId)}/census?days=30`,
      cookie,
    );
    expect(censusResponse.status, await censusResponse.clone().text()).toBe(200);
    const census = await censusResponse.json() as {
      version: number;
      surfaceId: string;
      generatedAt: number;
      days: number;
      rows: Array<Record<string, unknown>>;
    };
    expect(Object.keys(census).sort()).toEqual(["days", "generatedAt", "rows", "surfaceId", "version"]);
    expect(census).toMatchObject({
      version: 1,
      surfaceId: censusSurface.surfaceId,
      generatedAt: expect.any(Number),
      days: 30,
    });
    expect(census.rows).toContainEqual({
      day: new Date(censusOccurredAt).toISOString().slice(0, 10),
      callerClass: "worker_api",
      access: "write",
      count: 1,
      lastOccurredAt: censusOccurredAt,
      deploymentSha: "d".repeat(40),
    });
    expect(census.rows.every((row) => (
      JSON.stringify(Object.keys(row).sort()) === JSON.stringify([
        "access", "callerClass", "count", "day", "deploymentSha", "lastOccurredAt",
      ])
    ))).toBe(true);
    expect(JSON.stringify(census)).not.toMatch(/prompt|response|conversation|cookie|token/i);
    for (const query of ["", "?days=0", "?days=01", "?days=101", "?days=30&days=31", "?days=30&extra=1"]) {
      const invalid = await apiRequest(
        `/api/admin/legacy-surfaces/${encodeURIComponent(censusSurface.surfaceId)}/census${query}`,
        cookie,
      );
      expect(invalid.status, query).toBe(400);
      await expect(invalid.json(), query).resolves.toEqual({ error: "invalid_days" });
    }
    const unknownCensus = await apiRequest(
      "/api/admin/legacy-surfaces/not-bundled/census?days=30",
      cookie,
    );
    expect(unknownCensus.status).toBe(404);
    await expect(unknownCensus.json()).resolves.toEqual({ error: "legacy_surface_not_found" });

    const limited = await apiRequest("/api/admin/legacy-surfaces?limit=1", cookie);
    expect(limited.status).toBe(200);
    await expect(limited.json()).resolves.toMatchObject({ total: LEGACY_SURFACE_MANIFEST.length, surfaces: [snapshot.surfaces[0]] });
    for (const query of ["limit=0", "limit=01", "limit=101", "limit=1&limit=2", "limit=1&extra=1"]) {
      const invalid = await apiRequest(`/api/admin/legacy-surfaces?${query}`, cookie);
      expect(invalid.status, query).toBe(400);
      await expect(invalid.json(), query).resolves.toEqual({ error: "invalid_limit" });
    }

    const surface = snapshot.surfaces[0];
    const advanceInput = {
      version: 1,
      surfaceId: surface.surfaceId,
      expectedRevision: surface.revision,
      operationId: `worker-api-${crypto.randomUUID()}`,
      targetPhase: "instrumented",
      requestedAt: Date.now(),
      evidence: [],
    };
    const blocked = await apiRequest(
      `/api/admin/legacy-surfaces/${encodeURIComponent(surface.surfaceId)}/advance`,
      cookie,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(advanceInput),
      },
    );
    expect(blocked.status).toBe(422);
    await expect(blocked.json()).resolves.toEqual({ error: "legacy_surface_gate_blocked" });

    const leaked = await apiRequest(
      `/api/admin/legacy-surfaces/${encodeURIComponent(surface.surfaceId)}/advance`,
      cookie,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...advanceInput, operationId: `worker-api-${crypto.randomUUID()}`, notes: "must-not-persist" }),
      },
    );
    expect(leaked.status).toBe(400);
    await expect(leaked.json()).resolves.toEqual({ error: "invalid_legacy_surface_request" });
    await expect(env.CHAT_STORE.get(ADMIN_AUDIT_KEY)).resolves.toBeNull();

    const unknown = await apiRequest("/api/admin/legacy-surfaces/not-bundled/rollback", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(unknown.status).toBe(404);
    await expect(unknown.json()).resolves.toEqual({ error: "legacy_surface_not_found" });

    const driftedManifest = { ...LEGACY_SURFACE_MANIFEST[0], owner: "frontend" };
    const driftedSurfaceStub = env.INSTANCE_COORDINATOR.getByName(
      legacySurfaceObjectName(LEGACY_SURFACE_MANIFEST[0].surfaceId),
    );
    try {
      await runInDurableObject(driftedSurfaceStub, async (_instance, state) => {
        state.storage.sql.exec(
          "UPDATE legacy_surface_manifest SET manifest_json = ? WHERE id = 1",
          stableJson(driftedManifest),
        );
      });
      const drift = await apiRequest("/api/admin/legacy-surfaces", cookie);
      expect(drift.status).toBe(409);
      await expect(drift.json()).resolves.toEqual({ error: "legacy_surface_manifest_conflict" });
    } finally {
      await runInDurableObject(driftedSurfaceStub, async (_instance, state) => {
        state.storage.sql.exec(
          "UPDATE legacy_surface_manifest SET manifest_json = ? WHERE id = 1",
          stableJson(LEGACY_SURFACE_MANIFEST[0]),
        );
      });
    }
    } finally {
      await runInDurableObject(censusStub, async (_instance, state) => {
        state.storage.transactionSync(() => {
          state.storage.sql.exec("DELETE FROM legacy_surface_daily");
          state.storage.sql.exec("DELETE FROM legacy_surface_operations");
          state.storage.sql.exec("DELETE FROM legacy_surface_events");
          state.storage.sql.exec("DELETE FROM legacy_surface_state");
          state.storage.sql.exec("DELETE FROM legacy_surface_manifest");
        });
      });
      await expect(censusStub.restoreLegacySurfaceState({ version: 1, snapshot: censusSnapshot }))
        .resolves.toMatchObject({ ok: true, restored: true });
    }
  });

  it("rejects malformed managed-secret inputs without mutating storage", async () => {
    const cookie = await adminLogin();
    const cases = [
      {
        path: "/api/admin/route-secrets/not-valid",
        body: { apiKey: "value" },
        error: "invalid_api_key_ref",
      },
      {
        path: "/api/admin/route-secrets/BOUNDARY_ROUTE",
        body: { apiKey: "" },
        error: "api_key_required",
      },
      {
        path: "/api/admin/route-secrets/BOUNDARY_ROUTE",
        body: { apiKey: "x".repeat(8_193) },
        error: "api_key_too_long",
      },
      {
        path: "/api/admin/mcp-secrets/not-valid",
        body: { secret: "value" },
        error: "invalid_secret_ref",
      },
      {
        path: "/api/admin/mcp-secrets/BOUNDARY_MCP",
        body: { secret: "" },
        error: "secret_required",
      },
      {
        path: "/api/admin/mcp-secrets/BOUNDARY_MCP",
        body: { secret: "x".repeat(8_193) },
        error: "secret_too_long",
      },
    ];

    for (const entry of cases) {
      const response = await apiRequest(entry.path, cookie, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry.body),
      });
      expect(response.status, entry.error).toBe(400);
      await expect(response.json(), entry.error).resolves.toMatchObject({ error: entry.error });
    }

    const malformed = await apiRequest("/api/admin/route-secrets/BOUNDARY_ROUTE", cookie, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toMatchObject({ error: "api_key_required" });
    await expect(env.CHAT_STORE.get(`${ROUTE_SECRET_PREFIX}BOUNDARY_ROUTE`)).resolves.toBeNull();
    await expect(env.CHAT_STORE.get(`${MCP_SECRET_PREFIX}BOUNDARY_MCP`)).resolves.toBeNull();
    await expect(env.CHAT_STORE.get(ADMIN_AUDIT_KEY)).resolves.toBeNull();
  });

  it("sanitizes admin config credentials while preserving explicit legacy shadows", async () => {
    const adminCookie = await adminLogin();
    const providerKey = `provider-secret-${crypto.randomUUID()}`;
    const legacyKey = `legacy-secret-${crypto.randomUUID()}`;
    const providerHeader = `provider-header-${crypto.randomUUID()}`;
    const legacyHeader = `legacy-header-${crypto.randomUUID()}`;
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      providers: {
        shared: {
          label: "Shared",
          type: "openai-chat",
          baseUrl: "https://shared-config.example/v1",
          apiKey: providerKey,
          apiKeyRef: "SHARED_CONFIG_KEY",
          headers: { "X-Provider-Token": providerHeader },
        },
      },
      routes: {
        pooled: {
          label: "Pooled",
          offerings: [{ providerId: "shared", model: "pooled-model" }],
        },
        legacy: {
          label: "Legacy",
          type: "openai-chat",
          baseUrl: "https://legacy-config.example/v1",
          model: "legacy-model",
          apiKey: legacyKey,
          apiKeyRef: "LEGACY_CONFIG_KEY",
          headers: { "X-Legacy-Token": legacyHeader },
        },
      },
      defaults: { defaultRoute: "pooled", allowedRoutes: ["pooled", "legacy"] },
    }));

    const initial = await apiRequest("/api/admin/config", adminCookie).then((response) => response.json()) as any;
    const initialText = JSON.stringify(initial);
    expect(initialText).not.toContain(providerKey);
    expect(initialText).not.toContain(legacyKey);
    expect(initialText).not.toContain(providerHeader);
    expect(initialText).not.toContain(legacyHeader);
    expect(initial.config.providers.shared).toMatchObject({ hasLegacyKey: true, hasCustomHeaders: true, apiKeyRef: "SHARED_CONFIG_KEY" });
    expect(initial.config.providers.shared).not.toHaveProperty("apiKey");
    expect(initial.config.providers.shared).not.toHaveProperty("headers");
    expect(initial.config.routes.legacy).toMatchObject({ hasLegacyKey: true, hasCustomHeaders: true, apiKeyRef: "LEGACY_CONFIG_KEY" });
    expect(initial.config.routes.legacy).not.toHaveProperty("apiKey");
    expect(initial.config.routes.legacy).not.toHaveProperty("headers");

    const saved = await apiRequest("/api/admin/config", adminCookie, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: initial.config, expectedRevision: initial.revision }),
    });
    const savedText = await saved.text();
    expect(saved.status).toBe(200);
    expect(savedText).not.toContain(providerKey);
    expect(savedText).not.toContain(legacyKey);
    expect(savedText).not.toContain(providerHeader);
    expect(savedText).not.toContain(legacyHeader);
    const savedPayload = JSON.parse(savedText);
    const stored = await env.CHAT_STORE.get(ROUTES_CONFIG_KEY, "json") as any;
    expect(stored.providers.shared.apiKey).toBe(providerKey);
    expect(stored.providers.shared.headers).toEqual({ "X-Provider-Token": providerHeader });
    expect(stored.routes.legacy.apiKey).toBe(legacyKey);
    expect(stored.routes.legacy.headers).toEqual({ "X-Legacy-Token": legacyHeader });

    const withoutProviderShadow = structuredClone(savedPayload.config);
    delete withoutProviderShadow.providers.shared.hasLegacyKey;
    delete withoutProviderShadow.providers.shared.hasCustomHeaders;
    const replaced = await apiRequest("/api/admin/config", adminCookie, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: withoutProviderShadow, expectedRevision: savedPayload.revision }),
    });
    expect(replaced.status).toBe(200);
    const replacedPayload = await replaced.json() as any;
    const afterReplacement = await env.CHAT_STORE.get(ROUTES_CONFIG_KEY, "json") as any;
    expect(afterReplacement.providers.shared.apiKey).toBeUndefined();
    expect(afterReplacement.providers.shared.headers).toBeUndefined();
    expect(afterReplacement.routes.legacy.apiKey).toBe(legacyKey);
    expect(afterReplacement.routes.legacy.headers).toEqual({ "X-Legacy-Token": legacyHeader });

    const migrationConfig = structuredClone(replacedPayload.config);
    const legacyRoute = migrationConfig.routes.legacy;
    migrationConfig.providers["legacy-provider"] = {
      enabled: true,
      label: legacyRoute.label,
      type: legacyRoute.type,
      baseUrl: legacyRoute.baseUrl,
      apiKeyRef: legacyRoute.apiKeyRef,
      concurrency: "unlimited",
      headerSourceRouteId: "legacy",
    };
    for (const field of ["type", "baseUrl", "model", "apiKeyRef", "hasLegacyKey", "authHeader", "authPrefix", "directEndpoint", "headers"]) {
      delete legacyRoute[field];
    }
    legacyRoute.offerings = [{ providerId: "legacy-provider", model: "legacy-model" }];
    const migrated = await apiRequest("/api/admin/config", adminCookie, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: migrationConfig, expectedRevision: replacedPayload.revision }),
    });
    const migratedText = await migrated.text();
    expect(migrated.status, migratedText).toBe(200);
    expect(migratedText).not.toContain(legacyHeader);
    const afterMigration = await env.CHAT_STORE.get(ROUTES_CONFIG_KEY, "json") as any;
    expect(afterMigration.providers["legacy-provider"].headers).toEqual({ "X-Legacy-Token": legacyHeader });
    expect(afterMigration.routes.legacy.headers).toBeUndefined();
  });

  it("encrypts, rotates and deletes managed route keys without exposing plaintext", async () => {
    const cookie = await adminLogin();
    const apiKeyRef = "MANAGED_TEST_KEY";
    const apiKey = "managed-test-route-key-value";

    const created = await putRouteSecret(cookie, apiKeyRef, apiKey);
    const createdPayload = await created.json() as any;
    expect(created.status, JSON.stringify(createdPayload)).toBe(200);
    expect(createdPayload.item).toMatchObject({
      apiKeyRef,
      source: "managed",
      status: "configured",
      managed: true,
    });
    expect(JSON.stringify(createdPayload)).not.toContain(apiKey);
    expect(JSON.stringify(createdPayload)).not.toContain("ciphertext");

    const storageKey = `${ROUTE_SECRET_PREFIX}${encodeURIComponent(apiKeyRef)}`;
    const firstRaw = await env.CHAT_STORE.get(storageKey);
    expect(firstRaw).toBeTruthy();
    expect(firstRaw).not.toContain(apiKey);
    const firstRecord = JSON.parse(firstRaw!);
    expect(firstRecord).toMatchObject({ version: 1, algorithm: "AES-GCM" });
    expect(firstRecord.iv).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(firstRecord.ciphertext).toMatch(/^[A-Za-z0-9+/]+=*$/);

    const listed = await apiRequest("/api/admin/route-secrets", cookie);
    const listedText = await listed.text();
    expect(listed.status).toBe(200);
    expect(listedText).not.toContain(apiKey);
    expect(listedText).not.toContain("ciphertext");
    const listedPayload = JSON.parse(listedText);
    expect(listedPayload.masterKeyReady).toBe(true);
    expect(listedPayload.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ apiKeyRef, source: "managed", status: "configured" }),
    ]));

    const replaced = await putRouteSecret(cookie, apiKeyRef, apiKey, createdPayload.item.revision);
    const replacedPayload = await replaced.json() as any;
    expect(replaced.status, JSON.stringify(replacedPayload)).toBe(200);
    const secondRaw = await env.CHAT_STORE.get(storageKey);
    expect(secondRaw).toBeTruthy();
    expect(secondRaw).not.toBe(firstRaw);
    const secondRecord = JSON.parse(secondRaw!);
    expect(secondRecord.iv).not.toBe(firstRecord.iv);
    expect(secondRecord.ciphertext).not.toBe(firstRecord.ciphertext);

    const stale = await putRouteSecret(cookie, apiKeyRef, "stale-test-value", createdPayload.item.revision);
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({ error: "route_secret_conflict" });
    await expect(env.CHAT_STORE.get(storageKey)).resolves.toBe(secondRaw);

    const fromBase64 = (value: string) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
    const decrypt = (keyBytes: Uint8Array, additionalData: string) => crypto.subtle.importKey(
      "raw",
      keyBytes,
      { name: "AES-GCM" },
      false,
      ["decrypt"],
    ).then((key) => crypto.subtle.decrypt({
      name: "AES-GCM",
      iv: fromBase64(secondRecord.iv),
      additionalData: new TextEncoder().encode(additionalData),
    }, key, fromBase64(secondRecord.ciphertext)));
    await expect(decrypt(new Uint8Array(32).fill(9), `chatus:route-secret:v1:${apiKeyRef}`)).rejects.toBeTruthy();
    await expect(decrypt(
      Uint8Array.from({ length: 32 }, (_, index) => index),
      "chatus:route-secret:v1:DIFFERENT_TEST_KEY",
    )).rejects.toBeTruthy();

    const removed = await apiRequest(`/api/admin/route-secrets/${apiKeyRef}`, cookie, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRevision: replacedPayload.item.revision }),
    });
    expect(removed.status).toBe(200);
    await expect(env.CHAT_STORE.get(storageKey)).resolves.toBeNull();
    const audit = await apiRequest("/api/admin/audit", cookie).then((response) => response.json()) as any;
    expect(audit.entries.slice(0, 3)).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "route-secret.update", target: apiKeyRef }),
      expect.objectContaining({ action: "route-secret.delete", target: apiKeyRef }),
    ]));
    expect(JSON.stringify(audit)).not.toContain(apiKey);
  });

  it("migrates legacy routes server-side with credential preflight, atomicity and idempotence", async () => {
    const adminCookie = await adminLogin();
    const managedKey = "managed-migration-secret";
    const managedRef = "MIGRATION_MANAGED_KEY";
    expect((await putRouteSecret(adminCookie, managedRef, managedKey)).status).toBe(200);
    const inlineOnly = `inline-only-${crypto.randomUUID()}`;
    const hiddenHeader = `header-${crypto.randomUUID()}`;
    const initialConfig: any = {
      providers: {
        "managed-provider": {
          label: "Existing provider",
          type: "openai-chat",
          baseUrl: "https://existing.example/v1",
        },
        "managed-provider-2": {
          label: "Existing provider collision",
          type: "openai-chat",
          baseUrl: "https://existing-2.example/v1",
        },
      },
      routes: {
        managed: {
          enabled: true,
          label: "Managed legacy",
          type: "openai-chat",
          baseUrl: "https://managed.example/v1",
          model: "managed-model",
          apiKey: "legacy-shadow-that-must-not-be-used",
          apiKeyRef: managedRef,
          authHeader: "X-Provider-Key",
          authPrefix: "Token ",
          directEndpoint: true,
          headers: { "X-Internal-Header": hiddenHeader },
          fallbacks: ["worker"],
          maxTokens: 321,
          temperature: 0.2,
          supportsImages: false,
          supportsTools: true,
        },
        worker: {
          enabled: false,
          label: "Worker legacy",
          type: "openai-chat",
          baseUrl: "https://worker.example/v1",
          model: "worker-model",
          apiKeyRef: "TEST_ROUTE_KEY",
        },
        byok: {
          label: "BYOK legacy",
          type: "anthropic-messages",
          baseUrl: "https://byok.example/v1",
          model: "byok-model",
          requiresUserKey: true,
          allowUserKey: true,
        },
        inline: {
          label: "Inline only",
          type: "openai-chat",
          baseUrl: "https://inline.example/v1",
          model: "inline-model",
          apiKey: inlineOnly,
        },
        modern: {
          label: "Already provider-backed",
          offerings: [{ providerId: "managed-provider", model: "modern-model" }],
        },
        mixed: {
          enabled: true,
          label: "Provider-backed with legacy shadow",
          offerings: [{ providerId: "managed-provider", model: "modern-model", enabled: true }],
          type: "anthropic-messages",
          baseUrl: "https://stale-shadow.example/v1",
          model: "stale-shadow-model",
          apiKey: `stale-${inlineOnly}`,
          apiKeyRef: "STALE_SHADOW_KEY",
          authHeader: "X-Stale-Key",
          authPrefix: "Stale ",
          directEndpoint: true,
          headers: { "X-Stale-Header": hiddenHeader },
          fallbacks: ["managed"],
          maxTokens: 777,
        },
        invalidContract: {
          label: "Invalid BYOK contract",
          type: "openai-chat",
          baseUrl: "https://invalid.example/v1",
          model: "invalid-model",
          requiresUserKey: true,
          allowUserKey: false,
        },
      },
      defaults: { defaultRoute: "managed", allowedRoutes: ["managed", "worker", "byok", "inline", "mixed"] },
      users: { alice: { defaultRoute: "worker", allowedRoutes: ["worker", "managed"] } },
      publicAccess: { enabled: true, routeId: "managed", sessionTtlSeconds: 900, dailyMessageLimit: 10, minuteMessageLimit: 2, sourceDailyMessageLimit: 10, sourceMinuteMessageLimit: 2 },
    };
    const managedRuntimeBefore = resolveProviderRouteCandidates(
      "managed",
      initialConfig.routes.managed,
      initialConfig.providers,
    )[0];
    const mixedOfferingBefore = structuredClone(initialConfig.routes.mixed.offerings);
    const providerCountBefore = Object.keys(initialConfig.providers).length;
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify(initialConfig));

    const unauthenticated = await exports.default.fetch(new Request("https://example.test/api/admin/legacy-routes/migrate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ routeIds: ["managed"], expectedRevision: "x" }),
    }));
    expect(unauthenticated.status).toBe(401);

    const missingRevision = await apiRequest("/api/admin/legacy-routes/migrate", adminCookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ routeIds: ["managed"] }),
    });
    expect(missingRevision.status).toBe(400);
    await expect(missingRevision.json()).resolves.toMatchObject({ error: "expected_config_revision_required" });

    const initialResponse = await apiRequest("/api/admin/config", adminCookie);
    const initial = await initialResponse.json() as any;
    const rawBefore = await env.CHAT_STORE.get(ROUTES_CONFIG_KEY);
    const stale = await apiRequest("/api/admin/legacy-routes/migrate", adminCookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ routeIds: ["missing-route"], expectedRevision: "0".repeat(64) }),
    });
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({ error: "config_conflict" });

    const blocked = await apiRequest("/api/admin/legacy-routes/migrate", adminCookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ routeIds: ["inline", "missing-route", "modern", "invalidContract", "managed", "inline"], expectedRevision: initial.revision }),
    });
    const blockedText = await blocked.text();
    expect(blocked.status, blockedText).toBe(422);
    expect(blockedText).not.toContain(managedKey);
    expect(blockedText).not.toContain(hiddenHeader);
    expect(blockedText).not.toContain(inlineOnly);
    expect(blockedText).toContain("inline_credential_only");
    expect(blockedText).toContain("invalid_credential_contract");
    const blockedPayload = JSON.parse(blockedText) as any;
    expect(blockedPayload.statuses).toEqual(expect.arrayContaining([
      { routeId: "inline", status: "blocked", reason: "inline_credential_only" },
      { routeId: "invalidContract", status: "blocked", reason: "invalid_credential_contract" },
      { routeId: "managed", status: "ready" },
      { routeId: "missing-route", status: "missing" },
      { routeId: "modern", status: "already_migrated" },
    ]));
    await expect(env.CHAT_STORE.get(ROUTES_CONFIG_KEY)).resolves.toBe(rawBefore);

    const migration = await apiRequest("/api/admin/legacy-routes/migrate", adminCookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ routeIds: ["byok", "worker", "managed", "mixed"], expectedRevision: initial.revision }),
    });
    const migrationText = await migration.text();
    expect(migration.status, migrationText).toBe(200);
    expect(migrationText).not.toContain(managedKey);
    expect(migrationText).not.toContain(hiddenHeader);
    expect(migrationText).not.toContain(managedRef);
    expect(migrationText).not.toContain("X-Internal-Header");
    expect(migrationText).not.toContain("https://");
    expect(migrationText).toContain("managed");
    const migrated = JSON.parse(migrationText) as any;
    expect(isAdminLegacyRouteMigrationResponse(migrated)).toBe(true);
    expect(migrated.migrated).toEqual(["byok", "managed", "mixed", "worker"]);
    const stored = await env.CHAT_STORE.get(ROUTES_CONFIG_KEY, "json") as any;
    expect(stored.routes.managed).toMatchObject({
      enabled: true,
      label: "Managed legacy",
      fallbacks: ["worker"],
      maxTokens: 321,
      temperature: 0.2,
      supportsImages: false,
      supportsTools: true,
    });
    expect(stored.routes.managed).not.toHaveProperty("type");
    expect(stored.routes.managed).not.toHaveProperty("baseUrl");
    expect(stored.routes.managed).not.toHaveProperty("model");
    expect(stored.routes.managed).not.toHaveProperty("apiKey");
    expect(stored.routes.managed).not.toHaveProperty("headers");
    expect(stored.defaults.allowedRoutes).toEqual(["managed", "worker", "byok", "inline", "mixed"]);
    expect(stored.users.alice.allowedRoutes).toEqual(["worker", "managed"]);
    expect(stored.publicAccess.routeId).toBe("managed");
    const managedProviderId = stored.routes.managed.offerings[0].providerId;
    expect(managedProviderId).toBe("managed-provider-3");
    expect(stored.providers[managedProviderId]).toMatchObject({
      type: "openai-chat",
      baseUrl: "https://managed.example/v1",
      apiKeyRef: managedRef,
      authHeader: "X-Provider-Key",
      authPrefix: "Token ",
      directEndpoint: true,
      headers: { "X-Internal-Header": hiddenHeader },
    });
    expect(stored.routes.mixed.offerings).toEqual(mixedOfferingBefore);
    for (const key of ["type", "baseUrl", "model", "apiKey", "apiKeyRef", "authHeader", "authPrefix", "directEndpoint", "headers"]) {
      expect(stored.routes.mixed).not.toHaveProperty(key);
    }
    expect(stored.routes.mixed).toMatchObject({
      enabled: true,
      label: "Provider-backed with legacy shadow",
      fallbacks: ["managed"],
      maxTokens: 777,
    });
    expect(stored.providers).not.toHaveProperty("mixed-provider");
    expect(Object.keys(stored.providers)).toHaveLength(providerCountBefore + 3);
    expect(stored.routes.worker.enabled).toBe(false);
    expect(stored.providers[stored.routes.worker.offerings[0].providerId]).toMatchObject({ enabled: true, apiKeyRef: "TEST_ROUTE_KEY" });
    expect(stored.providers[stored.routes.byok.offerings[0].providerId]).toMatchObject({ requiresUserKey: true });

    const managedRuntimeAfter = resolveProviderRouteCandidates("managed", stored.routes.managed, stored.providers)[0];
    const runtimeShape = (candidate: any) => ({
      label: candidate.label,
      type: candidate.type,
      baseUrl: candidate.baseUrl,
      model: candidate.model,
      apiKeyRef: candidate.apiKeyRef,
      authHeader: candidate.authHeader,
      authPrefix: candidate.authPrefix,
      directEndpoint: candidate.directEndpoint,
      headers: candidate.headers,
      maxTokens: candidate.maxTokens,
      temperature: candidate.temperature,
      allowUserKey: candidate.allowUserKey,
      requiresUserKey: candidate.requiresUserKey,
      supportsImages: candidate.supportsImages,
      supportsTools: candidate.supportsTools,
      concurrency: candidate.concurrency,
      maxConcurrent: candidate.maxConcurrent,
      queueTimeoutMs: candidate.queueTimeoutMs,
      priority: candidate.priority,
    });
    expect(runtimeShape(managedRuntimeAfter)).toEqual(runtimeShape(managedRuntimeBefore));
    expect(managedRuntimeAfter.providerId).toBe(managedProviderId);
    expect(managedRuntimeAfter.providerId).not.toBe(managedRuntimeBefore.providerId);

    const afterSnapshot = await apiRequest("/api/admin/config", adminCookie).then((response) => response.json()) as any;
    expect(migrated.revision).toBe(afterSnapshot.revision);

    const second = await apiRequest("/api/admin/legacy-routes/migrate", adminCookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ routeIds: ["managed", "worker", "byok", "mixed"], expectedRevision: migrated.revision }),
    });
    const secondPayload = await second.json() as any;
    expect(second.status, JSON.stringify(secondPayload)).toBe(200);
    expect(secondPayload.migrated).toEqual([]);
    expect(secondPayload.alreadyMigrated).toEqual(["byok", "managed", "mixed", "worker"]);
    expect(await env.CHAT_STORE.get(ROUTES_CONFIG_KEY, "json")).toEqual(stored);
  });

  it("serializes concurrent configuration mutations against one revision", async () => {
    const adminCookie = await adminLogin();
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      providers: {},
      routes: {
        first: {
          label: "First legacy",
          type: "openai-chat",
          baseUrl: "https://first.example/v1",
          model: "first-model",
          requiresUserKey: true,
          allowUserKey: true,
        },
        second: {
          label: "Second legacy",
          type: "openai-chat",
          baseUrl: "https://second.example/v1",
          model: "second-model",
          requiresUserKey: true,
          allowUserKey: true,
        },
      },
      defaults: { defaultRoute: "first", allowedRoutes: ["first", "second"] },
    }));
    const snapshot = await apiRequest("/api/admin/config", adminCookie).then((response) => response.json()) as any;
    const mutate = (routeId: string) => apiRequest("/api/admin/legacy-routes/migrate", adminCookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ routeIds: [routeId], expectedRevision: snapshot.revision }),
    });

    const responses = await Promise.all([mutate("first"), mutate("second")]);
    const payloads = await Promise.all(responses.map((response) => response.json() as Promise<any>));
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const successfulIndex = responses.findIndex((response) => response.status === 200);
    const rejectedIndex = successfulIndex === 0 ? 1 : 0;
    const migratedRouteId = payloads[successfulIndex].migrated[0] as "first" | "second";
    const rejectedRouteId = migratedRouteId === "first" ? "second" : "first";
    expect(payloads[rejectedIndex].error).toMatch(/^config_(?:conflict|mutation_busy)$/);

    const stored = await env.CHAT_STORE.get(ROUTES_CONFIG_KEY, "json") as any;
    expect(stored.routes[migratedRouteId].offerings).toHaveLength(1);
    expect(stored.routes[migratedRouteId]).not.toHaveProperty("baseUrl");
    expect(stored.routes[rejectedRouteId]).toMatchObject({
      type: "openai-chat",
      baseUrl: `https://${rejectedRouteId}.example/v1`,
      model: `${rejectedRouteId}-model`,
    });
  });

  it("preserves malformed stored configuration while serving the fallback", async () => {
    const adminCookie = await adminLogin();
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, "{");

    const response = await apiRequest("/api/admin/config", adminCookie);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ source: "default" });
    await expect(env.CHAT_STORE.get(ROUTES_CONFIG_KEY)).resolves.toBe("{");
  });

  it("isolates MCP secrets in their own encrypted namespace", async () => {
    const cookie = await adminLogin();
    const secretRef = "TEST_ROUTE_KEY";
    const secret = " managed-mcp-secret-value ";
    const created = await apiRequest(`/api/admin/mcp-secrets/${secretRef}`, cookie, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret }),
    });
    const createdPayload = await created.json() as any;
    expect(created.status, JSON.stringify(createdPayload)).toBe(200);
    expect(createdPayload.item).toMatchObject({
      secretRef,
      source: "managed",
      status: "configured",
      managed: true,
      environmentFallback: true,
    });
    expect(JSON.stringify(createdPayload)).not.toContain(secret);
    expect(JSON.stringify(createdPayload)).not.toContain("ciphertext");

    const storageKey = `${MCP_SECRET_PREFIX}${secretRef}`;
    const raw = await env.CHAT_STORE.get(storageKey);
    expect(raw).toBeTruthy();
    expect(raw).not.toContain(secret);
    const record = JSON.parse(raw!);
    const fromBase64 = (value: string) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
    const key = await crypto.subtle.importKey(
      "raw",
      Uint8Array.from({ length: 32 }, (_, index) => index),
      { name: "AES-GCM" },
      false,
      ["decrypt"],
    );
    const decrypt = (aad: string) => crypto.subtle.decrypt({
      name: "AES-GCM",
      iv: fromBase64(record.iv),
      additionalData: new TextEncoder().encode(aad),
    }, key, fromBase64(record.ciphertext));
    const plaintext = await decrypt(`chatus:mcp-secret:v1:${secretRef}`);
    expect(new TextDecoder().decode(plaintext)).toBe(secret);
    await expect(decrypt(`chatus:route-secret:v1:${secretRef}`)).rejects.toBeTruthy();

    const listedText = await apiRequest("/api/admin/mcp-secrets", cookie).then((response) => response.text());
    expect(listedText).not.toContain(secret);
    expect(listedText).not.toContain("ciphertext");
    expect(JSON.parse(listedText).items).toEqual(expect.arrayContaining([
      expect.objectContaining({ secretRef, source: "managed", environmentFallback: true }),
    ]));

    const rotated = await apiRequest(`/api/admin/mcp-secrets/${secretRef}`, cookie, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: "rotated-mcp-secret", expectedRevision: createdPayload.item.revision }),
    });
    const rotatedPayload = await rotated.json() as any;
    expect(rotated.status).toBe(200);
    const stale = await apiRequest(`/api/admin/mcp-secrets/${secretRef}`, cookie, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRevision: createdPayload.item.revision }),
    });
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({ error: "mcp_secret_conflict" });

    const removed = await apiRequest(`/api/admin/mcp-secrets/${secretRef}`, cookie, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRevision: rotatedPayload.item.revision }),
    });
    expect(removed.status).toBe(200);
    await expect(removed.json()).resolves.toMatchObject({
      item: { secretRef, source: "worker", managed: false, environmentFallback: true },
    });
    await expect(env.CHAT_STORE.get(storageKey)).resolves.toBeNull();
    const audit = await apiRequest("/api/admin/audit", cookie).then((response) => response.json()) as any;
    expect(audit.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "mcp-secret.update", target: secretRef }),
      expect.objectContaining({ action: "mcp-secret.delete", target: secretRef }),
    ]));
    expect(JSON.stringify(audit)).not.toContain(secret);
  });

  it("discovers bounded governed MCP tools using saved secret references", async () => {
    const cookie = await adminLogin();
    expect((await apiRequest("/api/admin/mcp-secrets/MCP_DISCOVERY_KEY", cookie, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: "mcp-discovery-secret" }),
    })).status).toBe(200);
    const seenHeaders: Headers[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
      if (url.origin === "https://mcp-failure.example") {
        return new Response(`PRIVATE_MCP_DISCOVERY_BODY_${url.pathname}`, { status: 500 });
      }
      expect(url.origin).toBe("https://mcp-discovery.example");
      seenHeaders.push(new Headers(init?.headers));
      if (init?.method === "DELETE") return new Response(null, { status: 405 });
      const payload = JSON.parse(String(init?.body));
      if (payload.method === "initialize") {
        return new Response(JSON.stringify({
          jsonrpc: "2.0",
          id: payload.id,
          result: {
            protocolVersion: payload.params.protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: "fixture", version: "1.0.0" },
          },
        }), { headers: { "Content-Type": "application/json" } });
      }
      if (payload.method === "notifications/initialized") return new Response(null, { status: 202 });
      if (payload.method === "tools/list") {
        return new Response(JSON.stringify({
          jsonrpc: "2.0",
          id: payload.id,
          result: {
            tools: [
              {
                name: "lookup",
                title: "Lookup",
                description: "Find public information",
                inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
                annotations: { readOnlyHint: true, destructiveHint: false },
                execution: { taskSupport: "forbidden" },
              },
              {
                name: "delete_item",
                inputSchema: { type: "object", properties: {} },
                annotations: { readOnlyHint: false, destructiveHint: true },
              },
              {
                name: "slow_task",
                inputSchema: { type: "object", properties: {} },
                annotations: { readOnlyHint: true },
                execution: { taskSupport: "required" },
              },
            ],
          },
        }), { headers: { "Content-Type": "application/json" } });
      }
      throw new Error(`unexpected MCP method ${payload.method}`);
    });
    const response = await apiRequest("/api/admin/mcp-discovery", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        serverId: "fixture",
        label: "Fixture",
        endpoint: "https://mcp-discovery.example/rpc",
        authType: "bearer",
        secretRef: "MCP_DISCOVERY_KEY",
      }),
    });
    const payload = await response.json() as any;
    expect(response.status, JSON.stringify(payload)).toBe(200);
    expect(payload).toMatchObject({
      serverId: "fixture",
      rejected: 1,
      tools: [
        {
          id: "mcp:fixture:lookup",
          label: "Lookup",
          confirmation: "first-per-conversation",
          sideEffect: "read",
          reviewRequired: true,
          executor: { type: "mcp", serverId: "fixture", remoteName: "lookup" },
        },
        {
          id: "mcp:fixture:delete_item",
          confirmation: "always",
          sideEffect: "destructive",
          reviewRequired: true,
        },
      ],
    });
    expect(payload.tools[0].schemaFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(payload.tools[0].securityFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(payload.tools[0].reviewRevision).toMatch(/^[a-f0-9]{64}$/);
    expect(seenHeaders.some((headers) => headers.get("Authorization") === "Bearer mcp-discovery-secret")).toBe(true);
    expect(JSON.stringify(payload)).not.toContain("mcp-discovery-secret");
    expect(JSON.stringify(payload)).not.toContain("mcp-discovery.example");

    const failedServerId = "private-failure-server";
    const failed = await apiRequest("/api/admin/mcp-discovery", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        serverId: failedServerId,
        endpoint: "https://mcp-failure.example/private-rpc",
        authType: "none",
      }),
    });
    const failedText = await failed.text();
    expect(failed.status, failedText).toBe(502);
    expect(JSON.parse(failedText)).toEqual({
      error: "mcp_protocol_error",
      message: "MCP 服务返回了无法识别的响应，请稍后重试或联系管理员。",
    });
    expect(failedText).not.toContain(failedServerId);
    expect(failedText).not.toContain("mcp-failure.example");
    expect(failedText).not.toContain("PRIVATE_MCP_DISCOVERY_BODY");

    const unsafe = await apiRequest("/api/admin/mcp-discovery", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        serverId: "unsafe",
        endpoint: "https://127.0.0.1/rpc",
        authType: "none",
      }),
    });
    expect(unsafe.status).toBe(400);
    await expect(unsafe.json()).resolves.toMatchObject({ error: "mcp_endpoint_invalid" });
  });

  it("projects persisted MCP drift as disabled until an explicit revisioned review", async () => {
    const cookie = await adminLogin();
    const snapshot = await apiRequest("/api/admin/config", cookie).then((response) => response.json()) as any;
    const reviewRevision = "d".repeat(64);
    snapshot.config.mcpServers = {
      fixture: {
        enabled: true,
        label: "Fixture",
        endpoint: "https://drift.example/rpc",
        auth: { version: 1, type: "none" },
      },
    };
    snapshot.config.tools = {
      ...snapshot.config.tools,
      "mcp:fixture:lookup": {
        enabled: true,
        label: "Lookup",
        inputSchema: { type: "object", properties: { query: { type: "string" } } },
        confirmation: "first-per-conversation",
        executor: { type: "mcp", serverId: "fixture", remoteName: "lookup" },
        schemaFingerprint: "a".repeat(64),
        securityFingerprint: "b".repeat(64),
        sideEffect: "read",
        reviewRevision,
        reviewRequired: false,
      },
    };
    const savedResponse = await apiRequest("/api/admin/config", cookie, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: snapshot.config, expectedRevision: snapshot.revision }),
    });
    expect(savedResponse.status).toBe(200);

    await env.CHAT_STORE.put("config:mcp_tool_drift", JSON.stringify({
      version: 1,
      tools: {
        "mcp:fixture:lookup": { reviewRevision, observedAt: "2026-08-01T12:00:00.000Z" },
      },
    }));
    const drifted = await apiRequest("/api/admin/config", cookie).then((response) => response.json()) as any;
    expect(drifted.config.tools["mcp:fixture:lookup"]).toMatchObject({
      enabled: false,
      reviewRequired: true,
      reviewRevision,
    });
    expect(JSON.stringify(await env.CHAT_STORE.get("config:mcp_tool_drift"))).not.toContain("drift.example");

    drifted.config.tools["mcp:fixture:lookup"].enabled = true;
    drifted.config.tools["mcp:fixture:lookup"].reviewRequired = false;
    const reviewedResponse = await apiRequest("/api/admin/config", cookie, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: drifted.config, expectedRevision: drifted.revision }),
    });
    expect(reviewedResponse.status).toBe(200);
    await expect(env.CHAT_STORE.get("config:mcp_tool_drift")).resolves.toBeNull();
    const reviewed = await reviewedResponse.json() as any;
    expect(reviewed.config.tools["mcp:fixture:lookup"]).toMatchObject({ enabled: true, reviewRequired: false });

    await env.CHAT_STORE.put("config:mcp_tool_drift", JSON.stringify({
      version: 1,
      tools: { "mcp:fixture:lookup": { reviewRevision, observedAt: "not-a-date", endpoint: "https://forbidden.example" } },
    }));
    const malformed = await apiRequest("/api/admin/config", cookie).then((response) => response.json()) as any;
    expect(malformed.config.tools["mcp:fixture:lookup"]).toMatchObject({ enabled: true, reviewRequired: false });
    expect(JSON.stringify(malformed)).not.toContain("forbidden.example");
  });

  it("round-trips incomplete legacy MCP tools as disabled review-only config", async () => {
    const cookie = await adminLogin();
    const baseline = await apiRequest("/api/admin/config", cookie).then((response) => response.json()) as any;
    const providerKey = `combined-legacy-key-${crypto.randomUUID()}`;
    const providerHeader = `combined-legacy-header-${crypto.randomUUID()}`;
    baseline.config.providers.legacyCapacity = {
      enabled: true,
      label: "Legacy capacity",
      type: "openai-chat",
      baseUrl: "https://legacy-provider.example/v1",
      apiKey: providerKey,
      apiKeyRef: " LEGACY_CAPACITY_KEY ",
      authHeader: " ",
      headers: { "X-Legacy-Header": providerHeader },
      concurrency: "bounded",
      maxConcurrent: "100.5",
      queueTimeoutMs: "10001",
    };
    baseline.config.routes.backup = {
      ...structuredClone(baseline.config.routes.default),
      label: "Backup",
      fallbacks: [],
    };
    baseline.config.routes.default.fallbacks = ["backup", "backup"];
    baseline.config.routes.default.maxTokens = "2048";
    baseline.config.defaults.dailyMessageLimit = "321";
    baseline.config.defaults.minuteMessageLimit = 1.5;
    baseline.config.mcpServers = {
      legacy: {
        enabled: true,
        label: "Legacy MCP",
        endpoint: "http://legacy-mcp.example/rpc",
        auth: {
          version: 1,
          type: "oauth2",
          issuer: "https://issuer.example",
          clientId: "legacy-client",
          scopes: [],
          callbackPath: "/api/mcp/oauth/callback",
        },
      },
    };
    baseline.config.tools = {
      ...baseline.config.tools,
      "mcp:legacy:lookup": {
        enabled: true,
        label: "Legacy lookup",
        description: "Persisted before MCP governance fields were introduced.",
        inputSchema: { type: "object", properties: { query: { type: "string" } } },
        confirmation: "first-per-conversation",
        executor: { type: "mcp", serverId: "legacy", remoteName: "lookup" },
      },
    };
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify(baseline.config));

    const projectedResponse = await apiRequest("/api/admin/config", cookie);
    const projected = await projectedResponse.json() as any;
    expect(projectedResponse.status).toBe(200);
    expect(isAdminConfigSnapshot(projected)).toBe(true);
    expect(projected.config.tools["builtin:text_stats"]).not.toHaveProperty("reviewRequired");
    expect(projected.config.routes.default).toMatchObject({ fallbacks: ["backup"], maxTokens: 2048 });
    expect(projected.config.defaults.dailyMessageLimit).toBe(321);
    expect(projected.config.defaults).not.toHaveProperty("minuteMessageLimit");
    expect(projected.config.providers.legacyCapacity).toMatchObject({
      apiKeyRef: "LEGACY_CAPACITY_KEY",
      concurrency: "bounded",
      maxConcurrent: 1,
      hasLegacyKey: true,
      hasCustomHeaders: true,
    });
    expect(projected.config.providers.legacyCapacity).not.toHaveProperty("apiKey");
    expect(projected.config.providers.legacyCapacity).not.toHaveProperty("headers");
    expect(projected.config.providers.legacyCapacity).not.toHaveProperty("authHeader");
    expect(projected.config.providers.legacyCapacity).not.toHaveProperty("queueTimeoutMs");
    expect(projected.config.mcpServers.legacy).toMatchObject({
      enabled: false,
      endpoint: "http://legacy-mcp.example/rpc",
      auth: { version: 1, type: "oauth2", scopes: [] },
    });
    expect(projected.config.mcpServers.legacy.auth.configRevision).toMatch(/^[a-f0-9]{64}$/);
    const projectedText = JSON.stringify(projected);
    expect(projectedText).not.toContain(providerKey);
    expect(projectedText).not.toContain(providerHeader);
    expect(projected.config.tools["mcp:legacy:lookup"]).toMatchObject({
      enabled: false,
      label: "Legacy lookup",
      confirmation: "first-per-conversation",
      executor: { type: "mcp", serverId: "legacy", remoteName: "lookup" },
      reviewRequired: true,
    });
    for (const field of ["schemaFingerprint", "securityFingerprint", "sideEffect", "reviewRevision"]) {
      expect(projected.config.tools["mcp:legacy:lookup"]).not.toHaveProperty(field);
    }

    const unsafeConfig = structuredClone(projected.config);
    unsafeConfig.mcpServers.legacy.enabled = true;
    const unsafeResponse = await apiRequest("/api/admin/config", cookie, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: unsafeConfig, expectedRevision: projected.revision }),
    });
    expect(unsafeResponse.status).toBe(400);
    await expect(unsafeResponse.json()).resolves.toMatchObject({ error: "invalid_config" });

    projected.config.defaults.dailyMessageLimit = 322;
    const savedResponse = await apiRequest("/api/admin/config", cookie, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: projected.config, expectedRevision: projected.revision }),
    });
    const saved = await savedResponse.json() as any;
    expect(savedResponse.status, JSON.stringify(saved)).toBe(200);
    expect(isAdminConfigSnapshot(saved)).toBe(true);
    expect(saved.config.defaults.dailyMessageLimit).toBe(322);
    expect(saved.config.tools["mcp:legacy:lookup"]).toMatchObject({ enabled: false, reviewRequired: true });
    expect(saved.config.mcpServers.legacy).toMatchObject({ enabled: false, auth: { type: "oauth2", scopes: [] } });
    const stored = await env.CHAT_STORE.get(ROUTES_CONFIG_KEY, "json") as any;
    expect(stored.providers.legacyCapacity.apiKey).toBe(providerKey);
    expect(stored.providers.legacyCapacity.headers).toEqual({ "X-Legacy-Header": providerHeader });

    const reloaded = await apiRequest("/api/admin/config", cookie).then((response) => response.json()) as any;
    expect(reloaded.config.tools["mcp:legacy:lookup"]).toMatchObject({
      enabled: false,
      label: "Legacy lookup",
      reviewRequired: true,
    });
    expect(isAdminConfigSnapshot(reloaded)).toBe(true);
    expect(reloaded.config.defaults.dailyMessageLimit).toBe(322);
  });

  it("keeps the member OAuth PKCE and encrypted token lifecycle server-side", async () => {
    const adminCookie = await adminLogin();
    const snapshotResponse = await apiRequest("/api/admin/config", adminCookie);
    const snapshot = await snapshotResponse.json() as any;
    snapshot.config.mcpServers = {
      oauth: {
        enabled: true,
        label: "OAuth tools",
        endpoint: "https://oauth-mcp.example/rpc",
        auth: {
          version: 1,
          type: "oauth2",
          issuer: "https://issuer.example",
          clientId: "chatus-worker-test",
          scopes: ["profile", "tools.read"],
          callbackPath: "/api/mcp/oauth/callback",
        },
      },
    };
    const savedResponse = await apiRequest("/api/admin/config", adminCookie, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: snapshot.config, expectedRevision: snapshot.revision }),
    });
    const saved = await savedResponse.json() as any;
    expect(savedResponse.status, JSON.stringify(saved)).toBe(200);
    expect(saved.config.mcpServers.oauth.auth).toMatchObject({
      version: 1,
      type: "oauth2",
      callbackPath: "/api/mcp/oauth/callback",
    });
    expect(saved.config.mcpServers.oauth.auth.configRevision).toMatch(/^[a-f0-9]{64}$/);

    let tokenCalls = 0;
    let mcpRemoteCalls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
      if (url.origin === "https://oauth-mcp.example") {
        expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer worker-oauth-access");
        if (init?.method === "DELETE") return new Response(null, { status: 405 });
        const payload = JSON.parse(String(init?.body));
        mcpRemoteCalls += 1;
        if (payload.method === "initialize") {
          return new Response(JSON.stringify({
            jsonrpc: "2.0",
            id: payload.id,
            result: {
              protocolVersion: payload.params.protocolVersion,
              capabilities: { tools: {} },
              serverInfo: { name: "oauth-fixture", version: "1.0.0" },
            },
          }), { headers: { "Content-Type": "application/json" } });
        }
        if (payload.method === "notifications/initialized") return new Response(null, { status: 202 });
        if (payload.method === "tools/list") {
          return new Response(JSON.stringify({
            jsonrpc: "2.0",
            id: payload.id,
            result: { tools: [{
              name: "lookup",
              title: "Lookup",
              description: "Find public information",
              inputSchema: { type: "object", properties: { query: { type: "string" } } },
              annotations: { readOnlyHint: true, destructiveHint: false },
              execution: { taskSupport: "forbidden" },
            }] },
          }), { headers: { "Content-Type": "application/json" } });
        }
        throw new Error(`unexpected OAuth MCP method ${payload.method}`);
      }
      if (url.pathname.startsWith("/.well-known/")) {
        return new Response(JSON.stringify({
          issuer: "https://issuer.example",
          authorization_endpoint: "https://issuer.example/authorize",
          token_endpoint: "https://issuer.example/token",
          code_challenge_methods_supported: ["S256"],
        }), { headers: { "Content-Type": "application/json" } });
      }
      expect(url.toString()).toBe("https://issuer.example/token");
      tokenCalls += 1;
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("grant_type")).toBe("authorization_code");
      expect(body.get("code")).toBe("fixture-code");
      expect(body.get("redirect_uri")).toBe("https://example.test/api/mcp/oauth/callback");
      expect(body.get("code_verifier")).toMatch(/^[A-Za-z0-9_-]{43}$/);
      return new Response(JSON.stringify({
        access_token: "worker-oauth-access",
        refresh_token: "worker-oauth-refresh",
        token_type: "Bearer",
        expires_in: 3600,
        scope: "profile tools.read",
      }), { headers: { "Content-Type": "application/json" } });
    });

    const member = await login(`oauth-member-${crypto.randomUUID()}`);
    const before = await apiRequest("/api/session", member.cookie).then((response) => response.json()) as any;
    expect(before.mcpConnections).toEqual([expect.objectContaining({
      serverId: "oauth",
      label: "OAuth tools",
      connected: false,
      status: "disconnected",
      grantedScopes: [],
    })]);
    expect(JSON.stringify(before)).not.toContain("issuer.example");
    expect(JSON.stringify(before)).not.toContain("oauth-mcp.example");

    const startResponse = await apiRequest("/api/mcp/oauth/start", member.cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serverId: "oauth" }),
    });
    const start = await startResponse.json() as any;
    expect(startResponse.status, JSON.stringify(start)).toBe(200);
    const authorizationUrl = new URL(start.authorizationUrl);
    expect(authorizationUrl.origin).toBe("https://issuer.example");
    expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe("https://example.test/api/mcp/oauth/callback");
    const state = authorizationUrl.searchParams.get("state");
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const callback = await apiRequest(
      `/api/mcp/oauth/callback?state=${encodeURIComponent(state)}&code=fixture-code`,
      member.cookie,
      { redirect: "manual" },
    );
    expect(callback.status).toBe(303);
    expect(callback.headers.get("Location")).toBe("https://example.test/react-chat/?mcpOAuth=connected");
    expect(tokenCalls).toBe(1);

    const statusResponse = await apiRequest("/api/mcp/oauth/status", member.cookie);
    const status = await statusResponse.json() as any;
    expect(statusResponse.status).toBe(200);
    expect(status.connections).toEqual([expect.objectContaining({
      serverId: "oauth",
      label: "OAuth tools",
      connected: true,
      reviewRequired: false,
      status: "connected",
      grantedScopes: ["profile", "tools.read"],
    })]);
    expect(JSON.stringify(status)).not.toContain("worker-oauth-access");
    expect(JSON.stringify(status)).not.toContain("worker-oauth-refresh");
    expect(JSON.stringify(status)).not.toContain("issuer.example");

    const memberDiscoveryResponse = await apiRequest("/api/mcp/oauth/discovery", member.cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serverId: "oauth" }),
    });
    const memberDiscovery = await memberDiscoveryResponse.json() as any;
    expect(memberDiscoveryResponse.status, JSON.stringify(memberDiscovery)).toBe(200);
    expect(memberDiscovery).toMatchObject({ serverId: "oauth", tools: 1, rejected: 0 });
    expect(memberDiscovery.candidateId).toMatch(/^[a-f0-9-]{36}$/);
    const remoteCallsAfterMemberDiscovery = mcpRemoteCalls;

    const adminCandidateResponse = await apiRequest("/api/admin/mcp-discovery", adminCookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serverId: "oauth", memberLabel: member.label }),
    });
    const adminCandidate = await adminCandidateResponse.json() as any;
    expect(adminCandidateResponse.status, JSON.stringify(adminCandidate)).toBe(200);
    expect(adminCandidate).toMatchObject({
      serverId: "oauth",
      rejected: 0,
      tools: [{
        id: "mcp:oauth:lookup",
        sideEffect: "read",
        confirmation: "first-per-conversation",
        reviewRequired: true,
      }],
    });
    expect(mcpRemoteCalls).toBe(remoteCallsAfterMemberDiscovery);
    expect(JSON.stringify(memberDiscovery)).not.toContain("worker-oauth-access");
    expect(JSON.stringify(adminCandidate)).not.toContain("worker-oauth-access");
    expect(JSON.stringify(adminCandidate)).not.toContain("issuer.example");
    expect(JSON.stringify(adminCandidate)).not.toContain("oauth-mcp.example");

    const replay = await apiRequest(
      `/api/mcp/oauth/callback?state=${encodeURIComponent(state)}&code=fixture-code`,
      member.cookie,
      { redirect: "manual" },
    );
    expect(replay.status).toBe(303);
    expect(replay.headers.get("Location")).toBe("https://example.test/react-chat/?mcpOAuth=error");
    expect(tokenCalls).toBe(1);

    const userState = env.USER_STATE.getByName(member.label);
    await runInDurableObject(userState, async (_instance, durableState) => {
      const record = durableState.storage.sql.exec<{ encrypted_record: string }>(
        "SELECT encrypted_record FROM mcp_oauth_tokens WHERE server_id = 'oauth'",
      ).one().encrypted_record;
      expect(record).not.toContain("worker-oauth-access");
      expect(record).not.toContain("worker-oauth-refresh");
      const candidate = durableState.storage.sql.exec<{ discovery_json: string }>(
        "SELECT discovery_json FROM mcp_oauth_discovery_candidates WHERE server_id = 'oauth'",
      ).one().discovery_json;
      expect(candidate).not.toContain("worker-oauth-access");
      expect(candidate).not.toContain("worker-oauth-refresh");
      expect(candidate).not.toContain("issuer.example");
    });
    const audit = await apiRequest("/api/admin/audit", adminCookie).then((response) => response.json()) as any;
    expect(JSON.stringify(audit)).not.toContain("worker-oauth-access");
    expect(JSON.stringify(audit)).not.toContain("worker-oauth-refresh");
    expect(JSON.stringify(audit)).not.toContain(member.label);
    expect(audit.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "mcp.oauth.connect", target: "oauth" }),
      expect.objectContaining({ action: "mcp.oauth.discovery", target: "oauth:1/0" }),
    ]));

    const revoke = await apiRequest("/api/mcp/oauth/revoke", member.cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serverId: "oauth" }),
    });
    await expect(revoke.json()).resolves.toEqual({ ok: true, serverId: "oauth" });
    await runInDurableObject(userState, async (_instance, durableState) => {
      expect(durableState.storage.sql.exec<{ count: number }>(
        "SELECT COUNT(*) AS count FROM mcp_oauth_discovery_candidates",
      ).one().count).toBe(0);
    });
    const after = await apiRequest("/api/mcp/oauth/status", member.cookie).then((response) => response.json()) as any;
    expect(after.connections).toEqual([expect.objectContaining({ connected: false, status: "disconnected" })]);
    const revokeAudit = await apiRequest("/api/admin/audit", adminCookie).then((response) => response.json()) as any;
    expect(revokeAudit.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "mcp.oauth.revoke", target: "oauth" }),
    ]));
    expect(JSON.stringify(revokeAudit)).not.toContain(member.label);
  });

  it("continues the same capability stream after MCP approval and remembers conversation trust", async () => {
    const adminCookie = await adminLogin();
    const schema = { type: "object", properties: { query: { type: "string" } }, required: ["query"] };
    let mcpCallCount = 0;
    let destructive = false;
    let mcpFailureMarker = "";
    const providerBodies: any[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
      if (url.origin === "https://approval-mcp.example") {
        if (init?.method === "DELETE") return new Response(null, { status: 405 });
        const payload = JSON.parse(String(init?.body));
        if (payload.method === "initialize") {
          return new Response(JSON.stringify({
            jsonrpc: "2.0",
            id: payload.id,
            result: {
              protocolVersion: payload.params.protocolVersion,
              capabilities: { tools: {} },
              serverInfo: { name: "approval-fixture", version: "1.0.0" },
            },
          }), { headers: { "Content-Type": "application/json" } });
        }
        if (payload.method === "notifications/initialized") return new Response(null, { status: 202 });
        if (payload.method === "tools/list") {
          return new Response(JSON.stringify({
            jsonrpc: "2.0",
            id: payload.id,
            result: { tools: [{
              name: "lookup",
              title: "Lookup",
              inputSchema: schema,
              annotations: { readOnlyHint: !destructive, destructiveHint: destructive },
              execution: { taskSupport: "forbidden" },
            }] },
          }), { headers: { "Content-Type": "application/json" } });
        }
        if (payload.method === "tools/call") {
          mcpCallCount += 1;
          return new Response(JSON.stringify({
            jsonrpc: "2.0",
            id: payload.id,
            result: mcpFailureMarker
              ? { isError: true, content: [{ type: "text", text: mcpFailureMarker }] }
              : { content: [{ type: "text", text: `result:${payload.params.arguments.query}` }] },
          }), { headers: { "Content-Type": "application/json" } });
        }
        throw new Error(`unexpected MCP method ${payload.method}`);
      }
      const body = JSON.parse(String(init?.body));
      providerBodies.push(body);
      const previousToolResult = body.messages.some((message: any) => message.role === "tool");
      if (!previousToolResult) {
        return new Response(JSON.stringify({
          choices: [{
            message: {
              role: "assistant",
              content: null,
              tool_calls: [{
                id: `provider-call-${providerBodies.length}`,
                type: "function",
                function: { name: body.tools[0].function.name, arguments: JSON.stringify({ query: "approved" }) },
              }],
            },
            finish_reason: "tool_calls",
          }],
        }), { headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({
        choices: [{ message: { role: "assistant", content: "远程查询完成" }, finish_reason: "stop" }],
      }), { headers: { "Content-Type": "application/json" } });
    });

    const discovery = await apiRequest("/api/admin/mcp-discovery", adminCookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        serverId: "approval",
        endpoint: "https://approval-mcp.example/rpc",
        authType: "none",
      }),
    }).then((response) => response.json()) as any;
    const discoveredTool = discovery.tools[0];
    expect(discoveredTool.schemaFingerprint).toMatch(/^[a-f0-9]{64}$/);
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      routes: {
        tools: {
          label: "Tools",
          type: "openai-chat",
          baseUrl: "https://approval-provider.example/v1",
          model: "approval-model",
          apiKey: "approval-provider-key",
          supportsTools: true,
        },
      },
      defaults: {
        defaultRoute: "tools",
        allowedRoutes: ["tools"],
        allowedTools: [discoveredTool.id],
      },
      mcpServers: {
        approval: {
          enabled: true,
          label: "Approval",
          endpoint: "https://approval-mcp.example/rpc",
          authType: "none",
        },
      },
      tools: { [discoveredTool.id]: { ...discoveredTool, enabled: true, reviewRequired: false } },
      skills: {
        remote: {
          enabled: true,
          label: "Remote",
          instructions: "Use the remote lookup tool.",
          toolIds: [discoveredTool.id],
        },
      },
    }));
    const member = await login();
    const { cookie } = member;
    const startChat = () => apiRequest("/api/chat", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Chatus-Client": "web" },
      body: JSON.stringify({
        routeId: "tools",
        chatId: "conversation-trust",
        skillIds: ["remote"],
        messages: [{ role: "user", content: "执行远程查询" }],
      }),
    });
    const response = await startChat();
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const received: any[] = [];
    let confirmation: any = null;
    while (!confirmation) {
      const { value, done } = await reader.read();
      expect(done, JSON.stringify(received)).toBe(false);
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() || "";
      for (const frame of frames) {
        const line = frame.split(/\r?\n/).find((entry) => entry.startsWith("data: "));
        if (!line) continue;
        const event = JSON.parse(line.slice(6));
        received.push(event);
        if (event.type === "confirmation_required") confirmation = event;
      }
    }
    expect(mcpCallCount).toBe(0);
    expect(confirmation.event.argumentSummary).not.toContain("approved");
    const approved = await apiRequest("/api/tool-approvals", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Chatus-Client": "web" },
      body: JSON.stringify({
        runId: confirmation.runId,
        callId: confirmation.callId,
        decision: "conversation",
      }),
    });
    expect(approved.status).toBe(200);
    const replay = await apiRequest("/api/tool-approvals", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Chatus-Client": "web" },
      body: JSON.stringify({
        runId: confirmation.runId,
        callId: confirmation.callId,
        decision: "once",
      }),
    });
    expect(replay.status).toBe(409);

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
    }
    for (const frame of buffer.split("\n\n")) {
      const line = frame.split(/\r?\n/).find((entry) => entry.startsWith("data: "));
      if (line) received.push(JSON.parse(line.slice(6)));
    }
    expect(mcpCallCount).toBe(1);
    expect(received).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "tool", event: expect.objectContaining({ status: "approved", confirmation: "conversation" }) }),
      expect.objectContaining({ type: "tool", event: expect.objectContaining({ status: "completed" }) }),
      { type: "assistant_delta", text: "远程查询完成" },
      { type: "done" },
    ]));

    const trustedResponse = await startChat();
    const trustedEvents = await readCapabilityEvents(trustedResponse);
    expect(trustedEvents.some((event) => event.type === "confirmation_required")).toBe(false);
    expect(mcpCallCount).toBe(2);
    expect(trustedEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "tool", event: expect.objectContaining({ status: "approved", confirmation: "conversation" }) }),
      { type: "assistant_delta", text: "远程查询完成" },
    ]));

    mcpFailureMarker = `PRIVATE_MCP_TOOL_RESULT_${crypto.randomUUID()}`;
    const failedEvents = await readCapabilityEvents(await startChat());
    const publicFailure = failedEvents.find((event) => event.type === "error");
    expect(publicFailure).toMatchObject({
      code: "tool_execution_failed",
      message: "工具执行失败，请稍后重试。",
    });
    expect(publicFailure.message).not.toContain(mcpFailureMarker);
    expect(publicFailure.message).not.toContain("approval");
    mcpFailureMarker = "";

    destructive = true;
    const destructiveDiscovery = await apiRequest("/api/admin/mcp-discovery", adminCookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        serverId: "approval",
        endpoint: "https://approval-mcp.example/rpc",
        authType: "none",
      }),
    }).then((item) => item.json()) as any;
    const destructiveTool = destructiveDiscovery.tools[0];
    expect(destructiveTool).toMatchObject({
      id: discoveredTool.id,
      confirmation: "always",
      sideEffect: "destructive",
      reviewRequired: true,
    });
    const destructiveConfig = JSON.parse((await env.CHAT_STORE.get(ROUTES_CONFIG_KEY))!);
    destructiveConfig.tools[destructiveTool.id] = {
      ...destructiveTool,
      enabled: true,
      reviewRequired: false,
    };
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify(destructiveConfig));

    const firstDestructive = await readUntilCapabilityConfirmation(await startChat());
    const callsBeforeApproval = mcpCallCount;
    const invalidConversation = await apiRequest("/api/tool-approvals", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Chatus-Client": "web" },
      body: JSON.stringify({
        runId: firstDestructive.confirmation.runId,
        callId: firstDestructive.confirmation.callId,
        decision: "conversation",
      }),
    });
    expect(invalidConversation.status).toBe(400);
    await expect(invalidConversation.json()).resolves.toEqual({ error: "invalid_tool_approval_decision" });
    expect(mcpCallCount).toBe(callsBeforeApproval);
    const firstOnce = await apiRequest("/api/tool-approvals", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Chatus-Client": "web" },
      body: JSON.stringify({
        runId: firstDestructive.confirmation.runId,
        callId: firstDestructive.confirmation.callId,
        decision: "once",
      }),
    });
    expect(firstOnce.status).toBe(200);
    await drainCapabilityReader(firstDestructive.reader, firstDestructive.decoder, firstDestructive.buffer);
    expect(mcpCallCount).toBe(callsBeforeApproval + 1);

    const secondDestructive = await readUntilCapabilityConfirmation(await startChat());
    const secondOnce = await apiRequest("/api/tool-approvals", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Chatus-Client": "web" },
      body: JSON.stringify({
        runId: secondDestructive.confirmation.runId,
        callId: secondDestructive.confirmation.callId,
        decision: "once",
      }),
    });
    expect(secondOnce.status).toBe(200);
    await drainCapabilityReader(secondDestructive.reader, secondDestructive.decoder, secondDestructive.buffer);
    expect(mcpCallCount).toBe(callsBeforeApproval + 2);

    const deniedDestructive = await readUntilCapabilityConfirmation(await startChat());
    const callsBeforeDeny = mcpCallCount;
    const denied = await apiRequest("/api/tool-approvals", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Chatus-Client": "web" },
      body: JSON.stringify({
        runId: deniedDestructive.confirmation.runId,
        callId: deniedDestructive.confirmation.callId,
        decision: "deny",
      }),
    });
    expect(denied.status).toBe(200);
    await drainCapabilityReader(deniedDestructive.reader, deniedDestructive.decoder, deniedDestructive.buffer);
    expect(mcpCallCount).toBe(callsBeforeDeny);

    const cancelledDestructive = await readUntilCapabilityConfirmation(await startChat());
    const callsBeforeCancel = mcpCallCount;
    await cancelledDestructive.reader.cancel();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mcpCallCount).toBe(callsBeforeCancel);

    await runInDurableObject(env.USER_STATE.getByName(member.label), async (instance) => {
      (instance as unknown as { toolConfirmationTimeoutMs: number }).toolConfirmationTimeoutMs = 10;
    });
    const callsBeforeTimeout = mcpCallCount;
    const timeoutEvents = await readCapabilityEvents(await startChat());
    expect(timeoutEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "error", code: "tool_confirmation_timeout" }),
    ]));
    expect(mcpCallCount).toBe(callsBeforeTimeout);
  });

  it("rejects a managed ciphertext moved to a different key reference", async () => {
    const cookie = await adminLogin();
    const sourceRef = "SOURCE_TEST_KEY";
    const targetRef = "TARGET_TEST_KEY";
    expect((await putRouteSecret(cookie, sourceRef, "source-managed-test-value")).status).toBe(200);
    const raw = await env.CHAT_STORE.get(`${ROUTE_SECRET_PREFIX}${sourceRef}`);
    await env.CHAT_STORE.put(`${ROUTE_SECRET_PREFIX}${targetRef}`, raw!);
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      providers: {
        moved: {
          label: "Moved secret provider",
          type: "openai-chat",
          baseUrl: "https://moved.example/v1",
          apiKeyRef: targetRef,
        },
      },
      routes: {
        moved: { label: "Moved model", offerings: [{ providerId: "moved", model: "moved-model" }] },
      },
      defaults: { defaultRoute: "moved", allowedRoutes: ["moved"] },
    }));

    const response = await apiRequest("/api/admin/route-models", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerId: "moved" }),
    });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: "decrypt_failed" });

    const listed = await apiRequest("/api/admin/route-secrets", cookie).then((item) => item.json()) as any;
    expect(listed.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ apiKeyRef: targetRef, source: "managed", status: "unavailable" }),
    ]));
  });

  it("reports missing or changed master keys without breaking Worker Secret fallback", async () => {
    const cookie = await adminLogin();
    const apiKeyRef = "MASTER_MISMATCH_TEST_KEY";
    expect((await putRouteSecret(cookie, apiKeyRef, "master-mismatch-test-value")).status).toBe(200);
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      providers: {
        mismatch: {
          label: "Mismatched master provider",
          type: "openai-chat",
          baseUrl: "https://master-mismatch.example/v1",
          apiKeyRef,
        },
        worker: {
          label: "Worker fallback provider",
          type: "openai-chat",
          baseUrl: "https://worker-fallback.example/v1",
          apiKeyRef: "TEST_ROUTE_KEY",
        },
      },
      routes: {
        mismatch: { label: "Mismatch", offerings: [{ providerId: "mismatch", model: "mismatch-model" }] },
        worker: { label: "Worker", offerings: [{ providerId: "worker", model: "worker-model" }] },
      },
      defaults: { defaultRoute: "mismatch", allowedRoutes: ["mismatch", "worker"] },
    }));
    const withMasterKey = (masterKey: string | undefined) => new Proxy(env, {
      get(target, property, receiver) {
        if (property === "ROUTE_KEYS_MASTER_KEY") return masterKey;
        return Reflect.get(target, property, receiver);
      },
    });
    const directAdminRequest = (path: string, customEnv: typeof env, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      headers.set("Cookie", cookie);
      if (init.body) headers.set("Content-Type", "application/json");
      return worker.fetch(new Request(`https://example.test${path}`, { ...init, headers }), customEnv);
    };

    const changedMaster = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));
    const unreadable = await directAdminRequest(
      "/api/admin/route-models",
      withMasterKey(changedMaster),
      {
        method: "POST",
        body: JSON.stringify({ providerId: "mismatch" }),
      },
    );
    expect(unreadable.status).toBe(503);
    await expect(unreadable.json()).resolves.toMatchObject({ error: "decrypt_failed" });

    const missingMaster = withMasterKey(undefined);
    const cannotWrite = await directAdminRequest(
      "/api/admin/route-secrets/NEW_MASTER_TEST_KEY",
      missingMaster,
      { method: "PUT", body: JSON.stringify({ apiKey: "new-master-test-value" }) },
    );
    expect(cannotWrite.status).toBe(503);
    await expect(cannotWrite.json()).resolves.toMatchObject({ error: "master_key_unavailable" });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({
      data: [{ id: "fallback-model" }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const fallback = await directAdminRequest(
      "/api/admin/route-models",
      missingMaster,
      {
        method: "POST",
        body: JSON.stringify({ providerId: "worker" }),
      },
    );
    expect(fallback.status).toBe(200);
    expect(new Headers(fetchSpy.mock.calls[0]?.[1]?.headers).get("Authorization")).toBe("Bearer test-route-key");
  });

  it("prefers managed route keys over Worker Secrets and legacy route keys over managed keys", async () => {
    const cookie = await adminLogin();
    const managedValue = "managed-model-list-test-key";
    expect((await putRouteSecret(cookie, "TEST_ROUTE_KEY", managedValue)).status).toBe(200);
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      providers: {
        managed: {
          label: "Managed provider",
          type: "openai-chat",
          baseUrl: "https://managed-models.example/v1",
          apiKeyRef: "TEST_ROUTE_KEY",
        },
      },
      routes: {
        legacy: {
          label: "Legacy",
          type: "openai-chat",
          baseUrl: "https://legacy-models.example/v1",
          model: "legacy-model",
          apiKey: "legacy-model-list-test-key",
          apiKeyRef: "TEST_ROUTE_KEY",
        },
      },
      defaults: { defaultRoute: "legacy", allowedRoutes: ["legacy"] },
    }));
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({ data: [{ id: "model-a" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const managed = await apiRequest("/api/admin/route-models", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerId: "managed" }),
    });
    expect(managed.status).toBe(200);
    expect(new Headers(fetchSpy.mock.calls[0]?.[1]?.headers).get("Authorization")).toBe(`Bearer ${managedValue}`);

    const legacy = await apiRequest("/api/admin/route-models", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ routeId: "legacy" }),
    });
    expect(legacy.status).toBe(200);
    expect(new Headers(fetchSpy.mock.calls[1]?.[1]?.headers).get("Authorization")).toBe("Bearer legacy-model-list-test-key");
  });

  it("fetches and normalizes models through the admin API", async () => {
    const cookie = await adminLogin();
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      providers: {
        models: {
          label: "Models provider",
          type: "openai-chat",
          baseUrl: "https://models.example/v1",
          apiKeyRef: "TEST_ROUTE_KEY",
        },
      },
      routes: {
        models: { label: "Models", offerings: [{ providerId: "models", model: "model-a" }] },
      },
      defaults: { defaultRoute: "models", allowedRoutes: ["models"] },
    }));
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({ data: [{ id: "model-b" }, { id: "model-a" }, { id: "model-a" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    try {
      const response = await apiRequest("/api/admin/route-models", cookie, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId: "models" }),
      });
      const payload = await response.json();
      expect(response.status, JSON.stringify(payload)).toBe(200);
      expect(payload).toMatchObject({ models: ["model-a", "model-b"], count: 2 });
      expect(fetchSpy).toHaveBeenCalledOnce();
      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe("https://models.example/v1/models");
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test-route-key");
      const diagnostics = await apiRequest(
        "/api/admin/provider-attempts?providerId=models&limit=10",
        cookie,
      );
      expect(diagnostics.status).toBe(200);
      const diagnosticPayload = await diagnostics.json() as any;
      expect(diagnosticPayload).toMatchObject({
        providerId: "models",
        attempts: [expect.objectContaining({
          runKind: "model_discovery",
          logicalRouteId: "model-discovery",
          providerId: "models",
          model: "model-list",
          status: "succeeded",
        })],
      });
      expect(JSON.stringify(diagnosticPayload)).not.toMatch(/idempotency|fence|test-route-key/i);
      const invalidLimit = await apiRequest(
        "/api/admin/provider-attempts?providerId=models&limit=101",
        cookie,
      );
      expect(invalidLimit.status).toBe(400);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("manages immutable Provider prices and content-free reconciliation summaries", async () => {
    const cookie = await adminLogin();
    const providerId = "finance-test";
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      providers: {
        [providerId]: {
          label: "Finance test provider",
          type: "openai-chat",
          baseUrl: "https://finance.example/v1",
          apiKeyRef: "TEST_ROUTE_KEY",
        },
      },
      routes: {
        reasoning: { label: "Reasoning", offerings: [{ providerId, model: "finance-model" }] },
      },
      defaults: { defaultRoute: "reasoning", allowedRoutes: ["reasoning"] },
    }));
    const base = Date.now() + 1_000;
    const price = {
      version: 1,
      catalogVersionId: "finance-test-v1",
      providerId,
      offeringId: `reasoning/${providerId}`,
      model: "finance-model",
      currency: "USD",
      precision: 6,
      unit: "million_tokens",
      inputNoCachePriceMicros: 1_000_000,
      cacheReadInputPriceMicros: 0,
      cacheWriteInputPriceMicros: 0,
      outputTextPriceMicros: 2_000_000,
      reasoningOutputPriceMicros: 0,
      effectiveFrom: base,
      effectiveTo: null,
      approver: "finance-admin",
      provenance: "provider-published-price-card",
      createdAt: base,
    };
    const createdPrice = await apiRequest("/api/admin/provider-finance/prices", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(price),
    });
    expect(createdPrice.status, await createdPrice.clone().text()).toBe(201);
    const replayedPrice = await apiRequest("/api/admin/provider-finance/prices", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(price),
    });
    expect(replayedPrice.status).toBe(200);

    const runtime = createProviderAttemptRuntime({
      ledger: env.PROVIDER_ATTEMPT_LEDGER,
      mode: "required",
      operation: {
        version: 1,
        operationId: `finance-test-${crypto.randomUUID()}`,
        fenceId: crypto.randomUUID(),
        kind: "provider_turn",
        startedAt: base,
      },
    });
    const attempt = await runtime.createRun("main_answer").start({
      logicalRouteId: "reasoning",
      providerId,
      model: "finance-model",
      credentialClass: "managed",
      fallbackIndex: 0,
      startedAt: base + 1,
    });
    await attempt.recordUsage({
      source: "ai_sdk_generate",
      inputNoCacheTokens: 100,
      cacheReadInputTokens: 0,
      cacheWriteInputTokens: 0,
      outputTextTokens: 20,
      reasoningOutputTokens: 0,
      observedAt: base + 2,
    });
    await attempt.succeed(base + 3);

    const reconciliation = {
      version: 1,
      fingerprint: `sha256:${"c".repeat(64)}`,
      providerId,
      accountFingerprint: `acct_sha256:${"d".repeat(64)}`,
      periodStart: base - 1_000,
      periodEnd: base + 100,
      currency: "USD",
      reportedTotalMicros: 200,
      matchedTotalMicros: 140,
      status: "partial",
      importedAt: base + 200,
    };
    const imported = await apiRequest("/api/admin/provider-finance/reconciliations", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reconciliation),
    });
    expect(imported.status, await imported.clone().text()).toBe(201);
    await expect(imported.json()).resolves.toMatchObject({
      reconciliation: { unmatchedVarianceMicros: 60, status: "partial" },
    });

    const finance = await apiRequest(`/api/admin/provider-finance?periodStart=${base - 1_000}&limit=10`, cookie);
    expect(finance.status, await finance.clone().text()).toBe(200);
    const payload = await finance.json() as any;
    expect(payload).toMatchObject({
      version: 1,
      hardBudgetEnforcement: "instance_provider_v1",
      providers: [expect.objectContaining({
        providerId,
        label: "Finance test provider",
        capacity: expect.objectContaining({ calls: 1, unknownUsageAttempts: 0 }),
        usage: expect.objectContaining({ inputNoCacheTokens: 100, outputTextTokens: 20 }),
        costs: [expect.objectContaining({ currency: "USD", provisionalMicros: 140, totalMicros: 140 })],
        attempts: [expect.objectContaining({
          catalogVersionId: "finance-test-v1",
          usageState: "reported",
          costState: "provisional",
        })],
        reconciliations: [expect.objectContaining({ status: "partial", unmatchedVarianceMicros: 60 })],
      })],
    });
    expect(JSON.stringify(payload)).not.toMatch(/apiKey|rawInvoice|prompt|completion/i);

    const leaked = await apiRequest("/api/admin/provider-finance/reconciliations", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...reconciliation, fingerprint: `sha256:${"e".repeat(64)}`, rawInvoice: "secret" }),
    });
    expect(leaked.status).toBe(400);
    expect((await apiRequest("/api/admin/provider-finance?limit=101", cookie)).status).toBe(400);
  });

  it("enforces fenced audited Provider budget policy and hold mutations", async () => {
    const cookie = await adminLogin();
    const providerId = `budget-api-${crypto.randomUUID()}`;
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      providers: {
        [providerId]: {
          label: "Budget API provider",
          type: "openai-chat",
          baseUrl: "https://budget-api.example/v1",
          apiKeyRef: "TEST_ROUTE_KEY",
        },
      },
      routes: {
        reasoning: { label: "Reasoning", offerings: [{ providerId, model: "budget-model" }] },
      },
      defaults: { defaultRoute: "reasoning", allowedRoutes: ["reasoning"] },
    }));
    const base = Date.now() + 1_000;
    await env.PROVIDER_ATTEMPT_LEDGER.getByName(providerId).addPriceCatalog({
      version: 1,
      catalogVersionId: "budget-api-price-v1",
      providerId,
      offeringId: `reasoning/${providerId}`,
      model: "budget-model",
      currency: "USD",
      precision: 6,
      unit: "million_tokens",
      inputNoCachePriceMicros: 1_000_000,
      cacheReadInputPriceMicros: 0,
      cacheWriteInputPriceMicros: 0,
      outputTextPriceMicros: 1_000_000,
      reasoningOutputPriceMicros: 0,
      effectiveFrom: base,
      effectiveTo: null,
      approver: "budget-admin",
      provenance: "local-fixture",
      createdAt: base,
    });
    const policy = {
      version: 1,
      providerId,
      currency: "USD",
      mode: "shadow",
      periodStart: base,
      periodEnd: base + 86_400_000,
      limitMicros: 1_000,
      maxAttemptReserveMicros: 500,
      expectedPreviousVersion: 0,
    };

    const unauthorized = await exports.default.fetch(new Request(
      "https://example.test/api/admin/provider-finance/budgets",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(policy) },
    ));
    expect(unauthorized.status).toBe(401);

    const unknownProvider = await apiRequest("/api/admin/provider-finance/budgets", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...policy, providerId: "missing-provider" }),
    });
    expect(unknownProvider.status).toBe(404);

    const leaked = await apiRequest("/api/admin/provider-finance/budgets", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...policy, apiKey: "secret-marker" }),
    });
    expect(leaked.status).toBe(400);

    const browserIdentity = await apiRequest("/api/admin/provider-finance/budgets", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...policy,
        policyId: "browser-selected-policy",
        idempotencyKey: "provider-budget-policy:v1:browser-selected-policy",
      }),
    });
    expect(browserIdentity.status).toBe(400);

    const initialHard = await apiRequest("/api/admin/provider-finance/budgets", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...policy, mode: "hard" }),
    });
    expect(initialHard.status).toBe(409);
    await expect(initialHard.json()).resolves.toEqual({ error: "provider_budget_policy_transition" });

    const created = await apiRequest("/api/admin/provider-finance/budgets", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(policy),
    });
    expect(created.status, await created.clone().text()).toBe(201);
    await expect(created.json()).resolves.toMatchObject({ created: true, policy: { policyVersion: 1, mode: "shadow" } });
    const replay = await apiRequest("/api/admin/provider-finance/budgets", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(policy),
    });
    expect(replay.status).toBe(200);

    const conflictingReplay = await apiRequest("/api/admin/provider-finance/budgets", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...policy, mode: "soft" }),
    });
    expect(conflictingReplay.status).toBe(409);
    const stale = await apiRequest("/api/admin/provider-finance/budgets", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...policy, mode: "soft" }),
    });
    expect(stale.status).toBe(409);

    const soft = {
      ...policy,
      mode: "soft",
      expectedPreviousVersion: 1,
    };
    const softResponse = await apiRequest("/api/admin/provider-finance/budgets", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(soft),
    });
    expect(softResponse.status, await softResponse.clone().text()).toBe(201);
    await expect(softResponse.json()).resolves.toMatchObject({ policy: { policyVersion: 2, mode: "soft" } });

    const hard = {
      ...policy,
      mode: "hard",
      expectedPreviousVersion: 2,
    };
    const hardResponse = await apiRequest("/api/admin/provider-finance/budgets", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(hard),
    });
    expect(hardResponse.status, await hardResponse.clone().text()).toBe(201);

    const runtime = createProviderAttemptRuntime({
      ledger: env.PROVIDER_ATTEMPT_LEDGER,
      mode: "required",
      operation: {
        version: 1,
        operationId: `budget-api-operation-${crypto.randomUUID()}`,
        fenceId: crypto.randomUUID(),
        kind: "provider_turn",
        startedAt: base + 3,
      },
    });
    const attempt = await runtime.createRun("main_answer").start({
      logicalRouteId: "reasoning",
      providerId,
      model: "budget-model",
      credentialClass: "managed",
      fallbackIndex: 0,
      startedAt: base + 4,
    });
    await attempt.fail(new Error("local fake Provider failure"), base + 5);

    const beforeAction = await apiRequest(`/api/admin/provider-finance?periodStart=${base - 2_000}&limit=100`, cookie);
    expect(beforeAction.status, await beforeAction.clone().text()).toBe(200);
    const beforePayload = await beforeAction.json() as any;
    const provider = beforePayload.providers.find((entry: any) => entry.providerId === providerId);
    expect(provider).toMatchObject({
      budgetPolicies: [
        expect.objectContaining({ policyVersion: 3, mode: "hard" }),
        expect.objectContaining({ policyVersion: 2, mode: "soft" }),
        expect.objectContaining({ policyVersion: 1, mode: "shadow" }),
      ],
      budgetBalances: [expect.objectContaining({ reservedMicros: 0, heldMicros: 500, pendingSettlementCount: 0 })],
      budgetReservations: [expect.objectContaining({ status: "held", heldMicros: 500 })],
    });
    const reservation = provider.budgetReservations[0];
    const action = {
      version: 1,
      providerId,
      reservationId: reservation.reservationId,
      action: "release",
      amountMicros: 0,
      reason: "operator verified local fake failure is non-billable",
    };
    const actionLeak = await apiRequest(`/api/admin/provider-finance/budget-reservations/${reservation.reservationId}/reconcile`, cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...action, rawInvoice: "secret-marker" }),
    });
    expect(actionLeak.status).toBe(400);
    const mismatch = await apiRequest("/api/admin/provider-finance/budget-reservations/reservation_00000000-0000-4000-8000-000000000000/reconcile", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action),
    });
    expect(mismatch.status).toBe(400);
    const released = await apiRequest(`/api/admin/provider-finance/budget-reservations/${reservation.reservationId}/reconcile`, cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action),
    });
    expect(released.status, await released.clone().text()).toBe(200);
    await expect(released.json()).resolves.toMatchObject({ updated: true, reservation: { status: "operator_released", heldMicros: 0 } });
    const releasedReplay = await apiRequest(`/api/admin/provider-finance/budget-reservations/${reservation.reservationId}/reconcile`, cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action),
    });
    await expect(releasedReplay.json()).resolves.toMatchObject({ updated: false });

    const audit = await apiRequest("/api/admin/audit", cookie).then((response) => response.json()) as any;
    expect(audit.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "provider-budget-policy.create", target: providerId }),
      expect.objectContaining({ action: "provider-budget.release", target: providerId }),
    ]));
    const serialized = JSON.stringify({ beforePayload, audit });
    expect(serialized).not.toMatch(/secret-marker|apiKey|rawInvoice|prompt|completion/i);
  });

  it("redacts Provider bodies and endpoints from model discovery failures", async () => {
    const cookie = await adminLogin();
    const endpoint = "https://private-model-discovery.example/v1";
    const providerBodyMarker = `PRIVATE_MODEL_DISCOVERY_BODY_${crypto.randomUUID()}`;
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      providers: {
        privateModels: {
          label: "Private model provider",
          type: "openai-chat",
          baseUrl: endpoint,
          apiKeyRef: "TEST_ROUTE_KEY",
        },
      },
      routes: {},
      defaults: {},
    }));
    vi.spyOn(globalThis, "fetch").mockImplementationOnce(async () =>
      new Response(providerBodyMarker, { status: 503 }));

    const response = await apiRequest("/api/admin/route-models", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerId: "privateModels" }),
    });
    const text = await response.text();
    expect(response.status, text).toBe(502);
    expect(JSON.parse(text)).toEqual({
      error: "upstream_unavailable",
      message: "模型服务暂时不可用，请稍后重试或切换模型。",
      status: 503,
    });
    expect(text).not.toContain(providerBodyMarker);
    expect(text).not.toContain(endpoint);
    expect(text).not.toContain("private-model-discovery.example");
  });

  it("projects exhausted model-discovery budget before the Provider request", async () => {
    const cookie = await adminLogin();
    const providerId = `model-discovery-budget-${crypto.randomUUID()}`;
    const endpoint = `https://${providerId}.example/v1`;
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      providers: {
        [providerId]: {
          label: "Budgeted model discovery",
          type: "openai-chat",
          baseUrl: endpoint,
          apiKeyRef: "TEST_ROUTE_KEY",
        },
      },
      routes: {},
      defaults: {},
    }));
    await seedHardProviderBudget({
      providerId,
      routeId: "model-discovery",
      model: "model-list",
      knownPrice: true,
      exhausted: true,
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const response = await apiRequest("/api/admin/route-models", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerId }),
    });
    const text = await response.text();
    expect(response.status, text).toBe(429);
    expect(JSON.parse(text)).toEqual({
      error: "provider_budget_exceeded",
      message: "当前 Provider 预算已用尽，请联系管理员调整预算或稍后再试。",
    });
    expect(text).not.toContain(providerId);
    expect(text).not.toContain(endpoint);
    expect(text).not.toContain("TEST_ROUTE_KEY");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("classifies invalid model discovery JSON as a redacted protocol error", async () => {
    const cookie = await adminLogin();
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      providers: {
        invalidModels: {
          label: "Invalid model provider",
          type: "openai-chat",
          baseUrl: "https://invalid-model-discovery.example/v1",
          apiKeyRef: "TEST_ROUTE_KEY",
        },
      },
      routes: {},
      defaults: {},
    }));
    vi.spyOn(globalThis, "fetch").mockImplementationOnce(async () =>
      new Response("PRIVATE_INVALID_MODEL_JSON", { status: 200 }));
    const response = await apiRequest("/api/admin/route-models", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerId: "invalidModels" }),
    });
    await expect(response.json()).resolves.toEqual({
      error: "provider_protocol_error",
      message: "模型线路返回了无法识别的响应，请切换模型或联系管理员。",
    });
  });

  it("requires model discovery to use a saved provider or route", async () => {
    const cookie = await adminLogin();
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const injected = await apiRequest("/api/admin/route-models", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "openai-chat",
        baseUrl: "https://unsaved.example/v1",
        apiKeyRef: "TEST_ROUTE_KEY",
      }),
    });
    expect(injected.status).toBe(400);
    await expect(injected.json()).resolves.toMatchObject({ error: "provider_required" });

    const missing = await apiRequest("/api/admin/route-models", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerId: "missing-provider" }),
    });
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({ error: "provider_not_found" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("uses managed route keys for passive readiness and real chat requests", async () => {
    const adminCookie = await adminLogin();
    const apiKeyRef = "END_TO_END_TEST_KEY";
    const managedKey = "managed-end-to-end-test-key";
    expect((await putRouteSecret(adminCookie, apiKeyRef, managedKey)).status).toBe(200);
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      routes: {
        managed: {
          label: "Managed",
          type: "openai-chat",
          baseUrl: "https://managed-route.example/v1",
          model: "managed-model",
          apiKeyRef,
        },
      },
      defaults: { defaultRoute: "managed", allowedRoutes: ["managed"] },
    }));
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => openAiTextResponse("完成"));

    const health = await apiRequest("/api/admin/route-health", adminCookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ routeId: "managed" }),
    });
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toMatchObject({
      routeId: "managed",
      status: "unknown",
      source: "passive",
      configured: true,
      credentialStatus: "configured",
      reliability: null,
    });
    expect(fetchSpy).not.toHaveBeenCalled();

    const { cookie } = await login();
    const session = await apiRequest("/api/session", cookie);
    expect(session.status).toBe(200);
    await expect(session.json()).resolves.toMatchObject({ routes: [{ id: "managed" }], defaultRoute: "managed" });

    const chat = await apiRequest("/api/chat", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Chatus-Client": "web" },
      body: JSON.stringify({ routeId: "managed", messages: [{ role: "user", content: "完成一个简短任务" }] }),
    });
    expect(chat.status, await chat.clone().text()).toBe(200);
    await expect(chat.text()).resolves.toContain("完成");
    expect(fetchSpy).toHaveBeenCalledOnce();
    for (const [, init] of fetchSpy.mock.calls) {
      expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${managedKey}`);
    }
    await expect(env.CHAT_STORE.get("route-reliability:managed", "json")).resolves.toMatchObject({
      version: 2,
      source: "real_task",
      routeId: "managed",
      ok: true,
      outcome: "success",
    });
  });

  it("keeps user BYOK precedence and requiresUserKey blocking with a managed key present", async () => {
    const adminCookie = await adminLogin();
    const apiKeyRef = "BYOK_TEST_KEY";
    expect((await putRouteSecret(adminCookie, apiKeyRef, "managed-byok-test-key")).status).toBe(200);
    const label = `byok-${crypto.randomUUID()}`;
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      routes: {
        byok: {
          label: "BYOK",
          type: "openai-chat",
          baseUrl: "https://byok.example/v1",
          model: "byok-model",
          apiKeyRef,
          requiresUserKey: true,
        },
      },
      defaults: {
        defaultRoute: "byok",
        allowedRoutes: ["byok"],
        allowBringYourOwnKey: true,
      },
      users: { [label]: { allowBringYourOwnKey: true, systemPrompt: "Keep test responses concise." } },
    }));
    const { cookie } = await login(label);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => openAiTextResponse("BYOK 完成"));

    const session = await apiRequest("/api/session", cookie);
    await expect(session.json()).resolves.toMatchObject({
      allowBringYourOwnKey: true,
      hasUserSystemPrompt: true,
    });

    const missing = await apiRequest("/api/chat", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Chatus-Client": "web" },
      body: JSON.stringify({ routeId: "byok", messages: [{ role: "user", content: "执行 BYOK 测试" }] }),
    });
    expect(missing.status, await missing.clone().text()).toBe(400);
    await expect(missing.json()).resolves.toMatchObject({ error: "user_api_key_required", routeId: "byok" });
    expect(fetchSpy).not.toHaveBeenCalled();

    const supplied = await apiRequest("/api/chat", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Chatus-Client": "web" },
      body: JSON.stringify({
        routeId: "byok",
        userApiKey: "user-supplied-test-key",
        messages: [{ role: "user", content: "执行 BYOK 测试" }],
      }),
    });
    expect(supplied.status).toBe(200);
    await expect(supplied.text()).resolves.toContain("BYOK 完成");
    expect(new Headers(fetchSpy.mock.calls[0]?.[1]?.headers).get("Authorization")).toBe("Bearer user-supplied-test-key");
  });

  it("reports route configuration readiness without calling the provider", async () => {
    const cookie = await adminLogin();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const check = await apiRequest("/api/admin/route-health", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ routeId: "default" }),
    });
    expect(check.status).toBe(200);
    await expect(check.json()).resolves.toMatchObject({
      routeId: "default",
      status: "unavailable",
      source: "passive",
      configured: false,
      credentialStatus: "missing",
      reliability: null,
    });

    const stored = await apiRequest("/api/admin/route-health", cookie);
    expect(stored.status).toBe(200);
    await expect(stored.json()).resolves.toMatchObject({
      routes: {
        default: {
          routeId: "default",
          status: "unavailable",
          configured: false,
          credentialStatus: "missing",
        },
      },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("projects configured provider-route reliability without model calls or secret fields", async () => {
    const cookie = await adminLogin();
    const providerSecret = `reliability-secret-${crypto.randomUUID()}`;
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      providers: {
        shared: {
          label: "Shared provider",
          type: "openai-chat",
          baseUrl: "https://reliability.example/v1",
          apiKey: providerSecret,
          concurrency: "bounded",
          maxConcurrent: 2,
          queueTimeoutMs: 750,
        },
      },
      routes: {
        writer: {
          label: "Writer",
          offerings: [{ providerId: "shared", model: "writer-v1" }],
        },
      },
      defaults: { defaultRoute: "writer", allowedRoutes: ["writer"] },
    }));
    await env.CHAT_STORE.put(`${PROVIDER_ROUTE_RELIABILITY_PREFIX}writer:shared`, JSON.stringify({
      version: 2,
      source: "real_task",
      routeId: "writer",
      providerId: "shared",
      attempts: 3,
      successes: 2,
      averageLatencyMs: 240,
      lastOutcome: "upstream_server",
      observedAt: new Date().toISOString(),
      requestId: "turn_reliability-123",
      lastFallback: true,
      fallbackCount: 1,
      streamSamples: 2,
      progressiveSamples: 1,
      averageFirstVisibleLatencyMs: 95,
      lastFirstVisibleLatencyMs: 70,
      lastStreamShape: "single_chunk",
    }));
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const response = await apiRequest("/api/admin/reliability", cookie);
    const text = await response.text();
    expect(response.status, text).toBe(200);
    expect(text).not.toContain(providerSecret);
    expect(text).not.toContain("apiKey");
    expect(JSON.parse(text)).toMatchObject({
      providers: [{
        providerId: "shared",
        label: "Shared provider",
        enabled: true,
        credentialStatus: "configured",
        concurrency: "bounded",
        maxConcurrent: 2,
        queueTimeoutMs: 750,
        routes: [{
          routeId: "writer",
          model: "writer-v1",
          attempts: 3,
          successes: 2,
          averageLatencyMs: 240,
          lastOutcome: "upstream_server",
          requestId: "turn_reliability-123",
          lastFallback: true,
          fallbackCount: 1,
          streamSamples: 2,
          progressiveSamples: 1,
          averageFirstVisibleLatencyMs: 95,
          lastFirstVisibleLatencyMs: 70,
          lastStreamShape: "single_chunk",
        }],
      }],
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("renders expired provider-route reliability as unknown", async () => {
    const cookie = await adminLogin();
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      providers: {
        old: {
          label: "Old provider",
          type: "openai-chat",
          baseUrl: "https://old.example/v1",
          apiKey: "old-provider-secret",
        },
      },
      routes: {
        oldRoute: {
          label: "Old route",
          offerings: [{ providerId: "old", model: "old-v1" }],
        },
      },
      defaults: { defaultRoute: "oldRoute", allowedRoutes: ["oldRoute"] },
    }));
    await env.CHAT_STORE.put(`${PROVIDER_ROUTE_RELIABILITY_PREFIX}oldRoute:old`, JSON.stringify({
      version: 2,
      source: "real_task",
      routeId: "oldRoute",
      providerId: "old",
      attempts: 9,
      successes: 8,
      averageLatencyMs: 90,
      lastOutcome: "success",
      observedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1_000).toISOString(),
      lastFallback: false,
      fallbackCount: 0,
    }));
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const response = await apiRequest("/api/admin/reliability", cookie);
    const payload = await response.json() as {
      providers: Array<{ routes: Array<Record<string, unknown>> }>;
    };
    expect(response.status).toBe(200);
    expect(payload.providers[0].routes[0]).toMatchObject({ attempts: 0, successes: 0, averageLatencyMs: 0 });
    expect(payload.providers[0].routes[0]).not.toHaveProperty("lastOutcome");
    expect(payload.providers[0].routes[0]).not.toHaveProperty("observedAt");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects configurations without an enabled route for every user", async () => {
    const cookie = await adminLogin();
    const route = {
      label: "Disabled",
      type: "openai-chat",
      baseUrl: "https://disabled.example/v1",
      model: "disabled-model",
      enabled: false,
    };
    const noEnabledRoute = await apiRequest("/api/admin/config", cookie, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: { routes: { disabled: route }, defaults: { allowedRoutes: ["disabled"] } } }),
    });
    expect(noEnabledRoute.status).toBe(400);
    await expect(noEnabledRoute.json()).resolves.toMatchObject({ message: "至少需要启用一条线路" });

    const userWithoutRoute = await apiRequest("/api/admin/config", cookie, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        config: {
          routes: {
            active: { ...route, label: "Active", enabled: true },
            disabled: route,
          },
          defaults: { defaultRoute: "active", allowedRoutes: ["active"] },
          users: { friend: { defaultRoute: "disabled", allowedRoutes: ["disabled"] } },
        },
      }),
    });
    expect(userWithoutRoute.status).toBe(400);
    await expect(userWithoutRoute.json()).resolves.toMatchObject({ message: "用户 friend 至少需要一条已启用的允许线路" });

    const missingSkill = await apiRequest("/api/admin/config", cookie, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        config: {
          routes: { active: { ...route, label: "Active", enabled: true } },
          defaults: { defaultRoute: "active", allowedRoutes: ["active"] },
          users: { friend: { allowedSkills: ["missing"] } },
        },
      }),
    });
    expect(missingSkill.status).toBe(400);
    await expect(missingSkill.json()).resolves.toMatchObject({
      message: "用户 friend 允许了不存在的 Skill missing",
    });
  });

  it("rejects invalid provider-pool fields before normalization can discard them", async () => {
    const cookie = await adminLogin();
    const baseConfig = {
      providers: {
        shared: {
          label: "Shared provider",
          type: "openai-chat",
          baseUrl: "https://shared-provider.example/v1",
          apiKeyRef: "SHARED_PROVIDER_KEY",
          concurrency: "exclusive",
          queueTimeoutMs: 10_000,
        },
      },
      routes: {
        model: {
          label: "Logical model",
          offerings: [{ providerId: "shared", model: "upstream-model" }],
        },
      },
      defaults: { defaultRoute: "model", allowedRoutes: ["model"] },
    };

    const invalidProviderId = await apiRequest("/api/admin/config", cookie, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        config: {
          ...baseConfig,
          providers: { ["__proto__"]: baseConfig.providers.shared },
        },
      }),
    });
    expect(invalidProviderId.status).toBe(400);
    await expect(invalidProviderId.json()).resolves.toMatchObject({
      error: "invalid_config",
      message: expect.stringContaining("服务提供商 __proto__ 的 ID 无效"),
    });

    const inheritedProvider = await apiRequest("/api/admin/config", cookie, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        config: {
          ...baseConfig,
          routes: {
            model: {
              ...baseConfig.routes.model,
              offerings: [{ providerId: "constructor", model: "upstream-model" }],
            },
          },
        },
      }),
    });
    expect(inheritedProvider.status).toBe(400);
    await expect(inheritedProvider.json()).resolves.toMatchObject({
      error: "invalid_config",
      message: "逻辑模型 model 引用了不存在的服务提供商 constructor",
    });

    const missingProvider = await apiRequest("/api/admin/config", cookie, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        config: {
          ...baseConfig,
          routes: {
            model: {
              ...baseConfig.routes.model,
              offerings: [
                ...baseConfig.routes.model.offerings,
                { providerId: "missing", model: "other-model" },
              ],
            },
          },
        },
      }),
    });
    expect(missingProvider.status).toBe(400);
    await expect(missingProvider.json()).resolves.toMatchObject({
      error: "invalid_config",
      message: "逻辑模型 model 引用了不存在的服务提供商 missing",
    });

    const excessiveWait = await apiRequest("/api/admin/config", cookie, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        config: {
          ...baseConfig,
          providers: {
            shared: { ...baseConfig.providers.shared, queueTimeoutMs: 10_001 },
          },
        },
      }),
    });
    expect(excessiveWait.status).toBe(400);
    await expect(excessiveWait.json()).resolves.toMatchObject({
      error: "invalid_config",
      message: "服务提供商 shared 的等待时间必须是 0 到 10000 毫秒",
    });

    const arrayProviders = await apiRequest("/api/admin/config", cookie, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: { ...baseConfig, providers: [] } }),
    });
    expect(arrayProviders.status).toBe(400);
    await expect(arrayProviders.json()).resolves.toMatchObject({
      error: "invalid_config",
      message: "服务提供商配置必须是对象",
    });

    expect(await env.CHAT_STORE.get(ROUTES_CONFIG_KEY)).toBeNull();
  });

  it("rejects stale admin configuration updates", async () => {
    const cookie = await adminLogin();
    const initialResponse = await apiRequest("/api/admin/config", cookie);
    const initial = await initialResponse.json() as any;
    expect(initial.revision).toMatch(/^[0-9a-f]{64}$/);

    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      ...initial.config,
      users: { ...(initial.config.users || {}), concurrent: { displayName: "Concurrent edit" } },
    }));

    const stale = await apiRequest("/api/admin/config", cookie, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: initial.config, expectedRevision: initial.revision }),
    });
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({ error: "config_conflict" });
    const stored = await env.CHAT_STORE.get<any>(ROUTES_CONFIG_KEY, "json");
    expect(stored.users.concurrent.displayName).toBe("Concurrent edit");
  });

  it("rejects stale admin configuration resets", async () => {
    const cookie = await adminLogin();
    const initialResponse = await apiRequest("/api/admin/config", cookie);
    const initial = await initialResponse.json() as any;
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      ...initial.config,
      users: { ...(initial.config.users || {}), retained: { displayName: "Retained" } },
    }));

    const stale = await apiRequest("/api/admin/config", cookie, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRevision: initial.revision }),
    });
    expect(stale.status).toBe(409);
    await expect(env.CHAT_STORE.get(ROUTES_CONFIG_KEY)).resolves.not.toBeNull();
  });

  it("rejects stale access-code updates", async () => {
    await env.CHAT_STORE.put(ACCESS_CODES_KEY, "friend:original-code");
    const cookie = await adminLogin();
    const initialResponse = await apiRequest("/api/admin/access-codes", cookie);
    const initial = await initialResponse.json() as any;
    expect(initial.revision).toMatch(/^[0-9a-f]{64}$/);

    await env.CHAT_STORE.put(ACCESS_CODES_KEY, "friend:rotated-code");
    const stale = await apiRequest("/api/admin/access-codes", cookie, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessCodes: "friend:stale-code", expectedRevision: initial.revision }),
    });
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({ error: "access_codes_conflict" });
    await expect(env.CHAT_STORE.get(ACCESS_CODES_KEY)).resolves.toBe("friend:rotated-code");
  });

  it("rejects stale long-term memory updates", async () => {
    const label = `memory-${crypto.randomUUID()}`;
    const key = `memory:${encodeURIComponent(label)}`;
    await env.CHAT_STORE.put(key, "original memory");
    const cookie = await adminLogin();
    const initialResponse = await apiRequest(`/api/admin/memory?label=${encodeURIComponent(label)}`, cookie);
    const initial = await initialResponse.json() as any;
    expect(initial.revision).toMatch(/^[0-9a-f]{64}$/);

    const newer = await apiRequest("/api/admin/memory", cookie, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label, memory: "newer memory", expectedRevision: initial.revision }),
    });
    expect(newer.status).toBe(200);
    const stale = await apiRequest("/api/admin/memory", cookie, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label, memory: "stale memory", expectedRevision: initial.revision }),
    });
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({ error: "memory_conflict" });
    await expect(env.CHAT_STORE.get(key)).resolves.toBe("original memory");
    await expect(apiRequest(`/api/admin/memory?label=${encodeURIComponent(label)}`, cookie).then((response) => response.json()))
      .resolves.toMatchObject({ memory: "newer memory" });
  });

  it("derives route status from real user tasks without diagnostic model probes", async () => {
    const cookie = await adminLogin();
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      routes: {
        health: {
          label: "Health",
          type: "openai-chat",
          baseUrl: "https://health.example/v1",
          model: "health-model",
          apiKey: "health-key",
        },
      },
      defaults: { defaultRoute: "health", allowedRoutes: ["health"] },
    }));
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => openAiTextResponse("真实任务完成"));
    const initial = await apiRequest("/api/admin/route-health", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ routeId: "health" }),
    });
    expect(initial.status).toBe(200);
    await expect(initial.json()).resolves.toMatchObject({ status: "unknown", configured: true, reliability: null });
    expect(fetchSpy).not.toHaveBeenCalled();

    const user = await login();
    const chat = await apiRequest("/api/chat", user.cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Chatus-Client": "web" },
      body: JSON.stringify({ routeId: "health", messages: [{ role: "user", content: "整理三条发布检查事项" }] }),
    });
    expect(chat.status, await chat.clone().text()).toBe(200);
    await expect(chat.text()).resolves.toContain("真实任务完成");
    expect(fetchSpy).toHaveBeenCalledOnce();

    const status = await apiRequest("/api/admin/route-health", cookie);
    await expect(status.json()).resolves.toMatchObject({
      routes: {
        health: {
          status: "healthy",
          source: "passive",
          configured: true,
          reliability: { source: "real_task", ok: true, outcome: "success" },
        },
      },
    });
    const session = await apiRequest("/api/session", user.cookie);
    await expect(session.json()).resolves.toMatchObject({
      routes: [{ id: "health", healthStatus: "healthy", healthSource: "real_task", healthOutcome: "success" }],
    });
  });

  it("revokes every active session for a user label", async () => {
    const label = `revoke-${crypto.randomUUID()}`;
    const first = await login(label);
    const second = await login(label);
    const adminCookie = await adminLogin();

    const revoke = await apiRequest("/api/admin/sessions/revoke", adminCookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label }),
    });
    expect(revoke.status).toBe(200);
    await expect(revoke.json()).resolves.toMatchObject({ ok: true, label, revoked: 2, complete: true });
    expect((await apiRequest("/api/session", first.cookie)).status).toBe(401);
    expect((await apiRequest("/api/session", second.cookie)).status).toBe(401);
    const audit = await apiRequest("/api/admin/audit", adminCookie);
    expect(audit.status).toBe(200);
    await expect(audit.json()).resolves.toMatchObject({ entries: [{ action: "sessions.revoke", target: label }] });
  });
});
