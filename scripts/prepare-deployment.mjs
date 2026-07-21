import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  buildDeploymentConfig,
  collectWorkerSecrets,
  readInstanceConfiguration,
  validateCloudflareCredentials,
} from "./deployment-config.mjs";

const baseConfigPath = resolve("wrangler.jsonc");
const deploymentConfigPath = resolve(".wrangler.deploy.jsonc");
const workerSecretsPath = resolve(".prod.secrets.json");

async function readBaseConfig() {
  let source;
  try {
    source = await readFile(baseConfigPath, "utf8");
  } catch {
    throw new Error("Unable to read wrangler.jsonc");
  }
  try {
    return JSON.parse(source);
  } catch {
    throw new Error("wrangler.jsonc must remain valid JSON-compatible JSONC");
  }
}

async function main() {
  const instance = readInstanceConfiguration(process.env);
  validateCloudflareCredentials(process.env);
  const workerSecrets = collectWorkerSecrets(process.env);
  const deploymentConfig = buildDeploymentConfig(await readBaseConfig(), instance);

  await mkdir(dirname(deploymentConfigPath), { recursive: true });
  await writeFile(deploymentConfigPath, `${JSON.stringify(deploymentConfig, null, 2)}\n`, "utf8");
  await writeFile(workerSecretsPath, `${JSON.stringify(workerSecrets, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  console.log(`Deployment preflight passed for ${instance.workerName} (${instance.routeMode}).`);
}

try {
  await main();
} catch (error) {
  await Promise.all([
    rm(workerSecretsPath, { force: true }).catch(() => undefined),
    rm(deploymentConfigPath, { force: true }).catch(() => undefined),
  ]);
  const message = error instanceof Error ? error.message : "Unknown deployment preflight error";
  console.error(`Deployment preflight failed: ${message}`);
  process.exitCode = 1;
}
