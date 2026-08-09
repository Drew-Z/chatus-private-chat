import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { once } from "node:events";
import { createServer as createHttpServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const playwrightConfig = join(repoRoot, "tests", "browser", "product-validation", "playwright.config.ts");
const playwrightBin = join(repoRoot, "node_modules", "@playwright", "test", "cli.js");
const viteBin = join(repoRoot, "node_modules", "vite", "bin", "vite.js");
const wranglerBin = join(repoRoot, "node_modules", "wrangler", "bin", "wrangler.js");
const configuredArtifactDirectory = process.env.CHATUS_VALIDATION_ARTIFACT_DIR?.trim();
const artifactDirectory = configuredArtifactDirectory
  ? resolve(repoRoot, configuredArtifactDirectory)
  : join(repoRoot, "test-results", "product-validation");
const evidenceDirectory = join(artifactDirectory, "evidence");
const outputDirectory = join(artifactDirectory, "playwright");
const runPath = join(evidenceDirectory, "run.json");

let temporaryDirectory;
let wranglerProcess;
let primaryProvider;
let secondaryProvider;
let status = "failed";
let failureCode = null;
let startedAt = new Date().toISOString();
const baseline = readBaseline();

try {
  await runCommand(process.execPath, [viteBin, "build", "--config", "client/vite.config.ts"], { cwd: repoRoot });
  await Promise.all([
    mkdir(evidenceDirectory, { recursive: true }),
    mkdir(outputDirectory, { recursive: true }),
  ]);
  await writeRun();

  temporaryDirectory = await mkdtemp(join(tmpdir(), "chatus-product-validation-"));
  const persistDirectory = join(temporaryDirectory, "wrangler-state");
  await mkdir(persistDirectory, { recursive: true });

  const adminToken = `validation-admin-${randomBytes(24).toString("base64url")}`;
  const primaryKey = `sk-validation-primary-${randomBytes(24).toString("base64url")}`;
  const secondaryKey = `sk-validation-secondary-${randomBytes(24).toString("base64url")}`;
  const masterKey = randomBytes(32).toString("base64");
  const secrets = [adminToken, primaryKey, secondaryKey, masterKey];

  primaryProvider = createFakeProvider("primary", primaryKey);
  secondaryProvider = createFakeProvider("secondary", secondaryKey);
  const primaryPort = await listenOnRandomPort(primaryProvider.server);
  const secondaryPort = await listenOnRandomPort(secondaryProvider.server);
  const primaryURL = `http://127.0.0.1:${primaryPort}`;
  const secondaryURL = `http://127.0.0.1:${secondaryPort}`;
  const workerPort = await reserveRandomPort();
  const workerURL = `http://127.0.0.1:${workerPort}`;

  const initialConfig = {
    providers: {},
    routes: {
      bootstrap: {
        label: "Bootstrap route",
        type: "openai-chat",
        baseUrl: `${primaryURL}/v1`,
        apiKeyRef: "VALIDATION_PRIMARY_KEY",
        model: "bootstrap-model",
        enabled: true,
        supportsImages: true,
        supportsTools: true,
      },
    },
    defaults: {
      defaultRoute: "bootstrap",
      allowedRoutes: ["bootstrap"],
      allowedSkills: [],
      allowedTools: [],
      allowBringYourOwnKey: false,
      dailyMessageLimit: 100,
      minuteMessageLimit: 30,
    },
    users: {},
    publicAccess: { enabled: false },
    skills: {},
    tools: {
      "builtin:text_stats": {
        enabled: true,
        label: "文本统计",
        description: "Count text characters and lines.",
        inputSchema: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"],
          additionalProperties: false,
        },
        confirmation: "auto",
        executor: { type: "builtin", name: "text_stats" },
      },
    },
    mcpServers: {},
  };
  const envFile = join(temporaryDirectory, "runtime.dev.vars");
  await writeFile(envFile, [
    envLine("ACCESS_CODES_MODE", "managed"),
    envLine("ADMIN_TOKEN", adminToken),
    envLine("ROUTE_KEYS_MASTER_KEY", masterKey),
    envLine("SYSTEM_PROMPT", "Use deterministic synthetic validation responses only."),
    envLine("BLOCKED_PROMPTS", ""),
    envLine("MAX_MEMORY_CHARS", "4000"),
    rawEnvLine("ROUTES_CONFIG", JSON.stringify(initialConfig)),
    "",
  ].join("\n"), { encoding: "utf8", mode: 0o600 });

  wranglerProcess = spawn(process.execPath, [
    wranglerBin,
    "dev",
    "--local",
    "--ip",
    "127.0.0.1",
    "--port",
    String(workerPort),
    "--env-file",
    envFile,
    "--persist-to",
    persistDirectory,
  ], {
    cwd: repoRoot,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const wranglerOutput = collectOutput(wranglerProcess, secrets);
  await waitForHttpReady(`${workerURL}/healthz`, wranglerProcess, wranglerOutput, 60_000);

  await runCommand(process.execPath, [playwrightBin, "test", "--config", playwrightConfig], {
    cwd: repoRoot,
    env: {
      ...process.env,
      CHATUS_VALIDATION_BASE_URL: workerURL,
      CHATUS_VALIDATION_ADMIN_TOKEN: adminToken,
      CHATUS_VALIDATION_PRIMARY_PROVIDER_URL: primaryURL,
      CHATUS_VALIDATION_SECONDARY_PROVIDER_URL: secondaryURL,
      CHATUS_VALIDATION_PRIMARY_PROVIDER_KEY: primaryKey,
      CHATUS_VALIDATION_SECONDARY_PROVIDER_KEY: secondaryKey,
      CHATUS_VALIDATION_EVIDENCE_DIR: evidenceDirectory,
      CHATUS_VALIDATION_OUTPUT_DIR: outputDirectory,
    },
    secrets,
  });
  status = "passed";
} catch (error) {
  failureCode = error instanceof Error && /timed out/i.test(error.message)
    ? "validation_timeout"
    : "validation_failed";
  throw error;
} finally {
  await stopChildProcess(wranglerProcess);
  await closeServer(primaryProvider?.server);
  await closeServer(secondaryProvider?.server);
  await writeRun();
  if (temporaryDirectory) await removeTemporaryDirectory(temporaryDirectory);
}

function createFakeProvider(role, expectedKey) {
  const state = {
    requests: 0,
    selectorRequests: 0,
    projectRequests: 0,
    workspaceRequests: 0,
    operationsRequests: 0,
    preOutputFailures: 0,
    postVisibleFailures: 0,
    fallbackSuccesses: 0,
  };
  const server = createHttpServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/__state") {
        writeJson(response, 200, state);
        return;
      }
      if (request.method !== "POST" || url.pathname !== "/v1/chat/completions") {
        writeJson(response, 404, { error: "not_found" });
        return;
      }
      if (request.headers.authorization !== `Bearer ${expectedKey}`) {
        writeJson(response, 401, { error: "unauthorized" });
        return;
      }
      state.requests += 1;
      const body = await readJsonBody(request);
      const messages = Array.isArray(body.messages) ? body.messages : [];
      const userText = latestUserText(messages);
      const allText = collectMessageText(messages);
      const skillIds = readSelectorSkillIds(body, messages);
      if (skillIds !== null) {
        state.selectorRequests += 1;
        writeJson(response, 200, completion(JSON.stringify({ skillIds: skillIds.slice(0, 3) })));
        return;
      }

      if (userText.includes("[product:fallback]")) {
        if (role === "primary") {
          state.preOutputFailures += 1;
          writeJson(response, 503, { error: "synthetic_pre_output_failure" });
          return;
        }
        state.fallbackSuccesses += 1;
        await streamText(response, ["备用线路", "恢复完成"]);
        return;
      }
      if (userText.includes("[product:post-visible-failure]")) {
        state.postVisibleFailures += 1;
        openEventStream(response);
        writeSse(response, chunk("可见输出已开始"));
        await delay(150);
        response.destroy();
        return;
      }
      if (userText.includes("[product:project]")) {
        state.projectRequests += 1;
        await streamText(response, ["项目计划已生成", "：里程碑、风险与验收标准已列出。"]);
        return;
      }
      if (userText.includes("[product:file-analysis]")) {
        if (!allText.includes("Synthetic baseline: alpha=12, beta=18, total=30.") || !allText.includes("Synthetic PDF total 30")) {
          writeJson(response, 400, { error: "workspace_context_missing" });
          return;
        }
        state.workspaceRequests += 1;
        await streamText(response, ["文件分析完成", "：固定版本中的合计为 30。"]);
        return;
      }
      if (userText.includes("[product:operations]")) {
        state.operationsRequests += 1;
        await streamText(response, ["运营检查已完成", "：权限、恢复和审计边界正常。"]);
        return;
      }
      await streamText(response, ["Synthetic validation response"]);
    } catch {
      if (!response.headersSent) writeJson(response, 400, { error: "invalid_request" });
      else if (!response.destroyed) response.end();
    }
  });
  return { server, state };
}

function completion(content) {
  return {
    id: "chatcmpl-validation-selector",
    object: "chat.completion",
    created: 1,
    model: "validation-model",
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
}

async function streamText(response, values) {
  openEventStream(response);
  for (let index = 0; index < values.length; index += 1) {
    await delay(index === 0 ? 250 : 450);
    if (response.destroyed) return;
    writeSse(response, chunk(values[index], index === 0));
  }
  writeSse(response, {
    id: "chatus-validation-finish",
    model: "validation-model",
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
  });
  response.end("data: [DONE]\n\n");
}

function chunk(content, withRole = true) {
  return {
    id: "chatus-validation",
    model: "validation-model",
    choices: [{ index: 0, delta: { ...(withRole ? { role: "assistant" } : {}), content }, finish_reason: null }],
  };
}

function openEventStream(response) {
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });
  response.flushHeaders();
}

function writeSse(response, value) {
  response.write(`data: ${JSON.stringify(value)}\n\n`);
}

function collectMessageText(messages) {
  const output = [];
  for (const message of messages) {
    if (typeof message?.content === "string") output.push(message.content);
    if (!Array.isArray(message?.content)) continue;
    for (const part of message.content) {
      if (part?.type === "text" && typeof part.text === "string") output.push(part.text);
    }
  }
  return output.join("\n");
}

function latestUserText(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return collectMessageText([messages[index]]);
  }
  return "";
}

function readSelectorSkillIds(body, messages) {
  if (body.stream === true) return null;
  const selector = messages.some((message) => typeof message?.content === "string"
    && message.content.includes('Return only strict JSON with exactly this shape: {"skillIds":["id"]}.'));
  if (!selector) return null;
  try {
    const value = JSON.parse(latestUserText(messages));
    if (!Array.isArray(value?.skills)) return [];
    return value.skills.map((skill) => skill?.id)
      .filter((id, index, ids) => typeof id === "string" && id.length > 0 && ids.indexOf(id) === index);
  } catch {
    return [];
  }
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunkValue of request) {
    size += chunkValue.length;
    if (size > 2 * 1024 * 1024) throw new Error("request_too_large");
    chunks.push(chunkValue);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function writeJson(response, statusCode, value) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function envLine(name, value) {
  return `${name}=${JSON.stringify(value)}`;
}

function rawEnvLine(name, value) {
  if (/[\r\n#]/u.test(value)) throw new Error(`${name} must be a single dotenv-safe line`);
  return `${name}=${value}`;
}

async function listenOnRandomPort(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("provider_port_unavailable");
  return address.port;
}

async function reserveRandomPort() {
  const server = createNetServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("worker_port_unavailable");
  const port = address.port;
  await closeServer(server);
  return port;
}

async function waitForHttpReady(url, child, output, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Wrangler exited before ready.\n${output.read()}`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
    } catch {
      // Wrangler may still be compiling or initializing local bindings.
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for the local Worker.\n${output.read()}`);
}

function collectOutput(child, secrets = []) {
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (value) => { stdout = retainTail(stdout + value.toString("utf8")); });
  child.stderr?.on("data", (value) => { stderr = retainTail(stderr + value.toString("utf8")); });
  return { read: () => redact(`${stdout}\n${stderr}`.trim(), secrets) };
}

async function runCommand(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const output = collectOutput(child, options.secrets || []);
  const [exitCode] = await once(child, "exit");
  const text = output.read();
  if (text) process.stdout.write(`${text}\n`);
  if (exitCode !== 0) throw new Error(`${command} exited with code ${exitCode}`);
}

function retainTail(value) {
  return value.length > 256 * 1024 ? value.slice(-256 * 1024) : value;
}

function redact(value, secrets) {
  return secrets.reduce((current, secret) => current.split(secret).join("[redacted]"), value);
}

async function stopChildProcess(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32" && child.pid) {
    const killer = spawn("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true,
    });
    await once(killer, "exit");
    return;
  }
  child.kill("SIGTERM");
  await Promise.race([once(child, "exit"), delay(5_000)]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function closeServer(server) {
  if (!server?.listening) return;
  server.close();
  await once(server, "close");
}

async function removeTemporaryDirectory(directory) {
  let lastError;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await rm(directory, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      await delay(250);
    }
  }
  throw lastError;
}

async function writeRun() {
  if (!evidenceDirectory) return;
  await mkdir(evidenceDirectory, { recursive: true });
  await writeFile(runPath, `${JSON.stringify({
    schemaVersion: 1,
    kind: "product-direction-validation",
    status,
    failureCode,
    startedAt,
    completedAt: status === "failed" && !failureCode ? null : new Date().toISOString(),
    commit: baseline.commit,
    branch: baseline.branch,
    dirty: baseline.dirty,
    dirtyChangeCount: baseline.dirtyChangeCount,
    dirtyFingerprint: baseline.dirtyFingerprint,
    nodeVersion: process.version,
    scenarioIds: ["owner-setup", "project-collaboration", "file-analysis", "skill-operations", "provider-fallback"],
    providerCounters: {
      primary: primaryProvider?.state || null,
      secondary: secondaryProvider?.state || null,
    },
  }, null, 2)}\n`, "utf8");
}

function readBaseline() {
  const commit = gitOutput(["rev-parse", "HEAD"]);
  const branch = gitOutput(["branch", "--show-current"]);
  const statusOutput = gitOutput(["status", "--porcelain=v1"]);
  return {
    commit,
    branch,
    dirty: Boolean(statusOutput),
    dirtyChangeCount: statusOutput ? statusOutput.split(/\r?\n/u).filter(Boolean).length : 0,
    dirtyFingerprint: createHash("sha256").update(statusOutput).digest("hex"),
  };
}

function gitOutput(args) {
  const result = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8", windowsHide: true });
  if (result.status !== 0) return null;
  return result.stdout.trim();
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
