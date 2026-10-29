import {
  AGGREGATION_TYPES,
  type AggregationType,
  type BindingAxis,
  type BindingMode,
  type BindingRole,
  type BoardDocumentV1,
  type ChartType,
  type FieldReference,
  type FieldRole,
  type FieldValueType,
} from "./board-schema.js";
import { validateBoardDocument, type BoardValidationCatalog } from "./board-validation.js";
import { selectChartBindings } from "./chart-bindings.js";
import {
  DIAGNOSTIC_CODES,
  createDiagnostic,
  fail,
  ok,
  type Diagnostic,
  type Result,
} from "./diagnostics.js";
import { snapshotDocument, type BoardDocument } from "./document.js";
import {
  canonicalJson,
  cloneJson,
  isPlainObject,
  type JsonObject,
  type JsonValue,
} from "./json.js";
import { catalogDatasetEntry, escapePointerSegment, own } from "./board-validation-shared.js";

export const BINDING_SLOTS = Object.freeze(["x", "y", "series", "group"] as const);
export type BindingSlot = (typeof BINDING_SLOTS)[number];

export interface BindingSlotChange {
  readonly blockId: string;
  readonly slot: BindingSlot;
  readonly field: FieldReference | null;
  readonly aggregation?: AggregationType | null;
}

export interface BindingSlotFieldOption {
  readonly datasetId: string;
  readonly fieldId: string;
  readonly label: string | null;
  readonly type: FieldValueType;
  readonly role: FieldRole | null;
  readonly enabled: boolean;
  readonly reason: Diagnostic | null;
}

export interface BindingSlotAggregationOption {
  readonly type: AggregationType;
  readonly enabled: boolean;
  readonly reason: Diagnostic | null;
}

export interface BindingSlotDescriptor {
  readonly blockId: string;
  readonly slot: BindingSlot;
  readonly bindingId: string | null;
  readonly mode: BindingMode;
  readonly locked: boolean;
  readonly optional: boolean;
  readonly selectedField: FieldReference | null;
  readonly selectedAggregation: AggregationType | null;
  readonly fields: readonly BindingSlotFieldOption[];
  readonly aggregations: readonly BindingSlotAggregationOption[];
}

export interface BindingSlotDescriptionOptions {
  readonly catalog?: BoardValidationCatalog;
}

export interface AppliedBindingSlot {
  readonly document: BoardDocumentV1;
  readonly bindingId: string | null;
}

interface CandidateBuild {
  readonly document: BoardDocumentV1;
  readonly bindingId: string | null;
}

const SLOT_ORDER: readonly BindingSlot[] = Object.freeze(["x", "y", "series", "group"]);

function asDocumentV1(document: BoardDocument): BoardDocumentV1 {
  return document as unknown as BoardDocumentV1;
}

function blockList(document: BoardDocumentV1): readonly unknown[] {
  const blocks = (document as unknown as Record<string, unknown>).blocks;
  return Array.isArray(blocks) ? blocks : [];
}

function findBlock(document: BoardDocumentV1, blockId: string): Record<string, unknown> | null {
  const blocks = blockList(document);
  for (const entry of blocks) {
    if (isPlainObject(entry) && own(entry, "id") === blockId) {
      return entry as Record<string, unknown>;
    }
  }
  return null;
}

function bindingsOf(block: Record<string, unknown>): readonly unknown[] {
  const bindings = own(block, "bindings");
  return Array.isArray(bindings) ? bindings : [];
}

function bindingRecord(value: unknown): Record<string, unknown> | null {
  return isPlainObject(value) ? (value as Record<string, unknown>) : null;
}

function fixedBindingMode(binding: Record<string, unknown>): boolean {
  return own(binding, "mode") === "fixed";
}

interface BindingEntry {
  readonly binding: Record<string, unknown>;
  readonly index: number;
  readonly role: string | null;
  readonly axis: string | null;
}

function bindingEntries(block: Record<string, unknown>): readonly BindingEntry[] {
  const entries: BindingEntry[] = [];
  bindingsOf(block).forEach((value, index) => {
    const binding = bindingRecord(value);
    if (binding === null) {
      return;
    }
    entries.push(
      Object.freeze({
        binding,
        index,
        role: typeof own(binding, "role") === "string" ? (own(binding, "role") as string) : null,
        axis: typeof own(binding, "axis") === "string" ? (own(binding, "axis") as string) : null,
      }),
    );
  });
  return Object.freeze(entries);
}

function isEntryMeasure(entry: BindingEntry): boolean {
  return entry.role === "measure" || entry.role === "value" || entry.axis === "y";
}

function resolvedSlotEntries(
  block: Record<string, unknown>,
): Readonly<Record<BindingSlot, BindingEntry | null>> {
  const entries = bindingEntries(block);
  const type = own(block, "type");
  if (type === "metric") {
    return Object.freeze({
      x: null,
      y: entries.find(isEntryMeasure) ?? null,
      series: null,
      group: null,
    });
  }
  if (type !== "chart") {
    return Object.freeze({ x: null, y: null, series: null, group: null });
  }
  const selection = selectChartBindings(entries, visualizationOf(block));
  const seriesRole = selection.series?.role ?? null;
  return Object.freeze({
    x: selection.x,
    y: selection.y,
    series: selection.series !== null && seriesRole !== "group" ? selection.series : null,
    group: selection.series !== null && seriesRole === "group" ? selection.series : null,
  });
}

function findSlotBinding(
  block: Record<string, unknown>,
  slot: BindingSlot,
): Record<string, unknown> | null {
  return resolvedSlotEntries(block)[slot]?.binding ?? null;
}

function findSlotBindingIndex(block: Record<string, unknown>, slot: BindingSlot): number {
  return resolvedSlotEntries(block)[slot]?.index ?? -1;
}

function blockSlots(block: Record<string, unknown>): readonly BindingSlot[] {
  const type = own(block, "type");
  if (type === "chart") {
    return SLOT_ORDER;
  }
  if (type === "metric") {
    return Object.freeze(["y"] as const);
  }
  return Object.freeze([]);
}

function optionalSlot(slot: BindingSlot): boolean {
  return slot === "series" || slot === "group";
}

function visualizationOf(block: Record<string, unknown>): ChartType | null {
  const config = own(block, "config");
  const visualization = isPlainObject(config) ? own(config, "visualization") : undefined;
  return typeof visualization === "string" &&
    ["line", "area", "bar", "stacked-bar", "scatter", "donut"].includes(visualization)
    ? (visualization as ChartType)
    : null;
}

function slotRole(block: Record<string, unknown>, slot: BindingSlot): BindingRole {
  if (slot === "x") {
    return visualizationOf(block) === "scatter" ? "measure" : "dimension";
  }
  if (slot === "y") {
    return "measure";
  }
  return slot === "group" ? "group" : "series";
}

function slotAxis(slot: BindingSlot): BindingAxis | null {
  return slot === "x" ? "x" : slot === "y" ? "y" : null;
}

function bindingFieldReference(binding: Record<string, unknown>): FieldReference | null {
  const field = own(binding, "field");
  if (!isPlainObject(field)) {
    return null;
  }
  const datasetId = own(field, "datasetId");
  const fieldId = own(field, "fieldId");
  return typeof datasetId === "string" && typeof fieldId === "string"
    ? Object.freeze({ datasetId, fieldId })
    : null;
}

function bindingAggregation(binding: Record<string, unknown>): AggregationType | null {
  const aggregation = own(binding, "aggregation");
  if (!isPlainObject(aggregation)) {
    return null;
  }
  const type = own(aggregation, "type");
  return typeof type === "string" && (AGGREGATION_TYPES as readonly string[]).includes(type)
    ? (type as AggregationType)
    : null;
}

function firstDatasetId(document: BoardDocumentV1, block: Record<string, unknown>): string | null {
  for (const entry of bindingsOf(block)) {
    const binding = bindingRecord(entry);
    const field = binding === null ? null : bindingFieldReference(binding);
    if (field !== null) {
      return field.datasetId;
    }
  }
  const datasets = (document as unknown as Record<string, unknown>).datasets;
  if (!Array.isArray(datasets)) {
    return null;
  }
  for (const dataset of datasets) {
    if (isPlainObject(dataset)) {
      const id = own(dataset, "id");
      if (typeof id === "string" && id !== "") {
        return id;
      }
    }
  }
  return null;
}

function datasetFieldDescriptors(
  document: BoardDocumentV1,
  datasetId: string,
  catalog: BoardValidationCatalog | undefined,
): readonly BindingSlotFieldOption[] {
  const byId = new Map<string, BindingSlotFieldOption>();
  const datasets = (document as unknown as Record<string, unknown>).datasets;
  if (Array.isArray(datasets)) {
    for (const dataset of datasets) {
      if (!isPlainObject(dataset) || own(dataset, "id") !== datasetId) {
        continue;
      }
      const fields = own(dataset, "fields");
      if (!Array.isArray(fields)) {
        continue;
      }
      for (const entry of fields) {
        if (!isPlainObject(entry)) {
          continue;
        }
        const fieldId = own(entry, "id");
        const type = own(entry, "type");
        if (typeof fieldId !== "string" || typeof type !== "string") {
          continue;
        }
        byId.set(fieldId, {
          datasetId,
          fieldId,
          label: typeof own(entry, "label") === "string" ? (own(entry, "label") as string) : null,
          type: type as FieldValueType,
          role: typeof own(entry, "role") === "string" ? (own(entry, "role") as FieldRole) : null,
          enabled: false,
          reason: null,
        });
      }
    }
  }
  const providerDataset = catalogDatasetEntry(catalog, datasetId);
  const providerFields = providerDataset?.fields;
  if (isPlainObject(providerFields)) {
    for (const fieldId of Object.getOwnPropertyNames(providerFields)) {
      const entry = own(providerFields, fieldId);
      if (!isPlainObject(entry)) {
        continue;
      }
      const type = own(entry, "type");
      if (typeof type !== "string") {
        continue;
      }
      const existing = byId.get(fieldId);
      byId.set(fieldId, {
        datasetId,
        fieldId,
        label:
          existing?.label ??
          (typeof own(entry, "label") === "string" ? (own(entry, "label") as string) : null),
        type: type as FieldValueType,
        role:
          typeof own(entry, "role") === "string"
            ? (own(entry, "role") as FieldRole)
            : (existing?.role ?? null),
        enabled: false,
        reason: null,
      });
    }
  }
  return Object.freeze([...byId.values()]);
}

function sliceIdForBlock(block: Record<string, unknown>): string | null {
  for (const entry of bindingsOf(block)) {
    const binding = bindingRecord(entry);
    const sliceId = binding === null ? undefined : own(binding, "sliceId");
    if (typeof sliceId === "string" && sliceId !== "") {
      return sliceId;
    }
  }
  return null;
}

function firstSliceIdForDataset(document: BoardDocumentV1, datasetId: string): string | null {
  const slices = (document as unknown as Record<string, unknown>).slices;
  if (!Array.isArray(slices)) {
    return null;
  }
  for (const slice of slices) {
    if (isPlainObject(slice) && own(slice, "datasetId") === datasetId) {
      const id = own(slice, "id");
      if (typeof id === "string" && id !== "") {
        return id;
      }
    }
  }
  return null;
}

function uniqueBindingId(
  block: Record<string, unknown>,
  blockId: string,
  slot: BindingSlot,
): string {
  const used = new Set<string>();
  for (const entry of bindingsOf(block)) {
    const id = isPlainObject(entry) ? own(entry, "id") : undefined;
    if (typeof id === "string") {
      used.add(id);
    }
  }
  const base = `${blockId}:${slot}`;
  if (!used.has(base)) {
    return base;
  }
  let index = 2;
  while (used.has(`${base}:${index}`)) {
    index += 1;
  }
  return `${base}:${index}`;
}

function diagnosticsFromValidation(
  document: BoardDocumentV1,
  catalog: BoardValidationCatalog | undefined,
): readonly Diagnostic[] {
  const validation = validateBoardDocument(document, catalog === undefined ? {} : { catalog });
  return Object.freeze(
    validation.diagnostics.filter((diagnostic) => diagnostic.severity === "error"),
  );
}

function buildCandidate(
  document: BoardDocumentV1,
  change: BindingSlotChange,
  catalog: BoardValidationCatalog | undefined,
): Result<CandidateBuild> {
  if (!(BINDING_SLOTS as readonly string[]).includes(change.slot)) {
    return fail([
      createDiagnostic(DIAGNOSTIC_CODES.INVALID_ARGUMENT, "binding/slot", {
        message: "A binding slot must be x, y, series or group.",
      }),
    ]);
  }
  if (change.field !== null) {
    if (
      !isPlainObject(change.field) ||
      typeof change.field.datasetId !== "string" ||
      change.field.datasetId.trim() === "" ||
      typeof change.field.fieldId !== "string" ||
      change.field.fieldId.trim() === ""
    ) {
      return fail([
        createDiagnostic(DIAGNOSTIC_CODES.INVALID_ARGUMENT, "binding/field", {
          message: "A binding field requires a dataset ID and field ID.",
        }),
      ]);
    }
  }
  let next: JsonObject;
  try {
    next = cloneJson(document as unknown as JsonValue) as JsonObject;
  } catch (error) {
    return fail([
      createDiagnostic(DIAGNOSTIC_CODES.INVALID_ARGUMENT, "document", {
        message: error instanceof Error ? error.message : "The document is not cloneable JSON.",
      }),
    ]);
  }
  const blocks = own(next, "blocks");
  if (!Array.isArray(blocks)) {
    return fail([
      createDiagnostic(DIAGNOSTIC_CODES.INVALID_REFERENCE, "/blocks", {
        message: "The document does not contain a block list.",
      }),
    ]);
  }
  const blockIndex = blocks.findIndex(
    (entry) => isPlainObject(entry) && own(entry, "id") === change.blockId,
  );
  if (blockIndex < 0) {
    return fail([
      createDiagnostic(DIAGNOSTIC_CODES.INVALID_REFERENCE, "/blocks", {
        message: `The block ${change.blockId} does not exist.`,
        relatedIds: [change.blockId],
      }),
    ]);
  }
  const block = blocks[blockIndex];
  if (!isPlainObject(block)) {
    return fail([createDiagnostic(DIAGNOSTIC_CODES.DOCUMENT_INVALID, `/blocks/${blockIndex}`)]);
  }
  if (!blockSlots(block).includes(change.slot)) {
    return fail([
      createDiagnostic(DIAGNOSTIC_CODES.INCOMPATIBLE_BINDING, `/blocks/${blockIndex}/bindings`, {
        message: `The ${String(own(block, "type"))} block does not expose a ${change.slot} binding.`,
      }),
    ]);
  }
  const bindings = own(block, "bindings");
  const mutableBindings: JsonValue[] = Array.isArray(bindings)
    ? ([...bindings] as JsonValue[])
    : [];
  const existingIndex = findSlotBindingIndex(block, change.slot);
  const existing = existingIndex >= 0 ? bindingRecord(mutableBindings[existingIndex]) : null;
  const bindingPath =
    existingIndex >= 0
      ? `/blocks/${blockIndex}/bindings/${existingIndex}`
      : `/blocks/${blockIndex}/bindings`;
  let intendedId =
    existing !== null && typeof own(existing, "id") === "string"
      ? (own(existing, "id") as string)
      : null;

  if (existing !== null && fixedBindingMode(existing)) {
    return fail([
      createDiagnostic(DIAGNOSTIC_CODES.FIXED_BINDING_LOCKED, bindingPath, {
        message:
          "This binding is fixed by configuration and cannot be changed through the editor or public API. The lock is a configuration constraint, not a security boundary.",
        relatedIds: [change.blockId, String(own(existing, "id") ?? "")],
      }),
    ]);
  }

  if (change.field === null) {
    if (existing !== null) {
      mutableBindings.splice(existingIndex, 1);
      block.bindings = mutableBindings;
    }
  } else if (existing !== null) {
    const role = slotRole(block, change.slot);
    const axis = slotAxis(change.slot);
    const fieldChanged =
      bindingFieldReference(existing)?.datasetId !== change.field.datasetId ||
      bindingFieldReference(existing)?.fieldId !== change.field.fieldId;
    existing.field = {
      datasetId: change.field.datasetId,
      fieldId: change.field.fieldId,
    };
    existing.role = role;
    if (axis === null) {
      delete existing.axis;
    } else {
      existing.axis = axis;
    }
    if (change.slot === "y") {
      if (change.aggregation === null || change.aggregation === "none") {
        delete existing.aggregation;
      } else if (change.aggregation !== undefined) {
        existing.aggregation = { type: change.aggregation };
      } else if (fieldChanged && isPlainObject(existing.aggregation)) {
        const aggregation = existing.aggregation as Record<string, JsonValue>;
        delete aggregation.fieldId;
      }
    } else {
      delete existing.aggregation;
    }
    if (fieldChanged) {
      delete existing.sliceId;
    }
  } else if (change.field !== null) {
    const role = slotRole(block, change.slot);
    const axis = slotAxis(change.slot);
    const sliceId =
      sliceIdForBlock(block) ?? firstSliceIdForDataset(document, change.field.datasetId);
    const createdId = uniqueBindingId(block, change.blockId, change.slot);
    intendedId = createdId;
    const created: Record<string, JsonValue> = {
      id: createdId,
      role,
      field: {
        datasetId: change.field.datasetId,
        fieldId: change.field.fieldId,
      },
    };
    if (axis !== null) {
      created.axis = axis;
    }
    if (sliceId !== null) {
      created.sliceId = sliceId;
    }
    if (change.slot === "y" && change.aggregation != null && change.aggregation !== "none") {
      created.aggregation = { type: change.aggregation };
    }
    mutableBindings.push(created);
    block.bindings = mutableBindings;
  }

  const candidate = snapshotDocument(next);
  const errors = diagnosticsFromValidation(asDocumentV1(candidate), catalog);
  if (errors.length > 0) {
    return fail(errors);
  }
  if (change.field !== null) {
    const selected = findSlotBinding(block, change.slot);
    const selectedId =
      selected !== null && typeof own(selected, "id") === "string"
        ? (own(selected, "id") as string)
        : null;
    if (intendedId === null || selectedId !== intendedId) {
      return fail([
        createDiagnostic(DIAGNOSTIC_CODES.INCOMPATIBLE_BINDING, bindingPath, {
          message:
            "The requested change would resolve as a different binding slot. Set the required X field before adding or changing this binding.",
          ...(intendedId === null ? {} : { relatedIds: [intendedId] }),
        }),
      ]);
    }
  }
  return ok({
    document: asDocumentV1(candidate),
    bindingId: intendedId,
  });
}

function firstDiagnostic(diagnostics: readonly Diagnostic[]): Diagnostic | null {
  return diagnostics[0] ?? null;
}

function probeField(
  document: BoardDocumentV1,
  change: BindingSlotChange,
  catalog: BoardValidationCatalog | undefined,
): { readonly enabled: boolean; readonly reason: Diagnostic | null } {
  const first = buildCandidate(document, change, catalog);
  if (first.ok) {
    return { enabled: true, reason: null };
  }
  return { enabled: false, reason: firstDiagnostic(first.diagnostics) };
}

function probeAggregation(
  document: BoardDocumentV1,
  change: BindingSlotChange,
  aggregation: AggregationType,
  catalog: BoardValidationCatalog | undefined,
): { readonly enabled: boolean; readonly reason: Diagnostic | null } {
  const result = buildCandidate(document, { ...change, aggregation }, catalog);
  if (result.ok) {
    return { enabled: true, reason: null };
  }
  return { enabled: false, reason: firstDiagnostic(result.diagnostics) };
}

function fieldCompatibilityReason(
  field: BindingSlotFieldOption,
  block: Record<string, unknown>,
  slot: BindingSlot,
): Diagnostic | null {
  const type = field.type;
  if (slot === "y" && type !== "number") {
    return createDiagnostic(DIAGNOSTIC_CODES.INCOMPATIBLE_BINDING, "binding/field", {
      message: `The ${slot} slot requires a numeric measure, not a ${type} field.`,
      relatedIds: [field.datasetId, field.fieldId],
    });
  }
  if (slot === "x") {
    const visualization = visualizationOf(block);
    if (visualization === "scatter" && type !== "number") {
      return createDiagnostic(DIAGNOSTIC_CODES.INCOMPATIBLE_BINDING, "binding/field", {
        message: "A scatter X slot requires a numeric field.",
        relatedIds: [field.datasetId, field.fieldId],
      });
    }
  }
  return null;
}

function fieldCandidateEnabled(
  document: BoardDocumentV1,
  block: Record<string, unknown>,
  change: BindingSlotChange,
  field: BindingSlotFieldOption,
  catalog: BoardValidationCatalog | undefined,
): { readonly enabled: boolean; readonly reason: Diagnostic | null } {
  const compatibility = fieldCompatibilityReason(field, block, change.slot);
  if (compatibility !== null) {
    return { enabled: false, reason: compatibility };
  }
  if (change.slot !== "y") {
    return probeField(document, change, catalog);
  }
  let firstReason: Diagnostic | null = null;
  for (const aggregation of AGGREGATION_TYPES) {
    const probe = probeAggregation(document, change, aggregation, catalog);
    if (probe.enabled) {
      return probe;
    }
    firstReason ??= probe.reason;
  }
  return { enabled: false, reason: firstReason };
}

export function describeBindingSlots(
  document: BoardDocumentV1,
  blockId: string,
  options: BindingSlotDescriptionOptions = {},
): Result<readonly BindingSlotDescriptor[]> {
  const block = findBlock(document, blockId);
  if (block === null) {
    return fail([
      createDiagnostic(DIAGNOSTIC_CODES.INVALID_REFERENCE, "/blocks", {
        message: `The block ${blockId} does not exist.`,
        relatedIds: [blockId],
      }),
    ]);
  }
  const slots = blockSlots(block);
  if (slots.length === 0) {
    return ok(Object.freeze([]));
  }
  const catalog = options.catalog;
  const descriptors: BindingSlotDescriptor[] = [];
  for (const slot of slots) {
    const binding = findSlotBinding(block, slot);
    const datasetId =
      (binding === null ? null : (bindingFieldReference(binding)?.datasetId ?? null)) ??
      firstDatasetId(document, block);
    if (datasetId === null) {
      descriptors.push(
        Object.freeze({
          blockId,
          slot,
          bindingId: null,
          mode: "selectable" as BindingMode,
          locked: false,
          optional: optionalSlot(slot),
          selectedField: null,
          selectedAggregation: null,
          fields: Object.freeze([]),
          aggregations: Object.freeze([]),
        }),
      );
      continue;
    }
    const selectedField = binding === null ? null : bindingFieldReference(binding);
    const selectedAggregation = binding === null ? null : bindingAggregation(binding);
    const fields = datasetFieldDescriptors(document, datasetId, catalog).map((field) =>
      Object.freeze({
        ...field,
        ...fieldCandidateEnabled(
          document,
          block,
          {
            blockId,
            slot,
            field: { datasetId: field.datasetId, fieldId: field.fieldId },
          },
          field,
          catalog,
        ),
      }),
    );
    const aggregations =
      slot === "y"
        ? Object.freeze(
            AGGREGATION_TYPES.map((aggregation) => {
              if (selectedField === null) {
                return Object.freeze({
                  type: aggregation,
                  enabled: false,
                  reason: createDiagnostic(
                    DIAGNOSTIC_CODES.INVALID_ARGUMENT,
                    "binding/aggregation",
                    {
                      message: "Select a field before choosing an aggregation.",
                    },
                  ),
                });
              }
              return Object.freeze({
                type: aggregation,
                ...probeAggregation(
                  document,
                  { blockId, slot, field: selectedField },
                  aggregation,
                  catalog,
                ),
              });
            }),
          )
        : Object.freeze([]);
    const fieldRecord = binding === null ? null : bindingRecord(binding);
    descriptors.push(
      Object.freeze({
        blockId,
        slot,
        bindingId:
          binding !== null && typeof own(binding, "id") === "string"
            ? (own(binding, "id") as string)
            : null,
        mode:
          fieldRecord !== null && fixedBindingMode(fieldRecord)
            ? ("fixed" as BindingMode)
            : ("selectable" as BindingMode),
        locked: fieldRecord !== null && fixedBindingMode(fieldRecord),
        optional: optionalSlot(slot),
        selectedField,
        selectedAggregation,
        fields: Object.freeze(fields),
        aggregations,
      }),
    );
  }
  return ok(Object.freeze(descriptors));
}

export function setBindingSlot(
  document: BoardDocumentV1,
  change: BindingSlotChange,
  options: BindingSlotDescriptionOptions = {},
): Result<AppliedBindingSlot> {
  return buildCandidate(document, change, options.catalog);
}

export interface FixedBindingPreservationOptions {
  readonly allowDifferentDocument?: boolean;
  readonly allowRemovedBlockIds?: readonly string[];
}

export function assertFixedBindingsPreserved(
  previous: unknown,
  next: unknown,
  options: FixedBindingPreservationOptions = {},
): readonly Diagnostic[] {
  if (!isPlainObject(previous) || !isPlainObject(next)) {
    return Object.freeze([]);
  }
  const previousDocumentId = own(previous, "id");
  const nextDocumentId = own(next, "id");
  if (
    options.allowDifferentDocument === true &&
    typeof previousDocumentId === "string" &&
    typeof nextDocumentId === "string" &&
    previousDocumentId !== nextDocumentId
  ) {
    return Object.freeze([]);
  }
  const previousBlocks = own(previous, "blocks");
  if (!Array.isArray(previousBlocks)) {
    return Object.freeze([]);
  }
  const nextBlocks = own(next, "blocks");
  const diagnostics: Diagnostic[] = [];
  for (let blockIndex = 0; blockIndex < previousBlocks.length; blockIndex += 1) {
    const previousBlock = previousBlocks[blockIndex];
    if (!isPlainObject(previousBlock)) {
      continue;
    }
    const blockId = own(previousBlock, "id");
    if (typeof blockId !== "string") {
      continue;
    }
    const previousBindings = own(previousBlock, "bindings");
    if (!Array.isArray(previousBindings)) {
      continue;
    }
    const nextBlockIndex = Array.isArray(nextBlocks)
      ? nextBlocks.findIndex((entry) => isPlainObject(entry) && own(entry, "id") === blockId)
      : -1;
    const nextBlock =
      nextBlockIndex >= 0 && Array.isArray(nextBlocks) ? nextBlocks[nextBlockIndex] : undefined;
    const nextBindings =
      isPlainObject(nextBlock) && Array.isArray(own(nextBlock, "bindings"))
        ? (own(nextBlock, "bindings") as readonly unknown[])
        : [];
    for (let bindingIndex = 0; bindingIndex < previousBindings.length; bindingIndex += 1) {
      const previousBinding = previousBindings[bindingIndex];
      if (!isPlainObject(previousBinding) || !fixedBindingMode(previousBinding)) {
        continue;
      }
      const bindingId = own(previousBinding, "id");
      if (typeof bindingId !== "string") {
        continue;
      }
      const nextBindingIndex = nextBindings.findIndex(
        (entry) => isPlainObject(entry) && own(entry, "id") === bindingId,
      );
      if (nextBlockIndex < 0) {
        if (options.allowRemovedBlockIds?.includes(blockId)) {
          break;
        }
        diagnostics.push(
          createDiagnostic(
            DIAGNOSTIC_CODES.FIXED_BINDING_CHANGED,
            `/blocks/${escapePointerSegment(blockId)}`,
            {
              message: `The fixed binding ${bindingId} belongs to a block that is missing from the replacement document.`,
              relatedIds: [blockId, bindingId],
            },
          ),
        );
        break;
      }
      if (nextBindingIndex < 0) {
        diagnostics.push(
          createDiagnostic(
            DIAGNOSTIC_CODES.FIXED_BINDING_CHANGED,
            `/blocks/${nextBlockIndex}/bindings`,
            {
              message: `The fixed binding ${bindingId} was removed from the replacement document.`,
              relatedIds: [blockId, bindingId],
            },
          ),
        );
        continue;
      }
      const nextBinding = nextBindings[nextBindingIndex];
      if (
        !isPlainObject(nextBinding) ||
        canonicalJson(previousBinding as never) !== canonicalJson(nextBinding as never)
      ) {
        diagnostics.push(
          createDiagnostic(
            DIAGNOSTIC_CODES.FIXED_BINDING_CHANGED,
            `/blocks/${nextBlockIndex}/bindings/${nextBindingIndex}`,
            {
              message: `The fixed binding ${bindingId} cannot be changed or unlocked by a document replacement.`,
              relatedIds: [blockId, bindingId],
            },
          ),
        );
      }
    }
  }
  return Object.freeze(diagnostics);
}
