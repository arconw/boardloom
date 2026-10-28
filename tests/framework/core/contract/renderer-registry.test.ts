import { describe, expect, it } from "vitest";
import {
  DEFAULT_RENDERER_COLORS,
  RENDERER_API_VERSION,
  createEmptyBoardDocument,
  createIntlFormatterProvider,
  createLocalDatasetProvider,
  createRuntime,
  createRendererRegistry,
  destroyRenderer,
  emptyRendererData,
  mountRenderer,
  updateRenderer,
  type RendererDefinition,
  type RendererInput,
  type RendererSpec,
} from "../../../../packages/core/src/index.js";
import { ASSESSMENT_DESCRIPTOR, ASSESSMENT_ROWS } from "../fixtures/assessment-fixture.js";
import { unwrap } from "../support/assertions.js";

const spec: RendererSpec = {
  id: "block",
  kind: "chart",
  title: "Custom",
  visualization: "line",
  x: { fieldId: "x", label: "X", type: "string" },
  y: { fieldId: "y", label: "Y", type: "number" },
  series: null,
  aggregation: "average",
  stacked: false,
  categoryOrder: "data",
  xAxis: {},
  yAxis: {},
  comparison: false,
};

function input(overrides: Partial<RendererInput<HTMLElement>> = {}): RendererInput<HTMLElement> {
  return {
    host: {} as HTMLElement,
    spec,
    data: emptyRendererData(),
    theme: { mode: "light", colors: DEFAULT_RENDERER_COLORS.light },
    locale: "en",
    timezone: "UTC",
    direction: "ltr",
    formatters: createIntlFormatterProvider({ locale: "en", timezone: "UTC" }),
    messages: {
      locale: "en",
      direction: "ltr",
      has: () => true,
      text: (key: string) => key,
      plural: (key: string) => key,
    },
    ...overrides,
  };
}

const kpiSpec: RendererSpec = {
  id: "kpi-block",
  kind: "kpi",
  title: "KPI",
  y: { fieldId: "y", label: "Y", type: "number" },
  aggregation: "average",
  comparison: false,
};

function kpiRenderer(id: string): RendererDefinition<HTMLElement> {
  return {
    ...renderer(),
    id,
    kind: "kpi",
    visualizations: [],
    capabilities: {
      kinds: ["kpi"],
      visualizations: [],
      aggregation: ["average"],
      comparison: false,
      series: false,
      stacking: "rejected",
      zeroBaseline: "none",
      negativeValues: "supported",
      accessibility: true,
    },
  };
}

function renderer(
  overrides: Partial<RendererDefinition<HTMLElement>> = {},
): RendererDefinition<HTMLElement> {
  return {
    id: "test.renderer",
    version: "1.0.0",
    apiVersion: RENDERER_API_VERSION,
    kind: "chart",
    visualizations: ["line"],
    capabilities: {
      kinds: ["chart"],
      visualizations: ["line"],
      aggregation: ["average"],
      comparison: false,
      series: true,
      stacking: "rejected",
      zeroBaseline: "visible",
      negativeValues: "supported",
      accessibility: true,
    },
    validate: () => ({ ok: true, diagnostics: [] }),
    mount: () => ({ update: () => undefined, destroy: () => undefined }),
    ...overrides,
  };
}

describe("T07 renderer registry and lifecycle", () => {
  it("registers valid renderers and resolves by id or visualization", () => {
    const registry = createRendererRegistry([renderer()]);
    expect(registry.ok).toBe(true);
    if (!registry.ok) {
      return;
    }
    expect(registry.value.has("test.renderer")).toBe(true);
    expect(registry.value.get("test.renderer")?.version).toBe("1.0.0");
    expect(registry.value.resolve({ kind: "chart", visualization: "line" })?.id).toBe(
      "test.renderer",
    );
    expect(registry.value.resolve({ id: "test.renderer", kind: "chart" })?.id).toBe(
      "test.renderer",
    );
    expect(registry.value.list()).toHaveLength(1);
  });

  it("rejects duplicate IDs, duplicate visualizations and incompatible API versions", () => {
    const duplicateId = createRendererRegistry([renderer(), renderer()]);
    expect(duplicateId.ok).toBe(false);
    if (!duplicateId.ok) {
      expect(duplicateId.diagnostics[0]?.code).toBe("RENDERER_INVALID");
    }

    const duplicateVisualization = createRendererRegistry([
      renderer(),
      renderer({ id: "test.other" }),
    ]);
    expect(duplicateVisualization.ok).toBe(false);

    const incompatible = createRendererRegistry([
      renderer({ apiVersion: RENDERER_API_VERSION + 1 }),
    ]);
    expect(incompatible.ok).toBe(false);
    if (!incompatible.ok) {
      expect(incompatible.diagnostics[0]?.message).toContain("supports");
    }
  });

  it("rejects incoherent capability declarations and duplicate non-chart kinds", () => {
    const wrongKind = createRendererRegistry([
      renderer({
        capabilities: {
          ...renderer().capabilities,
          kinds: ["kpi"],
        },
      }),
    ]);
    expect(wrongKind.ok).toBe(false);

    const wrongVisualizations = createRendererRegistry([
      renderer({
        visualizations: ["line"],
        capabilities: {
          ...renderer().capabilities,
          visualizations: ["bar"],
        },
      }),
    ]);
    expect(wrongVisualizations.ok).toBe(false);

    const nonChartVisualizations = createRendererRegistry([kpiRenderer("kpi-a")]);
    expect(nonChartVisualizations.ok).toBe(true);
    const duplicateKpi = createRendererRegistry([kpiRenderer("kpi-a"), kpiRenderer("kpi-b")]);
    expect(duplicateKpi.ok).toBe(false);
    const duplicateKpiReversed = createRendererRegistry([
      kpiRenderer("kpi-b"),
      kpiRenderer("kpi-a"),
    ]);
    expect(duplicateKpiReversed.ok).toBe(false);

    const invalidPolicy = createRendererRegistry([
      renderer({
        capabilities: {
          ...renderer().capabilities,
          stacking: "sometimes" as never,
        },
      }),
    ]);
    expect(invalidPolicy.ok).toBe(false);
  });

  it("enforces declared capabilities before mount and update", () => {
    let validateCalls = 0;
    let mountCalls = 0;
    const guarded = renderer({
      validate: () => {
        validateCalls += 1;
        return { ok: true, diagnostics: [] };
      },
      mount: () => {
        mountCalls += 1;
        return { update: () => undefined, destroy: () => undefined };
      },
    });
    const guardedComparison = mountRenderer(
      guarded,
      input({ spec: { ...spec, comparison: true } }),
    );
    expect(guardedComparison.handle).toBeNull();
    expect(validateCalls).toBe(0);
    expect(mountCalls).toBe(0);

    const comparison = mountRenderer(renderer(), input({ spec: { ...spec, comparison: true } }));
    expect(comparison.handle).toBeNull();
    expect(comparison.diagnostics[0]?.code).toBe("RENDERER_INVALID");

    const wrongKind = mountRenderer(renderer(), input({ spec: kpiSpec }));
    expect(wrongKind.handle).toBeNull();
    expect(wrongKind.diagnostics[0]?.code).toBe("RENDERER_INVALID");

    const wrongVisualization = mountRenderer(
      renderer(),
      input({ spec: { ...spec, visualization: "bar" } }),
    );
    expect(wrongVisualization.handle).toBeNull();

    const noSeries = renderer({
      capabilities: { ...renderer().capabilities, series: false },
    });
    const seriesResult = mountRenderer(
      noSeries,
      input({
        spec: {
          ...spec,
          series: { fieldId: "series", label: "Series", type: "string" },
        },
      }),
    );
    expect(seriesResult.handle).toBeNull();

    const stacked = mountRenderer(renderer(), input({ spec: { ...spec, stacked: true } }));
    expect(stacked.handle).toBeNull();

    const aggregation = mountRenderer(renderer(), input({ spec: { ...spec, aggregation: "sum" } }));
    expect(aggregation.handle).toBeNull();

    const negative = renderer({
      capabilities: { ...renderer().capabilities, negativeValues: "rejected" },
    });
    const negativeResult = mountRenderer(
      negative,
      input({
        data: {
          ...emptyRendererData(),
          fields: [{ fieldId: "y", type: "number", role: "measure" }],
          rows: [{ y: -1 }],
          phase: "settled",
          empty: false,
        },
      }),
    );
    expect(negativeResult.handle).toBeNull();
    expect(negativeResult.diagnostics[0]?.code).toBe("RENDERER_DATA_INVALID");
  });

  it("enforces required stacking and negative policies for KPIs and grouped bars", () => {
    const required = renderer({
      capabilities: { ...renderer().capabilities, stacking: "required" },
    });
    expect(mountRenderer(required, input()).handle).toBeNull();
    expect(
      mountRenderer(required, input({ spec: { ...spec, stacked: true } })).handle,
    ).not.toBeNull();

    const kpiNegative = {
      ...kpiRenderer("kpi-negative"),
      capabilities: {
        ...kpiRenderer("kpi-negative").capabilities,
        negativeValues: "rejected" as const,
      },
    };
    const kpiResult = mountRenderer(
      kpiNegative,
      input({
        spec: kpiSpec,
        data: {
          ...emptyRendererData(),
          fields: [{ fieldId: "y", type: "number", role: "measure" }],
          rows: [{ y: -1 }],
          phase: "settled",
          empty: false,
        },
      }),
    );
    expect(kpiResult.handle).toBeNull();
    expect(kpiResult.diagnostics[0]?.code).toBe("RENDERER_DATA_INVALID");

    const groupedRenderer = renderer({
      visualizations: ["stacked-bar"],
      capabilities: {
        ...renderer().capabilities,
        visualizations: ["stacked-bar"],
        negativeValues: "rejected",
        stacking: "supported",
      },
    });
    const groupedSpec: RendererSpec = {
      ...spec,
      visualization: "stacked-bar",
      series: { fieldId: "series", label: "Series", type: "string" },
      stacked: false,
    };
    const grouped = mountRenderer(
      groupedRenderer,
      input({
        spec: groupedSpec,
        data: {
          ...emptyRendererData(),
          fields: [{ fieldId: "y", type: "number", role: "measure" }],
          rows: [{ y: -3 }, { y: 4 }],
          phase: "settled",
          empty: false,
        },
      }),
    );
    expect(grouped.handle).toBeNull();
    expect(grouped.diagnostics[0]?.code).toBe("RENDERER_DATA_INVALID");
  });

  it("rejects malformed definitions without invoking inherited functions", () => {
    for (const definition of [
      null,
      {},
      { ...renderer(), id: "__proto__" },
      { ...renderer(), id: "constructor" },
      { ...renderer(), kind: "constructor" as never },
      { ...renderer(), capabilities: undefined as never },
      { ...renderer(), visualizations: undefined as never },
    ]) {
      const result = createRendererRegistry([definition as never]);
      if (
        (definition as { id?: string } | null)?.id === "__proto__" ||
        (definition as { id?: string } | null)?.id === "constructor"
      ) {
        expect(result.ok).toBe(true);
        continue;
      }
      expect(result.ok).toBe(false);
    }
  });

  it("contains mount, update and destroy errors with stable diagnostics", () => {
    const mounted = mountRenderer(
      renderer({
        mount: () => {
          throw new Error("mount exploded");
        },
      }),
      input(),
    );
    expect(mounted.handle).toBeNull();
    expect(mounted.diagnostics[0]?.code).toBe("RENDERER_FAILED");

    const invalid = mountRenderer(
      renderer({
        validate: () => ({
          ok: false,
          diagnostics: [
            { code: "RENDERER_INCOMPATIBLE", path: "x", message: "bad", severity: "error" },
          ],
        }),
      }),
      input(),
    );
    expect(invalid.handle).toBeNull();
    expect(invalid.diagnostics[0]?.code).toBe("RENDERER_INCOMPATIBLE");

    let updates = 0;
    let destroys = 0;
    const definition = renderer({
      mount: () => ({
        update: () => {
          updates += 1;
          if (updates > 1) {
            throw new Error("update exploded");
          }
        },
        destroy: () => {
          destroys += 1;
        },
      }),
    });
    const result = mountRenderer(definition, input());
    expect(result.handle).not.toBeNull();
    if (result.handle === null) {
      return;
    }
    expect(updateRenderer(definition, result.handle, input())).toEqual([]);
    expect(updateRenderer(definition, result.handle, input())[0]?.code).toBe("RENDERER_FAILED");
    expect(destroyRenderer(definition, result.handle)).toEqual([]);
    expect(destroys).toBe(1);
  });

  it("exposes provider dataset descriptors to hosts without leaking runtime state", () => {
    const provider = unwrap(
      createLocalDatasetProvider({
        providerId: "renderer-contract",
        datasets: [{ descriptor: ASSESSMENT_DESCRIPTOR, rows: ASSESSMENT_ROWS }],
      }),
    );
    const runtime = createRuntime({ datasetProvider: provider });
    const space = unwrap(
      runtime.createSpace({
        document: createEmptyBoardDocument({
          id: "descriptor-space",
          title: "Descriptor",
          createdAt: 1,
        }),
      }),
    );
    expect(space.getDatasetDescriptor("assessment-results")?.fields.length).toBeGreaterThan(0);
    expect(space.getDatasetDescriptor("missing-dataset")).toBeUndefined();
    space.dispose();
    runtime.dispose();
    expect(space.getDatasetDescriptor("assessment-results")).toBeUndefined();
  });

  it("is own-entry-safe for prototype-name IDs and visualizations", () => {
    const registry = createRendererRegistry([renderer({ id: "constructor" })]);
    expect(registry.ok).toBe(true);
    if (!registry.ok) {
      return;
    }
    expect(registry.value.has("toString")).toBe(false);
    expect(registry.value.get("__proto__")).toBeUndefined();
    expect(registry.value.resolve({ kind: "chart", visualization: "constructor" as never })).toBe(
      undefined,
    );
    expect(registry.value.list().map((entry) => entry.id)).toEqual(["constructor"]);
  });
});
