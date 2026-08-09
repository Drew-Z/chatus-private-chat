import { expect, test, type APIRequestContext, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { minimalPdf } from "../../document-fixtures";

const adminToken = requiredEnv("CHATUS_VALIDATION_ADMIN_TOKEN");
const primaryProviderURL = requiredEnv("CHATUS_VALIDATION_PRIMARY_PROVIDER_URL");
const secondaryProviderURL = requiredEnv("CHATUS_VALIDATION_SECONDARY_PROVIDER_URL");
const primaryProviderKey = requiredEnv("CHATUS_VALIDATION_PRIMARY_PROVIDER_KEY");
const secondaryProviderKey = requiredEnv("CHATUS_VALIDATION_SECONDARY_PROVIDER_KEY");
const evidenceDirectory = requiredEnv("CHATUS_VALIDATION_EVIDENCE_DIR");
const stepsPath = join(evidenceDirectory, "steps.jsonl");
const observationsPath = join(evidenceDirectory, "observations.md");

test("owner-to-member product direction baseline", async ({ browser, page, request }, testInfo) => {
  await mkdir(evidenceDirectory, { recursive: true });
  await writeFile(stepsPath, "", "utf8");
  const observations: string[] = [
    "# Product validation observations",
    "",
    "This run used synthetic local data and deterministic fake Providers only.",
    "",
  ];
  const setupStartedAt = Date.now();
  let memberContext: BrowserContext | undefined;

  try {
    await test.step("owner opens the first-use admin workspace", async () => {
      await page.goto("/react-chat/admin");
      const loadingObserved = await page.getByText("正在连接管理后台", { exact: true })
        .isVisible({ timeout: 2_000 }).catch(() => false);
      await page.getByLabel("管理员 Token").fill(adminToken);
      await page.getByRole("button", { name: "进入后台" }).click();
      await expect(page.getByRole("heading", { name: "首次配置", exact: true })).toBeVisible();
      await expect(page.getByText(/\d+ \/ 6 已就绪/)).toBeVisible();
      await capture(page, testInfo, "01-setup-initial");
      await recordStep("owner.setup.initial", "owner", "/react-chat/admin", loadingObserved ? "pass" : "friction", setupStartedAt, loadingObserved
        ? "Initial loading and incomplete six-step projection were visible."
        : "The loading projection completed before it could be visually observed; the six-step projection was visible.");
    });

    await test.step("owner creates two Providers and write-only credentials", async () => {
      await page.getByRole("button", { name: "服务商", exact: true }).click();
      await createProvider(page, {
        id: "validation-primary",
        label: "Validation primary",
        baseURL: `${primaryProviderURL}/v1`,
        keyRef: "VALIDATION_PRIMARY_KEY",
        secret: primaryProviderKey,
        priority: 10,
      });
      await createProvider(page, {
        id: "validation-secondary",
        label: "Validation secondary",
        baseURL: `${secondaryProviderURL}/v1`,
        keyRef: "VALIDATION_SECONDARY_KEY",
        secret: secondaryProviderKey,
        priority: 20,
      });
      await capture(page, testInfo, "02-providers-ready");
      await recordStep("owner.setup.providers", "owner", "/react-chat/admin", "pass", setupStartedAt,
        "Two Provider entries and write-only managed credential states were configured through visible controls.");
    });

    await test.step("owner creates the logical model and bounded fallback offerings", async () => {
      await page.getByRole("button", { name: "逻辑模型", exact: true }).click();
      await page.locator("#logical-model-admin-add").click();
      await page.getByLabel("逻辑模型 ID").fill("validation-work");
      await page.getByLabel("对外名称").fill("项目协作模型");
      await page.getByLabel("支持工具").check();
      const offerings = page.locator(".admin-offering-row");
      await expect(offerings).toHaveCount(1);
      await offerings.nth(0).getByLabel("上游模型").fill("validation-model-primary");
      await page.getByRole("button", { name: "添加出口" }).click();
      await expect(offerings).toHaveCount(2);
      await offerings.nth(1).getByLabel("服务商").selectOption("validation-secondary");
      await offerings.nth(1).getByLabel("上游模型").fill("validation-model-secondary");
      await page.getByRole("button", { name: "保存逻辑模型" }).click();
      await expect(page.getByText("逻辑模型已保存。", { exact: true })).toBeVisible();
      await capture(page, testInfo, "03-logical-model-ready");
      await recordStep("owner.setup.logical-model", "owner", "/react-chat/admin", "pass", setupStartedAt,
        "The member-facing logical model showed two administrator-only Provider exits in deterministic order.");
    });

    await test.step("owner creates the project Skill", async () => {
      await page.getByRole("button", { name: "AI 能力", exact: true }).click();
      await page.getByRole("button", { name: "新增Skills" }).click();
      await page.getByLabel("Skill ID").fill("project-collaboration");
      await page.getByLabel("显示名称").fill("项目协作");
      await page.getByLabel("说明").fill("Synthetic programming and project collaboration workflow.");
      await page.getByLabel("Instructions").fill("Return a concise plan with risks, acceptance criteria, and recovery steps.");
      const builtinTool = page.locator(".capability-tool-checks label").filter({ hasText: "builtin:text_stats" });
      if (await builtinTool.count()) await builtinTool.getByRole("checkbox").check();
      await page.getByRole("button", { name: "保存 Skill" }).click();
      await expect(page.getByText("Skill 已保存。", { exact: true })).toBeVisible();
      await recordStep("owner.setup.skill", "owner", "/react-chat/admin", "pass", setupStartedAt,
        "A focused project Skill was configured without adding marketplace or orchestration scope.");
    });

    let memberAccessCode = "";
    await test.step("owner creates the first member and assigns explicit capabilities", async () => {
      await page.getByRole("button", { name: "成员访问", exact: true }).click();
      await page.getByRole("button", { name: "创建成员" }).click();
      const createDialog = page.getByRole("dialog", { name: "创建成员" });
      await createDialog.getByLabel("成员 label").fill("validation-member");
      await createDialog.getByRole("button", { name: "创建成员" }).click();
      const credential = page.getByRole("dialog", { name: "成员访问已创建" });
      memberAccessCode = await credential.locator("#member-access-code").inputValue();
      expect(memberAccessCode.length).toBeGreaterThan(20);
      await credential.getByRole("button", { name: "完成" }).click();

      await page.locator(".typed-admin-member").filter({ hasText: "validation-member" }).click();
      const routeSection = capabilitySection(page, "模型线路");
      await routeSection.getByLabel("继承默认可用线路").uncheck();
      await routeSection.getByLabel("继承默认首选线路").uncheck();
      const projectRoute = routeSection.locator("label").filter({ hasText: "validation-work" });
      const bootstrapRoute = routeSection.locator("label").filter({ hasText: "bootstrap" });
      if (!(await projectRoute.getByRole("checkbox").isChecked())) await projectRoute.getByRole("checkbox").check();
      await bootstrapRoute.getByRole("checkbox").uncheck();
      await routeSection.getByLabel("默认线路").selectOption("validation-work");

      const skillSection = capabilitySection(page, "Skills");
      await skillSection.getByLabel("继承默认 Skill").uncheck();
      await skillSection.locator("label").filter({ hasText: "项目协作" }).getByRole("checkbox").check();
      const toolSection = capabilitySection(page, "工具");
      await toolSection.getByLabel("继承默认工具").uncheck();
      const textStats = toolSection.locator("label").filter({ hasText: "builtin:text_stats" });
      if (await textStats.count()) await textStats.getByRole("checkbox").check();
      await page.getByRole("button", { name: "保存分配" }).click();
      await expect(page.getByText("成员分配与使用策略已保存。", { exact: true })).toBeVisible();
      await page.locator(".typed-admin-member").filter({ hasText: "默认配置" }).click();
      await page.locator(".typed-admin-member").filter({ hasText: "validation-member" }).click();
      await expect(routeSection.getByLabel("继承默认可用线路")).not.toBeChecked();
      await expect(projectRoute.getByRole("checkbox")).toBeChecked();
      await expect(bootstrapRoute.getByRole("checkbox")).not.toBeChecked();
      await capture(page, testInfo, "04-member-permissions-ready");
      await recordStep("owner.setup.member-permissions", "owner", "/react-chat/admin", "pass", setupStartedAt,
        "The first member received an explicit logical route, Skill, and bounded built-in tool assignment.");
    });

    await test.step("owner completes model-free smoke and server-confirmed logout", async () => {
      await page.getByRole("button", { name: "首次配置", exact: true }).click();
      await page.getByRole("button", { name: "运行 smoke" }).click();
      await expect(page.getByText("无模型 smoke 已通过，首次配置闭环就绪。", { exact: true })).toBeVisible();
      await expect(page.getByText("全部就绪", { exact: true })).toBeVisible();
      const setupElapsedMs = Date.now() - setupStartedAt;
      expect(setupElapsedMs).toBeLessThan(5 * 60_000);
      await capture(page, testInfo, "05-setup-complete");
      await recordStep("owner.setup.smoke", "owner", "/react-chat/admin", "pass", setupStartedAt,
        `The model-free smoke completed and the owner-to-ready elapsed time was ${setupElapsedMs} ms.`);
      await page.getByRole("button", { name: "退出", exact: true }).click();
      await expect(page.getByLabel("管理员 Token")).toBeVisible();
      await recordStep("owner.logout", "owner", "/react-chat/admin", "pass", setupStartedAt,
        "The admin workspace exited only after the server-confirmed logout response.");
    });

    memberContext = await browser.newContext({
      baseURL: testInfo.project.use.baseURL as string,
      colorScheme: "light",
      viewport: { width: 1440, height: 900 },
    });
    const memberPage = await memberContext.newPage();
    await loginMember(memberPage, memberAccessCode);

    await test.step("member completes the programming and project workflow", async () => {
      await expect(memberPage.getByRole("button", { name: "查看线路与状态" })).toContainText("项目协作模型");
      await openSidebarView(memberPage, "设置");
      await expect(memberPage.getByRole("button", { name: "自动", exact: true })).toHaveAttribute("aria-pressed", "true");
      await memberPage.getByRole("button", { name: "对话", exact: true }).click();
      await sendMessage(memberPage, "[product:project]");
      await expect(memberPage.locator(".thinking-row")).toBeVisible();
      const projectResponse = memberPage.locator(".message.assistant").last();
      await expect(projectResponse).toContainText("风险与验收标准已列出。");
      await expect(memberPage.locator(".thinking-row")).toBeHidden();
      await expect(memberPage.getByRole("button", { name: "停止生成" })).toBeHidden({ timeout: 20_000 });
      const liveSkillSelection = projectResponse.getByRole("region", { name: "本轮自动 Skill" });
      const liveSkillVisible = await liveSkillSelection.isVisible({ timeout: 2_000 }).catch(() => false);
      if (liveSkillVisible) await expect(liveSkillSelection).toContainText("项目协作");
      await memberPage.reload();
      await expect(memberPage.getByText("风险与验收标准已列出。", { exact: false })).toBeVisible();
      const persistedSkillSelection = projectResponse.getByRole("region", { name: "本轮自动 Skill" });
      const persistedSkillVisible = await persistedSkillSelection.isVisible({ timeout: 2_000 }).catch(() => false);
      if (persistedSkillVisible) await expect(persistedSkillSelection).toContainText("项目协作");
      const skillSelectionVisible = liveSkillVisible || persistedSkillVisible;
      await projectResponse.getByRole("button", { name: "创建对话分支" }).click();
      await expect(memberPage.getByRole("button", { name: /返回父会话/ })).toBeVisible();
      await capture(memberPage, testInfo, "06-project-workflow");
      await recordStep("member.workflow.project", "member", "/", skillSelectionVisible ? "pass" : "friction", setupStartedAt,
        skillSelectionVisible
          ? "Automatic Skill selection, progressive output, durable reload, and branch recovery were visible."
          : "The fake Provider completed Automatic Skill selection, but the message omitted its member-visible Skill selection block; output, reload, and branch recovery remained usable.");
      observations.push(skillSelectionVisible
        ? "- Programming/project workflow: understandable logical-model label and visible Automatic Skill choice; durable branching was recoverable."
        : "- Programming/project workflow friction: Provider counters prove Automatic Skill selection ran, but the member message omitted the selected Skill block before and after reload; the useful result and branch recovery still worked.");
    });

    await test.step("member completes the file-backed analysis workflow", async () => {
      await openSidebarView(memberPage, "文件");
      const fileInput = memberPage.locator('.file-workspace input[type="file"]').first();
      await fileInput.setInputFiles([
        {
          name: "synthetic-notes.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("Synthetic baseline: alpha=12, beta=18, total=30."),
        },
        {
          name: "report.pdf",
          mimeType: "application/pdf",
          buffer: Buffer.from(minimalPdf("Synthetic PDF total 30")),
        },
      ]);
      const notesRow = memberPage.locator(".file-workspace-row").filter({ hasText: "synthetic-notes.txt" });
      const pdfRow = memberPage.locator(".file-workspace-row").filter({ hasText: "report.pdf" });
      const transitionObserved = await observeIngestTransition(memberPage);
      await expect(notesRow).toContainText("可用", { timeout: 30_000 });
      await expect(pdfRow).toContainText("可用", { timeout: 30_000 });
      await capture(memberPage, testInfo, "07-files-ready");
      await test.step("member selects exact ready file versions", async () => {
        const notesSelection = notesRow.getByRole("checkbox");
        await expect(notesSelection).toBeEnabled({ timeout: 20_000 });
        await notesSelection.click({ timeout: 20_000 });
        await expect(notesSelection).toBeChecked({ timeout: 20_000 });
        const pdfSelection = pdfRow.getByRole("checkbox");
        await expect(pdfSelection).toBeEnabled({ timeout: 20_000 });
        await pdfSelection.click({ timeout: 20_000 });
        await expect(pdfSelection).toBeChecked({ timeout: 20_000 });
      });
      await test.step("member pins and renames the selected text file", async () => {
        const pinButton = notesRow.getByRole("button", { name: "固定文件" });
        await expect(pinButton).toBeEnabled({ timeout: 20_000 });
        await pinButton.click({ timeout: 20_000 });
        await expect(notesRow.getByRole("button", { name: "取消固定" })).toBeVisible({ timeout: 20_000 });
        const renameButton = notesRow.getByRole("button", { name: "重命名文件" });
        await expect(renameButton).toBeEnabled({ timeout: 20_000 });
        await renameButton.click({ timeout: 20_000 });
        const renameForm = memberPage.locator(".file-rename");
        await expect(renameForm).toBeVisible({ timeout: 20_000 });
        await renameForm.locator("input").fill("synthetic-renamed.txt", { timeout: 20_000 });
        await renameForm.getByRole("button", { name: "保存路径" }).click({ timeout: 20_000 });
        await expect(memberPage.locator(".file-workspace-row").filter({ hasText: "synthetic-renamed.txt" })).toBeVisible({ timeout: 20_000 });
      });
      await memberPage.getByRole("button", { name: "对话", exact: true }).click();
      const before = await providerState(request, primaryProviderURL);
      await sendMessage(memberPage, "[product:file-analysis]");
      await expect(memberPage.locator(".message.assistant").last()).toContainText("固定版本中的合计为 30。");
      await expect(memberPage.locator(".thinking-row")).toBeHidden();
      await expect(memberPage.getByRole("button", { name: "停止生成" })).toBeHidden({ timeout: 20_000 });
      const after = await providerState(request, primaryProviderURL);
      expect(after.workspaceRequests).toBeGreaterThan(before.workspaceRequests);

      await openSidebarView(memberPage, "文件");
      await fileInput.setInputFiles({
        name: "invalid.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("%PDF-invalid-synthetic"),
      });
      const invalidRow = memberPage.locator(".file-workspace-row").filter({ hasText: "invalid.pdf" });
      await expect(invalidRow).toContainText("解析失败", { timeout: 30_000 });
      await expect(invalidRow.getByRole("checkbox")).toBeDisabled();
      const failedIngestCounters = await providerState(request, primaryProviderURL);
      expect(failedIngestCounters.workspaceRequests).toBe(after.workspaceRequests);
      await expect(invalidRow.getByRole("button", { name: "重试文件解析" })).toBeVisible();
      await capture(memberPage, testInfo, "07-file-workflow");
      await recordStep("member.workflow.files", "member", "/", transitionObserved ? "pass" : "friction", setupStartedAt,
        transitionObserved
          ? "Queued/extracting/ready states, exact-version selection, rename stability, analysis, and a failed-ingest retry path were visible."
          : "Ready and failed-ingest states were visible, but the local queue completed too quickly to retain an intermediate queued/extracting frame.");
      observations.push(`- File workflow: exact-version selection and failed-ingest protection passed; intermediate ingest visibility ${transitionObserved ? "was observed" : "completed too quickly for a retained frame"}.`);
    });

    await test.step("member observes bounded Provider fallback and post-output commitment", async () => {
      await memberPage.getByRole("button", { name: "对话", exact: true }).click();
      const secondaryBefore = await providerState(request, secondaryProviderURL);
      await sendMessage(memberPage, "[product:fallback]");
      await expect(memberPage.locator(".thinking-row")).toBeVisible();
      await expect(memberPage.locator(".message.assistant").last()).toContainText("备用线路恢复完成");
      await expect(memberPage.locator(".thinking-row")).toBeHidden();
      await expect(memberPage.getByRole("button", { name: "停止生成" })).toBeHidden({ timeout: 20_000 });
      const secondaryAfter = await providerState(request, secondaryProviderURL);
      expect(secondaryAfter.fallbackSuccesses).toBeGreaterThan(secondaryBefore.fallbackSuccesses);

      const postVisiblePrimaryBefore = await providerState(request, primaryProviderURL);
      const postVisibleSecondaryBefore = await providerState(request, secondaryProviderURL);
      await sendMessage(memberPage, "[product:post-visible-failure]");
      await expect(memberPage.getByText("可见输出已开始", { exact: true })).toBeVisible();
      await expect(memberPage.getByRole("alert").last()).toBeVisible();
      const postVisiblePrimaryAfter = await providerState(request, primaryProviderURL);
      const postVisibleSecondaryAfter = await providerState(request, secondaryProviderURL);
      expect(
        postVisiblePrimaryAfter.postVisibleFailures + postVisibleSecondaryAfter.postVisibleFailures,
      ).toBeGreaterThan(
        postVisiblePrimaryBefore.postVisibleFailures + postVisibleSecondaryBefore.postVisibleFailures,
      );
      expect(
        postVisiblePrimaryAfter.requests + postVisibleSecondaryAfter.requests
          - postVisiblePrimaryBefore.requests - postVisibleSecondaryBefore.requests,
      ).toBe(2);
      await capture(memberPage, testInfo, "08-provider-recovery");
      await recordStep("member.recovery.provider", "member", "/", "pass", setupStartedAt,
        "Pre-output failure used the second offering; post-visible failure did not splice a second Provider response.");
    });

    await test.step("member uses the assigned operational Skill and verifies logout recovery", async () => {
      await sendMessage(memberPage, "[product:operations]");
      const response = memberPage.locator(".message.assistant").last();
      await expect(response).toContainText("权限、恢复和审计边界正常。");
      await expect(memberPage.locator(".thinking-row")).toBeHidden();
      await expect(memberPage.getByRole("button", { name: "停止生成" })).toBeHidden({ timeout: 20_000 });
      const operationSkillSelection = response.getByRole("region", { name: "本轮自动 Skill" });
      const operationSkillVisible = await operationSkillSelection.isVisible({ timeout: 2_000 }).catch(() => false);
      if (operationSkillVisible) await expect(operationSkillSelection).toContainText("项目协作");
      await capture(memberPage, testInfo, "09-operations-workflow");
      await memberPage.setViewportSize({ width: 390, height: 844 });
      await expectDocumentContained(memberPage);
      await capture(memberPage, testInfo, "10-mobile-containment");

      await memberPage.setViewportSize({ width: 1440, height: 900 });
      let logoutAttempts = 0;
      await memberPage.route("**/api/logout", async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        logoutAttempts += 1;
        if (logoutAttempts === 1) {
          await route.fulfill({
            status: 500,
            contentType: "application/json",
            body: JSON.stringify({ error: "internal_error", message: "Synthetic logout failure." }),
          });
          return;
        }
        await route.continue();
      });
      await memberPage.getByRole("button", { name: "退出登录" }).click();
      const alert = memberPage.getByRole("alert").filter({ hasText: "Synthetic logout failure." });
      await expect(alert).toBeVisible();
      await expect(memberPage.locator(".workspace-shell")).toBeVisible();
      await alert.getByRole("button", { name: "重试退出" }).click();
      await expect(memberPage.getByLabel("访问码")).toBeVisible();
      expect(logoutAttempts).toBe(2);
      await recordStep("member.workflow.operations", "member", "/", operationSkillVisible ? "pass" : "friction", setupStartedAt,
        operationSkillVisible
          ? "The assigned Skill completed an operational result; mobile containment and fail-closed logout retry passed."
          : "The operational result completed, but the selected Skill block was absent; mobile containment and fail-closed logout retry passed.");
      observations.push(operationSkillVisible
        ? "- Skill/operations workflow: the selected Skill stayed visible; the focused OAuth/MCP contract suite supplies the server-side token and drift evidence because production SSRF policy correctly rejects loopback OAuth issuers."
        : "- Skill/operations workflow friction: the result completed but the selected Skill block was absent. Focused OAuth/MCP suites supply server-side token and drift evidence because production SSRF policy correctly rejects loopback OAuth issuers.");
    });

    const primary = await providerState(request, primaryProviderURL);
    const secondary = await providerState(request, secondaryProviderURL);
    expect(primary.selectorRequests + secondary.selectorRequests).toBeGreaterThanOrEqual(5);
    expect(primary.projectRequests + secondary.projectRequests).toBeGreaterThan(0);
    expect(primary.workspaceRequests + secondary.workspaceRequests).toBeGreaterThan(0);
    expect(primary.operationsRequests + secondary.operationsRequests).toBeGreaterThan(0);
    expect(primary.preOutputFailures + secondary.preOutputFailures).toBeGreaterThan(0);
    expect(primary.postVisibleFailures + secondary.postVisibleFailures).toBeGreaterThan(0);
    expect(primary.fallbackSuccesses + secondary.fallbackSuccesses).toBeGreaterThan(0);
    observations.push("", "## Overall", "", "All three representative workflows produced useful, recoverable local outcomes without live model or MCP traffic.", "");
    await writeFile(observationsPath, `${observations.join("\n")}\n`, "utf8");
  } finally {
    await memberContext?.close().catch(() => undefined);
  }
});

async function createProvider(page: Page, input: {
  id: string;
  label: string;
  baseURL: string;
  keyRef: string;
  secret: string;
  priority: number;
}): Promise<void> {
  await page.locator("#provider-admin-add").click();
  await page.getByLabel("服务商 ID").fill(input.id);
  await page.getByLabel("显示名称").fill(input.label);
  await page.getByLabel("Base URL").fill(input.baseURL);
  await page.getByLabel("API Key Ref").fill(input.keyRef);
  await page.getByLabel("管理员优先级").fill(String(input.priority));
  await page.getByLabel("支持工具").check();
  await page.getByLabel("允许用户密钥").uncheck();
  await page.getByRole("button", { name: "保存服务商" }).click();
  await expect(page.getByText("服务商配置已保存。", { exact: true })).toBeVisible();
  const secretBox = page.locator(".admin-secret-box").filter({ hasText: "密钥状态" });
  await secretBox.locator('input[type="password"]').fill(input.secret);
  await secretBox.getByRole("button", { name: "保存密钥" }).click();
  await expect(page.getByText("密钥已保存，输入框已清空。", { exact: true })).toBeVisible();
}

function capabilitySection(page: Page, title: string) {
  return page.locator(".typed-admin-capability-section").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
}

async function loginMember(page: Page, accessCode: string): Promise<void> {
  await page.goto("/");
  await page.getByLabel("访问码").fill(accessCode);
  await page.getByRole("button", { name: "进入 Chatus" }).click();
  await expect(page.getByRole("textbox", { name: "消息" })).toBeVisible();
}

async function openSidebarView(page: Page, name: "文件" | "设置"): Promise<void> {
  const direct = page.getByRole("button", { name, exact: true });
  if (!(await direct.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "打开侧栏" }).click();
  }
  await direct.click();
}

async function sendMessage(page: Page, scenario: string): Promise<void> {
  const composer = page.getByRole("textbox", { name: "消息" });
  await composer.fill(scenario);
  await page.getByRole("button", { name: "发送", exact: true }).click();
}

async function capture(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

async function recordStep(
  id: string,
  actor: "owner" | "member",
  route: string,
  status: "pass" | "friction" | "blocked" | "invalid",
  startedAt: number,
  note: string,
): Promise<void> {
  await appendFile(stepsPath, `${JSON.stringify({
    schemaVersion: 1,
    id,
    actor,
    route,
    status,
    elapsedMs: Date.now() - startedAt,
    note,
  })}\n`, "utf8");
}

async function observeIngestTransition(page: Page): Promise<boolean> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const text = await page.locator(".file-workspace-list").innerText().catch(() => "");
    if (text.includes("等待解析") || text.includes("解析中")) return true;
    await page.waitForTimeout(100);
  }
  return false;
}

async function expectDocumentContained(page: Page): Promise<void> {
  await expect.poll(async () => page.evaluate(() => ({
    documentFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    bodyFits: document.body.scrollWidth <= document.body.clientWidth,
  }))).toEqual({ documentFits: true, bodyFits: true });
}

type ProviderState = {
  requests: number;
  selectorRequests: number;
  projectRequests: number;
  workspaceRequests: number;
  operationsRequests: number;
  preOutputFailures: number;
  postVisibleFailures: number;
  fallbackSuccesses: number;
};

async function providerState(request: APIRequestContext, providerURL: string): Promise<ProviderState> {
  const response = await request.get(`${providerURL}/__state`);
  expect(response.ok()).toBe(true);
  return response.json() as Promise<ProviderState>;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
