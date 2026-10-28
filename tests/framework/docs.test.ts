import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const decisionsDirectory = path.join(root, "docs/framework/decisions");

function readDocument(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf8");
}

describe("T01 documentation records", () => {
  it("keeps seven architecture decision records with explicit cost of change", () => {
    const adrFiles = readdirSync(decisionsDirectory)
      .filter((file) => /^ADR-\d{4}-.*\.md$/.test(file))
      .sort();
    expect(adrFiles).toHaveLength(7);

    for (const file of adrFiles) {
      const content = readFileSync(path.join(decisionsDirectory, file), "utf8");
      expect(content).toMatch(/^# ADR-\d{4}: /m);
      for (const heading of [
        "## Context",
        "## Decision",
        "## Consequences",
        "## Cost of change",
        "## References",
      ]) {
        expect(content).toContain(heading);
      }
    }
  });

  it("records corrected realtime and build-staging references", () => {
    const realtime = readDocument("docs/framework/decisions/ADR-0004-realtime-layering.md");
    expect(realtime).toContain("SPEC section 6");
    expect(realtime).not.toContain("SPEC section 12");
    for (const file of [
      "docs/framework/decisions/ADR-0005-package-boundaries.md",
      "docs/framework/decisions/ADR-0006-toolchain.md",
      "docs/framework/decisions/ADR-0007-quality-gates.md",
    ]) {
      expect(readDocument(file)).toContain(".tmp/build/packages");
    }
    const quality = readDocument("docs/framework/decisions/ADR-0007-quality-gates.md");
    expect(quality).toContain("bidirectionally");
    expect(quality).toContain("duplicate");
  });

  it("records license, naming, publication and browser boundaries", () => {
    const governance = readDocument("docs/framework/GOVERNANCE.md");
    expect(governance).toContain("MIT");
    expect(governance).toContain("Copyright (c) 2026 Boardloom contributors");
    expect(governance).toContain("arconw/boardloom");
    expect(governance).toContain("Public repository");
    expect(governance).toContain("npm publication is not authorized");
    expect(governance).toContain("No package claims registry availability");
    expect(governance).toContain("@boardloom/core");
    expect(governance).toContain("not a verified compatibility claim");
    expect(governance).toContain("T23");
  });

  it("records a reversible legacy migration route", () => {
    const migration = readDocument("docs/framework/MIGRATION_PLAN.md");
    expect(migration).toContain("LEGACY");
    expect(migration).toContain("reversible");
    expect(migration).toContain("never read, copied or published");
    expect(migration).toContain(".env");
    expect(migration).toContain(".ctx");
    expect(migration).toContain("explicit, recorded deviation");
  });

  it("records official-document toolchain evidence", () => {
    const evidence = readDocument("docs/framework/decisions/toolchain-evidence.md");
    for (const url of [
      "https://nodejs.org/en/about/previous-releases",
      "https://docs.npmjs.com/cli/v11/using-npm/workspaces",
      "https://docs.npmjs.com/cli/v11/commands/npm-ci",
      "https://nodejs.org/api/packages.html",
      "https://eslint.org/docs/latest/use/configure/configuration-files",
      "https://typescript-eslint.io/users/dependency-versions/",
      "https://vitest.dev/guide/",
      "https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions",
    ]) {
      expect(evidence).toContain(url);
    }
    expect(evidence).toContain("TypeScript 7 is not used");
  });

  it("reports the current T02 review stage in the public status document", () => {
    const status = readDocument("docs/framework/STATUS.md");
    expect(status).toContain("T02");
    expect(status).toContain("headless core");
    expect(status).toContain("No DOM runtime");
    expect(status).toContain("not accepted");
  });
});
