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
  authType: "bearer",
  secretRef: "MCP_FIXTURE_KEY",
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
  let lookupAnnotations = { readOnlyHint: true, destructiveHint: false };
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
    setLookupAnnotations(annotations: { readOnlyHint: boolean; destructiveHint: boolean }) {
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

function definition(schemaFingerprint: string): NormalizedToolDefinition {
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
      schemaFingerprint,
    },
  };
}

describe("MCP runtime", () => {
  it("discovers reviewed read-only tools through the injected secret resolver", async () => {
    const fixture = createFixtureFetch();
    const resolveSecret = vi.fn(async () => "fixture-secret");
    const runtime = createMcpRuntime({ resolveSecret, fingerprint, fetch: fixture.fetcher });

    const result = await runtime.discoverTools("fixture", server, new AbortController().signal);

    expect(result).toMatchObject({
      serverId: "fixture",
      rejected: 1,
      tools: [{
        id: "mcp:fixture:lookup",
        label: "Lookup",
        confirmation: "first-per-conversation",
        executor: { type: "mcp", serverId: "fixture", remoteName: "lookup" },
      }],
    });
    expect(result.tools[0].schemaFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(resolveSecret).toHaveBeenCalledOnce();
    expect(resolveSecret).toHaveBeenCalledWith("MCP_FIXTURE_KEY");
    expect(fixture.headers.some((headers) => headers.get("Authorization") === "Bearer fixture-secret")).toBe(true);
    expect(fixture.methods).toContain("session/delete");
    expect(JSON.stringify(result)).not.toContain("fixture-secret");
    expect(JSON.stringify(result)).not.toContain("mcp.example");
  });

  it("reuses one session, verifies the reviewed schema, and closes the execution", async () => {
    const fixture = createFixtureFetch();
    const resolveSecret = vi.fn(async () => "fixture-secret");
    const runtime = createMcpRuntime({ resolveSecret, fingerprint, fetch: fixture.fetcher });
    const discovery = await runtime.discoverTools("fixture", server, new AbortController().signal);
    const execution = runtime.createExecution();
    const tool = definition(discovery.tools[0].schemaFingerprint);

    await expect(execution.executeTool(tool, { query: "first" }, server, new AbortController().signal))
      .resolves.toEqual({ content: "result:first" });
    await expect(execution.executeTool(tool, { query: "second" }, server, new AbortController().signal))
      .resolves.toEqual({ content: "result:second" });
    expect(fixture.methods.filter((method) => method === "initialize")).toHaveLength(2);
    expect(fixture.methods.filter((method) => method === "tools/list")).toHaveLength(2);
    expect(fixture.methods.filter((method) => method === "tools/call")).toHaveLength(2);
    expect(resolveSecret).toHaveBeenCalledTimes(2);

    const stale = definition("0".repeat(64));
    await expect(execution.executeTool(stale, { query: "blocked" }, server, new AbortController().signal))
      .rejects.toMatchObject({ code: "mcp_tool_changed" });
    expect(fixture.methods.filter((method) => method === "tools/call")).toHaveLength(2);

    await execution.close();
    await execution.close();
    expect(fixture.methods.filter((method) => method === "session/delete")).toHaveLength(2);
  });

  it("rejects read-only annotation drift before calling the reviewed tool", async () => {
    const fixture = createFixtureFetch();
    const runtime = createMcpRuntime({
      resolveSecret: async () => "fixture-secret",
      fingerprint,
      fetch: fixture.fetcher,
    });
    const discovery = await runtime.discoverTools("fixture", server, new AbortController().signal);
    fixture.setLookupAnnotations({ readOnlyHint: false, destructiveHint: true });
    const execution = runtime.createExecution();

    await expect(execution.executeTool(
      definition(discovery.tools[0].schemaFingerprint),
      { query: "blocked" },
      server,
      new AbortController().signal,
    )).rejects.toMatchObject({ code: "mcp_tool_changed" });
    expect(fixture.methods.filter((method) => method === "tools/call")).toHaveLength(0);

    await execution.close();
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
      { ...server, endpoint: "https://redirect.example/rpc", authType: "none", secretRef: undefined },
      new AbortController().signal,
    )).rejects.toMatchObject({ code: "mcp_redirect_rejected" });

    const oversizedRuntime = createMcpRuntime({
      resolveSecret: async () => "",
      fingerprint,
      fetch: async () => new Response("", { headers: { "Content-Length": String(256 * 1024 + 1) } }),
    });
    await expect(oversizedRuntime.discoverTools(
      "oversized",
      { ...server, endpoint: "https://oversized.example/rpc", authType: "none", secretRef: undefined },
      new AbortController().signal,
    )).rejects.toSatisfy((error: unknown) =>
      error instanceof McpRuntimeError && error.code === "mcp_protocol_error",
    );
  });
});
