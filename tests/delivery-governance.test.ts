import { describe, expect, it } from "vitest";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";
import ciWorkflowRaw from "../.github/workflows/ci.yml?raw";
import deployWorkflowRaw from "../.github/workflows/deploy.yml?raw";
import acceptanceWorkflowRaw from "../.github/workflows/production-acceptance.yml?raw";
import checkFrontendSourceRaw from "../scripts/check-frontend.mjs?raw";
import agentRunnerSourceRaw from "../scripts/run-browser-agent-e2e.mjs?raw";
import packageSourceRaw from "../package.json?raw";
import vitestConfigSourceRaw from "../vitest.config.ts?raw";
import { TEST_COVERAGE_THRESHOLDS } from "../vitest.constants";
import { classifyChangedPaths } from "../scripts/classify-ci-paths.mjs";
import { assertMainTip, parseRemoteMain } from "../scripts/assert-main-tip.mjs";
import { createDeliveryManifest } from "../scripts/write-delivery-manifest.mjs";
import { provisionR2Bucket } from "../scripts/provision-r2-bucket.mjs";
import { provisionDocumentIngestQueues } from "../scripts/provision-document-ingest-queues.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const normalizeText = (source: string) => source.replace(/\r\n?/gu, "\n");
const ciWorkflow = normalizeText(ciWorkflowRaw);
const deployWorkflow = normalizeText(deployWorkflowRaw);
const acceptanceWorkflow = normalizeText(acceptanceWorkflowRaw);
const checkFrontendSource = normalizeText(checkFrontendSourceRaw);
const agentRunnerSource = normalizeText(agentRunnerSourceRaw);
const packageSource = normalizeText(packageSourceRaw);
const vitestConfigSource = normalizeText(vitestConfigSourceRaw);

type WorkflowStep = {
  name?: string;
  id?: string;
  uses?: string;
  if?: string;
  run?: string;
  env?: Record<string, unknown>;
  with?: Record<string, unknown>;
};

type WorkflowJob = {
  needs?: string | string[];
  if?: string;
  environment?: string;
  outputs?: Record<string, unknown>;
  steps?: WorkflowStep[];
  "runs-on"?: string;
  "timeout-minutes"?: number;
};

type Workflow = {
  on?: unknown;
  permissions?: Record<string, unknown>;
  concurrency?: Record<string, unknown>;
  jobs: Record<string, WorkflowJob>;
};

const parsedCiWorkflow = parseWorkflow(ciWorkflow, "ci.yml");
const parsedDeployWorkflow = parseWorkflow(deployWorkflow, "deploy.yml");
const parsedAcceptanceWorkflow = parseWorkflow(acceptanceWorkflow, "production-acceptance.yml");

describe("Vitest runtime and coverage governance", () => {
  it("keeps the full Cloudflare suite in one serial Workers pool", () => {
    expect(vitestConfigSource.match(/cloudflareTest\(\{/gu)).toHaveLength(1);
    expect(vitestConfigSource).toContain("exclude: sharedExclude");
    expect(vitestConfigSource).toContain("maxWorkers: 1");
    expect(vitestConfigSource).not.toContain("projects:");
    expect(vitestConfigSource).not.toContain('name: "node"');
  });

  it("uses one explicit Istanbul coverage budget", () => {
    const packageJson = JSON.parse(packageSource) as {
      scripts?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(packageJson.scripts?.test).toBe("vitest run");
    expect(packageJson.scripts?.["test:coverage"]).toBe("vitest run --coverage");
    expect(packageJson.devDependencies?.["@vitest/coverage-istanbul"]).toBe("^4.1.10");
    expect(vitestConfigSource).toContain('provider: "istanbul"');
    expect(vitestConfigSource).not.toContain('provider: "v8"');
    expect(vitestConfigSource).toContain('reporter: ["text", "json-summary", "html"]');
    expect(vitestConfigSource).toContain('reportsDirectory: "coverage"');
    expect(vitestConfigSource).toContain("thresholds: TEST_COVERAGE_THRESHOLDS");
    expect(Object.keys(TEST_COVERAGE_THRESHOLDS).sort()).toEqual([
      "branches",
      "functions",
      "lines",
      "statements",
    ]);
    for (const threshold of Object.values(TEST_COVERAGE_THRESHOLDS)) {
      expect(Number.isInteger(threshold)).toBe(true);
      expect(threshold).toBeGreaterThan(0);
    }
  });
});

describe("delivery path classification", () => {
  it("runs both browser suites for workspace-facing paths", () => {
    expect(classifyChangedPaths(["client/src/components/ChatWorkspace.tsx"])).toMatchObject({
      workspace: true,
      agent: true,
      deploy: true,
      docsOnly: false,
    });
  });

  it("runs fake-Provider Agent tests for Agent and provider paths", () => {
    expect(classifyChangedPaths(["src/agent/team-agent.ts"])).toMatchObject({
      workspace: false,
      agent: true,
      deploy: true,
      docsOnly: false,
    });
  });

  it("runs both suites for shared runtime configuration", () => {
    expect(classifyChangedPaths(["package-lock.json", "wrangler.jsonc"])).toMatchObject({
      workspace: true,
      agent: true,
      deploy: true,
      docsOnly: false,
    });
  });

  it("classifies approved documentation and Trellis record types without deploying", () => {
    const paths = [
      "docs/architecture.svg",
      "docs/operations.md",
      ".trellis/tasks/01-01-example/prd.md",
      ".trellis/tasks/01-01-example/task.json",
      ".trellis/tasks/01-01-example/check.jsonl",
      ".trellis/spec/platform/index.md",
      ".trellis/workspace/zhang/index.md",
    ];
    expect(classifyChangedPaths(paths)).toEqual({
      workspace: false,
      agent: false,
      deploy: false,
      docsOnly: true,
      paths: [...paths].sort(),
    });
  });

  it("does not let a documentation file hide a runtime change", () => {
    expect(classifyChangedPaths(["README.md", "src/worker.ts"])).toMatchObject({
      agent: true,
      deploy: true,
      docsOnly: false,
    });
  });

  it.each([
    ".trellis/scripts/task.py",
    ".trellis/tasks/01-01-example/tool.js",
    ".trellis/spec/platform/check.ts",
    ".trellis/workspace/zhang/replay.py",
    ".trellis/tasks/01-01-example/unknown.yaml",
    "docs/build.js",
  ])("treats executable or unknown record-adjacent path %s as code", (path) => {
    expect(classifyChangedPaths([path])).toMatchObject({ deploy: true, docsOnly: false });
  });

  it.each([
    ".github/workflows/ci.yml",
    ".github/workflows/deploy.yml",
    "scripts/classify-ci-paths.mjs",
    "scripts/assert-main-tip.mjs",
    "tests/delivery-governance.test.ts",
  ])("runs both browser suites when delivery governance path %s changes", (path) => {
    expect(classifyChangedPaths([path])).toMatchObject({
      workspace: true,
      agent: true,
      deploy: true,
      docsOnly: false,
    });
  });

  it("normalizes, deduplicates, and sorts paths deterministically", () => {
    expect(classifyChangedPaths([
      ".\\client\\src\\main.tsx",
      "client/src/main.tsx",
      "  ./README.md  ",
      "",
    ])).toEqual({
      workspace: true,
      agent: true,
      deploy: true,
      docsOnly: false,
      paths: ["README.md", "client/src/main.tsx"],
    });
  });

  it("fails closed for an empty or unknown change list", () => {
    expect(classifyChangedPaths([])).toEqual({
      workspace: false,
      agent: false,
      deploy: true,
      docsOnly: false,
      paths: [],
    });
    expect(classifyChangedPaths(["config-without-extension"])).toMatchObject({
      deploy: true,
      docsOnly: false,
    });
  });

  it("runs every gate for manual all-path classification", () => {
    expect(classifyChangedPaths(["README.md"], { all: true })).toMatchObject({
      workspace: true,
      agent: true,
      deploy: true,
      docsOnly: false,
    });
  });
});

describe("pull-request delivery workflow", () => {
  it("parses workflows with unique keys and rejects duplicate job keys", () => {
    expect(Object.keys(parsedCiWorkflow.jobs).sort()).toEqual([
      "agent-browser",
      "changes",
      "quality",
      "workspace-browser",
    ]);
    expect(() => parseWorkflow([
      "jobs:",
      "  duplicate:",
      "    runs-on: ubuntu-latest",
      "  duplicate:",
      "    runs-on: ubuntu-latest",
    ].join("\n"), "duplicate.yml")).toThrow();
  });

  it("keeps the five quality gates ordered and excludes production operations", () => {
    const quality = getJob(parsedCiWorkflow, "quality");
    expect(quality.needs).toBe("changes");
    expectCommandsInOrder(quality, [
      "npm run check:frontend",
      "npm test -- --coverage",
      "npm run typecheck",
      "npx wrangler deploy --dry-run",
      "git diff --check",
    ]);
    expect(joinJobRuns(quality)).toContain('git diff --check "$BASE_SHA" "$HEAD_SHA"');
    expect(joinWorkflowRuns(parsedCiWorkflow)).not.toContain("acceptance:production");
    expect(joinWorkflowRuns(parsedCiWorkflow)).not.toContain("smoke:production");
  });

  it("wires conditional browser jobs to exact classification outputs", () => {
    const changes = getJob(parsedCiWorkflow, "changes");
    expect(changes.outputs).toEqual({
      workspace: "${{ steps.classify.outputs.workspace }}",
      agent: "${{ steps.classify.outputs.agent }}",
      deploy: "${{ steps.classify.outputs.deploy }}",
    });

    const workspace = getJob(parsedCiWorkflow, "workspace-browser");
    expect(workspace.needs).toBe("changes");
    expect(workspace.if).toBe("needs.changes.outputs.workspace == 'true'");
    expect(joinJobRuns(workspace)).toContain("npm run test:browser:workspace");

    const agent = getJob(parsedCiWorkflow, "agent-browser");
    expect(agent.needs).toBe("changes");
    expect(agent.if).toBe("needs.changes.outputs.agent == 'true'");
    expect(joinJobRuns(agent)).toContain("npm run test:browser:agent");
  });

  it("normalizes frontend structure-check text before multi-line assertions", () => {
    expect(checkFrontendSource).toContain('readFile(file, "utf8")).replace(/\\r\\n?/gu, "\\n")');
    expect(checkFrontendSource).toContain("readText(path.join(root,");
    expect(checkFrontendSource).not.toContain("readFile(path.join(root,");
    expect(checkFrontendSource.match(/readFile\(/gu)).toHaveLength(1);
  });

  it("writes a bounded exact-SHA manifest without secret or user-content fields", async () => {
    const manifest = await createDeliveryManifest({
      kind: "test",
      status: "passed",
      commit: "abc123",
      root: repoRoot,
    });
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      kind: "test",
      status: "passed",
      commit: "abc123",
    });
    expect(
      manifest.packageLockSha256 === null || /^[a-f0-9]{64}$/u.test(manifest.packageLockSha256),
    ).toBe(true);
    expect(Object.keys(manifest).sort()).toEqual([
      "commit",
      "generatedAt",
      "kind",
      "packageLockSha256",
      "publicBundleSha256",
      "schemaVersion",
      "status",
    ]);
  });

  it("retains caller-owned fake-Provider Playwright output without retaining runtime state", () => {
    expect(agentRunnerSource).toContain("CHATUS_E2E_ARTIFACT_DIR");
    expect(agentRunnerSource).toContain("callerOwnsOutputDirectory");
    expect(agentRunnerSource).toContain('join(outputDirectory, "agent-summary.json")');
    expect(agentRunnerSource).toContain("providerCounters: providerState || null");
    expect(agentRunnerSource).toContain("removeTemporaryDirectory(temporaryDirectory)");
    expect(agentRunnerSource).not.toContain("removeTemporaryDirectory(outputDirectory)");
  });
});

describe("workflow structural governance", () => {
  it("enforces bounded job timeouts", () => {
    expectJobTimeouts(parsedCiWorkflow, {
      changes: 5,
      quality: 20,
      "workspace-browser": 20,
      "agent-browser": 20,
    });
    expectJobTimeouts(parsedDeployWorkflow, {
      changes: 5,
      "deployment-skipped": 5,
      deploy: 30,
    });
    expectJobTimeouts(parsedAcceptanceWorkflow, { acceptance: 15 });
  });

  it("uses only approved Node 24 official action majors", () => {
    const approved = new Set([
      "actions/checkout@v7",
      "actions/setup-node@v7",
      "actions/upload-artifact@v7",
    ]);
    const used = [parsedCiWorkflow, parsedDeployWorkflow, parsedAcceptanceWorkflow]
      .flatMap((workflow) => Object.values(workflow.jobs))
      .flatMap((job) => job.steps ?? [])
      .flatMap((step) => step.uses ? [step.uses] : []);
    expect(used.length).toBeGreaterThan(0);
    for (const action of used) expect(approved.has(action), action).toBe(true);
  });

  it("retains exact-SHA artifacts with bounded failure behavior", () => {
    expectArtifact(parsedCiWorkflow, "changes", "Retain path classification", {
      name: "pr-path-classification-${{ github.sha }}",
      path: "artifacts/path-classification/paths.json",
      retentionDays: 14,
    });
    expectArtifact(parsedCiWorkflow, "quality", "Retain quality manifest", {
      name: "pr-quality-${{ github.sha }}",
      path: "artifacts/quality/manifest.json",
      retentionDays: 14,
      always: true,
    });
    expectArtifact(parsedCiWorkflow, "quality", "Retain coverage summary", {
      name: "pr-coverage-${{ github.sha }}",
      path: "coverage/coverage-summary.json",
      retentionDays: 14,
      always: true,
    });
    expectArtifact(parsedCiWorkflow, "workspace-browser", "Retain Workspace Playwright artifacts", {
      name: "workspace-playwright-${{ github.sha }}",
      path: "test-results/workspace-visual",
      retentionDays: 14,
      always: true,
    });
    expectArtifact(parsedCiWorkflow, "agent-browser", "Retain fake-Provider Agent artifacts", {
      name: "agent-playwright-${{ github.sha }}",
      path: "test-results/agent-e2e-ci",
      retentionDays: 14,
      always: true,
    });
    expectArtifact(parsedDeployWorkflow, "changes", "Retain deployment path classification", {
      name: "deployment-paths-${{ github.sha }}",
      path: "artifacts/path-classification/paths.json",
      retentionDays: 30,
    });
    expectArtifact(parsedDeployWorkflow, "deploy", "Retain deployment manifest", {
      name: "production-deployment-${{ github.sha }}",
      path: "artifacts/deployment/manifest.json",
      retentionDays: 90,
      always: true,
    });
    expectArtifact(parsedAcceptanceWorkflow, "acceptance", "Retain production-acceptance summary", {
      name: "production-acceptance-${{ github.sha }}",
      path: "artifacts/production-acceptance/manifest.json",
      retentionDays: 90,
      always: true,
    });
    expectAlwaysStepBefore(parsedCiWorkflow, "quality", "Write quality manifest", "Retain quality manifest");
    expectAlwaysStepBefore(parsedDeployWorkflow, "deploy", "Write deployment manifest", "Retain deployment manifest");
    expectAlwaysStepBefore(
      parsedAcceptanceWorkflow,
      "acceptance",
      "Write acceptance manifest",
      "Retain production-acceptance summary",
    );
  });
});

describe("main deployment governance", () => {
  it("keeps docs-only skip and non-canceling exact-main deployment structure", () => {
    expect(parsedDeployWorkflow.concurrency).toEqual({
      group: "chatus-production-mutation",
      "cancel-in-progress": false,
    });
    const changes = getJob(parsedDeployWorkflow, "changes");
    expect(changes.outputs).toEqual({ deploy: "${{ steps.classify.outputs.deploy }}" });
    expect(joinJobRuns(changes)).toContain("classify-ci-paths.mjs");

    const skipped = getJob(parsedDeployWorkflow, "deployment-skipped");
    expect(skipped.needs).toBe("changes");
    expect(skipped.if).toBe("github.event_name == 'push' && needs.changes.outputs.deploy != 'true'");

    const deploy = getJob(parsedDeployWorkflow, "deploy");
    expect(deploy.needs).toBe("changes");
    expect(deploy.if).toBe("github.event_name == 'workflow_dispatch' || needs.changes.outputs.deploy == 'true'");
    expect(deploy.environment).toBe("production");
    expect(getNamedStep(deploy, "Checkout deployment revision").with).toEqual({ "fetch-depth": 0 });

    const firstGuard = getNamedStepIndex(deploy, "Refuse a stale main revision");
    const provisionR2 = getNamedStepIndex(deploy, "Provision workspace R2 bucket");
    const provisionQueues = getNamedStepIndex(deploy, "Provision document ingest Queues");
    const prepareSecrets = getNamedStepIndex(deploy, "Prepare deployment configuration and Worker secrets");
    const secondGuard = getNamedStepIndex(deploy, "Refuse a stale main revision before deploy");
    const deployWorker = getNamedStepIndex(deploy, "Deploy Worker");
    expect(firstGuard).toBeLessThan(provisionR2);
    expect(firstGuard).toBeLessThan(provisionQueues);
    expect(firstGuard).toBeLessThan(prepareSecrets);
    expect(secondGuard).toBe(deployWorker - 1);
    for (const name of ["Refuse a stale main revision", "Refuse a stale main revision before deploy"]) {
      const step = getNamedStep(deploy, name);
      expect(step.run).toBe("node scripts/assert-main-tip.mjs");
      expect(step.if).toBeUndefined();
    }
  });

  it("keeps production acceptance main-only, serialized, and exact-SHA", () => {
    expect(parsedAcceptanceWorkflow.concurrency).toEqual({
      group: "chatus-production-mutation",
      "cancel-in-progress": false,
    });
    const acceptance = getJob(parsedAcceptanceWorkflow, "acceptance");
    expect(acceptance.if).toBe("github.ref == 'refs/heads/main'");
    expect(acceptance.environment).toBe("production");
    expectCommandsInOrder(acceptance, [
      "smoke:production",
      "acceptance:production",
      "write-delivery-manifest.mjs",
    ]);
    expect(getNamedStep(acceptance, "Write acceptance manifest").env).toEqual({
      DELIVERY_STATUS: "release=${{ steps.release.outcome }},acceptance=${{ steps.acceptance.outcome }}",
    });
  });

  it("validates the remote main revision without leaking command failures", async () => {
    const expectedSha = "a".repeat(40);
    const exactOutput = `${expectedSha}\trefs/heads/main\n`;
    await expect(assertMainTip({
      expectedSha,
      readRemoteMain: async () => exactOutput,
    })).resolves.toBe(expectedSha);
    await expect(assertMainTip({
      expectedSha,
      readRemoteMain: async () => `${"b".repeat(40)}\trefs/heads/main\n`,
    })).rejects.toThrow("no longer the main branch tip");
    await expect(assertMainTip({
      expectedSha,
      readRemoteMain: async () => "",
    })).rejects.toThrow("missing or ambiguous");
    await expect(assertMainTip({
      expectedSha,
      readRemoteMain: async () => `${exactOutput}${exactOutput}`,
    })).rejects.toThrow("missing or ambiguous");
    await expect(assertMainTip({
      expectedSha: "invalid",
      readRemoteMain: async () => exactOutput,
    })).rejects.toThrow("40-character lowercase Git SHA");
    await expect(assertMainTip({
      expectedSha: expectedSha.toUpperCase(),
      readRemoteMain: async () => exactOutput,
    })).rejects.toThrow("40-character lowercase Git SHA");

    const commandFailure = assertMainTip({
      expectedSha,
      readRemoteMain: async () => { throw new Error("credential-bearing command detail"); },
    });
    await expect(commandFailure).rejects.toThrow("Unable to read the remote main revision");
    await expect(commandFailure).rejects.not.toThrow("credential-bearing command detail");
    expect(parseRemoteMain(exactOutput)).toBe(expectedSha);
    expect(() => parseRemoteMain(`${"c".repeat(39)}\trefs/heads/main\n`)).toThrow("invalid");
  });

  it("provisions the R2 bucket only after an exact missing response", async () => {
    const requests: Array<{ url: string; method: string; body?: string }> = [];
    const responses = [
      apiResponse(404, false, null, [{ code: 10006 }]),
      apiResponse(200, true, { name: "chatus-test-files" }),
      apiResponse(200, true, { name: "chatus-test-files" }),
    ];
    const result = await provisionR2Bucket({
      accountId: "a".repeat(32),
      apiToken: "test-token",
      bucketName: "chatus-test-files",
      fetchImpl: async (url, init = {}) => {
        requests.push({
          url: String(url),
          method: init.method || "GET",
          ...(typeof init.body === "string" ? { body: init.body } : {}),
        });
        return responses.shift()!;
      },
      logger: { log() {} },
    });
    expect(result).toEqual({ bucketName: "chatus-test-files", created: true });
    expect(requests.map((request) => request.method)).toEqual(["GET", "POST", "GET"]);
    expect(requests[1]?.body).toBe(JSON.stringify({ name: "chatus-test-files" }));
  });

  it("leaves an existing R2 bucket unchanged", async () => {
    const requests: string[] = [];
    await expect(provisionR2Bucket({
      accountId: "c".repeat(32),
      apiToken: "test-token",
      bucketName: "chatus-test-files",
      fetchImpl: async (_url, init = {}) => {
        requests.push(init.method || "GET");
        return apiResponse(200, true, { name: "chatus-test-files" });
      },
      logger: { log() {} },
    })).resolves.toEqual({ bucketName: "chatus-test-files", created: false });
    expect(requests).toEqual(["GET"]);
  });

  it("fails closed for R2 authorization, network, and malformed response errors", async () => {
    const base = {
      accountId: "b".repeat(32),
      apiToken: "test-token",
      bucketName: "chatus-test-files",
      logger: { log() {} },
      retryDelaysMs: [],
    };
    await expect(provisionR2Bucket({
      ...base,
      fetchImpl: async () => apiResponse(403, false, null, [{ code: 10000 }]),
    })).rejects.toThrow("lookup failed (status 403, codes 10000)");
    await expect(provisionR2Bucket({
      ...base,
      fetchImpl: async () => { throw new Error("network detail"); },
    })).rejects.toThrow("failed before receiving a response");
    await expect(provisionR2Bucket({
      ...base,
      fetchImpl: async () => new Response("not-json", { status: 502 }),
    })).rejects.toThrow("invalid JSON (status 502)");
  });

  it("retries transient R2 lookup failures without retrying writes", async () => {
    const requests: string[] = [];
    const delays: number[] = [];
    let attempt = 0;
    await expect(provisionR2Bucket({
      accountId: "c".repeat(32),
      apiToken: "test-token",
      bucketName: "chatus-test-files",
      fetchImpl: async (_url, init = {}) => {
        requests.push(init.method || "GET");
        attempt += 1;
        if (attempt === 1) return new Response("edge unavailable", { status: 522 });
        return apiResponse(200, true, { name: "chatus-test-files" });
      },
      logger: { log() {} },
      retryDelaysMs: [7],
      sleepImpl: async (delayMs: number) => { delays.push(delayMs); },
    })).resolves.toEqual({ bucketName: "chatus-test-files", created: false });
    expect(requests).toEqual(["GET", "GET"]);
    expect(delays).toEqual([7]);
  });

  it("verifies a R2 bucket after a lost create response instead of retrying the write", async () => {
    const requests: string[] = [];
    let attempt = 0;
    await expect(provisionR2Bucket({
      accountId: "d".repeat(32),
      apiToken: "test-token",
      bucketName: "chatus-test-files",
      fetchImpl: async (_url, init = {}) => {
        requests.push(init.method || "GET");
        attempt += 1;
        if (attempt === 1) return apiResponse(404, false, null, [{ code: 10006 }]);
        if (attempt === 2) throw new Error("network detail");
        return apiResponse(200, true, { name: "chatus-test-files" });
      },
      logger: { log() {} },
      retryDelaysMs: [],
    })).resolves.toEqual({ bucketName: "chatus-test-files", created: false });
    expect(requests).toEqual(["GET", "POST", "GET"]);
  });

  it("provisions the document ingest DLQ before the main Queue and verifies both", async () => {
    const requests: Array<{ url: string; method: string; body?: string }> = [];
    const queueNames = ["chatus-test-document-dlq", "chatus-test-document"];
    const responses = queueNames.flatMap((queueName) => [
      apiResponse(200, true, [], [], { page: 1, total_pages: 0 }),
      apiResponse(200, undefined, { queue_id: `${queueName}-id`, queue_name: queueName }, []),
      apiResponse(200, true, [{ queue_id: `${queueName}-id`, queue_name: queueName }], [], { page: 1, total_pages: 1 }),
    ]);

    await expect(provisionDocumentIngestQueues({
      accountId: "d".repeat(32),
      apiToken: "test-token",
      queueName: "chatus-test-document",
      deadLetterQueueName: "chatus-test-document-dlq",
      fetchImpl: async (url, init = {}) => {
        requests.push({
          url: String(url),
          method: init.method || "GET",
          ...(typeof init.body === "string" ? { body: init.body } : {}),
        });
        return responses.shift()!;
      },
      logger: { log() {} },
    })).resolves.toEqual({
      deadLetterQueue: { queueName: "chatus-test-document-dlq", created: true },
      queue: { queueName: "chatus-test-document", created: true },
    });

    expect(requests.map((request) => request.method)).toEqual(["GET", "POST", "GET", "GET", "POST", "GET"]);
    expect(new URL(requests[0]!.url).searchParams.get("page")).toBe("1");
    expect(new URL(requests[0]!.url).searchParams.get("name")).toBeNull();
    expect(requests[1]?.body).toBe(JSON.stringify({ queue_name: "chatus-test-document-dlq" }));
    expect(new URL(requests[3]!.url).searchParams.get("page")).toBe("1");
    expect(new URL(requests[3]!.url).searchParams.get("name")).toBeNull();
    expect(requests[4]?.body).toBe(JSON.stringify({ queue_name: "chatus-test-document" }));
  });

  it("leaves existing document ingest Queues unchanged", async () => {
    const requests: string[] = [];
    const queues = [
      { queue_id: "dlq-id", queue_name: "chatus-test-document-dlq" },
      { queue_id: "queue-id", queue_name: "chatus-test-document" },
    ];
    await expect(provisionDocumentIngestQueues({
      accountId: "e".repeat(32),
      apiToken: "test-token",
      queueName: "chatus-test-document",
      deadLetterQueueName: "chatus-test-document-dlq",
      fetchImpl: async (url, init = {}) => {
        const requestUrl = new URL(String(url));
        requests.push(`${init.method || "GET"} page=${requestUrl.searchParams.get("page")}`);
        return new Response(JSON.stringify({
          success: true,
          errors: null,
          messages: null,
          result: queues,
          result_info: {},
        }), { status: 200 });
      },
      logger: { log() {} },
    })).resolves.toEqual({
      deadLetterQueue: { queueName: "chatus-test-document-dlq", created: false },
      queue: { queueName: "chatus-test-document", created: false },
    });
    expect(requests).toEqual([
      "GET page=1",
      "GET page=1",
    ]);
  });

  it("searches every Queue page locally and rejects ambiguous exact matches", async () => {
    const requests: string[] = [];
    const base = {
      accountId: "2".repeat(32),
      apiToken: "test-token",
      queueName: "chatus-test-document",
      deadLetterQueueName: "chatus-test-document-dlq",
      logger: { log() {} },
    };
    await expect(provisionDocumentIngestQueues({
      ...base,
      fetchImpl: async (url, init = {}) => {
        const requestUrl = new URL(String(url));
        const page = Number(requestUrl.searchParams.get("page"));
        requests.push(`${init.method || "GET"} page=${page} name=${requestUrl.searchParams.get("name")}`);
        const result = page === 1
          ? [{ queue_id: "main-id", queue_name: "chatus-test-document" }]
          : [{ queue_id: "dlq-id", queue_name: "chatus-test-document-dlq" }];
        return new Response(JSON.stringify({
          result,
          result_info: { page, total_pages: 2 },
        }), { status: 200 });
      },
    })).resolves.toEqual({
      deadLetterQueue: { queueName: "chatus-test-document-dlq", created: false },
      queue: { queueName: "chatus-test-document", created: false },
    });
    expect(requests).toEqual([
      "GET page=1 name=null",
      "GET page=2 name=null",
      "GET page=1 name=null",
      "GET page=2 name=null",
    ]);

    await expect(provisionDocumentIngestQueues({
      ...base,
      fetchImpl: async (url) => {
        const page = Number(new URL(String(url)).searchParams.get("page"));
        return new Response(JSON.stringify({
          result: [{ queue_id: `duplicate-${page}`, queue_name: "chatus-test-document-dlq" }],
          result_info: { page, total_pages: 2 },
        }), { status: 200 });
      },
    })).rejects.toThrow('multiple exact matches for Queue "chatus-test-document-dlq"');
  });

  it("absorbs a concurrent Queue creation without relying on duplicate error codes", async () => {
    const responses = [
      apiResponse(200, true, [], []),
      apiResponse(409, false, null, [{ code: 99999 }]),
      apiResponse(200, true, [{ queue_id: "dlq-id", queue_name: "chatus-test-document-dlq" }], []),
      apiResponse(200, true, [{ queue_id: "queue-id", queue_name: "chatus-test-document" }], []),
    ];
    await expect(provisionDocumentIngestQueues({
      accountId: "f".repeat(32),
      apiToken: "test-token",
      queueName: "chatus-test-document",
      deadLetterQueueName: "chatus-test-document-dlq",
      fetchImpl: async () => responses.shift()!,
      logger: { log() {} },
    })).resolves.toEqual({
      deadLetterQueue: { queueName: "chatus-test-document-dlq", created: false },
      queue: { queueName: "chatus-test-document", created: false },
    });
  });

  it("fails closed for Queue authorization, malformed envelopes, and non-exact verification", async () => {
    const base = {
      accountId: "1".repeat(32),
      apiToken: "test-token",
      queueName: "chatus-test-document",
      deadLetterQueueName: "chatus-test-document-dlq",
      logger: { log() {} },
      retryDelaysMs: [],
    };
    await expect(provisionDocumentIngestQueues({
      ...base,
      fetchImpl: async () => apiResponse(403, false, null, [{ code: 10000 }]),
    })).rejects.toThrow("lookup failed (status 403, codes 10000)");
    await expect(provisionDocumentIngestQueues({
      ...base,
      fetchImpl: async () => new Response(JSON.stringify({
        success: "secret-success-value",
        result: [],
        errors: { token: "secret-token-value" },
      }), { status: 200 }),
    })).rejects.toThrow(
      "invalid envelope (status 200; shape success=string,errors=object,messages=missing,result=array,result_info=missing)",
    );
    const arrayEnvelopeFailure = provisionDocumentIngestQueues({
      ...base,
      fetchImpl: async () => new Response(JSON.stringify(["secret-array-value"]), { status: 200 }),
    });
    await expect(arrayEnvelopeFailure).rejects.toThrow("invalid envelope (status 200; shape array)");
    await expect(arrayEnvelopeFailure).rejects.not.toThrow("secret-array-value");
    await expect(provisionDocumentIngestQueues({
      ...base,
      fetchImpl: async () => new Response(JSON.stringify({ result: [], result_info: { page: 2, total_pages: 2 } }), { status: 200 }),
    })).rejects.toThrow("invalid pagination");
    const responses = [
      apiResponse(200, true, [], []),
      apiResponse(200, true, { queue_id: "wrong-id", queue_name: "wrong-name" }, []),
      apiResponse(200, true, [{ queue_id: "wrong-id", queue_name: "wrong-name" }], []),
    ];
    await expect(provisionDocumentIngestQueues({
      ...base,
      fetchImpl: async () => responses.shift()!,
    })).rejects.toThrow("post-create verification failed");
  });

  it("retries transient Queue lookup failures without retrying Queue creation", async () => {
    const requests: string[] = [];
    const delays: number[] = [];
    let attempt = 0;
    await expect(provisionDocumentIngestQueues({
      accountId: "3".repeat(32),
      apiToken: "test-token",
      queueName: "chatus-test-document",
      deadLetterQueueName: "chatus-test-document-dlq",
      fetchImpl: async (url, init = {}) => {
        const method = init.method || "GET";
        requests.push(method);
        attempt += 1;
        if (attempt === 1) return new Response("edge unavailable", { status: 520 });
        return apiResponse(200, true, [
          { queue_id: "dlq-id", queue_name: "chatus-test-document-dlq" },
          { queue_id: "queue-id", queue_name: "chatus-test-document" },
        ], []);
      },
      logger: { log() {} },
      retryDelaysMs: [11],
      sleepImpl: async (delayMs: number) => { delays.push(delayMs); },
    })).resolves.toEqual({
      deadLetterQueue: { queueName: "chatus-test-document-dlq", created: false },
      queue: { queueName: "chatus-test-document", created: false },
    });
    expect(requests).toEqual(["GET", "GET", "GET"]);
    expect(delays).toEqual([11]);
  });

  it("verifies a Queue after a lost create response instead of retrying the write", async () => {
    const requests: string[] = [];
    let attempt = 0;
    await expect(provisionDocumentIngestQueues({
      accountId: "4".repeat(32),
      apiToken: "test-token",
      queueName: "chatus-test-document",
      deadLetterQueueName: "chatus-test-document-dlq",
      fetchImpl: async (_url, init = {}) => {
        requests.push(init.method || "GET");
        attempt += 1;
        if (attempt === 1) return apiResponse(200, true, [], []);
        if (attempt === 2) throw new Error("network detail");
        if (attempt === 3) return apiResponse(200, true, [
          { queue_id: "dlq-id", queue_name: "chatus-test-document-dlq" },
        ], []);
        return apiResponse(200, true, [
          { queue_id: "queue-id", queue_name: "chatus-test-document" },
        ], []);
      },
      logger: { log() {} },
      retryDelaysMs: [],
    })).resolves.toEqual({
      deadLetterQueue: { queueName: "chatus-test-document-dlq", created: false },
      queue: { queueName: "chatus-test-document", created: false },
    });
    expect(requests).toEqual(["GET", "POST", "GET", "GET"]);
  });

  it("stays on the approved 0.x version line", () => {
    expect(JSON.parse(packageSource).version).toMatch(/^0\./u);
  });
});

function parseWorkflow(source: string, name: string): Workflow {
  const document = parseDocument(source, { prettyErrors: true, uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new Error(`${name} is invalid: ${document.errors.map((error) => error.message).join("; ")}`);
  }
  const parsed: unknown = document.toJS();
  if (!isRecord(parsed) || !isRecord(parsed.jobs)) throw new Error(`${name} must define a jobs mapping`);
  return parsed as Workflow;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getJob(workflow: Workflow, name: string): WorkflowJob {
  const job = workflow.jobs[name];
  if (!isRecord(job)) throw new Error(`Workflow job ${name} is missing or invalid`);
  return job as WorkflowJob;
}

function getJobSteps(job: WorkflowJob): WorkflowStep[] {
  if (!Array.isArray(job.steps)) throw new Error("Workflow job steps are missing or invalid");
  return job.steps;
}

function getNamedStep(job: WorkflowJob, name: string): WorkflowStep {
  const step = getJobSteps(job).find((candidate) => candidate.name === name);
  if (!step) throw new Error(`Workflow step ${name} is missing`);
  return step;
}

function getNamedStepIndex(job: WorkflowJob, name: string): number {
  const index = getJobSteps(job).findIndex((candidate) => candidate.name === name);
  if (index === -1) throw new Error(`Workflow step ${name} is missing`);
  return index;
}

function joinJobRuns(job: WorkflowJob): string {
  return getJobSteps(job).flatMap((step) => typeof step.run === "string" ? [step.run] : []).join("\n");
}

function joinWorkflowRuns(workflow: Workflow): string {
  return Object.values(workflow.jobs).map(joinJobRuns).join("\n");
}

function expectCommandsInOrder(job: WorkflowJob, commands: string[]) {
  const runs = getJobSteps(job).map((step) => step.run ?? "");
  let previous = -1;
  for (const command of commands) {
    const index = runs.findIndex((run, candidateIndex) => candidateIndex > previous && run.includes(command));
    expect(index, `Expected command after step ${previous}: ${command}`).toBeGreaterThan(previous);
    previous = index;
  }
}

function expectJobTimeouts(workflow: Workflow, expected: Record<string, number>) {
  expect(Object.keys(workflow.jobs).sort()).toEqual(Object.keys(expected).sort());
  for (const [name, timeout] of Object.entries(expected)) {
    const value = getJob(workflow, name)["timeout-minutes"];
    expect(value, `${name} timeout`).toBe(timeout);
    expect(value, `${name} timeout must stay bounded`).toBeLessThanOrEqual(timeout);
  }
}

function expectArtifact(
  workflow: Workflow,
  jobName: string,
  stepName: string,
  expected: { name: string; path: string; retentionDays: number; always?: boolean },
) {
  const step = getNamedStep(getJob(workflow, jobName), stepName);
  expect(step.uses).toBe("actions/upload-artifact@v7");
  expect(step.with).toEqual({
    name: expected.name,
    path: expected.path,
    "if-no-files-found": "error",
    "retention-days": expected.retentionDays,
  });
  expect(step.if).toBe(expected.always ? "always()" : undefined);
}

function expectAlwaysStepBefore(workflow: Workflow, jobName: string, writerName: string, uploadName: string) {
  const job = getJob(workflow, jobName);
  const writer = getNamedStep(job, writerName);
  expect(writer.if).toBe("always()");
  expect(getNamedStepIndex(job, writerName)).toBeLessThan(getNamedStepIndex(job, uploadName));
}

function apiResponse(
  status: number,
  success: boolean | undefined,
  result: unknown,
  errors: unknown[],
  resultInfo?: Record<string, unknown>,
) {
  return new Response(JSON.stringify({
    ...(success === undefined ? {} : { success }),
    result,
    errors,
    messages: [],
    ...(resultInfo === undefined ? {} : { result_info: resultInfo }),
  }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
