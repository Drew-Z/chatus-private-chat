import { describe, expect, it } from "vitest";
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
});
