import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  assertExists,
  isIgnored,
  lexicalCompare,
  normalizeRepoPath,
  publicPathViolation,
  repoRoot,
} from "./lib/repo.mjs";
import { validateMetadataPath } from "./lib/safe-paths.mjs";

function parseArgs(argv) {
  const options = { check: false, task: "", input: "", paths: "", output: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") {
      options.check = true;
      continue;
    }
    if (["--task", "--input", "--paths", "--output"].includes(argument)) {
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

function readInputPaths(options) {
  const rawValues = [];
  if (options.paths) {
    rawValues.push(...options.paths.split(","));
  }
  if (options.input) {
    const validated = validateMetadataPath({
      repoRoot,
      relativePath: options.input,
    });
    if (!validated.ok) {
      throw new Error(`unsafe input path: ${validated.rule}`);
    }
    rawValues.push(
      ...readFileSync(validated.absolutePath, "utf8")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== "" && !line.startsWith("#")),
    );
  }
  return rawValues;
}

function validatePaths(rawPaths) {
  if (rawPaths.length === 0) {
    throw new Error("no public paths were supplied");
  }

  const violations = [];
  const seen = new Set();
  const normalizedPaths = [];

  for (const rawPath of rawPaths) {
    let normalized;
    try {
      normalized = normalizeRepoPath(rawPath);
    } catch (error) {
      violations.push(error.message);
      continue;
    }

    if (seen.has(normalized)) {
      violations.push(`duplicate path: ${normalized}`);
      continue;
    }
    seen.add(normalized);

    const policyViolation = publicPathViolation(normalized);
    if (policyViolation) {
      violations.push(`${normalized}: ${policyViolation}`);
      continue;
    }

    try {
      assertExists(normalized);
    } catch {
      violations.push(`${normalized}: file does not exist`);
      continue;
    }

    if (isIgnored(normalized)) {
      violations.push(`${normalized}: path is ignored by Git and cannot be public`);
      continue;
    }

    normalizedPaths.push(normalized);
  }

  if (violations.length > 0) {
    throw new Error(`invalid stage paths:\n- ${violations.join("\n- ")}`);
  }

  return normalizedPaths.sort(lexicalCompare);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!/^T\d{2}$/.test(options.task)) {
    throw new Error("--task must be a task ID such as T01");
  }

  const outputPath = options.output || `.evidence/reviews/${options.task}/stage-paths.json`;
  const outputValidation = validateMetadataPath({
    repoRoot,
    relativePath: outputPath,
    allowMissingFinal: !options.check,
    allowMissingParents: !options.check,
  });
  if (!outputValidation.ok) {
    throw new Error(`unsafe output path: ${outputValidation.rule}`);
  }

  let paths;
  if (options.check) {
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(outputValidation.absolutePath, "utf8"));
    } catch {
      throw new Error("stage manifest is not valid JSON");
    }
    if (!Array.isArray(manifest)) {
      throw new Error("stage manifest must be a JSON array");
    }
    paths = validatePaths(manifest);
    if (paths.length !== manifest.length) {
      throw new Error("stage manifest contains duplicate or invalid paths");
    }
    console.log(`Stage manifest check passed for ${options.task}: ${paths.length} public paths.`);
    return;
  }

  paths = validatePaths(readInputPaths(options));
  mkdirSync(path.dirname(outputValidation.absolutePath), { recursive: true });
  writeFileSync(outputValidation.absolutePath, `${JSON.stringify(paths, null, 2)}\n`, "utf8");
  console.log(`Wrote ${outputPath} with ${paths.length} public paths.`);
}

try {
  main();
} catch (error) {
  console.error(`stage-paths: ${error.message}`);
  process.exitCode = 1;
}
