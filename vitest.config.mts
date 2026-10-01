import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "tests/**/*.test.ts"],
    exclude: ["tests/**/*.e2e.test.ts", "tests/perf/**", "node_modules/**", "dist/**", "dist-app/**"],
    testTimeout: 30000,
    setupFiles: ["./tests/setup.ts"],
  },
});
