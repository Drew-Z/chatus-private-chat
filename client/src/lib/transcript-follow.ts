import { useCallback, useEffect, useRef, type RefObject } from "react";

export const TRANSCRIPT_FOLLOW_THRESHOLD_PX = 140;

type FrameScheduler = {
  schedule: (callback: () => void) => void;
  cancel: () => void;
};

export function createFrameScheduler(
  requestFrame: (callback: FrameRequestCallback) => number,
  cancelFrame: (handle: number) => void,
): FrameScheduler {
  let pendingFrame: number | null = null;
  let latestCallback: (() => void) | null = null;
  return {
    schedule(callback) {
      latestCallback = callback;
      if (pendingFrame !== null) return;
      pendingFrame = requestFrame(() => {
        pendingFrame = null;
        const run = latestCallback;
        latestCallback = null;
        run?.();
      });
    },
    cancel() {
      if (pendingFrame !== null) cancelFrame(pendingFrame);
      pendingFrame = null;
      latestCallback = null;
    },
  };
}

export function isTranscriptNearBottom(
  container: Pick<HTMLElement, "scrollHeight" | "scrollTop" | "clientHeight">,
  threshold = TRANSCRIPT_FOLLOW_THRESHOLD_PX,
): boolean {
  return container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
}

export function resolveTranscriptFollowing({
  following,
  previousScrollTop,
  container,
}: {
  following: boolean;
  previousScrollTop: number;
  container: Pick<HTMLElement, "scrollHeight" | "scrollTop" | "clientHeight">;
}): boolean {
  if (isTranscriptNearBottom(container)) return true;
  if (container.scrollTop < previousScrollTop) return false;
  return following;
}

export function useTranscriptFollow({
  conversationId,
  followKey,
  active,
}: {
  conversationId: string;
  followKey: unknown;
  active: boolean;
}): {
  messageListRef: RefObject<HTMLDivElement | null>;
  endRef: RefObject<HTMLDivElement | null>;
  trackTranscriptScroll: () => void;
} {
  const messageListRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const followingRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  const activeRef = useRef(active);
  const schedulerRef = useRef<FrameScheduler | null>(null);
  activeRef.current = active;
  if (!schedulerRef.current) {
    schedulerRef.current = createFrameScheduler(
      (callback) => window.requestAnimationFrame(callback),
      (handle) => window.cancelAnimationFrame(handle),
    );
  }

  const scheduleFollow = useCallback(() => {
    if (!followingRef.current) return;
    schedulerRef.current?.schedule(() => {
      if (!followingRef.current) return;
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      endRef.current?.scrollIntoView({
        block: "end",
        behavior: activeRef.current || reducedMotion ? "auto" : "smooth",
      });
    });
  }, []);

  useEffect(() => {
    followingRef.current = true;
    lastScrollTopRef.current = messageListRef.current?.scrollTop ?? 0;
    scheduleFollow();
  }, [conversationId, scheduleFollow]);

  useEffect(() => {
    scheduleFollow();
  }, [active, followKey, scheduleFollow]);

  useEffect(() => () => schedulerRef.current?.cancel(), []);

  const trackTranscriptScroll = useCallback(() => {
    const container = messageListRef.current;
    if (!container) return;
    followingRef.current = resolveTranscriptFollowing({
      following: followingRef.current,
      previousScrollTop: lastScrollTopRef.current,
      container,
    });
    lastScrollTopRef.current = container.scrollTop;
  }, []);

  return { messageListRef, endRef, trackTranscriptScroll };
}
