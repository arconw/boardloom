import {
  AGGREGATION_TYPES,
  DATE_STYLES,
  FIELD_VALUE_TYPES,
  FILTER_OPERATORS,
  FORMAT_STYLES,
  LAYOUT_BOUNDS,
  TIME_STYLES,
  type AggregationType,
  type BucketGrain,
  type FieldValueType,
  type FilterOperator,
  type FormatStyle,
  type WeekStart,
} from "./board-schema.js";
import {
  checkUnknownKeys,
  isIsoDateString,
  isIsoDateTimeString,
  isIsoTemporalString,
  isRecord,
  nonEmptyString,
  oneOf,
  own,
} from "./board-validation-shared.js";
import { DIAGNOSTIC_CODES, createDiagnostic, hasError, type Diagnostic } from "./diagnostics.js";
import {
  cloneJson,
  deepFreeze,
  validateJsonValue,
  type JsonObject,
  type JsonValue,
} from "./json.js";
import { isValidTimeZone } from "./locale.js";

export const DATA_CONTRACT_VERSION = 1 as const;
export const DATA_FIELD_ROLES = Object.freeze(["dimension", "measure", "temporal"] as const);
export const TEMPORAL_REPRESENTATIONS = Object.freeze([
  "iso8601-offset",
  "epoch-milliseconds",
  "epoch-seconds",
] as const);
export const QUERY_OPERATIONS = Object.freeze([
  "project",
  "filter",
  "group",
  "aggregate",
  "timeWindow",
  "order",
  "limit",
  "cursor",
] as const);
export const QUERY_PHASES = Object.freeze([
  "idle",
  "loading",
  "settled",
  "empty",
  "partial",
  "error",
  "cancelled",
  "stale",
] as const);

export type DataFieldRole = (typeof DATA_FIELD_ROLES)[number];
export type TemporalRepresentation = (typeof TEMPORAL_REPRESENTATIONS)[number];
export type QueryOperation = (typeof QUERY_OPERATIONS)[number];
export type QueryPhase = (typeof QUERY_PHASES)[number];
export type QueryAggregationType = Exclude<AggregationType, "none">;

export const QUERY_AGGREGATION_TYPES: readonly QueryAggregationType[] = Object.freeze(
  AGGREGATION_TYPES.filter((type): type is QueryAggregationType => type !== "none"),
);

export interface DataUnitDescriptor {
  readonly unit: string;
  readonly scale?: number;
  readonly label?: string;
}

export interface DataFieldFormat {
  readonly style?: FormatStyle;
  readonly precision?: number;
  readonly currency?: string;
  readonly dateStyle?: (typeof DATE_STYLES)[number];
  readonly timeStyle?: (typeof TIME_STYLES)[number];
}

export interface DataValueRange {
  readonly min?: number;
  readonly max?: number;
}

export interface DataFieldDescriptor {
  readonly id: string;
  readonly key: string;
  readonly label?: string;
  readonly type: FieldValueType;
  readonly role: DataFieldRole;
  readonly nullable: boolean;
  readonly timezone?: string;
  readonly temporalRepresentation?: TemporalRepresentation;
  readonly unit?: DataUnitDescriptor;
  readonly allowedValues?: readonly (string | number | boolean)[];
  readonly range?: DataValueRange;
  readonly format?: DataFieldFormat;
  readonly operators?: readonly FilterOperator[];
}

export interface DatasetSliceDescriptor {
  readonly id: string;
  readonly datasetId: string;
  readonly label?: string;
  readonly fieldIds?: readonly string[];
  readonly parametersSchema?: JsonObject;
  readonly supportedOperations?: readonly QueryOperation[];
  readonly compatibilityNotes?: string;
}

export interface DatasetCapabilities {
  readonly grouping: boolean;
  readonly aggregations: readonly QueryAggregationType[];
  readonly filterOperators: readonly FilterOperator[];
  readonly timeWindow: boolean;
  readonly timezoneConversion: boolean;
  readonly local: boolean;
  readonly pushdownFilters: boolean;
  readonly serverPaging: boolean;
  readonly realtime: boolean;
  readonly comparison: boolean;
  readonly maxResultSize: number | null;
}

export interface DatasetDescriptor {
  readonly id: string;
  readonly label?: string;
  readonly version: string;
  readonly timezone: string;
  readonly temporalRepresentation: TemporalRepresentation;
  readonly fields: readonly DataFieldDescriptor[];
  readonly slices: readonly DatasetSliceDescriptor[];
  readonly capabilities: DatasetCapabilities;
}

export interface QueryFieldReference {
  readonly fieldId: string;
}

export interface QueryGrouping {
  readonly fieldId: string;
  readonly bucket?: {
    readonly grain: BucketGrain;
    readonly timezone: string;
    readonly weekStartsOn?: WeekStart;
  };
}

export interface QueryAggregation {
  readonly output: string;
  readonly type: QueryAggregationType;
  readonly fieldId?: string;
}

export interface QueryFilter {
  readonly id?: string;
  readonly fieldId: string;
  readonly operator: FilterOperator;
  readonly value?: JsonValue;
  readonly timezone?: string;
  readonly bounds?: (typeof LAYOUT_BOUNDS)[number];
}

export interface QueryTimeWindow {
  readonly fieldId: string;
  readonly start: string;
  readonly end: string;
  readonly timezone: string;
  readonly bounds: (typeof LAYOUT_BOUNDS)[number];
}

export interface QueryOrder {
  readonly key: string;
  readonly direction: "ascending" | "descending";
}

export interface QueryComparisonInput {
  readonly comparisonId: string;
  readonly side: "primary" | "reference";
  readonly inputId: string;
}

export interface QuerySpec {
  readonly datasetId: string;
  readonly sliceId?: string;
  readonly datasetVersion?: string;
  readonly fields?: readonly string[];
  readonly groupBy?: readonly QueryGrouping[];
  readonly aggregations?: readonly QueryAggregation[];
  readonly filters?: readonly QueryFilter[];
  readonly timeWindow?: QueryTimeWindow;
  readonly orderBy?: readonly QueryOrder[];
  readonly limit?: number;
  readonly cursor?: string;
  readonly comparisonInput?: QueryComparisonInput;
}

export interface QueryRequest {
  readonly datasetId: string;
  readonly datasetVersion: string;
  readonly sliceId?: string;
  readonly fields: readonly string[];
  readonly groupBy: readonly QueryGrouping[];
  readonly aggregations: readonly QueryAggregation[];
  readonly filters: readonly QueryFilter[];
  readonly timeWindow?: QueryTimeWindow;
  readonly orderBy: readonly QueryOrder[];
  readonly limit?: number;
  readonly cursor?: string;
  readonly comparisonInput?: QueryComparisonInput;
}

export type QueryResultRow = Readonly<Record<string, JsonValue>>;

export interface QueryResultField {
  readonly fieldId: string;
  readonly sourceFieldId?: string;
  readonly type: FieldValueType;
  readonly role: DataFieldRole;
  readonly unit?: DataUnitDescriptor;
  readonly timezone?: string;
  readonly temporalRepresentation?: TemporalRepresentation;
}

export interface QueryCounts {
  readonly returnedRows: number;
  readonly totalRows: number | null;
  readonly filteredRows: number;
  readonly nullCounts: Readonly<Record<string, number>>;
}

interface QueryResultBase {
  readonly requestId: string;
  readonly datasetId: string;
  readonly datasetVersion: string;
  readonly sliceId?: string;
  readonly diagnostics: readonly Diagnostic[];
}

export interface QuerySuccess extends QueryResultBase {
  readonly ok: true;
  readonly fields: readonly QueryResultField[];
  readonly rows: readonly QueryResultRow[];
  readonly counts: QueryCounts;
  readonly complete: boolean;
  readonly nextCursor?: string;
}

export interface QueryFailure extends QueryResultBase {
  readonly ok: false;
}

export type DatasetQueryResult = QuerySuccess | QueryFailure;

export interface QueryAbortSignal {
  readonly aborted: boolean;
  readonly reason?: unknown;
  addEventListener(type: "abort", listener: () => void): void;
  removeEventListener(type: "abort", listener: () => void): void;
}

export interface DatasetProviderContext {
  readonly signal: QueryAbortSignal;
  readonly requestId: string;
  readonly requestToken: number;
  readonly queryKey: string;
  readonly generation: number;
}

export interface DatasetProvider {
  readonly providerId: string;
  listDatasetIds(): readonly string[];
  getDatasetDescriptor(datasetId: string): DatasetDescriptor | undefined;
  query(
    request: QueryRequest,
    context: DatasetProviderContext,
  ): DatasetQueryResult | Promise<DatasetQueryResult>;
}

export interface QueryState {
  readonly queryId: string;
  readonly datasetId: string;
  readonly datasetVersion: string;
  readonly sliceId?: string;
  readonly queryKey: string;
  readonly generation: number;
  readonly phase: QueryPhase;
  readonly requestId: string | null;
  readonly requestToken: number;
  readonly fields: readonly QueryResultField[];
  readonly rows: readonly QueryResultRow[];
  readonly counts: QueryCounts;
  readonly diagnostics: readonly Diagnostic[];
  readonly complete: boolean;
  readonly nextCursor?: string;
  readonly cancelledReason?: string;
  readonly staleReason?: string;
  readonly startedAt: number | null;
  readonly settledAt: number | null;
  readonly updatedAt: number;
}

export interface DatasetDescriptorValidation {
  readonly valid: boolean;
  readonly diagnostics: readonly Diagnostic[];
  readonly descriptor?: DatasetDescriptor;
}

const DATASET_KEYS = new Set([
  "id",
  "label",
  "version",
  "timezone",
  "temporalRepresentation",
  "fields",
  "slices",
  "capabilities",
]);
const FIELD_KEYS = new Set([
  "id",
  "key",
  "label",
  "type",
  "role",
  "nullable",
  "timezone",
  "temporalRepresentation",
  "unit",
  "allowedValues",
  "range",
  "format",
  "operators",
]);
const SLICE_KEYS = new Set([
  "id",
  "datasetId",
  "label",
  "fieldIds",
  "parametersSchema",
  "supportedOperations",
  "compatibilityNotes",
]);
const CAPABILITY_KEYS = new Set([
  "grouping",
  "aggregations",
  "filterOperators",
  "timeWindow",
  "timezoneConversion",
  "local",
  "pushdownFilters",
  "serverPaging",
  "realtime",
  "comparison",
  "maxResultSize",
]);
const UNIT_KEYS = new Set(["unit", "scale", "label"]);
const RANGE_KEYS = new Set(["min", "max"]);
const FORMAT_KEYS = new Set(["style", "precision", "currency", "dateStyle", "timeStyle"]);
const EMPTY_COUNTS: QueryCounts = Object.freeze({
  returnedRows: 0,
  totalRows: null,
  filteredRows: 0,
  nullCounts: Object.freeze({}),
});

type AddDiagnostic = (
  code: string,
  path: string,
  message?: string,
  extra?: {
    readonly severity?: "error" | "warning";
    readonly hint?: string;
    readonly relatedIds?: readonly string[];
    readonly source?: string;
  },
) => void;

function isTemporalType(type: FieldValueType): boolean {
  return type === "date" || type === "datetime";
}

function valueMatchesType(value: unknown, type: FieldValueType): boolean {
  if (value === null) {
    return true;
  }
  if (type === "number") {
    return typeof value === "number" && Number.isFinite(value);
  }
  if (type === "string") {
    return typeof value === "string";
  }
  if (type === "boolean") {
    return typeof value === "boolean";
  }
  if (type === "date") {
    return typeof value === "string" && isIsoDateString(value);
  }
  return typeof value === "string" && isIsoDateTimeString(value);
}

function freezeDiagnostics(diagnostics: Diagnostic[]): readonly Diagnostic[] {
  return Object.freeze(diagnostics);
}

function diagnostic(
  code: string,
  path: string,
  message?: string,
  extra?: {
    readonly severity?: "error" | "warning";
    readonly hint?: string;
    readonly relatedIds?: readonly string[];
    readonly source?: string;
  },
): Diagnostic {
  return createDiagnostic(code, path, {
    ...(message === undefined ? {} : { message }),
    ...(extra === undefined ? {} : extra),
  });
}

function validateUnit(value: unknown, path: string, add: AddDiagnostic): void {
  if (!isRecord(value)) {
    add(DIAGNOSTIC_CODES.DATASET_DESCRIPTOR_INVALID, path, "A unit descriptor must be an object.");
    return;
  }
  checkUnknownKeys(value, UNIT_KEYS, path, add);
  const unit = own(value, "unit");
  if (!nonEmptyString(unit)) {
    add(DIAGNOSTIC_CODES.MISSING_ID, `${path}/unit`, "A unit symbol is required.");
  }
  const scale = own(value, "scale");
  if (
    scale !== undefined &&
    (typeof scale !== "number" || !Number.isFinite(scale) || scale === 0)
  ) {
    add(
      DIAGNOSTIC_CODES.DATASET_DESCRIPTOR_INVALID,
      `${path}/scale`,
      "A unit scale must be a finite non-zero number.",
    );
  }
  const label = own(value, "label");
  if (label !== undefined && typeof label !== "string") {
    add(DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE, `${path}/label`);
  }
}

function validateFieldFormat(value: unknown, path: string, add: AddDiagnostic): void {
  if (!isRecord(value)) {
    add(DIAGNOSTIC_CODES.DATASET_DESCRIPTOR_INVALID, path, "A field format must be an object.");
    return;
  }
  checkUnknownKeys(value, FORMAT_KEYS, path, add);
  if (own(value, "style") !== undefined && !oneOf(own(value, "style"), FORMAT_STYLES)) {
    add(DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE, `${path}/style`);
  }
  const precision = own(value, "precision");
  if (
    precision !== undefined &&
    (typeof precision !== "number" ||
      !Number.isInteger(precision) ||
      precision < 0 ||
      precision > 20)
  ) {
    add(DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE, `${path}/precision`);
  }
  const currency = own(value, "currency");
  if (currency !== undefined && typeof currency !== "string") {
    add(DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE, `${path}/currency`);
  }
  if (own(value, "dateStyle") !== undefined && !oneOf(own(value, "dateStyle"), DATE_STYLES)) {
    add(DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE, `${path}/dateStyle`);
  }
  if (own(value, "timeStyle") !== undefined && !oneOf(own(value, "timeStyle"), TIME_STYLES)) {
    add(DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE, `${path}/timeStyle`);
  }
}

function validateFieldRange(value: unknown, path: string, add: AddDiagnostic): void {
  if (!isRecord(value)) {
    add(DIAGNOSTIC_CODES.DATASET_DESCRIPTOR_INVALID, path, "A field range must be an object.");
    return;
  }
  checkUnknownKeys(value, RANGE_KEYS, path, add);
  const min = own(value, "min");
  const max = own(value, "max");
  for (const [key, entry] of [
    ["min", min],
    ["max", max],
  ] as const) {
    if (entry !== undefined && (typeof entry !== "number" || !Number.isFinite(entry))) {
      add(DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE, `${path}/${key}`);
    }
  }
  if (typeof min === "number" && typeof max === "number" && min > max) {
    add(
      DIAGNOSTIC_CODES.DATASET_DESCRIPTOR_INVALID,
      path,
      "A field range minimum must not exceed its maximum.",
    );
  }
}

function validateFilterOperatorArray(
  value: unknown,
  path: string,
  add: AddDiagnostic,
): readonly FilterOperator[] | null {
  if (!Array.isArray(value)) {
    add(DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE, path, "Filter operators must be an array.");
    return null;
  }
  const seen = new Set<FilterOperator>();
  const operators: FilterOperator[] = [];
  value.forEach((entry, index) => {
    if (!oneOf(entry, FILTER_OPERATORS)) {
      add(DIAGNOSTIC_CODES.DATASET_CAPABILITY_INVALID, `${path}/${index}`);
      return;
    }
    if (seen.has(entry)) {
      add(DIAGNOSTIC_CODES.DUPLICATE_ID, `${path}/${index}`, undefined, {
        relatedIds: [entry],
      });
      return;
    }
    seen.add(entry);
    operators.push(entry);
  });
  return operators;
}

function validateAggregationArray(
  value: unknown,
  path: string,
  add: AddDiagnostic,
): readonly QueryAggregationType[] | null {
  if (!Array.isArray(value)) {
    add(DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE, path, "Aggregations must be an array.");
    return null;
  }
  const seen = new Set<QueryAggregationType>();
  const aggregations: QueryAggregationType[] = [];
  value.forEach((entry, index) => {
    if (!oneOf(entry, QUERY_AGGREGATION_TYPES)) {
      add(DIAGNOSTIC_CODES.DATASET_CAPABILITY_INVALID, `${path}/${index}`);
      return;
    }
    if (seen.has(entry)) {
      add(DIAGNOSTIC_CODES.DUPLICATE_ID, `${path}/${index}`, undefined, {
        relatedIds: [entry],
      });
      return;
    }
    seen.add(entry);
    aggregations.push(entry);
  });
  return aggregations;
}

function validateCapabilities(value: unknown, path: string, add: AddDiagnostic): void {
  if (!isRecord(value)) {
    add(DIAGNOSTIC_CODES.DATASET_CAPABILITY_INVALID, path, "Capabilities must be an object.");
    return;
  }
  checkUnknownKeys(value, CAPABILITY_KEYS, path, add);
  for (const key of [
    "grouping",
    "timeWindow",
    "timezoneConversion",
    "local",
    "pushdownFilters",
    "serverPaging",
    "realtime",
    "comparison",
  ] as const) {
    if (typeof own(value, key) !== "boolean") {
      add(DIAGNOSTIC_CODES.DATASET_CAPABILITY_INVALID, `${path}/${key}`);
    }
  }
  const aggregations = own(value, "aggregations");
  if (aggregations !== undefined) {
    validateAggregationArray(aggregations, `${path}/aggregations`, add);
  } else {
    add(DIAGNOSTIC_CODES.DATASET_CAPABILITY_INVALID, `${path}/aggregations`);
  }
  const operators = own(value, "filterOperators");
  if (operators !== undefined) {
    validateFilterOperatorArray(operators, `${path}/filterOperators`, add);
  } else {
    add(DIAGNOSTIC_CODES.DATASET_CAPABILITY_INVALID, `${path}/filterOperators`);
  }
  const maxResultSize = own(value, "maxResultSize");
  if (
    maxResultSize !== null &&
    (typeof maxResultSize !== "number" || !Number.isInteger(maxResultSize) || maxResultSize <= 0)
  ) {
    add(
      DIAGNOSTIC_CODES.DATASET_CAPABILITY_INVALID,
      `${path}/maxResultSize`,
      "The maximum result size must be a positive integer or null.",
    );
  }
}

function validateField(
  value: unknown,
  path: string,
  descriptorTimezone: string,
  capabilityOperators: readonly FilterOperator[] | null,
  add: AddDiagnostic,
): { id: string; key: string } | null {
  if (!isRecord(value)) {
    add(DIAGNOSTIC_CODES.DATASET_DESCRIPTOR_INVALID, path, "A field must be an object.");
    return null;
  }
  checkUnknownKeys(value, FIELD_KEYS, path, add);
  const id = own(value, "id");
  const key = own(value, "key");
  if (!nonEmptyString(id)) {
    add(DIAGNOSTIC_CODES.MISSING_ID, `${path}/id`);
  }
  if (!nonEmptyString(key)) {
    add(DIAGNOSTIC_CODES.MISSING_ID, `${path}/key`);
  }
  const label = own(value, "label");
  if (label !== undefined && typeof label !== "string") {
    add(DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE, `${path}/label`);
  }
  const type = own(value, "type");
  if (!oneOf(type, FIELD_VALUE_TYPES)) {
    add(DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE, `${path}/type`);
  }
  const role = own(value, "role");
  if (!oneOf(role, DATA_FIELD_ROLES)) {
    add(DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE, `${path}/role`);
  } else if (role === "temporal" && oneOf(type, FIELD_VALUE_TYPES) && !isTemporalType(type)) {
    add(
      DIAGNOSTIC_CODES.DATASET_DESCRIPTOR_INVALID,
      `${path}/role`,
      "A temporal field must use the date or datetime value type.",
    );
  }
  if (typeof own(value, "nullable") !== "boolean") {
    add(DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE, `${path}/nullable`);
  }
  const timezone = own(value, "timezone");
  if (timezone !== undefined && (typeof timezone !== "string" || !isValidTimeZone(timezone))) {
    add(DIAGNOSTIC_CODES.INVALID_TIMEZONE, `${path}/timezone`);
  } else if (timezone === undefined && descriptorTimezone !== "") {
    if (!isValidTimeZone(descriptorTimezone)) {
      add(DIAGNOSTIC_CODES.INVALID_TIMEZONE, `${path}/timezone`);
    }
  }
  const temporalRepresentation = own(value, "temporalRepresentation");
  if (
    temporalRepresentation !== undefined &&
    !oneOf(temporalRepresentation, TEMPORAL_REPRESENTATIONS)
  ) {
    add(DIAGNOSTIC_CODES.DATASET_DESCRIPTOR_INVALID, `${path}/temporalRepresentation`);
  }
  const unit = own(value, "unit");
  if (unit !== undefined) {
    validateUnit(unit, `${path}/unit`, add);
  }
  const allowedValues = own(value, "allowedValues");
  if (allowedValues !== undefined) {
    if (!Array.isArray(allowedValues)) {
      add(DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE, `${path}/allowedValues`);
    } else {
      const seen = new Set<string>();
      allowedValues.forEach((entry, index) => {
        if (!oneOf(type, FIELD_VALUE_TYPES) || !valueMatchesType(entry, type)) {
          add(DIAGNOSTIC_CODES.DATASET_DESCRIPTOR_INVALID, `${path}/allowedValues/${index}`);
          return;
        }
        const serialized = `${typeof entry}:${String(entry)}`;
        if (seen.has(serialized)) {
          add(DIAGNOSTIC_CODES.DUPLICATE_ID, `${path}/allowedValues/${index}`);
          return;
        }
        seen.add(serialized);
      });
    }
  }
  const range = own(value, "range");
  if (range !== undefined) {
    validateFieldRange(range, `${path}/range`, add);
  }
  const format = own(value, "format");
  if (format !== undefined) {
    validateFieldFormat(format, `${path}/format`, add);
  }
  const operators = own(value, "operators");
  if (operators !== undefined) {
    const parsed = validateFilterOperatorArray(operators, `${path}/operators`, add);
    if (parsed && capabilityOperators) {
      parsed.forEach((operator, index) => {
        if (!capabilityOperators.includes(operator)) {
          add(
            DIAGNOSTIC_CODES.PROVIDER_CAPABILITY_MISMATCH,
            `${path}/operators/${index}`,
            `Operator "${operator}" is not declared by the dataset capabilities.`,
          );
        }
      });
    }
  }
  if (!nonEmptyString(id) || !nonEmptyString(key)) {
    return null;
  }
  return { id, key };
}

function validateSlice(
  value: unknown,
  path: string,
  datasetId: string,
  fieldIds: ReadonlySet<string>,
  add: AddDiagnostic,
): string | null {
  if (!isRecord(value)) {
    add(DIAGNOSTIC_CODES.DATASET_DESCRIPTOR_INVALID, path, "A slice must be an object.");
    return null;
  }
  checkUnknownKeys(value, SLICE_KEYS, path, add);
  const id = own(value, "id");
  if (!nonEmptyString(id)) {
    add(DIAGNOSTIC_CODES.MISSING_ID, `${path}/id`);
  }
  const sliceDatasetId = own(value, "datasetId");
  if (!nonEmptyString(sliceDatasetId) || sliceDatasetId !== datasetId) {
    add(DIAGNOSTIC_CODES.INVALID_REFERENCE, `${path}/datasetId`);
  }
  const label = own(value, "label");
  if (label !== undefined && typeof label !== "string") {
    add(DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE, `${path}/label`);
  }
  const sliceFieldIds = own(value, "fieldIds");
  if (sliceFieldIds !== undefined) {
    if (!Array.isArray(sliceFieldIds)) {
      add(DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE, `${path}/fieldIds`);
    } else {
      const seen = new Set<string>();
      sliceFieldIds.forEach((fieldId, index) => {
        if (!nonEmptyString(fieldId) || !fieldIds.has(fieldId)) {
          add(DIAGNOSTIC_CODES.INVALID_REFERENCE, `${path}/fieldIds/${index}`);
          return;
        }
        if (seen.has(fieldId)) {
          add(DIAGNOSTIC_CODES.DUPLICATE_ID, `${path}/fieldIds/${index}`, undefined, {
            relatedIds: [fieldId],
          });
          return;
        }
        seen.add(fieldId);
      });
    }
  }
  const supported = own(value, "supportedOperations");
  if (supported !== undefined) {
    if (!Array.isArray(supported)) {
      add(DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE, `${path}/supportedOperations`);
    } else {
      const seen = new Set<QueryOperation>();
      supported.forEach((operation, index) => {
        if (!oneOf(operation, QUERY_OPERATIONS)) {
          add(DIAGNOSTIC_CODES.DATASET_DESCRIPTOR_INVALID, `${path}/supportedOperations/${index}`);
          return;
        }
        if (seen.has(operation)) {
          add(DIAGNOSTIC_CODES.DUPLICATE_ID, `${path}/supportedOperations/${index}`);
          return;
        }
        seen.add(operation);
      });
    }
  }
  const notes = own(value, "compatibilityNotes");
  if (notes !== undefined && typeof notes !== "string") {
    add(DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE, `${path}/compatibilityNotes`);
  }
  const parametersSchema = own(value, "parametersSchema");
  if (parametersSchema !== undefined && !isRecord(parametersSchema)) {
    add(
      DIAGNOSTIC_CODES.DATASET_DESCRIPTOR_INVALID,
      `${path}/parametersSchema`,
      "A slice parameters schema must be a JSON object.",
    );
  }
  return nonEmptyString(id) ? id : null;
}

export function validateDatasetDescriptor(value: unknown): DatasetDescriptorValidation {
  const diagnostics: Diagnostic[] = [];
  const add: AddDiagnostic = (code, path, message, extra) => {
    diagnostics.push(diagnostic(code, path, message, extra));
  };

  if (!isRecord(value)) {
    add(
      DIAGNOSTIC_CODES.DATASET_DESCRIPTOR_INVALID,
      "",
      "A dataset descriptor must be a plain object.",
    );
    return Object.freeze({ valid: false, diagnostics: freezeDiagnostics(diagnostics) });
  }

  const json = validateJsonValue(value);
  if (!json.valid) {
    for (const issue of json.issues) {
      add(DIAGNOSTIC_CODES.DATASET_DESCRIPTOR_INVALID, issue.path, issue.message);
    }
    return Object.freeze({ valid: false, diagnostics: freezeDiagnostics(diagnostics) });
  }

  let clone: Record<string, unknown>;
  try {
    clone = cloneJson(value as JsonValue) as Record<string, unknown>;
  } catch (error) {
    add(
      DIAGNOSTIC_CODES.DATASET_DESCRIPTOR_INVALID,
      "",
      error instanceof Error ? error.message : "The dataset descriptor is not valid JSON data.",
    );
    return Object.freeze({ valid: false, diagnostics: freezeDiagnostics(diagnostics) });
  }

  checkUnknownKeys(clone, DATASET_KEYS, "", add);
  const id = own(clone, "id");
  if (!nonEmptyString(id)) {
    add(DIAGNOSTIC_CODES.MISSING_ID, "/id");
  }
  const label = own(clone, "label");
  if (label !== undefined && typeof label !== "string") {
    add(DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE, "/label");
  }
  const version = own(clone, "version");
  if (!nonEmptyString(version)) {
    add(DIAGNOSTIC_CODES.MISSING_REQUIRED_PROPERTY, "/version");
  }
  const timezone = own(clone, "timezone");
  if (typeof timezone !== "string" || !isValidTimeZone(timezone)) {
    add(DIAGNOSTIC_CODES.INVALID_TIMEZONE, "/timezone");
  }
  const representation = own(clone, "temporalRepresentation");
  if (!oneOf(representation, TEMPORAL_REPRESENTATIONS)) {
    add(DIAGNOSTIC_CODES.DATASET_DESCRIPTOR_INVALID, "/temporalRepresentation");
  }

  const capabilities = own(clone, "capabilities");
  validateCapabilities(capabilities, "/capabilities", add);
  const capabilityRecord = isRecord(capabilities) ? capabilities : {};
  const declaredOperators = own(capabilityRecord, "filterOperators");
  const capabilityOperators = Array.isArray(declaredOperators)
    ? declaredOperators.filter((operator): operator is FilterOperator =>
        oneOf(operator, FILTER_OPERATORS),
      )
    : null;

  const fieldIdSet = new Set<string>();
  const fieldKeySet = new Set<string>();
  const fields = own(clone, "fields");
  if (!Array.isArray(fields)) {
    add(DIAGNOSTIC_CODES.MISSING_REQUIRED_PROPERTY, "/fields");
  } else if (fields.length === 0) {
    add(
      DIAGNOSTIC_CODES.DATASET_DESCRIPTOR_INVALID,
      "/fields",
      "A dataset must declare at least one field.",
    );
  } else {
    fields.forEach((field, index) => {
      const parsed = validateField(
        field,
        `/fields/${index}`,
        typeof timezone === "string" ? timezone : "",
        capabilityOperators,
        add,
      );
      if (!parsed) {
        return;
      }
      if (fieldIdSet.has(parsed.id)) {
        add(DIAGNOSTIC_CODES.DUPLICATE_ID, `/fields/${index}/id`, undefined, {
          relatedIds: [parsed.id],
        });
      } else {
        fieldIdSet.add(parsed.id);
      }
      if (fieldKeySet.has(parsed.key)) {
        add(DIAGNOSTIC_CODES.DUPLICATE_ID, `/fields/${index}/key`, undefined, {
          relatedIds: [parsed.key],
        });
      } else {
        fieldKeySet.add(parsed.key);
      }
      const type = isRecord(field) ? own(field, "type") : undefined;
      const fieldRepresentation = isRecord(field)
        ? own(field, "temporalRepresentation")
        : undefined;
      if (
        oneOf(type, FIELD_VALUE_TYPES) &&
        isTemporalType(type) &&
        fieldRepresentation === undefined &&
        representation === undefined
      ) {
        add(
          DIAGNOSTIC_CODES.DATASET_DESCRIPTOR_INVALID,
          `/fields/${index}/temporalRepresentation`,
          "Temporal fields must declare a value representation.",
        );
      }
    });
  }

  const sliceIdSet = new Set<string>();
  const slices = own(clone, "slices");
  if (!Array.isArray(slices)) {
    add(DIAGNOSTIC_CODES.MISSING_REQUIRED_PROPERTY, "/slices");
  } else {
    slices.forEach((slice, index) => {
      const sliceId = validateSlice(
        slice,
        `/slices/${index}`,
        typeof id === "string" ? id : "",
        fieldIdSet,
        add,
      );
      if (sliceId === null) {
        return;
      }
      if (sliceIdSet.has(sliceId)) {
        add(DIAGNOSTIC_CODES.DUPLICATE_ID, `/slices/${index}/id`, undefined, {
          relatedIds: [sliceId],
        });
      } else {
        sliceIdSet.add(sliceId);
      }
    });
  }

  if (hasError(diagnostics)) {
    return Object.freeze({ valid: false, diagnostics: freezeDiagnostics(diagnostics) });
  }
  return Object.freeze({
    valid: true,
    diagnostics: freezeDiagnostics(diagnostics),
    descriptor: deepFreeze(clone) as unknown as DatasetDescriptor,
  });
}

export function validateDatasetProviderContract(provider: unknown): {
  readonly valid: boolean;
  readonly diagnostics: readonly Diagnostic[];
} {
  if (!isRecord(provider)) {
    return Object.freeze({
      valid: false,
      diagnostics: Object.freeze([
        createDiagnostic(DIAGNOSTIC_CODES.QUERY_PROVIDER_INVALID, "provider", {
          message: "A dataset provider must be an object.",
        }),
      ]),
    });
  }
  const diagnostics: Diagnostic[] = [];
  const readDataProperty = (
    key: string,
  ):
    | { readonly accessor: false; readonly value: unknown }
    | { readonly accessor: true; readonly value?: undefined } => {
    const descriptor = Object.getOwnPropertyDescriptor(provider, key);
    if (!descriptor || descriptor.get !== undefined || descriptor.set !== undefined) {
      return { accessor: true };
    }
    return { accessor: false, value: descriptor.value };
  };
  const providerId = readDataProperty("providerId");
  if (providerId.accessor) {
    diagnostics.push(
      createDiagnostic(DIAGNOSTIC_CODES.QUERY_PROVIDER_INVALID, "provider/providerId", {
        message: "The provider ID must be a data property, not an accessor.",
      }),
    );
  } else if (!nonEmptyString(providerId.value)) {
    diagnostics.push(
      createDiagnostic(DIAGNOSTIC_CODES.QUERY_PROVIDER_INVALID, "provider/providerId"),
    );
  }
  for (const method of ["listDatasetIds", "getDatasetDescriptor", "query"] as const) {
    const entry = readDataProperty(method);
    if (entry.accessor) {
      diagnostics.push(
        createDiagnostic(DIAGNOSTIC_CODES.QUERY_PROVIDER_INVALID, `provider/${method}`, {
          message: `The provider ${method} member must be a data property, not an accessor.`,
        }),
      );
    } else if (typeof entry.value !== "function") {
      diagnostics.push(
        createDiagnostic(DIAGNOSTIC_CODES.QUERY_PROVIDER_INVALID, `provider/${method}`),
      );
    }
  }
  return Object.freeze({
    valid: diagnostics.length === 0,
    diagnostics: freezeDiagnostics(diagnostics),
  });
}

export function emptyQueryCounts(): QueryCounts {
  return EMPTY_COUNTS;
}

export function isTemporalField(field: Pick<DataFieldDescriptor, "type">): boolean {
  return isTemporalType(field.type);
}

export function isTemporalValue(value: unknown, representation: TemporalRepresentation): boolean {
  if (representation === "iso8601-offset") {
    return typeof value === "string" && isIsoTemporalString(value);
  }
  return typeof value === "number" && Number.isFinite(value);
}

export function describeDataContract(): {
  readonly version: typeof DATA_CONTRACT_VERSION;
  readonly fieldRoles: readonly DataFieldRole[];
  readonly temporalRepresentations: readonly TemporalRepresentation[];
} {
  return Object.freeze({
    version: DATA_CONTRACT_VERSION,
    fieldRoles: DATA_FIELD_ROLES,
    temporalRepresentations: TEMPORAL_REPRESENTATIONS,
  });
}
