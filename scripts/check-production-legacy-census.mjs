import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateLegacySurfaceCensus } from "./legacy-census-contract.mjs";

export const CHAT_POST_SURFACE_ID = "legacy.api.chat-post";
export const CHAT_POST_CALLER_CLASSES = ["browser", "test", "worker_api"];
export const CLOUD_CHATS_SURFACE_ID = "legacy.api.cloud-chats";
export const CLOUD_CHATS_CALLER_CLASSES = ["agent_runtime", "browser", "operator", "test", "worker_api"];
export const BROWSER_SHELL_SURFACE_ID = "legacy.browser.shell";
export const BROWSER_SHELL_CALLER_CLASSES = [
  "browser",
  "deployment",
  "service_worker",
  "test",
  "worker_api",
];

export function resolveProductionLegacyCensusPolicy(surfaceId, days) {
  if (surfaceId === CHAT_POST_SURFACE_ID && days === 30) {
    return {
      allowedCallerClasses: CHAT_POST_CALLER_CLASSES,
      allowedAccessClasses: ["read", "write"],
      maximumTotalCount: 0,
    };
  }
  if (surfaceId === BROWSER_SHELL_SURFACE_ID && days === 14) {
    return {
      allowedCallerClasses: BROWSER_SHELL_CALLER_CLASSES,
      allowedAccessClasses: ["read"],
      maximumTotalCount: Number.MAX_SAFE_INTEGER,
    };
  }
  if (surfaceId === CLOUD_CHATS_SURFACE_ID && days === 30) {
    return {
      allowedCallerClasses: CLOUD_CHATS_CALLER_CLASSES,
      allowedAccessClasses: ["read", "write"],
      maximumTotalCount: 0,
    };
  }
  throw new Error("Production census gate has no policy for this surface and window");
}

export function evaluateProductionLegacyCensus(payload, expected) {
  const {
    surfaceId,
    days,
    expectedDeploymentSha,
    allowedCallerClasses,
    allowedAccessClasses = ["read", "write"],
    maximumTotalCount,
  } = expected;
  assert(/^[a-f0-9]{40}$/.test(expectedDeploymentSha), "census gate: invalid expected deployment SHA");
  assert(Array.isArray(allowedCallerClasses), "census gate: invalid caller classes");
  assert(Array.isArray(allowedAccessClasses), "census gate: invalid access classes");
  assert(
    Number.isSafeInteger(maximumTotalCount) && maximumTotalCount >= 0,
    "census gate: invalid maximum total count",
  );

  const census = validateLegacySurfaceCensus(payload, { surfaceId, days });
  const allowedCallers = new Set(allowedCallerClasses);
  const allowedAccess = new Set(allowedAccessClasses);
  assert(allowedCallers.size === allowedCallerClasses.length, "census gate: duplicate caller classes");
  assert(
    allowedAccess.size === allowedAccessClasses.length
      && [...allowedAccess].every((access) => access === "read" || access === "write"),
    "census gate: invalid access classes",
  );
  let totalCount = 0;
  let unknownCallerRows = 0;
  let unexpectedAccessRows = 0;
  let deploymentMismatchRows = 0;
  for (const row of census.rows) {
    totalCount += row.count;
    assert(Number.isSafeInteger(totalCount), "census gate: total count overflow");
    if (!allowedCallers.has(row.callerClass)) unknownCallerRows += 1;
    if (!allowedAccess.has(row.access)) unexpectedAccessRows += 1;
    if (row.deploymentSha !== expectedDeploymentSha) deploymentMismatchRows += 1;
  }

  return {
    version: 1,
    surfaceId,
    days,
    rowCount: census.rows.length,
    totalCount,
    unknownCallerRows,
    unexpectedAccessRows,
    deploymentMismatchRows,
    maximumTotalCount,
    status: unknownCallerRows > 0
      || unexpectedAccessRows > 0
      || deploymentMismatchRows > 0
      || totalCount > maximumTotalCount
      ? "anomaly"
      : "clear",
  };
}

async function main() {
  assert(process.env.GITHUB_ACTIONS === "true", "Production census gate runs only in GitHub Actions");
  assert(process.env.GITHUB_REF === "refs/heads/main", "Production census gate runs only from main");
  const surfaceId = process.env.LEGACY_SURFACE_ID?.trim() || CHAT_POST_SURFACE_ID;
  const days = Number(process.env.CENSUS_DAYS || 30);
  const expectedDeploymentSha = process.env.EXPECTED_RELEASE_SHA?.trim() || process.env.GITHUB_SHA?.trim() || "";
  const policy = resolveProductionLegacyCensusPolicy(surfaceId, days);
  const inputPath = resolve(process.env.CENSUS_INPUT?.trim() || "artifacts/legacy-surface-census/census.json");
  const payload = JSON.parse(await readFile(inputPath, "utf8"));
  const summary = evaluateProductionLegacyCensus(payload, {
    surfaceId,
    days,
    expectedDeploymentSha,
    ...policy,
  });
  console.log(JSON.stringify(summary));
  if (summary.status === "anomaly") {
    throw new Error(
      `Production legacy census anomaly: total=${summary.totalCount}/${summary.maximumTotalCount}, `
      + `unknownCallerRows=${summary.unknownCallerRows}, unexpectedAccessRows=${summary.unexpectedAccessRows}, `
      + `deploymentMismatchRows=${summary.deploymentMismatchRows}`,
    );
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
