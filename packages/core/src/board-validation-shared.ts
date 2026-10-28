import { DIAGNOSTIC_CODES } from "./diagnostics.js";
import type { DocumentValidation } from "./document.js";
import { isPlainObject, type JsonValidationLimits } from "./json.js";
import { isValidTimeZone } from "./locale.js";
import {
  FIELD_ROLES,
  FIELD_VALUE_TYPES,
  FILTER_OPERATORS,
  type FieldRole,
  type FieldValueType,
  type FilterOperator,
} from "./board-schema.js";

export interface ProviderFieldDescriptor {
  readonly type: FieldValueType;
  readonly role?: FieldRole;
  readonly unit?: string;
  readonly timezone?: string;
  readonly operators?: readonly FilterOperator[];
}

export interface ProviderDatasetDescriptor {
  readonly fields?: Readonly<Record<string, ProviderFieldDescriptor>>;
  readonly slices?: Readonly<Record<string, readonly string[]>>;
}

export interface BoardValidationCatalog {
  readonly datasets: Readonly<Record<string, ProviderDatasetDescriptor>>;
  readonly blockTypes?: readonly string[];
  readonly conversionProviders?: readonly string[];
}

export interface BoardValidationOptions {
  readonly jsonLimits?: JsonValidationLimits;
  readonly catalog?: BoardValidationCatalog;
}

export interface BoardDocumentValidation extends DocumentValidation {
  readonly schemaVersion: number | null;
}

export interface FieldInfo {
  readonly type?: FieldValueType;
  readonly role?: FieldRole;
  readonly unit?: string;
  readonly timezone?: string;
  readonly operators?: readonly FilterOperator[];
}

export interface ScannedEntry {
  readonly id: string;
  readonly path: string;
  readonly value: Record<string, unknown>;
}

export interface ScanResult {
  readonly entries: readonly ScannedEntry[];
  readonly byId: ReadonlyMap<string, ScannedEntry>;
}

export interface ReferenceContext {
  readonly documentDatasets: ReadonlyMap<string, ScannedEntry>;
  readonly documentFields: ReadonlyMap<string, FieldInfo>;
  readonly documentSlices: ReadonlyMap<string, ScannedEntry>;
  readonly blocks: ReadonlyMap<string, ScannedEntry>;
  readonly groups: ReadonlyMap<string, ScannedEntry>;
  readonly filters: ReadonlyMap<string, ScannedEntry>;
  readonly comparisons: ReadonlyMap<string, ScannedEntry>;
  readonly catalog?: BoardValidationCatalog;
}

export type AddDiagnostic = (
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

const FIELD_REFERENCE_KEYS = new Set(["datasetId", "fieldId"]);

export function escapePointerSegment(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

export function own(value: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(value, key) ? value[key] : undefined;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return isPlainObject(value);
}

export function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

export function oneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

export function fieldKey(datasetId: string, fieldId: string): string {
  return `${datasetId}\u0000${fieldId}`;
}

export function checkUnknownKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
  add: AddDiagnostic,
): void {
  for (const key of Object.getOwnPropertyNames(value)) {
    if (!allowed.has(key)) {
      add(
        DIAGNOSTIC_CODES.UNKNOWN_PROPERTY,
        `${path}/${escapePointerSegment(key)}`,
        `Property "${key}" is not part of the Boardloom schema.`,
      );
    }
  }
}

export function hasDeclaredFields(dataset: ScannedEntry | undefined): boolean {
  return dataset !== undefined && Array.isArray(own(dataset.value, "fields"));
}

export function catalogDatasetEntry(
  catalog: BoardValidationCatalog | undefined,
  datasetId: string,
): ProviderDatasetDescriptor | undefined {
  if (!catalog || !isRecord(catalog.datasets) || !Object.hasOwn(catalog.datasets, datasetId)) {
    return undefined;
  }
  const entry = catalog.datasets[datasetId];
  return isRecord(entry) ? (entry as ProviderDatasetDescriptor) : undefined;
}

export function catalogFieldEntry(
  dataset: ProviderDatasetDescriptor | undefined,
  fieldId: string,
): ProviderFieldDescriptor | undefined {
  if (!dataset || !Object.hasOwn(dataset, "fields")) {
    return undefined;
  }
  const fields = dataset.fields;
  if (!isRecord(fields) || !Object.hasOwn(fields, fieldId)) {
    return undefined;
  }
  const entry = fields[fieldId];
  if (!isRecord(entry) || !oneOf(entry.type, FIELD_VALUE_TYPES)) {
    return undefined;
  }
  if (entry.role !== undefined && !oneOf(entry.role, FIELD_ROLES)) {
    return undefined;
  }
  if (entry.unit !== undefined && typeof entry.unit !== "string") {
    return undefined;
  }
  if (
    entry.timezone !== undefined &&
    (typeof entry.timezone !== "string" || !isValidTimeZone(entry.timezone))
  ) {
    return undefined;
  }
  if (entry.operators !== undefined) {
    if (
      !Array.isArray(entry.operators) ||
      !entry.operators.every((operator) => oneOf(operator, FILTER_OPERATORS))
    ) {
      return undefined;
    }
  }
  return entry as ProviderFieldDescriptor;
}

export function catalogSliceFields(
  dataset: ProviderDatasetDescriptor | undefined,
  sliceId: string,
): readonly string[] | undefined {
  if (!dataset || !Object.hasOwn(dataset, "slices")) {
    return undefined;
  }
  const slices = dataset.slices;
  if (!isRecord(slices) || !Object.hasOwn(slices, sliceId)) {
    return undefined;
  }
  const entry = slices[sliceId];
  if (!Array.isArray(entry) || !entry.every((fieldId) => typeof fieldId === "string")) {
    return undefined;
  }
  return entry;
}

export function catalogHasSlices(dataset: ProviderDatasetDescriptor | undefined): boolean {
  return dataset !== undefined && Object.hasOwn(dataset, "slices") && isRecord(dataset.slices);
}

export function resolveFieldId(
  datasetId: string,
  fieldId: string,
  path: string,
  context: ReferenceContext,
  add: AddDiagnostic,
): FieldInfo | null {
  const dataset = context.documentDatasets.get(datasetId);
  if (!dataset) {
    add(DIAGNOSTIC_CODES.INVALID_REFERENCE, path, undefined, {
      relatedIds: [datasetId, fieldId],
    });
    return null;
  }
  const documentInfo = context.documentFields.get(fieldKey(datasetId, fieldId));
  const providerDataset = catalogDatasetEntry(context.catalog, datasetId);
  const providerInfo = catalogFieldEntry(providerDataset, fieldId);
  if (providerInfo) {
    if (documentInfo && documentInfo.type !== providerInfo.type) {
      add(DIAGNOSTIC_CODES.PROVIDER_CAPABILITY_MISMATCH, path, undefined, {
        relatedIds: [datasetId, fieldId],
      });
    }
    return providerInfo;
  }
  if (context.catalog) {
    if (!providerDataset) {
      add(DIAGNOSTIC_CODES.INVALID_REFERENCE, path, undefined, {
        relatedIds: [datasetId],
      });
      return null;
    }
    if (providerDataset.fields && !providerInfo) {
      add(DIAGNOSTIC_CODES.INVALID_REFERENCE, path, undefined, {
        relatedIds: [datasetId, fieldId],
      });
      return null;
    }
  }
  if (documentInfo) {
    return documentInfo;
  }
  if (hasDeclaredFields(dataset)) {
    add(DIAGNOSTIC_CODES.INVALID_REFERENCE, path, undefined, {
      relatedIds: [datasetId, fieldId],
    });
    return null;
  }
  add(DIAGNOSTIC_CODES.REFERENCE_UNVERIFIED, path, undefined, {
    severity: "warning",
    source: "structural",
    relatedIds: [datasetId, fieldId],
  });
  return {};
}

export function resolveFieldReference(
  value: Record<string, unknown>,
  path: string,
  context: ReferenceContext,
  add: AddDiagnostic,
): FieldInfo | null {
  checkUnknownKeys(value, FIELD_REFERENCE_KEYS, path, add);
  const datasetId = own(value, "datasetId");
  const fieldId = own(value, "fieldId");
  if (!nonEmptyString(datasetId)) {
    add(DIAGNOSTIC_CODES.MISSING_ID, `${path}/datasetId`, "A dataset identifier is required.");
    return null;
  }
  if (!nonEmptyString(fieldId)) {
    add(DIAGNOSTIC_CODES.MISSING_ID, `${path}/fieldId`, "A field identifier is required.");
    return null;
  }
  return resolveFieldId(datasetId, fieldId, `${path}/fieldId`, context, add);
}

export function resolveSlice(
  datasetId: string,
  sliceId: string,
  path: string,
  context: ReferenceContext,
  add: AddDiagnostic,
): boolean {
  const slice = context.documentSlices.get(sliceId);
  if (!slice) {
    add(DIAGNOSTIC_CODES.INVALID_REFERENCE, path, undefined, { relatedIds: [sliceId] });
    return false;
  }
  const sliceDataset = own(slice.value, "datasetId");
  if (sliceDataset !== datasetId) {
    add(DIAGNOSTIC_CODES.INVALID_REFERENCE, path, undefined, {
      relatedIds: [sliceId, datasetId],
    });
    return false;
  }
  return true;
}

function validDateParts(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) {
    return false;
  }
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isIsoDateString(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }
  return validDateParts(Number(match[1]), Number(match[2]), Number(match[3]));
}

export function isIsoDateTimeString(value: string): boolean {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = match[6] === undefined ? 0 : Number(match[6]);
  if (!validDateParts(year, month, day) || hour > 23 || minute > 59 || second > 59) {
    return false;
  }
  return Number.isFinite(Date.parse(value));
}

export function isIsoTemporalString(value: string): boolean {
  return isIsoDateString(value) || isIsoDateTimeString(value);
}
