import {
  COMPARISON_DELTA_MODES,
  COMPARISON_DISPLAY_MODES,
  COMPARISON_UNIT_POLICIES,
  FIELD_ROLES,
  LAYOUT_BOUNDS,
} from "./board-schema.js";
import { DIAGNOSTIC_CODES } from "./diagnostics.js";
import { isValidTimeZone } from "./locale.js";
import {
  checkUnknownKeys,
  fieldKey,
  isIsoTemporalString,
  isRecord,
  nonEmptyString,
  oneOf,
  own,
  resolveFieldReference,
  resolveSlice,
  type AddDiagnostic,
  type FieldInfo,
  type ReferenceContext,
  type ScannedEntry,
} from "./board-validation-shared.js";

const COMPARISON_KEYS = new Set([
  "id",
  "label",
  "displayMode",
  "deltaMode",
  "base",
  "reference",
  "mapping",
  "alignment",
  "windows",
  "unitPolicy",
]);
const COMPARISON_INPUT_KEYS = new Set(["datasetId", "sliceId"]);
const MAPPING_KEYS = new Set(["primary", "reference", "role"]);
const ALIGNMENT_KEYS = new Set(["keys", "collation", "normalization"]);
const WINDOWS_KEYS = new Set(["primary", "reference"]);
const TIME_WINDOW_KEYS = new Set(["timezone", "start", "end", "bounds"]);
const UNIT_POLICY_KEYS = new Set(["mode", "conversions"]);
const UNIT_CONVERSION_KEYS = new Set([
  "from",
  "to",
  "factor",
  "offset",
  "provider",
  "lossless",
  "documentation",
]);

export function validateComparison(
  comparison: ScannedEntry,
  context: ReferenceContext,
  add: AddDiagnostic,
): void {
  const value = comparison.value;
  const path = comparison.path;
  checkUnknownKeys(value, COMPARISON_KEYS, path, add);
  const label = own(value, "label");
  if (label === undefined) {
    add(DIAGNOSTIC_CODES.MISSING_REQUIRED_PROPERTY, `${path}/label`);
  } else if (typeof label !== "string" || label.trim() === "") {
    add(DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE, `${path}/label`);
  }
  const displayMode = own(value, "displayMode");
  if (!oneOf(displayMode, COMPARISON_DISPLAY_MODES)) {
    add(DIAGNOSTIC_CODES.INCOMPATIBLE_COMPARISON, `${path}/displayMode`);
  }
  const deltaMode = own(value, "deltaMode");
  if (!oneOf(deltaMode, COMPARISON_DELTA_MODES)) {
    add(DIAGNOSTIC_CODES.INCOMPATIBLE_COMPARISON, `${path}/deltaMode`);
  }

  const input = (
    key: "base" | "reference",
  ): { readonly datasetId: string; readonly sliceId?: string } | null => {
    const entry = own(value, key);
    const inputPath = `${path}/${key}`;
    if (entry === undefined) {
      add(DIAGNOSTIC_CODES.MISSING_REQUIRED_PROPERTY, inputPath);
      return null;
    }
    if (!isRecord(entry)) {
      add(DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE, inputPath);
      return null;
    }
    checkUnknownKeys(entry, COMPARISON_INPUT_KEYS, inputPath, add);
    const datasetId = own(entry, "datasetId");
    if (!nonEmptyString(datasetId)) {
      add(DIAGNOSTIC_CODES.MISSING_ID, `${inputPath}/datasetId`);
      return null;
    }
    if (!context.documentDatasets.has(datasetId)) {
      add(DIAGNOSTIC_CODES.INVALID_REFERENCE, `${inputPath}/datasetId`, undefined, {
        relatedIds: [datasetId],
      });
    }
    const sliceId = own(entry, "sliceId");
    if (sliceId !== undefined) {
      if (!nonEmptyString(sliceId)) {
        add(DIAGNOSTIC_CODES.MISSING_ID, `${inputPath}/sliceId`);
      } else {
        resolveSlice(datasetId, sliceId, `${inputPath}/sliceId`, context, add);
      }
    }
    return {
      datasetId,
      ...(typeof sliceId === "string" ? { sliceId } : {}),
    };
  };

  const base = input("base");
  const reference = input("reference");

  const mapping = own(value, "mapping");
  const measureUnits: Array<{
    readonly primary: string | undefined;
    readonly reference: string | undefined;
  }> = [];
  const dimensionFieldIds = new Set<string>();
  if (mapping === undefined) {
    add(DIAGNOSTIC_CODES.MISSING_REQUIRED_PROPERTY, `${path}/mapping`);
  } else if (!Array.isArray(mapping)) {
    add(DIAGNOSTIC_CODES.INCOMPATIBLE_COMPARISON, `${path}/mapping`);
  } else if (mapping.length === 0) {
    add(
      DIAGNOSTIC_CODES.INCOMPATIBLE_COMPARISON,
      `${path}/mapping`,
      "A comparison requires at least one field mapping.",
    );
  } else {
    const primaryFields = new Set<string>();
    const referenceFields = new Set<string>();
    mapping.forEach((entry, index) => {
      const mappingPath = `${path}/mapping/${index}`;
      if (!isRecord(entry)) {
        add(DIAGNOSTIC_CODES.INCOMPATIBLE_COMPARISON, mappingPath);
        return;
      }
      checkUnknownKeys(entry, MAPPING_KEYS, mappingPath, add);
      const role = own(entry, "role");
      if (!oneOf(role, FIELD_ROLES)) {
        add(DIAGNOSTIC_CODES.INCOMPATIBLE_COMPARISON, `${mappingPath}/role`);
      }
      const primary = own(entry, "primary");
      const referenceField = own(entry, "reference");
      let primaryInfo: FieldInfo | null = null;
      let referenceInfo: FieldInfo | null = null;
      if (!isRecord(primary)) {
        add(DIAGNOSTIC_CODES.MISSING_REQUIRED_PROPERTY, `${mappingPath}/primary`);
      } else {
        primaryInfo = resolveFieldReference(primary, `${mappingPath}/primary`, context, add);
        const datasetId = own(primary, "datasetId");
        const fieldId = own(primary, "fieldId");
        if (typeof datasetId === "string" && typeof fieldId === "string") {
          if (base && datasetId !== base.datasetId) {
            add(
              DIAGNOSTIC_CODES.INCOMPATIBLE_COMPARISON,
              `${mappingPath}/primary/datasetId`,
              undefined,
              { relatedIds: [datasetId] },
            );
          }
          const key = fieldKey(datasetId, fieldId);
          if (primaryFields.has(key)) {
            add(DIAGNOSTIC_CODES.INCOMPATIBLE_COMPARISON, `${mappingPath}/primary`, undefined, {
              relatedIds: [fieldId],
            });
          }
          primaryFields.add(key);
          if (role === "dimension") {
            dimensionFieldIds.add(fieldId);
          }
        }
      }
      if (!isRecord(referenceField)) {
        add(DIAGNOSTIC_CODES.MISSING_REQUIRED_PROPERTY, `${mappingPath}/reference`);
      } else {
        referenceInfo = resolveFieldReference(
          referenceField,
          `${mappingPath}/reference`,
          context,
          add,
        );
        const datasetId = own(referenceField, "datasetId");
        const fieldId = own(referenceField, "fieldId");
        if (typeof datasetId === "string" && typeof fieldId === "string") {
          if (reference && datasetId !== reference.datasetId) {
            add(
              DIAGNOSTIC_CODES.INCOMPATIBLE_COMPARISON,
              `${mappingPath}/reference/datasetId`,
              undefined,
              { relatedIds: [datasetId] },
            );
          }
          const key = fieldKey(datasetId, fieldId);
          if (referenceFields.has(key)) {
            add(DIAGNOSTIC_CODES.INCOMPATIBLE_COMPARISON, `${mappingPath}/reference`, undefined, {
              relatedIds: [fieldId],
            });
          }
          referenceFields.add(key);
        }
      }
      if (role === "measure" && primaryInfo && referenceInfo) {
        if (primaryInfo.type && referenceInfo.type && primaryInfo.type !== referenceInfo.type) {
          add(DIAGNOSTIC_CODES.INCOMPATIBLE_COMPARISON, mappingPath, undefined, {
            relatedIds: [comparison.id],
          });
        }
        measureUnits.push({ primary: primaryInfo.unit, reference: referenceInfo.unit });
      }
    });
  }

  const alignment = own(value, "alignment");
  if (alignment === undefined) {
    add(DIAGNOSTIC_CODES.MISSING_REQUIRED_PROPERTY, `${path}/alignment`);
  } else if (!isRecord(alignment)) {
    add(DIAGNOSTIC_CODES.INCOMPATIBLE_COMPARISON, `${path}/alignment`);
  } else {
    checkUnknownKeys(alignment, ALIGNMENT_KEYS, `${path}/alignment`, add);
    const keys = own(alignment, "keys");
    if (!Array.isArray(keys) || keys.length === 0) {
      add(DIAGNOSTIC_CODES.INCOMPATIBLE_COMPARISON, `${path}/alignment/keys`);
    } else {
      const seen = new Set<string>();
      keys.forEach((key, index) => {
        const keyPath = `${path}/alignment/keys/${index}`;
        if (!nonEmptyString(key)) {
          add(DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE, keyPath);
        } else if (seen.has(key)) {
          add(DIAGNOSTIC_CODES.DUPLICATE_ID, keyPath, undefined, { relatedIds: [key] });
        } else {
          seen.add(key);
          if (!dimensionFieldIds.has(key)) {
            add(
              DIAGNOSTIC_CODES.INCOMPATIBLE_COMPARISON,
              keyPath,
              "An alignment key must resolve to a primary dimension mapping.",
              { relatedIds: [key] },
            );
          }
        }
      });
    }
    for (const key of ["collation", "normalization"]) {
      const entry = own(alignment, key);
      if (entry !== undefined && typeof entry !== "string") {
        add(DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE, `${path}/alignment/${key}`);
      }
    }
  }

  const windows = own(value, "windows");
  if (windows !== undefined) {
    if (!isRecord(windows)) {
      add(DIAGNOSTIC_CODES.INCOMPATIBLE_COMPARISON, `${path}/windows`);
    } else {
      checkUnknownKeys(windows, WINDOWS_KEYS, `${path}/windows`, add);
      for (const key of ["primary", "reference"] as const) {
        const windowValue = own(windows, key);
        if (windowValue !== undefined) {
          validateTimeWindow(windowValue, `${path}/windows/${key}`, add);
        }
      }
    }
  }

  let unitPolicyMode: string | undefined;
  const conversions: Array<{
    readonly from: string;
    readonly to: string;
    readonly usable: boolean;
  }> = [];
  const unitPolicy = own(value, "unitPolicy");
  if (unitPolicy !== undefined) {
    if (!isRecord(unitPolicy)) {
      add(DIAGNOSTIC_CODES.INCOMPATIBLE_COMPARISON, `${path}/unitPolicy`);
    } else {
      checkUnknownKeys(unitPolicy, UNIT_POLICY_KEYS, `${path}/unitPolicy`, add);
      const mode = own(unitPolicy, "mode");
      if (!oneOf(mode, COMPARISON_UNIT_POLICIES)) {
        add(DIAGNOSTIC_CODES.INCOMPATIBLE_COMPARISON, `${path}/unitPolicy/mode`);
      } else {
        unitPolicyMode = mode;
      }
      const conversionValues = own(unitPolicy, "conversions");
      if (conversionValues !== undefined) {
        if (!Array.isArray(conversionValues)) {
          add(DIAGNOSTIC_CODES.INCOMPATIBLE_COMPARISON, `${path}/unitPolicy/conversions`);
        } else if (mode !== "explicit") {
          add(
            DIAGNOSTIC_CODES.INCOMPATIBLE_COMPARISON,
            `${path}/unitPolicy/conversions`,
            "Explicit conversions require the explicit unit policy mode.",
          );
        } else {
          conversionValues.forEach((entry, index) => {
            const conversionPath = `${path}/unitPolicy/conversions/${index}`;
            if (!isRecord(entry)) {
              add(DIAGNOSTIC_CODES.INCOMPATIBLE_COMPARISON, conversionPath);
              return;
            }
            checkUnknownKeys(entry, UNIT_CONVERSION_KEYS, conversionPath, add);
            const from = own(entry, "from");
            const to = own(entry, "to");
            const provider = own(entry, "provider");
            const factor = own(entry, "factor");
            const offset = own(entry, "offset");
            const lossless = own(entry, "lossless");
            const documentation = own(entry, "documentation");
            if (!nonEmptyString(from)) {
              add(DIAGNOSTIC_CODES.MISSING_ID, `${conversionPath}/from`);
            }
            if (!nonEmptyString(to)) {
              add(DIAGNOSTIC_CODES.MISSING_ID, `${conversionPath}/to`);
            }
            if (!nonEmptyString(provider)) {
              add(DIAGNOSTIC_CODES.MISSING_ID, `${conversionPath}/provider`);
            }
            if (typeof factor !== "number" || !Number.isFinite(factor) || factor === 0) {
              add(DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE, `${conversionPath}/factor`);
            }
            if (offset !== undefined && (typeof offset !== "number" || !Number.isFinite(offset))) {
              add(DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE, `${conversionPath}/offset`);
            }
            if (lossless !== undefined && typeof lossless !== "boolean") {
              add(DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE, `${conversionPath}/lossless`);
            }
            if (documentation !== undefined && typeof documentation !== "string") {
              add(DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE, `${conversionPath}/documentation`);
            }
            const documented = typeof documentation === "string" && documentation.trim() !== "";
            const usable = lossless === true || documented;
            if (!usable) {
              add(
                DIAGNOSTIC_CODES.INCOMPATIBLE_COMPARISON,
                conversionPath,
                "A unit conversion must be declared lossless or documented.",
              );
            }
            const conversionProviders =
              context.catalog !== undefined &&
              Object.hasOwn(context.catalog, "conversionProviders") &&
              Array.isArray(context.catalog.conversionProviders)
                ? context.catalog.conversionProviders
                : undefined;
            if (conversionProviders === undefined) {
              add(DIAGNOSTIC_CODES.REFERENCE_UNVERIFIED, conversionPath, undefined, {
                severity: "warning",
                source: "structural",
              });
            } else if (typeof provider === "string" && !conversionProviders.includes(provider)) {
              add(
                DIAGNOSTIC_CODES.PROVIDER_CAPABILITY_MISMATCH,
                conversionPath,
                "The provider does not declare this unit conversion capability.",
              );
            }
            if (typeof from === "string" && typeof to === "string") {
              conversions.push({ from, to, usable });
            }
          });
        }
      }
    }
  }

  for (const units of measureUnits) {
    if (
      units.primary === undefined ||
      units.reference === undefined ||
      units.primary === units.reference
    ) {
      continue;
    }
    if (unitPolicyMode !== "explicit") {
      add(DIAGNOSTIC_CODES.INCOMPATIBLE_COMPARISON, `${path}/mapping`, undefined, {
        relatedIds: [comparison.id],
      });
      continue;
    }
    const conversion = conversions.find(
      (entry) =>
        (entry.from === units.primary && entry.to === units.reference) ||
        (entry.from === units.reference && entry.to === units.primary),
    );
    if (!conversion || !conversion.usable) {
      add(DIAGNOSTIC_CODES.INCOMPATIBLE_COMPARISON, `${path}/unitPolicy/conversions`, undefined, {
        relatedIds: [comparison.id],
      });
    }
  }
}

export function validateTimeWindow(value: unknown, path: string, add: AddDiagnostic): void {
  if (!isRecord(value)) {
    add(DIAGNOSTIC_CODES.INCOMPATIBLE_COMPARISON, path);
    return;
  }
  checkUnknownKeys(value, TIME_WINDOW_KEYS, path, add);
  const timezone = own(value, "timezone");
  if (typeof timezone !== "string" || !isValidTimeZone(timezone)) {
    add(DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE, `${path}/timezone`);
  }
  for (const key of ["start", "end"]) {
    const entry = own(value, key);
    if (typeof entry !== "string" || !isIsoTemporalString(entry)) {
      add(DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE, `${path}/${key}`);
    }
  }
  const bounds = own(value, "bounds");
  if (!oneOf(bounds, LAYOUT_BOUNDS)) {
    add(DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE, `${path}/bounds`);
  }
}
