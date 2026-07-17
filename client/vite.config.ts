import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
  root: "client",
  plugins: [
    react(),
    {
      name: "copy-legacy-shell",
      apply: "build",
      async writeBundle() {
        const legacyDirectory = path.join(projectRoot, "public", "legacy");
        await mkdir(legacyDirectory, { recursive: true });
        await copyFile(path.join(projectRoot, "public", "index.html"), path.join(legacyDirectory, "index.html"));
      },
    },
  ],
  base: "/react-chat/",
  build: {
    outDir: "../public/react-chat",
    emptyOutDir: true,
    assetsDir: "assets",
  },
});
