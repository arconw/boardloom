import { describe, expect, it } from "vitest";
import {
  createEmptyBoardDocument,
  validateBoardDocument,
  type BindingDefinition,
  type FieldDescriptor,
} from "../../../../packages/core/src/index.js";

const fields: readonly FieldDescriptor[] = [
  { id: "category", type: "string", role: "dimension" },
  { id: "series", type: "string", role: "dimension" },
  { id: "value", type: "number", role: "measure", unit: "points" },
  { id: "xnum", type: "number", role: "measure" },
  { id: "ynum", type: "number", role: "measure" },
];

const numericDimensionFields: readonly FieldDescriptor[] = [
  ...fields,
  { id: "xnum", type: "number", role: "dimension" },
];

function binding(
  id: string,
  role: BindingDefinition["role"],
  fieldId: string,
  extra: Partial<BindingDefinition> = {},
): BindingDefinition {
  return {
    id,
    role,
    field: { datasetId: "dataset", fieldId },
    ...extra,
  };
}

function documentWith(
  block: {
    readonly type: string;
    readonly bindings: readonly BindingDefinition[];
    readonly config: Record<string, unknown>;
  },
  documentFields: readonly FieldDescriptor[] = fields,
): unknown {
  const base = createEmptyBoardDocument({ id: "matrix-board", title: "Matrix", createdAt: 1 });
  return {
    ...base,
    datasets: [{ id: "dataset", fields: documentFields }],
    slices: [
      {
        id: "slice",
        datasetId: "dataset",
        fieldIds: documentFields.map((field) => field.id),
      },
    ],
    blocks: [{ id: "block", type: block.type, bindings: block.bindings, config: block.config }],
    layout: {
      desktop: {
        columns: 12,
        rowHeight: 8,
        placements: [{ blockId: "block", x: 0, y: 0, width: 12, height: 4 }],
      },
    },
  };
}

function errorCodes(document: unknown): string[] {
  const result = validateBoardDocument(document);
  return result.diagnostics
    .filter((diagnostic) => diagnostic.severity === "error")
    .map((diagnostic) => diagnostic.code);
}

describe("T07 field matrix enforcement in document validation", () => {
  it("accepts valid built-in matrix combinations", () => {
    const bar = documentWith({
      type: "chart",
      bindings: [
        binding("x", "dimension", "category", { axis: "x" }),
        binding("y", "measure", "value", {
          axis: "y",
          aggregation: { type: "sum" },
        }),
      ],
      config: { visualization: "bar" },
    });
    expect(errorCodes(bar)).not.toContain("RENDERER_INCOMPATIBLE");

    const stacked = documentWith({
      type: "chart",
      bindings: [
        binding("x", "dimension", "category", { axis: "x" }),
        binding("y", "measure", "value", {
          axis: "y",
          aggregation: { type: "sum" },
        }),
        binding("series", "series", "series"),
      ],
      config: { visualization: "stacked-bar", options: { stacked: true } },
    });
    expect(errorCodes(stacked)).not.toContain("RENDERER_INCOMPATIBLE");

    const orderedArea = documentWith(
      {
        type: "chart",
        bindings: [
          binding("x", "dimension", "category", { axis: "x" }),
          binding("y", "measure", "value", {
            axis: "y",
            aggregation: { type: "average" },
          }),
        ],
        config: { visualization: "area" },
      },
      fields.map((field) =>
        field.id === "category" ? { ...field, allowedValues: ["low", "medium", "high"] } : field,
      ),
    );
    expect(errorCodes(orderedArea)).not.toContain("RENDERER_INCOMPATIBLE");

    const scatter = documentWith({
      type: "chart",
      bindings: [
        binding("x", "measure", "xnum", { axis: "x" }),
        binding("y", "measure", "ynum", { axis: "y" }),
      ],
      config: { visualization: "scatter" },
    });
    expect(errorCodes(scatter)).not.toContain("RENDERER_INCOMPATIBLE");
  });

  it("requires a date bucket for temporal bar axes", () => {
    const temporalFields: readonly FieldDescriptor[] = [
      ...fields,
      { id: "month", type: "date", role: "dimension", timezone: "UTC" },
    ];
    const bindings = [
      binding("x", "dimension", "month", { axis: "x" }),
      binding("y", "measure", "value", { axis: "y", aggregation: { type: "sum" } }),
    ];
    expect(
      errorCodes(
        documentWith({ type: "chart", bindings, config: { visualization: "bar" } }, temporalFields),
      ),
    ).toContain("RENDERER_INCOMPATIBLE");
    const bucketed = [
      binding("x", "dimension", "month", {
        axis: "x",
        bucket: { grain: "month", timezone: "UTC" },
      }),
      binding("y", "measure", "value", { axis: "y", aggregation: { type: "sum" } }),
    ];
    expect(
      errorCodes(
        documentWith(
          { type: "chart", bindings: bucketed, config: { visualization: "bar" } },
          temporalFields,
        ),
      ),
    ).not.toContain("RENDERER_INCOMPATIBLE");
  });

  it("accepts a KPI measure with a permitted label binding", () => {
    const metric = documentWith({
      type: "metric",
      bindings: [
        binding("y", "measure", "value", { axis: "y", aggregation: { type: "average" } }),
        binding("label", "label", "category"),
      ],
      config: {},
    });
    expect(errorCodes(metric)).not.toContain("RENDERER_INCOMPATIBLE");
  });

  it("requires explicit binning for numeric bar X and ordering for numeric line X", () => {
    const lineBindings = [
      binding("x", "dimension", "xnum", { axis: "x" }),
      binding("y", "measure", "value", { axis: "y", aggregation: { type: "average" } }),
    ];
    expect(
      errorCodes(
        documentWith(
          { type: "chart", bindings: lineBindings, config: { visualization: "line" } },
          numericDimensionFields,
        ),
      ),
    ).toContain("RENDERER_INCOMPATIBLE");
    expect(
      errorCodes(
        documentWith(
          {
            type: "chart",
            bindings: lineBindings,
            config: { visualization: "line", options: { categoryOrder: "ascending" } },
          },
          numericDimensionFields,
        ),
      ),
    ).not.toContain("RENDERER_INCOMPATIBLE");

    const barBindings = [
      binding("x", "dimension", "xnum", { axis: "x" }),
      binding("y", "measure", "value", { axis: "y", aggregation: { type: "sum" } }),
    ];
    expect(
      errorCodes(
        documentWith(
          { type: "chart", bindings: barBindings, config: { visualization: "bar" } },
          numericDimensionFields,
        ),
      ),
    ).toContain("RENDERER_INCOMPATIBLE");
    expect(
      errorCodes(
        documentWith(
          {
            type: "chart",
            bindings: barBindings,
            config: { visualization: "bar", options: { binnedX: true } },
          },
          numericDimensionFields,
        ),
      ),
    ).not.toContain("RENDERER_INCOMPATIBLE");
  });

  it("rejects illegal chart, stacked, donut, scatter and KPI combinations", () => {
    const cases: Array<[string, unknown]> = [
      [
        "bar with text measure",
        documentWith({
          type: "chart",
          bindings: [
            binding("x", "dimension", "category", { axis: "x" }),
            binding("y", "dimension", "series", {
              axis: "y",
              aggregation: { type: "sum" },
            }),
          ],
          config: { visualization: "bar" },
        }),
      ],
      [
        "stacked without series",
        documentWith({
          type: "chart",
          bindings: [
            binding("x", "dimension", "category", { axis: "x" }),
            binding("y", "measure", "value", {
              axis: "y",
              aggregation: { type: "sum" },
            }),
          ],
          config: { visualization: "stacked-bar", options: { stacked: true } },
        }),
      ],
      [
        "donut with series",
        documentWith({
          type: "chart",
          bindings: [
            binding("x", "dimension", "category", { axis: "x" }),
            binding("y", "measure", "value", {
              axis: "y",
              aggregation: { type: "sum" },
            }),
            binding("series", "series", "series"),
          ],
          config: { visualization: "donut" },
        }),
      ],
      [
        "scatter aggregated",
        documentWith({
          type: "chart",
          bindings: [
            binding("x", "measure", "xnum", { axis: "x", aggregation: { type: "sum" } }),
            binding("y", "measure", "ynum", { axis: "y", aggregation: { type: "sum" } }),
          ],
          config: { visualization: "scatter" },
        }),
      ],
      [
        "kpi undeclared aggregation",
        documentWith({
          type: "metric",
          bindings: [binding("y", "measure", "value", { axis: "y" })],
          config: {},
        }),
      ],
      [
        "bar median",
        documentWith({
          type: "chart",
          bindings: [
            binding("x", "dimension", "category", { axis: "x" }),
            binding("y", "measure", "value", {
              axis: "y",
              aggregation: { type: "median" },
            }),
          ],
          config: { visualization: "bar" },
        }),
      ],
    ];
    for (const [label, document] of cases) {
      const codes = errorCodes(document);
      expect(
        codes.includes("RENDERER_INCOMPATIBLE") || codes.includes("INCOMPATIBLE_BINDING"),
        label,
      ).toBe(true);
    }
  });

  it("rejects category-axis bounds, unit overrides and zero-baseline violations", () => {
    const baseBindings = [
      binding("x", "dimension", "category", { axis: "x" }),
      binding("y", "measure", "value", { axis: "y", aggregation: { type: "sum" } }),
    ];
    expect(
      errorCodes(
        documentWith({
          type: "chart",
          bindings: baseBindings,
          config: {
            visualization: "bar",
            options: { xAxis: { min: 0, max: 10 } },
          },
        }),
      ),
    ).toContain("INCOMPATIBLE_BINDING");
    expect(
      errorCodes(
        documentWith({
          type: "chart",
          bindings: baseBindings,
          config: {
            visualization: "bar",
            options: { yAxis: { unit: "USD" } },
          },
        }),
      ),
    ).toContain("INCOMPATIBLE_BINDING");
    expect(
      errorCodes(
        documentWith({
          type: "chart",
          bindings: baseBindings,
          config: {
            visualization: "bar",
            options: { yAxis: { min: 5 } },
          },
        }),
      ),
    ).toContain("INCOMPATIBLE_BINDING");
  });

  it("rejects an invalid category order value", () => {
    const codes = errorCodes(
      documentWith({
        type: "chart",
        bindings: [
          binding("x", "dimension", "category", { axis: "x" }),
          binding("y", "measure", "value", { axis: "y", aggregation: { type: "sum" } }),
        ],
        config: { visualization: "bar", options: { categoryOrder: "sideways" } },
      }),
    );
    expect(codes).toContain("INVALID_PROPERTY_TYPE");
  });
});
