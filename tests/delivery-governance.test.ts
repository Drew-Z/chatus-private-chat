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

  it("stays on the approved 0.x version line", () => {
    expect(JSON.parse(packageSource).version).toMatch(/^0\./u);
  });
});
