import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import type {
  CapabilityRegistryConfig,
  McpServerConfig,
  ToolConfig,
} from "../src/contracts/capability";
import {
  WEB_RESEARCH_INPUT_SCHEMA,
  WEB_RESEARCH_MAX_RESULT_CHARS,
  canonicalizePublicHttpsUrl,
  decodeWebResearchToolResult,
  formatWebResearchEvidenceForModel,
  isExactWebResearchInputSchema,
} from "../src/contracts/web-research";
import { getAgentWebResearchMetadata } from "../client/src/lib/api";
import { IDENTITY_REGISTRY_INSTANCE_NAME } from "../src/identity-registry";
import { getPublicCapabilities } from "../src/services/capability-registry";
import { createMcpRuntime, McpRuntimeError, type McpRuntimeExecution } from "../src/services/mcp-runtime";
import {
  WebResearchRuntimeError,
  executeWebResearch,
  resolveWebResearchBinding,
} from "../src/services/web-research";
import { prepareTeamAgentTurn, type Session } from "../src/worker";

const ROUTES_CONFIG_KEY = "config:routes_config";

const server: McpServerConfig = {
  enabled: true,
  label: "Search MCP",
  endpoint: "https://search.example/mcp",
  auth: { version: 1, type: "none" },
};

const webResearchTool: ToolConfig = {
  enabled: true,
  label: "Search",
  description: "Search public web pages",
  confirmation: "first-per-conversation",
  inputSchema: WEB_RESEARCH_INPUT_SCHEMA,
  executor: { type: "mcp", serverId: "search", remoteName: "search" },
  schemaFingerprint: "a".repeat(64),
  securityFingerprint: "b".repeat(64),
  sideEffect: "read",
  reviewRevision: "c".repeat(64),
  reviewRequired: false,
  capabilityRole: "web_search",
};

function config(tool: ToolConfig = webResearchTool): CapabilityRegistryConfig {
  return {
    skills: {
      writing: {
        enabled: true,
        label: "Writing",
        instructions: "Write clearly.",
        toolIds: ["mcp:search:search"],
      },
    },
    tools: { "mcp:search:search": tool },
    mcpServers: { search: server },
  };
}

function binding() {
  const resolved = resolveWebResearchBinding(config(), { allowedTools: ["mcp:search:search"] });
  if (!resolved.ok) throw new Error("fixture binding unavailable");
  return resolved.binding;
}

function evidenceResult(sources: unknown[]): { content: string } {
  return { content: JSON.stringify({ version: 1, sources }) };
}

function execution(result: unknown): McpRuntimeExecution & {
  executeTool: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
} {
  return {
    executeTool: vi.fn(async () => result),
    close: vi.fn(async () => undefined),
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("web research contract", () => {
  it("accepts only the exact bounded one-query input schema", () => {
    expect(isExactWebResearchInputSchema(WEB_RESEARCH_INPUT_SCHEMA)).toBe(true);
    expect(isExactWebResearchInputSchema({
      ...WEB_RESEARCH_INPUT_SCHEMA,
      properties: { ...WEB_RESEARCH_INPUT_SCHEMA.properties, url: { type: "string" } },
    })).toBe(false);
    expect(isExactWebResearchInputSchema({
      ...WEB_RESEARCH_INPUT_SCHEMA,
      additionalProperties: true,
    })).toBe(false);
  });

  it("canonicalizes, deduplicates, bounds, and preserves source order", () => {
    const sources = Array.from({ length: 12 }, (_, index) => ({
      url: index === 1
        ? "https://example.com/article?a=1&b=2#duplicate"
        : `https://example.com/article-${index}?b=2&a=1#section`,
      title: `Source ${index}`,
      snippet: `Snippet ${index}`,
    }));
    sources[0].url = "https://example.com/article?a=1&b=2";

    const evidence = decodeWebResearchToolResult(evidenceResult(sources));

    expect(evidence.sources).toHaveLength(10);
    expect(evidence.sources[0]).toEqual({
      url: "https://example.com/article?a=1&b=2",
      title: "Source 0",
      snippet: "Snippet 0",
    });
    expect(evidence.sources[1].title).toBe("Source 2");
    expect(evidence.sources.at(-1)?.title).toBe("Source 10");
    expect(formatWebResearchEvidenceForModel(evidence)).toContain("[10] Source 10");
  });

  it.each([
    ["non-text", { content: [{ type: "image" }] }],
    ["empty", { content: "   " }],
    ["malformed", { content: "not-json" }],
    ["unknown envelope field", { content: JSON.stringify({ version: 1, sources: [], extra: true }) }],
    ["oversized raw result", { content: "x".repeat(WEB_RESEARCH_MAX_RESULT_CHARS + 1) }],
    ["unsafe URL", evidenceResult([{ url: "https://127.0.0.1/private", title: "Private", snippet: "" }])],
    ["credential URL", evidenceResult([{ url: "https://user:pass@example.com/", title: "Private", snippet: "" }])],
    ["oversized title", evidenceResult([{ url: "https://example.com/", title: "x".repeat(241), snippet: "" }])],
  ])("rejects %s MCP evidence", (_label, value) => {
    expect(() => decodeWebResearchToolResult(value)).toThrow();
  });

  it("rejects private literal URLs while retaining public HTTPS URLs", () => {
    expect(canonicalizePublicHttpsUrl("https://localhost/search")).toBeNull();
    expect(canonicalizePublicHttpsUrl("https://[::1]/search")).toBeNull();
    expect(canonicalizePublicHttpsUrl("http://example.com/search")).toBeNull();
    expect(canonicalizePublicHttpsUrl("https://Example.com/search?z=2&a=1#part"))
      .toBe("https://example.com/search?a=1&z=2");
  });

  it("decodes only normalized persisted assistant evidence", () => {
    const metadata = {
      webResearch: {
        version: 1,
        sources: [{ url: "https://example.com/source", title: "Source", snippet: "Summary" }],
      },
    };
    expect(getAgentWebResearchMetadata(metadata)).toEqual(metadata.webResearch);
    expect(getAgentWebResearchMetadata({
      webResearch: { ...metadata.webResearch, providerId: "private" },
    })).toBeUndefined();
    expect(getAgentWebResearchMetadata({
      webResearch: { version: 1, sources: [{ ...metadata.webResearch.sources[0], url: "javascript:alert(1)" }] },
    })).toBeUndefined();
  });
});

describe("web research binding and execution", () => {
  it("projects the explicit capability but excludes its MCP tool from ordinary Skills and tools", () => {
    const projected = getPublicCapabilities(config(), {
      allowedSkills: ["writing"],
      allowedTools: ["mcp:search:search"],
    });

    expect(projected.tools).toEqual([]);
    expect(projected.skills).toEqual([{
      id: "writing",
      label: "Writing",
      description: "",
      toolIds: [],
    }]);
    expect(projected.capabilities).toContainEqual(expect.objectContaining({
      id: "chatus:web_research",
      activation: "explicit_turn",
      availability: "available",
      disclosure: expect.objectContaining({ execution: "reviewed_mcp", dataClasses: ["search_query"] }),
    }));
  });

  it("fails closed for missing assignment, review drift, write capability, and duplicate bindings", () => {
    expect(resolveWebResearchBinding(config(), { allowedTools: [] })).toEqual({ ok: false, reason: "not_assigned" });
    expect(resolveWebResearchBinding(config({ ...webResearchTool, reviewRequired: true }), { allowedTools: ["mcp:search:search"] }))
      .toEqual({ ok: false, reason: "review_required" });
    expect(resolveWebResearchBinding(config({ ...webResearchTool, sideEffect: "write" }), { allowedTools: ["mcp:search:search"] }))
      .toEqual({ ok: false, reason: "review_required" });
    const duplicate = config();
    duplicate.tools = { ...duplicate.tools, second: { ...webResearchTool } };
    expect(resolveWebResearchBinding(duplicate, { allowedTools: ["mcp:search:search", "second"] }))
      .toEqual({ ok: false, reason: "tool_unavailable" });
  });

  it("executes the exact query, decodes evidence, and always closes", async () => {
    const fake = execution(evidenceResult([
      { url: "https://example.com/source", title: "Source", snippet: "Summary" },
    ]));

    await expect(executeWebResearch(fake, binding(), " current facts ")).resolves.toMatchObject({ version: 1 });
    expect(fake.executeTool).toHaveBeenCalledWith(
      expect.objectContaining({ providerName: "chatus:web_research" }),
      { query: "current facts" },
      server,
      expect.any(AbortSignal),
    );
    expect(fake.close).toHaveBeenCalledOnce();
  });

  it("enforces timeout even when the MCP adapter ignores AbortSignal", async () => {
    vi.useFakeTimers();
    const fake = execution(undefined);
    fake.executeTool.mockImplementation(() => new Promise(() => undefined));

    const result = executeWebResearch(fake, binding(), "current facts", undefined, 25);
    const rejected = expect(result).rejects.toMatchObject<WebResearchRuntimeError>({ code: "web_research_timeout" });
    await vi.advanceTimersByTimeAsync(25);

    await rejected;
    expect(fake.close).toHaveBeenCalledOnce();
  });

  it("forwards parent cancellation, closes, and does not wait for a stuck adapter", async () => {
    const controller = new AbortController();
    const fake = execution(undefined);
    fake.executeTool.mockImplementation(() => new Promise(() => undefined));

    const result = executeWebResearch(fake, binding(), "current facts", controller.signal, 1_000);
    controller.abort(new DOMException("cancelled", "AbortError"));

    await expect(result).rejects.toMatchObject<WebResearchRuntimeError>({ code: "request_cancelled" });
    expect(fake.close).toHaveBeenCalledOnce();
  });

  it("closes without external I/O for an invalid query and maps MCP governance errors", async () => {
    const invalidQuery = execution(undefined);
    await expect(executeWebResearch(invalidQuery, binding(), " ")).rejects.toMatchObject<WebResearchRuntimeError>({
      code: "web_research_query_invalid",
    });
    expect(invalidQuery.executeTool).not.toHaveBeenCalled();
    expect(invalidQuery.close).toHaveBeenCalledOnce();

    const drift = execution(undefined);
    drift.executeTool.mockRejectedValue(new McpRuntimeError("mcp_tool_changed", "private drift detail"));
    await expect(executeWebResearch(drift, binding(), "current facts")).rejects.toMatchObject<WebResearchRuntimeError>({
      code: "web_research_review_required",
    });
    expect(drift.close).toHaveBeenCalledOnce();
  });
});

describe("web research TeamAgent preparation", () => {
  it.each([false, true])("injects the same normalized evidence for supportsTools=%s without exposing a normal tool", async (supportsTools) => {
    await env.CHAT_STORE.delete(ROUTES_CONFIG_KEY);
    const fixture = createMcpFixture();
    const discovered = await discoverFixtureTool(fixture.fetcher);
    const label = `web-research-${supportsTools ? "tools" : "text"}-${crypto.randomUUID()}`;
    const storedConfig = turnConfig(label, discovered, supportsTools);
    const localBinding = resolveWebResearchBinding(storedConfig, { allowedTools: ["mcp:search:search"] });
    if (!localBinding.ok) throw new Error(JSON.stringify({ discovered, localBinding }));
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify(storedConfig));
    fixture.methods.length = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(fixture.fetcher);
    const session = await createMemberSession(label);

    const prepared = await prepareTeamAgentTurn(env, session, {
      ...turnContext(),
      messages: [{ role: "user", content: "Find current release notes" }],
      skillMode: "manual",
      skillIds: [],
      capabilityIds: ["chatus:web_research"],
      webResearchQuery: "Find current release notes",
    });

    if (!prepared.ok) throw new Error(JSON.stringify(prepared));
    expect(prepared).toMatchObject({ ok: true });
    expect(prepared.webResearch).toEqual({
      version: 1,
      sources: [{ url: "https://example.com/release", title: "Release notes", snippet: "Current facts" }],
    });
    expect(JSON.stringify(prepared.systemMessages)).toContain("[WEB_RESEARCH_SOURCES_V1]");
    expect(JSON.stringify(prepared.systemMessages)).toContain("[1] Release notes");
    expect(prepared.toolDefinitions).toEqual([]);
    expect(fixture.methods.filter((method) => method === "tools/call")).toHaveLength(1);
    expect(fixture.queries).toEqual(["Find current release notes"]);
    await Promise.allSettled([prepared.closeTools(), prepared.releaseTurn()]);
  });

  it("rejects research before MCP I/O when three manual Skills already consume the shared slots", async () => {
    await env.CHAT_STORE.delete(ROUTES_CONFIG_KEY);
    const fixture = createMcpFixture();
    const discovered = await discoverFixtureTool(fixture.fetcher);
    const label = `web-research-slots-${crypto.randomUUID()}`;
    const stored = turnConfig(label, discovered, false);
    stored.skills = {
      one: { enabled: true, label: "One", instructions: "One." },
      two: { enabled: true, label: "Two", instructions: "Two." },
      three: { enabled: true, label: "Three", instructions: "Three." },
    };
    stored.defaults.allowedSkills = ["one", "two", "three"];
    stored.users[label].allowedSkills = ["one", "two", "three"];
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify(stored));
    fixture.methods.length = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(fixture.fetcher);
    const session = await createMemberSession(label);

    const prepared = await prepareTeamAgentTurn(env, session, {
      ...turnContext(),
      messages: [{ role: "user", content: "Find current release notes" }],
      skillMode: "manual",
      skillIds: ["one", "two", "three"],
      capabilityIds: ["chatus:web_research"],
      webResearchQuery: "Find current release notes",
    });

    expect(prepared).toMatchObject({ ok: false, error: "web_research_slot_limit", status: 409 });
    expect(fixture.methods).not.toContain("tools/call");
  });
});

async function createMemberSession(label: string): Promise<Extract<Session, { kind: "member" }>> {
  const now = Date.now();
  const principal = await env.IDENTITY_REGISTRY.getByName(IDENTITY_REGISTRY_INSTANCE_NAME).resolveOrCreatePrincipal({
    version: 1,
    operationId: `web-research-test:${crypto.randomUUID()}`,
    alias: label,
    origin: "native",
  });
  const marker = {
    version: 1 as const,
    principalId: principal.principalId,
    rootInstanceName: principal.rootInstanceName,
    userStateInstanceName: principal.userStateInstanceName,
    registryRevision: principal.registryRevision,
  };
  await env.USER_STATE.getByName(principal.userStateInstanceName).ensureStableIdentity(marker);
  return {
    id: crypto.randomUUID(),
    label,
    kind: "member",
    principalId: principal.principalId,
    rootInstanceName: principal.rootInstanceName,
    userStateInstanceName: principal.userStateInstanceName,
    registryRevision: principal.registryRevision,
    createdAt: now,
    lastSeen: now,
    expiresAt: now + 60_000,
  };
}

function turnContext() {
  return {
    turnId: `turn_${crypto.randomUUID()}`,
    operation: {
      version: 1 as const,
      operationId: `web-research-turn-${crypto.randomUUID()}`,
      fenceId: crypto.randomUUID(),
      kind: "provider_turn" as const,
      startedAt: Date.now(),
    },
  };
}

function turnConfig(label: string, discovered: ToolConfig, supportsTools: boolean) {
  return {
    routes: {
      primary: {
        label: "Primary",
        type: "openai-chat" as const,
        baseUrl: "https://provider.example/v1",
        model: "fixture-model",
        apiKey: "fixture-key",
        supportsTools,
      },
    },
    defaults: {
      defaultRoute: "primary",
      allowedRoutes: ["primary"],
      allowedSkills: [] as string[],
      allowedTools: ["mcp:search:search"],
    },
    users: {
      [label]: {
        defaultRoute: "primary",
        allowedRoutes: ["primary"],
        allowedSkills: [] as string[],
        allowedTools: ["mcp:search:search"],
      },
    },
    skills: {} as Record<string, { enabled: boolean; label: string; instructions: string }>,
    tools: {
      "mcp:search:search": {
        ...discovered,
        enabled: true,
        reviewRequired: false,
        capabilityRole: "web_search" as const,
      },
    },
    mcpServers: { search: server },
  };
}

async function discoverFixtureTool(fetcher: typeof fetch): Promise<ToolConfig> {
  const runtime = createMcpRuntime({
    resolveSecret: async () => "",
    fingerprint: async (value) => {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
      return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    },
    fetch: fetcher,
  });
  const result = await runtime.discoverTools("search", server, new AbortController().signal);
  return result.tools[0];
}

function createMcpFixture() {
  const methods: string[] = [];
  const queries: string[] = [];
  const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "DELETE") {
      methods.push("session/delete");
      return new Response(null, { status: 204 });
    }
    const payload = JSON.parse(String(init?.body)) as {
      id?: string | number;
      method: string;
      params?: { arguments?: { query?: string } };
    };
    methods.push(payload.method);
    if (payload.method === "initialize") {
      return rpcResponse(payload.id, {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "web-research-fixture", version: "1.0.0" },
      }, { "Mcp-Session-Id": `research-${crypto.randomUUID()}` });
    }
    if (payload.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (payload.method === "tools/list") {
      return rpcResponse(payload.id, {
        tools: [{
          name: "search",
          title: "Search",
          description: "Search public web pages",
          inputSchema: WEB_RESEARCH_INPUT_SCHEMA,
          annotations: { readOnlyHint: true, destructiveHint: false },
          execution: { taskSupport: "forbidden" },
        }],
      });
    }
    if (payload.method === "tools/call") {
      queries.push(payload.params?.arguments?.query || "");
      return rpcResponse(payload.id, {
        content: [{
          type: "text",
          text: JSON.stringify({
            version: 1,
            sources: [{ url: "https://example.com/release", title: "Release notes", snippet: "Current facts" }],
          }),
        }],
      });
    }
    throw new Error(`Unexpected MCP method ${payload.method}`);
  });
  return { fetcher, methods, queries };
}

function rpcResponse(
  id: string | number | undefined,
  result: unknown,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}
