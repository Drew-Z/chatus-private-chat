import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI, type OpenAIProviderSettings } from "@ai-sdk/openai";
import type { ImagePart, ModelMessage, TextPart } from "ai";
import type { ChatMessage } from "../contracts/chat";
import type { ResolvedProviderRoute } from "../contracts/provider";

type ProviderFetch = NonNullable<OpenAIProviderSettings["fetch"]>;

type CreateProviderLanguageModelOptions = {
  fetch?: ProviderFetch;
};

export function createProviderLanguageModel(
  route: ResolvedProviderRoute,
  apiKey: string,
  options: CreateProviderLanguageModelOptions = {},
) {
  if (route.type === "anthropic-messages") {
    const provider = createAnthropic({
      apiKey,
      baseURL: route.baseUrl,
      headers: buildProviderHeaders(route, apiKey, "x-api-key"),
      fetch: createRouteFetch(route, "x-api-key", options.fetch),
      name: "chatus.anthropic-compatible",
    });
    return provider.messages(route.model);
  }

  const provider = createOpenAI({
    apiKey,
    baseURL: route.baseUrl,
    headers: buildProviderHeaders(route, apiKey, "Authorization"),
    fetch: createRouteFetch(route, "Authorization", options.fetch),
    name: "chatus.openai-compatible",
  });
  return provider.chat(route.model);
}

export function buildProviderHeaders(
  route: ResolvedProviderRoute,
  apiKey: string,
  defaultAuthHeader: string,
): Record<string, string> {
  const headers = { ...(route.headers || {}) };
  const authHeader = route.authHeader || defaultAuthHeader;
  if (!hasHeader(headers, authHeader)) {
    const prefix = route.authPrefix !== undefined
      ? route.authPrefix
      : authHeader.toLowerCase() === "authorization"
        ? "Bearer "
        : "";
    headers[authHeader] = `${prefix}${apiKey}`;
  }
  return headers;
}

export function toProviderModelMessages(messages: ChatMessage[]): ModelMessage[] {
  return messages.map((message): ModelMessage => {
    if (message.role === "system") {
      return { role: "system", content: extractTextContent(message) };
    }
    if (message.role === "assistant") {
      return { role: "assistant", content: extractTextContent(message) };
    }
    if (typeof message.content === "string") {
      return { role: "user", content: message.content };
    }

    const content: Array<TextPart | ImagePart> = [];
    for (const part of message.content) {
      if (part.type === "text") {
        content.push({ type: "text", text: part.text });
        continue;
      }
      const image = parseDataImage(part.image_url.url);
      if (image) content.push({ type: "image", image: image.data, mediaType: image.mediaType });
    }
    return { role: "user", content };
  });
}

function createRouteFetch(
  route: ResolvedProviderRoute,
  defaultAuthHeader: string,
  fetchImpl: ProviderFetch = fetch,
): ProviderFetch {
  return async (url, init) => {
    const headers = new Headers(init?.headers);
    const authHeader = route.authHeader || defaultAuthHeader;
    if (
      authHeader.toLowerCase() !== defaultAuthHeader.toLowerCase()
      && !hasHeader(route.headers || {}, defaultAuthHeader)
    ) {
      headers.delete(defaultAuthHeader);
    }
    return fetchImpl(route.directEndpoint ? route.baseUrl : url, { ...init, headers });
  };
}

function hasHeader(headers: Record<string, string>, target: string): boolean {
  const normalized = target.toLowerCase();
  return Object.keys(headers).some((header) => header.toLowerCase() === normalized);
}

function extractTextContent(message: ChatMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

function parseDataImage(value: string): { mediaType: string; data: string } | null {
  const match = value.match(/^data:(image\/(?:png|jpe?g|webp|gif));base64,([A-Za-z0-9+/=]+)$/i);
  return match ? { mediaType: match[1], data: match[2] } : null;
}
