import { describe, expect, it } from "vitest";
import {
  availabilityConfidenceLabel,
  availabilityPresentation,
} from "../client/src/components/ModelAvailabilityBadge";
import type { MemberModelAvailability } from "../client/src/lib/api";

type AvailabilityRoute = MemberModelAvailability["routes"][number];

const baseRoute: AvailabilityRoute = {
  routeId: "fixture-route",
  label: "Fixture route",
  model: "fixture-model",
  status: "healthy",
  confidence: "recent",
  speed: "normal",
  observedAt: 1_700_000_000_000,
  fallbackRecentlyUsed: false,
  message: "healthy",
};

describe("member model availability presentation", () => {
  it("distinguishes no observation and an active refresh", () => {
    expect(availabilityPresentation()).toMatchObject({ label: "暂无观测", tone: "unknown" });
    expect(availabilityPresentation({ ...baseRoute, status: "unknown", observedAt: null })).toMatchObject({ label: "暂无观测", tone: "unknown" });
    expect(availabilityPresentation(baseRoute, true)).toMatchObject({ label: "正在更新", tone: "refreshing" });
  });

  it("keeps degraded and unavailable states primary while exposing confidence language", () => {
    expect(availabilityPresentation({ ...baseRoute, status: "degraded", confidence: "limited" })).toMatchObject({ label: "有波动", tone: "degraded" });
    expect(availabilityPresentation({ ...baseRoute, status: "unavailable" })).toMatchObject({ label: "暂不可用", tone: "unavailable" });
    expect(availabilityPresentation({ ...baseRoute, confidence: "limited" })).toMatchObject({ label: "样本较少", tone: "limited" });
    expect(availabilityPresentation({ ...baseRoute, confidence: "stale" })).toMatchObject({ label: "状态已过期", tone: "stale" });
    expect(availabilityConfidenceLabel("recent")).toBe("近期观测");
    expect(availabilityConfidenceLabel("limited")).toBe("样本较少");
    expect(availabilityConfidenceLabel("stale")).toBe("状态已过期");
  });
});
