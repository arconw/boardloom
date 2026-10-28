import { describe, expect, it } from "vitest";
import {
  createBoardValidationCatalog,
  createRuntime,
  describeBindingSlots,
  setBindingSlot,
  type BoardDocument,
  type BoardDocumentV1,
  type BoardValidationCatalog,
  type BlockDefinition,
} from "../../../../packages/core/src/index.js";
import { blockQueryId, deriveBlockQuery } from "../../../../packages/view-dom/src/block-query.js";
import { mountBoardView } from "../../../../packages/view-dom/src/index.js";
import { unwrap } from "../../core/support/assertions.js";
import {
  ASSESSMENT_DESCRIPTOR,
  ASSESSMENT_ROWS,
  cloneAssessmentDescriptor,
  createAssessmentProvider,
} from "../../core/fixtures/assessment-fixture.js";
import {
  FakeClock,
  createDeterministicIdFactory,
  createRecordingLogger,
} from "../../core/support/fakes.js";
import {
  createMiniDocument,
  findByClass,
  type MiniDocument,
  type MiniElement,
} from "../support/mini-dom.js";
import {
  createViewerProvider,
  createViewerRuntime,
  viewerFixtureDocument,
} from "../support/fixture.js";

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

function rootOf(handle: { readonly element: HTMLElement }): MiniElement {
  return handle.element as unknown as MiniElement;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createTarget(document: MiniDocument): MiniElement {
  const target = document.createElement("div");
  target.clientWidth = 1280;
  document.body.append(target);
  return target;
}

function control(
  root: MiniElement,
  blockId: string,
  slot: string,
  name: string,
): MiniElement | undefined {
  return findByClass(root, "bl-binding-control").find(
    (element) =>
      element.getAttribute("data-binding-block") === blockId &&
      element.getAttribute("data-binding-slot") === slot &&
      element.getAttribute("data-binding-control") === name,
  );
}

function catalog() {
  return createBoardValidationCatalog([ASSESSMENT_DESCRIPTOR]);
}

function fieldsOnlyCatalog(catalogValue: BoardValidationCatalog): BoardValidationCatalog {
  const datasets: Record<string, unknown> = {};
  for (const [datasetId, entry] of Object.entries(catalogValue.datasets)) {
    datasets[datasetId] = { fields: entry.fields, slices: entry.slices };
  }
  return { datasets } as unknown as BoardValidationCatalog;
}

describe("T08 binding inspector", () => {
  it("renders editor binding slots that agree with the shared core model", async () => {
    const document = createMiniDocument();
    const target = createTarget(document);
    const { runtime } = createViewerRuntime(createViewerProvider());
    const space = unwrap(runtime.createSpace({ document: viewerFixtureDocument() }));
    const handle = unwrap(
      mountBoardView(target as unknown as HTMLElement, {
        space,
        theme: "light",
      }),
    );
    await flush();

    const inspector = findByClass(rootOf(handle), "bl-inspector")[0];
    expect(inspector?.hasAttribute("hidden")).toBe(true);

    const lease = unwrap(space.acquireEditorLease({ sessionId: "inspector-session" }));
    unwrap(handle.setMode("editor", { lease }));
    await flush();

    expect(inspector?.hasAttribute("hidden")).toBe(false);
    for (const slot of ["x", "y", "series", "group"]) {
      expect(control(rootOf(handle), "block-chart", slot, "field")).toBeDefined();
    }
    expect(control(rootOf(handle), "block-metric", "y", "field")).toBeDefined();

    const described = describeBindingSlots(
      space.getSnapshot().committedDocument as unknown as BoardDocumentV1,
      "block-chart",
      { catalog: catalog() },
    );
    expect(described.ok).toBe(true);
    if (!described.ok) {
      return;
    }
    const coreY = described.value.find((entry) => entry.slot === "y");
    const aggregation = control(rootOf(handle), "block-chart", "y", "aggregation");
    expect(coreY).toBeDefined();
    expect(aggregation).toBeDefined();
    const rendered = new Map(
      (aggregation?.children ?? []).map((option) => [
        option.getAttribute("data-aggregation"),
        !option.hasAttribute("disabled"),
      ]),
    );
    for (const option of coreY?.aggregations ?? []) {
      expect(rendered.get(option.type), option.type).toBe(option.enabled);
    }
    expect(rendered.get("median")).toBe(false);

    const fieldOptions = new Map(
      (control(rootOf(handle), "block-chart", "y", "field")?.children ?? [])
        .filter((option) => option.getAttribute("data-field-id") !== null)
        .map((option) => [option.getAttribute("data-field-id"), !option.hasAttribute("disabled")]),
    );
    expect(fieldOptions.get("score")).toBe(true);
    expect(fieldOptions.get("school_id")).toBe(false);

    const invalid = setBindingSlot(
      space.getSnapshot().committedDocument as unknown as BoardDocumentV1,
      {
        blockId: "block-chart",
        slot: "y",
        field: { datasetId: "assessment-results", fieldId: "score" },
        aggregation: "median",
      },
      { catalog: catalog() },
    );
    expect(invalid.ok).toBe(false);

    unwrap(handle.unmount({ draftDecision: "cancel" }));
    unwrap(runtime.dispose());
  });

  it("applies a selectable change through the inspector and keeps the draft in core", async () => {
    const document = createMiniDocument();
    const target = createTarget(document);
    const { runtime } = createViewerRuntime(createViewerProvider());
    const space = unwrap(runtime.createSpace({ document: viewerFixtureDocument() }));
    const handle = unwrap(
      mountBoardView(target as unknown as HTMLElement, {
        space,
        theme: "light",
      }),
    );
    const lease = unwrap(space.acquireEditorLease({ sessionId: "inspector-change" }));
    unwrap(handle.setMode("editor", { lease }));
    await flush();

    const aggregation = control(rootOf(handle), "block-chart", "y", "aggregation");
    expect(aggregation).toBeDefined();
    if (aggregation === undefined) {
      return;
    }
    aggregation.value = "sum";
    rootOf(handle).dispatchEvent({ type: "change", target: aggregation as never });
    await flush();

    const draft = space.getSnapshot().draft?.document as unknown as BoardDocumentV1 | undefined;
    const chart = draft?.blocks.find((block) => block.id === "block-chart");
    const measure = chart?.bindings?.find((entry) => entry.id === "chart-score");
    expect(measure?.aggregation?.type).toBe("sum");
    expect(space.getSnapshot().committedDocument).toEqual(viewerFixtureDocument());
    expect(control(rootOf(handle), "block-chart", "y", "aggregation")?.value).toBe("sum");

    unwrap(handle.unmount({ draftDecision: "cancel" }));
    unwrap(runtime.dispose());
  });

  it("renders a fixed binding as a configuration lock, not a security control", async () => {
    const document = createMiniDocument();
    const target = createTarget(document);
    const { runtime } = createViewerRuntime(createViewerProvider());
    const fixedDocument = clone(viewerFixtureDocument()) as unknown as {
      blocks: Array<{ id: string; bindings: Array<{ id: string; mode?: string }> }>;
    };
    const metric = fixedDocument.blocks.find((block) => block.id === "block-metric");
    const measure = metric?.bindings.find((entry) => entry.id === "metric-score");
    if (measure) {
      measure.mode = "fixed";
    }
    const space = unwrap(runtime.createSpace({ document: fixedDocument }));
    const handle = unwrap(
      mountBoardView(target as unknown as HTMLElement, {
        space,
        theme: "light",
      }),
    );
    const lease = unwrap(space.acquireEditorLease({ sessionId: "fixed-inspector" }));
    unwrap(handle.setMode("editor", { lease }));
    await flush();

    const field = control(rootOf(handle), "block-metric", "y", "field");
    expect(field?.hasAttribute("disabled")).toBe(true);
    expect(field?.getAttribute("data-binding-mode")).toBe("fixed");
    const aggregation = control(rootOf(handle), "block-metric", "y", "aggregation");
    expect(aggregation?.hasAttribute("disabled")).toBe(true);
    const inspectorText = findByClass(rootOf(handle), "bl-inspector")[0]?.textContent ?? "";
    expect(inspectorText).toContain("Locked binding");
    expect(inspectorText).toContain("not a security boundary");
    expect(inspectorText.toLowerCase()).not.toContain("secure lock");

    const locked = setBindingSlot(
      space.getSnapshot().committedDocument as unknown as BoardDocumentV1,
      {
        blockId: "block-metric",
        slot: "y",
        field: { datasetId: "assessment-results", fieldId: "score" },
        aggregation: "sum",
      },
      { catalog: catalog() },
    );
    expect(locked.ok).toBe(false);

    unwrap(handle.unmount({ draftDecision: "cancel" }));
    unwrap(runtime.dispose());
  });

  it("uses the same effective provider constraints as the binding API", async () => {
    const restricted = cloneAssessmentDescriptor({
      capabilities: {
        ...ASSESSMENT_DESCRIPTOR.capabilities,
        aggregations: ["average"],
      },
    });
    const incomplete = fieldsOnlyCatalog(createBoardValidationCatalog([restricted]));
    const runtime = createRuntime({
      clock: new FakeClock(),
      logger: createRecordingLogger(),
      idFactory: createDeterministicIdFactory("inspector-effective"),
      datasetProvider: createAssessmentProvider(restricted),
      validationCatalog: incomplete,
    });
    const document = createMiniDocument();
    const target = createTarget(document);
    const space = unwrap(runtime.createSpace({ document: viewerFixtureDocument() }));
    const handle = unwrap(
      mountBoardView(target as unknown as HTMLElement, {
        space,
        theme: "light",
      }),
    );
    const lease = unwrap(space.acquireEditorLease({ sessionId: "effective-inspector" }));
    unwrap(handle.setMode("editor", { lease }));
    await flush();

    const aggregation = control(rootOf(handle), "block-chart", "y", "aggregation");
    const sum = aggregation?.children.find(
      (option) => option.getAttribute("data-aggregation") === "sum",
    );
    const average = aggregation?.children.find(
      (option) => option.getAttribute("data-aggregation") === "average",
    );
    expect(sum?.hasAttribute("disabled")).toBe(true);
    expect(average?.hasAttribute("disabled")).toBe(false);
    const effective = space.getValidationCatalog();
    expect(effective?.datasets["assessment-results"]?.capabilities?.aggregations).toEqual([
      "average",
    ]);
    const rejected = space.updateBinding(lease, {
      blockId: "block-chart",
      slot: "y",
      field: { datasetId: "assessment-results", fieldId: "score" },
      aggregation: "sum",
    });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.diagnostics[0]?.code).toBe("PROVIDER_CAPABILITY_MISMATCH");
    }

    unwrap(handle.unmount({ draftDecision: "cancel" }));
    unwrap(runtime.dispose());
  });

  it("retargets explicit aggregation targets when chart and metric Y fields change", async () => {
    const document = clone(viewerFixtureDocument()) as unknown as {
      datasets: Array<{ fields: Array<{ id: string; type: string; role: string }> }>;
      slices: Array<{ fieldIds: string[] }>;
      blocks: Array<{
        id: string;
        bindings?: Array<{
          id: string;
          field: { datasetId: string; fieldId: string };
          aggregation?: { type: string; fieldId?: string };
        }>;
      }>;
    };
    document.datasets[0]?.fields.push({
      id: "attendance_rate",
      type: "number",
      role: "measure",
    });
    document.slices[0]?.fieldIds.push("attendance_rate");
    for (const blockId of ["block-chart", "block-metric"]) {
      const target = document.blocks.find((block) => block.id === blockId);
      const measure = target?.bindings?.find(
        (entry) => entry.id === (blockId === "block-chart" ? "chart-score" : "metric-score"),
      );
      if (measure) {
        measure.aggregation = { type: "average", fieldId: "score" };
      }
    }

    const screen = createMiniDocument();
    const target = createTarget(screen);
    const { runtime } = createViewerRuntime(createViewerProvider());
    const space = unwrap(runtime.createSpace({ document }));
    const handle = unwrap(
      mountBoardView(target as unknown as HTMLElement, {
        space,
        theme: "light",
      }),
    );
    const lease = unwrap(space.acquireEditorLease({ sessionId: "retarget-editor" }));
    unwrap(handle.setMode("editor", { lease }));
    await flush();

    for (const blockId of ["block-chart", "block-metric"]) {
      const field = control(rootOf(handle), blockId, "y", "field");
      const option = field?.children.find(
        (candidate) => candidate.getAttribute("data-field-id") === "attendance_rate",
      );
      expect(field).toBeDefined();
      expect(option).toBeDefined();
      if (field === undefined || option === undefined) {
        return;
      }
      field.value = option.value;
      rootOf(handle).dispatchEvent({ type: "change", target: field as never });
      await flush();
    }

    const draft = space.getSnapshot().draft?.document as unknown as typeof document | undefined;
    for (const [blockId, bindingId] of [
      ["block-chart", "chart-score"],
      ["block-metric", "metric-score"],
    ] as const) {
      const block = draft?.blocks.find((entry) => entry.id === blockId);
      const measure = block?.bindings?.find((entry) => entry.id === bindingId);
      expect(measure?.field.fieldId).toBe("attendance_rate");
      expect(measure?.aggregation?.type).toBe("average");
      expect(measure?.aggregation?.fieldId).toBeUndefined();
    }
    const chartBlock = draft?.blocks.find((entry) => entry.id === "block-chart");
    const metricBlock = draft?.blocks.find((entry) => entry.id === "block-metric");
    const chartQuery = space
      .getQueryStates()
      .find((query) => query.queryId === blockQueryId(handle.view.viewId, "block-chart"));
    const metricQuery = space
      .getQueryStates()
      .find((query) => query.queryId === blockQueryId(handle.view.viewId, "block-metric"));
    const chartDerived = deriveBlockQuery(
      draft as unknown as BoardDocument,
      chartBlock as unknown as BlockDefinition,
    );
    const metricDerived = deriveBlockQuery(
      draft as unknown as BoardDocument,
      metricBlock as unknown as BlockDefinition,
    );
    expect(chartDerived.ok).toBe(true);
    expect(metricDerived.ok).toBe(true);
    if (chartDerived.ok && metricDerived.ok) {
      expect(chartDerived.value.spec.aggregations?.[0]?.fieldId).toBe("attendance_rate");
      expect(metricDerived.value.spec.aggregations?.[0]?.fieldId).toBe("attendance_rate");
    }

    const expectedNorth = (0.9 + 1 + 0.85) / 3;
    const northRow = chartQuery?.rows.find((row) => row["school_id"] === "north");
    expect(Number(northRow?.["chart-score"])).toBeCloseTo(expectedNorth, 6);
    const expectedOverall = (0.9 + 1 + 0.85 + 0.8) / 4;
    expect(Number(metricQuery?.rows[0]?.["metric-score"])).toBeCloseTo(expectedOverall, 6);
    expect(ASSESSMENT_ROWS.length).toBeGreaterThan(0);
    expect(chartBlock).toBeDefined();
    expect(metricBlock).toBeDefined();

    unwrap(handle.unmount({ draftDecision: "cancel" }));
    unwrap(runtime.dispose());
  });
});
