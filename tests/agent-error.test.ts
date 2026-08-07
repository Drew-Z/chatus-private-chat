import { describe, expect, it } from "vitest";
import {
  createAgentErrorEnvelope,
  parseAgentErrorEnvelope,
  projectAgentStreamError,
  providerBudgetErrorHttpStatus,
  serializeAgentErrorEnvelope,
} from "../src/contracts/agent-error";

describe("Agent error contract", () => {
  it("serializes only a stable code and canonical safe message", () => {
    const serialized = serializeAgentErrorEnvelope("upstream_error");
    expect(JSON.parse(serialized)).toEqual({
      error: "upstream_error",
      message: "模型线路暂时不可用，请稍后重试或切换模型。",
    });
    expect(serialized).not.toContain("providerId");
    expect(createAgentErrorEnvelope("not a valid code")).toEqual({
      error: "agent_error",
      message: "本轮任务暂时失败，可以稍后重试。",
    });
    expect(createAgentErrorEnvelope("unknown_internal_code")).toEqual({
      error: "agent_error",
      message: "本轮任务暂时失败，可以稍后重试。",
    });
    expect(createAgentErrorEnvelope("upstream_error", "turn_request-123")).toEqual({
      error: "upstream_error",
      message: "模型线路暂时不可用，请稍后重试或切换模型。",
      requestId: "turn_request-123",
    });
  });

  it("accepts legacy message-less envelopes and strict request references", () => {
    expect(parseAgentErrorEnvelope('{"error":"provider_busy"}')).toEqual({
      error: "provider_busy",
      message: "当前模型的可用线路都在忙，请稍后重试或切换模型。",
    });
    expect(parseAgentErrorEnvelope('{"error":"upstream_error","providerId":"private"}')).toBeUndefined();
    expect(parseAgentErrorEnvelope('{"error":"upstream_error","message":"private upstream body"}')).toBeUndefined();
    expect(parseAgentErrorEnvelope('{"error":"unknown_internal_code"}')).toBeUndefined();
    expect(parseAgentErrorEnvelope('{"error":"upstream_error","requestId":"turn_request-123"}')).toEqual({
      error: "upstream_error",
      message: "模型线路暂时不可用，请稍后重试或切换模型。",
      requestId: "turn_request-123",
    });
    expect(parseAgentErrorEnvelope('{"error":"upstream_error","requestId":"bad id"}')).toBeUndefined();
    expect(parseAgentErrorEnvelope('{"error":"UPSTREAM ERROR"}')).toBeUndefined();
    expect(parseAgentErrorEnvelope("not-json")).toBeUndefined();
  });

  it("projects provider failures into actionable public classes", () => {
    expect(projectAgentStreamError({ name: "ProviderBudgetError", code: "provider_budget_exceeded" }))
      .toBe("provider_budget_exceeded");
    expect(projectAgentStreamError({ name: "ProviderBudgetError", code: "provider_budget_policy_unknown" }))
      .toBe("provider_budget_policy_unknown");
    expect(projectAgentStreamError(namedError("ProviderAttemptLedgerError"))).toBe("provider_budget_unavailable");
    expect(projectAgentStreamError(namedError("ProviderBusyError"))).toBe("provider_busy");
    expect(projectAgentStreamError(namedError("ProviderProtocolError"))).toBe("provider_protocol_error");
    expect(projectAgentStreamError({ name: "UpstreamRequestError", status: 502, outcome: "protocol_error" }))
      .toBe("provider_protocol_error");
    expect(projectAgentStreamError(namedError("TimeoutError"))).toBe("upstream_timeout");
    expect(projectAgentStreamError(namedError("AbortError"))).toBe("request_cancelled");
    expect(projectAgentStreamError({ statusCode: 401, responseBody: "private upstream body" }))
      .toBe("upstream_authentication_failed");
    expect(projectAgentStreamError({ cause: { status: 429 } })).toBe("upstream_rate_limited");
    expect(projectAgentStreamError({ statusCode: 422 })).toBe("upstream_request_rejected");
    expect(projectAgentStreamError({ statusCode: 503 })).toBe("upstream_unavailable");
    expect(projectAgentStreamError({ name: "AI_APICallError" })).toBe("upstream_unavailable");
    expect(projectAgentStreamError(new Error("unexpected private detail"))).toBe("upstream_error");
  });

  it("maps public budget errors to stable HTTP statuses", () => {
    expect(providerBudgetErrorHttpStatus("provider_budget_exceeded")).toBe(429);
    expect(providerBudgetErrorHttpStatus("provider_budget_policy_unknown")).toBe(503);
    expect(providerBudgetErrorHttpStatus("provider_budget_unavailable")).toBe(503);
    expect(providerBudgetErrorHttpStatus("upstream_unavailable")).toBeUndefined();
  });
});

function namedError(name: string): Error {
  const error = new Error("private provider detail");
  error.name = name;
  return error;
}
