import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
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

const usesAngularCompiler = packageInfo.manifest.peerDependencies?.["@angular/core"] !== undefined;
const compilerPath = usesAngularCompiler
  ? path.join(
      repoRoot,
      "node_modules",
      "@angular",
      "compiler-cli",
      "bundles",
      "src",
      "bin",
      "ngc.js",
    )
  : path.join(repoRoot, "node_modules", "typescript", "bin", "tsc");
run(process.execPath, [
  compilerPath,
  "-p",
  path.join(packageDirectory, "tsconfig.json"),
  "--outDir",
  path.join(stagingDirectory, "dist"),
]);

const distDirectory = path.join(stagingDirectory, "dist");
if (!existsSync(path.join(distDirectory, "index.js"))) {
  const packageTsconfig = JSON.parse(
    readFileSync(path.join(packageDirectory, "tsconfig.json"), "utf8"),
  );
  const rootDirSetting = packageTsconfig.compilerOptions?.rootDir;
  if (typeof rootDirSetting === "string") {
    const absoluteRootDir = path.resolve(packageDirectory, rootDirSetting);
    const sourceRoot = path.join(packageDirectory, "src");
    const relativeSource = path.relative(absoluteRootDir, sourceRoot);
    const emittedSource = path.join(distDirectory, relativeSource);
    if (existsSync(path.join(emittedSource, "index.js"))) {
      const flattenedDirectory = path.join(stagingDirectory, "dist-flat");
      rmSync(flattenedDirectory, { recursive: true, force: true });
      mkdirSync(flattenedDirectory, { recursive: true });
      for (const entry of readdirSync(emittedSource)) {
        cpSync(path.join(emittedSource, entry), path.join(flattenedDirectory, entry), {
          recursive: true,
        });
      }
      rmSync(distDirectory, { recursive: true, force: true });
      mkdirSync(distDirectory, { recursive: true });
      for (const entry of readdirSync(flattenedDirectory)) {
        cpSync(path.join(flattenedDirectory, entry), path.join(distDirectory, entry), {
          recursive: true,
        });
      }
      rmSync(flattenedDirectory, { recursive: true, force: true });
    }
  }
}

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
