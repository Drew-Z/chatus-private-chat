import type { ChatMessage } from "../contracts/chat";
import type { ResolvedProviderRoute } from "../contracts/provider";
import { isTerminalProviderFailure } from "./provider-router";
import {
  buildHeaders,
  clampNumber,
  DEFAULT_ANTHROPIC_VERSION,
  formatUpstreamErrorMessage,
  routeUrl,
  setAuthHeader,
  toAnthropicMessages,
} from "./provider-tool-runtime";
import {
  createProviderFirstVisibleDeadline,
  raceWithAbort,
  type ProviderFirstVisibleDeadline,
} from "./provider-first-visible-deadline";

export const MAX_PROVIDER_STREAM_PREFLIGHT_BYTES = 256 * 1024;

export type ProviderStreamAttempt =
  | {
      ok: true;
      body: ReadableStream<Uint8Array>;
      cancelUpstream: (reason?: unknown) => Promise<void>;
    }
  | {
      ok: false;
      status: number;
      message: string;
      terminal: boolean;
    };

export type ProviderStreamArgs = {
  route: ResolvedProviderRoute;
  apiKey: string;
  usedUserKey: boolean;
  messages: ChatMessage[];
  temperature: unknown;
  defaultMaxTokens: number;
  signal?: AbortSignal;
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
};

export class UpstreamRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly outcome?: "protocol_error",
  ) {
    super(message);
    this.name = "UpstreamRequestError";
  }
}

export async function callProviderStream(args: ProviderStreamArgs): Promise<ProviderStreamAttempt> {
  const deadline = createProviderFirstVisibleDeadline(args.signal);
  try {
    const response = await raceWithAbort(
      args.route.type === "anthropic-messages"
        ? callAnthropicMessages({ ...args, signal: deadline.signal })
        : callOpenAiChat({ ...args, signal: deadline.signal }),
      deadline.signal,
    );

    if (response.ok && response.body) {
      const normalizedBody = args.route.type === "anthropic-messages"
        ? transformAnthropicStream(response.body)
        : response.body;
      const prepared = await prepareValidatedOpenAiSseStream(normalizedBody, deadline);
      return { ok: true, body: prepared.body, cancelUpstream: prepared.cancel };
    }

    const message = await response.text().catch(() => "");
    deadline.dispose();
    return {
      ok: false,
      status: response.status,
      message: formatUpstreamErrorMessage(message),
      terminal: isTerminalProviderFailure(response.status, args.usedUserKey),
    };
  } catch (error) {
    deadline.dispose();
    throw error;
  }
}

async function callOpenAiChat(args: ProviderStreamArgs): Promise<Response> {
  const headers = buildHeaders(args.route.headers);
  setAuthHeader(headers, args.route, args.apiKey, "Authorization");
  headers.set("Content-Type", "application/json");
  headers.set("Accept", "text/event-stream");
  const fetcher = args.fetch || fetch;
  return fetcher(routeUrl(args.route, "/chat/completions"), {
    method: "POST",
    headers,
    signal: args.signal,
    body: JSON.stringify({
      model: args.route.model,
      messages: args.messages,
      stream: true,
      temperature: clampNumber(args.temperature, 0, 2, args.route.temperature ?? 0.7),
      ...(args.route.maxTokens ? { max_tokens: args.route.maxTokens } : {}),
    }),
  });
}

async function callAnthropicMessages(args: ProviderStreamArgs): Promise<Response> {
  const headers = buildHeaders(args.route.headers);
  setAuthHeader(headers, args.route, args.apiKey, "x-api-key");
  headers.set("Content-Type", "application/json");
  headers.set("Accept", "text/event-stream");
  if (!headers.has("anthropic-version")) headers.set("anthropic-version", DEFAULT_ANTHROPIC_VERSION);
  const anthropic = toAnthropicMessages(args.messages);
  const fetcher = args.fetch || fetch;
  return fetcher(routeUrl(args.route, "/v1/messages"), {
    method: "POST",
    headers,
    signal: args.signal,
    body: JSON.stringify({
      model: args.route.model,
      messages: anthropic.messages,
      stream: true,
      max_tokens: args.route.maxTokens || args.defaultMaxTokens,
      temperature: clampNumber(args.temperature, 0, 1, args.route.temperature ?? 0.7),
      ...(anthropic.system ? { system: anthropic.system } : {}),
    }),
  });
}

class OpenAiSseValidator {
  private readonly decoder = new TextDecoder();
  private buffer = "";
  private visibleContent = false;
  private terminal = false;

  get hasVisibleContent(): boolean {
    return this.visibleContent;
  }

  get isTerminal(): boolean {
    return this.terminal;
  }

  push(chunk: Uint8Array): void {
    this.buffer += this.decoder.decode(chunk, { stream: true });
    this.consumeFrames();
  }

  finish(): void {
    this.buffer += this.decoder.decode();
    this.consumeFrames();
    if (this.buffer.trim()) throw protocolStreamError("upstream returned an incomplete SSE event");
    if (!this.visibleContent) throw protocolStreamError("upstream stream ended before visible content");
  }

  private consumeFrames(): void {
    while (true) {
      const separator = /\r?\n\r?\n/.exec(this.buffer);
      if (!separator) return;
      const frame = this.buffer.slice(0, separator.index);
      this.buffer = this.buffer.slice(separator.index + separator[0].length);
      const kind = inspectOpenAiSseFrame(frame);
      if (kind === "content") this.visibleContent = true;
      if (kind === "done") {
        if (!this.visibleContent) throw protocolStreamError("upstream stream ended before visible content");
        this.terminal = true;
        return;
      }
    }
  }
}

async function prepareValidatedOpenAiSseStream(
  source: ReadableStream<Uint8Array>,
  deadline: ProviderFirstVisibleDeadline,
): Promise<{
  body: ReadableStream<Uint8Array>;
  cancel: (reason?: unknown) => Promise<void>;
}> {
  const reader = source.getReader();
  const validator = new OpenAiSseValidator();
  const prefix: Uint8Array[] = [];
  let prefixBytes = 0;
  let cancelled = false;
  const cancel = async (reason?: unknown) => {
    if (cancelled) return;
    cancelled = true;
    await reader.cancel(reason).catch(() => undefined);
    deadline.dispose();
  };

  try {
    while (!validator.hasVisibleContent) {
      const next = await raceWithAbort(reader.read(), deadline.signal);
      if (next.done) {
        validator.finish();
        break;
      }
      if (!next.value.byteLength) continue;
      prefixBytes += next.value.byteLength;
      if (prefixBytes > MAX_PROVIDER_STREAM_PREFLIGHT_BYTES) {
        throw protocolStreamError("upstream produced too much metadata before visible content");
      }
      prefix.push(next.value);
      validator.push(next.value);
    }
  } catch (error) {
    await cancel();
    throw error;
  }
  deadline.commit();

  let prefixIndex = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (prefixIndex < prefix.length) {
        controller.enqueue(prefix[prefixIndex]);
        prefixIndex += 1;
        return;
      }
      if (validator.isTerminal) {
        await cancel();
        controller.close();
        return;
      }
      try {
        const next = await reader.read();
        if (next.done) {
          validator.finish();
          deadline.dispose();
          controller.close();
          return;
        }
        if (!next.value.byteLength) return;
        validator.push(next.value);
        controller.enqueue(next.value);
      } catch (error) {
        await cancel();
        controller.error(error);
      }
    },
    async cancel(reason) {
      await cancel(reason);
    },
  }, { highWaterMark: 0 });
  return { body, cancel };
}

function inspectOpenAiSseFrame(frame: string): "ignore" | "content" | "done" {
  const dataLines = frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).replace(/^ /, ""));
  if (!dataLines.length) return "ignore";
  const payload = dataLines.join("\n").trim();
  if (!payload) return "ignore";
  if (payload === "[DONE]") return "done";

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw protocolStreamError("upstream returned an invalid SSE event");
  }
  if (!isRecord(parsed)) throw protocolStreamError("upstream returned an invalid SSE payload");
  if (Object.prototype.hasOwnProperty.call(parsed, "error") && parsed.error !== undefined) {
    throw protocolStreamError("upstream returned an error event");
  }
  if (!Array.isArray(parsed.choices) || !parsed.choices.length || !isRecord(parsed.choices[0])) return "ignore";
  const choice = parsed.choices[0];
  const delta = isRecord(choice.delta) ? choice.delta : {};
  const message = isRecord(choice.message) ? choice.message : {};
  const text = typeof delta.content === "string"
    ? delta.content
    : typeof message.content === "string"
      ? message.content
      : typeof choice.text === "string" ? choice.text : "";
  return text ? "content" : "ignore";
}

function transformAnthropicStream(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let eventName = "";
  let doneSent = false;

  return new ReadableStream({
    async pull(controller) {
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          if (buffer.trim()) throw protocolStreamError("upstream returned an incomplete Anthropic SSE event");
          controller.close();
          return;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("event:")) {
            eventName = line.slice(6).trim();
            continue;
          }
          if (!line.startsWith("data:")) {
            if (!line.trim()) eventName = "";
            continue;
          }
          const payload = line.slice(5).trim();
          if (!payload) continue;

          const chunk = anthropicPayloadToOpenAiChunk(payload, eventName);
          if (chunk) {
            if (chunk === "data: [DONE]\n\n") {
              if (!doneSent) {
                controller.enqueue(encoder.encode(chunk));
                doneSent = true;
              }
              controller.close();
              await reader.cancel().catch(() => undefined);
              return;
            }
            controller.enqueue(encoder.encode(chunk));
            return;
          }
        }
      }
    },
    cancel() {
      return reader.cancel();
    },
  });
}

function anthropicPayloadToOpenAiChunk(payload: string, eventName: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw protocolStreamError("upstream returned an invalid Anthropic SSE event");
  }
  if (!isRecord(parsed)) throw protocolStreamError("upstream returned an invalid Anthropic SSE payload");
  if (parsed.type === "content_block_delta" && isRecord(parsed.delta)) {
    if (parsed.delta.type === "text_delta" && typeof parsed.delta.text === "string") {
      return openAiSseChunk(parsed.delta.text);
    }
    return "";
  }
  if (parsed.type === "error" || eventName === "error") {
    throw protocolStreamError("upstream returned an Anthropic error event");
  }
  if (parsed.type === "message_delta" && isRecord(parsed.delta) && typeof parsed.delta.stop_reason === "string") {
    return openAiFinishChunk(parsed.delta.stop_reason === "max_tokens" ? "length" : parsed.delta.stop_reason);
  }
  if (parsed.type === "message_stop" || eventName === "message_stop") return "data: [DONE]\n\n";
  return "";
}

function openAiSseChunk(text: string): string {
  return `data: ${JSON.stringify({
    choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
  })}\n\n`;
}

function openAiFinishChunk(finishReason: string): string {
  return `data: ${JSON.stringify({
    choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
  })}\n\n`;
}

function protocolStreamError(message: string): UpstreamRequestError {
  return new UpstreamRequestError(502, message, "protocol_error");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
