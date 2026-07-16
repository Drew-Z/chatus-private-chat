import { env } from "cloudflare:workers";
import { streamText } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
