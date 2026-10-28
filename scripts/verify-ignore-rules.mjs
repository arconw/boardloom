import { existsSync } from "node:fs";
import path from "node:path";
import { git, isIgnored, isSensitiveName, repoRoot } from "./lib/repo.mjs";

const mustBeIgnored = [
  ".env",
  ".env.local",
  ".ctx/context.md",
  ".tmp/probe.log",
  ".questions/README.md",
  ".evidence/reviews/T01/implementer.md",
  "node_modules/sample/index.js",
  "coverage/index.html",
  "dist/app.js",
  "packages/core/dist/index.js",
  "packages/core/dist/index.d.ts",
  ".vite/cache",
  ".eslintcache",
  "prisma/dev.db",
  "src/server.ts",
  "frontend/src/App.tsx",
  "tests/unit/legacy.test.ts",
  "tests/integration/legacy.test.ts",
  "tests/helpers/database.ts",
  "video-materials/raw.mp4",
  "example.db",
  "example.sqlite3",
  "scripts/scan-secrets.mjs",
];

const mustNotBeIgnored = [
  ".gitignore",
  "LICENSE",
  "package.json",
  "package-lock.json",
  ".npmrc",
  ".nvmrc",
  ".editorconfig",
  ".prettierrc.json",
  ".prettierignore",
  "eslint.config.js",
  "tsconfig.base.json",
  "tsconfig.json",
  "vitest.config.ts",
  "docs/framework/SPEC.md",
  "docs/framework/TASKS.md",
  "docs/framework/WORKFLOW.md",
  "docs/framework/STATUS.md",
  "docs/framework/GOVERNANCE.md",
  "docs/framework/MIGRATION_PLAN.md",
  "docs/framework/decisions/README.md",
  "docs/framework/decisions/ADR-0001-workspace-layout.md",
  "docs/framework/decisions/toolchain-evidence.md",
  "packages/core/package.json",
  "packages/core/src/index.ts",
  "packages/core/LICENSE",
  "packages/view-dom/styles.css",
  "tests/framework/foundation.test.ts",
  "scripts/lib/repo.mjs",
  "scripts/lib/public-surface.mjs",
  "scripts/lib/safe-paths.mjs",
  "scripts/build-package.mjs",
  "scripts/check-public-surface.mjs",
  "scripts/verify-boundaries.mjs",
  "scripts/verify-packages.mjs",
  "tests/framework/boundaries.test.ts",
  "tests/framework/public-surface.test.mjs",
  ".github/workflows/quality.yml",
];

const violations = [];

for (const sample of mustBeIgnored) {
  if (!isIgnored(sample)) {
    violations.push(`${sample}: expected to be ignored but is not`);
  }
}

for (const sample of mustNotBeIgnored) {
  if (!existsSync(path.join(repoRoot, sample))) {
    violations.push(`${sample}: expected public path is missing`);
    continue;
  }
  if (isIgnored(sample)) {
    violations.push(`${sample}: expected to be public but is ignored`);
  }
}

const trackedFiles = git(["ls-files", "-z"], { encoding: "buffer" })
  .toString("utf8")
  .split("\0")
  .filter(Boolean);

for (const trackedFile of trackedFiles) {
  const segments = trackedFile.split("/");
  if (
    segments.some((segment) =>
      [".ctx", ".evidence", ".questions", ".tmp", "coverage", "dist", "node_modules"].includes(
        segment,
      ),
    ) ||
    isSensitiveName(trackedFile)
  ) {
    violations.push(`${trackedFile}: sensitive or local-only path is tracked`);
  }
}

if (violations.length > 0) {
  console.error("Ignore-rule verification failed:");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `Ignore-rule verification passed: ${mustBeIgnored.length} local paths ignored, ${mustNotBeIgnored.length} public paths commit-ready, ${trackedFiles.length} tracked paths checked.`,
  );
}
