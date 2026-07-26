import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker";
import type { McpServerConfig, NormalizedToolDefinition } from "../contracts/capability";

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
  confirmation: "first-per-conversation";
  executor: { type: "mcp"; serverId: string; remoteName: string };
  schemaFingerprint: string;
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
  fingerprint(value: string): Promise<string>;
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
};

type ActiveMcpSession = {
  client: Client;
  transport: StreamableHTTPClientTransport;
  tools: Map<string, { schemaFingerprint: string; taskSupport: string; readOnly: boolean }>;
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

    const headers = new Headers();
    if (server.authType !== "none") {
      const secretRef = server.secretRef || "";
      if (!secretRef) throw new McpRuntimeError("mcp_auth_unavailable", `MCP 服务 ${serverId} 缺少 Secret Ref`);
      const secret = await dependencies.resolveSecret(secretRef);
      if (!secret) throw new McpRuntimeError("mcp_auth_unavailable", `MCP 服务 ${serverId} 的认证密钥不可用`);
      if (server.authType === "bearer") headers.set("Authorization", `Bearer ${secret}`);
      else headers.set("X-API-Key", secret);
    }

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
      return { client, transport, tools: new Map() };
    } catch (error) {
      await transport.close().catch(() => undefined);
      if (error instanceof McpRuntimeError) throw error;
      throw new McpRuntimeError("mcp_protocol_error", `无法连接 MCP 服务 ${serverId}`, true);
    }
  };

  const loadRuntimeTools = async (session: ActiveMcpSession, signal: AbortSignal): Promise<void> => {
    let cursor: string | undefined;
    for (let page = 0; page < MAX_MCP_TOOL_PAGES; page += 1) {
      const result = await session.client.listTools(cursor ? { cursor } : undefined, {
        signal,
        timeout: MCP_CALL_TIMEOUT_MS,
        maxTotalTimeout: MCP_CALL_TIMEOUT_MS,
      });
      for (const tool of result.tools) {
        const inputSchema = normalizeMcpToolSchema(tool.inputSchema);
        if (!inputSchema || !MCP_REMOTE_NAME_PATTERN.test(tool.name)) continue;
        session.tools.set(tool.name, {
          schemaFingerprint: await fingerprintSchema(inputSchema),
          taskSupport: tool.execution?.taskSupport || "forbidden",
          readOnly: isReadOnlyMcpTool(tool.annotations),
        });
        if (session.tools.size > MAX_MCP_TOOLS) {
          throw new McpRuntimeError("mcp_protocol_error", "MCP 工具数量超过限制");
        }
      }
      cursor = result.nextCursor;
      if (!cursor) return;
    }
    throw new McpRuntimeError("mcp_protocol_error", "MCP 工具列表分页超过限制");
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
            const readOnly = isReadOnlyMcpTool(remoteTool.annotations);
            const taskSupport = remoteTool.execution?.taskSupport || "forbidden";
            if (
              !remoteName
              || !MCP_REMOTE_NAME_PATTERN.test(remoteName)
              || !inputSchema
              || !readOnly
              || taskSupport === "required"
            ) {
              rejected += 1;
              continue;
            }
            tools.push({
              id: `mcp:${serverId}:${remoteName}`,
              label: normalizeBoundedText(remoteTool.title, 80) || remoteName,
              description: normalizeBoundedText(remoteTool.description, 1_000),
              inputSchema,
              confirmation: "first-per-conversation",
              executor: { type: "mcp", serverId, remoteName },
              schemaFingerprint: await fingerprintSchema(inputSchema),
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
          if (!session) {
            session = await openSession(executor.serverId, server, signal);
            try {
              await loadRuntimeTools(session, signal);
            } catch (error) {
              await closeMcpSession(session);
              throw error;
            }
            sessions.set(executor.serverId, session);
          }
          const remote = session.tools.get(executor.remoteName);
          if (!remote) {
            throw new McpRuntimeError("mcp_tool_changed", "MCP 工具已不存在，请管理员重新发现");
          }
          if (!definition.config.schemaFingerprint || remote.schemaFingerprint !== definition.config.schemaFingerprint) {
            throw new McpRuntimeError("mcp_tool_changed", "MCP 工具 Schema 已变化，请管理员重新发现并启用");
          }
          if (!remote.readOnly) {
            throw new McpRuntimeError("mcp_tool_changed", "MCP 工具只读标注已变化，请管理员重新发现并启用");
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

function isReadOnlyMcpTool(annotations: unknown): boolean {
  return isRecord(annotations)
    && annotations.readOnlyHint === true
    && annotations.destructiveHint !== true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
