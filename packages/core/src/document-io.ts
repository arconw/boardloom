import { BOARD_SCHEMA_VERSION } from "./board-schema.js";
import {
  validateBoardDocument,
  type BoardDocumentValidation,
  type BoardValidationCatalog,
} from "./board-validation.js";
import type { Clock } from "./clock.js";
import {
  DIAGNOSTIC_CODES,
  createDiagnostic,
  fail,
  hasError,
  ok,
  type Diagnostic,
  type Result,
} from "./diagnostics.js";
import { documentSchemaVersion, snapshotDocument, type BoardDocument } from "./document.js";
import type { IdFactory } from "./ids.js";
import {
  canonicalJson,
  cloneJson,
  freezeJson,
  isPlainObject,
  jsonByteLength,
  utf8ByteLength,
  validateJsonValue,
  type JsonObject,
  type JsonValidationLimits,
  type JsonValue,
} from "./json.js";
import {
  migrateBoardDocument,
  type BoardMigrationReport,
  type BoardMigrationStepDefinition,
} from "./migrations.js";

export const DEFAULT_MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const DEFAULT_MAX_IMPORT_DEPTH = 64;
export const DEFAULT_MAX_IMPORT_NODES = 100_000;
export const DEFAULT_MAX_IMPORT_ARRAY_LENGTH = 10_000;
export const DEFAULT_MAX_IMPORT_OBJECT_KEYS = 10_000;
export const DEFAULT_MAX_IMPORT_STRING_LENGTH = 1_000_000;

export interface BoardDocumentParseOptions {
  readonly maxBytes?: number;
  readonly maxDepth?: number;
  readonly maxNodes?: number;
  readonly maxArrayLength?: number;
  readonly maxObjectKeys?: number;
  readonly maxStringLength?: number;
  readonly allowMigration?: boolean;
  readonly migrationChain?: readonly BoardMigrationStepDefinition[];
  readonly targetVersion?: number;
  readonly idFactory?: IdFactory;
  readonly clock?: Clock;
  readonly catalog?: BoardValidationCatalog;
}

export interface PreparedBoardDocument {
  readonly document: BoardDocument;
  readonly schemaVersion: number;
  readonly migration: BoardMigrationReport | null;
  readonly diagnostics: readonly Diagnostic[];
  readonly warnings: readonly Diagnostic[];
}

export interface BoardSerialization {
  readonly document: BoardDocument;
  readonly canonical: string;
  readonly schemaVersion: number;
}

export interface BoardSerializationOptions {
  readonly catalog?: BoardValidationCatalog;
  readonly jsonLimits?: JsonValidationLimits;
}

function importLimits(options: BoardDocumentParseOptions): JsonValidationLimits {
  return {
    maxDepth: options.maxDepth ?? DEFAULT_MAX_IMPORT_DEPTH,
    maxNodes: options.maxNodes ?? DEFAULT_MAX_IMPORT_NODES,
    maxArrayLength: options.maxArrayLength ?? DEFAULT_MAX_IMPORT_ARRAY_LENGTH,
    maxObjectKeys: options.maxObjectKeys ?? DEFAULT_MAX_IMPORT_OBJECT_KEYS,
    maxStringLength: options.maxStringLength ?? DEFAULT_MAX_IMPORT_STRING_LENGTH,
  };
}

function jsonIssuesToDiagnostics(
  issues: readonly { readonly path: string; readonly message: string }[],
): readonly Diagnostic[] {
  return issues.map((issue) => {
    const limited = issue.message.includes("maximum");
    return createDiagnostic(
      limited ? DIAGNOSTIC_CODES.IMPORT_LIMIT_EXCEEDED : DIAGNOSTIC_CODES.DOCUMENT_INVALID,
      issue.path,
      { message: issue.message },
    );
  });
}

function mergedWarnings(
  migration: BoardMigrationReport | null,
  validation: BoardDocumentValidation,
): readonly Diagnostic[] {
  const seen = new Set<string>();
  const warnings: Diagnostic[] = [];
  for (const diagnostic of [
    ...(migration?.warnings ?? []),
    ...validation.diagnostics.filter((entry) => entry.severity === "warning"),
  ]) {
    const key = [
      diagnostic.code,
      diagnostic.path,
      diagnostic.message,
      diagnostic.severity,
      diagnostic.hint ?? "",
      diagnostic.source ?? "",
      (diagnostic.relatedIds ?? []).join("\u0000"),
    ].join("\u0000");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    warnings.push(diagnostic);
  }
  return Object.freeze(warnings);
}

function exceedsByteLimit(value: JsonValue, maxBytes: number): boolean {
  return jsonByteLength(value, maxBytes) > maxBytes;
}

export function parseBoardDocument(
  input: unknown,
  options: BoardDocumentParseOptions = {},
): Result<PreparedBoardDocument> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_IMPORT_BYTES;
  if (!Number.isFinite(maxBytes) || maxBytes < 0) {
    return fail([
      createDiagnostic(DIAGNOSTIC_CODES.INVALID_ARGUMENT, "maxBytes", {
        message: "The import size limit must be a finite non-negative number.",
      }),
    ]);
  }

  let parsed: unknown;
  if (typeof input === "string") {
    if (utf8ByteLength(input) > maxBytes) {
      return fail([createDiagnostic(DIAGNOSTIC_CODES.IMPORT_TOO_LARGE, "")]);
    }
    try {
      parsed = JSON.parse(input);
    } catch {
      return fail([createDiagnostic(DIAGNOSTIC_CODES.MALFORMED_JSON, "")]);
    }
  } else {
    parsed = input;
  }

  const limits = importLimits(options);
  const jsonResult = validateJsonValue(parsed, limits);
  if (!jsonResult.valid) {
    return fail(jsonIssuesToDiagnostics(jsonResult.issues));
  }
  if (!isPlainObject(parsed)) {
    return fail([
      createDiagnostic(DIAGNOSTIC_CODES.DOCUMENT_INVALID, "", {
        message: "A board document must be a JSON object.",
      }),
    ]);
  }

  const source = parsed as JsonObject;
  if (exceedsByteLimit(source, maxBytes)) {
    return fail([createDiagnostic(DIAGNOSTIC_CODES.IMPORT_TOO_LARGE, "")]);
  }

  const sourceVersion = documentSchemaVersion(source);
  if (sourceVersion === null || sourceVersion < 0) {
    return fail([createDiagnostic(DIAGNOSTIC_CODES.SCHEMA_VERSION_INVALID, "/schemaVersion")]);
  }
  if (sourceVersion > BOARD_SCHEMA_VERSION) {
    return fail([createDiagnostic(DIAGNOSTIC_CODES.FUTURE_SCHEMA_VERSION, "/schemaVersion")]);
  }

  let prepared = source;
  let migration: BoardMigrationReport | null = null;
  if (sourceVersion < BOARD_SCHEMA_VERSION) {
    if (options.allowMigration === false) {
      return fail([
        createDiagnostic(DIAGNOSTIC_CODES.UNSUPPORTED_SCHEMA_VERSION, "/schemaVersion"),
      ]);
    }
    const migrated = migrateBoardDocument(source, {
      ...(options.migrationChain === undefined ? {} : { chain: options.migrationChain }),
      targetVersion: options.targetVersion ?? BOARD_SCHEMA_VERSION,
      ...(options.idFactory === undefined ? {} : { idFactory: options.idFactory }),
      ...(options.clock === undefined ? {} : { clock: options.clock }),
      maxBytes,
      jsonLimits: limits,
    });
    if (!migrated.ok) {
      return fail(migrated.diagnostics);
    }
    prepared = migrated.value.document;
    migration = migrated.value.report;
  }

  const preparedJson = validateJsonValue(prepared, limits);
  if (!preparedJson.valid) {
    return fail(jsonIssuesToDiagnostics(preparedJson.issues));
  }
  if (exceedsByteLimit(prepared, maxBytes)) {
    return fail([createDiagnostic(DIAGNOSTIC_CODES.IMPORT_TOO_LARGE, "")]);
  }

  const validation = validateBoardDocument(prepared, {
    jsonLimits: limits,
    ...(options.catalog === undefined ? {} : { catalog: options.catalog }),
  });
  if (hasError(validation.diagnostics)) {
    return fail(validation.diagnostics);
  }

  const document = snapshotDocument(prepared);
  const warnings = mergedWarnings(migration, validation);
  return ok(
    Object.freeze({
      document,
      schemaVersion: validation.schemaVersion ?? BOARD_SCHEMA_VERSION,
      migration,
      diagnostics: validation.diagnostics,
      warnings,
    }),
  );
}

export function serializeBoardDocument(
  document: unknown,
  options: BoardSerializationOptions = {},
): Result<BoardSerialization> {
  const validation = validateBoardDocument(document, {
    ...(options.jsonLimits === undefined ? {} : { jsonLimits: options.jsonLimits }),
    ...(options.catalog === undefined ? {} : { catalog: options.catalog }),
  });
  if (hasError(validation.diagnostics)) {
    return fail(validation.diagnostics);
  }
  const snapshot = freezeJson(cloneJson(document as JsonValue));
  if (!isPlainObject(snapshot)) {
    return fail([
      createDiagnostic(DIAGNOSTIC_CODES.DOCUMENT_INVALID, "", {
        message: "A board document must be a JSON object.",
      }),
    ]);
  }
  return ok(
    Object.freeze({
      document: snapshot as BoardDocument,
      canonical: canonicalJson(snapshot),
      schemaVersion: validation.schemaVersion ?? BOARD_SCHEMA_VERSION,
    }),
  );
}

export function exportBoardDocument(
  document: unknown,
  options: BoardSerializationOptions = {},
): Result<BoardSerialization> {
  return serializeBoardDocument(document, options);
}
