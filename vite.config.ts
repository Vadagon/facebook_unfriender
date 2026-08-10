import react from "@vitejs/plugin-react";
import { cp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

function copyExtensionFiles(): Plugin {
  return {
    name: "copy-extension-files",
    async closeBundle() {
      const root = process.cwd();
      const output = resolve(root, "dist");
      await mkdir(output, { recursive: true });
      await Promise.all([
        cp(resolve(root, "manifest.json"), resolve(output, "manifest.json")),
        cp(resolve(root, "background.js"), resolve(output, "background.js")),
        cp(resolve(root, "icons"), resolve(output, "icons"), { recursive: true }),
        cp(resolve(root, "_locales"), resolve(output, "_locales"), { recursive: true })
      ]);
    }
  };
}

export default defineConfig({
  plugins: [react(), copyExtensionFiles()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(process.cwd(), "sidepanel.html")
    }
  }
});
