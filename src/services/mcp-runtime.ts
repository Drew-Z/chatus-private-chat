import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Tool as McpRemoteTool } from "@modelcontextprotocol/sdk/types.js";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker";
import type {
  McpServerConfig,
  McpToolSideEffect,
  NormalizedToolDefinition,
  ToolConfirmation,
} from "../contracts/capability";

export const MCP_REMOTE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
export const MAX_MCP_TOOL_SCHEMA_CHARS = 32_768;

const MAX_MCP_TOOLS = 200;
const MAX_MCP_TOOL_PAGES = 10;
const MCP_CALL_TIMEOUT_MS = 15_000;
const MAX_MCP_RESPONSE_BYTES = 256 * 1024;
const MCP_SCHEMA_VALIDATOR = new CfWorkerJsonSchemaValidator({ draft: "2020-12", shortcircuit: false });

export type McpDiscoveredTool = {
  id: string;
  label: string;
  description: string;
  inputSchema: Record<string, unknown>;
  confirmation: Extract<ToolConfirmation, "first-per-conversation" | "always">;
  executor: { type: "mcp"; serverId: string; remoteName: string };
  schemaFingerprint: string;
  securityFingerprint: string;
  sideEffect: McpToolSideEffect;
  reviewRevision: string;
  reviewRequired: true;
};

export type McpDiscoveryResult = {
  serverId: string;
  tools: McpDiscoveredTool[];
  rejected: number;
};

export type McpRuntimeExecution = {
  executeTool(
    definition: NormalizedToolDefinition,
    value: unknown,
    server: McpServerConfig | undefined,
    signal: AbortSignal,
  ): Promise<unknown>;
  close(): Promise<void>;
};

export type McpRuntime = {
  discoverTools(serverId: string, server: McpServerConfig, signal: AbortSignal): Promise<McpDiscoveryResult>;
  createExecution(): McpRuntimeExecution;
};

export type McpRuntimeDependencies = {
  resolveSecret(secretRef: string): Promise<string>;
  resolveOAuthAccessToken?(
    serverId: string,
    server: McpServerConfig,
    signal: AbortSignal,
  ): Promise<string>;
  recordToolDrift?(toolId: string, reviewRevision: string): Promise<void>;
  fingerprint(value: string): Promise<string>;
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
};

type ActiveMcpSession = {
  client: Client;
  transport: StreamableHTTPClientTransport;
  configKey: string;
  tools: Map<string, McpRuntimeToolSnapshot>;
};

type McpRuntimeToolSnapshot = {
  schemaFingerprint: string;
  securityFingerprint: string;
  sideEffect: McpToolSideEffect;
  reviewRevision: string;
  taskSupport: string;
};

export class McpRuntimeError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "McpRuntimeError";
  }
}

export function createMcpRuntime(dependencies: McpRuntimeDependencies): McpRuntime {
  const fetcher = dependencies.fetch || fetch;

  const fingerprintSchema = (value: unknown) => dependencies.fingerprint(stableJsonStringify(value));

  const inspectRemoteTool = async (
    remoteTool: McpRemoteTool,
    server: McpServerConfig,
  ): Promise<McpRuntimeToolSnapshot | null> => {
    const inputSchema = normalizeMcpToolSchema(remoteTool.inputSchema);
    if (!inputSchema || !MCP_REMOTE_NAME_PATTERN.test(remoteTool.name)) return null;
    const schemaFingerprint = await fingerprintSchema(inputSchema);
    const taskSupport = remoteTool.execution?.taskSupport || "forbidden";
    const sideEffect = classifyMcpToolSideEffect(remoteTool.annotations);
    const securityFingerprint = await dependencies.fingerprint(stableJsonStringify({
      annotations: normalizeMcpSecurityAnnotations(remoteTool.annotations),
      taskSupport,
    }));
    const reviewRevision = await dependencies.fingerprint(stableJsonStringify({
      schemaFingerprint,
      securityFingerprint,
      sideEffect,
      oauthConfigRevision: server.auth.type === "oauth2" ? server.auth.configRevision : "",
    }));
    return { schemaFingerprint, securityFingerprint, sideEffect, reviewRevision, taskSupport };
  };

  const openSession = async (
    serverId: string,
    server: McpServerConfig,
    signal: AbortSignal,
  ): Promise<ActiveMcpSession> => {
    let endpoint: URL;
    try {
      endpoint = new URL(server.endpoint);
    } catch {
      throw new McpRuntimeError("mcp_endpoint_invalid", `MCP 服务 ${serverId} 的地址无效`);
    }
    if (!isValidMcpEndpoint(server.endpoint) || isForbiddenMcpUrl(endpoint)) {
      throw new McpRuntimeError("mcp_endpoint_invalid", `MCP 服务 ${serverId} 的地址不允许访问`);
    }

    const headers = await resolveMcpHeaders(dependencies, serverId, server, signal);

    const transport = new StreamableHTTPClientTransport(endpoint, {
      requestInit: { headers },
      fetch: createMcpFetch(endpoint, fetcher),
      reconnectionOptions: {
        maxReconnectionDelay: 1_000,
        initialReconnectionDelay: 250,
        reconnectionDelayGrowFactor: 1,
        maxRetries: 0,
      },
    });
    const client = new Client(
      { name: "chatus", version: "0.1.0" },
      { jsonSchemaValidator: MCP_SCHEMA_VALIDATOR },
    );
    try {
      await client.connect(transport, {
        signal,
        timeout: MCP_CALL_TIMEOUT_MS,
        maxTotalTimeout: MCP_CALL_TIMEOUT_MS,
      });
      return {
        client,
        transport,
        configKey: stableJsonStringify({ endpoint: server.endpoint, auth: server.auth }),
        tools: new Map(),
      };
    } catch (error) {
      await transport.close().catch(() => undefined);
      if (error instanceof McpRuntimeError) throw error;
      throw new McpRuntimeError("mcp_protocol_error", `无法连接 MCP 服务 ${serverId}`, true);
    }
  };

  const loadRuntimeTools = async (
    session: ActiveMcpSession,
    server: McpServerConfig,
    signal: AbortSignal,
  ): Promise<Map<string, McpRuntimeToolSnapshot>> => {
    const tools = new Map<string, McpRuntimeToolSnapshot>();
    let cursor: string | undefined;
    for (let page = 0; page < MAX_MCP_TOOL_PAGES; page += 1) {
      const result = await session.client.listTools(cursor ? { cursor } : undefined, {
        signal,
        timeout: MCP_CALL_TIMEOUT_MS,
        maxTotalTimeout: MCP_CALL_TIMEOUT_MS,
      });
      for (const tool of result.tools) {
        const snapshot = await inspectRemoteTool(tool, server);
        if (!snapshot) continue;
        tools.set(tool.name, snapshot);
        if (tools.size > MAX_MCP_TOOLS) {
          throw new McpRuntimeError("mcp_protocol_error", "MCP 工具数量超过限制");
        }
      }
      cursor = result.nextCursor;
      if (!cursor) return tools;
    }
    throw new McpRuntimeError("mcp_protocol_error", "MCP 工具列表分页超过限制");
  };

  const throwToolDrift = async (
    definition: NormalizedToolDefinition,
    message: string,
  ): Promise<never> => {
    const reviewRevision = definition.config.reviewRevision;
    if (reviewRevision) {
      await dependencies.recordToolDrift?.(definition.id, reviewRevision).catch(() => undefined);
    }
    throw new McpRuntimeError("mcp_tool_changed", message);
  };

  return {
    discoverTools: async (serverId, server, signal) => {
      const session = await openSession(serverId, server, signal);
      try {
        const tools: McpDiscoveredTool[] = [];
        let cursor: string | undefined;
        let rejected = 0;
        for (let page = 0; page < MAX_MCP_TOOL_PAGES && tools.length < MAX_MCP_TOOLS; page += 1) {
          const result = await session.client.listTools(cursor ? { cursor } : undefined, {
            signal,
            timeout: MCP_CALL_TIMEOUT_MS,
            maxTotalTimeout: MCP_CALL_TIMEOUT_MS,
          });
          for (const remoteTool of result.tools) {
            const remoteName = normalizeBoundedText(remoteTool.name, 128);
            const inputSchema = normalizeMcpToolSchema(remoteTool.inputSchema);
            const snapshot = await inspectRemoteTool(remoteTool, server);
            if (
              !remoteName
              || !MCP_REMOTE_NAME_PATTERN.test(remoteName)
              || !inputSchema
              || !snapshot
              || snapshot.taskSupport === "required"
            ) {
              rejected += 1;
              continue;
            }
            tools.push({
              id: `mcp:${serverId}:${remoteName}`,
              label: normalizeBoundedText(remoteTool.title, 80) || remoteName,
              description: normalizeBoundedText(remoteTool.description, 1_000),
              inputSchema,
              confirmation: snapshot.sideEffect === "read" ? "first-per-conversation" : "always",
              executor: { type: "mcp", serverId, remoteName },
              schemaFingerprint: snapshot.schemaFingerprint,
              securityFingerprint: snapshot.securityFingerprint,
              sideEffect: snapshot.sideEffect,
              reviewRevision: snapshot.reviewRevision,
              reviewRequired: true,
            });
            if (tools.length >= MAX_MCP_TOOLS) break;
          }
          cursor = result.nextCursor;
          if (!cursor) return { serverId, tools, rejected };
        }
        if (cursor) throw new McpRuntimeError("mcp_protocol_error", "MCP 工具列表分页超过限制");
        return { serverId, tools, rejected };
      } finally {
        await closeMcpSession(session);
      }
    },
    createExecution: () => {
      const sessions = new Map<string, ActiveMcpSession>();
      let closed = false;
      return {
        executeTool: async (definition, value, server, signal) => {
          if (closed) throw new McpRuntimeError("mcp_runtime_closed", "MCP 运行时已关闭");
          const executor = definition.config.executor;
          if (executor.type !== "mcp") {
            throw new McpRuntimeError("tool_execution_failed", "工具执行器类型无效");
          }
          if (!isRecord(value)) {
            throw new McpRuntimeError("tool_arguments_invalid", "MCP 工具参数必须是对象");
          }
          if (!server || server.enabled !== true) {
            throw new McpRuntimeError("tool_not_found", "MCP 服务未启用");
          }

          let session = sessions.get(executor.serverId);
          const configKey = stableJsonStringify({ endpoint: server.endpoint, auth: server.auth });
          if (session && session.configKey !== configKey) {
            sessions.delete(executor.serverId);
            await closeMcpSession(session);
            session = undefined;
          }
          if (!session) {
            session = await openSession(executor.serverId, server, signal);
            sessions.set(executor.serverId, session);
          }
          try {
            session.tools = await loadRuntimeTools(session, server, signal);
          } catch (error) {
            sessions.delete(executor.serverId);
            await closeMcpSession(session);
            throw error;
          }
          const remote = session.tools.get(executor.remoteName);
          if (!remote) {
            return throwToolDrift(definition, "MCP 工具已不存在，请管理员重新发现");
          }
          if (!definition.config.schemaFingerprint || remote.schemaFingerprint !== definition.config.schemaFingerprint) {
            return throwToolDrift(definition, "MCP 工具 Schema 已变化，请管理员重新发现并启用");
          }
          if (
            !definition.config.securityFingerprint
            || remote.securityFingerprint !== definition.config.securityFingerprint
          ) {
            return throwToolDrift(definition, "MCP 工具安全标注已变化，请管理员重新发现并启用");
          }
          if (!definition.config.sideEffect || remote.sideEffect !== definition.config.sideEffect) {
            return throwToolDrift(definition, "MCP 工具副作用分类已变化，请管理员重新发现并启用");
          }
          if (
            !definition.config.reviewRevision
            || remote.reviewRevision !== definition.config.reviewRevision
            || definition.config.reviewRequired === true
          ) {
            return throwToolDrift(definition, "MCP 工具审查版本已失效，请管理员重新审查并启用");
          }
          if (remote.taskSupport === "required") {
            throw new McpRuntimeError("mcp_tool_unsupported", "首版不支持必须使用 Task 的 MCP 工具");
          }

          let result: unknown;
          try {
            result = await session.client.callTool(
              { name: executor.remoteName, arguments: value },
              undefined,
              { signal, timeout: MCP_CALL_TIMEOUT_MS, maxTotalTimeout: MCP_CALL_TIMEOUT_MS },
            );
          } catch {
            throw new McpRuntimeError("tool_execution_failed", `MCP 工具 ${definition.label} 执行失败`, true);
          }
          return normalizeMcpToolResult(result);
        },
        close: async () => {
          if (closed) return;
          closed = true;
          const active = [...sessions.values()];
          sessions.clear();
          await Promise.all(active.map((session) => closeMcpSession(session)));
        },
      };
    },
  };
}

export function isValidMcpEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.hash;
  } catch {
    return false;
  }
}

export function isForbiddenMcpUrl(url: URL): boolean {
  if (url.protocol !== "https:" || url.username || url.password || url.hash) return true;
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost")) return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return isForbiddenIpv4(hostname);
  if (hostname.includes(":")) return isForbiddenIpv6(hostname);
  return false;
}

export function normalizeMcpToolSchema(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length > MAX_MCP_TOOL_SCHEMA_CHARS) return null;
    const parsed: unknown = JSON.parse(serialized);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function resolveMcpHeaders(
  dependencies: McpRuntimeDependencies,
  serverId: string,
  server: McpServerConfig,
  signal: AbortSignal,
): Promise<Headers> {
  const headers = new Headers();
  if (server.auth.type === "none") return headers;
  if (server.auth.type === "oauth2") {
    let accessToken = "";
    try {
      accessToken = await dependencies.resolveOAuthAccessToken?.(serverId, server, signal) || "";
    } catch (error) {
      const reviewRequired = isRecord(error) && error.code === "mcp_oauth_review_required";
      throw new McpRuntimeError(
        reviewRequired ? "mcp_oauth_review_required" : "mcp_oauth_reconnect_required",
        reviewRequired ? `MCP 服务 ${serverId} 需要重新审查` : `MCP 服务 ${serverId} 需要重新连接`,
      );
    }
    if (!accessToken) {
      throw new McpRuntimeError("mcp_oauth_reconnect_required", `MCP 服务 ${serverId} 需要重新连接`);
    }
    headers.set("Authorization", `Bearer ${accessToken}`);
    return headers;
  }

  const secret = await dependencies.resolveSecret(server.auth.secretRef);
  if (!secret) throw new McpRuntimeError("mcp_auth_unavailable", `MCP 服务 ${serverId} 的认证密钥不可用`);
  if (server.auth.type === "bearer") headers.set("Authorization", `Bearer ${secret}`);
  else headers.set("X-API-Key", secret);
  return headers;
}

function createMcpFetch(
  endpoint: URL,
  fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  const endpointOrigin = endpoint.origin;
  return async (input, init = {}) => {
    const requestUrl = input instanceof URL
      ? input
      : typeof input === "string"
        ? new URL(input)
        : new URL(input.url);
    if (
      requestUrl.origin !== endpointOrigin
      || !isValidMcpEndpoint(requestUrl.toString())
      || isForbiddenMcpUrl(requestUrl)
    ) {
      throw new McpRuntimeError("mcp_endpoint_invalid", "MCP 请求试图访问未授权的地址");
    }
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    const response = await fetcher(requestUrl, { ...init, headers, redirect: "manual" });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel().catch(() => undefined);
      throw new McpRuntimeError("mcp_redirect_rejected", "MCP 服务返回了不允许的重定向");
    }
    const length = Number(response.headers.get("Content-Length") || "0");
    if (length > MAX_MCP_RESPONSE_BYTES) {
      await response.body?.cancel().catch(() => undefined);
      throw new McpRuntimeError("mcp_protocol_error", "MCP 响应超过协议大小限制");
    }
    if (!response.body) return response;
    const boundedBody = createBoundedReadableStream(response.body, MAX_MCP_RESPONSE_BYTES);
    return new Response(boundedBody, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}

function createBoundedReadableStream(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let total = 0;
  return new ReadableStream({
    async pull(controller) {
      const { value, done } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        controller.error(new McpRuntimeError("mcp_protocol_error", "MCP 响应超过协议大小限制"));
        return;
      }
      controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
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

function normalizeMcpToolResult(value: unknown): unknown {
  if (!isRecord(value) || "toolResult" in value || !Array.isArray(value.content)) {
    throw new McpRuntimeError("mcp_protocol_error", "MCP 工具返回了不支持的结果格式");
  }
  if (value.isError === true) throw new McpRuntimeError("tool_execution_failed", "MCP 工具报告执行失败");
  const text: string[] = [];
  for (const block of value.content) {
    if (!isRecord(block) || block.type !== "text" || typeof block.text !== "string") {
      throw new McpRuntimeError("mcp_tool_unsupported", "MCP 工具返回了首版不支持的非文本内容");
    }
    text.push(block.text);
  }
  const structuredContent = isRecord(value.structuredContent) ? value.structuredContent : undefined;
  if (structuredContent && text.length) return { structuredContent, content: text.join("\n") };
  if (structuredContent) return structuredContent;
  return { content: text.join("\n") };
}

async function closeMcpSession(session: ActiveMcpSession): Promise<void> {
  await session.transport.terminateSession().catch(() => undefined);
  await session.client.close().catch(() => undefined);
}

function stableJsonStringify(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize);
    if (isRecord(item)) {
      return Object.fromEntries(Object.keys(item).sort().map((key) => [key, normalize(item[key])]));
    }
    return item;
  };
  return JSON.stringify(normalize(value));
}

function normalizeBoundedText(value: unknown, maxChars: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxChars) : "";
}

export function classifyMcpToolSideEffect(annotations: unknown): McpToolSideEffect {
  if (isRecord(annotations) && annotations.destructiveHint === true) return "destructive";
  if (isRecord(annotations) && annotations.readOnlyHint === true) return "read";
  return "write";
}

function normalizeMcpSecurityAnnotations(annotations: unknown): Record<string, boolean | null> {
  const record = isRecord(annotations) ? annotations : {};
  return {
    readOnlyHint: normalizeMcpAnnotationHint(record.readOnlyHint),
    destructiveHint: normalizeMcpAnnotationHint(record.destructiveHint),
    idempotentHint: normalizeMcpAnnotationHint(record.idempotentHint),
    openWorldHint: normalizeMcpAnnotationHint(record.openWorldHint),
  };
}

function normalizeMcpAnnotationHint(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
