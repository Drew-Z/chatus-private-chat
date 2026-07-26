import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { createServer as createHttpServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const playwrightConfig = join(repoRoot, "tests", "browser", "agent-e2e", "playwright.config.ts");
const playwrightBin = join(repoRoot, "node_modules", "@playwright", "test", "cli.js");
const viteBin = join(repoRoot, "node_modules", "vite", "bin", "vite.js");
const wranglerBin = join(repoRoot, "node_modules", "wrangler", "bin", "wrangler.js");

let temporaryDirectory;
let providerServer;
let wranglerProcess;

try {
  await runCommand(process.execPath, [viteBin, "build", "--config", "client/vite.config.ts"], { cwd: repoRoot });

  temporaryDirectory = await mkdtemp(join(tmpdir(), "chatus-agent-e2e-"));
  const persistDirectory = join(temporaryDirectory, "wrangler-state");
  const outputDirectory = join(temporaryDirectory, "playwright-output");
  await Promise.all([
    mkdir(persistDirectory, { recursive: true }),
    mkdir(outputDirectory, { recursive: true }),
  ]);

  const accessCode = `e2e-${randomBytes(24).toString("base64url")}`;
  const adminToken = `e2e-admin-${randomBytes(24).toString("base64url")}`;
  const providerKey = `sk-e2e-${randomBytes(24).toString("base64url")}`;
  const secrets = [accessCode, adminToken, providerKey];

  const provider = createFakeProvider(providerKey);
  providerServer = provider.server;
  const providerPort = await listenOnRandomPort(providerServer);
  const providerURL = `http://127.0.0.1:${providerPort}`;
  const workerPort = await reserveRandomPort();
  const workerURL = `http://127.0.0.1:${workerPort}`;

  const routesConfig = {
    providers: {
      "e2e-provider": {
        label: "E2E provider",
        type: "openai-chat",
        baseUrl: `${providerURL}/v1`,
        apiKeyRef: "E2E_PROVIDER_KEY",
        concurrency: "unlimited",
        priority: 100,
        supportsImages: true,
        supportsTools: true,
      },
    },
    defaults: {
      defaultRoute: "e2e-chat",
      allowedRoutes: ["e2e-chat"],
      allowBringYourOwnKey: false,
    },
    publicAccess: { enabled: false },
    routes: {
      "e2e-chat": {
        label: "E2E chat",
        offerings: [{ providerId: "e2e-provider", model: "e2e-model" }],
        supportsImages: true,
        supportsTools: true,
      },
    },
  };
  const envFile = join(temporaryDirectory, "runtime.dev.vars");
  await writeFile(
    envFile,
    [
      envLine("ACCESS_CODES", `e2e-member:${accessCode}`),
      envLine("ADMIN_TOKEN", adminToken),
      envLine("SYSTEM_PROMPT", "You are a deterministic end-to-end test assistant."),
      envLine("BLOCKED_PROMPTS", ""),
      envLine("MAX_MEMORY_CHARS", "4000"),
      rawEnvLine("ROUTES_CONFIG", JSON.stringify(routesConfig)),
      envLine("E2E_PROVIDER_KEY", providerKey),
      "",
    ].join("\n"),
    { encoding: "utf8", mode: 0o600 },
  );

  wranglerProcess = spawn(
    process.execPath,
    [
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
    ],
    {
      cwd: repoRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  const wranglerOutput = collectOutput(wranglerProcess, secrets);
  await waitForHttpReady(`${workerURL}/healthz`, wranglerProcess, wranglerOutput, 60_000);
  await verifyMemberRoute(workerURL, accessCode, adminToken, wranglerOutput);

  try {
    await runCommand(
      process.execPath,
      [playwrightBin, "test", "--config", playwrightConfig],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          CHATUS_E2E_BASE_URL: workerURL,
          CHATUS_E2E_ACCESS_CODE: accessCode,
          CHATUS_E2E_PROVIDER_URL: providerURL,
          CHATUS_E2E_OUTPUT_DIR: outputDirectory,
        },
        secrets,
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Playwright failed";
    throw new Error(`${message}\nProvider counters: ${JSON.stringify(provider.state)}`);
  }
} finally {
  await stopChildProcess(wranglerProcess);
  await closeServer(providerServer);
  if (temporaryDirectory) {
    await removeTemporaryDirectory(temporaryDirectory);
  }
}

function createFakeProvider(expectedProviderKey) {
  const state = {
    delayedRequests: 0,
    singleChunkRequests: 0,
    recoveryRequests: 0,
    cancelledStreams: 0,
    memoryToolRequests: 0,
    memoryContinuationRequests: 0,
    fileRequests: 0,
    imageRequests: 0,
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
      if (request.headers.authorization !== `Bearer ${expectedProviderKey}`) {
        writeJson(response, 401, { error: "unauthorized" });
        return;
      }

      const body = await readJsonBody(request);
      const messages = Array.isArray(body.messages) ? body.messages : [];
      const userText = latestUserText(messages);
      const toolResult = messages.findLast((message) => message?.role === "tool");

      if (toolResult) {
        state.memoryContinuationRequests += 1;
        await streamTextResponse(response, [
          { delayMs: 100, text: "记忆审批已完成" },
        ]);
        return;
      }

      if (userText.includes("[e2e:memory]")) {
        const expectedRevision = readExpectedMemoryRevision(body.tools);
        state.memoryToolRequests += 1;
        await streamToolCall(response, {
          id: "call-memory",
          name: "chatus_update_memory",
          arguments: JSON.stringify({
            memory: "- 偏好简洁回答",
            expectedRevision,
          }),
        });
        return;
      }

      if (userText.includes("[e2e:delayed]")) {
        state.delayedRequests += 1;
        await streamTextResponse(response, [
          { delayMs: 350, text: "渐进第一段" },
          { delayMs: 900, text: "渐进第二段" },
        ]);
        return;
      }

      if (userText.includes("[e2e:single]")) {
        state.singleChunkRequests += 1;
        await streamTextResponse(response, [
          { delayMs: 350, text: "单块响应完成" },
        ]);
        return;
      }

      if (userText.includes("[e2e:recover]")) {
        state.recoveryRequests += 1;
        await streamTextResponse(response, [
          { delayMs: 250, text: "恢复第一段" },
          { delayMs: 2_000, text: "恢复第二段" },
        ]);
        return;
      }

      if (userText.includes("[e2e:cancel]")) {
        await streamCancellationScenario(request, response, state);
        return;
      }

      if (userText.includes("[e2e:attachment]")) {
        if (containsAttachedFile(messages)) state.fileRequests += 1;
        if (containsImage(messages)) state.imageRequests += 1;
        await streamTextResponse(response, [
          { delayMs: 100, text: "附件已接收" },
        ]);
        return;
      }

      await streamTextResponse(response, [
        { delayMs: 100, text: userText.includes("[e2e:default]") ? "后续请求可用" : "E2E response" },
      ]);
    } catch {
      if (!response.headersSent) {
        writeJson(response, 400, { error: "invalid_request" });
      } else if (!response.destroyed) {
        response.end();
      }
    }
  });

  return { server, state };
}

async function streamTextResponse(response, chunks) {
  openEventStream(response);
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    await delay(chunk.delayMs);
    if (response.destroyed) return;
    writeSse(response, {
      id: "chatus-e2e",
      model: "e2e-model",
      choices: [{
        index: 0,
        delta: {
          ...(index === 0 ? { role: "assistant" } : {}),
          content: chunk.text,
        },
        finish_reason: null,
      }],
    });
  }
  finishEventStream(response, "stop");
}

async function streamToolCall(response, toolCall) {
  openEventStream(response);
  await delay(150);
  writeSse(response, {
    id: "chatus-e2e-tool",
    object: "chat.completion.chunk",
    created: 1,
    model: "e2e-model",
    choices: [{
      index: 0,
      delta: { role: "assistant" },
      finish_reason: null,
    }],
  });
  writeSse(response, {
    id: "chatus-e2e-tool",
    object: "chat.completion.chunk",
    created: 1,
    model: "e2e-model",
    choices: [{
      index: 0,
      delta: {
        tool_calls: [{
          index: 0,
          id: toolCall.id,
          type: "function",
          function: {
            name: toolCall.name,
            arguments: toolCall.arguments,
          },
        }],
      },
      finish_reason: null,
    }],
  });
  finishEventStream(response, "tool_calls");
}

async function streamCancellationScenario(request, response, state) {
  openEventStream(response);
  await delay(200);
  writeSse(response, {
    id: "chatus-e2e-cancel",
    model: "e2e-model",
    choices: [{
      index: 0,
      delta: { role: "assistant", content: "取消前第一段" },
      finish_reason: null,
    }],
  });

  const aborted = await waitForAbort(request, response, 20_000);
  if (aborted) {
    state.cancelledStreams += 1;
    return;
  }
  finishEventStream(response, "stop");
}

function openEventStream(response) {
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });
  response.flushHeaders();
}

function finishEventStream(response, finishReason) {
  if (response.destroyed) return;
  writeSse(response, {
    id: "chatus-e2e-finish",
    model: "e2e-model",
    choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
  });
  response.end("data: [DONE]\n\n");
}

function writeSse(response, value) {
  response.write(`data: ${JSON.stringify(value)}\n\n`);
}

function collectUserText(messages) {
  const parts = [];
  for (const message of messages) {
    if (message?.role !== "user") continue;
    if (typeof message.content === "string") {
      parts.push(message.content);
      continue;
    }
    if (!Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (part?.type === "text" && typeof part.text === "string") parts.push(part.text);
    }
  }
  return parts.join("\n");
}

function latestUserText(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return collectUserText([messages[index]]);
  }
  return "";
}

function containsAttachedFile(messages) {
  return latestUserText(messages).includes('<attached_file name="fixture.md"');
}

function containsImage(messages) {
  return messages.some((message) => Array.isArray(message?.content)
    && message.content.some((part) => part?.type === "image_url"
      && typeof part.image_url?.url === "string"
      && part.image_url.url.startsWith("data:image/png;base64,")));
}

function readExpectedMemoryRevision(tools) {
  const memoryTool = Array.isArray(tools)
    ? tools.find((entry) => entry?.function?.name === "chatus_update_memory")
    : undefined;
  const revision = memoryTool?.function?.parameters?.properties?.expectedRevision?.const;
  if (typeof revision !== "string") {
    throw new Error("Memory proposal tool did not include a revision contract");
  }
  return revision;
}

async function readJsonBody(request) {
  const chunks = [];
  let byteLength = 0;
  for await (const chunk of request) {
    byteLength += chunk.length;
    if (byteLength > 2 * 1024 * 1024) throw new Error("Request body is too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function writeJson(response, status, value) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
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
  if (!address || typeof address === "string") throw new Error("Could not allocate a provider port");
  return address.port;
}

async function reserveRandomPort() {
  const server = createNetServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not allocate a Worker port");
  const port = address.port;
  await closeServer(server);
  return port;
}

async function waitForHttpReady(url, child, output, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Wrangler exited before it became ready.\n${output.read()}`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
    } catch {
      // The local Worker may still be compiling or initializing Durable Objects.
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for the local Worker.\n${output.read()}`);
}

async function verifyMemberRoute(workerURL, accessCode, adminToken, output) {
  const loginResponse = await fetch(`${workerURL}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: accessCode }),
  });
  const cookie = loginResponse.headers.get("set-cookie")?.split(";", 1)[0];
  if (!loginResponse.ok || !cookie) {
    throw new Error(`Local E2E login preflight failed.\n${output.read()}`);
  }
  const sessionResponse = await fetch(`${workerURL}/api/session`, {
    headers: { cookie },
  });
  const session = await sessionResponse.json().catch(() => null);
  if (!sessionResponse.ok || !Array.isArray(session?.routes) || session.routes.length === 0) {
    const configSummary = await readSafeAdminConfigSummary(workerURL, adminToken);
    const projection = session && typeof session === "object"
      ? {
          keys: Object.keys(session),
          routeCount: Array.isArray(session.routes) ? session.routes.length : null,
          defaultRoute: typeof session.defaultRoute === "string" ? session.defaultRoute : null,
        }
      : null;
    throw new Error(
      `Local E2E route preflight failed (${JSON.stringify({ projection, configSummary })}).\n${output.read()}`,
    );
  }
}

async function readSafeAdminConfigSummary(workerURL, adminToken) {
  const loginResponse = await fetch(`${workerURL}/api/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: adminToken }),
  });
  const cookie = loginResponse.headers.get("set-cookie")?.split(";", 1)[0];
  if (!loginResponse.ok || !cookie) return { error: "admin_login_failed" };
  const response = await fetch(`${workerURL}/api/admin/config`, { headers: { cookie } });
  const snapshot = await response.json().catch(() => null);
  if (!response.ok || !snapshot || typeof snapshot !== "object") return { error: "config_read_failed" };
  return {
    source: typeof snapshot.source === "string" ? snapshot.source : null,
    providerCount: snapshot.config?.providers && typeof snapshot.config.providers === "object"
      ? Object.keys(snapshot.config.providers).length
      : null,
    routeCount: snapshot.config?.routes && typeof snapshot.config.routes === "object"
      ? Object.keys(snapshot.config.routes).length
      : null,
  };
}

function collectOutput(child, secrets = []) {
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => {
    stdout = retainTail(stdout + chunk.toString("utf8"));
  });
  child.stderr?.on("data", (chunk) => {
    stderr = retainTail(stderr + chunk.toString("utf8"));
  });
  return {
    read: () => redact(`${stdout}\n${stderr}`.trim(), secrets),
  };
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
  if (exitCode !== 0) {
    throw new Error(`${command} exited with code ${exitCode}`);
  }
}

function retainTail(value) {
  const maxLength = 256 * 1024;
  return value.length > maxLength ? value.slice(-maxLength) : value;
}

function redact(value, secrets) {
  return secrets.reduce(
    (result, secret) => result.split(secret).join("[redacted]"),
    value,
  );
}

async function waitForAbort(request, response, timeoutMs) {
  if (request.aborted || response.destroyed) return true;
  return new Promise((resolveAbort) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      request.off("aborted", onAbort);
      response.off("close", onClose);
      resolveAbort(value);
    };
    const onAbort = () => finish(true);
    const onClose = () => finish(!response.writableEnded);
    const timer = setTimeout(() => finish(false), timeoutMs);
    request.once("aborted", onAbort);
    response.once("close", onClose);
  });
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

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
