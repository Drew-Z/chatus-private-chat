import { expect, test, type Page, type TestInfo } from "@playwright/test";

const blockedRequests = new WeakMap<Page, string[]>();

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
      headerTitle: rect(".header-conversation-title"),
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
