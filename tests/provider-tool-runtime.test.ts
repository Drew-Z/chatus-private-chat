import { describe, expect, it, vi } from "vitest";
import type { NormalizedToolDefinition } from "../src/contracts/capability";
import type { ChatMessage } from "../src/contracts/chat";
import type { ResolvedProviderRoute } from "../src/contracts/provider";
import {
  appendProviderToolResults,
  appendProviderTurn,
  callProviderToolTurn,
  createProviderToolHistory,
  ProviderToolError,
  ProviderToolRuntimeError,
} from "../src/services/provider-tool-runtime";

const lookupTool: NormalizedToolDefinition = {
  id: "builtin:lookup",
  providerName: "lookup_tool",
  label: "Lookup",
  description: "Find public information",
  inputSchema: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  },
  config: {
    label: "Lookup",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
    executor: { type: "builtin", name: "text_stats" },
  },
};

function route(
  type: ResolvedProviderRoute["type"],
  overrides: Partial<ResolvedProviderRoute> = {},
): ResolvedProviderRoute {
  return {
    routeId: "tools",
    providerId: "fixture",
    label: "Tools",
    type,
    baseUrl: "https://provider.example/v1/",
    model: "fixture-model",
    allowUserKey: true,
    requiresUserKey: false,
    supportsImages: true,
    supportsTools: true,
    concurrency: "unlimited",
    maxConcurrent: 100,
    queueTimeoutMs: 10_000,
    priority: 0,
    ...overrides,
  };
}

describe("provider tool runtime", () => {
  it("builds and parses an OpenAI-compatible tool turn", async () => {
    const providerRoute = route("openai-chat", {
      directEndpoint: true,
      baseUrl: "https://provider.example/custom-tools/",
      maxTokens: 512,
      temperature: 0.4,
      headers: { "X-Tenant": "fixture" },
    });
    const messages: ChatMessage[] = [
      { role: "system", content: "Be concise." },
      { role: "user", content: "Look this up." },
    ];
    const history = createProviderToolHistory(providerRoute, messages);
    let capturedUrl = "";
    let capturedHeaders = new Headers();
    let capturedBody: Record<string, unknown> = {};
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedHeaders = new Headers(init?.headers);
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        choices: [{
          message: {
            role: "assistant",
            content: null,
            tool_calls: [{
              id: "call-1",
              type: "function",
              function: { name: "lookup_tool", arguments: JSON.stringify({ query: "chatus" }) },
            }],
          },
          finish_reason: "tool_calls",
        }],
      }), { headers: { "Content-Type": "application/json" } });
    });

    const turn = await callProviderToolTurn({
      route: providerRoute,
      apiKey: "fixture-key",
      history,
      tools: [lookupTool],
      temperature: "1",
      defaultMaxTokens: 4096,
      signal: new AbortController().signal,
      usedUserKey: false,
      fetch: fetcher,
    });

    expect(capturedUrl).toBe("https://provider.example/custom-tools/");
    expect(capturedHeaders.get("Authorization")).toBe("Bearer fixture-key");
    expect(capturedHeaders.get("X-Tenant")).toBe("fixture");
    expect(capturedBody).toMatchObject({
      model: "fixture-model",
      stream: false,
      tool_choice: "auto",
      temperature: 0.4,
      max_tokens: 512,
    });
    expect(turn).toMatchObject({
      text: "",
      finishReason: "tool_calls",
      toolCalls: [{
        providerCallId: "call-1",
        providerName: "lookup_tool",
        toolId: "builtin:lookup",
        arguments: { query: "chatus" },
        argumentsValid: true,
      }],
    });

    appendProviderTurn(history, turn.providerTurn);
    appendProviderToolResults(history, [{ providerCallId: "call-1", text: "result", isError: false }]);
    expect(history.messages.at(-1)).toEqual({ role: "tool", tool_call_id: "call-1", content: "result" });
  });

  it("converts Anthropic messages and parses text plus tool use", async () => {
    const providerRoute = route("anthropic-messages", {
      authHeader: "X-Custom-Key",
      authPrefix: "Token ",
      headers: { "anthropic-version": "fixture-version" },
    });
    const messages: ChatMessage[] = [
      { role: "system", content: "Policy one." },
      { role: "system", content: [{ type: "text", text: "Policy two." }] },
      {
        role: "user",
        content: [
          { type: "text", text: "Inspect image" },
          { type: "image_url", image_url: { url: "data:image/png;base64,aGVsbG8=" } },
        ],
      },
    ];
    const history = createProviderToolHistory(providerRoute, messages);
    let capturedHeaders = new Headers();
    let capturedBody: Record<string, unknown> = {};
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedHeaders = new Headers(init?.headers);
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        content: [
          { type: "text", text: "I will look it up. " },
          { type: "tool_use", id: "call-a", name: "lookup_tool", input: { query: "image" } },
        ],
        stop_reason: "tool_use",
      }), { headers: { "Content-Type": "application/json" } });
    });

    const turn = await callProviderToolTurn({
      route: providerRoute,
      apiKey: "fixture-key",
      history,
      tools: [lookupTool],
      temperature: 5,
      defaultMaxTokens: 2048,
      signal: new AbortController().signal,
      usedUserKey: false,
      fetch: fetcher,
    });

    expect(capturedHeaders.get("X-Custom-Key")).toBe("Token fixture-key");
    expect(capturedHeaders.get("anthropic-version")).toBe("fixture-version");
    expect(capturedBody).toMatchObject({
      model: "fixture-model",
      system: "Policy one.\n\nPolicy two.",
      stream: false,
      max_tokens: 2048,
      temperature: 1,
    });
    expect(JSON.stringify(capturedBody)).toContain('"type":"image"');
    expect(turn).toMatchObject({
      text: "I will look it up. ",
      finishReason: "tool_use",
      toolCalls: [{
        providerCallId: "call-a",
        providerName: "lookup_tool",
        toolId: "builtin:lookup",
        arguments: { query: "image" },
      }],
    });

    appendProviderTurn(history, turn.providerTurn);
    appendProviderToolResults(history, [{ providerCallId: "call-a", text: "denied", isError: true }]);
    expect(history.messages.at(-1)).toEqual({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "call-a", content: "denied", is_error: true }],
    });
  });

  it("keeps malformed OpenAI arguments visible for schema rejection", async () => {
    const providerRoute = route("openai-chat");
    const history = createProviderToolHistory(providerRoute, [{ role: "user", content: "Run" }]);
    const turn = await callProviderToolTurn({
      route: providerRoute,
      apiKey: "fixture-key",
      history,
      tools: [lookupTool],
      temperature: 0.5,
      defaultMaxTokens: 4096,
      signal: new AbortController().signal,
      usedUserKey: false,
      fetch: async () => new Response(JSON.stringify({
        choices: [{
          message: {
            tool_calls: [{ id: "call-bad", function: { name: "lookup_tool", arguments: "{" } }],
          },
          finish_reason: "tool_calls",
        }],
      })),
    });

    expect(turn.toolCalls[0]).toMatchObject({ arguments: null, argumentsValid: false });
  });

  it("classifies upstream errors and rejects unassigned tool names", async () => {
    const providerRoute = route("openai-chat");
    const history = createProviderToolHistory(providerRoute, [{ role: "user", content: "Run" }]);
    await expect(callProviderToolTurn({
      route: providerRoute,
      apiKey: "user-key",
      history,
      tools: [lookupTool],
      temperature: 0.5,
      defaultMaxTokens: 4096,
      signal: new AbortController().signal,
      usedUserKey: true,
      fetch: async () => new Response(JSON.stringify({ error: { message: "invalid credential" } }), { status: 401 }),
    })).rejects.toEqual(expect.objectContaining({
      status: 401,
      terminal: true,
      message: "invalid credential",
    }));

    await expect(callProviderToolTurn({
      route: providerRoute,
      apiKey: "fixture-key",
      history,
      tools: [lookupTool],
      temperature: 0.5,
      defaultMaxTokens: 4096,
      signal: new AbortController().signal,
      usedUserKey: false,
      fetch: async () => new Response(JSON.stringify({
        choices: [{
          message: {
            tool_calls: [{ id: "call-unknown", function: { name: "other_tool", arguments: "{}" } }],
          },
          finish_reason: "tool_calls",
        }],
      })),
    })).rejects.toBeInstanceOf(ProviderToolRuntimeError);
  });

  it("wraps invalid provider JSON as a retryable protocol attempt failure", async () => {
    const providerRoute = route("anthropic-messages");
    const history = createProviderToolHistory(providerRoute, [{ role: "user", content: "Run" }]);
    await expect(callProviderToolTurn({
      route: providerRoute,
      apiKey: "fixture-key",
      history,
      tools: [lookupTool],
      temperature: 0.5,
      defaultMaxTokens: 4096,
      signal: new AbortController().signal,
      usedUserKey: false,
      fetch: async () => new Response("not-json"),
    })).rejects.toMatchObject({
      name: "ProviderToolError",
      outcome: "protocol_error",
    });
  });
});
