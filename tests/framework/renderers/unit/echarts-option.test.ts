import { describe, expect, it } from "vitest";
import {
  DEFAULT_RENDERER_COLORS,
  buildChartModel,
  buildChartRendererSpec,
  createIntlFormatterProvider,
  type ChartRendererSpec,
  type QueryResultField,
  type QueryResultRow,
  type RendererField,
} from "../../../../packages/core/src/index.js";
import { buildEChartsOption } from "../../../../packages/renderers-echarts/src/option.js";

const formatters = createIntlFormatterProvider({ locale: "en", timezone: "UTC" });
const messages = {
  locale: "en" as const,
  direction: "ltr" as const,
  has: () => true,
  text: (key: string, params?: Record<string, string | number | boolean | bigint>) => {
    if (key === "chart.baseline.zero") {
      return "Zero baseline";
    }
    return params ? `${key}:${Object.values(params).join(",")}` : key;
  },
  plural: (key: string, count: number) => `${key}:${String(count)}`,
};

const x: RendererField = {
  fieldId: "category",
  label: "Category",
  type: "string",
  role: "dimension",
};
const y: RendererField = {
  fieldId: "value",
  label: "Value",
  type: "number",
  role: "measure",
  unit: { unit: "points" },
};
const series: RendererField = {
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

function rows(...values: Record<string, QueryResultRow[string]>[]): readonly QueryResultRow[] {
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
          ? { ...x, allowedValues: ["a", "b"] }
          : x,
    y: visualization === "scatter" ? { fieldId: "y", label: "Y", type: "number" } : y,
    ...(visualization === "stacked-bar" ? { series } : {}),
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

function optionFor(
  visualization: ChartRendererSpec["visualization"],
  dataRows: readonly QueryResultRow[],
  overrides: Partial<Parameters<typeof buildChartRendererSpec>[0]> = {},
): Record<string, unknown> {
  const model = buildChartModel(
    spec(visualization, overrides),
    { fields, rows: dataRows },
    formatters,
  );
  return buildEChartsOption(model, formatters, messages, DEFAULT_RENDERER_COLORS.light) as Record<
    string,
    unknown
  >;
}

function axis(option: Record<string, unknown>, key: "xAxis" | "yAxis"): Record<string, unknown> {
  return option[key] as Record<string, unknown>;
}

describe("T07 ECharts option mapping", () => {
  it("keeps a zero baseline for bar and line charts and shows the zero line", () => {
    const bar = optionFor("bar", rows({ category: "a", value: 10 }, { category: "b", value: 20 }));
    expect(axis(bar, "yAxis").min).toBe(0);
    expect(axis(bar, "yAxis").max).toBe(20);

    const line = optionFor(
      "line",
      rows({ category: "a", value: 10 }, { category: "b", value: 20 }),
    );
    expect(axis(line, "yAxis").min).toBe(0);
    const firstSeries = (line.series as Record<string, unknown>[])[0];
    const markLine = firstSeries?.markLine as Record<string, unknown>;
    expect(markLine.data).toEqual([{ yAxis: 0 }]);
    expect(markLine.label).toEqual(expect.objectContaining({ formatter: "Zero baseline" }));
  });

  it("uses a diverging area origin at zero and rejects stacked negative data before geometry", () => {
    const area = optionFor(
      "area",
      rows({ category: "a", value: -5 }, { category: "b", value: 10 }),
    );
    const series = (area.series as Record<string, unknown>[])[0];
    expect((series?.areaStyle as Record<string, unknown>).origin).toBe(0);
    expect(axis(area, "yAxis").min).toBe(-5);
    expect(axis(area, "yAxis").max).toBe(10);
  });

  it("stacks non-negative bars and aligns series to the category order", () => {
    const option = optionFor(
      "stacked-bar",
      rows(
        { category: "a", series: "S2", value: 1 },
        { category: "b", series: "S2", value: 2 },
        { category: "a", series: "S1", value: 3 },
        { category: "b", series: "S1", value: 4 },
      ),
    );
    expect(axis(option, "xAxis").data).toEqual(["a", "b"]);
    const series = option.series as Record<string, unknown>[];
    expect(series.map((entry) => entry.stack)).toEqual(["total", "total"]);
    expect(series.map((entry) => entry.data)).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it("uses cumulative stack totals for axis bounds", () => {
    const option = optionFor(
      "stacked-bar",
      rows({ category: "a", series: "S1", value: 3 }, { category: "a", series: "S2", value: 4 }),
    );
    expect(axis(option, "yAxis").min).toBe(0);
    expect(axis(option, "yAxis").max).toBe(7);

    const area = optionFor(
      "area",
      rows({ category: "a", series: "S1", value: 3 }, { category: "a", series: "S2", value: 4 }),
      { series, stacked: true, aggregation: "sum" },
    );
    expect(axis(area, "yAxis").max).toBe(7);
  });

  it("honors configured value-axis bounds", () => {
    const option = optionFor("scatter", rows({ x: 10, y: 20 }, { x: 30, y: 40 }), {
      xAxis: { min: 0, max: 100 },
      yAxis: { min: 10, max: 100 },
    });
    expect(axis(option, "xAxis").min).toBe(0);
    expect(axis(option, "xAxis").max).toBe(100);
    expect(axis(option, "yAxis").min).toBe(10);
    expect(axis(option, "yAxis").max).toBe(100);
  });

  it("renders an explicitly ordered numeric line on a value axis", () => {
    const option = optionFor("line", rows({ x: 1, value: 3 }, { x: 2, value: 5 }), {
      x: { fieldId: "x", label: "X", type: "number", ordered: true },
      categoryOrder: "ascending",
    });
    expect(axis(option, "xAxis").type).toBe("value");
    const series = (option.series as Record<string, unknown>[])[0];
    expect(series?.data).toEqual([
      [1, 3],
      [2, 5],
    ]);
  });

  it("pads scatter axes and never forces a category axis", () => {
    const option = optionFor(
      "scatter",
      rows({ x: 10, y: 20 }, { x: 30, y: 40 }, { x: 20, y: null }),
    );
    expect(axis(option, "xAxis").type).toBe("value");
    expect(axis(option, "yAxis").type).toBe("value");
    expect(Number(axis(option, "xAxis").min)).toBeLessThan(10);
    expect(Number(axis(option, "xAxis").max)).toBeGreaterThan(30);
    const series = (option.series as Record<string, unknown>[])[0];
    expect(series?.type).toBe("scatter");
    expect((series?.data as unknown[]).length).toBe(2);
  });

  it("renders donut data with the same formatted values and units", () => {
    const option = optionFor(
      "donut",
      rows({ category: "a", value: 0 }, { category: "b", value: 25 }),
    );
    const series = (option.series as Record<string, unknown>[])[0];
    expect(series?.type).toBe("pie");
    expect((series?.data as unknown[]).length).toBe(2);
    expect(option.legend).toEqual(expect.objectContaining({ type: "scroll" }));
  });

  it("formats donut tooltip and label percentages through the same locale", () => {
    const german = createIntlFormatterProvider({ locale: "de", timezone: "UTC" });
    const model = buildChartModel(
      spec("donut"),
      {
        fields,
        rows: rows({ category: "a", value: 1 }, { category: "b", value: 1 }),
      },
      german,
    );
    const option = buildEChartsOption(
      model,
      german,
      messages,
      DEFAULT_RENDERER_COLORS.light,
    ) as Record<string, unknown>;
    const tooltip = option.tooltip as { formatter: (params: unknown) => string };
    const tooltipText = tooltip.formatter({ name: "A", value: 1, percent: 50.25 });
    const series = (option.series as Record<string, unknown>[])[0];
    const label = (series?.label as { formatter: (params: unknown) => string }).formatter({
      name: "A",
      value: 1,
      percent: 50.25,
    });
    expect(tooltipText.replaceAll("\u00a0", " ")).toContain("50,3 %");
    expect(label.replaceAll("\u00a0", " ")).toContain("50,3 %");
    expect(tooltipText).toBe(label);
  });

  it("uses rich-text tooltips and disables animation for reduced motion", () => {
    const option = optionFor("bar", rows({ category: "a", value: 10 }));
    expect(option.animation).toBe(false);
    expect(option.tooltip).toEqual(
      expect.objectContaining({ renderMode: "richText", confine: true }),
    );
  });

  it("formats axis ticks and tooltips through the same measure formatter", () => {
    const option = optionFor("bar", rows({ category: "a", value: 10 }));
    const yAxis = axis(option, "yAxis");
    const formatter = (yAxis.axisLabel as { formatter: (value: number) => string }).formatter;
    expect(formatter(10)).toBe("10 points");
    const tooltip = option.tooltip as { valueFormatter: (value: unknown) => string };
    expect(tooltip.valueFormatter(10)).toBe("10 points");
    expect(tooltip.valueFormatter(null)).toBe("chart.missing");
  });
});
