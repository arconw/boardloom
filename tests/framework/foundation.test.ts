import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const plannedPackages = [
  "core",
  "view-dom",
  "renderers-echarts",
  "react",
  "angular",
  "svelte",
] as const;

const forbiddenDependencies = new Set([
  "@fastify/cors",
  "@prisma/client",
  "better-sqlite3",
  "express",
  "fastify",
  "knex",
  "koa",
  "pg",
  "prisma",
  "sequelize",
  "sqlite3",
  "typeorm",
]);

function readJson(relativePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(root, relativePath), "utf8")) as Record<string, unknown>;
}

describe("workspace package skeleton", () => {
  it("declares the planned workspace layout", () => {
    const manifest = readJson("package.json");
    expect(manifest.private).toBe(true);
    expect(manifest.type).toBe("module");
    expect(manifest.license).toBe("MIT");
    expect(manifest.workspaces).toEqual(
      expect.arrayContaining(["packages/*", "examples/*", "apps/*"]),
    );
    expect(manifest.engines).toEqual(
      expect.objectContaining({
        node: ">=24.21.0 <25",
        npm: ">=11.19.0 <12",
      }),
    );
  });

  it.each(plannedPackages)("ships a publishable-shaped manifest for %s", (packageName) => {
    const relativePackage = `packages/${packageName}`;
    const manifest = readJson(`${relativePackage}/package.json`);

    expect(manifest.name).toBe(`@boardloom/${packageName}`);
    expect(manifest.private).toBe(true);
    expect(manifest.type).toBe("module");
    expect(manifest.license).toBe("MIT");
    expect(manifest).toHaveProperty("sideEffects");
    expect(manifest.exports).toEqual(
      expect.objectContaining({
        ".": expect.objectContaining({
          types: "./dist/index.d.ts",
          import: "./dist/index.js",
          default: "./dist/index.js",
        }),
        "./package.json": "./package.json",
      }),
    );
    expect(manifest.files).toEqual(expect.arrayContaining(["dist", "README.md", "LICENSE"]));

    const dependencySections = ["dependencies", "devDependencies", "peerDependencies"] as const;
    for (const section of dependencySections) {
      const dependencies = (manifest[section] ?? {}) as Record<string, string>;
      for (const dependency of Object.keys(dependencies)) {
        expect(forbiddenDependencies.has(dependency)).toBe(false);
      }
    }

    for (const relativeFile of ["src/index.ts", "tsconfig.json", "README.md", "LICENSE"]) {
      expect(existsSync(path.join(root, relativePackage, relativeFile))).toBe(true);
    }

    const packageLicense = readFileSync(path.join(root, relativePackage, "LICENSE"));
    const rootLicense = readFileSync(path.join(root, "LICENSE"));
    expect(packageLicense.equals(rootLicense)).toBe(true);
  });

  it("exports the DOM styles entry", () => {
    const manifest = readJson("packages/view-dom/package.json");
    expect(manifest.exports).toEqual(
      expect.objectContaining({
        "./styles.css": "./styles.css",
      }),
    );
    expect(existsSync(path.join(root, "packages/view-dom/styles.css"))).toBe(true);
  });
});
