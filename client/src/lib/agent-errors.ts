import {
  agentErrorMessage,
  parseAgentErrorEnvelope,
} from "../../../src/contracts/agent-error";

export function friendlyAgentError(message: string, online: boolean): string {
  if (!online) return "网络已断开，草稿仍保存在当前设备。";
  const envelope = parseAgentErrorEnvelope(message);
  if (envelope) return agentErrorMessage(envelope.error);

  const normalized = message.toLowerCase();
  if (/timed?\s*out|timeout|超时/.test(normalized)) return agentErrorMessage("upstream_timeout");
  if (/provider.*busy|线路.*繁忙|模型.*繁忙/.test(normalized)) return agentErrorMessage("provider_busy");
  if (/quota|额度/.test(normalized)) return agentErrorMessage("rate_limited");
  if (/rate.?limit|too many requests|\b429\b/.test(normalized)) return agentErrorMessage("upstream_rate_limited");
  if (/api.?key|authentication|unauthorized|forbidden|认证|凭据|\b401\b|\b403\b/.test(normalized)) {
    return agentErrorMessage("upstream_authentication_failed");
  }
  if (/protocol|invalid sse|无法识别.*响应/.test(normalized)) return agentErrorMessage("provider_protocol_error");
  if (/network|fetch|unavailable|连接失败|\b5\d\d\b/.test(normalized)) return agentErrorMessage("upstream_unavailable");
  return agentErrorMessage("agent_error");
}
