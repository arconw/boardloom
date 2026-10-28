import { defineConfig } from "vitest/config";

export default defineConfig({
  cacheDir: ".tmp/vite",
  test: {
    environment: "node",
    include: ["tests/framework/**/*.test.{ts,mjs}"],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    coverage: {
      reportsDirectory: ".tmp/testing/coverage",
    },
  },
});
