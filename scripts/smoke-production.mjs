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
  assert(response.headers.get("content-security-policy")?.includes("default-src 'self'"), `${label}: missing CSP`);
  assert(response.headers.get("x-frame-options") === "DENY", `${label}: missing X-Frame-Options`);
  assert(response.headers.get("x-content-type-options") === "nosniff", `${label}: missing X-Content-Type-Options`);
  assert(response.headers.get("referrer-policy") === "no-referrer", `${label}: missing Referrer-Policy`);
}

async function runChecks() {
  const marker = Date.now();
  const home = await request(`/?smoke=${marker}`);
  assert(home.status === 200, `home: expected 200, got ${home.status}`);
  assertSecurityHeaders(home, "home");
  const homeHtml = await home.text();
  assert(homeHtml.includes('id="loginView"'), "home: login view missing");
  assert(homeHtml.includes('src="/app.js"'), "home: app script missing");

  const admin = await request(`/admin?smoke=${marker}`);
  assert(admin.status === 200, `admin: expected 200, got ${admin.status}`);
  assertSecurityHeaders(admin, "admin");
  const adminHtml = await admin.text();
  assert(adminHtml.includes('id="adminLoginView"'), "admin: login view missing");
  assert(adminHtml.includes('id="releaseGrid"') || adminHtml.includes('class="release-grid"'), "admin: production status panel missing");

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
