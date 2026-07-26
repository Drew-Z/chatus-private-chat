import { expect, test } from "@playwright/test";

const accessCode = process.env.CHATUS_E2E_ACCESS_CODE;
const providerURL = process.env.CHATUS_E2E_PROVIDER_URL;
if (!accessCode || !providerURL) throw new Error("Agent E2E runtime variables are required");

test("real Worker Agent transport preserves streaming, approval, attachments, and branches", async ({ page, request }) => {
  await page.goto("/");
  await page.getByLabel("访问码").fill(accessCode);
  await page.getByRole("button", { name: "进入 Chatus" }).click();

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
  expect(state.delayedRequests).toBeGreaterThan(0);
  expect(state.singleChunkRequests).toBeGreaterThan(0);
  expect(state.recoveryRequests).toBeGreaterThan(0);
  expect(state.memoryToolRequests).toBeGreaterThan(0);
  expect(state.memoryContinuationRequests).toBeGreaterThan(0);
});

async function sendMessage(page: import("@playwright/test").Page, text: string): Promise<void> {
  const composer = page.getByRole("textbox", { name: "消息" });
  await composer.fill(text);
  await page.getByRole("button", { name: "发送", exact: true }).click();
}

type ProviderState = {
  delayedRequests: number;
  singleChunkRequests: number;
  recoveryRequests: number;
  cancelledStreams: number;
  memoryToolRequests: number;
  memoryContinuationRequests: number;
  fileRequests: number;
  imageRequests: number;
};

async function providerState(request: import("@playwright/test").APIRequestContext): Promise<ProviderState> {
  const response = await request.get(`${providerURL}/__state`);
  expect(response.ok()).toBe(true);
  return response.json() as Promise<ProviderState>;
}

async function readMemory(page: import("@playwright/test").Page): Promise<{ memory: string }> {
  return page.evaluate(async () => {
    const response = await fetch("/api/agent/memory", { credentials: "include" });
    if (!response.ok) throw new Error(`Memory request failed with ${response.status}`);
    return response.json() as Promise<{ memory: string }>;
  });
}
