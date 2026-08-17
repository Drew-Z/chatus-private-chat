import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const playwrightBin = join(repoRoot, "node_modules", "@playwright", "test", "cli.js");
const config = join(repoRoot, "tests", "browser", "accessibility.config.ts");

async function canRunFirefox() {
  try {
    const result = await import("playwright");
    await access(result.firefox.executablePath(), constants.X_OK);
    return true;
  } catch { return false; }
}

const args = [playwrightBin, "test", "--config", config];
const firefoxAvailable = await canRunFirefox();
if (!firefoxAvailable) args.push("--project=normal-motion", "--project=reduced-motion");
else process.stdout.write("Firefox executable detected; running the cross-engine smoke project.\n");
if (!firefoxAvailable) process.stdout.write("SKIP: firefox executable unavailable; Chromium accessibility projects remain deterministic.\n");

const child = spawn(process.execPath, args, { cwd: repoRoot, stdio: "inherit", env: process.env });
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
