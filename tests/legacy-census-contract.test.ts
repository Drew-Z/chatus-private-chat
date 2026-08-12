import { describe, expect, it } from "vitest";
import { validateLegacySurfaceCensus } from "../scripts/legacy-census-contract.mjs";

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
});
