import { describe, expect, it, vi } from "vitest";
import type { McpServerConfig, NormalizedToolDefinition } from "../src/contracts/capability";
import {
  createMcpRuntime,
  isForbiddenMcpUrl,
  isValidMcpEndpoint,
  McpRuntimeError,
} from "../src/services/mcp-runtime";

const server: McpServerConfig = {
  enabled: true,
  label: "Fixture",
  endpoint: "https://mcp.example/rpc",
  auth: { version: 1, type: "bearer", secretRef: "MCP_FIXTURE_KEY" },
};

const schema = {
  type: "object",
  properties: { query: { type: "string" } },
  required: ["query"],
};

async function fingerprint(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function createFixtureFetch() {
  const methods: string[] = [];
  const headers: Headers[] = [];
  let lookupAnnotations: Record<string, boolean> = { readOnlyHint: true, destructiveHint: false };
  const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    headers.push(new Headers(init?.headers));
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
        serverInfo: { name: "fixture", version: "1.0.0" },
      }, { "Mcp-Session-Id": "fixture-session" });
    }
    if (payload.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (payload.method === "tools/list") {
      return rpcResponse(payload.id, {
        tools: [
          {
            name: "lookup",
            title: "Lookup",
            description: "Find public information",
            inputSchema: schema,
            annotations: lookupAnnotations,
            execution: { taskSupport: "forbidden" },
          },
          {
            name: "delete_item",
            inputSchema: { type: "object", properties: {} },
            annotations: { readOnlyHint: false, destructiveHint: true },
          },
        ],
      });
    }
    if (payload.method === "tools/call") {
      return rpcResponse(payload.id, {
        content: [{ type: "text", text: `result:${payload.params?.arguments?.query || ""}` }],
      });
    }
    throw new Error(`Unexpected MCP method ${payload.method}`);
  });
  return {
    fetcher,
    headers,
    methods,
    setLookupAnnotations(annotations: Record<string, boolean>) {
      lookupAnnotations = annotations;
    },
  };
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

function definition(tool: {
  schemaFingerprint: string;
  securityFingerprint: string;
  sideEffect: "read" | "write" | "destructive";
  reviewRevision: string;
}): NormalizedToolDefinition {
  return {
    id: "mcp:fixture:lookup",
    providerName: "mcp_fixture_lookup",
    label: "Lookup",
    description: "Find public information",
    inputSchema: schema,
    config: {
      enabled: true,
      label: "Lookup",
      description: "Find public information",
      inputSchema: schema,
      confirmation: "first-per-conversation",
      executor: { type: "mcp", serverId: "fixture", remoteName: "lookup" },
      schemaFingerprint: tool.schemaFingerprint,
      securityFingerprint: tool.securityFingerprint,
      sideEffect: tool.sideEffect,
      reviewRevision: tool.reviewRevision,
      reviewRequired: false,
    },
  };
}

describe("MCP runtime", () => {
  it("discovers read and side-effect tools through the injected secret resolver", async () => {
    const fixture = createFixtureFetch();
    const resolveSecret = vi.fn(async () => "fixture-secret");
    const runtime = createMcpRuntime({ resolveSecret, fingerprint, fetch: fixture.fetcher });

    const result = await runtime.discoverTools("fixture", server, new AbortController().signal);

    expect(result).toMatchObject({
      serverId: "fixture",
      rejected: 0,
      tools: [
        {
          id: "mcp:fixture:lookup",
          label: "Lookup",
          confirmation: "first-per-conversation",
          sideEffect: "read",
          reviewRequired: true,
          executor: { type: "mcp", serverId: "fixture", remoteName: "lookup" },
        },
        {
          id: "mcp:fixture:delete_item",
          confirmation: "always",
          sideEffect: "destructive",
          reviewRequired: true,
        },
      ],
    });
    expect(result.tools[0].schemaFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(result.tools[0].securityFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(result.tools[0].reviewRevision).toMatch(/^[a-f0-9]{64}$/);
    expect(resolveSecret).toHaveBeenCalledOnce();
    expect(resolveSecret).toHaveBeenCalledWith("MCP_FIXTURE_KEY");
    expect(fixture.headers.some((headers) => headers.get("Authorization") === "Bearer fixture-secret")).toBe(true);
    expect(fixture.methods).toContain("session/delete");
    expect(JSON.stringify(result)).not.toContain("fixture-secret");
    expect(JSON.stringify(result)).not.toContain("mcp.example");
  });

  it("uses a member OAuth token and rejects OAuth config revision drift before tools/call", async () => {
    const fixture = createFixtureFetch();
    const resolveSecret = vi.fn(async () => "static-secret");
    const resolveOAuthAccessToken = vi.fn(async () => "member-access-token");
    const oauthServer: McpServerConfig = {
      ...server,
      auth: {
        version: 1,
        type: "oauth2",
        issuer: "https://issuer.example",
        clientId: "chatus",
        scopes: ["tools.read"],
        callbackPath: "/api/mcp/oauth/callback",
        configRevision: "oauth-config-v1",
      },
    };
    const runtime = createMcpRuntime({
      resolveSecret,
      resolveOAuthAccessToken,
      fingerprint,
      fetch: fixture.fetcher,
    });
    const discovery = await runtime.discoverTools("fixture", oauthServer, new AbortController().signal);

    expect(resolveSecret).not.toHaveBeenCalled();
    expect(resolveOAuthAccessToken).toHaveBeenCalledWith("fixture", oauthServer, expect.any(AbortSignal));
    expect(fixture.headers.some((headers) => headers.get("Authorization") === "Bearer member-access-token")).toBe(true);

    const execution = runtime.createExecution();
    const changedServer: McpServerConfig = {
      ...oauthServer,
      auth: { ...oauthServer.auth, configRevision: "oauth-config-v2" },
    };
    await expect(execution.executeTool(
      definition(discovery.tools[0]),
      { query: "blocked" },
      changedServer,
      new AbortController().signal,
    )).rejects.toMatchObject({ code: "mcp_tool_changed" });
    expect(fixture.methods.filter((method) => method === "tools/call")).toHaveLength(0);
    await execution.close();
  });

  it("reuses one session, verifies the reviewed schema, and closes the execution", async () => {
    const fixture = createFixtureFetch();
    const resolveSecret = vi.fn(async () => "fixture-secret");
    const runtime = createMcpRuntime({ resolveSecret, fingerprint, fetch: fixture.fetcher });
    const discovery = await runtime.discoverTools("fixture", server, new AbortController().signal);
    const execution = runtime.createExecution();
    const tool = definition(discovery.tools[0]);

    await expect(execution.executeTool(tool, { query: "first" }, server, new AbortController().signal))
      .resolves.toEqual({ content: "result:first" });
    await expect(execution.executeTool(tool, { query: "second" }, server, new AbortController().signal))
      .resolves.toEqual({ content: "result:second" });
    expect(fixture.methods.filter((method) => method === "initialize")).toHaveLength(2);
    expect(fixture.methods.filter((method) => method === "tools/list")).toHaveLength(3);
    expect(fixture.methods.filter((method) => method === "tools/call")).toHaveLength(2);
    expect(resolveSecret).toHaveBeenCalledTimes(2);

    const stale = definition({ ...discovery.tools[0], schemaFingerprint: "0".repeat(64) });
    await expect(execution.executeTool(stale, { query: "blocked" }, server, new AbortController().signal))
      .rejects.toMatchObject({ code: "mcp_tool_changed" });
    expect(fixture.methods.filter((method) => method === "tools/call")).toHaveLength(2);

    await execution.close();
    await execution.close();
    expect(fixture.methods.filter((method) => method === "session/delete")).toHaveLength(2);
  });

  it("rejects read-only annotation drift before calling the reviewed tool", async () => {
    const fixture = createFixtureFetch();
    const recordToolDrift = vi.fn(async () => undefined);
    const runtime = createMcpRuntime({
      resolveSecret: async () => "fixture-secret",
      recordToolDrift,
      fingerprint,
      fetch: fixture.fetcher,
    });
    const discovery = await runtime.discoverTools("fixture", server, new AbortController().signal);
    fixture.setLookupAnnotations({ readOnlyHint: false, destructiveHint: true });
    const execution = runtime.createExecution();

    await expect(execution.executeTool(
      definition(discovery.tools[0]),
      { query: "blocked" },
      server,
      new AbortController().signal,
    )).rejects.toMatchObject({ code: "mcp_tool_changed" });
    expect(fixture.methods.filter((method) => method === "tools/call")).toHaveLength(0);
    expect(recordToolDrift).toHaveBeenCalledOnce();
    expect(recordToolDrift).toHaveBeenCalledWith("mcp:fixture:lookup", discovery.tools[0].reviewRevision);

    await execution.close();
  });

  it("refreshes the remote tool snapshot before every call", async () => {
    const fixture = createFixtureFetch();
    const recordToolDrift = vi.fn(async () => undefined);
    const runtime = createMcpRuntime({
      resolveSecret: async () => "fixture-secret",
      recordToolDrift,
      fingerprint,
      fetch: fixture.fetcher,
    });
    const discovery = await runtime.discoverTools("fixture", server, new AbortController().signal);
    const execution = runtime.createExecution();
    const tool = definition(discovery.tools[0]);

    await expect(execution.executeTool(tool, { query: "first" }, server, new AbortController().signal))
      .resolves.toEqual({ content: "result:first" });
    fixture.setLookupAnnotations({ readOnlyHint: false, destructiveHint: true });
    await expect(execution.executeTool(tool, { query: "blocked" }, server, new AbortController().signal))
      .rejects.toMatchObject({ code: "mcp_tool_changed" });

    expect(fixture.methods.filter((method) => method === "initialize")).toHaveLength(2);
    expect(fixture.methods.filter((method) => method === "tools/list")).toHaveLength(3);
    expect(fixture.methods.filter((method) => method === "tools/call")).toHaveLength(1);
    expect(recordToolDrift).toHaveBeenCalledWith("mcp:fixture:lookup", discovery.tools[0].reviewRevision);
    await execution.close();
  });

  it("rejects security annotation and review-state drift before calling the reviewed tool", async () => {
    const fixture = createFixtureFetch();
    const runtime = createMcpRuntime({
      resolveSecret: async () => "fixture-secret",
      fingerprint,
      fetch: fixture.fetcher,
    });
    const discovery = await runtime.discoverTools("fixture", server, new AbortController().signal);
    fixture.setLookupAnnotations({ readOnlyHint: true, destructiveHint: false, openWorldHint: true });
    const execution = runtime.createExecution();

    await expect(execution.executeTool(
      definition(discovery.tools[0]),
      { query: "blocked" },
      server,
      new AbortController().signal,
    )).rejects.toMatchObject({ code: "mcp_tool_changed" });
    expect(fixture.methods.filter((method) => method === "tools/call")).toHaveLength(0);
    await execution.close();

    const cleanFixture = createFixtureFetch();
    const cleanRuntime = createMcpRuntime({
      resolveSecret: async () => "fixture-secret",
      fingerprint,
      fetch: cleanFixture.fetcher,
    });
    const cleanDiscovery = await cleanRuntime.discoverTools("fixture", server, new AbortController().signal);
    const reviewPending = definition(cleanDiscovery.tools[0]);
    reviewPending.config.reviewRequired = true;
    const cleanExecution = cleanRuntime.createExecution();
    await expect(cleanExecution.executeTool(
      reviewPending,
      { query: "blocked" },
      server,
      new AbortController().signal,
    )).rejects.toMatchObject({ code: "mcp_tool_changed" });
    expect(cleanFixture.methods.filter((method) => method === "tools/call")).toHaveLength(0);
    await cleanExecution.close();
  });

  it("rejects unsafe destinations, redirects, and oversized protocol responses", async () => {
    expect(isValidMcpEndpoint("https://public.example/rpc")).toBe(true);
    expect(isValidMcpEndpoint("http://public.example/rpc")).toBe(false);
    expect(isForbiddenMcpUrl(new URL("https://localhost/rpc"))).toBe(true);
    expect(isForbiddenMcpUrl(new URL("https://127.0.0.1/rpc"))).toBe(true);
    expect(isForbiddenMcpUrl(new URL("https://10.0.0.1/rpc"))).toBe(true);
    expect(isForbiddenMcpUrl(new URL("https://[::1]/rpc"))).toBe(true);
    expect(isForbiddenMcpUrl(new URL("https://public.example/rpc"))).toBe(false);

    const redirectRuntime = createMcpRuntime({
      resolveSecret: async () => "",
      fingerprint,
      fetch: async () => new Response(null, { status: 302, headers: { Location: "https://other.example/rpc" } }),
    });
    await expect(redirectRuntime.discoverTools(
      "redirect",
      { ...server, endpoint: "https://redirect.example/rpc", auth: { version: 1, type: "none" } },
      new AbortController().signal,
    )).rejects.toMatchObject({ code: "mcp_redirect_rejected" });

    const oversizedRuntime = createMcpRuntime({
      resolveSecret: async () => "",
      fingerprint,
      fetch: async () => new Response("", { headers: { "Content-Length": String(256 * 1024 + 1) } }),
    });
    await expect(oversizedRuntime.discoverTools(
      "oversized",
      { ...server, endpoint: "https://oversized.example/rpc", auth: { version: 1, type: "none" } },
      new AbortController().signal,
    )).rejects.toSatisfy((error: unknown) =>
      error instanceof McpRuntimeError && error.code === "mcp_protocol_error",
    );
  });
});
