import { afterEach, describe, expect, it, vi } from "vitest";
import {
  adminLogout,
  ApiError,
  exportUserData,
  fetchAdminSetupStatus,
  isAdminConfigSnapshot,
  isAdminAuditSnapshot,
  isAdminFeedbackSnapshot,
  isAdminMemberCredentialResponse,
  isAdminMemberConfigRemovalResponse,
  isAdminMemberListResponse,
  isAdminMemberRevokeResponse,
  isAdminMemberSessionsResponse,
  isAdminMcpDiscoveryResponse,
  isAdminMcpSecretMutationResponse,
  isAdminMcpSecretsSnapshot,
  isAdminUsageResetResponse,
  isAdminOperationsStats,
  isAdminReliabilitySnapshot,
  isAdminSessionProjection,
  isAdminSetupStatus,
  isAgentConversation,
  isAgentConversationBranchResult,
  isAgentMemory,
  isSessionProjection,
  submitFeedback,
  isUserDataExport,
  isUserDataMutationResponse,
  runAdminSetupSmoke,
} from "../client/src/lib/api";
import { DEFAULT_FILE_INPUT_POLICY } from "../src/contracts/file";

const validAdminConfig = {
  routes: {
    primary: {
      label: "Primary",
      enabled: true,
      offerings: [{ providerId: "shared", model: "model-a" }],
    },
  },
  providers: {
    shared: {
      label: "Shared",
      type: "openai-chat",
      baseUrl: "https://provider.example/v1",
      hasLegacyKey: true,
    },
  },
  users: {
    bill: { allowedSkills: ["coding"], allowedTools: ["builtin:text_stats"] },
  },
  defaults: { allowedSkills: ["coding"], allowedTools: ["builtin:text_stats"] },
  publicAccess: {
    enabled: true,
    routeId: "primary",
    sessionTtlSeconds: 86_400,
    dailyMessageLimit: 20,
    minuteMessageLimit: 6,
    sourceDailyMessageLimit: 200,
    sourceMinuteMessageLimit: 30,
  },
  skills: {
    coding: {
      enabled: true,
      label: "Coding",
      instructions: "Use the coding workflow.",
      toolIds: ["builtin:text_stats"],
    },
  },
  tools: {
    "builtin:text_stats": {
      enabled: true,
      label: "Text stats",
      inputSchema: { type: "object" },
      confirmation: "auto",
      executor: { type: "builtin", name: "text_stats" },
    },
  },
  mcpServers: {},
};

const validSession = {
  access: "member",
  user: "bill",
  displayName: "Bill",
  usage: { used: 2, limit: 20, remaining: 18 },
  routes: [{
    id: "primary",
    label: "Primary",
    model: "model-a",
    type: "openai-chat",
    supportsImages: true,
    supportsTools: true,
    healthStatus: "unknown",
  }],
  defaultRoute: "primary",
  allowBringYourOwnKey: false,
  hasUserSystemPrompt: true,
  imageInput: {
    acceptedMediaTypes: ["image/png", "image/jpeg", "image/webp", "image/gif"],
    maxImages: 4,
    maxImageBytes: 1_300_000,
    maxTotalImageBytes: 1_300_000,
  },
  fileInput: { ...DEFAULT_FILE_INPUT_POLICY },
  capabilities: {
    imageInput: true,
    fileInput: true,
    memory: true,
    messageActions: true,
    feedback: true,
    accountData: true,
  },
  skills: [{ id: "coding", label: "Coding", toolIds: ["builtin:text_stats"] }],
  tools: [{
    id: "builtin:text_stats",
    label: "Text stats",
    source: "builtin",
    confirmation: "auto",
  }],
  agent: { transport: "cloudflare-ai-chat", basePath: "agent", instance: "member-1" },
};

const validOperationsStats = {
  day: "2026-07-26",
  days: ["2026-07-26", "2026-07-25"],
  totals: { requests: 8, errors: 1, fallbacks: 1, rateLimited: 1, errorRate: 12.5 },
  trend: [
    { day: "2026-07-26", requests: 5, errors: 1, fallbacks: 1, rateLimited: 1, errorRate: 20 },
    { day: "2026-07-25", requests: 3, errors: 0, fallbacks: 0, rateLimited: 0, errorRate: 0 },
  ],
  routeStats: [{
    id: "primary",
    label: "Primary",
    model: "model-a",
    ok7d: 7,
    error7d: 1,
    errorRate7d: 12.5,
    days: [
      { day: "2026-07-26", ok: 4, error: 1 },
      { day: "2026-07-25", ok: 3, error: 0 },
    ],
  }],
  users: [{
    label: "bill",
    enabled: true,
    displayName: "Bill",
    used: 5,
    dailyLimit: 10,
    remaining: 5,
    defaultRoute: "primary",
    allowedRoutes: ["primary"],
    allowBringYourOwnKey: false,
    hasSystemPrompt: false,
    systemPromptChars: 0,
    activeSessions: 2,
    memoryChars: 120,
    requests7d: 8,
    errors7d: 1,
    errorRate7d: 12.5,
    usageByDay: [
      { day: "2026-07-26", used: 5 },
      { day: "2026-07-25", used: 3 },
    ],
  }],
  routes: [{
    id: "primary",
    enabled: true,
    label: "Primary",
    type: "openai-chat",
    model: "model-a",
    baseUrl: "https://provider.example/v1",
    apiKeyRef: "PRIMARY_KEY",
    requiresUserKey: false,
    supportsImages: true,
  }],
  configSource: "kv",
  accessCodeSource: "managed",
};

const validSetupStatus = {
  ready: false,
  configSource: "kv",
  steps: {
    health: { ready: true, status: "ready", count: 3 },
    provider: { ready: true, status: "ready", count: 1 },
    model: { ready: true, status: "ready", count: 1 },
    member: { ready: true, status: "ready", count: 1 },
    permission: { ready: true, status: "ready", count: 1 },
    smoke: { ready: false, status: "not_run", count: 0 },
  },
};

describe("admin logout client contract", () => {
  afterEach(() => vi.restoreAllMocks());

  it("accepts only an exact successful revocation response", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    await expect(adminLogout()).resolves.toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("/api/admin/logout");
    expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({ method: "POST", credentials: "include", cache: "no-store" });
  });

  it("rejects network failures without pretending the session was revoked", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("offline"));

    await expect(adminLogout()).rejects.toMatchObject<ApiError>({ code: "network_unavailable", status: 0 });
  });

  it("rejects server failures with the structured API error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      error: "internal_error",
      message: "管理员会话撤销失败。",
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    }));

    await expect(adminLogout()).rejects.toMatchObject<ApiError>({
      code: "internal_error",
      message: "管理员会话撤销失败。",
      status: 500,
    });
  });

  it("rejects false, non-exact, and non-JSON 2xx responses", async () => {
    const responses = [
      new Response(JSON.stringify({ ok: false }), { status: 200, headers: { "Content-Type": "application/json" } }),
      new Response(JSON.stringify({ ok: true, extra: true }), { status: 200, headers: { "Content-Type": "application/json" } }),
      new Response("", { status: 200 }),
    ];
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => responses.shift()!);

    for (let index = 0; index < 3; index += 1) {
      await expect(adminLogout()).rejects.toMatchObject<ApiError>({
        code: "invalid_admin_logout_response",
        status: 502,
      });
    }
  });
});

describe("admin setup client contract", () => {
  afterEach(() => vi.restoreAllMocks());

  it("accepts only the exact finite setup projection", () => {
    expect(isAdminSetupStatus(validSetupStatus)).toBe(true);
    expect(isAdminSetupStatus({ ...validSetupStatus, secret: "leak" })).toBe(false);
    expect(isAdminSetupStatus({
      ...validSetupStatus,
      steps: {
        ...validSetupStatus.steps,
        provider: { ...validSetupStatus.steps.provider, apiKeyRef: "PRIVATE_KEY" },
      },
    })).toBe(false);
    expect(isAdminSetupStatus({
      ...validSetupStatus,
      steps: {
        ...validSetupStatus.steps,
        smoke: { ready: false, status: "pending", count: 0 },
      },
    })).toBe(false);
    expect(isAdminSetupStatus({ ...validSetupStatus, ready: true })).toBe(false);
    expect(isAdminSetupStatus({
      ...validSetupStatus,
      steps: {
        ...validSetupStatus.steps,
        model: { ready: true, status: "ready", count: "1" },
      },
    })).toBe(false);
  });

  it("loads setup status and runs smoke through credentialed no-store requests", async () => {
    const completed = {
      ...validSetupStatus,
      ready: true,
      steps: {
        ...validSetupStatus.steps,
        smoke: { ready: true, status: "ready", count: 1 },
      },
    };
    const responses = [validSetupStatus, completed];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(
      JSON.stringify(responses.shift()),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));

    await expect(fetchAdminSetupStatus()).resolves.toEqual(validSetupStatus);
    await expect(runAdminSetupSmoke()).resolves.toEqual(completed);
    expect(fetchSpy.mock.calls[0]).toEqual([
      "/api/admin/setup-status",
      expect.objectContaining({ credentials: "include", cache: "no-store" }),
    ]);
    expect(fetchSpy.mock.calls[1]).toEqual([
      "/api/admin/setup-smoke",
      expect.objectContaining({ method: "POST", credentials: "include", cache: "no-store" }),
    ]);
  });

  it("rejects malformed status and smoke responses", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
      JSON.stringify({ ...validSetupStatus, model: "private-model-name" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));
    await expect(fetchAdminSetupStatus()).rejects.toMatchObject<ApiError>({
      code: "invalid_admin_setup_status_response",
      status: 502,
    });
    await expect(runAdminSetupSmoke()).rejects.toMatchObject<ApiError>({
      code: "invalid_admin_setup_smoke_response",
      status: 502,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe("React client runtime validation", () => {
  it("validates the admin session and capability configuration boundary", () => {
    expect(isAdminSessionProjection({ authenticated: true })).toBe(true);
    expect(isAdminSessionProjection({ authenticated: "true" })).toBe(false);
    expect(isAdminConfigSnapshot({ config: validAdminConfig, source: "kv", revision: "a".repeat(64) })).toBe(true);
    expect(isAdminConfigSnapshot({ config: { ...validAdminConfig, routes: [] }, source: "kv", revision: "a" })).toBe(false);
    expect(isAdminConfigSnapshot({
      config: {
        ...validAdminConfig,
        providers: { shared: { ...validAdminConfig.providers.shared, apiKey: "secret" } },
      },
      source: "kv",
      revision: "a",
    })).toBe(false);
    expect(isAdminConfigSnapshot({
      config: {
        ...validAdminConfig,
        publicAccess: { ...validAdminConfig.publicAccess, routeId: "missing" },
      },
      source: "kv",
      revision: "a",
    })).toBe(false);
    expect(isAdminConfigSnapshot({
      config: {
        ...validAdminConfig,
        publicAccess: { ...validAdminConfig.publicAccess, sessionTtlSeconds: 899 },
      },
      source: "kv",
      revision: "a",
    })).toBe(false);
    expect(isAdminConfigSnapshot({
      config: {
        ...validAdminConfig,
        publicAccess: { ...validAdminConfig.publicAccess, enabled: false, routeId: "" },
      },
      source: "kv",
      revision: "a",
    })).toBe(true);
    expect(isAdminConfigSnapshot({
      config: {
        ...validAdminConfig,
        providers: { shared: { ...validAdminConfig.providers.shared, headers: { Authorization: "secret" } } },
      },
      source: "kv",
      revision: "a",
    })).toBe(false);
    expect(isAdminConfigSnapshot({
      config: {
        ...validAdminConfig,
        users: { bill: { allowedSkills: ["missing"] } },
      },
      source: "kv",
      revision: "a",
    })).toBe(false);
    expect(isAdminConfigSnapshot({
      config: {
        ...validAdminConfig,
        users: { bill: { allowedRoutes: ["missing"] } },
      },
      source: "kv",
      revision: "a",
    })).toBe(false);
    expect(isAdminConfigSnapshot({
      config: {
        ...validAdminConfig,
        routes: { primary: { ...validAdminConfig.routes.primary, enabled: false } },
      },
      source: "kv",
      revision: "a",
    })).toBe(false);
    expect(isAdminConfigSnapshot({
      config: {
        ...validAdminConfig,
        skills: { coding: { ...validAdminConfig.skills.coding, label: " " } },
      },
      source: "kv",
      revision: "a",
    })).toBe(false);
    expect(isAdminConfigSnapshot({
      config: {
        ...validAdminConfig,
        mcpServers: {
          docs: { enabled: true, label: "Docs", endpoint: "https://docs.example/mcp", authType: "none", secretRef: "DOCS_MCP" },
        },
      },
      source: "kv",
      revision: "a",
    })).toBe(false);
  });

  it("validates a secret-free member projection with unique labels", () => {
    expect(isAdminMemberListResponse({
      members: [{ label: "bill", displayName: "Bill", configured: true, hasAccessCode: true }],
      accessRevision: "a".repeat(64),
      accessSource: "kv",
    })).toBe(true);
    expect(isAdminMemberListResponse({
      members: [],
      accessRevision: "b".repeat(64),
      accessSource: "managed",
    })).toBe(true);
    expect(isAdminMemberListResponse({
      members: [
        { label: "bill", displayName: "Bill", configured: true, hasAccessCode: true },
        { label: "bill", displayName: "Bill", configured: false, hasAccessCode: false },
      ],
      accessRevision: "a".repeat(64),
      accessSource: "kv",
    })).toBe(false);
    expect(isAdminMemberListResponse({
      members: [{ label: "bill", displayName: "Bill", configured: true, hasAccessCode: true, code: "secret" }],
      accessRevision: "a".repeat(64),
      accessSource: "kv",
    })).toBe(false);
    expect(isAdminMemberListResponse({
      members: [{ label: "bill", displayName: "Bill", configured: true, hasAccessCode: true }],
      accessRevision: "a".repeat(64),
      accessSource: "kv",
      accessCode: "secret",
    })).toBe(false);
    expect(isAdminMemberListResponse({
      members: [{ label: "bill", displayName: "Bill", configured: true, hasAccessCode: true }],
      accessRevision: "a".repeat(64),
      accessSource: "default",
    })).toBe(false);
  });

  it("validates coherent exact operations statistics", () => {
    expect(isAdminOperationsStats(validOperationsStats)).toBe(true);
    expect(isAdminOperationsStats({ ...validOperationsStats, token: "secret" })).toBe(false);
    expect(isAdminOperationsStats({
      ...validOperationsStats,
      day: "2026-02-31",
      days: ["2026-02-31", "2026-02-28"],
    })).toBe(false);
    expect(isAdminOperationsStats({
      ...validOperationsStats,
      trend: [...validOperationsStats.trend].reverse(),
    })).toBe(false);
    expect(isAdminOperationsStats({
      ...validOperationsStats,
      totals: { ...validOperationsStats.totals, requests: 9 },
    })).toBe(false);
    expect(isAdminOperationsStats({
      ...validOperationsStats,
      routeStats: [{ ...validOperationsStats.routeStats[0], ok7d: 8 }],
    })).toBe(false);
    expect(isAdminOperationsStats({
      ...validOperationsStats,
      routeStats: [],
    })).toBe(false);
    expect(isAdminOperationsStats({
      ...validOperationsStats,
      users: [{ ...validOperationsStats.users[0], used: 4 }],
    })).toBe(false);
    expect(isAdminOperationsStats({
      ...validOperationsStats,
      routes: [{ ...validOperationsStats.routes[0], apiKeyRef: "sk-secret" }],
    })).toBe(false);
    expect(isAdminOperationsStats({
      ...validOperationsStats,
      routes: [{ ...validOperationsStats.routes[0], apiKey: "secret" }],
    })).toBe(false);
  });

  it("accepts only exact secret-free audit and feedback metadata", () => {
    const auditEntry = {
      id: "audit-1",
      action: "config.update",
      target: "primary",
      at: "2026-07-26T08:00:00.000Z",
    };
    expect(isAdminAuditSnapshot({ entries: [auditEntry] })).toBe(true);
    expect(isAdminAuditSnapshot({ entries: [auditEntry, auditEntry] })).toBe(false);
    expect(isAdminAuditSnapshot({ entries: [{ ...auditEntry, token: "secret" }] })).toBe(false);

    const feedbackEntry = {
      id: "bill:chat-1:message-1",
      label: "bill",
      rating: "down",
      reason: "inaccurate",
      routeId: "primary",
      chatId: "chat-1",
      messageId: "message-1",
      at: "2026-07-26T08:10:00.000Z",
    };
    expect(isAdminFeedbackSnapshot({ entries: [feedbackEntry] })).toBe(true);
    expect(isAdminFeedbackSnapshot({ entries: [feedbackEntry, feedbackEntry] })).toBe(false);
    expect(isAdminFeedbackSnapshot({ entries: [{ ...feedbackEntry, message: "private content" }] })).toBe(false);
    expect(isAdminFeedbackSnapshot({ entries: [{ ...feedbackEntry, reason: "raw-model-output" }] })).toBe(false);
  });

  it("accepts access codes only in exact one-time credential responses", () => {
    const member = { label: "bill", displayName: "Bill", configured: true, hasAccessCode: true };
    const credential = {
      member,
      accessCode: "generated-access-code",
      accessRevision: "b".repeat(64),
      sessionRevocation: { revoked: 2, complete: true },
    };
    expect(isAdminMemberCredentialResponse(credential)).toBe(true);
    expect(isAdminMemberCredentialResponse({ ...credential, accessCode: "" })).toBe(false);
    expect(isAdminMemberCredentialResponse({ ...credential, secret: "extra" })).toBe(false);
    expect(isAdminMemberCredentialResponse({
      ...credential,
      member: { ...member, token: "extra" },
    })).toBe(false);
    expect(isAdminMemberCredentialResponse({
      ...credential,
      sessionRevocation: { revoked: 2, complete: true, token: "extra" },
    })).toBe(false);

    const revoked = {
      member: null,
      accessRevision: "c".repeat(64),
      sessionRevocation: { revoked: 1, complete: true },
    };
    expect(isAdminMemberRevokeResponse(revoked)).toBe(true);
    expect(isAdminMemberRevokeResponse({ ...revoked, accessCode: "must-not-appear" })).toBe(false);
    expect(isAdminMemberRevokeResponse({ ...revoked, sessionRevocation: { revoked: -1, complete: true } })).toBe(false);
  });

  it("validates member configuration removal and session revocation responses", () => {
    const member = { label: "bill", displayName: "Bill", configured: false, hasAccessCode: true };
    const removal = {
      member,
      config: validAdminConfig,
      source: "kv",
      revision: "d".repeat(64),
    };
    expect(isAdminMemberConfigRemovalResponse(removal)).toBe(true);
    expect(isAdminMemberConfigRemovalResponse({ ...removal, member: null, accessCode: "secret" })).toBe(false);
    expect(isAdminMemberConfigRemovalResponse({
      ...removal,
      config: { ...validAdminConfig, providers: { shared: { ...validAdminConfig.providers.shared, apiKey: "secret" } } },
    })).toBe(false);
    expect(isAdminMemberConfigRemovalResponse({ ...removal, source: "secret" })).toBe(false);

    const sessions = { ok: true, label: "bill", revoked: 3, complete: true };
    expect(isAdminMemberSessionsResponse(sessions)).toBe(true);
    expect(isAdminMemberSessionsResponse({ ...sessions, token: "secret" })).toBe(false);
    expect(isAdminMemberSessionsResponse({ ...sessions, revoked: -1 })).toBe(false);

    const usageReset = { ok: true, label: "bill", day: "2026-07-26" };
    expect(isAdminUsageResetResponse(usageReset)).toBe(true);
    expect(isAdminUsageResetResponse({ ...usageReset, token: "secret" })).toBe(false);
    expect(isAdminUsageResetResponse({ ...usageReset, ok: false })).toBe(false);
    expect(isAdminUsageResetResponse({ ...usageReset, label: " " })).toBe(false);
    expect(isAdminUsageResetResponse({ ...usageReset, day: "2026-02-31" })).toBe(false);
  });

  it("accepts only the secret-free user data mutation envelope", () => {
    expect(isUserDataMutationResponse({ ok: true, revoked: 2 })).toBe(true);
    expect(isUserDataMutationResponse({ ok: true, revoked: 0, accessCode: "secret" })).toBe(false);
    expect(isUserDataMutationResponse({ ok: false, revoked: 0 })).toBe(false);
    expect(isUserDataMutationResponse({ ok: true, revoked: -1 })).toBe(false);
  });

  it("accepts only the exact bounded user data export schema", () => {
    const exported = {
      schema: "chatus-user-data",
      version: 1,
      exportedAt: "2026-07-23T00:00:00.000Z",
      account: { label: "bill" },
      memory: { text: "prefers concise answers", updatedAt: 10 },
      conversations: [{
        id: "chat-1",
        title: "Release notes",
        createdAt: 10,
        updatedAt: 20,
        summary: "",
        pinned: false,
        routeId: "primary",
        skillIds: ["coding"],
        messageCount: 2,
        messages: [
          { id: "message-1", role: "user", parts: [{ type: "text", text: "Draft release notes" }] },
          { id: "message-2", role: "assistant", parts: [{ type: "file", mediaType: "text/plain", name: "notes.txt" }] },
        ],
        messagesTruncated: false,
      }],
      truncated: false,
    };
    expect(isUserDataExport(exported)).toBe(true);
    expect(isUserDataExport({ ...exported, accessCode: "secret" })).toBe(false);
    expect(isUserDataExport({ ...exported, account: { label: "bill", token: "secret" } })).toBe(false);
    expect(isUserDataExport({
      ...exported,
      conversations: [{ ...exported.conversations[0], providerCredential: "secret" }],
    })).toBe(false);
    expect(isUserDataExport({
      ...exported,
      conversations: [{
        ...exported.conversations[0],
        messages: [{ id: "message-1", role: "user", parts: [{ type: "file", mediaType: "text/plain", url: "private" }] }],
      }],
    })).toBe(false);
    expect(isUserDataExport({ ...exported, truncated: "false" })).toBe(false);
  });

  it("parses and validates the export response before returning a download", async () => {
    const valid = {
      schema: "chatus-user-data",
      version: 1,
      exportedAt: "2026-07-23T00:00:00.000Z",
      account: { label: "bill" },
      memory: { text: "", updatedAt: 0 },
      conversations: [],
      truncated: false,
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify(valid), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    }));
    const result = await exportUserData();
    expect(result.truncated).toBe(false);
    await expect(result.blob.text()).resolves.toContain('"schema":"chatus-user-data"');

    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ ...valid, accessCode: "secret" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    await expect(exportUserData()).rejects.toMatchObject({ code: "invalid_user_data_export_response", status: 502 });
    fetchSpy.mockRestore();
  });

  it("accepts a complete authenticated session projection", () => {
    expect(isSessionProjection(validSession)).toBe(true);
  });

  it("accepts an authenticated degraded state with no configured route", () => {
    expect(isSessionProjection({ ...validSession, routes: [], defaultRoute: "" })).toBe(true);
  });

  it("requires the complete session policy projection", () => {
    expect(isSessionProjection({ ...validSession, access: undefined })).toBe(false);
    expect(isSessionProjection({ ...validSession, access: "anonymous" })).toBe(false);
    expect(isSessionProjection({ ...validSession, capabilities: undefined })).toBe(false);
    expect(isSessionProjection({ ...validSession, capabilities: { ...validSession.capabilities, memory: "yes" } })).toBe(false);
    expect(isSessionProjection({ ...validSession, capabilities: { ...validSession.capabilities, extra: true } })).toBe(false);
    expect(isSessionProjection({ ...validSession, allowBringYourOwnKey: undefined })).toBe(false);
    expect(isSessionProjection({ ...validSession, hasUserSystemPrompt: undefined })).toBe(false);
    expect(isSessionProjection({ ...validSession, allowBringYourOwnKey: "no" })).toBe(false);
    expect(isSessionProjection({ ...validSession, hasUserSystemPrompt: 1 })).toBe(false);
    expect(isSessionProjection({ ...validSession, imageInput: undefined })).toBe(false);
    expect(isSessionProjection({
      ...validSession,
      imageInput: { ...validSession.imageInput, maxTotalImageBytes: 0 },
    })).toBe(false);
    expect(isSessionProjection({
      ...validSession,
      imageInput: { ...validSession.imageInput, acceptedMediaTypes: ["image/png", "image/svg+xml"] },
    })).toBe(false);
    expect(isSessionProjection({ ...validSession, fileInput: undefined })).toBe(false);
    expect(isSessionProjection({
      ...validSession,
      capabilities: { ...validSession.capabilities, fileInput: "yes" },
    })).toBe(false);
    expect(isSessionProjection({
      ...validSession,
      fileInput: { ...validSession.fileInput, maxFiles: 0 },
    })).toBe(false);
    expect(isSessionProjection({
      ...validSession,
      fileInput: { ...validSession.fileInput, acceptedExtensions: [".txt", ".exe"] },
    })).toBe(false);
    expect(isSessionProjection({
      ...validSession,
      fileInput: { ...validSession.fileInput, extra: true },
    })).toBe(false);
  });

  it("accepts an explicit restricted guest projection", () => {
    expect(isSessionProjection({
      ...validSession,
      access: "guest",
      user: "guest-public",
      displayName: "访客",
      routes: [{ ...validSession.routes[0], supportsTools: false }],
      allowBringYourOwnKey: false,
      hasUserSystemPrompt: false,
      skills: [],
      tools: [],
      capabilities: {
        imageInput: true,
        fileInput: false,
        memory: false,
        messageActions: false,
        feedback: false,
        accountData: false,
      },
    })).toBe(true);
  });

  it("accepts a controlled unavailable guest projection", () => {
    expect(isSessionProjection({
      ...validSession,
      access: "guest",
      user: "guest-public",
      displayName: "访客",
      routes: [],
      defaultRoute: "",
      allowBringYourOwnKey: false,
      hasUserSystemPrompt: false,
      skills: [],
      tools: [],
      capabilities: {
        imageInput: false,
        fileInput: false,
        memory: false,
        messageActions: false,
        feedback: false,
        accountData: false,
      },
    })).toBe(true);
  });

  it.each([
    ["multiple routes", { routes: [{ ...validSession.routes[0], supportsTools: false }, { ...validSession.routes[0], id: "backup", supportsTools: false }] }],
    ["BYOK", { allowBringYourOwnKey: true }],
    ["custom system prompt", { hasUserSystemPrompt: true }],
    ["member capability", { capabilities: { ...validSession.capabilities, memory: true } }],
    ["Skill projection", { skills: validSession.skills }],
    ["tool projection", { tools: validSession.tools }],
    ["tool-capable route", { routes: [{ ...validSession.routes[0], supportsTools: true }] }],
    ["mismatched default route", { defaultRoute: "backup" }],
    ["image policy mismatch", { routes: [{ ...validSession.routes[0], supportsImages: false, supportsTools: false }] }],
    ["file capability", { capabilities: { ...validSession.capabilities, memory: false, messageActions: false, feedback: false, accountData: false, fileInput: true } }],
  ])("rejects a guest projection with %s", (_label, override) => {
    expect(isSessionProjection({
      ...validSession,
      access: "guest",
      user: "guest-public",
      displayName: "访客",
      routes: [{ ...validSession.routes[0], supportsTools: false }],
      allowBringYourOwnKey: false,
      hasUserSystemPrompt: false,
      skills: [],
      tools: [],
      capabilities: {
        imageInput: true,
        fileInput: false,
        memory: false,
        messageActions: false,
        feedback: false,
        accountData: false,
      },
      ...override,
    })).toBe(false);
  });

  it.each([
    ["malformed usage", { ...validSession, usage: { used: -1, limit: 20, remaining: 21 } }],
    ["fractional usage", { ...validSession, usage: { used: 0.5, limit: 20, remaining: 19.5 } }],
    ["malformed route", { ...validSession, routes: [{ ...validSession.routes[0], supportsTools: "yes" }] }],
    ["missing default route", { ...validSession, defaultRoute: "missing" }],
    ["malformed Skill", { ...validSession, skills: [{ id: "coding", label: "Coding", toolIds: [1] }] }],
    ["unknown Skill tool", { ...validSession, skills: [{ id: "coding", label: "Coding", toolIds: ["missing"] }] }],
    ["malformed tool", { ...validSession, tools: [{ ...validSession.tools[0], source: "remote" }] }],
    ["malformed Agent transport", { ...validSession, agent: { ...validSession.agent, basePath: "" } }],
  ])("rejects %s", (_label, value) => {
    expect(isSessionProjection(value)).toBe(false);
  });

  it("validates conversation timestamps, counts, and selected Skills", () => {
    const conversation = {
      id: "chat-1",
      title: "Release notes",
      createdAt: 10,
      updatedAt: 20,
      summary: "",
      pinned: false,
      routeId: "primary",
      skillIds: ["coding"],
      messageCount: 2,
    };
    expect(isAgentConversation(conversation)).toBe(true);
    expect(isAgentConversation({ ...conversation, updatedAt: 9 })).toBe(false);
    expect(isAgentConversation({ ...conversation, messageCount: -1 })).toBe(false);
    expect(isAgentConversation({ ...conversation, skillIds: ["coding", "coding"] })).toBe(false);
  });

  it("validates secret-free branch responses and feedback envelopes", async () => {
    const conversation = {
      id: "branch-1",
      title: "Release notes · 分支",
      createdAt: 10,
      updatedAt: 20,
      summary: "",
      pinned: false,
      parentChatId: "chat-1",
      routeId: "primary",
      skillIds: ["coding"],
      messageCount: 2,
    };
    const branch = {
      ok: true,
      requestId: "branch-request-1",
      conversation,
      launch: "respond",
      anchorMessageId: "message-1",
    };
    expect(isAgentConversationBranchResult(branch)).toBe(true);
    expect(isAgentConversationBranchResult({ ...branch, accessCode: "secret" })).toBe(false);
    expect(isAgentConversationBranchResult({ ...branch, conversation: { ...conversation, messageCount: -1 } })).toBe(false);
    expect(isAgentConversationBranchResult({ ...branch, launch: "background" })).toBe(false);

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, rating: "up" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    await expect(submitFeedback({ rating: "up", routeId: "primary", chatId: "chat-1", messageId: "message-2" })).resolves.toBe("up");
    expect(fetchSpy).toHaveBeenCalledWith("/api/feedback", expect.objectContaining({ method: "POST" }));
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, rating: "up", accessCode: "secret" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    await expect(submitFeedback({ rating: "up", routeId: "primary", chatId: "chat-1", messageId: "message-2" })).rejects.toMatchObject({ code: "invalid_feedback_response" });
    fetchSpy.mockRestore();
  });

  it("validates memory revision and size metadata", () => {
    expect(isAgentMemory({ memory: "prefers concise answers", revision: "abc", updatedAt: 10, maxChars: 100 })).toBe(true);
    expect(isAgentMemory({ memory: "too long", revision: "abc", updatedAt: 10, maxChars: 2 })).toBe(false);
    expect(isAgentMemory({ memory: "ok", revision: "", updatedAt: 10, maxChars: 100 })).toBe(true);
    expect(isAgentMemory({ memory: "ok", revision: "abc", updatedAt: 10, maxChars: 1.5 })).toBe(false);
  });

  it("validates coherent secret-free stream reliability evidence", () => {
    const route = {
      routeId: "writer",
      model: "writer-v1",
      enabled: true,
      attempts: 4,
      successes: 3,
      averageLatencyMs: 240,
      lastOutcome: "success",
      observedAt: "2026-07-25T12:00:00.000Z",
      lastFallback: false,
      fallbackCount: 1,
      streamSamples: 3,
      progressiveSamples: 2,
      averageFirstVisibleLatencyMs: 85,
      lastFirstVisibleLatencyMs: 60,
      lastStreamShape: "progressive",
    };
    const snapshot = {
      generatedAt: "2026-07-25T12:00:01.000Z",
      providers: [{
        providerId: "shared",
        label: "Shared provider",
        enabled: true,
        credentialStatus: "configured",
        concurrency: "bounded",
        maxConcurrent: 2,
        queueTimeoutMs: 750,
        routes: [route],
      }],
    };

    expect(isAdminReliabilitySnapshot(snapshot)).toBe(true);
    expect(isAdminReliabilitySnapshot({
      ...snapshot,
      providers: [{ ...snapshot.providers[0], routes: [{ ...route, progressiveSamples: 4 }] }],
    })).toBe(false);
    expect(isAdminReliabilitySnapshot({
      ...snapshot,
      providers: [{ ...snapshot.providers[0], routes: [{ ...route, streamSamples: 4, progressiveSamples: 2 }] }],
    })).toBe(false);
    expect(isAdminReliabilitySnapshot({
      ...snapshot,
      providers: [{ ...snapshot.providers[0], routes: [{ ...route, lastStreamShape: "buffered" }] }],
    })).toBe(false);
    expect(isAdminReliabilitySnapshot({
      ...snapshot,
      providers: [{ ...snapshot.providers[0], routes: [{ ...route, firstVisibleLatencyMs: 60 }] }],
    })).toBe(false);
  });

  it("validates exact secret-free MCP secret metadata", () => {
    const item = {
      secretRef: "DOCS_MCP",
      source: "managed",
      status: "configured",
      managed: true,
      environmentFallback: false,
      updatedAt: "2026-07-26T12:00:00.000Z",
      revision: "revision-1",
    };
    expect(isAdminMcpSecretsSnapshot({ masterKeyReady: true, items: [item] })).toBe(true);
    expect(isAdminMcpSecretMutationResponse({ ok: true, item })).toBe(true);
    expect(isAdminMcpSecretsSnapshot({ masterKeyReady: true, items: [item, item] })).toBe(false);
    expect(isAdminMcpSecretsSnapshot({ masterKeyReady: true, items: [{ ...item, secret: "hidden" }] })).toBe(false);
    expect(isAdminMcpSecretMutationResponse({ ok: true, item: { ...item, source: "legacy" } })).toBe(false);
  });

  it("validates exact MCP discovery ownership and schema fingerprints", () => {
    const tool = {
      id: "mcp:docs:search",
      label: "Search",
      description: "Search docs",
      inputSchema: { type: "object", properties: {} },
      confirmation: "first-per-conversation",
      executor: { type: "mcp", serverId: "docs", remoteName: "search" },
      schemaFingerprint: "a".repeat(64),
    };
    expect(isAdminMcpDiscoveryResponse({ serverId: "docs", tools: [tool], rejected: 2 })).toBe(true);
    expect(isAdminMcpDiscoveryResponse({ serverId: "other", tools: [tool], rejected: 2 })).toBe(false);
    expect(isAdminMcpDiscoveryResponse({ serverId: "docs", tools: [{ ...tool, id: "mcp:docs:other" }], rejected: 2 })).toBe(false);
    expect(isAdminMcpDiscoveryResponse({ serverId: "docs", tools: [{ ...tool, schemaFingerprint: "A".repeat(64) }], rejected: 2 })).toBe(false);
    expect(isAdminMcpDiscoveryResponse({ serverId: "docs", tools: [{ ...tool, label: " " }], rejected: 2 })).toBe(false);
    expect(isAdminMcpDiscoveryResponse({ serverId: "docs", tools: [{ ...tool, id: "mcp:docs:bad:name", executor: { ...tool.executor, remoteName: "bad:name" } }], rejected: 2 })).toBe(false);
    expect(isAdminMcpDiscoveryResponse({ serverId: "docs", tools: [tool], rejected: 2, secret: "hidden" })).toBe(false);
  });
});
