import { describe, expect, it } from "vitest";
import {
  createBoardValidationCatalog,
  createLocalDatasetProvider,
  createRuntime,
  validateBoardDocument,
  type BoardDocumentV1,
  type DatasetDescriptor,
} from "../../../../packages/core/src/index.js";
import { ASSESSMENT_DESCRIPTOR } from "../../core/fixtures/assessment-fixture.js";
import { mountBoardView } from "../../../../packages/view-dom/src/index.js";
import { unwrap } from "../../core/support/assertions.js";
import {
  createMiniDocument,
  findByAttribute,
  findByClass,
  type MiniDocument,
  type MiniElement,
} from "../support/mini-dom.js";
import {
  createViewerProvider,
  createViewerRuntime,
  viewerFixtureDocument,
  viewerFixtureRows,
} from "../support/fixture.js";
import { FakeClock, createDeterministicIdFactory } from "../../core/support/fakes.js";

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

function rootOf(handle: { readonly element: HTMLElement }): MiniElement {
  return handle.element as unknown as MiniElement;
}

function createTarget(document: MiniDocument): MiniElement {
  const target = document.createElement("div");
  target.clientWidth = 1280;
  document.body.append(target);
  return target;
}

function filterControl(root: MiniElement, name: string): MiniElement | undefined {
  return findByClass(root, "bl-filter-input").find(
    (element) => element.getAttribute("data-filter-control") === name,
  );
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function customRuntime(descriptor: DatasetDescriptor | readonly DatasetDescriptor[]) {
  const descriptors = Array.isArray(descriptor) ? descriptor : [descriptor];
  const provider = unwrap(
    createLocalDatasetProvider({
      providerId: "viewer-filter",
      datasets: descriptors.map((entry) => ({
        descriptor: entry,
        rows: viewerFixtureRows(),
      })),
    }),
  );
  return createRuntime({
    clock: new FakeClock(),
    idFactory: createDeterministicIdFactory("viewer-filter"),
    datasetProvider: provider,
    validationCatalog: createBoardValidationCatalog([...descriptors]),
  });
}

describe("T09 filter block and manager UI", () => {
  it("renders viewer-editable filter controls, chips and reset paths", async () => {
    const document = createMiniDocument();
    const target = createTarget(document);
    const { runtime } = createViewerRuntime(createViewerProvider());
    const space = unwrap(runtime.createSpace({ document: viewerFixtureDocument() }));
    const handle = unwrap(
      mountBoardView(target as unknown as HTMLElement, { space, theme: "light" }),
    );
    await flush();

    const root = rootOf(handle);
    const item = findByClass(root, "bl-filter-item")[0];
    expect(item?.getAttribute("data-filter-id")).toBe("filter-school");
    const valueControl = filterControl(root, "value");
    expect(valueControl).toBeDefined();
    const chip = findByClass(root, "bl-filter-chip").find(
      (element) => element.getAttribute("data-filter-chip") === "filter-school",
    );
    expect(chip?.getAttribute("data-filter-active")).toBe("false");
    expect(findByAttribute(root, "data-filter-reset", "filter-school").length).toBeGreaterThan(0);

    if (valueControl !== undefined) {
      valueControl.value = "east";
      valueControl.dispatchEvent({ type: "change", target: valueControl });
      await flush();
    }
    expect(space.getFilterState().activeValues).toEqual([
      { filterId: "filter-school", value: ["east"] },
    ]);
    const activeChip = findByClass(root, "bl-filter-chip").find(
      (element) => element.getAttribute("data-filter-chip") === "filter-school",
    );
    expect(activeChip?.getAttribute("data-filter-active")).toBe("true");
    expect(activeChip?.textContent).toContain("east");

    const reset = findByAttribute(root, "data-filter-reset", "filter-school")[0];
    if (reset !== undefined) {
      root.dispatchEvent({ type: "click", target: reset });
    }
    await flush();
    expect(space.getFilterState().activeValues).toHaveLength(0);

    unwrap(handle.unmount({ draftDecision: "cancel" }));
    unwrap(runtime.dispose());
  });

  it("cross-filters from an accessible chart data row and exposes a clear path", async () => {
    const document = createMiniDocument();
    const target = createTarget(document);
    const { runtime } = createViewerRuntime(createViewerProvider());
    const space = unwrap(runtime.createSpace({ document: viewerFixtureDocument() }));
    const handle = unwrap(
      mountBoardView(target as unknown as HTMLElement, { space, theme: "light" }),
    );
    await flush();
    const root = rootOf(handle);
    const selector = findByClass(root, "bl-cross-select")[0];
    expect(selector).toBeDefined();
    selector?.click();
    await flush();
    expect(space.getFilterState().crossFilters).toHaveLength(1);
    const selectionChip = findByClass(root, "bl-filter-chip--selection")[0];
    expect(selectionChip).toBeDefined();
    expect(selectionChip?.textContent).toContain("school_id");
    expect((selectionChip?.textContent.match(/north/g) ?? []).length).toBe(1);
    const second = findByClass(root, "bl-cross-select")[0];
    expect(second?.getAttribute("aria-pressed")).toBe("true");
    second?.click();
    await flush();
    expect(space.getFilterState().crossFilters).toHaveLength(0);

    unwrap(handle.unmount({ draftDecision: "cancel" }));
    unwrap(runtime.dispose());
  });

  it("edits filter definitions through the editor manager draft", async () => {
    const document = createMiniDocument();
    const target = createTarget(document);
    const { runtime } = createViewerRuntime(createViewerProvider());
    const space = unwrap(runtime.createSpace({ document: viewerFixtureDocument() }));
    const handle = unwrap(
      mountBoardView(target as unknown as HTMLElement, { space, theme: "light" }),
    );
    await flush();
    const lease = unwrap(space.acquireEditorLease({ sessionId: "filter-manager" }));
    unwrap(handle.setMode("editor", { lease }));
    await flush();

    const root = rootOf(handle);
    const manager = findByClass(root, "bl-filter-manager")[0];
    expect(manager).toBeDefined();
    const row = findByClass(root, "bl-filter-row").find(
      (element) => element.getAttribute("data-filter-id") === "filter-school",
    );
    expect(row).toBeDefined();
    const defaultValue = findByClass(row!, "bl-filter-control").find(
      (element) => element.getAttribute("data-filter-control") === "default",
    );
    expect(defaultValue).toBeDefined();
    if (defaultValue !== undefined) {
      defaultValue.value = "east";
      root.dispatchEvent({ type: "change", target: defaultValue });
      await flush();
    }
    const draft = space.getSnapshot().draft?.document as unknown as BoardDocumentV1;
    const filter = draft.filters.find((entry) => entry.id === "filter-school");
    expect(filter?.defaultValue).toEqual(["east"]);

    const add = findByAttribute(root, "data-filter-action", "add")[0];
    if (add !== undefined) {
      root.dispatchEvent({ type: "click", target: add });
    }
    await flush();
    const pendingRows = findByAttribute(root, "data-filter-pending", "true");
    expect(pendingRows.length).toBe(1);
    const pendingId = pendingRows[0]?.getAttribute("data-filter-id");
    expect(pendingId).not.toBeNull();
    const pendingApply = findByAttribute(root, "data-filter-apply", pendingId ?? "")[0];
    if (pendingApply !== undefined) {
      root.dispatchEvent({ type: "click", target: pendingApply });
    }
    await flush();
    const nextDraft = space.getSnapshot().draft?.document as unknown as BoardDocumentV1;
    expect(nextDraft.filters.length).toBeGreaterThan(draft.filters.length);
    expect(findByClass(root, "bl-filter-row").length).toBe(nextDraft.filters.length);

    unwrap(handle.unmount({ draftDecision: "cancel" }));
    unwrap(runtime.dispose());
  });

  it("creates valid date and datetime range defaults in the manager", async () => {
    const fixture = clone(viewerFixtureDocument());
    (fixture.datasets[0] as unknown as { fields: unknown[] }).fields = [
      ...((fixture.datasets[0]!.fields ?? []) as unknown[]),
      { id: "submitted_at", type: "datetime", role: "dimension", timezone: "UTC" },
    ];
    const document = createMiniDocument();
    const target = createTarget(document);
    const { runtime } = createViewerRuntime(createViewerProvider());
    const space = unwrap(runtime.createSpace({ document: fixture }));
    const handle = unwrap(
      mountBoardView(target as unknown as HTMLElement, { space, theme: "light" }),
    );
    await flush();
    const lease = unwrap(space.acquireEditorLease({ sessionId: "date-range" }));
    unwrap(handle.setMode("editor", { lease }));
    await flush();
    const root = rootOf(handle);
    const row = findByClass(root, "bl-filter-row").find(
      (element) => element.getAttribute("data-filter-id") === "filter-school",
    );
    const fieldSelect = findByClass(row!, "bl-filter-control").find(
      (element) => element.getAttribute("data-filter-control") === "field",
    );
    fieldSelect!.value = JSON.stringify(["assessment-results", "submitted_at"]);
    root.dispatchEvent({ type: "change", target: fieldSelect! });
    await flush();
    const refreshedRow = findByClass(root, "bl-filter-row").find(
      (element) => element.getAttribute("data-filter-id") === "filter-school",
    );
    const operatorSelect = findByClass(refreshedRow!, "bl-filter-control").find(
      (element) => element.getAttribute("data-filter-control") === "operator",
    );
    operatorSelect!.value = "between";
    root.dispatchEvent({ type: "change", target: operatorSelect! });
    await flush();
    const apply = findByAttribute(root, "data-filter-apply", "filter-school")[0];
    if (apply !== undefined) {
      root.dispatchEvent({ type: "click", target: apply });
      await flush();
    }
    const draft = space.getSnapshot().draft?.document as unknown as BoardDocumentV1;
    const filter = draft.filters.find((entry) => entry.id === "filter-school");
    expect(Array.isArray(filter?.defaultValue)).toBe(true);
    expect((filter?.defaultValue as readonly string[]).length).toBe(2);
    expect(filter?.temporal).toMatchObject({ timezone: "UTC", bounds: "inclusive" });
    expect(String((filter?.defaultValue as readonly string[])[0])).toMatch(/^\d{4}-/);
    unwrap(handle.unmount({ draftDecision: "cancel" }));
    unwrap(runtime.dispose());
  });

  it("renders boolean predicates as fixed states and rejects meaningless active values", async () => {
    const fixture = clone(viewerFixtureDocument());
    (fixture.datasets[0] as unknown as { fields: unknown[] }).fields = [
      ...((fixture.datasets[0]!.fields ?? []) as unknown[]),
      { id: "passed", type: "boolean", role: "dimension" },
    ];
    (fixture.filters as unknown as unknown[]).push({
      id: "filter-passed",
      label: "Passed",
      field: { datasetId: "assessment-results", fieldId: "passed" },
      operator: "isTrue",
      viewerEditable: true,
      target: { kind: "board" },
    });
    const filterBlock = fixture.blocks.find((block) => block.id === "block-filter");
    if (filterBlock !== undefined) {
      (filterBlock as unknown as { config: unknown }).config = {
        filterIds: ["filter-school", "filter-passed"],
      };
    }
    const descriptor: DatasetDescriptor = {
      ...ASSESSMENT_DESCRIPTOR,
      capabilities: {
        ...ASSESSMENT_DESCRIPTOR.capabilities,
        filterOperators: [
          ...ASSESSMENT_DESCRIPTOR.capabilities.filterOperators,
          "isTrue",
          "isFalse",
        ],
      },
      fields: [
        ...ASSESSMENT_DESCRIPTOR.fields,
        {
          id: "passed",
          key: "passed",
          label: "Passed",
          type: "boolean",
          role: "dimension",
          nullable: true,
        },
      ],
    };
    const invalidDefault = clone(fixture);
    const invalidFilter = invalidDefault.filters.find(
      (filter) => filter.id === "filter-passed",
    ) as unknown as { defaultValue: unknown };
    invalidFilter.defaultValue = false;
    expect(validateBoardDocument(invalidDefault).valid).toBe(false);
    const runtime = customRuntime(descriptor);
    const space = unwrap(runtime.createSpace({ document: fixture }));
    const document = createMiniDocument();
    const target = createTarget(document);
    const handle = unwrap(
      mountBoardView(target as unknown as HTMLElement, { space, theme: "light" }),
    );
    await flush();
    const item = findByClass(rootOf(handle), "bl-filter-item").find(
      (element) => element.getAttribute("data-filter-id") === "filter-passed",
    );
    expect(item?.textContent).toContain("Is true");
    const chip = findByClass(rootOf(handle), "bl-filter-chip").find(
      (element) => element.getAttribute("data-filter-chip") === "filter-passed",
    );
    expect(chip?.textContent).toContain("Is true");
    expect(chip?.textContent).not.toContain("false");
    expect(
      findByClass(item!, "bl-filter-input").some(
        (element) => element.getAttribute("data-filter-control") === "value",
      ),
    ).toBe(false);
    const rejected = space.setFilterValue("filter-passed", true);
    expect(rejected.ok).toBe(false);
    const lease = unwrap(space.acquireEditorLease({ sessionId: "boolean-manager" }));
    unwrap(handle.setMode("editor", { lease }));
    await flush();
    const row = findByClass(rootOf(handle), "bl-filter-row").find(
      (element) => element.getAttribute("data-filter-id") === "filter-passed",
    );
    expect(
      findByClass(row!, "bl-filter-control").some(
        (element) => element.getAttribute("data-filter-control") === "default",
      ),
    ).toBe(false);
    unwrap(handle.unmount({ draftDecision: "cancel" }));
    unwrap(runtime.dispose());
  });

  it("submits numeric membership as a typed array", async () => {
    const fixture = clone(viewerFixtureDocument());
    (fixture.filters as unknown as unknown[]).push({
      id: "filter-score-in",
      label: "Score set",
      field: { datasetId: "assessment-results", fieldId: "score" },
      operator: "in",
      defaultValue: [10],
      viewerEditable: true,
      target: { kind: "board" },
    });
    const filterBlock = fixture.blocks.find((block) => block.id === "block-filter");
    if (filterBlock !== undefined) {
      (filterBlock as unknown as { config: unknown }).config = {
        filterIds: ["filter-school", "filter-score-in"],
      };
    }
    const document = createMiniDocument();
    const target = createTarget(document);
    const { runtime } = createViewerRuntime(createViewerProvider());
    const space = unwrap(runtime.createSpace({ document: fixture }));
    const handle = unwrap(
      mountBoardView(target as unknown as HTMLElement, { space, theme: "light" }),
    );
    await flush();
    const root = rootOf(handle);
    const item = findByClass(root, "bl-filter-item").find(
      (element) => element.getAttribute("data-filter-id") === "filter-score-in",
    );
    const input = findByClass(item!, "bl-filter-input").find(
      (element) => element.getAttribute("data-filter-control") === "value",
    );
    expect(input?.getAttribute("type")).toBe("number");
    input!.value = "7";
    input!.dispatchEvent({ type: "change", target: input! });
    await flush();
    expect(space.getFilterState().activeValues).toEqual([
      { filterId: "filter-score-in", value: [7] },
    ]);
    unwrap(handle.unmount({ draftDecision: "cancel" }));
    unwrap(runtime.dispose());
  });

  it("applies a viewer temporal window when conversion capability is declared", async () => {
    const fixture = clone(viewerFixtureDocument());
    (fixture.datasets[0] as unknown as { fields: unknown[] }).fields = [
      ...((fixture.datasets[0]!.fields ?? []) as unknown[]),
      { id: "submitted_at", type: "datetime", role: "dimension", timezone: "UTC" },
    ];
    (fixture.filters as unknown as unknown[]).push({
      id: "filter-window",
      label: "Window",
      field: { datasetId: "assessment-results", fieldId: "submitted_at" },
      operator: "between",
      defaultValue: ["2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z"],
      viewerEditable: true,
      temporal: { timezone: "America/New_York", bounds: "inclusive" },
      target: { kind: "block", blockId: "block-table" },
    });
    const filterBlock = fixture.blocks.find((block) => block.id === "block-filter");
    if (filterBlock !== undefined) {
      (filterBlock as unknown as { config: unknown }).config = {
        filterIds: ["filter-school", "filter-window"],
      };
    }
    const descriptor: DatasetDescriptor = {
      ...ASSESSMENT_DESCRIPTOR,
      capabilities: { ...ASSESSMENT_DESCRIPTOR.capabilities, timezoneConversion: true },
    };
    const document = createMiniDocument();
    const target = createTarget(document);
    const runtime = customRuntime(descriptor);
    const space = unwrap(runtime.createSpace({ document: fixture }));
    const handle = unwrap(
      mountBoardView(target as unknown as HTMLElement, { space, theme: "light" }),
    );
    await flush();
    const root = rootOf(handle);
    const item = findByClass(root, "bl-filter-item").find(
      (element) => element.getAttribute("data-filter-id") === "filter-window",
    );
    const inputs = findByClass(item!, "bl-filter-input").filter(
      (element) => element.getAttribute("data-filter-control") === "range",
    );
    expect(inputs).toHaveLength(2);
    inputs[0]!.value = "2026-03-01T00:00:00Z";
    inputs[0]!.dispatchEvent({ type: "input", target: inputs[0]! });
    inputs[1]!.value = "2026-03-02T00:00:00Z";
    inputs[1]!.dispatchEvent({ type: "input", target: inputs[1]! });
    const apply = findByClass(item!, "bl-filter-apply")[0];
    apply?.click();
    await flush();
    expect(space.getFilterState().activeValues).toEqual([
      {
        filterId: "filter-window",
        value: ["2026-03-01T00:00:00Z", "2026-03-02T00:00:00Z"],
      },
    ]);
    unwrap(handle.unmount({ draftDecision: "cancel" }));
    unwrap(runtime.dispose());
  });

  it("restricts manager operator options to declared provider capabilities", async () => {
    const fixture = clone(viewerFixtureDocument());
    (fixture.filters as unknown as unknown[]).push({
      id: "filter-score-in",
      label: "Score set",
      field: { datasetId: "assessment-results", fieldId: "score" },
      operator: "in",
      defaultValue: [10],
      viewerEditable: true,
      target: { kind: "board" },
    });
    const descriptor: DatasetDescriptor = {
      ...ASSESSMENT_DESCRIPTOR,
      fields: ASSESSMENT_DESCRIPTOR.fields.map((field) =>
        field.id === "score" ? { ...field, operators: ["equals", "in"] } : field,
      ),
    };
    const runtime = customRuntime(descriptor);
    const space = unwrap(runtime.createSpace({ document: fixture }));
    const document = createMiniDocument();
    const target = createTarget(document);
    const handle = unwrap(
      mountBoardView(target as unknown as HTMLElement, { space, theme: "light" }),
    );
    await flush();
    const lease = unwrap(space.acquireEditorLease({ sessionId: "restricted-manager" }));
    unwrap(handle.setMode("editor", { lease }));
    await flush();
    const row = findByClass(rootOf(handle), "bl-filter-row").find(
      (element) => element.getAttribute("data-filter-id") === "filter-score-in",
    );
    const operator = findByClass(row!, "bl-filter-control").find(
      (element) => element.getAttribute("data-filter-control") === "operator",
    );
    const values = new Set((operator?.children ?? []).map((option) => option.value));
    expect(values.has("equals")).toBe(true);
    expect(values.has("in")).toBe(true);
    expect(values.has("greaterThan")).toBe(false);
    unwrap(handle.unmount({ draftDecision: "cancel" }));
    unwrap(runtime.dispose());
  });

  it("clears stale defaults when a manager field change crosses types", async () => {
    const fixture = clone(viewerFixtureDocument());
    (fixture.datasets[0] as unknown as { fields: unknown[] }).fields = [
      ...((fixture.datasets[0]!.fields ?? []) as unknown[]),
      { id: "submitted_at", type: "datetime", role: "dimension", timezone: "UTC" },
      { id: "passed", type: "boolean", role: "dimension" },
    ];
    (fixture.filters as unknown as unknown[]).push({
      id: "filter-switch",
      label: "Switch",
      field: { datasetId: "assessment-results", fieldId: "submitted_at" },
      operator: "between",
      defaultValue: ["2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z"],
      temporal: { timezone: "UTC", bounds: "inclusive" },
      viewerEditable: true,
      target: { kind: "board" },
    });
    const descriptor: DatasetDescriptor = {
      ...ASSESSMENT_DESCRIPTOR,
      capabilities: {
        ...ASSESSMENT_DESCRIPTOR.capabilities,
        filterOperators: [
          ...ASSESSMENT_DESCRIPTOR.capabilities.filterOperators,
          "isTrue",
          "isFalse",
        ],
      },
      fields: [
        ...ASSESSMENT_DESCRIPTOR.fields,
        {
          id: "passed",
          key: "passed",
          label: "Passed",
          type: "boolean",
          role: "dimension",
          nullable: true,
        },
      ],
    };
    const runtime = customRuntime(descriptor);
    const space = unwrap(runtime.createSpace({ document: fixture }));
    const document = createMiniDocument();
    const target = createTarget(document);
    const handle = unwrap(
      mountBoardView(target as unknown as HTMLElement, { space, theme: "light" }),
    );
    await flush();
    const lease = unwrap(space.acquireEditorLease({ sessionId: "switch-manager" }));
    unwrap(handle.setMode("editor", { lease }));
    await flush();
    const findField = () => {
      const row = findByClass(rootOf(handle), "bl-filter-row").find(
        (element) => element.getAttribute("data-filter-id") === "filter-switch",
      );
      return findByClass(row!, "bl-filter-control").find(
        (element) => element.getAttribute("data-filter-control") === "field",
      );
    };
    let field = findField();
    field!.value = JSON.stringify(["assessment-results", "score"]);
    rootOf(handle).dispatchEvent({ type: "change", target: field! });
    await flush();
    let apply = findByAttribute(rootOf(handle), "data-filter-apply", "filter-switch")[0];
    if (apply !== undefined) {
      rootOf(handle).dispatchEvent({ type: "click", target: apply });
      await flush();
    }
    let draft = space.getSnapshot().draft?.document as unknown as BoardDocumentV1;
    let filter = draft.filters.find((entry) => entry.id === "filter-switch");
    expect(filter?.field.fieldId).toBe("score");
    expect(filter?.temporal).toBeUndefined();
    expect(filter?.defaultValue).toBe(0);
    field = findField();
    field!.value = JSON.stringify(["assessment-results", "passed"]);
    rootOf(handle).dispatchEvent({ type: "change", target: field! });
    await flush();
    apply = findByAttribute(rootOf(handle), "data-filter-apply", "filter-switch")[0];
    if (apply !== undefined) {
      rootOf(handle).dispatchEvent({ type: "click", target: apply });
      await flush();
    }
    draft = space.getSnapshot().draft?.document as unknown as BoardDocumentV1;
    filter = draft.filters.find((entry) => entry.id === "filter-switch");
    expect(filter?.field.fieldId).toBe("passed");
    expect(filter?.operator).toBe("isTrue");
    expect(filter?.defaultValue).toBeUndefined();
    expect(filter?.temporal).toBeUndefined();
    unwrap(handle.unmount({ draftDecision: "cancel" }));
    unwrap(runtime.dispose());
  });

  it("restricts manager operators by mapped target capabilities", async () => {
    const fixture = clone(viewerFixtureDocument());
    (fixture.datasets as unknown as unknown[]).push({
      id: "viewer-other",
      label: "Other",
      fields: [
        { id: "school_id", type: "string", role: "dimension" },
        { id: "subject", type: "string", role: "dimension" },
        { id: "score", type: "number", role: "measure", unit: "points" },
      ],
    });
    (fixture.blocks as unknown as unknown[]).push({
      id: "table-other",
      type: "table",
      title: "Other rows",
      bindings: [
        {
          id: "other-school",
          role: "dimension",
          field: { datasetId: "viewer-other", fieldId: "school_id" },
        },
        {
          id: "other-score",
          role: "measure",
          field: { datasetId: "viewer-other", fieldId: "score" },
          aggregation: { type: "average" },
        },
      ],
      config: { columns: ["other-school", "other-score"] },
    });
    const placement = {
      blockId: "table-other",
      x: 0,
      y: 8,
      width: 12,
      height: 4,
    };
    (fixture.layout.desktop.placements as unknown as unknown[]).push(placement);
    (fixture.layout.tablet?.placements as unknown as unknown[]).push({
      ...placement,
      y: 18,
      width: 8,
    });
    (fixture.layout.narrow?.placements as unknown as unknown[]).push({
      ...placement,
      y: 20,
      width: 4,
    });
    const schoolFilter = fixture.filters.find(
      (filter) => filter.id === "filter-school",
    ) as unknown as {
      mappings: unknown[];
    };
    schoolFilter.mappings = [
      {
        source: { datasetId: "assessment-results", fieldId: "school_id" },
        target: { datasetId: "viewer-other", fieldId: "school_id" },
      },
    ];
    (fixture.filters as unknown as unknown[]).push({
      id: "filter-mapped",
      label: "Mapped score",
      field: { datasetId: "assessment-results", fieldId: "score" },
      operator: "equals",
      defaultValue: 10,
      viewerEditable: true,
      mappings: [
        {
          source: { datasetId: "assessment-results", fieldId: "score" },
          target: { datasetId: "viewer-other", fieldId: "score" },
        },
      ],
      target: { kind: "block", blockId: "table-other" },
    });
    const otherDescriptor: DatasetDescriptor = {
      ...ASSESSMENT_DESCRIPTOR,
      id: "viewer-other",
      label: "Other",
      slices: ASSESSMENT_DESCRIPTOR.slices.map((slice) => ({
        ...slice,
        datasetId: "viewer-other",
      })),
      fields: ASSESSMENT_DESCRIPTOR.fields.map((field) =>
        field.id === "score" ? { ...field, operators: ["equals"] } : field,
      ),
    };
    const runtime = customRuntime([ASSESSMENT_DESCRIPTOR, otherDescriptor]);
    const space = unwrap(runtime.createSpace({ document: fixture }));
    const document = createMiniDocument();
    const target = createTarget(document);
    const handle = unwrap(
      mountBoardView(target as unknown as HTMLElement, { space, theme: "light" }),
    );
    await flush();
    const lease = unwrap(space.acquireEditorLease({ sessionId: "mapped-manager" }));
    unwrap(handle.setMode("editor", { lease }));
    await flush();
    const row = findByClass(rootOf(handle), "bl-filter-row").find(
      (element) => element.getAttribute("data-filter-id") === "filter-mapped",
    );
    const operator = findByClass(row!, "bl-filter-control").find(
      (element) => element.getAttribute("data-filter-control") === "operator",
    );
    const values = new Set((operator?.children ?? []).map((option) => option.value));
    expect(values.has("equals")).toBe(true);
    expect(values.has("greaterThan")).toBe(false);
    expect(values.has("between")).toBe(false);

    const schoolRow = findByClass(rootOf(handle), "bl-filter-row").find(
      (element) => element.getAttribute("data-filter-id") === "filter-school",
    );
    const schoolField = findByClass(schoolRow!, "bl-filter-control").find(
      (element) => element.getAttribute("data-filter-control") === "field",
    );
    schoolField!.value = JSON.stringify(["assessment-results", "score"]);
    rootOf(handle).dispatchEvent({ type: "change", target: schoolField! });
    await flush();
    const pendingRow = findByClass(rootOf(handle), "bl-filter-row").find(
      (element) => element.getAttribute("data-filter-id") === "filter-school",
    );
    expect(pendingRow?.getAttribute("data-filter-pending")).toBe("true");
    const mapping = findByClass(pendingRow!, "bl-filter-control").find(
      (element) =>
        element.getAttribute("data-filter-control") === "mapping" &&
        element.getAttribute("data-filter-dataset") === "viewer-other",
    );
    mapping!.value = "score";
    rootOf(handle).dispatchEvent({ type: "change", target: mapping! });
    await flush();
    const apply = findByAttribute(rootOf(handle), "data-filter-apply", "filter-school")[0];
    if (apply !== undefined) {
      rootOf(handle).dispatchEvent({ type: "click", target: apply });
      await flush();
    }
    const draft = space.getSnapshot().draft?.document as unknown as BoardDocumentV1;
    const changed = draft.filters.find((entry) => entry.id === "filter-school");
    expect(changed?.field.fieldId).toBe("score");
    expect(changed?.operator).toBe("equals");
    expect(changed?.mappings).toEqual([
      {
        source: { datasetId: "assessment-results", fieldId: "score" },
        target: { datasetId: "viewer-other", fieldId: "score" },
      },
    ]);
    unwrap(handle.unmount({ draftDecision: "cancel" }));
    unwrap(runtime.dispose());
  });

  it("displays an explicit null active value instead of the default", async () => {
    const document = createMiniDocument();
    const target = createTarget(document);
    const fixture = clone(viewerFixtureDocument());
    const filter = fixture.filters[0] as unknown as {
      operator: string;
      defaultValue: unknown;
    };
    filter.operator = "equals";
    filter.defaultValue = "north";
    const { runtime } = createViewerRuntime(createViewerProvider());
    const space = unwrap(runtime.createSpace({ document: fixture }));
    const handle = unwrap(
      mountBoardView(target as unknown as HTMLElement, { space, theme: "light" }),
    );
    await flush();
    unwrap(space.setFilterValue("filter-school", null as never));
    await flush();
    const root = rootOf(handle);
    const chip = findByClass(root, "bl-filter-chip").find(
      (element) => element.getAttribute("data-filter-chip") === "filter-school",
    );
    const chipValue = findByClass(chip!, "bl-filter-chip__value")[0];
    expect(chip?.getAttribute("data-filter-active")).toBe("true");
    expect(chipValue?.textContent).toBe("");
    const item = findByClass(root, "bl-filter-item").find(
      (element) => element.getAttribute("data-filter-id") === "filter-school",
    );
    const itemValue = findByClass(item!, "bl-filter-chip__value")[0];
    expect(itemValue?.textContent).toBe("");
    expect(space.getFilterState().activeValues).toEqual([
      { filterId: "filter-school", value: null },
    ]);
    unwrap(handle.unmount({ draftDecision: "cancel" }));
    unwrap(runtime.dispose());
  });

  it("resolves comparison-side operator transitions through the pending editor state", async () => {
    const fixture = clone(viewerFixtureDocument());
    (fixture.datasets[0] as unknown as { fields: unknown[] }).fields = [
      ...((fixture.datasets[0]!.fields ?? []) as unknown[]),
      { id: "submitted_at", type: "datetime", role: "dimension", timezone: "UTC" },
    ];
    (fixture.datasets as unknown as unknown[]).push({
      id: "viewer-other",
      label: "Other",
      fields: [
        { id: "school_id", type: "string", role: "dimension" },
        { id: "subject", type: "string", role: "dimension" },
        { id: "score", type: "number", role: "measure", unit: "points" },
        { id: "submitted_at", type: "datetime", role: "dimension", timezone: "UTC" },
      ],
    });
    (fixture.comparisons as unknown as unknown[]).push({
      id: "comparison-side",
      label: "Comparison side",
      displayMode: "overlay",
      deltaMode: "absolute",
      base: { datasetId: "assessment-results" },
      reference: { datasetId: "viewer-other" },
      mapping: [
        {
          primary: { datasetId: "assessment-results", fieldId: "school_id" },
          reference: { datasetId: "viewer-other", fieldId: "school_id" },
          role: "dimension",
        },
        {
          primary: { datasetId: "assessment-results", fieldId: "score" },
          reference: { datasetId: "viewer-other", fieldId: "score" },
          role: "measure",
        },
        {
          primary: { datasetId: "assessment-results", fieldId: "submitted_at" },
          reference: { datasetId: "viewer-other", fieldId: "submitted_at" },
          role: "dimension",
        },
      ],
      alignment: { keys: ["school_id"] },
    });
    const chart = fixture.blocks.find((block) => block.id === "block-chart");
    (chart as unknown as { config: Record<string, unknown> }).config = {
      ...(chart?.config ?? {}),
      comparisonId: "comparison-side",
    };
    (fixture.filters as unknown as unknown[]).push({
      id: "filter-comparison",
      label: "Comparison score",
      field: { datasetId: "assessment-results", fieldId: "score" },
      operator: "between",
      defaultValue: [1, 2],
      viewerEditable: true,
      target: { kind: "block", blockId: "block-chart" },
    });
    const otherDescriptor: DatasetDescriptor = {
      ...ASSESSMENT_DESCRIPTOR,
      id: "viewer-other",
      label: "Other",
      slices: ASSESSMENT_DESCRIPTOR.slices.map((slice) => ({
        ...slice,
        datasetId: "viewer-other",
      })),
      fields: ASSESSMENT_DESCRIPTOR.fields.map((field) =>
        field.id === "score" || field.id === "submitted_at"
          ? { ...field, operators: ["between"] }
          : field,
      ),
    };
    const runtime = customRuntime([ASSESSMENT_DESCRIPTOR, otherDescriptor]);
    const space = unwrap(runtime.createSpace({ document: fixture }));
    const document = createMiniDocument();
    const target = createTarget(document);
    const handle = unwrap(
      mountBoardView(target as unknown as HTMLElement, { space, theme: "light" }),
    );
    await flush();
    const lease = unwrap(space.acquireEditorLease({ sessionId: "comparison-manager" }));
    unwrap(handle.setMode("editor", { lease }));
    await flush();
    const row = findByClass(rootOf(handle), "bl-filter-row").find(
      (element) => element.getAttribute("data-filter-id") === "filter-comparison",
    );
    const field = findByClass(row!, "bl-filter-control").find(
      (element) => element.getAttribute("data-filter-control") === "field",
    );
    field!.value = JSON.stringify(["assessment-results", "submitted_at"]);
    rootOf(handle).dispatchEvent({ type: "change", target: field! });
    await flush();
    const pendingRow = findByClass(rootOf(handle), "bl-filter-row").find(
      (element) => element.getAttribute("data-filter-id") === "filter-comparison",
    );
    expect(pendingRow?.getAttribute("data-filter-pending")).toBe("true");
    const operator = findByClass(pendingRow!, "bl-filter-control").find(
      (element) => element.getAttribute("data-filter-control") === "operator",
    );
    expect(operator?.value).toBe("between");
    const apply = findByAttribute(rootOf(handle), "data-filter-apply", "filter-comparison")[0];
    if (apply !== undefined) {
      rootOf(handle).dispatchEvent({ type: "click", target: apply });
      await flush();
    }
    const draft = space.getSnapshot().draft?.document as unknown as BoardDocumentV1;
    const changed = draft.filters.find((entry) => entry.id === "filter-comparison");
    expect(changed?.field.fieldId).toBe("submitted_at");
    expect(changed?.operator).toBe("between");
    expect(changed?.temporal).toMatchObject({ timezone: "UTC", bounds: "inclusive" });
    expect(findByAttribute(rootOf(handle), "data-filter-pending", "true")).toHaveLength(0);
    unwrap(handle.unmount({ draftDecision: "cancel" }));
    unwrap(runtime.dispose());
  });

  it("adds filters through the pending flow when the first dataset is unused", async () => {
    const fixture = clone(viewerFixtureDocument());
    (fixture.datasets as unknown as unknown[]).unshift({
      id: "viewer-ref",
      label: "Reference",
      fields: [
        { id: "school_id", type: "string", role: "dimension" },
        { id: "subject", type: "string", role: "dimension" },
        { id: "score", type: "number", role: "measure", unit: "points" },
      ],
    });
    const refDescriptor: DatasetDescriptor = {
      ...ASSESSMENT_DESCRIPTOR,
      id: "viewer-ref",
      label: "Reference",
      slices: ASSESSMENT_DESCRIPTOR.slices.map((slice) => ({
        ...slice,
        datasetId: "viewer-ref",
      })),
    };
    const runtime = customRuntime([ASSESSMENT_DESCRIPTOR, refDescriptor]);
    const space = unwrap(runtime.createSpace({ document: fixture }));
    const document = createMiniDocument();
    const target = createTarget(document);
    const handle = unwrap(
      mountBoardView(target as unknown as HTMLElement, { space, theme: "light" }),
    );
    await flush();
    const lease = unwrap(space.acquireEditorLease({ sessionId: "add-pending" }));
    unwrap(handle.setMode("editor", { lease }));
    await flush();
    const root = rootOf(handle);
    const before =
      (space.getSnapshot().draft?.document as unknown as BoardDocumentV1 | undefined)?.filters
        .length ?? 0;
    const add = findByAttribute(root, "data-filter-action", "add")[0];
    if (add !== undefined) {
      root.dispatchEvent({ type: "click", target: add });
    }
    await flush();
    let pendingRows = findByAttribute(root, "data-filter-pending", "true");
    expect(pendingRows).toHaveLength(1);
    expect(
      (space.getSnapshot().draft?.document as unknown as BoardDocumentV1 | undefined)?.filters
        .length ?? 0,
    ).toBe(before);
    const pendingId = pendingRows[0]?.getAttribute("data-filter-id") ?? "";
    const discard = findByAttribute(root, "data-filter-discard", pendingId)[0];
    if (discard !== undefined) {
      root.dispatchEvent({ type: "click", target: discard });
    }
    await flush();
    expect(
      (space.getSnapshot().draft?.document as unknown as BoardDocumentV1 | undefined)?.filters
        .length ?? 0,
    ).toBe(before);
    expect(findByAttribute(root, "data-filter-pending", "true")).toHaveLength(0);

    const addAgain = findByAttribute(root, "data-filter-action", "add")[0];
    if (addAgain !== undefined) {
      root.dispatchEvent({ type: "click", target: addAgain });
    }
    await flush();
    pendingRows = findByAttribute(root, "data-filter-pending", "true");
    expect(pendingRows).toHaveLength(1);
    const newId = pendingRows[0]?.getAttribute("data-filter-id") ?? "";
    const apply = findByAttribute(root, "data-filter-apply", newId)[0];
    if (apply !== undefined) {
      root.dispatchEvent({ type: "click", target: apply });
    }
    await flush();
    const after =
      (space.getSnapshot().draft?.document as unknown as BoardDocumentV1 | undefined)?.filters
        .length ?? 0;
    expect(after).toBe(before + 1);
    expect(findByAttribute(root, "data-filter-pending", "true")).toHaveLength(0);
    unwrap(handle.unmount({ draftDecision: "cancel" }));
    unwrap(runtime.dispose());
  });

  it("clears failed pending-apply diagnostics when the candidate is discarded", async () => {
    const fixture = clone(viewerFixtureDocument());
    (fixture.datasets as unknown as unknown[]).push({
      id: "viewer-other",
      label: "Other",
      fields: [
        { id: "school_id", type: "string", role: "dimension" },
        { id: "subject", type: "string", role: "dimension" },
        { id: "score", type: "number", role: "measure", unit: "points" },
      ],
    });
    const schoolFilter = fixture.filters.find(
      (filter) => filter.id === "filter-school",
    ) as unknown as {
      mappings: unknown[];
    };
    schoolFilter.mappings = [
      {
        source: { datasetId: "assessment-results", fieldId: "school_id" },
        target: { datasetId: "viewer-other", fieldId: "school_id" },
      },
    ];
    (fixture.blocks as unknown as unknown[]).push({
      id: "table-other",
      type: "table",
      title: "Other rows",
      bindings: [
        {
          id: "other-school",
          role: "dimension",
          field: { datasetId: "viewer-other", fieldId: "school_id" },
        },
        {
          id: "other-score",
          role: "measure",
          field: { datasetId: "viewer-other", fieldId: "score" },
          aggregation: { type: "average" },
        },
      ],
      config: { columns: ["other-school", "other-score"] },
    });
    (fixture.layout.desktop.placements as unknown as unknown[]).push({
      blockId: "table-other",
      x: 0,
      y: 12,
      width: 12,
      height: 4,
    });
    (fixture.layout.tablet?.placements as unknown as unknown[]).push({
      blockId: "table-other",
      x: 0,
      y: 18,
      width: 8,
      height: 4,
    });
    (fixture.layout.narrow?.placements as unknown as unknown[]).push({
      blockId: "table-other",
      x: 0,
      y: 20,
      width: 4,
      height: 4,
    });
    const otherDescriptor: DatasetDescriptor = {
      ...ASSESSMENT_DESCRIPTOR,
      id: "viewer-other",
      label: "Other",
      slices: ASSESSMENT_DESCRIPTOR.slices.map((slice) => ({
        ...slice,
        datasetId: "viewer-other",
      })),
    };
    const runtime = customRuntime([ASSESSMENT_DESCRIPTOR, otherDescriptor]);
    const space = unwrap(runtime.createSpace({ document: fixture }));
    const document = createMiniDocument();
    const target = createTarget(document);
    const handle = unwrap(
      mountBoardView(target as unknown as HTMLElement, { space, theme: "light" }),
    );
    await flush();
    const lease = unwrap(space.acquireEditorLease({ sessionId: "discard-diagnostics" }));
    unwrap(handle.setMode("editor", { lease }));
    await flush();
    const root = rootOf(handle);
    const before =
      (space.getSnapshot().draft?.document as unknown as BoardDocumentV1 | undefined)?.filters
        .length ?? 0;
    const add = findByAttribute(root, "data-filter-action", "add")[0];
    if (add !== undefined) {
      root.dispatchEvent({ type: "click", target: add });
    }
    await flush();
    const pendingRow = findByAttribute(root, "data-filter-pending", "true")[0];
    const pendingId = pendingRow?.getAttribute("data-filter-id") ?? "";
    const targetSelect = findByClass(pendingRow!, "bl-filter-control").find(
      (element) => element.getAttribute("data-filter-control") === "target",
    );
    targetSelect!.value = "board";
    root.dispatchEvent({ type: "change", target: targetSelect! });
    await flush();
    const apply = findByAttribute(root, "data-filter-apply", pendingId)[0];
    if (apply !== undefined) {
      root.dispatchEvent({ type: "click", target: apply });
    }
    await flush();
    expect(findByClass(root, "bl-diagnostic").length).toBeGreaterThan(0);
    expect(
      (space.getSnapshot().draft?.document as unknown as BoardDocumentV1 | undefined)?.filters
        .length ?? 0,
    ).toBe(before);
    const discard = findByAttribute(root, "data-filter-discard", pendingId)[0];
    if (discard !== undefined) {
      root.dispatchEvent({ type: "click", target: discard });
    }
    await flush();
    expect(findByClass(root, "bl-diagnostic")).toHaveLength(0);
    expect(findByAttribute(root, "data-filter-pending", "true")).toHaveLength(0);
    unwrap(handle.unmount({ draftDecision: "cancel" }));
    unwrap(runtime.dispose());
  });
});
