import {
  AGGREGATION_TYPES,
  CHART_TYPES,
  type AggregationType,
  type BucketGrain,
  type FieldValueType,
} from "./board-schema.js";
import type { DataFieldRole } from "./data-contract.js";
import { DIAGNOSTIC_CODES, createDiagnostic, type Diagnostic } from "./diagnostics.js";

export const VISUALIZATION_KINDS = Object.freeze([...CHART_TYPES, "kpi", "table"] as const);
export type VisualizationKind = (typeof VISUALIZATION_KINDS)[number];

export const FIELD_CLASSES = Object.freeze([
  "temporal",
  "ordered-categorical",
  "categorical",
  "numeric",
  "none",
] as const);
export type FieldClass = (typeof FIELD_CLASSES)[number];

export const CATEGORY_ORDERS = Object.freeze([
  "declared",
  "data",
  "ascending",
  "descending",
] as const);
export type CategoryOrder = (typeof CATEGORY_ORDERS)[number];

export type MatrixAggregationRule =
  readonly AggregationType[] | "declared" | "raw-or-grouped" | "none";

export interface VisualizationMatrixEntry {
  readonly visualization: VisualizationKind;
  readonly x: readonly FieldClass[];
  readonly y: readonly FieldClass[];
  readonly series: "required" | "optional" | "none";
  readonly aggregation: MatrixAggregationRule;
  readonly comparison: "absolute" | "percentage" | "both" | "optional" | "none";
  readonly zeroBaseline: "required" | "visible" | "optional" | "none";
  readonly negativeValues: "supported" | "diverging" | "rejected";
  readonly stacking: "required" | "supported" | "optional" | "rejected";
  readonly paddedAxes: boolean;
  readonly nullPolicy: "gap" | "excluded" | "cell" | "no-data";
}

export const VISUALIZATION_MATRIX = Object.freeze({
  line: Object.freeze({
    visualization: "line",
    x: Object.freeze(["temporal", "ordered-categorical", "numeric"]),
    y: Object.freeze(["numeric"]),
    series: "optional",
    aggregation: Object.freeze(["average", "sum"]),
    comparison: "both",
    zeroBaseline: "visible",
    negativeValues: "supported",
    stacking: "rejected",
    paddedAxes: false,
    nullPolicy: "gap",
  }),
  area: Object.freeze({
    visualization: "area",
    x: Object.freeze(["temporal", "ordered-categorical"]),
    y: Object.freeze(["numeric"]),
    series: "optional",
    aggregation: Object.freeze(["average", "sum"]),
    comparison: "both",
    zeroBaseline: "required",
    negativeValues: "diverging",
    stacking: "optional",
    paddedAxes: false,
    nullPolicy: "gap",
  }),
  bar: Object.freeze({
    visualization: "bar",
    x: Object.freeze(["temporal", "ordered-categorical", "categorical", "numeric"]),
    y: Object.freeze(["numeric"]),
    series: "optional",
    aggregation: Object.freeze(["sum", "average", "count", "min", "max"]),
    comparison: "both",
    zeroBaseline: "required",
    negativeValues: "supported",
    stacking: "optional",
    paddedAxes: false,
    nullPolicy: "gap",
  }),
  "stacked-bar": Object.freeze({
    visualization: "stacked-bar",
    x: Object.freeze(["temporal", "ordered-categorical", "categorical"]),
    y: Object.freeze(["numeric"]),
    series: "required",
    aggregation: Object.freeze(["sum"]),
    comparison: "both",
    zeroBaseline: "required",
    negativeValues: "rejected",
    stacking: "required",
    paddedAxes: false,
    nullPolicy: "gap",
  }),
  scatter: Object.freeze({
    visualization: "scatter",
    x: Object.freeze(["numeric"]),
    y: Object.freeze(["numeric"]),
    series: "optional",
    aggregation: "none",
    comparison: "both",
    zeroBaseline: "optional",
    negativeValues: "supported",
    stacking: "rejected",
    paddedAxes: true,
    nullPolicy: "excluded",
  }),
  donut: Object.freeze({
    visualization: "donut",
    x: Object.freeze(["categorical", "ordered-categorical"]),
    y: Object.freeze(["numeric"]),
    series: "none",
    aggregation: Object.freeze(["sum"]),
    comparison: "optional",
    zeroBaseline: "none",
    negativeValues: "rejected",
    stacking: "rejected",
    paddedAxes: false,
    nullPolicy: "excluded",
  }),
  kpi: Object.freeze({
    visualization: "kpi",
    x: Object.freeze(["none"]),
    y: Object.freeze(["numeric"]),
    series: "none",
    aggregation: "declared",
    comparison: "both",
    zeroBaseline: "none",
    negativeValues: "supported",
    stacking: "rejected",
    paddedAxes: false,
    nullPolicy: "no-data",
  }),
  table: Object.freeze({
    visualization: "table",
    x: Object.freeze(["none"]),
    y: Object.freeze(["none"]),
    series: "none",
    aggregation: "raw-or-grouped",
    comparison: "optional",
    zeroBaseline: "none",
    negativeValues: "supported",
    stacking: "rejected",
    paddedAxes: false,
    nullPolicy: "cell",
  }),
}) as unknown as Readonly<Record<VisualizationKind, VisualizationMatrixEntry>>;

export interface MatrixFieldInput {
  readonly type: FieldValueType;
  readonly role?: DataFieldRole;
  readonly ordered?: boolean;
  readonly allowedValues?: readonly (string | number | boolean)[];
  readonly bucket?: { readonly grain: BucketGrain };
  readonly binned?: boolean;
}

export interface MatrixInput {
  readonly visualization: VisualizationKind;
  readonly x?: MatrixFieldInput | null;
  readonly y?: MatrixFieldInput | null;
  readonly series?: MatrixFieldInput | null;
  readonly aggregation?: AggregationType | null;
  readonly stacked?: boolean;
  readonly paths?: {
    readonly visualization?: string;
    readonly x?: string;
    readonly y?: string;
    readonly series?: string;
    readonly aggregation?: string;
  };
}

export interface MatrixValidation {
  readonly ok: boolean;
  readonly entry: VisualizationMatrixEntry;
  readonly diagnostics: readonly Diagnostic[];
  readonly stacked: boolean;
}

export function isVisualizationKind(value: unknown): value is VisualizationKind {
  return typeof value === "string" && (VISUALIZATION_KINDS as readonly string[]).includes(value);
}

export function isCategoryOrder(value: unknown): value is CategoryOrder {
  return typeof value === "string" && (CATEGORY_ORDERS as readonly string[]).includes(value);
}

export function classifyField(field: MatrixFieldInput | null | undefined): FieldClass {
  if (!field) {
    return "none";
  }
  if (field.type === "date" || field.type === "datetime") {
    return "temporal";
  }
  if (field.type === "number") {
    return "numeric";
  }
  const ordered =
    field.ordered === true ||
    field.bucket !== undefined ||
    (Array.isArray(field.allowedValues) && field.allowedValues.length > 0);
  return ordered ? "ordered-categorical" : "categorical";
}

function classLabel(fieldClass: FieldClass): string {
  switch (fieldClass) {
    case "temporal":
      return "a temporal field";
    case "ordered-categorical":
      return "an ordered categorical field";
    case "categorical":
      return "a categorical field";
    case "numeric":
      return "a numeric field";
    case "none":
      return "no field";
  }
}

function classList(classes: readonly FieldClass[]): string {
  return classes.map(classLabel).join(" or ");
}

function incompatible(path: string, message: string): Diagnostic {
  return createDiagnostic(DIAGNOSTIC_CODES.RENDERER_INCOMPATIBLE, path, { message });
}

function checkAggregation(
  visualization: VisualizationKind,
  aggregation: AggregationType | null | undefined,
  path: string,
  diagnostics: Diagnostic[],
): void {
  const rule = VISUALIZATION_MATRIX[visualization].aggregation;
  if (rule === "raw-or-grouped") {
    return;
  }
  if (rule === "none") {
    if (aggregation !== undefined && aggregation !== null && aggregation !== "none") {
      diagnostics.push(
        incompatible(
          path,
          `${visualization} must not aggregate rows; remove the ${aggregation} aggregation.`,
        ),
      );
    }
    return;
  }
  if (rule === "declared") {
    if (
      aggregation === undefined ||
      aggregation === null ||
      aggregation === "none" ||
      !(AGGREGATION_TYPES as readonly string[]).includes(aggregation)
    ) {
      diagnostics.push(
        incompatible(path, `${visualization} requires an explicitly declared aggregation.`),
      );
    }
    return;
  }
  if (aggregation === undefined || aggregation === null) {
    diagnostics.push(
      incompatible(
        path,
        `${visualization} requires one of these aggregations: ${rule.join(", ")}.`,
      ),
    );
    return;
  }
  if (!rule.includes(aggregation)) {
    diagnostics.push(
      incompatible(
        path,
        `Aggregation "${aggregation}" is not supported by ${visualization}; use ${rule.join(", ")}.`,
      ),
    );
  }
}

export function validateVisualizationMatrix(input: MatrixInput): MatrixValidation {
  if (
    !isVisualizationKind(input.visualization) ||
    !Object.hasOwn(VISUALIZATION_MATRIX, input.visualization)
  ) {
    return Object.freeze({
      ok: false,
      entry: VISUALIZATION_MATRIX.table,
      diagnostics: Object.freeze([
        incompatible(
          input.paths?.visualization ?? "visualization",
          `The visualization ${String(input.visualization)} is not part of the field-type matrix.`,
        ),
      ]),
      stacked: false,
    });
  }
  const entry = VISUALIZATION_MATRIX[input.visualization];
  const paths = input.paths ?? {};
  const diagnostics: Diagnostic[] = [];
  const visualizationPath = paths.visualization ?? "visualization";
  const xPath = paths.x ?? "x";
  const yPath = paths.y ?? "y";
  const seriesPath = paths.series ?? "series";
  const aggregationPath = paths.aggregation ?? "aggregation";
  const xClass = classifyField(input.x);
  const yClass = classifyField(input.y);
  const seriesClass = classifyField(input.series);

  if (entry.x.includes("none")) {
    if (xClass !== "none") {
      diagnostics.push(incompatible(xPath, `${input.visualization} does not accept an X field.`));
    }
  } else if (xClass === "none") {
    diagnostics.push(incompatible(xPath, `${input.visualization} requires an X field.`));
  } else if (!entry.x.includes(xClass)) {
    diagnostics.push(
      incompatible(
        xPath,
        `${input.visualization} X must be ${classList(entry.x)}, not ${classLabel(xClass)}.`,
      ),
    );
  }

  if (entry.y.includes("none")) {
    if (yClass !== "none") {
      diagnostics.push(incompatible(yPath, `${input.visualization} does not accept a Y field.`));
    }
  } else if (yClass === "none") {
    diagnostics.push(incompatible(yPath, `${input.visualization} requires a Y field.`));
  } else if (!entry.y.includes(yClass)) {
    diagnostics.push(
      incompatible(
        yPath,
        `${input.visualization} Y must be ${classList(entry.y)}, not ${classLabel(yClass)}.`,
      ),
    );
  }

  if (entry.series === "required") {
    if (seriesClass === "none") {
      diagnostics.push(
        incompatible(seriesPath, `${input.visualization} requires a categorical series field.`),
      );
    } else if (seriesClass !== "categorical" && seriesClass !== "ordered-categorical") {
      diagnostics.push(
        incompatible(
          seriesPath,
          `${input.visualization} series must be categorical, not ${classLabel(seriesClass)}.`,
        ),
      );
    }
  } else if (entry.series === "none") {
    if (seriesClass !== "none") {
      diagnostics.push(
        incompatible(seriesPath, `${input.visualization} does not accept a series field.`),
      );
    }
  } else if (
    seriesClass !== "none" &&
    seriesClass !== "categorical" &&
    seriesClass !== "ordered-categorical"
  ) {
    diagnostics.push(
      incompatible(
        seriesPath,
        `${input.visualization} series must be categorical, not ${classLabel(seriesClass)}.`,
      ),
    );
  }

  if (input.visualization === "donut") {
    if (xClass === "numeric") {
      diagnostics.push(incompatible(xPath, "Donut categories must be categorical, not numeric."));
    }
  }

  if (input.visualization === "bar" && xClass === "numeric" && input.x?.binned !== true) {
    diagnostics.push(
      incompatible(
        xPath,
        "A numeric bar X must be declared as pre-binned; implicit client-side binning is not performed.",
      ),
    );
  }

  if (input.visualization === "line" && xClass === "numeric" && input.x?.ordered !== true) {
    diagnostics.push(
      incompatible(xPath, "A numeric line X requires explicit ascending numeric ordering."),
    );
  }

  if (
    (input.visualization === "bar" || input.visualization === "stacked-bar") &&
    xClass === "temporal" &&
    input.x?.bucket === undefined
  ) {
    diagnostics.push(
      incompatible(
        xPath,
        `${input.visualization} requires an explicit date bucket for temporal X.`,
      ),
    );
  }

  checkAggregation(input.visualization, input.aggregation, aggregationPath, diagnostics);

  let stacked = false;
  if (input.visualization === "stacked-bar") {
    stacked = input.stacked !== false;
  } else if (input.visualization === "bar" || input.visualization === "area") {
    stacked = input.stacked === true;
  } else if (input.stacked === true) {
    diagnostics.push(
      incompatible(visualizationPath, `${input.visualization} does not support stacking.`),
    );
  }

  if (stacked && entry.series !== "required" && input.series == null) {
    diagnostics.push(
      incompatible(seriesPath, "Stacked rendering requires a categorical series field."),
    );
  }
  if (stacked && entry.stacking === "rejected") {
    diagnostics.push(
      incompatible(visualizationPath, `${input.visualization} does not support stacking.`),
    );
  }

  return Object.freeze({
    ok: !diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    entry,
    diagnostics: Object.freeze(diagnostics),
    stacked,
  });
}

export function describeVisualizationMatrix(): readonly VisualizationMatrixEntry[] {
  return Object.freeze(Object.values(VISUALIZATION_MATRIX));
}
