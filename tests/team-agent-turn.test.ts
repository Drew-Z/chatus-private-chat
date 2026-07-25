import { env, exports } from "cloudflare:workers";
import { stepCountIs, streamText } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentToolSet } from "../src/services/agent-tools";
import { loadProviderRouteReliability } from "../src/services/route-reliability";
import { prepareTeamAgentTurn, type Session } from "../src/worker";

const ROUTES_CONFIG_KEY = "config:routes_config";
const ROUTE_RELIABILITY_PREFIX = "route-reliability:";
const ROUTE_SECRET_PREFIX = "route-secret:";
const PUBLIC_ROUTE_ID = "public-agent-route";
const PRIVATE_ROUTE_ID = "private-agent-route";

describe("prepared TeamAgent turn", () => {
  beforeEach(async () => {
    await env.CHAT_STORE.delete(ROUTES_CONFIG_KEY);
    await clearRouteReliability();
    await clearRouteSecrets();
  });

  afterEach(() => vi.restoreAllMocks());

  it("falls back before visible output and returns an AI SDK UI message stream", async () => {
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

    const prepared = await prepareTeamAgentTurn(env, session, {
      messages: [{ role: "user", content: "整理三条发布检查事项" }],
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
    const prepared = await prepareTeamAgentTurn(env, session, {
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

    const prepared = await prepareTeamAgentTurn(env, session, {
      messages: [{ role: "user", content: "统计这段文字" }],
      skillIds: ["writing"],
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    expect(prepared.toolDefinitions).toHaveLength(1);
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

    const prepared = await prepareTeamAgentTurn(env, session, {
      messages: [{ role: "user", content: "继续旧会话" }],
      skillIds: ["writing"],
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    expect(prepared.skillIds).toEqual([]);
    expect(prepared.toolDefinitions).toEqual([]);
    expect(JSON.stringify(prepared.messages)).not.toContain("Revoked instructions");
    await prepared.closeTools();
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

    const forged = await prepareTeamAgentTurn(env, session, {
      routeId: PRIVATE_ROUTE_ID,
      messages: [{ role: "user", content: "try private route" }],
    });
    expect(forged).toMatchObject({ ok: false, error: "route_not_allowed", status: 403 });

    const prepared = await prepareTeamAgentTurn(env, session, {
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
    const input = { messages: [{ role: "user" as const, content: "继续完成这个任务" }] };

    const initial = await prepareTeamAgentTurn(env, session, input);
    expect(initial.ok).toBe(true);
    if (initial.ok) await initial.closeTools();

    const continuation = await prepareTeamAgentTurn(env, session, { ...input, continuation: true });
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
    const prepared = await prepareTeamAgentTurn(env, session, {
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
