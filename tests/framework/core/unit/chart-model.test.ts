import { describe, expect, it } from "vitest";
import {
  buildChartModel,
  buildChartRendererSpec,
  createIntlFormatterProvider,
  type ChartRendererSpec,
  type QueryResultField,
  type QueryResultRow,
  type RendererField,
} from "../../../../packages/core/src/index.js";

const formatters = createIntlFormatterProvider({ locale: "en", timezone: "UTC" });

const categoryField: RendererField = {
  fieldId: "category",
  label: "Category",
  type: "string",
  role: "dimension",
};
const measureField: RendererField = {
  fieldId: "value",
  label: "Value",
  type: "number",
  role: "measure",
  unit: { unit: "points" },
};
const seriesField: RendererField = {
  fieldId: "series",
  label: "Series",
  type: "string",
  role: "dimension",
};

const fields: readonly QueryResultField[] = [
  { fieldId: "category", type: "string", role: "dimension" },
  { fieldId: "value", type: "number", role: "measure", unit: { unit: "points" } },
  { fieldId: "series", type: "string", role: "dimension" },
  { fieldId: "x", type: "number", role: "measure" },
  { fieldId: "y", type: "number", role: "measure" },
];

function rows(...values: Array<Record<string, QueryResultRow[string]>>): readonly QueryResultRow[] {
  return values;
}

function spec(
  visualization: ChartRendererSpec["visualization"],
  overrides: Partial<Parameters<typeof buildChartRendererSpec>[0]> = {},
): ChartRendererSpec {
  const built = buildChartRendererSpec({
    id: "block-chart",
    visualization,
    x:
      visualization === "scatter"
        ? { fieldId: "x", label: "X", type: "number" }
        : visualization === "line" || visualization === "area"
          ? { ...categoryField, allowedValues: ["a", "b", "c"] }
          : categoryField,
    y: visualization === "scatter" ? { fieldId: "y", label: "Y", type: "number" } : measureField,
    ...(visualization === "stacked-bar" ? { series: seriesField } : {}),
    aggregation:
      visualization === "scatter"
        ? "none"
        : visualization === "line" || visualization === "area"
          ? "average"
          : "sum",
    ...overrides,
  });
  if (!built.ok) {
    throw new Error(JSON.stringify(built.diagnostics));
  }
  return built.value;
}

describe("T07 chart model", () => {
  it("keeps null as a gap, zero as a value and counts negatives", () => {
    const model = buildChartModel(
      spec("bar"),
      {
        fields,
        rows: rows(
          { category: "b", value: 0 },
          { category: "a", value: null },
          { category: "c", value: -5 },
        ),
      },
      formatters,
    );
    expect(model.empty).toBe(false);
    expect(model.nullCount).toBe(1);
    expect(model.zeroCount).toBe(1);
    expect(model.negativeCount).toBe(1);
    expect(model.domainMin).toBe(-5);
    expect(model.domainMax).toBe(0);
    expect(model.values[0]).toEqual([0, null, -5]);
    expect(model.diagnostics.some((entry) => entry.code === "RENDERER_DATA_INVALID")).toBe(false);
  });

  it("orders categories by data, declared, ascending and descending without reordering by default", () => {
    const data = {
      fields,
      rows: rows(
        { category: "b", value: 1 },
        { category: "a", value: 2 },
        { category: "c", value: 3 },
      ),
    };
    const dataOrder = buildChartModel(spec("bar"), data, formatters);
    expect(dataOrder.categories.map((entry) => entry.raw)).toEqual(["b", "a", "c"]);

    const ascending = buildChartModel(
      spec("bar", { categoryOrder: "ascending" }),
      data,
      formatters,
    );
    expect(ascending.categories.map((entry) => entry.raw)).toEqual(["a", "b", "c"]);

    const descending = buildChartModel(
      spec("bar", { categoryOrder: "descending" }),
      data,
      formatters,
    );
    expect(descending.categories.map((entry) => entry.raw)).toEqual(["c", "b", "a"]);

    const declared = buildChartModel(
      spec("bar", {
        categoryOrder: "declared",
        x: {
          ...categoryField,
          allowedValues: ["c", "a"],
        },
      }),
      data,
      formatters,
    );
    expect(declared.categories.map((entry) => entry.raw)).toEqual(["c", "a", "b"]);
  });

  it("puts missing categories last for every explicit order", () => {
    const data = {
      fields,
      rows: rows(
        { category: "b", value: 1 },
        { category: null, value: 2 },
        { category: "a", value: 3 },
      ),
    };
    for (const order of ["data", "ascending", "descending", "declared"] as const) {
      const model = buildChartModel(spec("bar", { categoryOrder: order }), data, formatters);
      expect(model.categories.at(-1)?.missing, order).toBe(true);
    }
    const model = buildChartModel(spec("bar"), data, formatters);
    expect(model.categories.at(-1)?.label).toBeNull();
  });

  it("aligns series values to the ordered category axis", () => {
    const model = buildChartModel(
      spec("bar", { series: seriesField, aggregation: "sum" }),
      {
        fields,
        rows: rows(
          { category: "a", series: "S2", value: 1 },
          { category: "b", series: "S2", value: 2 },
          { category: "a", series: "S1", value: 3 },
          { category: "b", series: "S1", value: null },
        ),
      },
      formatters,
    );
    expect(model.series.map((entry) => entry.label)).toEqual(["S2", "S1"]);
    expect(model.values).toEqual([
      [1, 2],
      [3, null],
    ]);
  });

  it("enforces a zero baseline for line, area and bar domains", () => {
    for (const visualization of ["line", "area", "bar"] as const) {
      const allPositive = buildChartModel(
        spec(visualization),
        {
          fields,
          rows: rows({ category: "a", value: 10 }, { category: "b", value: 20 }),
        },
        formatters,
      );
      expect(allPositive.domainMin, visualization).toBe(0);
      const allNegative = buildChartModel(
        spec(visualization),
        {
          fields,
          rows: rows({ category: "a", value: -10 }, { category: "b", value: -20 }),
        },
        formatters,
      );
      expect(allNegative.domainMax, visualization).toBe(0);
    }
  });

  it("uses cumulative stack totals for stacked domains", () => {
    const model = buildChartModel(
      spec("stacked-bar"),
      {
        fields,
        rows: rows(
          { category: "a", series: "S1", value: 3 },
          { category: "a", series: "S2", value: 4 },
        ),
      },
      formatters,
    );
    expect(model.valueMin).toBe(0);
    expect(model.valueMax).toBe(7);
    expect(model.domainMax).toBe(7);
  });

  it("rejects negatives in every stacked route but allows explicit grouped bars", () => {
    const stackedBar = buildChartModel(
      spec("bar", { stacked: true, series: seriesField }),
      {
        fields,
        rows: rows(
          { category: "a", series: "S1", value: 3 },
          { category: "a", series: "S2", value: -2 },
        ),
      },
      formatters,
    );
    expect(stackedBar.blocked).toBe(true);
    expect(stackedBar.diagnostics.some((entry) => entry.code === "RENDERER_DATA_INVALID")).toBe(
      true,
    );

    const grouped = buildChartModel(
      spec("stacked-bar", { stacked: false }),
      {
        fields,
        rows: rows(
          { category: "a", series: "S1", value: 3 },
          { category: "a", series: "S2", value: -2 },
        ),
      },
      formatters,
    );
    expect(grouped.blocked).toBe(false);
    expect(grouped.domainMin).toBe(-2);
    expect(grouped.domainMax).toBe(3);
  });

  it("excludes numeric-line rows without a finite X coordinate", () => {
    const model = buildChartModel(
      spec("line", {
        x: { fieldId: "x", label: "X", type: "number", ordered: true },
        categoryOrder: "ascending",
      }),
      {
        fields,
        rows: rows({ x: null, value: 10 }, { x: 2, value: 10 }, { x: "bad", value: 20 }),
      },
      formatters,
    );
    expect(model.pointCount).toBe(1);
    expect(model.nullCount).toBe(2);
    expect(model.categoryCount).toBe(1);
    expect(model.values).toEqual([[10]]);
    expect(
      model.diagnostics.filter((entry) => entry.code === "RENDERER_DATA_INVALID"),
    ).toHaveLength(1);
  });

  it("pads scatter axes instead of forcing a zero baseline", () => {
    const model = buildChartModel(
      spec("scatter"),
      {
        fields,
        rows: rows({ x: 10, y: 20 }, { x: 30, y: 40 }),
      },
      formatters,
    );
    expect(model.baseline).toBe("padded");
    expect(model.xDomainMin).toBeLessThan(10);
    expect(model.xDomainMax).toBeGreaterThan(30);
    expect(model.yDomainMin).toBeLessThan(20);
    expect(model.yDomainMax).toBeGreaterThan(40);
    expect(model.scatterPoints).toHaveLength(2);
  });

  it("excludes scatter points without both coordinates from counts and geometry", () => {
    const model = buildChartModel(
      spec("scatter"),
      {
        fields,
        rows: rows({ x: null, y: 10 }, { x: 20, y: 10 }, { x: "bad", y: 10 }),
      },
      formatters,
    );
    expect(model.pointCount).toBe(1);
    expect(model.nullCount).toBe(2);
    expect(model.scatterPoints).toHaveLength(1);
    expect(
      model.diagnostics.filter((entry) => entry.code === "RENDERER_DATA_INVALID"),
    ).toHaveLength(1);
  });

  it("marks empty data explicitly and never fabricates zero geometry", () => {
    const empty = buildChartModel(spec("bar"), { fields, rows: [] }, formatters);
    expect(empty.empty).toBe(true);
    expect(empty.values.flat()).toEqual([]);
    const allNull = buildChartModel(
      spec("bar"),
      {
        fields,
        rows: rows({ category: "a", value: null }),
      },
      formatters,
    );
    expect(allNull.empty).toBe(true);
    expect(allNull.nullCount).toBe(1);
  });

  it("blocks stacked bars and donuts with negative values", () => {
    const stacked = buildChartModel(
      spec("stacked-bar"),
      {
        fields,
        rows: rows(
          { category: "a", series: "S1", value: 5 },
          { category: "a", series: "S2", value: -1 },
        ),
      },
      formatters,
    );
    expect(stacked.blocked).toBe(true);
    expect(stacked.diagnostics.some((entry) => entry.severity === "error")).toBe(true);

    const donut = buildChartModel(
      spec("donut"),
      {
        fields,
        rows: rows({ category: "a", value: 5 }, { category: "b", value: -2 }),
      },
      formatters,
    );
    expect(donut.blocked).toBe(true);
  });

  it("marks a zero donut total as empty geometry while keeping zero values distinct", () => {
    const model = buildChartModel(
      spec("donut"),
      {
        fields,
        rows: rows({ category: "a", value: 0 }, { category: "b", value: 0 }),
      },
      formatters,
    );
    expect(model.zeroTotal).toBe(true);
    expect(model.empty).toBe(false);
    expect(model.zeroCount).toBe(2);
    expect(model.total).toBe(0);
  });
});
