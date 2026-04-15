import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["test/**/*.test.ts"],
    exclude: ["test/**/node_modules/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      exclude: [
        "test/**",
        "node_modules/**",
        "dist/**",
        "**/*.d.ts",
      ],
      include: [
        "src/walrus-storage.ts",
        "src/walrus-batch.ts",
        "src/walrus-optimistic-lock.ts",
        "src/walrus-cost.ts",
        "src/sql-parser.ts",
        "src/sql-errors.ts",
        "src/walrus-skeleton.ts",
      ],
      thresholds: {
        lines: 75,
        functions: 80,
        branches: 64,
        statements: 73,
      },
    },
    testTimeout: 30_000,
  },
});
