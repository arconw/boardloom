import {
  activeValueFor,
  createEmptyFilterRuntimeState,
  type BoardDocumentV1,
  type FilterDefinition,
  type FilterRuntimeState,
  type FilterTarget,
  type JsonValue,
} from "@boardloom/core";
import type { ViewMessages } from "./messages.js";

export interface FilterSummaryEntry {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly originKey: string;
  readonly originText: string;
  readonly active: boolean;
  readonly editable: boolean;
  readonly targetKind: "board" | "group" | "block";
}

export interface CrossFilterSummaryEntry {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly originKey: string;
  readonly originText: string;
  readonly sourceBlockId: string;
}

export function filterValueText(value: JsonValue | undefined): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => filterValueText(entry))
      .filter(Boolean)
      .join(", ");
  }
  if (typeof value === "object") {
    return "";
  }
  return String(value);
}

function originForTarget(
  document: BoardDocumentV1,
  target: FilterTarget,
  messages: ViewMessages,
): { readonly key: string; readonly text: string } {
  if (target.kind === "board") {
    return {
      key: "viewer.filters.origin.board",
      text: messages.text("viewer.filters.origin.board"),
    };
  }
  if (target.kind === "group") {
    const group = document.filterGroups?.find((candidate) => candidate.id === target.groupId);
    return {
      key: "viewer.filters.origin.group",
      text: messages.text("viewer.filters.origin.group", {
        name: group?.label ?? target.groupId,
      }),
    };
  }
  const block = document.blocks.find((candidate) => candidate.id === target.blockId);
  return {
    key: "viewer.filters.origin.block",
    text: messages.text("viewer.filters.origin.block", {
      name: block?.title ?? target.blockId,
    }),
  };
}

export function filterDisplayValue(
  filter: FilterDefinition,
  state: FilterRuntimeState,
  messages: ViewMessages,
): string {
  if (
    filter.operator === "isNull" ||
    filter.operator === "isNotNull" ||
    filter.operator === "isTrue" ||
    filter.operator === "isFalse"
  ) {
    return messages.text(`filter.operator.${filter.operator}`);
  }
  const active = activeValueFor(state, filter.id);
  return filterValueText(active === undefined ? filter.defaultValue : active);
}

export function filterSummaryEntry(
  document: BoardDocumentV1,
  filter: FilterDefinition,
  messages: ViewMessages,
  state: FilterRuntimeState = createEmptyFilterRuntimeState(),
): FilterSummaryEntry {
  const origin = originForTarget(document, filter.target, messages);
  const active = activeValueFor(state, filter.id);
  return Object.freeze({
    id: filter.id,
    label: filter.label ?? filter.field.fieldId,
    value: filterDisplayValue(filter, state, messages),
    originKey: origin.key,
    originText: origin.text,
    active: active !== undefined,
    editable: filter.viewerEditable === true,
    targetKind: filter.target.kind,
  });
}

export function activeFilterSummaries(
  document: BoardDocumentV1,
  messages: ViewMessages,
  state: FilterRuntimeState = createEmptyFilterRuntimeState(),
): readonly FilterSummaryEntry[] {
  return Object.freeze(
    document.filters.map((filter) => filterSummaryEntry(document, filter, messages, state)),
  );
}

export function activeFilterChipSummaries(
  document: BoardDocumentV1,
  messages: ViewMessages,
  state: FilterRuntimeState = createEmptyFilterRuntimeState(),
): readonly FilterSummaryEntry[] {
  return activeFilterSummaries(document, messages, state);
}

export function crossFilterSummaries(
  document: BoardDocumentV1,
  messages: ViewMessages,
  state: FilterRuntimeState = createEmptyFilterRuntimeState(),
): readonly CrossFilterSummaryEntry[] {
  return Object.freeze(
    state.crossFilters.map((selection) => {
      const source = document.blocks.find((block) => block.id === selection.sourceBlockId);
      const dataset = document.datasets.find((entry) => entry.id === selection.field.datasetId);
      const field = dataset?.fields?.find((entry) => entry.id === selection.field.fieldId);
      return Object.freeze({
        id: selection.id,
        label: selection.label ?? field?.id ?? selection.field.fieldId,
        value: filterValueText(selection.value),
        originKey: "viewer.filters.origin.cross",
        originText: messages.text("viewer.filters.origin.cross", {
          name: source?.title ?? selection.sourceBlockId,
        }),
        sourceBlockId: selection.sourceBlockId,
      });
    }),
  );
}
