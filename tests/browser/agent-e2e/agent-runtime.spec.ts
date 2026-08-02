import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

const accessCode = process.env.CHATUS_E2E_ACCESS_CODE;
const providerURL = process.env.CHATUS_E2E_PROVIDER_URL;
if (!accessCode || !providerURL) throw new Error("Agent E2E runtime variables are required");
const memberAccessCode: string = accessCode;
test.use({ screenshot: "off", trace: "off" });

test("streaming follows a reader at the bottom without stealing an upward scroll", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await loginMember(page);
  const messageList = page.locator(".message-list");
  await sendMessage(page, "[e2e:scroll] 验证流式贴底");
  const assistant = page.locator(".message.assistant").last();

  await expect(assistant).toContainText("滚动第一段");
  await expect.poll(() => transcriptDistanceFromBottom(messageList)).toBeLessThan(140);

  const upwardPosition = await messageList.evaluate((element) => {
    element.scrollTop = Math.max(0, element.scrollHeight - element.clientHeight - 320);
    element.dispatchEvent(new Event("scroll"));
    return { scrollTop: element.scrollTop, distance: element.scrollHeight - element.scrollTop - element.clientHeight };
  });
  expect(upwardPosition.distance).toBeGreaterThanOrEqual(250);

  await expect(assistant).toContainText("滚动第二段");
  const afterSecondChunk = await messageList.evaluate((element) => ({
    scrollTop: element.scrollTop,
    distance: element.scrollHeight - element.scrollTop - element.clientHeight,
  }));
  expect(afterSecondChunk.distance).toBeGreaterThanOrEqual(250);
  expect(Math.abs(afterSecondChunk.scrollTop - upwardPosition.scrollTop)).toBeLessThanOrEqual(2);
  await expect(assistant).toContainText("滚动第三段完成");
});

test("legacy image input is keyboard reachable and opens the native chooser", async ({ page }) => {
  await page.goto("/legacy/");
  await page.getByLabel("访问码").fill(memberAccessCode);
  await page.getByRole("button", { name: "进入 Chatus" }).click();
  const imageButton = page.getByRole("button", { name: "添加图片" });
  await expect(imageButton).toBeVisible();
  await imageButton.focus();
  await expect(imageButton).toBeFocused();

  const chooserPromise = page.waitForEvent("filechooser");
  await imageButton.press("Enter");
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: "keyboard-pixel.gif",
    mimeType: "image/gif",
    buffer: Buffer.from(
      "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
      "base64",
    ),
  });
  await expect(page.locator("#attachmentRow .attachment img")).toBeVisible();
});

test("real Worker Agent transport preserves streaming, approval, attachments, and branches", async ({ page, request }) => {
  await loginMember(page);

  const composer = page.getByRole("textbox", { name: "消息" });
  await expect(composer).toBeVisible();

  await sendMessage(page, "[e2e:delayed] 分两段回答");
  await expect(page.locator(".thinking-row")).toBeVisible();
  const delayedAssistant = page.locator(".message.assistant").last();
  await expect(delayedAssistant).toContainText("渐进第一段");
  await expect(page.getByRole("button", { name: "停止生成" })).toBeVisible();
  await expect(delayedAssistant).toContainText("渐进第二段");
  await expect(page.getByRole("button", { name: "发送", exact: true })).toBeVisible();

  await sendMessage(page, "[e2e:single] 返回单块内容");
  await expect(page.locator(".thinking-row")).toBeVisible();
  await expect(page.getByText("单块响应完成", { exact: true })).toBeVisible();

  await sendMessage(page, "[e2e:recover] 验证重连恢复");
  const recoveryAssistant = page.locator(".message.assistant").last();
  await expect(recoveryAssistant).toContainText("恢复第一段");
  await page.reload();
  await expect(composer).toBeVisible();
  await expect(page.locator(".message.assistant").last()).toContainText("恢复第二段");

  await sendMessage(page, "[e2e:cancel] 验证停止");
  await expect(page.getByText("取消前第一段", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "停止生成" }).click();
  await expect(page.getByRole("button", { name: "发送", exact: true })).toBeVisible();
  await expect.poll(async () => (await providerState(request)).cancelledStreams).toBeGreaterThan(0);

  await sendMessage(page, "[e2e:default] 停止后继续");
  await expect(page.getByText("后续请求可用", { exact: true })).toBeVisible();

  await sendMessage(page, "[e2e:memory] 请记住我的稳定偏好");
  const memoryTrace = page.locator(".tool-trace").filter({ hasText: "更新长期记忆" }).last();
  await expect(memoryTrace).toBeVisible();
  await expect(memoryTrace.locator(".memory-proposal-preview")).toHaveText("- 偏好简洁回答");
  await expect.poll(async () => (await readMemory(page)).memory).toBe("");
  await memoryTrace.getByRole("button", { name: "批准" }).click();
  await expect(page.getByText("记忆审批已完成", { exact: true })).toBeVisible();
  await expect.poll(async () => (await readMemory(page)).memory).toBe("- 偏好简洁回答");

  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles([
    {
      name: "fixture.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Synthetic attachment\nNo private data."),
    },
    {
      name: "pixel.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=",
        "base64",
      ),
    },
  ]);
  await expect(page.getByText("fixture.md", { exact: true })).toBeVisible();
  await expect(page.getByText("pixel.png", { exact: true })).toBeVisible();
  await sendMessage(page, "[e2e:attachment] 检查附件");
  await expect(page.getByText("附件已接收", { exact: true })).toBeVisible();
  await expect.poll(async () => (await providerState(request)).fileRequests).toBeGreaterThan(0);
  await expect.poll(async () => (await providerState(request)).imageRequests).toBeGreaterThan(0);

  const sourceAssistant = page.locator(".message.assistant").filter({ hasText: "附件已接收" });
  await sourceAssistant.getByRole("button", { name: "创建对话分支" }).click();
  await expect(page.getByRole("button", { name: /返回父会话/ })).toBeVisible();

  const state = await providerState(request);
  expect(state.selectorRequests).toBeGreaterThan(0);
  expect(state.delayedRequests).toBeGreaterThan(0);
  expect(state.singleChunkRequests).toBeGreaterThan(0);
  expect(state.recoveryRequests).toBeGreaterThan(0);
  expect(state.memoryToolRequests).toBeGreaterThan(0);
  expect(state.memoryContinuationRequests).toBeGreaterThan(0);
});

test.describe("member logout recovery", () => {
  test("failed logout preserves the member workspace and retry clears drafts without provider calls", async ({ page, request }) => {
    await loginMember(page);
    const composer = page.getByRole("textbox", { name: "消息" });
    await composer.fill("合成退出恢复草稿");

    const sessionIdentity = await readSessionIdentity(page);
    await expect.poll(async () => (await readDraftStorageState(page, sessionIdentity.user)).draftCount).toBeGreaterThan(0);
    const draftState = await readDraftStorageState(page, sessionIdentity.user);
    const composerFingerprint = await readInputFingerprint(composer);
    const providerBaseline = await providerState(request);
    let logoutAttempts = 0;

    await page.route("**/api/logout", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      logoutAttempts += 1;
      if (logoutAttempts === 1) {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "internal_error", message: "合成成员会话撤销失败，请重试。" }),
        });
        return;
      }
      await route.continue();
    });

    await page.getByRole("button", { name: "退出登录" }).click();
    const alert = page.getByRole("alert").filter({ hasText: "合成成员会话撤销失败，请重试。" });
    await expect(alert).toBeVisible();
    await expect(alert.getByRole("button", { name: "重试退出" })).toBeEnabled();
    await expect(page.locator(".workspace-shell")).toBeVisible();
    await expect(composer).toBeVisible();
    expect(await readInputFingerprint(composer)).toBe(composerFingerprint);
    expect(await readSessionIdentity(page)).toEqual(sessionIdentity);
    expect(await readDraftStorageState(page, sessionIdentity.user)).toEqual(draftState);
    expect(await providerState(request)).toEqual(providerBaseline);
    expect(logoutAttempts).toBe(1);

    await alert.getByRole("button", { name: "重试退出" }).click();
    await expect(page.getByLabel("访问码")).toBeVisible();
    await expect.poll(async () => (await readDraftStorageState(page, sessionIdentity.user)).draftCount).toBe(0);
    expect(await providerState(request)).toEqual(providerBaseline);
    expect(logoutAttempts).toBe(2);
  });
});

async function loginMember(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("访问码").fill(memberAccessCode);
  await page.getByRole("button", { name: "进入 Chatus" }).click();
  await expect(page.getByRole("textbox", { name: "消息" })).toBeVisible();
}

async function sendMessage(page: Page, text: string): Promise<void> {
  const composer = page.getByRole("textbox", { name: "消息" });
  await composer.fill(text);
  await page.getByRole("button", { name: "发送", exact: true }).click();
}

type ProviderState = {
  selectorRequests: number;
  delayedRequests: number;
  singleChunkRequests: number;
  recoveryRequests: number;
  cancelledStreams: number;
  memoryToolRequests: number;
  memoryContinuationRequests: number;
  fileRequests: number;
  imageRequests: number;
  scrollRequests: number;
};

async function providerState(request: APIRequestContext): Promise<ProviderState> {
  const response = await request.get(`${providerURL}/__state`);
  expect(response.ok()).toBe(true);
  return response.json() as Promise<ProviderState>;
}

async function transcriptDistanceFromBottom(messageList: Locator): Promise<number> {
  return messageList.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight);
}

async function readMemory(page: Page): Promise<{ memory: string }> {
  return page.evaluate(async () => {
    const response = await fetch("/api/agent/memory", { credentials: "include" });
    if (!response.ok) throw new Error(`Memory request failed with ${response.status}`);
    return response.json() as Promise<{ memory: string }>;
  });
}

async function readSessionIdentity(page: Page): Promise<{ access: "member"; user: string }> {
  return page.evaluate(async () => {
    const response = await fetch("/api/session", { credentials: "include" });
    if (!response.ok) throw new Error(`Session request failed with ${response.status}`);
    const data = await response.json() as { access?: unknown; user?: unknown };
    if (data.access !== "member" || typeof data.user !== "string") {
      throw new Error("Expected an authenticated member session");
    }
    return { access: "member" as const, user: data.user };
  });
}

async function readDraftStorageState(page: Page, user: string): Promise<{
  draftCount: number;
  draftFingerprint: string;
  activeChatFingerprint: string;
}> {
  return page.evaluate(async ({ member }) => {
    const digest = async (value: string) => {
      const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
      return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    };
    const prefix = `chatus:react:${member}:draft:`;
    const entries: Array<[string, string]> = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(prefix)) entries.push([key, localStorage.getItem(key) || ""]);
    }
    entries.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
    return {
      draftCount: entries.length,
      draftFingerprint: await digest(JSON.stringify(entries)),
      activeChatFingerprint: await digest(localStorage.getItem(`chatus:react:${member}:active-chat`) || ""),
    };
  }, { member: user });
}

async function readInputFingerprint(input: Locator): Promise<string> {
  return input.evaluate(async (element) => {
    const value = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.value : "";
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  });
}
