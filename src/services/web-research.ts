import type {
  CapabilityAssignment,
  CapabilityRegistryConfig,
  CapabilityUnavailableReason,
  McpServerConfig,
  NormalizedToolDefinition,
  ToolConfig,
} from "../contracts/capability";
import {
  WEB_RESEARCH_CAPABILITY_ID,
  WEB_RESEARCH_TIMEOUT_MS,
  decodeWebResearchToolResult,
  isReviewedWebResearchTool,
  normalizeWebResearchQuery,
  type WebResearchEvidenceV1,
} from "../contracts/web-research";
import { McpRuntimeError, type McpRuntimeExecution } from "./mcp-runtime";

export type WebResearchBinding = {
  toolId: string;
  tool: ToolConfig & { executor: Extract<ToolConfig["executor"], { type: "mcp" }> };
  server: McpServerConfig;
  definition: NormalizedToolDefinition;
};

export type WebResearchBindingResult =
  | { ok: true; binding: WebResearchBinding }
  | { ok: false; reason: CapabilityUnavailableReason };

export class WebResearchRuntimeError extends Error {
  constructor(
    readonly code:
      | "request_cancelled"
      | "web_research_timeout"
      | "web_research_connection_required"
      | "web_research_review_required"
      | "web_research_invalid_response"
      | "web_research_no_sources"
      | "web_research_query_invalid"
      | "web_research_not_available",
  ) {
    super(code);
    this.name = "WebResearchRuntimeError";
  }
}

export function resolveWebResearchBinding(
  config: CapabilityRegistryConfig,
  assignment: CapabilityAssignment,
): WebResearchBindingResult {
  const candidates = Object.entries(config.tools || {}).filter(([, tool]) => tool.capabilityRole === "web_search");
  if (candidates.length !== 1) return { ok: false, reason: "tool_unavailable" };
  const [toolId, tool] = candidates[0];
  if (!(assignment.allowedTools || []).includes(toolId)) return { ok: false, reason: "not_assigned" };
  if (tool.reviewRequired === true || tool.sideEffect !== "read") return { ok: false, reason: "review_required" };
  if (!isReviewedWebResearchTool(tool)) return { ok: false, reason: "tool_unavailable" };
  const server = config.mcpServers?.[tool.executor.serverId];
  if (!server || server.enabled !== true) return { ok: false, reason: "tool_unavailable" };
  return {
    ok: true,
    binding: {
      toolId,
      tool,
      server,
      definition: {
        id: toolId,
        providerName: WEB_RESEARCH_CAPABILITY_ID,
        label: tool.label,
        description: tool.description || tool.label,
        inputSchema: tool.inputSchema,
        config: tool,
      },
    },
  };
}

export async function executeWebResearch(
  execution: McpRuntimeExecution,
  binding: WebResearchBinding,
  queryValue: unknown,
  signal?: AbortSignal,
  timeoutMs = WEB_RESEARCH_TIMEOUT_MS,
): Promise<WebResearchEvidenceV1> {
  const query = normalizeWebResearchQuery(queryValue);
  if (!query) {
    await execution.close().catch(() => undefined);
    throw new WebResearchRuntimeError("web_research_query_invalid");
  }
  const controller = new AbortController();
  let timedOut = false;
  const abortFromParent = () => controller.abort(signal?.reason);
  if (signal?.aborted) abortFromParent();
  else signal?.addEventListener("abort", abortFromParent, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException("Web research timed out", "TimeoutError"));
  }, Math.max(1, timeoutMs));

  try {
    if (controller.signal.aborted) throw new WebResearchRuntimeError("request_cancelled");
    const result = await raceWebResearchExecution(
      execution.executeTool(
        binding.definition,
        { query },
        binding.server,
        controller.signal,
      ),
      controller.signal,
    );
    if (controller.signal.aborted) {
      throw new WebResearchRuntimeError(timedOut ? "web_research_timeout" : "request_cancelled");
    }
    try {
      return decodeWebResearchToolResult(result);
    } catch (error) {
      if (error instanceof Error && error.message === "web_research_empty") {
        throw new WebResearchRuntimeError("web_research_no_sources");
      }
      throw new WebResearchRuntimeError("web_research_invalid_response");
    }
  } catch (error) {
    if (error instanceof WebResearchRuntimeError) throw error;
    if (signal?.aborted) throw new WebResearchRuntimeError("request_cancelled");
    if (timedOut) throw new WebResearchRuntimeError("web_research_timeout");
    if (error instanceof McpRuntimeError) {
      if (error.code === "mcp_oauth_reconnect_required" || error.code === "mcp_auth_unavailable") {
        throw new WebResearchRuntimeError("web_research_connection_required");
      }
      if (error.code === "mcp_oauth_review_required" || error.code === "mcp_tool_changed") {
        throw new WebResearchRuntimeError("web_research_review_required");
      }
    }
    throw new WebResearchRuntimeError("web_research_not_available");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abortFromParent);
    await execution.close().catch(() => undefined);
  }
}

function raceWebResearchExecution<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}
