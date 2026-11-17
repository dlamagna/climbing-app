import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { type Plugin, defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { injectManifest, precacheUrls } from "./src/swPrecache";

// Writes this build's file list and a version (hash of every file) into dist/sw.js, so the service worker
// precaches the whole app shell on install and clears older caches on activate.
function swPrecache(): Plugin {
  let outDir = "dist";
  return {
    name: "sw-precache",
    apply: "build",
    configResolved(config) {
      outDir = config.build.outDir.startsWith("/") ? config.build.outDir : join(config.root, config.build.outDir);
    },
    closeBundle() {
      const files = (readdirSync(outDir, { recursive: true, withFileTypes: true }) as import("node:fs").Dirent[])
        .filter((d) => d.isFile())
        .map((d) => relative(outDir, join(d.parentPath, d.name)).split(sep).join("/"))
        .sort();
      const urls = precacheUrls(files);
      const hash = createHash("sha256");
      for (const f of files) if (f !== "sw.js") hash.update(f).update(readFileSync(join(outDir, f)));
      const swPath = join(outDir, "sw.js");
      writeFileSync(swPath, injectManifest(readFileSync(swPath, "utf8"), { version: hash.digest("hex").slice(0, 12), urls }));
    },
  };
}

export default defineConfig({
  plugins: [react(), swPrecache()],
  server: {
    // `npm run dev` for UI work; API calls go to `wrangler dev` on :8787.
    proxy: { "/api": "http://localhost:8787", "/mcp": "http://localhost:8787" },
  },
});
