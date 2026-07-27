import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function createDeliveryManifest({
  kind,
  status,
  commit = process.env.GITHUB_SHA || null,
  root = repoRoot,
}) {
  return {
    schemaVersion: 1,
    kind,
    status,
    commit,
    generatedAt: new Date().toISOString(),
    packageLockSha256: await hashFileIfPresent(resolve(root, "package-lock.json")),
    publicBundleSha256: await hashDirectoryIfPresent(resolve(root, "public", "react-chat")),
  };
}

async function hashFileIfPresent(path) {
  try {
    return sha256(await readFile(path));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function hashDirectoryIfPresent(directory) {
  try {
    if (!(await stat(directory)).isDirectory()) return null;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  const files = await collectFiles(directory);
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(relative(directory, file).replaceAll("\\", "/"));
    hash.update("\0");
    hash.update(await readFile(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function collectFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files.sort();
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function main() {
  const args = process.argv.slice(2);
  const kind = readArg(args, "--kind");
  const status = readArg(args, "--status");
  const output = resolve(readArg(args, "--output"));
  const manifest = await createDeliveryManifest({ kind, status });
  await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function readArg(args, name) {
  const index = args.indexOf(name);
  const value = index === -1 ? undefined : args[index + 1];
  if (!value) throw new Error(`${name} requires a value`);
  return value;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
