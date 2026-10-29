import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const tempDirectory = path.join(root, ".tmp", "T01", "tooling-test");

interface ScriptResult {
  status: number;
  stdout: string;
  stderr: string;
}

function runCommand(command: string, args: string[], cwd = root): ScriptResult {
  try {
    const stdout = execFileSync(command, args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return {
      status: failure.status ?? 1,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
    };
  }
}

function runScript(args: string[]): ScriptResult {
  return runCommand(process.execPath, args);
}

function runScriptIn(cwd: string, args: string[]): ScriptResult {
  return runCommand(process.execPath, args, cwd);
}

describe("foundation quality scripts", () => {
  it("runs unit, contract and integration tiers in the public workflow", () => {
    const workflow = readFileSync(path.join(root, ".github/workflows/quality.yml"), "utf8");
    expect(workflow).toContain("npm run test:unit");
    expect(workflow).toContain("npm run test:contract");
    expect(workflow).toContain("npm run test:integration");
  });

  it("passes acceptance-owner verification", () => {
    const result = runScript(["scripts/verify-acceptance-owners.mjs"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Acceptance-owner verification passed");
  });

  it("passes package-boundary verification", () => {
    const result = runScript(["scripts/verify-boundaries.mjs"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Package boundary check passed");
  });

  it("rejects a protected stage-path input before reading", () => {
    rmSync(tempDirectory, { recursive: true, force: true });
    mkdirSync(tempDirectory, { recursive: true });
    const inputResult = runScript([
      "scripts/stage-paths.mjs",
      "--task",
      "T99",
      "--input",
      ".env",
      "--output",
      ".tmp/T01/tooling-test/ignored.json",
    ]);
    expect(inputResult.status).toBe(1);
    expect(inputResult.stderr).toContain("unsafe input path");
  });

  it("rejects a linked stage-path output prefix without creating a file", () => {
    rmSync(tempDirectory, { recursive: true, force: true });
    mkdirSync(tempDirectory, { recursive: true });
    const target = path.join(tempDirectory, "linked-target");
    const linkedParent = path.join(tempDirectory, "linked-parent");
    mkdirSync(target, { recursive: true });
    symlinkSync(target, linkedParent);

    const result = runScript([
      "scripts/stage-paths.mjs",
      "--task",
      "T99",
      "--paths",
      "LICENSE",
      "--output",
      path.relative(root, path.join(linkedParent, "stage-paths.json")),
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("unsafe output path");
    expect(existsSync(path.join(target, "stage-paths.json"))).toBe(false);

    rmSync(linkedParent, { force: true });
    rmSync(target, { recursive: true, force: true });
  });

  it("creates and rewrites the default manifest in an isolated fixture repository", () => {
    rmSync(tempDirectory, { recursive: true, force: true });
    mkdirSync(tempDirectory, { recursive: true });
    const fixtureRepo = path.join(tempDirectory, "fresh-repo");
    mkdirSync(path.join(fixtureRepo, "scripts", "lib"), { recursive: true });
    cpSync(
      path.join(root, "scripts", "stage-paths.mjs"),
      path.join(fixtureRepo, "scripts", "stage-paths.mjs"),
    );
    cpSync(
      path.join(root, "scripts", "lib", "repo.mjs"),
      path.join(fixtureRepo, "scripts", "lib", "repo.mjs"),
    );
    cpSync(
      path.join(root, "scripts", "lib", "safe-paths.mjs"),
      path.join(fixtureRepo, "scripts", "lib", "safe-paths.mjs"),
    );
    writeFileSync(path.join(fixtureRepo, "LICENSE"), "MIT\n", "utf8");
    writeFileSync(path.join(fixtureRepo, "package.json"), "{}\n", "utf8");
    expect(runCommand("git", ["init", "-q"], fixtureRepo).status).toBe(0);

    try {
      const first = runScriptIn(fixtureRepo, [
        "scripts/stage-paths.mjs",
        "--task",
        "T98",
        "--paths",
        "LICENSE",
      ]);
      expect(first.status).toBe(0);
      const manifestPath = path.join(
        fixtureRepo,
        ".evidence",
        "reviews",
        "T98",
        "stage-paths.json",
      );
      expect(JSON.parse(readFileSync(manifestPath, "utf8"))).toEqual(["LICENSE"]);

      const second = runScriptIn(fixtureRepo, [
        "scripts/stage-paths.mjs",
        "--task",
        "T98",
        "--paths",
        "LICENSE,package.json",
      ]);
      expect(second.status).toBe(0);
      expect(JSON.parse(readFileSync(manifestPath, "utf8"))).toEqual(["LICENSE", "package.json"]);
    } finally {
      rmSync(fixtureRepo, { recursive: true, force: true });
    }
  });

  it("creates missing permitted output parents for a new task", () => {
    rmSync(tempDirectory, { recursive: true, force: true });
    mkdirSync(tempDirectory, { recursive: true });
    const input = path.join(tempDirectory, "new-task-paths.txt");
    const output = path.join(tempDirectory, "new-task", "stage-paths.json");
    writeFileSync(input, "LICENSE\n", "utf8");

    const result = runScript([
      "scripts/stage-paths.mjs",
      "--task",
      "T98",
      "--input",
      path.relative(root, input),
      "--output",
      path.relative(root, output),
    ]);
    expect(result.status).toBe(0);
    expect(JSON.parse(readFileSync(output, "utf8"))).toEqual(["LICENSE"]);
    rmSync(path.dirname(output), { recursive: true, force: true });
  });

  it("rejects linked metadata inputs for acceptance and staged-tree tools", () => {
    rmSync(tempDirectory, { recursive: true, force: true });
    mkdirSync(tempDirectory, { recursive: true });
    const linkPath = path.join(tempDirectory, "tasks-link.md");
    symlinkSync(path.join(root, "docs/framework/TASKS.md"), linkPath);

    const acceptance = runScript([
      "scripts/verify-acceptance-owners.mjs",
      "--tasks",
      path.relative(root, linkPath),
    ]);
    expect(acceptance.status).toBe(1);
    expect(acceptance.stderr).toContain("unsafe metadata input");

    const stagedTree = runScript([
      "scripts/verify-staged-tree.mjs",
      "--task",
      "T01",
      "--manifest",
      path.relative(root, linkPath),
    ]);
    expect(stagedTree.status).toBe(1);
    expect(stagedTree.stderr).toContain("unsafe stage manifest input");
  });

  it("rejects an omitted final-acceptance declaration", () => {
    const fixtures = path.join(tempDirectory, "acceptance-fixtures");
    rmSync(fixtures, { recursive: true, force: true });
    mkdirSync(fixtures, { recursive: true });
    const tasksText = readFileSync(path.join(root, "docs/framework/TASKS.md"), "utf8");
    const t19Start = tasksText.indexOf("### T19");
    const t20Start = tasksText.indexOf("### T20");
    const t19 = tasksText.slice(t19Start, t20Start);
    const mutatedT19 = t19.replace(
      "Final acceptance: AC-033, AC-100, AC-101, AC-102, AC-132, AC-145.",
      "Final acceptance: AC-033, AC-100, AC-101, AC-102, AC-132.",
    );
    const mutatedTasks = tasksText.slice(0, t19Start) + mutatedT19 + tasksText.slice(t20Start);
    const tasksPath = path.join(fixtures, "tasks-omission.md");
    writeFileSync(tasksPath, mutatedTasks, "utf8");

    const result = runScript([
      "scripts/verify-acceptance-owners.mjs",
      "--tasks",
      path.relative(root, tasksPath),
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("AC-145");
  });

  it("rejects a duplicate final-acceptance declaration", () => {
    const fixtures = path.join(tempDirectory, "acceptance-fixtures");
    mkdirSync(fixtures, { recursive: true });
    const tasksText = readFileSync(path.join(root, "docs/framework/TASKS.md"), "utf8");
    const t19Start = tasksText.indexOf("### T19");
    const t20Start = tasksText.indexOf("### T20");
    const t19 = tasksText.slice(t19Start, t20Start);
    const mutatedT19 = t19.replace(
      "Final acceptance: AC-033, AC-100, AC-101, AC-102, AC-132, AC-145.",
      "Final acceptance: AC-033, AC-100, AC-101, AC-102, AC-132, AC-145, AC-145.",
    );
    const mutatedTasks = tasksText.slice(0, t19Start) + mutatedT19 + tasksText.slice(t20Start);
    const tasksPath = path.join(fixtures, "tasks-duplicate.md");
    writeFileSync(tasksPath, mutatedTasks, "utf8");

    const result = runScript([
      "scripts/verify-acceptance-owners.mjs",
      "--tasks",
      path.relative(root, tasksPath),
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("duplicate final acceptance AC-145");
  });

  it("builds publishable staging under .tmp without source-local dist", () => {
    for (const packageName of [
      "core",
      "view-dom",
      "renderers-echarts",
      "react",
      "angular",
      "svelte",
    ]) {
      const buildResult = runScript(["scripts/build-package.mjs", packageName]);
      expect(buildResult.status).toBe(0);
      expect(buildResult.stdout).toContain(`Built @boardloom/${packageName}`);

      const staging = path.join(root, ".tmp", "build", "packages", packageName);
      for (const relativeFile of [
        "package.json",
        "README.md",
        "LICENSE",
        "dist/index.js",
        "dist/index.d.ts",
      ]) {
        expect(existsSync(path.join(staging, relativeFile))).toBe(true);
      }
      expect(existsSync(path.join(root, "packages", packageName, "dist"))).toBe(false);
    }
    expect(existsSync(path.join(root, ".tmp", "build", "packages", "view-dom", "styles.css"))).toBe(
      true,
    );
  }, 60_000);

  it("verifies staged packages and reports actionable missing staging", () => {
    const result = runScript(["scripts/verify-packages.mjs"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Package staging verification passed");

    const emptyStaging = path.join(tempDirectory, "empty-staging");
    rmSync(emptyStaging, { recursive: true, force: true });
    mkdirSync(emptyStaging, { recursive: true });
    const missing = runScript([
      "scripts/verify-packages.mjs",
      "--staging-root",
      path.relative(root, emptyStaging),
    ]);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("build staging is missing");
  });

  it("passes ignore-rule verification without printing protected content", () => {
    const result = runScript(["scripts/verify-ignore-rules.mjs"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Ignore-rule verification passed");
    expect(result.stdout).not.toContain(".env content");
  });

  it("generates a sorted manifest and rejects ignored paths", () => {
    rmSync(tempDirectory, { recursive: true, force: true });
    mkdirSync(tempDirectory, { recursive: true });

    const validInput = path.join(tempDirectory, "valid-paths.txt");
    const validOutput = path.join(tempDirectory, "valid-manifest.json");
    writeFileSync(validInput, "package.json\nLICENSE\n", "utf8");

    const validResult = runScript([
      "scripts/stage-paths.mjs",
      "--task",
      "T99",
      "--input",
      path.relative(root, validInput),
      "--output",
      path.relative(root, validOutput),
    ]);
    expect(validResult.status).toBe(0);
    expect(JSON.parse(readFileSync(validOutput, "utf8"))).toEqual(["LICENSE", "package.json"]);

    const checkResult = runScript([
      "scripts/stage-paths.mjs",
      "--task",
      "T99",
      "--output",
      path.relative(root, validOutput),
      "--check",
    ]);
    expect(checkResult.status).toBe(0);

    const invalidInput = path.join(tempDirectory, "invalid-paths.txt");
    const invalidOutput = path.join(tempDirectory, "invalid-manifest.json");
    writeFileSync(invalidInput, ".env\n.evidence/reviews/T01/implementer.md\n", "utf8");

    const invalidResult = runScript([
      "scripts/stage-paths.mjs",
      "--task",
      "T99",
      "--input",
      path.relative(root, invalidInput),
      "--output",
      path.relative(root, invalidOutput),
    ]);
    expect(invalidResult.status).toBe(1);
    expect(existsSync(invalidOutput)).toBe(false);
    expect(invalidResult.stderr).toContain("sensitive");
  });
});
