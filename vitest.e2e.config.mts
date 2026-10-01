import { defineConfig } from "vitest/config";

// e2e e perf sobre o Electron real (precisa de `npm run build` antes). Serial: um app por vez.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.e2e.test.ts", "tests/perf/**/*.perf.ts"],
    testTimeout: 120000,
    hookTimeout: 120000,
    fileParallelism: false,
    globalSetup: ["./tests/global-teardown.ts"],
    maxWorkers: 1,
  },
});
