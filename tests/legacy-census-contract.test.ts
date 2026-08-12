import { describe, expect, it } from "vitest";
import { validateLegacySurfaceCensus } from "../scripts/legacy-census-contract.mjs";
import {
  CHAT_POST_CALLER_CLASSES,
  CHAT_POST_SURFACE_ID,
  evaluateProductionLegacyCensus,
} from "../scripts/check-production-legacy-census.mjs";
import { LEGACY_SURFACE_MANIFEST } from "../src/contracts/legacy-surface";

const expected = { surfaceId: "legacy.api.chat-post", days: 30 };
const lastOccurredAt = Date.UTC(2026, 7, 12, 1, 2, 3);
const census = {
  version: 1,
  surfaceId: expected.surfaceId,
  generatedAt: lastOccurredAt + 1,
  days: expected.days,
  rows: [{
    day: "2026-08-12",
    callerClass: "worker_api",
    access: "write",
    count: 2,
    lastOccurredAt,
    deploymentSha: "a".repeat(40),
  }],
};

describe("production legacy census contract", () => {
  it("keeps the scheduled gate caller classes aligned with the code-owned manifest", () => {
    const manifest = LEGACY_SURFACE_MANIFEST.find(({ surfaceId }) => surfaceId === CHAT_POST_SURFACE_ID);
    expect(manifest?.callerClasses).toEqual(CHAT_POST_CALLER_CLASSES);
  });

  it("accepts only canonical content-free census rows", () => {
    expect(validateLegacySurfaceCensus(census, expected)).toEqual(census);
    expect(() => validateLegacySurfaceCensus({ ...census, token: "secret" }, expected))
      .toThrow("invalid top-level fields");
    expect(() => validateLegacySurfaceCensus({
      ...census,
      rows: [{ ...census.rows[0], prompt: "secret" }],
    }, expected)).toThrow("invalid row fields");
    expect(() => validateLegacySurfaceCensus({
      ...census,
      rows: [{ ...census.rows[0], deploymentSha: "A".repeat(40) }],
    }, expected)).toThrow("invalid deployment SHA");
  });

  it("rejects identity drift, duplicates, and non-canonical ordering", () => {
    expect(() => validateLegacySurfaceCensus({ ...census, days: 31 }, expected)).toThrow("identity mismatch");
    expect(() => validateLegacySurfaceCensus({
      ...census,
      rows: [census.rows[0], census.rows[0]],
    }, expected)).toThrow("rows not canonical");
    expect(() => validateLegacySurfaceCensus({
      ...census,
      rows: [
        { ...census.rows[0], access: "write", callerClass: "worker_api" },
        { ...census.rows[0], access: "read", callerClass: "browser" },
      ],
    }, expected)).toThrow("rows not canonical");
  });

  it("summarizes only aggregate anomaly signals", () => {
    expect(evaluateProductionLegacyCensus({ ...census, rows: [] }, {
      ...expected,
      expectedDeploymentSha: "a".repeat(40),
      allowedCallerClasses: ["browser", "test", "worker_api"],
      maximumTotalCount: 0,
    })).toEqual({
      version: 1,
      surfaceId: expected.surfaceId,
      days: expected.days,
      rowCount: 0,
      totalCount: 0,
      unknownCallerRows: 0,
      deploymentMismatchRows: 0,
      maximumTotalCount: 0,
      status: "clear",
    });
    expect(evaluateProductionLegacyCensus(census, {
      ...expected,
      expectedDeploymentSha: "a".repeat(40),
      allowedCallerClasses: ["browser", "test", "worker_api"],
      maximumTotalCount: 0,
    })).toMatchObject({
      rowCount: 1,
      totalCount: 2,
      status: "anomaly",
    });
  });

  it("flags unknown caller classes and deployment drift without exposing rows", () => {
    const summary = evaluateProductionLegacyCensus({
      ...census,
      rows: [{ ...census.rows[0], callerClass: "unexpected", deploymentSha: "b".repeat(40) }],
    }, {
      ...expected,
      expectedDeploymentSha: "a".repeat(40),
      allowedCallerClasses: ["browser", "test", "worker_api"],
      maximumTotalCount: 10,
    });
    expect(summary).toMatchObject({
      unknownCallerRows: 1,
      deploymentMismatchRows: 1,
      status: "anomaly",
    });
    expect(summary).not.toHaveProperty("rows");
  });
});
