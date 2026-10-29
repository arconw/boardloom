import { describe, expect, it } from "vitest";
import {
  AGGREGATION_TYPES,
  ENGLISH_MESSAGES,
  RENDERER_API_VERSION,
  createBoardValidationCatalog,
  createLocalDatasetProvider,
  createRuntime,
  type BoardDocumentV1,
  type ComparisonDefinition,
  type DatasetDescriptor,
  type JsonValue,
  type RendererDefinition,
} from "../../../../packages/core/src/index.js";
import { mountBoardView } from "../../../../packages/view-dom/src/index.js";
import { unwrap } from "../../core/support/assertions.js";
import { FakeClock, createDeterministicIdFactory } from "../../core/support/fakes.js";
import {
  createMiniDocument,
  findByAttribute,
  findByClass,
  type MiniDocument,
  type MiniElement,
} from "../support/mini-dom.js";

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

function createTarget(document: MiniDocument): MiniElement {
  const target = document.createElement("div");
  target.clientWidth = 1280;
  document.body.append(target);
  return target;
}

function rootOf(handle: { readonly element: HTMLElement }): MiniElement {
  return handle.element as unknown as MiniElement;
}

function dataset(id: string, unit = "points"): DatasetDescriptor {
  return {
    id,
    version: "2026.1",
    timezone: "UTC",
    temporalRepresentation: "iso8601-offset",
    fields: [
      { id: "subject", key: "subject", type: "string", role: "dimension", nullable: false },
      {
        id: "score",
        key: "score",
        type: "number",
        role: "measure",
        nullable: true,
        unit: { unit, ...(unit === "percent" ? { scale: 1 } : {}) },
      },
    ],
    slices: [
      {
        id: `term-${id}`,
        datasetId: id,
        fieldIds: ["subject", "score"],
        supportedOperations: ["filter", "group", "aggregate"],
      },
    ],
    capabilities: {
      grouping: true,
      aggregations: ["average", "sum", "count"],
      filterOperators: ["equals"],
      timeWindow: false,
      timezoneConversion: false,
      local: true,
      pushdownFilters: true,
      serverPaging: false,
      realtime: false,
      comparison: true,
      maxResultSize: null,
    },
  };
}

function rows(
  values: readonly (readonly [string, number | null])[],
): readonly Readonly<Record<string, JsonValue>>[] {
  return values.map(([subject, score]) => ({ subject, score }));
}

function documentFor(
  options: {
    readonly blockType?: "table" | "metric" | "chart";
    readonly displayMode?: "overlay" | "side-by-side";
    readonly deltaMode?: "absolute" | "percentage" | "both" | "none";
    readonly referenceDataset?: string;
    readonly blockConfig?: Record<string, JsonValue>;
    readonly comparisons?: BoardDocumentV1["comparisons"];
    readonly referenceUnit?: string;
    readonly unitPolicy?: ComparisonDefinition["unitPolicy"];
  } = {},
): BoardDocumentV1 {
  const blockType = options.blockType ?? "table";
  const bindings =
    blockType === "metric"
      ? [
          {
            id: "measure",
            role: "measure" as const,
            axis: "y" as const,
            field: { datasetId: "current", fieldId: "score" },
            sliceId: "term-current",
            aggregation: { type: "average" as const },
          },
        ]
      : [
          {
            id: "dimension",
            role: "dimension" as const,
            axis: blockType === "chart" ? ("x" as const) : ("none" as const),
            field: { datasetId: "current", fieldId: "subject" },
            sliceId: "term-current",
          },
          {
            id: "measure",
            role: "measure" as const,
            axis: "y" as const,
            field: { datasetId: "current", fieldId: "score" },
            sliceId: "term-current",
            aggregation: { type: "average" as const },
          },
        ];
  return {
    schemaVersion: 1,
    id: "comparison-ui-board",
    title: "Comparison board",
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    theme: { mode: "light" },
    datasets: [
      {
        id: "current",
        provider: "comparison-ui",
        label: "Current term",
        fields: [
          { id: "subject", type: "string", role: "dimension" },
          { id: "score", type: "number", role: "measure", unit: "points" },
        ],
      },
      {
        id: "previous",
        provider: "comparison-ui",
        label: "Previous term",
        fields: [
          { id: "subject", type: "string", role: "dimension" },
          {
            id: "score",
            type: "number",
            role: "measure",
            unit:
              options.referenceUnit ??
              (options.referenceDataset === "percent" ? "percent" : "points"),
          },
        ],
      },
      {
        id: "percent",
        provider: "comparison-ui",
        label: "Percent term",
        fields: [
          { id: "subject", type: "string", role: "dimension" },
          { id: "score", type: "number", role: "measure", unit: "percent" },
        ],
      },
    ],
    slices: [
      {
        id: "term-current",
        datasetId: "current",
        label: "Current",
        fieldIds: ["subject", "score"],
      },
      {
        id: "term-previous",
        datasetId: "previous",
        label: "Previous",
        fieldIds: ["subject", "score"],
      },
      {
        id: "term-percent",
        datasetId: "percent",
        label: "Percent",
        fieldIds: ["subject", "score"],
      },
    ],
    blocks: [
      {
        id: "block",
        type: blockType,
        title: "Scores",
        bindings,
        config: {
          ...(blockType === "chart" ? { visualization: "bar" } : {}),
          comparisonId: "comparison",
          ...options.blockConfig,
        },
      },
    ],
    filters: [],
    comparisons: options.comparisons ?? [
      {
        id: "comparison",
        label: "Previous term",
        displayMode: options.displayMode ?? "overlay",
        deltaMode: options.deltaMode ?? "both",
        base: { datasetId: "current", sliceId: "term-current" },
        reference:
          options.referenceDataset === "percent"
            ? { datasetId: "percent", sliceId: "term-percent" }
            : { datasetId: "previous", sliceId: "term-previous" },
        mapping: [
          {
            primary: { datasetId: "current", fieldId: "subject" },
            reference: {
              datasetId: options.referenceDataset ?? "previous",
              fieldId: "subject",
            },
            role: "dimension",
          },
          {
            primary: { datasetId: "current", fieldId: "score" },
            reference: {
              datasetId: options.referenceDataset ?? "previous",
              fieldId: "score",
            },
            role: "measure",
          },
        ],
        alignment: { keys: ["subject"], collation: "unicode", normalization: "none" },
        unitPolicy: options.unitPolicy ?? { mode: "identical" },
      },
    ],
    layout: {
      desktop: {
        columns: 12,
        placements: [{ blockId: "block", x: 0, y: 0, width: 12, height: 6 }],
      },
    },
    extensions: {},
  };
}

function runtimeFor(
  primaryRows: readonly Readonly<Record<string, JsonValue>>[],
  referenceRows: readonly Readonly<Record<string, JsonValue>>[],
  referenceUnit = "points",
) {
  const provider = unwrap(
    createLocalDatasetProvider({
      providerId: "comparison-ui",
      datasets: [
        { descriptor: dataset("current"), rows: primaryRows },
        { descriptor: dataset("previous", referenceUnit), rows: referenceRows },
        { descriptor: dataset("percent", "percent"), rows: referenceRows },
      ],
    }),
  );
  return createRuntime({
    clock: new FakeClock(),
    idFactory: createDeterministicIdFactory("comparison-ui"),
    datasetProvider: provider,
    validationCatalog: createBoardValidationCatalog([
      dataset("current"),
      dataset("previous", referenceUnit),
      dataset("percent", "percent"),
    ]),
  });
}

async function mount(
  document: BoardDocumentV1,
  primaryRows: readonly Readonly<Record<string, JsonValue>>[],
  referenceRows: readonly Readonly<Record<string, JsonValue>>[],
  referenceUnit = "points",
  renderers?: readonly RendererDefinition<HTMLElement>[],
) {
  const mini = createMiniDocument();
  const target = createTarget(mini);
  const runtime = runtimeFor(primaryRows, referenceRows, referenceUnit);
  const space = unwrap(runtime.createSpace({ document }));
  const handle = unwrap(
    mountBoardView(target as unknown as HTMLElement, {
      space,
      theme: "light",
      ...(renderers === undefined ? {} : { renderers }),
    }),
  );
  await flush();
  return { mini, runtime, space, handle, root: rootOf(handle) };
}

async function mountCustom(
  document: BoardDocumentV1,
  sources: readonly {
    readonly descriptor: DatasetDescriptor;
    readonly rows: readonly Readonly<Record<string, JsonValue>>[];
  }[],
) {
  const mini = createMiniDocument();
  const target = createTarget(mini);
  const provider = unwrap(
    createLocalDatasetProvider({ providerId: "comparison-ui", datasets: [...sources] }),
  );
  const runtime = createRuntime({
    clock: new FakeClock(),
    idFactory: createDeterministicIdFactory("comparison-ui"),
    datasetProvider: provider,
    validationCatalog: createBoardValidationCatalog(sources.map((source) => source.descriptor)),
  });
  const space = unwrap(runtime.createSpace({ document }));
  const handle = unwrap(
    mountBoardView(target as unknown as HTMLElement, { space, theme: "light" }),
  );
  await flush();
  return { mini, runtime, space, handle, root: rootOf(handle) };
}

function datasetWithCount(id: string): DatasetDescriptor {
  return {
    ...dataset(id),
    fields: [
      { id: "subject", key: "subject", type: "string", role: "dimension", nullable: false },
      {
        id: "score",
        key: "score",
        type: "number",
        role: "measure",
        nullable: true,
        unit: { unit: "points" },
      },
      {
        id: "count",
        key: "count",
        type: "number",
        role: "measure",
        nullable: true,
        unit: { unit: "items" },
      },
    ],
    slices: [
      {
        id: `term-${id}`,
        datasetId: id,
        fieldIds: ["subject", "score", "count"],
        supportedOperations: ["filter", "group", "aggregate"],
      },
    ],
  };
}

function datasetWithGrade(id: string): DatasetDescriptor {
  return {
    ...dataset(id),
    fields: [
      { id: "subject", key: "subject", type: "string", role: "dimension", nullable: false },
      { id: "grade", key: "grade", type: "string", role: "dimension", nullable: false },
      {
        id: "score",
        key: "score",
        type: "number",
        role: "measure",
        nullable: true,
        unit: { unit: "points" },
      },
    ],
    slices: [
      {
        id: `term-${id}`,
        datasetId: id,
        fieldIds: ["subject", "grade", "score"],
        supportedOperations: ["filter", "group", "aggregate"],
      },
    ],
  };
}

function flakyChartRenderer(counter: { value: number }): RendererDefinition<HTMLElement> {
  const base = recordingChartRenderer();
  return {
    ...base,
    id: "test.flaky-chart",
    mount(input) {
      counter.value += 1;
      if (counter.value === 1) {
        throw new Error("Synthetic mount failure");
      }
      const element = input.host.ownerDocument.createElement("div");
      element.className = "bl-flaky-chart";
      element.setAttribute("data-attempt", String(counter.value));
      input.host.append(element);
      return {
        update(next): void {
          element.setAttribute(
            "data-comparison-rows",
            String(next.comparison?.counts.rowCount ?? ""),
          );
        },
        destroy(): void {
          element.remove();
        },
      };
    },
  };
}

function recordingChartRenderer(): RendererDefinition<HTMLElement> {
  return {
    id: "test.recording-chart",
    version: "1.0.0",
    apiVersion: RENDERER_API_VERSION,
    kind: "chart",
    visualizations: ["bar"],
    capabilities: {
      kinds: ["chart"],
      visualizations: ["bar"],
      aggregation: AGGREGATION_TYPES.filter((entry) => entry !== "none"),
      comparison: true,
      series: true,
      stacking: "optional",
      zeroBaseline: "required",
      negativeValues: "supported",
      accessibility: true,
    },
    validate: () => ({ ok: true, diagnostics: [] }),
    mount(input) {
      const doc = input.host.ownerDocument;
      const element = doc.createElement("div");
      element.className = "bl-recording-chart";
      const update = (next: typeof input): void => {
        element.setAttribute("data-spec", JSON.stringify(next.spec));
        element.setAttribute("data-rows", JSON.stringify(next.data.rows));
        element.setAttribute("data-fields", JSON.stringify(next.data.fields));
        element.setAttribute(
          "data-comparison-rows",
          String(next.comparison?.counts.rowCount ?? ""),
        );
      };
      update(input);
      input.host.append(element);
      return {
        update,
        destroy(): void {
          element.remove();
        },
      };
    },
  };
}

describe("T10 comparison presentation and builder", () => {
  it("renders absolute and percentage deltas with explicit missing and zero reasons", async () => {
    const { runtime, handle, root } = await mount(
      documentFor(),
      rows([
        ["math", 5],
        ["negative", 10],
        ["zero-ref", 10],
        ["both-zero", 0],
        ["null-primary", null],
        ["primary-only", 7],
      ]),
      rows([
        ["math", 2],
        ["negative", -5],
        ["zero-ref", 0],
        ["both-zero", 0],
        ["null-primary", 5],
        ["reference-only", 6],
      ]),
    );
    const table = findByClass(root, "bl-comparison-table")[0];
    expect(table).toBeDefined();
    const tableRows = findByClass(root, "bl-table");
    expect(tableRows.length).toBeGreaterThan(0);
    const text = findByClass(root, "bl-comparison-table-region")[0]?.textContent ?? "";
    expect(text).toContain("matched");
    expect(text).toContain("primary-only");
    expect(text).toContain("reference-only");
    const negative = findByAttribute(root, "data-comparison-status", "matched");
    expect(negative.length).toBeGreaterThan(0);
    const zeroRef = findByClass(root, "bl-table__cell").find(
      (cell) =>
        cell.getAttribute("data-delta") === "percentage" &&
        cell.getAttribute("data-reason") === "ZERO_REFERENCE",
    );
    expect(zeroRef).toBeDefined();
    expect(zeroRef?.textContent).toContain("not available");
    const missing = findByClass(root, "bl-table__cell").find(
      (cell) => cell.getAttribute("data-reason") === "PRIMARY_ONLY",
    );
    expect(missing).toBeDefined();
    expect(missing?.textContent).toContain("Not available");
    unwrap(handle.unmount({ draftDecision: "cancel" }));
    unwrap(runtime.dispose());
  });

  it("renders side-by-side mode and only the requested delta", async () => {
    const { runtime, handle, root } = await mount(
      documentFor({ displayMode: "side-by-side", deltaMode: "percentage" }),
      rows([["math", 5]]),
      rows([["math", 2]]),
    );
    const region = findByClass(root, "bl-comparison-table-region")[0];
    expect(findByAttribute(root, "data-comparison-mode", "side-by-side").length).toBeGreaterThan(0);
    const percentage = findByClass(root, "bl-table__cell").filter(
      (cell) => cell.getAttribute("data-delta") === "percentage",
    );
    const absolute = findByClass(root, "bl-table__cell").filter(
      (cell) => cell.getAttribute("data-delta") === "absolute",
    );
    expect(percentage.length).toBeGreaterThan(0);
    expect(absolute).toHaveLength(0);
    expect(region?.textContent).toContain("150");
    unwrap(handle.unmount({ draftDecision: "cancel" }));
    unwrap(runtime.dispose());
  });

  it("shows metric comparison deltas and never fabricates a zero percentage", async () => {
    const { runtime, handle, root } = await mount(
      documentFor({ blockType: "metric" }),
      rows([["math", 10]]),
      rows([["math", 0]]),
    );
    const delta = findByClass(root, "bl-comparison-delta").find(
      (element) => element.getAttribute("data-delta") === "percentage",
    );
    expect(delta?.getAttribute("data-delta-status")).toBe("unavailable");
    expect(delta?.getAttribute("data-reason")).toBe("ZERO_REFERENCE");
    expect(delta?.textContent).toContain("not available");
    expect(delta?.textContent).not.toContain("Infinity");
    expect(delta?.textContent).not.toContain("NaN");
    unwrap(handle.unmount({ draftDecision: "cancel" }));
    unwrap(runtime.dispose());
  });

  it("rejects incompatible reference units from the comparison builder without mutating the draft", async () => {
    const { runtime, space, handle, root } = await mount(
      documentFor({ blockType: "table" }),
      rows([["math", 5]]),
      rows([["math", 2]]),
    );
    const lease = unwrap(space.acquireEditorLease({ sessionId: "comparison-builder" }));
    unwrap(handle.setMode("editor", { lease }));
    await flush();
    const reference = findByClass(root, "bl-comparison-control").find(
      (element) => element.getAttribute("data-comparison-control") === "reference",
    );
    expect(reference).toBeDefined();
    if (reference !== undefined) {
      reference.value = "percent|term-percent";
      root.dispatchEvent({ type: "change", target: reference });
      await flush();
    }
    const diagnostics = findByClass(root, "bl-diagnostic__code").map(
      (element) => element.textContent,
    );
    expect(diagnostics).toContain("INCOMPATIBLE_COMPARISON");
    expect(root.textContent).toContain(
      "The comparison mapping, units or alignment are incompatible.",
    );
    expect(root.textContent).toContain("comparisons/comparison/unitPolicy");
    const detail = findByClass(root, "bl-diagnostic__detail")[0];
    expect(detail?.textContent).toBe(
      ENGLISH_MESSAGES["diagnostic.detail.comparison.unitsIncompatible"],
    );
    const draft = space.getSnapshot().draft?.document as BoardDocumentV1 | undefined;
    expect(draft?.comparisons?.[0]?.reference.datasetId).toBe("previous");
    unwrap(space.cancelDraft(lease));
    unwrap(handle.unmount({ draftDecision: "cancel" }));
    unwrap(runtime.dispose());
  });

  it("renders chart overlay and side-by-side series without fabricating missing values", async () => {
    const overlay = await mount(
      documentFor({ blockType: "chart" }),
      rows([
        ["math", 5],
        ["missing", 7],
      ]),
      rows([
        ["math", 2],
        ["other-only", 9],
      ]),
      "points",
      [recordingChartRenderer()],
    );
    const overlayCharts = findByClass(overlay.root, "bl-recording-chart");
    expect(overlayCharts).toHaveLength(1);
    const overlayRows = JSON.parse(overlayCharts[0]?.getAttribute("data-rows") ?? "[]") as Array<
      Record<string, JsonValue>
    >;
    expect(overlayRows).toHaveLength(4);
    expect(overlayRows.map((row) => row["__comparison_side"])).toEqual([
      "Primary",
      "Reference",
      "Primary",
      "Reference",
    ]);
    expect(overlayRows.map((row) => row.measure)).toEqual([5, 2, 7, 9]);
    expect(overlayRows.some((row) => row.measure === 0)).toBe(false);
    const overlaySpec = JSON.parse(overlayCharts[0]?.getAttribute("data-spec") ?? "{}") as {
      readonly series?: { readonly fieldId?: string };
    };
    expect(overlaySpec.series?.fieldId).toBe("__comparison_side");
    expect(overlayCharts[0]?.getAttribute("data-comparison-rows")).toBe("3");
    expect(findByClass(overlay.root, "bl-comparison-table")).toHaveLength(1);
    expect(
      findByClass(overlay.root, "bl-table__cell").filter(
        (cell) => cell.getAttribute("data-delta") === "percentage",
      ).length,
    ).toBeGreaterThan(0);
    unwrap(overlay.handle.unmount({ draftDecision: "cancel" }));
    unwrap(overlay.runtime.dispose());

    const side = await mount(
      documentFor({ blockType: "chart", displayMode: "side-by-side" }),
      rows([["math", 5]]),
      rows([["math", 2]]),
      "points",
      [recordingChartRenderer()],
    );
    const sideCharts = findByClass(side.root, "bl-recording-chart");
    expect(sideCharts).toHaveLength(2);
    const sideRows = sideCharts.map(
      (chart) =>
        JSON.parse(chart.getAttribute("data-rows") ?? "[]") as Array<Record<string, JsonValue>>,
    );
    expect(sideRows[0]?.[0]?.measure).toBe(5);
    expect(sideRows[1]?.[0]?.measure).toBe(2);
    unwrap(side.handle.unmount({ draftDecision: "cancel" }));
    unwrap(side.runtime.dispose());
  });

  it("shows side-by-side values in their own units with deltas disabled", async () => {
    const { runtime, handle, root } = await mount(
      documentFor({
        blockType: "table",
        displayMode: "side-by-side",
        deltaMode: "none",
        referenceDataset: "percent",
        referenceUnit: "percent",
      }),
      rows([["math", 5]]),
      rows([["math", 4]]),
      "percent",
    );
    expect(findByAttribute(root, "data-comparison-mode", "side-by-side").length).toBeGreaterThan(0);
    const cells = findByClass(root, "bl-table__cell");
    const primary = cells.find((cell) => cell.getAttribute("data-comparison-side") === "primary");
    const reference = cells.find(
      (cell) => cell.getAttribute("data-comparison-side") === "reference",
    );
    expect(primary?.textContent).toContain("5 points");
    expect(reference?.textContent).toContain("4%");
    expect(cells.filter((cell) => cell.getAttribute("data-delta") !== null)).toHaveLength(0);
    unwrap(handle.unmount({ draftDecision: "cancel" }));
    unwrap(runtime.dispose());
  });

  it("displays the converted reference operand in the primary unit beside a consistent delta", async () => {
    const { runtime, handle, root } = await mount(
      documentFor({
        blockType: "table",
        referenceDataset: "percent",
        referenceUnit: "percent",
        unitPolicy: {
          mode: "explicit",
          conversions: [
            {
              from: "points",
              to: "percent",
              factor: 2,
              provider: "local.fixture",
              lossless: true,
            },
          ],
        },
      }),
      rows([["math", 5]]),
      rows([["math", 4]]),
      "percent",
    );
    const cells = findByClass(root, "bl-table__cell");
    const reference = cells.find(
      (cell) => cell.getAttribute("data-comparison-side") === "reference",
    );
    const absolute = cells.find((cell) => cell.getAttribute("data-delta") === "absolute");
    expect(reference?.textContent).toContain("2 points");
    expect(reference?.textContent).not.toContain("4");
    expect(absolute?.textContent).toContain("3 points");
    expect(root.textContent).toContain("Reference converted from points to percent");
    unwrap(handle.unmount({ draftDecision: "cancel" }));
    unwrap(runtime.dispose());
  });

  it("releases both comparison queries when the view unmounts", async () => {
    const { runtime, space, handle } = await mount(
      documentFor(),
      rows([["math", 5]]),
      rows([["math", 2]]),
    );
    expect(space.getQueryStates()).toHaveLength(2);
    unwrap(handle.unmount({ draftDecision: "cancel" }));
    expect(space.getQueryStates()).toHaveLength(0);
    unwrap(runtime.dispose());
  });

  it("resolves alignment-key formatting through the comparison primary dataset", async () => {
    const template = documentFor({ blockType: "table" });
    const block = template.blocks[0];
    if (block === undefined) {
      return;
    }
    const decoy = {
      ...dataset("decoy"),
      fields: [
        {
          id: "subject",
          key: "subject",
          type: "date" as const,
          role: "dimension" as const,
          nullable: false,
          timezone: "Pacific/Auckland",
        },
        {
          id: "score",
          key: "score",
          type: "number" as const,
          role: "measure" as const,
          nullable: true,
          unit: { unit: "points" },
        },
      ],
      slices: [],
    };
    const document = {
      ...template,
      datasets: [
        {
          id: "decoy",
          provider: "comparison-ui",
          fields: [
            { id: "subject", type: "date", role: "dimension", timezone: "Pacific/Auckland" },
            { id: "score", type: "number", role: "measure", unit: "points" },
          ],
        },
        ...template.datasets,
      ],
      blocks: [
        {
          ...block,
          config: { comparisonId: "comparison" },
        },
      ],
    } as BoardDocumentV1;
    const { runtime, handle, root } = await mountCustom(document, [
      { descriptor: decoy, rows: [] },
      { descriptor: dataset("current"), rows: rows([["math", 5]]) },
      { descriptor: dataset("previous"), rows: rows([["math", 2]]) },
      { descriptor: dataset("percent", "percent"), rows: [] },
    ]);
    const text = findByClass(root, "bl-comparison-table")[0]?.textContent ?? "";
    expect(text).toContain("math");
    expect(text).not.toContain("Not available");
    unwrap(handle.unmount({ draftDecision: "cancel" }));
    unwrap(runtime.dispose());
  });

  it("does not present mapped measures that the block does not bind", async () => {
    const template = documentFor({ blockType: "table" });
    const block = template.blocks[0];
    const comparison = template.comparisons?.[0];
    if (block === undefined || comparison === undefined) {
      return;
    }
    const current = datasetWithCount("current");
    const previous = datasetWithCount("previous");
    const document = {
      ...template,
      datasets: [
        {
          id: "current",
          provider: "comparison-ui",
          fields: [
            { id: "subject", type: "string", role: "dimension" },
            { id: "score", type: "number", role: "measure", unit: "points" },
            { id: "count", type: "number", role: "measure", unit: "items" },
          ],
        },
        {
          id: "previous",
          provider: "comparison-ui",
          fields: [
            { id: "subject", type: "string", role: "dimension" },
            { id: "score", type: "number", role: "measure", unit: "points" },
            { id: "count", type: "number", role: "measure", unit: "items" },
          ],
        },
      ],
      slices: [
        {
          id: "term-current",
          datasetId: "current",
          fieldIds: ["subject", "score", "count"],
        },
        {
          id: "term-previous",
          datasetId: "previous",
          fieldIds: ["subject", "score", "count"],
        },
      ],
      blocks: [
        {
          ...block,
          config: { comparisonId: "comparison" },
          bindings: [
            {
              id: "dimension",
              role: "dimension",
              field: { datasetId: "current", fieldId: "subject" },
              sliceId: "term-current",
            },
            {
              id: "measure",
              role: "measure",
              field: { datasetId: "current", fieldId: "score" },
              sliceId: "term-current",
              aggregation: { type: "average" },
            },
          ],
        },
      ],
      comparisons: [
        {
          ...comparison,
          base: { datasetId: "current", sliceId: "term-current" },
          reference: { datasetId: "previous", sliceId: "term-previous" },
          mapping: [
            {
              primary: { datasetId: "current", fieldId: "subject" },
              reference: { datasetId: "previous", fieldId: "subject" },
              role: "dimension",
            },
            {
              primary: { datasetId: "current", fieldId: "score" },
              reference: { datasetId: "previous", fieldId: "score" },
              role: "measure",
            },
            {
              primary: { datasetId: "current", fieldId: "count" },
              reference: { datasetId: "previous", fieldId: "count" },
              role: "measure",
            },
          ],
        },
      ],
    } as BoardDocumentV1;
    const { runtime, handle, root } = await mountCustom(document, [
      {
        descriptor: current,
        rows: [{ subject: "math", score: 5, count: 99 }],
      },
      {
        descriptor: previous,
        rows: [{ subject: "math", score: 2, count: 77 }],
      },
    ]);
    const measureHeaders = findByAttribute(root, "data-measure").map(
      (element) => element.textContent,
    );
    expect(measureHeaders.join(" ")).not.toContain("count");
    expect(root.textContent).not.toContain("count: 0");
    unwrap(handle.unmount({ draftDecision: "cancel" }));
    unwrap(runtime.dispose());
  });

  it("rejects a builder alignment key outside the block grouping before draft acceptance", async () => {
    const template = documentFor({ blockType: "table" });
    const block = template.blocks[0];
    const comparison = template.comparisons?.[0];
    if (block === undefined || comparison === undefined) {
      return;
    }
    const current = datasetWithGrade("current");
    const previous = datasetWithGrade("previous");
    const mapping = [
      {
        primary: { datasetId: "current", fieldId: "subject" },
        reference: { datasetId: "previous", fieldId: "subject" },
        role: "dimension" as const,
      },
      {
        primary: { datasetId: "current", fieldId: "grade" },
        reference: { datasetId: "previous", fieldId: "grade" },
        role: "dimension" as const,
      },
      {
        primary: { datasetId: "current", fieldId: "score" },
        reference: { datasetId: "previous", fieldId: "score" },
        role: "measure" as const,
      },
    ];
    const document = {
      ...template,
      datasets: [
        {
          id: "current",
          provider: "comparison-ui",
          fields: [
            { id: "subject", type: "string", role: "dimension" },
            { id: "grade", type: "string", role: "dimension" },
            { id: "score", type: "number", role: "measure", unit: "points" },
          ],
        },
        {
          id: "previous",
          provider: "comparison-ui",
          fields: [
            { id: "subject", type: "string", role: "dimension" },
            { id: "grade", type: "string", role: "dimension" },
            { id: "score", type: "number", role: "measure", unit: "points" },
          ],
        },
      ],
      slices: [
        { id: "term-current", datasetId: "current", fieldIds: ["subject", "grade", "score"] },
        { id: "term-previous", datasetId: "previous", fieldIds: ["subject", "grade", "score"] },
      ],
      blocks: [
        {
          ...block,
          config: { comparisonId: "comparison" },
          bindings: [
            {
              id: "dimension",
              role: "dimension",
              field: { datasetId: "current", fieldId: "subject" },
              sliceId: "term-current",
            },
            {
              id: "measure",
              role: "measure",
              field: { datasetId: "current", fieldId: "score" },
              sliceId: "term-current",
              aggregation: { type: "average" },
            },
          ],
        },
      ],
      comparisons: [
        {
          ...comparison,
          base: { datasetId: "current", sliceId: "term-current" },
          reference: { datasetId: "previous", sliceId: "term-previous" },
          mapping,
          alignment: { keys: ["subject"], collation: "unicode", normalization: "none" },
        },
      ],
    } as BoardDocumentV1;
    const { runtime, space, handle, root } = await mountCustom(document, [
      {
        descriptor: current,
        rows: [{ subject: "math", grade: "A", score: 5 }],
      },
      {
        descriptor: previous,
        rows: [{ subject: "math", grade: "A", score: 2 }],
      },
    ]);
    const lease = unwrap(space.acquireEditorLease({ sessionId: "comparison-alignment-reject" }));
    unwrap(handle.setMode("editor", { lease }));
    await flush();
    const alignment = findByClass(root, "bl-comparison-control").find(
      (element) =>
        element.getAttribute("data-comparison-control") === "alignment" &&
        element.getAttribute("data-comparison-field") === "grade",
    );
    expect(alignment).toBeDefined();
    if (alignment !== undefined) {
      (alignment as unknown as { checked: boolean }).checked = true;
      root.dispatchEvent({ type: "change", target: alignment });
    }
    await flush();
    const draft = space.getSnapshot().draft?.document as BoardDocumentV1 | undefined;
    expect(draft?.comparisons?.[0]?.alignment.keys).toEqual(["subject"]);
    expect(
      findByClass(root, "bl-diagnostic__code").map((element) => element.textContent),
    ).toContain("COMPARISON_ALIGNMENT_INVALID");
    unwrap(space.cancelDraft(lease));
    unwrap(handle.unmount({ draftDecision: "cancel" }));
    unwrap(runtime.dispose());
  });

  it("recovers after a duplicate-key comparison error when the draft adds an alignment key", async () => {
    const template = documentFor({ blockType: "table" });
    const block = template.blocks[0];
    const comparison = template.comparisons?.[0];
    if (block === undefined || comparison === undefined) {
      return;
    }
    const current = datasetWithGrade("current");
    const previous = datasetWithGrade("previous");
    const mapping = [
      {
        primary: { datasetId: "current", fieldId: "subject" },
        reference: { datasetId: "previous", fieldId: "subject" },
        role: "dimension" as const,
      },
      {
        primary: { datasetId: "current", fieldId: "grade" },
        reference: { datasetId: "previous", fieldId: "grade" },
        role: "dimension" as const,
      },
      {
        primary: { datasetId: "current", fieldId: "score" },
        reference: { datasetId: "previous", fieldId: "score" },
        role: "measure" as const,
      },
    ];
    const document = {
      ...template,
      datasets: [
        {
          id: "current",
          provider: "comparison-ui",
          fields: [
            { id: "subject", type: "string", role: "dimension" },
            { id: "grade", type: "string", role: "dimension" },
            { id: "score", type: "number", role: "measure", unit: "points" },
          ],
        },
        {
          id: "previous",
          provider: "comparison-ui",
          fields: [
            { id: "subject", type: "string", role: "dimension" },
            { id: "grade", type: "string", role: "dimension" },
            { id: "score", type: "number", role: "measure", unit: "points" },
          ],
        },
      ],
      slices: [
        {
          id: "term-current",
          datasetId: "current",
          fieldIds: ["subject", "grade", "score"],
        },
        {
          id: "term-previous",
          datasetId: "previous",
          fieldIds: ["subject", "grade", "score"],
        },
      ],
      blocks: [
        {
          ...block,
          config: { comparisonId: "comparison" },
          bindings: [
            {
              id: "dimension",
              role: "dimension",
              field: { datasetId: "current", fieldId: "subject" },
              sliceId: "term-current",
            },
            {
              id: "grade",
              role: "group",
              field: { datasetId: "current", fieldId: "grade" },
              sliceId: "term-current",
            },
            {
              id: "measure",
              role: "measure",
              field: { datasetId: "current", fieldId: "score" },
              sliceId: "term-current",
              aggregation: { type: "average" },
            },
          ],
        },
      ],
      comparisons: [
        {
          ...comparison,
          base: { datasetId: "current", sliceId: "term-current" },
          reference: { datasetId: "previous", sliceId: "term-previous" },
          mapping,
          alignment: { keys: ["subject"], collation: "unicode", normalization: "none" },
        },
      ],
    } as BoardDocumentV1;
    const { runtime, space, handle, root } = await mountCustom(document, [
      {
        descriptor: current,
        rows: [
          { subject: "math", grade: "A", score: 5 },
          { subject: "math", grade: "B", score: 7 },
        ],
      },
      {
        descriptor: previous,
        rows: [
          { subject: "math", grade: "A", score: 2 },
          { subject: "math", grade: "B", score: 4 },
        ],
      },
    ]);
    expect(findByClass(root, "bl-comparison-table")).toHaveLength(0);
    expect(
      findByClass(root, "bl-diagnostic__code").map((element) => element.textContent),
    ).toContain("DUPLICATE_ALIGNMENT_KEY");

    const lease = unwrap(space.acquireEditorLease({ sessionId: "comparison-recovery" }));
    unwrap(handle.setMode("editor", { lease }));
    await flush();
    const currentDocument =
      space.getSnapshot().draft?.document ?? space.getSnapshot().committedDocument;
    const recovered = {
      ...(currentDocument as unknown as BoardDocumentV1),
      comparisons: [
        {
          ...comparison,
          base: { datasetId: "current", sliceId: "term-current" },
          reference: { datasetId: "previous", sliceId: "term-previous" },
          mapping,
          alignment: {
            keys: ["subject", "grade"],
            collation: "unicode",
            normalization: "none",
          },
        },
      ],
    } as BoardDocumentV1;
    unwrap(space.updateDraft(lease, recovered));
    await flush();
    expect(findByClass(root, "bl-comparison-table")).toHaveLength(1);
    expect(findByClass(root, "bl-table")[0]?.textContent).toContain("math");
    unwrap(space.cancelDraft(lease));
    unwrap(handle.unmount({ draftDecision: "cancel" }));
    unwrap(runtime.dispose());
  });

  it("offers a side-by-side delta-disabled comparison when units differ", async () => {
    const template = documentFor({ blockType: "table", comparisons: [], blockConfig: {} });
    const block = template.blocks[0];
    if (block === undefined) {
      return;
    }
    const document = {
      ...template,
      datasets: [
        {
          id: "current",
          provider: "comparison-ui",
          label: "Current",
          fields: [
            { id: "subject", type: "string", role: "dimension" },
            { id: "score", type: "number", role: "measure", unit: "points" },
          ],
        },
        {
          id: "previous",
          provider: "comparison-ui",
          label: "Previous",
          fields: [
            { id: "subject", type: "string", role: "dimension" },
            { id: "score", type: "number", role: "measure", unit: "percent" },
          ],
        },
      ],
      slices: [
        { id: "term-current", datasetId: "current", fieldIds: ["subject", "score"] },
        { id: "term-previous", datasetId: "previous", fieldIds: ["subject", "score"] },
      ],
      blocks: [
        {
          ...block,
          config: {},
          bindings: [
            {
              id: "dimension",
              role: "dimension",
              field: { datasetId: "current", fieldId: "subject" },
              sliceId: "term-current",
            },
            {
              id: "measure",
              role: "measure",
              field: { datasetId: "current", fieldId: "score" },
              sliceId: "term-current",
              aggregation: { type: "average" },
            },
          ],
        },
      ],
      comparisons: [],
    } as BoardDocumentV1;
    const { runtime, space, handle, root } = await mountCustom(document, [
      { descriptor: dataset("current"), rows: rows([["math", 5]]) },
      { descriptor: dataset("previous", "percent"), rows: rows([["math", 4]]) },
    ]);
    const lease = unwrap(space.acquireEditorLease({ sessionId: "comparison-unit-alternative" }));
    unwrap(handle.setMode("editor", { lease }));
    await flush();
    const add = findByAttribute(root, "data-comparison-action", "add")[0];
    if (add !== undefined) {
      root.dispatchEvent({ type: "click", target: add });
    }
    await flush();
    const draft = space.getSnapshot().draft?.document as BoardDocumentV1 | undefined;
    const comparison = draft?.comparisons?.[0];
    expect(comparison?.displayMode).toBe("side-by-side");
    expect(comparison?.deltaMode).toBe("none");
    expect(findByAttribute(root, "data-comparison-mode", "side-by-side").length).toBeGreaterThan(0);
    expect(
      findByClass(root, "bl-table__cell").filter(
        (cell) => cell.getAttribute("data-delta") !== null,
      ),
    ).toHaveLength(0);
    unwrap(space.cancelDraft(lease));
    unwrap(handle.unmount({ draftDecision: "cancel" }));
    unwrap(runtime.dispose());
  });

  it("creates an explicit mapping when compatible fields use different ids", async () => {
    const template = documentFor({ blockType: "table", comparisons: [], blockConfig: {} });
    const block = template.blocks[0];
    if (block === undefined) {
      return;
    }
    const document = {
      ...template,
      datasets: [
        {
          id: "current",
          provider: "comparison-ui",
          label: "Current",
          fields: [
            { id: "student", type: "string", role: "dimension" },
            { id: "score", type: "number", role: "measure", unit: "points" },
          ],
        },
        {
          id: "previous",
          provider: "comparison-ui",
          label: "Previous",
          fields: [
            { id: "subject", type: "string", role: "dimension" },
            { id: "pct", type: "number", role: "measure", unit: "percent" },
          ],
        },
      ],
      slices: [
        {
          id: "term-current",
          datasetId: "current",
          fieldIds: ["student", "score"],
        },
        {
          id: "term-previous",
          datasetId: "previous",
          fieldIds: ["subject", "pct"],
        },
      ],
      blocks: [
        {
          ...block,
          config: {},
          bindings: [
            {
              id: "dimension",
              role: "dimension",
              field: { datasetId: "current", fieldId: "student" },
              sliceId: "term-current",
            },
            {
              id: "measure",
              role: "measure",
              axis: "y",
              field: { datasetId: "current", fieldId: "score" },
              sliceId: "term-current",
              aggregation: { type: "average" },
            },
          ],
        },
      ],
      comparisons: [],
    } as BoardDocumentV1;
    const current = {
      ...dataset("current"),
      fields: [
        { id: "student", key: "student", type: "string", role: "dimension", nullable: false },
        {
          id: "score",
          key: "score",
          type: "number",
          role: "measure",
          nullable: true,
          unit: { unit: "points" },
        },
      ],
      slices: [
        {
          id: "term-current",
          datasetId: "current",
          fieldIds: ["student", "score"],
          supportedOperations: ["filter", "group", "aggregate"],
        },
      ],
    } as DatasetDescriptor;
    const previous = {
      ...dataset("previous", "percent"),
      fields: [
        { id: "subject", key: "subject", type: "string", role: "dimension", nullable: false },
        {
          id: "pct",
          key: "pct",
          type: "number",
          role: "measure",
          nullable: true,
          unit: { unit: "percent", scale: 1 },
        },
      ],
      slices: [
        {
          id: "term-previous",
          datasetId: "previous",
          fieldIds: ["subject", "pct"],
          supportedOperations: ["filter", "group", "aggregate"],
        },
      ],
    } as DatasetDescriptor;
    const { runtime, space, handle, root } = await mountCustom(document, [
      { descriptor: current, rows: [{ student: "math", score: 5 }] },
      { descriptor: previous, rows: [{ subject: "math", pct: 2 }] },
    ]);
    const lease = unwrap(space.acquireEditorLease({ sessionId: "comparison-different-ids" }));
    unwrap(handle.setMode("editor", { lease }));
    await flush();
    const add = findByAttribute(root, "data-comparison-action", "add")[0];
    if (add !== undefined) {
      root.dispatchEvent({ type: "click", target: add });
    }
    await flush();
    const draft = space.getSnapshot().draft?.document as BoardDocumentV1 | undefined;
    expect(draft?.comparisons).toHaveLength(1);
    const mapping = draft?.comparisons?.[0]?.mapping;
    expect(mapping).toContainEqual(
      expect.objectContaining({
        primary: { datasetId: "current", fieldId: "student" },
        reference: { datasetId: "previous", fieldId: "subject" },
      }),
    );
    expect(mapping).toContainEqual(
      expect.objectContaining({
        primary: { datasetId: "current", fieldId: "score" },
        reference: { datasetId: "previous", fieldId: "pct" },
      }),
    );
    expect(draft?.comparisons?.[0]?.alignment.keys).toEqual(["student"]);
    expect(draft?.comparisons?.[0]?.displayMode).toBe("side-by-side");
    expect(draft?.comparisons?.[0]?.deltaMode).toBe("none");
    unwrap(space.cancelDraft(lease));
    unwrap(handle.unmount({ draftDecision: "cancel" }));
    unwrap(runtime.dispose());
  });

  it("surfaces chart renderer failures and retries after a renderer recovers", async () => {
    const counter = { value: 0 };
    const { runtime, handle, root } = await mount(
      documentFor({ blockType: "chart" }),
      rows([["math", 5]]),
      rows([["math", 2]]),
      "points",
      [flakyChartRenderer(counter)],
    );
    expect(counter.value).toBe(1);
    expect(findByClass(root, "bl-flaky-chart")).toHaveLength(0);
    expect(
      findByClass(root, "bl-diagnostic__code").map((element) => element.textContent),
    ).toContain("RENDERER_FAILED");
    unwrap(handle.update({ messages: { "chart.missing": "No value" } }));
    await flush();
    expect(counter.value).toBe(2);
    expect(findByClass(root, "bl-flaky-chart")).toHaveLength(1);
    expect(findByClass(root, "bl-state--error")).toHaveLength(0);
    expect(
      findByClass(root, "bl-diagnostic__code").map((element) => element.textContent),
    ).not.toContain("RENDERER_FAILED");
    unwrap(handle.unmount({ draftDecision: "cancel" }));
    unwrap(runtime.dispose());
  });

  it("adds a comparison and edits display, delta, alignment and attachment through the builder", async () => {
    const document = documentFor({
      blockType: "table",
      comparisons: [],
      blockConfig: {},
    });
    const block = document.blocks[0];
    if (block !== undefined) {
      const { comparisonId: _comparisonId, ...config } = block.config;
      void _comparisonId;
      (document.blocks as BoardDocumentV1["blocks"][number][])[0] = { ...block, config };
    }
    const { runtime, space, handle, root } = await mount(
      document,
      rows([
        ["math", 5],
        ["reading", 4],
      ]),
      rows([
        ["math", 2],
        ["reading", 8],
      ]),
    );
    const lease = unwrap(space.acquireEditorLease({ sessionId: "comparison-add" }));
    unwrap(handle.setMode("editor", { lease }));
    await flush();
    const add = findByAttribute(root, "data-comparison-action", "add")[0];
    expect(add).toBeDefined();
    if (add !== undefined) {
      root.dispatchEvent({ type: "click", target: add });
    }
    await flush();
    let draft = space.getSnapshot().draft?.document as BoardDocumentV1 | undefined;
    expect(draft?.comparisons).toHaveLength(1);
    const comparison = draft?.comparisons?.[0];
    expect(comparison?.base.datasetId).toBe("current");
    expect(comparison?.reference.datasetId).toBe("previous");
    expect(comparison?.mapping.some((entry) => entry.role === "measure")).toBe(true);
    expect(comparison?.alignment.keys.length).toBeGreaterThan(0);
    expect(draft?.blocks[0]?.config.comparisonId).toBe(comparison?.id);

    const display = findByClass(root, "bl-comparison-control").find(
      (element) => element.getAttribute("data-comparison-control") === "displayMode",
    );
    if (display !== undefined) {
      display.value = "side-by-side";
      root.dispatchEvent({ type: "change", target: display });
      await flush();
    }
    draft = space.getSnapshot().draft?.document as BoardDocumentV1 | undefined;
    expect(draft?.comparisons?.[0]?.displayMode).toBe("side-by-side");

    const delta = findByClass(root, "bl-comparison-control").find(
      (element) => element.getAttribute("data-comparison-control") === "deltaMode",
    );
    if (delta !== undefined) {
      delta.value = "percentage";
      root.dispatchEvent({ type: "change", target: delta });
      await flush();
    }
    draft = space.getSnapshot().draft?.document as BoardDocumentV1 | undefined;
    expect(draft?.comparisons?.[0]?.deltaMode).toBe("percentage");

    unwrap(space.cancelDraft(lease));
    unwrap(handle.unmount({ draftDecision: "cancel" }));
    unwrap(runtime.dispose());
  });
});
