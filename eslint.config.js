import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import prettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores([
    "node_modules/",
    "dist/",
    "coverage/",
    ".vite/",
    ".svelte-kit/",
    ".vitest/",
    ".tmp/",
    ".evidence/",
    ".questions/",
    ".ctx/",
    "src/**",
    "frontend/**",
    "prisma/**",
    "video-materials/**",
    "tests/unit/**",
    "tests/integration/**",
    "tests/helpers/**",
  ]),
  {
    files: [
      "eslint.config.js",
      "vitest.config.ts",
      "scripts/**/*.mjs",
      "packages/**/*.{ts,tsx}",
      "tests/framework/**/*.{ts,tsx,mjs}",
      "examples/**/*.{js,mjs,ts,tsx}",
      "apps/**/*.{js,mjs,ts,tsx}",
    ],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      "no-console": "off",
    },
  },
  prettier,
]);
