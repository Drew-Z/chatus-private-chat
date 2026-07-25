import { describe, expect, it } from "vitest";
import { resizeComposerTextarea } from "../client/src/components/MessageComposer";

describe("React composer sizing", () => {
  it("grows to content and switches to local scrolling at the cap", () => {
    const style: Record<string, string> = {};
    const element = { style, scrollHeight: 240 } as unknown as HTMLTextAreaElement;
    expect(resizeComposerTextarea(element, 180)).toBe(180);
    expect(style.height).toBe("180px");
    expect(style.overflowY).toBe("auto");
  });

  it("keeps the single-line minimum without a scrollbar", () => {
    const style: Record<string, string> = {};
    const element = { style, scrollHeight: 20 } as unknown as HTMLTextAreaElement;
    expect(resizeComposerTextarea(element, 180)).toBe(42);
    expect(style.height).toBe("42px");
    expect(style.overflowY).toBe("hidden");
  });
});
