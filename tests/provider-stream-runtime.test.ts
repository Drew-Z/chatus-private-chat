import { describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "../src/contracts/chat";
import type { ResolvedProviderRoute } from "../src/contracts/provider";
import {
  callProviderStream,
  MAX_PROVIDER_STREAM_PREFLIGHT_BYTES,
  UpstreamRequestError,
} from "../src/services/provider-stream-runtime";

const encoder = new TextEncoder();

function route(
  type: ResolvedProviderRoute["type"],
  overrides: Partial<ResolvedProviderRoute> = {},
): ResolvedProviderRoute {
  return {
    routeId: "chat",
    providerId: "fixture",
    label: "Fixture",
    type,
    baseUrl: "https://provider.example/v1/",
    model: "fixture-model",
    allowUserKey: true,
    requiresUserKey: false,
    supportsImages: true,
    supportsTools: false,
    concurrency: "unlimited",
    maxConcurrent: 100,
    queueTimeoutMs: 10_000,
    priority: 0,
    ...overrides,
  };
}

function openAiEvent(content: string): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify({
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
  })}\n\n`);
}

function openAiMetadataEvent(): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify({
    choices: [{ index: 0, delta: {}, finish_reason: null }],
  })}\n\n`);
}

function anthropicEvent(event: string, payload: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function streamFromChunks(chunks: Uint8Array[], onCancel?: (reason: unknown) => void): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(chunks[index]);
      index += 1;
    },
    cancel(reason) {
      onCancel?.(reason);
    },
  });
}

async function nextTask(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("provider stream runtime", () => {
  it("waits for genuine OpenAI-visible output before returning the stream", async () => {
    let upstream: ReadableStreamDefaultController<Uint8Array> | undefined;
    const source = new ReadableStream<Uint8Array>({ start: (controller) => { upstream = controller; } });
    let capturedUrl = "";
    let capturedHeaders = new Headers();
    let capturedBody: Record<string, unknown> = {};
    let capturedSignal: AbortSignal | null = null;
    const signal = new AbortController().signal;
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedHeaders = new Headers(init?.headers);
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      capturedSignal = init?.signal as AbortSignal;
      return new Response(source, { headers: { "Content-Type": "text/event-stream" } });
    });
    let settled = false;
    const attemptPromise = callProviderStream({
      route: route("openai-chat", { temperature: 0.4 }),
      apiKey: "fixture-key",
      usedUserKey: false,
      messages: [{ role: "user", content: "Hello" }],
      temperature: "1",
      defaultMaxTokens: 4096,
      signal,
      fetch: fetcher,
    }).then((attempt) => {
      settled = true;
      return attempt;
    });

    await nextTask();
    expect(settled).toBe(false);
    upstream?.enqueue(openAiMetadataEvent());
    await nextTask();
    expect(settled).toBe(false);
    upstream?.enqueue(openAiEvent("visible"));
    const attempt = await attemptPromise;
    expect(attempt.ok).toBe(true);
    if (!attempt.ok) throw new Error("expected successful stream attempt");

    upstream?.enqueue(encoder.encode("data: [DONE]\n\n"));
    upstream?.close();
    await expect(new Response(attempt.body).text()).resolves.toContain("visible");
    expect(capturedUrl).toBe("https://provider.example/v1/chat/completions");
    expect(capturedSignal).not.toBe(signal);
    expect(capturedSignal?.aborted).toBe(false);
    expect(capturedHeaders.get("Authorization")).toBe("Bearer fixture-key");
    expect(capturedBody).toMatchObject({
      model: "fixture-model",
      messages: [{ role: "user", content: "Hello" }],
      stream: true,
      temperature: 0.4,
    });
  });

  it("classifies HTTP failures before any stream is committed", async () => {
    const messages: ChatMessage[] = [{ role: "user", content: "Hello" }];
    const userKeyAttempt = await callProviderStream({
      route: route("openai-chat"),
      apiKey: "user-key",
      usedUserKey: true,
      messages,
      temperature: 0.5,
      defaultMaxTokens: 4096,
      fetch: async () => new Response(JSON.stringify({ error: { message: "invalid credential" } }), { status: 401 }),
    });
    expect(userKeyAttempt).toEqual({
      ok: false,
      status: 401,
      message: "invalid credential",
      terminal: true,
    });

    const serverKeyAttempt = await callProviderStream({
      route: route("openai-chat"),
      apiKey: "server-key",
      usedUserKey: false,
      messages,
      temperature: 0.5,
      defaultMaxTokens: 4096,
      fetch: async () => new Response("unauthorized", { status: 401 }),
    });
    expect(serverKeyAttempt).toMatchObject({ ok: false, status: 401, terminal: false });
  });

  it("rejects DONE-only, oversized-metadata, and Anthropic error prefaces", async () => {
    const base = {
      apiKey: "fixture-key",
      usedUserKey: false,
      messages: [{ role: "user", content: "Hello" }] as ChatMessage[],
      temperature: 0.5,
      defaultMaxTokens: 4096,
    };
    await expect(callProviderStream({
      ...base,
      route: route("openai-chat"),
      fetch: async () => new Response("data: [DONE]\n\n"),
    })).rejects.toMatchObject({ status: 502, outcome: "protocol_error" });

    const oversized = new Uint8Array(MAX_PROVIDER_STREAM_PREFLIGHT_BYTES + 1);
    oversized.fill(58);
    await expect(callProviderStream({
      ...base,
      route: route("openai-chat"),
      fetch: async () => new Response(streamFromChunks([oversized])),
    })).rejects.toMatchObject({
      status: 502,
      outcome: "protocol_error",
      message: "upstream produced too much metadata before visible content",
    });

    await expect(callProviderStream({
      ...base,
      route: route("anthropic-messages", { baseUrl: "https://anthropic.example" }),
      fetch: async () => new Response(streamFromChunks([
        anthropicEvent("error", { type: "error", error: { message: "busy" } }),
      ])),
    })).rejects.toBeInstanceOf(UpstreamRequestError);
  });

  it("normalizes Anthropic text, finish, and stop events into OpenAI SSE", async () => {
    let capturedUrl = "";
    let capturedHeaders = new Headers();
    let capturedBody: Record<string, unknown> = {};
    const attempt = await callProviderStream({
      route: route("anthropic-messages", { baseUrl: "https://anthropic.example", maxTokens: 1024 }),
      apiKey: "fixture-key",
      usedUserKey: false,
      messages: [
        { role: "system", content: "Policy" },
        { role: "user", content: "Hello" },
      ],
      temperature: 3,
      defaultMaxTokens: 4096,
      fetch: async (input, init) => {
        capturedUrl = String(input);
        capturedHeaders = new Headers(init?.headers);
        capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(streamFromChunks([
          anthropicEvent("content_block_delta", {
            type: "content_block_delta",
            delta: { type: "text_delta", text: "hello" },
          }),
          anthropicEvent("message_delta", { type: "message_delta", delta: { stop_reason: "max_tokens" } }),
          anthropicEvent("message_stop", { type: "message_stop" }),
        ]));
      },
    });
    expect(attempt.ok).toBe(true);
    if (!attempt.ok) throw new Error("expected successful stream attempt");
    const text = await new Response(attempt.body).text();

    expect(capturedUrl).toBe("https://anthropic.example/v1/messages");
    expect(capturedHeaders.get("x-api-key")).toBe("fixture-key");
    expect(capturedHeaders.get("anthropic-version")).toBe("2023-06-01");
    expect(capturedBody).toMatchObject({
      model: "fixture-model",
      system: "Policy",
      stream: true,
      max_tokens: 1024,
      temperature: 1,
    });
    expect(text).toContain('"content":"hello"');
    expect(text).toContain('"finish_reason":"length"');
    expect(text).toContain("data: [DONE]");
  });

  it("fails after visible output without reopening fallback and propagates cancellation", async () => {
    let cancelled: unknown;
    const attempt = await callProviderStream({
      route: route("openai-chat"),
      apiKey: "fixture-key",
      usedUserKey: false,
      messages: [{ role: "user", content: "Hello" }],
      temperature: 0.5,
      defaultMaxTokens: 4096,
      fetch: async () => new Response(streamFromChunks([
        openAiEvent("visible"),
        encoder.encode("data: not-json\n\n"),
      ], (reason) => { cancelled = reason; })),
    });
    expect(attempt.ok).toBe(true);
    if (!attempt.ok) throw new Error("expected successful stream attempt");
    const reader = attempt.body.getReader();
    await expect(reader.read()).resolves.toMatchObject({ done: false });
    await expect(reader.read()).rejects.toMatchObject({ status: 502, outcome: "protocol_error" });

    let explicitCancel: unknown;
    const cancellable = await callProviderStream({
      route: route("openai-chat"),
      apiKey: "fixture-key",
      usedUserKey: false,
      messages: [{ role: "user", content: "Hello" }],
      temperature: 0.5,
      defaultMaxTokens: 4096,
      fetch: async () => new Response(streamFromChunks([
        openAiEvent("visible"),
      ], (reason) => { explicitCancel = reason; })),
    });
    expect(cancellable.ok).toBe(true);
    if (!cancellable.ok) throw new Error("expected cancellable stream attempt");
    await cancellable.cancelUpstream("stop");
    expect(explicitCancel).toBe("stop");
    expect(cancelled).toBeUndefined();
  });

  it("aborts fetch construction that produces no response before the sixty-second deadline", async () => {
    vi.useFakeTimers();
    try {
      let capturedSignal: AbortSignal | undefined;
      let markStarted!: () => void;
      const started = new Promise<void>((resolve) => { markStarted = resolve; });
      const attempt = callProviderStream({
        route: route("openai-chat"),
        apiKey: "fixture-key",
        usedUserKey: false,
        messages: [{ role: "user", content: "Hello" }],
        temperature: 0.5,
        defaultMaxTokens: 4096,
        fetch: async (_input, init) => {
          capturedSignal = init?.signal as AbortSignal;
          markStarted();
          return await new Promise<Response>(() => undefined);
        },
      });

      await started;
      const rejection = expect(attempt).rejects.toMatchObject({ name: "TimeoutError" });
      await vi.advanceTimersByTimeAsync(60_000);

      await rejection;
      expect(capturedSignal?.aborted).toBe(true);
      expect((capturedSignal?.reason as Error)?.name).toBe("TimeoutError");
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels a pre-visible SSE reader at the sixty-second deadline", async () => {
    vi.useFakeTimers();
    try {
      const cancel = vi.fn();
      const source = new ReadableStream<Uint8Array>({ cancel });
      let markStarted!: () => void;
      const started = new Promise<void>((resolve) => { markStarted = resolve; });
      const attempt = callProviderStream({
        route: route("openai-chat"),
        apiKey: "fixture-key",
        usedUserKey: false,
        messages: [{ role: "user", content: "Hello" }],
        temperature: 0.5,
        defaultMaxTokens: 4096,
        fetch: async () => {
          markStarted();
          return new Response(source);
        },
      });

      await started;
      const rejection = expect(attempt).rejects.toMatchObject({ name: "TimeoutError" });
      await vi.advanceTimersByTimeAsync(60_000);

      await rejection;
      expect(cancel).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves parent cancellation before visible output", async () => {
    const cancel = vi.fn();
    const source = new ReadableStream<Uint8Array>({ cancel });
    const controller = new AbortController();
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const attempt = callProviderStream({
      route: route("openai-chat"),
      apiKey: "fixture-key",
      usedUserKey: false,
      messages: [{ role: "user", content: "Hello" }],
      temperature: 0.5,
      defaultMaxTokens: 4096,
      signal: controller.signal,
      fetch: async () => {
        markStarted();
        return new Response(source);
      },
    });

    await started;
    controller.abort(new DOMException("cancelled by user", "AbortError"));

    await expect(attempt).rejects.toMatchObject({ name: "AbortError" });
  });

  it("does not abort a committed legacy stream after the first-visible deadline", async () => {
    vi.useFakeTimers();
    try {
      let upstream!: ReadableStreamDefaultController<Uint8Array>;
      let capturedSignal: AbortSignal | undefined;
      const source = new ReadableStream<Uint8Array>({
        start(controller) { upstream = controller; },
      });
      const attemptPromise = callProviderStream({
        route: route("openai-chat"),
        apiKey: "fixture-key",
        usedUserKey: false,
        messages: [{ role: "user", content: "Hello" }],
        temperature: 0.5,
        defaultMaxTokens: 4096,
        fetch: async (_input, init) => {
          capturedSignal = init?.signal as AbortSignal;
          return new Response(source);
        },
      });
      upstream.enqueue(openAiEvent("first"));
      const attempt = await attemptPromise;
      expect(attempt.ok).toBe(true);
      if (!attempt.ok) throw new Error("expected successful stream attempt");
      const reader = attempt.body.getReader();
      await expect(reader.read()).resolves.toMatchObject({ done: false });

      await vi.advanceTimersByTimeAsync(120_000);
      expect(capturedSignal?.aborted).toBe(false);
      upstream.enqueue(openAiEvent("later"));
      upstream.enqueue(encoder.encode("data: [DONE]\n\n"));
      upstream.close();
      await expect(readByteStream(reader)).resolves.toContain("later");
    } finally {
      vi.useRealTimers();
    }
  });
});

async function readByteStream(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let output = "";
  while (true) {
    const next = await reader.read();
    if (next.done) return output + decoder.decode();
    output += decoder.decode(next.value, { stream: true });
  }
}
