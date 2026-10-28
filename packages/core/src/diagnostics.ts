import { deepFreeze } from "./json.js";

export const DIAGNOSTIC_CODES = Object.freeze({
  SPACE_ALREADY_EXISTS: "SPACE_ALREADY_EXISTS",
  SPACE_DISPOSED: "SPACE_DISPOSED",
  SPACE_NOT_FOUND: "SPACE_NOT_FOUND",
  RUNTIME_DISPOSED: "RUNTIME_DISPOSED",
  VIEW_DISPOSED: "VIEW_DISPOSED",
  VIEWER_READ_ONLY: "VIEWER_READ_ONLY",
  EDITOR_LEASE_REQUIRED: "EDITOR_LEASE_REQUIRED",
  EDITOR_LEASE_CONFLICT: "EDITOR_LEASE_CONFLICT",
  EDITOR_LEASE_INVALID: "EDITOR_LEASE_INVALID",
  DRAFT_REQUIRES_DECISION: "DRAFT_REQUIRES_DECISION",
  DRAFT_HISTORY_EMPTY: "DRAFT_HISTORY_EMPTY",
  DRAFT_INVALID: "DRAFT_INVALID",
  REVISION_CONFLICT: "REVISION_CONFLICT",
  DOCUMENT_INVALID: "DOCUMENT_INVALID",
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
  VIEWER_READ_ONLY: "A viewer-bound command cannot change the board structure or configuration.",
  EDITOR_LEASE_REQUIRED: "An active editor lease is required for this authoring command.",
  EDITOR_LEASE_CONFLICT: "Another editor lease already holds the authoring lock for this space.",
  EDITOR_LEASE_INVALID: "The editor lease does not belong to this space or is no longer active.",
  DRAFT_REQUIRES_DECISION:
    "The draft has unsaved changes and requires an explicit apply or cancel decision.",
  DRAFT_HISTORY_EMPTY: "There is no draft change available in that direction.",
  DRAFT_INVALID: "The draft failed document validation and was not applied.",
  REVISION_CONFLICT:
    "The committed document advanced after the draft started; the draft was preserved.",
  DOCUMENT_INVALID: "The value is not a valid board document.",
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
