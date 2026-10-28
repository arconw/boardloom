import { describe, expect, it } from "vitest";
import {
  createBoardValidationCatalog,
  createRuntime,
  type BoardDocumentV1,
  type BoardValidationCatalog,
  type BindingDefinition,
  type DatasetDescriptor,
} from "../../../../packages/core/src/index.js";
import { expectFailure, unwrap } from "../support/assertions.js";
import {
  ASSESSMENT_DESCRIPTOR,
  cloneAssessmentDescriptor,
  createAssessmentProvider,
} from "../fixtures/assessment-fixture.js";
import {
  FakeClock,
  createDeterministicIdFactory,
  createRecordingLogger,
} from "../support/fakes.js";

function binding(
  id: string,
  role: BindingDefinition["role"],
  fieldId: string,
  extra: Partial<BindingDefinition> = {},
): BindingDefinition {
  return {
    id,
    role,
    field: { datasetId: "assessment-results", fieldId },
    sliceId: "all-results",
    ...extra,
  };
}

function bindingDocument(fixedMeasure = false): BoardDocumentV1 {
  return {
    schemaVersion: 1,
    id: "binding-api-board",
    title: "Binding API board",
    createdAt: 1,
    updatedAt: 2,
    theme: { mode: "light" },
    datasets: [
      {
        id: "assessment-results",
        provider: "assessment-fixture",
        fields: ASSESSMENT_DESCRIPTOR.fields.map((field) => ({
          id: field.id,
          type: field.type,
          role: field.role === "temporal" ? "dimension" : field.role,
          ...(field.unit === undefined ? {} : { unit: field.unit.unit }),
        })),
      },
    ],
    slices: [
      {
        id: "all-results",
        datasetId: "assessment-results",
        fieldIds: ASSESSMENT_DESCRIPTOR.fields.map((field) => field.id),
      },
    ],
    blocks: [
      {
        id: "chart",
        type: "chart",
        title: "Scores",
        bindings: [
          binding("chart-x", "dimension", "school_id", { axis: "x" }),
          binding("chart-y", "measure", "score", {
            axis: "y",
            ...(fixedMeasure ? { mode: "fixed" as const } : {}),
            aggregation: { type: "average" },
          }),
        ],
        config: { visualization: "bar" },
      },
      {
        id: "metric",
        type: "metric",
        title: "Average",
        bindings: [
          binding("metric-y", "measure", "score", {
            axis: "y",
            aggregation: { type: "average" },
          }),
        ],
        config: {},
      },
    ],
    filters: [],
    filterGroups: [],
    comparisons: [],
    layout: {
      desktop: {
        columns: 12,
        placements: [
          { blockId: "chart", x: 0, y: 0, width: 8, height: 4 },
          { blockId: "metric", x: 8, y: 0, width: 4, height: 4 },
        ],
      },
    },
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function catalogFor(descriptor: DatasetDescriptor = ASSESSMENT_DESCRIPTOR): BoardValidationCatalog {
  return createBoardValidationCatalog([descriptor]);
}

function fieldsOnlyCatalog(descriptor: DatasetDescriptor): BoardValidationCatalog {
  const full = createBoardValidationCatalog([descriptor]);
  const datasets: Record<string, unknown> = {};
  for (const [datasetId, entry] of Object.entries(full.datasets)) {
    datasets[datasetId] = { fields: entry.fields, slices: entry.slices };
  }
  return { datasets } as unknown as BoardValidationCatalog;
}

function restrictedAggregationDescriptor(): DatasetDescriptor {
  return cloneAssessmentDescriptor({
    capabilities: {
      ...ASSESSMENT_DESCRIPTOR.capabilities,
      aggregations: ["average"],
    },
  });
}

function harness(
  document: BoardDocumentV1 = bindingDocument(),
  descriptor: DatasetDescriptor = ASSESSMENT_DESCRIPTOR,
) {
  const clock = new FakeClock();
  const runtime = createRuntime({
    clock,
    logger: createRecordingLogger(),
    idFactory: createDeterministicIdFactory("binding"),
    datasetProvider: createAssessmentProvider(descriptor),
    validationCatalog: catalogFor(descriptor),
  });
  const space = unwrap(runtime.createSpace({ document }));
  return { runtime, space, clock };
}

function measureBinding(document: BoardDocumentV1): BindingDefinition {
  const chart = document.blocks.find((block) => block.id === "chart");
  const found = chart?.bindings?.find((entry) => entry.id === "chart-y");
  if (!found) {
    throw new Error("chart measure binding is missing");
  }
  return found;
}

describe("T08 binding API and fixed-binding admission", () => {
  it("changes a selectable binding through the editor view draft", () => {
    const { runtime, space } = harness();
    const lease = unwrap(space.acquireEditorLease({ sessionId: "binding-editor" }));
    const editor = unwrap(space.createView({ mode: "editor", lease }));
    const result = editor.commands.updateBinding({
      blockId: "chart",
      slot: "y",
      field: { datasetId: "assessment-results", fieldId: "score" },
      aggregation: "sum",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(
      measureBinding(result.value.document as unknown as BoardDocumentV1).aggregation?.type,
    ).toBe("sum");
    expect(
      measureBinding(space.getSnapshot().committedDocument as unknown as BoardDocumentV1)
        .aggregation?.type,
    ).toBe("average");
    expect(space.getSnapshot().draft?.dirty).toBe(true);
    unwrap(editor.dispose({ draftDecision: "cancel" }));
    unwrap(runtime.dispose());
  });

  it("rejects a fixed binding through the public binding API", () => {
    const { runtime, space } = harness(bindingDocument(true));
    const lease = unwrap(space.acquireEditorLease({ sessionId: "fixed-editor" }));
    const editor = unwrap(space.createView({ mode: "editor", lease }));
    const result = editor.commands.updateBinding({
      blockId: "chart",
      slot: "y",
      field: { datasetId: "assessment-results", fieldId: "attendance_rate" },
      aggregation: "sum",
    });
    expectFailure(result, "FIXED_BINDING_LOCKED");
    expect(space.getSnapshot().draft?.dirty).toBe(false);
    unwrap(editor.dispose({ draftDecision: "cancel" }));
    unwrap(runtime.dispose());
  });

  it("rejects fixed-binding changes through full document draft updates", () => {
    const { runtime, space } = harness(bindingDocument(true));
    const lease = unwrap(space.acquireEditorLease({ sessionId: "fixed-document-editor" }));
    const changed = clone(bindingDocument(true)) as unknown as {
      blocks: Array<{ bindings: Array<{ aggregation?: { type: string } }> }>;
    };
    const measure = changed.blocks[0]?.bindings[1];
    if (measure?.aggregation) {
      measure.aggregation.type = "sum";
    }
    const result = space.updateDraft(lease, changed);
    expectFailure(result, "FIXED_BINDING_CHANGED");
    expect(space.getSnapshot().draft?.dirty).toBe(false);
    unwrap(space.releaseEditorLease(lease));
    unwrap(runtime.dispose());
  });

  it("rejects a viewer-bound binding command while a sibling editor exists", () => {
    const { runtime, space } = harness();
    const lease = unwrap(space.acquireEditorLease({ sessionId: "sibling-editor" }));
    const editor = unwrap(space.createView({ mode: "editor", lease }));
    const viewer = unwrap(space.createView({ mode: "viewer" }));
    const result = viewer.commands.updateBinding({
      blockId: "chart",
      slot: "y",
      field: { datasetId: "assessment-results", fieldId: "score" },
      aggregation: "sum",
    });
    expectFailure(result, "VIEWER_READ_ONLY");
    expect(editor.mode).toBe("editor");
    unwrap(editor.dispose({ draftDecision: "cancel" }));
    unwrap(runtime.dispose());
  });

  it("rejects fixed-binding changes on document load but accepts selectable changes", () => {
    const { runtime, space } = harness(bindingDocument(true));
    const before = space.getSnapshot().committedDocument;
    const fixedChange = clone(bindingDocument(true)) as unknown as {
      blocks: Array<{ bindings: Array<{ aggregation?: { type: string } }> }>;
    };
    const fixedMeasure = fixedChange.blocks[0]?.bindings[1];
    if (fixedMeasure?.aggregation) {
      fixedMeasure.aggregation.type = "sum";
    }
    expectFailure(space.loadDocument(fixedChange), "FIXED_BINDING_CHANGED");
    expect(space.getSnapshot().committedDocument).toEqual(before);

    unwrap(runtime.dispose());

    const selectableHarness = harness(bindingDocument());
    const selectableDocument = bindingDocument();
    const selectableChange = clone(selectableDocument) as unknown as {
      blocks: Array<{ bindings: Array<{ aggregation?: { type: string } }> }>;
    };
    const selectableMeasure = selectableChange.blocks[0]?.bindings[1];
    if (selectableMeasure?.aggregation) {
      selectableMeasure.aggregation.type = "sum";
    }
    expect(selectableHarness.space.loadDocument(selectableChange).ok).toBe(true);
    expect(
      measureBinding(
        selectableHarness.space.getSnapshot().committedDocument as unknown as BoardDocumentV1,
      ).aggregation?.type,
    ).toBe("sum");
    unwrap(selectableHarness.runtime.dispose());
  });

  it("rejects fixed-binding changes during import from a source space", () => {
    const { runtime, space } = harness(bindingDocument(true));
    const spacesBefore = runtime.spaceCount;
    const changed = clone(bindingDocument(true)) as unknown as {
      blocks: Array<{ bindings: Array<{ aggregation?: { type: string } }> }>;
    };
    const measure = changed.blocks[0]?.bindings[1];
    if (measure?.aggregation) {
      measure.aggregation.type = "sum";
    }
    const imported = runtime.importDocument(JSON.stringify(changed), {
      sourceSpaceId: space.id,
    });
    expectFailure(imported, "FIXED_BINDING_CHANGED");
    expect(runtime.spaceCount).toBe(spacesBefore);
    expect(space.disposed).toBe(false);
    unwrap(runtime.dispose());
  });

  it("rejects a fixed-binding change combined with a document ID change in the same space", () => {
    const { runtime, space } = harness(bindingDocument(true));
    const lease = unwrap(space.acquireEditorLease({ sessionId: "identity-editor" }));
    const renamed = clone(bindingDocument(true)) as unknown as {
      id: string;
      blocks: Array<{ bindings: Array<{ aggregation?: { type: string } }> }>;
    };
    renamed.id = "renamed-binding-board";
    const renamedMeasure = renamed.blocks[0]?.bindings[1];
    if (renamedMeasure?.aggregation) {
      renamedMeasure.aggregation.type = "sum";
    }
    expectFailure(space.updateDraft(lease, renamed), "FIXED_BINDING_CHANGED");
    expect(space.getSnapshot().committedDocument.id).toBe("binding-api-board");
    expectFailure(space.loadDocument(renamed), "FIXED_BINDING_CHANGED");
    expect(space.getSnapshot().committedDocument.id).toBe("binding-api-board");
    unwrap(space.releaseEditorLease(lease));
    unwrap(runtime.dispose());
  });

  it("allows a document ID change when fixed bindings are preserved", () => {
    const { runtime, space } = harness(bindingDocument(true));
    const lease = unwrap(space.acquireEditorLease({ sessionId: "identity-preserved" }));
    const renamed = clone(bindingDocument(true)) as unknown as { id: string };
    renamed.id = "renamed-preserved-board";
    unwrap(space.updateDraft(lease, renamed));
    const applied = unwrap(space.applyDraft(lease));
    expect(applied.committedDocument.id).toBe("renamed-preserved-board");
    expect(measureBinding(applied.committedDocument as unknown as BoardDocumentV1).mode).toBe(
      "fixed",
    );
    unwrap(space.releaseEditorLease(lease));
    unwrap(runtime.dispose());
  });

  it("allows import-as-new-space to use a different document identity", () => {
    const { runtime, space } = harness(bindingDocument(true));
    const renamed = clone(bindingDocument(true)) as unknown as {
      id: string;
      blocks: Array<{ bindings: Array<{ aggregation?: { type: string } }> }>;
    };
    renamed.id = "imported-different-board";
    const imported = unwrap(
      runtime.importDocument(JSON.stringify(renamed), { sourceSpaceId: space.id }),
    );
    expect(imported.space.getSnapshot().committedDocument.id).toBe("imported-different-board");
    expect(space.getSnapshot().committedDocument.id).toBe("binding-api-board");
    unwrap(runtime.dispose());
  });

  it("rejects an aggregated categorical chart when provider grouping is disabled", () => {
    const noGrouping = cloneAssessmentDescriptor({
      capabilities: {
        ...ASSESSMENT_DESCRIPTOR.capabilities,
        grouping: false,
      },
    });
    const runtime = createRuntime({
      clock: new FakeClock(),
      logger: createRecordingLogger(),
      idFactory: createDeterministicIdFactory("binding-no-grouping"),
      datasetProvider: createAssessmentProvider(noGrouping),
      validationCatalog: catalogFor(noGrouping),
    });
    expectFailure(
      runtime.createSpace({ document: bindingDocument() }),
      "PROVIDER_CAPABILITY_MISMATCH",
    );
    expect(runtime.spaceCount).toBe(0);
    unwrap(runtime.dispose());
  });

  it("applies provider aggregation restrictions even with an incomplete explicit catalog", () => {
    const restricted = restrictedAggregationDescriptor();
    const incomplete = fieldsOnlyCatalog(restricted);
    const runtime = createRuntime({
      clock: new FakeClock(),
      logger: createRecordingLogger(),
      idFactory: createDeterministicIdFactory("binding-effective"),
      datasetProvider: createAssessmentProvider(restricted),
      validationCatalog: incomplete,
    });
    const space = unwrap(runtime.createSpace({ document: bindingDocument() }));
    const catalog = space.getValidationCatalog();
    expect(catalog?.datasets["assessment-results"]?.capabilities?.aggregations).toEqual([
      "average",
    ]);
    const lease = unwrap(space.acquireEditorLease({ sessionId: "effective-editor" }));
    const editor = unwrap(space.createView({ mode: "editor", lease }));
    expectFailure(
      editor.commands.updateBinding({
        blockId: "chart",
        slot: "y",
        field: { datasetId: "assessment-results", fieldId: "score" },
        aggregation: "sum",
      }),
      "PROVIDER_CAPABILITY_MISMATCH",
    );
    const draft = clone(bindingDocument()) as unknown as {
      blocks: Array<{ bindings: Array<{ id: string; aggregation?: { type: string } }> }>;
    };
    const draftMeasure = draft.blocks[0]?.bindings.find((entry) => entry.id === "chart-y");
    if (draftMeasure?.aggregation) {
      draftMeasure.aggregation.type = "sum";
    }
    expectFailure(space.updateDraft(lease, draft), "PROVIDER_CAPABILITY_MISMATCH");
    unwrap(editor.dispose({ draftDecision: "cancel" }));
    unwrap(runtime.dispose());
  });

  it("rejects an aggregation that the provider does not declare", () => {
    const restricted = cloneAssessmentDescriptor({
      capabilities: {
        ...ASSESSMENT_DESCRIPTOR.capabilities,
        aggregations: ["average"],
      },
    });
    const { runtime, space } = harness(bindingDocument(), restricted);
    const lease = unwrap(space.acquireEditorLease({ sessionId: "capability-editor" }));
    const editor = unwrap(space.createView({ mode: "editor", lease }));
    const result = editor.commands.updateBinding({
      blockId: "chart",
      slot: "y",
      field: { datasetId: "assessment-results", fieldId: "score" },
      aggregation: "sum",
    });
    expectFailure(result, "PROVIDER_CAPABILITY_MISMATCH");
    unwrap(editor.dispose({ draftDecision: "cancel" }));
    unwrap(runtime.dispose());
  });
});
