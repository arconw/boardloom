import { describe, expect, it } from "vitest";
import {
  assertFixedBindingsPreserved,
  createEmptyBoardDocument,
  describeBindingSlots,
  setBindingSlot,
  validateBoardDocument,
  type BindingDefinition,
  type BoardDocumentV1,
  type BoardValidationCatalog,
  type FieldDescriptor,
} from "../../../../packages/core/src/index.js";

const fields: readonly FieldDescriptor[] = [
  { id: "category", type: "string", role: "dimension" },
  { id: "series", type: "string", role: "dimension" },
  { id: "alt", type: "string", role: "dimension" },
  { id: "value", type: "number", role: "measure", unit: "points" },
  { id: "alternate", type: "number", role: "measure", unit: "points" },
];

function binding(
  id: string,
  role: BindingDefinition["role"],
  fieldId: string,
  extra: Partial<BindingDefinition> = {},
): BindingDefinition {
  return {
    id,
    role,
    field: { datasetId: "dataset", fieldId },
    ...extra,
  };
}

function chartDocument(overrides: { readonly fixedMeasure?: boolean } = {}): BoardDocumentV1 {
  const base = createEmptyBoardDocument({ id: "binding-board", title: "Bindings", createdAt: 1 });
  return {
    ...base,
    datasets: [{ id: "dataset", fields }],
    slices: [{ id: "slice", datasetId: "dataset", fieldIds: fields.map((field) => field.id) }],
    blocks: [
      {
        id: "chart",
        type: "chart",
        title: "Scores",
        bindings: [
          binding("chart-x", "dimension", "category", { axis: "x" }),
          binding("chart-y", "measure", "value", {
            axis: "y",
            sliceId: "slice",
            ...(overrides.fixedMeasure === true ? { mode: "fixed" } : {}),
            aggregation: { type: "average" },
          }),
        ],
        config: { visualization: "bar" },
      },
    ],
    layout: {
      desktop: {
        columns: 12,
        placements: [{ blockId: "chart", x: 0, y: 0, width: 12, height: 4 }],
      },
    },
  };
}

function providerCatalog(
  aggregations: readonly string[] = ["count", "sum", "average", "min", "max", "mode"],
  grouping = true,
): BoardValidationCatalog {
  return {
    datasets: {
      dataset: {
        fields: Object.fromEntries(
          fields.map((field) => [
            field.id,
            {
              type: field.type,
              ...(field.role === undefined ? {} : { role: field.role }),
              ...(field.unit === undefined ? {} : { unit: field.unit }),
            },
          ]),
        ),
        slices: { slice: fields.map((field) => field.id) },
        capabilities: { grouping, aggregations },
      },
    },
  } as unknown as BoardValidationCatalog;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function slot(
  document: BoardDocumentV1,
  name: "x" | "y" | "series" | "group",
  catalog: BoardValidationCatalog = providerCatalog(),
) {
  const described = describeBindingSlots(document, "chart", { catalog });
  if (!described.ok) {
    throw new Error(described.diagnostics.map((diagnostic) => diagnostic.code).join(","));
  }
  const found = described.value.find((entry) => entry.slot === name);
  if (!found) {
    throw new Error(`missing ${name} slot`);
  }
  return found;
}

describe("T08 shared binding model", () => {
  it("describes X, Y, series and group slots with selected values", () => {
    const document = chartDocument();
    const x = slot(document, "x");
    expect(x.selectedField).toEqual({ datasetId: "dataset", fieldId: "category" });
    expect(x.locked).toBe(false);
    const y = slot(document, "y");
    expect(y.selectedField).toEqual({ datasetId: "dataset", fieldId: "value" });
    expect(y.selectedAggregation).toBe("average");
    expect(slot(document, "series").bindingId).toBeNull();
    expect(slot(document, "group").bindingId).toBeNull();
  });

  it("marks aggregation options using the visualization and provider capabilities", () => {
    const document = chartDocument();
    const y = slot(document, "y");
    const byType = new Map(y.aggregations.map((option) => [option.type, option.enabled]));
    expect(byType.get("average")).toBe(true);
    expect(byType.get("sum")).toBe(true);
    expect(byType.get("count")).toBe(true);
    expect(byType.get("min")).toBe(true);
    expect(byType.get("max")).toBe(true);
    expect(byType.get("median")).toBe(false);
    expect(byType.get("none")).toBe(false);

    const restricted = slot(document, "y", providerCatalog(["average"]));
    const restrictedByType = new Map(
      restricted.aggregations.map((option) => [option.type, option]),
    );
    expect(restrictedByType.get("average")?.enabled).toBe(true);
    expect(restrictedByType.get("sum")?.enabled).toBe(false);
    expect(restrictedByType.get("sum")?.reason?.code).toBe("PROVIDER_CAPABILITY_MISMATCH");
  });

  it("changes a selectable binding without mutating the source document", () => {
    const document = chartDocument();
    const before = clone(document);
    const changed = setBindingSlot(
      document,
      {
        blockId: "chart",
        slot: "y",
        field: { datasetId: "dataset", fieldId: "alternate" },
        aggregation: "sum",
      },
      { catalog: providerCatalog() },
    );
    expect(changed.ok).toBe(true);
    if (!changed.ok) {
      return;
    }
    expect(document).toEqual(before);
    const chart = changed.value.document.blocks[0];
    const measure = chart?.bindings?.find((entry) => entry.id === "chart-y");
    expect(measure?.field.fieldId).toBe("alternate");
    expect(measure?.aggregation?.type).toBe("sum");
    expect(
      validateBoardDocument(changed.value.document, { catalog: providerCatalog() }).valid,
    ).toBe(true);
  });

  it("rejects changes to a fixed binding and documents the lock boundary", () => {
    const document = chartDocument({ fixedMeasure: true });
    const result = setBindingSlot(
      document,
      {
        blockId: "chart",
        slot: "y",
        field: { datasetId: "dataset", fieldId: "alternate" },
        aggregation: "sum",
      },
      { catalog: providerCatalog() },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]?.code).toBe("FIXED_BINDING_LOCKED");
      expect(result.diagnostics[0]?.message).toContain("not a security boundary");
    }
    const y = slot(document, "y");
    expect(y.locked).toBe(true);
    expect(y.mode).toBe("fixed");
    expect(y.aggregations.every((option) => option.enabled === false)).toBe(true);
  });

  it("rejects illegal field, aggregation and chart combinations without substitution", () => {
    const document = chartDocument();
    const stringMeasure = setBindingSlot(
      document,
      {
        blockId: "chart",
        slot: "y",
        field: { datasetId: "dataset", fieldId: "category" },
      },
      { catalog: providerCatalog() },
    );
    expect(stringMeasure.ok).toBe(false);

    const numericX = setBindingSlot(
      document,
      {
        blockId: "chart",
        slot: "x",
        field: { datasetId: "dataset", fieldId: "value" },
      },
      { catalog: providerCatalog() },
    );
    expect(numericX.ok).toBe(false);

    const median = setBindingSlot(
      document,
      {
        blockId: "chart",
        slot: "y",
        field: { datasetId: "dataset", fieldId: "value" },
        aggregation: "median",
      },
      { catalog: providerCatalog() },
    );
    expect(median.ok).toBe(false);
    if (!median.ok) {
      expect(median.diagnostics.some((entry) => entry.code === "RENDERER_INCOMPATIBLE")).toBe(true);
    }
  });

  it("requires provider grouping and aggregation capabilities", () => {
    const document = chartDocument();
    const withoutGrouping = setBindingSlot(
      document,
      {
        blockId: "chart",
        slot: "series",
        field: { datasetId: "dataset", fieldId: "series" },
      },
      { catalog: providerCatalog(undefined, false) },
    );
    expect(withoutGrouping.ok).toBe(false);
    if (!withoutGrouping.ok) {
      expect(withoutGrouping.diagnostics[0]?.code).toBe("PROVIDER_CAPABILITY_MISMATCH");
    }

    const withoutSum = setBindingSlot(
      document,
      {
        blockId: "chart",
        slot: "y",
        field: { datasetId: "dataset", fieldId: "value" },
        aggregation: "sum",
      },
      { catalog: providerCatalog(["average"]) },
    );
    expect(withoutSum.ok).toBe(false);
    if (!withoutSum.ok) {
      expect(withoutSum.diagnostics[0]?.code).toBe("PROVIDER_CAPABILITY_MISMATCH");
    }
  });

  it("adds and removes series and group slots explicitly", () => {
    const document = chartDocument();
    const withSeries = setBindingSlot(
      document,
      {
        blockId: "chart",
        slot: "series",
        field: { datasetId: "dataset", fieldId: "series" },
      },
      { catalog: providerCatalog() },
    );
    expect(withSeries.ok).toBe(true);
    if (!withSeries.ok) {
      return;
    }
    const seriesBinding = withSeries.value.document.blocks[0]?.bindings?.find(
      (entry) => entry.role === "series",
    );
    expect(seriesBinding?.field.fieldId).toBe("series");

    const groupedWithSeries = setBindingSlot(
      withSeries.value.document,
      {
        blockId: "chart",
        slot: "group",
        field: { datasetId: "dataset", fieldId: "series" },
      },
      { catalog: providerCatalog() },
    );
    expect(groupedWithSeries.ok).toBe(false);

    const removed = setBindingSlot(
      withSeries.value.document,
      { blockId: "chart", slot: "series", field: null },
      { catalog: providerCatalog() },
    );
    expect(removed.ok).toBe(true);
    if (!removed.ok) {
      return;
    }
    const grouped = setBindingSlot(
      removed.value.document,
      {
        blockId: "chart",
        slot: "group",
        field: { datasetId: "dataset", fieldId: "series" },
      },
      { catalog: providerCatalog() },
    );
    expect(grouped.ok).toBe(true);
    if (grouped.ok) {
      expect(
        grouped.value.document.blocks[0]?.bindings?.some((entry) => entry.role === "group"),
      ).toBe(true);
    }
  });

  it("resolves slots with the same axis, dimension and series precedence as validation", () => {
    const reordered = chartDocument();
    const reorderedChart = reordered.blocks[0] as unknown as
      { bindings: BindingDefinition[]; config: Record<string, unknown> } | undefined;
    if (reorderedChart) {
      reorderedChart.bindings = [
        binding("chart-series", "dimension", "series"),
        binding("chart-x", "dimension", "category", { axis: "x" }),
        binding("chart-y", "measure", "value", {
          axis: "y",
          sliceId: "slice",
          aggregation: { type: "average" },
        }),
      ];
    }
    expect(validateBoardDocument(reordered).valid).toBe(true);
    expect(slot(reordered, "x").selectedField).toEqual({
      datasetId: "dataset",
      fieldId: "category",
    });
    expect(slot(reordered, "series").selectedField).toEqual({
      datasetId: "dataset",
      fieldId: "series",
    });

    const labelled = chartDocument();
    const labelledChart = labelled.blocks[0] as unknown as
      { bindings: BindingDefinition[]; config: Record<string, unknown> } | undefined;
    if (labelledChart) {
      labelledChart.bindings = [
        binding("chart-label", "label", "alt"),
        binding("chart-x", "dimension", "category", { axis: "x" }),
        binding("chart-y", "measure", "value", {
          axis: "y",
          sliceId: "slice",
          aggregation: { type: "average" },
        }),
      ];
    }
    expect(validateBoardDocument(labelled).valid).toBe(true);
    expect(slot(labelled, "x").selectedField).toEqual({
      datasetId: "dataset",
      fieldId: "category",
    });
    expect(slot(labelled, "series").bindingId).toBeNull();
    const addedSeries = setBindingSlot(
      labelled,
      {
        blockId: "chart",
        slot: "series",
        field: { datasetId: "dataset", fieldId: "series" },
      },
      { catalog: providerCatalog() },
    );
    expect(addedSeries.ok).toBe(true);
    if (addedSeries.ok) {
      expect(slot(addedSeries.value.document, "series").selectedField).toEqual({
        datasetId: "dataset",
        fieldId: "series",
      });
      expect(validateBoardDocument(addedSeries.value.document).valid).toBe(true);
    }

    const scatter = chartDocument();
    const scatterChart = scatter.blocks[0] as unknown as
      { bindings: BindingDefinition[]; config: Record<string, unknown> } | undefined;
    if (scatterChart) {
      scatterChart.bindings = [
        binding("scatter-x", "measure", "value"),
        binding("scatter-y", "measure", "alternate"),
      ];
      scatterChart.config = { visualization: "scatter" };
    }
    expect(validateBoardDocument(scatter).valid).toBe(true);
    expect(slot(scatter, "x").selectedField).toEqual({
      datasetId: "dataset",
      fieldId: "value",
    });
    expect(slot(scatter, "y").selectedField).toEqual({
      datasetId: "dataset",
      fieldId: "alternate",
    });
  });

  it("rejects a series change that would be resolved as the X slot", () => {
    const document = chartDocument();
    const chart = document.blocks[0] as unknown as
      { bindings: BindingDefinition[]; config: Record<string, unknown> } | undefined;
    if (chart) {
      chart.bindings = [
        binding("chart-y", "measure", "value", {
          axis: "y",
          sliceId: "slice",
          aggregation: { type: "average" },
        }),
      ];
    }
    const result = setBindingSlot(
      document,
      {
        blockId: "chart",
        slot: "series",
        field: { datasetId: "dataset", fieldId: "series" },
      },
      { catalog: providerCatalog() },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]?.code).toBe("INCOMPATIBLE_BINDING");
    }
  });

  it("rejects series and group fields that repeat the selected X field", () => {
    const document = chartDocument();
    const seriesSame = setBindingSlot(
      document,
      {
        blockId: "chart",
        slot: "series",
        field: { datasetId: "dataset", fieldId: "category" },
      },
      { catalog: providerCatalog() },
    );
    expect(seriesSame.ok).toBe(false);
    if (!seriesSame.ok) {
      expect(seriesSame.diagnostics[0]?.code).toBe("INCOMPATIBLE_BINDING");
    }
    const groupSame = setBindingSlot(
      document,
      {
        blockId: "chart",
        slot: "group",
        field: { datasetId: "dataset", fieldId: "category" },
      },
      { catalog: providerCatalog() },
    );
    expect(groupSame.ok).toBe(false);

    const slotSeries = slot(document, "series");
    expect(slotSeries.fields.find((field) => field.fieldId === "category")?.enabled).toBe(false);
    expect(slotSeries.fields.find((field) => field.fieldId === "series")?.enabled).toBe(true);

    const withSeries = setBindingSlot(
      document,
      {
        blockId: "chart",
        slot: "series",
        field: { datasetId: "dataset", fieldId: "series" },
      },
      { catalog: providerCatalog() },
    );
    expect(withSeries.ok).toBe(true);
    if (withSeries.ok) {
      const xToSeries = setBindingSlot(
        withSeries.value.document,
        {
          blockId: "chart",
          slot: "x",
          field: { datasetId: "dataset", fieldId: "series" },
        },
        { catalog: providerCatalog() },
      );
      expect(xToSeries.ok).toBe(false);
      if (!xToSeries.ok) {
        expect(xToSeries.diagnostics[0]?.code).toBe("INCOMPATIBLE_BINDING");
      }
    }
  });

  it("requires provider grouping for an aggregated categorical X", () => {
    const validation = validateBoardDocument(chartDocument(), {
      catalog: providerCatalog(undefined, false),
    });
    expect(validation.valid).toBe(false);
    expect(validation.diagnostics.map((entry) => entry.code)).toContain(
      "PROVIDER_CAPABILITY_MISMATCH",
    );
    const described = describeBindingSlots(chartDocument(), "chart", {
      catalog: providerCatalog(undefined, false),
    });
    expect(described.ok).toBe(true);
    if (described.ok) {
      const x = described.value.find((entry) => entry.slot === "x");
      expect(x?.fields.every((field) => field.enabled === false)).toBe(true);
    }
  });

  it("rejects fixed-binding changes, removals and unlocks in replacement documents", () => {
    const previous = chartDocument({ fixedMeasure: true });
    expect(assertFixedBindingsPreserved(clone(previous), clone(previous))).toEqual([]);

    const changed = clone(previous) as unknown as {
      blocks: Array<{ bindings: Array<{ aggregation: { type: string } }> }>;
    };
    const changedBinding = changed.blocks[0]?.bindings[1];
    if (changedBinding) {
      changedBinding.aggregation.type = "sum";
    }
    const changedDiagnostics = assertFixedBindingsPreserved(
      previous,
      changed as unknown as BoardDocumentV1,
    );
    expect(changedDiagnostics.map((entry) => entry.code)).toContain("FIXED_BINDING_CHANGED");

    const removed = clone(previous) as unknown as {
      blocks: Array<{ bindings: unknown[] }>;
    };
    removed.blocks[0]?.bindings.splice(1, 1);
    expect(
      assertFixedBindingsPreserved(previous, removed as unknown as BoardDocumentV1).map(
        (entry) => entry.code,
      ),
    ).toContain("FIXED_BINDING_CHANGED");

    const unlocked = clone(previous) as unknown as {
      blocks: Array<{ bindings: Array<{ mode?: string }> }>;
    };
    const fixed = unlocked.blocks[0]?.bindings[1];
    if (fixed) {
      delete fixed.mode;
    }
    expect(
      assertFixedBindingsPreserved(previous, unlocked as unknown as BoardDocumentV1).map(
        (entry) => entry.code,
      ),
    ).toContain("FIXED_BINDING_CHANGED");

    const selectable = chartDocument();
    const selectableChange = clone(selectable) as unknown as {
      blocks: Array<{ bindings: Array<{ aggregation: { type: string } }> }>;
    };
    const selectableBinding = selectableChange.blocks[0]?.bindings[1];
    if (selectableBinding) {
      selectableBinding.aggregation.type = "sum";
    }
    expect(
      assertFixedBindingsPreserved(selectable, selectableChange as unknown as BoardDocumentV1),
    ).toEqual([]);

    const renamed = clone(previous) as unknown as {
      id: string;
      blocks: Array<{ bindings: Array<{ aggregation: { type: string } }> }>;
    };
    renamed.id = "renamed-board";
    const renamedBinding = renamed.blocks[0]?.bindings[1];
    if (renamedBinding) {
      renamedBinding.aggregation.type = "sum";
    }
    expect(
      assertFixedBindingsPreserved(previous, renamed as unknown as BoardDocumentV1).map(
        (entry) => entry.code,
      ),
    ).toContain("FIXED_BINDING_CHANGED");
    expect(
      assertFixedBindingsPreserved(previous, renamed as unknown as BoardDocumentV1, {
        allowDifferentDocument: true,
      }),
    ).toEqual([]);
  });
});
