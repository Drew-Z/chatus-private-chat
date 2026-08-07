export type AgentErrorEnvelope = {
  error: AgentErrorCode;
  message: string;
  requestId?: string;
};

const AGENT_ERROR_CODE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const AGENT_REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const GENERIC_AGENT_ERROR = "agent_error";

const AGENT_ERROR_MESSAGES = {
  agent_error: "本轮任务暂时失败，可以稍后重试。",
  agent_runtime_error: "任务运行时暂时不可用，请稍后重试。",
  agent_identity_unavailable: "Agent 会话身份已失效，请刷新页面重新连接。",
  agent_identity_conflict: "Agent 会话身份发生冲突，请刷新页面重新连接。",
  agent_identity_corrupt: "Agent 会话状态无法恢复，请刷新页面重新连接。",
  agent_context_invalid: "工具续接上下文无法恢复，请刷新页面后重试。",
  conversation_not_found: "当前会话不存在或已删除，请新建会话后重试。",
  workspace_context_unavailable: "工作区上下文暂时无法加载，请稍后重试。",
  instance_maintenance: "实例正在维护，请稍后重试。",
  session_expired: "登录会话已过期，请重新登录。",
  public_access_disabled: "公开访问已关闭，请登录后继续。",
  no_routes_available: "当前没有可用模型，请联系管理员完成配置。",
  route_not_allowed: "当前模型不可用，请切换模型或联系管理员。",
  user_api_key_required: "当前模型需要额外凭据，请切换模型或联系管理员。",
  empty_messages: "消息不能为空，请补充内容后重试。",
  blocked_prompt: "该请求不符合当前使用策略，请改为一个真实任务。",
  image_not_supported: "当前模型不支持图片，请移除图片或切换模型。",
  invalid_image_type: "图片格式不受支持。",
  invalid_image_data: "图片数据无效。",
  image_too_large: "单张图片超过大小限制。",
  too_many_images: "图片数量超过限制。",
  images_too_large: "图片总大小超过限制。",
  file_not_supported: "当前会话不支持文件上传。",
  invalid_file_type: "文件格式不受支持。",
  invalid_file_data: "文件内容无法按 UTF-8 文本读取。",
  file_too_large: "单个文件超过大小限制。",
  too_many_files: "文件数量超过限制。",
  files_too_large: "文件总大小超过限制。",
  file_text_too_large: "文件文本内容超过限制。",
  rate_limited: "当前额度已用完，请稍后再试或联系管理员调整额度。",
  concurrent_turn: "当前会话已有任务正在运行，请等待完成或先停止当前任务。",
  provider_busy: "当前模型的可用线路都在忙，请稍后重试或切换模型。",
  provider_budget_exceeded: "当前 Provider 预算已用尽，请联系管理员调整预算或稍后再试。",
  provider_budget_policy_unknown: "当前 Provider 缺少可验证的价格策略，请联系管理员完成配置。",
  provider_budget_unavailable: "Provider 预算账本暂时不可用，请稍后重试。",
  upstream_timeout: "模型线路响应超时，请稍后重试或切换模型。",
  upstream_rate_limited: "上游模型暂时限流，请稍后重试或切换模型。",
  upstream_authentication_failed: "模型线路凭据不可用，请切换模型或联系管理员。",
  upstream_request_rejected: "当前模型无法处理这次请求，请调整内容、切换模型或联系管理员。",
  provider_protocol_error: "模型线路返回了无法识别的响应，请切换模型或联系管理员。",
  upstream_unavailable: "模型服务暂时不可用，请稍后重试或切换模型。",
  upstream_error: "模型线路暂时不可用，请稍后重试或切换模型。",
  request_cancelled: "本轮任务已停止。",
  tool_arguments_invalid: "工具参数无效，请调整请求后重试。",
  tool_budget_exceeded: "本轮工具执行时间超过限制，请减少任务范围后重试。",
  tool_call_limit: "本轮工具调用次数超过限制，请减少任务范围后重试。",
  tool_call_limit_exceeded: "本轮工具调用次数超过限制，请减少任务范围后重试。",
  tool_confirmation_required: "工具调用需要确认后才能继续。",
  tool_confirmation_timeout: "工具确认已超时，请重新发起请求。",
  tool_execution_failed: "工具执行失败，请稍后重试。",
  tool_not_allowed: "当前工具未获授权，请联系管理员。",
  tool_not_found: "当前工具不可用，请刷新页面或联系管理员。",
  tool_result_too_large: "工具返回内容超过限制，请缩小任务范围后重试。",
  tool_round_limit: "本轮工具交互次数超过限制，请减少任务范围后重试。",
  tool_runtime_closed: "工具会话已结束，请重新发起请求。",
  tool_time_budget_exceeded: "本轮工具执行时间超过限制，请减少任务范围后重试。",
  mcp_auth_unavailable: "MCP 认证不可用，请重新连接或联系管理员。",
  mcp_endpoint_invalid: "MCP 服务配置无效，请联系管理员检查配置。",
  mcp_oauth_reconnect_required: "MCP 连接已失效，请重新连接。",
  mcp_oauth_review_required: "MCP 权限或工具定义已变化，请重新审查后连接。",
  mcp_protocol_error: "MCP 服务返回了无法识别的响应，请稍后重试或联系管理员。",
  mcp_redirect_rejected: "MCP 服务连接被安全策略拒绝，请联系管理员。",
  mcp_runtime_closed: "MCP 连接已结束，请重新发起请求。",
  mcp_tool_changed: "MCP 工具配置已变化，请重新开始本轮请求。",
  mcp_tool_unsupported: "当前 MCP 工具暂不可用，请联系管理员。",
} as const;

export type AgentErrorCode = keyof typeof AGENT_ERROR_MESSAGES;

export function agentErrorMessage(error: string): string {
  return AGENT_ERROR_MESSAGES[normalizeAgentErrorCode(error)];
}

export function createAgentErrorEnvelope(error: string, requestId?: string): AgentErrorEnvelope {
  const normalized = normalizeAgentErrorCode(error);
  const normalizedRequestId = normalizeAgentRequestId(requestId);
  return {
    error: normalized,
    message: agentErrorMessage(normalized),
    ...(normalizedRequestId ? { requestId: normalizedRequestId } : {}),
  };
}

export function serializeAgentErrorEnvelope(error: string, requestId?: string): string {
  return JSON.stringify(createAgentErrorEnvelope(error, requestId));
}

export function parseAgentErrorEnvelope(value: string): AgentErrorEnvelope | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed)) return undefined;
    const keys = Object.keys(parsed);
    if (keys.some((key) => key !== "error" && key !== "message" && key !== "requestId")) return undefined;
    if (typeof parsed.error !== "string" || !isAgentErrorCode(parsed.error)) return undefined;
    if (parsed.message !== undefined && typeof parsed.message !== "string") return undefined;
    const message = agentErrorMessage(parsed.error);
    if (typeof parsed.message === "string" && parsed.message !== message) return undefined;
    const requestId = normalizeAgentRequestId(parsed.requestId);
    if (parsed.requestId !== undefined && !requestId) return undefined;
    return {
      error: parsed.error,
      message,
      ...(requestId ? { requestId } : {}),
    };
  } catch {
    return undefined;
  }
}

export function projectAgentStreamError(error: unknown): AgentErrorCode {
  const chain = errorChain(error);
  if (chain.some((item) => item.code === "provider_budget_exceeded")) return "provider_budget_exceeded";
  if (chain.some((item) => item.code === "provider_budget_policy_unknown")) return "provider_budget_policy_unknown";
  if (hasName(chain, "ProviderAttemptLedgerError")) return "provider_budget_unavailable";
  if (hasName(chain, "ProviderBusyError")) return "provider_busy";
  if (
    hasName(chain, "ProviderProtocolError")
    || chain.some((item) => item.code === "provider_protocol_error")
    || chain.some((item) => item.outcome === "protocol_error")
  ) return "provider_protocol_error";

  const normalizedText = chain
    .map((item) => typeof item.message === "string" ? item.message : "")
    .join(" ")
    .toLowerCase();
  const status = firstStatus(chain);
  if (
    hasName(chain, "TimeoutError")
    || status === 408
    || status === 504
    || /timed?\s*out|timeout|超时/.test(normalizedText)
  ) return "upstream_timeout";
  if (hasName(chain, "AbortError")) return "request_cancelled";
  if (status === 401 || status === 403) return "upstream_authentication_failed";
  if (status === 429) return "upstream_rate_limited";
  if (status === 400 || status === 404 || status === 409 || status === 422) {
    return "upstream_request_rejected";
  }
  if (status !== undefined && status >= 500) return "upstream_unavailable";
  if (hasName(chain, "AI_APICallError") || hasName(chain, "TypeError")) return "upstream_unavailable";
  return "upstream_error";
}

export function providerBudgetErrorHttpStatus(error: AgentErrorCode): 429 | 503 | undefined {
  if (error === "provider_budget_exceeded") return 429;
  if (error === "provider_budget_policy_unknown" || error === "provider_budget_unavailable") return 503;
  return undefined;
}

export function normalizeAgentRequestId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return AGENT_REQUEST_ID_PATTERN.test(normalized) ? normalized : undefined;
}

function normalizeAgentErrorCode(value: string): AgentErrorCode {
  const normalized = value.trim().toLowerCase();
  return AGENT_ERROR_CODE_PATTERN.test(normalized) && isAgentErrorCode(normalized)
    ? normalized
    : GENERIC_AGENT_ERROR;
}

function isAgentErrorCode(value: string): value is AgentErrorCode {
  return Object.prototype.hasOwnProperty.call(AGENT_ERROR_MESSAGES, value);
}

function errorChain(error: unknown): Record<string, unknown>[] {
  const queue: unknown[] = [error];
  const seen = new Set<object>();
  const output: Record<string, unknown>[] = [];
  while (queue.length && output.length < 12) {
    const current = queue.shift();
    if (!isRecord(current) || seen.has(current)) continue;
    seen.add(current);
    output.push(current);
    queue.push(current.cause, current.lastError);
    if (Array.isArray(current.errors)) queue.push(...current.errors.slice(0, 4));
  }
  return output;
}

function hasName(chain: Record<string, unknown>[], name: string): boolean {
  return chain.some((item) => item.name === name);
}

function firstStatus(chain: Record<string, unknown>[]): number | undefined {
  for (const item of chain) {
    const value = typeof item.statusCode === "number" ? item.statusCode : item.status;
    if (typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599) return value;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
