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
const navigationFetch = serviceWorker.match(/async function fetchNavigation\([\s\S]*?\n\}/)?.[0] || "";
assert(navigationFetch.includes("response.status === 404"), "sw.js: navigation 404 responses must use the cached route shell when available");
assert(navigationFetch.includes("response.status >= 500"), "sw.js: navigation 5xx responses must use the cached route shell when available");
assert(navigationFetch.includes("(await caches.match(fallbackPath)) || response"), "sw.js: HTTP fallback must preserve the original response when no shell is cached");
assert(!navigationFetch.includes("response.status === 401") && !navigationFetch.includes("response.status === 403"), "sw.js: authentication errors must not be hidden by an offline shell");
const installHandler = serviceWorker.match(/addEventListener\("install",[\s\S]*?\n\}\);/)?.[0] || "";
assert(installHandler && !installHandler.includes("skipWaiting"), "sw.js: updates must not activate during install");

const chatScript = await readFile(path.join(root, "public/app.js"), "utf8");
const chatHtml = await readFile(path.join(root, "public/index.html"), "utf8");
const adminScript = await readFile(path.join(root, "public/admin.js"), "utf8");
const adminHtml = await readFile(path.join(root, "public/admin.html"), "utf8");
const styles = await readFile(path.join(root, "public/styles.css"), "utf8");
const icons = await readFile(path.join(root, "public/icons.svg"), "utf8");
const workerScript = await readFile(path.join(root, "src/worker.ts"), "utf8");
const reactStyles = await readFile(path.join(root, "client/src/styles.css"), "utf8");
const reactClient = await readFile(path.join(root, "client/src/components/ChatWorkspace.tsx"), "utf8");
const reactSidebar = await readFile(path.join(root, "client/src/components/ConversationSidebar.tsx"), "utf8");
const reactMemoryPanel = await readFile(path.join(root, "client/src/components/MemoryPanel.tsx"), "utf8");
const reactMessageView = await readFile(path.join(root, "client/src/components/MessageView.tsx"), "utf8");
const reactComposer = await readFile(path.join(root, "client/src/components/MessageComposer.tsx"), "utf8");
const reactWorkspaceHeader = await readFile(path.join(root, "client/src/components/WorkspaceHeader.tsx"), "utf8");
const reactAdminApp = await readFile(path.join(root, "client/src/components/AdminApp.tsx"), "utf8");
const reactAdminWorkspace = await readFile(path.join(root, "client/src/components/AdminWorkspace.tsx"), "utf8");
const reactProviderAdmin = await readFile(path.join(root, "client/src/components/ProviderAdminPanel.tsx"), "utf8");
const reactLogicalModelAdmin = await readFile(path.join(root, "client/src/components/LogicalModelAdminPanel.tsx"), "utf8");
const reactReliabilityAdmin = await readFile(path.join(root, "client/src/components/ReliabilityAdminPanel.tsx"), "utf8");
const reactOperationsAdmin = await readFile(path.join(root, "client/src/components/AdminOperationsPanel.tsx"), "utf8");
const reactAdminProvider = await readFile(path.join(root, "client/src/lib/admin-provider.ts"), "utf8");
const reactAdminConfig = await readFile(path.join(root, "client/src/lib/admin-config.ts"), "utf8");
const reactApi = await readFile(path.join(root, "client/src/lib/api.ts"), "utf8");
const reactApp = await readFile(path.join(root, "client/src/App.tsx"), "utf8");
const reactMain = await readFile(path.join(root, "client/src/main.tsx"), "utf8");
const reactBuild = await readFile(path.join(root, "public/react-chat/index.html"), "utf8");
const legacyBuild = await readFile(path.join(root, "public/legacy/index.html"), "utf8");
const reactSourceHtml = await readFile(path.join(root, "client/index.html"), "utf8");
const deployWorkflow = await readFile(path.join(root, ".github/workflows/deploy.yml"), "utf8");
const wranglerConfig = await readFile(path.join(root, "wrangler.jsonc"), "utf8");
assert(reactClient.includes('basePath: session.agent.basePath'), "React client: Agent base path must come from the authenticated session");
assert(reactClient.includes('name: conversationAgentClientName(session.agent.instance, conversation.id)'), "React client: each conversation must have an isolated SDK client identity");
assert(reactClient.includes('resume: true'), "React client: resumable Agent chat must stay enabled");
assert(reactClient.includes('cancelOnClientAbort: false'), "React client: browser cleanup must not cancel resumable server turns");
assert(reactClient.includes('query: { chatId: conversation.id }'), "React client: Agent transport must include the authenticated conversation id");
assert(reactClient.includes('body: () => ({ routeId, skillIds, chatId: conversation.id })'), "React client: Agent turns must include route, Skill, and conversation state");
assert(reactClient.includes("addToolApprovalResponse"), "React client: tool approval rendering is missing");
assert(reactClient.includes("if (busy || accountBusy) return;"), "React client: logout must not abandon an active Agent or account operation");
assert(reactWorkspaceHeader.includes("disabled={busy || accountBusy}"), "React client: logout control must be disabled during an active Agent or account operation");
assert(reactClient.includes("await chat.sendMessage(text ? { text, files: fileParts } : { files: fileParts })"), "React client: text and attachment-only send failures must be observed");
assert(reactClient.includes("resolvePendingDraftAction("), "React client: SDK resolve-with-error status must resolve pending drafts explicitly");
assert(reactClient.includes("const value = input || pendingSubmission?.text || \"\""), "React client: submitted text must remain device-persisted until the request settles");
assert(reactClient.includes("draftGeneration.current === submittedDraftGeneration") && reactClient.includes("setAttachments(submittedAttachments)"), "React client: rejected sends must restore the complete submitted draft only when no newer draft exists");
assert(reactClient.includes("retryFailedTurn") && reactClient.includes('onBranch(conversation, "resend"'), "React client: failed turns need an in-place retry branch action");
assert(reactClient.includes("messageListRef") && reactClient.includes("nearBottom"), "React client: streaming scroll must respect manual transcript scrolling");
assert(reactSidebar.includes("session.tools.map") && reactSidebar.includes("selectedToolIds"), "React sidebar: assigned tools and current Skill activation must remain visible");
assert(reactSidebar.includes('tool.source === "mcp"'), "React sidebar: MCP tools must remain distinguishable without exposing server details");
assert(reactSidebar.includes("onRevokeAllSessions") && reactSidebar.includes("onDeleteUserData") && reactSidebar.includes("onExportUserData"), "React sidebar: account data actions are missing");
assert(reactSidebar.includes("账号与数据") && reactSidebar.includes("清空我的数据") && reactSidebar.includes("注销所有设备"), "React sidebar: account data controls need explicit labels and destructive copy");
assert(reactSidebar.includes("<dialog") && reactSidebar.includes("previousFocusRef.current?.focus()"), "React sidebar: account data confirmations must be modal and restore focus");
assert(reactSidebar.includes("data-sidebar-initial-focus") && reactSidebar.includes('event.key === "Escape"') && reactSidebar.includes("previousSidebarFocusRef.current?.focus()"), "React sidebar: mobile drawer must trap focus, close on Escape, and restore focus");
assert(reactSidebar.includes("conversation-delete-dialog") && !reactSidebar.includes("window.confirm"), "React sidebar: conversation deletion needs an accessible modal instead of window.confirm");
assert(reactSidebar.includes("aria-pressed={active}") && reactSidebar.includes("onViewChange"), "React sidebar: active conversations and the controlled settings view need semantic state");
assert(reactMemoryPanel.includes("preserveDraft: true"), "React memory: conflicts must retain the local draft");
assert(reactMemoryPanel.includes("previousFocusRef") && reactMemoryPanel.includes("closeButtonRef.current?.focus()"), "React memory: modal focus must enter and return from the drawer");
assert(reactMemoryPanel.includes('event.key !== "Tab"') && reactMemoryPanel.includes("panel.querySelectorAll<HTMLElement>"), "React memory: keyboard focus must remain inside the modal drawer");
assert(reactMessageView.includes("sanitizeMarkdownUrl(part.url)"), "React messages: source URLs must use the Markdown protocol sanitizer");
assert(reactMessageView.includes("editOpenerRef") && reactMessageView.includes("restoreEditFocus"), "React messages: edit cancellation must restore focus to its originating action");
assert(reactMessageView.includes('className="message-sources"') && reactMessageView.includes('aria-label="消息来源"'), "React messages: sources need a compact labelled group");
assert(reactClient.includes("<WorkspaceHeader") && !reactClient.includes('className="chat-toolbar"'), "React workspace: title, route, health, and connection must share one compact header");
assert(reactWorkspaceHeader.includes("route.model") && reactWorkspaceHeader.includes("routeHealthLabel") && reactWorkspaceHeader.includes("connectionState"), "React workspace header: logical model, passive health, and connection state are missing");
assert(reactClient.includes("<MessageComposer") && reactComposer.includes("resizeComposerTextarea") && reactComposer.includes('rows={1}'), "React composer: bounded textarea auto-growth is missing");
assert(reactComposer.includes('statusText || "\\u00a0"') && reactComposer.includes("aria-hidden={!statusText}"), "React composer: status space must remain reserved while idle");
assert(reactComposer.includes("<Paperclip") && reactComposer.includes("onPaste={addClipboardImages}") && reactComposer.includes("onDrop={handleDrop}"), "React composer: picker, paste, and drop acquisition must share the attachment workflow");
assert(reactComposer.includes("attachment-strip") && reactComposer.includes("onRemoveAttachment") && reactComposer.includes("onRetryAttachment"), "React composer: attachment previews need remove and retry actions");
assert(reactClient.includes("toAttachmentFileParts(attachments)") && reactClient.includes("releaseAttachmentPreviews"), "React client: attachment messages and preview cleanup are missing");
for (const token of ["--workspace-header-height", "--rail-width", "--transcript-max-width", "--touch-target", "--composer-status-height"]) {
  assert(reactStyles.includes(token), `React styles: missing shared workspace token ${token}`);
}
assert(reactStyles.includes("width: min(100%, var(--transcript-max-width))"), "React styles: transcript width must consume the shared readable-width token");
assert(reactStyles.includes("position: sticky") && reactStyles.includes("env(safe-area-inset-bottom)"), "React styles: composer must remain pinned with mobile safe-area padding");
assert(/@media \(max-width: 780px\)[\s\S]*?\.message-actions \.icon-button \{ width: var\(--touch-target\)/.test(reactStyles), "React styles: touch message actions must use the shared 44px target");
assert(!reactStyles.includes(".message-actions .icon-button { opacity: 0") && !reactStyles.includes(".message-actions { pointer-events: none"), "React styles: message actions must not depend on hover for discovery");
assert(reactStyles.includes(".message.user .markdown-content h1") && reactStyles.includes(".message.user .markdown-content code"), "React styles: user-bubble Markdown needs role-specific contrast");
assert(reactApp.includes("status: \"authenticated\""), "React client: authenticated session gate is missing");
assert(reactApp.includes('surface === "admin"'), "React admin: typed route gate is missing");
assert(reactMain.includes("resolveClientSurface(window.location.pathname)"), "React admin: pathname routing must stay at the composition root");
assert(reactAdminApp.includes("fetchAdminSession()") && reactAdminApp.includes("adminLogin(token)"), "React admin: authenticated session gate is missing");
assert(reactAdminApp.includes("finally {\n      setSubmitting(false);"), "React admin: login submit state must recover after rejected requests");
assert(reactAdminWorkspace.includes("putAdminConfig(config, data.snapshot.revision)"), "React admin: capability saves must use the current config revision");
assert(reactAdminWorkspace.includes('error.code === "config_conflict"') && reactAdminWorkspace.includes("loadAdminData(true)"), "React admin: config conflicts must retain the draft while loading the latest revision");
assert(reactAdminWorkspace.includes('window.addEventListener("beforeunload"'), "React admin: unsaved capability assignments need a page-leave warning");
assert(!reactAdminWorkspace.includes("apiKey") && !reactAdminWorkspace.includes("inputSchema") && !reactAdminWorkspace.includes("endpoint"), "React admin: capability assignment must not render provider credentials or tool schemas");
assert(reactAdminWorkspace.includes('href="/admin.html"'), "React admin: full administration link must target the deployed legacy admin asset");
assert(reactAdminWorkspace.includes('id="routes"') && reactAdminWorkspace.includes("<legend>允许线路</legend>"), "React admin: semantic member route assignment is missing");
assert(reactAdminWorkspace.includes("inheritDefaultRoute") && reactAdminWorkspace.includes("setRouteAllowed("), "React admin: route and default-route inheritance controls are missing");
assert(reactAdminWorkspace.includes("createAdminMemberAccess(") && reactAdminWorkspace.includes("rotateAdminMemberAccess(") && reactAdminWorkspace.includes("revokeAdminMemberAccess("), "React admin: typed member lifecycle actions are missing");
assert(reactAdminWorkspace.includes("removeAdminMemberConfig(") && reactAdminWorkspace.includes("revokeAdminMemberSessions("), "React admin: member configuration reset and session management actions are missing");
assert(reactAdminWorkspace.includes("恢复默认配置") && reactAdminWorkspace.includes("注销所有会话"), "React admin: member operation confirmations are missing");
assert(reactAdminWorkspace.includes("<dialog") && reactAdminWorkspace.includes("dialog.showModal()") && reactAdminWorkspace.includes("previousFocusRef.current?.focus()"), "React admin: member lifecycle dialog must be modal and restore focus");
assert(reactAdminWorkspace.includes('readOnly\n                autoComplete="off"') && reactAdminWorkspace.includes('aria-label="复制访问码"'), "React admin: the one-time access code needs a selectable copy fallback");
assert(!reactAdminWorkspace.includes("/api/admin/access-codes") && !reactAdminWorkspace.includes("generateAccessCode") && !reactAdminWorkspace.includes("randomToken"), "React admin: typed lifecycle must not read raw access codes or generate credentials in the browser");
assert(reactAdminWorkspace.includes("ProviderAdminPanel") && reactAdminWorkspace.includes("LogicalModelAdminPanel") && reactAdminWorkspace.includes("ReliabilityAdminPanel") && reactAdminWorkspace.includes("AdminOperationsPanel"), "React admin: typed provider-pool and operations views are missing");
assert(reactAdminWorkspace.includes("放弃这些修改") && reactAdminWorkspace.includes("setPoolDirty(false)"), "React admin: leaving a pool editor must explicitly discard and clear its local dirty state");
assert(reactProviderAdmin.includes("createProviderDraft") && reactProviderAdmin.includes("使用服务器版本"), "React admin: provider drafts need shared normalization and an explicit conflict reset");
assert(reactProviderAdmin.includes('type="password"') && (reactProviderAdmin.match(/setSecretValue\(\"\"\)/g) || []).length >= 2, "React admin: provider credentials must be write-only and cleared after mutations");
assert(reactProviderAdmin.includes("secretCanEdit") && reactProviderAdmin.includes("hasProviderIdConflict"), "React admin: provider key writes and renames must stay scoped and collision-safe");
assert(reactLogicalModelAdmin.includes("createLogicalModelDraft") && reactLogicalModelAdmin.includes("使用服务器版本"), "React admin: logical-model drafts need shared normalization and an explicit conflict reset");
assert(reactLogicalModelAdmin.includes("hasLogicalModelIdConflict") && reactLogicalModelAdmin.includes("图片能力") && reactLogicalModelAdmin.includes("工具能力"), "React admin: logical-model offering edits need collision guards and capability overrides");
assert(reactReliabilityAdmin.includes("fetchAdminReliability()") && reactReliabilityAdmin.includes("真实任务被动记录") && !reactReliabilityAdmin.includes("discoverAdminProviderModels"), "React admin: reliability must remain passive and model-call free");
assert(reactReliabilityAdmin.includes("averageFirstVisibleLatencyMs") && reactReliabilityAdmin.includes("lastStreamShape") && reactReliabilityAdmin.includes("progressiveSamples"), "React admin: truthful first-output and stream-shape evidence is missing");
assert(reactOperationsAdmin.includes("fetchAdminOperations()") && reactOperationsAdmin.includes("不含消息内容") && !reactOperationsAdmin.includes("chatId}</") && !reactOperationsAdmin.includes("messageId}</"), "React admin: operations must expose only aggregate and metadata views");
assert(reactOperationsAdmin.includes("operations-user-table-wrap") && reactStyles.includes(".operations-user-table-wrap { max-width: 100%; overflow-x: auto; }"), "React admin: operations member usage needs local table overflow");
assert(reactAdminProvider.includes("...(provider || {})") && reactAdminProvider.includes("...(route || {})"), "React admin: draft helpers must retain sanitized fields that are not rendered as controls");
assert(reactApi.includes("hasExactKeys(value, [\"member\", \"accessCode\", \"accessRevision\", \"sessionRevocation\"])") && reactApi.includes("isAdminMemberRevokeResponse"), "React admin: member lifecycle responses need strict secret-aware decoders");
assert(reactApi.includes("isAdminMemberConfigRemovalResponse") && reactApi.includes("isAdminMemberSessionsResponse") && reactApi.includes('hasExactKeys(value, ["ok", "label", "revoked", "complete"])'), "React admin: member reset/session responses need strict decoders");
assert(reactApi.includes('"/api/sessions/revoke-all"') && reactApi.includes('"/api/user-data"') && reactApi.includes('"/api/user-data/export"'), "React client: user session, deletion, and export APIs are missing");
assert(reactApi.includes("fetchAdminReliability") && reactApi.includes('"/api/admin/reliability"'), "React admin: passive reliability API wrapper is missing");
assert(reactApi.includes("hasValidAdminStreamEvidence") && reactApi.includes('"single_chunk"') && reactApi.includes('"progressive"'), "React admin: stream evidence decoder contract is missing");
assert(reactApi.includes("fetchAdminOperations") && reactApi.includes('"/api/admin/stats"') && reactApi.includes('"/api/admin/audit"') && reactApi.includes('"/api/admin/feedback"'), "React admin: operations API wrapper is incomplete");
assert(reactApi.includes("isAdminOperationsStats") && reactApi.includes("isAdminAuditSnapshot") && reactApi.includes("isAdminFeedbackSnapshot"), "React admin: operations responses need strict secret-aware decoders");
assert(reactApi.includes("isUserDataMutationResponse") && reactApi.includes('hasExactKeys(value, ["ok", "revoked"])'), "React client: user data mutations need exact secret-free response validation");
assert(reactApi.includes("isUserDataExport") && reactApi.includes("new TextEncoder().encode(text)"), "React client: user data downloads need exact bounded JSON validation");
assert(reactAdminConfig.includes("routesDirty: false") && reactAdminConfig.includes("if (draft.routesDirty)"), "React admin: untouched route assignments must survive capability-only saves");
assert(reactApi.includes('typeof value.allowBringYourOwnKey === "boolean"') && reactApi.includes('typeof value.hasUserSystemPrompt === "boolean"'), "React client: session policy projection drifted from the Worker response");
assert(reactBuild.includes('/react-chat/assets/'), "React client: Vite output does not use the isolated asset base");
assert(reactBuild.includes('id="root"'), "React client: built application root is missing");
assert(reactBuild.includes('meta name="chatus-release" content="development"'), "React client: built page is missing the release placeholder");
assert(reactBuild.includes('/pwa.js?v=development'), "React client: built page is missing release update registration");
assert(reactBuild.includes('/manifest.webmanifest'), "React client: built page is missing the PWA manifest");
assert(reactSourceHtml.includes('meta name="chatus-release" content="development"'), "React source: release placeholder is missing");
assert(deployWorkflow.includes('"public/react-chat/index.html"'), "Deploy workflow: React build must receive the release fingerprint");
assert(deployWorkflow.includes('"public/legacy/index.html"'), "Deploy workflow: legacy rollback shell must receive the release fingerprint");
assert(wranglerConfig.includes('"DEFAULT_CLIENT": "react"'), "Wrangler: React must be the default client after cutover");
const reactAssets = [...reactBuild.matchAll(/(?:src|href)=["'](\/react-chat\/assets\/[^"']+)["']/g)].map((match) => match[1]);
assert(reactAssets.some((asset) => asset.endsWith(".js")), "React client: built JavaScript asset is missing");
assert(reactAssets.some((asset) => asset.endsWith(".css")), "React client: built stylesheet asset is missing");
for (const asset of reactAssets) {
  const file = path.join(root, "public", asset.replace(/^\//, ""));
  await access(file, constants.R_OK).catch(() => assert(false, `React client: missing built asset ${asset}`));
}
assert(workerScript.includes('url.pathname === "/legacy"'), "Worker: legacy rollback redirect is missing");
assert(workerScript.includes('fetchRewrittenAsset(request, env, url, "/legacy/")'), "Worker: legacy rollback shell is missing");
assert(workerScript.includes('env.DEFAULT_CLIENT === "legacy" ? "/legacy/" : "/react-chat/index.html"'), "Worker: React default and legacy rollback selection is missing");
assert(workerScript.includes('url.pathname === "/react-chat/admin"') && workerScript.includes('fetchRewrittenAsset(request, env, url, "/react-chat/")'), "Worker: typed admin shell fallback must preserve the admin pathname without an Assets index redirect");
assert(workerScript.includes('url.pathname === "/api/admin/members"'), "Worker: typed admin member projection is missing");
assert(workerScript.includes('url.pathname === "/api/admin/reliability"') && workerScript.includes("isRecentProviderRouteReliability"), "Worker: typed reliability must expose only recent passive provider-pair records");
assert(workerScript.includes("firstVisibleLatencyMs: event.firstVisibleLatencyMs") && workerScript.includes("lastFirstVisibleLatencyMs"), "Worker: provider stream evidence is not connected to passive reliability");
assert(workerScript.includes("handleCreateAdminMemberAccess") && workerScript.includes("handleRotateAdminMemberAccess") && workerScript.includes("handleRevokeAdminMemberAccess"), "Worker: narrow member lifecycle endpoints are missing");
assert(workerScript.includes("handleRemoveAdminMemberConfig") && workerScript.includes("requireConfigMutationSnapshot"), "Worker: member configuration removal must be revision checked");
assert(workerScript.includes('url.pathname === "/api/user-data/export"') && workerScript.includes("handleExportUserData"), "Worker: authenticated user data export endpoint is missing");
assert(workerScript.includes("MAX_USER_DATA_EXPORT_BYTES") && workerScript.includes('Content-Disposition'), "Worker: user data export needs a bounded attachment response");
assert(workerScript.includes('error: "last_access_code"') && workerScript.includes("requireAccessCodeMutationSnapshot"), "Worker: member access revocation needs last-code and revision protection");
assert(serviceWorker.includes('if (pathname.startsWith("/legacy")) return "/legacy/"'), "sw.js: legacy navigation cache must stay isolated");
assert(serviceWorker.includes('if (pathname.startsWith("/react-chat")) return "/react-chat/"'), "sw.js: React navigation cache must stay isolated");
assert(serviceWorker.includes('if (pathname.startsWith("/admin")) return "/admin"'), "sw.js: admin navigation cache must stay isolated");
assert(serviceWorker.includes('url.pathname.startsWith("/agent")'), "sw.js: Agent transport must never be cached");
assert(serviceWorker.includes('fetch("/react-chat/")'), "sw.js: install must discover the generated React shell");
assert(legacyBuild === chatHtml, "Legacy build: generated rollback shell drifted from public/index.html");
assert(chatScript.includes('./markdown.js?v=development'), "app.js: markdown module must share the release fingerprint");
assert(adminScript.includes('./admin-report.js?v=development'), "admin.js: report module must share the release fingerprint");
assert(adminHtml.includes('href="/react-chat/admin"'), "admin.html: typed member-capability entry is missing");
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
assert(chatScript.includes("近期真实任务异常，失败时会尝试备用线路"), "app.js: passive route failures must explain fallback");
assert(!chatScript.includes("巡检"), "app.js: chat UI must not imply automatic route probes");
assert(!adminScript.includes("自动巡检"), "admin.js: admin UI must not imply automatic route probes");
assert(!adminScript.includes("缺少近期健康检查"), "admin.js: admin UI must not require recurring manual probes");
assert(adminHtml.includes("刷新状态") && adminHtml.includes("刷新全部"), "admin.html: route controls must describe passive status refresh");
assert(!workerScript.includes("17 × 23") && !workerScript.includes("task_validation_failed"), "worker.ts: diagnostics must not contain model probe tasks");
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
assert(adminHtml.includes('id="providerSecretInput" type="password" autocomplete="new-password"'), "admin.html: managed provider key must use a write-only password input");
assert(adminScript.includes("/api/admin/route-secrets/"), "admin.js: managed provider keys need the authenticated vault API");
assert((adminScript.match(/clearProviderSecretInput\(\)/g) || []).length >= 5, "admin.js: provider key input must be cleared across save and navigation transitions");
const routeSaveStart = adminScript.indexOf('routeForm.addEventListener("submit"');
const routeSaveEnd = adminScript.indexOf("skillSelect?.addEventListener", routeSaveStart);
const routeSaveSource = adminScript.slice(routeSaveStart, routeSaveEnd);
assert(routeSaveSource && !routeSaveSource.includes("providerSecretInput"), "admin.js: raw provider keys must never enter logical model configuration");
assert(routeSaveSource.includes("replaceRouteReferences(previous, routeId)"), "admin.js: logical model renames must preserve user and fallback references");
assert(routeSaveSource.includes("restoreModelAdminState(rollbackState)"), "admin.js: failed logical model saves must restore the previous local configuration");
const providerSaveStart = adminScript.indexOf('providerForm?.addEventListener("submit"');
const providerSaveEnd = adminScript.indexOf("deleteProviderButton", providerSaveStart);
const providerSaveSource = adminScript.slice(providerSaveStart, providerSaveEnd);
assert(adminScript.includes('const PROVIDER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;'), "admin.js: provider IDs must use the server-compatible safe grammar");
assert(adminHtml.includes('id="providerIdInput" autocomplete="off" placeholder="openrouter" pattern="[A-Za-z0-9][A-Za-z0-9._-]{0,79}" maxlength="80"'), "admin.html: provider ID input must expose the server-compatible pattern and length");
assert(providerSaveSource && !providerSaveSource.includes("providerSecretInput"), "admin.js: raw provider keys must never enter provider configuration");
assert(providerSaveSource.includes("restoreModelAdminState(rollbackState)"), "admin.js: failed provider saves must restore the previous local configuration");
const modelFetchStart = adminScript.indexOf("async function fetchProviderModels()");
const modelFetchEnd = adminScript.indexOf("function invalidateRouteModels", modelFetchStart);
const modelFetchSource = adminScript.slice(modelFetchStart, modelFetchEnd);
assert(modelFetchSource.includes("providerId") && !modelFetchSource.includes("providerSecretInput"), "admin.js: model listing must identify the provider without sending plaintext keys");
assert(!adminHtml.includes("<datalist"), "admin.html: provider models must not use a native datalist");
for (const id of ["providerForm", "providerAdminSelect", "routeForm", "routeOfferingsList", "addRouteOfferingButton", "providerModelDialog", "providerModelSearchInput", "providerModelList", "providerModelPrefixInput", "providerModelSelectionStatus", "batchAddOfferingsButton"]) {
  assert(adminHtml.includes(`id="${id}"`), `admin.html: missing model chooser control #${id}`);
}
const modelListStart = adminScript.indexOf("function renderProviderModelList()");
const modelListEnd = adminScript.indexOf("function updateProviderModelSelection", modelListStart);
const modelListSource = adminScript.slice(modelListStart, modelListEnd);
const modelFilterSource = modelListSource.slice(0, modelListSource.indexOf("for (const model of visible)"));
assert(modelFilterSource.includes("providerModelSearchInput") && !/\bproviderModelInput\b/.test(modelFilterSource), "admin.js: model search must be independent from the offering editor");
assert(modelListSource.includes("当前显示完整列表"), "admin.js: opening the chooser must expose the full fetched model list");
const batchCreateStart = adminScript.indexOf("async function addSelectedProviderOfferings()");
const batchCreateEnd = adminScript.indexOf("function findLogicalRouteForModel", batchCreateStart);
const batchCreateSource = adminScript.slice(batchCreateStart, batchCreateEnd);
assert(batchCreateSource.includes("providerId") && batchCreateSource.includes("uniqueRouteId"), "admin.js: batch offerings need provider references and collision-safe IDs");
assert(!batchCreateSource.includes("providerSecretInput") && !batchCreateSource.includes("baseUrl") && !batchCreateSource.includes("apiKeyRef"), "admin.js: batch offerings must not duplicate endpoint or credentials");
assert(!batchCreateSource.includes("allowedRoutes"), "admin.js: batch offerings must preserve explicit user route permissions");
assert(adminScript.includes("function normalizeClientConfig") && adminScript.slice(adminScript.indexOf("function normalizeClientConfig"), adminScript.indexOf("function renderCapabilityEditors")).includes("providers"), "admin.js: provider registry must survive editor normalization");
assert(adminScript.includes('typeof value === "object" && !Array.isArray(value)'), "admin.js: config objects must reject arrays during client normalization");
assert(adminScript.includes("migrateLegacyRoute") && adminScript.includes("isLegacyRoute"), "admin.js: legacy routes need an explicit migration path");
assert(adminScript.includes("provider?.hasLegacyKey === true"), "admin.js: provider secret status must use the sanitized legacy-key marker");
const legacyMigrationStart = adminScript.indexOf("async function migrateLegacyRoute()");
const legacyMigrationEnd = adminScript.indexOf("function splitCsv", legacyMigrationStart);
const legacyMigrationSource = adminScript.slice(legacyMigrationStart, legacyMigrationEnd);
assert(legacyMigrationSource.includes("current.hasLegacyKey === true") && legacyMigrationSource.includes("isConfiguredRouteSecret"), "admin.js: legacy migration must require a safe server-side credential before dropping a hidden key");
assert(!legacyMigrationSource.includes("apiKey: current.apiKey"), "admin.js: legacy migration must never copy plaintext keys into provider configuration");
for (const id of [
  "allowedSkillsBox", "allowedToolsBox", "routeToolsInput", "capabilitySkillsPanel", "capabilityToolsPanel", "capabilityMcpPanel",
  "skillForm", "skillToolsBox", "toolForm", "mcpForm", "mcpSecretInput", "discoverMcpToolsButton",
]) {
  assert(adminHtml.includes(`id="${id}"`), `admin.html: missing AI capability control #${id}`);
}
assert(adminScript.includes("allowedSkills: checkedValues(allowedSkillsBox)"), "admin.js: user saves must persist Skill assignments");
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
