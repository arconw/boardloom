import { FIELD_VALUE_TYPES } from "./board-schema.js";
import {
  DATA_FIELD_ROLES,
  isTemporalField,
  type QueryCounts,
  type QueryResultField,
  type QueryResultRow,
} from "./data-contract.js";
import { DIAGNOSTIC_CODES, createDiagnostic, type Diagnostic } from "./diagnostics.js";
import { cloneJson, deepFreeze, isPlainObject, validateJsonValue, type JsonValue } from "./json.js";
import { isValidTimeZone } from "./locale.js";
import {
  isIsoDateString,
  isIsoDateTimeString,
  isRecord,
  nonEmptyString,
  own,
} from "./board-validation-shared.js";

export type AdmittedProviderResult =
  | { readonly ok: true; readonly value: Record<string, unknown> }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

export function admitProviderResult(value: unknown): AdmittedProviderResult {
  if (!isRecord(value)) {
    return Object.freeze({
      ok: false as const,
      diagnostics: Object.freeze([
        createDiagnostic(DIAGNOSTIC_CODES.QUERY_RESULT_INVALID, "result", {
          message: "A provider result must be a plain object.",
        }),
      ]),
    });
  }
  const validation = validateJsonValue(value);
  if (!validation.valid) {
    return Object.freeze({
      ok: false as const,
      diagnostics: Object.freeze(
        validation.issues.map((issue) =>
          createDiagnostic(DIAGNOSTIC_CODES.QUERY_RESULT_INVALID, `result${issue.path}`, {
            message: issue.message,
          }),
        ),
      ),
    });
  }
  try {
    return Object.freeze({
      ok: true as const,
      value: cloneJson(value as JsonValue) as Record<string, unknown>,
    });
  } catch {
    return Object.freeze({
      ok: false as const,
      diagnostics: Object.freeze([
        createDiagnostic(DIAGNOSTIC_CODES.QUERY_RESULT_INVALID, "result", {
          message: "The provider result is not descriptor-safe JSON data.",
        }),
      ]),
    });
  }
}

export interface NormalizedSuccess {
  readonly fields: readonly QueryResultField[];
  readonly rows: readonly QueryResultRow[];
  readonly counts: QueryCounts;
  readonly diagnostics: readonly Diagnostic[];
  readonly complete: boolean;
  readonly nextCursor?: string;
}

export function normalizeDiagnostics(
  value: unknown,
  diagnostics: Diagnostic[],
  path: string,
): readonly Diagnostic[] | null {
  if (!Array.isArray(value)) {
    diagnostics.push(createDiagnostic(DIAGNOSTIC_CODES.QUERY_RESULT_INVALID, path));
    return null;
  }
  const normalized: Diagnostic[] = [];
  value.forEach((entry, index) => {
    if (!isRecord(entry)) {
      diagnostics.push(createDiagnostic(DIAGNOSTIC_CODES.QUERY_RESULT_INVALID, `${path}/${index}`));
      return;
    }
    const code = own(entry, "code");
    const diagnosticPath = own(entry, "path");
    const message = own(entry, "message");
    const severity = own(entry, "severity");
    if (
      !nonEmptyString(code) ||
      typeof diagnosticPath !== "string" ||
      typeof message !== "string" ||
      (severity !== "error" && severity !== "warning")
    ) {
      diagnostics.push(createDiagnostic(DIAGNOSTIC_CODES.QUERY_RESULT_INVALID, `${path}/${index}`));
      return;
    }
    const hint = own(entry, "hint");
    const source = own(entry, "source");
    const relatedIds = own(entry, "relatedIds");
    normalized.push(
      createDiagnostic(code, diagnosticPath, {
        message,
        severity,
        ...(typeof hint === "string" ? { hint } : {}),
        ...(typeof source === "string" ? { source } : {}),
        ...(Array.isArray(relatedIds) && relatedIds.every((item) => typeof item === "string")
          ? { relatedIds: relatedIds as string[] }
          : {}),
      }),
    );
  });
  return Object.freeze(normalized);
}

function normalizeUnit(
  value: unknown,
  diagnostics: Diagnostic[],
  path: string,
): QueryResultField["unit"] | null {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    diagnostics.push(createDiagnostic(DIAGNOSTIC_CODES.QUERY_RESULT_INVALID, path));
    return null;
  }
  const unit = own(value, "unit");
  const scale = own(value, "scale");
  const label = own(value, "label");
  if (
    !nonEmptyString(unit) ||
    (scale !== undefined &&
      (typeof scale !== "number" || !Number.isFinite(scale) || scale === 0)) ||
    (label !== undefined && typeof label !== "string")
  ) {
    diagnostics.push(createDiagnostic(DIAGNOSTIC_CODES.QUERY_RESULT_INVALID, path));
    return null;
  }
  return Object.freeze({
    unit,
    ...(typeof scale === "number" ? { scale } : {}),
    ...(typeof label === "string" ? { label } : {}),
  });
}

function normalizeResultFields(
  value: unknown,
  diagnostics: Diagnostic[],
): readonly QueryResultField[] | null {
  if (!Array.isArray(value)) {
    diagnostics.push(createDiagnostic(DIAGNOSTIC_CODES.QUERY_RESULT_INVALID, "result/fields"));
    return null;
  }
  const seen = new Set<string>();
  const fields: QueryResultField[] = [];
  value.forEach((entry, index) => {
    const path = `result/fields/${index}`;
    if (!isRecord(entry)) {
      diagnostics.push(createDiagnostic(DIAGNOSTIC_CODES.QUERY_RESULT_INVALID, path));
      return;
    }
    const fieldId = own(entry, "fieldId");
    const type = own(entry, "type");
    const role = own(entry, "role");
    const sourceFieldId = own(entry, "sourceFieldId");
    const timezone = own(entry, "timezone");
    const temporalRepresentation = own(entry, "temporalRepresentation");
    if (!nonEmptyString(fieldId)) {
      diagnostics.push(createDiagnostic(DIAGNOSTIC_CODES.QUERY_RESULT_INVALID, `${path}/fieldId`));
      return;
    }
    if (seen.has(fieldId)) {
      diagnostics.push(
        createDiagnostic(DIAGNOSTIC_CODES.QUERY_RESULT_INVALID, `${path}/fieldId`, {
          message: `Duplicate result field "${fieldId}".`,
        }),
      );
      return;
    }
    if (!(FIELD_VALUE_TYPES as readonly unknown[]).includes(type)) {
      diagnostics.push(createDiagnostic(DIAGNOSTIC_CODES.QUERY_RESULT_INVALID, `${path}/type`));
      return;
    }
    if (!(DATA_FIELD_ROLES as readonly unknown[]).includes(role)) {
      diagnostics.push(createDiagnostic(DIAGNOSTIC_CODES.QUERY_RESULT_INVALID, `${path}/role`));
      return;
    }
    if (
      sourceFieldId !== undefined &&
      (typeof sourceFieldId !== "string" || sourceFieldId.trim() === "")
    ) {
      diagnostics.push(
        createDiagnostic(DIAGNOSTIC_CODES.QUERY_RESULT_INVALID, `${path}/sourceFieldId`),
      );
      return;
    }
    if (timezone !== undefined && (typeof timezone !== "string" || !isValidTimeZone(timezone))) {
      diagnostics.push(createDiagnostic(DIAGNOSTIC_CODES.QUERY_RESULT_INVALID, `${path}/timezone`));
      return;
    }
    if (
      temporalRepresentation !== undefined &&
      temporalRepresentation !== "iso8601-offset" &&
      temporalRepresentation !== "epoch-milliseconds" &&
      temporalRepresentation !== "epoch-seconds"
    ) {
      diagnostics.push(
        createDiagnostic(DIAGNOSTIC_CODES.QUERY_RESULT_INVALID, `${path}/temporalRepresentation`),
      );
      return;
    }
    const unit = normalizeUnit(own(entry, "unit"), diagnostics, `${path}/unit`);
    if (unit === null) {
      return;
    }
    seen.add(fieldId);
    fields.push(
      Object.freeze({
        fieldId,
        ...(sourceFieldId === undefined ? {} : { sourceFieldId }),
        type: type as QueryResultField["type"],
        role: role as QueryResultField["role"],
        ...(unit === undefined ? {} : { unit }),
        ...(typeof timezone === "string" ? { timezone } : {}),
        ...(temporalRepresentation === undefined
          ? {}
          : {
              temporalRepresentation:
                temporalRepresentation as QueryResultField["temporalRepresentation"],
            }),
      }),
    );
  });
  if (diagnostics.length > 0) {
    return null;
  }
  return Object.freeze(fields);
}

function valueMatchesResultField(value: JsonValue, field: QueryResultField): boolean {
  if (value === null) {
    return true;
  }
  if (isTemporalField(field)) {
    if (
      field.temporalRepresentation === "epoch-milliseconds" ||
      field.temporalRepresentation === "epoch-seconds"
    ) {
      return typeof value === "number" && Number.isFinite(value);
    }
    if (field.type === "date") {
      return typeof value === "string" && isIsoDateString(value);
    }
    return typeof value === "string" && isIsoDateTimeString(value);
  }
  if (field.type === "number") {
    return typeof value === "number" && Number.isFinite(value);
  }
  if (field.type === "string") {
    return typeof value === "string";
  }
  return typeof value === "boolean";
}

function normalizeRows(
  value: unknown,
  fields: readonly QueryResultField[],
  diagnostics: Diagnostic[],
): readonly QueryResultRow[] | null {
  if (!Array.isArray(value)) {
    diagnostics.push(createDiagnostic(DIAGNOSTIC_CODES.QUERY_RESULT_INVALID, "result/rows"));
    return null;
  }
  const json = validateJsonValue(value);
  if (!json.valid) {
    for (const issue of json.issues) {
      diagnostics.push(
        createDiagnostic(DIAGNOSTIC_CODES.QUERY_RESULT_INVALID, `result/rows${issue.path}`, {
          message: issue.message,
        }),
      );
    }
    return null;
  }
  const fieldById = new Map(fields.map((field) => [field.fieldId, field]));
  const rows: QueryResultRow[] = [];
  value.forEach((entry, index) => {
    if (!isPlainObject(entry)) {
      diagnostics.push(
        createDiagnostic(DIAGNOSTIC_CODES.QUERY_RESULT_INVALID, `result/rows/${index}`),
      );
      return;
    }
    for (const key of Object.getOwnPropertyNames(entry)) {
      const field = fieldById.get(key);
      if (!field) {
        diagnostics.push(
          createDiagnostic(DIAGNOSTIC_CODES.QUERY_RESULT_INVALID, `result/rows/${index}/${key}`, {
            message: `Row field "${key}" is not declared in the result field metadata.`,
          }),
        );
        continue;
      }
      if (!valueMatchesResultField(entry[key] as JsonValue, field)) {
        diagnostics.push(
          createDiagnostic(DIAGNOSTIC_CODES.QUERY_RESULT_INVALID, `result/rows/${index}/${key}`),
        );
      }
    }
    if (diagnostics.length > 0) {
      return;
    }
    rows.push(deepFreeze(cloneJson(entry as JsonValue) as QueryResultRow));
  });
  if (diagnostics.length > 0) {
    return null;
  }
  return Object.freeze(rows);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function normalizeCounts(
  value: unknown,
  rowCount: number,
  diagnostics: Diagnostic[],
  allowGlobalAggregateRow: boolean,
): QueryCounts | null {
  if (!isRecord(value)) {
    diagnostics.push(createDiagnostic(DIAGNOSTIC_CODES.QUERY_RESULT_INVALID, "result/counts"));
    return null;
  }
  const returnedRows = own(value, "returnedRows");
  const totalRows = own(value, "totalRows");
  const filteredRows = own(value, "filteredRows");
  const nullCounts = own(value, "nullCounts");
  if (
    !isCount(returnedRows) ||
    returnedRows !== rowCount ||
    (totalRows !== null && !isCount(totalRows)) ||
    !isCount(filteredRows) ||
    (filteredRows < returnedRows &&
      !(allowGlobalAggregateRow && filteredRows === 0 && returnedRows === 1 && rowCount === 1)) ||
    (typeof totalRows === "number" && totalRows < filteredRows) ||
    !isRecord(nullCounts)
  ) {
    diagnostics.push(createDiagnostic(DIAGNOSTIC_CODES.QUERY_RESULT_INVALID, "result/counts"));
    return null;
  }
  const normalizedNulls: Record<string, number> = Object.create(null) as Record<string, number>;
  for (const key of Object.getOwnPropertyNames(nullCounts)) {
    const count = nullCounts[key];
    if (!isCount(count) || count > filteredRows) {
      diagnostics.push(
        createDiagnostic(DIAGNOSTIC_CODES.QUERY_RESULT_INVALID, `result/counts/nullCounts/${key}`),
      );
      return null;
    }
    Object.defineProperty(normalizedNulls, key, {
      value: count,
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  return Object.freeze({
    returnedRows,
    totalRows,
    filteredRows,
    nullCounts: Object.freeze(normalizedNulls),
  });
}

export function normalizeSuccess(
  result: Record<string, unknown>,
  diagnostics: Diagnostic[],
  expectedFields: readonly QueryResultField[],
  allowGlobalAggregateRow: boolean,
): NormalizedSuccess | null {
  const reportedFields = normalizeResultFields(own(result, "fields"), diagnostics);
  if (!reportedFields) {
    return null;
  }
  if (
    reportedFields.length !== expectedFields.length ||
    reportedFields.some((field, index) => {
      const expected = expectedFields[index];
      return (
        expected === undefined ||
        field.fieldId !== expected.fieldId ||
        field.type !== expected.type ||
        field.role !== expected.role
      );
    })
  ) {
    diagnostics.push(
      createDiagnostic(DIAGNOSTIC_CODES.QUERY_RESULT_INVALID, "result/fields", {
        message: "The provider result fields do not match the planned query output.",
      }),
    );
    return null;
  }
  const rows = normalizeRows(own(result, "rows"), expectedFields, diagnostics);
  if (!rows) {
    return null;
  }
  const counts = normalizeCounts(
    own(result, "counts"),
    rows.length,
    diagnostics,
    allowGlobalAggregateRow,
  );
  if (!counts) {
    return null;
  }
  const complete = own(result, "complete");
  if (typeof complete !== "boolean") {
    diagnostics.push(createDiagnostic(DIAGNOSTIC_CODES.QUERY_RESULT_INVALID, "result/complete"));
    return null;
  }
  const nextCursor = own(result, "nextCursor");
  if (nextCursor !== undefined && (typeof nextCursor !== "string" || nextCursor.trim() === "")) {
    diagnostics.push(createDiagnostic(DIAGNOSTIC_CODES.QUERY_RESULT_INVALID, "result/nextCursor"));
    return null;
  }
  if (complete && nextCursor !== undefined) {
    diagnostics.push(
      createDiagnostic(DIAGNOSTIC_CODES.QUERY_RESULT_INVALID, "result/nextCursor", {
        message: "A complete result must not declare a next cursor.",
      }),
    );
    return null;
  }
  const providerDiagnostics = normalizeDiagnostics(
    own(result, "diagnostics"),
    diagnostics,
    "result/diagnostics",
  );
  if (!providerDiagnostics) {
    return null;
  }
  return Object.freeze({
    fields: expectedFields,
    rows,
    counts,
    diagnostics: providerDiagnostics,
    complete,
    ...(typeof nextCursor === "string" ? { nextCursor } : {}),
  });
}
