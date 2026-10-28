import { readFileSync } from "node:fs";
import { repoRoot } from "./lib/repo.mjs";
import { validateMetadataPath } from "./lib/safe-paths.mjs";

function parseArgs(argv) {
  const options = {
    spec: "docs/framework/SPEC.md",
    tasks: "docs/framework/TASKS.md",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--spec" || argument === "--tasks") {
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

function readRepoText(relativePath) {
  const validated = validateMetadataPath({
    repoRoot,
    relativePath,
    allowedRoots: ["docs/framework"],
  });
  if (!validated.ok) {
    throw new Error(`unsafe metadata input: ${validated.rule}`);
  }
  return readFileSync(validated.absolutePath, "utf8");
}

let options;
let spec;
let tasks;
try {
  options = parseArgs(process.argv.slice(2));
  spec = readRepoText(options.spec);
  tasks = readRepoText(options.tasks);
} catch (error) {
  console.error(`verify-acceptance-owners: ${error.message}`);
  process.exit(1);
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

const specAcceptanceIds = uniqueSorted(
  [...spec.matchAll(/^\| (AC-\d{3}) \|/gm)].map((match) => match[1]),
);

const ownershipStart = tasks.indexOf("## 2.1 Normative acceptance ownership");
const ownershipEnd = tasks.indexOf("## 3. Tasks");
if (ownershipStart === -1 || ownershipEnd === -1) {
  console.error("Could not locate the normative acceptance ownership section in TASKS.md.");
  process.exit(1);
}
const ownershipSection = tasks.slice(ownershipStart, ownershipEnd);

const ownerRows = [
  ...ownershipSection.matchAll(/^\|\s*(AC-\d{3})\s*\|\s*(T\d{2})\s*\|(.*)\|$/gm),
].map((match) => ({
  acceptanceId: match[1],
  owner: match[2],
  contributors: match[3]
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value !== "" && value !== "None beyond the final owner"),
}));

const taskSections = new Map();
const taskHeadingMatches = [...tasks.matchAll(/^### (T\d{2}) - .*$/gm)];
for (let index = 0; index < taskHeadingMatches.length; index += 1) {
  const match = taskHeadingMatches[index];
  const start = match.index ?? 0;
  const end =
    index + 1 < taskHeadingMatches.length
      ? (taskHeadingMatches[index + 1].index ?? tasks.length)
      : tasks.length;
  const section = tasks.slice(start, end);
  const finalAcceptanceMatch = section.match(/^Final acceptance: (.*)$/m);
  const finalAcceptance = finalAcceptanceMatch
    ? [...finalAcceptanceMatch[1].matchAll(/AC-\d{3}/g)].map((match) => match[0])
    : null;
  taskSections.set(match[1], finalAcceptance);
}

const taskIds = new Set(taskSections.keys());
const violations = [];
const ownersById = new Map();

for (const row of ownerRows) {
  if (ownersById.has(row.acceptanceId)) {
    violations.push(`${row.acceptanceId} has more than one final owner`);
  }
  ownersById.set(row.acceptanceId, row.owner);

  if (!taskIds.has(row.owner)) {
    violations.push(`${row.acceptanceId} is owned by unknown task ${row.owner}`);
  }
  for (const contributor of row.contributors) {
    if (!taskIds.has(contributor)) {
      violations.push(`${row.acceptanceId} has unknown contributor ${contributor}`);
    }
  }
}

for (const acceptanceId of specAcceptanceIds) {
  if (!ownersById.has(acceptanceId)) {
    violations.push(`${acceptanceId} is defined in SPEC.md but has no final owner`);
  }
}

for (const acceptanceId of ownersById.keys()) {
  if (!specAcceptanceIds.includes(acceptanceId)) {
    violations.push(`${acceptanceId} has an owner but is not defined in SPEC.md`);
  }
}

for (const [taskId, finalAcceptance] of taskSections) {
  if (finalAcceptance === null) {
    violations.push(`${taskId} has no Final acceptance line`);
    continue;
  }
  const seenDeclarations = new Set();
  for (const acceptanceId of finalAcceptance) {
    if (seenDeclarations.has(acceptanceId)) {
      violations.push(`${taskId} declares duplicate final acceptance ${acceptanceId}`);
    }
    seenDeclarations.add(acceptanceId);
    if (!specAcceptanceIds.includes(acceptanceId)) {
      violations.push(`${taskId} declares unknown final acceptance ${acceptanceId}`);
    }
    if (ownersById.get(acceptanceId) !== taskId) {
      violations.push(
        `${taskId} declares ${acceptanceId} as final acceptance but the owner is ${ownersById.get(acceptanceId) ?? "missing"}`,
      );
    }
  }
}

for (const row of ownerRows) {
  const declared = taskSections.get(row.owner);
  if (declared && !declared.includes(row.acceptanceId)) {
    violations.push(
      `${row.owner} ownership table assigns ${row.acceptanceId} but Final acceptance does not declare it`,
    );
  }
}

const expectedT00 = new Set(["AC-136", "AC-157"]);
const expectedT23 = new Set(["AC-140", "AC-141", "AC-146"]);
for (const [taskId, expected] of [
  ["T00", expectedT00],
  ["T23", expectedT23],
]) {
  const actual = new Set(
    ownerRows.filter((row) => row.owner === taskId).map((row) => row.acceptanceId),
  );
  if (actual.size !== expected.size || [...expected].some((id) => !actual.has(id))) {
    violations.push(`${taskId} ownership does not match the recorded decision`);
  }
}

if (violations.length > 0) {
  console.error("Acceptance-owner verification failed:");
  for (const violation of uniqueSorted(violations)) {
    console.error(`- ${violation}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `Acceptance-owner verification passed for ${specAcceptanceIds.length} acceptance criteria and ${taskIds.size} tasks.`,
  );
}
