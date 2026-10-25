import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The public demo (demo/): the real app and worker running in the browser on sample data, as plain
// static files. Relative base, so it works from any folder (GitHub Pages serves it under /climbing-app/).
export default defineConfig({
  root: resolve(import.meta.dirname, "demo"),
  base: "./",
  publicDir: resolve(import.meta.dirname, "public"), // icons (the service worker is copied too but never registered)
  plugins: [react()],
  build: {
    outDir: resolve(import.meta.dirname, "dist-demo"),
    emptyOutDir: true,
    rollupOptions: {
      input: { index: resolve(import.meta.dirname, "demo/index.html"), app: resolve(import.meta.dirname, "demo/app.html") },
    },
  },
});
