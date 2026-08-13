import { describe, expect, it } from "vitest";
import { validateLegacySurfaceCensus } from "../scripts/legacy-census-contract.mjs";
import {
  assertDeployedReleaseSha,
  assertUnchangedDeployedReleaseSha,
} from "../scripts/collect-production-legacy-census.mjs";
import {
  BROWSER_SHELL_CALLER_CLASSES,
  BROWSER_SHELL_SURFACE_ID,
  CHAT_POST_CALLER_CLASSES,
  CHAT_POST_SURFACE_ID,
  CLOUD_CHATS_CALLER_CLASSES,
  CLOUD_CHATS_SURFACE_ID,
  evaluateProductionLegacyCensus,
  resolveProductionLegacyCensusPolicy,
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
  it("requires exact main manually and permits only deployed ancestors on schedule", async () => {
    const deployedSha = "a".repeat(40);
    const expectedMainSha = "b".repeat(40);
    await expect(assertDeployedReleaseSha({
      deployedSha: expectedMainSha,
      expectedMainSha,
      allowDeployedAncestor: false,
    })).resolves.toBe(expectedMainSha);
    await expect(assertDeployedReleaseSha({
      deployedSha,
      expectedMainSha,
      allowDeployedAncestor: false,
      isAncestor: async () => true,
    })).rejects.toThrow("deployed commit mismatch");
    await expect(assertDeployedReleaseSha({
      deployedSha,
      expectedMainSha,
      allowDeployedAncestor: true,
      isAncestor: async () => true,
    })).resolves.toBe(deployedSha);
    await expect(assertDeployedReleaseSha({
      deployedSha,
      expectedMainSha,
      allowDeployedAncestor: true,
      isAncestor: async () => false,
    })).rejects.toThrow("not a main ancestor");
    expect(assertUnchangedDeployedReleaseSha(deployedSha, deployedSha)).toBe(deployedSha);
    expect(() => assertUnchangedDeployedReleaseSha(deployedSha, expectedMainSha))
      .toThrow("deployed commit changed");
  });

  it("keeps gated caller classes aligned with the code-owned manifest", () => {
    const chatPost = LEGACY_SURFACE_MANIFEST.find(({ surfaceId }) => surfaceId === CHAT_POST_SURFACE_ID);
    const browserShell = LEGACY_SURFACE_MANIFEST.find(({ surfaceId }) => surfaceId === BROWSER_SHELL_SURFACE_ID);
    const cloudChats = LEGACY_SURFACE_MANIFEST.find(({ surfaceId }) => surfaceId === CLOUD_CHATS_SURFACE_ID);
    expect(chatPost?.callerClasses).toEqual(CHAT_POST_CALLER_CLASSES);
    expect(browserShell?.callerClasses).toEqual(BROWSER_SHELL_CALLER_CLASSES);
    expect(cloudChats?.callerClasses).toEqual(CLOUD_CHATS_CALLER_CLASSES);
  });

  it("binds anomaly policies to each surface's exact observation window", () => {
    expect(resolveProductionLegacyCensusPolicy(CHAT_POST_SURFACE_ID, 30)).toEqual({
      allowedCallerClasses: CHAT_POST_CALLER_CLASSES,
      allowedAccessClasses: ["read", "write"],
      maximumTotalCount: 0,
    });
    expect(resolveProductionLegacyCensusPolicy(BROWSER_SHELL_SURFACE_ID, 14)).toEqual({
      allowedCallerClasses: BROWSER_SHELL_CALLER_CLASSES,
      allowedAccessClasses: ["read"],
      maximumTotalCount: Number.MAX_SAFE_INTEGER,
    });
    expect(() => resolveProductionLegacyCensusPolicy(CHAT_POST_SURFACE_ID, 14))
      .toThrow("no policy");
    expect(() => resolveProductionLegacyCensusPolicy(BROWSER_SHELL_SURFACE_ID, 30))
      .toThrow("no policy");
    expect(resolveProductionLegacyCensusPolicy(CLOUD_CHATS_SURFACE_ID, 30)).toEqual({
      allowedCallerClasses: CLOUD_CHATS_CALLER_CLASSES,
      allowedAccessClasses: ["read", "write"],
      maximumTotalCount: 0,
    });
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
      unexpectedAccessRows: 0,
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

  it("permits declared browser-shell reads and rejects shell writes", () => {
    const shellExpected = {
      surfaceId: BROWSER_SHELL_SURFACE_ID,
      days: 14,
      expectedDeploymentSha: "a".repeat(40),
      ...resolveProductionLegacyCensusPolicy(BROWSER_SHELL_SURFACE_ID, 14),
    };
    const shellCensus = {
      ...census,
      surfaceId: BROWSER_SHELL_SURFACE_ID,
      days: 14,
      rows: [{ ...census.rows[0], callerClass: "service_worker", access: "read" }],
    };
    expect(evaluateProductionLegacyCensus(shellCensus, shellExpected)).toMatchObject({
      totalCount: 2,
      unknownCallerRows: 0,
      unexpectedAccessRows: 0,
      deploymentMismatchRows: 0,
      status: "clear",
    });
    expect(evaluateProductionLegacyCensus({
      ...shellCensus,
      rows: [{ ...shellCensus.rows[0], access: "write" }],
    }, shellExpected)).toMatchObject({
      unexpectedAccessRows: 1,
      status: "anomaly",
    });
  });

  it("flags unknown callers, access drift, and deployment drift without exposing rows", () => {
    const summary = evaluateProductionLegacyCensus({
      ...census,
      rows: [{ ...census.rows[0], callerClass: "unexpected", deploymentSha: "b".repeat(40) }],
    }, {
      ...expected,
      expectedDeploymentSha: "a".repeat(40),
      allowedCallerClasses: ["browser", "test", "worker_api"],
      allowedAccessClasses: ["read"],
      maximumTotalCount: 10,
    });
    expect(summary).toMatchObject({
      unknownCallerRows: 1,
      unexpectedAccessRows: 1,
      deploymentMismatchRows: 1,
      status: "anomaly",
    });
    expect(summary).not.toHaveProperty("rows");
  });
});
