import { describe, expect, it } from "vitest";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ciWorkflowRaw from "../.github/workflows/ci.yml?raw";
import deployWorkflowRaw from "../.github/workflows/deploy.yml?raw";
import acceptanceWorkflowRaw from "../.github/workflows/production-acceptance.yml?raw";
import checkFrontendSourceRaw from "../scripts/check-frontend.mjs?raw";
import agentRunnerSourceRaw from "../scripts/run-browser-agent-e2e.mjs?raw";
import packageSourceRaw from "../package.json?raw";
import { classifyChangedPaths } from "../scripts/classify-ci-paths.mjs";
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

describe("delivery path classification", () => {
  it("runs Workspace Playwright only for workspace-facing paths", () => {
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

  it("classifies documentation and Trellis records without deploying", () => {
    expect(classifyChangedPaths(["docs/operations.md", ".trellis/tasks/01-01-example/prd.md"])).toEqual({
      workspace: false,
      agent: false,
      deploy: false,
      docsOnly: true,
      paths: [".trellis/tasks/01-01-example/prd.md", "docs/operations.md"],
    });
  });

  it("does not let a documentation file hide a runtime change", () => {
    expect(classifyChangedPaths(["README.md", "src/worker.ts"])).toMatchObject({
      agent: true,
      deploy: true,
      docsOnly: false,
    });
  });

  it("treats executable Trellis scripts as code rather than records", () => {
    expect(classifyChangedPaths([".trellis/scripts/task.py"])).toMatchObject({
      deploy: true,
      docsOnly: false,
    });
  });
});

describe("pull-request delivery workflow", () => {
  it("keeps stable quality and conditional browser checks", () => {
    expect(ciWorkflow).toContain("pull_request:");
    expect(ciWorkflow).toContain("quality:");
    expect(ciWorkflow).toContain("workspace-browser:");
    expect(ciWorkflow).toContain("agent-browser:");
    expect(ciWorkflow).toContain("npm run check:frontend");
    expect(ciWorkflow).toContain("npm test");
    expect(ciWorkflow).toContain("npm run typecheck");
    expect(ciWorkflow).toContain("npx wrangler deploy --dry-run");
    expect(ciWorkflow).toContain("git diff --check");
    expect(ciWorkflow).toContain('git diff --check "$BASE_SHA" "$HEAD_SHA"');
    expect(ciWorkflow).toContain("npm run test:browser:workspace");
    expect(ciWorkflow).toContain("npm run test:browser:agent");
    expect(ciWorkflow).toContain("actions/upload-artifact@v4");
    expect(ciWorkflow).not.toContain("acceptance:production");
    expect(ciWorkflow).not.toContain("smoke:production");
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

describe("main deployment governance", () => {
  it("skips docs-only deployment and retains exact-SHA artifacts", () => {
    expect(deployWorkflow).toContain("classify-ci-paths.mjs");
    expect(deployWorkflow).toContain("deployment-skipped:");
    expect(deployWorkflow).toContain("needs.changes.outputs.deploy");
    expect(deployWorkflow).toContain("write-delivery-manifest.mjs");
    expect(deployWorkflow).toContain("actions/upload-artifact@v4");
    expect(deployWorkflow).toContain("Checkout deployment revision");
    expect(deployWorkflow).toContain(
      "- name: Checkout deployment revision\n        uses: actions/checkout@v5\n        with:\n          fetch-depth: 0",
    );
    expect(deployWorkflow.match(/git ls-remote origin refs\/heads\/main/g)).toHaveLength(2);
  });

  it("retains a production-acceptance summary without moving acceptance into PR CI", () => {
    expect(acceptanceWorkflow).toContain("write-delivery-manifest.mjs");
    expect(acceptanceWorkflow).toContain("actions/upload-artifact@v4");
    expect(acceptanceWorkflow).toContain("steps.acceptance.outcome");
    expect(acceptanceWorkflow).toContain("refs/heads/main");
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
        return new Response(JSON.stringify({ result: queues }), { status: 200 });
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

  it("stays on the approved 0.x version line", () => {
    expect(JSON.parse(packageSource).version).toMatch(/^0\./u);
  });
});

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
