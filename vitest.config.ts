import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  cacheDir: ".tmp/vite",
  resolve: {
    alias: {
      "@boardloom/core": fileURLToPath(new URL("./packages/core/src/index.ts", import.meta.url)),
    },
  },
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
