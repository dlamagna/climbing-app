import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // `npm run dev` for UI work; API calls go to `wrangler dev` on :8787.
    proxy: { "/api": "http://localhost:8787", "/mcp": "http://localhost:8787" },
  },
});
