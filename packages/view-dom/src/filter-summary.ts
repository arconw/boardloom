import type { BoardDocumentV1, FilterDefinition, FilterTarget, JsonValue } from "@boardloom/core";
import type { ViewMessages } from "./messages.js";

export interface FilterSummaryEntry {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly originKey: string;
  readonly originText: string;
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

export function filterSummaryEntry(
  document: BoardDocumentV1,
  filter: FilterDefinition,
  messages: ViewMessages,
): FilterSummaryEntry {
  const origin = originForTarget(document, filter.target, messages);
  return Object.freeze({
    id: filter.id,
    label: filter.label ?? filter.field.fieldId,
    value: filterValueText(filter.defaultValue),
    originKey: origin.key,
    originText: origin.text,
  });
}

export function activeFilterSummaries(
  document: BoardDocumentV1,
  messages: ViewMessages,
): readonly FilterSummaryEntry[] {
  return Object.freeze(
    document.filters.map((filter) => filterSummaryEntry(document, filter, messages)),
  );
}
