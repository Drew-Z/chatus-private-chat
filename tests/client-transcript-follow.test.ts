import { describe, expect, it, vi } from "vitest";
import {
  TRANSCRIPT_FOLLOW_THRESHOLD_PX,
  createFrameScheduler,
  isTranscriptNearBottom,
  resolveTranscriptFollowing,
} from "../client/src/lib/transcript-follow";

describe("transcript follow scheduling", () => {
  it("coalesces repeated token updates into one animation frame and keeps the latest callback", () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    let nextHandle = 1;
    const cancel = vi.fn((handle: number) => callbacks.delete(handle));
    const scheduler = createFrameScheduler((callback) => {
      const handle = nextHandle++;
      callbacks.set(handle, callback);
      return handle;
    }, cancel);
    const calls: string[] = [];

    scheduler.schedule(() => calls.push("first"));
    scheduler.schedule(() => calls.push("second"));
    scheduler.schedule(() => calls.push("latest"));
    expect(callbacks.size).toBe(1);

    callbacks.get(1)?.(16);
    expect(calls).toEqual(["latest"]);
    scheduler.schedule(() => calls.push("next-frame"));
    expect(callbacks.size).toBe(2);
    callbacks.get(2)?.(32);
    expect(calls).toEqual(["latest", "next-frame"]);

    scheduler.schedule(() => calls.push("cancelled"));
    scheduler.cancel();
    expect(cancel).toHaveBeenCalledWith(3);
    expect(callbacks.has(3)).toBe(false);
  });

  it("follows only while the viewport remains near the transcript bottom", () => {
    expect(isTranscriptNearBottom({ scrollHeight: 1_000, scrollTop: 761, clientHeight: 100 })).toBe(true);
    expect(isTranscriptNearBottom({ scrollHeight: 1_000, scrollTop: 760, clientHeight: 100 })).toBe(false);
    expect(TRANSCRIPT_FOLLOW_THRESHOLD_PX).toBe(140);
  });

  it("distinguishes explicit upward scrolling from content growth", () => {
    const grown = { scrollHeight: 1_200, scrollTop: 760, clientHeight: 100 };
    expect(resolveTranscriptFollowing({ following: true, previousScrollTop: 760, container: grown })).toBe(true);
    expect(resolveTranscriptFollowing({ following: true, previousScrollTop: 900, container: grown })).toBe(false);
    expect(resolveTranscriptFollowing({
      following: false,
      previousScrollTop: 760,
      container: { scrollHeight: 1_000, scrollTop: 870, clientHeight: 100 },
    })).toBe(true);
  });
});
