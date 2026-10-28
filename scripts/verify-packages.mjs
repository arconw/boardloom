import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { listPackages, repoRoot, run } from "./lib/repo.mjs";

const forbiddenSegments = new Set([
  ".ctx",
  ".env",
  ".evidence",
  ".questions",
  ".tmp",
  "coverage",
  "frontend",
  "legacy",
  "node_modules",
  "prisma",
  "src",
  "test",
  "tests",
  "video-materials",
]);

function parseArgs(argv) {
  let stagingRoot = path.join(repoRoot, ".tmp", "build", "packages");
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--staging-root") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--staging-root requires a directory");
      }
      stagingRoot = path.resolve(repoRoot, value);
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${argv[index]}`);
  }
  return stagingRoot;
}

function fail(message) {
  console.error(`verify-packages: ${message}`);
  process.exit(1);
}

function collectTargets(manifest) {
  const targets = [];
  for (const field of ["main", "module", "types", "style", "browser"]) {
    if (typeof manifest[field] === "string") {
      targets.push({ field, target: manifest[field] });
    }
  }
  function walk(value, label) {
    if (typeof value === "string") {
      targets.push({ field: label, target: value });
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((entry, index) => walk(entry, `${label}[${index}]`));
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, entry] of Object.entries(value)) {
        walk(entry, `${label}.${key}`);
      }
    }
  }
  walk(manifest.exports, "exports");
  return targets;
}

function validateStagingTargets(stagedManifest, stagingDirectory, packageName, violations) {
  for (const { field, target } of collectTargets(stagedManifest)) {
    if (!target.startsWith("./") || target.includes("\\")) {
      violations.push(`${packageName}: ${field} target is not package-relative`);
      continue;
    }
    const normalized = path.posix.normalize(target.slice(2));
    if (normalized.startsWith("../") || path.posix.isAbsolute(normalized)) {
      violations.push(`${packageName}: ${field} target escapes the staging package`);
      continue;
    }
    const absoluteTarget = path.resolve(stagingDirectory, normalized);
    if (!absoluteTarget.startsWith(`${path.resolve(stagingDirectory)}${path.sep}`)) {
      violations.push(`${packageName}: ${field} target escapes the staging package`);
      continue;
    }
    if (!existsSync(absoluteTarget)) {
      violations.push(`${packageName}: ${field} target is missing from staging: ${target}`);
      continue;
    }
    if (!statSync(absoluteTarget).isFile()) {
      violations.push(`${packageName}: ${field} target is not a file: ${target}`);
    }
  }
}

function validatePackedFile(file, packageName, violations) {
  if (file.startsWith("/") || file.includes("..") || file.includes("\\")) {
    violations.push(`${packageName}: packed path escapes the package: ${file}`);
    return;
  }
  for (const segment of file.split("/")) {
    if (forbiddenSegments.has(segment)) {
      violations.push(`${packageName}: packed path exposes forbidden segment ${segment}`);
    }
  }
}

function validateStagingPackage(packageInfo, stagingRoot, packRoot, violations) {
  const packageName = packageInfo.manifest.name;
  const stagingDirectory = path.join(stagingRoot, path.basename(packageInfo.directory));
  if (!existsSync(stagingDirectory)) {
    violations.push(
      `${packageName}: build staging is missing; run npm run build before npm run verify:packages`,
    );
    return;
  }

  const stagedManifestPath = path.join(stagingDirectory, "package.json");
  if (!existsSync(stagedManifestPath)) {
    violations.push(`${packageName}: staged package.json is missing`);
    return;
  }
  const stagedManifest = JSON.parse(readFileSync(stagedManifestPath, "utf8"));
  if (stagedManifest.name !== packageName) {
    violations.push(`${packageName}: staged manifest name does not match`);
  }

  const requiredFiles = [
    "package.json",
    "README.md",
    "LICENSE",
    "dist/index.js",
    "dist/index.d.ts",
  ];
  if (packageName === "@boardloom/view-dom") {
    requiredFiles.push("styles.css");
  }
  for (const required of requiredFiles) {
    if (!existsSync(path.join(stagingDirectory, required))) {
      violations.push(`${packageName}: staging is missing ${required}`);
    }
  }
  validateStagingTargets(stagedManifest, stagingDirectory, packageName, violations);

  const packResult = run("npm", ["pack", "--json", "--pack-destination", packRoot], {
    cwd: stagingDirectory,
  });
  let packed;
  try {
    packed = JSON.parse(packResult)[0];
  } catch {
    violations.push(`${packageName}: npm pack dry-run did not return valid JSON`);
    return;
  }
  if (!packed || !Array.isArray(packed.files)) {
    violations.push(`${packageName}: npm pack returned no file list`);
    return;
  }
  if (!packed.filename || !existsSync(path.join(packRoot, packed.filename))) {
    violations.push(`${packageName}: npm pack did not produce a tarball`);
    return;
  }

  const packedPaths = packed.files.map((entry) => entry.path);
  for (const required of requiredFiles) {
    if (!packedPaths.includes(required)) {
      violations.push(`${packageName}: packed surface is missing ${required}`);
    }
  }
  for (const file of packedPaths) {
    validatePackedFile(file, packageName, violations);
  }
}

function main() {
  const stagingRoot = parseArgs(process.argv.slice(2));
  const packages = listPackages();
  const violations = [];

  if (!existsSync(stagingRoot)) {
    fail("build staging is missing; run npm run build before npm run verify:packages");
  }

  const packRoot = path.join(repoRoot, ".tmp", "build", "packs");
  rmSync(packRoot, { recursive: true, force: true });
  mkdirSync(packRoot, { recursive: true });

  for (const packageInfo of packages) {
    validateStagingPackage(packageInfo, stagingRoot, packRoot, violations);
  }

  for (const packageInfo of packages) {
    const sourceDist = path.join(packageInfo.directory, "dist");
    if (existsSync(sourceDist)) {
      violations.push(
        `${packageInfo.manifest.name}: source-local dist is forbidden; build under .tmp/build/packages`,
      );
    }
  }

  if (violations.length > 0) {
    console.error("Package staging verification failed:");
    for (const violation of violations) {
      console.error(`- ${violation}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    `Package staging verification passed for ${packages.length} packages under ${path.relative(
      repoRoot,
      stagingRoot,
    )}; tarballs are in .tmp/build/packs.`,
  );
}

try {
  main();
} catch (error) {
  fail(error.message);
}
