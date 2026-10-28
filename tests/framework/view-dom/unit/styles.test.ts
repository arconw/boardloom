import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const styles = readFileSync(path.join(root, "packages/view-dom/styles.css"), "utf8");
const selectorLines = styles
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.startsWith(".") || line.startsWith("*") || line.startsWith(":"));

describe("T06 scoped viewer styles", () => {
  it("keeps every selector scoped to the Boardloom host or its cascade layer", () => {
    expect(styles).toContain("@layer boardloom");
    expect(styles).not.toMatch(/(^|\})\s*(:root|html|body)\s*\{/m);
    expect(styles).not.toContain("@import");
    expect(styles).not.toMatch(/url\(\s*["']?https?:/);
    for (const selector of selectorLines) {
      expect(selector, selector).toMatch(/^\.boardloom/);
    }
  });

  it("provides the viewer shell, state, metric, table and filter surface classes", () => {
    for (const className of [
      ".boardloom.bl-viewer",
      ".boardloom .bl-header",
      ".boardloom .bl-status",
      ".boardloom .bl-diagnostics",
      ".boardloom .bl-filters",
      ".boardloom .bl-board-grid",
      ".boardloom .bl-block",
      ".boardloom .bl-state",
      ".boardloom .bl-metric__value",
      ".boardloom .bl-table-region",
      ".boardloom .bl-filter-surface",
      ".boardloom .bl-live",
    ]) {
      expect(styles, className).toContain(className);
    }
  });

  it("uses logical layout properties and honors narrow and reduced-motion rules", () => {
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(styles).toContain('data-boardloom-breakpoint="narrow"');
    expect(styles).toContain("grid-template-columns");
    expect(styles).toContain("grid-auto-rows");
    expect(styles).toContain("grid-row:");
    expect(styles).toContain(".bl-chart-data[hidden]");
    expect(styles).toContain("unicode-bidi: isolate");
    expect(styles).not.toMatch(/margin-(left|right)\s*:/);
    expect(styles).not.toMatch(/padding-(left|right)\s*:/);
    expect(styles).not.toMatch(/text-align:\s*(left|right)\s*;/);
    expect(styles).not.toMatch(/font-size:\s*(10|11)px/);
  });
});
