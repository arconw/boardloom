import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import { isSensitiveName, normalizeRepoPath } from "./repo.mjs";

const defaultDependencies = {
  lstat: lstatSync,
  realpath: realpathSync,
};

const forbiddenMetadataSegments = new Set([
  ".ctx",
  ".git",
  ".questions",
  "coverage",
  "dist",
  "frontend",
  "node_modules",
  "prisma",
  "video-materials",
]);

function isAllowedRoot(normalized, allowedRoots) {
  return allowedRoots.some((root) => normalized === root || normalized.startsWith(`${root}/`));
}

function isIntendedStageManifest(normalized) {
  return /^\.evidence\/reviews\/T\d{2}\/stage-paths\.json$/.test(normalized);
}

export function validateMetadataPath({
  repoRoot,
  relativePath,
  allowedRoots = [],
  allowMissingFinal = false,
  allowMissingParents = false,
  dependencies = defaultDependencies,
}) {
  let normalized;
  try {
    normalized = normalizeRepoPath(relativePath);
  } catch (error) {
    return { ok: false, rule: "path-escape", reason: error.message };
  }

  if (isSensitiveName(normalized)) {
    return { ok: false, rule: "protected-path", reason: "protected file or directory name" };
  }

  const intendedManifest = isIntendedStageManifest(normalized);
  for (const segment of normalized.split("/")) {
    if (forbiddenMetadataSegments.has(segment)) {
      return {
        ok: false,
        rule: "local-path",
        reason: `forbidden metadata directory segment: ${segment}`,
      };
    }
    if (segment === ".evidence" && !intendedManifest) {
      return {
        ok: false,
        rule: "local-path",
        reason: "local evidence is only allowed as the intended stage manifest",
      };
    }
  }

  const underProjectTemp = normalized === ".tmp" || normalized.startsWith(".tmp/");
  if (!underProjectTemp && !intendedManifest && !isAllowedRoot(normalized, allowedRoots)) {
    return {
      ok: false,
      rule: "local-path",
      reason: "path is not an allowed metadata input or output",
    };
  }
  const allowMissingAncestors =
    allowMissingParents && allowMissingFinal && (underProjectTemp || intendedManifest);

  const root = path.resolve(repoRoot);
  const absolutePath = path.resolve(root, normalized);
  if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`)) {
    return { ok: false, rule: "path-escape", reason: "path resolves outside the repository" };
  }

  const segments = normalized.split("/").filter(Boolean);
  let currentPath = root;
  let missingAt = null;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    currentPath = path.join(currentPath, segment);
    const isFinal = index === segments.length - 1;
    let entry;
    try {
      entry = dependencies.lstat(currentPath);
    } catch {
      if ((isFinal && allowMissingFinal) || allowMissingAncestors) {
        missingAt = currentPath;
        break;
      }
      return { ok: false, rule: "missing-path", reason: "metadata path does not exist" };
    }
    if (entry.isSymbolicLink()) {
      return { ok: false, rule: "symlink", reason: "symbolic links are not allowed" };
    }
    if (!isFinal && !entry.isDirectory()) {
      return {
        ok: false,
        rule: "not-a-directory",
        reason: "metadata path component is not a directory",
      };
    }
    if (isFinal && !entry.isFile()) {
      return { ok: false, rule: "not-a-file", reason: "metadata path is not a regular file" };
    }
  }

  let realRoot;
  let realPath;
  try {
    realRoot = dependencies.realpath(root);
    realPath = dependencies.realpath(missingAt ? path.dirname(missingAt) : absolutePath);
  } catch {
    return { ok: false, rule: "missing-path", reason: "metadata path cannot be resolved" };
  }
  if (realPath !== realRoot && !realPath.startsWith(`${realRoot}${path.sep}`)) {
    return {
      ok: false,
      rule: "symlink-escape",
      reason: "resolved metadata path escapes the repository",
    };
  }

  return { ok: true, normalized, absolutePath };
}
