import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { createRuntime } from "../../../../packages/core/src/index.js";
import { unwrap } from "../support/assertions.js";
import { makeDocument } from "../support/fakes.js";

const root = process.cwd();
const sourceRoot = path.join(root, "packages", "core", "src");
const forbiddenGlobals = new Set([
  "window",
  "HTMLElement",
  "HTMLCanvasElement",
  "ResizeObserver",
  "MutationObserver",
  "IntersectionObserver",
  "localStorage",
  "sessionStorage",
  "navigator",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "getComputedStyle",
  "DOMParser",
  "XMLSerializer",
]);

function listSourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

describe("headless core import contract", () => {
  it("does not reference DOM globals and has no external package imports", () => {
    const findings: string[] = [];
    for (const file of listSourceFiles(sourceRoot)) {
      const relative = path.relative(root, file).split(path.sep).join("/");
      const sourceFile = ts.createSourceFile(
        file,
        readFileSync(file, "utf8"),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      );

      function visit(node: ts.Node): void {
        if (ts.isIdentifier(node) && forbiddenGlobals.has(node.text)) {
          findings.push(`${relative}: DOM identifier ${node.text}`);
        }
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
          const specifier = node.moduleSpecifier.text;
          if (!specifier.startsWith(".") && !specifier.startsWith("/")) {
            findings.push(`${relative}: external import ${specifier}`);
          }
        }
        ts.forEachChild(node, visit);
      }

      visit(sourceFile);
    }

    expect(findings).toEqual([]);
  });

  it("runs in Node without browser globals", () => {
    expect((globalThis as Record<string, unknown>).document).toBeUndefined();
    expect((globalThis as Record<string, unknown>).window).toBeUndefined();
    const runtime = createRuntime();
    const space = unwrap(runtime.createSpace({ id: "no-dom", document: makeDocument("Headless") }));
    expect(space.getSnapshot().committedDocument.title).toBe("Headless");
    unwrap(space.dispose());
    unwrap(runtime.dispose());
  });
});
