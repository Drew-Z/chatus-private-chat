import { describe, expect, it } from "vitest";
import {
  createAgentErrorEnvelope,
  parseAgentErrorEnvelope,
  projectAgentStreamError,
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
  });

  it("accepts message-less envelopes but rejects expanded or malformed payloads", () => {
    expect(parseAgentErrorEnvelope('{"error":"provider_busy"}')).toEqual({
      error: "provider_busy",
      message: "当前模型的可用线路都在忙，请稍后重试或切换模型。",
    });
    expect(parseAgentErrorEnvelope('{"error":"upstream_error","providerId":"private"}')).toBeUndefined();
    expect(parseAgentErrorEnvelope('{"error":"UPSTREAM ERROR"}')).toBeUndefined();
    expect(parseAgentErrorEnvelope("not-json")).toBeUndefined();
  });

  it("projects provider failures into actionable public classes", () => {
    expect(projectAgentStreamError(namedError("ProviderBusyError"))).toBe("provider_busy");
    expect(projectAgentStreamError(namedError("ProviderProtocolError"))).toBe("provider_protocol_error");
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
});

function namedError(name: string): Error {
  const error = new Error("private provider detail");
  error.name = name;
  return error;
}
