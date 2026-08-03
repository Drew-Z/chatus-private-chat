const baseUrl = new URL(process.argv[2] || process.env.PRODUCTION_URL || "");
const expectedCommit = process.argv[3] || process.env.EXPECTED_COMMIT || "";
const maxAttempts = 12;
const retryDelayMs = 5000;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(path, options = {}) {
  const url = new URL(path, baseUrl);
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(10000),
    ...options,
  });
  return response;
}

function assertSecurityHeaders(response, label) {
  const csp = response.headers.get("content-security-policy") || "";
  assert(csp.includes("default-src 'self'"), `${label}: missing CSP`);
  assert(!csp.includes("'unsafe-inline'"), `${label}: CSP allows unsafe inline content`);
  assert(response.headers.get("x-frame-options") === "DENY", `${label}: missing X-Frame-Options`);
  assert(response.headers.get("x-content-type-options") === "nosniff", `${label}: missing X-Content-Type-Options`);
  assert(response.headers.get("strict-transport-security")?.includes("max-age=31536000"), `${label}: missing HSTS`);
  assert(response.headers.get("referrer-policy") === "no-referrer", `${label}: missing Referrer-Policy`);
  assert(/^[0-9a-f-]{36}$/i.test(response.headers.get("x-request-id") || ""), `${label}: missing request id`);
}

async function runChecks() {
  const marker = Date.now();
  const health = await request(`/healthz?smoke=${marker}`);
  assert(health.status === 200, `health: expected 200, got ${health.status}`);
  assertSecurityHeaders(health, "health");
  assert(health.headers.get("cache-control")?.includes("no-store"), "health: cache must be disabled");
  const healthBody = await health.json();
  assert(healthBody.status === "ok", "health: worker is degraded");
  assert(healthBody.checks?.kv === true, "health: KV check failed");
  assert(healthBody.checks?.durableObject === true, "health: Durable Object check failed");
  assert(healthBody.checks?.configured === true, "health: configuration check failed");

  const home = await request(`/?smoke=${marker}`);
  assert(home.status === 200, `home: expected 200, got ${home.status}`);
  assertSecurityHeaders(home, "home");
  const homeHtml = await home.text();
  assert(homeHtml.includes('id="root"'), "home: React root missing");
  assert(homeHtml.includes('/react-chat/assets/'), "home: React assets missing");
  assert(homeHtml.includes('/manifest.webmanifest'), "home: manifest link missing");
  if (expectedCommit) assert(homeHtml.includes(`name="chatus-release" content="${expectedCommit}"`), "home: release meta does not match deployment");
  if (expectedCommit) assert(homeHtml.includes(`/pwa.js?v=${expectedCommit}`), "home: PWA asset version does not match deployment");

  const reactAssets = [...homeHtml.matchAll(/(?:src|href)="(\/react-chat\/assets\/[^"]+\.(?:js|css))"/g)]
    .map((match) => match[1]);
  assert(reactAssets.some((asset) => asset.endsWith(".js")), "home: built React JavaScript is missing");
  assert(reactAssets.some((asset) => asset.endsWith(".css")), "home: built React stylesheet is missing");
  for (const asset of reactAssets) {
    const response = await request(asset);
    assert(response.status === 200, `${asset}: expected 200, got ${response.status}`);
    assert(response.headers.get("cache-control")?.includes("immutable"), `${asset}: immutable cache missing`);
  }

  const legacy = await request(`/legacy/?smoke=${marker}`);
  assert(legacy.status === 200, `legacy: expected 200, got ${legacy.status}`);
  assertSecurityHeaders(legacy, "legacy");
  const legacyHtml = await legacy.text();
  assert(legacyHtml.includes('id="loginView"'), "legacy: login view missing");
  assert(legacyHtml.includes('src="/app.js?v='), "legacy: versioned app script missing");
  if (expectedCommit) assert(legacyHtml.includes(`name="chatus-release" content="${expectedCommit}"`), "legacy: release meta does not match deployment");
  if (expectedCommit) assert(legacyHtml.includes(`/app.js?v=${expectedCommit}`), "legacy: asset version does not match deployment");

  const admin = await request(`/react-chat/admin?smoke=${marker}`);
  assert(admin.status === 200, `admin: expected 200, got ${admin.status}`);
  assertSecurityHeaders(admin, "admin");
  const adminHtml = await admin.text();
  assert(adminHtml.includes('id="root"'), "admin: React root missing");
  assert(adminHtml.includes('/react-chat/assets/'), "admin: React assets missing");
  if (expectedCommit) assert(adminHtml.includes(`name="chatus-release" content="${expectedCommit}"`), "admin: release meta does not match deployment");
  const retiredAdmin = await request(`/admin.html?smoke=${marker}`, { redirect: "manual" });
  assert(retiredAdmin.status === 308, `retired admin: expected 308, got ${retiredAdmin.status}`);
  assert(new URL(retiredAdmin.headers.get("location") || "", baseUrl).pathname === "/react-chat/admin", "retired admin: redirect target mismatch");

  if (expectedCommit) {
    const fingerprintedAsset = await request(`/app.js?v=${expectedCommit}`);
    assert(fingerprintedAsset.headers.get("cache-control")?.includes("immutable"), "fingerprinted asset: immutable cache missing");
    const appSource = await fingerprintedAsset.text();
    assert(appSource.includes(`./markdown.js?v=${expectedCommit}`), "app module: dependency fingerprint does not match deployment");
    const markdownAsset = await request(`/markdown.js?v=${expectedCommit}`);
    assert(markdownAsset.headers.get("cache-control")?.includes("immutable"), "markdown module: immutable cache missing");
    const plainAsset = await request("/app.js");
    assert(!plainAsset.headers.get("cache-control")?.includes("immutable"), "plain asset: must remain revalidated");
    const releaseAsset = await request(`/release.json?v=${expectedCommit}`);
    assert(!releaseAsset.headers.get("cache-control")?.includes("immutable"), "release metadata: must not be immutable");
  }

  const session = await request("/api/session");
  assert(session.status === 401, `session: expected 401, got ${session.status}`);
  assertSecurityHeaders(session, "session");
  const sessionBody = await session.json();
  assert(sessionBody.error === "unauthorized", "session: unexpected unauthenticated response");

  const manifestResponse = await request("/manifest.webmanifest");
  assert(manifestResponse.status === 200, `manifest: expected 200, got ${manifestResponse.status}`);
  assert(manifestResponse.headers.get("content-type")?.includes("application/manifest+json"), "manifest: wrong content type");
  const manifest = await manifestResponse.json();
  assert(manifest.name === "Chatus 私人 AI 工作台", "manifest: unexpected app name");
  assert(manifest.display === "standalone", "manifest: standalone display missing");
  assert(Array.isArray(manifest.icons) && manifest.icons.length >= 2, "manifest: icons missing");

  for (const icon of ["/icon-192.png", "/icon-512.png"]) {
    const response = await request(icon);
    assert(response.status === 200, `${icon}: expected 200, got ${response.status}`);
    assert(response.headers.get("content-type") === "image/png", `${icon}: wrong content type`);
  }

  const serviceWorker = await request("/sw.js");
  assert(serviceWorker.status === 200, `service worker: expected 200, got ${serviceWorker.status}`);
  const serviceWorkerSource = await serviceWorker.text();
  assert(serviceWorkerSource.includes('url.pathname.startsWith("/api/")'), "service worker: API cache exclusion missing");

  const pwaScript = await request("/pwa.js");
  assert(pwaScript.status === 200, `pwa script: expected 200, got ${pwaScript.status}`);
  assert((await pwaScript.text()).includes("fetchReleaseCommit"), "pwa script: release update detection missing");

  const robots = await request("/robots.txt");
  assert(robots.status === 200, `robots: expected 200, got ${robots.status}`);
  assert((await robots.text()).includes("Disallow: /"), "robots: private-site directive missing");

  if (expectedCommit) {
    const releaseResponse = await request(`/release.json?smoke=${marker}`);
    assert(releaseResponse.status === 200, `release: expected 200, got ${releaseResponse.status}`);
    const release = await releaseResponse.json();
    assert(release.commit === expectedCommit, `release: expected ${expectedCommit}, got ${release.commit || "missing"}`);
  }
}

let lastError;
for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  try {
    await runChecks();
    console.log(`Production smoke test passed: ${baseUrl.origin}`);
    process.exit(0);
  } catch (error) {
    lastError = error;
    console.error(`Smoke attempt ${attempt}/${maxAttempts} failed: ${error.message}`);
    if (attempt < maxAttempts) await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }
}

throw lastError;
