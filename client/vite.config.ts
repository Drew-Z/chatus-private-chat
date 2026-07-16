import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "client",
  plugins: [react()],
  base: "/react-chat/",
  build: {
    outDir: "../public/react-chat",
    emptyOutDir: true,
    assetsDir: "assets",
  },
});
