import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ENGLISH_MESSAGES } from "../../packages/core/src/index.js";

const root = process.cwd();

function read(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf8");
}

const tokenStyles = read("packages/view-dom/styles.css");
const designSystem = read("docs/design/DESIGN_SYSTEM.md");
const acceptance = read("docs/design/VISUAL_ACCEPTANCE.md");
const referenceStyles = read("docs/design/references/reference.css");

const colorTokens = [
  "canvas",
  "canvas-deep",
  "surface",
  "surface-raised",
  "surface-sunken",
  "surface-overlay",
  "field",
  "field-disabled",
  "text",
  "text-muted",
  "text-faint",
  "text-inverse",
  "text-on-accent",
  "border-subtle",
  "border",
  "border-strong",
  "accent",
  "accent-hover",
  "accent-active",
  "accent-soft",
  "accent-soft-text",
  "focus",
  "selection",
  "selection-text",
  "backdrop",
  "success",
  "success-surface",
  "warning",
  "warning-surface",
  "danger",
  "danger-surface",
  "info",
  "info-surface",
  "skeleton",
  "skeleton-highlight",
];

const typographyTokens = [
  "font-sans",
  "font-display",
  "font-mono",
  "font-size-xs",
  "font-size-sm",
  "font-size-md",
  "font-size-lg",
  "font-size-xl",
  "font-size-2xl",
  "font-size-3xl",
  "font-size-4xl",
  "line-height-tight",
  "line-height-snug",
  "line-height-normal",
  "line-height-relaxed",
  "font-weight-regular",
  "font-weight-medium",
  "font-weight-semibold",
  "font-weight-bold",
  "letter-spacing-tight",
  "letter-spacing-normal",
  "letter-spacing-wide",
  "letter-spacing-caps",
  "font-variant-numeric",
];

const spacingTokens = [
  "0",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "10",
  "12",
  "14",
  "16",
  "20",
  "24",
].map((value) => `space-${value}`);

const radiusTokens = ["none", "xs", "sm", "md", "lg", "xl", "full"].map(
  (value) => `radius-${value}`,
);

const elevationTokens = ["0", "1", "2", "3"].map((value) => `elevation-${value}`);

const motionTokens = [
  "motion-duration-instant",
  "motion-duration-fast",
  "motion-duration-base",
  "motion-duration-slow",
  "motion-duration-slower",
  "motion-ease-standard",
  "motion-ease-enter",
  "motion-ease-exit",
];

const focusTokens = ["focus-width", "focus-offset", "focus-radius"];

const chartTokens = [
  ...Array.from({ length: 8 }, (_, index) => `chart-series-${index + 1}`),
  "chart-grid",
  "chart-axis",
  "chart-threshold",
  "chart-reference",
  "chart-selection",
  "chart-null",
  "chart-band",
  "chart-fill-opacity",
];

const layoutTokens = [
  "control-height-sm",
  "control-height-md",
  "control-height-lg",
  "target-min",
  "icon-sm",
  "icon-md",
  "icon-lg",
  "layout-content-max",
  "layout-gutter",
  "layout-grid-gap",
  "layout-block-gap",
  "z-base",
  "z-sticky",
  "z-dropdown",
  "z-drawer",
  "z-dialog",
  "z-toast",
];

function hasToken(name: string): boolean {
  return new RegExp(`--bl-${name}\\s*:`).test(tokenStyles);
}

function colorPair(name: string): [string, string] {
  const match = tokenStyles.match(
    new RegExp(
      `--bl-${name}\\s*:\\s*light-dark\\(\\s*(#[0-9a-fA-F]{6})\\s*,\\s*(#[0-9a-fA-F]{6})\\s*\\)`,
    ),
  );
  if (!match) {
    throw new Error(`token ${name} is not a light-dark color pair`);
  }
  const light = match[1];
  const dark = match[2];
  if (!light || !dark) {
    throw new Error(`token ${name} has an incomplete light-dark pair`);
  }
  return [light, dark];
}

function luminance(hex: string): number {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255);
  const linear = channels.map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  const red = linear[0] ?? 0;
  const green = linear[1] ?? 0;
  const blue = linear[2] ?? 0;
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(first: string, second: string): number {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function placeholderNames(text: string): string[] {
  return [...text.matchAll(/\{([a-zA-Z0-9_.-]+)\}/g)]
    .map((match) => match[1])
    .filter((value): value is string => value !== undefined)
    .sort();
}

describe("T05 design token layer", () => {
  it("declares the complete required token families inside the scoped boardloom layer", () => {
    expect(tokenStyles).toContain("@layer boardloom");
    expect(tokenStyles).toContain(".boardloom {");
    expect(tokenStyles).toContain('[data-boardloom-theme="light"]');
    expect(tokenStyles).toContain('[data-boardloom-theme="dark"]');
    expect(tokenStyles).toContain('[data-boardloom-theme="system"]');
    expect(tokenStyles).toContain("color-scheme: light dark");
    expect(tokenStyles).toContain(":focus-visible");
    expect(tokenStyles).toContain("@media (prefers-reduced-motion: reduce)");

    for (const name of [
      ...colorTokens.map((value) => `color-${value}`),
      ...typographyTokens,
      ...spacingTokens,
      ...radiusTokens,
      ...elevationTokens,
      ...motionTokens,
      ...focusTokens,
      ...chartTokens,
      ...layoutTokens,
    ]) {
      expect(hasToken(name), `missing token --bl-${name}`).toBe(true);
    }
  });

  it("does not impose global host selectors, remote fonts or a marketing brand", () => {
    expect(tokenStyles).not.toMatch(/(^|\})\s*(:root|html|body)\s*\{/m);
    expect(tokenStyles).not.toMatch(/(^|\})\s*\*\s*\{/m);
    expect(tokenStyles).not.toContain("@import");
    expect(tokenStyles).not.toMatch(/url\(\s*["']?https?:/);
    expect(tokenStyles.toLowerCase()).not.toContain("boardloom-brand");
  });

  it("documents the token families, theme contract and implementation boundary", () => {
    for (const phrase of [
      "--bl-color-canvas",
      "--bl-font-sans",
      "--bl-space-1",
      "--bl-radius-md",
      "--bl-elevation-2",
      "--bl-motion-duration-base",
      "--bl-focus-width",
      "--bl-chart-series-1",
      "data-boardloom-theme",
      "cascade layer",
      "not production UI",
    ]) {
      expect(designSystem).toContain(phrase);
    }
    expect(referenceStyles).toContain('@import "../../../packages/view-dom/styles.css"');
  });

  it("meets AA text and non-text contrast for every documented core pair", () => {
    const pairs: Array<[string, string, number]> = [
      ["color-text", "color-canvas", 4.5],
      ["color-text", "color-surface", 4.5],
      ["color-text-muted", "color-surface", 4.5],
      ["color-text-faint", "color-surface", 4.5],
      ["color-accent", "color-surface", 4.5],
      ["color-text-on-accent", "color-accent", 4.5],
      ["color-accent-soft-text", "color-accent-soft", 4.5],
      ["color-selection-text", "color-selection", 4.5],
      ["color-focus", "color-canvas", 3],
      ["color-focus", "color-surface", 3],
      ["color-border-strong", "color-surface", 3],
      ["color-success", "color-success-surface", 4.5],
      ["color-warning", "color-warning-surface", 4.5],
      ["color-danger", "color-danger-surface", 4.5],
      ["color-info", "color-info-surface", 4.5],
    ];

    for (const [foreground, background, minimum] of pairs) {
      const foregroundValues = colorPair(foreground);
      const backgroundValues = colorPair(background);
      expect(
        contrast(foregroundValues[0], backgroundValues[0]),
        `light ${foreground}`,
      ).toBeGreaterThanOrEqual(minimum);
      expect(
        contrast(foregroundValues[1], backgroundValues[1]),
        `dark ${foreground}`,
      ).toBeGreaterThanOrEqual(minimum);
    }
  });

  it("keeps all eight chart series distinguishable from both surfaces", () => {
    const surface = colorPair("color-surface");
    for (let index = 1; index <= 8; index += 1) {
      const series = colorPair(`chart-series-${index}`);
      expect(contrast(series[0], surface[0]), `light series ${index}`).toBeGreaterThanOrEqual(3);
      expect(contrast(series[1], surface[1]), `dark series ${index}`).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("T05 message-key catalog", () => {
  const catalog = JSON.parse(read("docs/design/message-keys.json")) as {
    version: number;
    keys: Array<{
      key: string;
      english: string;
      context: string;
      source: string;
      placeholders?: string[];
    }>;
  };

  it("has unique namespaced keys and complete placeholder declarations", () => {
    expect(catalog.version).toBe(1);
    const seen = new Set<string>();
    for (const entry of catalog.keys) {
      expect(entry.key).toMatch(/^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9_]+)+$/);
      expect(seen.has(entry.key), `duplicate key ${entry.key}`).toBe(false);
      seen.add(entry.key);
      expect(entry.english.length).toBeGreaterThan(0);
      expect(entry.context.length).toBeGreaterThan(0);
      expect(["core", "proposed"]).toContain(entry.source);
      expect(placeholderNames(entry.english)).toEqual([...(entry.placeholders ?? [])].sort());
    }
  });

  it("includes every existing core UI key used by the design foundations", () => {
    for (const key of Object.keys(ENGLISH_MESSAGES)) {
      if (/^(common|mode|draft|editor|status|a11y)\./.test(key)) {
        expect(seenKeys(), `missing core key ${key}`).toContain(key);
      }
    }
  });

  function seenKeys(): string[] {
    return catalog.keys.map((entry) => entry.key);
  }
});

describe("T05 static reference mocks", () => {
  const pages = [
    "index.html",
    "viewer-desktop.html",
    "viewer-narrow.html",
    "editor-desktop.html",
    "editor-narrow.html",
    "states.html",
    "boards.html",
    "localization.html",
    "accessibility.html",
  ];

  it("labels every page as a design reference and never mislabels it as product UI", () => {
    for (const page of pages) {
      const document = read(`docs/design/references/${page}`);
      expect(document, page).toContain("Design reference - not production UI");
      expect(document, page).not.toContain("<img");
    }
  });

  it("annotates visible copy only with keys that exist in the catalog", () => {
    const catalog = JSON.parse(read("docs/design/message-keys.json")) as {
      keys: Array<{ key: string }>;
    };
    const known = new Set(catalog.keys.map((entry) => entry.key));
    for (const page of pages) {
      const document = read(`docs/design/references/${page}`);
      for (const match of document.matchAll(/data-message-key="([^"]+)"/g)) {
        const key = match[1];
        if (key === undefined) {
          continue;
        }
        expect(known.has(key), `${page} uses unknown key ${key}`).toBe(true);
      }
    }
  });

  it("covers all required states and the viewer, editor, narrow and RTL compositions", () => {
    const states = read("docs/design/references/states.html");
    for (const state of [
      "Loading",
      "Empty",
      "Error",
      "Stale",
      "Partial",
      "Diagnostics",
      "Filter origin",
      "Comparison",
      "Realtime reconnect",
      "Plugin error",
    ]) {
      expect(states).toContain(state);
    }

    expect(read("docs/design/references/viewer-desktop.html")).toContain(
      'data-boardloom-theme="dark"',
    );
    expect(read("docs/design/references/editor-desktop.html")).toContain(
      'data-boardloom-theme="dark"',
    );
    expect(read("docs/design/references/viewer-narrow.html")).toContain("app-shell--narrow-320");
    expect(read("docs/design/references/editor-narrow.html")).toContain("app-shell--narrow-320");
    expect(read("docs/design/references/localization.html")).toContain('dir="rtl"');

    expect(acceptance).toContain("AC-122");
    expect(acceptance).toContain("AC-111");
    expect(acceptance).toContain("AC-120");
    expect(acceptance).toContain("AC-121");
    expect(acceptance).toContain("AC-150");
    expect(acceptance).toContain("VA-62");
  });

  it("annotates every framework control and column header in product references", () => {
    const productPages = pages.filter(
      (page) => page !== "index.html" && page !== "accessibility.html",
    );
    for (const page of productPages) {
      const document = read(`docs/design/references/${page}`).replace(
        /<details class="ref-keymap">[\s\S]*?<\/details>/g,
        "",
      );
      for (const match of document.matchAll(/<(button|input|select|label|summary)\b[^>]*>/g)) {
        expect(match[0], `${page} has an unannotated ${match[1]}`).toContain("data-message-key=");
      }
      for (const match of document.matchAll(
        /<th\b(?=[^>]*scope="col")(?![^>]*data-message-key)(?![^>]*data-host-content)[^>]*>/g,
      )) {
        expect(match[0], `${page} has an unannotated column header`).toContain("data-message-key=");
      }
      expect(document, `${page} should distinguish host fixture content`).toContain(
        "data-host-content=",
      );
    }
  });

  it("maps framework status, instructions and accessible names to semantic keys", () => {
    const productPages = pages.filter(
      (page) => page !== "index.html" && page !== "accessibility.html",
    );
    const expectedAriaKeys: Record<string, string> = {
      "Editor panels": "editor.panels",
      "Editor drawers": "editor.drawers",
      "Inspector sections": "editor.inspectorSections",
      "Keyboard layout controls": "a11y.keyboardAlternative",
      "Move selected block": "editor.block.move",
      "Board mode": "a11y.modeNavigation",
      "Board filters": "a11y.filterRegion",
      "Key measures": "a11y.measuresRegion",
      "Series legend": "chart.legend",
      "وضع اللوحة": "a11y.modeNavigation",
      "المؤشرات الرئيسية": "a11y.measuresRegion",
    };
    for (const page of productPages) {
      const document = read(`docs/design/references/${page}`);
      for (const match of document.matchAll(/<(p|div|ul|section|form)\b[^>]*>/g)) {
        const tag = match[0];
        const aria = tag.match(/aria-label="([^"]+)"/)?.[1];
        const key = tag.match(/data-message-key="([^"]+)"/)?.[1];
        if (aria && expectedAriaKeys[aria]) {
          expect(key, `${page} aria-label ${aria}`).toBe(expectedAriaKeys[aria]);
        }
      }
      for (const match of document.matchAll(
        /<[a-z]+\s+class="keyboard-hint"(?![^>]*data-message-key)[^>]*>/g,
      )) {
        expect(match[0], `${page} has an unkeyed keyboard instruction`).toContain(
          "data-message-key=",
        );
      }
      expect(document, `${page} generic library-add key`).not.toContain(
        'data-message-key="editor.library.add"',
      );
      expect(document, `${page} host period key`).not.toContain(
        'data-message-key="table.header.currentPeriod">Fall 2026',
      );
    }
    for (const page of productPages) {
      const document = read(`docs/design/references/${page}`);
      for (const match of document.matchAll(/<[a-z][^>]*\baria-label="([^"]+)"[^>]*>/g)) {
        const tag = match[0];
        expect(
          /data-message-key=|data-host-content=|data-doc-content=/.test(tag),
          `${page} unclassified accessible name ${match[1]}`,
        ).toBe(true);
      }
    }
    const boards = read("docs/design/references/boards.html");
    expect(boards).toMatch(/aria-label="Commercial measures"[^>]*data-host-content=/);
    expect(boards).toMatch(/aria-label="Operational measures"[^>]*data-host-content=/);
    const editorNarrow = read("docs/design/references/editor-narrow.html");
    expect(editorNarrow).toContain('data-message-key="draft.dirty"');
    expect(editorNarrow).toContain('data-message-key="editor.draft.edits.other"');
    expect(editorNarrow).toContain('data-message-key="draft.clean"');
    expect(read("docs/design/references/states.html")).toContain(
      'data-message-key="state.stale.chartSummary"',
    );
  });

  it("uses one main landmark per documentation page and no incomplete tab semantics", () => {
    for (const page of pages) {
      const document = read(`docs/design/references/${page}`);
      expect(document.match(/<main\b/g)?.length ?? 0, `${page} main count`).toBe(1);
      expect(document, `${page} uses role=tab`).not.toContain('role="tab"');
      expect(document, `${page} uses aria-selected`).not.toContain("aria-selected=");
    }
  });

  it("keeps the modal narrow editor draft actions inside the sheet", () => {
    const editorNarrow = read("docs/design/references/editor-narrow.html");
    const sheet = editorNarrow.slice(
      editorNarrow.indexOf('id="narrow-inspector-sheet"') - 200,
      editorNarrow.indexOf("</section>", editorNarrow.indexOf('id="narrow-inspector-sheet"')),
    );
    expect(sheet).toContain('data-message-key="common.apply"');
    expect(sheet).toContain('data-message-key="editor.draft.discard"');
    expect(editorNarrow).toContain('aria-controls="narrow-inspector-sheet"');
    expect(editorNarrow).toContain('class="narrow-background" inert aria-hidden="true"');
  });

  it("keeps skip-link, target, elevation and small-text regressions visible in reference styles", () => {
    expect(referenceStyles).toContain(".ref-page .sr-only:focus-visible");
    expect(referenceStyles).toContain("clip: auto");
    expect(referenceStyles).toContain("position: static");
    expect(referenceStyles).toContain("min-height: var(--bl-target-min)");
    expect(referenceStyles).toContain(".ui-check {");
    expect(referenceStyles).not.toMatch(/font-size:\s*(10|11)px/);
    expect(read("docs/design/references/index.html")).not.toMatch(/font-size:\s*(10|11)px/);
    expect(referenceStyles).toContain(".a11y-legend li > span:not(.a11y-number)");
    expect(referenceStyles).toContain("color: var(--bl-color-text-on-accent)");
  });

  it("defines valid theme-dependent elevation shadows", () => {
    expect(tokenStyles).not.toMatch(/--bl-elevation-[123]\s*:\s*light-dark\(\s*0 /);
    for (const level of [1, 2, 3]) {
      expect(tokenStyles).toMatch(
        new RegExp(
          `--bl-elevation-${level}\\s*:\\s*0 [^;]*light-dark\\(rgba\\([^)]*\\), rgba\\([^)]*\\)\\)`,
        ),
      );
    }
  });

  it("resolves the Arabic SVG title and description without using the panel heading", () => {
    const localization = read("docs/design/references/localization.html");
    expect(localization).toContain('aria-labelledby="rtl-svg-title"');
    expect(localization).toContain('aria-describedby="rtl-svg-desc"');
    expect(localization).toContain('<title id="rtl-svg-title">');
    expect(localization).toContain('<desc id="rtl-svg-desc">');
  });

  it("wraps documentation tables and gives narrow artboards a full-bleed review frame", () => {
    expect(referenceStyles).toContain("@media (max-width: 900px)");
    expect(referenceStyles).toContain(".ref-artboard-frame");
    expect(referenceStyles).toContain("padding-inline: 0;");
    const accessibility = read("docs/design/references/accessibility.html");
    expect(accessibility).toContain('data-reference-kind="annotations"');
    expect(read("docs/design/references/index.html")).toContain(
      'data-reference-kind="documentation"',
    );
    expect((accessibility.match(/class="table-scroll"/g) ?? []).length).toBeGreaterThanOrEqual(3);
    for (const page of pages) {
      const document = read(`docs/design/references/${page}`);
      for (const match of document.matchAll(/<div\s+class="table-scroll"[\s\S]*?>/g)) {
        expect(match[0], `${page} table-scroll region`).toContain('role="region"');
        expect(match[0], `${page} table-scroll keyboard path`).toContain('tabindex="0"');
        expect(match[0], `${page} table-scroll name`).toContain("aria-labelledby=");
      }
    }
    expect(accessibility).toContain('id="keyboard-paths-table-caption"');
    expect(accessibility).toContain('role="region" aria-labelledby="keyboard-title"');
  });

  it("groups diagnostic severity in words and keeps the theme persistence contract", () => {
    const states = read("docs/design/references/states.html");
    expect(states).toContain('data-message-key="viewer.diagnostics.severity.warning"');
    expect(states).toContain('data-message-key="viewer.diagnostics.severity.info"');
    expect(states).toContain("Warnings");
    expect(states).toContain("Information");
    expect(designSystem).toContain("theme.tokens");
    expect(designSystem).not.toContain("stores the mode only");
    expect(designSystem).toContain("below the 768 px narrow threshold");
    expect(read("docs/design/LOCALIZATION.md")).toContain("Right moves visually right");
  });

  it("keeps the Devanagari limitation explicit instead of claiming an absent sample", () => {
    expect(acceptance).toContain("Devanagari is planned but not shown at T05");
    expect(read("docs/design/references/localization.html")).toContain(
      "A Devanagari/Hindi sample is not included in T05",
    );
  });

  it("declares plural one/other variants for count messages", () => {
    const catalog = JSON.parse(read("docs/design/message-keys.json")) as {
      keys: Array<{ key: string }>;
    };
    const known = new Set(catalog.keys.map((entry) => entry.key));
    for (const family of [
      "viewer.meta.rows",
      "viewer.filters.summary",
      "viewer.diagnostics.summary",
      "viewer.incidents.summary",
      "state.loading.body",
      "state.partial.body",
    ]) {
      expect(known.has(`${family}.one`), family).toBe(true);
      expect(known.has(`${family}.other`), family).toBe(true);
    }
  });
});
