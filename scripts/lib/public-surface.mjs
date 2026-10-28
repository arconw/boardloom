import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { isSensitiveName, normalizeRepoPath, publicPathViolation } from "./repo.mjs";

export const contentRules = [
  { id: "private-key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { id: "aws-access-key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: "github-token", pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { id: "slack-token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { id: "bearer-token", pattern: /\bBearer\s+[A-Za-z0-9._-]{20,}\b/ },
  {
    id: "registry-auth",
    pattern:
      /(?:\/\/[^\s"']*:)?(?:[_-]?authToken|_auth|_password|npmAuthToken)\s*[:=]\s*(?!\$\{|process\.env)[^\s"'#,\r\n]{4,}/i,
  },
  {
    id: "unquoted-credential-assignment",
    pattern:
      /(?:^|[\s,;{])(?:api[_-]?key|secret|password|passwd|token)\s*[:=]\s*(?:"[^"\r\n]{8,}"|'[^'\r\n]{8,}'|(?!\$\{|process\.env|["'#])[^\s"'#,\r\n]{8,})/i,
  },
  {
    id: "database-url",
    pattern: /\b(postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^:\s/@]+:[^@\s/]+@/i,
  },
];

const defaultDependencies = {
  lstat: lstatSync,
  realpath: realpathSync,
  stat: statSync,
  readFile: readFileSync,
};

function classifyPath(repoRoot, relativePath, dependencies) {
  let normalized;
  try {
    normalized = normalizeRepoPath(relativePath);
  } catch (error) {
    return { ok: false, rule: "path-escape", reason: error.message };
  }

  if (isSensitiveName(normalized)) {
    return { ok: false, rule: "protected-path", reason: "protected or database-like file name" };
  }

  const policyViolation = publicPathViolation(normalized);
  if (policyViolation) {
    return { ok: false, rule: "local-path", reason: policyViolation };
  }

  const root = path.resolve(repoRoot);
  const absolutePath = path.resolve(root, normalized);
  if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`)) {
    return { ok: false, rule: "path-escape", reason: "path resolves outside the repository" };
  }

  const segments = normalized.split("/").filter(Boolean);
  let currentPath = root;
  for (const segment of segments) {
    currentPath = path.join(currentPath, segment);
    let entry;
    try {
      entry = dependencies.lstat(currentPath);
    } catch {
      return { ok: false, rule: "missing-path", reason: "path does not exist" };
    }
    if (entry.isSymbolicLink()) {
      return { ok: false, rule: "symlink", reason: "symbolic links are not allowed" };
    }
  }

  let realRoot;
  let realPath;
  try {
    realRoot = dependencies.realpath(root);
    realPath = dependencies.realpath(absolutePath);
  } catch {
    return { ok: false, rule: "missing-path", reason: "path cannot be resolved" };
  }
  if (realPath !== realRoot && !realPath.startsWith(`${realRoot}${path.sep}`)) {
    return { ok: false, rule: "symlink-escape", reason: "resolved path escapes the repository" };
  }

  const stats = dependencies.stat(absolutePath);
  if (!stats.isFile()) {
    return { ok: false, rule: "not-a-file", reason: "path is not a regular file" };
  }

  return { ok: true, normalized, absolutePath, stats };
}

function scanText(text) {
  return contentRules.filter((rule) => rule.pattern.test(text)).map((rule) => rule.id);
}

export function scanPaths({
  repoRoot,
  paths,
  dependencies = defaultDependencies,
  maxBytes = 5 * 1024 * 1024,
}) {
  const findings = [];
  let scanned = 0;
  let skipped = 0;

  for (const relativePath of paths) {
    const classified = classifyPath(repoRoot, relativePath, dependencies);
    if (!classified.ok) {
      findings.push({ path: relativePath, rule: classified.rule, reason: classified.reason });
      continue;
    }

    if (classified.stats.size > maxBytes) {
      skipped += 1;
      continue;
    }

    const content = dependencies.readFile(classified.absolutePath);
    if (content.subarray(0, 8192).includes(0)) {
      skipped += 1;
      continue;
    }

    scanned += 1;
    for (const rule of scanText(content.toString("utf8"))) {
      findings.push({ path: classified.normalized, rule });
    }
  }

  return { findings, scanned, skipped };
}

export function formatFinding(finding) {
  return finding.reason
    ? `${finding.path}: ${finding.rule} (${finding.reason})`
    : `${finding.path}: ${finding.rule}`;
}
