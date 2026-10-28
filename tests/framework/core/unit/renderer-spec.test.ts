import { describe, expect, it } from "vitest";
import {
  buildChartRendererSpec,
  validateChartRendererSpec,
  type ChartRendererSpec,
  type RendererField,
} from "../../../../packages/core/src/index.js";

const category: RendererField = {
  fieldId: "category",
  label: "Category",
  type: "string",
  role: "dimension",
};
const numeric: RendererField = {
  fieldId: "number",
  label: "Number",
  type: "number",
  role: "measure",
};
const measure: RendererField = {
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

function chart(
  overrides: Partial<Parameters<typeof buildChartRendererSpec>[0]> = {},
): ReturnType<typeof buildChartRendererSpec> {
  return buildChartRendererSpec({
    id: "block",
    visualization: "bar",
    x: category,
    y: measure,
    aggregation: "sum",
    ...overrides,
  });
}

describe("T07 renderer spec construction", () => {
  it("guards unknown and prototype-name visualizations without throwing", () => {
    for (const visualization of ["constructor", "__proto__", "toString", "nope"]) {
      const built = chart({ visualization: visualization as never });
      expect(built.ok).toBe(false);
      if (!built.ok) {
        expect(built.diagnostics[0]?.code).toBe("RENDERER_INCOMPATIBLE");
      }
    }
    const base = chart();
    expect(base.ok).toBe(true);
    if (!base.ok) {
      return;
    }
    for (const visualization of ["constructor", "__proto__", "toString", "nope"]) {
      const validation = validateChartRendererSpec({
        ...base.value,
        visualization: visualization as never,
      });
      expect(validation.ok).toBe(false);
      expect(validation.diagnostics[0]?.code).toBe("RENDERER_INCOMPATIBLE");
    }
  });

  it("requires explicit ordering for numeric line X and binning for numeric bar X", () => {
    const unorderedLine = chart({
      visualization: "line",
      x: numeric,
      y: measure,
      aggregation: "average",
    });
    expect(unorderedLine.ok).toBe(false);

    const orderedLine = chart({
      visualization: "line",
      x: { ...numeric, ordered: true },
      y: measure,
      aggregation: "average",
      categoryOrder: "ascending",
    });
    expect(orderedLine.ok).toBe(true);

    const unbinnedBar = chart({ x: numeric });
    expect(unbinnedBar.ok).toBe(false);

    const binnedBar = chart({
      x: { ...numeric, binned: true },
      categoryOrder: "data",
    });
    expect(binnedBar.ok).toBe(true);
  });

  it("requires a declared date bucket for temporal bar axes", () => {
    const temporal: RendererField = {
      fieldId: "month",
      label: "Month",
      type: "date",
      role: "dimension",
    };
    expect(
      chart({
        visualization: "bar",
        x: temporal,
        y: measure,
        aggregation: "sum",
      }).ok,
    ).toBe(false);
    expect(
      chart({
        visualization: "bar",
        x: { ...temporal, bucket: { grain: "month" } },
        y: measure,
        aggregation: "sum",
      }).ok,
    ).toBe(true);
  });

  it("rejects unsupported stacking instead of normalizing it away", () => {
    const line = chart({
      visualization: "line",
      x: category,
      y: measure,
      aggregation: "average",
      stacked: true,
    });
    expect(line.ok).toBe(false);
    const scatter = chart({
      visualization: "scatter",
      x: numeric,
      y: measure,
      aggregation: "none",
      stacked: true,
    });
    expect(scatter.ok).toBe(false);
  });

  it("honors valid axis bounds and rejects unsupported axis configuration", () => {
    const valid = chart({
      visualization: "scatter",
      x: { ...numeric, unit: { unit: "seconds" } },
      y: { ...measure, unit: { unit: "USD" } },
      aggregation: "none",
      xAxis: { min: 0, max: 100, unit: "seconds" },
      yAxis: { min: 10, max: 100, unit: "USD" },
    });
    expect(valid.ok).toBe(true);
    if (!valid.ok) {
      return;
    }
    const optionSpec: ChartRendererSpec = valid.value;
    expect(optionSpec.xAxis).toEqual({ min: 0, max: 100, unit: "seconds" });
    expect(optionSpec.yAxis).toEqual({ min: 10, max: 100, unit: "USD" });

    expect(chart({ xAxis: { min: 0, max: 10 } }).ok).toBe(false);
    expect(
      chart({
        visualization: "scatter",
        x: numeric,
        y: measure,
        aggregation: "none",
        yAxis: { unit: "USD" },
      }).ok,
    ).toBe(false);
    expect(chart({ yAxis: { min: 1 } }).ok).toBe(false);
  });

  it("treats stacked-bar without explicit disable as stacked and requires a series", () => {
    const stacked = chart({
      visualization: "stacked-bar",
      x: category,
      y: measure,
      series,
      aggregation: "sum",
    });
    expect(stacked.ok).toBe(true);
    if (stacked.ok) {
      expect(stacked.value.stacked).toBe(true);
    }
    const missingSeries = chart({
      visualization: "stacked-bar",
      x: category,
      y: measure,
      aggregation: "sum",
    });
    expect(missingSeries.ok).toBe(false);
  });
});
