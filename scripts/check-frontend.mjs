import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const pages = [
  { html: "public/index.html", script: "public/app.js" },
  { html: "public/admin.html", script: "public/admin.js" },
];

for (const file of ["public/app.js", "public/admin.js", "public/markdown.js", "public/theme.js", "public/pwa.js", "public/sw.js"]) {
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
const styles = await readFile(path.join(root, "public/styles.css"), "utf8");
assert(chatScript.includes('./markdown.js?v=development'), "app.js: markdown module must share the release fingerprint");
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
assert(chatScript.includes("commitPendingSessionDeletion"), "app.js: cloud chat deletion must be delayed for undo");
assert(chatScript.includes("undoPendingSessionDeletion"), "app.js: deleted chats must be recoverable during the undo window");
assert(chatScript.includes("已切换到空白会话"), "app.js: new chat should reuse an existing blank session");
assert(chatScript.includes("merged_session_limit"), "app.js: imports must not silently evict existing chats");
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
assert((await readFile(path.join(root, "public/admin.js"), "utf8")).includes('window.addEventListener("beforeunload"'), "admin.js: unsaved configuration needs a page-leave warning");
assert((await readFile(path.join(root, "public/admin.js"), "utf8")).includes("confirmDiscardChanges"), "admin.js: internal navigation must protect unsaved configuration");
assert((await readFile(path.join(root, "public/admin.js"), "utf8")).includes("resetUnsavedEditors"), "admin.js: discarded edits must restore saved form values");

console.log("Frontend structure checks passed");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
