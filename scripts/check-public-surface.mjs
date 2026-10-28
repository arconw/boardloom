import { readFileSync } from "node:fs";
import path from "node:path";
import { git, repoRoot } from "./lib/repo.mjs";
import { formatFinding, scanPaths } from "./lib/public-surface.mjs";
import { validateMetadataPath } from "./lib/safe-paths.mjs";

function parseArgs(argv) {
  const options = { task: "", paths: "", manifest: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (["--task", "--paths", "--manifest"].includes(argument)) {
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

function readManifest(manifestPath) {
  const validated = validateMetadataPath({ repoRoot, relativePath: manifestPath });
  if (!validated.ok) {
    throw new Error(`unsafe stage manifest input: ${validated.rule}`);
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(validated.absolutePath, "utf8"));
  } catch {
    throw new Error("stage manifest is not valid JSON");
  }
  if (!Array.isArray(manifest)) {
    throw new Error("stage manifest must be a JSON array");
  }
  return manifest;
}

function listFiles(options) {
  if (options.paths) {
    return options.paths
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  }

  if (options.manifest || options.task) {
    const manifestPath =
      options.manifest || path.join(".evidence", "reviews", options.task, "stage-paths.json");
    return readManifest(manifestPath);
  }

  return git(["ls-files", "-z"], { encoding: "buffer" })
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const files = listFiles(options);
  const result = scanPaths({ repoRoot, paths: files });

  if (result.findings.length > 0) {
    console.error("Public-surface check failed. Matched values are intentionally not printed.");
    for (const finding of result.findings) {
      console.error(`- ${formatFinding(finding)}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    `Public-surface check passed: ${result.scanned} text files scanned, ${result.skipped} large or binary files skipped, matched values redacted.`,
  );
}

try {
  main();
} catch (error) {
  console.error(`check-public-surface: ${error.message}`);
  process.exitCode = 1;
}
