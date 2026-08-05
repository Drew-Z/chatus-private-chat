import { execFile as execFileCallback, spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const execFile = promisify(execFileCallback);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const evidenceDirectory = join(repoRoot, "test-results", "restore-drill");
const vitestBin = join(repoRoot, "node_modules", "vitest", "vitest.mjs");
const maxOutputBytes = 256 * 1024;

const commit = (process.env.RESTORE_DRILL_COMMIT || await currentCommit()).trim();
if (!/^[a-f0-9]{40}$/.test(commit)) {
  throw new Error("restore_drill_commit_invalid");
}

await mkdir(evidenceDirectory, { recursive: true });
const outputPath = join(evidenceDirectory, `${commit}.json`);
let status = "failed";
let evidence;
let diagnostic = "";

try {
  const result = await runVitest(commit);
  diagnostic = result.output;
  if (result.exitCode !== 0) throw new Error("restore_drill_test_failed");
  evidence = parseEvidence(result.output, commit);
  validateEvidence(evidence, commit);
  status = "passed";
} catch (error) {
  diagnostic = diagnostic.slice(-maxOutputBytes);
  const errorCode = error instanceof Error && /^[a-z0-9_:-]+$/.test(error.message)
    ? error.message
    : "restore_drill_failed";
  await writeFile(outputPath, `${JSON.stringify({
    schemaVersion: 1,
    kind: "isolated-restore-drill",
    status,
    commit,
    error: errorCode,
    generatedAt: new Date().toISOString(),
  }, null, 2)}\n`, "utf8");
  process.stderr.write(`${errorCode}\n`);
  process.exitCode = 1;
}

if (status === "passed") {
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  process.stdout.write(`${outputPath}\n`);
}

async function currentCommit() {
  const result = await execFile("git", ["rev-parse", "HEAD"], { cwd: repoRoot });
  return result.stdout;
}

function runVitest(restoreCommit) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [vitestBin, "run", "tests/instance-restore-drill.test.ts", "--reporter=verbose"], {
      cwd: repoRoot,
      env: { ...process.env, RESTORE_DRILL_COMMIT: restoreCommit },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks = [];
    let size = 0;
    const append = (chunk) => {
      const text = chunk.toString();
      chunks.push(text);
      size += Buffer.byteLength(text);
      while (size > maxOutputBytes && chunks.length > 1) {
        size -= Buffer.byteLength(chunks.shift());
      }
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.on("error", reject);
    child.on("close", (exitCode) => resolveResult({ exitCode: exitCode ?? 1, output: chunks.join("") }));
  });
}

function parseEvidence(output, restoreCommit) {
  const marker = "RESTORE_DRILL_EVIDENCE:";
  const index = output.lastIndexOf(marker);
  if (index < 0) throw new Error("restore_drill_evidence_missing");
  const line = output.slice(index + marker.length).split(/\r?\n/, 1)[0];
  let value;
  try {
    value = JSON.parse(line);
  } catch {
    throw new Error("restore_drill_evidence_invalid");
  }
  if (value.commit !== restoreCommit && value.commit !== "b".repeat(40)) {
    throw new Error("restore_drill_commit_mismatch");
  }
  // The Workers test pool does not expose the parent process environment; stamp
  // the exact worktree SHA only after the sanitized marker has been validated.
  value.commit = restoreCommit;
  return value;
}

function validateEvidence(value, restoreCommit) {
  const keys = [
    "schemaVersion", "kind", "status", "commit", "generatedAt", "manifestChecksum",
    "targetIdentityDigest", "sourceBeforeDigest", "sourceAfterDigest", "targetDigest",
    "unresolvedReferences", "loss", "phases", "totals",
  ];
  if (!isExactObject(value, keys) || value.schemaVersion !== 1 || value.kind !== "isolated-restore-drill"
    || value.status !== "passed" || value.commit !== restoreCommit || value.unresolvedReferences !== 0) {
    throw new Error("restore_drill_evidence_invalid");
  }
  if (!isDigest(value.manifestChecksum) || !isDigest(value.targetIdentityDigest)
    || !isDigest(value.sourceBeforeDigest) || !isDigest(value.sourceAfterDigest) || !isDigest(value.targetDigest)) {
    throw new Error("restore_drill_evidence_invalid");
  }
  if (!isExactObject(value.loss, ["capturedThrough", "restoredThrough", "lostItemCount"])
    || value.loss.lostItemCount !== 0 || !Array.isArray(value.phases) || value.phases.length !== 11
    || !isExactObject(value.totals, ["itemCount", "bytes", "durationMs", "operatorWaitMs"])) {
    throw new Error("restore_drill_evidence_invalid");
  }
  const forbidden = ["source-root-", "source-conversation-", "source-user-", "ciphertext", "apiKey", "token"];
  if (forbidden.some((needle) => JSON.stringify(value).includes(needle))) {
    throw new Error("restore_drill_evidence_leak");
  }
}

function isExactObject(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function isDigest(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
