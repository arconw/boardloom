import { describe, expect, it } from "vitest";
import {
  editorAddBlock,
  editorDeleteBlock,
  editorDuplicateBlock,
  editorMoveBlock,
  editorReorderBlock,
  editorResizeBlock,
  editorResetBlock,
  editorSetTheme,
  editorUpdateBlock,
  validateBoardDocument,
  type BoardDocumentV1,
  type BoardValidationCatalog,
} from "../../../../packages/core/src/index.js";
import { expectFailure, unwrap } from "../support/assertions.js";
import { createDeterministicIdFactory } from "../support/fakes.js";

function operationDocument(): BoardDocumentV1 {
  return {
    schemaVersion: 1,
    id: "editor-operations",
    title: "Editor operations",
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    theme: { mode: "light" },
    datasets: [
      {
        id: "results",
        provider: "synthetic",
        label: "Results",
        fields: [
          { id: "subject", type: "string", role: "dimension" },
          { id: "score", type: "number", role: "measure" },
        ],
      },
    ],
    slices: [{ id: "all-results", datasetId: "results", fieldIds: ["subject", "score"] }],
    filterGroups: [],
    blocks: [
      {
        id: "metric",
        type: "metric",
        title: "Average score",
        bindings: [
          {
            id: "metric-score",
            role: "measure",
            axis: "y",
            mode: "fixed",
            field: { datasetId: "results", fieldId: "score" },
            sliceId: "all-results",
            aggregation: { type: "average" },
          },
        ],
        config: {},
      },
      {
        id: "chart",
        type: "chart",
        title: "By subject",
        bindings: [
          {
            id: "chart-subject",
            role: "dimension",
            axis: "x",
            field: { datasetId: "results", fieldId: "subject" },
            sliceId: "all-results",
          },
          {
            id: "chart-score",
            role: "measure",
            axis: "y",
            field: { datasetId: "results", fieldId: "score" },
            sliceId: "all-results",
            aggregation: { type: "average" },
          },
        ],
        config: { visualization: "bar" },
      },
      { id: "note", type: "text", title: "Note", bindings: [], config: { text: "Synthetic." } },
    ],
    filters: [
      {
        id: "subject-filter",
        label: "Subject",
        field: { datasetId: "results", fieldId: "subject" },
        operator: "isNotNull",
        viewerEditable: true,
        target: { kind: "board" },
      },
    ],
    comparisons: [],
    layout: {
      desktop: {
        columns: 12,
        placements: [
          { blockId: "metric", x: 0, y: 0, width: 4, height: 2 },
          { blockId: "chart", x: 4, y: 0, width: 4, height: 4 },
          { blockId: "note", x: 8, y: 0, width: 4, height: 2 },
        ],
      },
      tablet: {
        columns: 8,
        placements: [
          { blockId: "metric", x: 0, y: 0, width: 4, height: 2 },
          { blockId: "chart", x: 4, y: 0, width: 4, height: 4 },
          { blockId: "note", x: 0, y: 4, width: 4, height: 2 },
        ],
      },
      narrow: {
        columns: 4,
        placements: [
          { blockId: "metric", x: 0, y: 0, width: 4, height: 2 },
          { blockId: "chart", x: 0, y: 2, width: 4, height: 4 },
          { blockId: "note", x: 0, y: 6, width: 4, height: 2 },
        ],
      },
    },
  };
}

const context = { idFactory: createDeterministicIdFactory("editor") };

function valid(document: BoardDocumentV1): BoardDocumentV1 {
  const validation = validateBoardDocument(document);
  expect(validation.diagnostics.filter((entry) => entry.severity === "error")).toEqual([]);
  expect(validation.valid).toBe(true);
  return document;
}

describe("editor block operations", () => {
  it("adds every built-in block type and a registered extension type", () => {
    let document = operationDocument();
    for (const type of ["chart", "metric", "table", "text", "filter"]) {
      const added = unwrap(editorAddBlock(document, type, {}, context));
      document = valid(added);
    }
    const custom = unwrap(editorAddBlock(document, "plugin.commentary", {}, context));
    expect(custom.blocks.at(-1)?.type).toBe("plugin.commentary");
    expect(custom.blocks).toHaveLength(document.blocks.length + 1);
  });

  it("duplicates blocks with fresh block, binding and column identifiers", () => {
    const document = operationDocument();
    const duplicated = unwrap(editorDuplicateBlock(document, "chart", context));
    const source = document.blocks.find((block) => block.id === "chart");
    const copy = duplicated.blocks.at(-1);
    expect(copy?.id).not.toBe(source?.id);
    expect(copy?.bindings?.map((binding) => binding.id)).not.toEqual(
      source?.bindings?.map((binding) => binding.id),
    );
    expect(copy?.bindings?.map((binding) => binding.field)).toEqual(
      source?.bindings?.map((binding) => binding.field),
    );
    valid(duplicated);
  });

  it("duplicates a configured table with remapped column and sort references", () => {
    const added = unwrap(editorAddBlock(operationDocument(), "table", {}, context));
    const table = added.blocks.at(-1);
    if (table === undefined || table.bindings === undefined) {
      throw new Error("table missing");
    }
    const sorted = unwrap(
      editorUpdateBlock(added, table.id, {
        config: {
          ...table.config,
          sort: { bindingId: table.bindings[0]?.id ?? "", direction: "descending" },
        },
      }),
    );
    const duplicated = unwrap(editorDuplicateBlock(sorted, table.id, context));
    const copy = duplicated.blocks.at(-1);
    const copiedIds = new Set(copy?.bindings?.map((binding) => binding.id) ?? []);
    expect(copy?.id).not.toBe(table.id);
    expect(copy?.config.columns).toEqual(expect.arrayContaining([...copiedIds]));
    const sort = copy?.config.sort as { bindingId?: string } | undefined;
    expect(sort?.bindingId).toBeDefined();
    expect(copiedIds.has(String(sort?.bindingId))).toBe(true);
    valid(duplicated);
  });

  it("deletes blocks and layout placements while retaining valid layout", () => {
    const document = operationDocument();
    const deleted = unwrap(editorDeleteBlock(document, "metric"));
    expect(deleted.blocks.map((block) => block.id)).toEqual(["chart", "note"]);
    expect(deleted.layout.desktop.placements.map((entry) => entry.blockId)).toEqual([
      "chart",
      "note",
    ]);
    valid(deleted);
  });

  it("removes a block-targeted filter and an orphaned filter block", () => {
    const added = unwrap(editorAddBlock(operationDocument(), "filter", {}, context));
    const filterBlock = added.blocks.at(-1);
    const filterId = added.filters[0]?.id;
    if (filterBlock === undefined || filterId === undefined) {
      throw new Error("filter block missing");
    }
    const targeted = unwrap(
      editorUpdateBlock(added, filterBlock.id, {
        config: { filterIds: [filterId] },
      }),
    );
    const withTarget = {
      ...targeted,
      filters: targeted.filters.map((filter) =>
        filter.id === filterId
          ? { ...filter, target: { kind: "block" as const, blockId: "note" } }
          : filter,
      ),
    };
    const deleted = unwrap(editorDeleteBlock(withTarget, "note"));
    expect(deleted.blocks.map((block) => block.id)).toEqual(["metric", "chart"]);
    expect(deleted.filters.some((filter) => filter.id === filterId)).toBe(false);
    valid(deleted);
  });

  it("removes a board filter created for a deleted filter block and replaces it on reset", () => {
    const base = operationDocument();
    const withoutFilters: BoardDocumentV1 = { ...base, filters: [] };
    const added = unwrap(editorAddBlock(withoutFilters, "filter", {}, context));
    const filterBlock = added.blocks.at(-1);
    const originalFilterId = added.filters[0]?.id;
    if (filterBlock === undefined || originalFilterId === undefined) {
      throw new Error("filter block missing");
    }
    expect(added.filters).toHaveLength(1);
    expect(added.filters[0]?.target).toEqual({ kind: "board" });
    const deleted = unwrap(editorDeleteBlock(added, filterBlock.id));
    expect(deleted.filters).toEqual([]);
    valid(deleted);
    const reset = unwrap(editorResetBlock(added, filterBlock.id, context));
    expect(reset.filters).toHaveLength(1);
    expect(reset.filters[0]?.id).not.toBe(originalFilterId);
    const resetBlock = reset.blocks.find((block) => block.id === filterBlock.id);
    expect(resetBlock?.config.filterIds).toEqual([reset.filters[0]?.id]);
    valid(reset);
  });

  it("moves, resizes and reorders blocks without overlap", () => {
    const document = operationDocument();
    const moved = unwrap(
      editorMoveBlock(document, "chart", { breakpoint: "desktop", dx: 4, dy: 0 }),
    );
    valid(moved);
    const resized = unwrap(
      editorResizeBlock(moved, "chart", { breakpoint: "desktop", dw: -2, dh: 1 }),
    );
    valid(resized);
    const reordered = unwrap(editorReorderBlock(resized, "note", "earlier"));
    expect(reordered.blocks.map((block) => block.id)).toEqual(["metric", "note", "chart"]);
    valid(reordered);
  });

  it("updates block titles and resets non-fixed bindings to defaults", () => {
    const document = operationDocument();
    const renamed = unwrap(editorUpdateBlock(document, "chart", { title: "Updated" }));
    expect(renamed.blocks.find((block) => block.id === "chart")?.title).toBe("Updated");
    const cleared = unwrap(editorUpdateBlock(renamed, "chart", { title: " " }));
    expect(cleared.blocks.find((block) => block.id === "chart")?.title).toBeUndefined();
    const reset = unwrap(editorResetBlock(document, "chart", context));
    const restored = reset.blocks.find((block) => block.id === "chart");
    expect(restored?.bindings?.length).toBe(2);
    expect(restored?.title).toBe("By subject");
  });

  it("materializes fallback layouts for missing tablet and narrow breakpoints", () => {
    const base = operationDocument();
    const desktopOnly: BoardDocumentV1 = {
      ...base,
      layout: { desktop: base.layout.desktop },
    };
    const moved = unwrap(
      editorMoveBlock(desktopOnly, "chart", { breakpoint: "narrow", dx: 0, dy: 1 }),
    );
    expect(moved.layout.narrow).toBeDefined();
    valid(moved);
    const resized = unwrap(
      editorResizeBlock(moved, "chart", { breakpoint: "tablet", dw: -1, dh: 1 }),
    );
    expect(resized.layout.tablet).toBeDefined();
    valid(resized);
  });

  it("preserves unrelated theme tokens through a mode-only edit and explicit removal", () => {
    const base = operationDocument();
    const withTokens: BoardDocumentV1 = {
      ...base,
      theme: {
        mode: "light",
        tokens: {
          accent: "#111111",
          surface: "#ffffff",
          success: "#00aa00",
          "ext.brand-extra": "#123456",
        },
      },
    };
    const modeOnly = unwrap(editorSetTheme(withTokens, { mode: "dark" }));
    expect(modeOnly.theme).toEqual(
      withTokens.theme && {
        ...withTokens.theme,
        mode: "dark",
      },
    );
    const removed = unwrap(
      editorSetTheme(withTokens, { mode: "light", removeTokens: ["success"] }),
    );
    expect(removed.theme.tokens).toEqual({
      accent: "#111111",
      surface: "#ffffff",
      "ext.brand-extra": "#123456",
    });
  });

  it("edits text content and registered block configuration", () => {
    const document = operationDocument();
    const text = unwrap(editorUpdateBlock(document, "note", { text: "Updated note" }));
    const note = text.blocks.find((block) => block.id === "note");
    expect(note?.config.text).toBe("Updated note");
    expect(note?.title).toBe("Note");
    valid(text);
    const custom = unwrap(
      editorAddBlock(document, "plugin.commentary", { title: "Commentary" }, context),
    );
    const customId = custom.blocks.at(-1)?.id ?? "";
    const configured = unwrap(
      editorUpdateBlock(custom, customId, { config: { message: "Registered block" } }),
    );
    expect(configured.blocks.at(-1)?.config).toEqual({ message: "Registered block" });
    expect(configured.blocks.at(-1)?.title).toBe("Commentary");
    const catalog = {
      datasets: {
        results: {
          fields: { subject: { type: "string" }, score: { type: "number" } },
          slices: { "all-results": ["subject", "score"] },
        },
      },
      blockTypes: ["plugin.commentary"],
    } as unknown as BoardValidationCatalog;
    const validation = validateBoardDocument(configured, { catalog });
    expect(validation.diagnostics.filter((entry) => entry.severity === "error")).toEqual([]);
    expect(validation.valid).toBe(true);
    expectFailure(editorUpdateBlock(document, "chart", { text: "not text" }), "INVALID_ARGUMENT");
  });

  it("rejects unknown token names and unsafe values while allowing extension tokens", () => {
    const document = operationDocument();
    expectFailure(
      editorSetTheme(document, { mode: "light", tokens: { "brand.extra": "#ffffff" } }),
      "INVALID_THEME_TOKEN",
    );
    expectFailure(
      editorSetTheme(document, {
        mode: "light",
        tokens: { accent: "url(https://example.test/x)" },
      }),
      "INVALID_THEME_TOKEN",
    );
    expectFailure(
      editorSetTheme(document, { mode: "light", tokens: { accent: "not a color" } }),
      "INVALID_THEME_TOKEN",
    );
    expectFailure(
      editorSetTheme(document, { mode: "light", tokens: { "--foo": "#ffffff" } }),
      "INVALID_THEME_TOKEN",
    );
    expectFailure(
      editorSetTheme(document, { mode: "light", tokens: { "ext.a.b": "#ffffff" } }),
      "INVALID_THEME_TOKEN",
    );
    const protoTokens = JSON.parse('{"__proto__":"#ffffff"}') as Record<string, string>;
    expectFailure(
      editorSetTheme(document, { mode: "light", tokens: protoTokens }),
      "INVALID_THEME_TOKEN",
    );
    const unknownDocument: BoardDocumentV1 = {
      ...document,
      theme: { mode: "light", tokens: { "brand.extra": "#ffffff" } },
    };
    expect(
      validateBoardDocument(unknownDocument).diagnostics.some(
        (entry) => entry.code === "INVALID_THEME_TOKEN",
      ),
    ).toBe(true);
    const unsafeDocument: BoardDocumentV1 = {
      ...document,
      theme: { mode: "light", tokens: { accent: "url(https://example.test/x)" } },
    };
    expect(
      validateBoardDocument(unsafeDocument).diagnostics.some(
        (entry) => entry.code === "INVALID_THEME_TOKEN",
      ),
    ).toBe(true);
    const extension = unwrap(
      editorSetTheme(document, {
        mode: "light",
        tokens: { "ext.brand-color": "#123456", "font-sans": "system-ui, sans-serif" },
      }),
    );
    expect(extension.theme.tokens).toMatchObject({
      "ext.brand-color": "#123456",
      "font-sans": "system-ui, sans-serif",
    });
    valid(extension);
  });

  it("validates theme modes and token names before changing the document", () => {
    const document = operationDocument();
    const themed = unwrap(
      editorSetTheme(document, {
        mode: "dark",
        tokens: { accent: "#3366cc", "canvas-deep": "#111111" },
      }),
    );
    expect(themed.theme).toEqual({
      mode: "dark",
      tokens: { accent: "#3366cc", "canvas-deep": "#111111" },
    });
    expectFailure(editorSetTheme(document, { mode: "sepia" as never }), "INVALID_ARGUMENT");
    expectFailure(
      editorSetTheme(document, { mode: "light", tokens: { "bad token": "#fff" } }),
      "INVALID_THEME_TOKEN",
    );
    expectFailure(
      editorSetTheme(document, { mode: "light", tokens: { accent: " " } }),
      "INVALID_THEME_TOKEN",
    );
  });
});
