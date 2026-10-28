import { BOARD_SCHEMA_VERSION } from "./board-schema.js";
import { createSystemClock, type Clock } from "./clock.js";
import {
  DIAGNOSTIC_CODES,
  createDiagnostic,
  fail,
  hasError,
  ok,
  type Diagnostic,
  type Result,
} from "./diagnostics.js";
import { createSequentialIdFactory, type IdFactory } from "./ids.js";
import {
  cloneJson,
  isPlainObject,
  jsonByteLength,
  validateJsonValue,
  type JsonObject,
  type JsonValidationLimits,
  type JsonValue,
} from "./json.js";

export interface MigrationContext {
  readonly idFactory: IdFactory;
  readonly clock: Clock;
}

export interface BoardMigrationStepOutcome {
  readonly document: JsonObject;
  readonly warnings: readonly Diagnostic[];
  readonly preservedFields: readonly string[];
  readonly addedFields: readonly string[];
  readonly removedFields: readonly string[];
  readonly preservedIds: readonly string[];
  readonly synthetic?: boolean;
}

export interface BoardMigrationStepDefinition {
  readonly fromVersion: number;
  readonly toVersion: number;
  migrate(document: JsonObject, context: MigrationContext): Result<BoardMigrationStepOutcome>;
}

export interface BoardMigrationStepReport {
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly warnings: readonly Diagnostic[];
  readonly preservedFields: readonly string[];
  readonly addedFields: readonly string[];
  readonly removedFields: readonly string[];
  readonly preservedIds: readonly string[];
}

export interface BoardMigrationReport {
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly migrated: boolean;
  readonly syntheticSource: boolean;
  readonly steps: readonly BoardMigrationStepReport[];
  readonly warnings: readonly Diagnostic[];
}

export interface BoardMigrationOutcome {
  readonly document: JsonObject;
  readonly report: BoardMigrationReport;
}

export interface BoardMigrationOptions {
  readonly chain?: readonly BoardMigrationStepDefinition[];
  readonly targetVersion?: number;
  readonly idFactory?: IdFactory;
  readonly clock?: Clock;
  readonly jsonLimits?: JsonValidationLimits;
  readonly maxBytes?: number;
}

const DEFAULT_MIGRATION_JSON_LIMITS: JsonValidationLimits = Object.freeze({
  maxDepth: 64,
  maxNodes: 100_000,
  maxArrayLength: 10_000,
  maxObjectKeys: 10_000,
  maxStringLength: 1_000_000,
});

function own(value: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(value, key) ? value[key] : undefined;
}

function readSchemaVersion(document: JsonObject): number | null {
  const value = own(document, "schemaVersion");
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function collectStableIds(document: JsonObject): readonly string[] {
  const ids = new Set<string>();
  const rootId = own(document, "id");
  if (typeof rootId === "string" && rootId !== "") {
    ids.add(rootId);
  }
  for (const collection of [
    "datasets",
    "slices",
    "blocks",
    "filterGroups",
    "filters",
    "comparisons",
  ]) {
    const entries = own(document, collection);
    if (!Array.isArray(entries)) {
      continue;
    }
    for (const entry of entries) {
      if (!isPlainObject(entry)) {
        continue;
      }
      const id = own(entry, "id");
      if (typeof id === "string" && id !== "") {
        ids.add(id);
      }
      if (collection === "datasets") {
        for (const field of collectNestedIds(entry, "fields")) {
          ids.add(field);
        }
      }
      if (collection === "slices") {
        const fieldIds = own(entry, "fieldIds");
        if (Array.isArray(fieldIds)) {
          for (const fieldId of fieldIds) {
            if (typeof fieldId === "string" && fieldId !== "") {
              ids.add(fieldId);
            }
          }
        }
      }
      if (collection === "blocks") {
        for (const binding of collectNestedIds(entry, "bindings")) {
          ids.add(binding);
        }
        const bindings = own(entry, "bindings");
        if (Array.isArray(bindings)) {
          for (const binding of bindings) {
            if (!isPlainObject(binding)) {
              continue;
            }
            collectReferenceFieldId(binding, "field", ids);
            const aggregation = own(binding, "aggregation");
            if (isPlainObject(aggregation)) {
              const fieldId = own(aggregation, "fieldId");
              if (typeof fieldId === "string" && fieldId !== "") {
                ids.add(fieldId);
              }
            }
          }
        }
      }
      if (collection === "filters") {
        collectReferenceFieldId(entry, "field", ids);
      }
      if (collection === "comparisons") {
        const mapping = own(entry, "mapping");
        if (Array.isArray(mapping)) {
          for (const mappingEntry of mapping) {
            if (!isPlainObject(mappingEntry)) {
              continue;
            }
            collectReferenceFieldId(mappingEntry, "primary", ids);
            collectReferenceFieldId(mappingEntry, "reference", ids);
          }
        }
      }
    }
  }
  return Object.freeze([...ids].sort());
}

function collectReferenceFieldId(
  entry: Record<string, unknown>,
  key: string,
  ids: Set<string>,
): void {
  const reference = own(entry, key);
  if (!isPlainObject(reference)) {
    return;
  }
  const fieldId = own(reference, "fieldId");
  if (typeof fieldId === "string" && fieldId !== "") {
    ids.add(fieldId);
  }
}

function collectNestedIds(entry: Record<string, unknown>, key: string): readonly string[] {
  const values = own(entry, key);
  if (!Array.isArray(values)) {
    return [];
  }
  const ids: string[] = [];
  for (const value of values) {
    if (!isPlainObject(value)) {
      continue;
    }
    const id = own(value, "id");
    if (typeof id === "string" && id !== "") {
      ids.push(id);
    }
  }
  return ids;
}

function createStackedLayout(blocks: unknown): JsonObject | null {
  if (!Array.isArray(blocks)) {
    return null;
  }
  const ids: string[] = [];
  for (const block of blocks) {
    if (!isPlainObject(block)) {
      continue;
    }
    const id = own(block, "id");
    if (typeof id === "string" && id !== "") {
      ids.push(id);
    }
  }
  if (ids.length === 0) {
    return {
      desktop: { columns: 12, rowHeight: 8, placements: [] },
      tablet: { columns: 8, rowHeight: 8, placements: [] },
      narrow: { columns: 4, rowHeight: 8, placements: [] },
    };
  }
  const makePlacements = (columns: number): JsonValue[] =>
    ids.map((blockId, index) => ({
      blockId,
      x: 0,
      y: index * 4,
      width: columns,
      height: 4,
    }));
  return {
    desktop: { columns: 12, rowHeight: 8, placements: makePlacements(12) },
    tablet: { columns: 8, rowHeight: 8, placements: makePlacements(8) },
    narrow: { columns: 4, rowHeight: 8, placements: makePlacements(4) },
  };
}

export const SYNTHETIC_V0_TO_V1_MIGRATION: BoardMigrationStepDefinition = Object.freeze({
  fromVersion: 0,
  toVersion: 1,
  migrate(document: JsonObject, context: MigrationContext): Result<BoardMigrationStepOutcome> {
    const migrated = cloneJson(document);
    const preservedFields = Object.freeze(
      Object.getOwnPropertyNames(migrated).filter((key) => key !== "schemaVersion"),
    );
    const preservedIds = collectStableIds(document);
    const addedFields: string[] = [];
    const removedFields: string[] = [];
    const warnings: Diagnostic[] = [
      createDiagnostic(DIAGNOSTIC_CODES.MIGRATION_SYNTHETIC_SOURCE, "/schemaVersion", {
        severity: "warning",
        source: "migration",
        hint: "This fixture represents an unpublished pre-release shape, not a historical Boardloom format.",
      }),
    ];

    const addField = (key: string, value: JsonValue): void => {
      if (!Object.hasOwn(migrated, key)) {
        Object.defineProperty(migrated, key, {
          value,
          enumerable: true,
          configurable: true,
          writable: true,
        });
        addedFields.push(key);
      }
    };

    const now = context.clock.now();
    addField("createdAt", now);
    addField("updatedAt", now);
    addField("theme", { mode: "system" });
    addField("datasets", []);
    addField("slices", []);
    addField("filterGroups", []);
    addField("filters", []);
    addField("comparisons", []);
    const layout = createStackedLayout(own(migrated, "blocks"));
    if (layout) {
      addField("layout", layout);
    }

    const blocks = own(migrated, "blocks");
    if (Array.isArray(blocks)) {
      blocks.forEach((block, index) => {
        if (!isPlainObject(block)) {
          return;
        }
        if (!Object.hasOwn(block, "bindings")) {
          Object.defineProperty(block, "bindings", {
            value: [],
            enumerable: true,
            configurable: true,
            writable: true,
          });
          addedFields.push(`blocks[${index}].bindings`);
        }
      });
    }

    migrated.schemaVersion = 1;

    return ok(
      Object.freeze({
        document: migrated,
        warnings: Object.freeze(warnings),
        preservedFields,
        addedFields: Object.freeze(addedFields),
        removedFields: Object.freeze(removedFields),
        preservedIds,
        synthetic: true,
      }),
    );
  },
});

export const BOARD_MIGRATION_CHAIN: readonly BoardMigrationStepDefinition[] = Object.freeze([
  SYNTHETIC_V0_TO_V1_MIGRATION,
]);

export function migrateBoardDocument(
  input: unknown,
  options: BoardMigrationOptions = {},
): Result<BoardMigrationOutcome> {
  if (!isPlainObject(input)) {
    return fail([
      createDiagnostic(DIAGNOSTIC_CODES.DOCUMENT_INVALID, "", {
        message: "A board document must be a JSON object.",
      }),
    ]);
  }
  const limits = { ...DEFAULT_MIGRATION_JSON_LIMITS, ...options.jsonLimits };
  const maxBytes = options.maxBytes ?? Number.POSITIVE_INFINITY;
  const json = validateJsonValue(input, limits);
  if (!json.valid) {
    return fail(
      json.issues.map((issue) =>
        createDiagnostic(DIAGNOSTIC_CODES.DOCUMENT_INVALID, issue.path, {
          message: issue.message,
        }),
      ),
    );
  }

  const source = input as JsonObject;
  if (jsonByteLength(source, maxBytes) > maxBytes) {
    return fail([createDiagnostic(DIAGNOSTIC_CODES.IMPORT_TOO_LARGE, "/schemaVersion")]);
  }
  const clock = options.clock ?? createSystemClock();
  const context: MigrationContext = Object.freeze({
    clock,
    idFactory: options.idFactory ?? createSequentialIdFactory({ clock }),
  });
  const chain = options.chain ?? BOARD_MIGRATION_CHAIN;
  const targetVersion = options.targetVersion ?? BOARD_SCHEMA_VERSION;
  const fromVersion = readSchemaVersion(source);
  if (fromVersion === null) {
    return fail([createDiagnostic(DIAGNOSTIC_CODES.SCHEMA_VERSION_INVALID, "/schemaVersion")]);
  }
  if (fromVersion > targetVersion) {
    return fail([
      createDiagnostic(DIAGNOSTIC_CODES.FUTURE_SCHEMA_VERSION, "/schemaVersion", {
        hint: "Use a newer Boardloom build; migration never downgrades a document.",
      }),
    ]);
  }
  if (fromVersion === targetVersion) {
    return ok(
      Object.freeze({
        document: cloneJson(source),
        report: Object.freeze({
          fromVersion,
          toVersion: targetVersion,
          migrated: false,
          syntheticSource: false,
          steps: Object.freeze([]),
          warnings: Object.freeze([]),
        }),
      }),
    );
  }

  const chainBySource = new Map<number, BoardMigrationStepDefinition>();
  for (const step of chain) {
    if (
      !Number.isInteger(step.fromVersion) ||
      !Number.isInteger(step.toVersion) ||
      step.toVersion <= step.fromVersion
    ) {
      return fail([
        createDiagnostic(DIAGNOSTIC_CODES.MIGRATION_FAILED, "/schemaVersion", {
          message: "A migration step must advance to a strictly newer schema version.",
        }),
      ]);
    }
    if (chainBySource.has(step.fromVersion)) {
      return fail([
        createDiagnostic(DIAGNOSTIC_CODES.MIGRATION_FAILED, "/schemaVersion", {
          message: `More than one migration starts at schema version ${step.fromVersion}.`,
        }),
      ]);
    }
    chainBySource.set(step.fromVersion, step);
  }

  let current = cloneJson(source);
  let version = fromVersion;
  const steps: BoardMigrationStepReport[] = [];
  const warnings: Diagnostic[] = [];
  const visited = new Set<number>([version]);
  let syntheticSource = false;

  while (version < targetVersion) {
    const step = chainBySource.get(version);
    if (!step) {
      return fail([
        createDiagnostic(DIAGNOSTIC_CODES.MIGRATION_FAILED, "/schemaVersion", {
          message: `No migration step is registered from schema version ${version}.`,
        }),
      ]);
    }
    if (visited.has(step.toVersion)) {
      return fail([
        createDiagnostic(DIAGNOSTIC_CODES.MIGRATION_FAILED, "/schemaVersion", {
          message: "The migration chain contains a cycle.",
        }),
      ]);
    }
    let applied: Result<BoardMigrationStepOutcome>;
    try {
      applied = step.migrate(cloneJson(current), context);
    } catch {
      return fail([
        createDiagnostic(DIAGNOSTIC_CODES.MIGRATION_FAILED, "/schemaVersion", {
          message: `The migration step ${version} -> ${step.toVersion} failed.`,
        }),
      ]);
    }
    const outcomeJson = validateJsonValue(applied, limits);
    if (!outcomeJson.valid) {
      const issue = outcomeJson.issues[0];
      return fail([
        createDiagnostic(DIAGNOSTIC_CODES.MIGRATION_FAILED, issue?.path ?? "/schemaVersion", {
          message: issue?.message ?? "A migration step returned a non-JSON result.",
        }),
      ]);
    }
    if (!isPlainObject(applied) || typeof applied.ok !== "boolean") {
      return fail([
        createDiagnostic(DIAGNOSTIC_CODES.MIGRATION_FAILED, "/schemaVersion", {
          message: "A migration step returned an invalid result.",
        }),
      ]);
    }
    if (jsonByteLength(applied as JsonValue, maxBytes) > maxBytes) {
      return fail([createDiagnostic(DIAGNOSTIC_CODES.IMPORT_TOO_LARGE, "/schemaVersion")]);
    }
    if (!applied.ok) {
      if (!isDiagnosticArray(applied.diagnostics)) {
        return fail([
          createDiagnostic(DIAGNOSTIC_CODES.MIGRATION_FAILED, "/schemaVersion", {
            message: "A migration step returned invalid failure diagnostics.",
          }),
        ]);
      }
      return fail(applied.diagnostics);
    }
    if (!isPlainObject(applied.value)) {
      return fail([
        createDiagnostic(DIAGNOSTIC_CODES.MIGRATION_FAILED, "/schemaVersion", {
          message: "A migration step returned an invalid outcome.",
        }),
      ]);
    }
    const result = applied.value;
    if (
      !isPlainObject(result.document) ||
      result.document.schemaVersion !== step.toVersion ||
      !isDiagnosticArray(result.warnings) ||
      !isStringArray(result.preservedFields) ||
      !isStringArray(result.addedFields) ||
      !isStringArray(result.removedFields) ||
      !isStringArray(result.preservedIds) ||
      (result.synthetic !== undefined && typeof result.synthetic !== "boolean")
    ) {
      return fail([
        createDiagnostic(DIAGNOSTIC_CODES.MIGRATION_FAILED, "/schemaVersion", {
          message: "A migration step returned an invalid result.",
        }),
      ]);
    }
    if (jsonByteLength(result.document, maxBytes) > maxBytes) {
      return fail([createDiagnostic(DIAGNOSTIC_CODES.IMPORT_TOO_LARGE, "/schemaVersion")]);
    }
    if (hasError(result.warnings)) {
      return fail(result.warnings);
    }
    steps.push(
      Object.freeze({
        fromVersion: step.fromVersion,
        toVersion: step.toVersion,
        warnings: Object.freeze([...result.warnings]),
        preservedFields: Object.freeze([...result.preservedFields]),
        addedFields: Object.freeze([...result.addedFields]),
        removedFields: Object.freeze([...result.removedFields]),
        preservedIds: Object.freeze([...result.preservedIds]),
      }),
    );
    warnings.push(...result.warnings);
    syntheticSource = syntheticSource || result.synthetic === true;
    current = cloneJson(result.document);
    version = step.toVersion;
    visited.add(version);
  }

  return ok(
    Object.freeze({
      document: current,
      report: Object.freeze({
        fromVersion,
        toVersion: version,
        migrated: true,
        syntheticSource,
        steps: Object.freeze(steps),
        warnings: Object.freeze(warnings),
      }),
    }),
  );
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isDiagnosticArray(value: unknown): value is readonly Diagnostic[] {
  if (!Array.isArray(value)) {
    return false;
  }
  return value.every((entry) => {
    if (!isPlainObject(entry)) {
      return false;
    }
    if (
      typeof entry.code !== "string" ||
      typeof entry.path !== "string" ||
      typeof entry.message !== "string" ||
      (entry.severity !== "error" && entry.severity !== "warning")
    ) {
      return false;
    }
    if (entry.hint !== undefined && typeof entry.hint !== "string") {
      return false;
    }
    if (entry.source !== undefined && typeof entry.source !== "string") {
      return false;
    }
    if (entry.relatedIds !== undefined && !isStringArray(entry.relatedIds)) {
      return false;
    }
    return true;
  });
}
