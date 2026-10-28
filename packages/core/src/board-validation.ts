import {
  BOARD_SCHEMA_VERSION,
  FIELD_ROLES,
  FIELD_VALUE_TYPES,
  THEME_MODES,
  isNamespacedExtensionKey,
  isThemeTokenName,
  type FieldRole,
} from "./board-schema.js";
import { DIAGNOSTIC_CODES, createDiagnostic, hasError, type Diagnostic } from "./diagnostics.js";
import { validateJsonValue, type JsonValidationLimits } from "./json.js";
import { isValidTimeZone } from "./locale.js";
import {
  escapePointerSegment,
  fieldKey,
  isRecord,
  nonEmptyString,
  oneOf,
  own,
  resolveFieldId,
  type FieldInfo,
  type ReferenceContext,
  type ScannedEntry,
  type ScanResult,
  type BoardDocumentValidation,
  type ProviderFieldDescriptor,
  type BoardValidationOptions,
  catalogDatasetEntry,
  catalogFieldEntry,
  catalogHasSlices,
  catalogSliceFields,
} from "./board-validation-shared.js";
import { validateComparison } from "./board-validation-comparison.js";
import { validateBlock } from "./board-validation-block.js";
import { validateFilter } from "./board-validation-filter.js";
import { validateLayout } from "./board-validation-layout.js";

export type {
  BoardDocumentValidation,
  BoardValidationCatalog,
  BoardValidationOptions,
  ProviderDatasetDescriptor,
  ProviderFieldDescriptor,
} from "./board-validation-shared.js";

const TOP_LEVEL_KEYS = new Set([
  "schemaVersion",
  "id",
  "title",
  "description",
  "createdAt",
  "updatedAt",
  "theme",
  "datasets",
  "slices",
  "blocks",
  "filterGroups",
  "filters",
  "comparisons",
  "layout",
  "extensions",
]);

const DATASET_KEYS = new Set(["id", "provider", "label", "fields"]);
const FIELD_KEYS = new Set(["id", "type", "role", "unit", "timezone", "nullable", "allowedValues"]);
const SLICE_KEYS = new Set(["id", "datasetId", "label", "fieldIds"]);
const GROUP_KEYS = new Set(["id", "label", "blockIds"]);
const THEME_KEYS = new Set(["mode", "tokens"]);
const DEFAULT_BOARD_JSON_LIMITS: JsonValidationLimits = Object.freeze({
  maxDepth: 64,
  maxNodes: 100_000,
  maxArrayLength: 10_000,
  maxObjectKeys: 10_000,
  maxStringLength: 1_000_000,
});

export function validateBoardDocument(
  document: unknown,
  options: BoardValidationOptions = {},
): BoardDocumentValidation {
  const diagnostics: Diagnostic[] = [];
  const limits = { ...DEFAULT_BOARD_JSON_LIMITS, ...options.jsonLimits };

  const add = (
    code: string,
    path: string,
    message?: string,
    extra: {
      readonly severity?: "error" | "warning";
      readonly hint?: string;
      readonly relatedIds?: readonly string[];
      readonly source?: string;
    } = {},
  ): void => {
    diagnostics.push(
      createDiagnostic(code, path, {
        ...(message === undefined ? {} : { message }),
        ...(extra.severity === undefined ? {} : { severity: extra.severity }),
        ...(extra.hint === undefined ? {} : { hint: extra.hint }),
        ...(extra.relatedIds === undefined ? {} : { relatedIds: extra.relatedIds }),
        ...(extra.source === undefined ? {} : { source: extra.source }),
      }),
    );
  };

  const unknownKeys = (
    value: Record<string, unknown>,
    allowed: ReadonlySet<string>,
    path: string,
  ): void => {
    for (const key of Object.getOwnPropertyNames(value)) {
      if (!allowed.has(key)) {
        add(
          DIAGNOSTIC_CODES.UNKNOWN_PROPERTY,
          `${path}/${escapePointerSegment(key)}`,
          `Property "${key}" is not part of the Boardloom schema.`,
        );
      }
    }
  };

  const requiredString = (
    value: Record<string, unknown>,
    key: string,
    path: string,
    allowEmpty = false,
  ): string | undefined => {
    const entry = own(value, key);
    const entryPath = `${path}/${escapePointerSegment(key)}`;
    if (entry === undefined) {
      add(DIAGNOSTIC_CODES.MISSING_REQUIRED_PROPERTY, entryPath);
      return undefined;
    }
    if (typeof entry !== "string" || (!allowEmpty && entry.trim() === "")) {
      add(DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE, entryPath, `Property "${key}" must be a string.`);
      return undefined;
    }
    return entry;
  };

  const optionalString = (
    value: Record<string, unknown>,
    key: string,
    path: string,
  ): string | undefined => {
    const entry = own(value, key);
    if (entry === undefined) {
      return undefined;
    }
    if (typeof entry !== "string") {
      add(
        DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE,
        `${path}/${escapePointerSegment(key)}`,
        `Property "${key}" must be a string.`,
      );
      return undefined;
    }
    return entry;
  };

  const optionalBoolean = (
    value: Record<string, unknown>,
    key: string,
    path: string,
  ): boolean | undefined => {
    const entry = own(value, key);
    if (entry === undefined) {
      return undefined;
    }
    if (typeof entry !== "boolean") {
      add(
        DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE,
        `${path}/${escapePointerSegment(key)}`,
        `Property "${key}" must be a boolean.`,
      );
      return undefined;
    }
    return entry;
  };

  const requiredNumber = (
    value: Record<string, unknown>,
    key: string,
    path: string,
  ): number | undefined => {
    const entry = own(value, key);
    const entryPath = `${path}/${escapePointerSegment(key)}`;
    if (entry === undefined) {
      add(DIAGNOSTIC_CODES.MISSING_REQUIRED_PROPERTY, entryPath);
      return undefined;
    }
    if (typeof entry !== "number" || !Number.isFinite(entry)) {
      add(DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE, entryPath, `Property "${key}" must be a number.`);
      return undefined;
    }
    return entry;
  };

  const requiredRecord = (
    value: Record<string, unknown>,
    key: string,
    path: string,
  ): Record<string, unknown> | undefined => {
    const entry = own(value, key);
    const entryPath = `${path}/${escapePointerSegment(key)}`;
    if (entry === undefined) {
      add(DIAGNOSTIC_CODES.MISSING_REQUIRED_PROPERTY, entryPath);
      return undefined;
    }
    if (!isRecord(entry)) {
      add(
        DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE,
        entryPath,
        `Property "${key}" must be an object.`,
      );
      return undefined;
    }
    return entry;
  };

  const optionalRecord = (
    value: Record<string, unknown>,
    key: string,
    path: string,
  ): Record<string, unknown> | undefined => {
    const entry = own(value, key);
    if (entry === undefined) {
      return undefined;
    }
    if (!isRecord(entry)) {
      add(
        DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE,
        `${path}/${escapePointerSegment(key)}`,
        `Property "${key}" must be an object.`,
      );
      return undefined;
    }
    return entry;
  };

  const requiredArray = (
    value: Record<string, unknown>,
    key: string,
    path: string,
  ): readonly unknown[] | undefined => {
    const entry = own(value, key);
    const entryPath = `${path}/${escapePointerSegment(key)}`;
    if (entry === undefined) {
      add(DIAGNOSTIC_CODES.MISSING_REQUIRED_PROPERTY, entryPath);
      return undefined;
    }
    if (!Array.isArray(entry)) {
      add(DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE, entryPath, `Property "${key}" must be an array.`);
      return undefined;
    }
    return entry;
  };

  const optionalArray = (
    value: Record<string, unknown>,
    key: string,
    path: string,
  ): readonly unknown[] | undefined => {
    const entry = own(value, key);
    if (entry === undefined) {
      return undefined;
    }
    if (!Array.isArray(entry)) {
      add(
        DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE,
        `${path}/${escapePointerSegment(key)}`,
        `Property "${key}" must be an array.`,
      );
      return undefined;
    }
    return entry;
  };

  const scanCollection = (key: string, required: boolean): ScanResult => {
    const path = `/${escapePointerSegment(key)}`;
    const raw = required ? requiredArray(root, key, "") : optionalArray(root, key, "");
    if (!raw) {
      return { entries: [], byId: new Map() };
    }
    const entries: ScannedEntry[] = [];
    const byId = new Map<string, ScannedEntry>();
    raw.forEach((entry, index) => {
      const entryPath = `${path}/${index}`;
      if (!isRecord(entry)) {
        add(
          DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE,
          entryPath,
          "A document entry must be an object.",
        );
        return;
      }
      const id = own(entry, "id");
      if (!nonEmptyString(id)) {
        add(DIAGNOSTIC_CODES.MISSING_ID, `${entryPath}/id`, "A stable identifier is required.");
        return;
      }
      const scanned: ScannedEntry = { id, path: entryPath, value: entry };
      const duplicate = byId.get(id);
      if (duplicate) {
        add(DIAGNOSTIC_CODES.DUPLICATE_ID, `${entryPath}/id`, undefined, {
          relatedIds: [id],
        });
        return;
      }
      byId.set(id, scanned);
      entries.push(scanned);
    });
    return { entries, byId };
  };

  if (!isRecord(document)) {
    add(DIAGNOSTIC_CODES.DOCUMENT_INVALID, "", "A board document must be a JSON object.");
    return Object.freeze({
      valid: false,
      diagnostics: Object.freeze(diagnostics),
      schemaVersion: null,
    });
  }
  const root = document;

  const jsonResult = validateJsonValue(root, limits);
  if (!jsonResult.valid) {
    for (const issue of jsonResult.issues) {
      add(DIAGNOSTIC_CODES.DOCUMENT_INVALID, issue.path, issue.message);
    }
    return Object.freeze({
      valid: false,
      diagnostics: Object.freeze(diagnostics),
      schemaVersion: null,
    });
  }

  const versionValue = own(root, "schemaVersion");
  if (versionValue === undefined) {
    add(DIAGNOSTIC_CODES.MISSING_REQUIRED_PROPERTY, "/schemaVersion");
  } else if (
    typeof versionValue !== "number" ||
    !Number.isInteger(versionValue) ||
    versionValue < 0
  ) {
    add(DIAGNOSTIC_CODES.SCHEMA_VERSION_INVALID, "/schemaVersion");
  } else if (versionValue > BOARD_SCHEMA_VERSION) {
    add(DIAGNOSTIC_CODES.FUTURE_SCHEMA_VERSION, "/schemaVersion", undefined, {
      hint: "Open the document with a newer Boardloom build; downgrade is not supported.",
    });
  } else if (versionValue !== BOARD_SCHEMA_VERSION) {
    add(DIAGNOSTIC_CODES.UNSUPPORTED_SCHEMA_VERSION, "/schemaVersion", undefined, {
      hint: "Migrate the document before validation.",
    });
  }

  unknownKeys(root, TOP_LEVEL_KEYS, "");
  requiredString(root, "id", "");
  requiredString(root, "title", "");
  optionalString(root, "description", "");
  const createdAt = requiredNumber(root, "createdAt", "");
  if (createdAt !== undefined && (!Number.isInteger(createdAt) || createdAt < 0)) {
    add(
      DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE,
      "/createdAt",
      "The creation timestamp must be a non-negative integer.",
    );
  }
  const updatedAt = requiredNumber(root, "updatedAt", "");
  if (updatedAt !== undefined && (!Number.isInteger(updatedAt) || updatedAt < 0)) {
    add(
      DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE,
      "/updatedAt",
      "The update timestamp must be a non-negative integer.",
    );
  }

  const theme = requiredRecord(root, "theme", "");
  if (theme) {
    unknownKeys(theme, THEME_KEYS, "/theme");
    const mode = own(theme, "mode");
    if (mode === undefined) {
      add(DIAGNOSTIC_CODES.MISSING_REQUIRED_PROPERTY, "/theme/mode");
    } else if (!oneOf(mode, THEME_MODES)) {
      add(
        DIAGNOSTIC_CODES.INVALID_THEME_TOKEN,
        "/theme/mode",
        "The theme mode must be light, dark or system.",
      );
    }
    const tokens = optionalRecord(theme, "tokens", "/theme");
    if (tokens) {
      for (const key of Object.getOwnPropertyNames(tokens)) {
        const tokenPath = `/theme/tokens/${escapePointerSegment(key)}`;
        if (!isThemeTokenName(key)) {
          add(
            DIAGNOSTIC_CODES.INVALID_THEME_TOKEN,
            tokenPath,
            "Theme token names must use lowercase segments separated by dots or hyphens.",
          );
        }
        if (typeof tokens[key] !== "string") {
          add(
            DIAGNOSTIC_CODES.INVALID_THEME_TOKEN,
            tokenPath,
            "Theme token values must be strings.",
          );
        }
      }
    }
  }

  const datasets = scanCollection("datasets", true);
  const slices = scanCollection("slices", true);
  const groups = scanCollection("filterGroups", false);
  const blocks = scanCollection("blocks", true);
  const filters = scanCollection("filters", true);
  const comparisons = scanCollection("comparisons", false);

  const documentFields = new Map<string, FieldInfo>();

  const catalogField = (datasetId: string, fieldId: string): ProviderFieldDescriptor | undefined =>
    catalogFieldEntry(catalogDatasetEntry(options.catalog, datasetId), fieldId);

  for (const dataset of datasets.entries) {
    unknownKeys(dataset.value, DATASET_KEYS, dataset.path);
    const datasetId = dataset.id;
    optionalString(dataset.value, "provider", dataset.path);
    optionalString(dataset.value, "label", dataset.path);
    const catalogDataset = catalogDatasetEntry(options.catalog, datasetId);
    if (options.catalog && !catalogDataset) {
      add(DIAGNOSTIC_CODES.INVALID_REFERENCE, `${dataset.path}/id`, undefined, {
        relatedIds: [datasetId],
      });
    }
    const fields = optionalArray(dataset.value, "fields", dataset.path);
    if (!fields) {
      continue;
    }
    const seenFields = new Set<string>();
    fields.forEach((entry, index) => {
      const fieldPath = `${dataset.path}/fields/${index}`;
      if (!isRecord(entry)) {
        add(DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE, fieldPath, "A field must be an object.");
        return;
      }
      unknownKeys(entry, FIELD_KEYS, fieldPath);
      const fieldId = own(entry, "id");
      if (!nonEmptyString(fieldId)) {
        add(
          DIAGNOSTIC_CODES.MISSING_ID,
          `${fieldPath}/id`,
          "A stable field identifier is required.",
        );
        return;
      }
      if (seenFields.has(fieldId)) {
        add(DIAGNOSTIC_CODES.DUPLICATE_ID, `${fieldPath}/id`, undefined, {
          relatedIds: [fieldId],
        });
        return;
      }
      seenFields.add(fieldId);
      const type = own(entry, "type");
      if (!oneOf(type, FIELD_VALUE_TYPES)) {
        add(
          DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE,
          `${fieldPath}/type`,
          "A field type must be string, number, boolean, date or datetime.",
        );
        return;
      }
      const role = own(entry, "role");
      if (role !== undefined && !oneOf(role, FIELD_ROLES)) {
        add(
          DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE,
          `${fieldPath}/role`,
          "A field role must be dimension or measure.",
        );
      }
      const unit = optionalString(entry, "unit", fieldPath);
      const timezone = optionalString(entry, "timezone", fieldPath);
      if (timezone !== undefined && !isValidTimeZone(timezone)) {
        add(DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE, `${fieldPath}/timezone`);
      }
      optionalBoolean(entry, "nullable", fieldPath);
      const allowedValuesRaw = optionalArray(entry, "allowedValues", fieldPath);
      const allowedValues: (string | number | boolean)[] = [];
      if (allowedValuesRaw !== undefined) {
        const seenValues = new Set<string>();
        allowedValuesRaw.forEach((value, index) => {
          const valid =
            (type === "number" && typeof value === "number" && Number.isFinite(value)) ||
            (type === "string" && typeof value === "string") ||
            (type === "boolean" && typeof value === "boolean") ||
            ((type === "date" || type === "datetime") && typeof value === "string");
          if (!valid) {
            add(
              DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE,
              `${fieldPath}/allowedValues/${index}`,
              "An allowed value must match the declared field type.",
            );
            return;
          }
          const key = `${typeof value}:${String(value)}`;
          if (seenValues.has(key)) {
            add(DIAGNOSTIC_CODES.DUPLICATE_ID, `${fieldPath}/allowedValues/${index}`);
            return;
          }
          seenValues.add(key);
          allowedValues.push(value as string | number | boolean);
        });
      }
      const info: FieldInfo = {
        type,
        ...(role === undefined ? {} : { role: role as FieldRole }),
        ...(unit === undefined ? {} : { unit }),
        ...(timezone === undefined ? {} : { timezone }),
        ...(allowedValues.length === 0 ? {} : { allowedValues: Object.freeze(allowedValues) }),
      };
      documentFields.set(fieldKey(datasetId, fieldId), info);
      const providerField = catalogField(datasetId, fieldId);
      if (options.catalog && catalogDataset?.fields) {
        if (!providerField) {
          add(DIAGNOSTIC_CODES.INVALID_REFERENCE, `${fieldPath}/id`, undefined, {
            relatedIds: [datasetId, fieldId],
          });
        } else if (providerField.type !== type) {
          add(DIAGNOSTIC_CODES.PROVIDER_CAPABILITY_MISMATCH, `${fieldPath}/type`, undefined, {
            relatedIds: [datasetId, fieldId],
          });
        }
      }
    });
  }

  const referenceContext: ReferenceContext = {
    documentDatasets: datasets.byId,
    documentFields,
    documentSlices: slices.byId,
    blocks: blocks.byId,
    groups: groups.byId,
    filters: filters.byId,
    comparisons: comparisons.byId,
    ...(options.catalog === undefined ? {} : { catalog: options.catalog }),
  };

  for (const slice of slices.entries) {
    unknownKeys(slice.value, SLICE_KEYS, slice.path);
    const datasetId = requiredString(slice.value, "datasetId", slice.path);
    optionalString(slice.value, "label", slice.path);
    if (datasetId !== undefined && !datasets.byId.has(datasetId)) {
      add(DIAGNOSTIC_CODES.INVALID_REFERENCE, `${slice.path}/datasetId`, undefined, {
        relatedIds: [datasetId],
      });
    }
    const providerDataset = datasetId ? catalogDatasetEntry(options.catalog, datasetId) : undefined;
    const hasProviderSlices = catalogHasSlices(providerDataset);
    const providerFieldIds = providerDataset
      ? catalogSliceFields(providerDataset, slice.id)
      : undefined;
    if (hasProviderSlices && providerFieldIds === undefined) {
      add(DIAGNOSTIC_CODES.INVALID_REFERENCE, `${slice.path}/id`, undefined, {
        relatedIds: [slice.id],
      });
    }
    const fieldIds = optionalArray(slice.value, "fieldIds", slice.path);
    if (!fieldIds) {
      continue;
    }
    const seenFields = new Set<string>();
    fieldIds.forEach((fieldId, index) => {
      const fieldPath = `${slice.path}/fieldIds/${index}`;
      if (!nonEmptyString(fieldId)) {
        add(DIAGNOSTIC_CODES.MISSING_ID, fieldPath, "A slice field identifier is required.");
        return;
      }
      if (seenFields.has(fieldId)) {
        add(DIAGNOSTIC_CODES.DUPLICATE_ID, fieldPath, undefined, { relatedIds: [fieldId] });
        return;
      }
      seenFields.add(fieldId);
      if (providerFieldIds && !providerFieldIds.includes(fieldId)) {
        add(DIAGNOSTIC_CODES.INVALID_REFERENCE, fieldPath, undefined, {
          relatedIds: [fieldId],
        });
      }
      if (datasetId !== undefined) {
        resolveFieldId(datasetId, fieldId, fieldPath, referenceContext, add);
      }
    });
  }

  for (const group of groups.entries) {
    unknownKeys(group.value, GROUP_KEYS, group.path);
    optionalString(group.value, "label", group.path);
    const blockIds = optionalArray(group.value, "blockIds", group.path);
    if (!blockIds) {
      continue;
    }
    const seenBlocks = new Set<string>();
    blockIds.forEach((blockId, index) => {
      const blockPath = `${group.path}/blockIds/${index}`;
      if (!nonEmptyString(blockId)) {
        add(DIAGNOSTIC_CODES.MISSING_ID, blockPath, "A block identifier is required.");
        return;
      }
      if (seenBlocks.has(blockId)) {
        add(DIAGNOSTIC_CODES.DUPLICATE_ID, blockPath, undefined, { relatedIds: [blockId] });
        return;
      }
      seenBlocks.add(blockId);
      if (!blocks.byId.has(blockId)) {
        add(DIAGNOSTIC_CODES.INVALID_REFERENCE, blockPath, undefined, { relatedIds: [blockId] });
      }
    });
  }

  for (const comparison of comparisons.entries) {
    validateComparison(comparison, referenceContext, add);
  }

  for (const block of blocks.entries) {
    validateBlock(block, referenceContext, add);
  }

  for (const filter of filters.entries) {
    validateFilter(filter, referenceContext, add);
  }

  validateLayout(root, blocks.byId, add);

  const extensions = optionalRecord(root, "extensions", "");
  if (extensions) {
    for (const key of Object.getOwnPropertyNames(extensions)) {
      if (!isNamespacedExtensionKey(key)) {
        add(DIAGNOSTIC_CODES.INVALID_EXTENSION_KEY, `/extensions/${escapePointerSegment(key)}`);
      }
    }
  }

  return Object.freeze({
    valid: !hasError(diagnostics),
    diagnostics: Object.freeze(diagnostics),
    schemaVersion:
      typeof versionValue === "number" && Number.isInteger(versionValue) ? versionValue : null,
  });
}
