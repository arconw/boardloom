import {
  AGGREGATION_TYPES,
  BINDING_AXES,
  BINDING_MODES,
  BINDING_ROLES,
  BOARD_BLOCK_TYPES,
  BUCKET_GRAINS,
  CHART_TYPES,
  DATE_STYLES,
  FORMAT_STYLES,
  TIME_STYLES,
  WEEK_STARTS,
  type BindingRole,
} from "./board-schema.js";
import { DIAGNOSTIC_CODES } from "./diagnostics.js";
import { isValidTimeZone } from "./locale.js";
import {
  CATEGORY_ORDERS,
  validateVisualizationMatrix,
  VISUALIZATION_MATRIX,
  type MatrixFieldInput,
  type VisualizationKind,
} from "./field-matrix.js";
import {
  checkUnknownKeys,
  isRecord,
  nonEmptyString,
  oneOf,
  own,
  resolveFieldId,
  resolveFieldReference,
  resolveSlice,
  type AddDiagnostic,
  type FieldInfo,
  type ReferenceContext,
  type ScannedEntry,
} from "./board-validation-shared.js";

const BLOCK_KEYS = new Set(["id", "type", "title", "groupId", "bindings", "config"]);
const BINDING_KEYS = new Set([
  "id",
  "role",
  "mode",
  "axis",
  "bucket",
  "field",
  "sliceId",
  "aggregation",
  "format",
  "label",
]);
const BUCKET_KEYS = new Set(["grain", "timezone", "weekStartsOn"]);
const AGGREGATION_KEYS = new Set(["type", "fieldId"]);
const FORMAT_KEYS = new Set([
  "style",
  "unit",
  "currency",
  "precision",
  "dateStyle",
  "timeStyle",
  "timezone",
]);
const CHART_CONFIG_KEYS = new Set(["visualization", "comparisonId", "options"]);
const CHART_OPTION_KEYS = new Set([
  "stacked",
  "legend",
  "categoryOrder",
  "binnedX",
  "xAxis",
  "yAxis",
]);
const CHART_AXIS_KEYS = new Set(["label", "min", "max", "unit"]);
const METRIC_CONFIG_KEYS = new Set(["comparisonId", "format"]);
const TABLE_CONFIG_KEYS = new Set(["pageSize", "columns", "sort"]);
const TABLE_SORT_KEYS = new Set(["bindingId", "direction"]);
const TEXT_CONFIG_KEYS = new Set(["text"]);
const FILTER_CONFIG_KEYS = new Set(["filterIds"]);

interface ParsedMatrixBinding {
  readonly role: BindingRole | null;
  readonly axis: "x" | "y" | "none" | null;
  readonly field: FieldInfo | null;
  readonly grain?: string;
  readonly aggregation: string | null;
  readonly path: string;
}

function matrixField(binding: ParsedMatrixBinding | undefined): MatrixFieldInput | null {
  if (!binding || !binding.field?.type) {
    return null;
  }
  return Object.freeze({
    type: binding.field.type,
    ...(binding.field.role === undefined ? {} : { role: binding.field.role }),
    ...(binding.field.allowedValues === undefined
      ? {}
      : { allowedValues: binding.field.allowedValues }),
    ...(binding.grain === undefined ? {} : { bucket: { grain: binding.grain as never } }),
  });
}

function validateFieldMatrix(
  blockType: string,
  visualization: VisualizationKind,
  config: Record<string, unknown>,
  bindings: readonly ParsedMatrixBinding[],
  path: string,
  add: AddDiagnostic,
): void {
  if (blockType === "table") {
    return;
  }
  const measures = bindings.filter(
    (binding) => binding.role === "measure" || binding.role === "value" || binding.axis === "y",
  );
  if (visualization === "scatter") {
    if (measures.length > 2) {
      add(
        DIAGNOSTIC_CODES.INCOMPATIBLE_BINDING,
        `${path}/bindings`,
        "A scatter chart supports at most two measures, X and Y.",
      );
    }
  } else if (visualization === "kpi") {
    if (measures.length !== 1) {
      add(
        DIAGNOSTIC_CODES.INCOMPATIBLE_BINDING,
        `${path}/bindings`,
        "A KPI supports exactly one measure binding.",
      );
    }
  } else if (measures.length > 1) {
    add(
      DIAGNOSTIC_CODES.INCOMPATIBLE_BINDING,
      `${path}/bindings`,
      "A chart supports one Y measure binding.",
    );
  }
  if (visualization === "kpi") {
    const kpiMeasure = measures[0];
    const result = validateVisualizationMatrix({
      visualization,
      y: matrixField(kpiMeasure),
      aggregation:
        kpiMeasure?.aggregation === null || kpiMeasure?.aggregation === undefined
          ? null
          : (kpiMeasure.aggregation as never),
      paths: {
        visualization: `${path}/config/visualization`,
        y: kpiMeasure?.path ?? `${path}/bindings/y`,
        aggregation: kpiMeasure?.path ?? `${path}/bindings/aggregation`,
      },
    });
    for (const diagnostic of result.diagnostics) {
      add(diagnostic.code, diagnostic.path, diagnostic.message, {
        severity: diagnostic.severity,
        ...(diagnostic.relatedIds === undefined ? {} : { relatedIds: diagnostic.relatedIds }),
      });
    }
    return;
  }
  let x: ParsedMatrixBinding | undefined;
  let y: ParsedMatrixBinding | undefined;
  let series: ParsedMatrixBinding | undefined;
  if (visualization === "scatter") {
    x = measures.find((binding) => binding.axis === "x") ?? measures[0];
    y =
      measures.find((binding) => binding.axis === "y" && binding !== x) ??
      measures.find((binding) => binding !== x);
    series = bindings.find((binding) => binding.role === "series" || binding.role === "group");
  } else {
    x =
      bindings.find((binding) => binding.axis === "x") ??
      bindings.find((binding) => binding.role === "dimension") ??
      bindings.find(
        (binding) =>
          binding.role === "series" || binding.role === "group" || binding.role === "label",
      );
    y = measures.find((binding) => binding !== x);
    const candidates = bindings.filter(
      (binding) =>
        binding !== x &&
        binding !== y &&
        (binding.role === "series" ||
          binding.role === "group" ||
          binding.role === "dimension" ||
          binding.axis === "x"),
    );
    series = candidates[0];
    if (candidates.length > 1) {
      add(
        DIAGNOSTIC_CODES.INCOMPATIBLE_BINDING,
        `${path}/bindings`,
        "A chart supports at most one series dimension.",
      );
    }
  }
  const options = own(config, "options");
  const stackedOption = isRecord(options) ? own(options, "stacked") : undefined;
  const stacked =
    visualization === "stacked-bar" ? stackedOption !== false : stackedOption === true;
  const categoryOrderValue = isRecord(options) ? own(options, "categoryOrder") : undefined;
  const binnedX = isRecord(options) ? own(options, "binnedX") === true : false;
  const xBase = matrixField(x);
  const xMatrix =
    xBase === null
      ? null
      : Object.freeze({
          ...xBase,
          ...(categoryOrderValue === "ascending" ? { ordered: true } : {}),
          ...(binnedX ? { binned: true } : {}),
        });
  const aggregation = y?.aggregation;
  const result = validateVisualizationMatrix({
    visualization,
    x: xMatrix,
    y: matrixField(y),
    series: matrixField(series),
    aggregation: aggregation === null || aggregation === undefined ? null : (aggregation as never),
    stacked,
    paths: {
      visualization: `${path}/config/visualization`,
      x: x?.path ?? `${path}/bindings/x`,
      y: y?.path ?? `${path}/bindings/y`,
      series: series?.path ?? `${path}/bindings/series`,
      aggregation: y?.path ?? `${path}/bindings/aggregation`,
    },
  });
  for (const diagnostic of result.diagnostics) {
    add(diagnostic.code, diagnostic.path, diagnostic.message, {
      severity: diagnostic.severity,
      ...(diagnostic.relatedIds === undefined ? {} : { relatedIds: diagnostic.relatedIds }),
    });
  }

  const xAxis = isRecord(options) ? own(options, "xAxis") : undefined;
  const yAxis = isRecord(options) ? own(options, "yAxis") : undefined;
  const xBounds =
    isRecord(xAxis) && (own(xAxis, "min") !== undefined || own(xAxis, "max") !== undefined);
  const numericXAxis =
    visualization === "scatter" || (visualization === "line" && x?.field?.type === "number");
  if (xBounds && !numericXAxis) {
    add(
      DIAGNOSTIC_CODES.INCOMPATIBLE_BINDING,
      `${path}/config/options/xAxis`,
      "X axis bounds are only supported for numeric axes.",
    );
  }
  if (isRecord(xAxis)) {
    const unit = own(xAxis, "unit");
    if (typeof unit === "string" && unit !== (x?.field?.unit ?? "")) {
      add(
        DIAGNOSTIC_CODES.INCOMPATIBLE_BINDING,
        `${path}/config/options/xAxis/unit`,
        "An X axis unit override must match the field unit.",
      );
    }
  }
  if (isRecord(yAxis)) {
    const unit = own(yAxis, "unit");
    if (typeof unit === "string" && unit !== (y?.field?.unit ?? "")) {
      add(
        DIAGNOSTIC_CODES.INCOMPATIBLE_BINDING,
        `${path}/config/options/yAxis/unit`,
        "A Y axis unit override must match the field unit.",
      );
    }
    const matrixEntry = VISUALIZATION_MATRIX[visualization];
    if (matrixEntry.zeroBaseline === "required" || matrixEntry.zeroBaseline === "visible") {
      const min = own(yAxis, "min");
      const max = own(yAxis, "max");
      if (typeof min === "number" && min > 0) {
        add(
          DIAGNOSTIC_CODES.INCOMPATIBLE_BINDING,
          `${path}/config/options/yAxis/min`,
          "The Y axis must include a visible zero baseline.",
        );
      }
      if (typeof max === "number" && max < 0) {
        add(
          DIAGNOSTIC_CODES.INCOMPATIBLE_BINDING,
          `${path}/config/options/yAxis/max`,
          "The Y axis must include a visible zero baseline.",
        );
      }
    }
  }
}

const BINDING_ROLES_BY_BLOCK: Readonly<Record<string, readonly BindingRole[]>> = Object.freeze({
  chart: ["dimension", "measure", "series", "group", "size", "color", "comparison", "label"],
  metric: ["measure", "label"],
  table: ["dimension", "measure", "column", "group", "label"],
  text: [],
  filter: [],
});

export function validateFormat(
  value: Record<string, unknown>,
  path: string,
  add: AddDiagnostic,
): void {
  checkUnknownKeys(value, FORMAT_KEYS, path, add);
  const style = own(value, "style");
  if (style !== undefined && !oneOf(style, FORMAT_STYLES)) {
    add(
      DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE,
      `${path}/style`,
      "A format style must be decimal, percent, currency or compact.",
    );
  }
  for (const key of ["unit", "currency"]) {
    const entry = own(value, key);
    if (entry !== undefined && typeof entry !== "string") {
      add(DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE, `${path}/${key}`);
    }
  }
  const precision = own(value, "precision");
  if (
    precision !== undefined &&
    (typeof precision !== "number" ||
      !Number.isInteger(precision) ||
      precision < 0 ||
      precision > 20)
  ) {
    add(
      DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE,
      `${path}/precision`,
      "Format precision must be an integer between 0 and 20.",
    );
  }
  const dateStyle = own(value, "dateStyle");
  if (dateStyle !== undefined && !oneOf(dateStyle, DATE_STYLES)) {
    add(DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE, `${path}/dateStyle`);
  }
  const timeStyle = own(value, "timeStyle");
  if (timeStyle !== undefined && !oneOf(timeStyle, TIME_STYLES)) {
    add(DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE, `${path}/timeStyle`);
  }
  const timezone = own(value, "timezone");
  if (timezone !== undefined && (typeof timezone !== "string" || !isValidTimeZone(timezone))) {
    add(DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE, `${path}/timezone`);
  }
}

export function validateAggregation(
  value: Record<string, unknown>,
  datasetId: string | undefined,
  bindingFieldInfo: FieldInfo | null,
  path: string,
  context: ReferenceContext,
  add: AddDiagnostic,
): void {
  checkUnknownKeys(value, AGGREGATION_KEYS, path, add);
  const type = own(value, "type");
  if (!oneOf(type, AGGREGATION_TYPES)) {
    add(
      DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE,
      `${path}/type`,
      "An aggregation type must be a supported aggregation name.",
    );
  }
  let fieldInfo = bindingFieldInfo;
  const fieldId = own(value, "fieldId");
  if (fieldId !== undefined) {
    if (!nonEmptyString(fieldId)) {
      add(DIAGNOSTIC_CODES.MISSING_ID, `${path}/fieldId`);
      fieldInfo = null;
    } else if (datasetId !== undefined) {
      fieldInfo = resolveFieldId(datasetId, fieldId, `${path}/fieldId`, context, add);
    }
  }
  if (oneOf(type, AGGREGATION_TYPES) && fieldInfo?.type) {
    const numericRequired = type === "sum" || type === "average" || type === "median";
    const orderedRequired = numericRequired || type === "min" || type === "max";
    if (
      (numericRequired && fieldInfo.type !== "number") ||
      (orderedRequired &&
        fieldInfo.type !== "number" &&
        fieldInfo.type !== "date" &&
        fieldInfo.type !== "datetime")
    ) {
      add(
        DIAGNOSTIC_CODES.INCOMPATIBLE_BINDING,
        `${path}/type`,
        `Aggregation "${type}" is not compatible with field type "${fieldInfo.type}".`,
      );
    }
  }
}

export function validateTemporalBucket(
  value: unknown,
  fieldInfo: FieldInfo | null,
  path: string,
  add: AddDiagnostic,
): void {
  if (!isRecord(value)) {
    add(DIAGNOSTIC_CODES.INCOMPATIBLE_BINDING, path);
    return;
  }
  checkUnknownKeys(value, BUCKET_KEYS, path, add);
  const grain = own(value, "grain");
  if (!oneOf(grain, BUCKET_GRAINS)) {
    add(DIAGNOSTIC_CODES.INCOMPATIBLE_BINDING, `${path}/grain`);
  }
  const timezone = own(value, "timezone");
  if (typeof timezone !== "string" || !isValidTimeZone(timezone)) {
    add(DIAGNOSTIC_CODES.INCOMPATIBLE_BINDING, `${path}/timezone`);
  }
  const weekStartsOn = own(value, "weekStartsOn");
  if (weekStartsOn !== undefined && !oneOf(weekStartsOn, WEEK_STARTS)) {
    add(DIAGNOSTIC_CODES.INCOMPATIBLE_BINDING, `${path}/weekStartsOn`);
  }
  if (grain === "week" && weekStartsOn === undefined) {
    add(
      DIAGNOSTIC_CODES.INCOMPATIBLE_BINDING,
      `${path}/weekStartsOn`,
      "Week buckets must declare their week start.",
    );
  }
  if (fieldInfo?.type !== undefined && fieldInfo.type !== "date" && fieldInfo.type !== "datetime") {
    add(
      DIAGNOSTIC_CODES.INCOMPATIBLE_BINDING,
      path,
      "Temporal bucketing requires a date or datetime field.",
    );
  }
}

export function validateBlock(
  block: ScannedEntry,
  context: ReferenceContext,
  add: AddDiagnostic,
): void {
  const value = block.value;
  const path = block.path;
  checkUnknownKeys(value, BLOCK_KEYS, path, add);
  const type = own(value, "type");
  if (!nonEmptyString(type)) {
    add(DIAGNOSTIC_CODES.MISSING_REQUIRED_PROPERTY, `${path}/type`);
    return;
  }
  const registered =
    context.catalog !== undefined &&
    Object.hasOwn(context.catalog, "blockTypes") &&
    Array.isArray(context.catalog.blockTypes)
      ? context.catalog.blockTypes
      : [];
  const builtIn = (BOARD_BLOCK_TYPES as readonly string[]).includes(type);
  if (!builtIn && !registered.includes(type)) {
    add(DIAGNOSTIC_CODES.UNKNOWN_BLOCK_TYPE, `${path}/type`, undefined, {
      relatedIds: [type],
    });
  }
  const title = own(value, "title");
  if (title !== undefined && typeof title !== "string") {
    add(DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE, `${path}/title`);
  }
  const groupId = own(value, "groupId");
  if (groupId !== undefined) {
    if (!nonEmptyString(groupId)) {
      add(DIAGNOSTIC_CODES.MISSING_ID, `${path}/groupId`);
    } else if (!context.groups.has(groupId)) {
      add(DIAGNOSTIC_CODES.INVALID_REFERENCE, `${path}/groupId`, undefined, {
        relatedIds: [groupId],
      });
    }
  }

  const bindingIds = new Map<string, Record<string, unknown>>();
  const matrixBindings: ParsedMatrixBinding[] = [];
  const bindings = own(value, "bindings");
  if (bindings !== undefined) {
    if (!Array.isArray(bindings)) {
      add(DIAGNOSTIC_CODES.INCOMPATIBLE_BINDING, `${path}/bindings`);
    } else {
      const roleCandidate = Object.hasOwn(BINDING_ROLES_BY_BLOCK, type)
        ? BINDING_ROLES_BY_BLOCK[type]
        : undefined;
      const allowedRoles = Array.isArray(roleCandidate) ? roleCandidate : undefined;
      bindings.forEach((entry, index) => {
        const bindingPath = `${path}/bindings/${index}`;
        if (!isRecord(entry)) {
          add(DIAGNOSTIC_CODES.INCOMPATIBLE_BINDING, bindingPath);
          return;
        }
        checkUnknownKeys(entry, BINDING_KEYS, bindingPath, add);
        const id = own(entry, "id");
        if (!nonEmptyString(id)) {
          add(DIAGNOSTIC_CODES.MISSING_ID, `${bindingPath}/id`);
        } else if (bindingIds.has(id)) {
          add(DIAGNOSTIC_CODES.DUPLICATE_ID, `${bindingPath}/id`, undefined, {
            relatedIds: [id],
          });
        } else {
          bindingIds.set(id, entry);
        }
        const role = own(entry, "role");
        if (!oneOf(role, BINDING_ROLES)) {
          add(DIAGNOSTIC_CODES.INCOMPATIBLE_BINDING, `${bindingPath}/role`);
        } else if (allowedRoles && !allowedRoles.includes(role)) {
          add(
            DIAGNOSTIC_CODES.INCOMPATIBLE_BINDING,
            `${bindingPath}/role`,
            `Binding role "${role}" is not compatible with block type "${type}".`,
          );
        }
        const mode = own(entry, "mode");
        if (mode !== undefined && !oneOf(mode, BINDING_MODES)) {
          add(
            DIAGNOSTIC_CODES.INCOMPATIBLE_BINDING,
            `${bindingPath}/mode`,
            "A binding mode must be selectable or fixed.",
          );
        }
        const axis = own(entry, "axis");
        if (axis !== undefined && !oneOf(axis, BINDING_AXES)) {
          add(
            DIAGNOSTIC_CODES.INCOMPATIBLE_BINDING,
            `${bindingPath}/axis`,
            "A binding axis must be x, y or none.",
          );
        }
        const field = own(entry, "field");
        let datasetId: string | undefined;
        let bindingFieldInfo: FieldInfo | null = null;
        if (!isRecord(field)) {
          add(DIAGNOSTIC_CODES.MISSING_REQUIRED_PROPERTY, `${bindingPath}/field`);
        } else {
          bindingFieldInfo = resolveFieldReference(field, `${bindingPath}/field`, context, add);
          const value = own(field, "datasetId");
          if (typeof value === "string") {
            datasetId = value;
          }
        }
        const bucket = own(entry, "bucket");
        if (bucket !== undefined) {
          validateTemporalBucket(bucket, bindingFieldInfo, `${bindingPath}/bucket`, add);
        }
        const sliceId = own(entry, "sliceId");
        if (sliceId !== undefined) {
          if (!nonEmptyString(sliceId)) {
            add(DIAGNOSTIC_CODES.MISSING_ID, `${bindingPath}/sliceId`);
          } else if (datasetId !== undefined) {
            resolveSlice(datasetId, sliceId, `${bindingPath}/sliceId`, context, add);
          }
        }
        const aggregation = own(entry, "aggregation");
        if (aggregation !== undefined) {
          if (!isRecord(aggregation)) {
            add(DIAGNOSTIC_CODES.INCOMPATIBLE_BINDING, `${bindingPath}/aggregation`);
          } else {
            validateAggregation(
              aggregation,
              datasetId,
              bindingFieldInfo,
              `${bindingPath}/aggregation`,
              context,
              add,
            );
          }
        }
        const format = own(entry, "format");
        if (format !== undefined) {
          if (!isRecord(format)) {
            add(DIAGNOSTIC_CODES.INCOMPATIBLE_BINDING, `${bindingPath}/format`);
          } else {
            validateFormat(format, `${bindingPath}/format`, add);
          }
        }
        const label = own(entry, "label");
        if (label !== undefined && typeof label !== "string") {
          add(DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE, `${bindingPath}/label`);
        }
        matrixBindings.push({
          role: oneOf(role, BINDING_ROLES) ? role : null,
          axis: oneOf(axis, BINDING_AXES) ? axis : null,
          field: bindingFieldInfo,
          ...(isRecord(bucket) && oneOf(own(bucket, "grain"), BUCKET_GRAINS)
            ? { grain: own(bucket, "grain") as string }
            : {}),
          aggregation:
            isRecord(aggregation) && oneOf(own(aggregation, "type"), AGGREGATION_TYPES)
              ? (own(aggregation, "type") as string)
              : null,
          path: bindingPath,
        });
      });
    }
  }

  const config = own(value, "config");
  if (!isRecord(config)) {
    add(DIAGNOSTIC_CODES.MISSING_REQUIRED_PROPERTY, `${path}/config`);
    return;
  }
  if (!builtIn) {
    return;
  }
  if (type === "chart") {
    checkUnknownKeys(config, CHART_CONFIG_KEYS, `${path}/config`, add);
    const visualization = own(config, "visualization");
    if (!oneOf(visualization, CHART_TYPES)) {
      add(DIAGNOSTIC_CODES.UNKNOWN_RENDERER_TYPE, `${path}/config/visualization`);
    }
    const comparisonId = own(config, "comparisonId");
    if (comparisonId !== undefined) {
      if (!nonEmptyString(comparisonId)) {
        add(DIAGNOSTIC_CODES.MISSING_ID, `${path}/config/comparisonId`);
      } else if (!context.comparisons.has(comparisonId)) {
        add(DIAGNOSTIC_CODES.INVALID_REFERENCE, `${path}/config/comparisonId`, undefined, {
          relatedIds: [comparisonId],
        });
      }
    }
    const options = own(config, "options");
    if (options !== undefined) {
      if (!isRecord(options)) {
        add(DIAGNOSTIC_CODES.INCOMPATIBLE_BINDING, `${path}/config/options`);
      } else {
        checkUnknownKeys(options, CHART_OPTION_KEYS, `${path}/config/options`, add);
        const stacked = own(options, "stacked");
        if (stacked !== undefined && typeof stacked !== "boolean") {
          add(DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE, `${path}/config/options/stacked`);
        }
        const legend = own(options, "legend");
        if (legend !== undefined && legend !== "hidden" && legend !== "visible") {
          add(DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE, `${path}/config/options/legend`);
        }
        const categoryOrder = own(options, "categoryOrder");
        if (categoryOrder !== undefined && !oneOf(categoryOrder, CATEGORY_ORDERS)) {
          add(
            DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE,
            `${path}/config/options/categoryOrder`,
            "A category order must be declared, data, ascending or descending.",
          );
        }
        const binnedX = own(options, "binnedX");
        if (binnedX !== undefined && typeof binnedX !== "boolean") {
          add(DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE, `${path}/config/options/binnedX`);
        }
        for (const axisKey of ["xAxis", "yAxis"] as const) {
          const axis = own(options, axisKey);
          if (axis !== undefined) {
            if (!isRecord(axis)) {
              add(DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE, `${path}/config/options/${axisKey}`);
            } else {
              checkUnknownKeys(axis, CHART_AXIS_KEYS, `${path}/config/options/${axisKey}`, add);
              for (const key of ["label", "unit"]) {
                const entry = own(axis, key);
                if (entry !== undefined && typeof entry !== "string") {
                  add(
                    DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE,
                    `${path}/config/options/${axisKey}/${key}`,
                  );
                }
              }
              for (const key of ["min", "max"]) {
                const entry = own(axis, key);
                if (entry !== undefined && (typeof entry !== "number" || !Number.isFinite(entry))) {
                  add(
                    DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE,
                    `${path}/config/options/${axisKey}/${key}`,
                  );
                }
              }
            }
          }
        }
      }
    }
    validateFieldMatrix(
      "chart",
      visualization as VisualizationKind,
      config,
      matrixBindings,
      path,
      add,
    );
    return;
  }
  if (type === "metric") {
    checkUnknownKeys(config, METRIC_CONFIG_KEYS, `${path}/config`, add);
    const comparisonId = own(config, "comparisonId");
    if (comparisonId !== undefined) {
      if (!nonEmptyString(comparisonId)) {
        add(DIAGNOSTIC_CODES.MISSING_ID, `${path}/config/comparisonId`);
      } else if (!context.comparisons.has(comparisonId)) {
        add(DIAGNOSTIC_CODES.INVALID_REFERENCE, `${path}/config/comparisonId`, undefined, {
          relatedIds: [comparisonId],
        });
      }
    }
    const format = own(config, "format");
    if (format !== undefined) {
      if (!isRecord(format)) {
        add(DIAGNOSTIC_CODES.INCOMPATIBLE_BINDING, `${path}/config/format`);
      } else {
        validateFormat(format, `${path}/config/format`, add);
      }
    }
    validateFieldMatrix("metric", "kpi", config, matrixBindings, path, add);
    return;
  }
  if (type === "table") {
    checkUnknownKeys(config, TABLE_CONFIG_KEYS, `${path}/config`, add);
    const pageSize = own(config, "pageSize");
    if (
      pageSize !== undefined &&
      (typeof pageSize !== "number" ||
        !Number.isInteger(pageSize) ||
        pageSize < 1 ||
        pageSize > 10_000)
    ) {
      add(DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE, `${path}/config/pageSize`);
    }
    const columns = own(config, "columns");
    if (columns !== undefined) {
      if (!Array.isArray(columns)) {
        add(DIAGNOSTIC_CODES.INCOMPATIBLE_BINDING, `${path}/config/columns`);
      } else {
        const seen = new Set<string>();
        columns.forEach((column, index) => {
          const columnPath = `${path}/config/columns/${index}`;
          if (!nonEmptyString(column)) {
            add(DIAGNOSTIC_CODES.MISSING_ID, columnPath);
            return;
          }
          if (seen.has(column)) {
            add(DIAGNOSTIC_CODES.DUPLICATE_ID, columnPath, undefined, {
              relatedIds: [column],
            });
          }
          seen.add(column);
          if (!bindingIds.has(column)) {
            add(DIAGNOSTIC_CODES.INVALID_REFERENCE, columnPath, undefined, {
              relatedIds: [column],
            });
          }
        });
      }
    }
    const sort = own(config, "sort");
    if (sort !== undefined) {
      if (!isRecord(sort)) {
        add(DIAGNOSTIC_CODES.INCOMPATIBLE_BINDING, `${path}/config/sort`);
      } else {
        checkUnknownKeys(sort, TABLE_SORT_KEYS, `${path}/config/sort`, add);
        const bindingId = own(sort, "bindingId");
        if (!nonEmptyString(bindingId)) {
          add(DIAGNOSTIC_CODES.MISSING_ID, `${path}/config/sort/bindingId`);
        } else if (!bindingIds.has(bindingId)) {
          add(DIAGNOSTIC_CODES.INVALID_REFERENCE, `${path}/config/sort/bindingId`, undefined, {
            relatedIds: [bindingId],
          });
        }
        const direction = own(sort, "direction");
        if (direction !== "ascending" && direction !== "descending") {
          add(DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE, `${path}/config/sort/direction`);
        }
      }
    }
    return;
  }
  if (type === "text") {
    checkUnknownKeys(config, TEXT_CONFIG_KEYS, `${path}/config`, add);
    const text = own(config, "text");
    if (typeof text !== "string") {
      add(DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE, `${path}/config/text`);
    }
    return;
  }
  checkUnknownKeys(config, FILTER_CONFIG_KEYS, `${path}/config`, add);
  const filterIds = own(config, "filterIds");
  if (!Array.isArray(filterIds) || filterIds.length === 0) {
    add(DIAGNOSTIC_CODES.INCOMPATIBLE_BINDING, `${path}/config/filterIds`);
    return;
  }
  const seen = new Set<string>();
  filterIds.forEach((filterId, index) => {
    const filterPath = `${path}/config/filterIds/${index}`;
    if (!nonEmptyString(filterId)) {
      add(DIAGNOSTIC_CODES.MISSING_ID, filterPath);
      return;
    }
    if (seen.has(filterId)) {
      add(DIAGNOSTIC_CODES.DUPLICATE_ID, filterPath, undefined, { relatedIds: [filterId] });
      return;
    }
    seen.add(filterId);
    if (!context.filters.has(filterId)) {
      add(DIAGNOSTIC_CODES.INVALID_REFERENCE, filterPath, undefined, {
        relatedIds: [filterId],
      });
    }
  });
}
