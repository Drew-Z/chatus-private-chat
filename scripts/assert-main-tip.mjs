import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const MAIN_REF = "refs/heads/main";
const SHA_PATTERN = /^[a-f0-9]{40}$/u;

export async function assertMainTip(options = {}) {
  const expectedSha = normalizeSha(options.expectedSha);
  if (!SHA_PATTERN.test(expectedSha)) {
    throw new Error("Expected main revision must be a 40-character lowercase Git SHA");
  }

  let output;
  try {
    output = await (options.readRemoteMain ?? readRemoteMain)();
  } catch {
    throw new Error("Unable to read the remote main revision");
  }

  const remoteSha = parseRemoteMain(output);
  if (remoteSha !== expectedSha) {
    throw new Error("Refusing to deploy a revision that is no longer the main branch tip");
  }
  return remoteSha;
}

export function parseRemoteMain(output) {
  const lines = String(output ?? "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length !== 1) throw new Error("Remote main revision is missing or ambiguous");

  const fields = lines[0].split(/\s+/u);
  if (fields.length !== 2 || fields[1] !== MAIN_REF || !SHA_PATTERN.test(fields[0])) {
    throw new Error("Remote main revision is invalid");
  }
  return fields[0];
}

async function readRemoteMain() {
  const { stdout } = await execFileAsync("git", ["ls-remote", "origin", MAIN_REF], {
    encoding: "utf8",
  });
  return stdout;
}

function normalizeSha(value) {
  return String(value ?? "").trim();
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  try {
    const sha = await assertMainTip({ expectedSha: process.env.GITHUB_SHA });
    process.stdout.write(`Verified main tip ${sha}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Main revision verification failed"}\n`);
    process.exitCode = 1;
  }
}
