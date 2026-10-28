import type { ChartType } from "./board-schema.js";
import { DIAGNOSTIC_CODES, createDiagnostic, type Diagnostic } from "./diagnostics.js";
import type { QueryCounts, QueryResultField, QueryResultRow } from "./data-contract.js";
import type { CategoryOrder } from "./field-matrix.js";
import type { FormatterProvider } from "./formatting.js";
import { canonicalJson, type JsonValue } from "./json.js";
import type {
  ChartRendererSpec,
  KpiRendererSpec,
  RendererField,
  TableRendererSpec,
} from "./renderer-contract.js";
import { fieldValueOf } from "./renderer-contract.js";
import { formatValueParts, type ValueMessages } from "./value-format.js";

export interface ChartModelCategory {
  readonly key: string;
  readonly raw: JsonValue | null;
  readonly label: string | null;
  readonly missing: boolean;
}

export interface ChartModelSeries {
  readonly key: string;
  readonly raw: JsonValue | null;
  readonly label: string | null;
  readonly missing: boolean;
}

export interface ScatterModelPoint {
  readonly x: number | null;
  readonly y: number | null;
  readonly seriesKey: string;
}

export interface ChartModel {
  readonly spec: ChartRendererSpec;
  readonly categories: readonly ChartModelCategory[];
  readonly series: readonly ChartModelSeries[];
  readonly values: readonly (readonly (number | null)[])[];
  readonly scatterPoints: readonly ScatterModelPoint[];
  readonly rowCount: number;
  readonly filteredRowCount: number;
  readonly nonNullRowCount: number;
  readonly categoryCount: number;
  readonly seriesCount: number;
  readonly pointCount: number;
  readonly nullCount: number;
  readonly zeroCount: number;
  readonly negativeCount: number;
  readonly valueMin: number | null;
  readonly valueMax: number | null;
  readonly xMin: number | null;
  readonly xMax: number | null;
  readonly domainMin: number | null;
  readonly domainMax: number | null;
  readonly xDomainMin: number | null;
  readonly xDomainMax: number | null;
  readonly yDomainMin: number | null;
  readonly yDomainMax: number | null;
  readonly includesZero: boolean;
  readonly empty: boolean;
  readonly zeroTotal: boolean;
  readonly total: number;
  readonly blocked: boolean;
  readonly baseline: "zero" | "padded" | "none";
  readonly diagnostics: readonly Diagnostic[];
  readonly unitText: string;
  readonly xUnitText: string;
}

export interface KpiModel {
  readonly spec: KpiRendererSpec;
  readonly value: number | null;
  readonly text: string | null;
  readonly unitText: string;
  readonly missing: boolean;
  readonly invalid: boolean;
  readonly rowCount: number;
  readonly nullCount: number;
  readonly empty: boolean;
  readonly fieldLabel: string;
}

export interface TableModelCell {
  readonly fieldId: string;
  readonly text: string | null;
  readonly missing: boolean;
  readonly invalid: boolean;
  readonly numeric: number | null;
}

export interface TableModelColumn {
  readonly fieldId: string;
  readonly label: string;
  readonly unitText: string;
  readonly type: RendererField["type"];
  readonly role: RendererField["role"];
}

export interface TableModelRow {
  readonly index: number;
  readonly cells: readonly TableModelCell[];
}

export interface TableModel {
  readonly spec: TableRendererSpec;
  readonly columns: readonly TableModelColumn[];
  readonly rows: readonly TableModelRow[];
  readonly rowCount: number;
  readonly empty: boolean;
  readonly missingCount: number;
}

const SINGLE_SERIES = "__single__";
const MISSING_KEY = "__missing__";

function missingCategory(): ChartModelCategory {
  return Object.freeze({ key: MISSING_KEY, raw: null, label: null, missing: true });
}

function missingSeries(): ChartModelSeries {
  return Object.freeze({ key: MISSING_KEY, raw: null, label: null, missing: true });
}

function valueKey(value: JsonValue | undefined): string {
  return value === null || value === undefined ? MISSING_KEY : canonicalJson(value);
}

function isTemporalField(field: RendererField): boolean {
  return field.type === "date" || field.type === "datetime";
}

function rawTimestamp(value: JsonValue | null | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function compareRaw(
  left: JsonValue | null,
  right: JsonValue | null,
  field: RendererField,
  collator: Intl.Collator,
): number {
  if (left === null || right === null) {
    return left === right ? 0 : left === null ? 1 : -1;
  }
  if (isTemporalField(field)) {
    const leftTime = rawTimestamp(left);
    const rightTime = rawTimestamp(right);
    if (leftTime !== null && rightTime !== null) {
      return leftTime - rightTime;
    }
  }
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }
  if (typeof left === "boolean" && typeof right === "boolean") {
    return left === right ? 0 : left ? 1 : -1;
  }
  return collator.compare(String(left), String(right));
}

function orderByDeclared<T extends { readonly raw: JsonValue | null; readonly key: string }>(
  entries: readonly T[],
  allowedValues: readonly (string | number | boolean)[] | undefined,
  field: RendererField,
  collator: Intl.Collator,
): T[] {
  if (!allowedValues || allowedValues.length === 0) {
    return [...entries].sort((left, right) => {
      if (left.raw === null && right.raw !== null) {
        return 1;
      }
      if (right.raw === null && left.raw !== null) {
        return -1;
      }
      return 0;
    });
  }
  const rank = new Map<string, number>();
  allowedValues.forEach((value, index) => {
    rank.set(valueKey(value), index);
  });
  return [...entries].sort((left, right) => {
    if (left.raw === null && right.raw !== null) {
      return 1;
    }
    if (right.raw === null && left.raw !== null) {
      return -1;
    }
    const leftRank = rank.get(left.key);
    const rightRank = rank.get(right.key);
    if (leftRank !== undefined && rightRank !== undefined) {
      return leftRank - rightRank;
    }
    if (leftRank !== undefined) {
      return -1;
    }
    if (rightRank !== undefined) {
      return 1;
    }
    return compareRaw(left.raw, right.raw, field, collator);
  });
}

function orderCategories(
  entries: readonly ChartModelCategory[],
  order: CategoryOrder,
  field: RendererField,
  collator: Intl.Collator,
): ChartModelCategory[] {
  if (order === "data") {
    return [...entries].sort((left, right) => {
      if (left.missing === right.missing) {
        return 0;
      }
      return left.missing ? 1 : -1;
    });
  }
  if (order === "declared") {
    return orderByDeclared(entries, field.allowedValues, field, collator);
  }
  const direction = order === "ascending" ? 1 : -1;
  return [...entries].sort((left, right) => {
    if (left.raw === null && right.raw !== null) {
      return 1;
    }
    if (right.raw === null && left.raw !== null) {
      return -1;
    }
    return compareRaw(left.raw, right.raw, field, collator) * direction;
  });
}

function orderSeries(
  entries: readonly ChartModelSeries[],
  field: RendererField | null,
  collator: Intl.Collator,
): ChartModelSeries[] {
  if (!field) {
    return [...entries];
  }
  if (field.allowedValues && field.allowedValues.length > 0) {
    return orderByDeclared(entries, field.allowedValues, field, collator);
  }
  return [...entries];
}

function asFiniteNumber(value: JsonValue | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function paddedRange(
  values: readonly number[],
): { readonly min: number; readonly max: number } | null {
  if (values.length === 0) {
    return null;
  }
  let min = values[0] ?? 0;
  let max = values[0] ?? 0;
  for (const value of values) {
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  const span = max - min;
  const padding = span === 0 ? (Math.abs(max) > 0 ? Math.abs(max) * 0.05 : 1) : span * 0.05;
  return { min: min - padding, max: max + padding };
}

function chartBaseline(visualization: ChartType): "zero" | "padded" | "none" {
  if (visualization === "scatter") {
    return "padded";
  }
  if (visualization === "donut") {
    return "none";
  }
  return "zero";
}

function dataDiagnostic(path: string, message: string): Diagnostic {
  return createDiagnostic(DIAGNOSTIC_CODES.RENDERER_DATA_INVALID, path, { message });
}

export function buildChartModel(
  spec: ChartRendererSpec,
  data: {
    readonly fields: readonly QueryResultField[];
    readonly rows: readonly QueryResultRow[];
    readonly counts?: QueryCounts;
  },
  formatters: FormatterProvider,
  messages?: ValueMessages,
): ChartModel {
  const diagnostics: Diagnostic[] = [];
  const collator = new Intl.Collator(formatters.locale, { numeric: true, sensitivity: "base" });
  const xField = spec.x;
  const yField = spec.y;
  const seriesField = spec.series;
  const yResultField = data.fields.find((field) => field.fieldId === yField.fieldId) ?? null;
  const sourceNullCount =
    yResultField?.sourceFieldId === undefined
      ? 0
      : (data.counts?.nullCounts[yResultField.sourceFieldId] ?? 0);
  const categoryByKey = new Map<string, ChartModelCategory>();
  const seriesByKey = new Map<string, ChartModelSeries>();
  const scatterPoints: ScatterModelPoint[] = [];
  let nullCount = 0;
  let zeroCount = 0;
  let negativeCount = 0;
  let hasDuplicate = false;
  let finiteCount = 0;
  let valueMin: number | null = null;
  let valueMax: number | null = null;
  let xMin: number | null = null;
  let xMax: number | null = null;
  let total = 0;
  const seen = new Set<string>();

  const registerSeries = (raw: JsonValue | undefined): ChartModelSeries => {
    if (!seriesField) {
      const existing = seriesByKey.get(SINGLE_SERIES);
      if (existing) {
        return existing;
      }
      const created = Object.freeze({
        key: SINGLE_SERIES,
        raw: null,
        label: null,
        missing: false,
      });
      seriesByKey.set(SINGLE_SERIES, created);
      return created;
    }
    if (raw === null || raw === undefined) {
      const existing = seriesByKey.get(MISSING_KEY);
      if (existing) {
        return existing;
      }
      const created = missingSeries();
      seriesByKey.set(MISSING_KEY, created);
      return created;
    }
    const key = valueKey(raw);
    const existing = seriesByKey.get(key);
    if (existing) {
      return existing;
    }
    const created = Object.freeze({
      key,
      raw,
      label: formatValueParts(raw, seriesField, formatters, messages).text,
      missing: false,
    });
    seriesByKey.set(key, created);
    return created;
  };

  for (const row of data.rows) {
    const rawX = fieldValueOf(row, xField.fieldId) ?? null;
    const rawY = fieldValueOf(row, yField.fieldId);
    const rawSeries = seriesField ? (fieldValueOf(row, seriesField.fieldId) ?? null) : null;

    if (spec.visualization === "scatter") {
      const numericX = asFiniteNumber(rawX ?? undefined);
      const numericY = asFiniteNumber(rawY);
      let missingPoint = false;
      if (rawX === null || rawX === undefined) {
        missingPoint = true;
      } else if (numericX === null) {
        missingPoint = true;
        diagnostics.push(
          createDiagnostic(DIAGNOSTIC_CODES.RENDERER_DATA_INVALID, `chart/${spec.id}/data`, {
            severity: "warning",
            message: "A scatter X value is non-finite or non-numeric and cannot be plotted.",
          }),
        );
      }
      if (rawY === null || rawY === undefined) {
        missingPoint = true;
      } else if (numericY === null) {
        missingPoint = true;
        diagnostics.push(
          createDiagnostic(DIAGNOSTIC_CODES.RENDERER_DATA_INVALID, `chart/${spec.id}/data`, {
            severity: "warning",
            message: "A scatter Y value is non-finite or non-numeric and cannot be plotted.",
          }),
        );
      }
      if (missingPoint) {
        nullCount += 1;
        continue;
      }
      if (numericX === null || numericY === null) {
        continue;
      }
      finiteCount += 1;
      xMin = xMin === null ? numericX : Math.min(xMin, numericX);
      xMax = xMax === null ? numericX : Math.max(xMax, numericX);
      valueMin = valueMin === null ? numericY : Math.min(valueMin, numericY);
      valueMax = valueMax === null ? numericY : Math.max(valueMax, numericY);
      if (numericY === 0) {
        zeroCount += 1;
      }
      if (numericY < 0) {
        negativeCount += 1;
      }
      const series = registerSeries(rawSeries ?? undefined);
      scatterPoints.push(Object.freeze({ x: numericX, y: numericY, seriesKey: series.key }));
      continue;
    }

    if (xField.type === "number") {
      const numericX = asFiniteNumber(rawX);
      if (numericX !== null) {
        xMin = xMin === null ? numericX : Math.min(xMin, numericX);
        xMax = xMax === null ? numericX : Math.max(xMax, numericX);
      }
      if (spec.visualization === "line") {
        if (rawX === null || rawX === undefined) {
          nullCount += 1;
          continue;
        }
        if (numericX === null) {
          nullCount += 1;
          diagnostics.push(
            createDiagnostic(DIAGNOSTIC_CODES.RENDERER_DATA_INVALID, `chart/${spec.id}/data`, {
              severity: "warning",
              message: "A numeric line X value is non-finite or non-numeric and cannot be plotted.",
            }),
          );
          continue;
        }
      }
    }
    const missingX = rawX === null || rawX === undefined;
    const categoryKey = valueKey(rawX);
    let category = categoryByKey.get(categoryKey);
    if (!category) {
      category = missingX
        ? missingCategory()
        : Object.freeze({
            key: categoryKey,
            raw: rawX,
            label: formatValueParts(rawX, xField, formatters, messages).text,
            missing: false,
          });
      categoryByKey.set(categoryKey, category);
    }
    const series = registerSeries(rawSeries ?? undefined);
    const numericY = asFiniteNumber(rawY);
    const pointKey = `${category.key}\u0000${series.key}`;
    if (seen.has(pointKey)) {
      hasDuplicate = true;
      diagnostics.push(
        dataDiagnostic(
          `chart/${spec.id}/data`,
          "The data contains duplicate category and series points after query grouping.",
        ),
      );
    }
    seen.add(pointKey);
    if (rawY === null || rawY === undefined) {
      nullCount += 1;
    } else if (numericY === null) {
      nullCount += 1;
      diagnostics.push(
        dataDiagnostic(
          `chart/${spec.id}/data`,
          "A chart point contains a non-finite or non-numeric measure value.",
        ),
      );
    } else {
      finiteCount += 1;
      total += numericY;
      valueMin = valueMin === null ? numericY : Math.min(valueMin, numericY);
      valueMax = valueMax === null ? numericY : Math.max(valueMax, numericY);
      if (numericY === 0) {
        zeroCount += 1;
      }
      if (numericY < 0) {
        negativeCount += 1;
      }
    }
  }

  const categories = orderCategories(
    [...categoryByKey.values()],
    spec.categoryOrder,
    xField,
    collator,
  );
  const seriesList = orderSeries([...seriesByKey.values()], seriesField, collator);
  const categoryIndex = new Map(
    categories.map((category, index) => [category.key, index] as const),
  );
  const seriesIndexByKey = new Map(seriesList.map((series, index) => [series.key, index] as const));

  let aligned: (number | null)[][] = seriesList.map(() => categories.map(() => null));
  for (const row of data.rows) {
    if (spec.visualization === "scatter") {
      break;
    }
    const rawX = fieldValueOf(row, xField.fieldId) ?? null;
    const rawSeries = seriesField ? (fieldValueOf(row, seriesField.fieldId) ?? null) : null;
    const category = categoryIndex.get(valueKey(rawX));
    const series = seriesIndexByKey.get(registerSeries(rawSeries ?? undefined).key);
    if (category === undefined || series === undefined) {
      continue;
    }
    const target = aligned[series];
    if (target !== undefined) {
      target[category] = asFiniteNumber(fieldValueOf(row, yField.fieldId));
    }
  }

  const visualization = spec.visualization;
  const baseline = chartBaseline(visualization);
  const zeroTotal = visualization === "donut" && total === 0 && finiteCount > 0;
  const stacked = spec.stacked;
  let blocked = false;
  if (visualization === "donut" && negativeCount > 0) {
    blocked = true;
    diagnostics.push(
      dataDiagnostic(
        `chart/${spec.id}/data`,
        "A donut cannot include negative values; no part-to-whole geometry is produced.",
      ),
    );
  }
  const stackedGeometry =
    stacked &&
    (visualization === "stacked-bar" || visualization === "bar" || visualization === "area");
  if (stackedGeometry && negativeCount > 0) {
    blocked = true;
    diagnostics.push(
      dataDiagnostic(
        `chart/${spec.id}/data`,
        "Stacked geometry cannot include negative values; no stack is produced.",
      ),
    );
  }
  if (hasDuplicate) {
    blocked = true;
  }

  if (stackedGeometry && finiteCount > 0) {
    let cumulativeMin = valueMin ?? 0;
    let cumulativeMax = valueMax ?? 0;
    for (
      let categoryIndexValue = 0;
      categoryIndexValue < categories.length;
      categoryIndexValue += 1
    ) {
      let positive = 0;
      let negative = 0;
      for (const seriesValues of aligned) {
        const value = seriesValues[categoryIndexValue];
        if (value === null || value === undefined) {
          continue;
        }
        if (value >= 0) {
          positive += value;
        } else {
          negative += value;
        }
      }
      cumulativeMax = Math.max(cumulativeMax, positive);
      cumulativeMin = Math.min(cumulativeMin, negative);
    }
    valueMin = cumulativeMin;
    valueMax = cumulativeMax;
  }

  let domainMin: number | null = null;
  let domainMax: number | null = null;
  let xDomainMin: number | null = null;
  let xDomainMax: number | null = null;
  let yDomainMin: number | null = null;
  let yDomainMax: number | null = null;
  if (xField.type === "number" && xMin !== null && xMax !== null) {
    const padded = paddedRange([xMin, xMax]);
    xDomainMin = padded?.min ?? null;
    xDomainMax = padded?.max ?? null;
  }
  if (baseline === "zero") {
    domainMin = valueMin === null ? null : Math.min(0, valueMin);
    domainMax = valueMax === null ? null : Math.max(0, valueMax);
    yDomainMin = domainMin;
    yDomainMax = domainMax;
  } else if (baseline === "padded") {
    const xValues = [...(xMin === null ? [] : [xMin]), ...(xMax === null ? [] : [xMax])];
    const yValues = [
      ...(valueMin === null ? [] : [valueMin]),
      ...(valueMax === null ? [] : [valueMax]),
    ];
    const xPadded = paddedRange(xValues);
    const yPadded = paddedRange(yValues);
    xDomainMin = xPadded?.min ?? null;
    xDomainMax = xPadded?.max ?? null;
    yDomainMin = yPadded?.min ?? null;
    yDomainMax = yPadded?.max ?? null;
    const combined = [...xValues, ...yValues];
    const padded = paddedRange(combined);
    domainMin = padded?.min ?? null;
    domainMax = padded?.max ?? null;
  }

  const filteredRowCount = data.counts?.filteredRows ?? data.rows.length;
  const effectiveNullCount = Math.max(nullCount, sourceNullCount);
  const nonNullRowCount = Math.max(0, filteredRowCount - effectiveNullCount);
  const empty = finiteCount === 0;
  if (empty && data.rows.length > 0 && !blocked) {
    diagnostics.push(
      createDiagnostic(DIAGNOSTIC_CODES.RENDERER_DATA_INVALID, `chart/${spec.id}/data`, {
        severity: "warning",
        message: "The chart has no finite measure values; null is not rendered as zero.",
      }),
    );
  }

  if (visualization !== "scatter") {
    aligned = seriesList.map((_series, seriesIndexValue) => {
      const source = aligned[seriesIndexValue] ?? [];
      return categories.map((_category, index) => source[index] ?? null);
    });
  }

  return Object.freeze({
    spec,
    categories: Object.freeze(categories),
    series: Object.freeze(seriesList),
    values: Object.freeze(aligned.map((entry) => Object.freeze(entry))),
    scatterPoints: Object.freeze(scatterPoints),
    rowCount: data.rows.length,
    filteredRowCount,
    nonNullRowCount,
    categoryCount: categories.length,
    seriesCount: seriesList.length,
    pointCount: finiteCount,
    nullCount: effectiveNullCount,
    zeroCount,
    negativeCount,
    valueMin,
    valueMax,
    xMin,
    xMax,
    domainMin,
    domainMax,
    xDomainMin,
    xDomainMax,
    yDomainMin,
    yDomainMax,
    includesZero: valueMin !== null && valueMax !== null && valueMin <= 0 && valueMax >= 0,
    empty,
    zeroTotal,
    total,
    blocked,
    baseline,
    diagnostics: Object.freeze(diagnostics),
    unitText: formatValueParts(0, yField, formatters, messages).unitText,
    xUnitText: formatValueParts(0, xField, formatters, messages).unitText,
  });
}

export function buildKpiModel(
  spec: KpiRendererSpec,
  data: {
    readonly fields: readonly QueryResultField[];
    readonly rows: readonly QueryResultRow[];
    readonly counts?: QueryCounts;
  },
  formatters: FormatterProvider,
  messages?: ValueMessages,
): KpiModel {
  const field = data.fields.find((candidate) => candidate.fieldId === spec.y.fieldId) ?? null;
  const row = data.rows[0];
  const value = row === undefined || field === null ? undefined : fieldValueOf(row, field.fieldId);
  const parts = formatValueParts(value as JsonValue | undefined, spec.y, formatters, messages);
  const nullKey = field?.sourceFieldId ?? field?.fieldId ?? spec.y.fieldId;
  const nullCount = data.counts === undefined ? 0 : (data.counts.nullCounts[nullKey] ?? 0);
  return Object.freeze({
    spec,
    value: parts.numeric,
    text: parts.text,
    unitText: parts.unitText,
    missing: parts.missing,
    invalid: parts.invalid,
    rowCount: data.rows.length,
    nullCount,
    empty: data.rows.length === 0 || field === null,
    fieldLabel: spec.y.label,
  });
}

export function buildTableModel(
  spec: TableRendererSpec,
  data: {
    readonly fields: readonly QueryResultField[];
    readonly rows: readonly QueryResultRow[];
    readonly counts?: QueryCounts;
  },
  formatters: FormatterProvider,
  messages?: ValueMessages,
): TableModel {
  const columns: TableModelColumn[] = spec.columns.map((column) => {
    const unitText = formatValueParts(0, column, formatters, messages).unitText;
    return Object.freeze({
      fieldId: column.fieldId,
      label: column.label,
      unitText,
      type: column.type,
      role: column.role,
    });
  });
  let missingCount = 0;
  const rows: TableModelRow[] = data.rows.map((row, index) => {
    const cells = spec.columns.map((column) => {
      const value = fieldValueOf(row, column.fieldId);
      const parts = formatValueParts(value as JsonValue | undefined, column, formatters, messages);
      if (parts.missing) {
        missingCount += 1;
      }
      return Object.freeze({
        fieldId: column.fieldId,
        text: parts.text,
        missing: parts.missing,
        invalid: parts.invalid,
        numeric: parts.numeric,
      });
    });
    return Object.freeze({ index, cells: Object.freeze(cells) });
  });
  return Object.freeze({
    spec,
    columns: Object.freeze(columns),
    rows: Object.freeze(rows),
    rowCount: rows.length,
    empty: rows.length === 0,
    missingCount,
  });
}

export function chartModelDiagnostics(model: ChartModel): readonly Diagnostic[] {
  return model.diagnostics;
}
