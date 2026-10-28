import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const probeBase = path.join(root, ".tmp", "T01", "boundary-probes");

function runBoundary(probeRoot: string, stagingRoot?: string) {
  const args = ["scripts/verify-boundaries.mjs", "--packages", path.relative(root, probeRoot)];
  if (stagingRoot) {
    args.push("--staging-root", path.relative(root, stagingRoot));
  }
  try {
    const stdout = execFileSync(process.execPath, args, {
      cwd: root,
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

function writeProbePackage(
  probeRoot: string,
  directory: string,
  manifestOverrides: Record<string, unknown>,
  source: string,
) {
  const packageDirectory = path.join(probeRoot, directory);
  mkdirSync(path.join(packageDirectory, "src"), { recursive: true });
  const manifest = {
    name: "@boardloom/core",
    version: "0.0.0",
    private: true,
    type: "module",
    sideEffects: false,
    main: "./dist/index.js",
    types: "./dist/index.d.ts",
    exports: {
      ".": {
        types: "./dist/index.d.ts",
        import: "./dist/index.js",
        default: "./dist/index.js",
      },
      "./package.json": "./package.json",
    },
    files: ["dist", "README.md", "LICENSE"],
    ...manifestOverrides,
  };
  writeFileSync(path.join(packageDirectory, "package.json"), JSON.stringify(manifest, null, 2));
  writeFileSync(path.join(packageDirectory, "README.md"), "# Probe\n");
  writeFileSync(path.join(packageDirectory, "LICENSE"), "MIT\n");
  writeFileSync(path.join(packageDirectory, "src", "index.ts"), source);
}

describe("package boundary enforcement", () => {
  it("rejects external and bundled dependencies in core", () => {
    const probeRoot = path.join(probeBase, "dependencies");
    rmSync(probeRoot, { recursive: true, force: true });
    writeProbePackage(
      probeRoot,
      "core",
      {
        dependencies: { react: "0.0.0" },
        optionalDependencies: { fastify: "0.0.0" },
        peerDependencies: { "@boardloom/angular": "0.0.0" },
        bundledDependencies: ["@boardloom/view-dom"],
      },
      "export {};\n",
    );

    const result = runBoundary(probeRoot);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("react is not allowed");
    expect(result.stderr).toContain("fastify");
    expect(result.stderr).toContain("@boardloom/angular");
    expect(result.stderr).toContain("bundledDependencies");
  });

  it("allows renderer-specific echarts but rejects it in view-dom", () => {
    const allowedRoot = path.join(probeBase, "renderer-allowed");
    const emptyStaging = path.join(probeBase, "empty-staging");
    rmSync(allowedRoot, { recursive: true, force: true });
    rmSync(emptyStaging, { recursive: true, force: true });
    mkdirSync(emptyStaging, { recursive: true });
    writeProbePackage(
      allowedRoot,
      "renderers-echarts",
      {
        name: "@boardloom/renderers-echarts",
        dependencies: { echarts: "0.0.0" },
      },
      'import "echarts";\n',
    );
    const allowed = runBoundary(allowedRoot, emptyStaging);
    expect(allowed.status).toBe(0);
    expect(allowed.stdout).toContain("Build required");

    const rejectedRoot = path.join(probeBase, "dom-rejected");
    rmSync(rejectedRoot, { recursive: true, force: true });
    writeProbePackage(
      rejectedRoot,
      "view-dom",
      {
        name: "@boardloom/view-dom",
        dependencies: { echarts: "0.0.0" },
        files: ["dist", "README.md", "LICENSE", "styles.css"],
      },
      'import "echarts";\n',
    );
    writeFileSync(path.join(rejectedRoot, "view-dom", "styles.css"), "@layer boardloom {}\n");
    const rejected = runBoundary(rejectedRoot);
    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain("echarts");
  });

  it("rejects escaping, source and test export targets", () => {
    const probeRoot = path.join(probeBase, "targets");
    rmSync(probeRoot, { recursive: true, force: true });
    writeProbePackage(
      probeRoot,
      "core",
      {
        exports: {
          ".": {
            types: "./src/index.ts",
            import: "../outside.js",
          },
          "./test": "./tests/fixture.js",
        },
      },
      "export {};\n",
    );

    const result = runBoundary(probeRoot);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("export target escapes the package");
    expect(result.stderr).toContain("exposes forbidden segment src");
    expect(result.stderr).toContain("exposes forbidden segment tests");
  });

  it("detects static, dynamic, require and type import forms", () => {
    const probeRoot = path.join(probeBase, "syntax");
    rmSync(probeRoot, { recursive: true, force: true });
    const source = [
      'export * from "react";',
      'export { value } from "svelte";',
      'void import("fastify");',
      'require("prisma");',
      'import equal = require("react");',
      'type Imported = import("@angular/core").Value;',
      'const resolved = import.meta.resolve("echarts");',
      'const required = require.resolve("react");',
      "export { equal, required, resolved };",
      "",
    ].join("\n");
    writeProbePackage(probeRoot, "core", {}, source);

    const result = runBoundary(probeRoot);
    expect(result.status).toBe(1);
    for (const name of ["react", "svelte", "fastify", "prisma", "@angular/core", "echarts"]) {
      expect(result.stderr).toContain(name);
    }
  });

  it("reports a build-required state without failing source metadata checks", () => {
    const probeRoot = path.join(probeBase, "valid-source");
    const emptyStaging = path.join(probeBase, "empty-staging-valid");
    rmSync(probeRoot, { recursive: true, force: true });
    rmSync(emptyStaging, { recursive: true, force: true });
    mkdirSync(emptyStaging, { recursive: true });
    writeProbePackage(probeRoot, "core", {}, "export {};\n");

    const result = runBoundary(probeRoot, emptyStaging);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Build required");
  });
});
