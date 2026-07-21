import { describe, expect, it } from "vitest";
import { friendlyAgentError } from "../client/src/lib/agent-errors";
import {
  restoreRejectedDraft,
  resolveLoadedMemoryDraft,
  resolvePendingDraftAction,
} from "../client/src/lib/state";

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
});
