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
  await expect(page.getByText("更新配置", { exact: true })).toBeVisible();
  await expect(page.getByText(/不准确/)).toBeVisible();
  await expect(page.getByText("合成运营成员名称用于验证窄屏容器", { exact: true })).toBeVisible();

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
