import { describe, expect, it } from "vitest";
import { friendlyAgentError, resolveAgentError } from "../client/src/lib/agent-errors";
import {
  conversationAgentClientName,
  findRetrySourceMessageId,
  hasPendingToolApprovalAfterLatestUser,
  hasVisibleAssistantOutputAfterLatestUser,
  isActiveTurnPhase,
  resolveMessageActionAvailability,
  restoreRejectedDraft,
  resolveLoadedMemoryDraft,
  resolvePendingDraftAction,
  resolveTurnPhase,
  type TurnPhase,
} from "../client/src/lib/state";
import { resolveClientSurface } from "../client/src/lib/routing";

describe("React client state recovery", () => {
  it("gives every conversation an exact SDK client identity", () => {
    const first = conversationAgentClientName("member-root", "chat-a:b");
    const second = conversationAgentClientName("member-root", "chat-a");
    const otherMember = conversationAgentClientName("member-other", "chat-a:b");

    expect(first).toBe('["member-root","chat-a:b"]');
    expect(second).not.toBe(first);
    expect(otherMember).not.toBe(first);
    expect(conversationAgentClientName("member-root", "chat-a:b")).toBe(first);
  });

  it("restores a rejected send without overwriting newer input", () => {
    expect(restoreRejectedDraft("", "  original draft  ")).toBe("  original draft  ");
    expect(restoreRejectedDraft("newer input", "original draft")).toBe("newer input");
  });

  it("refreshes memory metadata while preserving a conflicted local draft", () => {
    expect(resolveLoadedMemoryDraft("local edit", "server value", true)).toBe("local edit");
    expect(resolveLoadedMemoryDraft("local edit", "server value", false)).toBe("server value");
  });

  it("keeps a submitted draft until the SDK reports success or error", () => {
    expect(resolvePendingDraftAction("ready", false, false)).toBe("keep");
    expect(resolvePendingDraftAction("submitted", false, false)).toBe("keep");
    expect(resolvePendingDraftAction("error", true, true)).toBe("restore");
    expect(resolvePendingDraftAction("ready", false, true)).toBe("clear");
  });

  it("retries from the latest user turn without treating an assistant error as the source", () => {
    expect(findRetrySourceMessageId([
      { id: "user-1", role: "user" },
      { id: "assistant-1", role: "assistant" },
      { id: "user-2", role: "user" },
    ])).toBe("user-2");
    expect(findRetrySourceMessageId([{ id: "assistant-1", role: "assistant" }])).toBeUndefined();
  });

  it("keeps the waiting state until the current turn has visible assistant output", () => {
    expect(hasVisibleAssistantOutputAfterLatestUser([
      { role: "assistant", parts: [{ type: "text", text: "previous reply" }] },
      { role: "user", parts: [{ type: "text", text: "new request" }] },
    ])).toBe(false);
    expect(hasVisibleAssistantOutputAfterLatestUser([
      { role: "user", parts: [{ type: "text", text: "new request" }] },
      { role: "assistant", parts: [{ type: "text", text: "first visible chunk" }] },
    ])).toBe(true);
    expect(hasVisibleAssistantOutputAfterLatestUser([
      { role: "user", parts: [{ type: "text", text: "new request" }] },
      { role: "assistant", parts: [{ type: "reasoning", text: "visible reasoning" }] },
    ])).toBe(true);
    expect(hasVisibleAssistantOutputAfterLatestUser([
      { role: "user", parts: [{ type: "text", text: "new request" }] },
      { role: "assistant", parts: [{ type: "dynamic-tool", state: "approval-requested" }] },
    ])).toBe(true);
  });

  it("derives every turn phase from SDK state and visible message parts", () => {
    const userMessage = { role: "user", parts: [{ type: "text", text: "request" }] };
    const visibleMessages = [
      userMessage,
      { role: "assistant", parts: [{ type: "text", text: "response" }] },
    ];
    const phase = (overrides: Partial<Parameters<typeof resolveTurnPhase>[0]> = {}) => resolveTurnPhase({
      status: "ready",
      isStreaming: false,
      isRecovering: false,
      hasError: false,
      stopped: false,
      messages: [],
      ...overrides,
    });

    expect(phase()).toBe("idle");
    expect(phase({ status: "submitted", messages: [userMessage] })).toBe("submitted");
    expect(phase({ status: "streaming", isStreaming: true, messages: [userMessage] })).toBe("waiting-first-output");
    expect(phase({ status: "streaming", isStreaming: true, messages: visibleMessages })).toBe("streaming");
    expect(phase({
      status: "streaming",
      isStreaming: true,
      messages: [userMessage, { role: "assistant", parts: [{ type: "dynamic-tool", state: "input-available" }] }],
    })).toBe("tool-running");
    expect(phase({ isRecovering: true, messages: visibleMessages })).toBe("recovering");
    expect(phase({ messages: visibleMessages })).toBe("completed");
    expect(phase({ stopped: true, messages: visibleMessages })).toBe("stopped");
    expect(phase({ status: "error", hasError: true, messages: [userMessage] })).toBe("failed");

    const activePhases: TurnPhase[] = ["submitted", "waiting-first-output", "streaming", "tool-running", "recovering"];
    expect(activePhases.every(isActiveTurnPhase)).toBe(true);
    expect(["idle", "completed", "stopped", "failed"].some((value) => isActiveTurnPhase(value as TurnPhase))).toBe(false);
  });

  it("detects pending approval only in the current user turn", () => {
    expect(hasPendingToolApprovalAfterLatestUser([
      { role: "assistant", parts: [{ type: "dynamic-tool", state: "approval-requested" }] },
      { role: "user", parts: [{ type: "text", text: "new request" }] },
    ])).toBe(false);
    expect(hasPendingToolApprovalAfterLatestUser([
      { role: "user", parts: [{ type: "text", text: "new request" }] },
      { role: "assistant", parts: [{ type: "dynamic-tool", state: "approval-requested" }] },
    ])).toBe(true);
  });

  it("centralizes role, phase, route, failure, approval, and online action availability", () => {
    const availability = (overrides: Partial<Parameters<typeof resolveMessageActionAvailability>[0]> = {}) => (
      resolveMessageActionAvailability({
        phase: "completed",
        role: "user",
        isLatestMessage: true,
        online: true,
        blocked: false,
        routeAvailable: true,
        messageActionsEnabled: true,
        feedbackEnabled: true,
        hasText: true,
        canContinue: false,
        toolApprovalPending: false,
        ...overrides,
      })
    );

    expect(availability()).toEqual({
      copy: "enabled",
      edit: "enabled",
      resend: "enabled",
      regenerate: "hidden",
      continue: "hidden",
      branch: "enabled",
      feedback: "hidden",
      approveTool: "hidden",
      retry: "hidden",
    });
    expect(availability({ role: "assistant", canContinue: true })).toMatchObject({
      copy: "enabled",
      edit: "hidden",
      resend: "hidden",
      regenerate: "enabled",
      continue: "enabled",
      branch: "enabled",
      feedback: "enabled",
    });
    expect(availability({ role: "assistant", canContinue: true, routeAvailable: false })).toMatchObject({
      copy: "enabled",
      regenerate: "disabled",
      continue: "disabled",
      branch: "enabled",
      feedback: "disabled",
    });
    expect(availability({ phase: "streaming" })).toMatchObject({
      copy: "enabled",
      edit: "disabled",
      resend: "disabled",
      branch: "disabled",
    });
    expect(availability({
      phase: "tool-running",
      role: "assistant",
      toolApprovalPending: true,
    })).toMatchObject({ approveTool: "enabled", regenerate: "disabled", feedback: "disabled" });
    expect(availability({
      phase: "tool-running",
      role: "assistant",
      toolApprovalPending: true,
      online: false,
    })).toMatchObject({ copy: "enabled", approveTool: "disabled", branch: "disabled" });
    expect(availability({ phase: "failed" })).toMatchObject({ retry: "enabled", edit: "enabled" });
    expect(availability({ phase: "failed", isLatestMessage: false })).toMatchObject({ retry: "hidden" });
    expect(availability({ phase: "failed", blocked: true })).toMatchObject({ retry: "disabled", edit: "disabled", copy: "enabled" });
    expect(availability({ messageActionsEnabled: false, role: "assistant", feedbackEnabled: false })).toMatchObject({
      regenerate: "hidden",
      continue: "hidden",
      branch: "hidden",
      feedback: "hidden",
    });
  });

  it("turns structured Agent failures into actionable messages", () => {
    expect(friendlyAgentError(JSON.stringify({
      error: "agent_identity_unavailable",
    }), true)).toBe("Agent 会话身份已失效，请刷新页面重新连接。");
    expect(friendlyAgentError(JSON.stringify({
      error: "agent_context_invalid",
    }), true)).toBe("工具续接上下文无法恢复，请刷新页面后重试。");
    expect(friendlyAgentError(JSON.stringify({ error: "provider_busy" }), true))
      .toBe("当前模型的可用线路都在忙，请稍后重试或切换模型。");
    expect(resolveAgentError(JSON.stringify({
      error: "provider_busy",
      message: "当前模型的可用线路都在忙，请稍后重试或切换模型。",
      requestId: "turn_request-123",
    }), true)).toEqual({
      message: "当前模型的可用线路都在忙，请稍后重试或切换模型。",
      requestId: "turn_request-123",
    });
    expect(friendlyAgentError(JSON.stringify({
      error: "user_api_key_required",
    }), true)).toBe("当前模型需要额外凭据，请切换模型或联系管理员。");
    expect(friendlyAgentError(JSON.stringify({
      error: "upstream_authentication_failed",
    }), true)).toBe("模型线路凭据不可用，请切换模型或联系管理员。");
    expect(friendlyAgentError(JSON.stringify({
      error: "agent_identity_unavailable",
      message: "private runtime detail",
    }), true)).toBe("本轮任务暂时失败，可以稍后重试。");
    expect(friendlyAgentError(JSON.stringify({
      error: "unknown_failure",
      message: "raw provider payload",
    }), true)).toBe("本轮任务暂时失败，可以稍后重试。");
    expect(friendlyAgentError('{"error":"upstream_error","providerId":"private-provider"}', true))
      .toBe("本轮任务暂时失败，可以稍后重试。");
    expect(resolveAgentError('{"error":"upstream_error","requestId":"private provider"}', true))
      .toEqual({ message: "本轮任务暂时失败，可以稍后重试。" });
    expect(resolveAgentError(JSON.stringify({ error: "provider_busy", requestId: "turn_request-123" }), false))
      .toEqual({ message: "网络已断开，草稿仍保存在当前设备。", requestId: "turn_request-123" });
    expect(friendlyAgentError("timeout", false)).toBe("网络已断开，草稿仍保存在当前设备。");
  });

  it("routes only the nested React admin shell to the typed administration surface", () => {
    expect(resolveClientSurface("/react-chat/admin")).toBe("admin");
    expect(resolveClientSurface("/react-chat/admin/")).toBe("admin");
    expect(resolveClientSurface("/react-chat/")).toBe("chat");
    expect(resolveClientSurface("/admin")).toBe("chat");
  });
});
