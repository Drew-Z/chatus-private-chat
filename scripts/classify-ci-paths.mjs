import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WORKSPACE_PREFIXES = [
  "client/",
  "public/",
  "tests/browser/workspace-fixture/",
];

const WORKSPACE_FILES = new Set([
  "scripts/check-frontend.mjs",
  "tests/browser/playwright.config.ts",
  "tests/browser/workspace-visual.spec.ts",
]);

const AGENT_PREFIXES = [
  "client/",
  "public/",
  "src/",
  "tests/browser/agent-e2e/",
];

const AGENT_FILES = new Set([
  "scripts/run-browser-agent-e2e.mjs",
  "vitest.config.ts",
]);

const SHARED_FILES = new Set([
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "wrangler.jsonc",
]);

const GOVERNANCE_PREFIXES = [".github/"];

const GOVERNANCE_FILES = new Set([
  "scripts/assert-main-tip.mjs",
  "scripts/classify-ci-paths.mjs",
  "tests/delivery-governance.test.ts",
]);

const DOCUMENTATION_EXTENSIONS = new Set([
  ".gif",
  ".jpeg",
  ".jpg",
  ".md",
  ".mdx",
  ".pdf",
  ".png",
  ".svg",
  ".txt",
  ".webp",
]);

const TRELLIS_RECORD_PREFIXES = [
  ".trellis/tasks/",
  ".trellis/spec/",
  ".trellis/workspace/",
];

const TRELLIS_RECORD_EXTENSIONS = new Set([".json", ".jsonl", ".md"]);

export function classifyChangedPaths(inputPaths, options = {}) {
  const paths = [...new Set(inputPaths.map(normalizePath).filter(Boolean))].sort();
  if (options.all === true) {
    return { workspace: true, agent: true, deploy: true, quality: true, docsOnly: false, paths };
  }

  const docsOnly = paths.length > 0 && paths.every(isDocumentationPath);
  const shared = paths.some((path) => SHARED_FILES.has(path));
  const governance = paths.some(isGovernancePath);
  const workspace = !docsOnly && (shared || governance || paths.some(isWorkspacePath));
  const agent = !docsOnly && (shared || governance || paths.some(isAgentPath));

  return {
    workspace,
    agent,
    deploy: paths.length === 0 || !docsOnly,
    quality: paths.length === 0 || !docsOnly,
    docsOnly,
    paths,
  };
}

function normalizePath(value) {
  return String(value || "").trim().replaceAll("\\", "/").replace(/^\.\//u, "");
}

function isDocumentationPath(path) {
  const lowerPath = path.toLowerCase();
  const extension = readExtension(lowerPath);
  if (extension === ".md") return true;
  if (lowerPath.startsWith("docs/")) return DOCUMENTATION_EXTENSIONS.has(extension);
  return TRELLIS_RECORD_PREFIXES.some((prefix) => lowerPath.startsWith(prefix))
    && TRELLIS_RECORD_EXTENSIONS.has(extension);
}

function isGovernancePath(path) {
  return GOVERNANCE_FILES.has(path) || GOVERNANCE_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function readExtension(path) {
  const slashIndex = path.lastIndexOf("/");
  const dotIndex = path.lastIndexOf(".");
  return dotIndex > slashIndex ? path.slice(dotIndex) : "";
}

function isWorkspacePath(path) {
  return WORKSPACE_FILES.has(path) || WORKSPACE_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function isAgentPath(path) {
  return AGENT_FILES.has(path) || AGENT_PREFIXES.some((prefix) => path.startsWith(prefix));
}

async function main() {
  const args = process.argv.slice(2);
  const all = args.includes("--all");
  const outputPath = readArg(args, "--github-output");
  const manifestPath = readArg(args, "--manifest");
  const input = await readStdin();
  const result = classifyChangedPaths(input.split(/\r?\n/u), { all });
  const output = ["workspace", "agent", "deploy", "quality", "docsOnly"]
    .map((key) => `${key}=${String(result[key])}`)
    .join("\n") + "\n";

  if (outputPath) await writeFile(outputPath, output, { encoding: "utf8", flag: "a" });
  else process.stdout.write(output);

  if (manifestPath) {
    await writeFile(
      manifestPath,
      `${JSON.stringify({ ...result, commit: process.env.GITHUB_SHA || null }, null, 2)}\n`,
      "utf8",
    );
  }
}

function readArg(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value) throw new Error(`${name} requires a value`);
  return resolve(value);
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
