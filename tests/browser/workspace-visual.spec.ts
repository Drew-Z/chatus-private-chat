import { expect, test, type Page, type TestInfo } from "@playwright/test";
import type { AdminConfig } from "../../client/src/lib/api";

const blockedRequests = new WeakMap<Page, string[]>();

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
    },
  },
  mcpServers: {
    docs: {
      enabled: true,
      label: "Documentation service with a long synthetic name",
      endpoint: "https://docs.example/mcp",
      authType: "bearer",
      secretRef: "DOCS_MCP",
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
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
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

test("message edit restores focus and rich content remains visible", async ({ page }) => {
  const edit = page.getByRole("button", { name: "编辑并分支发送" });
  await edit.click();
  const editor = page.getByRole("textbox", { name: "编辑消息" });
  await expect(editor).toBeFocused();
  await page.getByRole("button", { name: "取消" }).click();
  await expect(edit).toBeFocused();
  await expect(page.locator(".message-sources")).toContainText("来源 · 2");
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

test("operations data stays scannable with local table overflow", async ({ page }, testInfo) => {
  test.skip(!["desktop-1440", "touch-390"].includes(testInfo.project.name), "operations coverage targets desktop and 390px");
  await page.goto("/?view=operations");
  await expect(page.getByLabel("7 日运营摘要")).toBeVisible();
  await expect(page.getByRole("heading", { name: "7 日请求趋势" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "逻辑模型结果" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "成员反馈" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "管理审计" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "成员用量" })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "2026-07-26 请求 5" })).toBeVisible();
  await expect(page.getByText("更新配置", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/不准确/).first()).toBeVisible();
  await expect(page.getByText("合成运营成员 01", { exact: true })).toBeVisible();
  await expect(page.getByText(/当前显示 20 \/ 21/)).toHaveCount(4);
  await expect(page.getByText("第 21 条逻辑模型", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "逻辑模型结果：下一页" }).click();
  await expect(page.getByText("第 21 条逻辑模型", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "成员反馈：下一页" }).click();
  await expect(page.getByText("第 21 条成员反馈", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "管理审计：下一页" }).click();
  await expect(page.getByText(/第 21 条管理审计/)).toBeVisible();
  await page.getByRole("button", { name: "成员用量：下一页" }).click();
  await expect(page.getByText("第 21 位运营成员", { exact: true })).toBeVisible();

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
        authType: "bearer",
        secretRef: "DOCS_MCP",
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
  await expect(page.getByText(/Schema 变更 1/)).toBeVisible();
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

async function attachScreenshot(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}-${testInfo.project.name}.png`);
  await page.screenshot({ path, fullPage: false, animations: "disabled" });
  await testInfo.attach(`${name}-${testInfo.project.name}`, {
    path,
    contentType: "image/png",
  });
}
