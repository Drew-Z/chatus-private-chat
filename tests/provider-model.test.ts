import { generateText } from "ai";
import { describe, expect, it, vi } from "vitest";
import type { RouteConfig } from "../src/contracts/provider";
import type { ChatMessage } from "../src/contracts/chat";
import {
  buildProviderHeaders,
  createProviderLanguageModel,
  toProviderModelMessages,
} from "../src/services/provider-model";

function route(overrides: Partial<RouteConfig> = {}): RouteConfig {
  return {
    label: "Primary",
    type: "openai-chat",
    baseUrl: "https://provider.example/v1",
    model: "model-a",
    ...overrides,
  };
}

describe("provider model adapter", () => {
  it("preserves configured headers and custom authentication without leaking the default auth header", async () => {
    const fetchSpy = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("X-Provider-Key")).toBe("Token secret-key");
      expect(headers.get("Authorization")).toBeNull();
      expect(headers.get("X-Tenant")).toBe("tenant-a");
      return new Response(JSON.stringify({
        id: "chatcmpl-test",
        object: "chat.completion",
        created: 1,
        model: "model-a",
        choices: [{ index: 0, message: { role: "assistant", content: "完成" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const model = createProviderLanguageModel(route({
      authHeader: "X-Provider-Key",
      authPrefix: "Token ",
      headers: { "X-Tenant": "tenant-a" },
    }), "secret-key", { fetch: fetchSpy });

    const result = await generateText({ model, prompt: "执行一个真实任务", maxRetries: 0 });

    expect(result.text).toBe("完成");
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe("https://provider.example/v1/chat/completions");
  });

  it("uses an exact direct Anthropic endpoint and keeps route-provided authentication authoritative", async () => {
    const fetchSpy = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(String(url)).toBe("https://proxy.example/custom/messages");
      expect(headers.get("Authorization")).toBe("Bearer route-token");
      expect(headers.get("x-api-key")).toBeNull();
      return new Response(JSON.stringify({
        id: "msg-test",
        type: "message",
        role: "assistant",
        model: "claude-compatible",
        content: [{ type: "text", text: "已处理" }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const model = createProviderLanguageModel(route({
      type: "anthropic-messages",
      baseUrl: "https://proxy.example/custom/messages",
      model: "claude-compatible",
      directEndpoint: true,
      authHeader: "Authorization",
      authPrefix: "Bearer ",
    }), "route-token", { fetch: fetchSpy });

    const result = await generateText({ model, prompt: "整理一次任务结果", maxRetries: 0 });

    expect(result.text).toBe("已处理");
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("does not overwrite a route-supplied authentication header", () => {
    expect(buildProviderHeaders(route({
      headers: { authorization: "Basic existing" },
    }), "secret-key", "Authorization")).toMatchObject({ authorization: "Basic existing" });
  });

  it("converts legacy text and data-image messages into AI SDK model messages", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "system context" },
      {
        role: "user",
        content: [
          { type: "text", text: "inspect this" },
          { type: "image_url", image_url: { url: "data:image/png;base64,QUJD" } },
        ],
      },
      { role: "assistant", content: [{ type: "text", text: "done" }] },
    ];

    expect(toProviderModelMessages(messages)).toEqual([
      { role: "system", content: "system context" },
      {
        role: "user",
        content: [
          { type: "text", text: "inspect this" },
          { type: "image", image: "QUJD", mediaType: "image/png" },
        ],
      },
      { role: "assistant", content: "done" },
    ]);
  });
});
