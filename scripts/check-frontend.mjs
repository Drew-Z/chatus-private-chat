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
assert(serviceWorker.includes('event.data?.type === "SKIP_WAITING"'), "sw.js: missing update activation handler");
const installHandler = serviceWorker.match(/addEventListener\("install",[\s\S]*?\n\}\);/)?.[0] || "";
assert(installHandler && !installHandler.includes("skipWaiting"), "sw.js: updates must not activate during install");

const chatScript = await readFile(path.join(root, "public/app.js"), "utf8");
assert(chatScript.includes('promptInput.addEventListener("input", () => saveActiveDraft())'), "app.js: missing draft input persistence");
assert(chatScript.includes("restoreActiveDraft();"), "app.js: missing draft restoration");
assert(chatScript.includes("clearUserDrafts(previousUser);"), "app.js: logout must clear local drafts");
assert(chatScript.includes('connectionState.classList.add("route-unhealthy")'), "app.js: selected unhealthy route must be visible");
assert(chatScript.includes("近期巡检异常，失败时会尝试备用线路"), "app.js: unhealthy route selection must explain fallback");

console.log("Frontend structure checks passed");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
