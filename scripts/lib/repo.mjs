import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export const repoRoot = path.resolve(here, "../..");
export const packagesRoot = path.join(repoRoot, "packages");

export function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: options.encoding ?? "utf8",
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
    maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
  });
}

export function git(args, options = {}) {
  return run("git", args, options);
}

export function gitBuffer(args, options = {}) {
  return run("git", args, { ...options, encoding: "buffer" });
}

export function readText(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

export function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

export function toPosix(value) {
  return value.split(path.sep).join("/");
}

export function normalizeRepoPath(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("path is empty");
  }
  if (value.includes("\\")) {
    throw new Error(`path uses backslashes: ${value}`);
  }
  const normalized = toPosix(path.posix.normalize(value));
  if (normalized === ".." || normalized.startsWith("../") || path.posix.isAbsolute(normalized)) {
    throw new Error(`path escapes the repository: ${value}`);
  }
  return normalized.startsWith("./") ? normalized.slice(2) : normalized;
}

export function lexicalCompare(left, right) {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

export function listPackages(packagesDirectory = packagesRoot) {
  if (!existsSync(packagesDirectory)) {
    return [];
  }
  return readdirSync(packagesDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(packagesDirectory, entry.name))
    .filter((directory) => existsSync(path.join(directory, "package.json")))
    .map((directory) => {
      const manifest = JSON.parse(readFileSync(path.join(directory, "package.json"), "utf8"));
      return {
        directory,
        relativeDirectory: toPosix(path.relative(repoRoot, directory)),
        manifest,
      };
    })
    .sort((left, right) => lexicalCompare(left.manifest.name, right.manifest.name));
}

const forbiddenSegments = new Set([
  ".ctx",
  ".evidence",
  ".git",
  ".questions",
  ".tmp",
  "coverage",
  "dist",
  "frontend",
  "node_modules",
  "prisma",
  "video-materials",
]);

const sensitiveNamePatterns = [
  /^\.env($|\.)/i,
  /^credentials\.json$/i,
  /^secrets?\./i,
  /^token/i,
  /secret/i,
  /password/i,
  /passwd/i,
  /apikey/i,
  /api[_-]?key/i,
  /^id_rsa$/i,
  /^id_ed25519$/i,
  /\.(pem|key|p12|pfx|keystore)$/i,
  /\.(db|db-.*|sqlite|sqlite-.*|sqlite3|sqlite3-.*)$/i,
];

export function isSensitiveName(relativePath) {
  const segments = path.posix.normalize(relativePath).split("/").filter(Boolean);
  return segments.some((segment) => sensitiveNamePatterns.some((pattern) => pattern.test(segment)));
}

export function publicPathViolation(relativePath) {
  const normalized = normalizeRepoPath(relativePath);
  if (isSensitiveName(normalized)) {
    return "sensitive or local database file name";
  }
  const segments = normalized.split("/");
  for (const segment of segments) {
    if (forbiddenSegments.has(segment)) {
      return `local, generated or ignored directory segment: ${segment}`;
    }
  }
  if (normalized.startsWith("src/")) {
    return "legacy application source";
  }
  if (normalized.startsWith("tests/") && !normalized.startsWith("tests/framework/")) {
    return "legacy test source";
  }
  return null;
}

export function isIgnored(relativePath) {
  try {
    git(["check-ignore", "--no-index", "-q", "--", relativePath], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    return true;
  } catch (error) {
    if (error.status === 1) {
      return false;
    }
    throw error;
  }
}

export function assertExists(relativePath) {
  if (!existsSync(path.join(repoRoot, relativePath))) {
    throw new Error(`missing file: ${relativePath}`);
  }
}
