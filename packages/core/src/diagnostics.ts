import { deepFreeze } from "./json.js";

export const DIAGNOSTIC_CODES = Object.freeze({
  SPACE_ALREADY_EXISTS: "SPACE_ALREADY_EXISTS",
  SPACE_DISPOSED: "SPACE_DISPOSED",
  SPACE_NOT_FOUND: "SPACE_NOT_FOUND",
  RUNTIME_DISPOSED: "RUNTIME_DISPOSED",
  VIEW_DISPOSED: "VIEW_DISPOSED",
  VIEW_SESSION_RESTORE_FAILED: "VIEW_SESSION_RESTORE_FAILED",
  VIEWER_READ_ONLY: "VIEWER_READ_ONLY",
  EDITOR_LEASE_REQUIRED: "EDITOR_LEASE_REQUIRED",
  EDITOR_LEASE_CONFLICT: "EDITOR_LEASE_CONFLICT",
  EDITOR_LEASE_INVALID: "EDITOR_LEASE_INVALID",
  DRAFT_REQUIRES_DECISION: "DRAFT_REQUIRES_DECISION",
  DISPOSAL_PARTIAL: "DISPOSAL_PARTIAL",
  DRAFT_HISTORY_EMPTY: "DRAFT_HISTORY_EMPTY",
  DRAFT_INVALID: "DRAFT_INVALID",
  REVISION_CONFLICT: "REVISION_CONFLICT",
  DOCUMENT_INVALID: "DOCUMENT_INVALID",
  MALFORMED_JSON: "MALFORMED_JSON",
  IMPORT_TOO_LARGE: "IMPORT_TOO_LARGE",
  IMPORT_LIMIT_EXCEEDED: "IMPORT_LIMIT_EXCEEDED",
  SCHEMA_VERSION_INVALID: "SCHEMA_VERSION_INVALID",
  UNSUPPORTED_SCHEMA_VERSION: "UNSUPPORTED_SCHEMA_VERSION",
  FUTURE_SCHEMA_VERSION: "FUTURE_SCHEMA_VERSION",
  MISSING_REQUIRED_PROPERTY: "MISSING_REQUIRED_PROPERTY",
  INVALID_PROPERTY_TYPE: "INVALID_PROPERTY_TYPE",
  MISSING_ID: "MISSING_ID",
  DUPLICATE_ID: "DUPLICATE_ID",
  UNKNOWN_BLOCK_TYPE: "UNKNOWN_BLOCK_TYPE",
  UNKNOWN_RENDERER_TYPE: "UNKNOWN_RENDERER_TYPE",
  RENDERER_INVALID: "RENDERER_INVALID",
  RENDERER_FAILED: "RENDERER_FAILED",
  RENDERER_INCOMPATIBLE: "RENDERER_INCOMPATIBLE",
  RENDERER_DATA_INVALID: "RENDERER_DATA_INVALID",
  RENDERER_DUPLICATE_POINT: "RENDERER_DUPLICATE_POINT",
  RENDERER_UNSUPPORTED: "RENDERER_UNSUPPORTED",
  BLOCK_SURFACE_FAILED: "BLOCK_SURFACE_FAILED",
  LAYOUT_INVALID: "LAYOUT_INVALID",
  LAYOUT_OVERLAP: "LAYOUT_OVERLAP",
  LAYOUT_FALLBACK: "LAYOUT_FALLBACK",
  INVALID_REFERENCE: "INVALID_REFERENCE",
  REFERENCE_UNVERIFIED: "REFERENCE_UNVERIFIED",
  INCOMPATIBLE_BINDING: "INCOMPATIBLE_BINDING",
  FIXED_BINDING_LOCKED: "FIXED_BINDING_LOCKED",
  FIXED_BINDING_CHANGED: "FIXED_BINDING_CHANGED",
  INCOMPATIBLE_FILTER: "INCOMPATIBLE_FILTER",
  FILTER_CONFLICT: "FILTER_CONFLICT",
  FILTER_TARGET_UNMAPPED: "FILTER_TARGET_UNMAPPED",
  FILTER_TARGET_INCOMPATIBLE: "FILTER_TARGET_INCOMPATIBLE",
  FILTER_SCHEMA_PENDING: "FILTER_SCHEMA_PENDING",
  FILTER_STATE_INVALID: "FILTER_STATE_INVALID",
  CROSS_FILTER_INCOMPATIBLE: "CROSS_FILTER_INCOMPATIBLE",
  INCOMPATIBLE_COMPARISON: "INCOMPATIBLE_COMPARISON",
  COMPARISON_MAPPING_INCOMPLETE: "COMPARISON_MAPPING_INCOMPLETE",
  COMPARISON_AGGREGATION_REQUIRED: "COMPARISON_AGGREGATION_REQUIRED",
  COMPARISON_SLICE_MISMATCH: "COMPARISON_SLICE_MISMATCH",
  COMPARISON_WINDOW_FIELD_MISSING: "COMPARISON_WINDOW_FIELD_MISSING",
  COMPARISON_ALIGNMENT_INVALID: "COMPARISON_ALIGNMENT_INVALID",
  COMPARISON_CONVERSION_UNSUPPORTED: "COMPARISON_CONVERSION_UNSUPPORTED",
  DUPLICATE_ALIGNMENT_KEY: "DUPLICATE_ALIGNMENT_KEY",
  NULL_ALIGNMENT_KEY: "NULL_ALIGNMENT_KEY",
  INVALID_THEME_TOKEN: "INVALID_THEME_TOKEN",
  UNKNOWN_PROPERTY: "UNKNOWN_PROPERTY",
  INVALID_EXTENSION_KEY: "INVALID_EXTENSION_KEY",
  PROVIDER_CAPABILITY_MISMATCH: "PROVIDER_CAPABILITY_MISMATCH",
  DATASET_DESCRIPTOR_INVALID: "DATASET_DESCRIPTOR_INVALID",
  DATASET_CAPABILITY_INVALID: "DATASET_CAPABILITY_INVALID",
  QUERY_PROVIDER_MISSING: "QUERY_PROVIDER_MISSING",
  QUERY_PROVIDER_INVALID: "QUERY_PROVIDER_INVALID",
  QUERY_INVALID: "QUERY_INVALID",
  QUERY_NOT_FOUND: "QUERY_NOT_FOUND",
  QUERY_ROW_INVALID: "QUERY_ROW_INVALID",
  QUERY_RESULT_INVALID: "QUERY_RESULT_INVALID",
  QUERY_RESULT_TRUNCATED: "QUERY_RESULT_TRUNCATED",
  QUERY_REQUEST_NOT_HONORED: "QUERY_REQUEST_NOT_HONORED",
  QUERY_FAILED: "QUERY_FAILED",
  QUERY_CANCELLED: "QUERY_CANCELLED",
  QUERY_STALE: "QUERY_STALE",
  REALTIME_NOT_CONFIGURED: "REALTIME_NOT_CONFIGURED",
  REALTIME_PROVIDER_UNSUPPORTED: "REALTIME_PROVIDER_UNSUPPORTED",
  REALTIME_TRANSPORT_UNAVAILABLE: "REALTIME_TRANSPORT_UNAVAILABLE",
  REALTIME_SUBSCRIPTION_FAILED: "REALTIME_SUBSCRIPTION_FAILED",
  REALTIME_ENVELOPE_INVALID: "REALTIME_ENVELOPE_INVALID",
  REALTIME_QUERY_MISMATCH: "REALTIME_QUERY_MISMATCH",
  REALTIME_GENERATION_MISMATCH: "REALTIME_GENERATION_MISMATCH",
  REALTIME_EPOCH_MISMATCH: "REALTIME_EPOCH_MISMATCH",
  REALTIME_SEQUENCE_GAP: "REALTIME_SEQUENCE_GAP",
  REALTIME_DUPLICATE: "REALTIME_DUPLICATE",
  REALTIME_STALE_MESSAGE: "REALTIME_STALE_MESSAGE",
  REALTIME_BUFFER_OVERFLOW: "REALTIME_BUFFER_OVERFLOW",
  REALTIME_ROW_INVALID: "REALTIME_ROW_INVALID",
  REALTIME_ROW_MISSING: "REALTIME_ROW_MISSING",
  REALTIME_RESYNC_COMPLETED: "REALTIME_RESYNC_COMPLETED",
  REALTIME_ERROR: "REALTIME_ERROR",
  MIGRATION_FAILED: "MIGRATION_FAILED",
  MIGRATION_SYNTHETIC_SOURCE: "MIGRATION_SYNTHETIC_SOURCE",
  EXPORT_INVALID: "EXPORT_INVALID",
  INVALID_LOCALE: "INVALID_LOCALE",
  INVALID_TIMEZONE: "INVALID_TIMEZONE",
  INVALID_ARGUMENT: "INVALID_ARGUMENT",
  FORMATTER_INIT_FAILED: "FORMATTER_INIT_FAILED",
  FORMAT_INVALID_VALUE: "FORMAT_INVALID_VALUE",
  FORMAT_NON_FINITE: "FORMAT_NON_FINITE",
  FORMAT_INVALID_DATE: "FORMAT_INVALID_DATE",
  MESSAGE_MISSING_KEY: "MESSAGE_MISSING_KEY",
  MESSAGE_MISSING_PARAM: "MESSAGE_MISSING_PARAM",
  MESSAGE_INVALID_PARAM: "MESSAGE_INVALID_PARAM",
  MESSAGE_INVALID_DICTIONARY: "MESSAGE_INVALID_DICTIONARY",
  EXTENSION_INVALID: "EXTENSION_INVALID",
  EXTENSION_DUPLICATE: "EXTENSION_DUPLICATE",
  EXTENSION_INCOMPATIBLE_API: "EXTENSION_INCOMPATIBLE_API",
  EXTENSION_FAILED: "EXTENSION_FAILED",
  EXTENSION_DISPOSAL_FAILED: "EXTENSION_DISPOSAL_FAILED",
  EXTENSION_STYLE_INVALID: "EXTENSION_STYLE_INVALID",
} as const);

export type DiagnosticCode = (typeof DIAGNOSTIC_CODES)[keyof typeof DIAGNOSTIC_CODES];
export type DiagnosticSeverity = "error" | "warning";

export interface Diagnostic {
  readonly code: string;
  readonly path: string;
  readonly message: string;
  readonly severity: DiagnosticSeverity;
  readonly hint?: string;
  readonly relatedIds?: readonly string[];
  readonly source?: string;
}

export interface DiagnosticOptions {
  readonly severity?: DiagnosticSeverity;
  readonly hint?: string;
  readonly relatedIds?: readonly string[];
  readonly source?: string;
  readonly message?: string;
}

export interface OperationSuccess<T> {
  readonly ok: true;
  readonly value: T;
}

export interface OperationFailure {
  readonly ok: false;
  readonly diagnostics: readonly Diagnostic[];
}

export type Result<T> = OperationSuccess<T> | OperationFailure;

export function ok<T>(value: T): Result<T> {
  return Object.freeze({ ok: true, value });
}

export function fail(diagnostics: readonly Diagnostic[]): OperationFailure {
  const frozen = deepFreeze([...diagnostics]);
  return Object.freeze({ ok: false, diagnostics: frozen });
}

export const DIAGNOSTIC_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  SPACE_ALREADY_EXISTS: "A space with this ID already exists in the runtime.",
  SPACE_DISPOSED: "The space has been disposed and no longer accepts commands.",
  SPACE_NOT_FOUND: "The requested space does not exist in the runtime.",
  RUNTIME_DISPOSED: "The runtime has been disposed and no longer creates spaces.",
  VIEW_DISPOSED: "The view has been disposed and no longer accepts commands.",
  VIEW_SESSION_RESTORE_FAILED:
    "The external view's original mode or session could not be restored.",
  VIEWER_READ_ONLY: "A viewer-bound command cannot change the board structure or configuration.",
  EDITOR_LEASE_REQUIRED: "An active editor lease is required for this authoring command.",
  EDITOR_LEASE_CONFLICT: "Another editor lease already holds the authoring lock for this space.",
  EDITOR_LEASE_INVALID: "The editor lease does not belong to this space or is no longer active.",
  DRAFT_REQUIRES_DECISION:
    "The draft has unsaved changes and requires an explicit apply or cancel decision.",
  DISPOSAL_PARTIAL: "Disposal stopped after some spaces were already resolved or closed.",
  DRAFT_HISTORY_EMPTY: "There is no draft change available in that direction.",
  DRAFT_INVALID: "The draft failed document validation and was not applied.",
  REVISION_CONFLICT:
    "The committed document advanced after the draft started; the draft was preserved.",
  DOCUMENT_INVALID: "The value is not a valid board document.",
  MALFORMED_JSON: "The imported text is not valid JSON.",
  IMPORT_TOO_LARGE: "The imported document exceeds the configured size limit.",
  IMPORT_LIMIT_EXCEEDED: "The imported document exceeds a configured structural limit.",
  SCHEMA_VERSION_INVALID: "The document schema version must be a non-negative integer.",
  UNSUPPORTED_SCHEMA_VERSION:
    "The document schema version is older than this Boardloom build supports.",
  FUTURE_SCHEMA_VERSION:
    "The document was written by a newer Boardloom schema and cannot be downgraded.",
  MISSING_REQUIRED_PROPERTY: "A required board document property is missing.",
  INVALID_PROPERTY_TYPE: "A board document property has the wrong type or value.",
  MISSING_ID: "A required stable identifier is missing or empty.",
  DUPLICATE_ID: "An identifier is duplicated within its namespace.",
  UNKNOWN_BLOCK_TYPE: "The block type is not a registered built-in or extension block type.",
  UNKNOWN_RENDERER_TYPE: "The chart or renderer type is not registered.",
  RENDERER_INVALID: "The renderer definition is invalid or already registered.",
  RENDERER_FAILED: "The renderer failed while mounting, updating or destroying a block.",
  RENDERER_INCOMPATIBLE:
    "The renderer spec or field combination is not compatible with the selected visualization.",
  RENDERER_DATA_INVALID:
    "The data violates a renderer policy such as a non-negative stacked or donut total.",
  RENDERER_DUPLICATE_POINT:
    "The query produced duplicate category and series points. Adjust the X, series or label bindings so each point is unique.",
  RENDERER_UNSUPPORTED: "No registered renderer supports this block and visualization.",
  BLOCK_SURFACE_FAILED: "The block surface failed while rendering or updating.",
  LAYOUT_INVALID: "The layout geometry is invalid or outside the breakpoint grid.",
  LAYOUT_OVERLAP: "Two block placements overlap within the same breakpoint.",
  LAYOUT_FALLBACK: "A block has no placement for this breakpoint and falls back to a larger one.",
  INVALID_REFERENCE: "A document reference does not resolve to an existing value.",
  REFERENCE_UNVERIFIED:
    "A field or provider reference could not be verified without a host provider catalog.",
  INCOMPATIBLE_BINDING: "A block binding is incompatible with its block or field.",
  FIXED_BINDING_LOCKED:
    "A fixed binding is locked by configuration and cannot be changed. Locking is not a security boundary.",
  FIXED_BINDING_CHANGED:
    "A document replacement changed or removed a fixed binding; the document was rejected.",
  INCOMPATIBLE_FILTER: "A filter operator or value is incompatible with its field or target.",
  FILTER_CONFLICT:
    "Two active filters on the same field contradict each other and produce an empty result.",
  FILTER_TARGET_UNMAPPED:
    "A filter target uses a different dataset and has no explicit field mapping.",
  FILTER_TARGET_INCOMPATIBLE:
    "A filter field mapping is incompatible in type, unit or time semantics.",
  FILTER_SCHEMA_PENDING:
    "The filter target schema is not known yet; the filter is pending rather than guessed.",
  FILTER_STATE_INVALID: "The serialized filter runtime state is invalid.",
  CROSS_FILTER_INCOMPATIBLE: "The cross-filter selection is not compatible with this target block.",
  INCOMPATIBLE_COMPARISON: "The comparison mapping, units or alignment are incompatible.",
  COMPARISON_MAPPING_INCOMPLETE:
    "A comparison field used by the block has no explicit mapping on the other side.",
  COMPARISON_AGGREGATION_REQUIRED:
    "A comparison requires explicit grouping and aggregation before rows can be aligned.",
  COMPARISON_SLICE_MISMATCH:
    "A block binding and its comparison side declare different slices for the same dataset.",
  COMPARISON_WINDOW_FIELD_MISSING:
    "A comparison time window was declared but no mapped temporal field is available.",
  COMPARISON_ALIGNMENT_INVALID:
    "A comparison alignment key or normalization rule is invalid or unsupported.",
  COMPARISON_CONVERSION_UNSUPPORTED:
    "A unit conversion cannot be applied to the selected aggregation without changing its meaning.",
  DUPLICATE_ALIGNMENT_KEY:
    "Two rows share the same composite alignment key after grouping and aggregation.",
  NULL_ALIGNMENT_KEY:
    "A row has a null component in its composite alignment key and was excluded from matching.",
  INVALID_THEME_TOKEN: "A theme token name or value is invalid.",
  UNKNOWN_PROPERTY: "A property is not recognized by the schema version.",
  INVALID_EXTENSION_KEY: "Extension keys must be namespaced with at least one dot.",
  PROVIDER_CAPABILITY_MISMATCH: "The document uses a provider capability that is unavailable.",
  DATASET_DESCRIPTOR_INVALID:
    "The dataset descriptor does not satisfy the Boardloom data contract.",
  DATASET_CAPABILITY_INVALID: "The dataset capability declaration is invalid.",
  QUERY_PROVIDER_MISSING: "No dataset provider is configured for this space.",
  QUERY_PROVIDER_INVALID: "The dataset provider does not satisfy the provider contract.",
  QUERY_INVALID: "The query specification is invalid.",
  QUERY_NOT_FOUND: "The requested query does not exist in this space.",
  QUERY_ROW_INVALID: "A provider row contains invalid or non-finite data.",
  QUERY_RESULT_INVALID: "The provider result does not satisfy the query result contract.",
  QUERY_RESULT_TRUNCATED: "The provider truncated the result at its declared size limit.",
  QUERY_REQUEST_NOT_HONORED:
    "The async provider did not confirm every requested filter, grouping, aggregation or time window.",
  QUERY_FAILED: "The dataset provider failed to execute the query.",
  QUERY_CANCELLED: "The query was cancelled.",
  QUERY_STALE: "An older or superseded query result was ignored.",
  REALTIME_NOT_CONFIGURED: "No realtime transport is configured for this space.",
  REALTIME_PROVIDER_UNSUPPORTED: "The dataset does not declare realtime capability.",
  REALTIME_TRANSPORT_UNAVAILABLE: "The realtime transport could not open a subscription.",
  REALTIME_SUBSCRIPTION_FAILED: "The realtime subscription failed to start.",
  REALTIME_ENVELOPE_INVALID: "A realtime envelope does not satisfy the live contract.",
  REALTIME_QUERY_MISMATCH: "A realtime message belongs to a different query, dataset or slice.",
  REALTIME_GENERATION_MISMATCH: "A realtime message belongs to an older query generation.",
  REALTIME_EPOCH_MISMATCH: "A realtime message belongs to an incomparable provider epoch.",
  REALTIME_SEQUENCE_GAP: "A realtime sequence gap requires resynchronization.",
  REALTIME_DUPLICATE: "A duplicate or older realtime message was ignored.",
  REALTIME_STALE_MESSAGE: "A stale realtime message was ignored.",
  REALTIME_BUFFER_OVERFLOW: "The bounded realtime buffer dropped or coalesced messages.",
  REALTIME_ROW_INVALID: "A realtime row does not match the query-shaped result contract.",
  REALTIME_ROW_MISSING: "A realtime delete referenced a row that is not present.",
  REALTIME_RESYNC_COMPLETED: "Realtime resynchronization completed with a new baseline.",
  REALTIME_ERROR: "The realtime provider reported an error.",
  MIGRATION_FAILED: "The document cannot be migrated to the current schema version.",
  MIGRATION_SYNTHETIC_SOURCE:
    "The source document is a synthetic pre-release fixture, not a published historical format.",
  EXPORT_INVALID: "The document cannot be exported because it does not pass schema validation.",
  INVALID_LOCALE: "The locale is not one of the supported Boardloom UI locales.",
  INVALID_TIMEZONE: "The timezone is not a valid IANA time zone identifier.",
  INVALID_ARGUMENT: "An argument does not satisfy the documented contract.",
  FORMATTER_INIT_FAILED:
    "The formatter provider could not be created for this locale configuration.",
  FORMAT_INVALID_VALUE: "The value cannot be formatted with the requested options.",
  FORMAT_NON_FINITE: "Non-finite numbers are invalid data and are not rendered as zero.",
  FORMAT_INVALID_DATE: "The value is not a valid date or timestamp.",
  MESSAGE_MISSING_KEY: "The message key is missing from every provider in the fallback chain.",
  MESSAGE_MISSING_PARAM: "A message placeholder has no matching interpolation parameter.",
  MESSAGE_INVALID_PARAM: "Interpolation parameters must be plain scalar values.",
  MESSAGE_INVALID_DICTIONARY: "A message dictionary is not a plain string-to-string record.",
  EXTENSION_INVALID:
    "The extension definition is missing required metadata or has an invalid shape.",
  EXTENSION_DUPLICATE: "An extension with this kind and ID is already registered.",
  EXTENSION_INCOMPATIBLE_API:
    "The extension targets an API version that this Boardloom build does not support.",
  EXTENSION_FAILED: "The extension failed while it was being created, used or disposed.",
  EXTENSION_DISPOSAL_FAILED:
    "An extension failed during disposal; other extensions were still disposed.",
  EXTENSION_STYLE_INVALID:
    "The extension style sheet is invalid or escapes the Boardloom host scope.",
});

export function createDiagnostic(
  code: string,
  path: string,
  options: DiagnosticOptions = {},
): Diagnostic {
  return Object.freeze({
    code,
    path,
    message: options.message ?? DIAGNOSTIC_MESSAGES[code] ?? `Diagnostic ${code}`,
    severity: options.severity ?? "error",
    ...(options.hint === undefined ? {} : { hint: options.hint }),
    ...(options.relatedIds === undefined
      ? {}
      : { relatedIds: Object.freeze([...options.relatedIds]) }),
    ...(options.source === undefined ? {} : { source: options.source }),
  });
}

export class BoardloomError extends Error {
  readonly diagnostic: Diagnostic;

  constructor(diagnostic: Diagnostic) {
    super(diagnostic.message);
    this.name = "BoardloomError";
    this.diagnostic = diagnostic;
  }
}

export function hasError(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error");
}
