import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { validateLegacySurfaceCensus } from "./legacy-census-contract.mjs";

const productionUrl = process.env.PRODUCTION_URL?.trim() || "";
const adminToken = process.env.ADMIN_TOKEN?.trim() || "";
const expectedReleaseSha = process.env.EXPECTED_RELEASE_SHA?.trim() || process.env.GITHUB_SHA?.trim() || "";
const surfaceId = process.env.LEGACY_SURFACE_ID?.trim() || "legacy.api.chat-post";
const outputPath = resolve(process.env.CENSUS_OUTPUT?.trim() || "artifacts/legacy-surface-census/census.json");
const days = Number(process.env.CENSUS_DAYS || 30);
const requestTimeoutMs = 15_000;

assert(process.env.GITHUB_ACTIONS === "true", "Production census runs only in GitHub Actions");
assert(process.env.GITHUB_REF === "refs/heads/main", "Production census runs only from main");
assert(productionUrl, "PRODUCTION_URL is required");
assert(adminToken, "ADMIN_TOKEN is required");
assert(/^[a-f0-9]{40}$/.test(expectedReleaseSha), "EXPECTED_RELEASE_SHA must be a lowercase 40-character commit SHA");
assert(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(surfaceId), "LEGACY_SURFACE_ID is invalid");
assert(Number.isSafeInteger(days) && days >= 1 && days <= 100, "CENSUS_DAYS must be between 1 and 100");

const baseUrl = new URL(productionUrl);
assert(baseUrl.protocol === "https:", "Production census requires HTTPS");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function cookieFromResponse(response) {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie") || ""];
  const value = values.find((item) => item.includes("="));
  return value ? value.split(";", 1)[0] : "";
}

async function request(path, { cookie = "", method = "GET", body } = {}) {
  const headers = new Headers();
  if (cookie) headers.set("Cookie", cookie);
  if (body !== undefined) headers.set("Content-Type", "application/json");
  return fetch(new URL(path, baseUrl), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
}

async function readJson(response, operation) {
  if (response.status !== 200) throw new Error(`${operation}: expected HTTP 200, got ${response.status}`);
  try {
    return await response.json();
  } catch {
    throw new Error(`${operation}: response was not JSON`);
  }
}

async function verifyRelease(operation) {
  const payload = await readJson(await request(`/release.json?census=${Date.now()}`), operation);
  assert(payload.commit === expectedReleaseSha, `${operation}: deployed commit mismatch`);
}

await verifyRelease("verify release before census");
const login = await request("/api/admin/login", { method: "POST", body: { token: adminToken } });
const loginPayload = await readJson(login, "admin login");
assert(loginPayload.authenticated === true, "admin login: authentication failed");
const cookie = cookieFromResponse(login);
assert(cookie, "admin login: session cookie missing");
let census;
try {
  census = validateLegacySurfaceCensus(await readJson(
    await request(`/api/admin/legacy-surfaces/${encodeURIComponent(surfaceId)}/census?days=${days}`, { cookie }),
    "read legacy surface census",
  ), { surfaceId, days });
} finally {
  await readJson(await request("/api/admin/logout", { cookie, method: "POST" }), "admin logout");
}
await verifyRelease("verify release after census");
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(census, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
console.log(`retained legacy census for ${surfaceId}: ${census.rows.length} content-free rows`);
