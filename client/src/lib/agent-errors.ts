import {
  agentErrorMessage,
  parseAgentErrorEnvelope,
  type AgentErrorCode,
} from "../../../src/contracts/agent-error";

export type AgentErrorPresentation = {
  code: AgentErrorCode;
  message: string;
  requestId?: string;
};

export function resolveAgentError(message: string, online: boolean): AgentErrorPresentation {
  const envelope = parseAgentErrorEnvelope(message);
  if (!online) {
    return {
      code: envelope?.error || "agent_error",
      message: "网络已断开，草稿仍保存在当前设备。",
      ...(envelope?.requestId ? { requestId: envelope.requestId } : {}),
    };
  }
  if (envelope) {
    return {
      code: envelope.error,
      message: agentErrorMessage(envelope.error),
      ...(envelope.requestId ? { requestId: envelope.requestId } : {}),
    };
  }

  const normalized = message.trim().toLowerCase();
  if (normalized.startsWith("{") || normalized.startsWith("[")) {
    return presentation("agent_error");
  }
  if (/timed?\s*out|timeout|超时/.test(normalized)) return presentation("upstream_timeout");
  if (/provider.*busy|线路.*繁忙|模型.*繁忙/.test(normalized)) return presentation("provider_busy");
  if (/quota|额度/.test(normalized)) return presentation("rate_limited");
  if (/rate.?limit|too many requests|\b429\b/.test(normalized)) return presentation("upstream_rate_limited");
  if (/api.?key|authentication|unauthorized|forbidden|认证|凭据|\b401\b|\b403\b/.test(normalized)) {
    return presentation("upstream_authentication_failed");
  }
  if (/protocol|invalid sse|无法识别.*响应/.test(normalized)) return presentation("provider_protocol_error");
  if (/network|fetch|unavailable|连接失败|\b5\d\d\b/.test(normalized)) return presentation("upstream_unavailable");
  return presentation("agent_error");
}

export function friendlyAgentError(message: string, online: boolean): string {
  return resolveAgentError(message, online).message;
}

export function isConversationAccessRefreshError(message: string): boolean {
  const envelope = parseAgentErrorEnvelope(message);
  return envelope?.error === "conversation_not_found"
    || envelope?.error === "conversation_access_revision_conflict";
}

function presentation(code: AgentErrorCode): AgentErrorPresentation {
  return { code, message: agentErrorMessage(code) };
}
