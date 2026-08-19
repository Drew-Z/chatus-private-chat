import { env } from "cloudflare:workers";
import { stepCountIs, streamText } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROVIDER_BUDGET_HOLD_REVIEW_AFTER_MS } from "../src/contracts/provider-finance";
import { providerOfferingId } from "../src/contracts/provider-attempt";
import { IDENTITY_REGISTRY_INSTANCE_NAME } from "../src/identity-registry";
import { createAgentToolSet } from "../src/services/agent-tools";
import { prepareTeamAgentTurn, type Session } from "../src/worker";

const ROUTES_CONFIG_KEY = "config:routes_config";

function turnContext() {
  return {
    turnId: `turn_${crypto.randomUUID()}`,
    operation: {
      version: 1 as const,
      operationId: `provider-turn-${crypto.randomUUID()}`,
      fenceId: crypto.randomUUID(),
      kind: "provider_turn" as const,
      startedAt: Date.now(),
    },
  };
}

async function createMemberSession(label: string): Promise<Extract<Session, { kind: "member" }>> {
  const principal = await env.IDENTITY_REGISTRY.getByName(IDENTITY_REGISTRY_INSTANCE_NAME).resolveOrCreatePrincipal({
    version: 1,
    operationId: `test-principal:${crypto.randomUUID()}`,
    alias: label,
    origin: "native",
  });
  await env.USER_STATE.getByName(principal.userStateInstanceName).ensureStableIdentity({
    version: 1,
    principalId: principal.principalId,
    rootInstanceName: principal.rootInstanceName,
    userStateInstanceName: principal.userStateInstanceName,
    registryRevision: principal.registryRevision,
  });
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    label,
    kind: "member",
    principalId: principal.principalId,
    rootInstanceName: principal.rootInstanceName,
    userStateInstanceName: principal.userStateInstanceName,
    registryRevision: principal.registryRevision,
    createdAt: now,
    lastSeen: now,
    expiresAt: now + 60_000,
  };
}

describe("auxiliary vision Provider turns", () => {
  beforeEach(async () => {
    await env.CHAT_STORE.delete(ROUTES_CONFIG_KEY);
  });

  afterEach(() => vi.restoreAllMocks());

  it("keeps native image turns on the selected Provider without a helper", async () => {
    const context = turnContext();
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      providers: {
        native: {
          label: "Native vision",
          type: "openai-chat",
          baseUrl: "https://native-vision.example/v1",
          apiKey: "native-test-key",
          supportsImages: true,
        },
      },
      routes: {
        native: {
          label: "Native vision",
          offerings: [{ providerId: "native", model: "native-model" }],
          supportsImages: true,
        },
      },
      defaults: { defaultRoute: "native", allowedRoutes: ["native"] },
    }));
    let providerBody = "";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      providerBody = String(init?.body || "");
      return openAiStreamResponse("I can see the native image.");
    });
    const session = await createMemberSession(`agent-native-vision-${crypto.randomUUID()}`);
    const image = "data:image/png;base64,QQ==";
    const prepared = await prepareTeamAgentTurn(env, session, {
      ...context,
      messages: [{
        id: "native-image-message",
        role: "user",
        content: [{ type: "image_url", image_url: { url: image } }],
      }],
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.forceImageInspect).toBe(false);
    expect(prepared.visionInspect).toBeUndefined();
    expect(JSON.stringify(prepared.messages)).toContain('"type":"image"');
    expect(JSON.stringify(prepared.messages)).toContain('"mediaType":"image/png"');
    const body = await streamText({
      model: prepared.model,
      messages: prepared.messages,
      maxRetries: 0,
      allowSystemInMessages: true,
    }).toUIMessageStreamResponse().text();
    expect(body).toContain("native image");
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(providerBody).toContain(image);
    const [attempt] = await env.PROVIDER_ATTEMPT_LEDGER.getByName("native").listRecent();
    expect(attempt).toMatchObject({ turnId: context.turnId, runKind: "main_answer", status: "succeeded" });
    await Promise.allSettled([prepared.closeTools(), prepared.releaseTurn()]);
  });

  it("runs pre-answer inspection with helper fallback, private evidence, and one admission", async () => {
    const label = `agent-vision-preanswer-${crypto.randomUUID()}`;
    const context = turnContext();
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      providers: {
        text: {
          label: "Text",
          type: "openai-chat",
          baseUrl: "https://vision-main.example/v1",
          apiKey: "text-test-key",
          supportsImages: false,
          supportsTools: false,
        },
        "vision-primary": {
          label: "Vision primary",
          type: "openai-chat",
          baseUrl: "https://vision-primary.example/v1",
          apiKey: "vision-primary-key",
          supportsImages: true,
        },
        "vision-backup": {
          label: "Vision backup",
          type: "openai-chat",
          baseUrl: "https://vision-backup.example/v1",
          apiKey: "vision-backup-key",
          supportsImages: true,
        },
      },
      routes: {
        text: {
          label: "Text",
          offerings: [{ providerId: "text", model: "text-model" }],
          supportsImages: false,
        },
        vision: {
          label: "Vision",
          offerings: [
            { providerId: "vision-primary", model: "vision-model", priority: 10 },
            { providerId: "vision-backup", model: "vision-model", priority: 0 },
          ],
        },
      },
      defaults: {
        defaultRoute: "text",
        allowedRoutes: ["text"],
        allowedAugmentations: ["vision_assist"],
        dailyMessageLimit: 1,
        minuteMessageLimit: 10,
      },
      visionAssist: { enabled: true, routeId: "vision", maxOutputChars: 1_024 },
    }));
    const priceStart = Date.now() - 1_000;
    const backupLedger = env.PROVIDER_ATTEMPT_LEDGER.getByName("vision-backup");
    await backupLedger.addPriceCatalog(priceCatalogInput(
      "vision-backup",
      "vision",
      "vision-model",
      priceStart,
    ));
    const calls: Array<{ url: string; body: string }> = [];
    const validEvidence = JSON.stringify({
      version: 1,
      description: "A release dashboard with all checks green.",
      ocrText: ["Release ready"],
      limitations: ["The timestamp is too small to read."],
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const body = String(init?.body || "");
      calls.push({ url, body });
      if (url.startsWith("https://vision-primary.example/")) {
        return openAiCompletionResponse('{"version":1,"description":"malformed"}');
      }
      if (url.startsWith("https://vision-backup.example/")) return openAiCompletionResponse(validEvidence);
      return openAiStreamResponse("The release dashboard is green.");
    });
    const persisted: Array<{ ids: string[]; description: string }> = [];
    const session = await createMemberSession(label);
    const messageId = "vision-source-preanswer";
    const image = "data:image/png;base64,QQ==";
    const prepared = await prepareTeamAgentTurn(env, session, {
      ...context,
      messages: [{
        id: messageId,
        role: "user",
        content: [
          { type: "text", text: "Is this release ready?" },
          { type: "image_url", image_url: { url: image } },
        ],
      }],
      visionSources: [{ sourceMessageId: messageId, images: [image] }],
      persistVisionEvidence: (ids, evidence) => {
        persisted.push({ ids, description: evidence.description });
      },
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.forceImageInspect).toBe(false);
    expect(JSON.stringify(prepared.messages)).not.toContain("data:image");
    expect(JSON.stringify(prepared.messages)).toContain("A release dashboard with all checks green.");

    const response = streamText({
      model: prepared.model,
      messages: prepared.messages,
      maxRetries: 0,
      allowSystemInMessages: true,
    }).toUIMessageStreamResponse();
    expect(await response.text()).toContain("release dashboard is green");
    expect(calls.map(({ url }) => new URL(url).host)).toEqual([
      "vision-primary.example",
      "vision-backup.example",
      "vision-main.example",
    ]);
    expect(calls[0].body).toContain(image);
    expect(calls[1].body).toContain(image);
    expect(calls[2].body).not.toContain("data:image");
    expect(calls[2].body).not.toContain("image_url");
    expect(calls[2].body).toContain("A release dashboard with all checks green.");
    expect(persisted).toEqual([{ ids: [messageId], description: "A release dashboard with all checks green." }]);

    const [primaryAttempt] = await env.PROVIDER_ATTEMPT_LEDGER.getByName("vision-primary").listRecent();
    const [backupAttempt] = await env.PROVIDER_ATTEMPT_LEDGER.getByName("vision-backup").listRecent();
    const [mainAttempt] = await env.PROVIDER_ATTEMPT_LEDGER.getByName("text").listRecent();
    expect(primaryAttempt).toMatchObject({
      turnId: context.turnId,
      runKind: "auxiliary_vision",
      fallbackIndex: 0,
      status: "failed",
      errorClass: "provider_protocol_error",
    });
    expect(backupAttempt).toMatchObject({
      turnId: context.turnId,
      runId: primaryAttempt.runId,
      runKind: "auxiliary_vision",
      fallbackIndex: 1,
      status: "succeeded",
    });
    expect(mainAttempt).toMatchObject({ turnId: context.turnId, runKind: "main_answer", status: "succeeded" });
    await expect(backupLedger.getFinanceSnapshot({ periodStart: priceStart, limit: 10 })).resolves.toMatchObject({
      attempts: [expect.objectContaining({
        runKind: "auxiliary_vision",
        usageState: "partial",
        costState: "provisional",
        usage: expect.objectContaining({ inputNoCacheTokens: 2, outputTextTokens: 3 }),
        costs: [expect.objectContaining({ currency: "USD", totalMicros: 8 })],
      })],
    });
    await Promise.allSettled([prepared.closeTools(), prepared.releaseTurn()]);

    const nextTurn = await prepareTeamAgentTurn(env, session, {
      ...turnContext(),
      messages: [{ role: "user", content: "This is another message." }],
    });
    expect(nextTurn).toMatchObject({ ok: false, error: "rate_limited", status: 429 });
  });

  it("forces trusted inspection between the initial answer and tool continuation", async () => {
    const label = `agent-vision-tool-${crypto.randomUUID()}`;
    const context = turnContext();
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      providers: {
        text: {
          label: "Tool text",
          type: "openai-chat",
          baseUrl: "https://vision-tool-main.example/v1",
          apiKey: "tool-text-key",
          supportsImages: false,
          supportsTools: true,
        },
        vision: {
          label: "Vision",
          type: "openai-chat",
          baseUrl: "https://vision-tool-helper.example/v1",
          apiKey: "vision-helper-key",
          supportsImages: true,
        },
      },
      routes: {
        text: {
          label: "Tool text",
          offerings: [{ providerId: "text", model: "tool-text-model" }],
          supportsImages: false,
          supportsTools: true,
        },
        vision: { label: "Vision", offerings: [{ providerId: "vision", model: "vision-model" }] },
      },
      defaults: {
        defaultRoute: "text",
        allowedRoutes: ["text"],
        allowedAugmentations: ["vision_assist"],
      },
      visionAssist: { enabled: true, routeId: "vision", maxOutputChars: 1_024 },
    }));
    const validEvidence = JSON.stringify({
      version: 1,
      description: "A two-column comparison table.",
      ocrText: ["Option A", "Option B"],
      limitations: [],
    });
    const calls: Array<{ url: string; body: string }> = [];
    let textCalls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const body = String(init?.body || "");
      calls.push({ url, body });
      if (url.startsWith("https://vision-tool-helper.example/")) return openAiCompletionResponse(validEvidence);
      textCalls += 1;
      return textCalls === 1
        ? openAiToolCallStreamResponse("image_inspect", {})
        : openAiStreamResponse("Option A is highlighted.");
    });
    const persisted: string[] = [];
    const session = await createMemberSession(label);
    const messageId = "vision-source-tool";
    const image = "data:image/png;base64,Qg==";
    const prepared = await prepareTeamAgentTurn(env, session, {
      ...context,
      messages: [{
        id: messageId,
        role: "user",
        content: [
          { type: "text", text: "Compare these options." },
          { type: "image_url", image_url: { url: image } },
        ],
      }],
      visionSources: [{ sourceMessageId: messageId, images: [image] }],
      persistVisionEvidence: (ids) => persisted.push(...ids),
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.forceImageInspect).toBe(true);
    expect(prepared.visionInspect).toBeTypeOf("function");
    expect(JSON.stringify(prepared.messages)).not.toContain("data:image");
    expect(JSON.stringify(prepared.messages)).toContain("image_inspect");

    const tools = createAgentToolSet({
      definitions: prepared.toolDefinitions,
      conversationId: "chat-vision-tool",
      runTool: prepared.runTool,
      approvals: { isTrusted: () => false, markTrusted: () => undefined },
      vision: { inspect: prepared.visionInspect! },
    });
    const result = streamText({
      model: prepared.model,
      messages: prepared.messages,
      tools,
      stopWhen: stepCountIs(prepared.maxToolSteps),
      maxRetries: 0,
      allowSystemInMessages: true,
      prepareStep: ({ stepNumber }) => stepNumber === 0
        ? { toolChoice: { type: "tool", toolName: "image_inspect" }, activeTools: ["image_inspect"] }
        : undefined,
    });
    expect(await result.toUIMessageStreamResponse().text()).toContain("Option A is highlighted");
    expect(calls.map(({ url }) => new URL(url).host)).toEqual([
      "vision-tool-main.example",
      "vision-tool-helper.example",
      "vision-tool-main.example",
    ]);
    expect(calls[0].body).not.toContain("data:image");
    expect(calls[0].body).toContain('"tool_choice"');
    expect(calls[1].body).toContain(image);
    expect(calls[2].body).not.toContain("data:image");
    expect(calls[2].body).toContain("A two-column comparison table.");
    expect(persisted).toEqual([messageId]);

    const attempts = (await env.PROVIDER_ATTEMPT_LEDGER.getByName("text").listRecent({ limit: 10 }))
      .filter((attempt) => attempt.turnId === context.turnId);
    expect(attempts.map(({ runKind, status }) => ({ runKind, status }))).toEqual([
      { runKind: "tool_continuation", status: "succeeded" },
      { runKind: "main_answer", status: "succeeded" },
    ]);
    const [visionAttempt] = await env.PROVIDER_ATTEMPT_LEDGER.getByName("vision").listRecent();
    expect(visionAttempt).toMatchObject({ turnId: context.turnId, runKind: "auxiliary_vision", status: "succeeded" });
    await Promise.allSettled([prepared.closeTools(), prepared.releaseTurn()]);
  });

  it("fails malformed helper evidence before the unsupported text Provider runs", async () => {
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify(singleHelperConfig({
      helperBaseUrl: "https://vision-malformed.example/v1",
      mainBaseUrl: "https://main-must-not-run.example/v1",
    })));
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      openAiCompletionResponse('{"version":1,"description":"missing arrays"}'),
    );
    const session = await createMemberSession(`agent-vision-malformed-${crypto.randomUUID()}`);
    const prepared = await prepareTeamAgentTurn(env, session, visionTurnInput(turnContext()));
    expect(prepared).toMatchObject({
      ok: false,
      error: "vision_assist_invalid_response",
      status: 502,
    });
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(String(fetchSpy.mock.calls[0][0])).toContain("vision-malformed.example");
  });

  it("fails missing helper credentials before any Provider request", async () => {
    const config = singleHelperConfig({
      helperBaseUrl: "https://vision-missing-key.example/v1",
      mainBaseUrl: "https://main-must-not-run.example/v1",
    });
    delete (config.providers.vision as { apiKey?: string }).apiKey;
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify(config));
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const session = await createMemberSession(`agent-vision-missing-key-${crypto.randomUUID()}`);
    const prepared = await prepareTeamAgentTurn(env, session, visionTurnInput(turnContext()));
    expect(prepared).toMatchObject({ ok: false, error: "image_not_supported", status: 400 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fails helper capacity before ledger admission or unsupported main I/O", async () => {
    const providerId = `vision-busy-${crypto.randomUUID()}`;
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify(singleHelperConfig({
      helperBaseUrl: "https://vision-busy.example/v1",
      mainBaseUrl: "https://main-must-not-run.example/v1",
      providerId,
      concurrency: "exclusive",
    })));
    const coordinator = env.PROVIDER_COORDINATOR.getByName(providerId);
    const held = await coordinator.acquire({
      requestId: `held-${crypto.randomUUID()}`,
      capacity: 1,
      waitMs: 0,
    });
    expect(held.ok).toBe(true);
    if (!held.ok) return;
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      const session = await createMemberSession(`agent-vision-busy-${crypto.randomUUID()}`);
      const prepared = await prepareTeamAgentTurn(env, session, visionTurnInput(turnContext()));
      expect(prepared).toMatchObject({ ok: false, error: "provider_busy", status: 429 });
      expect(fetchSpy).not.toHaveBeenCalled();
      await expect(env.PROVIDER_ATTEMPT_LEDGER.getByName(providerId).listRecent()).resolves.toEqual([]);
    } finally {
      await coordinator.release({ token: held.token });
    }
  });

  it("rechecks assignment after helper capacity waiting and denies stale Provider I/O", async () => {
    const providerId = `vision-revoked-${crypto.randomUUID()}`;
    const config = singleHelperConfig({
      helperBaseUrl: "https://vision-revoked.example/v1",
      mainBaseUrl: "https://main-must-not-run.example/v1",
      providerId,
      concurrency: "exclusive",
      queueTimeoutMs: 2_000,
    });
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify(config));
    const coordinator = env.PROVIDER_COORDINATOR.getByName(providerId);
    const held = await coordinator.acquire({
      requestId: `held-${crypto.randomUUID()}`,
      capacity: 1,
      waitMs: 0,
    });
    expect(held.ok).toBe(true);
    if (!held.ok) return;
    let released = false;
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      const session = await createMemberSession(`agent-vision-revoked-${crypto.randomUUID()}`);
      const preparing = prepareTeamAgentTurn(env, session, visionTurnInput(turnContext()));
      await vi.waitFor(async () => {
        await expect(coordinator.inspect()).resolves.toMatchObject({ active: 1, waiting: 1 });
      });

      config.defaults.allowedAugmentations = [];
      await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify(config));
      await coordinator.release({ token: held.token });
      released = true;

      await expect(preparing).resolves.toMatchObject({
        ok: false,
        error: "vision_assist_unavailable",
        status: 503,
      });
      expect(fetchSpy).not.toHaveBeenCalled();
      await expect(env.PROVIDER_ATTEMPT_LEDGER.getByName(providerId).listRecent()).resolves.toEqual([]);
      await expect(coordinator.inspect()).resolves.toMatchObject({ active: 0, waiting: 0 });
    } finally {
      if (!released) await coordinator.release({ token: held.token });
    }
  });

  it("blocks helper budget admission before any Provider request", async () => {
    const providerId = `vision-budget-${crypto.randomUUID()}`;
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify(singleHelperConfig({
      helperBaseUrl: "https://vision-budget.example/v1",
      mainBaseUrl: "https://main-must-not-run.example/v1",
      providerId,
    })));
    const periodStart = Date.now() - 1_000;
    const ledger = env.PROVIDER_ATTEMPT_LEDGER.getByName(providerId);
    const policy = hardBudgetPolicy(providerId, `policy-${crypto.randomUUID()}`, periodStart);
    await ledger.addBudgetPolicy({ ...policy, mode: "shadow" });
    await ledger.addBudgetPolicy({
      ...policy,
      idempotencyKey: `provider-budget-policy:v1:${crypto.randomUUID()}`,
      expectedPreviousVersion: 1,
      createdAt: periodStart + 1,
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const session = await createMemberSession(`agent-vision-budget-${crypto.randomUUID()}`);
    await expect(prepareTeamAgentTurn(env, session, visionTurnInput(turnContext())))
      .resolves.toMatchObject({ ok: false, error: "provider_budget_policy_unknown", status: 503 });
    expect(fetchSpy).not.toHaveBeenCalled();
    await expect(ledger.listRecent()).resolves.toEqual([]);
    await expect(ledger.getFinanceSnapshot({ periodStart, limit: 10 })).resolves.toMatchObject({
      capacity: { calls: 0 },
      budgetBalances: [expect.objectContaining({ denialCount: 1, reservedMicros: 0 })],
    });
  });

  it("settles helper timeout before unsupported main I/O", async () => {
    const providerId = `vision-timeout-${crypto.randomUUID()}`;
    const context = turnContext();
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify(singleHelperConfig({
      helperBaseUrl: "https://vision-timeout.example/v1",
      mainBaseUrl: "https://main-must-not-run.example/v1",
      providerId,
    })));
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new DOMException("helper timed out", "TimeoutError"),
    );
    const session = await createMemberSession(`agent-vision-timeout-${crypto.randomUUID()}`);
    const prepared = await prepareTeamAgentTurn(env, session, visionTurnInput(context));
    expect(prepared).toMatchObject({ ok: false, error: "upstream_timeout", status: 504 });
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [attempt] = await env.PROVIDER_ATTEMPT_LEDGER.getByName(providerId).listRecent();
    expect(attempt).toMatchObject({
      turnId: context.turnId,
      runKind: "auxiliary_vision",
      status: "timed_out",
      errorClass: "upstream_timeout",
    });
  });

  it("settles helper cancellation and never starts the unsupported text Provider", async () => {
    const providerId = `vision-cancel-${crypto.randomUUID()}`;
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify(singleHelperConfig({
      helperBaseUrl: "https://vision-cancel.example/v1",
      mainBaseUrl: "https://main-must-not-run.example/v1",
      providerId,
      concurrency: "exclusive",
    })));
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let resolveLate!: (response: Response) => void;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      markStarted();
      return await new Promise<Response>((resolve) => {
        resolveLate = resolve;
      });
    });
    const session = await createMemberSession(`agent-vision-cancel-${crypto.randomUUID()}`);
    const controller = new AbortController();
    const context = turnContext();
    const persisted: string[] = [];
    const preparing = prepareTeamAgentTurn(env, session, {
      ...visionTurnInput(context),
      abortSignal: controller.signal,
      persistVisionEvidence: (ids) => persisted.push(...ids),
    });
    await started;
    controller.abort(new DOMException("cancelled by user", "AbortError"));
    await expect(Promise.race([
      preparing,
      new Promise((_, reject) => setTimeout(() => reject(new Error("cancellation did not settle promptly")), 500)),
    ])).resolves.toMatchObject({ ok: false, error: "request_cancelled", status: 499 });
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(persisted).toEqual([]);
    const [attempt] = await env.PROVIDER_ATTEMPT_LEDGER.getByName(providerId).listRecent();
    expect(attempt).toMatchObject({
      turnId: context.turnId,
      runKind: "auxiliary_vision",
      status: "cancelled",
      errorClass: "request_cancelled",
    });
    const coordinator = env.PROVIDER_COORDINATOR.getByName(providerId);
    const replacement = await coordinator.acquire({
      requestId: `replacement-${crypto.randomUUID()}`,
      capacity: 1,
      waitMs: 1_000,
    });
    expect(replacement.ok).toBe(true);
    if (replacement.ok) await coordinator.release({ token: replacement.token });

    resolveLate(openAiCompletionResponse(JSON.stringify({
      version: 1,
      description: "This late helper result must remain inert.",
      ocrText: [],
      limitations: [],
    })));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(persisted).toEqual([]);
  });
});

describe("capability monitoring lifecycle ownership", () => {
  it("starts monitoring only when waitUntil accepts lifecycle ownership", async () => {
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify(singleHelperConfig({
      helperBaseUrl: "https://monitor-helper.example/v1",
      mainBaseUrl: "https://monitor-main.example/v1",
    })));
    const session = await createMemberSession(`monitoring-owner-${crypto.randomUUID()}`);
    const runDeniedResearch = (waitUntil?: (promise: Promise<unknown>) => void) => prepareTeamAgentTurn(env, session, {
      ...turnContext(),
      messages: [{ role: "user", content: "Local monitoring lifecycle test." }],
      capabilityIds: ["chatus:web_research"],
      disableTools: true,
      ...(waitUntil ? { waitUntil } : {}),
    });
    const baseline = await deniedWebResearchMonitoringCount();

    await expect(runDeniedResearch()).resolves.toMatchObject({
      ok: false,
      error: "web_research_not_available",
    });
    await Promise.resolve();
    expect(await deniedWebResearchMonitoringCount()).toBe(baseline);

    await expect(runDeniedResearch(() => { throw new Error("lifecycle rejected"); })).resolves.toMatchObject({
      ok: false,
      error: "web_research_not_available",
    });
    await Promise.resolve();
    expect(await deniedWebResearchMonitoringCount()).toBe(baseline);

    let acceptedWrite: Promise<unknown> | undefined;
    await expect(runDeniedResearch((promise) => { acceptedWrite = promise; })).resolves.toMatchObject({
      ok: false,
      error: "web_research_not_available",
    });
    expect(acceptedWrite).toBeDefined();
    await acceptedWrite;
    expect(await deniedWebResearchMonitoringCount()).toBe(baseline + 1);
  });
});

type SingleHelperOptions = {
  helperBaseUrl: string;
  mainBaseUrl: string;
  providerId?: string;
  concurrency?: "unlimited" | "exclusive";
  queueTimeoutMs?: number;
};

function singleHelperConfig(options: SingleHelperOptions) {
  const providerId = options.providerId || "vision";
  return {
    providers: {
      text: {
        label: "Text",
        type: "openai-chat",
        baseUrl: options.mainBaseUrl,
        apiKey: "text-test-key",
        supportsImages: false,
      },
      [providerId]: {
        label: "Vision",
        type: "openai-chat",
        baseUrl: options.helperBaseUrl,
        apiKey: "vision-test-key",
        supportsImages: true,
        concurrency: options.concurrency || "unlimited",
        queueTimeoutMs: options.queueTimeoutMs ?? 0,
      },
    },
    routes: {
      text: {
        label: "Text",
        offerings: [{ providerId: "text", model: "text-model" }],
        supportsImages: false,
      },
      vision: {
        label: "Vision",
        offerings: [{ providerId, model: "vision-model" }],
        supportsImages: true,
      },
    },
    defaults: {
      defaultRoute: "text",
      allowedRoutes: ["text"],
      allowedAugmentations: ["vision_assist"],
    },
    visionAssist: { enabled: true, routeId: "vision", maxOutputChars: 1_024 },
  };
}

async function deniedWebResearchMonitoringCount(): Promise<number> {
  const now = Date.now();
  const rows = await env.PROVIDER_COORDINATOR
    .getByName("$capability-monitoring-v1")
    .getCapabilityMonitoringAggregate({
      periodStart: now - 24 * 60 * 60 * 1_000,
      periodEnd: now,
    });
  return rows
    .filter((row) => row.capabilityId === "chatus:web_research" && row.status === "denied")
    .reduce((total, row) => total + row.count, 0);
}

function visionTurnInput(context: ReturnType<typeof turnContext>) {
  const image = "data:image/png;base64,QQ==";
  const sourceMessageId = `vision-source-${crypto.randomUUID()}`;
  return {
    ...context,
    messages: [{
      id: sourceMessageId,
      role: "user" as const,
      content: [
        { type: "text" as const, text: "Inspect this image." },
        { type: "image_url" as const, image_url: { url: image } },
      ],
    }],
    visionSources: [{ sourceMessageId, images: [image] }],
  };
}

function hardBudgetPolicy(providerId: string, policyId: string, periodStart: number) {
  return {
    version: 1 as const,
    policyId,
    idempotencyKey: `provider-budget-policy:v1:${crypto.randomUUID()}`,
    providerId,
    currency: "USD",
    mode: "hard" as const,
    periodStart,
    periodEnd: periodStart + 24 * 60 * 60 * 1_000,
    limitMicros: 1_000,
    maxAttemptReserveMicros: 500,
    holdReviewAfterMs: PROVIDER_BUDGET_HOLD_REVIEW_AFTER_MS,
    allowUnknownPrice: false as const,
    approver: "test-finance-admin",
    createdAt: periodStart,
    expectedPreviousVersion: 0,
  };
}

function priceCatalogInput(
  providerId: string,
  logicalRouteId: string,
  model: string,
  effectiveFrom: number,
) {
  return {
    version: 1 as const,
    catalogVersionId: `catalog-${crypto.randomUUID()}`,
    providerId,
    offeringId: providerOfferingId(logicalRouteId, providerId),
    model,
    currency: "USD",
    precision: 6,
    unit: "million_tokens" as const,
    inputNoCachePriceMicros: 1_000_000,
    cacheReadInputPriceMicros: 0,
    cacheWriteInputPriceMicros: 0,
    outputTextPriceMicros: 2_000_000,
    reasoningOutputPriceMicros: 0,
    effectiveFrom,
    effectiveTo: null,
    approver: "test-finance-admin",
    provenance: "local fake Provider price",
    createdAt: effectiveFrom,
  };
}

function openAiCompletionResponse(text: string): Response {
  return new Response(JSON.stringify({
    id: "chatcmpl-vision-test",
    object: "chat.completion",
    created: 1,
    model: "vision-model",
    choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
    usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

function openAiStreamResponse(text: string): Response {
  const chunks = [
    {
      id: "chatcmpl-vision-stream",
      object: "chat.completion.chunk",
      created: 1,
      model: "tool-text-model",
      choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
    },
    {
      id: "chatcmpl-vision-stream",
      object: "chat.completion.chunk",
      created: 1,
      model: "tool-text-model",
      choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
    },
    {
      id: "chatcmpl-vision-stream",
      object: "chat.completion.chunk",
      created: 1,
      model: "tool-text-model",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
    },
  ];
  const body = `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`;
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function openAiToolCallStreamResponse(name: string, input: Record<string, unknown>): Response {
  const chunks = [
    {
      id: "chatcmpl-vision-tool",
      object: "chat.completion.chunk",
      created: 1,
      model: "tool-text-model",
      choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
    },
    {
      id: "chatcmpl-vision-tool",
      object: "chat.completion.chunk",
      created: 1,
      model: "tool-text-model",
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{
            index: 0,
            id: "call-image-inspect",
            type: "function",
            function: { name, arguments: JSON.stringify(input) },
          }],
        },
        finish_reason: null,
      }],
    },
    {
      id: "chatcmpl-vision-tool",
      object: "chat.completion.chunk",
      created: 1,
      model: "tool-text-model",
      choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
      usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
    },
  ];
  const body = `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`;
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}
