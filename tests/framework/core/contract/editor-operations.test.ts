import { describe, expect, it } from "vitest";
import {
  DIAGNOSTIC_CODES,
  createRuntime,
  parseBoardDocument,
  validateBoardDocument,
  type BoardDocumentV1,
  type BoardSpace,
  type BoardValidationCatalog,
  type SpaceEvent,
} from "../../../../packages/core/src/index.js";
import { expectFailure, unwrap } from "../support/assertions.js";
import {
  FakeClock,
  createDeterministicIdFactory,
  createRecordingLogger,
} from "../support/fakes.js";

function editorDocument(): BoardDocumentV1 {
  return {
    schemaVersion: 1,
    id: "editor-contract",
    title: "Editor contract",
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    theme: { mode: "light" },
    datasets: [
      {
        id: "results",
        provider: "synthetic",
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
        title: "Scores",
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

function asDoc(value: unknown): BoardDocumentV1 {
  return value as BoardDocumentV1;
}

function harness(): {
  readonly space: BoardSpace;
  readonly clock: FakeClock;
  readonly lease: ReturnType<BoardSpace["getSnapshot"]>["editorLease"];
} {
  const clock = new FakeClock();
  const runtime = createRuntime({
    clock,
    logger: createRecordingLogger(),
    idFactory: createDeterministicIdFactory("editor-contract"),
  });
  const space = unwrap(runtime.createSpace({ id: "editor-space", document: editorDocument() }));
  const lease = unwrap(space.acquireEditorLease({ sessionId: "author" }));
  return { space, clock, lease };
}

describe("editor draft operations contract", () => {
  it("runs block CRUD, layout changes and theme edits through a lease", () => {
    const { space, lease } = harness();
    if (lease === null) {
      throw new Error("lease missing");
    }
    const view = unwrap(space.createView({ mode: "editor", lease }));
    const added = unwrap(view.commands.addBlock("table", { title: "New table" }));
    expect(added.document.blocks).toHaveLength(4);
    const duplicated = unwrap(view.commands.duplicateBlock("chart"));
    expect(duplicated.document.blocks).toHaveLength(5);
    const moved = unwrap(view.commands.moveBlock("chart", { breakpoint: "desktop", dx: 4, dy: 0 }));
    expect(moved.document.blocks).toHaveLength(5);
    const resized = unwrap(
      view.commands.resizeBlock("chart", { breakpoint: "desktop", dw: -1, dh: 1 }),
    );
    expect(resized.document.blocks).toHaveLength(5);
    const reordered = unwrap(view.commands.reorderBlock("note", "earlier"));
    expect(asDoc(reordered.document).blocks.map((block) => block.id)[1]).toBe("note");
    const themed = unwrap(view.commands.setTheme({ mode: "dark", tokens: { accent: "#123456" } }));
    expect(asDoc(themed.document).theme).toEqual({ mode: "dark", tokens: { accent: "#123456" } });
    const applied = unwrap(view.commands.applyDraft());
    expect(asDoc(applied.committedDocument).theme.mode).toBe("dark");
    expect(validateBoardDocument(applied.committedDocument).valid).toBe(true);
  });

  it("rejects editor structure and layout commands from a viewer-bound view", () => {
    const { space, lease } = harness();
    if (lease === null) {
      throw new Error("lease missing");
    }
    const viewer = unwrap(space.createView({ mode: "viewer" }));
    expectFailure(viewer.commands.addBlock("text"), DIAGNOSTIC_CODES.VIEWER_READ_ONLY);
    expectFailure(viewer.commands.deleteBlock("note"), DIAGNOSTIC_CODES.VIEWER_READ_ONLY);
    expectFailure(
      viewer.commands.moveBlock("chart", { breakpoint: "desktop", dx: 1 }),
      DIAGNOSTIC_CODES.VIEWER_READ_ONLY,
    );
    expectFailure(viewer.commands.setTheme({ mode: "dark" }), DIAGNOSTIC_CODES.VIEWER_READ_ONLY);
    expectFailure(viewer.commands.applyDraft(), DIAGNOSTIC_CODES.VIEWER_READ_ONLY);
    expect(space.getSnapshot().draft?.document.blocks).toHaveLength(3);
  });

  it("keeps the draft unchanged when theme validation fails", () => {
    const { space, lease } = harness();
    if (lease === null) {
      throw new Error("lease missing");
    }
    const view = unwrap(space.createView({ mode: "editor", lease }));
    const before = view.getSnapshot().draft;
    expectFailure(
      view.commands.setTheme({ mode: "dark", tokens: { "bad token": "#fff" } }),
      DIAGNOSTIC_CODES.INVALID_THEME_TOKEN,
    );
    expect(view.getSnapshot().draft).toEqual(before);
  });

  it("ties fixed-block removal authorization to undone draft history", () => {
    const { space, lease } = harness();
    if (lease === null) {
      throw new Error("lease missing");
    }
    const view = unwrap(space.createView({ mode: "editor", lease }));
    unwrap(view.commands.deleteBlock("metric"));
    unwrap(view.commands.undo());
    const restored = JSON.parse(
      JSON.stringify(asDoc(view.getSnapshot().draft?.document)),
    ) as BoardDocumentV1;
    const withoutMetric = restored.blocks.filter((block) => block.id !== "metric");
    const ordinaryRemoval = {
      ...restored,
      blocks: withoutMetric,
      layout: Object.fromEntries(
        Object.entries(restored.layout).map(
          ([breakpoint, layoutValue]: [string, BoardDocumentV1["layout"]["desktop"]]) => [
            breakpoint,
            {
              ...layoutValue,
              placements: layoutValue.placements.filter(
                (placement) => placement.blockId !== "metric",
              ),
            },
          ],
        ),
      ) as unknown as BoardDocumentV1["layout"],
    };
    expectFailure(
      view.commands.updateDraft(ordinaryRemoval),
      DIAGNOSTIC_CODES.FIXED_BINDING_CHANGED,
    );
    unwrap(view.commands.redo());
    const applied = unwrap(view.commands.applyDraft());
    expect(asDoc(applied.committedDocument).blocks.map((block) => block.id)).toEqual([
      "chart",
      "note",
    ]);
  });

  it("edits text block content with undo, redo, apply and export", () => {
    const { space, lease } = harness();
    if (lease === null) {
      throw new Error("lease missing");
    }
    const view = unwrap(space.createView({ mode: "editor", lease }));
    unwrap(view.commands.updateBlock("note", { text: "Revised text" }));
    expect(
      asDoc(view.getSnapshot().draft?.document).blocks.find((block) => block.id === "note")?.title,
    ).toBe("Note");
    const undone = unwrap(view.commands.undo());
    expect(asDoc(undone.document).blocks.find((block) => block.id === "note")?.config.text).toBe(
      "Synthetic.",
    );
    const redone = unwrap(view.commands.redo());
    expect(asDoc(redone.document).blocks.find((block) => block.id === "note")?.config.text).toBe(
      "Revised text",
    );
    const applied = unwrap(view.commands.applyDraft());
    expect(
      asDoc(applied.committedDocument).blocks.find((block) => block.id === "note")?.config.text,
    ).toBe("Revised text");
    const exported = unwrap(space.exportDocument());
    const parsed = JSON.parse(exported.canonical) as BoardDocumentV1;
    expect(parsed.blocks.find((block) => block.id === "note")?.config.text).toBe("Revised text");
  });

  it("preserves unrelated theme tokens through a mode-only edit", () => {
    const { space, lease } = harness();
    if (lease === null) {
      throw new Error("lease missing");
    }
    const view = unwrap(space.createView({ mode: "editor", lease }));
    unwrap(
      view.commands.updateDraft({
        ...asDoc(view.getSnapshot().draft?.document),
        theme: {
          mode: "light",
          tokens: { accent: "#111111", success: "#00aa00", "ext.brand-extra": "#123123" },
        },
      }),
    );
    unwrap(view.commands.setTheme({ mode: "dark" }));
    const draftTheme = asDoc(view.getSnapshot().draft?.document).theme;
    expect(draftTheme).toEqual({
      mode: "dark",
      tokens: { accent: "#111111", success: "#00aa00", "ext.brand-extra": "#123123" },
    });
    unwrap(view.commands.applyDraft());
    const exported = unwrap(space.exportDocument());
    const parsed = JSON.parse(exported.canonical) as BoardDocumentV1;
    expect(parsed.theme).toEqual(draftTheme);
  });

  it("deletes a fixed-binding block through an explicit editor removal", () => {
    const { space, lease } = harness();
    if (lease === null) {
      throw new Error("lease missing");
    }
    const view = unwrap(space.createView({ mode: "editor", lease }));
    expectFailure(view.commands.resetBlock("metric"), DIAGNOSTIC_CODES.FIXED_BINDING_CHANGED);
    const removed = unwrap(view.commands.deleteBlock("metric"));
    expect(asDoc(removed.document).blocks.map((block) => block.id)).toEqual(["chart", "note"]);
    const applied = unwrap(view.commands.applyDraft());
    expect(asDoc(applied.committedDocument).blocks.map((block) => block.id)).toEqual([
      "chart",
      "note",
    ]);
  });

  it("undoes and redoes editor operations within history bounds", () => {
    const { space, lease } = harness();
    if (lease === null) {
      throw new Error("lease missing");
    }
    const view = unwrap(space.createView({ mode: "editor", lease }));
    const first = unwrap(view.commands.addBlock("text"));
    expect(first.canUndo).toBe(true);
    expect(first.canRedo).toBe(false);
    const undone = unwrap(view.commands.undo());
    expect(undone.document.blocks).toHaveLength(3);
    expect(undone.canRedo).toBe(true);
    const redone = unwrap(view.commands.redo());
    expect(redone.document.blocks).toHaveLength(4);
    expect(redone.canUndo).toBe(true);
    expectFailure(view.commands.redo(), DIAGNOSTIC_CODES.DRAFT_HISTORY_EMPTY);
  });

  it("preserves a dirty draft across viewer mode switching and cancel restores committed state", () => {
    const { space, lease } = harness();
    if (lease === null) {
      throw new Error("lease missing");
    }
    const view = unwrap(space.createView({ mode: "editor", lease }));
    const changed = unwrap(view.commands.updateBlock("chart", { title: "Draft title" }));
    const revision = changed.revision;
    unwrap(view.setMode("viewer"));
    expect(asDoc(view.getSnapshot().draft?.document).blocks[1]?.title).toBe("Draft title");
    expect(asDoc(space.getSnapshot().committedDocument).blocks[1]?.title).toBe("Scores");
    unwrap(view.setMode("editor"));
    expect(view.getSnapshot().draft?.revision).toBe(revision);
    const cancelled = unwrap(view.commands.cancelDraft());
    expect(asDoc(cancelled.committedDocument).blocks[1]?.title).toBe("Scores");
    expect(view.getSnapshot().draft?.dirty).toBe(false);
  });

  it("rejects a second editor lease and preserves the draft on revision conflict", () => {
    const { space, lease } = harness();
    if (lease === null) {
      throw new Error("lease missing");
    }
    const events: SpaceEvent[] = [];
    space.subscribe((event) => events.push(event));
    expectFailure(
      space.acquireEditorLease({ sessionId: "second-editor" }),
      DIAGNOSTIC_CODES.EDITOR_LEASE_CONFLICT,
    );
    const view = unwrap(space.createView({ mode: "editor", lease }));
    const changed = unwrap(view.commands.updateBlock("chart", { title: "Draft survives" }));
    unwrap(space.loadDocument(editorDocument(), { source: "host" }));
    expectFailure(view.commands.applyDraft(), DIAGNOSTIC_CODES.REVISION_CONFLICT);
    const snapshot = space.getSnapshot();
    expect(asDoc(snapshot.draft?.document).blocks[1]?.title).toBe("Draft survives");
    expect(snapshot.draft?.revision).toBe(changed.revision);
    expect(
      events.some(
        (event) =>
          event.type === "draft:conflict" &&
          event.diagnostics[0]?.code === DIAGNOSTIC_CODES.REVISION_CONFLICT,
      ),
    ).toBe(true);
  });

  it("deletes a generated filter with its filter block and replaces it on reset", () => {
    const clock = new FakeClock();
    const runtime = createRuntime({
      clock,
      logger: createRecordingLogger(),
      idFactory: createDeterministicIdFactory("filter-block-editor"),
    });
    const document = { ...editorDocument(), filters: [] };
    const space = unwrap(runtime.createSpace({ id: "filter-block-space", document }));
    const lease = unwrap(space.acquireEditorLease({ sessionId: "filter-block" }));
    const view = unwrap(space.createView({ mode: "editor", lease }));
    const added = unwrap(view.commands.addBlock("filter"));
    const filterBlock = asDoc(added.document).blocks.at(-1);
    const firstFilterId = asDoc(added.document).filters[0]?.id;
    if (filterBlock === undefined || firstFilterId === undefined) {
      throw new Error("filter block missing");
    }
    const removed = unwrap(view.commands.deleteBlock(filterBlock.id));
    expect(asDoc(removed.document).filters).toEqual([]);
    const applied = unwrap(view.commands.applyDraft());
    expect(asDoc(applied.committedDocument).filters).toEqual([]);
    const readded = unwrap(view.commands.addBlock("filter"));
    const resetBlock = asDoc(readded.document).blocks.at(-1);
    const filterBeforeReset = asDoc(readded.document).filters[0]?.id;
    if (resetBlock === undefined || filterBeforeReset === undefined) {
      throw new Error("filter block missing after re-add");
    }
    const reset = unwrap(view.commands.resetBlock(resetBlock.id));
    const filtersAfterReset = asDoc(reset.document).filters;
    expect(filtersAfterReset).toHaveLength(1);
    expect(filtersAfterReset[0]?.id).not.toBe(filterBeforeReset);
    expect(
      asDoc(reset.document).blocks.find((block) => block.id === resetBlock.id)?.config.filterIds,
    ).toEqual([filtersAfterReset[0]?.id]);
    const finalApplied = unwrap(view.commands.applyDraft());
    const exported = unwrap(space.exportDocument());
    const parsed = JSON.parse(exported.canonical) as BoardDocumentV1;
    expect(parsed.filters).toHaveLength(1);
    expect(asDoc(finalApplied.committedDocument).filters).toHaveLength(1);
  });

  it("preserves a registered block title across config edit, undo, apply and export", () => {
    const base = editorDocument();
    const commentary = {
      id: "commentary",
      type: "plugin.commentary",
      title: "Commentary",
      bindings: [],
      config: { message: "Initial" },
    };
    const document: BoardDocumentV1 = {
      ...base,
      blocks: [...base.blocks, commentary],
      layout: {
        desktop: {
          ...base.layout.desktop,
          placements: [
            ...base.layout.desktop.placements,
            { blockId: "commentary", x: 0, y: 4, width: 12, height: 2 },
          ],
        },
        ...(base.layout.tablet === undefined
          ? {}
          : {
              tablet: {
                ...base.layout.tablet,
                placements: [
                  ...base.layout.tablet.placements,
                  { blockId: "commentary", x: 0, y: 8, width: 8, height: 2 },
                ],
              },
            }),
        ...(base.layout.narrow === undefined
          ? {}
          : {
              narrow: {
                ...base.layout.narrow,
                placements: [
                  ...base.layout.narrow.placements,
                  { blockId: "commentary", x: 0, y: 8, width: 4, height: 2 },
                ],
              },
            }),
      },
    };
    const catalog = {
      datasets: {
        results: {
          fields: { subject: { type: "string" }, score: { type: "number" } },
          slices: { "all-results": ["subject", "score"] },
        },
      },
      blockTypes: ["plugin.commentary"],
    } as unknown as BoardValidationCatalog;
    const clock = new FakeClock();
    const runtime = createRuntime({
      clock,
      logger: createRecordingLogger(),
      idFactory: createDeterministicIdFactory("registered-editor"),
      validationCatalog: catalog,
    });
    const space = unwrap(runtime.createSpace({ id: "registered-space", document }));
    const lease = unwrap(space.acquireEditorLease({ sessionId: "registered" }));
    const view = unwrap(space.createView({ mode: "editor", lease }));
    unwrap(view.commands.updateBlock("commentary", { config: { message: "Changed" } }));
    expect(
      asDoc(view.getSnapshot().draft?.document).blocks.find((block) => block.id === "commentary")
        ?.title,
    ).toBe("Commentary");
    unwrap(view.commands.undo());
    unwrap(view.commands.redo());
    const applied = unwrap(view.commands.applyDraft());
    const appliedBlock = asDoc(applied.committedDocument).blocks.find(
      (block) => block.id === "commentary",
    );
    expect(appliedBlock?.title).toBe("Commentary");
    expect(appliedBlock?.config).toEqual({ message: "Changed" });
    const exported = unwrap(space.exportDocument());
    const parsed = JSON.parse(exported.canonical) as BoardDocumentV1;
    const exportedBlock = parsed.blocks.find((block) => block.id === "commentary");
    expect(exportedBlock?.title).toBe("Commentary");
    expect(exportedBlock?.config).toEqual({ message: "Changed" });
  });

  it("requires an explicit decision to release a dirty draft", () => {
    const { space, lease } = harness();
    if (lease === null) {
      throw new Error("lease missing");
    }
    const view = unwrap(space.createView({ mode: "editor", lease }));
    unwrap(view.commands.updateBlock("chart", { title: "Dirty" }));
    expectFailure(space.releaseEditorLease(lease), DIAGNOSTIC_CODES.DRAFT_REQUIRES_DECISION);
    expect(space.getSnapshot().editorLease?.leaseId).toBe(lease.leaseId);
    expect(asDoc(space.getSnapshot().draft?.document).blocks[1]?.title).toBe("Dirty");
    unwrap(space.releaseEditorLease(lease, { decision: "cancel" }));
    expect(space.getSnapshot().draft).toBeNull();
    expect(asDoc(space.getSnapshot().committedDocument).blocks[1]?.title).toBe("Scores");
  });

  it("round-trips applied editor changes without semantic loss", () => {
    const { space, lease } = harness();
    if (lease === null) {
      throw new Error("lease missing");
    }
    const view = unwrap(space.createView({ mode: "editor", lease }));
    unwrap(view.commands.addBlock("text", { title: "Round trip" }));
    unwrap(view.commands.setTheme({ mode: "system", tokens: { accent: "#abcdef" } }));
    const applied = unwrap(view.commands.applyDraft());
    const exported = unwrap(space.exportDocument());
    const reparsed = unwrap(parseBoardDocument(exported.canonical));
    expect(reparsed.document).toEqual(applied.committedDocument);
  });
});
