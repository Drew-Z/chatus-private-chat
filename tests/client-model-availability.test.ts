import { describe, expect, it } from "vitest";
import type { MemberModelAvailability } from "../client/src/lib/api";
import {
  beginModelAvailabilityRefresh,
  completeModelAvailabilityRefresh,
  createModelAvailabilityViewState,
  failModelAvailabilityRefresh,
} from "../client/src/lib/model-availability";

const projection: MemberModelAvailability = {
  version: 1,
  generatedAt: 1_700_000_000_000,
  window: "24h",
  routes: [{
    routeId: "balanced",
    status: "healthy",
    speed: "normal",
    samples: 3,
    fallbackRecentlyUsed: false,
    message: "healthy",
  }],
};

describe("member model availability view state", () => {
  it("represents initial loading and a successful result", () => {
    const loading = createModelAvailabilityViewState();
    expect(loading).toEqual({ status: "loading", data: null, refreshing: true, error: "" });
    expect(completeModelAvailabilityRefresh(projection)).toEqual({
      status: "success",
      data: projection,
      refreshing: false,
      error: "",
    });
  });

  it("distinguishes an empty configured projection from failure", () => {
    const empty = completeModelAvailabilityRefresh({ ...projection, routes: [] });
    expect(empty.status).toBe("empty");
    expect(empty.data?.routes).toEqual([]);
    expect(empty.error).toBe("");
  });

  it("exposes an initial error and starts a clean retry", () => {
    const failed = failModelAvailabilityRefresh(createModelAvailabilityViewState(), "读取失败");
    expect(failed).toEqual({ status: "error", data: null, refreshing: false, error: "读取失败" });
    expect(beginModelAvailabilityRefresh(failed)).toEqual({
      status: "loading",
      data: null,
      refreshing: true,
      error: "",
    });
  });

  it("keeps the last successful projection when refresh fails", () => {
    const ready = completeModelAvailabilityRefresh(projection);
    const stale = failModelAvailabilityRefresh(beginModelAvailabilityRefresh(ready), "暂时无法更新");
    expect(stale.status).toBe("stale");
    expect(stale.data).toBe(projection);
    expect(stale.error).toBe("暂时无法更新");
    expect(stale.refreshing).toBe(false);
  });
});
