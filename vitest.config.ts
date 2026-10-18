import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Explicit so a run from the main checkout doesn't also pick up tests in .claude/worktrees.
    include: ["src/**/*.test.ts", "worker/**/*.test.ts"],
  },
});
