import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateLegacySurfaceCensus } from "./legacy-census-contract.mjs";

export const CHAT_POST_SURFACE_ID = "legacy.api.chat-post";
export const CHAT_POST_CALLER_CLASSES = ["browser", "test", "worker_api"];

export function evaluateProductionLegacyCensus(payload, expected) {
  const {
    surfaceId,
    days,
    expectedDeploymentSha,
    allowedCallerClasses,
    maximumTotalCount,
  } = expected;
  assert(/^[a-f0-9]{40}$/.test(expectedDeploymentSha), "census gate: invalid expected deployment SHA");
  assert(Array.isArray(allowedCallerClasses), "census gate: invalid caller classes");
  assert(
    Number.isSafeInteger(maximumTotalCount) && maximumTotalCount >= 0,
    "census gate: invalid maximum total count",
  );

  const census = validateLegacySurfaceCensus(payload, { surfaceId, days });
  const allowedCallers = new Set(allowedCallerClasses);
  assert(allowedCallers.size === allowedCallerClasses.length, "census gate: duplicate caller classes");
  let totalCount = 0;
  let unknownCallerRows = 0;
  let deploymentMismatchRows = 0;
  for (const row of census.rows) {
    totalCount += row.count;
    assert(Number.isSafeInteger(totalCount), "census gate: total count overflow");
    if (!allowedCallers.has(row.callerClass)) unknownCallerRows += 1;
    if (row.deploymentSha !== expectedDeploymentSha) deploymentMismatchRows += 1;
  }

  return {
    version: 1,
    surfaceId,
    days,
    rowCount: census.rows.length,
    totalCount,
    unknownCallerRows,
    deploymentMismatchRows,
    maximumTotalCount,
    status: unknownCallerRows > 0 || deploymentMismatchRows > 0 || totalCount > maximumTotalCount
      ? "anomaly"
      : "clear",
  };
}

async function main() {
  assert(process.env.GITHUB_ACTIONS === "true", "Production census gate runs only in GitHub Actions");
  assert(process.env.GITHUB_REF === "refs/heads/main", "Production census gate runs only from main");
  const surfaceId = process.env.LEGACY_SURFACE_ID?.trim() || CHAT_POST_SURFACE_ID;
  assert(surfaceId === CHAT_POST_SURFACE_ID, "Production census gate supports only legacy.api.chat-post");
  const days = Number(process.env.CENSUS_DAYS || 30);
  const expectedDeploymentSha = process.env.EXPECTED_RELEASE_SHA?.trim() || process.env.GITHUB_SHA?.trim() || "";
  const maximumTotalCount = Number(process.env.MAX_CENSUS_TOTAL_COUNT || 0);
  const inputPath = resolve(process.env.CENSUS_INPUT?.trim() || "artifacts/legacy-surface-census/census.json");
  const payload = JSON.parse(await readFile(inputPath, "utf8"));
  const summary = evaluateProductionLegacyCensus(payload, {
    surfaceId,
    days,
    expectedDeploymentSha,
    allowedCallerClasses: CHAT_POST_CALLER_CLASSES,
    maximumTotalCount,
  });
  console.log(JSON.stringify(summary));
  if (summary.status === "anomaly") {
    throw new Error(
      `Production legacy census anomaly: total=${summary.totalCount}/${summary.maximumTotalCount}, `
      + `unknownCallerRows=${summary.unknownCallerRows}, deploymentMismatchRows=${summary.deploymentMismatchRows}`,
    );
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
