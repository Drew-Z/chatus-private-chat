import type { ToolConfig } from "./capability";

export const WEB_RESEARCH_CAPABILITY_ID = "chatus:web_research" as const;
export const WEB_RESEARCH_QUERY_MAX_CHARS = 2_000;
export const WEB_RESEARCH_MAX_SOURCES = 10;
export const WEB_RESEARCH_MAX_RESULT_CHARS = 64_000;
export const WEB_RESEARCH_MAX_NORMALIZED_CHARS = 16_000;
export const WEB_RESEARCH_MAX_TITLE_CHARS = 240;
export const WEB_RESEARCH_MAX_SNIPPET_CHARS = 1_200;
export const WEB_RESEARCH_MAX_URL_CHARS = 2_048;
export const WEB_RESEARCH_TIMEOUT_MS = 20_000;

export const WEB_RESEARCH_INPUT_SCHEMA = {
  type: "object",
  properties: {
    query: {
      type: "string",
      minLength: 1,
      maxLength: WEB_RESEARCH_QUERY_MAX_CHARS,
    },
  },
  required: ["query"],
  additionalProperties: false,
} as const;

export type WebResearchSourceV1 = {
  url: string;
  title: string;
  snippet: string;
};

export type WebResearchEvidenceV1 = {
  version: 1;
  sources: WebResearchSourceV1[];
};

export type WebResearchRequestedCapabilities = {
  capabilityIds: Array<typeof WEB_RESEARCH_CAPABILITY_ID>;
};

export class WebResearchDecodeError extends Error {
  constructor(readonly code: "invalid" | "empty" | "too_large" | "unsafe_url") {
    super(`web_research_${code}`);
    this.name = "WebResearchDecodeError";
  }
}

export function isExactWebResearchInputSchema(value: unknown): boolean {
  if (!isRecord(value) || !hasExactKeys(value, ["type", "properties", "required", "additionalProperties"])) {
    return false;
  }
  if (value.type !== "object" || value.additionalProperties !== false) return false;
  if (!Array.isArray(value.required) || value.required.length !== 1 || value.required[0] !== "query") return false;
  if (!isRecord(value.properties) || !hasExactKeys(value.properties, ["query"])) return false;
  const query = value.properties.query;
  return isRecord(query)
    && hasExactKeys(query, ["type", "minLength", "maxLength"])
    && query.type === "string"
    && query.minLength === 1
    && query.maxLength === WEB_RESEARCH_QUERY_MAX_CHARS;
}

export function isReviewedWebResearchTool(tool: ToolConfig | undefined): tool is ToolConfig & {
  executor: Extract<ToolConfig["executor"], { type: "mcp" }>;
} {
  return Boolean(
    tool
    && tool.enabled === true
    && tool.capabilityRole === "web_search"
    && tool.executor.type === "mcp"
    && tool.sideEffect === "read"
    && tool.reviewRequired === false
    && isFingerprint(tool.schemaFingerprint)
    && isFingerprint(tool.securityFingerprint)
    && isFingerprint(tool.reviewRevision)
    && isExactWebResearchInputSchema(tool.inputSchema),
  );
}

export function normalizeWebResearchQuery(value: unknown): string {
  if (typeof value !== "string") return "";
  const query = value.trim();
  return query.length > 0 && query.length <= WEB_RESEARCH_QUERY_MAX_CHARS ? query : "";
}

export function normalizeWebResearchCapabilityIds(value: unknown): Array<typeof WEB_RESEARCH_CAPABILITY_ID> {
  if (!Array.isArray(value) || value.length !== 1 || value[0] !== WEB_RESEARCH_CAPABILITY_ID) return [];
  return [WEB_RESEARCH_CAPABILITY_ID];
}

export function decodeWebResearchToolResult(value: unknown): WebResearchEvidenceV1 {
  if (!isRecord(value) || !hasExactKeys(value, ["content"]) || typeof value.content !== "string") {
    throw new WebResearchDecodeError("invalid");
  }
  if (!value.content.trim() || value.content.length > WEB_RESEARCH_MAX_RESULT_CHARS) {
    throw new WebResearchDecodeError(value.content.trim() ? "too_large" : "empty");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value.content);
  } catch {
    throw new WebResearchDecodeError("invalid");
  }
  return normalizeWebResearchEvidence(parsed);
}

export function decodeWebResearchEvidenceV1(value: unknown): WebResearchEvidenceV1 | undefined {
  try {
    return normalizeWebResearchEvidence(value);
  } catch {
    return undefined;
  }
}

function normalizeWebResearchEvidence(parsed: unknown): WebResearchEvidenceV1 {
  if (!isRecord(parsed) || !hasExactKeys(parsed, ["version", "sources"]) || parsed.version !== 1) {
    throw new WebResearchDecodeError("invalid");
  }
  if (!Array.isArray(parsed.sources) || parsed.sources.length === 0) {
    throw new WebResearchDecodeError("empty");
  }
  if (parsed.sources.length > 50) throw new WebResearchDecodeError("too_large");

  const sources: WebResearchSourceV1[] = [];
  const seen = new Set<string>();
  let normalizedChars = 0;
  for (const source of parsed.sources) {
    if (!isRecord(source) || !hasExactKeys(source, ["url", "title", "snippet"])) {
      throw new WebResearchDecodeError("invalid");
    }
    const title = normalizeBoundedText(source.title, WEB_RESEARCH_MAX_TITLE_CHARS);
    const snippet = normalizeBoundedText(source.snippet, WEB_RESEARCH_MAX_SNIPPET_CHARS);
    if (!title || typeof source.url !== "string" || source.url.length > WEB_RESEARCH_MAX_URL_CHARS) {
      throw new WebResearchDecodeError("too_large");
    }
    const url = canonicalizePublicHttpsUrl(source.url);
    if (!url) throw new WebResearchDecodeError("unsafe_url");
    normalizedChars += url.length + title.length + snippet.length;
    if (normalizedChars > WEB_RESEARCH_MAX_NORMALIZED_CHARS) throw new WebResearchDecodeError("too_large");
    if (seen.has(url)) continue;
    seen.add(url);
    sources.push({ url, title, snippet });
    if (sources.length >= WEB_RESEARCH_MAX_SOURCES) break;
  }
  if (!sources.length) throw new WebResearchDecodeError("empty");
  return { version: 1, sources };
}

export function formatWebResearchEvidenceForModel(evidence: WebResearchEvidenceV1): string {
  const lines = [
    "[WEB_RESEARCH_SOURCES_V1]",
    "Use only these normalized sources for claims that require fresh web evidence. Cite them as [1], [2], and so on.",
  ];
  evidence.sources.forEach((source, index) => {
    lines.push(
      `[${index + 1}] ${source.title}`,
      `URL: ${source.url}`,
      `Snippet: ${source.snippet || "(no snippet provided)"}`,
    );
  });
  lines.push("[/WEB_RESEARCH_SOURCES_V1]");
  return lines.join("\n");
}

export function canonicalizePublicHttpsUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost")) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname) && isForbiddenIpv4(hostname)) return null;
  if (hostname.includes(":") && isForbiddenIpv6(hostname)) return null;
  url.hash = "";
  url.searchParams.sort();
  return url.toString();
}

function normalizeBoundedText(value: unknown, maxChars: number): string {
  if (typeof value !== "string") throw new WebResearchDecodeError("invalid");
  const normalized = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (normalized.length > maxChars) throw new WebResearchDecodeError("too_large");
  return normalized;
}

function isFingerprint(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);
}

function isForbiddenIpv4(hostname: string): boolean {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 0 || b === 168))
    || (a === 198 && (b === 18 || b === 19 || b === 51))
    || (a === 203 && b === 0) || a >= 224;
}

function isForbiddenIpv6(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (normalized === "::" || normalized === "::1") return true;
  if (
    normalized.startsWith("fc")
    || normalized.startsWith("fd")
    || normalized.startsWith("fe8")
    || normalized.startsWith("fe9")
    || normalized.startsWith("fea")
    || normalized.startsWith("feb")
    || normalized.startsWith("ff")
    || normalized.startsWith("2001:db8:")
  ) return true;
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? isForbiddenIpv4(mapped[1]) : false;
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
