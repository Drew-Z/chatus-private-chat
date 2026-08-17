import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import type { AdminConfig } from "../../client/src/lib/api";

const blockedRequests = new WeakMap<Page, string[]>();
const adminConfig: AdminConfig = {
  routes: {
    primary: {
      label: "Primary",
      enabled: true,
      offerings: [{ providerId: "shared", model: "synthetic-model" }],
    },
  },
  providers: {
    shared: {
      label: "Shared",
      type: "openai-chat",
      baseUrl: "https://provider.example/v1",
      hasLegacyKey: true,
    },
  },
  users: { bill: { displayName: "Bill" } },
  defaults: {
    enabled: true,
    defaultRoute: "primary",
    allowedRoutes: ["primary"],
    allowedSkills: [],
    allowedTools: [],
    dailyMessageLimit: 500,
    minuteMessageLimit: 12,
  },
  publicAccess: {
    enabled: false,
    routeId: "",
    sessionTtlSeconds: 86_400,
    dailyMessageLimit: 20,
    minuteMessageLimit: 6,
    sourceDailyMessageLimit: 200,
    sourceMinuteMessageLimit: 30,
  },
  skills: {},
  tools: {},
  mcpServers: {},
};

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({
    reducedMotion: test.info().project.name === "normal-motion" ? "no-preference" : "reduce",
  });
  const blocked: string[] = [];
  blockedRequests.set(page, blocked);
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    const request = route.request();
    const json = (body: unknown) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
    if (request.method() === "GET" && url.pathname === "/api/admin/config") {
      await json({ config: adminConfig, source: "kv", revision: "a".repeat(64) });
      return;
    }
    if (request.method() === "GET" && url.pathname === "/api/admin/members") {
      await json({
        members: [{ label: "bill", displayName: "Bill", configured: true, hasAccessCode: true }],
        accessRevision: "c".repeat(64),
        accessSource: "managed",
      });
      return;
    }
    if (request.method() === "GET" && url.pathname === "/api/admin/setup-status") {
      await json({
        ready: true,
        configSource: "kv",
        steps: Object.fromEntries(["health", "provider", "model", "member", "permission", "smoke"]
          .map((name) => [name, { ready: true, status: "ready", count: 1 }])),
      });
      return;
    }
    const allowed = url.origin === "http://127.0.0.1:4178"
      && !url.pathname.startsWith("/api/")
      && !url.pathname.startsWith("/agent");
    if (allowed) await route.continue();
    else {
      blocked.push(`${route.request().method()} ${url.href}`);
      await route.abort("blockedbyclient");
    }
  });
});

test.afterEach(async ({ page }) => {
  expect(blockedRequests.get(page) || [], "accessibility fixture attempted an unexpected network request").toEqual([]);
});

async function expectAccessible(page: Page, scope = "body", disabledRules: string[] = []) {
  const results = await new AxeBuilder({ page })
    .include(scope)
    .disableRules(["color-contrast", ...disabledRules])
    .analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

test("member workspace meets the accessibility baseline", async ({ page }) => {
  await page.goto("/?drawer=open");
  await expect(page.locator("[data-visual-fixture=true]")).toBeVisible();
  // The broad synthetic member fixture intentionally carries unlabeled test
  // controls, nested row actions, and a non-focusable presentation-only code
  // scroller. Production-focused tests cover those interaction contracts.
  await expectAccessible(page, ".workspace-shell", ["label", "scrollable-region-focusable", "nested-interactive"]);
});

test("admin workspace meets the accessibility baseline", async ({ page }) => {
  await page.goto("/?view=admin-members");
  await expect(page.locator("[data-visual-fixture=true]")).toBeVisible();
  await expect(page.getByRole("heading", { name: "默认配置" })).toBeVisible();
  await expectAccessible(page, "[data-visual-fixture=true]");
});

test("normal and reduced motion projects expose the requested preference", async ({ page }, testInfo) => {
  const reduced = await page.evaluate(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  expect(reduced).toBe(testInfo.project.name === "reduced-motion" || testInfo.project.name === "firefox-smoke");
});
