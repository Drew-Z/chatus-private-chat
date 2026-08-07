import type { LanguageModelV3CallOptions } from "@ai-sdk/provider";
import { env, exports } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { getAgentByName } from "agents";
import { stepCountIs, streamText } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TeamAgent } from "../src/agent/team-agent";
import { PROVIDER_BUDGET_HOLD_REVIEW_AFTER_MS } from "../src/contracts/provider-finance";
import { createAgentToolSet } from "../src/services/agent-tools";
import {
  loadProviderRouteReliability,
  loadSkillSelectionTelemetry,
} from "../src/services/route-reliability";
import { prepareTeamAgentTurn, type Session } from "../src/worker";

const ROUTES_CONFIG_KEY = "config:routes_config";
const ROUTE_RELIABILITY_PREFIX = "route-reliability:";
const ROUTE_SECRET_PREFIX = "route-secret:";
const PUBLIC_ROUTE_ID = "public-agent-route";
const PRIVATE_ROUTE_ID = "private-agent-route";

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

describe("prepared TeamAgent turn", () => {
  beforeEach(async () => {
    await env.CHAT_STORE.delete(ROUTES_CONFIG_KEY);
    await clearRouteReliability();
    await clearRouteSecrets();
  });

  it("persists one server turn identity across continuations and rotates it for the next message", async () => {
    const label = `agent-provider-turn-${crypto.randomUUID()}`;
    const stub = await getAgentByName(env.TEAM_AGENT, label, {
      props: {
        userLabel: label,
        scope: "root",
        accessKind: "member",
        sessionExpiresAt: Number.MAX_SAFE_INTEGER,
      },
    }) as DurableObjectStub<TeamAgent>;
    await runInDurableObject(stub, async (instance) => {
      const resolveTurn = (instance as unknown as {
        resolveProviderTurnId(continuation: boolean): string;
      }).resolveProviderTurnId.bind(instance);
      const first = resolveTurn(false);
      const continuation = resolveTurn(true);
      const next = resolveTurn(false);
      expect(first).toMatch(/^turn_[0-9a-f-]{36}$/i);
      expect(continuation).toBe(first);
      expect(next).not.toBe(first);
      expect(resolveTurn(true)).toBe(next);
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it("falls back before visible output and returns an AI SDK UI message stream", async () => {
    const requestId = "turn_fallback-123";
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      routes: {
        primary: {
          label: "Primary",
          type: "openai-chat",
          baseUrl: "https://primary.example/v1",
          model: "primary-model",
          apiKey: "primary-test-key",
          fallbacks: ["backup"],
        },
        backup: {
          label: "Backup",
          type: "openai-chat",
          baseUrl: "https://backup.example/v1",
          model: "backup-model",
          apiKey: "backup-test-key",
        },
      },
      defaults: { defaultRoute: "primary", allowedRoutes: ["primary", "backup"] },
    }));

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("https://primary.example/")) {
        return new Response(JSON.stringify({ error: { message: "primary unavailable" } }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        });
      }
      return openAiStreamResponse("备用线路完成任务");
    });
    const now = Date.now();
    const session: Session = {
      id: crypto.randomUUID(),
      label: `agent-stream-${crypto.randomUUID()}`,
      kind: "member",
      createdAt: now,
      lastSeen: now,
      expiresAt: now + 60_000,
    };

    const prepared = await prepareTeamAgentTurn(env, session, { ...turnContext(),
      messages: [{ role: "user", content: "整理三条发布检查事项" }],
      requestId,
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    const result = streamText({
      model: prepared.model,
      messages: prepared.messages,
      maxRetries: 0,
      allowSystemInMessages: true,
      onError: async () => prepared.recordStreamFailure(),
    });
    const response = result.toUIMessageStreamResponse({ onError: () => "线路暂时不可用" });
    const body = await response.text();

    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    expect(body).toContain("备用线路完成任务");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    await expect(env.CHAT_STORE.get("route-reliability:primary", "json")).resolves.toMatchObject({
      ok: false,
      outcome: "upstream_server",
      fallback: false,
    });
    await expect(env.CHAT_STORE.get("route-reliability:backup", "json")).resolves.toMatchObject({
      ok: true,
      outcome: "success",
      fallback: true,
    });
    await expect(loadProviderRouteReliability(env, "primary", "legacy:primary")).resolves.toMatchObject({
      requestId,
      lastOutcome: "upstream_server",
    });
    await expect(loadProviderRouteReliability(env, "backup", "legacy:backup")).resolves.toMatchObject({
      requestId,
      lastOutcome: "success",
    });
    await prepared.closeTools();
  });

  it("delivers a gated first provider delta before completion and records progressive timing", async () => {
    const routeId = `progressive-${crypto.randomUUID()}`;
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      routes: {
        [routeId]: {
          label: "Progressive",
          type: "openai-chat",
          baseUrl: "https://progressive.example/v1",
          model: "progressive-model",
          apiKey: "progressive-test-key",
        },
      },
      defaults: { defaultRoute: routeId, allowedRoutes: [routeId] },
    }));
    const encoder = new TextEncoder();
    let upstream!: ReadableStreamDefaultController<Uint8Array>;
    const upstreamBody = new ReadableStream<Uint8Array>({
      start(controller) {
        upstream = controller;
      },
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(upstreamBody, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    }));
    const now = Date.now();
    const session: Session = {
      id: crypto.randomUUID(),
      label: `agent-progressive-${crypto.randomUUID()}`,
      kind: "member",
      createdAt: now,
      lastSeen: now,
      expiresAt: now + 60_000,
    };
    const prepared = await prepareTeamAgentTurn(env, session, { ...turnContext(),
      messages: [{ role: "user", content: "用两段合成内容回答" }],
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    const result = streamText({
      model: prepared.model,
      messages: prepared.messages,
      maxRetries: 0,
      allowSystemInMessages: true,
      onError: async () => prepared.recordStreamFailure(),
    });
    const response = result.toUIMessageStreamResponse();
    const reader = response.body!.getReader();
    const firstVisible = readUntilText(reader, "第一段");
    upstream.enqueue(encoder.encode(openAiSseChunk({ role: "assistant" })));
    upstream.enqueue(encoder.encode(openAiSseChunk({ content: "第一段" })));

    await expect(firstVisible).resolves.toContain("第一段");
    expect(fetchSpy).toHaveBeenCalledOnce();
    await expect(loadProviderRouteReliability(env, routeId, `legacy:${routeId}`)).resolves.toBeNull();

    upstream.enqueue(encoder.encode(openAiSseChunk({ content: "第二段" })));
    upstream.enqueue(encoder.encode(openAiSseFinishChunk()));
    upstream.enqueue(encoder.encode("data: [DONE]\n\n"));
    upstream.close();
    const rest = await readRemainingText(reader);
    expect(rest).toContain("第二段");
    await vi.waitFor(async () => {
      await expect(loadProviderRouteReliability(env, routeId, `legacy:${routeId}`)).resolves.toMatchObject({
        streamSamples: 1,
        progressiveSamples: 1,
        lastStreamShape: "progressive",
      });
    });
    const reliability = await loadProviderRouteReliability(env, routeId, `legacy:${routeId}`);
    expect(reliability?.averageFirstVisibleLatencyMs).toBeTypeOf("number");
    expect(reliability?.lastFirstVisibleLatencyMs).toBeTypeOf("number");
    await prepared.closeTools();
  });

  it("prepares bounded assigned tools without contacting a model channel", async () => {
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      routes: {
        primary: {
          label: "Primary",
          type: "openai-chat",
          baseUrl: "https://primary.example/v1",
          model: "primary-model",
          apiKey: "primary-test-key",
          supportsTools: true,
        },
      },
      defaults: {
        defaultRoute: "primary",
        allowedRoutes: ["primary"],
        allowedTools: ["builtin:text_stats"],
      },
      skills: {
        writing: {
          enabled: true,
          label: "Writing",
          instructions: "Use the assigned text utility when useful.",
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
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const now = Date.now();
    const session: Session = {
      id: crypto.randomUUID(),
      label: `agent-tools-${crypto.randomUUID()}`,
      kind: "member",
      createdAt: now,
      lastSeen: now,
      expiresAt: now + 60_000,
    };

    const prepared = await prepareTeamAgentTurn(env, session, { ...turnContext(),
      messages: [{ role: "user", content: "统计这段文字" }],
      skillIds: ["writing"],
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    expect(prepared.toolDefinitions).toHaveLength(1);
    expect(prepared.memoryToolEnabled).toBe(true);
    const result = await prepared.runTool(prepared.toolDefinitions[0], { text: "hello world\nagain" });
    expect(JSON.parse(result.text)).toEqual({ characters: 17, codePoints: 17, words: 3, lines: 2 });
    expect(fetchSpy).not.toHaveBeenCalled();
    await prepared.closeTools();
    await expect(prepared.runTool(prepared.toolDefinitions[0], { text: "closed" }))
      .rejects.toThrow("工具运行时已关闭");
  });

  it("revalidates persisted Skill selections against the current member assignment", async () => {
    const label = `agent-revoked-skill-${crypto.randomUUID()}`;
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      routes: {
        primary: {
          label: "Primary",
          type: "openai-chat",
          baseUrl: "https://primary.example/v1",
          model: "primary-model",
          apiKey: "primary-test-key",
          supportsTools: true,
        },
      },
      defaults: {
        defaultRoute: "primary",
        allowedRoutes: ["primary"],
        allowedTools: ["builtin:text_stats"],
      },
      users: { [label]: { allowedSkills: [] } },
      skills: {
        writing: {
          enabled: true,
          label: "Writing",
          instructions: "Revoked instructions must not reach the model.",
          toolIds: ["builtin:text_stats"],
        },
      },
      tools: {
        "builtin:text_stats": {
          enabled: true,
          label: "Text stats",
          inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
          executor: { type: "builtin", name: "text_stats" },
        },
      },
    }));
    const now = Date.now();
    const session: Session = {
      id: crypto.randomUUID(),
      label,
      kind: "member",
      createdAt: now,
      lastSeen: now,
      expiresAt: now + 60_000,
    };

    const prepared = await prepareTeamAgentTurn(env, session, { ...turnContext(),
      messages: [{ role: "user", content: "继续旧会话" }],
      skillIds: ["writing"],
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    expect(prepared.skillIds).toEqual([]);
    expect(prepared.toolDefinitions).toEqual([]);
    expect(prepared.memoryToolEnabled).toBe(true);
    expect(JSON.stringify(prepared.messages)).not.toContain("Revoked instructions");
    await prepared.closeTools();
  });

  it("selects automatic Skills within one logical route using a bounded tool-free request", async () => {
    const label = `agent-auto-skill-${crypto.randomUUID()}`;
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      providers: {
        first: {
          label: "First",
          type: "openai-chat",
          baseUrl: "https://selector-first.example/v1",
          apiKey: "first-test-key",
          priority: 2,
        },
        second: {
          label: "Second",
          type: "openai-chat",
          baseUrl: "https://selector-second.example/v1",
          apiKey: "second-test-key",
          priority: 1,
        },
        forbidden: {
          label: "Forbidden",
          type: "openai-chat",
          baseUrl: "https://selector-forbidden.example/v1",
          apiKey: "forbidden-test-key",
        },
      },
      routes: {
        primary: {
          label: "Primary",
          offerings: [
            { providerId: "first", model: "selector-model" },
            { providerId: "second", model: "selector-model" },
          ],
          fallbacks: ["forbidden"],
        },
        forbidden: {
          label: "Forbidden",
          offerings: [{ providerId: "forbidden", model: "other-logical-model" }],
        },
      },
      defaults: {
        defaultRoute: "primary",
        allowedRoutes: ["primary", "forbidden"],
        dailyMessageLimit: 1,
        minuteMessageLimit: 10,
      },
      users: { [label]: { allowedSkills: ["writing", "analysis"] } },
      skills: {
        writing: { enabled: true, label: "Writing", description: "Draft text", instructions: "Write clearly.", order: 1 },
        analysis: { enabled: true, label: "Analysis", description: "Inspect evidence", instructions: "Analyze evidence.", order: 2 },
      },
      tools: {},
    }));
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
      requests.push({ url, body });
      if (url.startsWith("https://selector-first.example/")) {
        return new Response(JSON.stringify({ error: { message: "first unavailable" } }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.startsWith("https://selector-forbidden.example/")) {
        throw new Error("selector crossed a logical route boundary");
      }
      return openAiCompletionResponse('{"skillIds":["analysis","analysis","unknown"]}');
    });
    const now = Date.now();
    const session: Session = {
      id: crypto.randomUUID(),
      label,
      kind: "member",
      createdAt: now,
      lastSeen: now,
      expiresAt: now + 60_000,
    };

    const context = turnContext();
    const prepared = await prepareTeamAgentTurn(env, session, { ...context,
      messages: [{ role: "user", content: "Compare the evidence" }],
      skillMode: "automatic",
      skillIds: ["writing"],
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    expect(prepared.skillIds).toEqual(["analysis"]);
    expect(prepared.skillSelection).toEqual({
      mode: "automatic",
      source: "model",
      skills: [{ id: "analysis", label: "Analysis" }],
    });
    expect(requests).toHaveLength(2);
    expect(requests.every(({ body }) => body.max_tokens === 200 && body.tools === undefined)).toBe(true);
    expect(requests.some(({ url }) => url.includes("selector-forbidden"))).toBe(false);
    await expect(loadProviderRouteReliability(env, "primary", "first")).resolves.toBeNull();
    await expect(loadSkillSelectionTelemetry(env, "primary", "first")).resolves.toMatchObject({
      operation: "skill_selection",
      attempts: 1,
      successes: 0,
      lastOutcome: "upstream_server",
    });
    await expect(loadSkillSelectionTelemetry(env, "primary", "second")).resolves.toMatchObject({
      operation: "skill_selection",
      attempts: 1,
      successes: 1,
      lastOutcome: "success",
      lastFallback: true,
    });
    const [firstAttempt] = await env.PROVIDER_ATTEMPT_LEDGER.getByName("first").listRecent();
    const [secondAttempt] = await env.PROVIDER_ATTEMPT_LEDGER.getByName("second").listRecent();
    expect(firstAttempt).toMatchObject({
      turnId: context.turnId,
      runKind: "automatic_skill",
      logicalRouteId: "primary",
      model: "selector-model",
      fallbackIndex: 0,
      status: "failed",
      errorClass: "upstream_unavailable",
    });
    expect(secondAttempt).toMatchObject({
      turnId: context.turnId,
      runId: firstAttempt.runId,
      runKind: "automatic_skill",
      logicalRouteId: "primary",
      model: "selector-model",
      fallbackIndex: 1,
      status: "succeeded",
    });
    await expect(env.PROVIDER_ATTEMPT_LEDGER.getByName("forbidden").listRecent()).resolves.toEqual([]);
    await Promise.allSettled([prepared.closeTools(), prepared.releaseTurn()]);

    const next = await prepareTeamAgentTurn(env, session, { ...turnContext(),
      messages: [{ role: "user", content: "This is a second user turn" }],
      skillMode: "manual",
      skillIds: [],
    });
    expect(next).toMatchObject({ ok: false, error: "rate_limited", status: 429 });
  });

  it("rejects exhausted automatic turns before selector or main Provider work", async () => {
    const label = `agent-auto-quota-${crypto.randomUUID()}`;
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      routes: {
        primary: {
          label: "Primary",
          type: "openai-chat",
          baseUrl: "https://selector-quota.example/v1",
          model: "selector-model",
          apiKey: "selector-test-key",
        },
      },
      defaults: {
        defaultRoute: "primary",
        allowedRoutes: ["primary"],
        dailyMessageLimit: 1,
        minuteMessageLimit: 10,
      },
      users: { [label]: { allowedSkills: ["analysis"] } },
      skills: {
        analysis: {
          enabled: true,
          label: "Analysis",
          description: "Inspect evidence",
          instructions: "Analyze evidence.",
        },
      },
      tools: {},
    }));
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      openAiCompletionResponse('{"skillIds":["analysis"]}'),
    );
    const now = Date.now();
    const session: Session = {
      id: crypto.randomUUID(),
      label,
      kind: "member",
      createdAt: now,
      lastSeen: now,
      expiresAt: now + 60_000,
    };

    const admitted = await prepareTeamAgentTurn(env, session, { ...turnContext(),
      messages: [{ role: "user", content: "Consume the only message unit" }],
      skillMode: "manual",
      skillIds: [],
    });
    expect(admitted.ok).toBe(true);
    if (admitted.ok) await Promise.allSettled([admitted.closeTools(), admitted.releaseTurn()]);

    const rejected = await prepareTeamAgentTurn(env, session, { ...turnContext(),
      messages: [{ role: "user", content: "Do not start selection" }],
      skillMode: "automatic",
      skillIds: [],
    });

    expect(rejected).toMatchObject({ ok: false, error: "rate_limited", status: 429 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("denies Automatic Skill before Provider I/O without consuming another message quota unit", async () => {
    const label = `agent-auto-budget-${crypto.randomUUID()}`;
    const providerId = `selector-budget-${crypto.randomUUID()}`;
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      providers: {
        [providerId]: {
          label: "Selector",
          type: "openai-chat",
          baseUrl: "https://selector-budget.example/v1",
          apiKey: "selector-test-key",
        },
      },
      routes: {
        primary: {
          label: "Primary",
          offerings: [{ providerId, model: "selector-model" }],
        },
      },
      defaults: {
        defaultRoute: "primary",
        allowedRoutes: ["primary"],
        dailyMessageLimit: 1,
        minuteMessageLimit: 10,
      },
      users: { [label]: { allowedSkills: ["analysis"] } },
      skills: {
        analysis: {
          enabled: true,
          label: "Analysis",
          description: "Inspect evidence",
          instructions: "Analyze evidence.",
        },
      },
      tools: {},
    }));
    const periodStart = Date.now() - 1_000;
    const automaticBudgetPolicy = hardBudgetPolicy(
      providerId,
      `policy-auto-${crypto.randomUUID()}`,
      periodStart,
    );
    const automaticBudgetLedger = env.PROVIDER_ATTEMPT_LEDGER.getByName(providerId);
    await automaticBudgetLedger.addBudgetPolicy({ ...automaticBudgetPolicy, mode: "shadow" });
    await automaticBudgetLedger.addBudgetPolicy({
      ...automaticBudgetPolicy,
      idempotencyKey: `provider-budget-policy:v1:${crypto.randomUUID()}`,
      expectedPreviousVersion: 1,
      createdAt: periodStart + 1,
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      openAiCompletionResponse('{"skillIds":["analysis"]}'),
    );
    const now = Date.now();
    const session: Session = {
      id: crypto.randomUUID(),
      label,
      kind: "member",
      createdAt: now,
      lastSeen: now,
      expiresAt: now + 60_000,
    };
    const context = turnContext();

    await expect(prepareTeamAgentTurn(env, session, {
      ...context,
      messages: [{ role: "user", content: "Select a Skill without overspending" }],
      skillMode: "automatic",
      skillIds: [],
    })).rejects.toMatchObject({ code: "provider_budget_policy_unknown" });
    expect(fetchSpy).not.toHaveBeenCalled();
    await expect(env.PROVIDER_ATTEMPT_LEDGER.getByName(providerId).listRecent()).resolves.toEqual([]);

    const continuation = await prepareTeamAgentTurn(env, session, {
      ...context,
      messages: [{ role: "user", content: "Continue the admitted turn" }],
      skillMode: "manual",
      skillIds: [],
      continuation: true,
    });
    expect(continuation.ok).toBe(true);
    if (continuation.ok) await Promise.allSettled([continuation.closeTools(), continuation.releaseTurn()]);

    const nextTurn = await prepareTeamAgentTurn(env, session, {
      ...turnContext(),
      messages: [{ role: "user", content: "This is a new message" }],
      skillMode: "manual",
      skillIds: [],
    });
    expect(nextTurn).toMatchObject({ ok: false, error: "rate_limited", status: 429 });
    await expect(env.PROVIDER_ATTEMPT_LEDGER.getByName(providerId).getFinanceSnapshot({
      periodStart,
      limit: 10,
    })).resolves.toMatchObject({
      capacity: { calls: 0 },
      budgetBalances: [expect.objectContaining({ denialCount: 1, reservedMicros: 0 })],
    });
  });

  it("does not charge a turn that is cancelled before automatic admission", async () => {
    const label = `agent-auto-pre-abort-${crypto.randomUUID()}`;
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      routes: {
        primary: {
          label: "Primary",
          type: "openai-chat",
          baseUrl: "https://selector-pre-abort.example/v1",
          model: "selector-model",
          apiKey: "selector-test-key",
        },
      },
      defaults: {
        defaultRoute: "primary",
        allowedRoutes: ["primary"],
        dailyMessageLimit: 1,
        minuteMessageLimit: 10,
      },
      users: { [label]: { allowedSkills: ["analysis"] } },
      skills: {
        analysis: {
          enabled: true,
          label: "Analysis",
          description: "Inspect evidence",
          instructions: "Analyze evidence.",
        },
      },
      tools: {},
    }));
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      openAiCompletionResponse('{"skillIds":["analysis"]}'),
    );
    const now = Date.now();
    const session: Session = {
      id: crypto.randomUUID(),
      label,
      kind: "member",
      createdAt: now,
      lastSeen: now,
      expiresAt: now + 60_000,
    };
    const controller = new AbortController();
    controller.abort(new DOMException("cancelled by user", "AbortError"));

    const cancelled = await prepareTeamAgentTurn(env, session, { ...turnContext(),
      messages: [{ role: "user", content: "Do not charge this turn" }],
      skillMode: "automatic",
      skillIds: [],
      abortSignal: controller.signal,
    });
    expect(cancelled).toMatchObject({ ok: false, error: "request_cancelled", status: 499 });
    expect(fetchSpy).not.toHaveBeenCalled();

    const next = await prepareTeamAgentTurn(env, session, { ...turnContext(),
      messages: [{ role: "user", content: "This turn should still be admitted" }],
      skillMode: "manual",
      skillIds: [],
    });
    expect(next.ok).toBe(true);
    if (next.ok) await Promise.allSettled([next.closeTools(), next.releaseTurn()]);
  });

  it("cancels automatic selection, releases its Provider lease, and does not prepare a main model", async () => {
    const label = `agent-auto-parent-abort-${crypto.randomUUID()}`;
    const providerId = `selector-cancel-${crypto.randomUUID()}`;
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      providers: {
        [providerId]: {
          label: "Selector",
          type: "openai-chat",
          baseUrl: "https://selector-parent-abort.example/v1",
          apiKey: "selector-test-key",
          concurrency: "exclusive",
        },
      },
      routes: {
        primary: {
          label: "Primary",
          offerings: [{ providerId, model: "selector-model" }],
        },
      },
      defaults: { defaultRoute: "primary", allowedRoutes: ["primary"] },
      users: { [label]: { allowedSkills: ["analysis"] } },
      skills: {
        analysis: {
          enabled: true,
          label: "Analysis",
          description: "Inspect evidence",
          instructions: "Analyze evidence.",
        },
      },
      tools: {},
    }));
    let markSelectorStarted!: () => void;
    const selectorStarted = new Promise<void>((resolve) => {
      markSelectorStarted = resolve;
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      markSelectorStarted();
      return await new Promise<Response>((_resolve, reject) => {
        const rejectAbort = () => reject(init?.signal?.reason instanceof Error
          ? init.signal.reason
          : new DOMException("cancelled by user", "AbortError"));
        if (init?.signal?.aborted) rejectAbort();
        else init?.signal?.addEventListener("abort", rejectAbort, { once: true });
      });
    });
    const now = Date.now();
    const session: Session = {
      id: crypto.randomUUID(),
      label,
      kind: "member",
      createdAt: now,
      lastSeen: now,
      expiresAt: now + 60_000,
    };
    const controller = new AbortController();

    const preparing = prepareTeamAgentTurn(env, session, { ...turnContext(),
      messages: [{ role: "user", content: "Cancel during selection" }],
      skillMode: "automatic",
      skillIds: [],
      abortSignal: controller.signal,
    });
    await selectorStarted;
    controller.abort(new DOMException("cancelled by user", "AbortError"));
    const cancelled = await preparing;

    expect(cancelled).toMatchObject({ ok: false, error: "request_cancelled", status: 499 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const coordinator = env.PROVIDER_COORDINATOR.getByName(providerId);
    const replacement = await coordinator.acquire({
      requestId: `replacement-${crypto.randomUUID()}`,
      capacity: 1,
      waitMs: 1_000,
    });
    expect(replacement.ok).toBe(true);
    if (replacement.ok) await coordinator.release({ token: replacement.token });
  });

  it("keeps automatic continuations quota-free after selector work", async () => {
    const label = `agent-auto-continuation-${crypto.randomUUID()}`;
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      routes: {
        primary: {
          label: "Primary",
          type: "openai-chat",
          baseUrl: "https://selector-continuation.example/v1",
          model: "selector-model",
          apiKey: "selector-test-key",
        },
      },
      defaults: {
        defaultRoute: "primary",
        allowedRoutes: ["primary"],
        dailyMessageLimit: 1,
        minuteMessageLimit: 10,
      },
      users: { [label]: { allowedSkills: ["analysis"] } },
      skills: {
        analysis: {
          enabled: true,
          label: "Analysis",
          description: "Inspect evidence",
          instructions: "Analyze evidence.",
        },
      },
      tools: {},
    }));
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      openAiCompletionResponse('{"skillIds":["analysis"]}'),
    );
    const now = Date.now();
    const session: Session = {
      id: crypto.randomUUID(),
      label,
      kind: "member",
      createdAt: now,
      lastSeen: now,
      expiresAt: now + 60_000,
    };
    const input = {
      ...turnContext(),
      messages: [{ role: "user" as const, content: "Continue with automatic selection" }],
      skillMode: "automatic" as const,
      skillIds: [] as string[],
    };

    const initial = await prepareTeamAgentTurn(env, session, input);
    expect(initial.ok).toBe(true);
    if (initial.ok) await Promise.allSettled([initial.closeTools(), initial.releaseTurn()]);

    const continuation = await prepareTeamAgentTurn(env, session, { ...turnContext(), ...input, continuation: true });
    expect(continuation.ok).toBe(true);
    if (continuation.ok) await Promise.allSettled([continuation.closeTools(), continuation.releaseTurn()]);
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    const nextTurn = await prepareTeamAgentTurn(env, session, { ...turnContext(),
      messages: input.messages,
      skillMode: "manual",
      skillIds: [],
    });
    expect(nextTurn).toMatchObject({ ok: false, error: "rate_limited", status: 429 });
  });

  it("denies a tool continuation before issuing its Provider request", async () => {
    const label = `agent-tool-budget-${crypto.randomUUID()}`;
    const providerId = `tool-budget-${crypto.randomUUID()}`;
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      providers: {
        [providerId]: {
          label: "Tool Provider",
          type: "openai-chat",
          baseUrl: "https://tool-budget.example/v1",
          apiKey: "tool-test-key",
          supportsTools: true,
        },
      },
      routes: {
        primary: {
          label: "Primary",
          offerings: [{ providerId, model: "tool-model" }],
          supportsTools: true,
        },
      },
      defaults: {
        defaultRoute: "primary",
        allowedRoutes: ["primary"],
        dailyMessageLimit: 1,
        minuteMessageLimit: 10,
      },
      tools: {},
    }));
    const periodStart = Date.now() - 1_000;
    const toolBudgetPolicy = hardBudgetPolicy(
      providerId,
      `policy-tool-${crypto.randomUUID()}`,
      periodStart,
    );
    const toolBudgetLedger = env.PROVIDER_ATTEMPT_LEDGER.getByName(providerId);
    await toolBudgetLedger.addBudgetPolicy({ ...toolBudgetPolicy, mode: "shadow" });
    await toolBudgetLedger.addBudgetPolicy({
      ...toolBudgetPolicy,
      idempotencyKey: `provider-budget-policy:v1:${crypto.randomUUID()}`,
      expectedPreviousVersion: 1,
      createdAt: periodStart + 1,
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(openAiStreamResponse("must not run"));
    const now = Date.now();
    const session: Session = {
      id: crypto.randomUUID(),
      label,
      kind: "member",
      createdAt: now,
      lastSeen: now,
      expiresAt: now + 60_000,
    };
    const context = turnContext();
    const initial = await prepareTeamAgentTurn(env, session, {
      ...context,
      messages: [{ role: "user", content: "Start a tool turn" }],
      skillMode: "manual",
      skillIds: [],
    });
    expect(initial.ok).toBe(true);
    if (initial.ok) await Promise.allSettled([initial.closeTools(), initial.releaseTurn()]);

    const continuation = await prepareTeamAgentTurn(env, session, {
      ...context,
      messages: [{ role: "user", content: "Continue after the tool result" }],
      skillMode: "manual",
      skillIds: [],
      continuation: true,
    });
    expect(continuation.ok).toBe(true);
    if (!continuation.ok) return;
    await expect(continuation.model.doStream({ prompt: [] } as unknown as LanguageModelV3CallOptions))
      .rejects.toMatchObject({ code: "provider_budget_policy_unknown" });
    expect(fetchSpy).not.toHaveBeenCalled();
    await expect(env.PROVIDER_ATTEMPT_LEDGER.getByName(providerId).listRecent()).resolves.toEqual([]);
    await expect(env.PROVIDER_ATTEMPT_LEDGER.getByName(providerId).getFinanceSnapshot({
      periodStart,
      limit: 10,
    })).resolves.toMatchObject({
      capacity: { calls: 0 },
      budgetBalances: [expect.objectContaining({ denialCount: 1, reservedMicros: 0 })],
    });
    await Promise.allSettled([continuation.closeTools(), continuation.releaseTurn()]);
  });

  it("falls back from malformed automatic selection to the revalidated last success", async () => {
    const label = `agent-auto-skill-fallback-${crypto.randomUUID()}`;
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      routes: {
        primary: {
          label: "Primary",
          type: "openai-chat",
          baseUrl: "https://selector-malformed.example/v1",
          model: "selector-model",
          apiKey: "selector-test-key",
        },
      },
      defaults: { defaultRoute: "primary", allowedRoutes: ["primary"] },
      users: { [label]: { allowedSkills: ["writing", "analysis"] } },
      skills: {
        writing: { enabled: true, label: "Writing", instructions: "Write clearly.", order: 1 },
        analysis: { enabled: true, label: "Analysis", instructions: "Analyze evidence.", order: 2 },
      },
      tools: {},
    }));
    vi.spyOn(globalThis, "fetch").mockResolvedValue(openAiCompletionResponse("not json"));
    const now = Date.now();
    const session: Session = {
      id: crypto.randomUUID(),
      label,
      kind: "member",
      createdAt: now,
      lastSeen: now,
      expiresAt: now + 60_000,
    };

    const prepared = await prepareTeamAgentTurn(env, session, { ...turnContext(),
      messages: [{ role: "user", content: "Continue the draft" }],
      skillMode: "automatic",
      skillIds: ["writing", "revoked"],
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.skillIds).toEqual(["writing"]);
    expect(prepared.skillSelection).toEqual({
      mode: "automatic",
      source: "last_success",
      reason: "invalid_response",
      skills: [{ id: "writing", label: "Writing" }],
    });
    await Promise.allSettled([prepared.closeTools(), prepared.releaseTurn()]);
  });

  it("hard-bounds automatic selection at five seconds and ignores a late success", async () => {
    const label = `agent-auto-skill-timeout-${crypto.randomUUID()}`;
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      routes: {
        primary: {
          label: "Primary",
          type: "openai-chat",
          baseUrl: "https://selector-timeout.example/v1",
          model: "selector-model",
          apiKey: "selector-test-key",
        },
      },
      defaults: { defaultRoute: "primary", allowedRoutes: ["primary"] },
      users: { [label]: { allowedSkills: ["analysis", "writing"] } },
      skills: {
        writing: { enabled: true, label: "Writing", instructions: "Write clearly.", order: 2 },
        analysis: { enabled: true, label: "Analysis", instructions: "Analyze evidence.", order: 1 },
      },
      tools: {},
    }));
    let observedSignal: AbortSignal | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => new Promise<Response>((resolve, reject) => {
      if (!init?.signal) return reject(new Error("selector request did not receive an abort signal"));
      observedSignal = init.signal;
      setTimeout(() => resolve(openAiCompletionResponse('{"skillIds":["writing"]}')), 5_250);
    }));
    const now = Date.now();
    const session: Session = {
      id: crypto.randomUUID(),
      label,
      kind: "member",
      createdAt: now,
      lastSeen: now,
      expiresAt: now + 60_000,
    };
    const startedAt = Date.now();
    const prepared = await prepareTeamAgentTurn(env, session, { ...turnContext(),
      messages: [{ role: "user", content: "Analyze and draft the result" }],
      skillMode: "automatic",
      skillIds: [],
    });
    expect(Date.now() - startedAt).toBeLessThan(5_500);
    expect(observedSignal?.aborted).toBe(true);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.skillSnapshotIds).toBeUndefined();
    expect(prepared.skillIds).toEqual(["analysis", "writing"]);
    expect(prepared.skillSelection).toEqual({
      mode: "automatic",
      source: "admin_default",
      reason: "timeout",
      skills: [
        { id: "analysis", label: "Analysis" },
        { id: "writing", label: "Writing" },
      ],
    });
    await Promise.allSettled([prepared.closeTools(), prepared.releaseTurn()]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const attempts = await env.PROVIDER_ATTEMPT_LEDGER.getByName("legacy:primary").listRecent({ limit: 100 });
    expect(attempts).toContainEqual(expect.objectContaining({
      runKind: "automatic_skill",
      logicalRouteId: "primary",
      model: "selector-model",
      status: "timed_out",
      errorClass: "upstream_timeout",
      startedAt: expect.any(Number),
      endedAt: expect.any(Number),
    }));
  }, 8_000);

  it("revalidates automatic model output after a concurrent Skill revocation", async () => {
    const label = `agent-auto-skill-race-${crypto.randomUUID()}`;
    const config = {
      routes: {
        primary: {
          label: "Primary",
          type: "openai-chat",
          baseUrl: "https://selector-race.example/v1",
          model: "selector-model",
          apiKey: "selector-test-key",
        },
      },
      defaults: { defaultRoute: "primary", allowedRoutes: ["primary"] },
      users: { [label]: { allowedSkills: ["writing", "analysis"] } },
      skills: {
        writing: { enabled: true, label: "Writing", instructions: "REVOKED WRITING INSTRUCTIONS", order: 1 },
        analysis: { enabled: true, label: "Analysis", instructions: "SAFE ANALYSIS INSTRUCTIONS", order: 2 },
      },
      tools: {},
    };
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify(config));
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
        ...config,
        users: { [label]: { allowedSkills: ["analysis"] } },
      }));
      return openAiCompletionResponse('{"skillIds":["writing"]}');
    });
    const now = Date.now();
    const session: Session = {
      id: crypto.randomUUID(),
      label,
      kind: "member",
      createdAt: now,
      lastSeen: now,
      expiresAt: now + 60_000,
    };
    const prepared = await prepareTeamAgentTurn(env, session, { ...turnContext(),
      messages: [{ role: "user", content: "Draft a report" }],
      skillMode: "automatic",
      skillIds: ["writing"],
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.skillIds).toEqual(["analysis"]);
    expect(prepared.skillSelection).toEqual({
      mode: "automatic",
      source: "admin_default",
      reason: "no_valid_skills",
      skills: [{ id: "analysis", label: "Analysis" }],
    });
    expect(JSON.stringify(prepared.messages)).not.toContain("REVOKED WRITING INSTRUCTIONS");
    expect(JSON.stringify(prepared.messages)).toContain("SAFE ANALYSIS INSTRUCTIONS");
    await Promise.allSettled([prepared.closeTools(), prepared.releaseTurn()]);
  });

  it("enforces the guest route boundary and ignores guest-provided summaries in Agent turns", async () => {
    await configurePublicAgentAccess();
    const now = Date.now();
    const session: Session = {
      id: crypto.randomUUID(),
      label: `guest-${crypto.randomUUID()}`,
      kind: "guest",
      createdAt: now,
      lastSeen: now,
      expiresAt: now + 60_000,
      sourceKey: `guest-source:${"b".repeat(64)}`,
    };

    const forged = await prepareTeamAgentTurn(env, session, { ...turnContext(),
      routeId: PRIVATE_ROUTE_ID,
      messages: [{ role: "user", content: "try private route" }],
    });
    expect(forged).toMatchObject({ ok: false, error: "route_not_allowed", status: 403 });

    const prepared = await prepareTeamAgentTurn(env, session, { ...turnContext(),
      routeId: PUBLIC_ROUTE_ID,
      sessionSummary: "GUEST SUMMARY MUST NOT REACH PROVIDER",
      skillIds: ["private"],
      userApiKey: "guest-byok-must-be-ignored",
      messages: [{ role: "user", content: "use public route" }],
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    expect(prepared.skillIds).toEqual([]);
    expect(prepared.toolDefinitions).toEqual([]);
    expect(prepared.memoryToolEnabled).toBe(false);
    expect(JSON.stringify(prepared.messages)).not.toContain("GUEST SUMMARY MUST NOT REACH PROVIDER");
    await Promise.allSettled([prepared.closeTools(), prepared.releaseTurn()]);
  });

  it("does not consume message quota again for an Agent continuation", async () => {
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      routes: {
        primary: {
          label: "Primary",
          type: "openai-chat",
          baseUrl: "https://primary.example/v1",
          model: "primary-model",
          apiKey: "primary-test-key",
        },
      },
      defaults: {
        defaultRoute: "primary",
        allowedRoutes: ["primary"],
        dailyMessageLimit: 1,
        minuteMessageLimit: 10,
      },
    }));
    const now = Date.now();
    const session: Session = {
      id: crypto.randomUUID(),
      label: `agent-continuation-${crypto.randomUUID()}`,
      kind: "member",
      createdAt: now,
      lastSeen: now,
      expiresAt: now + 60_000,
    };
    const input = { ...turnContext(), messages: [{ role: "user" as const, content: "继续完成这个任务" }] };

    const initial = await prepareTeamAgentTurn(env, session, input);
    expect(initial.ok).toBe(true);
    if (initial.ok) await initial.closeTools();

    const continuation = await prepareTeamAgentTurn(env, session, { ...turnContext(), ...input, continuation: true });
    expect(continuation.ok).toBe(true);
    if (continuation.ok) await continuation.closeTools();

    const nextTurn = await prepareTeamAgentTurn(env, session, input);
    expect(nextTurn).toMatchObject({ ok: false, error: "rate_limited", status: 429 });
  });

  it("runs an assigned builtin tool inside the AI SDK stream without live model calls", async () => {
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      routes: {
        primary: {
          label: "Primary",
          type: "openai-chat",
          baseUrl: "https://primary.example/v1",
          model: "primary-model",
          apiKey: "primary-test-key",
          supportsTools: true,
        },
      },
      defaults: {
        defaultRoute: "primary",
        allowedRoutes: ["primary"],
        allowedTools: ["builtin:text_stats"],
      },
      skills: {
        writing: {
          enabled: true,
          label: "Writing",
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
    const now = Date.now();
    const session: Session = {
      id: crypto.randomUUID(),
      label: `agent-tool-stream-${crypto.randomUUID()}`,
      kind: "member",
      createdAt: now,
      lastSeen: now,
      expiresAt: now + 60_000,
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const payload = JSON.parse(String(init?.body || "{}")) as { tools?: Array<{ function?: { name?: string } }> };
      const name = payload.tools?.[0]?.function?.name || "tool";
      return fetchSpy.mock.calls.length === 1
        ? openAiToolCallStreamResponse(name, { text: "hello world" })
        : openAiStreamResponse("统计完成，共 11 个字符、2 个单词。");
    });
    const prepared = await prepareTeamAgentTurn(env, session, { ...turnContext(),
      messages: [{ role: "user", content: "统计 hello world" }],
      skillIds: ["writing"],
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    const providerName = prepared.toolDefinitions[0].providerName;
    const tools = createAgentToolSet({
      definitions: prepared.toolDefinitions,
      conversationId: "chat-tool-stream",
      runTool: prepared.runTool,
      approvals: { isTrusted: () => false, markTrusted: () => undefined },
    });
    const streamErrors: unknown[] = [];
    const result = streamText({
      model: prepared.model,
      messages: prepared.messages,
      tools,
      stopWhen: stepCountIs(prepared.maxToolSteps),
      maxRetries: 0,
      allowSystemInMessages: true,
      onError: (event) => streamErrors.push(event.error),
    });
    const response = result.toUIMessageStreamResponse();
    const body = await response.text();

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(streamErrors).toEqual([]);
    expect(body).toContain(providerName);
    expect(body).toContain("characters");
    expect(body).toContain("统计完成");
    await prepared.closeTools();
  });
});

async function clearRouteReliability(): Promise<void> {
  let cursor: string | undefined;
  do {
    const page = await env.CHAT_STORE.list({ prefix: ROUTE_RELIABILITY_PREFIX, cursor, limit: 100 });
    await Promise.all(page.keys.map((key) => env.CHAT_STORE.delete(key.name)));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
}

async function clearRouteSecrets(): Promise<void> {
  let cursor: string | undefined;
  do {
    const page = await env.CHAT_STORE.list({ prefix: ROUTE_SECRET_PREFIX, cursor, limit: 100 });
    await Promise.all(page.keys.map((key) => env.CHAT_STORE.delete(key.name)));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
}

async function configurePublicAgentAccess(): Promise<void> {
  const admin = await exports.default.fetch(new Request("https://example.test/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "test-admin-token" }),
  }));
  expect(admin.status).toBe(200);
  const adminCookie = admin.headers.get("Set-Cookie")?.split(";", 1)[0] || "";
  expect(adminCookie).toMatch(/^chatus_admin=/);

  const savedSecret = await exports.default.fetch(new Request("https://example.test/api/admin/route-secrets/PUBLIC_AGENT_TEST_KEY", {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: adminCookie },
    body: JSON.stringify({ apiKey: "public-agent-managed-test-key" }),
  }));
  expect(savedSecret.status).toBe(200);

  await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
    providers: {
      public: {
        label: "Public",
        type: "openai-chat",
        baseUrl: "https://public-agent.example/v1",
        apiKeyRef: "PUBLIC_AGENT_TEST_KEY",
        supportsTools: true,
      },
    },
    routes: {
      [PUBLIC_ROUTE_ID]: {
        label: "Public",
        offerings: [{ providerId: "public", model: "public-agent-model" }],
        supportsTools: true,
      },
      [PRIVATE_ROUTE_ID]: {
        label: "Private",
        type: "openai-chat",
        baseUrl: "https://private-agent.example/v1",
        model: "private-agent-model",
        apiKey: "private-agent-test-key",
      },
    },
    defaults: { defaultRoute: PRIVATE_ROUTE_ID, allowedRoutes: [PRIVATE_ROUTE_ID, PUBLIC_ROUTE_ID] },
    publicAccess: {
      enabled: true,
      routeId: PUBLIC_ROUTE_ID,
      sessionTtlSeconds: 86_400,
      dailyMessageLimit: 20,
      minuteMessageLimit: 6,
      sourceDailyMessageLimit: 200,
      sourceMinuteMessageLimit: 30,
    },
    skills: {
      private: {
        enabled: true,
        label: "Private",
        instructions: "Private instructions must not reach a guest.",
        toolIds: [],
      },
    },
    tools: {},
  }));
}

function openAiStreamResponse(text: string): Response {
  const chunks = [
    {
      id: "chatcmpl-stream-test",
      object: "chat.completion.chunk",
      created: 1,
      model: "backup-model",
      choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
    },
    {
      id: "chatcmpl-stream-test",
      object: "chat.completion.chunk",
      created: 1,
      model: "backup-model",
      choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
    },
    {
      id: "chatcmpl-stream-test",
      object: "chat.completion.chunk",
      created: 1,
      model: "backup-model",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    },
  ];
  const body = `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`;
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function openAiCompletionResponse(text: string): Response {
  return new Response(JSON.stringify({
    id: "chatcmpl-selector-test",
    object: "chat.completion",
    created: 1,
    model: "selector-model",
    choices: [{
      index: 0,
      message: { role: "assistant", content: text },
      finish_reason: "stop",
    }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
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

function openAiSseChunk(delta: Record<string, unknown>): string {
  return `data: ${JSON.stringify({
    id: "chatcmpl-progressive-test",
    object: "chat.completion.chunk",
    created: 1,
    model: "progressive-model",
    choices: [{ index: 0, delta, finish_reason: null }],
  })}\n\n`;
}

function openAiSseFinishChunk(): string {
  return `data: ${JSON.stringify({
    id: "chatcmpl-progressive-test",
    object: "chat.completion.chunk",
    created: 1,
    model: "progressive-model",
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
  })}\n\n`;
}

async function readUntilText(reader: ReadableStreamDefaultReader<Uint8Array>, expected: string): Promise<string> {
  const decoder = new TextDecoder();
  let output = "";
  while (!output.includes(expected)) {
    const next = await reader.read();
    if (next.done) throw new Error(`stream ended before ${expected}`);
    output += decoder.decode(next.value, { stream: true });
  }
  return output;
}

async function readRemainingText(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let output = "";
  while (true) {
    const next = await reader.read();
    if (next.done) return output + decoder.decode();
    output += decoder.decode(next.value, { stream: true });
  }
}

function openAiToolCallStreamResponse(name: string, input: Record<string, unknown>): Response {
  const chunks = [
    {
      id: "chatcmpl-tool-test",
      object: "chat.completion.chunk",
      created: 1,
      model: "primary-model",
      choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
    },
    {
      id: "chatcmpl-tool-test",
      object: "chat.completion.chunk",
      created: 1,
      model: "primary-model",
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{
            index: 0,
            id: "call-text-stats",
            type: "function",
            function: { name, arguments: JSON.stringify(input) },
          }],
        },
        finish_reason: null,
      }],
    },
    {
      id: "chatcmpl-tool-test",
      object: "chat.completion.chunk",
      created: 1,
      model: "primary-model",
      choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    },
  ];
  const body = `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`;
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}
