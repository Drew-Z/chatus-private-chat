import { describe, expect, it } from "vitest";
import { buildAdminReportCsv } from "../public/admin-report.js";

describe("buildAdminReportCsv", () => {
  it("exports operational fields without sensitive configuration", () => {
    const csv = buildAdminReportCsv({
      day: "2026-07-13",
      trend: [{ day: "2026-07-13", requests: 10, errors: 1, errorRate: 10, fallbacks: 2, rateLimited: 0 }],
      routeStats: [{ id: "line-a", label: "主,线路", model: "model-a", ok7d: 9, error7d: 1, errorRate7d: 10 }],
      users: [{
        label: "friend", displayName: "朋友", enabled: true, used: 10, dailyLimit: 500, remaining: 490,
        defaultRoute: "line-a", allowedRoutes: ["line-a"], allowBringYourOwnKey: false, activeSessions: 1,
        memoryChars: 20, requests7d: 10, errors7d: 1, errorRate7d: 10,
      }],
    }, new Date("2026-07-13T00:00:00.000Z"));

    expect(csv).toContain('line-a,"主,线路",model-a,9,1,10');
    expect(csv).toContain("friend,朋友,启用,10,500,490,line-a,1,否,1,20,10,1,10");
    expect(csv).not.toMatch(/apiKey|baseUrl|systemPrompt|memory[^C]/i);
  });
});
