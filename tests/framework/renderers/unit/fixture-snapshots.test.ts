import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildChartModel,
  buildChartRendererSpec,
  createIntlFormatterProvider,
  type QueryResultField,
  type QueryResultRow,
} from "../../../../packages/core/src/index.js";

interface Case {
  readonly visualization: "bar";
  readonly rows: readonly QueryResultRow[];
  readonly expected: {
    readonly values: readonly (readonly (number | null)[])[];
    readonly nullCount: number;
    readonly zeroCount: number;
    readonly negativeCount: number;
    readonly empty: boolean;
    readonly domainMin: number | null;
    readonly domainMax: number | null;
  };
}

const fixture = JSON.parse(
  readFileSync(
    path.join(process.cwd(), "tests/framework/renderers/fixtures/chart-cases.json"),
    "utf8",
  ),
) as Record<string, Case>;

const formatters = createIntlFormatterProvider({ locale: "en", timezone: "UTC" });
const fields: readonly QueryResultField[] = [
  { fieldId: "category", type: "string", role: "dimension" },
  { fieldId: "value", type: "number", role: "measure", unit: { unit: "points" } },
];

describe("T07 null, zero, negative and empty fixture snapshots", () => {
  it.each(Object.entries(fixture))("matches the %s fixture", (name, testCase) => {
    const built = buildChartRendererSpec({
      id: `fixture-${name}`,
      visualization: testCase.visualization,
      x: { fieldId: "category", label: "Category", type: "string", role: "dimension" },
      y: {
        fieldId: "value",
        label: "Value",
        type: "number",
        role: "measure",
        unit: { unit: "points" },
      },
      aggregation: "sum",
    });
    expect(built.ok).toBe(true);
    if (!built.ok) {
      return;
    }
    const model = buildChartModel(built.value, { fields, rows: testCase.rows }, formatters);
    expect({
      values: model.values.map((entry) => [...entry]),
      nullCount: model.nullCount,
      zeroCount: model.zeroCount,
      negativeCount: model.negativeCount,
      empty: model.empty,
      domainMin: model.domainMin,
      domainMax: model.domainMax,
    }).toEqual(testCase.expected);
  });
});
