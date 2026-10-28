import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isSensitiveName } from "../../scripts/lib/repo.mjs";
import { validateMetadataPath } from "../../scripts/lib/safe-paths.mjs";
import { scanPaths } from "../../scripts/lib/public-surface.mjs";

const root = process.cwd();
const fixtureBase = path.join(root, ".tmp", "T01", "public-surface-fixture");
const fixtureRoot = path.join(fixtureBase, "root");
const outsideRoot = path.join(fixtureBase, "outside");

function resetFixture() {
  rmSync(fixtureBase, { recursive: true, force: true });
  mkdirSync(fixtureRoot, { recursive: true });
  mkdirSync(outsideRoot, { recursive: true });
}

function runScript(args) {
  try {
    const stdout = execFileSync(process.execPath, args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    return {
      status: error.status ?? 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
    };
  }
}

describe("public-surface scanner safety", () => {
  it("rejects a protected path before any filesystem access", () => {
    let touched = false;
    const dependencies = {
      lstat() {
        touched = true;
        throw new Error("lstat must not run");
      },
      realpath() {
        touched = true;
        throw new Error("realpath must not run");
      },
      stat() {
        touched = true;
        throw new Error("stat must not run");
      },
      readFile() {
        touched = true;
        throw new Error("readFile must not run");
      },
    };

    const result = scanPaths({
      repoRoot: fixtureRoot,
      paths: [".env"],
      dependencies,
    });

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].rule).toBe("protected-path");
    expect(touched).toBe(false);
  });

  it("rejects local-only, traversal and absolute paths", () => {
    const result = scanPaths({
      repoRoot: fixtureRoot,
      paths: [".evidence/reviews/sample.md", "../outside.txt", "/etc/passwd"],
    });

    expect(result.findings.map((finding) => finding.rule)).toEqual([
      "local-path",
      "path-escape",
      "path-escape",
    ]);
  });

  it("rejects file and ancestor symlinks", () => {
    resetFixture();
    writeFileSync(path.join(outsideRoot, "outside-sample.txt"), "ordinary sample\n", "utf8");
    symlinkSync(
      path.join(outsideRoot, "outside-sample.txt"),
      path.join(fixtureRoot, "linked-file.txt"),
    );
    symlinkSync(outsideRoot, path.join(fixtureRoot, "linked-dir"));

    const result = scanPaths({
      repoRoot: fixtureRoot,
      paths: ["linked-file.txt", "linked-dir/outside-sample.txt"],
    });

    expect(result.findings.map((finding) => finding.rule)).toEqual(["symlink", "symlink"]);
  });

  it("detects registry auth and unquoted assignments without echoing values", () => {
    resetFixture();
    const fakeRegistryValue = ["fake", "Registry", "Value"].join("");
    const fakeAssignmentValue = ["fake", "Assignment", "Value"].join("");
    const registryLine = ["//registry.npmjs.org/:_auth", "Token=", fakeRegistryValue].join("");
    const assignmentLine = ["api", "_key: ", fakeAssignmentValue].join("");
    writeFileSync(
      path.join(fixtureRoot, "registry-config-sample.txt"),
      `${registryLine}\n${assignmentLine}\n`,
      "utf8",
    );

    const result = scanPaths({
      repoRoot: fixtureRoot,
      paths: ["registry-config-sample.txt"],
    });
    const rules = result.findings.map((finding) => finding.rule);
    const serialized = JSON.stringify(result);

    expect(rules).toContain("registry-auth");
    expect(rules).toContain("unquoted-credential-assignment");
    expect(serialized).not.toContain(fakeRegistryValue);
    expect(serialized).not.toContain(fakeAssignmentValue);
  });

  it("rejects protected wildcard names used for manifest inputs without filesystem access", () => {
    let touched = false;
    const dependencies = {
      lstat() {
        touched = true;
        throw new Error("lstat must not run");
      },
      realpath() {
        touched = true;
        throw new Error("realpath must not run");
      },
    };

    const result = validateMetadataPath({
      repoRoot: fixtureRoot,
      relativePath: ".env",
      dependencies,
    });

    expect(result.rule).toBe("protected-path");
    expect(touched).toBe(false);

    const directoryResult = validateMetadataPath({
      repoRoot: fixtureRoot,
      relativePath: ".tmp/service-secret/manifest.json",
      dependencies,
    });
    expect(directoryResult.rule).toBe("protected-path");
    expect(touched).toBe(false);
    for (const name of [
      "service-secret.txt",
      "servicepassword.txt",
      "serviceapikey.txt",
      "service_api_key.txt",
      "token-store.txt",
      "service-secret/file.txt",
      "servicepassword/file.txt",
    ]) {
      expect(isSensitiveName(name)).toBe(true);
    }
    expect(isSensitiveName("scripts/check-public-surface.mjs")).toBe(false);
  });

  it("guards intended manifest parents and forbidden metadata segments", () => {
    const intended = validateMetadataPath({
      repoRoot: fixtureRoot,
      relativePath: ".evidence/reviews/T98/stage-paths.json",
      allowMissingFinal: true,
      allowMissingParents: true,
    });
    expect(intended.ok).toBe(true);

    const forbidden = validateMetadataPath({
      repoRoot: fixtureRoot,
      relativePath: ".tmp/.ctx/manifest.json",
    });
    expect(forbidden.rule).toBe("local-path");
  });

  it("rejects a linked manifest and sanitizes malformed manifest diagnostics", () => {
    resetFixture();
    const manifestSource = path.join(fixtureBase, "manifest-source.json");
    const manifestLink = path.join(fixtureBase, "manifest-link.json");
    const malformedManifest = path.join(fixtureBase, "malformed.json");
    writeFileSync(manifestSource, JSON.stringify(["LICENSE"]), "utf8");
    symlinkSync(manifestSource, manifestLink);
    writeFileSync(malformedManifest, '{"synthetic":"payload', "utf8");

    const linked = runScript([
      "scripts/check-public-surface.mjs",
      "--manifest",
      path.relative(root, manifestLink),
    ]);
    expect(linked.status).toBe(1);
    expect(linked.stderr).toContain("symlink");

    const malformed = runScript([
      "scripts/check-public-surface.mjs",
      "--manifest",
      path.relative(root, malformedManifest),
    ]);
    expect(malformed.status).toBe(1);
    expect(malformed.stderr).toContain("not valid JSON");
    expect(`${malformed.stdout}${malformed.stderr}`).not.toContain("synthetic");
    expect(`${malformed.stdout}${malformed.stderr}`).not.toContain("payload");
  });

  it("guards isolated stage-path output and keeps a safe fixture unchanged", () => {
    resetFixture();
    const fixtureDocs = path.join(fixtureRoot, "docs", "framework");
    mkdirSync(fixtureDocs, { recursive: true });
    const fixtureFile = path.join(fixtureDocs, "guard-probe.json");
    const sentinel = JSON.stringify({ sentinel: "keep" });
    writeFileSync(fixtureFile, sentinel, "utf8");

    const guard = validateMetadataPath({
      repoRoot: fixtureRoot,
      relativePath: "docs/framework/guard-probe.json",
      allowMissingFinal: true,
      allowMissingParents: true,
    });
    expect(guard.ok).toBe(false);
    expect(guard.rule).toBe("local-path");
    expect(readFileSync(fixtureFile, "utf8")).toBe(sentinel);
  });

  it("rejects a protected CLI path without reading or creating it", () => {
    const result = runScript(["scripts/check-public-surface.mjs", "--paths", ".env"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("protected-path");
  });

  it("scans tracked public files successfully", () => {
    const result = runScript(["scripts/check-public-surface.mjs"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Public-surface check passed");
  });
});
