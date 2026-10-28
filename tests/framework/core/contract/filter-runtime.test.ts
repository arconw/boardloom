import { describe, expect, it } from "vitest";
import {
  DIAGNOSTIC_CODES,
  createBoardValidationCatalog,
  createEmptyBoardDocument,
  createRuntime,
  validateBoardDocument,
  type BoardDocumentV1,
  type BoardValidationCatalog,
  type DatasetDescriptor,
  type SpaceEvent,
} from "../../../../packages/core/src/index.js";
import { expectFailure, unwrap } from "../support/assertions.js";
import { FakeClock, createDeterministicIdFactory } from "../support/fakes.js";

function documentValue(): BoardDocumentV1 {
  const empty = createEmptyBoardDocument({
    id: "filter-runtime-board",
    title: "Filter runtime",
    createdAt: 1_700_000_000_000,
  });
  return {
    ...empty,
    datasets: [
      {
        id: "ds",
        label: "Synthetic",
        fields: [
          { id: "school", type: "string", role: "dimension" },
          { id: "score", type: "number", role: "measure", unit: "points" },
        ],
      },
    ],
    blocks: [
      {
        id: "chart",
        type: "chart",
        title: "Scores",
        bindings: [
          {
            id: "chart-x",
            role: "dimension",
            axis: "x",
            field: { datasetId: "ds", fieldId: "school" },
          },
          {
            id: "chart-y",
            role: "measure",
            axis: "y",
            field: { datasetId: "ds", fieldId: "score" },
            aggregation: { type: "average" },
          },
        ],
        config: { visualization: "bar" },
      },
      {
        id: "table",
        type: "table",
        title: "Rows",
        bindings: [
          {
            id: "table-school",
            role: "dimension",
            field: { datasetId: "ds", fieldId: "school" },
          },
          {
            id: "table-score",
            role: "measure",
            field: { datasetId: "ds", fieldId: "score" },
            aggregation: { type: "sum" },
          },
        ],
        config: { columns: ["table-school", "table-score"] },
      },
      {
        id: "filter-block",
        type: "filter",
        title: "Filters",
        config: { filterIds: ["filter-school", "filter-locked"] },
      },
    ],
    filters: [
      {
        id: "filter-school",
        label: "School",
        field: { datasetId: "ds", fieldId: "school" },
        operator: "in",
        defaultValue: ["north", "south"],
        viewerEditable: true,
        target: { kind: "board" },
      },
      {
        id: "filter-locked",
        label: "Locked",
        field: { datasetId: "ds", fieldId: "score" },
        operator: "greaterThan",
        defaultValue: 0,
        viewerEditable: false,
        target: { kind: "board" },
      },
    ],
    layout: {
      desktop: {
        columns: 12,
        rowHeight: 8,
        placements: [
          { blockId: "chart", x: 0, y: 0, width: 6, height: 4 },
          { blockId: "table", x: 6, y: 0, width: 6, height: 4 },
          { blockId: "filter-block", x: 0, y: 4, width: 12, height: 2 },
        ],
      },
      tablet: {
        columns: 8,
        rowHeight: 8,
        placements: [
          { blockId: "chart", x: 0, y: 0, width: 8, height: 4 },
          { blockId: "table", x: 0, y: 4, width: 8, height: 4 },
          { blockId: "filter-block", x: 0, y: 8, width: 8, height: 2 },
        ],
      },
      narrow: {
        columns: 4,
        rowHeight: 8,
        placements: [
          { blockId: "chart", x: 0, y: 0, width: 4, height: 4 },
          { blockId: "table", x: 0, y: 4, width: 4, height: 4 },
          { blockId: "filter-block", x: 0, y: 8, width: 4, height: 2 },
        ],
      },
    },
  };
}

function runtimeInstance() {
  return createRuntime({
    clock: new FakeClock(),
    idFactory: createDeterministicIdFactory("filter"),
  });
}

describe("T09 space-owned filter runtime", () => {
  it("changes viewer-editable active values, emits one change event and keeps snapshots serializable", () => {
    const runtime = runtimeInstance();
    const space = unwrap(runtime.createSpace({ document: documentValue() }));
    const events: SpaceEvent[] = [];
    const unsubscribe = space.subscribe((event) => {
      if (event.type === "filter:changed") {
        events.push(event);
      }
    });
    expect(space.getFilterState()).toEqual({ activeValues: [], crossFilters: [] });
    const updated = unwrap(space.setFilterValue("filter-school", ["north"]));
    expect(updated.activeValues).toEqual([{ filterId: "filter-school", value: ["north"] }]);
    expect(space.getSnapshot().filterState).toEqual(updated);
    expect(events).toHaveLength(1);
    const changed = events[0];
    expect(changed?.type).toBe("filter:changed");
    if (changed?.type === "filter:changed") {
      expect(changed.filterId).toBe("filter-school");
      expect(changed.scope).toEqual({ kind: "board" });
      expect(changed.value).toEqual(["north"]);
      expect(changed.active).toBe(true);
    }
    unwrap(space.setFilterValue("filter-school", ["north"]));
    expect(events).toHaveLength(1);
    unwrap(space.setFilterValue("filter-school", ["south"]));
    expect(events).toHaveLength(2);
    const serialized = JSON.parse(JSON.stringify(space.getFilterState())) as unknown;
    const restored = unwrap(space.setFilterRuntimeState(serialized));
    expect(restored.activeValues).toEqual([{ filterId: "filter-school", value: ["south"] }]);
    unsubscribe();
    unwrap(space.dispose());
    unwrap(runtime.dispose());
  });

  it("rejects locked edits and invalid values atomically while retaining the prior state", () => {
    const runtime = runtimeInstance();
    const space = unwrap(runtime.createSpace({ document: documentValue() }));
    unwrap(space.setFilterValue("filter-school", ["north"]));
    const before = space.getFilterState();
    expectFailure(space.setFilterValue("filter-locked", 10), DIAGNOSTIC_CODES.VIEWER_READ_ONLY);
    expectFailure(
      space.setFilterValue("filter-school", 10 as never),
      DIAGNOSTIC_CODES.FILTER_STATE_INVALID,
    );
    expectFailure(
      space.setFilterValue("filter-locked", [5] as never, { allowLocked: true }),
      DIAGNOSTIC_CODES.FILTER_STATE_INVALID,
    );
    expect(space.getFilterState()).toEqual(before);
    unwrap(space.dispose());
    unwrap(runtime.dispose());
  });

  it("resets one filter, a scope and all viewer-editable filters", () => {
    const runtime = runtimeInstance();
    const space = unwrap(runtime.createSpace({ document: documentValue() }));
    unwrap(space.setFilterValue("filter-school", ["north"]));
    unwrap(space.setFilterValue("filter-locked", 5, { allowLocked: true }));
    expect(space.getFilterState().activeValues).toHaveLength(2);
    unwrap(space.resetFilter("filter-school"));
    expect(space.getFilterState().activeValues).toEqual([{ filterId: "filter-locked", value: 5 }]);
    unwrap(space.resetFilterScope("board"));
    expect(space.getFilterState().activeValues).toHaveLength(1);
    unwrap(space.resetAllFilters({ allowLocked: true }));
    expect(space.getFilterState().activeValues).toHaveLength(0);
    unwrap(space.dispose());
    unwrap(runtime.dispose());
  });

  it("toggles cross-filters without echo duplicates and rejects unmapped selection fields", () => {
    const runtime = runtimeInstance();
    const space = unwrap(runtime.createSpace({ document: documentValue() }));
    const events: SpaceEvent[] = [];
    space.subscribe((event) => {
      if (event.type === "crossfilter:changed") {
        events.push(event);
      }
    });
    const selection = {
      sourceBlockId: "chart",
      field: { datasetId: "ds", fieldId: "school" },
      operator: "equals" as const,
      value: "north",
    };
    unwrap(space.setCrossFilter(selection, { toggle: true }));
    expect(space.getFilterState().crossFilters).toHaveLength(1);
    expect(events).toHaveLength(1);
    const crossEvent = events[0];
    expect(crossEvent?.type).toBe("crossfilter:changed");
    if (crossEvent?.type === "crossfilter:changed") {
      expect(crossEvent.sourceBlockId).toBe("chart");
      expect(crossEvent.targetIds).toEqual(["table"]);
      expect(crossEvent.cleared).toBe(false);
    }
    unwrap(space.setCrossFilter(selection, { toggle: true }));
    expect(space.getFilterState().crossFilters).toHaveLength(0);
    expect(events).toHaveLength(2);
    const clearedEvent = events[1];
    if (clearedEvent?.type === "crossfilter:changed") {
      expect(clearedEvent.cleared).toBe(true);
      expect(clearedEvent.targetIds).toEqual(["table"]);
    }
    unwrap(space.setCrossFilter(selection, { toggle: true }));
    unwrap(space.setCrossFilter({ ...selection, value: "south" }, { toggle: true }));
    expect(space.getFilterState().crossFilters).toHaveLength(1);
    expect(space.getFilterState().crossFilters[0]?.value).toBe("south");
    expectFailure(
      space.setCrossFilter({
        sourceBlockId: "chart",
        field: { datasetId: "ds", fieldId: "missing" },
        operator: "equals",
        value: "north",
      }),
      DIAGNOSTIC_CODES.INVALID_REFERENCE,
    );
    unwrap(space.clearCrossFilters());
    expect(space.getFilterState().crossFilters).toHaveLength(0);
    unwrap(space.dispose());
    unwrap(runtime.dispose());
  });

  it("rejects malformed serialized state and incompatible cross-filter operators", () => {
    const runtime = runtimeInstance();
    const space = unwrap(runtime.createSpace({ document: documentValue() }));
    const before = space.getFilterState();
    expectFailure(
      space.setFilterRuntimeState({
        activeValues: [{ filterId: "filter-school", value: () => "north" }],
        crossFilters: [],
      }),
      DIAGNOSTIC_CODES.FILTER_STATE_INVALID,
    );
    expectFailure(
      space.setCrossFilter({
        sourceBlockId: "chart",
        field: { datasetId: "ds", fieldId: "school" },
        operator: "greaterThan",
        value: "north",
      }),
      DIAGNOSTIC_CODES.FILTER_STATE_INVALID,
    );
    expectFailure(
      space.setCrossFilter({
        sourceBlockId: "chart",
        field: { datasetId: "ds", fieldId: "school" },
        operator: "in",
        value: "north",
      }),
      DIAGNOSTIC_CODES.FILTER_STATE_INVALID,
    );
    expect(space.getFilterState()).toEqual(before);
    unwrap(space.dispose());
    unwrap(runtime.dispose());
  });

  it("isolates filter runtime state per space", () => {
    const runtime = runtimeInstance();
    const first = unwrap(runtime.createSpace({ document: documentValue() }));
    const second = unwrap(runtime.createSpace({ document: documentValue() }));
    unwrap(first.setFilterValue("filter-school", ["north"]));
    expect(first.getFilterState().activeValues).toHaveLength(1);
    expect(second.getFilterState().activeValues).toHaveLength(0);
    unwrap(
      first.setCrossFilter(
        {
          sourceBlockId: "chart",
          field: { datasetId: "ds", fieldId: "school" },
          operator: "equals",
          value: "north",
        },
        { toggle: true },
      ),
    );
    expect(second.getFilterState().crossFilters).toHaveLength(0);
    unwrap(first.dispose());
    unwrap(second.dispose());
    unwrap(runtime.dispose());
  });

  it("rejects a structural load that invalidates the active filter state", () => {
    const runtime = runtimeInstance();
    const space = unwrap(runtime.createSpace({ document: documentValue() }));
    unwrap(space.setFilterValue("filter-school", ["north"]));
    const beforeDocument = space.getSnapshot().committedDocument;
    const beforeState = space.getFilterState();
    const invalid = documentValue();
    (invalid as unknown as { filters: BoardDocumentV1["filters"] }).filters = invalid.filters.map(
      (filter) =>
        filter.id === "filter-school"
          ? {
              ...filter,
              field: { datasetId: "ds", fieldId: "score" },
              operator: "greaterThan",
              defaultValue: 1,
            }
          : filter,
    );
    expectFailure(space.loadDocument(invalid), DIAGNOSTIC_CODES.FILTER_STATE_INVALID);
    expect(space.getSnapshot().committedDocument).toEqual(beforeDocument);
    expect(space.getFilterState()).toEqual(beforeState);
    unwrap(space.dispose());
    unwrap(runtime.dispose());
  });

  it("prunes runtime state when a draft is cancelled", () => {
    const runtime = runtimeInstance();
    const space = unwrap(runtime.createSpace({ document: documentValue() }));
    const lease = unwrap(space.acquireEditorLease({ sessionId: "cancel-filter" }));
    const draft = JSON.parse(
      JSON.stringify(space.getSnapshot().committedDocument),
    ) as BoardDocumentV1;
    (draft.filters as unknown as unknown[]).push({
      id: "filter-draft",
      label: "Draft",
      field: { datasetId: "ds", fieldId: "score" },
      operator: "greaterThan",
      defaultValue: 1,
      viewerEditable: true,
      target: { kind: "board" },
    });
    (draft.layout.desktop.placements as unknown as unknown[]).push({
      blockId: "chart-draft",
      x: 0,
      y: 6,
      width: 12,
      height: 4,
    });
    (draft.layout.tablet?.placements as unknown as unknown[]).push({
      blockId: "chart-draft",
      x: 0,
      y: 10,
      width: 8,
      height: 4,
    });
    (draft.layout.narrow?.placements as unknown as unknown[]).push({
      blockId: "chart-draft",
      x: 0,
      y: 10,
      width: 4,
      height: 4,
    });
    (draft.blocks as unknown as unknown[]).push({
      id: "chart-draft",
      type: "chart",
      title: "Draft chart",
      bindings: [
        {
          id: "draft-x",
          role: "dimension",
          axis: "x",
          field: { datasetId: "ds", fieldId: "school" },
        },
        {
          id: "draft-y",
          role: "measure",
          axis: "y",
          field: { datasetId: "ds", fieldId: "score" },
          aggregation: { type: "average" },
        },
      ],
      config: { visualization: "bar" },
    });
    unwrap(space.updateDraft(lease, draft));
    unwrap(space.setFilterValue("filter-draft", 5));
    unwrap(
      space.setCrossFilter(
        {
          sourceBlockId: "chart-draft",
          field: { datasetId: "ds", fieldId: "school" },
          operator: "equals",
          value: "north",
        },
        { toggle: true },
      ),
    );
    expect(space.getFilterState().activeValues).toHaveLength(1);
    expect(space.getFilterState().crossFilters).toHaveLength(1);
    unwrap(space.cancelDraft(lease));
    expect(space.getFilterState().activeValues).toHaveLength(0);
    expect(space.getFilterState().crossFilters).toHaveLength(0);
    const committed = space.getSnapshot().committedDocument as unknown as BoardDocumentV1;
    expect(committed.filters.some((filter) => filter.id === "filter-draft")).toBe(false);
    unwrap(space.dispose());
    unwrap(runtime.dispose());
  });

  it("aligns definition and runtime timezone rules for temporal filters", () => {
    const buildDocument = (): BoardDocumentV1 => {
      const value = JSON.parse(JSON.stringify(documentValue())) as BoardDocumentV1;
      (value.datasets[0]!.fields as unknown as unknown[]).push({
        id: "submitted_at",
        type: "datetime",
        role: "dimension",
        timezone: "UTC",
      });
      (value.filters as unknown as unknown[]).push({
        id: "filter-window",
        label: "Window",
        field: { datasetId: "ds", fieldId: "submitted_at" },
        operator: "between",
        defaultValue: ["2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z"],
        viewerEditable: true,
        temporal: { timezone: "America/New_York", bounds: "inclusive" },
        target: { kind: "board" },
      });
      return value;
    };
    const descriptor: DatasetDescriptor = {
      id: "ds",
      label: "Synthetic",
      version: "1",
      timezone: "UTC",
      temporalRepresentation: "iso8601-offset",
      fields: [
        {
          id: "school",
          key: "school",
          label: "School",
          type: "string",
          role: "dimension",
          nullable: false,
        },
        {
          id: "score",
          key: "score",
          label: "Score",
          type: "number",
          role: "measure",
          nullable: true,
        },
        {
          id: "submitted_at",
          key: "submitted_at",
          label: "Submitted",
          type: "datetime",
          role: "temporal",
          nullable: false,
          timezone: "UTC",
        },
      ],
      slices: [],
      capabilities: {
        grouping: true,
        aggregations: ["average", "sum"],
        filterOperators: [
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
          "before",
          "after",
          "onOrBefore",
          "onOrAfter",
        ],
        timeWindow: false,
        timezoneConversion: true,
        local: true,
        pushdownFilters: true,
        serverPaging: false,
        realtime: false,
        comparison: false,
        maxResultSize: null,
      },
    };
    const withoutCapability = validateBoardDocument(buildDocument());
    expect(withoutCapability.valid).toBe(false);
    const converting = createBoardValidationCatalog([descriptor]);
    const withCapability = validateBoardDocument(buildDocument(), { catalog: converting });
    expect(withCapability.valid).toBe(true);
    const runtime = createRuntime({
      clock: new FakeClock(),
      idFactory: createDeterministicIdFactory("timezone"),
      validationCatalog: converting,
    });
    const space = unwrap(runtime.createSpace({ document: buildDocument() }));
    unwrap(space.setFilterValue("filter-window", ["2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z"]));
    unwrap(
      space.setFilterRuntimeState({
        activeValues: [
          {
            filterId: "filter-window",
            value: ["2026-02-01T00:00:00Z", "2026-02-02T00:00:00Z"],
          },
        ],
        crossFilters: [],
      }),
    );
    unwrap(space.dispose());
    unwrap(runtime.dispose());

    const strictDescriptor: DatasetDescriptor = {
      ...descriptor,
      capabilities: { ...descriptor.capabilities, timezoneConversion: false },
    };
    const strictCatalog = createBoardValidationCatalog([strictDescriptor]);
    const strictDocument = validateBoardDocument(buildDocument(), { catalog: strictCatalog });
    expect(strictDocument.valid).toBe(false);
    const strictRuntime = createRuntime({
      clock: new FakeClock(),
      idFactory: createDeterministicIdFactory("timezone-strict"),
      validationCatalog: strictCatalog,
    });
    expect(strictRuntime.createSpace({ document: buildDocument() }).ok).toBe(false);
    unwrap(strictRuntime.dispose());

    const omittedCatalog = (timezoneConversion: boolean): BoardValidationCatalog => ({
      datasets: {
        ds: {
          fields: {
            school: { type: "string", role: "dimension" },
            score: { type: "number", role: "measure" },
            submitted_at: { type: "datetime", role: "dimension" },
          },
          capabilities: { timezoneConversion },
        },
      },
    });
    const omittedFalse = validateBoardDocument(buildDocument(), {
      catalog: omittedCatalog(false),
    });
    expect(omittedFalse.valid).toBe(false);
    const omittedTrue = validateBoardDocument(buildDocument(), {
      catalog: omittedCatalog(true),
    });
    expect(omittedTrue.valid).toBe(true);
    const omittedRuntime = createRuntime({
      clock: new FakeClock(),
      idFactory: createDeterministicIdFactory("timezone-omitted"),
      validationCatalog: omittedCatalog(true),
    });
    const omittedSpace = unwrap(omittedRuntime.createSpace({ document: buildDocument() }));
    unwrap(
      omittedSpace.setFilterValue("filter-window", [
        "2026-01-01T00:00:00Z",
        "2026-01-02T00:00:00Z",
      ]),
    );
    unwrap(omittedSpace.dispose());
    unwrap(omittedRuntime.dispose());
    const omittedStrictRuntime = createRuntime({
      clock: new FakeClock(),
      idFactory: createDeterministicIdFactory("timezone-omitted-strict"),
      validationCatalog: omittedCatalog(false),
    });
    expect(omittedStrictRuntime.createSpace({ document: buildDocument() }).ok).toBe(false);
    unwrap(omittedStrictRuntime.dispose());
  });

  it("delivers cross-filter events immutably on both channels through disposal", () => {
    const runtime = runtimeInstance();
    const space = unwrap(runtime.createSpace({ document: documentValue() }));
    const runtimeEvents: SpaceEvent[] = [];
    const spaceEvents: SpaceEvent[] = [];
    runtime.subscribe((event) => runtimeEvents.push(event));
    space.subscribe((event) => {
      spaceEvents.push(event);
      if (event.type === "crossfilter:changed") {
        unwrap(space.dispose());
      }
    });
    unwrap(
      space.setCrossFilter(
        {
          sourceBlockId: "chart",
          field: { datasetId: "ds", fieldId: "school" },
          operator: "equals",
          value: "north",
        },
        { toggle: true },
      ),
    );
    const cross = spaceEvents.find((event) => event.type === "crossfilter:changed");
    expect(cross).toBeDefined();
    if (cross?.type === "crossfilter:changed") {
      expect(Object.isFrozen(cross.targetIds)).toBe(true);
      expect(cross.targetIds).toEqual(["table"]);
    }
    expect(runtimeEvents.some((event) => event.type === "crossfilter:changed")).toBe(true);
    expect(runtimeEvents.some((event) => event.type === "space:disposed")).toBe(true);
    expect(space.setFilterValue("filter-school", ["north"]).ok).toBe(false);
    unwrap(runtime.dispose());
  });
});
