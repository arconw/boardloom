import { describe, expect, it } from "vitest";
import {
  DEFAULT_RENDERER_COLORS,
  createEmptyBoardDocument,
  createIntlFormatterProvider,
  createMessageProvider,
  createRendererRegistry,
  describeBindingSlots,
  emptyRendererData,
  type BindingDefinition,
  type BlockDefinition,
  type BoardDocument,
  type BoardDocumentV1,
  type DatasetDescriptor,
  type QueryResultField,
  type QueryResultRow,
  type QueryState,
} from "../../../../packages/core/src/index.js";
import { formatValueParts } from "../../../../packages/core/src/index.js";
import type { BlockSurfaceEnvironment } from "../../../../packages/view-dom/src/block-registry.js";
import { createViewMessages } from "../../../../packages/view-dom/src/messages.js";
import {
  buildChartSpecForBlock,
  buildKpiSpecForBlock,
  buildTableSpecForBlock,
} from "../../../../packages/view-dom/src/renderer-adapter.js";
import { createMiniDocument } from "../support/mini-dom.js";
import { unwrap } from "../../core/support/assertions.js";

function binding(
  id: string,
  role: BindingDefinition["role"],
  fieldId: string,
  extra: Partial<BindingDefinition> = {},
): BindingDefinition {
  return { id, role, field: { datasetId: "dataset", fieldId }, ...extra };
}

function board(): BoardDocument {
  const base = createEmptyBoardDocument({ id: "adapter", title: "Adapter", createdAt: 1 });
  return {
    ...base,
    datasets: [
      {
        id: "dataset",
        fields: [
          { id: "label", type: "string", role: "dimension" },
          { id: "category", type: "string", role: "dimension" },
          { id: "series", type: "string", role: "dimension" },
          { id: "value", type: "number", role: "measure" },
          { id: "percent", type: "number", role: "measure", unit: "percent" },
          { id: "xnum", type: "number", role: "dimension" },
        ],
      },
    ],
    slices: [
      {
        id: "slice",
        datasetId: "dataset",
        fieldIds: ["label", "value", "percent", "xnum"],
      },
    ],
  } as unknown as BoardDocument;
}

const fields: readonly QueryResultField[] = [
  { fieldId: "label", type: "string", role: "dimension" },
  { fieldId: "category", type: "string", role: "dimension" },
  { fieldId: "series", type: "string", role: "dimension" },
  {
    fieldId: "value",
    type: "number",
    role: "measure",
    timezone: "UTC",
    unit: { unit: "percent", scale: 1, label: "%" },
  },
  {
    fieldId: "percent",
    type: "number",
    role: "measure",
    unit: { unit: "percent", scale: 1, label: "%" },
  },
  { fieldId: "xnum", type: "number", role: "dimension" },
];

const percentDescriptor: DatasetDescriptor = {
  id: "dataset",
  version: "1",
  timezone: "UTC",
  temporalRepresentation: "iso8601-offset",
  fields: [
    {
      id: "percent",
      key: "percent",
      type: "number",
      role: "measure",
      nullable: true,
      unit: { unit: "percent", scale: 1, label: "%" },
    },
    { id: "label", key: "label", type: "string", role: "dimension", nullable: false },
    { id: "value", key: "value", type: "number", role: "measure", nullable: true },
    { id: "xnum", key: "xnum", type: "number", role: "dimension", nullable: true },
  ],
  slices: [],
  capabilities: {
    grouping: true,
    aggregations: ["sum", "average"],
    filterOperators: ["equals"],
    timeWindow: false,
    timezoneConversion: false,
    local: true,
    pushdownFilters: false,
    serverPaging: false,
    realtime: false,
    comparison: false,
    maxResultSize: null,
  },
};

function environment(
  block: BlockDefinition,
  rows: readonly QueryResultRow[] = [{ label: "A", value: 12.34, xnum: 3 }],
  descriptor?: DatasetDescriptor,
): BlockSurfaceEnvironment {
  const doc = createMiniDocument();
  const provider = createMessageProvider({ locale: "en" });
  const messages = createViewMessages({ provider });
  const query: QueryState = {
    queryId: "q",
    datasetId: "dataset",
    datasetVersion: "1",
    queryKey: "key",
    generation: 1,
    phase: "settled",
    requestId: "request",
    requestToken: 1,
    fields,
    rows,
    counts: {
      returnedRows: rows.length,
      totalRows: rows.length,
      filteredRows: rows.length,
      nullCounts: {},
    },
    diagnostics: [],
    complete: true,
    startedAt: 0,
    settledAt: 1,
    updatedAt: 1,
  };
  return {
    document: board(),
    dom: doc as unknown as Document,
    block,
    query,
    queryError: null,
    queryPlan: null,
    contextSignature: "",
    filterState: { activeValues: [], crossFilters: [] },
    applyFilterValue: () => ({ ok: true, value: { activeValues: [], crossFilters: [] } }),
    resetFilterValue: () => ({ ok: true, value: { activeValues: [], crossFilters: [] } }),
    toggleCrossFilter: () => ({ ok: true, value: { activeValues: [], crossFilters: [] } }),
    clearCrossFilters: () => ({ ok: true, value: { activeValues: [], crossFilters: [] } }),
    messages,
    formatters: createIntlFormatterProvider({ locale: "en", timezone: "UTC" }),
    locale: "en" as const,
    timezone: "UTC",
    theme: { mode: "light" as const, colors: DEFAULT_RENDERER_COLORS.light },
    renderers: unwrap(createRendererRegistry()),
    getDatasetDescriptor: () => descriptor,
    createElement: <K extends keyof HTMLElementTagNameMap>(
      tag: K,
      className?: string,
    ): HTMLElementTagNameMap[K] => {
      const element = doc.createElement(tag) as unknown as HTMLElementTagNameMap[K];
      if (className !== undefined) {
        element.className = className;
      }
      return element;
    },
  };
}

describe("T07 renderer adapter metadata", () => {
  it("applies metric config format over binding and field defaults", () => {
    const block: BlockDefinition = {
      id: "metric",
      type: "metric",
      bindings: [
        binding("metric-value", "measure", "value", {
          axis: "y",
          aggregation: { type: "average" },
          format: { style: "decimal", precision: 3 },
        }),
      ],
      config: { format: { precision: 1, unit: "points" } },
    };
    const spec = buildKpiSpecForBlock(environment(block));
    expect(spec.ok).toBe(true);
    if (!spec.ok) {
      return;
    }
    expect(spec.value.y.format).toEqual({ style: "decimal", precision: 1 });
    expect(spec.value.y.unit).toEqual({ unit: "points" });

    const currency = buildKpiSpecForBlock(
      environment({
        ...block,
        config: { format: { style: "currency", currency: "USD", precision: 0 } },
      }),
    );
    expect(currency.ok).toBe(true);
    if (currency.ok) {
      expect(currency.value.y.format).toEqual({
        style: "currency",
        currency: "USD",
        precision: 0,
      });
    }

    const percent = buildKpiSpecForBlock(
      environment({ ...block, config: { format: { style: "percent", precision: 1 } } }),
    );
    expect(percent.ok).toBe(true);
    if (percent.ok) {
      expect(percent.value.y.format).toEqual({ style: "percent", precision: 1 });
    }
  });

  it("merges provider format defaults, binding overrides and explicit unit conflicts", () => {
    const descriptor: DatasetDescriptor = {
      id: "dataset",
      version: "1",
      timezone: "UTC",
      temporalRepresentation: "iso8601-offset",
      fields: [
        {
          id: "value",
          key: "value",
          type: "number",
          role: "measure",
          nullable: true,
          unit: { unit: "points" },
          format: { style: "currency", currency: "USD", precision: 0 },
        },
        { id: "label", key: "label", type: "string", role: "dimension", nullable: false },
        {
          id: "percent",
          key: "percent",
          type: "number",
          role: "measure",
          nullable: true,
          unit: { unit: "percent", scale: 1, label: "%" },
        },
        { id: "xnum", key: "xnum", type: "number", role: "dimension", nullable: true },
      ],
      slices: [],
      capabilities: {
        grouping: true,
        aggregations: ["sum", "average"],
        filterOperators: ["equals"],
        timeWindow: false,
        timezoneConversion: false,
        local: true,
        pushdownFilters: false,
        serverPaging: false,
        realtime: false,
        comparison: false,
        maxResultSize: null,
      },
    };
    const block: BlockDefinition = {
      id: "metric",
      type: "metric",
      bindings: [
        binding("metric-value", "measure", "value", {
          axis: "y",
          aggregation: { type: "average" },
        }),
      ],
      config: {},
    };
    const providerSpec = buildKpiSpecForBlock(environment(block, undefined, descriptor));
    expect(providerSpec.ok).toBe(true);
    if (providerSpec.ok) {
      expect(providerSpec.value.y.format).toEqual({
        style: "currency",
        currency: "USD",
        precision: 0,
      });
      expect(providerSpec.value.y.unit).toEqual({ unit: "points" });
    }

    const partial = buildKpiSpecForBlock(
      environment(
        {
          ...block,
          bindings: [
            binding("metric-value", "measure", "value", {
              axis: "y",
              aggregation: { type: "average" },
              format: { precision: 1 },
            }),
          ],
        },
        undefined,
        descriptor,
      ),
    );
    expect(partial.ok).toBe(true);
    if (partial.ok) {
      expect(partial.value.y.format).toEqual({
        style: "currency",
        currency: "USD",
        precision: 1,
      });
    }

    const conflictingUnit = buildKpiSpecForBlock(
      environment(
        {
          ...block,
          bindings: [
            binding("metric-value", "measure", "value", {
              axis: "y",
              aggregation: { type: "average" },
              format: { unit: "USD" },
            }),
          ],
        },
        undefined,
        descriptor,
      ),
    );
    expect(conflictingUnit.ok).toBe(false);
  });

  it("preserves provider unit scale and label when an override repeats the code", () => {
    const block: BlockDefinition = {
      id: "metric",
      type: "metric",
      bindings: [
        binding("metric-percent", "measure", "percent", {
          axis: "y",
          aggregation: { type: "average" },
          format: { unit: "percent" },
        }),
      ],
      config: {},
    };
    const spec = buildKpiSpecForBlock(environment(block, [{ percent: 74 }], percentDescriptor));
    expect(spec.ok).toBe(true);
    if (!spec.ok) {
      return;
    }
    expect(spec.value.y.unit).toEqual({ unit: "percent", scale: 1, label: "%" });
    expect(
      formatValueParts(
        74,
        spec.value.y,
        createIntlFormatterProvider({ locale: "en", timezone: "UTC" }),
      ).text,
    ).toBe("74%");

    const configSpec = buildKpiSpecForBlock(
      environment(
        {
          ...block,
          bindings: [
            binding("metric-percent", "measure", "percent", {
              axis: "y",
              aggregation: { type: "average" },
            }),
          ],
          config: { format: { unit: "percent" } },
        },
        [{ percent: 74 }],
        percentDescriptor,
      ),
    );
    expect(configSpec.ok).toBe(true);
    if (configSpec.ok) {
      expect(configSpec.value.y.unit).toEqual({
        unit: "percent",
        scale: 1,
        label: "%",
      });
    }
  });

  it("preserves unit descriptors for chart and table paths", () => {
    const chart = buildChartSpecForBlock(
      environment(
        {
          id: "percent-chart",
          type: "chart",
          bindings: [
            binding("x", "dimension", "label", { axis: "x" }),
            binding("y", "measure", "percent", {
              axis: "y",
              aggregation: { type: "sum" },
              format: { unit: "percent" },
            }),
          ],
          config: { visualization: "bar" },
        },
        undefined,
        percentDescriptor,
      ),
    );
    expect(chart.ok).toBe(true);
    if (chart.ok) {
      expect(chart.value.y.unit).toEqual({ unit: "percent", scale: 1, label: "%" });
      expect(
        formatValueParts(
          74,
          chart.value.y,
          createIntlFormatterProvider({ locale: "en", timezone: "UTC" }),
        ).text,
      ).toBe("74%");
    }

    const table = buildTableSpecForBlock(
      environment(
        {
          id: "percent-table",
          type: "table",
          bindings: [
            binding("percent", "measure", "percent", {
              aggregation: { type: "sum" },
              format: { unit: "percent" },
            }),
          ],
          config: { columns: ["percent"] },
        },
        undefined,
        percentDescriptor,
      ),
    );
    expect(table.ok).toBe(true);
    if (table.ok) {
      expect(table.value.columns[0]?.unit).toEqual({
        unit: "percent",
        scale: 1,
        label: "%",
      });
      const column = table.value.columns[0];
      if (column !== undefined) {
        expect(
          formatValueParts(
            74,
            column,
            createIntlFormatterProvider({ locale: "en", timezone: "UTC" }),
          ).text,
        ).toBe("74%");
      }
    }
  });

  it("applies binding format timezone over provider and field timezone", () => {
    const block: BlockDefinition = {
      id: "metric",
      type: "metric",
      bindings: [
        binding("metric-value", "measure", "value", {
          axis: "y",
          aggregation: { type: "average" },
          format: { timezone: "Asia/Tokyo" },
        }),
      ],
      config: {},
    };
    const spec = buildKpiSpecForBlock(environment(block));
    expect(spec.ok).toBe(true);
    if (spec.ok) {
      expect(spec.value.y.timezone).toBe("Asia/Tokyo");
    }
  });

  it("applies temporal binding styles to table columns", () => {
    const block: BlockDefinition = {
      id: "table",
      type: "table",
      bindings: [
        binding("timestamp", "dimension", "label", {
          format: { dateStyle: "short", timeStyle: "medium", timezone: "Asia/Tokyo" },
        }),
      ],
      config: { columns: ["timestamp"] },
    };
    const spec = buildTableSpecForBlock(environment(block));
    expect(spec.ok).toBe(true);
    if (spec.ok) {
      expect(spec.value.columns[0]?.format).toEqual({
        dateStyle: "short",
        timeStyle: "medium",
      });
      expect(spec.value.columns[0]?.timezone).toBe("Asia/Tokyo");
    }
  });

  it("selects and orders table columns from validated config", () => {
    const block: BlockDefinition = {
      id: "table",
      type: "table",
      bindings: [
        binding("a", "dimension", "label"),
        binding("b", "measure", "value", { aggregation: { type: "sum" } }),
      ],
      config: { columns: ["b", "a"] },
    };
    const spec = buildTableSpecForBlock(environment(block));
    expect(spec.ok).toBe(true);
    if (!spec.ok) {
      return;
    }
    expect(spec.value.columns.map((column) => column.fieldId)).toEqual(["b", "label"]);

    const unknown = buildTableSpecForBlock(
      environment({ ...block, config: { columns: ["missing"] } }),
    );
    expect(unknown.ok).toBe(false);
    const duplicate = buildTableSpecForBlock(
      environment({ ...block, config: { columns: ["a", "a"] } }),
    );
    expect(duplicate.ok).toBe(false);
  });

  it("passes binned and explicitly ordered numeric X declarations to the matrix", () => {
    const binned = buildChartSpecForBlock(
      environment({
        id: "bar",
        type: "chart",
        bindings: [
          binding("x", "dimension", "xnum", { axis: "x" }),
          binding("y", "measure", "value", {
            axis: "y",
            aggregation: { type: "sum" },
          }),
        ],
        config: { visualization: "bar", options: { binnedX: true } },
      }),
    );
    expect(binned.ok).toBe(true);
    if (binned.ok) {
      expect(binned.value.x.binned).toBe(true);
    }

    const ordered = buildChartSpecForBlock(
      environment({
        id: "line",
        type: "chart",
        bindings: [
          binding("x", "dimension", "xnum", { axis: "x" }),
          binding("y", "measure", "value", {
            axis: "y",
            aggregation: { type: "average" },
          }),
        ],
        config: { visualization: "line", options: { categoryOrder: "ascending" } },
      }),
    );
    expect(ordered.ok).toBe(true);
    if (ordered.ok) {
      expect(ordered.value.x.ordered).toBe(true);
      expect(ordered.value.categoryOrder).toBe("ascending");
    }
  });

  it("fills missing values rather than treating them as zero", () => {
    const block: BlockDefinition = {
      id: "metric",
      type: "metric",
      bindings: [
        binding("metric-value", "measure", "value", {
          axis: "y",
          aggregation: { type: "average" },
        }),
      ],
      config: {},
    };
    const env = environment(block, [{ label: "A", value: null, xnum: 1 }]);
    expect(env.query?.rows[0]).toBeDefined();
    expect(emptyRendererData().rows).toEqual([]);
  });

  it("resolves explicit X and series with the document-validation precedence", () => {
    const reordered = buildChartSpecForBlock(
      environment(
        {
          id: "reordered-chart",
          type: "chart",
          bindings: [
            binding("series", "dimension", "category"),
            binding("x", "dimension", "label", { axis: "x" }),
            binding("y", "measure", "value", {
              axis: "y",
              aggregation: { type: "sum" },
            }),
          ],
          config: { visualization: "bar" },
        },
        [{ label: "A", category: "one", value: 2 }],
      ),
    );
    expect(reordered.ok).toBe(true);
    if (reordered.ok) {
      expect(reordered.value.x.fieldId).toBe("label");
      expect(reordered.value.series?.fieldId).toBe("category");
    }

    const labelled = buildChartSpecForBlock(
      environment(
        {
          id: "labelled-chart",
          type: "chart",
          bindings: [
            binding("label", "label", "category"),
            binding("x", "dimension", "label", { axis: "x" }),
            binding("y", "measure", "value", {
              axis: "y",
              aggregation: { type: "sum" },
            }),
            binding("series", "series", "series"),
          ],
          config: { visualization: "bar" },
        },
        [{ label: "A", category: "one", series: "group-a", value: 2 }],
      ),
    );
    expect(labelled.ok).toBe(true);
    if (labelled.ok) {
      expect(labelled.value.x.fieldId).toBe("label");
      expect(labelled.value.series?.fieldId).toBe("series");
    }

    const scatter = buildChartSpecForBlock(
      environment(
        {
          id: "implicit-scatter",
          type: "chart",
          bindings: [binding("first", "measure", "value"), binding("second", "measure", "percent")],
          config: { visualization: "scatter" },
        },
        [{ value: 1, percent: 2 }],
        percentDescriptor,
      ),
    );
    expect(scatter.ok).toBe(true);
    if (scatter.ok) {
      expect(scatter.value.x.fieldId).toBe("value");
      expect(scatter.value.y.fieldId).toBe("percent");
    }
  });

  it("matches the inspector slot descriptors for a label-bearing chart with a series", () => {
    const block: BlockDefinition = {
      id: "agreement-chart",
      type: "chart",
      bindings: [
        binding("label", "label", "category"),
        binding("x", "dimension", "label", { axis: "x" }),
        binding("y", "measure", "value", {
          axis: "y",
          aggregation: { type: "sum" },
        }),
        binding("series", "series", "series"),
      ],
      config: { visualization: "bar" },
    };
    const document = { ...board(), blocks: [block] } as unknown as BoardDocumentV1;
    const described = describeBindingSlots(document, block.id);
    expect(described.ok).toBe(true);
    const spec = buildChartSpecForBlock(
      environment(block, [{ label: "A", category: "one", series: "group-a", value: 2 }]),
    );
    expect(spec.ok).toBe(true);
    if (!described.ok || !spec.ok) {
      return;
    }
    const slot = (name: "x" | "y" | "series") =>
      described.value.find((entry) => entry.slot === name);
    expect(slot("x")?.selectedField?.fieldId).toBe(spec.value.x.fieldId);
    expect(slot("y")?.bindingId).toBe(spec.value.y.fieldId);
    expect(slot("series")?.selectedField?.fieldId).toBe(spec.value.series?.fieldId);
    expect(slot("series")?.selectedField?.fieldId).toBe("series");
  });
});
