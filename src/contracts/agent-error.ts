export type AgentErrorEnvelope = {
  error: string;
  message: string;
};

const AGENT_ERROR_CODE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const GENERIC_AGENT_ERROR = "agent_error";

const AGENT_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  agent_error: "本轮任务暂时失败，可以稍后重试。",
  agent_identity_unavailable: "Agent 会话身份已失效，请刷新页面重新连接。",
  agent_identity_conflict: "Agent 会话身份发生冲突，请刷新页面重新连接。",
  agent_identity_corrupt: "Agent 会话状态无法恢复，请刷新页面重新连接。",
  agent_context_invalid: "工具续接上下文无法恢复，请刷新页面后重试。",
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
  upstream_timeout: "模型线路响应超时，请稍后重试或切换模型。",
  upstream_rate_limited: "上游模型暂时限流，请稍后重试或切换模型。",
  upstream_authentication_failed: "模型线路凭据不可用，请切换模型或联系管理员。",
  upstream_request_rejected: "当前模型无法处理这次请求，请调整内容、切换模型或联系管理员。",
  provider_protocol_error: "模型线路返回了无法识别的响应，请切换模型或联系管理员。",
  upstream_unavailable: "模型服务暂时不可用，请稍后重试或切换模型。",
  upstream_error: "模型线路暂时不可用，请稍后重试或切换模型。",
  request_cancelled: "本轮任务已停止。",
};

export function agentErrorMessage(error: string): string {
  return AGENT_ERROR_MESSAGES[normalizeAgentErrorCode(error)] || AGENT_ERROR_MESSAGES[GENERIC_AGENT_ERROR];
}

export function createAgentErrorEnvelope(error: string): AgentErrorEnvelope {
  const normalized = normalizeAgentErrorCode(error);
  return { error: normalized, message: agentErrorMessage(normalized) };
}

export function serializeAgentErrorEnvelope(error: string): string {
  return JSON.stringify(createAgentErrorEnvelope(error));
}

export function parseAgentErrorEnvelope(value: string): AgentErrorEnvelope | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed)) return undefined;
    const keys = Object.keys(parsed);
    if (keys.some((key) => key !== "error" && key !== "message")) return undefined;
    if (typeof parsed.error !== "string" || !AGENT_ERROR_CODE_PATTERN.test(parsed.error)) return undefined;
    if (parsed.message !== undefined && typeof parsed.message !== "string") return undefined;
    return {
      error: parsed.error,
      message: typeof parsed.message === "string" ? parsed.message : agentErrorMessage(parsed.error),
    };
  } catch {
    return undefined;
  }
}

export function projectAgentStreamError(error: unknown): string {
  const chain = errorChain(error);
  if (hasName(chain, "ProviderBusyError")) return "provider_busy";
  if (
    hasName(chain, "ProviderProtocolError")
    || chain.some((item) => item.code === "provider_protocol_error")
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

function normalizeAgentErrorCode(value: string): string {
  const normalized = value.trim().toLowerCase();
  return AGENT_ERROR_CODE_PATTERN.test(normalized) ? normalized : GENERIC_AGENT_ERROR;
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
