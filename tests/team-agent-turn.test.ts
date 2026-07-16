import { env } from "cloudflare:workers";
import { stepCountIs, streamText } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentToolSet } from "../src/services/agent-tools";
import { prepareTeamAgentTurn, type Session } from "../src/worker";

const ROUTES_CONFIG_KEY = "config:routes_config";
const ROUTE_RELIABILITY_PREFIX = "route-reliability:";

describe("prepared TeamAgent turn", () => {
  beforeEach(async () => {
    await env.CHAT_STORE.delete(ROUTES_CONFIG_KEY);
    await clearRouteReliability();
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
      createdAt: now,
      lastSeen: now,
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
      createdAt: now,
      lastSeen: now,
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
      createdAt: now,
      lastSeen: now,
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
      createdAt: now,
      lastSeen: now,
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
