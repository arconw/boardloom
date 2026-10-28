import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { listPackages, repoRoot, run } from "./lib/repo.mjs";

function fail(message) {
  console.error(`build-package: ${message}`);
  process.exit(1);
}

const requested = process.argv[2];
if (!requested) {
  fail("usage: node scripts/build-package.mjs <package-directory>");
}

const packageInfo = listPackages().find(
  (candidate) =>
    candidate.relativeDirectory === `packages/${requested}` ||
    candidate.manifest.name === requested,
);
if (!packageInfo) {
  fail(`unknown package: ${requested}`);
}

const packageDirectory = packageInfo.directory;
const stagingDirectory = path.join(
  repoRoot,
  ".tmp",
  "build",
  "packages",
  path.basename(packageDirectory),
);

rmSync(stagingDirectory, { recursive: true, force: true });
mkdirSync(path.join(stagingDirectory, "dist"), { recursive: true });

const tscPath = path.join(repoRoot, "node_modules", "typescript", "bin", "tsc");
run(process.execPath, [
  tscPath,
  "-p",
  path.join(packageDirectory, "tsconfig.json"),
  "--outDir",
  path.join(stagingDirectory, "dist"),
]);

for (const file of ["package.json", "README.md", "LICENSE", "styles.css"]) {
  const source = path.join(packageDirectory, file);
  if (existsSync(source)) {
    copyFileSync(source, path.join(stagingDirectory, file));
  }
}

for (const required of [
  "package.json",
  "README.md",
  "LICENSE",
  "dist/index.js",
  "dist/index.d.ts",
]) {
  if (!existsSync(path.join(stagingDirectory, required))) {
    fail(`staging output is missing ${required} for ${packageInfo.manifest.name}`);
  }
}
if (
  packageInfo.manifest.name === "@boardloom/view-dom" &&
  !existsSync(path.join(stagingDirectory, "styles.css"))
) {
  fail("staging output is missing styles.css for @boardloom/view-dom");
}

console.log(
  `Built ${packageInfo.manifest.name} into .tmp/build/packages/${path.basename(packageDirectory)}.`,
);
