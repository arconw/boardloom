import { describe, expect, it } from "vitest";
import {
  BLOCK_EXTENSION_API_VERSION,
  DEFAULT_RENDERER_COLORS,
  DIAGNOSTIC_CODES,
  RENDERER_API_VERSION,
  createIntlFormatterProvider,
  createRendererRegistry,
  emptyRendererData,
  mountRenderer,
  type ChartRendererSpec,
  type RendererData,
  type RendererInput,
} from "../../../../packages/core/src/index.js";
import {
  REFERENCE_BLOCK_TYPE,
  REFERENCE_PLUGIN,
  REFERENCE_RENDERER_ID,
  createReferencePlugin,
} from "../../../../packages/view-dom/src/reference-plugin.js";
import { createBoardloomExtensions } from "../../../../packages/view-dom/src/extensions.js";
import {
  installScopedStyles,
  scopeExtensionCss,
} from "../../../../packages/view-dom/src/plugin-styles.js";
import { createMiniDocument } from "../support/mini-dom.js";

function rendererInput(
  host: HTMLElement,
  spec: ChartRendererSpec,
  data: RendererData,
): RendererInput<HTMLElement> {
  const formatters = createIntlFormatterProvider({ locale: "en", timezone: "UTC" });
  return {
    host,
    spec,
    data,
    theme: { mode: "light", colors: DEFAULT_RENDERER_COLORS.light },
    locale: "en",
    timezone: "UTC",
    direction: "ltr",
    formatters,
    messages: {
      locale: "en",
      direction: "ltr",
      has: () => true,
      text: (key: string) => key,
      plural: (key: string) => key,
    },
  };
}

function referenceSpec(): ChartRendererSpec {
  return {
    id: "plugin.reference",
    kind: "chart",
    title: "Plugin values",
    comparison: false,
    visualization: "bar",
    x: { fieldId: "category", label: "Category", type: "string", role: "dimension" },
    y: { fieldId: "value", label: "Value", type: "number", role: "measure" },
    series: null,
    aggregation: "none",
    stacked: false,
    categoryOrder: "data",
    xAxis: {},
    yAxis: { min: 0 },
  };
}

describe("T13 scoped extension styles", () => {
  it("scopes selectors to one instance and preserves conditional at-rules", () => {
    const scoped = scopeExtensionCss(
      ".plugin-reference, .plugin-reference__title { color: red; }\n@media (min-width: 600px) { .plugin-reference { padding: 1rem; } }",
      "bl-instance-1",
    );
    expect(scoped.ok).toBe(true);
    if (!scoped.ok) {
      return;
    }
    expect(scoped.value).toContain(
      '[data-boardloom-scope="bl-instance-1"] .plugin-reference, [data-boardloom-scope="bl-instance-1"] .plugin-reference__title',
    );
    expect(scoped.value).toContain("@media (min-width: 600px)");
  });

  it("rejects host selectors, external imports and unscopable at-rules", () => {
    for (const css of [
      "body { color: red; }",
      ":root { color: red; }",
      "@import url(https://example.invalid/a.css);",
      "@keyframes spin { from { opacity: 0; } to { opacity: 1; } }",
      ".plugin { background: url(http://example.invalid/a.png); }",
      ".plugin { background: url( https://example.invalid/a.png); }",
      '.plugin { background: url( "https://example.invalid/a.png" ); }',
      ".plugin { background: url(\\68 ttps://example.invalid/a.png); }",
      '.plugin { background-image: image-set("https://example.invalid/a.png" 1x); }',
      '.plugin { background-image: image-set("//example.invalid/a.png" 1x); }',
      ".plugin::after { content: '</style>'; }",
    ]) {
      const result = scopeExtensionCss(css, "bl-instance-1");
      expect(result.ok, css).toBe(false);
    }
  });

  it("installs and removes separate style elements per instance", () => {
    const document = createMiniDocument();
    const first = installScopedStyles(document as unknown as Document, "bl-instance-1", [
      { id: "plugin", css: ".plugin { color: red; }" },
    ]);
    const second = installScopedStyles(document as unknown as Document, "bl-instance-2", [
      { id: "plugin", css: ".plugin { color: blue; }" },
    ]);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) {
      return;
    }
    expect(first.value.scopeSelector).not.toBe(second.value.scopeSelector);
    expect(first.value.element.textContent).toContain('[data-boardloom-scope="bl-instance-1"]');
    expect(second.value.element.textContent).toContain('[data-boardloom-scope="bl-instance-2"]');
    expect(first.value.element.textContent).not.toContain("bl-instance-2");
    first.value.dispose();
    first.value.dispose();
    expect(first.value.element.parentNode).toBeNull();
    expect(second.value.element.parentNode).not.toBeNull();
    second.value.dispose();
  });
});

describe("T13 public extension registries", () => {
  it("exposes block, renderer, adapter, formatter, dictionary and theme registrations", () => {
    const extensions = createBoardloomExtensions(REFERENCE_PLUGIN);
    expect(extensions.ok).toBe(true);
    if (!extensions.ok) {
      return;
    }
    expect(extensions.value.blocks.has(REFERENCE_BLOCK_TYPE)).toBe(true);
    expect(extensions.value.renderers.has(REFERENCE_RENDERER_ID)).toBe(true);
    expect(extensions.value.core.list("formatter").map((entry) => entry.id)).toEqual([
      "reference.formatter",
    ]);
    expect(extensions.value.core.list("messageDictionary").map((entry) => entry.id)).toEqual([
      "reference.messages.ar",
      "reference.messages.de",
      "reference.messages.en",
      "reference.messages.es",
      "reference.messages.fr",
      "reference.messages.hi",
      "reference.messages.ja",
      "reference.messages.ko",
      "reference.messages.pt-BR",
      "reference.messages.ru",
      "reference.messages.zh-CN",
    ]);
    expect(extensions.value.core.list("theme").map((entry) => entry.id)).toEqual([
      "reference.theme",
    ]);
    const kinds = extensions.value.list().map((entry) => entry.kind);
    expect(kinds.filter((kind) => kind === "block").length).toBe(6);
    expect(kinds.filter((kind) => kind === "renderer").length).toBeGreaterThanOrEqual(1);
    expect(extensions.value.list()).toContainEqual({
      kind: "renderer",
      id: REFERENCE_RENDERER_ID,
      version: "1.0.0",
    });
    expect(kinds).toContain("formatter");
    expect(kinds).toContain("messageDictionary");
    expect(kinds).toContain("theme");
    const arabic = extensions.value.core.get("messageDictionary", "reference.messages.ar");
    expect(arabic?.dictionary["plugin.reference.title"]).not.toBe("Reference tile");
    expect(arabic?.dictionary["plugin.reference.title"]).toBeTypeOf("string");
    expect(extensions.value.core.resolveThemeTokens()).toEqual({
      "ext.reference-accent": "#0d6964",
    });
    expect(extensions.value.disposed).toBe(false);
  });

  it("rejects duplicate block and renderer IDs and invalid style text", () => {
    const duplicateBlock = createBoardloomExtensions({
      blockTypes: [
        {
          type: "plugin.sample",
          version: "1.0.0",
          apiVersion: BLOCK_EXTENSION_API_VERSION,
          createSurface: () => ({
            element: createMiniDocument().createElement("div") as never,
            update: () => undefined,
          }),
        },
        {
          type: "plugin.sample",
          version: "1.1.0",
          apiVersion: BLOCK_EXTENSION_API_VERSION,
          createSurface: () => ({
            element: createMiniDocument().createElement("div") as never,
            update: () => undefined,
          }),
        },
      ],
    });
    expect(duplicateBlock.ok).toBe(false);
    if (!duplicateBlock.ok) {
      expect(duplicateBlock.diagnostics[0]?.code).toBe(DIAGNOSTIC_CODES.EXTENSION_DUPLICATE);
    }

    const badStyle = createBoardloomExtensions({
      includeBuiltIns: false,
      blockTypes: [
        {
          type: "plugin.bad-style",
          version: "1.0.0",
          apiVersion: BLOCK_EXTENSION_API_VERSION,
          styles: "body { color: red; }",
          createSurface: () => ({
            element: createMiniDocument().createElement("div") as never,
            update: () => undefined,
          }),
        },
      ],
    });
    expect(badStyle.ok).toBe(false);
    if (!badStyle.ok) {
      expect(badStyle.diagnostics[0]?.code).toBe(DIAGNOSTIC_CODES.EXTENSION_STYLE_INVALID);
    }
  });

  it("allows an explicit custom renderer without hijacking built-in visualization resolution", () => {
    const extensions = createBoardloomExtensions(REFERENCE_PLUGIN);
    expect(extensions.ok).toBe(true);
    if (!extensions.ok) {
      return;
    }
    expect(
      extensions.value.renderers.resolve({ kind: "chart", visualization: "bar" })?.id,
    ).not.toBe(REFERENCE_RENDERER_ID);
    expect(
      extensions.value.renderers.resolve({ id: REFERENCE_RENDERER_ID, kind: "chart" })?.id,
    ).toBe(REFERENCE_RENDERER_ID);
  });

  it("rejects malformed definitions before duplicate scanning", () => {
    for (const options of [
      { blockTypes: [null as never] },
      { renderers: [null as never] },
      { blockTypes: [{} as never] },
      { renderers: [{} as never] },
    ]) {
      const extensions = createBoardloomExtensions(options);
      expect(extensions.ok, JSON.stringify(options)).toBe(false);
      if (!extensions.ok) {
        expect(extensions.diagnostics[0]?.code).toBe(DIAGNOSTIC_CODES.EXTENSION_INVALID);
      }
    }
  });

  it("rejects incompatible and non-semantic block and renderer versions with shared codes", () => {
    const blockShape = () => ({
      element: createMiniDocument().createElement("div") as never,
      update: () => undefined,
    });
    const incompatibleBlock = createBoardloomExtensions({
      includeBuiltIns: false,
      blockTypes: [
        {
          type: "plugin.incompatible",
          version: "1.0.0",
          apiVersion: BLOCK_EXTENSION_API_VERSION + 1,
          createSurface: blockShape,
        },
      ],
    });
    expect(incompatibleBlock.ok).toBe(false);
    if (!incompatibleBlock.ok) {
      expect(incompatibleBlock.diagnostics[0]?.code).toBe(
        DIAGNOSTIC_CODES.EXTENSION_INCOMPATIBLE_API,
      );
    }
    const invalidBlockVersion = createBoardloomExtensions({
      includeBuiltIns: false,
      blockTypes: [
        {
          type: "plugin.bad-version",
          version: "1.0",
          apiVersion: BLOCK_EXTENSION_API_VERSION,
          createSurface: blockShape,
        },
      ],
    });
    expect(invalidBlockVersion.ok).toBe(false);
    if (!invalidBlockVersion.ok) {
      expect(invalidBlockVersion.diagnostics[0]?.code).toBe(DIAGNOSTIC_CODES.EXTENSION_INVALID);
    }

    const rendererBase = {
      id: "plugin.incompatible-renderer",
      version: "1.0.0",
      apiVersion: RENDERER_API_VERSION,
      kind: "kpi" as const,
      visualizations: [],
      capabilities: {
        kinds: ["kpi"] as const,
        visualizations: [],
        aggregation: ["none"] as const,
        comparison: false,
        series: false,
        stacking: "rejected" as const,
        zeroBaseline: "none" as const,
        negativeValues: "supported" as const,
        accessibility: true,
      },
      validate: () => ({ ok: true, diagnostics: [] }),
      mount: () => ({ update: () => undefined, destroy: () => undefined }),
    };
    const incompatibleRenderer = createRendererRegistry([
      { ...rendererBase, apiVersion: RENDERER_API_VERSION + 1 },
    ]);
    expect(incompatibleRenderer.ok).toBe(false);
    if (!incompatibleRenderer.ok) {
      expect(incompatibleRenderer.diagnostics[0]?.code).toBe(
        DIAGNOSTIC_CODES.EXTENSION_INCOMPATIBLE_API,
      );
    }
    const invalidRendererVersion = createRendererRegistry([{ ...rendererBase, version: "1.0" }]);
    expect(invalidRendererVersion.ok).toBe(false);
    if (!invalidRendererVersion.ok) {
      expect(invalidRendererVersion.diagnostics[0]?.code).toBe(DIAGNOSTIC_CODES.EXTENSION_INVALID);
    }
  });
});

describe("T13 reference plugin", () => {
  it("renders the reference custom renderer with accessible bar values", () => {
    const document = createMiniDocument();
    const host = document.createElement("div");
    const spec = referenceSpec();
    const data: RendererData = {
      ...emptyRendererData(),
      fields: [
        { fieldId: "category", type: "string", role: "dimension" },
        { fieldId: "value", type: "number", role: "measure" },
      ],
      rows: [
        { category: "A", value: 4 },
        { category: "B", value: 8 },
      ],
      counts: { returnedRows: 2, totalRows: 2, filteredRows: 2, nullCounts: {} },
      phase: "settled",
      empty: false,
    };
    const mounted = mountRenderer(
      REFERENCE_PLUGIN.renderers[0]!,
      rendererInput(host as unknown as HTMLElement, spec, data),
    );
    expect(mounted.handle).not.toBeNull();
    expect(host.textContent).toContain("A");
    expect(host.textContent).toContain("8");
    const fills = host.children.flatMap((child) => child.children);
    expect(host.getAttribute("data-boardloom-scope")).toBeNull();
    expect(fills.length).toBeGreaterThan(0);
    mounted.handle?.destroy();
  });

  it("provides a formatter and theme example that can be selected", () => {
    const plugin = createReferencePlugin({ accent: "#334455" });
    expect(plugin.themes[0]?.tokens["ext.reference-accent"]).toBe("#334455");
    const formatterDefinition = plugin.formatters[0]!;
    const formatter = formatterDefinition.create({ locale: "en", timezone: "UTC" });
    expect(formatter.formatNumber(1.23456, { maximumFractionDigits: 2 })).toBe("1.23");
    expect(createIntlFormatterProvider({ locale: "en", timezone: "UTC" }).formatNumber(1)).toBe(
      "1",
    );
  });
});
