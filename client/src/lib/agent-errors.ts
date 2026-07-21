type AgentErrorEnvelope = {
  error: string;
  message?: string;
};

export function friendlyAgentError(message: string, online: boolean): string {
  if (!online) return "网络已断开，草稿仍保存在当前设备。";
  const envelope = parseAgentErrorEnvelope(message);
  const code = envelope?.error.toLocaleLowerCase() || "";
  const detail = envelope?.message || message;
  const normalized = `${code} ${detail}`.toLocaleLowerCase();
  if (code.startsWith("agent_identity_")) return "Agent 会话身份已失效，请刷新页面重新连接。";
  if (normalized.includes("rate") || normalized.includes("额度")) return "当前额度已用完，请稍后再试或联系管理员调整额度。";
  if (normalized.includes("timeout") || normalized.includes("超时")) return "模型线路响应超时，可以稍后重试或切换线路。";
  if (normalized.includes("key") || normalized.includes("认证")) return "当前线路凭据不可用，请切换线路或联系管理员。";
  return detail || "本轮任务暂时失败，可以重新连接后继续。";
}

function parseAgentErrorEnvelope(value: string): AgentErrorEnvelope | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const record = parsed as Record<string, unknown>;
    if (typeof record.error !== "string") return undefined;
    return {
      error: record.error,
      message: typeof record.message === "string" ? record.message : undefined,
    };
  } catch {
    return undefined;
  }
}
