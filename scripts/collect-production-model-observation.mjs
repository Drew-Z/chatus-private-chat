import { execFile as execFileCallback } from "node:child_process";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const HOUR_MS = 60 * 60 * 1_000;
const WINDOW_MS = 24 * HOUR_MS;
const BUCKET_COUNT = 24;
const GROUP_LIMIT = 500;
const RUN_KIND_LIMIT = 7;
const FAILURE_CLASS_LIMIT = 9;
const REQUEST_TIMEOUT_MS = 15_000;
const RUN_KINDS = new Set([
  "main_answer",
  "automatic_skill",
  "memory_suggestion",
  "conversation_summary",
  "model_discovery",
  "tool_continuation",
  "legacy_capability",
]);
const FAILURE_CLASSES = new Set([
  "provider_busy",
  "upstream_timeout",
  "upstream_rate_limited",
  "upstream_authentication_failed",
  "upstream_request_rejected",
  "provider_protocol_error",
  "upstream_unavailable",
  "upstream_error",
  "request_cancelled",
]);

export function isModelMonitorSnapshot(value) {
  if (!isRecord(value)
    || !hasExactKeys(value, [
      "version",
      "window",
      "generatedAt",
      "periodStart",
      "periodEnd",
      "totals",
      "trend",
      "routes",
      "providers",
      "models",
      "runKinds",
      "failureClasses",
    ])
    || value.version !== 1
    || value.window !== "24h"
    || !isNonNegativeInteger(value.generatedAt)
    || !isNonNegativeInteger(value.periodStart)
    || !isNonNegativeInteger(value.periodEnd)
    || value.periodEnd - value.periodStart !== WINDOW_MS
    || value.generatedAt !== value.periodEnd) return false;

  const { periodStart, periodEnd, totals, trend, routes, providers, models, runKinds, failureClasses } = value;
  if (!isModelMonitorTotals(totals)
    || !Array.isArray(trend)
    || trend.length !== BUCKET_COUNT
    || !trend.every((item, index) => isModelMonitorTrend(item, periodStart, periodEnd, index))
    || !isBoundedGroupArray(routes, GROUP_LIMIT)
    || !isBoundedGroupArray(providers, GROUP_LIMIT)
    || !isBoundedGroupArray(models, GROUP_LIMIT)
    || !Array.isArray(runKinds)
    || runKinds.length > RUN_KIND_LIMIT
    || !runKinds.every(isModelMonitorRunKind)
    || !Array.isArray(failureClasses)
    || failureClasses.length > FAILURE_CLASS_LIMIT
    || !failureClasses.every(isModelMonitorFailureClass)) return false;

  const unique = [routes, providers, models].every((groups) => hasUniqueIds(groups))
    && hasUniqueIds(trend, "bucketStart")
    && hasUniqueIds(runKinds, "runKind")
    && hasUniqueIds(failureClasses, "errorClass");
  return unique
    && monitorCountsMatch(totals, trend)
    && monitorCountsMatch(totals, routes)
    && monitorCountsMatch(totals, providers)
    && monitorCountsMatch(totals, models)
    && monitorCountsMatch(totals, runKinds)
    && failureClasses.reduce((sum, item) => sum + item.count, 0) === totals.failures;
}

export function summarizeModelMonitorSnapshot(snapshot, metadata) {
  assert(isModelMonitorSnapshot(snapshot), "model monitor response is invalid");
  return {
    schemaVersion: 1,
    kind: "chatus-model-monitor-observation",
    status: "passed",
    deployedSha: metadata.deployedSha,
    observationStartedAt: new Date(metadata.observationStartedAt).toISOString(),
    observedAt: new Date(metadata.observedAt).toISOString(),
    window: "24h",
    periodStart: snapshot.periodStart,
    periodEnd: snapshot.periodEnd,
    generatedAt: snapshot.generatedAt,
    totals: snapshot.totals,
    reconciliation: {
      trendBuckets: snapshot.trend.length,
      routeGroups: snapshot.routes.length,
      providerGroups: snapshot.providers.length,
      modelGroups: snapshot.models.length,
      runKindGroups: snapshot.runKinds.length,
      failureClassGroups: snapshot.failureClasses.length,
      exact: true,
    },
  };
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
}

function hasOnlyKeys(value, keys) {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isBoundedString(value, maximum) {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function isNullableRate(value) {
  return value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1);
}

function isNullableNonNegativeInteger(value) {
  return value === null || isNonNegativeInteger(value);
}

function isModelMonitorTotals(value) {
  if (!isRecord(value)
    || !hasExactKeys(value, ["attempts", "succeeded", "failures", "inFlight", "completed", "successRate", "fallbacks", "averageLatencyMs"])) return false;
  return isModelMonitorCountFields(value);
}

function isModelMonitorCountFields(value) {
  if (!isRecord(value)) return false;
  const { attempts, succeeded, failures, inFlight, completed, fallbacks } = value;
  if (![attempts, succeeded, failures, inFlight, completed, fallbacks].every(isNonNegativeInteger)
    || attempts !== completed + inFlight
    || completed !== succeeded + failures
    || !isNullableRate(value.successRate)
    || value.successRate !== (completed > 0 ? succeeded / completed : null)
    || !isNullableNonNegativeInteger(value.averageLatencyMs)) return false;
  return true;
}

function isModelMonitorTrend(value, periodStart, periodEnd, index) {
  if (!isRecord(value)
    || !hasExactKeys(value, ["bucketStart", "bucketEnd", "attempts", "succeeded", "failures", "inFlight", "fallbacks"])
    || ![value.bucketStart, value.bucketEnd, value.attempts, value.succeeded, value.failures, value.inFlight, value.fallbacks].every(isNonNegativeInteger)
    || value.bucketStart !== periodStart + index * HOUR_MS
    || value.bucketEnd !== value.bucketStart + HOUR_MS
    || value.bucketStart < periodStart
    || value.bucketEnd > periodEnd
    || value.attempts !== value.succeeded + value.failures + value.inFlight) return false;
  return true;
}

function isModelMonitorGroup(value) {
  return isRecord(value)
    && hasOnlyKeys(value, ["id", "label", "model", "attempts", "succeeded", "failures", "inFlight", "completed", "successRate", "fallbacks", "averageLatencyMs"])
    && isBoundedString(value.id, 200)
    && isBoundedString(value.label, 300)
    && (value.model === undefined || isBoundedString(value.model, 200))
    && isModelMonitorCountFields(value);
}

function isBoundedGroupArray(value, limit) {
  return Array.isArray(value) && value.length <= limit && value.every(isModelMonitorGroup);
}

function isModelMonitorRunKind(value) {
  return isRecord(value)
    && hasExactKeys(value, ["runKind", "attempts", "succeeded", "failures", "inFlight", "completed", "successRate", "fallbacks", "averageLatencyMs"])
    && RUN_KINDS.has(value.runKind)
    && isModelMonitorCountFields(value);
}

function isModelMonitorFailureClass(value) {
  return isRecord(value)
    && hasExactKeys(value, ["errorClass", "count"])
    && FAILURE_CLASSES.has(value.errorClass)
    && isNonNegativeInteger(value.count)
    && value.count > 0;
}

function hasUniqueIds(values, key = "id") {
  const ids = values.map((value) => value[key]);
  return new Set(ids).size === ids.length;
}

function monitorCountsMatch(totals, rows) {
  return rows.reduce((sum, row) => sum + row.attempts, 0) === totals.attempts
    && rows.reduce((sum, row) => sum + row.succeeded, 0) === totals.succeeded
    && rows.reduce((sum, row) => sum + row.failures, 0) === totals.failures
    && rows.reduce((sum, row) => sum + row.inFlight, 0) === totals.inFlight
    && rows.reduce((sum, row) => sum + row.fallbacks, 0) === totals.fallbacks;
}

async function main() {
  const productionUrl = process.env.PRODUCTION_URL?.trim() || "";
  const adminToken = process.env.ADMIN_TOKEN?.trim() || "";
  const expectedMainSha = process.env.EXPECTED_MAIN_SHA?.trim() || process.env.GITHUB_SHA?.trim() || "";
  const expectedReleaseSha = process.env.EXPECTED_RELEASE_SHA?.trim() || "";
  const observationStartedAt = Date.parse(process.env.OBSERVATION_STARTED_AT?.trim() || "");
  const outputPath = resolve(process.env.OBSERVATION_OUTPUT?.trim() || "artifacts/production-model-observation/observation.json");

  assert(process.env.GITHUB_ACTIONS === "true", "Production model observation runs only in GitHub Actions");
  assert(process.env.GITHUB_REF === "refs/heads/main", "Production model observation runs only from main");
  assert(productionUrl, "PRODUCTION_URL is required");
  assert(adminToken, "ADMIN_TOKEN is required");
  assert(/^[a-f0-9]{40}$/.test(expectedMainSha), "EXPECTED_MAIN_SHA must be a lowercase 40-character commit SHA");
  assert(/^[a-f0-9]{40}$/.test(expectedReleaseSha), "EXPECTED_RELEASE_SHA must be a lowercase 40-character commit SHA");
  assert(Number.isSafeInteger(observationStartedAt), "OBSERVATION_STARTED_AT must be an ISO timestamp");
  assert(Date.now() >= observationStartedAt + WINDOW_MS, "24-hour observation window is not complete");

  const baseUrl = new URL(productionUrl);
  assert(baseUrl.protocol === "https:", "Production model observation requires HTTPS");
  const request = async (path, { cookie = "", method = "GET", body } = {}) => {
    const headers = new Headers();
    if (cookie) headers.set("Cookie", cookie);
    if (body !== undefined) headers.set("Content-Type", "application/json");
    return fetch(new URL(path, baseUrl), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  };
  const readJson = async (response, operation) => {
    if (response.status !== 200) throw new Error(`${operation}: expected HTTP 200, got ${response.status}`);
    try {
      return await response.json();
    } catch {
      throw new Error(`${operation}: response was not JSON`);
    }
  };
  const cookieFromResponse = (response) => {
    const values = typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie") || ""];
    const value = values.find((item) => item.includes("="));
    return value ? value.split(";", 1)[0] : "";
  };
  const readRelease = async (operation) => {
    const payload = await readJson(await request(`/release.json?observation=${Date.now()}`), operation);
    assert(/^[a-f0-9]{40}$/.test(payload.commit), `${operation}: invalid deployed commit`);
    return payload.commit;
  };

  const deployedBefore = await readRelease("verify release before observation");
  assert(deployedBefore === expectedReleaseSha, "verify release before observation: deployed commit mismatch");
  await assertDeployedReleaseIsMainAncestor(deployedBefore, expectedMainSha);

  const login = await request("/api/admin/login", { method: "POST", body: { token: adminToken } });
  const loginPayload = await readJson(login, "admin login");
  assert(loginPayload.authenticated === true, "admin login: authentication failed");
  const cookie = cookieFromResponse(login);
  assert(cookie, "admin login: session cookie missing");

  let snapshot;
  let primaryError;
  try {
    snapshot = await readJson(
      await request("/api/admin/model-monitor?window=24h&bucket=hour", { cookie }),
      "read model monitor",
    );
    assert(isModelMonitorSnapshot(snapshot), "read model monitor: invalid or unreconciled snapshot");
  } catch (error) {
    primaryError = error;
  } finally {
    try {
      await readJson(await request("/api/admin/logout", { cookie, method: "POST" }), "admin logout");
    } catch (error) {
      primaryError = primaryError || error;
    }
  }
  if (primaryError) throw primaryError;

  const observedAt = Date.now();
  assert(observedAt >= observationStartedAt + WINDOW_MS, "observation completed before the 24-hour window");
  const deployedAfter = await readRelease("verify release after observation");
  assert(deployedAfter === deployedBefore, "verify release after observation: deployed commit changed");
  const summary = summarizeModelMonitorSnapshot(snapshot, {
    deployedSha: deployedBefore,
    observationStartedAt,
    observedAt,
  });
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  const githubOutput = process.env.GITHUB_OUTPUT?.trim() || "";
  assert(githubOutput, "GITHUB_OUTPUT is required");
  await appendFile(githubOutput, `deployed_sha=${deployedBefore}\nobserved_at=${summary.observedAt}\n`, "utf8");
  console.log(`model observation passed: attempts=${summary.totals.attempts}, completed=${summary.totals.completed}, failures=${summary.totals.failures}, successRate=${summary.totals.successRate ?? "unknown"}`);
}

async function assertDeployedReleaseIsMainAncestor(deployedSha, mainSha) {
  try {
    await execFile("git", ["merge-base", "--is-ancestor", deployedSha, mainSha], { windowsHide: true });
  } catch (error) {
    if (error && typeof error === "object" && error.code === 1) {
      throw new Error("verify release: deployed commit is not a main ancestor");
    }
    throw new Error("verify release: git ancestry check failed");
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
