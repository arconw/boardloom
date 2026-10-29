import {
  BOARD_BREAKPOINTS,
  BOARD_BLOCK_TYPES,
  isAllowedThemeTokenName,
  validateThemeTokenValue,
  THEME_MODES,
  type BindingDefinition,
  type BoardBlockType,
  type BoardBreakpoint,
  type BoardDocumentV1,
  type BoardLayout,
  type BoardTheme,
  type BlockDefinition,
  type BreakpointLayout,
  type DatasetReference,
  type FieldDescriptor,
  type FilterDefinition,
  type LayoutPlacement,
  type ThemeMode,
} from "./board-schema.js";
import {
  DIAGNOSTIC_CODES,
  createDiagnostic,
  fail,
  ok,
  type Diagnostic,
  type Result,
} from "./diagnostics.js";
import type { IdFactory } from "./ids.js";
import { cloneJson, isPlainObject, type JsonObject } from "./json.js";

export interface EditorOperationContext {
  readonly idFactory: IdFactory;
}

export interface EditorAddBlockOptions {
  readonly title?: string;
  readonly groupId?: string;
}

export interface EditorMoveBlockChange {
  readonly breakpoint?: BoardBreakpoint;
  readonly dx?: number;
  readonly dy?: number;
}

export interface EditorResizeBlockChange {
  readonly breakpoint?: BoardBreakpoint;
  readonly dw?: number;
  readonly dh?: number;
}

export interface EditorBlockPatch {
  readonly title?: string;
  readonly text?: string;
  readonly config?: JsonObject;
}

export type EditorReorderDirection = "earlier" | "later";

export interface EditorThemeInput {
  readonly mode: ThemeMode;
  readonly tokens?: Readonly<Record<string, string>>;
  readonly removeTokens?: readonly string[];
}

const QUERY_BLOCK_TYPES = new Set(["chart", "metric", "table"]);

function operationFailure(path: string, message: string): Result<never> {
  return fail([
    createDiagnostic(DIAGNOSTIC_CODES.INVALID_ARGUMENT, path, {
      message,
    }),
  ]);
}

function invalidArgument(path: string, message: string): readonly Diagnostic[] {
  return [
    createDiagnostic(DIAGNOSTIC_CODES.INVALID_ARGUMENT, path, {
      message,
    }),
  ];
}

function blockFailure(path: string, message: string): Result<never> {
  return fail([
    createDiagnostic(DIAGNOSTIC_CODES.INCOMPATIBLE_BINDING, path, {
      message,
    }),
  ]);
}

function findBlock(
  document: BoardDocumentV1,
  blockId: string,
): Result<{ readonly block: BlockDefinition; readonly index: number }> {
  const index = document.blocks.findIndex((block) => block.id === blockId);
  const block = index >= 0 ? document.blocks[index] : undefined;
  if (block === undefined) {
    return fail([
      createDiagnostic(DIAGNOSTIC_CODES.INVALID_REFERENCE, "blockId", {
        relatedIds: [blockId],
      }),
    ]);
  }
  return ok(Object.freeze({ block, index }));
}

function isBreakpoint(value: unknown): value is BoardBreakpoint {
  return typeof value === "string" && (BOARD_BREAKPOINTS as readonly string[]).includes(value);
}

function fallbackBreakpointLayout(
  document: BoardDocumentV1,
  name: BoardBreakpoint,
): BreakpointLayout | undefined {
  if (name === "narrow") {
    return document.layout.narrow ?? document.layout.tablet ?? document.layout.desktop;
  }
  if (name === "tablet") {
    return document.layout.tablet ?? document.layout.desktop;
  }
  return document.layout.desktop;
}

function breakpointFor(
  document: BoardDocumentV1,
  value: BoardBreakpoint | undefined,
): Result<{ readonly name: BoardBreakpoint; readonly layout: BreakpointLayout }> {
  const name = value ?? "desktop";
  if (!isBreakpoint(name)) {
    return fail(
      invalidArgument("breakpoint", "A layout breakpoint must be desktop, tablet or narrow."),
    );
  }
  const layout = fallbackBreakpointLayout(document, name);
  if (layout === undefined) {
    return fail(invalidArgument(`layout/${name}`, "The selected breakpoint has no layout."));
  }
  return ok(
    Object.freeze({
      name,
      layout: Object.freeze({
        ...layout,
        placements: Object.freeze(layout.placements.map((placement) => Object.freeze(placement))),
      }) as unknown as BreakpointLayout,
    }),
  );
}

function cloneBlockSource(block: BlockDefinition): BlockDefinition {
  return cloneJson(block as unknown as JsonObject) as unknown as BlockDefinition;
}

function defaultHeightFor(type: string): number {
  if (type === "chart" || type === "table") {
    return 4;
  }
  return 2;
}

function defaultWidthFor(columns: number): number {
  return Math.max(1, Math.min(columns, Math.ceil(columns / 2)));
}

function datasetFields(dataset: DatasetReference | undefined): readonly FieldDescriptor[] {
  return dataset?.fields ?? [];
}

function isDimensionField(field: FieldDescriptor): boolean {
  return (
    field.role === "dimension" ||
    field.type === "string" ||
    field.type === "date" ||
    field.type === "datetime"
  );
}

function isMeasureField(field: FieldDescriptor): boolean {
  return field.role === "measure" || field.type === "number";
}

function preferredDataset(document: BoardDocumentV1): DatasetReference | undefined {
  for (const filter of document.filters) {
    const dataset = document.datasets.find((entry) => entry.id === filter.field.datasetId);
    if (dataset !== undefined && datasetFields(dataset).length > 0) {
      return dataset;
    }
  }
  return document.datasets.find((entry) => datasetFields(entry).length > 0);
}

function fieldReference(
  dataset: DatasetReference,
  field: FieldDescriptor,
): {
  readonly datasetId: string;
  readonly fieldId: string;
} {
  return Object.freeze({ datasetId: dataset.id, fieldId: field.id });
}

function sliceFor(document: BoardDocumentV1, datasetId: string): string | undefined {
  return document.slices.find((slice) => slice.datasetId === datasetId)?.id;
}

function defaultFilterDefinition(
  document: BoardDocumentV1,
  idFactory: IdFactory,
): Result<{ readonly filter: FilterDefinition; readonly dataset: DatasetReference }> {
  const dataset = preferredDataset(document);
  if (!dataset) {
    return blockFailure(
      "filters",
      "A filter block requires a dataset field; add a dataset with fields first.",
    );
  }
  const field = datasetFields(dataset).find(isDimensionField) ?? datasetFields(dataset)[0];
  if (field === undefined) {
    return blockFailure(
      "filters",
      "A filter block requires a dataset field; add a dataset with fields first.",
    );
  }
  const operator = field.type === "boolean" ? "isTrue" : "isNotNull";
  const filter: FilterDefinition = {
    id: idFactory.createId("filter"),
    label: field.id,
    field: fieldReference(dataset, field),
    operator,
    viewerEditable: true,
    target: { kind: "board" },
  };
  return ok(Object.freeze({ filter, dataset }));
}

export function editorDefaultBlock(
  document: BoardDocumentV1,
  type: string,
  context: EditorOperationContext,
): Result<{ readonly block: BlockDefinition; readonly filter?: FilterDefinition }> {
  if (typeof type !== "string" || type.trim() === "") {
    return operationFailure("type", "A block type must be a non-empty string.");
  }
  if (!(BOARD_BLOCK_TYPES as readonly string[]).includes(type)) {
    return ok({ block: { id: context.idFactory.createId("block"), type, config: {} } });
  }
  const builtIn = type as BoardBlockType;
  if (builtIn === "text") {
    return ok({
      block: { id: context.idFactory.createId("block"), type, config: { text: "" } },
    });
  }
  if (builtIn === "filter") {
    const existing = document.filters[0];
    if (existing !== undefined) {
      return ok({
        block: {
          id: context.idFactory.createId("block"),
          type,
          config: { filterIds: [existing.id] },
        },
      });
    }
    const created = defaultFilterDefinition(document, context.idFactory);
    if (!created.ok) {
      return created;
    }
    return ok({
      block: {
        id: context.idFactory.createId("block"),
        type,
        config: { filterIds: [created.value.filter.id] },
      },
      filter: created.value.filter,
    });
  }

  const dataset = preferredDataset(document);
  if (dataset === undefined) {
    return blockFailure(
      "bindings",
      "This block requires a dataset with fields; add a dataset with fields first.",
    );
  }
  const fields = datasetFields(dataset);
  const dimension = fields.find(isDimensionField);
  const measure = fields.find(isMeasureField);
  const sliceId = sliceFor(document, dataset.id);
  const bindings: BindingDefinition[] = [];
  if (builtIn === "chart") {
    if (dimension === undefined) {
      return blockFailure(
        "bindings/x",
        "A chart block requires a dimension field; add a dimension field first.",
      );
    }
    if (measure === undefined) {
      return blockFailure(
        "bindings/y",
        "A chart block requires a numeric measure field; add a measure field first.",
      );
    }
    bindings.push(
      {
        id: context.idFactory.createId("binding"),
        role: "dimension",
        axis: "x",
        mode: "selectable",
        field: fieldReference(dataset, dimension),
        ...(sliceId === undefined ? {} : { sliceId }),
      },
      {
        id: context.idFactory.createId("binding"),
        role: "measure",
        axis: "y",
        mode: "selectable",
        field: fieldReference(dataset, measure),
        aggregation: { type: "average" },
        ...(sliceId === undefined ? {} : { sliceId }),
      },
    );
    return ok({
      block: {
        id: context.idFactory.createId("block"),
        type,
        bindings,
        config: { visualization: "bar" },
      },
    });
  }
  if (builtIn === "metric") {
    if (measure === undefined) {
      return blockFailure(
        "bindings/y",
        "A metric block requires a numeric measure field; add a measure field first.",
      );
    }
    return ok({
      block: {
        id: context.idFactory.createId("block"),
        type,
        bindings: [
          {
            id: context.idFactory.createId("binding"),
            role: "measure",
            axis: "y",
            mode: "selectable",
            field: fieldReference(dataset, measure),
            aggregation: { type: "average" },
            ...(sliceId === undefined ? {} : { sliceId }),
          },
        ],
        config: {},
      },
    });
  }
  if (dimension !== undefined) {
    bindings.push({
      id: context.idFactory.createId("binding"),
      role: "dimension",
      field: fieldReference(dataset, dimension),
      ...(sliceId === undefined ? {} : { sliceId }),
    });
  }
  if (measure !== undefined) {
    bindings.push({
      id: context.idFactory.createId("binding"),
      role: "measure",
      field: fieldReference(dataset, measure),
      aggregation: { type: "average" },
      ...(sliceId === undefined ? {} : { sliceId }),
    });
  }
  return ok({
    block: {
      id: context.idFactory.createId("block"),
      type,
      bindings,
      config: { columns: bindings.map((binding) => binding.id) },
    },
  });
}

function placementsBottom(layout: BreakpointLayout): number {
  return layout.placements.reduce(
    (bottom, placement) => Math.max(bottom, placement.y + placement.height),
    0,
  );
}

function addPlacementToLayout(
  document: BoardDocumentV1,
  blockId: string,
  type: string,
): BoardLayout {
  const layout: {
    desktop: BreakpointLayout;
    tablet?: BreakpointLayout;
    narrow?: BreakpointLayout;
  } = { ...document.layout };
  for (const breakpoint of BOARD_BREAKPOINTS) {
    const current = document.layout[breakpoint];
    if (current === undefined) {
      continue;
    }
    const width = Math.min(current.columns, defaultWidthFor(current.columns));
    const placement: LayoutPlacement = {
      blockId,
      x: 0,
      y: placementsBottom(current),
      width,
      height: defaultHeightFor(type),
      minWidth: 1,
      minHeight: 1,
    };
    layout[breakpoint] = {
      ...current,
      placements: [...current.placements, placement],
    };
  }
  return layout;
}

export function editorAddBlock(
  document: BoardDocumentV1,
  type: string,
  options: EditorAddBlockOptions,
  context: EditorOperationContext,
): Result<BoardDocumentV1> {
  if (!Array.isArray(document.blocks)) {
    return operationFailure("blocks", "The draft has no block list.");
  }
  if (options.title !== undefined && typeof options.title !== "string") {
    return operationFailure("title", "A block title must be a string.");
  }
  if (options.groupId !== undefined) {
    if (typeof options.groupId !== "string" || options.groupId.trim() === "") {
      return operationFailure("groupId", "A block group identifier must be a non-empty string.");
    }
    const groupExists = (document.filterGroups ?? []).some((group) => group.id === options.groupId);
    if (!groupExists) {
      return fail([
        createDiagnostic(DIAGNOSTIC_CODES.INVALID_REFERENCE, "groupId", {
          relatedIds: [options.groupId],
        }),
      ]);
    }
  }
  const created = editorDefaultBlock(document, type, context);
  if (!created.ok) {
    return created;
  }
  const block: BlockDefinition = {
    ...created.value.block,
    ...(options.title === undefined || options.title.trim() === "" ? {} : { title: options.title }),
    ...(options.groupId === undefined ? {} : { groupId: options.groupId }),
  };
  const filters =
    created.value.filter === undefined
      ? document.filters
      : [...document.filters, created.value.filter];
  return ok({
    ...document,
    blocks: [...document.blocks, block],
    filters,
    layout: addPlacementToLayout(document, block.id, type),
  });
}

function removePlacements(layout: BoardLayout, blockId: string): BoardLayout {
  const next: {
    desktop: BreakpointLayout;
    tablet?: BreakpointLayout;
    narrow?: BreakpointLayout;
  } = { ...layout };
  for (const breakpoint of BOARD_BREAKPOINTS) {
    const current = layout[breakpoint];
    if (current === undefined) {
      continue;
    }
    next[breakpoint] = {
      ...current,
      placements: current.placements.filter((placement) => placement.blockId !== blockId),
    };
  }
  return next;
}

function blockFilterIds(block: BlockDefinition): readonly string[] {
  if (block.type !== "filter" || !isPlainObject(block.config)) {
    return Object.freeze([]);
  }
  const filterIds = block.config.filterIds;
  return Array.isArray(filterIds)
    ? filterIds.filter((entry): entry is string => typeof entry === "string")
    : Object.freeze([]);
}

export function editorDeleteBlock(
  document: BoardDocumentV1,
  blockId: string,
): Result<BoardDocumentV1> {
  const found = findBlock(document, blockId);
  if (!found.ok) {
    return found;
  }
  const removedBlockIds = new Set<string>([blockId]);
  let changed = true;
  while (changed) {
    changed = false;
    const removedFilterIds = new Set(
      document.filters
        .filter(
          (filter) => filter.target.kind === "block" && removedBlockIds.has(filter.target.blockId),
        )
        .map((filter) => filter.id),
    );
    for (const block of document.blocks) {
      if (removedBlockIds.has(block.id)) {
        continue;
      }
      const filterIds = blockFilterIds(block);
      if (filterIds.length === 0) {
        continue;
      }
      if (filterIds.every((filterId) => removedFilterIds.has(filterId))) {
        removedBlockIds.add(block.id);
        changed = true;
      }
    }
  }
  const targetRemovedFilterIds = new Set(
    document.filters
      .filter(
        (filter) => filter.target.kind === "block" && removedBlockIds.has(filter.target.blockId),
      )
      .map((filter) => filter.id),
  );
  const remainingBlocks = document.blocks
    .filter((block) => !removedBlockIds.has(block.id))
    .map((block) => {
      const filterIds = blockFilterIds(block);
      if (block.type !== "filter" || filterIds.length === 0) {
        return block;
      }
      const nextFilterIds = filterIds.filter((filterId) => !targetRemovedFilterIds.has(filterId));
      return nextFilterIds.length === filterIds.length
        ? block
        : { ...block, config: { ...block.config, filterIds: nextFilterIds } };
    });
  const referencedByRemaining = new Set(remainingBlocks.flatMap(blockFilterIds));
  const removedOwnedFilterIds = new Set(
    document.blocks
      .filter((block) => removedBlockIds.has(block.id) && block.type === "filter")
      .flatMap(blockFilterIds)
      .filter((filterId) => !referencedByRemaining.has(filterId)),
  );
  const removedFilterIds = new Set([...targetRemovedFilterIds, ...removedOwnedFilterIds]);
  const remainingIds = new Set(remainingBlocks.map((block) => block.id));
  const filters = document.filters.filter((filter) => !removedFilterIds.has(filter.id));
  const filterGroups = (document.filterGroups ?? []).map((group) =>
    group.blockIds === undefined
      ? group
      : { ...group, blockIds: group.blockIds.filter((id) => remainingIds.has(id)) },
  );
  let layout = document.layout;
  for (const removedId of removedBlockIds) {
    layout = removePlacements(layout, removedId);
  }
  return ok({
    ...document,
    blocks: remainingBlocks,
    filters,
    filterGroups,
    layout,
  });
}

function remapBlockConfiguration(
  block: BlockDefinition,
  context: EditorOperationContext,
): { readonly bindings: BindingDefinition[]; readonly config: JsonObject } {
  const mappings = new Map<string, string>();
  const bindings = (block.bindings ?? []).map((binding) => {
    const id = context.idFactory.createId("binding");
    mappings.set(binding.id, id);
    return { ...binding, id };
  });
  const config = isPlainObject(block.config) ? (cloneJson(block.config) as JsonObject) : {};
  if (Array.isArray(config.columns)) {
    config.columns = config.columns
      .filter((column): column is string => typeof column === "string")
      .map((column) => mappings.get(column) ?? column);
  }
  if (isPlainObject(config.sort)) {
    const bindingId = config.sort.bindingId;
    if (typeof bindingId === "string" && mappings.has(bindingId)) {
      config.sort = {
        ...config.sort,
        bindingId: mappings.get(bindingId) ?? bindingId,
      };
    }
  }
  return { bindings, config };
}

export function editorDuplicateBlock(
  document: BoardDocumentV1,
  blockId: string,
  context: EditorOperationContext,
): Result<BoardDocumentV1> {
  const found = findBlock(document, blockId);
  if (!found.ok) {
    return found;
  }
  const source = cloneBlockSource(found.value.block);
  const remapped = remapBlockConfiguration(source, context);
  const block: BlockDefinition = {
    ...source,
    id: context.idFactory.createId("block"),
    ...(source.bindings === undefined ? {} : { bindings: remapped.bindings }),
    config: remapped.config,
  };
  return ok({
    ...document,
    blocks: [...document.blocks, block],
    layout: addPlacementToLayout(document, block.id, block.type),
  });
}

function overlap(left: LayoutPlacement, right: LayoutPlacement): boolean {
  return (
    left.x < right.x + right.width &&
    right.x < left.x + left.width &&
    left.y < right.y + right.height &&
    right.y < left.y + left.height
  );
}

function resolveBreakpoint(
  layout: BreakpointLayout,
  desired: ReadonlyMap<string, LayoutPlacement>,
  priorityId: string,
): BreakpointLayout {
  const byId = new Map(layout.placements.map((placement) => [placement.blockId, placement]));
  const order = [
    priorityId,
    ...layout.placements
      .filter((placement) => placement.blockId !== priorityId)
      .sort((left, right) => (left.y === right.y ? left.x - right.x : left.y - right.y))
      .map((placement) => placement.blockId),
  ];
  const placed: LayoutPlacement[] = [];
  for (const blockId of order) {
    const base = desired.get(blockId) ?? byId.get(blockId);
    if (base === undefined) {
      continue;
    }
    const x = Math.max(0, Math.min(base.x, layout.columns - 1));
    const width = Math.max(1, Math.min(base.width, layout.columns - x));
    const height = Math.max(1, base.height);
    const minWidth = base.minWidth ?? 1;
    const minHeight = base.minHeight ?? 1;
    const finalWidth = Math.max(width, Math.min(minWidth, layout.columns - x));
    const finalHeight = Math.max(height, minHeight);
    let y = Math.max(0, base.y);
    let guard = 0;
    while (
      placed.some((entry) =>
        overlap({ ...base, x, y, width: finalWidth, height: finalHeight }, entry),
      ) &&
      guard < 10_000
    ) {
      y += 1;
      guard += 1;
    }
    placed.push({
      ...base,
      x,
      y,
      width: finalWidth,
      height: finalHeight,
    });
  }
  const orderById = new Map(placed.map((placement) => [placement.blockId, placement]));
  return {
    ...layout,
    placements: layout.placements.map((placement) => orderById.get(placement.blockId) ?? placement),
  };
}

function changedBreakpointLayout(
  document: BoardDocumentV1,
  breakpoint: BoardBreakpoint,
  blockId: string,
  change: Partial<LayoutPlacement>,
): Result<BoardLayout> {
  const selected = breakpointFor(document, breakpoint);
  if (!selected.ok) {
    return selected;
  }
  const current = selected.value.layout;
  const existing = current.placements.find((placement) => placement.blockId === blockId);
  if (existing === undefined) {
    return fail([
      createDiagnostic(DIAGNOSTIC_CODES.INVALID_REFERENCE, `layout/${breakpoint}/placements`, {
        relatedIds: [blockId],
      }),
    ]);
  }
  const desired = new Map<string, LayoutPlacement>();
  desired.set(blockId, { ...existing, ...change });
  const layout: BoardLayout = {
    ...document.layout,
    [breakpoint]: resolveBreakpoint(current, desired, blockId),
  };
  return ok(layout);
}

export function editorMoveBlock(
  document: BoardDocumentV1,
  blockId: string,
  change: EditorMoveBlockChange,
): Result<BoardDocumentV1> {
  const found = findBlock(document, blockId);
  if (!found.ok) {
    return found;
  }
  const selected = breakpointFor(document, change.breakpoint);
  if (!selected.ok) {
    return selected;
  }
  const dx = change.dx ?? 0;
  const dy = change.dy ?? 0;
  if (!Number.isInteger(dx) || !Number.isInteger(dy)) {
    return operationFailure("dx", "Block movement must use integer grid steps.");
  }
  const existing = selected.value.layout.placements.find(
    (placement) => placement.blockId === blockId,
  );
  if (existing === undefined) {
    return fail([
      createDiagnostic(
        DIAGNOSTIC_CODES.INVALID_REFERENCE,
        `layout/${selected.value.name}/placements`,
        { relatedIds: [blockId] },
      ),
    ]);
  }
  const layout = changedBreakpointLayout(document, selected.value.name, blockId, {
    x: Math.max(0, Math.min(existing.x + dx, selected.value.layout.columns - existing.width)),
    y: Math.max(0, existing.y + dy),
  });
  if (!layout.ok) {
    return layout;
  }
  return ok({ ...document, layout: layout.value });
}

export function editorResizeBlock(
  document: BoardDocumentV1,
  blockId: string,
  change: EditorResizeBlockChange,
): Result<BoardDocumentV1> {
  const found = findBlock(document, blockId);
  if (!found.ok) {
    return found;
  }
  const selected = breakpointFor(document, change.breakpoint);
  if (!selected.ok) {
    return selected;
  }
  const dw = change.dw ?? 0;
  const dh = change.dh ?? 0;
  if (!Number.isInteger(dw) || !Number.isInteger(dh)) {
    return operationFailure("dw", "Block resizing must use integer grid steps.");
  }
  const existing = selected.value.layout.placements.find(
    (placement) => placement.blockId === blockId,
  );
  if (existing === undefined) {
    return fail([
      createDiagnostic(
        DIAGNOSTIC_CODES.INVALID_REFERENCE,
        `layout/${selected.value.name}/placements`,
        { relatedIds: [blockId] },
      ),
    ]);
  }
  const minWidth = existing.minWidth ?? 1;
  const minHeight = existing.minHeight ?? 1;
  const width = Math.max(
    minWidth,
    Math.min(existing.width + dw, selected.value.layout.columns - existing.x),
  );
  const height = Math.max(minHeight, existing.height + dh);
  const layout = changedBreakpointLayout(document, selected.value.name, blockId, {
    width,
    height,
  });
  if (!layout.ok) {
    return layout;
  }
  return ok({ ...document, layout: layout.value });
}

function reorderBreakpoint(
  layout: BreakpointLayout,
  blockId: string,
  neighborId: string | undefined,
): BreakpointLayout {
  const left = layout.placements.find((placement) => placement.blockId === blockId);
  const neighbor = layout.placements.find((placement) => placement.blockId === neighborId);
  if (left === undefined || neighbor === undefined) {
    return layout;
  }
  const desired = new Map<string, LayoutPlacement>([
    [left.blockId, { ...left, y: neighbor.y }],
    [neighbor.blockId, { ...neighbor, y: left.y }],
  ]);
  return resolveBreakpoint(layout, desired, left.blockId);
}

export function editorReorderBlock(
  document: BoardDocumentV1,
  blockId: string,
  direction: EditorReorderDirection,
): Result<BoardDocumentV1> {
  if (direction !== "earlier" && direction !== "later") {
    return operationFailure("direction", "A reorder direction must be earlier or later.");
  }
  const found = findBlock(document, blockId);
  if (!found.ok) {
    return found;
  }
  const targetIndex = direction === "earlier" ? found.value.index - 1 : found.value.index + 1;
  if (targetIndex < 0 || targetIndex >= document.blocks.length) {
    return ok(document);
  }
  const blocks = [...document.blocks];
  const target = blocks[targetIndex];
  blocks[targetIndex] = blocks[found.value.index] as BlockDefinition;
  blocks[found.value.index] = target as BlockDefinition;
  const desktop = reorderBreakpoint(document.layout.desktop, blockId, target?.id);
  const tablet =
    document.layout.tablet === undefined
      ? undefined
      : reorderBreakpoint(document.layout.tablet, blockId, target?.id);
  const narrow =
    document.layout.narrow === undefined
      ? undefined
      : reorderBreakpoint(document.layout.narrow, blockId, target?.id);
  const layout: BoardLayout = {
    desktop,
    ...(tablet === undefined ? {} : { tablet }),
    ...(narrow === undefined ? {} : { narrow }),
  };
  return ok({ ...document, blocks, layout });
}

export function editorUpdateBlock(
  document: BoardDocumentV1,
  blockId: string,
  patch: EditorBlockPatch,
): Result<BoardDocumentV1> {
  if (patch.title !== undefined && typeof patch.title !== "string") {
    return operationFailure("title", "A block title must be a string.");
  }
  if (patch.text !== undefined && typeof patch.text !== "string") {
    return operationFailure("text", "Text block content must be a string.");
  }
  if (patch.config !== undefined && !isPlainObject(patch.config)) {
    return operationFailure("config", "Block configuration must be a plain object.");
  }
  const found = findBlock(document, blockId);
  if (!found.ok) {
    return found;
  }
  if (patch.text !== undefined && found.value.block.type !== "text") {
    return operationFailure("text", "Only text blocks accept plain text content.");
  }
  const block = { ...found.value.block };
  if (patch.title !== undefined) {
    const title = patch.title.trim();
    if (title === "") {
      delete block.title;
    } else {
      block.title = title;
    }
  }
  if (patch.config !== undefined) {
    block.config = patch.config;
  }
  if (patch.text !== undefined) {
    block.config = { ...block.config, text: patch.text };
  }
  return ok({
    ...document,
    blocks: document.blocks.map((entry) => (entry.id === blockId ? block : entry)),
  });
}

export function editorResetBlock(
  document: BoardDocumentV1,
  blockId: string,
  context: EditorOperationContext,
): Result<BoardDocumentV1> {
  const found = findBlock(document, blockId);
  if (!found.ok) {
    return found;
  }
  if (found.value.block.type === "filter") {
    const oldFilterIds = blockFilterIds(found.value.block);
    const referencedElsewhere = new Set(
      document.blocks
        .filter((block) => block.id !== blockId && block.type === "filter")
        .flatMap(blockFilterIds),
    );
    const removableFilterIds = new Set(
      oldFilterIds.filter((filterId) => !referencedElsewhere.has(filterId)),
    );
    const createdFilter = defaultFilterDefinition(document, context.idFactory);
    if (!createdFilter.ok) {
      return createdFilter;
    }
    const block: BlockDefinition = {
      ...found.value.block,
      config: { ...found.value.block.config, filterIds: [createdFilter.value.filter.id] },
    };
    return ok({
      ...document,
      blocks: document.blocks.map((entry) => (entry.id === blockId ? block : entry)),
      filters: [
        ...document.filters.filter((filter) => !removableFilterIds.has(filter.id)),
        createdFilter.value.filter,
      ],
    });
  }
  const created = editorDefaultBlock(document, found.value.block.type, context);
  if (!created.ok) {
    return created;
  }
  const block: BlockDefinition = {
    ...created.value.block,
    id: found.value.block.id,
    ...(found.value.block.title === undefined ? {} : { title: found.value.block.title }),
    ...(found.value.block.groupId === undefined ? {} : { groupId: found.value.block.groupId }),
  };
  const filters =
    created.value.filter === undefined
      ? document.filters
      : [...document.filters, created.value.filter];
  return ok({
    ...document,
    blocks: document.blocks.map((entry) => (entry.id === blockId ? block : entry)),
    filters,
  });
}

export function editorSetTheme(
  document: BoardDocumentV1,
  theme: EditorThemeInput,
): Result<BoardDocumentV1> {
  if (!isPlainObject(theme) || !(THEME_MODES as readonly string[]).includes(String(theme.mode))) {
    return operationFailure("theme/mode", "A theme mode must be light, dark or system.");
  }
  if (theme.tokens !== undefined && !isPlainObject(theme.tokens)) {
    return operationFailure("theme/tokens", "Theme tokens must be a plain object.");
  }
  if (theme.removeTokens !== undefined && !Array.isArray(theme.removeTokens)) {
    return operationFailure("theme/removeTokens", "Theme token removals must be an array.");
  }
  const tokens = Object.create(null) as Record<string, string>;
  for (const name of Object.getOwnPropertyNames(document.theme.tokens ?? {})) {
    const value = document.theme.tokens?.[name];
    if (typeof value === "string") {
      tokens[name] = value;
    }
  }
  if (theme.tokens !== undefined) {
    for (const name of Object.getOwnPropertyNames(theme.tokens)) {
      const value = theme.tokens[name];
      if (!isAllowedThemeTokenName(name)) {
        return fail([
          createDiagnostic(DIAGNOSTIC_CODES.INVALID_THEME_TOKEN, `theme/tokens/${name}`, {
            message:
              "A theme token name must be a known framework token, an explicit bl-/--bl- token or a single-segment ext. extension token.",
          }),
        ]);
      }
      if (typeof value !== "string") {
        return fail([
          createDiagnostic(DIAGNOSTIC_CODES.INVALID_THEME_TOKEN, `theme/tokens/${name}`, {
            message: "A theme token value must be a string.",
          }),
        ]);
      }
      const valueReason = validateThemeTokenValue(name, value);
      if (valueReason !== null) {
        return fail([
          createDiagnostic(DIAGNOSTIC_CODES.INVALID_THEME_TOKEN, `theme/tokens/${name}`, {
            message: valueReason,
          }),
        ]);
      }
      tokens[name] = value;
    }
  }
  for (const name of theme.removeTokens ?? []) {
    if (typeof name !== "string" || !isAllowedThemeTokenName(name)) {
      return fail([
        createDiagnostic(
          DIAGNOSTIC_CODES.INVALID_THEME_TOKEN,
          `theme/removeTokens/${String(name)}`,
          {
            message: "A removed theme token name is invalid.",
          },
        ),
      ]);
    }
    delete tokens[name];
  }
  const nextTheme: BoardTheme = {
    mode: theme.mode as ThemeMode,
    ...(Object.keys(tokens).length === 0 ? {} : { tokens }),
  };
  return ok({ ...document, theme: nextTheme });
}

export function editorBlockConsumesData(type: string): boolean {
  return QUERY_BLOCK_TYPES.has(type);
}
