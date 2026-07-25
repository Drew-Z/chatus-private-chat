import { describe, expect, it } from "vitest";
import { friendlyAgentError } from "../client/src/lib/agent-errors";
import {
  findRetrySourceMessageId,
  hasVisibleAssistantTextAfterLatestUser,
  restoreRejectedDraft,
  resolveLoadedMemoryDraft,
  resolvePendingDraftAction,
} from "../client/src/lib/state";
import { resolveClientSurface } from "../client/src/lib/routing";

describe("React client state recovery", () => {
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

  it("keeps the waiting state until the current turn has visible assistant text", () => {
    expect(hasVisibleAssistantTextAfterLatestUser([
      { role: "assistant", parts: [{ type: "text", text: "previous reply" }] },
      { role: "user", parts: [{ type: "text", text: "new request" }] },
    ])).toBe(false);
    expect(hasVisibleAssistantTextAfterLatestUser([
      { role: "user", parts: [{ type: "text", text: "new request" }] },
      { role: "assistant", parts: [{ type: "text", text: "first visible chunk" }] },
    ])).toBe(true);
  });

  it("turns structured Agent failures into actionable messages", () => {
    expect(friendlyAgentError(JSON.stringify({
      error: "agent_identity_unavailable",
      message: "Agent identity is unavailable.",
    }), true)).toBe("Agent 会话身份已失效，请刷新页面重新连接。");
    expect(friendlyAgentError(JSON.stringify({
      error: "agent_context_invalid",
      message: "工具续接上下文无法恢复。",
    }), true)).toBe("工具续接上下文无法恢复。");
    expect(friendlyAgentError("timeout", false)).toBe("网络已断开，草稿仍保存在当前设备。");
  });

  it("routes only the nested React admin shell to the typed administration surface", () => {
    expect(resolveClientSurface("/react-chat/admin")).toBe("admin");
    expect(resolveClientSurface("/react-chat/admin/")).toBe("admin");
    expect(resolveClientSurface("/react-chat/")).toBe("chat");
    expect(resolveClientSurface("/admin")).toBe("chat");
  });
});
