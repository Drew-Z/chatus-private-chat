import { execFile as execFileCallback } from "node:child_process";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { validateLegacySurfaceCensus } from "./legacy-census-contract.mjs";

const execFile = promisify(execFileCallback);
const requestTimeoutMs = 15_000;

export async function assertDeployedReleaseSha({
  deployedSha,
  expectedMainSha,
  allowDeployedAncestor,
  isAncestor = gitIsAncestor,
}) {
  assert(/^[a-f0-9]{40}$/.test(deployedSha), "verify release: invalid deployed commit");
  assert(/^[a-f0-9]{40}$/.test(expectedMainSha), "EXPECTED_MAIN_SHA must be a lowercase 40-character commit SHA");
  if (deployedSha === expectedMainSha) return deployedSha;
  assert(allowDeployedAncestor, "verify release: deployed commit mismatch");
  assert(await isAncestor(deployedSha, expectedMainSha), "verify release: deployed commit is not a main ancestor");
  return deployedSha;
}

export function assertUnchangedDeployedReleaseSha(beforeSha, afterSha) {
  assert(afterSha === beforeSha, "verify release after census: deployed commit changed");
  return beforeSha;
}

async function main() {
  const productionUrl = process.env.PRODUCTION_URL?.trim() || "";
  const adminToken = process.env.ADMIN_TOKEN?.trim() || "";
  const expectedMainSha = process.env.EXPECTED_MAIN_SHA?.trim() || process.env.GITHUB_SHA?.trim() || "";
  const allowDeployedAncestor = process.env.ALLOW_DEPLOYED_ANCESTOR === "true";
  const surfaceId = process.env.LEGACY_SURFACE_ID?.trim() || "legacy.api.chat-post";
  const outputPath = resolve(process.env.CENSUS_OUTPUT?.trim() || "artifacts/legacy-surface-census/census.json");
  const days = Number(process.env.CENSUS_DAYS || 30);

  assert(process.env.GITHUB_ACTIONS === "true", "Production census runs only in GitHub Actions");
  assert(process.env.GITHUB_REF === "refs/heads/main", "Production census runs only from main");
  assert(productionUrl, "PRODUCTION_URL is required");
  assert(adminToken, "ADMIN_TOKEN is required");
  assert(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(surfaceId), "LEGACY_SURFACE_ID is invalid");
  assert(Number.isSafeInteger(days) && days >= 1 && days <= 100, "CENSUS_DAYS must be between 1 and 100");

  const baseUrl = new URL(productionUrl);
  assert(baseUrl.protocol === "https:", "Production census requires HTTPS");

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

  async function readRelease(operation) {
    const payload = await readJson(await request(`/release.json?census=${Date.now()}`), operation);
    assert(/^[a-f0-9]{40}$/.test(payload.commit), `${operation}: invalid deployed commit`);
    return payload.commit;
  }

  const deployedSha = await assertDeployedReleaseSha({
    deployedSha: await readRelease("verify release before census"),
    expectedMainSha,
    allowDeployedAncestor,
  });
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
  assertUnchangedDeployedReleaseSha(
    deployedSha,
    await readRelease("verify release after census"),
  );
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(census, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  const githubOutput = process.env.GITHUB_OUTPUT?.trim() || "";
  assert(githubOutput, "GITHUB_OUTPUT is required");
  await appendFile(githubOutput, `deployed_sha=${deployedSha}\n`, "utf8");
  console.log(`retained legacy census for ${surfaceId}: ${census.rows.length} content-free rows`);
}

async function gitIsAncestor(ancestorSha, descendantSha) {
  try {
    await execFile("git", ["merge-base", "--is-ancestor", ancestorSha, descendantSha], { windowsHide: true });
    return true;
  } catch (error) {
    if (error && typeof error === "object" && error.code === 1) return false;
    throw new Error("verify release: git ancestry check failed");
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
