import {
  BUCKET_GRAINS,
  FILTER_OPERATORS,
  LAYOUT_BOUNDS,
  WEEK_STARTS,
  type BucketGrain,
  type FieldValueType,
  type FilterOperator,
  type WeekStart,
} from "./board-schema.js";
import {
  isIsoTemporalString,
  isRecord,
  nonEmptyString,
  oneOf,
  own,
} from "./board-validation-shared.js";
import {
  FILTER_OPERATORS_BY_FIELD_TYPE,
  validateFilterValue,
  valueMatchesFieldType,
} from "./board-validation-filter.js";
import {
  QUERY_AGGREGATION_TYPES,
  QUERY_OPERATIONS,
  type DatasetDescriptor,
  type DatasetSliceDescriptor,
  type DataFieldDescriptor,
  type QueryAggregation,
  type QueryAggregationType,
  type QueryComparisonInput,
  type QueryFilter,
  type QueryGrouping,
  type QueryOperation,
  type QueryOrder,
  type QueryRequest,
  type QueryResultField,
  type QuerySpec,
  type QueryTimeWindow,
} from "./data-contract.js";
import {
  DIAGNOSTIC_CODES,
  createDiagnostic,
  fail,
  hasError,
  ok,
  type Diagnostic,
  type Result,
} from "./diagnostics.js";
import {
  canonicalJson,
  cloneJson,
  deepFreeze,
  validateJsonValue,
  type JsonObject,
  type JsonValue,
} from "./json.js";
import { isValidTimeZone } from "./locale.js";
import { temporalInstant } from "./temporal.js";

export interface CanonicalQueryKey {
  readonly value: string;
  readonly components: Readonly<JsonObject>;
}

export interface QueryPlan {
  readonly dataset: DatasetDescriptor;
  readonly slice: DatasetSliceDescriptor | null;
  readonly request: QueryRequest;
  readonly key: CanonicalQueryKey;
  readonly operations: readonly QueryOperation[];
  readonly outputFields: readonly QueryResultField[];
}

export interface BuildQueryPlanOptions {
  readonly providerId?: string;
}

const SPEC_KEYS = new Set([
  "datasetId",
  "sliceId",
  "datasetVersion",
  "fields",
  "groupBy",
  "aggregations",
  "filters",
  "timeWindow",
  "orderBy",
  "limit",
  "cursor",
  "comparisonInput",
]);
const GROUP_KEYS = new Set(["fieldId", "bucket"]);
const BUCKET_KEYS = new Set(["grain", "timezone", "weekStartsOn"]);
const AGGREGATION_KEYS = new Set(["output", "type", "fieldId"]);
const FILTER_KEYS = new Set(["id", "fieldId", "operator", "value", "timezone", "bounds"]);
const WINDOW_KEYS = new Set(["fieldId", "start", "end", "timezone", "bounds"]);
const ORDER_KEYS = new Set(["key", "direction"]);
const COMPARISON_KEYS = new Set(["comparisonId", "side", "inputId"]);

const TEMPORAL_FILTER_OPERATORS: ReadonlySet<FilterOperator> = new Set([
  "before",
  "after",
  "onOrBefore",
  "onOrAfter",
  "between",
]);

function addDiagnostic(
  diagnostics: Diagnostic[],
  code: string,
  path: string,
  message?: string,
  extra?: {
    readonly severity?: "error" | "warning";
    readonly hint?: string;
    readonly relatedIds?: readonly string[];
    readonly source?: string;
  },
): void {
  diagnostics.push(
    createDiagnostic(code, path, {
      ...(message === undefined ? {} : { message }),
      ...(extra === undefined ? {} : extra),
    }),
  );
}

function unknownKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
  diagnostics: Diagnostic[],
): void {
  for (const key of Object.getOwnPropertyNames(value)) {
    if (!allowed.has(key)) {
      addDiagnostic(
        diagnostics,
        DIAGNOSTIC_CODES.QUERY_INVALID,
        `${path}/${key}`,
        `Property "${key}" is not part of a query request.`,
      );
    }
  }
}

function isArrayIndexKey(key: string, length: number): boolean {
  if (key === "") {
    return false;
  }
  const index = Number(key);
  return String(index) === key && Number.isInteger(index) && index >= 0 && index < length;
}

function isDenseArray(value: unknown, path: string, diagnostics: Diagnostic[]): value is unknown[] {
  if (!Array.isArray(value)) {
    addDiagnostic(
      diagnostics,
      DIAGNOSTIC_CODES.QUERY_INVALID,
      path,
      "A query collection must be an array.",
    );
    return false;
  }
  let valid = true;
  if (Object.getOwnPropertySymbols(value).length > 0) {
    addDiagnostic(
      diagnostics,
      DIAGNOSTIC_CODES.QUERY_INVALID,
      `${path}/[symbol]`,
      "Symbol properties are not valid query collection entries.",
    );
    valid = false;
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    if (key === "length") {
      continue;
    }
    if (!isArrayIndexKey(key, value.length)) {
      addDiagnostic(
        diagnostics,
        DIAGNOSTIC_CODES.QUERY_INVALID,
        `${path}/${key}`,
        "Query collections may only contain indexed entries.",
      );
      valid = false;
    }
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, String(index))) {
      addDiagnostic(
        diagnostics,
        DIAGNOSTIC_CODES.QUERY_INVALID,
        `${path}/${index}`,
        "Query collections must not be sparse.",
      );
      valid = false;
    }
  }
  return valid;
}

function isTemporalType(type: FieldValueType): boolean {
  return type === "date" || type === "datetime";
}

function lexicalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function outputTypeFor(
  aggregation: QueryAggregationType,
  source: DataFieldDescriptor | undefined,
): FieldValueType {
  if (
    aggregation === "count" ||
    aggregation === "countDistinct" ||
    aggregation === "sum" ||
    aggregation === "average" ||
    aggregation === "median"
  ) {
    return "number";
  }
  return source?.type ?? "number";
}

function aggregationAllowed(
  aggregation: QueryAggregationType,
  field: DataFieldDescriptor | undefined,
  path: string,
  diagnostics: Diagnostic[],
): boolean {
  if (aggregation === "count") {
    return true;
  }
  if (!field) {
    addDiagnostic(
      diagnostics,
      DIAGNOSTIC_CODES.QUERY_INVALID,
      `${path}/fieldId`,
      `Aggregation "${aggregation}" requires a source field.`,
    );
    return false;
  }
  if (aggregation === "countDistinct" || aggregation === "mode") {
    return true;
  }
  if (aggregation === "sum" || aggregation === "average" || aggregation === "median") {
    if (field.type !== "number") {
      addDiagnostic(
        diagnostics,
        DIAGNOSTIC_CODES.INCOMPATIBLE_BINDING,
        `${path}/type`,
        `Aggregation "${aggregation}" requires a numeric measure.`,
      );
      return false;
    }
    return true;
  }
  if (field.type === "boolean") {
    addDiagnostic(
      diagnostics,
      DIAGNOSTIC_CODES.INCOMPATIBLE_BINDING,
      `${path}/type`,
      `Aggregation "${aggregation}" requires an ordered field type.`,
    );
    return false;
  }
  return true;
}

function normalizeGrouping(
  value: unknown,
  index: number,
  fields: ReadonlyMap<string, DataFieldDescriptor>,
  descriptor: DatasetDescriptor,
  diagnostics: Diagnostic[],
): QueryGrouping | null {
  const path = `/groupBy/${index}`;
  if (!isRecord(value)) {
    addDiagnostic(
      diagnostics,
      DIAGNOSTIC_CODES.QUERY_INVALID,
      path,
      "A grouping must be an object.",
    );
    return null;
  }
  unknownKeys(value, GROUP_KEYS, path, diagnostics);
  const fieldId = own(value, "fieldId");
  if (!nonEmptyString(fieldId)) {
    addDiagnostic(diagnostics, DIAGNOSTIC_CODES.MISSING_ID, `${path}/fieldId`);
    return null;
  }
  const field = fields.get(fieldId);
  if (!field) {
    addDiagnostic(diagnostics, DIAGNOSTIC_CODES.INVALID_REFERENCE, `${path}/fieldId`, undefined, {
      relatedIds: [fieldId],
    });
    return null;
  }
  if (field.role === "measure") {
    addDiagnostic(
      diagnostics,
      DIAGNOSTIC_CODES.INCOMPATIBLE_BINDING,
      `${path}/fieldId`,
      "A measure field cannot be used as a grouping field.",
    );
    return null;
  }
  const bucketValue = own(value, "bucket");
  if (bucketValue === undefined) {
    return Object.freeze({ fieldId });
  }
  if (!isRecord(bucketValue)) {
    addDiagnostic(diagnostics, DIAGNOSTIC_CODES.QUERY_INVALID, `${path}/bucket`);
    return null;
  }
  unknownKeys(bucketValue, BUCKET_KEYS, `${path}/bucket`, diagnostics);
  const grain = own(bucketValue, "grain");
  if (!oneOf(grain, BUCKET_GRAINS)) {
    addDiagnostic(diagnostics, DIAGNOSTIC_CODES.QUERY_INVALID, `${path}/bucket/grain`);
    return null;
  }
  const timezone = own(bucketValue, "timezone");
  if (typeof timezone !== "string" || !isValidTimeZone(timezone)) {
    addDiagnostic(diagnostics, DIAGNOSTIC_CODES.INVALID_TIMEZONE, `${path}/bucket/timezone`);
    return null;
  }
  const weekStartsOn = own(bucketValue, "weekStartsOn");
  if (weekStartsOn !== undefined && !oneOf(weekStartsOn, WEEK_STARTS)) {
    addDiagnostic(diagnostics, DIAGNOSTIC_CODES.QUERY_INVALID, `${path}/bucket/weekStartsOn`);
    return null;
  }
  if (grain === "week" && weekStartsOn === undefined) {
    addDiagnostic(
      diagnostics,
      DIAGNOSTIC_CODES.QUERY_INVALID,
      `${path}/bucket/weekStartsOn`,
      "A week bucket must declare its week start.",
    );
    return null;
  }
  if (!isTemporalType(field.type)) {
    addDiagnostic(
      diagnostics,
      DIAGNOSTIC_CODES.INCOMPATIBLE_BINDING,
      `${path}/bucket`,
      "Temporal bucketing requires a date or datetime field.",
    );
    return null;
  }
  const fieldTimezone = field.timezone ?? descriptor.timezone;
  if (timezone !== fieldTimezone && !descriptor.capabilities.timezoneConversion) {
    addDiagnostic(
      diagnostics,
      DIAGNOSTIC_CODES.PROVIDER_CAPABILITY_MISMATCH,
      `${path}/bucket/timezone`,
      "The dataset does not declare timezone conversion capability.",
    );
    return null;
  }
  return Object.freeze({
    fieldId,
    bucket: Object.freeze({
      grain: grain as BucketGrain,
      timezone,
      ...(weekStartsOn === undefined ? {} : { weekStartsOn: weekStartsOn as WeekStart }),
    }),
  });
}

function normalizeAggregation(
  value: unknown,
  index: number,
  fields: ReadonlyMap<string, DataFieldDescriptor>,
  descriptor: DatasetDescriptor,
  diagnostics: Diagnostic[],
): QueryAggregation | null {
  const path = `/aggregations/${index}`;
  if (!isRecord(value)) {
    addDiagnostic(
      diagnostics,
      DIAGNOSTIC_CODES.QUERY_INVALID,
      path,
      "An aggregation must be an object.",
    );
    return null;
  }
  unknownKeys(value, AGGREGATION_KEYS, path, diagnostics);
  const output = own(value, "output");
  if (!nonEmptyString(output)) {
    addDiagnostic(diagnostics, DIAGNOSTIC_CODES.MISSING_ID, `${path}/output`);
    return null;
  }
  const type = own(value, "type");
  if (!oneOf(type, QUERY_AGGREGATION_TYPES)) {
    addDiagnostic(diagnostics, DIAGNOSTIC_CODES.QUERY_INVALID, `${path}/type`);
    return null;
  }
  if (!descriptor.capabilities.aggregations.includes(type)) {
    addDiagnostic(
      diagnostics,
      DIAGNOSTIC_CODES.PROVIDER_CAPABILITY_MISMATCH,
      `${path}/type`,
      `The dataset does not declare the "${type}" aggregation capability.`,
    );
    return null;
  }
  const fieldId = own(value, "fieldId");
  if (fieldId !== undefined && !nonEmptyString(fieldId)) {
    addDiagnostic(diagnostics, DIAGNOSTIC_CODES.MISSING_ID, `${path}/fieldId`);
    return null;
  }
  const field = nonEmptyString(fieldId) ? fields.get(fieldId) : undefined;
  if (nonEmptyString(fieldId) && !field) {
    addDiagnostic(diagnostics, DIAGNOSTIC_CODES.INVALID_REFERENCE, `${path}/fieldId`, undefined, {
      relatedIds: [fieldId],
    });
    return null;
  }
  if (!aggregationAllowed(type, field, path, diagnostics)) {
    return null;
  }
  return Object.freeze({
    output,
    type,
    ...(fieldId === undefined ? {} : { fieldId }),
  });
}

function normalizeFilter(
  value: unknown,
  index: number,
  fields: ReadonlyMap<string, DataFieldDescriptor>,
  descriptor: DatasetDescriptor,
  diagnostics: Diagnostic[],
): QueryFilter | null {
  const path = `/filters/${index}`;
  if (!isRecord(value)) {
    addDiagnostic(diagnostics, DIAGNOSTIC_CODES.QUERY_INVALID, path, "A filter must be an object.");
    return null;
  }
  unknownKeys(value, FILTER_KEYS, path, diagnostics);
  const id = own(value, "id");
  if (id !== undefined && !nonEmptyString(id)) {
    addDiagnostic(diagnostics, DIAGNOSTIC_CODES.MISSING_ID, `${path}/id`);
    return null;
  }
  const fieldId = own(value, "fieldId");
  if (!nonEmptyString(fieldId)) {
    addDiagnostic(diagnostics, DIAGNOSTIC_CODES.MISSING_ID, `${path}/fieldId`);
    return null;
  }
  const field = fields.get(fieldId);
  if (!field) {
    addDiagnostic(diagnostics, DIAGNOSTIC_CODES.INVALID_REFERENCE, `${path}/fieldId`, undefined, {
      relatedIds: [fieldId],
    });
    return null;
  }
  const operator = own(value, "operator");
  if (!oneOf(operator, FILTER_OPERATORS)) {
    addDiagnostic(diagnostics, DIAGNOSTIC_CODES.INCOMPATIBLE_FILTER, `${path}/operator`);
    return null;
  }
  const declaredOperators = field.operators ?? descriptor.capabilities.filterOperators;
  if (!declaredOperators.includes(operator)) {
    addDiagnostic(
      diagnostics,
      DIAGNOSTIC_CODES.PROVIDER_CAPABILITY_MISMATCH,
      `${path}/operator`,
      `The provider does not declare the "${operator}" filter operator.`,
    );
    return null;
  }
  const typeOperators = FILTER_OPERATORS_BY_FIELD_TYPE[field.type];
  if (!typeOperators.includes(operator)) {
    addDiagnostic(
      diagnostics,
      DIAGNOSTIC_CODES.INCOMPATIBLE_FILTER,
      `${path}/operator`,
      `Operator "${operator}" is not compatible with field type "${field.type}".`,
    );
    return null;
  }
  const filterValue = own(value, "value");
  validateFilterValue(
    operator,
    filterValue,
    field.type,
    `${path}/value`,
    (code, issuePath, message, extra) => {
      addDiagnostic(diagnostics, code, issuePath, message, extra);
    },
  );
  if (filterValue !== undefined) {
    const json = validateJsonValue(filterValue);
    if (!json.valid) {
      for (const issue of json.issues) {
        addDiagnostic(diagnostics, DIAGNOSTIC_CODES.QUERY_INVALID, issue.path, issue.message);
      }
      return null;
    }
    const entries = Array.isArray(filterValue) ? filterValue : [filterValue];
    for (const entry of entries) {
      if (!valueMatchesFieldType(entry, field.type)) {
        addDiagnostic(diagnostics, DIAGNOSTIC_CODES.INCOMPATIBLE_FILTER, `${path}/value`);
        return null;
      }
    }
  }
  const timezone = own(value, "timezone");
  if (timezone !== undefined && (typeof timezone !== "string" || !isValidTimeZone(timezone))) {
    addDiagnostic(diagnostics, DIAGNOSTIC_CODES.INVALID_TIMEZONE, `${path}/timezone`);
    return null;
  }
  const bounds = own(value, "bounds");
  if (bounds !== undefined && !oneOf(bounds, LAYOUT_BOUNDS)) {
    addDiagnostic(diagnostics, DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE, `${path}/bounds`);
    return null;
  }
  const temporal = isTemporalType(field.type) && TEMPORAL_FILTER_OPERATORS.has(operator);
  const resolvedTimezone = temporal
    ? typeof timezone === "string"
      ? timezone
      : (field.timezone ?? descriptor.timezone)
    : typeof timezone === "string"
      ? timezone
      : undefined;
  if (temporal && operator === "between" && bounds === undefined) {
    addDiagnostic(
      diagnostics,
      DIAGNOSTIC_CODES.INCOMPATIBLE_FILTER,
      `${path}/bounds`,
      "A temporal range filter must declare its boundary rule.",
    );
    return null;
  }
  const fieldTimezone = field.timezone ?? descriptor.timezone;
  if (
    isTemporalType(field.type) &&
    typeof timezone === "string" &&
    timezone !== fieldTimezone &&
    !descriptor.capabilities.timezoneConversion
  ) {
    addDiagnostic(
      diagnostics,
      DIAGNOSTIC_CODES.PROVIDER_CAPABILITY_MISMATCH,
      `${path}/timezone`,
      "The dataset does not declare timezone conversion capability.",
    );
    return null;
  }
  if (field.type === "date" && filterValue !== undefined) {
    const dateTimezone =
      typeof timezone === "string" ? timezone : (field.timezone ?? descriptor.timezone);
    const entries = Array.isArray(filterValue) ? filterValue : [filterValue];
    for (const entry of entries) {
      if (temporalInstant(entry, "date", dateTimezone, "iso8601-offset") === null) {
        addDiagnostic(
          diagnostics,
          DIAGNOSTIC_CODES.INCOMPATIBLE_FILTER,
          `${path}/value`,
          "The date-only value does not occur in the declared timezone.",
        );
        return null;
      }
    }
  }
  const snapshotValue =
    filterValue === undefined
      ? undefined
      : (deepFreeze(cloneJson(filterValue as JsonValue)) as JsonValue);
  return Object.freeze({
    ...(id === undefined ? {} : { id }),
    fieldId,
    operator,
    ...(snapshotValue === undefined ? {} : { value: snapshotValue }),
    ...(resolvedTimezone === undefined ? {} : { timezone: resolvedTimezone }),
    ...(bounds === undefined ? {} : { bounds: bounds as (typeof LAYOUT_BOUNDS)[number] }),
  });
}

function normalizeWindow(
  value: unknown,
  fields: ReadonlyMap<string, DataFieldDescriptor>,
  descriptor: DatasetDescriptor,
  diagnostics: Diagnostic[],
): QueryTimeWindow | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  const path = "/timeWindow";
  if (!isRecord(value)) {
    addDiagnostic(diagnostics, DIAGNOSTIC_CODES.QUERY_INVALID, path);
    return null;
  }
  unknownKeys(value, WINDOW_KEYS, path, diagnostics);
  const fieldId = own(value, "fieldId");
  if (!nonEmptyString(fieldId)) {
    addDiagnostic(diagnostics, DIAGNOSTIC_CODES.MISSING_ID, `${path}/fieldId`);
    return null;
  }
  const field = fields.get(fieldId);
  if (!field) {
    addDiagnostic(diagnostics, DIAGNOSTIC_CODES.INVALID_REFERENCE, `${path}/fieldId`, undefined, {
      relatedIds: [fieldId],
    });
    return null;
  }
  if (!isTemporalType(field.type)) {
    addDiagnostic(
      diagnostics,
      DIAGNOSTIC_CODES.INCOMPATIBLE_FILTER,
      `${path}/fieldId`,
      "A time window requires a date or datetime field.",
    );
    return null;
  }
  if (!descriptor.capabilities.timeWindow) {
    addDiagnostic(
      diagnostics,
      DIAGNOSTIC_CODES.PROVIDER_CAPABILITY_MISMATCH,
      path,
      "The dataset does not declare time window capability.",
    );
    return null;
  }
  const timezone = own(value, "timezone");
  if (typeof timezone !== "string" || !isValidTimeZone(timezone)) {
    addDiagnostic(diagnostics, DIAGNOSTIC_CODES.INVALID_TIMEZONE, `${path}/timezone`);
    return null;
  }
  const bounds = own(value, "bounds");
  if (!oneOf(bounds, LAYOUT_BOUNDS)) {
    addDiagnostic(diagnostics, DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE, `${path}/bounds`);
    return null;
  }
  const fieldTimezone = field.timezone ?? descriptor.timezone;
  if (timezone !== fieldTimezone && !descriptor.capabilities.timezoneConversion) {
    addDiagnostic(
      diagnostics,
      DIAGNOSTIC_CODES.PROVIDER_CAPABILITY_MISMATCH,
      `${path}/timezone`,
      "The dataset does not declare timezone conversion capability.",
    );
    return null;
  }
  const start = own(value, "start");
  const end = own(value, "end");
  if (typeof start !== "string" || !isIsoTemporalString(start)) {
    addDiagnostic(diagnostics, DIAGNOSTIC_CODES.QUERY_INVALID, `${path}/start`);
    return null;
  }
  if (typeof end !== "string" || !isIsoTemporalString(end)) {
    addDiagnostic(diagnostics, DIAGNOSTIC_CODES.QUERY_INVALID, `${path}/end`);
    return null;
  }
  const startInstant = temporalInstant(
    start,
    start.includes("T") ? "datetime" : "date",
    timezone,
    "iso8601-offset",
  );
  const endInstant = temporalInstant(
    end,
    end.includes("T") ? "datetime" : "date",
    timezone,
    "iso8601-offset",
  );
  if (startInstant === null) {
    addDiagnostic(
      diagnostics,
      DIAGNOSTIC_CODES.QUERY_INVALID,
      `${path}/start`,
      "The time window start date does not occur in the declared timezone.",
    );
    return null;
  }
  if (endInstant === null) {
    addDiagnostic(
      diagnostics,
      DIAGNOSTIC_CODES.QUERY_INVALID,
      `${path}/end`,
      "The time window end date does not occur in the declared timezone.",
    );
    return null;
  }
  if (startInstant > endInstant) {
    addDiagnostic(
      diagnostics,
      DIAGNOSTIC_CODES.QUERY_INVALID,
      `${path}/start`,
      "The time window start must not be after its end.",
    );
    return null;
  }
  return Object.freeze({
    fieldId,
    start,
    end,
    timezone,
    bounds: bounds as (typeof LAYOUT_BOUNDS)[number],
  });
}

function normalizeOrder(
  value: unknown,
  index: number,
  diagnostics: Diagnostic[],
): QueryOrder | null {
  const path = `/orderBy/${index}`;
  if (!isRecord(value)) {
    addDiagnostic(diagnostics, DIAGNOSTIC_CODES.QUERY_INVALID, path);
    return null;
  }
  unknownKeys(value, ORDER_KEYS, path, diagnostics);
  const key = own(value, "key");
  if (!nonEmptyString(key)) {
    addDiagnostic(diagnostics, DIAGNOSTIC_CODES.MISSING_ID, `${path}/key`);
    return null;
  }
  const direction = own(value, "direction");
  if (direction !== "ascending" && direction !== "descending") {
    addDiagnostic(diagnostics, DIAGNOSTIC_CODES.QUERY_INVALID, `${path}/direction`);
    return null;
  }
  return Object.freeze({ key, direction });
}

function normalizeComparison(
  value: unknown,
  diagnostics: Diagnostic[],
): QueryComparisonInput | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  const path = "/comparisonInput";
  if (!isRecord(value)) {
    addDiagnostic(diagnostics, DIAGNOSTIC_CODES.QUERY_INVALID, path);
    return null;
  }
  unknownKeys(value, COMPARISON_KEYS, path, diagnostics);
  const comparisonId = own(value, "comparisonId");
  const side = own(value, "side");
  const inputId = own(value, "inputId");
  if (!nonEmptyString(comparisonId)) {
    addDiagnostic(diagnostics, DIAGNOSTIC_CODES.MISSING_ID, `${path}/comparisonId`);
    return null;
  }
  if (side !== "primary" && side !== "reference") {
    addDiagnostic(diagnostics, DIAGNOSTIC_CODES.QUERY_INVALID, `${path}/side`);
    return null;
  }
  if (!nonEmptyString(inputId)) {
    addDiagnostic(diagnostics, DIAGNOSTIC_CODES.MISSING_ID, `${path}/inputId`);
    return null;
  }
  return Object.freeze({ comparisonId, side, inputId });
}

function isTemporalFieldType(type: FieldValueType): boolean {
  return type === "date" || type === "datetime";
}

function resultFieldFor(
  descriptor: DatasetDescriptor,
  field: DataFieldDescriptor,
  grouping: QueryGrouping | undefined,
): QueryResultField {
  if (grouping?.bucket && grouping.bucket.grain !== "instant") {
    return Object.freeze({
      fieldId: field.id,
      sourceFieldId: field.id,
      type: "date",
      role: "temporal",
      timezone: grouping.bucket.timezone,
      temporalRepresentation: "iso8601-offset",
    });
  }
  const temporal = isTemporalFieldType(field.type);
  return Object.freeze({
    fieldId: field.id,
    sourceFieldId: field.id,
    type: field.type,
    role: field.role,
    ...(field.unit === undefined ? {} : { unit: field.unit }),
    ...(temporal
      ? {
          timezone: field.timezone ?? descriptor.timezone,
          temporalRepresentation: field.temporalRepresentation ?? descriptor.temporalRepresentation,
        }
      : {}),
  });
}

export function deriveQueryResultFields(
  descriptor: DatasetDescriptor,
  request: QueryRequest,
): readonly QueryResultField[] {
  const fieldsById = new Map<string, DataFieldDescriptor>();
  for (const field of descriptor.fields) {
    fieldsById.set(field.id, field);
  }
  const groupingByField = new Map<string, QueryGrouping>();
  for (const grouping of request.groupBy) {
    groupingByField.set(grouping.fieldId, grouping);
  }
  const result: QueryResultField[] = [];
  const seen = new Set<string>();
  const add = (field: QueryResultField): void => {
    if (seen.has(field.fieldId)) {
      return;
    }
    seen.add(field.fieldId);
    result.push(field);
  };
  for (const fieldId of request.fields) {
    const field = fieldsById.get(fieldId);
    if (field) {
      add(resultFieldFor(descriptor, field, groupingByField.get(fieldId)));
    }
  }
  for (const grouping of request.groupBy) {
    const field = fieldsById.get(grouping.fieldId);
    if (field) {
      add(resultFieldFor(descriptor, field, grouping));
    }
  }
  for (const aggregation of request.aggregations) {
    const source =
      aggregation.fieldId === undefined ? undefined : fieldsById.get(aggregation.fieldId);
    const preserveTemporal =
      source !== undefined &&
      isTemporalFieldType(source.type) &&
      aggregation.type !== "count" &&
      aggregation.type !== "countDistinct" &&
      aggregation.type !== "sum" &&
      aggregation.type !== "average" &&
      aggregation.type !== "median";
    add(
      Object.freeze({
        fieldId: aggregation.output,
        ...(source === undefined ? {} : { sourceFieldId: source.id }),
        type: outputTypeFor(aggregation.type, source),
        role: "measure",
        ...(source?.unit === undefined ||
        aggregation.type === "count" ||
        aggregation.type === "countDistinct"
          ? {}
          : { unit: source.unit }),
        ...(preserveTemporal && source !== undefined
          ? { timezone: source.timezone ?? descriptor.timezone }
          : {}),
        ...(preserveTemporal && source !== undefined
          ? {
              temporalRepresentation:
                source.temporalRepresentation ?? descriptor.temporalRepresentation,
            }
          : {}),
      }),
    );
  }
  return Object.freeze(result);
}

export function queryFilterKey(filter: QueryFilter): string {
  return canonicalJson({
    fieldId: filter.fieldId,
    operator: filter.operator,
    ...(filter.value === undefined ? {} : { value: filter.value }),
    ...(filter.timezone === undefined ? {} : { timezone: filter.timezone }),
    ...(filter.bounds === undefined ? {} : { bounds: filter.bounds }),
  });
}

function canonicalComponents(
  providerId: string,
  descriptor: DatasetDescriptor,
  slice: DatasetSliceDescriptor | null,
  request: QueryRequest,
  operations: readonly QueryOperation[],
): JsonObject {
  const filters = [...request.filters]
    .sort((left, right) => lexicalCompare(queryFilterKey(left), queryFilterKey(right)))
    .map((filter) => ({
      ...(filter.id === undefined ? {} : { id: filter.id }),
      fieldId: filter.fieldId,
      operator: filter.operator,
      ...(filter.value === undefined ? {} : { value: filter.value }),
      ...(filter.timezone === undefined ? {} : { timezone: filter.timezone }),
      ...(filter.bounds === undefined ? {} : { bounds: filter.bounds }),
    }));
  return {
    schema: 1,
    providerId,
    datasetId: descriptor.id,
    datasetVersion: descriptor.version,
    ...(slice === null ? {} : { sliceId: slice.id }),
    fields: [...request.fields],
    groupBy: request.groupBy.map((grouping) => ({
      fieldId: grouping.fieldId,
      ...(grouping.bucket === undefined
        ? {}
        : {
            bucket: {
              grain: grouping.bucket.grain,
              timezone: grouping.bucket.timezone,
              ...(grouping.bucket.weekStartsOn === undefined
                ? {}
                : { weekStartsOn: grouping.bucket.weekStartsOn }),
            },
          }),
    })),
    aggregations: request.aggregations.map((aggregation) => ({
      output: aggregation.output,
      type: aggregation.type,
      ...(aggregation.fieldId === undefined ? {} : { fieldId: aggregation.fieldId }),
    })),
    filters,
    ...(request.timeWindow === undefined
      ? {}
      : {
          timeWindow: {
            fieldId: request.timeWindow.fieldId,
            start: request.timeWindow.start,
            end: request.timeWindow.end,
            timezone: request.timeWindow.timezone,
            bounds: request.timeWindow.bounds,
          },
        }),
    orderBy: request.orderBy.map((order) => ({
      key: order.key,
      direction: order.direction,
    })),
    ...(request.limit === undefined ? {} : { limit: request.limit }),
    ...(request.cursor === undefined ? {} : { cursor: request.cursor }),
    ...(request.comparisonInput === undefined
      ? {}
      : {
          comparisonInput: {
            comparisonId: request.comparisonInput.comparisonId,
            side: request.comparisonInput.side,
            inputId: request.comparisonInput.inputId,
          },
        }),
    operations: [...operations],
  };
}

export function admitQuerySpec(value: unknown): Result<QuerySpec> {
  const validation = validateJsonValue(value);
  if (!validation.valid) {
    return fail(
      validation.issues.map((issue) =>
        createDiagnostic(DIAGNOSTIC_CODES.QUERY_INVALID, issue.path, {
          message: issue.message,
        }),
      ),
    );
  }
  let clone: unknown;
  try {
    clone = cloneJson(value as JsonValue);
  } catch {
    return fail([
      createDiagnostic(DIAGNOSTIC_CODES.QUERY_INVALID, "", {
        message: "The query specification is not descriptor-safe JSON data.",
      }),
    ]);
  }
  if (!isRecord(clone)) {
    return fail([
      createDiagnostic(DIAGNOSTIC_CODES.QUERY_INVALID, "", {
        message: "A query specification must be an object.",
      }),
    ]);
  }
  return ok(deepFreeze(clone) as unknown as QuerySpec);
}

export function buildQueryPlan(
  descriptor: DatasetDescriptor,
  spec: unknown,
  options: BuildQueryPlanOptions = {},
): Result<QueryPlan> {
  const admitted = admitQuerySpec(spec);
  if (!admitted.ok) {
    return admitted;
  }
  const input = admitted.value;
  const diagnostics: Diagnostic[] = [];
  unknownKeys(input as unknown as Record<string, unknown>, SPEC_KEYS, "", diagnostics);
  if (input.datasetId !== descriptor.id) {
    addDiagnostic(diagnostics, DIAGNOSTIC_CODES.INVALID_REFERENCE, "/datasetId", undefined, {
      relatedIds: [String(input.datasetId), descriptor.id],
    });
  }
  const datasetVersion = input.datasetVersion;
  if (datasetVersion !== undefined) {
    if (typeof datasetVersion !== "string" || datasetVersion.trim() === "") {
      addDiagnostic(diagnostics, DIAGNOSTIC_CODES.QUERY_INVALID, "/datasetVersion");
    } else if (datasetVersion !== descriptor.version) {
      addDiagnostic(
        diagnostics,
        DIAGNOSTIC_CODES.PROVIDER_CAPABILITY_MISMATCH,
        "/datasetVersion",
        `The query targets dataset version "${datasetVersion}" but the provider exposes "${descriptor.version}".`,
      );
    }
  }

  const fieldsById = new Map<string, DataFieldDescriptor>();
  for (const field of descriptor.fields) {
    fieldsById.set(field.id, field);
  }

  const slicesById = new Map<string, DatasetSliceDescriptor>();
  for (const slice of descriptor.slices) {
    slicesById.set(slice.id, slice);
  }
  const sliceId = input.sliceId;
  let slice: DatasetSliceDescriptor | null = null;
  if (sliceId !== undefined) {
    if (typeof sliceId !== "string" || sliceId.trim() === "") {
      addDiagnostic(diagnostics, DIAGNOSTIC_CODES.QUERY_INVALID, "/sliceId");
    } else {
      slice = slicesById.get(sliceId) ?? null;
      if (slice === null) {
        addDiagnostic(diagnostics, DIAGNOSTIC_CODES.INVALID_REFERENCE, "/sliceId", undefined, {
          relatedIds: [sliceId],
        });
      }
    }
  }
  const sliceFields = slice?.fieldIds === undefined ? null : new Set(slice.fieldIds);
  const requireSliceField = (fieldId: string, path: string): void => {
    if (sliceFields !== null && !sliceFields.has(fieldId)) {
      addDiagnostic(
        diagnostics,
        DIAGNOSTIC_CODES.INVALID_REFERENCE,
        path,
        "The field is not part of the selected slice.",
        { relatedIds: [fieldId] },
      );
    }
  };

  const rawGroups = input.groupBy;
  const groupBy: QueryGrouping[] = [];
  const groupedFields = new Set<string>();
  if (rawGroups !== undefined) {
    if (isDenseArray(rawGroups, "/groupBy", diagnostics)) {
      rawGroups.forEach((entry, index) => {
        const grouping = normalizeGrouping(entry, index, fieldsById, descriptor, diagnostics);
        if (!grouping) {
          return;
        }
        if (groupedFields.has(grouping.fieldId)) {
          addDiagnostic(
            diagnostics,
            DIAGNOSTIC_CODES.DUPLICATE_ID,
            `/groupBy/${index}/fieldId`,
            undefined,
            { relatedIds: [grouping.fieldId] },
          );
          return;
        }
        groupedFields.add(grouping.fieldId);
        groupBy.push(grouping);
        requireSliceField(grouping.fieldId, `/groupBy/${index}/fieldId`);
      });
      if (groupBy.length > 0 && !descriptor.capabilities.grouping) {
        addDiagnostic(
          diagnostics,
          DIAGNOSTIC_CODES.PROVIDER_CAPABILITY_MISMATCH,
          "/groupBy",
          "The dataset does not declare grouping capability.",
        );
      }
    }
  }

  const rawAggregations = input.aggregations;
  const aggregations: QueryAggregation[] = [];
  const aggregationOutputs = new Set<string>();
  if (rawAggregations !== undefined) {
    if (isDenseArray(rawAggregations, "/aggregations", diagnostics)) {
      rawAggregations.forEach((entry, index) => {
        const aggregation = normalizeAggregation(entry, index, fieldsById, descriptor, diagnostics);
        if (!aggregation) {
          return;
        }
        if (aggregationOutputs.has(aggregation.output)) {
          addDiagnostic(
            diagnostics,
            DIAGNOSTIC_CODES.DUPLICATE_ID,
            `/aggregations/${index}/output`,
            undefined,
            { relatedIds: [aggregation.output] },
          );
          return;
        }
        aggregationOutputs.add(aggregation.output);
        aggregations.push(aggregation);
        if (aggregation.fieldId !== undefined) {
          requireSliceField(aggregation.fieldId, `/aggregations/${index}/fieldId`);
        }
      });
    }
  }

  const rawFields = input.fields;
  let fields: string[];
  if (rawFields === undefined) {
    fields =
      groupBy.length === 0 && aggregations.length === 0
        ? slice?.fieldIds === undefined
          ? descriptor.fields.map((field) => field.id)
          : [...slice.fieldIds]
        : [];
  } else if (!isDenseArray(rawFields, "/fields", diagnostics)) {
    fields = [];
  } else {
    fields = [];
    const seen = new Set<string>();
    rawFields.forEach((fieldId, index) => {
      if (typeof fieldId !== "string" || fieldId.trim() === "") {
        addDiagnostic(diagnostics, DIAGNOSTIC_CODES.MISSING_ID, `/fields/${index}`);
        return;
      }
      if (!fieldsById.has(fieldId)) {
        addDiagnostic(
          diagnostics,
          DIAGNOSTIC_CODES.INVALID_REFERENCE,
          `/fields/${index}`,
          undefined,
          { relatedIds: [fieldId] },
        );
        return;
      }
      if (seen.has(fieldId)) {
        addDiagnostic(diagnostics, DIAGNOSTIC_CODES.DUPLICATE_ID, `/fields/${index}`, undefined, {
          relatedIds: [fieldId],
        });
        return;
      }
      seen.add(fieldId);
      fields.push(fieldId);
      requireSliceField(fieldId, `/fields/${index}`);
      if ((groupBy.length > 0 || aggregations.length > 0) && !groupedFields.has(fieldId)) {
        addDiagnostic(
          diagnostics,
          DIAGNOSTIC_CODES.QUERY_INVALID,
          `/fields/${index}`,
          "A projected field in a grouped or aggregated query must also be grouped.",
        );
      }
    });
  }
  if (fields.length === 0 && groupBy.length === 0 && aggregations.length === 0) {
    addDiagnostic(
      diagnostics,
      DIAGNOSTIC_CODES.QUERY_INVALID,
      "/fields",
      "A query must select at least one field, grouping or aggregation.",
    );
  }
  for (const output of aggregationOutputs) {
    if (fields.includes(output) || groupedFields.has(output)) {
      addDiagnostic(
        diagnostics,
        DIAGNOSTIC_CODES.DUPLICATE_ID,
        "/aggregations",
        `Aggregation output "${output}" collides with a projected or grouped field.`,
        { relatedIds: [output] },
      );
    }
  }

  const rawFilters = input.filters;
  const filters: QueryFilter[] = [];
  const filterIds = new Set<string>();
  if (rawFilters !== undefined) {
    if (isDenseArray(rawFilters, "/filters", diagnostics)) {
      rawFilters.forEach((entry, index) => {
        const filter = normalizeFilter(entry, index, fieldsById, descriptor, diagnostics);
        if (!filter) {
          return;
        }
        if (filter.id !== undefined) {
          if (filterIds.has(filter.id)) {
            addDiagnostic(
              diagnostics,
              DIAGNOSTIC_CODES.DUPLICATE_ID,
              `/filters/${index}/id`,
              undefined,
              { relatedIds: [filter.id] },
            );
            return;
          }
          filterIds.add(filter.id);
        }
        filters.push(filter);
        requireSliceField(filter.fieldId, `/filters/${index}/fieldId`);
      });
    }
  }

  const timeWindow = normalizeWindow(input.timeWindow, fieldsById, descriptor, diagnostics);
  if (timeWindow) {
    requireSliceField(timeWindow.fieldId, "/timeWindow/fieldId");
  }

  const rawOrders = input.orderBy;
  const orderBy: QueryOrder[] = [];
  if (rawOrders !== undefined) {
    if (isDenseArray(rawOrders, "/orderBy", diagnostics)) {
      const seen = new Set<string>();
      rawOrders.forEach((entry, index) => {
        const order = normalizeOrder(entry, index, diagnostics);
        if (!order) {
          return;
        }
        if (seen.has(order.key)) {
          addDiagnostic(
            diagnostics,
            DIAGNOSTIC_CODES.DUPLICATE_ID,
            `/orderBy/${index}/key`,
            undefined,
            { relatedIds: [order.key] },
          );
          return;
        }
        seen.add(order.key);
        orderBy.push(order);
      });
    }
  }

  const limit = input.limit;
  if (limit !== undefined && (typeof limit !== "number" || !Number.isInteger(limit) || limit < 0)) {
    addDiagnostic(
      diagnostics,
      DIAGNOSTIC_CODES.QUERY_INVALID,
      "/limit",
      "A query limit must be a non-negative integer.",
    );
  }
  const cursor = input.cursor;
  if (cursor !== undefined) {
    if (typeof cursor !== "string" || cursor.trim() === "") {
      addDiagnostic(diagnostics, DIAGNOSTIC_CODES.QUERY_INVALID, "/cursor");
    } else if (!descriptor.capabilities.serverPaging) {
      addDiagnostic(
        diagnostics,
        DIAGNOSTIC_CODES.PROVIDER_CAPABILITY_MISMATCH,
        "/cursor",
        "The dataset does not declare server paging capability.",
      );
    }
  }
  const comparisonInput = normalizeComparison(input.comparisonInput, diagnostics);
  if (comparisonInput && !descriptor.capabilities.comparison) {
    addDiagnostic(
      diagnostics,
      DIAGNOSTIC_CODES.PROVIDER_CAPABILITY_MISMATCH,
      "/comparisonInput",
      "The dataset does not declare comparison capability.",
    );
  }

  const operationsSet = new Set<QueryOperation>();
  if (fields.length > 0) {
    operationsSet.add("project");
  }
  if (filters.length > 0) {
    operationsSet.add("filter");
  }
  if (groupBy.length > 0) {
    operationsSet.add("group");
  }
  if (aggregations.length > 0) {
    operationsSet.add("aggregate");
  }
  if (timeWindow) {
    operationsSet.add("timeWindow");
  }
  if (orderBy.length > 0) {
    operationsSet.add("order");
  }
  if (limit !== undefined) {
    operationsSet.add("limit");
  }
  if (cursor !== undefined) {
    operationsSet.add("cursor");
  }
  const operations = QUERY_OPERATIONS.filter((operation) => operationsSet.has(operation));
  if (slice?.supportedOperations !== undefined) {
    for (const operation of operations) {
      if (!slice.supportedOperations.includes(operation)) {
        addDiagnostic(
          diagnostics,
          DIAGNOSTIC_CODES.PROVIDER_CAPABILITY_MISMATCH,
          "/sliceId",
          `The selected slice does not support the "${operation}" operation.`,
          { relatedIds: [slice.id] },
        );
      }
    }
  }

  const request: QueryRequest = Object.freeze({
    datasetId: descriptor.id,
    datasetVersion: descriptor.version,
    ...(slice === null ? {} : { sliceId: slice.id }),
    fields: Object.freeze(fields),
    groupBy: Object.freeze(groupBy),
    aggregations: Object.freeze(aggregations),
    filters: Object.freeze(filters),
    ...(timeWindow ? { timeWindow } : {}),
    orderBy: Object.freeze(orderBy),
    ...(typeof limit === "number" ? { limit } : {}),
    ...(typeof cursor === "string" ? { cursor } : {}),
    ...(comparisonInput ? { comparisonInput } : {}),
  });
  const outputFields = deriveQueryResultFields(descriptor, request);
  const outputKeys = new Set(outputFields.map((field) => field.fieldId));
  for (const order of orderBy) {
    if (!outputKeys.has(order.key)) {
      addDiagnostic(
        diagnostics,
        DIAGNOSTIC_CODES.INVALID_REFERENCE,
        "/orderBy",
        `Ordering key "${order.key}" is not part of the query output.`,
        { relatedIds: [order.key] },
      );
    }
  }

  if (hasError(diagnostics)) {
    return fail(diagnostics);
  }
  const providerId = options.providerId ?? descriptor.id;
  const components = canonicalComponents(providerId, descriptor, slice, request, operations);
  const key: CanonicalQueryKey = Object.freeze({
    value: `BQK1:${canonicalJson(components)}`,
    components: Object.freeze(components),
  });
  return ok(
    Object.freeze({
      dataset: descriptor,
      slice,
      request,
      key,
      operations,
      outputFields,
    }),
  );
}
