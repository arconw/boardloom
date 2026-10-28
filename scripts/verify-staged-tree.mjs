import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  assertExists,
  git,
  gitBuffer,
  isIgnored,
  lexicalCompare,
  publicPathViolation,
  repoRoot,
} from "./lib/repo.mjs";
import { validateMetadataPath } from "./lib/safe-paths.mjs";

function parseArgs(argv) {
  const options = { task: "", manifest: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--task" || argument === "--manifest") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`missing value for ${argument}`);
      }
      options[argument.slice(2)] = value;
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${argument}`);
  }
  return options;
}

function parseNameStatus(rawOutput) {
  const fields = rawOutput.split("\0").filter((field) => field !== "");
  const entries = [];
  for (let index = 0; index < fields.length; index += 2) {
    const status = fields[index];
    const file = fields[index + 1];
    if (!status || !file) {
      throw new Error("unexpected git name-status output");
    }
    entries.push({ status, file });
  }
  return entries;
}

function computeFingerprint(paths) {
  const hash = createHash("sha256");
  for (const file of paths) {
    const content = gitBuffer(["show", `:${file}`]);
    hash.update(file, "utf8");
    hash.update(Buffer.from([0]));
    hash.update(content);
    hash.update(Buffer.from([0]));
  }
  return hash.digest("hex");
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!/^T\d{2}$/.test(options.task)) {
    throw new Error("--task must be a task ID such as T01");
  }

  const manifestPath =
    options.manifest || path.join(".evidence", "reviews", options.task, "stage-paths.json");
  const manifestValidation = validateMetadataPath({
    repoRoot,
    relativePath: manifestPath,
  });
  if (!manifestValidation.ok) {
    throw new Error(`unsafe stage manifest input: ${manifestValidation.rule}`);
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestValidation.absolutePath, "utf8"));
  } catch {
    throw new Error("stage manifest is not valid JSON");
  }
  if (!Array.isArray(manifest) || manifest.length === 0) {
    throw new Error("stage manifest must be a non-empty JSON array");
  }

  const violations = [];
  const paths = [];
  const seen = new Set();
  for (const rawPath of manifest) {
    if (typeof rawPath !== "string") {
      violations.push("manifest contains a non-string path");
      continue;
    }
    const policyViolation = publicPathViolation(rawPath);
    if (policyViolation) {
      violations.push(`${rawPath}: ${policyViolation}`);
      continue;
    }
    if (isIgnored(rawPath)) {
      violations.push(`${rawPath}: path is ignored by Git`);
      continue;
    }
    try {
      assertExists(rawPath);
    } catch {
      violations.push(`${rawPath}: file does not exist in the working tree`);
      continue;
    }
    if (seen.has(rawPath)) {
      violations.push(`${rawPath}: duplicate manifest path`);
      continue;
    }
    seen.add(rawPath);
    paths.push(rawPath);
  }

  if (violations.length > 0) {
    throw new Error(`invalid stage manifest:\n- ${violations.join("\n- ")}`);
  }

  paths.sort(lexicalCompare);

  const baseCommit = git(["rev-parse", "HEAD"]).trim();
  const stagedEntries = parseNameStatus(
    gitBuffer(["diff", "--cached", "--name-status", "--no-renames", "-z"]).toString("utf8"),
  );

  for (const entry of stagedEntries) {
    if (entry.status === "D") {
      violations.push(`${entry.file}: staged deletion is not authorized by this manifest`);
    }
  }

  const stagedFiles = new Set(
    stagedEntries.filter((entry) => entry.status !== "D").map((entry) => entry.file),
  );
  for (const file of paths) {
    if (!stagedFiles.has(file)) {
      violations.push(`${file}: manifest path is not staged`);
    }
  }
  for (const file of stagedFiles) {
    if (!seen.has(file)) {
      violations.push(`${file}: staged change is absent from the manifest`);
    }
  }

  for (const file of paths) {
    try {
      git(["diff", "--quiet", "--", file]);
    } catch {
      violations.push(`${file}: working tree differs from the staged index`);
    }
  }

  if (violations.length > 0) {
    throw new Error(
      `staged-tree gate failed:\n- ${violations.join("\n- ")}\nStage exactly the manifest, then rerun.`,
    );
  }

  const tree = git(["write-tree"]).trim();
  const fingerprint = computeFingerprint(paths);

  console.log(`Task: ${options.task}`);
  console.log(`Base commit: ${baseCommit}`);
  console.log(`Staged tree: ${tree}`);
  console.log(`Review fingerprint: ${fingerprint}`);
  console.log(`Manifest: ${manifestPath}`);
  console.log(`Public files: ${paths.length}`);
}

try {
  main();
} catch (error) {
  console.error(`verify-staged-tree: ${error.message}`);
  process.exitCode = 1;
}
