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
  catalogDatasetEntry,
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
  "mappings",
  "target",
]);
const FILTER_TEMPORAL_KEYS = new Set(["timezone", "bounds"]);
const FILTER_TARGET_KEYS = new Set(["kind", "groupId", "blockId"]);
const FILTER_MAPPING_KEYS = new Set(["source", "target"]);
const DATA_CONSUMING_TYPES = new Set(["chart", "metric", "table"]);
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

function blockDatasets(block: ScannedEntry): readonly string[] {
  const bindings = own(block.value, "bindings");
  if (!Array.isArray(bindings)) {
    return Object.freeze([]);
  }
  const datasets: string[] = [];
  for (const binding of bindings) {
    if (!isRecord(binding)) {
      continue;
    }
    const field = own(binding, "field");
    if (!isRecord(field)) {
      continue;
    }
    const datasetId = own(field, "datasetId");
    if (nonEmptyString(datasetId) && !datasets.includes(datasetId)) {
      datasets.push(datasetId);
    }
  }
  return Object.freeze(datasets);
}

function fieldInfoCompatibility(source: FieldInfo | null, target: FieldInfo | null): string | null {
  if (source === null || target === null) {
    return "field-unverified";
  }
  if (source.type !== undefined && target.type !== undefined && source.type !== target.type) {
    return "field-type";
  }
  if ((source.unit ?? "") !== (target.unit ?? "")) {
    return "field-unit";
  }
  if (
    (source.type === "date" || source.type === "datetime") &&
    (source.timezone ?? "") !== (target.timezone ?? "")
  ) {
    return "field-timezone";
  }
  return null;
}

function comparisonSideField(
  comparison: Record<string, unknown>,
  field: Record<string, unknown>,
  side: "primary" | "reference",
  mappings: unknown,
): Record<string, unknown> | null {
  const mapping = own(comparison, "mapping");
  if (!Array.isArray(mapping)) {
    return null;
  }
  const datasetId = own(field, "datasetId");
  const fieldId = own(field, "fieldId");
  if (!nonEmptyString(datasetId) || !nonEmptyString(fieldId)) {
    return null;
  }
  for (const entry of mapping) {
    if (!isRecord(entry)) {
      continue;
    }
    const primary = own(entry, "primary");
    const reference = own(entry, "reference");
    if (!isRecord(primary) || !isRecord(reference)) {
      continue;
    }
    const primaryDataset = own(primary, "datasetId");
    const primaryField = own(primary, "fieldId");
    const referenceDataset = own(reference, "datasetId");
    const referenceField = own(reference, "fieldId");
    const matchesPrimary = primaryDataset === datasetId && primaryField === fieldId;
    const matchesReference = referenceDataset === datasetId && referenceField === fieldId;
    if (side === "primary" && matchesReference) {
      return primary;
    }
    if (side === "reference" && matchesPrimary) {
      return reference;
    }
    if (side === "primary" && matchesPrimary) {
      return primary;
    }
    if (side === "reference" && matchesReference) {
      return reference;
    }
  }
  const inputKey = side === "primary" ? "base" : "reference";
  const input = own(comparison, inputKey);
  if (!isRecord(input)) {
    return null;
  }
  const sideDataset = own(input, "datasetId");
  if (sideDataset === datasetId) {
    return {
      datasetId: sideDataset,
      fieldId,
    };
  }
  if (Array.isArray(mappings) && nonEmptyString(sideDataset)) {
    for (const mapping of mappings) {
      if (!isRecord(mapping)) {
        continue;
      }
      const source = own(mapping, "source");
      const target = own(mapping, "target");
      if (!isRecord(source) || !isRecord(target)) {
        continue;
      }
      if (
        own(source, "datasetId") === datasetId &&
        own(source, "fieldId") === fieldId &&
        own(target, "datasetId") === sideDataset
      ) {
        const targetField = own(target, "fieldId");
        if (nonEmptyString(targetField)) {
          return { datasetId: sideDataset, fieldId: targetField };
        }
      }
    }
  }
  return null;
}

function conversionAllowed(context: ReferenceContext, datasetId: string): boolean {
  return catalogDatasetEntry(context.catalog, datasetId)?.capabilities?.timezoneConversion === true;
}

function filterTemporalTimezone(value: Record<string, unknown>): string | undefined {
  const temporal = own(value, "temporal");
  if (!isRecord(temporal)) {
    return undefined;
  }
  const timezone = own(temporal, "timezone");
  return nonEmptyString(timezone) ? timezone : undefined;
}

function targetTimezoneViolation(
  value: Record<string, unknown>,
  targetInfo: FieldInfo | null,
  targetDatasetId: string,
  context: ReferenceContext,
): boolean {
  const timezone = filterTemporalTimezone(value);
  return (
    timezone !== undefined &&
    (targetInfo?.type === "date" || targetInfo?.type === "datetime") &&
    targetInfo.timezone !== undefined &&
    targetInfo.timezone !== timezone &&
    !conversionAllowed(context, targetDatasetId)
  );
}

function validateFilterMappings(
  value: Record<string, unknown>,
  path: string,
  filterField: Record<string, unknown> | null,
  sourceInfo: FieldInfo | null,
  context: ReferenceContext,
  add: AddDiagnostic,
): void {
  const mappings = own(value, "mappings");
  if (mappings === undefined) {
    return;
  }
  if (!Array.isArray(mappings)) {
    add(DIAGNOSTIC_CODES.INCOMPATIBLE_FILTER, `${path}/mappings`);
    return;
  }
  const sourceDataset = filterField === null ? undefined : own(filterField, "datasetId");
  const sourceFieldId = filterField === null ? undefined : own(filterField, "fieldId");
  const targetDatasets = new Set<string>();
  mappings.forEach((entry, index) => {
    const mappingPath = `${path}/mappings/${index}`;
    if (!isRecord(entry)) {
      add(DIAGNOSTIC_CODES.INCOMPATIBLE_FILTER, mappingPath);
      return;
    }
    checkUnknownKeys(entry, FILTER_MAPPING_KEYS, mappingPath, add);
    const source = own(entry, "source");
    const target = own(entry, "target");
    if (!isRecord(source)) {
      add(DIAGNOSTIC_CODES.MISSING_REQUIRED_PROPERTY, `${mappingPath}/source`);
    } else if (
      own(source, "datasetId") !== sourceDataset ||
      own(source, "fieldId") !== sourceFieldId
    ) {
      add(
        DIAGNOSTIC_CODES.INCOMPATIBLE_FILTER,
        `${mappingPath}/source`,
        "A filter mapping source must be the filter field identity.",
      );
    }
    if (!isRecord(target)) {
      add(DIAGNOSTIC_CODES.MISSING_REQUIRED_PROPERTY, `${mappingPath}/target`);
      return;
    }
    const targetInfo = resolveFieldReference(target, `${mappingPath}/target`, context, add);
    const operator = own(value, "operator");
    if (
      oneOf(operator, FILTER_OPERATORS) &&
      targetInfo?.operators !== undefined &&
      !targetInfo.operators.includes(operator)
    ) {
      add(
        DIAGNOSTIC_CODES.FILTER_TARGET_INCOMPATIBLE,
        `${mappingPath}/target`,
        `The mapped field does not declare operator "${operator}".`,
      );
    }
    const targetDataset = own(target, "datasetId");
    if (
      nonEmptyString(targetDataset) &&
      targetTimezoneViolation(value, targetInfo, targetDataset, context)
    ) {
      add(
        DIAGNOSTIC_CODES.FILTER_TARGET_INCOMPATIBLE,
        `${mappingPath}/target`,
        "The mapped target dataset does not declare timezone conversion for this filter window.",
        { relatedIds: [String(own(value, "id")), targetDataset] },
      );
    }
    if (nonEmptyString(targetDataset)) {
      if (targetDatasets.has(targetDataset)) {
        add(
          DIAGNOSTIC_CODES.INCOMPATIBLE_FILTER,
          `${mappingPath}/target/datasetId`,
          "A filter may declare at most one mapping per target dataset.",
        );
      }
      targetDatasets.add(targetDataset);
    }
    const reason = fieldInfoCompatibility(sourceInfo, targetInfo);
    if (reason === "field-type") {
      add(
        DIAGNOSTIC_CODES.FILTER_TARGET_INCOMPATIBLE,
        `${mappingPath}/target`,
        "A filter mapping must preserve the source field type.",
      );
    } else if (reason === "field-unit") {
      add(
        DIAGNOSTIC_CODES.FILTER_TARGET_INCOMPATIBLE,
        `${mappingPath}/target`,
        "A filter mapping must preserve the source field unit. Unit conversion is not implicit.",
      );
    } else if (reason === "field-timezone") {
      add(
        DIAGNOSTIC_CODES.FILTER_TARGET_INCOMPATIBLE,
        `${mappingPath}/target`,
        "A temporal filter mapping must preserve time semantics. Timezone conversion is not implicit.",
      );
    }
  });
}

function validateFilterTargetCoverage(
  value: Record<string, unknown>,
  path: string,
  filterField: Record<string, unknown> | null,
  context: ReferenceContext,
  add: AddDiagnostic,
): void {
  if (filterField === null) {
    return;
  }
  const target = own(value, "target");
  if (!isRecord(target)) {
    return;
  }
  const sourceDataset = own(filterField, "datasetId");
  const mappings = own(value, "mappings");
  const mappedDatasets = new Set<string>();
  if (Array.isArray(mappings)) {
    for (const entry of mappings) {
      if (!isRecord(entry)) {
        continue;
      }
      const mappingTarget = own(entry, "target");
      if (isRecord(mappingTarget)) {
        const datasetId = own(mappingTarget, "datasetId");
        if (nonEmptyString(datasetId)) {
          mappedDatasets.add(datasetId);
        }
      }
    }
  }
  const blocks: ScannedEntry[] = [];
  const kind = own(target, "kind");
  if (kind === "board") {
    blocks.push(...context.blocks.values());
  } else if (kind === "group") {
    const groupId = own(target, "groupId");
    if (!nonEmptyString(groupId)) {
      return;
    }
    const group = context.groups.get(groupId);
    const blockIds = group === undefined ? undefined : own(group.value, "blockIds");
    for (const block of context.blocks.values()) {
      const blockGroup = own(block.value, "groupId");
      const listed =
        Array.isArray(blockIds) &&
        blockIds.some((entry) => typeof entry === "string" && entry === block.id);
      if (blockGroup === groupId || listed) {
        blocks.push(block);
      }
    }
  } else if (kind === "block") {
    const blockId = own(target, "blockId");
    if (nonEmptyString(blockId)) {
      const block = context.blocks.get(blockId);
      if (block !== undefined) {
        blocks.push(block);
      }
    }
  }
  for (const block of blocks) {
    const blockType = own(block.value, "type");
    if (typeof blockType !== "string" || !DATA_CONSUMING_TYPES.has(blockType)) {
      continue;
    }
    const datasets = blockDatasets(block);
    if (datasets.length === 0) {
      add(
        DIAGNOSTIC_CODES.FILTER_SCHEMA_PENDING,
        `${path}/target`,
        `Block "${block.id}" has no discovered dataset; the filter remains pending.`,
        { severity: "warning", relatedIds: [block.id] },
      );
      continue;
    }
    for (const datasetId of datasets) {
      if (sourceDataset === datasetId) {
        continue;
      }
      if (mappedDatasets.has(datasetId)) {
        continue;
      }
      add(
        DIAGNOSTIC_CODES.FILTER_TARGET_UNMAPPED,
        `${path}/mappings`,
        `Filter "${String(own(value, "id"))}" targets dataset "${datasetId}" through block "${block.id}" without an explicit mapping.`,
        { relatedIds: [String(own(value, "id")), block.id, datasetId] },
      );
    }
    const config = own(block.value, "config");
    const comparisonId = isRecord(config) ? own(config, "comparisonId") : undefined;
    if (nonEmptyString(comparisonId)) {
      const comparisonEntry = context.comparisons.get(comparisonId);
      if (comparisonEntry !== undefined) {
        const filterMappings = own(value, "mappings");
        const primary = comparisonSideField(
          comparisonEntry.value,
          filterField,
          "primary",
          filterMappings,
        );
        const reference = comparisonSideField(
          comparisonEntry.value,
          filterField,
          "reference",
          filterMappings,
        );
        for (const [side, sideField] of [
          ["primary", primary],
          ["reference", reference],
        ] as const) {
          if (sideField === null) {
            add(
              DIAGNOSTIC_CODES.FILTER_TARGET_UNMAPPED,
              `${path}/mappings`,
              `Filter "${String(own(value, "id"))}" has no ${side} comparison mapping for block "${block.id}".`,
              { relatedIds: [String(own(value, "id")), block.id, comparisonId] },
            );
            continue;
          }
          const sideInfo = resolveFieldReference(
            sideField,
            `${path}/comparison/${side}`,
            context,
            add,
          );
          const sourceInfo = resolveFieldReference(filterField, `${path}/field`, context, add);
          const sideDatasetId = own(sideField, "datasetId");
          if (
            nonEmptyString(sideDatasetId) &&
            targetTimezoneViolation(value, sideInfo, sideDatasetId, context)
          ) {
            add(
              DIAGNOSTIC_CODES.FILTER_TARGET_INCOMPATIBLE,
              `${path}/comparison/${side}`,
              `The ${side} comparison dataset does not declare timezone conversion for this filter window.`,
              { relatedIds: [String(own(value, "id")), block.id, comparisonId] },
            );
          }
          const operator = own(value, "operator");
          if (
            oneOf(operator, FILTER_OPERATORS) &&
            sideInfo?.operators !== undefined &&
            !sideInfo.operators.includes(operator)
          ) {
            add(
              DIAGNOSTIC_CODES.FILTER_TARGET_INCOMPATIBLE,
              `${path}/comparison/${side}`,
              `The ${side} comparison side does not declare operator "${operator}".`,
              { relatedIds: [String(own(value, "id")), block.id, comparisonId] },
            );
          }
          const reason = fieldInfoCompatibility(sourceInfo, sideInfo);
          if (reason === "field-type" || reason === "field-unit" || reason === "field-timezone") {
            add(
              DIAGNOSTIC_CODES.FILTER_TARGET_INCOMPATIBLE,
              `${path}/comparison/${side}`,
              `The filter is incompatible with the ${side} comparison side (${reason}).`,
              { relatedIds: [String(own(value, "id")), block.id, comparisonId] },
            );
          }
        }
      }
    }
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
  validateFilterMappings(
    value,
    path,
    isRecord(fieldValue) ? fieldValue : null,
    fieldInfo,
    context,
    add,
  );
  validateFilterTargetCoverage(value, path, isRecord(fieldValue) ? fieldValue : null, context, add);
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
    const timezone = isRecord(temporal) ? own(temporal, "timezone") : undefined;
    const datasetId = isRecord(fieldValue) ? own(fieldValue, "datasetId") : undefined;
    if (
      fieldIsTemporal &&
      nonEmptyString(timezone) &&
      nonEmptyString(datasetId) &&
      fieldInfo?.timezone !== undefined &&
      fieldInfo.timezone !== timezone
    ) {
      const dataset = catalogDatasetEntry(context.catalog, String(datasetId));
      if (dataset?.capabilities?.timezoneConversion !== true) {
        add(
          dataset === undefined
            ? DIAGNOSTIC_CODES.INCOMPATIBLE_FILTER
            : DIAGNOSTIC_CODES.PROVIDER_CAPABILITY_MISMATCH,
          temporalPath,
          `The filter timezone "${timezone}" differs from the field timezone "${fieldInfo.timezone}" and timezone conversion is not declared.`,
          {
            relatedIds: [
              String(datasetId),
              isRecord(fieldValue) ? String(own(fieldValue, "fieldId")) : "",
            ],
          },
        );
      }
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
  const noValue =
    operator === "isNull" ||
    operator === "isNotNull" ||
    operator === "isTrue" ||
    operator === "isFalse";
  if (noValue) {
    if (value !== undefined) {
      add(
        DIAGNOSTIC_CODES.INCOMPATIBLE_FILTER,
        path,
        `Operator "${operator}" does not accept a default value.`,
      );
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
