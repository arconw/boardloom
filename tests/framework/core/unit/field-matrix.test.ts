import { describe, expect, it } from "vitest";
import {
  VISUALIZATION_MATRIX,
  classifyField,
  describeVisualizationMatrix,
  isCategoryOrder,
  isVisualizationKind,
  validateVisualizationMatrix,
} from "../../../../packages/core/src/index.js";

const temporal = { type: "date" as const, role: "dimension" as const };
const categorical = { type: "string" as const, role: "dimension" as const };
const orderedCategorical = {
  type: "string" as const,
  role: "dimension" as const,
  allowedValues: ["low", "medium", "high"],
};
const numeric = { type: "number" as const, role: "measure" as const };

describe("T07 normative field-type matrix", () => {
  it("classifies temporal, ordered, categorical and numeric fields without inherited lookup", () => {
    expect(classifyField(temporal)).toBe("temporal");
    expect(classifyField(orderedCategorical)).toBe("ordered-categorical");
    expect(classifyField(categorical)).toBe("categorical");
    expect(classifyField(numeric)).toBe("numeric");
    expect(classifyField(null)).toBe("none");
    expect(isVisualizationKind("line")).toBe(true);
    expect(isVisualizationKind("constructor")).toBe(false);
    expect(isVisualizationKind("__proto__")).toBe(false);
    expect(isCategoryOrder("declared")).toBe(true);
    expect(isCategoryOrder("constructor")).toBe(false);
  });

  it("accepts the valid combinations for every built-in visualization", () => {
    const cases = [
      {
        visualization: "line" as const,
        x: temporal,
        y: numeric,
        series: categorical,
        aggregation: "average" as const,
      },
      {
        visualization: "line" as const,
        x: orderedCategorical,
        y: numeric,
        aggregation: "sum" as const,
      },
      {
        visualization: "line" as const,
        x: { ...numeric, ordered: true },
        y: numeric,
        aggregation: "average" as const,
      },
      {
        visualization: "bar" as const,
        x: { ...numeric, binned: true },
        y: numeric,
        aggregation: "sum" as const,
      },
      {
        visualization: "area" as const,
        x: orderedCategorical,
        y: numeric,
        aggregation: "average" as const,
      },
      {
        visualization: "bar" as const,
        x: categorical,
        y: numeric,
        series: categorical,
        aggregation: "sum" as const,
      },
      {
        visualization: "bar" as const,
        x: { ...temporal, bucket: { grain: "month" as const } },
        y: numeric,
        aggregation: "sum" as const,
      },
      {
        visualization: "stacked-bar" as const,
        x: categorical,
        y: numeric,
        series: categorical,
        aggregation: "sum" as const,
      },
      {
        visualization: "scatter" as const,
        x: numeric,
        y: numeric,
        series: categorical,
        aggregation: "none" as const,
      },
      {
        visualization: "donut" as const,
        x: categorical,
        y: numeric,
        aggregation: "sum" as const,
      },
      { visualization: "kpi" as const, y: numeric, aggregation: "average" as const },
    ];
    for (const input of cases) {
      const result = validateVisualizationMatrix(input);
      expect(result.ok, input.visualization).toBe(true);
      expect(result.diagnostics.filter((entry) => entry.severity === "error")).toEqual([]);
    }
  });

  it("rejects illegal X, Y, series and aggregation combinations", () => {
    const cases: Array<[string, Parameters<typeof validateVisualizationMatrix>[0]]> = [
      [
        "line text measure",
        {
          visualization: "line",
          x: temporal,
          y: { type: "string", role: "dimension" },
          aggregation: "average",
        },
      ],
      [
        "area unordered category",
        {
          visualization: "area",
          x: categorical,
          y: numeric,
          aggregation: "average",
        },
      ],
      [
        "bar median",
        {
          visualization: "bar",
          x: categorical,
          y: numeric,
          aggregation: "median",
        },
      ],
      [
        "stacked bar missing series",
        {
          visualization: "stacked-bar",
          x: categorical,
          y: numeric,
          aggregation: "sum",
        },
      ],
      [
        "stacked bar average",
        {
          visualization: "stacked-bar",
          x: categorical,
          y: numeric,
          series: categorical,
          aggregation: "average",
        },
      ],
      [
        "scatter categorical X",
        {
          visualization: "scatter",
          x: categorical,
          y: numeric,
          aggregation: "none",
        },
      ],
      [
        "scatter aggregated",
        {
          visualization: "scatter",
          x: numeric,
          y: numeric,
          aggregation: "sum",
        },
      ],
      [
        "donut series",
        {
          visualization: "donut",
          x: categorical,
          y: numeric,
          series: categorical,
          aggregation: "sum",
        },
      ],
      [
        "donut average",
        {
          visualization: "donut",
          x: categorical,
          y: numeric,
          aggregation: "average",
        },
      ],
      ["kpi undeclared aggregation", { visualization: "kpi", y: numeric, aggregation: "none" }],
      ["kpi X field", { visualization: "kpi", x: categorical, y: numeric, aggregation: "average" }],
      [
        "temporal bar without bucket",
        {
          visualization: "bar",
          x: temporal,
          y: numeric,
          aggregation: "sum",
        },
      ],
      [
        "temporal stacked bar without bucket",
        {
          visualization: "stacked-bar",
          x: temporal,
          y: numeric,
          series: categorical,
          aggregation: "sum",
        },
      ],
      [
        "unbinned numeric bar",
        {
          visualization: "bar",
          x: numeric,
          y: numeric,
          aggregation: "sum",
        },
      ],
      [
        "unordered numeric line",
        {
          visualization: "line",
          x: numeric,
          y: numeric,
          aggregation: "average",
        },
      ],
      [
        "line stacking",
        {
          visualization: "line",
          x: temporal,
          y: numeric,
          aggregation: "average",
          stacked: true,
        },
      ],
    ];
    for (const [label, input] of cases) {
      const result = validateVisualizationMatrix(input);
      expect(result.ok, label).toBe(false);
      expect(
        result.diagnostics.some((entry) => entry.severity === "error"),
        label,
      ).toBe(true);
    }
  });

  it("returns diagnostics for prototype-name visualizations instead of crashing", () => {
    for (const visualization of ["constructor", "__proto__", "toString"]) {
      const result = validateVisualizationMatrix({
        visualization: visualization as never,
      });
      expect(result.ok).toBe(false);
      expect(result.diagnostics[0]?.code).toBe("RENDERER_INCOMPATIBLE");
    }
  });

  it("publishes the complete matrix with its policies", () => {
    const entries = describeVisualizationMatrix();
    expect(entries.map((entry) => entry.visualization).sort()).toEqual(
      ["area", "bar", "donut", "kpi", "line", "scatter", "stacked-bar", "table"].sort(),
    );
    expect(VISUALIZATION_MATRIX["stackedBar" as never]).toBeUndefined();
    expect(VISUALIZATION_MATRIX["stacked-bar"].negativeValues).toBe("rejected");
    expect(VISUALIZATION_MATRIX.area.zeroBaseline).toBe("required");
    expect(VISUALIZATION_MATRIX.donut.aggregation).toEqual(["sum"]);
    expect(VISUALIZATION_MATRIX.scatter.paddedAxes).toBe(true);
    expect(VISUALIZATION_MATRIX.kpi.nullPolicy).toBe("no-data");
  });
});
