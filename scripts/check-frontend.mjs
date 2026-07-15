import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const pages = [
  { html: "public/index.html", script: "public/app.js" },
  { html: "public/admin.html", script: "public/admin.js" },
];

for (const file of ["public/app.js", "public/admin.js", "public/admin-report.js", "public/markdown.js", "public/theme.js", "public/pwa.js", "public/sw.js"]) {
  execFileSync(process.execPath, ["--check", file], { cwd: root, stdio: "inherit" });
}

for (const page of pages) {
  const [html, script] = await Promise.all([
    readFile(path.join(root, page.html), "utf8"),
    readFile(path.join(root, page.script), "utf8"),
  ]);
  const ids = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]);
  const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  assert(!duplicateIds.length, `${page.html}: duplicate ids: ${duplicateIds.join(", ")}`);
  assert(html.includes('meta name="chatus-release" content="development"'), `${page.html}: missing release meta placeholder`);
  assert(html.includes("?v=development"), `${page.html}: missing asset version placeholders`);

  const referencedIds = [...script.matchAll(/querySelector\(["']#([A-Za-z][\w-]*)["']\)/g)].map((match) => match[1]);
  const missingIds = [...new Set(referencedIds.filter((id) => !ids.includes(id)))];
  assert(!missingIds.length, `${page.script}: ids missing from ${page.html}: ${missingIds.join(", ")}`);

  const assets = [...html.matchAll(/(?:src|href)=["'](\/[^"'#?]+)["']/g)]
    .map((match) => match[1])
    .filter((asset) => asset.includes("."));
  for (const asset of assets) {
    const file = path.join(root, "public", asset.replace(/^\//, ""));
    await access(file, constants.R_OK).catch(() => assert(false, `${page.html}: missing asset ${asset}`));
  }
}

const [pwaScript, serviceWorker] = await Promise.all([
  readFile(path.join(root, "public/pwa.js"), "utf8"),
  readFile(path.join(root, "public/sw.js"), "utf8"),
]);
assert(pwaScript.includes('postMessage({ type: "SKIP_WAITING" })'), "pwa.js: missing explicit update activation");
assert(pwaScript.includes("fetchReleaseCommit"), "pwa.js: releases must be detected even when the service worker is unchanged");
assert(pwaScript.includes('meta[name="chatus-release"]'), "pwa.js: update checks need the version of the loaded page");
assert(pwaScript.includes("5 * 60_000"), "pwa.js: long-lived pages need periodic release checks");
assert(serviceWorker.includes('event.data?.type === "SKIP_WAITING"'), "sw.js: missing update activation handler");
assert(serviceWorker.includes('cache.put(fallbackPath, response.clone())'), "sw.js: successful navigation must refresh the offline page");
const installHandler = serviceWorker.match(/addEventListener\("install",[\s\S]*?\n\}\);/)?.[0] || "";
assert(installHandler && !installHandler.includes("skipWaiting"), "sw.js: updates must not activate during install");

const chatScript = await readFile(path.join(root, "public/app.js"), "utf8");
const chatHtml = await readFile(path.join(root, "public/index.html"), "utf8");
const adminScript = await readFile(path.join(root, "public/admin.js"), "utf8");
const adminHtml = await readFile(path.join(root, "public/admin.html"), "utf8");
const styles = await readFile(path.join(root, "public/styles.css"), "utf8");
const icons = await readFile(path.join(root, "public/icons.svg"), "utf8");
assert(chatScript.includes('./markdown.js?v=development'), "app.js: markdown module must share the release fingerprint");
assert(adminScript.includes('./admin-report.js?v=development'), "admin.js: report module must share the release fingerprint");
assert(serviceWorker.includes('"/admin-report.js"'), "sw.js: offline admin shell must include the report module");
assert(serviceWorker.includes('"/icons.svg"'), "sw.js: offline chat shell must include the Lucide sprite");
assert(icons.includes("lucide-static v1.24.0 - ISC"), "icons.svg: missing Lucide license provenance");
assert(chatHtml.includes("/icons.svg?v=development#"), "index.html: Lucide sprite references must share the release fingerprint");
const spriteIconIds = new Set([...icons.matchAll(/<symbol id="([a-z0-9-]+)"/g)].map((match) => match[1]));
const staticIconNames = [...chatHtml.matchAll(/icons\.svg\?v=development#([a-z0-9-]+)/g)].map((match) => match[1]);
const actionIconNames = [...chatScript.matchAll(/actionButton\("([a-z0-9-]+)"/g)].map((match) => match[1]);
const promptIconNames = [...chatScript.matchAll(/icon: "([a-z0-9-]+)"/g)].map((match) => match[1]);
const dynamicIconNames = [...chatScript.matchAll(/return "([a-z0-9-]+)";/g)].map((match) => match[1]);
const referencedIconNames = [...new Set([...staticIconNames, ...actionIconNames, ...promptIconNames, ...dynamicIconNames, "eye", "eye-off"])];
const missingIcons = referencedIconNames.filter((name) => !spriteIconIds.has(name));
assert(!missingIcons.length, `icons.svg: missing referenced symbols: ${missingIcons.join(", ")}`);
assert(chatScript.includes('button.setAttribute("aria-label", label)'), "app.js: icon-only message actions need accessible names");
assert(chatScript.includes("function actionButton(icon, label, onClick"), "app.js: message actions must use the shared icon helper");
assert(styles.includes("@media (hover: hover) and (pointer: fine)"), "styles.css: message action fading must be limited to precise hover pointers");
assert(styles.includes("opacity: 0.68;"), "styles.css: desktop message actions should remain subtly visible");
assert(!styles.includes("pointer-events: none;\n    opacity: 0;"), "styles.css: message actions must not require hover to become operable");
assert(
  /@media \(max-width: 820px\)[\s\S]*?\.chat-product-body \.message-actions \{\s*pointer-events: auto;\s*opacity: 1;/.test(styles),
  "styles.css: narrow touch layouts must expose message actions without hover",
);
assert(chatScript.includes('group.className = "model-provider-group"'), "app.js: model picker routes must be grouped by provider label");
assert(chatScript.includes('const options = [...modelPickerMenu.querySelectorAll(".model-option")]'), "app.js: grouped model picker must preserve keyboard option traversal");
assert(chatScript.includes('bubble.className = "message-bubble"'), "app.js: user messages need a nested visual bubble");
assert(chatScript.includes("contentTarget.append(createMessageMeta(message))"), "app.js: user metadata should remain inside the visual bubble");
assert(styles.includes("calc((100% - 720px) / 2)"), "styles.css: the conversation reading column must be 720px");
assert(styles.includes("width: min(720px, 100%);"), "styles.css: the composer must align with the reading column");
assert(styles.includes(".dialog-primary:disabled"), "styles.css: batch route creation needs a visible disabled state");
assert(chatScript.includes('promptInput.addEventListener("input", () => saveActiveDraft())'), "app.js: missing draft input persistence");
assert(chatScript.includes("restoreActiveDraft();"), "app.js: missing draft restoration");
assert(chatScript.includes("clearUserDrafts(previousUser);"), "app.js: logout must clear local drafts");
assert(chatScript.includes('connectionState.classList.add("route-unhealthy")'), "app.js: selected unhealthy route must be visible");
assert(chatScript.includes("近期巡检异常，失败时会尝试备用线路"), "app.js: unhealthy route selection must explain fallback");
assert(chatScript.includes('openModelPicker(event.key === "ArrowUp" ? "last" : "selected")'), "app.js: model picker trigger needs arrow-key navigation");
assert(chatScript.includes('event.key === "Tab"'), "app.js: model picker must close when keyboard focus leaves");
assert(chatScript.includes("bootView.hidden = true;"), "app.js: startup state must resolve into an application view");
assert(chatScript.includes("preserveCloudConflict(chat, data.currentChat)"), "app.js: cloud save conflicts must preserve both versions");
assert(chatScript.includes("restoreSessionRoute(session)"), "app.js: switching chats must restore the chat model");
assert(chatScript.includes("active.routeId = routeId"), "app.js: model changes must persist on the active chat");
assert(chatScript.includes("branchConversationAt(index)"), "app.js: messages must support non-destructive conversation branching");
assert(chatScript.includes("原会话保持不变"), "app.js: branching must explain that the source chat is preserved");
assert(chatScript.includes("已创建编辑分支"), "app.js: editing history must preserve the original chat");
assert(chatScript.includes("createResponseBranch(userIndex, \"重新生成\")"), "app.js: regenerating must preserve the original chat");
assert(chatScript.includes("createResponseBranch(index, \"重发\")"), "app.js: resending must preserve the original chat");
assert(chatScript.includes("parentChatId: source.id"), "app.js: branches must retain their source chat");
assert(chatScript.includes("branchOriginButton.hidden = !active.parentChatId"), "app.js: branch navigation must reflect the active chat");
assert(chatScript.includes("已开始空白会话，原会话保持不变"), "app.js: clearing must not destroy chat history");
assert(chatScript.includes("commitPendingSessionDeletion"), "app.js: cloud chat deletion must be delayed for undo");
assert(chatScript.includes("undoPendingSessionDeletion"), "app.js: deleted chats must be recoverable during the undo window");
assert(chatScript.includes("expectedUpdatedAt="), "app.js: chat deletion must not remove a newer cloud version");
assert(chatScript.includes("已切换到空白会话"), "app.js: new chat should reuse an existing blank session");
assert(chatScript.includes("merged_session_limit"), "app.js: imports must not silently evict existing chats");
assert(chatScript.includes("expectedRevision: memoryRevision"), "app.js: memory saves must reject stale editors");
assert(chatScript.includes("MEMORY_DRAFT_PREFIX"), "app.js: unsaved memory edits need user-scoped local drafts");
assert(chatScript.includes("summaryInFlight.has(sessionId)"), "app.js: a chat must not run overlapping summary updates");
assert(chatScript.includes("sessions.find((session) => session.id === sessionId)"), "app.js: summary results must return to their source chat");
assert(chatScript.includes("queueCloudSave(target, true)"), "app.js: summary updates must sync the source chat, not the currently open chat");
assert(chatScript.includes("cloudSaveQueue.set(chat.id, chat)"), "app.js: concurrent cloud saves must retain each chat identity");
assert(chatScript.includes("cloudSaveTimers.set(chat.id, timer)"), "app.js: save debouncing must be isolated per chat");
assert(chatScript.includes("deletedSessionIds.has(chat.id)"), "app.js: deleted chats must not re-enter the cloud save queue");
assert(chatScript.includes("cancelQueuedCloudSave(id)"), "app.js: deleting a chat must cancel its queued saves");
assert(chatScript.includes("所有设备均已退出"), "app.js: deleting all data must disclose account-wide session revocation");
assert(chatScript.includes("已恢复未保存修改"), "app.js: restored memory drafts need visible status");
assert(chatScript.includes("formatVersion: 4"), "app.js: full backups need the current schema version");
assert(chatScript.includes("unsupported_backup_version"), "app.js: newer backup formats must be rejected safely");
assert(chatScript.includes('mode: "restore"'), "app.js: explicit backup imports must use restore semantics");
assert(chatScript.includes("routeId: session.routeId"), "app.js: backups must preserve each chat model");
assert(chatScript.includes("skillIds: normalizeSelectedSkillIds(session.skillIds)"), "app.js: backups must preserve selected Skills");
assert(chatScript.includes("toolEvents: item.role === \"assistant\" ? normalizeToolEvents"), "app.js: stored tool events must be normalized");
assert(chatScript.includes("formatVersion > 4"), "app.js: backup imports must reject future schemas after v4");
for (const id of ["capabilityButton", "capabilityPopover", "skillSelectorList", "selectedSkills", "capabilityToolContext"]) {
  assert(chatHtml.includes(`id="${id}"`), `index.html: missing capability control #${id}`);
}
assert(chatScript.includes('response.headers.get("X-Chatus-Stream") === "capability-v1"'), "app.js: capability responses need a dedicated stream parser");
assert(chatScript.includes('fetchWithTimeout("/api/tool-approvals"'), "app.js: tool confirmations need the authenticated approval endpoint");
assert(chatScript.includes('"X-Chatus-Client": "web"'), "app.js: tool confirmations must satisfy the Worker web-client boundary");
assert(chatScript.includes('if (isBusy && id !== activeSessionId)'), "app.js: active capability streams must remain attached to their source chat");
assert(chatScript.includes("MAX_SELECTED_SKILLS"), "app.js: Skill selection needs a fixed upper bound");
assert(chatScript.indexOf("await loadUserSessions") < chatScript.indexOf("renderCapabilitySelector();", chatScript.indexOf("await loadUserSessions")), "app.js: capability rendering must wait until conversations are loaded");
assert(chatScript.includes("renderToolTimeline(message)"), "app.js: assistant messages need a visible tool timeline");
assert(chatScript.includes("pendingToolApprovals.delete(eventId)"), "app.js: confirmation controls must become stale after one decision");
assert(styles.includes(".tool-approval-actions"), "styles.css: tool confirmations need stable touch-visible layout");
assert(chatScript.includes("跨用户导入"), "app.js: backup imports must disclose a different source user");
assert(chatScript.includes("（此设备副本）"), "app.js: local conflict copy must be identifiable");
assert(chatScript.includes("startLoginRetryCountdown(retryAfter)"), "app.js: login throttling needs a retry countdown");
assert(chatScript.includes('data.reset === "daily"'), "app.js: minute and daily rate limits must remain distinct");
assert(chatScript.includes("async function fetchWithTimeout"), "app.js: non-streaming requests need bounded timeouts");
assert(chatScript.includes('const response = await fetch("/api/chat"'), "app.js: streaming chat must remain user-cancellable without a fixed timeout");
assert(chatScript.includes('reducedMotion || distance > 1600 ? "auto" : "smooth"'), "app.js: smooth scrolling must respect reduced-motion preferences");
assert(chatScript.includes("Chatus 诊断信息"), "app.js: user support diagnostics are missing");
const diagnosticStart = chatScript.indexOf("async function copyDiagnostics()");
const diagnosticEnd = chatScript.indexOf("\n}\n", diagnosticStart);
const diagnosticSource = chatScript.slice(diagnosticStart, diagnosticEnd);
assert(!diagnosticSource.includes("userApiKey"), "app.js: diagnostics must not include API keys");
assert(styles.includes("button:focus-visible"), "styles.css: keyboard controls need a visible focus ring");
assert(styles.includes("@media (prefers-reduced-motion: reduce)"), "styles.css: motion needs an accessibility fallback");
for (const file of ["public/app.js", "public/admin.js", "public/theme.js"]) {
  const source = await readFile(path.join(root, file), "utf8");
  assert(!source.includes(".style."), `${file}: inline styles weaken the CSP`);
}
assert(adminScript.includes('window.addEventListener("beforeunload"'), "admin.js: unsaved configuration needs a page-leave warning");
assert(adminScript.includes("confirmDiscardChanges"), "admin.js: internal navigation must protect unsaved configuration");
assert(adminScript.includes("resetUnsavedEditors"), "admin.js: discarded edits must restore saved form values");
assert(adminScript.includes('attentionPanel.hidden = currentAdminSection !== "overview" || alerts.length === 0'), "admin.js: overview alerts must not leak into other admin sections after refresh");
assert(adminScript.includes('markDirty("access")'), "admin.js: generated access codes must be marked unsaved");
assert(adminScript.includes("expectedRevision: configRevision"), "admin.js: config saves must reject stale editors");
assert(adminScript.includes('method: "DELETE",\n    body: JSON.stringify({ expectedRevision: configRevision })'), "admin.js: config resets must reject stale editors");
assert(adminScript.includes("attemptSaveConfig"), "admin.js: form save failures need visible feedback");
assert(adminScript.includes("expectedRevision: accessRevision"), "admin.js: access-code saves must reject stale editors");
assert(adminScript.includes("expectedRevision: memoryRevision"), "admin.js: memory saves must reject stale editors");
assert(adminHtml.includes('id="routeSecretInput" type="password" autocomplete="new-password"'), "admin.html: managed route key must use a write-only password input");
assert(adminScript.includes("/api/admin/route-secrets/"), "admin.js: managed route keys need the authenticated vault API");
assert((adminScript.match(/clearRouteSecretInput\(\)/g) || []).length >= 5, "admin.js: route key input must be cleared across save and navigation transitions");
const routeSaveStart = adminScript.indexOf('routeForm.addEventListener("submit"');
const routeSaveEnd = adminScript.indexOf("deleteRouteButton.addEventListener", routeSaveStart);
const routeSaveSource = adminScript.slice(routeSaveStart, routeSaveEnd);
assert(routeSaveSource && !routeSaveSource.includes("routeSecretInput"), "admin.js: raw route keys must never enter route configuration");
const modelFetchStart = adminScript.indexOf("async function fetchRouteModels()");
const modelFetchEnd = adminScript.indexOf("function setRouteHealth", modelFetchStart);
const modelFetchSource = adminScript.slice(modelFetchStart, modelFetchEnd);
assert(modelFetchSource && !modelFetchSource.includes("routeSecretInput"), "admin.js: model listing must send only the route key reference");
assert(!adminHtml.includes("<datalist"), "admin.html: route models must not use a native datalist");
const routeModelInputTag = adminHtml.match(/<input[^>]*id="routeModelInput"[^>]*>/)?.[0] || "";
assert(routeModelInputTag && !/\slist=/.test(routeModelInputTag), "admin.html: route model input must preserve independent manual entry");
for (const id of ["browseRouteModelsButton", "routeModelDialog", "routeModelSearchInput", "routeModelList", "routeModelPrefixInput", "routeModelSelectionStatus", "batchCreateRoutesButton"]) {
  assert(adminHtml.includes(`id="${id}"`), `admin.html: missing model chooser control #${id}`);
}
const modelListStart = adminScript.indexOf("function renderRouteModelList()");
const modelListEnd = adminScript.indexOf("function updateRouteModelSelection", modelListStart);
const modelListSource = adminScript.slice(modelListStart, modelListEnd);
const modelFilterSource = modelListSource.slice(0, modelListSource.indexOf("for (const model of visible)"));
assert(modelFilterSource.includes("routeModelSearchInput") && !/\brouteModelInput\b/.test(modelFilterSource), "admin.js: model search must be independent from the selected model field");
assert(modelListSource.includes("打开时始终显示完整列表"), "admin.js: opening the chooser must expose the full fetched model list");
const batchCreateStart = adminScript.indexOf("async function createSelectedModelRoutes()");
const batchCreateEnd = adminScript.indexOf("function deriveRoutePrefix", batchCreateStart);
const batchCreateSource = adminScript.slice(batchCreateStart, batchCreateEnd);
assert(batchCreateSource.includes("uniqueRouteId"), "admin.js: batch-created routes need collision-safe IDs");
assert(!batchCreateSource.includes("routeSecretInput"), "admin.js: batch route creation must never read plaintext route secrets");
assert(!batchCreateSource.includes("allowedRoutes"), "admin.js: batch route creation must preserve explicit user route permissions");
for (const id of [
  "allowedToolsBox", "routeToolsInput", "capabilitySkillsPanel", "capabilityToolsPanel", "capabilityMcpPanel",
  "skillForm", "skillToolsBox", "toolForm", "mcpForm", "mcpSecretInput", "discoverMcpToolsButton",
]) {
  assert(adminHtml.includes(`id="${id}"`), `admin.html: missing AI capability control #${id}`);
}
assert(adminHtml.includes('id="mcpSecretInput" type="password" autocomplete="new-password"'), "admin.html: MCP secret must use a write-only password input");
assert(adminScript.includes("/api/admin/mcp-secrets/"), "admin.js: MCP credentials need the authenticated write-only vault API");
assert((adminScript.match(/clearMcpSecretInput\(\)/g) || []).length >= 5, "admin.js: MCP plaintext must clear across save and navigation transitions");
const mcpSaveStart = adminScript.indexOf('mcpForm?.addEventListener("submit"');
const mcpSaveEnd = adminScript.indexOf('deleteMcpButton?.addEventListener', mcpSaveStart);
const mcpSaveSource = adminScript.slice(mcpSaveStart, mcpSaveEnd);
assert(mcpSaveSource && !mcpSaveSource.includes("mcpSecretInput"), "admin.js: raw MCP credentials must never enter config saves");
const discoveryStart = adminScript.indexOf("async function discoverMcpTools()");
const discoveryEnd = adminScript.indexOf("async function checkRouteHealth", discoveryStart);
const discoverySource = adminScript.slice(discoveryStart, discoveryEnd);
assert(discoverySource.includes("schemaChanged") && discoverySource.includes("enabled: existing && !schemaChanged"), "admin.js: new or schema-changed MCP tools must remain disabled");
assert(discoverySource && !discoverySource.includes("mcpSecretInput.value"), "admin.js: MCP discovery must use only saved secret references");

console.log("Frontend structure checks passed");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
