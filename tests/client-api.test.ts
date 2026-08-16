import { afterEach, describe, expect, it, vi } from "vitest";
import {
  advanceAdminLegacySurface,
  adminLogout,
  ApiError,
  createAgentConversation,
  deleteWorkspaceFile,
  exportUserData,
  fetchAdminLegacySurfaces,
  fetchAdminLegacySurfaceCensus,
  fetchAdminSetupStatus,
  getAgentSkillSelectionMetadata,
  isAdminConfigSnapshot,
  isAdminLegacyRouteMigrationResponse,
  isAdminLegacySurfaceMutationResult,
  isAdminLegacySurfaceSnapshot,
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
  isMcpOAuthConnection,
  isMcpOAuthDiscoveryCandidate,
  isMcpOAuthRevokeResponse,
  isMcpOAuthStartResponse,
  isMcpOAuthStatusResponse,
  isMemberModelAvailability,
  isModelMonitorSnapshot,
  isAdminUsageResetResponse,
  isAdminOperationsStats,
  isAdminProviderFinanceSnapshot,
  isAdminReliabilitySnapshot,
  isAdminSessionProjection,
  isAdminSetupStatus,
  isAgentConversation,
  isAgentConversationBranchResult,
  isConversationGrantList,
  isAgentMemory,
  isSessionProjection,
  isWorkspaceFile,
  isWorkspaceFileVersion,
  listWorkspaceFiles,
  listConversationShares,
  logout,
  migrateAdminLegacyRoutes,
  retryWorkspaceDocumentIngest,
  rollbackAdminLegacySurface,
  revokeConversationShare,
  setConversationWorkspaceFiles,
  submitFeedback,
  isUserDataExport,
  isUserDataMutationResponse,
  runAdminSetupSmoke,
  updateWorkspaceFile,
  updateAgentConversation,
  upsertConversationShare,
  uploadWorkspaceFile,
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
  mcpConnections: [{
    serverId: "docs",
    label: "Docs",
    connected: true,
    reviewRequired: false,
    grantedScopes: ["mcp.read"],
    expiresAt: 2_000_000_000_000,
    status: "connected",
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

const legacySurfaceProjection = {
  version: 1 as const,
  surfaceId: "legacy.surface-alpha",
  revision: 0,
  manifestVersion: 1,
  manifestDigest: "a".repeat(64),
  phase: "discovered" as const,
  readControl: "enabled" as const,
  writeControl: "enabled" as const,
  owner: "unassigned" as const,
  blockerCodes: ["maximum_phase_reached" as const, "owner_unassigned" as const],
  observationStartedAt: 0,
  observationRequiredUntil: 0,
  lastTransitionAt: 0,
  lastDeploymentSha: "",
  evidence: { required: 0, present: 0, complete: true },
  allowedActions: [],
};

const legacySurfaceSnapshot = {
  version: 1 as const,
  manifestDigest: legacySurfaceProjection.manifestDigest,
  generatedAt: 1_785_032_000_000,
  total: 1,
  surfaces: [legacySurfaceProjection],
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

describe("member logout client contract", () => {
  afterEach(() => vi.restoreAllMocks());

  it("accepts only an exact successful revocation response", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    await expect(logout()).resolves.toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("/api/logout");
    expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({ method: "POST", credentials: "include", cache: "no-store" });
  });

  it("rejects network failures without pretending the session was revoked", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("offline"));

    await expect(logout()).rejects.toMatchObject<ApiError>({ code: "network_unavailable", status: 0 });
  });

  it("rejects server failures with the structured API error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      error: "internal_error",
      message: "成员会话撤销失败。",
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    }));

    await expect(logout()).rejects.toMatchObject<ApiError>({
      code: "internal_error",
      message: "成员会话撤销失败。",
      status: 500,
    });
  });

  it("rejects false, non-exact, empty, and non-JSON 2xx responses", async () => {
    const responses = [
      new Response(JSON.stringify({ ok: false }), { status: 200, headers: { "Content-Type": "application/json" } }),
      new Response(JSON.stringify({ ok: true, extra: true }), { status: 200, headers: { "Content-Type": "application/json" } }),
      new Response("", { status: 200 }),
      new Response("not-json", { status: 200, headers: { "Content-Type": "text/plain" } }),
    ];
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => responses.shift()!);

    for (let index = 0; index < 4; index += 1) {
      await expect(logout()).rejects.toMatchObject<ApiError>({
        code: "invalid_logout_response",
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

describe("legacy route migration client contract", () => {
  afterEach(() => vi.restoreAllMocks());

  const migrationResponse = {
    revision: "b".repeat(64),
    migrated: ["primary"],
    alreadyMigrated: [],
    statuses: [{ routeId: "primary", status: "migrated" as const }],
  };

  it("decodes only the bounded secret-free migration envelope", () => {
    expect(isAdminLegacyRouteMigrationResponse(migrationResponse)).toBe(true);
    expect(isAdminLegacyRouteMigrationResponse({ ...migrationResponse, secret: "key" })).toBe(false);
    expect(isAdminLegacyRouteMigrationResponse({ ...migrationResponse, config: validAdminConfig })).toBe(false);
    expect(isAdminLegacyRouteMigrationResponse({ ...migrationResponse, source: "kv" })).toBe(false);
    expect(isAdminLegacyRouteMigrationResponse({ ...migrationResponse, endpoint: "https://private.example" })).toBe(false);
    expect(isAdminLegacyRouteMigrationResponse({
      ...migrationResponse,
      statuses: [{ routeId: "primary", status: "blocked", reason: "credential_unavailable", endpoint: "https://private.example" }],
    })).toBe(false);
    expect(isAdminLegacyRouteMigrationResponse({
      ...migrationResponse,
      statuses: [{ routeId: "primary", status: "migrated", reason: "credential_unavailable" }],
    })).toBe(false);
  });

  it("posts route IDs and revision through the credentialed no-store boundary", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(migrationResponse), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    await expect(migrateAdminLegacyRoutes(["primary"], "a".repeat(64))).resolves.toEqual(migrationResponse);
    expect(fetchSpy).toHaveBeenCalledWith("/api/admin/legacy-routes/migrate", expect.objectContaining({
      method: "POST",
      credentials: "include",
      cache: "no-store",
      body: JSON.stringify({ routeIds: ["primary"], expectedRevision: "a".repeat(64) }),
    }));
  });

  it("preserves bounded per-route reasons on an atomic block", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      error: "legacy_route_migration_blocked",
      message: "迁移已取消。",
      statuses: [{ routeId: "primary", status: "blocked", reason: "inline_credential_only" }],
    }), { status: 422, headers: { "Content-Type": "application/json" } }));
    await expect(migrateAdminLegacyRoutes(["primary"], "a".repeat(64))).rejects.toMatchObject<ApiError>({
      code: "legacy_route_migration_blocked",
      status: 422,
      details: { legacyRouteStatuses: [{ routeId: "primary", status: "blocked", reason: "inline_credential_only" }] },
    });
  });
});

describe("legacy surface control-plane client contract", () => {
  afterEach(() => vi.restoreAllMocks());

  it("accepts only bounded exact sorted snapshots and mutation results", () => {
    expect(isAdminLegacySurfaceSnapshot(legacySurfaceSnapshot)).toBe(true);
    expect(isAdminLegacySurfaceSnapshot({ ...legacySurfaceSnapshot, token: "secret" })).toBe(false);
    expect(isAdminLegacySurfaceSnapshot({ ...legacySurfaceSnapshot, manifestDigest: "A".repeat(64) })).toBe(false);
    expect(isAdminLegacySurfaceSnapshot({ ...legacySurfaceSnapshot, total: 0 })).toBe(false);
    expect(isAdminLegacySurfaceSnapshot({
      ...legacySurfaceSnapshot,
      surfaces: [{ ...legacySurfaceProjection, prompt: "secret" }],
    })).toBe(false);
    expect(isAdminLegacySurfaceSnapshot({
      ...legacySurfaceSnapshot,
      surfaces: [{ ...legacySurfaceProjection, phase: "read_disabled", readControl: "enabled" }],
    })).toBe(false);
    expect(isAdminLegacySurfaceSnapshot({
      ...legacySurfaceSnapshot,
      total: 2,
      surfaces: [
        { ...legacySurfaceProjection, surfaceId: "legacy.surface-beta" },
        legacySurfaceProjection,
      ],
    })).toBe(false);
    expect(isAdminLegacySurfaceSnapshot({
      ...legacySurfaceSnapshot,
      total: 2,
      surfaces: [legacySurfaceProjection, legacySurfaceProjection],
    })).toBe(false);
    expect(isAdminLegacySurfaceSnapshot({
      ...legacySurfaceSnapshot,
      total: 101,
      surfaces: [],
    })).toBe(false);

    const mutation = {
      ok: true,
      replayed: false,
      projection: { ...legacySurfaceProjection, revision: 1, phase: "instrumented" },
    };
    expect(isAdminLegacySurfaceMutationResult(mutation)).toBe(true);
    expect(isAdminLegacySurfaceMutationResult({ ...mutation, credential: "secret" })).toBe(false);
    expect(isAdminLegacySurfaceMutationResult({ ...mutation, replayed: "false" })).toBe(false);
  });

  it("strictly decodes list, advance, and rollback HTTP responses", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify(legacySurfaceSnapshot), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    await expect(fetchAdminLegacySurfaces(1)).resolves.toEqual(legacySurfaceSnapshot);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("/api/admin/legacy-surfaces?limit=1");

    const censusLastOccurredAt = 1_785_031_200_100;
    const census = {
      version: 1,
      surfaceId: legacySurfaceProjection.surfaceId,
      generatedAt: 1_785_032_000_100,
      days: 30,
      rows: [{
        day: new Date(censusLastOccurredAt).toISOString().slice(0, 10),
        callerClass: "worker_api",
        access: "write",
        count: 2,
        lastOccurredAt: censusLastOccurredAt,
        deploymentSha: "a".repeat(40),
      }],
    } as const;
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify(census), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    await expect(fetchAdminLegacySurfaceCensus(legacySurfaceProjection.surfaceId, 30)).resolves.toEqual(census);
    expect(fetchSpy.mock.calls[1]?.[0]).toBe(
      "/api/admin/legacy-surfaces/legacy.surface-alpha/census?days=30",
    );

    const advanceInput = {
      version: 1 as const,
      surfaceId: legacySurfaceProjection.surfaceId,
      expectedRevision: 0,
      operationId: "advance-operation",
      targetPhase: "instrumented" as const,
      requestedAt: 1_785_032_000_100,
      evidence: [],
    };
    const advancedProjection = { ...legacySurfaceProjection, revision: 1, phase: "instrumented" as const };
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({
      ok: true,
      replayed: false,
      projection: advancedProjection,
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    await expect(advanceAdminLegacySurface(advanceInput)).resolves.toMatchObject({ projection: advancedProjection });
    expect(fetchSpy.mock.calls[2]?.[0]).toBe("/api/admin/legacy-surfaces/legacy.surface-alpha/advance");
    expect(JSON.parse(String(fetchSpy.mock.calls[2]?.[1]?.body))).toEqual(advanceInput);

    const rollbackInput = {
      version: 1 as const,
      surfaceId: legacySurfaceProjection.surfaceId,
      expectedRevision: 7,
      operationId: "rollback-operation",
      scope: "read" as const,
      reason: "runtime_regression" as const,
      requestedAt: 1_785_032_000_200,
      evidence: [{
        version: 1 as const,
        kind: "rollback_rehearsal" as const,
        evidenceId: "rollback-evidence",
        digest: "b".repeat(64),
        deploymentSha: "c".repeat(40),
        observedAt: 1_785_032_000_100,
        count: 1,
        result: "passed" as const,
      }],
    };
    const rolledBackProjection = {
      ...legacySurfaceProjection,
      revision: 8,
      phase: "recovery_proven" as const,
      writeControl: "disabled" as const,
      owner: "operations" as const,
      blockerCodes: [],
    };
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({
      ok: true,
      replayed: false,
      projection: rolledBackProjection,
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    await expect(rollbackAdminLegacySurface(rollbackInput)).resolves.toMatchObject({ projection: rolledBackProjection });
    expect(fetchSpy.mock.calls[3]?.[0]).toBe("/api/admin/legacy-surfaces/legacy.surface-alpha/rollback");
  });

  it("rejects malformed local requests and mismatched successful responses", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(fetchAdminLegacySurfaces(101)).rejects.toMatchObject({
      code: "invalid_legacy_surface_limit",
      status: 400,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    await expect(fetchAdminLegacySurfaceCensus(legacySurfaceProjection.surfaceId, 0)).rejects.toMatchObject({
      code: "invalid_legacy_surface_census_request",
      status: 400,
    });
    expect(fetchSpy).not.toHaveBeenCalled();

    const malformed = {
      version: 1,
      surfaceId: legacySurfaceProjection.surfaceId,
      expectedRevision: 0,
      operationId: "advance-operation",
      targetPhase: "instrumented",
      requestedAt: 1_785_032_000_100,
      evidence: [],
      notes: "must-not-send",
    };
    await expect(advanceAdminLegacySurface(malformed as never)).rejects.toMatchObject({
      code: "invalid_legacy_surface_request",
      status: 400,
    });
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({
      ok: true,
      replayed: false,
      projection: { ...legacySurfaceProjection, revision: 2, phase: "instrumented" },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    await expect(advanceAdminLegacySurface({
      version: 1,
      surfaceId: legacySurfaceProjection.surfaceId,
      expectedRevision: 0,
      operationId: "advance-operation",
      targetPhase: "instrumented",
      requestedAt: 1_785_032_000_100,
      evidence: [],
    })).rejects.toMatchObject({
      code: "invalid_admin_legacy_surface_mutation_response",
      status: 502,
    });

    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({
      ok: true,
      replayed: false,
      projection: {
        ...legacySurfaceProjection,
        revision: 8,
        phase: "shadowing",
        owner: "operations",
        blockerCodes: [],
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    await expect(rollbackAdminLegacySurface({
      version: 1,
      surfaceId: legacySurfaceProjection.surfaceId,
      expectedRevision: 7,
      operationId: "rollback-operation",
      scope: "read",
      reason: "runtime_regression",
      requestedAt: 1_785_032_000_200,
      evidence: [{
        version: 1,
        kind: "rollback_rehearsal",
        evidenceId: "rollback-evidence",
        digest: "b".repeat(64),
        deploymentSha: "c".repeat(40),
        observedAt: 1_785_032_000_100,
        count: 1,
        result: "passed",
      }],
    })).rejects.toMatchObject({
      code: "invalid_admin_legacy_surface_mutation_response",
      status: 502,
    });
  });
});

describe("workspace file client contract", () => {
  afterEach(() => vi.restoreAllMocks());

  const version = {
    id: "version-1",
    fileId: "file-1",
    size: 5,
    mediaType: "text/plain",
    checksum: "a".repeat(64),
    state: "ready" as const,
    ingestStatus: "ready" as const,
    ingestGeneration: 1,
    ingestAttempts: 1,
    createdAt: 10,
  };
  const file = {
    id: "file-1",
    path: "notes.txt",
    name: "notes.txt",
    pinned: false,
    state: "ready" as const,
    createdAt: 10,
    updatedAt: 20,
    currentVersion: version,
    retryAvailable: false,
    ingestRetryAvailable: false,
  };
  const conversation = {
    id: "chat-1",
    title: "Notes",
    createdAt: 10,
    updatedAt: 20,
    summary: "",
    pinned: false,
    skillMode: "manual" as const,
    skillIds: [],
    messageCount: 0,
    workspaceFiles: [],
  };
  const usage = {
    quotaBytes: 5,
    extractedBytes: 2,
    pendingCleanupBytes: 3,
    trackedBytes: 10,
    limitBytes: 250 * 1024 * 1024,
  };

  it("accepts only exact metadata-tracked usage arithmetic", async () => {
    const validPage = { files: [file], maxFileBytes: 10 * 1024 * 1024, usage };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify(validPage), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    await expect(listWorkspaceFiles()).resolves.toEqual(validPage);

    const invalidUsage = [
      { ...usage, objectKey: "private" },
      { ...usage, quotaBytes: -1, trackedBytes: 4 },
      { ...usage, extractedBytes: 1.5, trackedBytes: 9.5 },
      { ...usage, trackedBytes: 11 },
      {
        quotaBytes: Number.MAX_SAFE_INTEGER,
        extractedBytes: 1,
        pendingCleanupBytes: 0,
        trackedBytes: Number.MAX_SAFE_INTEGER,
        limitBytes: 250 * 1024 * 1024,
      },
    ];
    for (const invalid of invalidUsage) {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({
        files: [file],
        maxFileBytes: 10 * 1024 * 1024,
        usage: invalid,
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
      await expect(listWorkspaceFiles()).rejects.toMatchObject<ApiError>({
        code: "invalid_workspace_response",
        status: 502,
      });
    }

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({
      ...validPage,
      objectKey: "private",
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    await expect(listWorkspaceFiles()).rejects.toMatchObject<ApiError>({
      code: "invalid_workspace_response",
      status: 502,
    });
  });

  it("accepts every documented workspace mutation envelope", async () => {
    const responses = [
      { ok: true, file, existing: false },
      { ok: true },
      { ok: true, file },
      { ok: true, conversation },
      { ok: true, deleted: false, pending: true, message: "删除正在自动重试" },
    ];
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(
      JSON.stringify(responses.shift()),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));

    await expect(uploadWorkspaceFile({
      file: new File(["notes"], "notes.txt", { type: "text/plain" }),
      relativePath: "notes.txt",
      operationId: "upload-1",
    })).resolves.toEqual(file);
    await expect(retryWorkspaceDocumentIngest(file.id, version.id)).resolves.toBeUndefined();
    await expect(updateWorkspaceFile(file, { pinned: true })).resolves.toEqual(file);
    await expect(setConversationWorkspaceFiles(conversation, [])).resolves.toEqual(conversation);
    await expect(deleteWorkspaceFile(file, "delete-1")).resolves.toEqual({
      deleted: false,
      pending: true,
      message: "删除正在自动重试",
    });
  });

  it("rejects unknown workspace mutation response fields", async () => {
    const responses = [
      { ok: true, file, existing: false, objectKey: "private" },
      { ok: true, message: { ownerId: "private" } },
      { ok: true, file, objectKey: "private" },
      { ok: true, conversation, token: "private" },
      { ok: true, deleted: true, existing: false, objectKey: "private" },
    ];
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(
      JSON.stringify(responses.shift()),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));

    await expect(uploadWorkspaceFile({
      file: new File(["notes"], "notes.txt", { type: "text/plain" }),
      relativePath: "notes.txt",
      operationId: "upload-1",
    })).rejects.toMatchObject<ApiError>({ code: "invalid_workspace_response", status: 502 });
    await expect(retryWorkspaceDocumentIngest(file.id, version.id))
      .rejects.toMatchObject<ApiError>({ code: "invalid_workspace_response", status: 502 });
    await expect(updateWorkspaceFile(file, { pinned: true }))
      .rejects.toMatchObject<ApiError>({ code: "invalid_workspace_response", status: 502 });
    await expect(setConversationWorkspaceFiles(conversation, []))
      .rejects.toMatchObject<ApiError>({ code: "invalid_conversation_response", status: 502 });
    await expect(deleteWorkspaceFile(file, "delete-1"))
      .rejects.toMatchObject<ApiError>({ code: "invalid_workspace_response", status: 502 });
  });

  it("validates exact document ingest fields", () => {
    expect(isWorkspaceFileVersion(version)).toBe(true);
    expect(isWorkspaceFile(file)).toBe(true);
    expect(isWorkspaceFileVersion({ ...version, ingestStatus: "unknown" })).toBe(false);
    expect(isWorkspaceFileVersion({ ...version, ingestError: "x", ownerId: "private" })).toBe(false);
    expect(isWorkspaceFile({ ...file, ingestRetryAvailable: "true" })).toBe(false);
    expect(isWorkspaceFile({ ...file, ingestRetryAvailable: true })).toBe(false);
    expect(isWorkspaceFile({ ...file, currentVersion: { ...version, fileId: "other-file" } })).toBe(false);
    expect(isWorkspaceFile({
      ...file,
      currentVersion: { ...version, ingestStatus: "failed" },
      ingestRetryAvailable: true,
    })).toBe(true);
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

  it("accepts incomplete legacy MCP tools only in the fail-closed review state", () => {
    const legacyTool = {
      enabled: false,
      label: "Legacy lookup",
      inputSchema: { type: "object", properties: { query: { type: "string" } } },
      confirmation: "first-per-conversation",
      executor: { type: "mcp", serverId: "docs", remoteName: "lookup" },
      reviewRequired: true,
    };
    const snapshot = (tool: Record<string, unknown>) => ({
      config: {
        ...validAdminConfig,
        tools: { ...validAdminConfig.tools, "mcp:docs:lookup": tool },
        mcpServers: {
          docs: {
            enabled: true,
            label: "Docs",
            endpoint: "https://docs.example/mcp",
            auth: { version: 1, type: "none" },
          },
        },
      },
      source: "kv",
      revision: "a".repeat(64),
    });

    expect(isAdminConfigSnapshot(snapshot(legacyTool))).toBe(true);
    expect(isAdminConfigSnapshot(snapshot({ ...legacyTool, enabled: true }))).toBe(false);
    expect(isAdminConfigSnapshot(snapshot({ ...legacyTool, reviewRequired: false }))).toBe(false);
    expect(isAdminConfigSnapshot(snapshot({ ...legacyTool, reviewRequired: undefined }))).toBe(false);
    expect(isAdminConfigSnapshot(snapshot({ ...legacyTool, schemaFingerprint: "invalid" }))).toBe(false);
    expect(isAdminConfigSnapshot(snapshot({
      ...legacyTool,
      executor: { type: "mcp", serverId: "docs", remoteName: "invalid name" },
    }))).toBe(false);

    expect(isAdminConfigSnapshot(snapshot({
      ...legacyTool,
      enabled: true,
      schemaFingerprint: "b".repeat(64),
      securityFingerprint: "c".repeat(64),
      sideEffect: "read",
      reviewRevision: "d".repeat(64),
      reviewRequired: false,
    }))).toBe(true);
  });

  it("accepts invalid historical MCP execution metadata only while disabled", () => {
    const recoveryServer = {
      enabled: false,
      label: "Legacy OAuth",
      endpoint: "http://legacy-mcp.example/rpc",
      auth: {
        version: 1,
        type: "oauth2",
        issuer: "https://issuer.example",
        clientId: "legacy-client",
        scopes: [],
        callbackPath: "/api/mcp/oauth/callback",
        configRevision: "a".repeat(64),
      },
    };
    const snapshot = (server: Record<string, unknown>) => ({
      config: { ...validAdminConfig, mcpServers: { legacy: server } },
      source: "kv",
      revision: "a".repeat(64),
    });

    expect(isAdminConfigSnapshot(snapshot(recoveryServer))).toBe(true);
    expect(isAdminConfigSnapshot(snapshot({ ...recoveryServer, enabled: true }))).toBe(false);
    expect(isAdminConfigSnapshot(snapshot({ ...recoveryServer, endpoint: "" }))).toBe(false);
    expect(isAdminConfigSnapshot(snapshot({
      ...recoveryServer,
      auth: { ...recoveryServer.auth, issuer: "http://issuer.example" },
    }))).toBe(false);
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

  it("accepts exact content-free Provider finance evidence and rejects money ambiguity", () => {
    const attempt = {
      attemptId: "attempt_00000000-0000-4000-8000-000000000001",
      runKind: "main_answer",
      logicalRouteId: "reasoning",
      offeringId: "reasoning/provider-a",
      model: "model-a",
      fallbackIndex: 0,
      status: "succeeded",
      errorClass: "none",
      startedAt: 1_000,
      endedAt: 1_100,
      latencyMs: 100,
      priceResolution: "matched",
      catalogVersionId: "catalog-v1",
      usageState: "reported",
      usage: {
        inputNoCacheTokens: 100,
        cacheReadInputTokens: 0,
        cacheWriteInputTokens: 0,
        outputTextTokens: 20,
        reasoningOutputTokens: 0,
      },
      costState: "provisional",
      costs: [{ currency: "USD", provisionalMicros: 140, settledMicros: 0, correctedMicros: 0, totalMicros: 140 }],
    };
    const finance = {
      version: 1,
      generatedAt: 2_000,
      periodStart: 0,
      hardBudgetEnforcement: "instance_provider_v1",
      providers: [{
        version: 1,
        providerId: "provider-a",
        label: "Provider A",
        generatedAt: 2_000,
        periodStart: 0,
        capacity: {
          calls: 1,
          succeeded: 1,
          failures: 0,
          retries: 0,
          fallbacks: 0,
          averageLatencyMs: 100,
          unknownUsageAttempts: 0,
          provisionalCostAttempts: 1,
        },
        usage: attempt.usage,
        costs: [{ ...attempt.costs[0], unknownAttempts: 0 }],
        attempts: [attempt],
        reconciliations: [{
          version: 1,
          reconciliationId: "reconciliation-1",
          revision: 1,
          supersedesReconciliationId: null,
          fingerprint: `sha256:${"c".repeat(64)}`,
          providerId: "provider-a",
          accountFingerprint: `acct_sha256:${"d".repeat(64)}`,
          periodStart: 0,
          periodEnd: 1_000,
          currency: "USD",
          reportedTotalMicros: 140,
          matchedTotalMicros: 140,
          unmatchedVarianceMicros: 0,
          status: "matched",
          importedAt: 2_000,
        }],
        catalogs: [{
          version: 1,
          catalogVersionId: "catalog-v1",
          providerId: "provider-a",
          offeringId: "reasoning/provider-a",
          model: "model-a",
          currency: "USD",
          precision: 6,
          unit: "million_tokens",
          inputNoCachePriceMicros: 1_000_000,
          cacheReadInputPriceMicros: 0,
          cacheWriteInputPriceMicros: 0,
          outputTextPriceMicros: 2_000_000,
          reasoningOutputPriceMicros: 0,
          effectiveFrom: 0,
          effectiveTo: null,
          approver: "finance-admin",
          provenance: "provider-price-card",
          createdAt: 0,
        }],
        budgetPolicies: [{
          version: 1,
          policyId: "budget-a",
          providerId: "provider-a",
          currency: "USD",
          mode: "hard",
          periodStart: 0,
          periodEnd: 10_000,
          limitMicros: 1_000,
          maxAttemptReserveMicros: 400,
          holdReviewAfterMs: 259200000,
          allowUnknownPrice: false,
          approver: "finance-admin",
          createdAt: 0,
          expectedPreviousVersion: 0,
          policyVersion: 1,
        }],
        budgetBalances: [{
          version: 1,
          policyId: "budget-a",
          policyVersion: 1,
          providerId: "provider-a",
          currency: "USD",
          mode: "hard",
          periodStart: 0,
          periodEnd: 10_000,
          limitMicros: 1_000,
          settledMicros: 0,
          reservedMicros: 0,
          heldMicros: 400,
          availableMicros: 600,
          denialCount: 1,
          alertCount: 0,
          pendingSettlementCount: 0,
          reviewRequiredCount: 1,
          updatedAt: 2_000,
        }],
        budgetReservations: [{
          version: 1,
          reservationId: "reservation_00000000-0000-4000-8000-000000000001",
          attemptId: "attempt_00000000-0000-4000-8000-000000000001",
          policyId: "budget-a",
          policyVersion: 1,
          currency: "USD",
          status: "review_required",
          reservedMicros: 400,
          settledMicros: 0,
          releasedMicros: 0,
          heldMicros: 400,
          createdAt: 1_000,
          updatedAt: 2_000,
          reviewAfter: 2_000,
        }],
      }],
    };
    expect(isAdminProviderFinanceSnapshot(finance)).toBe(true);
    expect(isAdminProviderFinanceSnapshot({ ...finance, hardBudgetEnforcement: "enabled" })).toBe(false);
    expect(isAdminProviderFinanceSnapshot({
      ...finance,
      providers: [{
        ...finance.providers[0],
        budgetBalances: [{ ...finance.providers[0].budgetBalances[0], availableMicros: 1_000 }],
      }],
    })).toBe(false);
    expect(isAdminProviderFinanceSnapshot({
      ...finance,
      providers: [{
        ...finance.providers[0],
        budgetReservations: [{ ...finance.providers[0].budgetReservations[0], rawInvoice: "secret" }],
      }],
    })).toBe(false);
    expect(isAdminProviderFinanceSnapshot({
      ...finance,
      providers: [{ ...finance.providers[0], rawInvoice: "secret" }],
    })).toBe(false);
    expect(isAdminProviderFinanceSnapshot({
      ...finance,
      providers: [{
        ...finance.providers[0],
        attempts: [{ ...attempt, costs: [{ ...attempt.costs[0], totalMicros: 0 }] }],
      }],
    })).toBe(false);
    expect(isAdminProviderFinanceSnapshot({
      ...finance,
      providers: [{
        ...finance.providers[0],
        reconciliations: [{
          ...finance.providers[0].reconciliations[0],
          revision: 2,
          supersedesReconciliationId: null,
        }],
      }],
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
        skillMode: "manual",
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
      conversations: [{
        ...exported.conversations[0],
        workspaceFiles: [{
          fileId: "file-1",
          versionId: "version-1",
          path: "reference/notes.txt",
          name: "notes.txt",
          mediaType: "text/plain",
          size: 42,
          checksum: "a".repeat(64),
        }],
      }],
    })).toBe(false);
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
      mcpConnections: [],
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
      mcpConnections: [],
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
    ["MCP OAuth connection", { mcpConnections: validSession.mcpConnections }],
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
      mcpConnections: [],
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
      skillMode: "automatic",
      skillIds: ["coding"],
      messageCount: 2,
      workspaceFiles: [],
      resourceId: "res_11111111-1111-4111-8111-111111111111",
      accessRole: "owner",
      accessRevision: 1,
    };
    expect(isAgentConversation(conversation)).toBe(true);
    expect(isAgentConversation({ ...conversation, updatedAt: 9 })).toBe(false);
    expect(isAgentConversation({ ...conversation, messageCount: -1 })).toBe(false);
    expect(isAgentConversation({ ...conversation, skillMode: "scheduled" })).toBe(false);
    const { skillMode: _skillMode, ...missingMode } = conversation;
    expect(isAgentConversation(missingMode)).toBe(false);
    expect(isAgentConversation({ ...conversation, skillIds: ["coding", "coding"] })).toBe(false);
    expect(isAgentConversation({ ...conversation, objectKey: "private" })).toBe(false);
    expect(isAgentConversation({ ...conversation, accessRole: "viewer", workspaceFiles: [{ private: true }] })).toBe(false);
    expect(isAgentConversation({ ...conversation, accessRole: "viewer", parentChatId: "owner-branch" })).toBe(false);
    expect(isAgentConversation({ ...conversation, accessRole: "viewer", workspaceFiles: [] })).toBe(true);
    expect(isAgentConversation({ ...conversation, accessRole: undefined })).toBe(false);
  });

  it("decodes exact content-free conversation grants", () => {
    const grants = {
      version: 1,
      resourceId: "res_11111111-1111-4111-8111-111111111111",
      accessRevision: 3,
      grants: [{
        principalId: "prn_22222222-2222-4222-8222-222222222222",
        alias: "collaborator",
        role: "editor",
        grantRevision: 3,
        grantedAt: 10,
        updatedAt: 20,
      }],
    };
    expect(isConversationGrantList(grants)).toBe(true);
    expect(isConversationGrantList({ ...grants, ownerLabel: "private" })).toBe(false);
    expect(isConversationGrantList({ ...grants, grants: [{ ...grants.grants[0], role: "owner" }] })).toBe(false);
    expect(isConversationGrantList({ ...grants, grants: [grants.grants[0], grants.grants[0]] })).toBe(false);
  });

  it("decodes only bounded public automatic Skill metadata", () => {
    const metadata = {
      finishReason: "length",
      skillSelection: {
        mode: "automatic",
        source: "last_success",
        reason: "timeout",
        skills: [{ id: "coding", label: "Coding" }],
      },
    };
    expect(getAgentSkillSelectionMetadata(metadata)).toEqual(metadata.skillSelection);
    expect(getAgentSkillSelectionMetadata({
      skillSelection: { ...metadata.skillSelection, providerId: "private" },
    })).toBeUndefined();
    expect(getAgentSkillSelectionMetadata({
      skillSelection: { ...metadata.skillSelection, reason: "raw_provider_error" },
    })).toBeUndefined();
    expect(getAgentSkillSelectionMetadata({
      skillSelection: { ...metadata.skillSelection, skills: [metadata.skillSelection.skills[0], metadata.skillSelection.skills[0]] },
    })).toBeUndefined();
  });

  it("serializes conversation Skill mode create and manual clear mutations", async () => {
    const conversation = {
      id: "chat-mode",
      title: "Mode test",
      createdAt: 10,
      updatedAt: 20,
      summary: "",
      pinned: false,
      routeId: "primary",
      skillMode: "automatic" as const,
      skillIds: ["coding"],
      messageCount: 0,
      workspaceFiles: [],
      resourceId: "res_11111111-1111-4111-8111-111111111111",
      accessRole: "owner" as const,
      accessRevision: 1,
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, conversation }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    }));
    await expect(createAgentConversation({ routeId: "primary", skillMode: "automatic" }))
      .resolves.toEqual(conversation);
    expect(JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body))).toEqual({
      routeId: "primary",
      skillMode: "automatic",
    });

    const manual = { ...conversation, updatedAt: 21, skillMode: "manual" as const, skillIds: [] };
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, conversation: manual }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    await expect(updateAgentConversation(conversation, { skillMode: "manual", skillIds: [] }))
      .resolves.toEqual(manual);
    expect(JSON.parse(String((fetchSpy.mock.calls[1][1] as RequestInit).body))).toEqual({
      skillMode: "manual",
      skillIds: [],
      expectedUpdatedAt: 20,
      resourceId: conversation.resourceId,
    });
    fetchSpy.mockRestore();
  });

  it("serializes exact resource-scoped share mutations", async () => {
    const conversation = {
      id: "share-chat",
      title: "Shared work",
      createdAt: 10,
      updatedAt: 20,
      summary: "",
      pinned: false,
      routeId: "primary",
      skillMode: "automatic" as const,
      skillIds: [],
      messageCount: 0,
      workspaceFiles: [],
      resourceId: "res_11111111-1111-4111-8111-111111111111",
      accessRole: "owner" as const,
      accessRevision: 1,
    };
    const grants = {
      version: 1,
      resourceId: conversation.resourceId,
      accessRevision: 2,
      grants: [{
        principalId: "prn_22222222-2222-4222-8222-222222222222",
        alias: "collaborator",
        role: "viewer" as const,
        grantRevision: 2,
        grantedAt: 10,
        updatedAt: 10,
      }],
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify(grants), { status: 200, headers: { "Content-Type": "application/json" } }));
    await expect(listConversationShares(conversation)).resolves.toEqual(grants);
    expect(String(fetchSpy.mock.calls[0][0])).toContain(`resourceId=${encodeURIComponent(conversation.resourceId)}`);

    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, operationId: "share-op", changed: true, ...grants }), { status: 200, headers: { "Content-Type": "application/json" } }));
    await expect(upsertConversationShare({
      conversation,
      operationId: "share-op",
      granteeLabel: "collaborator",
      role: "viewer",
      expectedAccessRevision: 1,
    })).resolves.toMatchObject({ operationId: "share-op", accessRevision: 2 });
    expect(JSON.parse(String((fetchSpy.mock.calls[1][1] as RequestInit).body))).toEqual({
      version: 1,
      operationId: "share-op",
      resourceId: conversation.resourceId,
      granteeLabel: "collaborator",
      role: "viewer",
      expectedAccessRevision: 1,
    });

    const revoked = { ...grants, accessRevision: 3, grants: [] };
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, operationId: "revoke-op", changed: true, ...revoked }), { status: 200, headers: { "Content-Type": "application/json" } }));
    await expect(revokeConversationShare({
      conversation,
      operationId: "revoke-op",
      granteePrincipalId: grants.grants[0].principalId,
      expectedAccessRevision: 2,
    })).resolves.toMatchObject({ operationId: "revoke-op", accessRevision: 3, grants: [] });
    expect(JSON.parse(String((fetchSpy.mock.calls[2][1] as RequestInit).body))).toEqual({
      version: 1,
      operationId: "revoke-op",
      resourceId: conversation.resourceId,
      granteePrincipalId: grants.grants[0].principalId,
      expectedAccessRevision: 2,
    });
    fetchSpy.mockRestore();
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
      skillMode: "automatic",
      skillIds: ["coding"],
      messageCount: 2,
      workspaceFiles: [],
      resourceId: "res_11111111-1111-4111-8111-111111111111",
      accessRole: "owner",
      accessRevision: 1,
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
      requestId: "turn_request-123",
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
    expect(isAdminReliabilitySnapshot({
      ...snapshot,
      providers: [{ ...snapshot.providers[0], routes: [{ ...route, requestId: "bad request id" }] }],
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
      securityFingerprint: "b".repeat(64),
      sideEffect: "read",
      reviewRevision: "c".repeat(64),
      reviewRequired: true,
    };
    expect(isAdminMcpDiscoveryResponse({ serverId: "docs", tools: [tool], rejected: 2 })).toBe(true);
    expect(isAdminMcpDiscoveryResponse({ serverId: "other", tools: [tool], rejected: 2 })).toBe(false);
    expect(isAdminMcpDiscoveryResponse({ serverId: "docs", tools: [{ ...tool, id: "mcp:docs:other" }], rejected: 2 })).toBe(false);
    expect(isAdminMcpDiscoveryResponse({ serverId: "docs", tools: [{ ...tool, schemaFingerprint: "A".repeat(64) }], rejected: 2 })).toBe(false);
    expect(isAdminMcpDiscoveryResponse({ serverId: "docs", tools: [{ ...tool, label: " " }], rejected: 2 })).toBe(false);
    expect(isAdminMcpDiscoveryResponse({ serverId: "docs", tools: [{ ...tool, id: "mcp:docs:bad:name", executor: { ...tool.executor, remoteName: "bad:name" } }], rejected: 2 })).toBe(false);
    expect(isAdminMcpDiscoveryResponse({ serverId: "docs", tools: [tool], rejected: 2, secret: "hidden" })).toBe(false);
  });

  it("validates exact secret-free MCP OAuth browser projections", () => {
    const connected = validSession.mcpConnections[0];
    expect(isMcpOAuthConnection(connected)).toBe(true);
    expect(isMcpOAuthConnection({ ...connected, accessToken: "hidden" })).toBe(false);
    expect(isMcpOAuthConnection({ ...connected, status: "review_required" })).toBe(false);
    expect(isMcpOAuthConnection({
      serverId: "docs",
      label: "Docs",
      connected: false,
      reviewRequired: true,
      grantedScopes: ["mcp.read"],
      status: "review_required",
    })).toBe(true);
    expect(isMcpOAuthStatusResponse({ connections: [connected] })).toBe(true);
    expect(isMcpOAuthStatusResponse({ connections: [connected, connected] })).toBe(false);
    expect(isMcpOAuthStartResponse({ serverId: "docs", authorizationUrl: "https://identity.example/authorize?state=opaque" })).toBe(true);
    expect(isMcpOAuthStartResponse({ serverId: "docs", authorizationUrl: "javascript:alert(1)" })).toBe(false);
    expect(isMcpOAuthDiscoveryCandidate({
      candidateId: "12345678-1234-4123-8123-123456789abc",
      serverId: "docs",
      createdAt: 1_900_000_000_000,
      expiresAt: 1_900_001_800_000,
      tools: 3,
      rejected: 1,
    })).toBe(true);
    expect(isMcpOAuthRevokeResponse({ ok: true, serverId: "docs" })).toBe(true);
    expect(isMcpOAuthRevokeResponse({ ok: true, serverId: "docs", refreshToken: "hidden" })).toBe(false);
  });

  it("validates exact model monitor and member availability projections", () => {
    const generatedAt = 1_900_000_000_000;
    const periodStart = generatedAt - 86_400_000;
    const totals = {
      attempts: 3,
      succeeded: 2,
      failures: 1,
      inFlight: 0,
      completed: 3,
      successRate: 2 / 3,
      fallbacks: 1,
      averageLatencyMs: 200,
    };
    const group = { id: "route-a", label: "Route A", model: "model-a", ...totals };
    const monitor = {
      version: 1,
      window: "24h",
      generatedAt,
      periodStart,
      periodEnd: generatedAt,
      totals,
      trend: Array.from({ length: 24 }, (_, index) => ({
        bucketStart: periodStart + index * 3_600_000,
        bucketEnd: periodStart + (index + 1) * 3_600_000,
        attempts: index === 0 ? 3 : 0,
        succeeded: index === 0 ? 2 : 0,
        failures: index === 0 ? 1 : 0,
        inFlight: 0,
        fallbacks: index === 0 ? 1 : 0,
      })),
      routes: [group],
      providers: [{ ...group, id: "provider-a", label: "Provider A" }],
      models: [{ ...group, id: "model-a", label: "model-a" }],
      runKinds: [{ runKind: "main_answer", ...totals }],
      failureClasses: [{ errorClass: "upstream_timeout", count: 1 }],
    };
    expect(isModelMonitorSnapshot(monitor)).toBe(true);
    expect(isModelMonitorSnapshot({ ...monitor, providerId: "hidden" })).toBe(false);
    expect(isModelMonitorSnapshot({ ...monitor, totals: { ...totals, completed: 2 } })).toBe(false);
    expect(isModelMonitorSnapshot({
      ...monitor,
      trend: monitor.trend.map((item, index) => index === 7 ? { ...item, bucketStart: item.bucketStart + 1 } : item),
    })).toBe(false);
    expect(isModelMonitorSnapshot({
      ...monitor,
      trend: monitor.trend.map((item, index) => index === 7 ? { ...item, bucketEnd: item.bucketEnd - 1 } : item),
    })).toBe(false);
    const emptyGroup = {
      id: "empty-route",
      label: "Empty route",
      attempts: 0,
      succeeded: 0,
      failures: 0,
      inFlight: 0,
      completed: 0,
      successRate: null,
      fallbacks: 0,
      averageLatencyMs: null,
    };
    expect(isModelMonitorSnapshot({
      ...monitor,
      routes: [monitor.routes[0], ...Array.from({ length: 500 }, (_, index) => ({ ...emptyGroup, id: `empty-route-${index}` }))],
    })).toBe(false);

    const availability = {
      version: 1,
      generatedAt,
      window: "24h",
      routes: [{
        routeId: "route-a",
        label: "Route A",
        model: "Model A",
        status: "degraded",
        confidence: "recent",
        speed: "normal",
        observedAt: generatedAt - 1_000,
        fallbackRecentlyUsed: true,
        message: "degraded",
      }],
    };
    expect(isMemberModelAvailability(availability)).toBe(true);
    expect(isMemberModelAvailability({ ...availability, routes: [{ ...availability.routes[0], providerId: "hidden" }] })).toBe(false);
    expect(isMemberModelAvailability({ ...availability, routes: [{ ...availability.routes[0], message: "healthy" }] })).toBe(false);
  });
});
