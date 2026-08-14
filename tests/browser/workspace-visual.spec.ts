import { expect, test, type Page, type Route, type TestInfo } from "@playwright/test";
import type { AdminConfig } from "../../client/src/lib/api";

const blockedRequests = new WeakMap<Page, string[]>();

type ShareFixtureGrant = {
  principalId: string;
  alias: string;
  role: "viewer" | "editor";
  grantRevision: number;
  grantedAt: number;
  updatedAt: number;
};

type ShareFixtureState = {
  accessRevision: number;
  grants: ShareFixtureGrant[];
  replay: Map<string, Record<string, unknown>>;
  failedOperations: Set<string>;
  loadFailed: boolean;
  upsertOperationIds: string[];
  revokeOperationIds: string[];
};

const shareFixtureStates = new WeakMap<Page, ShareFixtureState>();
const shareFixtureResourceId = "res_11111111-1111-4111-8111-111111111111";
const shareFixtureNow = 1785032000000;

const adminMemberConfig: AdminConfig = {
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
  users: {
    bill: { displayName: "Bill" },
  },
  defaults: {
    enabled: true,
    defaultRoute: "primary",
    allowedRoutes: ["primary"],
    allowedSkills: ["coding"],
    allowedTools: ["builtin:text_stats"],
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
  skills: {
    coding: {
      enabled: true,
      label: "Coding workflow with a long synthetic title",
      description: "Synthetic Skill used only for responsive browser acceptance.",
      instructions: "Review the request, use assigned tools when needed, and keep the result concise.",
      toolIds: ["builtin:text_stats"],
      order: 1,
    },
  },
  tools: {
    "builtin:text_stats": {
      enabled: true,
      label: "Text statistics",
      description: "Counts text without contacting a provider.",
      inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
      confirmation: "auto",
      executor: { type: "builtin", name: "text_stats" },
    },
    "mcp:docs:search": {
      enabled: true,
      label: "Search remote documentation",
      description: "Synthetic reviewed read-only remote tool.",
      inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
      confirmation: "first-per-conversation",
      executor: { type: "mcp", serverId: "docs", remoteName: "search" },
      schemaFingerprint: "d".repeat(64),
      securityFingerprint: "e".repeat(64),
      sideEffect: "read",
      reviewRevision: "f".repeat(64),
      reviewRequired: false,
    },
  },
  mcpServers: {
    docs: {
      enabled: true,
      label: "Documentation service with a long synthetic name",
      endpoint: "https://docs.example/mcp",
      auth: { version: 1, type: "bearer", secretRef: "DOCS_MCP" },
    },
  },
};

const adminSetupReady = {
  ready: true,
  configSource: "kv",
  steps: {
    health: { ready: true, status: "ready", count: 3 },
    provider: { ready: true, status: "ready", count: 1 },
    model: { ready: true, status: "ready", count: 1 },
    member: { ready: true, status: "ready", count: 1 },
    permission: { ready: true, status: "ready", count: 1 },
    smoke: { ready: true, status: "ready", count: 1 },
  },
} as const;

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const blocked: string[] = [];
  blockedRequests.set(page, blocked);
  const shareState: ShareFixtureState = {
    accessRevision: 1,
    grants: [{
      principalId: "prn_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      alias: "visual-grantee",
      role: "viewer",
      grantRevision: 1,
      grantedAt: shareFixtureNow,
      updatedAt: shareFixtureNow,
    }],
    replay: new Map(),
    failedOperations: new Set(),
    loadFailed: false,
    upsertOperationIds: [],
    revokeOperationIds: [],
  };
  shareFixtureStates.set(page, shareState);
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === "http://127.0.0.1:4178" && /^\/api\/agent\/conversations\/[^/]+\/shares(?:\/revoke)?$/.test(url.pathname)) {
      const fixtureParams = new URL(page.url()).searchParams;
      const response = () => ({
        version: 1 as const,
        resourceId: shareFixtureResourceId,
        accessRevision: shareState.accessRevision,
        grants: shareState.grants,
      });
      if (route.request().method() === "GET") {
        if (fixtureParams.get("shareLoadError") === "once" && !shareState.loadFailed) {
          shareState.loadFailed = true;
          await fulfillShareError(route, "conversation_acl_unavailable", "合成共享列表暂时不可用。");
          return;
        }
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(response()) });
        return;
      }

      const body = JSON.parse(route.request().postData() || "{}") as Record<string, unknown>;
      const operationId = String(body.operationId || "");
      const replay = shareState.replay.get(operationId);
      if (url.pathname.endsWith("/revoke")) shareState.revokeOperationIds.push(operationId);
      else shareState.upsertOperationIds.push(operationId);
      if (replay) {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(replay) });
        return;
      }

      if (url.pathname.endsWith("/revoke")) {
        const principalId = String(body.granteePrincipalId || "");
        shareState.accessRevision += 1;
        shareState.grants = shareState.grants.filter((grant) => grant.principalId !== principalId);
      } else {
        const alias = String(body.granteeLabel || "");
        const role = body.role === "editor" ? "editor" : "viewer";
        const existing = shareState.grants.find((grant) => grant.alias === alias);
        shareState.accessRevision += 1;
        if (existing) {
          shareState.grants = shareState.grants.map((grant) => grant.alias === alias ? {
            ...grant,
            role,
            grantRevision: grant.grantRevision + 1,
            updatedAt: shareFixtureNow + shareState.accessRevision,
          } : grant);
        } else {
          shareState.grants = [...shareState.grants, {
            principalId: "prn_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            alias,
            role,
            grantRevision: 1,
            grantedAt: shareFixtureNow + shareState.accessRevision,
            updatedAt: shareFixtureNow + shareState.accessRevision,
          }];
        }
      }
      const mutationResponse = { ok: true, ...response(), operationId, changed: true };
      shareState.replay.set(operationId, mutationResponse);
      if (fixtureParams.get("shareDelay") === "1") {
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
      if (fixtureParams.get("shareFailure") === "once" && !shareState.failedOperations.has(operationId)) {
        shareState.failedOperations.add(operationId);
        await fulfillShareError(route, "conversation_acl_unavailable", "合成共享写入已提交，但响应暂时不可用。");
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mutationResponse) });
      return;
    }
    const allowed = url.origin === "http://127.0.0.1:4178"
      && !url.pathname.startsWith("/api/")
      && !url.pathname.startsWith("/agent");
    if (allowed) await route.continue();
    else {
      blocked.push(url.href);
      await route.abort("blockedbyclient");
    }
  });
  await page.goto("/");
  await expect(page.locator("[data-visual-fixture=true]")).toBeVisible();
});

test.afterEach(async ({ page }) => {
  expect(blockedRequests.get(page) || [], "visual fixture attempted an unexpected network request").toEqual([]);
});

async function fulfillShareError(
  route: Route,
  error: string,
  message: string,
): Promise<void> {
  await route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ error, message }),
  });
}

test("workspace geometry stays contained and ordered", async ({ page }, testInfo) => {
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();

  const geometry = await page.evaluate(() => {
    const rect = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) throw new Error(`missing ${selector}`);
      const value = element.getBoundingClientRect();
      return { left: value.left, right: value.right, top: value.top, bottom: value.bottom, width: value.width, height: value.height };
    };
    const code = document.querySelector<HTMLElement>(".code-block pre");
    const transcript = document.querySelector<HTMLElement>(".message-column");
    const skillSelection = document.querySelector<HTMLElement>(".message-skill-selection");
    const skillMessage = skillSelection?.closest<HTMLElement>(".message");
    const skillSelectionRect = skillSelection?.getBoundingClientRect();
    const skillMessageRect = skillMessage?.getBoundingClientRect();
    return {
      documentFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      bodyFits: document.body.scrollWidth <= document.body.clientWidth,
      header: rect(".workspace-header"),
      headerLeading: rect(".header-leading"),
      headerTitle: rect(".header-title-stack"),
      headerRoute: rect(".header-route-button"),
      headerActions: rect(".header-actions"),
      layout: rect(".workspace-layout"),
      messageList: rect(".message-list"),
      composer: rect(".composer"),
      transcript: rect(".message-column"),
      action: rect(".composer-action"),
      codeScrollsLocally: Boolean(code && code.scrollWidth > code.clientWidth),
      transcriptScrollFits: Boolean(transcript && transcript.scrollWidth <= transcript.clientWidth),
      skillSelectionScrollFits: Boolean(skillSelection && skillSelection.scrollWidth <= skillSelection.clientWidth),
      skillSelectionInsideMessage: Boolean(
        skillSelectionRect
        && skillMessageRect
        && skillSelectionRect.left >= skillMessageRect.left - 1
        && skillSelectionRect.right <= skillMessageRect.right + 1
      ),
    };
  });

  expect(geometry.documentFits).toBe(true);
  expect(geometry.bodyFits).toBe(true);
  expect(geometry.header.height).toBeLessThanOrEqual(60);
  expect(geometry.header.bottom).toBeLessThanOrEqual(geometry.layout.top + 1);
  expect(geometry.headerLeading.right).toBeLessThanOrEqual(geometry.headerTitle.left + 1);
  expect(geometry.headerTitle.right).toBeLessThanOrEqual(geometry.headerRoute.left + 1);
  expect(geometry.headerRoute.right).toBeLessThanOrEqual(geometry.headerActions.left + 1);
  expect(geometry.messageList.bottom).toBeLessThanOrEqual(geometry.composer.top + 1);
  expect(geometry.transcript.width).toBeLessThanOrEqual(720);
  expect(geometry.transcript.left).toBeGreaterThanOrEqual(0);
  expect(geometry.transcript.right).toBeLessThanOrEqual(viewport!.width);
  expect(geometry.transcriptScrollFits).toBe(true);
  expect(geometry.skillSelectionScrollFits).toBe(true);
  expect(geometry.skillSelectionInsideMessage).toBe(true);
  expect(geometry.codeScrollsLocally).toBe(true);

  if (viewport!.width <= 520) {
    expect(geometry.headerTitle.width).toBeGreaterThanOrEqual(64);
    expect(geometry.headerRoute.width).toBeGreaterThanOrEqual(48);
  }

  if (testInfo.project.name === "touch-390") {
    expect(geometry.action.width).toBeGreaterThanOrEqual(44);
    expect(geometry.action.height).toBeGreaterThanOrEqual(44);
    const actionSizes = await page.locator(".message-actions .icon-button").evaluateAll((buttons) => buttons.map((button) => {
      const rect = button.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    }));
    expect(actionSizes.length).toBeGreaterThan(5);
    expect(actionSizes.every((size) => size.width >= 44 && size.height >= 44)).toBe(true);
  }

  await attachScreenshot(page, testInfo, "workspace");
});

test("bounded Provider progress stays neutral and contained", async ({ page }, testInfo) => {
  test.skip(!["desktop-1440", "touch-390"].includes(testInfo.project.name), "Provider progress targets desktop and 390px");

  await page.goto("/?phase=waiting-first-output&progress=primary");
  const status = page.getByRole("status").filter({ hasText: "正在尝试可用线路" });
  await expect(status).toContainText("1/3");
  await expect(status).toContainText("最多还需 60s");
  await expect(status).not.toContainText(/Provider|model|endpoint|primary/);

  await page.goto("/?phase=waiting-first-output&progress=fallback");
  const fallback = page.getByRole("status").filter({ hasText: "正在尝试备用线路" });
  await expect(fallback).toContainText("2/3");
  await expect(fallback).toContainText("最多还需 60s");
  const geometry = await fallback.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      viewport: document.documentElement.clientWidth,
      documentFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    };
  });
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewport);
  expect(geometry.documentFits).toBe(true);

  await page.goto("/?phase=waiting-first-output");
  await expect(page.getByRole("status").filter({ hasText: "正在等待首字输出" })).toBeVisible();
});

test("member logout keeps pending and retry recovery accessible and contained", async ({ page }, testInfo) => {
  test.skip(!["desktop-1440", "touch-390"].includes(testInfo.project.name), "member logout coverage targets desktop and 390px");

  const logout = page.getByRole("button", { name: "退出登录" });
  await expect(logout).toBeEnabled();
  await expect(logout).toHaveAttribute("title", "退出登录");
  await logout.click();

  const pendingLogout = page.getByRole("button", { name: "正在退出登录" });
  await expect(pendingLogout).toBeDisabled();
  await expect(pendingLogout).toHaveAttribute("title", "正在退出登录");
  await expect(page.getByRole("button", { name: "查看线路与状态" })).toBeDisabled();
  await expect(page.getByRole("button", { name: /MCP 连接/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: "发送", exact: true })).toBeDisabled();

  await page.goto("/?logout=error");
  const alert = page.getByRole("alert").filter({ hasText: "合成成员会话撤销失败" });
  const retry = alert.getByRole("button", { name: "重试退出" });
  await expect(alert).toBeVisible();
  await expect(retry).toBeEnabled();
  await expect(page.getByRole("button", { name: "退出登录" })).toBeEnabled();

  const geometry = await page.evaluate(() => {
    const row = document.querySelector<HTMLElement>(".member-logout-error");
    const retryButton = row?.querySelector<HTMLElement>("button");
    const conversation = document.querySelector<HTMLElement>(".conversation-chat");
    if (!row || !retryButton || !conversation) throw new Error("missing member logout recovery fixture");
    const rowRect = row.getBoundingClientRect();
    const retryRect = retryButton.getBoundingClientRect();
    const conversationRect = conversation.getBoundingClientRect();
    return {
      documentFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      bodyFits: document.body.scrollWidth <= document.body.clientWidth,
      rowFits: row.scrollWidth <= row.clientWidth + 1,
      rowInsideViewport: rowRect.left >= 0 && rowRect.right <= document.documentElement.clientWidth + 1,
      retryInsideRow: retryRect.left >= rowRect.left - 1 && retryRect.right <= rowRect.right + 1,
      rowBeforeConversation: rowRect.bottom <= conversationRect.top + 1,
    };
  });
  expect(geometry).toEqual({
    documentFits: true,
    bodyFits: true,
    rowFits: true,
    rowInsideViewport: true,
    retryInsideRow: true,
    rowBeforeConversation: true,
  });
  await attachScreenshot(page, testInfo, "member-logout-error");

  await retry.focus();
  await expect(retry).toBeFocused();
  await retry.press("Enter");
  await expect(page.getByRole("button", { name: "正在退出登录" })).toBeDisabled();
  await expect(page.locator(".member-logout-error")).toHaveCount(0);
});

test("file workspace stays contained and exposes exact version selection", async ({ page }, testInfo) => {
  const fileId = "11111111-1111-4111-8111-111111111111";
  const currentVersionId = "22222222-2222-4222-8222-222222222222";
  const oldVersionId = "33333333-3333-4333-8333-333333333333";
  const checksum = "a".repeat(64);
  const currentVersion = {
    id: currentVersionId,
    fileId,
    size: 4_096,
    mediaType: "text/markdown",
    checksum,
    state: "ready",
    ingestStatus: "ready",
    ingestGeneration: 1,
    ingestAttempts: 1,
    createdAt: Date.now(),
  } as const;
  const oldVersion = { ...currentVersion, id: oldVersionId, createdAt: Date.now() - 86_400_000 };
  const ingestFailedFileId = "55555555-5555-4555-8555-555555555555";
  const ingestFailedVersionId = "66666666-6666-4666-8666-666666666666";
  let ingestStatus: "failed" | "ready" = "failed";
  let ingestRetryRequested = false;
  let updatedAt = Date.now();
  let deleted = false;

  await page.route("**/api/workspace/files**", async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown, status = 200) => route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
    if (url.pathname === "/api/workspace/files" && route.request().method() === "GET") {
      const quotaBytes = (deleted ? 0 : currentVersion.size) + 8_192 + 2_048;
      const extractedBytes = 1_536;
      const pendingCleanupBytes = 3_072;
      await json({
        files: [...(deleted ? [] : [{
          id: fileId,
          path: "quarterly/reviews/release-notes-with-a-deliberately-long-name.md",
          name: "release-notes-with-a-deliberately-long-name.md",
          pinned: true,
          state: "ready",
          createdAt: updatedAt - 100_000,
          updatedAt,
          currentVersion,
          retryAvailable: false,
          ingestRetryAvailable: false,
        }]), {
          id: "44444444-4444-4444-8444-444444444444",
          path: "source-data/metrics.csv",
          name: "metrics.csv",
          pinned: false,
          state: "failed",
          createdAt: updatedAt - 200_000,
          updatedAt: updatedAt - 1_000,
          retryAvailable: true,
          ingestRetryAvailable: false,
        }, {
          id: ingestFailedFileId,
          path: "documents/failed-report.pdf",
          name: "failed-report.pdf",
          pinned: false,
          state: "ready",
          createdAt: updatedAt - 300_000,
          updatedAt: updatedAt - 2_000,
          currentVersion: {
            id: ingestFailedVersionId,
            fileId: ingestFailedFileId,
            size: 8_192,
            mediaType: "application/pdf",
            checksum,
            state: "ready",
            ingestStatus,
            ingestGeneration: 1,
            ingestAttempts: 1,
            ...(ingestStatus === "failed" ? { ingestError: "pdf_invalid" } : {}),
            createdAt: updatedAt - 300_000,
          },
          retryAvailable: false,
          ingestRetryAvailable: ingestStatus === "failed",
        }],
        maxFileBytes: 10 * 1024 * 1024,
        usage: {
          quotaBytes,
          extractedBytes,
          pendingCleanupBytes,
          trackedBytes: quotaBytes + extractedBytes + pendingCleanupBytes,
          limitBytes: 250 * 1024 * 1024,
        },
      });
      return;
    }
    if (url.pathname === `/api/workspace/files/${fileId}/versions`) {
      await json({
        file: {
          id: fileId,
          path: "quarterly/reviews/release-notes-with-a-deliberately-long-name.md",
          name: "release-notes-with-a-deliberately-long-name.md",
          pinned: true,
          state: "ready",
          createdAt: updatedAt - 100_000,
          updatedAt,
          currentVersion,
          retryAvailable: false,
          ingestRetryAvailable: false,
        },
        versions: [currentVersion, oldVersion],
      });
      return;
    }
    if (url.pathname === `/api/workspace/files/${ingestFailedFileId}/ingest-retry` && route.request().method() === "POST") {
      expect(route.request().postDataJSON()).toEqual({ versionId: ingestFailedVersionId });
      ingestRetryRequested = true;
      ingestStatus = "ready";
      await json({ ok: true });
      return;
    }
    if (url.pathname === `/api/workspace/files/${fileId}` && route.request().method() === "DELETE") {
      deleted = true;
      await json({ ok: true, deleted: true, existing: false });
      return;
    }
    throw new Error(`unexpected file workspace request: ${route.request().method()} ${url.pathname}`);
  });
  await page.route("**/api/agent/conversations/*/workspace-files", async (route) => {
    const body = route.request().postDataJSON() as { files: Array<{ fileId: string; versionId: string }> };
    updatedAt += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        conversation: {
          id: "visual-long",
          title: "整理一个很长很长的项目复盘标题，用来确认会话列表和头部不会挤压操作区",
          createdAt: updatedAt - 86_400_000,
          updatedAt,
          summary: "Synthetic visual fixture",
          pinned: false,
          routeId: "reasoning",
          skillMode: "automatic",
          skillIds: ["project"],
          messageCount: 8,
          workspaceFiles: body.files.map((ref) => ({
            ...ref,
            path: "quarterly/reviews/release-notes-with-a-deliberately-long-name.md",
            name: "release-notes-with-a-deliberately-long-name.md",
            size: ref.versionId === oldVersionId ? oldVersion.size : currentVersion.size,
            mediaType: "text/markdown",
            checksum,
          })),
        },
      }),
    });
  });

  if ((page.viewportSize()?.width || 0) <= 780) await page.getByRole("button", { name: "打开会话" }).click();
  await page.getByRole("button", { name: "文件", exact: true }).click();
  const panel = page.locator(".file-workspace");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("release-notes-with-a-deliberately-long-name.md");
  const usage = panel.getByRole("region", { name: "工作区元数据用量" });
  await expect(usage).toContainText("文件配额14.0 KB / 250.0 MB");
  await expect(usage).toContainText("解析产物1.5 KB");
  await expect(usage).toContainText("待清理3.0 KB");
  await expect(usage).toContainText("元数据合计18.5 KB");
  await expect(usage).toContainText("仅统计元数据记录，不代表 R2 实际占用。");
  await expect(usage.getByRole("progressbar", { name: "文件配额" })).toHaveAttribute("value", "14336");
  const row = panel.locator(".file-workspace-row").filter({ hasText: "release-notes-with-a-deliberately-long-name.md" });
  const selection = row.getByRole("checkbox");
  await selection.click();
  await expect(selection).toBeChecked();
  await expect(panel.locator(".file-workspace-actions span")).toHaveText("1/10");
  const selector = row.getByRole("combobox", { name: /会话版本/ });
  await expect(selector).toBeVisible();
  await selector.selectOption(oldVersionId);
  await expect(row.getByRole("link", { name: "下载文件" })).toHaveAttribute("href", new RegExp(oldVersionId));
  await expect(row.getByRole("button", { name: "上传新版本" })).toBeVisible();
  const failedRow = panel.locator(".file-workspace-row").filter({ hasText: "failed-report.pdf" });
  await expect(failedRow).toContainText("解析失败");
  await expect(failedRow.getByRole("checkbox")).toBeDisabled();
  await failedRow.getByRole("button", { name: "重试文件解析" }).click();
  await expect(failedRow).toContainText("可用");
  await expect(failedRow.getByRole("checkbox")).toBeEnabled();
  expect(ingestRetryRequested).toBe(true);

  await panel.locator('input[type="file"]').nth(0).setInputFiles({
    name: "too-large.txt",
    mimeType: "text/plain",
    buffer: Buffer.alloc(1024 * 1024 + 1, 65),
  });
  await expect(panel.getByRole("alert")).toContainText("超过 1.0 MB 限制");

  const geometry = await panel.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const rows = [...element.querySelectorAll<HTMLElement>(".file-workspace-row")];
    const usage = element.querySelector<HTMLElement>(".file-workspace-usage");
    return {
      documentFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      panelFits: rect.left >= 0 && rect.right <= document.documentElement.clientWidth + 1,
      rowsFit: rows.every((row) => row.scrollWidth <= row.clientWidth),
      usageFits: Boolean(usage && usage.scrollWidth <= usage.clientWidth),
    };
  });
  expect(geometry).toEqual({ documentFits: true, panelFits: true, rowsFit: true, usageFits: true });
  await attachScreenshot(page, testInfo, "file-workspace");
  await row.getByRole("button", { name: "删除文件" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "删除", exact: true }).click();
  await expect(row).toHaveCount(0);
  await expect(panel.locator(".file-workspace-actions span")).toHaveText("0/10");
  await expect(panel.getByRole("button", { name: "上传文件" })).toBeFocused();
});

test("file workspace recovers from an initial usage load failure", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440", "state recovery needs one desktop browser pass");
  let allowSuccess = false;
  let requests = 0;

  await page.route("**/api/workspace/files**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== "GET" || url.pathname !== "/api/workspace/files") {
      throw new Error(`unexpected workspace recovery request: ${request.method()} ${url.pathname}`);
    }
    requests += 1;
    await route.fulfill({
      status: allowSuccess ? 200 : 503,
      contentType: "application/json",
      body: JSON.stringify(allowSuccess ? {
        files: [],
        maxFileBytes: 10 * 1024 * 1024,
        usage: {
          quotaBytes: 0,
          extractedBytes: 0,
          pendingCleanupBytes: 0,
          trackedBytes: 0,
          limitBytes: 250 * 1024 * 1024,
        },
      } : { error: "fixture_unavailable", message: "合成文件工作区读取失败。" }),
    });
  });

  await page.getByRole("button", { name: "文件", exact: true }).click();
  const panel = page.locator(".file-workspace");
  await expect(panel.getByRole("alert")).toContainText("合成文件工作区读取失败。");
  await expect(panel.getByText("正在读取文件...")).toHaveCount(0);
  await expect(panel.getByText("还没有文件", { exact: true })).toHaveCount(0);
  await expect(panel.getByRole("region", { name: "工作区元数据用量" })).toHaveCount(0);

  allowSuccess = true;
  await panel.getByRole("button", { name: "刷新文件" }).click();
  await expect(panel.getByRole("alert")).toHaveCount(0);
  await expect(panel.getByRole("region", { name: "工作区元数据用量" })).toContainText("文件配额0 B / 250.0 MB");
  await expect(panel.getByText("还没有文件", { exact: true })).toBeVisible();
  await expect(panel.getByText("正在读取文件...")).toHaveCount(0);
  expect(requests).toBe(2);
});

test("branch origin hint returns to parent and handles missing parents", async ({ page }, testInfo) => {
  await page.goto("/?branch=present");
  const origin = page.getByRole("button", { name: "返回父会话：第二个会话" });
  await expect(origin).toBeVisible();
  await expect(origin).toContainText("来自 第二个会话");

  const geometry = await page.evaluate(() => {
    const header = document.querySelector<HTMLElement>(".workspace-header");
    const stack = document.querySelector<HTMLElement>(".header-title-stack");
    const chip = document.querySelector<HTMLElement>(".origin-chip");
    const route = document.querySelector<HTMLElement>(".header-route-button");
    if (!header || !stack || !chip || !route) throw new Error("missing branch origin header regions");
    const headerRect = header.getBoundingClientRect();
    const stackRect = stack.getBoundingClientRect();
    const chipRect = chip.getBoundingClientRect();
    const routeRect = route.getBoundingClientRect();
    return {
      documentFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      headerHeight: headerRect.height,
      chipInsideStack: chipRect.left >= stackRect.left - 1 && chipRect.right <= stackRect.right + 1,
      stackBeforeRoute: stackRect.right <= routeRect.left + 1,
    };
  });
  expect(geometry.documentFits).toBe(true);
  expect(geometry.headerHeight).toBeLessThanOrEqual(60);
  expect(geometry.chipInsideStack).toBe(true);
  expect(geometry.stackBeforeRoute).toBe(true);
  await origin.click();
  await expect(page.locator(".header-conversation-title")).toHaveText("第二个会话");

  await page.goto("/?branch=missing");
  await expect(page.locator(".origin-chip.static")).toContainText("父会话不可用");
  await expect(page.getByRole("button", { name: /返回父会话/ })).toHaveCount(0);
  await attachScreenshot(page, testInfo, "branch-origin");
});

test("guest workspace keeps the public model fixed and member controls hidden", async ({ page }, testInfo) => {
  await page.goto("/?access=guest");
  await expect(page.locator(".header-route-button.static")).toContainText("公开模型");
  await expect(page.getByRole("button", { name: "成员登录" })).toBeVisible();
  await expect(page.getByRole("button", { name: "查看线路与状态" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "记忆" })).toHaveCount(0);
  const openSidebar = page.getByRole("button", { name: "打开会话" });
  if (await openSidebar.isVisible()) await openSidebar.click();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(page.getByRole("group", { name: "Skill 模式" })).toHaveCount(0);
  await expect(page.getByText("Skills", { exact: true })).toHaveCount(0);
  await expect(page.locator(".skill-option")).toHaveCount(0);

  const geometry = await page.evaluate(() => {
    const headerRoute = document.querySelector<HTMLElement>(".header-route-button.static");
    const headerActions = document.querySelector<HTMLElement>(".header-actions");
    if (!headerRoute || !headerActions) throw new Error("missing guest header regions");
    const route = headerRoute.getBoundingClientRect();
    const actions = headerActions.getBoundingClientRect();
    return {
      documentFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      routeHasWidth: route.width >= 48,
      routeBeforeActions: route.right <= actions.left + 1,
    };
  });
  expect(geometry.documentFits).toBe(true);
  expect(geometry.routeHasWidth).toBe(true);
  expect(geometry.routeBeforeActions).toBe(true);
  await attachScreenshot(page, testInfo, "guest-workspace");
});

test("member Skill mode switches between automatic and exact manual selection", async ({ page }) => {
  await page.getByRole("button", { name: "查看线路与状态" }).click();
  await page.getByRole("button", { name: "Skills", exact: true }).click();
  const mode = page.getByRole("group", { name: "Skill 模式" });
  const automatic = mode.getByRole("button", { name: "自动" });
  const manual = mode.getByRole("button", { name: "手动" });
  const projectSkill = page.locator(".skill-option").filter({ hasText: "项目协作" }).getByRole("checkbox");

  await expect(automatic).toHaveAttribute("aria-pressed", "true");
  await expect(manual).toHaveAttribute("aria-pressed", "false");
  await expect(projectSkill).toBeChecked();
  await expect(projectSkill).toBeDisabled();

  await manual.click();
  await expect(automatic).toHaveAttribute("aria-pressed", "false");
  await expect(manual).toHaveAttribute("aria-pressed", "true");
  await expect(projectSkill).toBeEnabled();
  await projectSkill.uncheck();
  await expect(projectSkill).not.toBeChecked();
});

test("member settings center keeps global preferences out of conversation context", async ({ page }, testInfo) => {
  test.skip(!["desktop-1440", "mobile-480"].includes(testInfo.project.name), "settings coverage targets desktop and mobile");
  await page.getByRole("button", { name: "成员设置" }).first().click();
  const center = page.getByRole("dialog", { name: "成员设置" });
  await expect(center).toBeVisible();
  await center.getByRole("button", { name: "外观" }).click();
  await expect(center.locator('[role="group"][aria-label="主题"]')).toBeVisible();
  await center.getByRole("button", { name: "深色" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  if ((page.viewportSize()?.width || 0) <= 780) await center.getByRole("button", { name: "设置", exact: true }).click();
  await center.getByRole("button", { name: "连接" }).click();
  await expect(center).toContainText("MCP");
  if ((page.viewportSize()?.width || 0) <= 780) await center.getByRole("button", { name: "设置", exact: true }).click();
  await center.getByRole("button", { name: "账号与数据" }).click();
  await expect(center).toContainText("导出我的数据");
  const geometry = await page.evaluate(() => ({
    documentFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    bodyFits: document.body.scrollWidth <= document.body.clientWidth,
  }));
  expect(geometry).toEqual({ documentFits: true, bodyFits: true });
  await page.keyboard.press("Escape");
  await expect(center).toHaveCount(0);
});

test("message edit restores focus and rich content remains visible", async ({ page }) => {
  const edit = page.getByRole("button", { name: "编辑并分支发送" });
  await edit.click();
  const editor = page.getByRole("textbox", { name: "编辑消息" });
  await expect(editor).toBeFocused();
  await page.getByRole("button", { name: "取消" }).click();
  await expect(edit).toBeFocused();
  await expect(page.locator(".message-sources")).toContainText("来源 · 2");
  const skillSelection = page.getByRole("region", { name: "本轮自动 Skill" });
  await expect(skillSelection).toContainText("自动 Skill");
  await expect(skillSelection).toContainText("上次成功");
  await expect(skillSelection).toContainText("项目协作");
  await expect(skillSelection).toContainText("选择超时，已回退");
  await expect(page.getByRole("button", { name: "继续生成并创建分支" })).toBeVisible();

  const colors = await page.evaluate(() => {
    const heading = document.querySelector<HTMLElement>(".message.user .markdown-content h1");
    const code = document.querySelector<HTMLElement>(".message.user .markdown-content code");
    return { heading: heading ? getComputedStyle(heading).color : "", code: code ? getComputedStyle(code).color : "" };
  });
  expect(colors.heading).toBe("rgb(255, 255, 255)");
  expect(colors.code).not.toBe(colors.heading);
});

test("message actions follow phase, route, approval, and online policy", async ({ page }, testInfo) => {
  test.skip(!["desktop-1440", "touch-390"].includes(testInfo.project.name), "action matrix targets desktop and 390px");

  await page.goto("/?phase=streaming");
  await expect(page.locator(".conversation-chat")).toHaveAttribute("data-turn-phase", "streaming");
  await expect(page.locator(".message.user").getByRole("button", { name: "复制消息" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "编辑并分支发送" })).toBeDisabled();
  await expect(page.locator(".message.user").getByRole("button", { name: "创建对话分支" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "重新生成并创建分支" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "继续生成并创建分支" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "有帮助" })).toBeDisabled();

  await page.goto("/?phase=tool-running");
  await expect(page.getByRole("button", { name: "批准" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "拒绝" })).toBeEnabled();
  await expect(page.locator(".message.assistant").getByRole("button", { name: "创建对话分支" })).toBeDisabled();

  await page.goto("/?phase=completed&route=0");
  await expect(page.locator(".message.user").getByRole("button", { name: "创建对话分支" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "编辑并分支发送" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "重新生成并创建分支" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "有帮助" })).toBeDisabled();

  await page.goto("/?phase=tool-running&online=0");
  await expect(page.locator(".message.assistant").getByRole("button", { name: "复制消息" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "批准" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "拒绝" })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("memory proposals show the exact candidate before approval", async ({ page }) => {
  const trace = page.locator(".tool-trace").filter({ hasText: "更新长期记忆" });
  await expect(trace).toBeVisible();
  await expect(trace.locator(".memory-proposal-preview")).toHaveText(
    "- 偏好简洁、直接的回答\n- 长期使用 TypeScript",
  );
  await expect(trace).toContainText("确认后才会更新长期记忆");
  await expect(trace.getByRole("button", { name: "批准" })).toBeVisible();
  await expect(trace.getByRole("button", { name: "拒绝" })).toBeVisible();
});

test("composer grows within its cap and keeps send stop dimensions stable", async ({ page }) => {
  const textarea = page.getByRole("textbox", { name: "消息" });
  const initialHeight = await textarea.evaluate((element) => element.getBoundingClientRect().height);
  await textarea.fill(Array.from({ length: 12 }, (_, index) => `合成输入第 ${index + 1} 行`).join("\n"));
  const grownHeight = await textarea.evaluate((element) => element.getBoundingClientRect().height);
  expect(grownHeight).toBeGreaterThan(initialHeight);
  expect(grownHeight).toBeLessThanOrEqual(180);

  const sendSize = await page.getByRole("button", { name: "发送", exact: true }).evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
  await page.goto("/?busy=1");
  const stopSize = await page.getByRole("button", { name: "停止生成" }).evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
  expect(stopSize).toEqual(sendSize);
  await expect(page.locator(".composer-status")).toHaveText("Agent 正在继续处理");
});

test("attachment previews expose stable ready reading error and capability states", async ({ page }, testInfo) => {
  await page.goto("/?attachments=states");
  await expect(page.locator(".attachment-preview")).toHaveCount(4);
  await expect(page.locator(".attachment-preview.ready").filter({ hasText: "ready-preview.png" })).toHaveCount(1);
  await expect(page.locator(".attachment-preview.ready").filter({ hasText: "notes.md" })).toHaveCount(1);
  await expect(page.locator(".attachment-preview.reading .attachment-spinner")).toBeVisible();
  await expect(page.locator(".attachment-preview.error")).toContainText("不支持此格式");
  await expect(page.getByRole("button", { name: "发送", exact: true })).toBeDisabled();

  const geometry = await page.evaluate(() => {
    const strip = document.querySelector<HTMLElement>(".attachment-strip");
    const box = document.querySelector<HTMLElement>(".composer-box");
    if (!strip || !box) throw new Error("missing attachment preview strip");
    return {
      documentFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      stripFits: strip.getBoundingClientRect().right <= box.getBoundingClientRect().right + 1,
      stripScrollsLocally: strip.scrollWidth >= strip.clientWidth,
    };
  });
  expect(geometry.documentFits).toBe(true);
  expect(geometry.stripFits).toBe(true);
  expect(geometry.stripScrollsLocally).toBe(true);

  if (testInfo.project.name === "touch-390") {
    const size = await page.getByRole("button", { name: "添加附件" }).evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });
    expect(size.width).toBeGreaterThanOrEqual(44);
    expect(size.height).toBeGreaterThanOrEqual(44);
  }

  await page.goto("/?attachments=states&images=0");
  await expect(page.getByRole("button", { name: "添加附件" })).toBeEnabled();
  await expect(page.locator(".attachment-strip")).toContainText("notes.md");
  await expect(page.locator(".attachment-error")).toHaveText([
    "当前模型不支持图片",
    "当前模型不支持图片",
    "当前模型不支持图片",
  ]);
  await attachScreenshot(page, testInfo, "image-previews");
});

test("picker paste and drop share the attachment workflow", async ({ page }) => {
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles({ name: "picked.png", mimeType: "image/png", buffer: Buffer.from([65]) });
  await expect(page.locator(".attachment-preview.ready")).toContainText("picked.png");

  await page.getByRole("button", { name: "移除 picked.png" }).click();
  await expect(page.locator(".attachment-preview")).toHaveCount(0);

  await page.getByRole("textbox", { name: "消息" }).evaluate((element) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array([66])], "pasted.png", { type: "image/png" }));
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, clipboardData: transfer }));
  });
  await expect(page.locator(".attachment-preview.ready")).toContainText("pasted.png");

  await page.getByRole("textbox", { name: "消息" }).evaluate((element) => {
    const form = element.closest("form");
    if (!form) throw new Error("missing composer form");
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array([67])], "dropped.png", { type: "image/png" }));
    for (const type of ["dragenter", "dragover", "drop"]) {
      form.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }));
    }
  });
  await expect(page.locator(".attachment-preview.ready")).toHaveCount(2);
  await expect(page.locator(".attachment-strip")).toContainText("dropped.png");
});

test("reliability stream evidence stays contained on narrow viewports", async ({ page }, testInfo) => {
  await page.goto("/?view=reliability");
  await expect(page.getByText("渐进", { exact: true })).toBeVisible();
  await expect(page.getByText("单块", { exact: true })).toBeVisible();
  await expect(page.getByText("turn_reliability-123", { exact: true })).toBeVisible();
  const copyReference = page.getByRole("button", { name: "复制请求引用" });
  await expect(copyReference).toBeVisible();
  await copyReference.click();
  await expect(page.getByRole("button", { name: "请求引用已复制" })).toBeVisible();
  const geometry = await page.evaluate(() => {
    const wrap = document.querySelector<HTMLElement>(".admin-reliability-table-wrap");
    const table = document.querySelector<HTMLElement>(".admin-reliability-table");
    if (!wrap || !table) throw new Error("missing reliability table");
    return {
      documentFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      bodyFits: document.body.scrollWidth <= document.body.clientWidth,
      wrapperFits: wrap.getBoundingClientRect().right <= document.documentElement.clientWidth,
      localOverflow: table.scrollWidth > wrap.clientWidth,
    };
  });
  expect(geometry.documentFits).toBe(true);
  expect(geometry.bodyFits).toBe(true);
  expect(geometry.wrapperFits).toBe(true);
  if ((page.viewportSize()?.width || 0) < 1160) expect(geometry.localOverflow).toBe(true);
  await attachScreenshot(page, testInfo, "reliability");
});

test("Agent errors expose only canonical copyable request references", async ({ page }, testInfo) => {
  test.skip(!["desktop-1440", "touch-390"].includes(testInfo.project.name), "error presentation coverage targets desktop and 390px");
  await page.goto("/?view=agent-error");
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("当前模型的可用线路都在忙，请稍后重试或切换模型。");
  await expect(alert).toContainText("请求引用 turn_request-123");
  await expect(alert).not.toContainText("provider_busy");
  const copyReference = page.getByRole("button", { name: "复制请求引用" });
  await copyReference.click();
  await expect(page.getByRole("button", { name: "请求引用已复制" })).toBeVisible();
  await expect(page.getByRole("button", { name: "重试这一轮" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "重新连接" })).toBeVisible();
  const fits = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    body: document.body.scrollWidth <= document.body.clientWidth,
    alert: (document.querySelector(".error-banner")?.getBoundingClientRect().right || Infinity) <= document.documentElement.clientWidth,
  }));
  expect(fits).toEqual({ document: true, body: true, alert: true });
  await attachScreenshot(page, testInfo, "agent-error-reference");

  await page.goto("/?view=agent-error&request=0");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("button", { name: "复制请求引用" })).toHaveCount(0);
});

test("operations data stays scannable with local table overflow", async ({ page }, testInfo) => {
  test.skip(!["desktop-1440", "touch-390"].includes(testInfo.project.name), "operations coverage targets desktop and 390px");
  await page.goto("/?view=operations");
  await expect(page.getByLabel("7 日运营摘要")).toBeVisible();
  await expect(page.getByRole("heading", { name: "旧功能面治理" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "7 日请求趋势" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "逻辑模型结果" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "成员反馈" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "管理审计" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "成员用量" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Provider 容量" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "成本证据" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "预算策略" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "预算余额与告警" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "价格目录" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Provider 尝试" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "预算占用与复核" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Provider 对账" })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "2026-07-26 请求 5" })).toBeVisible();
  await expect(page.getByText("更新配置", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/不准确/).first()).toBeVisible();
  await expect(page.getByText("合成运营成员 01", { exact: true })).toBeVisible();
  await expect(page.getByText(/调用 21 · 失败 4 · 重试 7 · Fallback 7/)).toBeVisible();
  const providerAttempts = page.locator(".admin-operations-section").filter({ has: page.getByRole("heading", { name: "Provider 尝试" }) });
  await expect(providerAttempts).toContainText("Provider 上报");
  await expect(providerAttempts).toContainText("估算");
  await expect(providerAttempts).toContainText("已对账");
  await expect(providerAttempts).toContainText("已更正");
  await expect(page.getByText(/当前显示 20 \/ 21/)).toHaveCount(9);
  await expect(page.getByText("第 21 条逻辑模型", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "旧功能面治理：下一页" }).click();
  await expect(page.getByText("legacy.surface-21", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "逻辑模型结果：下一页" }).click();
  await expect(page.getByText("第 21 条逻辑模型", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "成员反馈：下一页" }).click();
  await expect(page.getByText("第 21 条成员反馈", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "管理审计：下一页" }).click();
  await expect(page.getByText(/第 21 条管理审计/)).toBeVisible();
  await page.getByRole("button", { name: "成员用量：下一页" }).click();
  await expect(page.getByText("第 21 位运营成员", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "价格目录：下一页" }).click();
  await expect(page.getByText(/第 21 条价格目录模型/)).toBeVisible();
  await page.getByRole("button", { name: "预算占用与复核：下一页" }).click();
  await expect(page.getByText(/reservation_00000000-0000-4000-8000-000000000021/)).toBeVisible();

  await page.getByLabel("筛选运营数据").fill("第 21 条逻辑模型");
  await expect(page.getByText("当前显示 1 / 1", { exact: true })).toBeVisible();
  await expect(page.getByText("第 21 条逻辑模型", { exact: true })).toBeVisible();

  const geometry = await page.evaluate(() => {
    const content = document.querySelector<HTMLElement>(".admin-operations-content");
    const wrap = document.querySelector<HTMLElement>(".operations-user-table-wrap");
    const table = document.querySelector<HTMLElement>(".operations-user-table");
    const sections = [...document.querySelectorAll<HTMLElement>(".admin-operations-section")];
    if (!content || !wrap || !table || !sections.length) throw new Error("missing operations view");
    const viewportWidth = document.documentElement.clientWidth;
    return {
      documentFits: document.documentElement.scrollWidth <= viewportWidth,
      bodyFits: document.body.scrollWidth <= document.body.clientWidth,
      contentFits: content.getBoundingClientRect().right <= viewportWidth,
      sectionsFit: sections.every((section) => section.getBoundingClientRect().right <= viewportWidth),
      wrapperFits: wrap.getBoundingClientRect().right <= viewportWidth,
      localOverflow: table.scrollWidth > wrap.clientWidth,
    };
  });
  expect(geometry.documentFits).toBe(true);
  expect(geometry.bodyFits).toBe(true);
  expect(geometry.contentFits).toBe(true);
  expect(geometry.sectionsFit).toBe(true);
  expect(geometry.wrapperFits).toBe(true);
  if (testInfo.project.name === "touch-390") expect(geometry.localOverflow).toBe(true);
  await attachScreenshot(page, testInfo, "operations");
});

test("legacy surface transition keeps evidence retryable and refreshes authority", async ({ page }, testInfo) => {
  test.skip(!["desktop-1440", "touch-390"].includes(testInfo.project.name), "legacy surface governance targets desktop and 390px");
  await page.goto("/?view=operations");

  const result = page.getByTestId("legacy-surface-fixture-result");
  const surfaceRow = page.locator(".legacy-surface-row").filter({ hasText: "legacy.surface-01" });
  await expect(surfaceRow).toContainText("影子运行");
  await expect(surfaceRow).toContainText("读取启用");
  await expect(surfaceRow).toContainText("写入启用");
  await surfaceRow.getByRole("button", { name: "推进至写入已停用" }).click();
  await expect(result).toHaveAttribute("data-dirty", "true");

  const form = page.locator(".legacy-surface-transition-form");
  await expect(form).toContainText("影子运行 → 写入已停用");
  const evidenceGroups = form.locator("fieldset");
  await expect(evidenceGroups).toHaveCount(3);
  for (let index = 0; index < 3; index += 1) {
    const group = evidenceGroups.nth(index);
    await group.getByLabel("证据 ID").fill(`fixture:evidence:${index + 1}`);
    await group.getByLabel("SHA-256 摘要").fill("c".repeat(64));
    await group.getByLabel("部署 Commit SHA").fill("d".repeat(40));
    await group.getByLabel("计数").fill(String(index));
  }
  await form.getByRole("button", { name: "检查并确认" }).click();

  const dialog = page.getByRole("dialog", { name: "确认推进旧功能面" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("legacy.surface-01");
  await expect(dialog).toContainText("影子运行");
  await expect(dialog).toContainText("写入已停用");
  await expect(dialog.getByRole("button", { name: "取消" })).toBeFocused();
  await dialog.getByRole("button", { name: "确认推进" }).click();
  await expect(result).toHaveAttribute("data-kind", "advance-attempt");
  await expect(dialog.getByRole("button", { name: "正在提交..." })).toBeDisabled();
  await releaseLegacySurfaceTransition(page);
  await expect(dialog.getByRole("alert")).toHaveText("合成治理提交失败，请使用同一草稿重试。");
  await expect(dialog).toBeVisible();
  await expect(form.getByLabel("证据 ID").first()).toHaveValue("fixture:evidence:1");
  await expect(result).toHaveAttribute("data-dirty", "true");

  const firstAttempt = await result.evaluate((element) => ({
    operationId: element.getAttribute("data-operation-id"),
    requestedAt: element.getAttribute("data-requested-at"),
  }));
  expect(firstAttempt.operationId).toMatch(/^legacy-surface:[0-9a-f-]{36}$/);
  expect(firstAttempt.requestedAt).toMatch(/^\d+$/);

  const errorGeometry = await page.evaluate(() => {
    const main = document.querySelector<HTMLElement>('main[data-visual-fixture="true"]');
    const form = document.querySelector<HTMLElement>(".legacy-surface-transition-form");
    const dialog = document.querySelector<HTMLElement>(".confirm-dialog");
    const viewportWidth = document.documentElement.clientWidth;
    if (!main || !form || !dialog) throw new Error("missing legacy surface transition fixture");
    const dialogRect = dialog.getBoundingClientRect();
    return {
      documentFits: document.documentElement.scrollWidth <= viewportWidth,
      bodyFits: document.body.scrollWidth <= document.body.clientWidth,
      mainFits: main.getBoundingClientRect().right <= viewportWidth + 1,
      formFits: form.scrollWidth <= form.clientWidth + 1,
      dialogFits: dialogRect.left >= 0 && dialogRect.right <= viewportWidth + 1,
      dialogContentFits: dialog.scrollWidth <= dialog.clientWidth + 1,
    };
  });
  expect(errorGeometry).toEqual({
    documentFits: true,
    bodyFits: true,
    mainFits: true,
    formFits: true,
    dialogFits: true,
    dialogContentFits: true,
  });
  await attachScreenshot(page, testInfo, "legacy-surface-transition-error");

  await dialog.getByRole("button", { name: "确认推进" }).click();
  await expect(dialog.getByRole("button", { name: "正在提交..." })).toBeDisabled();
  await releaseLegacySurfaceTransition(page);
  await expect(dialog).toHaveCount(0);
  await expect(result).toHaveAttribute("data-kind", "advance");
  await expect(result).toHaveAttribute("data-operation-id", firstAttempt.operationId!);
  await expect(result).toHaveAttribute("data-requested-at", firstAttempt.requestedAt!);
  await expect(result).toHaveAttribute("data-dirty", "false");
  await expect(form).toHaveCount(0);
  await expect(surfaceRow.getByText("写入已停用", { exact: true })).toBeVisible();
  await expect(surfaceRow.locator(".legacy-surface-facts > div").filter({ hasText: "修订" })).toContainText("2");
  await surfaceRow.scrollIntoViewIfNeeded();
  await attachScreenshot(page, testInfo, "legacy-surface-transition-success");
});

test("finance entry fixture keeps drafts dirty on validation or mutation failure", async ({ page }, testInfo) => {
  test.skip(!["desktop-1440", "touch-390"].includes(testInfo.project.name), "finance entry interaction targets desktop and 390px");
  await page.goto("/?view=operations-finance");

  const result = page.getByTestId("finance-fixture-result");
  const priceForm = page.locator("form").filter({ hasText: "新增价格目录" });
  await priceForm.getByLabel("目录版本 ID").fill("fixture-error");
  await priceForm.getByLabel("Offering ID").fill("reasoning/provider-fixture");
  await priceForm.getByLabel("上游模型").fill("fixture-model");
  await priceForm.getByLabel("输入单价 / 百万 Token").fill("1");
  await priceForm.getByLabel("审批人").fill("fixture-admin");
  await priceForm.getByLabel("价格来源").fill("fixture-price-card");
  await priceForm.getByRole("button", { name: "保存价格目录" }).click();
  await expect(priceForm.getByRole("alert")).toHaveText("合成价格目录失败。");
  await expect(result).toHaveAttribute("data-dirty", "true");

  await priceForm.getByLabel("目录版本 ID").fill("fixture-price-new");
  await priceForm.getByRole("button", { name: "保存价格目录" }).click();
  await expect(priceForm.getByRole("status")).toHaveText("价格目录已提交，重复版本会保持幂等。");
  await expect(result).toHaveAttribute("data-kind", "price");
  const priceTiming = await result.evaluate((element) => ({
    effectiveFrom: Number(element.getAttribute("data-effective-from")),
    createdAt: Number(element.getAttribute("data-created-at")),
  }));
  expect(priceTiming.createdAt).toBeLessThanOrEqual(priceTiming.effectiveFrom);
  await expect(result).toHaveAttribute("data-dirty", "false");

  const reconciliationForm = page.locator("form").filter({ hasText: "导入对账摘要" });
  await reconciliationForm.getByLabel("对账指纹").fill(`sha256:${"1".repeat(64)}`);
  await reconciliationForm.getByLabel("账户指纹").fill(`acct_sha256:${"2".repeat(64)}`);
  await reconciliationForm.getByLabel("报告总额").fill("1");
  await reconciliationForm.getByLabel("已匹配总额").fill("2");
  await reconciliationForm.getByRole("button", { name: "导入对账摘要" }).click();
  await expect(reconciliationForm.getByRole("alert")).toHaveText("已匹配总额不能超过报告总额。");
  await expect(result).toHaveAttribute("data-dirty", "true");

  await reconciliationForm.getByLabel("已匹配总额").fill("0.8");
  await reconciliationForm.getByRole("button", { name: "导入对账摘要" }).click();
  await expect(reconciliationForm.getByRole("status")).toHaveText("对账摘要已提交，原始发票不会进入系统。");
  await expect(result).toHaveAttribute("data-kind", "reconciliation");
  await expect(result).toHaveAttribute("data-dirty", "false");

  const budgetPolicyForm = page.locator("form").filter({ hasText: "新增预算策略版本" });
  await budgetPolicyForm.getByLabel("策略模式").selectOption("soft");
  await budgetPolicyForm.getByRole("button", { name: "保存预算策略" }).click();
  await expect(budgetPolicyForm.getByRole("status")).toContainText("预算策略版本已提交");
  await expect(result).toHaveAttribute("data-kind", "budget-policy");
  await expect(result).toHaveAttribute("data-dirty", "false");

  const budgetActionForm = page.locator("form").filter({ hasText: "处理预算占用" });
  await budgetActionForm.getByLabel("处理方式").selectOption("release");
  await budgetActionForm.getByLabel("处理原因").fill("fixture operator release");
  await budgetActionForm.getByRole("button", { name: "提交预算处理" }).click();
  await expect(budgetActionForm.getByRole("status")).toContainText("预算占用已人工释放");
  await expect(result).toHaveAttribute("data-kind", "budget-release");
  await expect(result).toHaveAttribute("data-dirty", "false");
  const geometry = await page.evaluate(() => {
    const main = document.querySelector<HTMLElement>('main[data-visual-fixture="true"]');
    const forms = [...document.querySelectorAll<HTMLElement>(".admin-finance-form")];
    const viewportWidth = document.documentElement.clientWidth;
    if (!main || forms.length !== 4) throw new Error("missing finance fixture forms");
    return {
      documentFits: document.documentElement.scrollWidth <= viewportWidth,
      bodyFits: document.body.scrollWidth <= document.body.clientWidth,
      mainFits: main.getBoundingClientRect().right <= viewportWidth,
      formsFit: forms.every((form) => form.getBoundingClientRect().right <= viewportWidth),
    };
  });
  expect(geometry).toEqual({ documentFits: true, bodyFits: true, mainFits: true, formsFit: true });
  await attachScreenshot(page, testInfo, "operations-finance-entry");
});

test("shared confirmation dialog traps and restores focus while keeping failures retryable", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440", "dialog behavior needs one desktop browser pass");
  await page.goto("/?view=confirm-dialog");
  const opener = page.getByRole("button", { name: "打开合成确认" });
  await opener.click();
  let dialog = page.getByRole("dialog", { name: "确认合成危险操作？" });
  const cancel = dialog.getByRole("button", { name: "取消" });
  const confirm = dialog.getByRole("button", { name: "确认执行" });
  const close = dialog.getByRole("button", { name: "关闭确认窗口" });
  await expect(cancel).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(confirm).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();

  await opener.click();
  dialog = page.getByRole("dialog", { name: "确认合成危险操作？" });
  await dialog.getByRole("button", { name: "确认执行" }).click();
  await expect(dialog.getByRole("button", { name: "处理中..." })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("alert")).toHaveText("合成提交失败，请重试。");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "确认执行" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "后续焦点" })).toBeFocused();
  await expect(page.getByText("合成操作已完成。", { exact: true })).toBeVisible();
});

test("admin setup guide keeps the six-step order and runs model-free smoke", async ({ page }, testInfo) => {
  test.skip(!["desktop-1440", "touch-390"].includes(testInfo.project.name), "setup coverage targets desktop and 390px");
  let setupStatus = {
    ...adminSetupReady,
    ready: false,
    steps: {
      ...adminSetupReady.steps,
      smoke: { ready: false, status: "not_run", count: 0 },
    },
  };
  let smokeRuns = 0;
  await page.route("**/api/admin/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body: unknown) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
    if (url.pathname === "/api/admin/config" && request.method() === "GET") {
      await json({ config: adminMemberConfig, source: "kv", revision: "a".repeat(64) });
      return;
    }
    if (url.pathname === "/api/admin/members" && request.method() === "GET") {
      await json({ members: [{ label: "bill", displayName: "Bill", configured: true, hasAccessCode: true }], accessRevision: "c".repeat(64), accessSource: "managed" });
      return;
    }
    if (url.pathname === "/api/admin/setup-status" && request.method() === "GET") {
      await json(setupStatus);
      return;
    }
    if (url.pathname === "/api/admin/setup-smoke" && request.method() === "POST") {
      smokeRuns += 1;
      setupStatus = adminSetupReady;
      await json(setupStatus);
      return;
    }
    throw new Error(`unexpected setup fixture request: ${request.method()} ${url.pathname}`);
  });

  await page.goto("/?view=admin-members");
  await expect(page.getByRole("heading", { name: "首次配置" })).toBeVisible();
  await expect(page.locator(".typed-admin-setup-copy strong")).toHaveText([
    "运行健康",
    "Provider 密钥",
    "Logical model / offering",
    "首位成员",
    "成员权限",
    "无模型 smoke",
  ]);
  await expect(page.locator('a[href="/admin.html"]')).toHaveCount(0);
  await page.getByRole("button", { name: "运行 smoke" }).click();
  await expect(page.getByText("全部就绪", { exact: true })).toBeVisible();
  expect(smokeRuns).toBe(1);

  await page.getByRole("button", { name: "配置权限" }).click();
  await expect(page.getByRole("heading", { name: "默认配置" })).toBeVisible();
  const geometry = await page.evaluate(() => ({
    documentFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    bodyFits: document.body.scrollWidth <= document.body.clientWidth,
  }));
  expect(geometry.documentFits).toBe(true);
  expect(geometry.bodyFits).toBe(true);
  await attachScreenshot(page, testInfo, "admin-setup-guide");
});

test("provider migration exposes bounded statuses and submits only safe routes", async ({ page }, testInfo) => {
  test.skip(!["desktop-1440", "touch-390"].includes(testInfo.project.name), "provider migration coverage targets desktop and 390px");
  const currentConfig: AdminConfig = structuredClone(adminMemberConfig);
  currentConfig.routes = {
    ...currentConfig.routes,
    legacyReady: {
      label: "Legacy ready",
      enabled: true,
      type: "openai-chat",
      baseUrl: "https://provider.example/v1",
      model: "synthetic-legacy-ready",
      apiKeyRef: "READY_KEY",
      hasLegacyKey: true,
      fallbacks: ["primary"],
      maxTokens: 321,
      temperature: 0.2,
      supportsImages: false,
      supportsTools: true,
    },
    legacyBlocked: {
      label: "Legacy blocked",
      enabled: true,
      type: "anthropic-messages",
      baseUrl: "https://provider.example/v1",
      model: "synthetic-legacy-blocked",
      hasLegacyKey: true,
    },
  };
  const migratedConfig: AdminConfig = structuredClone(currentConfig);
  const migratedRoute = { ...migratedConfig.routes.legacyReady };
  delete migratedRoute.type;
  delete migratedRoute.baseUrl;
  delete migratedRoute.model;
  delete migratedRoute.apiKeyRef;
  delete migratedRoute.authHeader;
  delete migratedRoute.authPrefix;
  delete migratedRoute.directEndpoint;
  migratedConfig.routes.legacyReady = {
    ...migratedRoute,
    offerings: [{ providerId: "legacyReady-provider", model: "synthetic-legacy-ready", enabled: true }],
  };
  migratedConfig.providers["legacyReady-provider"] = {
    label: "Legacy ready",
    type: "openai-chat",
    baseUrl: "https://provider.example/v1",
    apiKeyRef: "READY_KEY",
    enabled: true,
    supportsImages: false,
    supportsTools: true,
  };
  let revision = "a".repeat(64);
  let migrationPayload: { routeIds: string[]; expectedRevision: string } | null = null;
  let postMigrationConfigRead = false;

  await page.route("**/api/admin/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = async (body: unknown, status = 200) => route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
    if (url.pathname === "/api/admin/config" && request.method() === "GET") {
      if (migrationPayload) postMigrationConfigRead = true;
      await json({ config: migrationPayload ? migratedConfig : currentConfig, source: "kv", revision });
      return;
    }
    if (url.pathname === "/api/admin/members" && request.method() === "GET") {
      await json({ members: [{ label: "bill", displayName: "Bill", configured: true, hasAccessCode: true }], accessRevision: "c".repeat(64), accessSource: "managed" });
      return;
    }
    if (url.pathname === "/api/admin/setup-status" && request.method() === "GET") {
      await json(adminSetupReady);
      return;
    }
    if (url.pathname === "/api/admin/route-secrets" && request.method() === "GET") {
      await json({
        masterKeyReady: true,
        items: [{ apiKeyRef: "READY_KEY", source: "managed", status: "configured", managed: true, environmentFallback: false }],
      });
      return;
    }
    if (url.pathname === "/api/admin/legacy-routes/migrate" && request.method() === "POST") {
      migrationPayload = request.postDataJSON() as { routeIds: string[]; expectedRevision: string };
      expect(migrationPayload).toEqual({ routeIds: ["legacyReady"], expectedRevision: "a".repeat(64) });
      revision = "b".repeat(64);
      await json({
        revision,
        migrated: ["legacyReady"],
        alreadyMigrated: [],
        statuses: [
          { routeId: "legacyReady", status: "migrated" },
        ],
      });
      return;
    }
    throw new Error(`unexpected provider migration fixture request: ${request.method()} ${url.pathname}`);
  });

  await page.goto("/?view=admin-members");
  await expect(page.getByRole("button", { name: "服务商" })).toBeVisible();
  await page.getByRole("button", { name: "服务商" }).click();
  await expect(page.getByRole("heading", { name: "2 条旧线路待迁移" })).toBeVisible();
  await expect(page.getByText("legacyReady", { exact: true })).toBeVisible();
  await expect(page.getByText("需先保存 Key Ref", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "迁移可安全线路" })).toBeEnabled();
  await page.getByRole("button", { name: "迁移可安全线路" }).click();
  const dialog = page.getByRole("dialog", { name: "迁移 1 条旧线路？" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("legacyReady");
  await expect(dialog).not.toContainText("legacyBlocked");
  await dialog.getByRole("button", { name: "确认迁移" }).click();
  await expect(page.getByText("已迁移 1 条旧线路。", { exact: true })).toBeVisible();
  await expect(page.getByText("服务商 ID：legacyReady-provider", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "1 条旧线路待迁移" })).toBeVisible();
  const migratedProviderItem = page.getByRole("listbox", { name: "服务商列表" }).getByRole("button").filter({ hasText: "服务商 ID：legacyReady-provider" });
  await migratedProviderItem.focus();
  await expect(migratedProviderItem).toBeFocused();
  await migratedProviderItem.press("Enter");
  await expect(page.getByText("Legacy ready（模型 ID：legacyReady）", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "逻辑模型" }).click();
  await expect(page.getByText("模型 ID：legacyReady · 1 个服务商出口", { exact: true })).toBeVisible();
  const migratedLogicalModelItem = page.getByRole("listbox", { name: "逻辑模型列表" }).getByRole("button").filter({ hasText: "模型 ID：legacyReady · 1 个服务商出口" });
  await migratedLogicalModelItem.focus();
  await expect(migratedLogicalModelItem).toBeFocused();
  await migratedLogicalModelItem.press("Enter");
  await expect(page.locator('option[value="legacyReady-provider"]')).toHaveText("Legacy ready（服务商 ID：legacyReady-provider）");
  const offeringProviderIdentity = page.locator(".admin-offering-identity", { hasText: "服务商 ID：legacyReady-provider" });
  await expect(offeringProviderIdentity).toBeVisible();
  await offeringProviderIdentity.scrollIntoViewIfNeeded();
  expect(migrationPayload).toEqual({ routeIds: ["legacyReady"], expectedRevision: "a".repeat(64) });
  expect(postMigrationConfigRead).toBe(true);

  const geometry = await page.evaluate(() => ({
    documentFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    bodyFits: document.body.scrollWidth <= document.body.clientWidth,
  }));
  expect(geometry.documentFits).toBe(true);
  expect(geometry.bodyFits).toBe(true);
  await attachScreenshot(page, testInfo, "admin-provider-migration");
});

test("admin workspace initial error is distinct from loading and retryable", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440", "state transition coverage needs one desktop browser pass");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let allowSuccess = false;
  await page.route("**/api/admin/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== "GET" || !["/api/admin/config", "/api/admin/members", "/api/admin/setup-status"].includes(url.pathname)) {
      throw new Error(`unexpected admin state request: ${request.method()} ${url.pathname}`);
    }
    await gate;
    if (!allowSuccess) {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "fixture_unavailable", message: "合成后台读取失败。" }) });
      return;
    }
    if (url.pathname === "/api/admin/config") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ config: adminMemberConfig, source: "kv", revision: "a".repeat(64) }) });
    } else if (url.pathname === "/api/admin/setup-status") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(adminSetupReady) });
    } else {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ members: [{ label: "bill", displayName: "Bill", configured: true, hasAccessCode: true }], accessRevision: "c".repeat(64), accessSource: "managed" }) });
    }
  });

  await page.goto("/?view=admin-members");
  await expect(page.getByText("正在读取配置...", { exact: true }).first()).toBeVisible();
  release();
  await expect(page.getByRole("heading", { name: "无法读取管理配置" })).toBeVisible();
  await expect(page.getByText("正在读取配置...", { exact: true })).toHaveCount(0);
  allowSuccess = true;
  await page.getByRole("button", { name: "重试读取配置" }).click();
  await expect(page.getByRole("heading", { name: "默认配置" })).toBeVisible();
});

test("admin logout keeps the workspace until server revocation succeeds", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440", "logout transition coverage needs one desktop browser pass");
  let logoutAttempts = 0;
  await page.route("**/api/admin/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body: unknown, status = 200) => route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
    if (url.pathname === "/api/admin/config" && request.method() === "GET") {
      await json({ config: adminMemberConfig, source: "kv", revision: "a".repeat(64) });
      return;
    }
    if (url.pathname === "/api/admin/members" && request.method() === "GET") {
      await json({ members: [], accessRevision: "c".repeat(64), accessSource: "managed" });
      return;
    }
    if (url.pathname === "/api/admin/setup-status" && request.method() === "GET") {
      await json(adminSetupReady);
      return;
    }
    if (url.pathname === "/api/admin/logout" && request.method() === "POST") {
      logoutAttempts += 1;
      await json(logoutAttempts === 1
        ? { error: "internal_error", message: "合成会话撤销失败，请重试。" }
        : { ok: true }, logoutAttempts === 1 ? 500 : 200);
      return;
    }
    throw new Error(`unexpected logout fixture request: ${request.method()} ${url.pathname}`);
  });

  await page.goto("/?view=admin-members");
  await expect(page.getByRole("heading", { name: "默认配置" })).toBeVisible();
  await page.getByRole("button", { name: "退出" }).click();
  await expect(page.getByRole("alert")).toContainText("合成会话撤销失败，请重试。");
  await expect(page.getByRole("heading", { name: "默认配置" })).toBeVisible();
  await expect(page.getByText("管理员 fixture 已退出。", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "重试退出" }).click();
  await expect(page.getByText("管理员 fixture 已退出。", { exact: true })).toBeVisible();
  expect(logoutAttempts).toBe(2);
});

test("operations initial error is distinct from loading and retryable", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440", "state transition coverage needs one desktop browser pass");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let allowSuccess = false;
  await page.route("**/api/admin/**", async (route) => {
    const url = new URL(route.request().url());
    await gate;
    if (!allowSuccess) {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "fixture_unavailable", message: "合成运营读取失败。" }) });
      return;
    }
    const body = url.pathname === "/api/admin/stats"
      ? {
          day: "2026-07-26",
          days: ["2026-07-26"],
          totals: { requests: 0, errors: 0, fallbacks: 0, rateLimited: 0, errorRate: 0 },
          trend: [{ day: "2026-07-26", requests: 0, errors: 0, fallbacks: 0, rateLimited: 0, errorRate: 0 }],
          routeStats: [],
          users: [],
          routes: [],
          configSource: "kv",
          accessCodeSource: "managed",
        }
      : url.pathname === "/api/admin/provider-finance"
        ? {
            version: 1,
            generatedAt: 1785032000000,
            periodStart: 1782440000000,
            hardBudgetEnforcement: "instance_provider_v1",
            providers: [],
          }
        : url.pathname === "/api/admin/legacy-surfaces"
          ? {
              version: 1,
              manifestDigest: "a".repeat(64),
              generatedAt: 1785032000000,
              total: 1,
              surfaces: [{
                version: 1,
                surfaceId: "legacy.surface-alpha",
                revision: 0,
                manifestVersion: 1,
                manifestDigest: "a".repeat(64),
                phase: "discovered",
                readControl: "enabled",
                writeControl: "enabled",
                owner: "unassigned",
                blockerCodes: ["maximum_phase_reached", "owner_unassigned"],
                observationStartedAt: 0,
                observationRequiredUntil: 0,
                lastTransitionAt: 0,
                lastDeploymentSha: "",
                evidence: { required: 0, present: 0, complete: true },
                allowedActions: [],
              }],
            }
          : { entries: [] };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });

  await page.goto("/?view=operations-panel");
  await expect(page.getByText("正在读取运营数据...", { exact: true })).toBeVisible();
  release();
  await expect(page.getByRole("heading", { name: "无法读取运营数据" })).toBeVisible();
  await expect(page.getByText("正在读取运营数据...", { exact: true })).toHaveCount(0);
  allowSuccess = true;
  await page.getByRole("button", { name: "重试读取运营数据" }).click();
  await expect(page.getByLabel("7 日运营摘要")).toBeVisible();
});

test("member policy editing and usage reset stay usable on desktop and touch", async ({ page }, testInfo) => {
  test.skip(!["desktop-1440", "touch-390"].includes(testInfo.project.name), "member policy coverage targets desktop and 390px");
  let currentConfig: AdminConfig = structuredClone(adminMemberConfig);
  let revision = "a".repeat(64);
  const savedConfigs: AdminConfig[] = [];
  let sessionRetryCount = 0;
  let setupStatusReads = 0;

  await page.route("**/api/admin/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = async (body: unknown) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });

    if (url.pathname === "/api/admin/config" && request.method() === "GET") {
      await json({ config: currentConfig, source: "kv", revision });
      return;
    }
    if (url.pathname === "/api/admin/members" && request.method() === "GET") {
      await json({
        members: [{ label: "bill", displayName: "Bill", configured: true, hasAccessCode: true }],
        accessRevision: "c".repeat(64),
        accessSource: "managed",
      });
      return;
    }
    if (url.pathname === "/api/admin/setup-status" && request.method() === "GET") {
      setupStatusReads += 1;
      await json(adminSetupReady);
      return;
    }
    if (url.pathname === "/api/admin/config" && request.method() === "PUT") {
      const payload = request.postDataJSON() as { config: AdminConfig; expectedRevision: string };
      expect(payload.expectedRevision).toBe(revision);
      currentConfig = payload.config;
      savedConfigs.push(structuredClone(payload.config));
      revision = "b".repeat(64);
      await json({ config: currentConfig, source: "kv", revision });
      return;
    }
    if (url.pathname === "/api/admin/usage" && request.method() === "POST") {
      expect(request.postDataJSON()).toEqual({ label: "bill" });
      await json({ ok: true, label: "bill", day: "2026-07-26" });
      return;
    }
    if (url.pathname === "/api/admin/members/bill/access-code" && request.method() === "DELETE") {
      expect(request.postDataJSON()).toEqual({ expectedAccessRevision: "c".repeat(64) });
      await json({
        member: { label: "bill", displayName: "Bill", configured: true, hasAccessCode: false },
        accessRevision: "d".repeat(64),
        sessionRevocation: { revoked: 1, complete: false },
      });
      return;
    }
    if (url.pathname === "/api/admin/sessions/revoke" && request.method() === "POST") {
      expect(request.postDataJSON()).toEqual({ label: "bill" });
      sessionRetryCount += 1;
      await json({ ok: true, label: "bill", revoked: 1, complete: true });
      return;
    }
    throw new Error(`unexpected admin fixture request: ${request.method()} ${url.pathname}`);
  });

  await page.goto("/?view=admin-members");
  if (testInfo.project.name === "touch-390") {
    await page.getByRole("combobox", { name: "选择成员" }).selectOption("bill");
  } else {
    await page.locator(".typed-admin-member").filter({ hasText: "Bill" }).click();
  }

  const policyHeading = page.getByRole("heading", { name: "使用策略" });
  await policyHeading.scrollIntoViewIfNeeded();
  await expect(policyHeading).toBeVisible();
  await expect(page.getByLabel("继承默认状态")).toBeChecked();
  await expect(page.getByLabel("继承默认每日额度")).toBeChecked();
  await expect(page.getByLabel("继承默认每分钟额度")).toBeChecked();

  await page.getByLabel("继承默认状态").uncheck();
  await page.getByLabel("允许使用").uncheck();
  await page.getByLabel("继承默认每日额度").uncheck();
  const dailyLimitInput = page.getByLabel("每日消息额度");
  await dailyLimitInput.fill("");
  await expect(dailyLimitInput).toHaveAttribute("aria-describedby", "typed-admin-policy-daily-error");
  await expect(page.locator("#typed-admin-policy-daily-error")).toHaveText("每日消息额度必须是正整数。");
  await expect(page.getByRole("button", { name: "保存分配" })).toBeDisabled();
  await dailyLimitInput.fill("250");
  await page.getByRole("button", { name: "保存分配" }).click();
  await expect(page.getByText("成员分配与使用策略已保存。", { exact: true })).toBeVisible();
  expect(savedConfigs).toHaveLength(1);
  expect(setupStatusReads).toBeGreaterThanOrEqual(2);
  expect(savedConfigs[0].users.bill).toMatchObject({ displayName: "Bill", enabled: false, dailyMessageLimit: 250 });
  expect(savedConfigs[0].users.bill.minuteMessageLimit).toBeUndefined();

  await page.getByRole("button", { name: "重置今日用量" }).click();
  const dialog = page.getByRole("dialog", { name: "重置今日用量" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "重置今日用量" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("bill 的今日用量已重置。", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "撤销访问" }).click();
  const revokeDialog = page.getByRole("dialog", { name: "撤销成员访问" });
  await expect(revokeDialog).toBeVisible();
  await revokeDialog.getByRole("button", { name: "确认撤销" }).click();
  await expect(revokeDialog).toHaveCount(0);
  await expect(page.getByText("bill 的访问码已撤销，但会话注销未完成。", { exact: true })).toBeVisible();
  if (testInfo.project.name === "touch-390") {
    await page.getByRole("combobox", { name: "选择成员" }).selectOption("");
  } else {
    await page.locator(".typed-admin-member").filter({ hasText: "默认配置" }).click();
  }
  await expect(page.getByRole("button", { name: "重试注销会话" })).toBeVisible();
  await page.getByRole("button", { name: "重试注销会话" }).click();
  await expect(page.getByText("已注销 bill 的 1 个会话。", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "重试注销会话" })).toHaveCount(0);
  expect(sessionRetryCount).toBe(1);

  const geometry = await page.evaluate(() => {
    const policy = document.querySelector<HTMLElement>('[aria-labelledby="capability-policy"]');
    if (!policy) throw new Error("missing member policy section");
    const rect = policy.getBoundingClientRect();
    return {
      documentFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      policyFits: rect.left >= 0 && rect.right <= document.documentElement.clientWidth + 1,
    };
  });
  expect(geometry.documentFits).toBe(true);
  expect(geometry.policyFits).toBe(true);
  await attachScreenshot(page, testInfo, "admin-member-policy");
});

test("capability registry keeps drafts, secrets, and review actions contained", async ({ page }, testInfo) => {
  test.skip(!["desktop-1440", "touch-390"].includes(testInfo.project.name), "capability registry coverage targets desktop and 390px");
  let currentConfig: AdminConfig = structuredClone(adminMemberConfig);
  currentConfig.tools["mcp:docs:search"] = {
    enabled: false,
    label: "Legacy documentation search",
    description: "Synthetic tool persisted before MCP governance fields were introduced.",
    inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    confirmation: "first-per-conversation",
    executor: { type: "mcp", serverId: "docs", remoteName: "search" },
    reviewRequired: true,
  };
  let revision = "a".repeat(64);
  let secretWriteCount = 0;
  let discoveryCount = 0;

  await page.route("**/api/admin/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = async (body: unknown, status = 200) => route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });

    if (url.pathname === "/api/admin/config" && request.method() === "GET") {
      await json({ config: currentConfig, source: "kv", revision });
      return;
    }
    if (url.pathname === "/api/admin/members" && request.method() === "GET") {
      await json({ members: [{ label: "bill", displayName: "Bill", configured: true, hasAccessCode: true }], accessRevision: "c".repeat(64), accessSource: "managed" });
      return;
    }
    if (url.pathname === "/api/admin/setup-status" && request.method() === "GET") {
      await json(adminSetupReady);
      return;
    }
    if (url.pathname === "/api/admin/mcp-secrets" && request.method() === "GET") {
      await json({
        masterKeyReady: true,
        items: [{
          secretRef: "DOCS_MCP",
          source: "managed",
          status: "configured",
          managed: true,
          environmentFallback: false,
          updatedAt: "2026-07-26T12:00:00.000Z",
          revision: "s".repeat(64),
        }],
      });
      return;
    }
    if (url.pathname === "/api/admin/mcp-secrets/DOCS_MCP" && request.method() === "PUT") {
      const payload = request.postDataJSON() as { secret: string; expectedRevision?: string };
      expect(payload.secret).toBe(" not-a-real-secret ");
      expect(payload.expectedRevision).toBe("s".repeat(64));
      secretWriteCount += 1;
      await json({
        ok: true,
        item: {
          secretRef: "DOCS_MCP",
          source: "managed",
          status: "configured",
          managed: true,
          environmentFallback: false,
          updatedAt: "2026-07-26T12:05:00.000Z",
          revision: "t".repeat(64),
        },
      });
      return;
    }
    if (url.pathname === "/api/admin/mcp-discovery" && request.method() === "POST") {
      expect(request.postDataJSON()).toEqual({
        serverId: "docs",
        label: currentConfig.mcpServers.docs.label,
        endpoint: "https://docs.example/mcp",
        auth: { version: 1, type: "bearer", secretRef: "DOCS_MCP" },
      });
      discoveryCount += 1;
      await json({
        serverId: "docs",
        tools: [{
          id: "mcp:docs:search",
          label: "Search remote documentation v2",
          description: "Synthetic reviewed read-only remote tool.",
          inputSchema: { type: "object", properties: { query: { type: "string" }, scope: { type: "string" } }, required: ["query"] },
          confirmation: "first-per-conversation",
          executor: { type: "mcp", serverId: "docs", remoteName: "search" },
          schemaFingerprint: "e".repeat(64),
          securityFingerprint: "f".repeat(64),
          sideEffect: "read",
          reviewRevision: "a".repeat(64),
          reviewRequired: true,
        }],
        rejected: 1,
      });
      return;
    }
    if (url.pathname === "/api/admin/config" && request.method() === "PUT") {
      const payload = request.postDataJSON() as { config: AdminConfig; expectedRevision: string };
      expect(payload.expectedRevision).toBe(revision);
      currentConfig = payload.config;
      revision = "b".repeat(64);
      await json({ config: currentConfig, source: "kv", revision });
      return;
    }
    throw new Error(`unexpected capability fixture request: ${request.method()} ${url.pathname}`);
  });

  await page.goto("/?view=admin-members");
  await expect(page.getByText("无法读取管理配置", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "AI 能力" }).click();
  await expect(page.getByRole("heading", { name: "Skills", exact: true })).toBeVisible();

  const skillName = page.getByLabel("显示名称");
  await skillName.fill("Unsaved synthetic Skill title");
  await page.getByRole("tab", { name: "工具" }).click();
  const discardDialog = page.getByRole("dialog", { name: "放弃当前草稿？" });
  await expect(discardDialog).toBeVisible();
  await expect(discardDialog.getByRole("button", { name: "取消" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(discardDialog).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "工具" })).toBeFocused();
  await page.getByRole("tab", { name: "工具" }).click();
  await page.getByRole("dialog", { name: "放弃当前草稿？" }).getByRole("button", { name: "放弃并切换" }).click();
  await expect(page.getByRole("heading", { name: "工具", exact: true })).toBeVisible();

  await page.getByRole("tab", { name: "工具" }).press("ArrowRight");
  await expect(page.getByRole("tab", { name: "MCP" })).toBeFocused();
  await expect(page.getByRole("heading", { name: "MCP Servers", exact: true })).toBeVisible();
  const secretInput = page.getByLabel("MCP 托管密钥");
  await secretInput.fill(" not-a-real-secret ");
  await secretInput.press("Enter");
  await expect(secretInput).toHaveValue("");
  expect(secretWriteCount).toBe(1);

  await page.getByRole("button", { name: "发现工具" }).click();
  await expect(page.getByText(/治理变更 1/)).toBeVisible();
  expect(discoveryCount).toBe(1);
  expect(currentConfig.tools["mcp:docs:search"]).toMatchObject({ enabled: false, schemaFingerprint: "e".repeat(64) });

  const deleteButton = page.getByRole("button", { name: "删除", exact: true });
  await deleteButton.click();
  const deleteDialog = page.getByRole("dialog", { name: /删除 MCP Server/ });
  await expect(deleteDialog).toBeVisible();
  await expect(deleteDialog.getByRole("button", { name: "取消" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(deleteDialog).toHaveCount(0);
  await expect(deleteButton).toBeFocused();

  const geometry = await page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>(".capability-admin-panel");
    if (!panel) throw new Error("missing capability admin panel");
    const rect = panel.getBoundingClientRect();
    return {
      documentFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      bodyFits: document.body.scrollWidth <= document.body.clientWidth,
      panelFits: rect.left >= 0 && rect.right <= document.documentElement.clientWidth + 1,
    };
  });
  expect(geometry).toEqual({ documentFits: true, bodyFits: true, panelFits: true });
  await attachScreenshot(page, testInfo, "admin-capabilities");

  await deleteButton.click();
  await page.getByRole("dialog", { name: /删除 MCP Server/ }).getByRole("button", { name: "删除 Server" }).click();
  await expect(page.getByRole("tab", { name: "MCP" })).toBeFocused();
  await expect(page.getByText("暂无MCP Server", { exact: true })).toBeVisible();
  expect(currentConfig.mcpServers.docs).toBeUndefined();
  expect(currentConfig.tools["mcp:docs:search"]).toBeUndefined();
  expect(currentConfig.tools["builtin:text_stats"]).toBeDefined();
  expect(currentConfig.providers.shared).toBeDefined();
  expect(currentConfig.users.bill).toBeDefined();
});

test("member OAuth MCP connections stay actionable and contained", async ({ page }, testInfo) => {
  await page.goto("/?view=mcp-connections");
  const dialog = page.getByRole("dialog", { name: "MCP 连接" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".mcp-connection-row")).toHaveCount(3);
  await expect(dialog.getByText("已连接", { exact: true })).toBeVisible();
  await expect(dialog.getByText("需要重审", { exact: true })).toBeVisible();
  await expect(dialog.getByText("未连接", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "关闭 MCP 连接" })).toBeFocused();

  await dialog.getByRole("button", { name: "生成发现候选" }).click();
  await expect(dialog.getByText("已生成发现候选：3 个工具，1 个被拒绝。")).toBeVisible();

  const geometry = await page.evaluate(() => {
    const dialogElement = document.querySelector<HTMLElement>(".mcp-connections-dialog");
    if (!dialogElement) throw new Error("missing MCP connection dialog");
    const rect = dialogElement.getBoundingClientRect();
    return {
      documentFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      dialogFits: rect.left >= 0 && rect.right <= document.documentElement.clientWidth + 1,
      contentFits: dialogElement.scrollWidth <= dialogElement.clientWidth + 1,
    };
  });
  expect(geometry).toEqual({ documentFits: true, dialogFits: true, contentFits: true });
  await attachScreenshot(page, testInfo, "mcp-connections");
});

test("owner manages conversation shares with accessible pending confirmation", async ({ page }) => {
  await page.goto("/?acl=owner&drawer=open&shareDelay=1");
  const opener = page.getByRole("button", { name: "管理共享" });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "共享对话" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByPlaceholder("输入精确成员标签")).toBeFocused();
  await expect(dialog.getByText("visual-grantee", { exact: true })).toBeVisible();

  await dialog.getByPlaceholder("输入精确成员标签").fill("visual-editor");
  await dialog.locator(".share-grant-form select").selectOption("editor");
  await dialog.getByRole("button", { name: "添加共享" }).click();
  const addedRow = dialog.locator(".share-grant-row").filter({ hasText: "visual-editor" });
  await expect(addedRow).toBeVisible();
  await expect(addedRow.locator("select")).toHaveValue("editor");

  await addedRow.locator("select").selectOption("viewer");
  await expect(addedRow.locator("select")).toHaveValue("viewer");
  const revokeButton = addedRow.getByRole("button", { name: "撤销 visual-editor 的共享" });
  await revokeButton.click();
  const confirm = page.getByRole("dialog", { name: "撤销共享？" });
  await expect(confirm.getByRole("button", { name: "取消" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(confirm).toHaveCount(0);
  await expect(revokeButton).toBeFocused();

  await revokeButton.click();
  await confirm.getByRole("button", { name: "撤销共享" }).click();
  await expect(confirm.getByRole("button", { name: "撤销中..." })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(confirm).toBeVisible();
  await expect(confirm).toHaveCount(0);
  await expect(addedRow).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test("share retries replay the same operation identity", async ({ page }) => {
  await page.goto("/?acl=owner&drawer=open&shareFailure=once");
  await page.getByRole("button", { name: "管理共享" }).click();
  const dialog = page.getByRole("dialog", { name: "共享对话" });
  await dialog.getByPlaceholder("输入精确成员标签").fill("visual-retry");
  await dialog.getByRole("button", { name: "添加共享" }).click();
  await expect(dialog.getByText("合成共享写入已提交，但响应暂时不可用。")).toBeVisible();
  await dialog.getByRole("button", { name: "重试" }).click();
  await expect(dialog.getByText("visual-retry", { exact: true })).toBeVisible();

  const stateAfterGrant = shareFixtureStates.get(page);
  expect(stateAfterGrant?.upsertOperationIds).toHaveLength(2);
  expect(new Set(stateAfterGrant?.upsertOperationIds).size).toBe(1);

  const retryRow = dialog.locator(".share-grant-row").filter({ hasText: "visual-retry" });
  await retryRow.getByRole("button", { name: "撤销 visual-retry 的共享" }).click();
  const confirm = page.getByRole("dialog", { name: "撤销共享？" });
  await confirm.getByRole("button", { name: "撤销共享" }).click();
  await expect(confirm.getByText("合成共享写入已提交，但响应暂时不可用。")).toBeVisible();
  await confirm.getByRole("button", { name: "撤销共享" }).click();
  await expect(confirm).toHaveCount(0);
  await expect(retryRow).toHaveCount(0);

  const stateAfterRevoke = shareFixtureStates.get(page);
  expect(stateAfterRevoke?.revokeOperationIds).toHaveLength(2);
  expect(new Set(stateAfterRevoke?.revokeOperationIds).size).toBe(1);
});

test("share list load failure recovers without leaving the dialog", async ({ page }) => {
  await page.goto("/?acl=owner&drawer=open&shareLoadError=once");
  await page.getByRole("button", { name: "管理共享" }).click();
  const dialog = page.getByRole("dialog", { name: "共享对话" });
  await expect(dialog.getByText("合成共享列表暂时不可用。")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "重试" })).toBeFocused();
  await dialog.getByRole("button", { name: "重试" }).click();
  await expect(dialog.getByText("visual-grantee", { exact: true })).toBeVisible();
});

test("viewer and editor receive only their bounded conversation controls", async ({ page }) => {
  await page.goto("/?acl=viewer&drawer=open");
  const viewerRow = page.locator(".conversation-row.active");
  await expect(page.getByText("查看者", { exact: true }).first()).toBeVisible();
  await expect(page.locator(".composer")).toHaveCount(0);
  await expect(page.getByText("查看者权限：可以阅读这段对话，但不能发送消息或修改内容。", { exact: true })).toBeVisible();
  await expect(viewerRow.getByRole("button", { name: "重命名", exact: true })).toHaveCount(0);
  await expect(viewerRow.getByRole("button", { name: "删除会话", exact: true })).toHaveCount(0);
  await expect(viewerRow.getByRole("button", { name: "管理共享", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "文件", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "设置", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "查看线路与状态" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "记忆" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /MCP 连接/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "编辑并分支发送" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "重新生成并创建分支" })).toHaveCount(0);

  await page.goto("/?acl=editor&drawer=open");
  const editorRow = page.locator(".conversation-row.active");
  await expect(page.getByText("编辑者", { exact: true }).first()).toBeVisible();
  await expect(page.locator(".composer")).toBeVisible();
  await expect(page.getByRole("button", { name: "当前会话不支持附件" })).toBeDisabled();
  await expect(editorRow.getByRole("button", { name: "重命名", exact: true })).toBeVisible();
  await expect(editorRow.getByRole("button", { name: "删除会话", exact: true })).toHaveCount(0);
  await expect(editorRow.getByRole("button", { name: "管理共享", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "文件", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "设置", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "编辑并分支发送" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "重新生成并创建分支" })).toHaveCount(0);

  const containment = await page.evaluate(() => ({
    documentFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    bodyFits: document.body.scrollWidth <= document.body.clientWidth,
  }));
  expect(containment).toEqual({ documentFits: true, bodyFits: true });
});

test("mobile drawer and delete confirmation preserve focus", async ({ page }, testInfo) => {
  test.skip((page.viewportSize()?.width || 0) > 780, "drawer behavior applies at the mobile breakpoint");

  const opener = page.getByRole("button", { name: "打开会话" });
  await opener.click();
  const close = page.locator("[data-sidebar-initial-focus=true]");
  await expect(close).toBeFocused();
  await expect(page.locator(".conversation-sidebar")).toHaveClass(/open/);

  const deleteButton = page.getByRole("button", { name: "删除会话" }).first();
  await deleteButton.click();
  await expect(page.getByRole("dialog", { name: "删除这段对话？" })).toBeVisible();
  await expect(page.getByRole("button", { name: "取消" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "删除这段对话？" })).toHaveCount(0);
  await expect(deleteButton).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(page.locator(".conversation-sidebar")).not.toHaveClass(/open/);
  await expect(opener).toBeFocused();
  await attachScreenshot(page, testInfo, "drawer-closed");
});

async function releaseLegacySurfaceTransition(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.dispatchEvent(new Event("chatus:fixture:legacy-surface-transition-release"));
  });
}

async function attachScreenshot(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}-${testInfo.project.name}.png`);
  await page.screenshot({ path, fullPage: false, animations: "disabled" });
  await testInfo.attach(`${name}-${testInfo.project.name}`, {
    path,
    contentType: "image/png",
  });
}
