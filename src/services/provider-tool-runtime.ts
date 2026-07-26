import type {
  ModelTurn,
  NormalizedToolCall,
  NormalizedToolDefinition,
} from "../contracts/capability";
import type { ChatMessage, ChatPart } from "../contracts/chat";
import { parseDataImage } from "../contracts/image";
import type { ResolvedProviderRoute, RouteConfig } from "../contracts/provider";
import { isTerminalProviderFailure } from "./provider-router";

export const DEFAULT_ANTHROPIC_VERSION = "2023-06-01";

export type ProviderToolHistory =
  | { type: "openai-chat"; messages: unknown[] }
  | { type: "anthropic-messages"; system: string; messages: unknown[] };

export type ProviderToolExecutionResult = {
  providerCallId: string;
  text: string;
  isError: boolean;
};

export type ProviderToolTurnArgs = {
  route: ResolvedProviderRoute;
  apiKey: string;
  history: ProviderToolHistory;
  tools: NormalizedToolDefinition[];
  temperature: unknown;
  defaultMaxTokens: number;
  signal: AbortSignal;
  usedUserKey: boolean;
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
};

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: {
        type: "base64";
        media_type: string;
        data: string;
      };
    };

export class ProviderToolError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly terminal: boolean,
  ) {
    super(message);
    this.name = "ProviderToolError";
  }
}

export class ProviderToolRuntimeError extends Error {
  constructor(readonly code: "provider_protocol_error" | "tool_not_allowed", message: string) {
    super(message);
    this.name = "ProviderToolRuntimeError";
  }
}

export function createProviderToolHistory(
  route: ResolvedProviderRoute,
  messages: ChatMessage[],
): ProviderToolHistory {
  if (route.type === "anthropic-messages") {
    const anthropic = toAnthropicMessages(messages);
    return { type: route.type, system: anthropic.system, messages: anthropic.messages };
  }
  return {
    type: route.type,
    messages: messages.map((message) => ({ role: message.role, content: message.content })),
  };
}

export async function callProviderToolTurn(args: ProviderToolTurnArgs): Promise<ModelTurn> {
  const response = args.route.type === "anthropic-messages"
    ? await callAnthropicToolTurn(args)
    : await callOpenAiToolTurn(args);
  const text = await response.text();
  if (!response.ok) {
    const terminal = isTerminalProviderFailure(response.status, args.usedUserKey);
    throw new ProviderToolError(response.status, formatUpstreamErrorMessage(text), terminal);
  }
  try {
    const payload = JSON.parse(text) as unknown;
    return args.route.type === "anthropic-messages"
      ? parseAnthropicToolTurn(payload, args.tools)
      : parseOpenAiToolTurn(payload, args.tools);
  } catch (error) {
    if (error instanceof ProviderToolRuntimeError) throw error;
    throw new ProviderToolError(502, "上游返回了无法识别的工具响应", false);
  }
}

export function appendProviderTurn(history: ProviderToolHistory, providerTurn: unknown): void {
  history.messages.push(providerTurn);
}

export function appendProviderToolResults(
  history: ProviderToolHistory,
  results: ProviderToolExecutionResult[],
): void {
  if (history.type === "openai-chat") {
    for (const result of results) {
      history.messages.push({ role: "tool", tool_call_id: result.providerCallId, content: result.text });
    }
    return;
  }
  history.messages.push({
    role: "user",
    content: results.map((result) => ({
      type: "tool_result",
      tool_use_id: result.providerCallId,
      content: result.text,
      ...(result.isError ? { is_error: true } : {}),
    })),
  });
}

export function toAnthropicMessages(messages: ChatMessage[]): {
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string | AnthropicContentBlock[] }>;
} {
  const system: string[] = [];
  const converted: Array<{ role: "user" | "assistant"; content: string | AnthropicContentBlock[] }> = [];

  for (const message of messages) {
    if (message.role === "system") {
      system.push(extractText(message.content));
      continue;
    }
    if (typeof message.content === "string") {
      converted.push({ role: message.role, content: message.content });
      continue;
    }

    const content: AnthropicContentBlock[] = [];
    for (const part of message.content) {
      if (part.type === "text") {
        content.push({ type: "text", text: part.text });
        continue;
      }
      const dataImage = parseDataImage(part.image_url.url);
      if (!dataImage.ok) throw new Error(dataImage.error);
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: dataImage.image.mediaType,
          data: dataImage.image.data,
        },
      });
    }
    converted.push({ role: message.role, content: content.length ? content : "" });
  }

  return {
    system: system.filter(Boolean).join("\n\n"),
    messages: converted,
  };
}

export function buildHeaders(input?: Record<string, string>): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(input || {})) headers.set(key, value);
  return headers;
}

export function setAuthHeader(
  headers: Headers,
  route: RouteConfig | ResolvedProviderRoute,
  apiKey: string,
  defaultHeader: string,
): void {
  const header = route.authHeader || defaultHeader;
  if (headers.has(header)) return;
  const lower = header.toLowerCase();
  const prefix = route.authPrefix !== undefined
    ? route.authPrefix
    : lower === "authorization" ? "Bearer " : "";
  headers.set(header, `${prefix}${apiKey}`);
}

export function routeUrl(route: ResolvedProviderRoute, suffix: string): string {
  const base = route.baseUrl.trim().replace(/\/+$/, "");
  return route.directEndpoint ? base : `${base}${suffix}`;
}

export function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function formatUpstreamErrorMessage(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return "upstream returned an empty error";
  try {
    const parsed: unknown = JSON.parse(trimmed);
    const message = findErrorMessage(parsed);
    return message || trimmed.slice(0, 500);
  } catch {
    return trimmed.slice(0, 500);
  }
}

async function callOpenAiToolTurn(args: ProviderToolTurnArgs): Promise<Response> {
  if (args.history.type !== "openai-chat") {
    throw new ProviderToolRuntimeError("provider_protocol_error", "Provider history mismatch");
  }
  const headers = buildHeaders(args.route.headers);
  setAuthHeader(headers, args.route, args.apiKey, "Authorization");
  headers.set("Content-Type", "application/json");
  headers.set("Accept", "application/json");
  const fetcher = args.fetch || fetch;
  return fetcher(providerToolUrl(args.route, "/chat/completions"), {
    method: "POST",
    headers,
    signal: args.signal,
    body: JSON.stringify({
      model: args.route.model,
      messages: args.history.messages,
      tools: args.tools.map((tool) => ({
        type: "function",
        function: {
          name: tool.providerName,
          description: tool.description,
          parameters: tool.inputSchema,
        },
      })),
      tool_choice: "auto",
      stream: false,
      temperature: clampNumber(args.temperature, 0, 2, args.route.temperature ?? 0.7),
      ...(args.route.maxTokens ? { max_tokens: args.route.maxTokens } : {}),
    }),
  });
}

async function callAnthropicToolTurn(args: ProviderToolTurnArgs): Promise<Response> {
  if (args.history.type !== "anthropic-messages") {
    throw new ProviderToolRuntimeError("provider_protocol_error", "Provider history mismatch");
  }
  const headers = buildHeaders(args.route.headers);
  setAuthHeader(headers, args.route, args.apiKey, "x-api-key");
  headers.set("Content-Type", "application/json");
  headers.set("Accept", "application/json");
  if (!headers.has("anthropic-version")) headers.set("anthropic-version", DEFAULT_ANTHROPIC_VERSION);
  const fetcher = args.fetch || fetch;
  return fetcher(providerToolUrl(args.route, "/v1/messages"), {
    method: "POST",
    headers,
    signal: args.signal,
    body: JSON.stringify({
      model: args.route.model,
      messages: args.history.messages,
      tools: args.tools.map((tool) => ({
        name: tool.providerName,
        description: tool.description,
        input_schema: tool.inputSchema,
      })),
      stream: false,
      max_tokens: args.route.maxTokens || args.defaultMaxTokens,
      temperature: clampNumber(args.temperature, 0, 1, args.route.temperature ?? 0.7),
      ...(args.history.system ? { system: args.history.system } : {}),
    }),
  });
}

function parseOpenAiToolTurn(value: unknown, tools: NormalizedToolDefinition[]): ModelTurn {
  if (!isRecord(value) || !Array.isArray(value.choices) || !isRecord(value.choices[0])) {
    throw new ProviderToolRuntimeError("provider_protocol_error", "OpenAI-compatible 响应缺少 choices");
  }
  const choice = value.choices[0];
  if (!isRecord(choice.message)) {
    throw new ProviderToolRuntimeError("provider_protocol_error", "OpenAI-compatible 响应缺少 message");
  }
  const message = choice.message;
  const text = typeof message.content === "string" ? message.content : "";
  const aliasMap = new Map(tools.map((tool) => [tool.providerName, tool.id]));
  const toolCalls: NormalizedToolCall[] = [];
  if (Array.isArray(message.tool_calls)) {
    for (const rawCall of message.tool_calls) {
      if (!isRecord(rawCall) || !isRecord(rawCall.function)) {
        throw new ProviderToolRuntimeError("provider_protocol_error", "OpenAI-compatible tool_call 格式无效");
      }
      const providerCallId = typeof rawCall.id === "string" ? rawCall.id : "";
      const providerName = typeof rawCall.function.name === "string" ? rawCall.function.name : "";
      const rawArguments = typeof rawCall.function.arguments === "string" ? rawCall.function.arguments : "";
      if (!providerCallId || !providerName || !aliasMap.has(providerName)) {
        throw new ProviderToolRuntimeError("tool_not_allowed", "模型请求了未授权的工具");
      }
      let parsedArguments: unknown;
      let argumentsValid = true;
      try {
        parsedArguments = JSON.parse(rawArguments);
      } catch {
        parsedArguments = null;
        argumentsValid = false;
      }
      toolCalls.push({
        providerCallId,
        providerName,
        toolId: aliasMap.get(providerName) || "",
        arguments: parsedArguments,
        argumentsValid,
      });
    }
  }
  return {
    text,
    toolCalls,
    finishReason: typeof choice.finish_reason === "string" ? choice.finish_reason : "",
    providerTurn: {
      role: "assistant",
      content: text || null,
      ...(Array.isArray(message.tool_calls) ? { tool_calls: message.tool_calls } : {}),
    },
  };
}

function parseAnthropicToolTurn(value: unknown, tools: NormalizedToolDefinition[]): ModelTurn {
  if (!isRecord(value) || !Array.isArray(value.content)) {
    throw new ProviderToolRuntimeError("provider_protocol_error", "Anthropic 响应缺少 content");
  }
  const aliasMap = new Map(tools.map((tool) => [tool.providerName, tool.id]));
  const textParts: string[] = [];
  const toolCalls: NormalizedToolCall[] = [];
  const providerContent: unknown[] = [];
  for (const block of value.content) {
    if (!isRecord(block) || typeof block.type !== "string") {
      throw new ProviderToolRuntimeError("provider_protocol_error", "Anthropic content block 格式无效");
    }
    if (block.type === "text" && typeof block.text === "string") {
      textParts.push(block.text);
      providerContent.push({ type: "text", text: block.text });
      continue;
    }
    if (block.type === "tool_use") {
      const providerCallId = typeof block.id === "string" ? block.id : "";
      const providerName = typeof block.name === "string" ? block.name : "";
      if (!providerCallId || !providerName || !aliasMap.has(providerName)) {
        throw new ProviderToolRuntimeError("tool_not_allowed", "模型请求了未授权的工具");
      }
      toolCalls.push({
        providerCallId,
        providerName,
        toolId: aliasMap.get(providerName) || "",
        arguments: block.input,
        argumentsValid: true,
      });
      providerContent.push({ type: "tool_use", id: providerCallId, name: providerName, input: block.input });
      continue;
    }
    throw new ProviderToolRuntimeError(
      "provider_protocol_error",
      `Anthropic 返回了不支持的 ${block.type} 内容块`,
    );
  }
  return {
    text: textParts.join(""),
    toolCalls,
    finishReason: typeof value.stop_reason === "string" ? value.stop_reason : "",
    providerTurn: { role: "assistant", content: providerContent },
  };
}

function extractText(content: string | ChatPart[]): string {
  if (typeof content === "string") return content;
  return content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
}

function providerToolUrl(route: ResolvedProviderRoute, suffix: string): string {
  return route.directEndpoint ? route.baseUrl : routeUrl(route, suffix);
}

function findErrorMessage(value: unknown): string {
  if (!isRecord(value)) return "";
  if (typeof value.message === "string") return value.message;
  if (isRecord(value.error)) return findErrorMessage(value.error);
  return "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
