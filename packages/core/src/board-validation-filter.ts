import {
  FILTER_OPERATORS,
  FILTER_TARGET_KINDS,
  LAYOUT_BOUNDS,
  type FieldValueType,
  type FilterOperator,
  type FilterTargetKind,
} from "./board-schema.js";
import { DIAGNOSTIC_CODES } from "./diagnostics.js";
import { isValidTimeZone } from "./locale.js";
import {
  checkUnknownKeys,
  isIsoDateString,
  isIsoDateTimeString,
  isRecord,
  nonEmptyString,
  oneOf,
  own,
  resolveFieldReference,
  type AddDiagnostic,
  type FieldInfo,
  type ReferenceContext,
  type ScannedEntry,
} from "./board-validation-shared.js";

const FILTER_KEYS = new Set([
  "id",
  "label",
  "description",
  "field",
  "operator",
  "defaultValue",
  "viewerEditable",
  "temporal",
  "target",
]);
const FILTER_TEMPORAL_KEYS = new Set(["timezone", "bounds"]);
const FILTER_TARGET_KEYS = new Set(["kind", "groupId", "blockId"]);
const TEMPORAL_FILTER_OPERATORS = new Set<FilterOperator>([
  "before",
  "after",
  "onOrBefore",
  "onOrAfter",
  "between",
]);

export const FILTER_OPERATORS_BY_FIELD_TYPE: Readonly<
  Record<FieldValueType, readonly FilterOperator[]>
> = Object.freeze({
  number: [
    "equals",
    "notEquals",
    "greaterThan",
    "greaterThanOrEqual",
    "lessThan",
    "lessThanOrEqual",
    "between",
    "in",
    "notIn",
    "isNull",
    "isNotNull",
  ],
  string: ["equals", "notEquals", "in", "notIn", "contains", "isNull", "isNotNull"],
  boolean: ["isTrue", "isFalse", "isNull"],
  date: [
    "before",
    "after",
    "onOrBefore",
    "onOrAfter",
    "between",
    "in",
    "notIn",
    "isNull",
    "isNotNull",
  ],
  datetime: [
    "before",
    "after",
    "onOrBefore",
    "onOrAfter",
    "between",
    "in",
    "notIn",
    "isNull",
    "isNotNull",
  ],
});

export function validateFilterTemporal(value: unknown, path: string, add: AddDiagnostic): void {
  if (!isRecord(value)) {
    add(DIAGNOSTIC_CODES.INCOMPATIBLE_FILTER, path);
    return;
  }
  checkUnknownKeys(value, FILTER_TEMPORAL_KEYS, path, add);
  const timezone = own(value, "timezone");
  if (typeof timezone !== "string" || !isValidTimeZone(timezone)) {
    add(DIAGNOSTIC_CODES.INCOMPATIBLE_FILTER, `${path}/timezone`);
  }
  const bounds = own(value, "bounds");
  if (!oneOf(bounds, LAYOUT_BOUNDS)) {
    add(DIAGNOSTIC_CODES.INCOMPATIBLE_FILTER, `${path}/bounds`);
  }
}

export function validateFilter(
  filter: ScannedEntry,
  context: ReferenceContext,
  add: AddDiagnostic,
): void {
  const value = filter.value;
  const path = filter.path;
  checkUnknownKeys(value, FILTER_KEYS, path, add);
  for (const key of ["label", "description"]) {
    const entry = own(value, key);
    if (entry !== undefined && typeof entry !== "string") {
      add(DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE, `${path}/${key}`);
    }
  }
  const fieldValue = own(value, "field");
  let fieldInfo: FieldInfo | null = null;
  if (!isRecord(fieldValue)) {
    add(DIAGNOSTIC_CODES.MISSING_REQUIRED_PROPERTY, `${path}/field`);
  } else {
    fieldInfo = resolveFieldReference(fieldValue, `${path}/field`, context, add);
  }
  const operator = own(value, "operator");
  if (!oneOf(operator, FILTER_OPERATORS)) {
    add(
      DIAGNOSTIC_CODES.INCOMPATIBLE_FILTER,
      `${path}/operator`,
      "A filter requires a supported typed operator.",
    );
  } else if (fieldInfo?.type) {
    const allowed = fieldInfo.operators ?? FILTER_OPERATORS_BY_FIELD_TYPE[fieldInfo.type];
    if (!allowed.includes(operator)) {
      add(
        DIAGNOSTIC_CODES.INCOMPATIBLE_FILTER,
        `${path}/operator`,
        `Operator "${operator}" is not compatible with field type "${fieldInfo.type}".`,
      );
    } else if (operator === "contains" && fieldInfo.operators === undefined) {
      add(DIAGNOSTIC_CODES.REFERENCE_UNVERIFIED, `${path}/operator`, undefined, {
        severity: "warning",
        source: "structural",
      });
    }
  }
  const temporal = own(value, "temporal");
  const temporalPath = `${path}/temporal`;
  const fieldIsTemporal = fieldInfo?.type === "date" || fieldInfo?.type === "datetime";
  if (temporal !== undefined) {
    validateFilterTemporal(temporal, temporalPath, add);
    if (fieldInfo?.type && !fieldIsTemporal) {
      add(
        DIAGNOSTIC_CODES.INCOMPATIBLE_FILTER,
        temporalPath,
        "A temporal filter window is only valid for date or datetime fields.",
      );
    }
  } else if (
    fieldIsTemporal &&
    oneOf(operator, FILTER_OPERATORS) &&
    TEMPORAL_FILTER_OPERATORS.has(operator)
  ) {
    add(
      DIAGNOSTIC_CODES.INCOMPATIBLE_FILTER,
      temporalPath,
      "A temporal range filter must declare its timezone and boundary rule.",
    );
  }
  const viewerEditable = own(value, "viewerEditable");
  if (viewerEditable !== undefined && typeof viewerEditable !== "boolean") {
    add(DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE, `${path}/viewerEditable`);
  }

  const target = own(value, "target");
  if (!isRecord(target)) {
    add(DIAGNOSTIC_CODES.MISSING_REQUIRED_PROPERTY, `${path}/target`);
  } else {
    checkUnknownKeys(target, FILTER_TARGET_KEYS, `${path}/target`, add);
    const kind = own(target, "kind");
    if (!oneOf(kind, FILTER_TARGET_KINDS)) {
      add(
        DIAGNOSTIC_CODES.INCOMPATIBLE_FILTER,
        `${path}/target/kind`,
        "A filter target must be board, group or block.",
      );
    } else {
      const kindValue: FilterTargetKind = kind;
      if (kindValue === "board") {
        if (own(target, "groupId") !== undefined || own(target, "blockId") !== undefined) {
          add(
            DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE,
            `${path}/target`,
            "A board filter target cannot name a group or block.",
          );
        }
      } else if (kindValue === "group") {
        if (own(target, "blockId") !== undefined) {
          add(
            DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE,
            `${path}/target`,
            "A group filter target cannot name a block.",
          );
        }
        const groupId = own(target, "groupId");
        if (!nonEmptyString(groupId)) {
          add(DIAGNOSTIC_CODES.MISSING_ID, `${path}/target/groupId`);
        } else if (!context.groups.has(groupId)) {
          add(DIAGNOSTIC_CODES.INVALID_REFERENCE, `${path}/target/groupId`, undefined, {
            relatedIds: [groupId],
          });
        }
      } else {
        if (own(target, "groupId") !== undefined) {
          add(
            DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE,
            `${path}/target`,
            "A block filter target cannot name a group.",
          );
        }
        const blockId = own(target, "blockId");
        if (!nonEmptyString(blockId)) {
          add(DIAGNOSTIC_CODES.MISSING_ID, `${path}/target/blockId`);
        } else if (!context.blocks.has(blockId)) {
          add(DIAGNOSTIC_CODES.INVALID_REFERENCE, `${path}/target/blockId`, undefined, {
            relatedIds: [blockId],
          });
        }
      }
    }
  }

  const defaultValue = own(value, "defaultValue");
  if (operator !== undefined && oneOf(operator, FILTER_OPERATORS)) {
    validateFilterValue(operator, defaultValue, fieldInfo?.type, `${path}/defaultValue`, add);
  }
}

export function validateFilterValue(
  operator: FilterOperator,
  value: unknown,
  fieldType: FieldValueType | undefined,
  path: string,
  add: AddDiagnostic,
): void {
  const noValue = operator === "isNull" || operator === "isNotNull";
  if (noValue) {
    if (value !== undefined && value !== null) {
      add(
        DIAGNOSTIC_CODES.INCOMPATIBLE_FILTER,
        path,
        `Operator "${operator}" does not accept a default value.`,
      );
    }
    return;
  }
  if (operator === "isTrue" || operator === "isFalse") {
    if (value !== undefined && typeof value !== "boolean") {
      add(DIAGNOSTIC_CODES.INCOMPATIBLE_FILTER, path);
    }
    return;
  }
  if (value === undefined) {
    add(
      DIAGNOSTIC_CODES.INCOMPATIBLE_FILTER,
      path,
      "The filter operator requires a default value.",
    );
    return;
  }
  if (operator === "between") {
    if (!Array.isArray(value) || value.length !== 2) {
      add(
        DIAGNOSTIC_CODES.INCOMPATIBLE_FILTER,
        path,
        "A between filter requires a two-value range.",
      );
      return;
    }
  } else if (operator === "in" || operator === "notIn") {
    if (!Array.isArray(value)) {
      add(
        DIAGNOSTIC_CODES.INCOMPATIBLE_FILTER,
        path,
        "A membership filter requires an array of values.",
      );
      return;
    }
  } else if (Array.isArray(value)) {
    add(
      DIAGNOSTIC_CODES.INCOMPATIBLE_FILTER,
      path,
      `Operator "${operator}" requires a scalar default value.`,
    );
    return;
  }
  if (fieldType === undefined) {
    return;
  }
  const entries = Array.isArray(value) ? value : [value];
  for (const entry of entries) {
    if (!valueMatchesFieldType(entry, fieldType)) {
      add(
        DIAGNOSTIC_CODES.INCOMPATIBLE_FILTER,
        path,
        `The filter value does not match field type "${fieldType}".`,
      );
      return;
    }
  }
}
export function valueMatchesFieldType(value: unknown, fieldType: FieldValueType): boolean {
  if (value === null) {
    return true;
  }
  if (fieldType === "number") {
    return typeof value === "number" && Number.isFinite(value);
  }
  if (fieldType === "string") {
    return typeof value === "string";
  }
  if (fieldType === "boolean") {
    return typeof value === "boolean";
  }
  if (fieldType === "date") {
    return typeof value === "string" && isIsoDateString(value);
  }
  return typeof value === "string" && isIsoDateTimeString(value);
}
