import { describe, expect, it } from "vitest";
import {
  DIAGNOSTIC_CODES,
  composeBlockFilters,
  composeComparisonFilterSides,
  createEmptyBoardDocument,
  crossFilterTargetStatus,
  filterCompositionOrder,
  filterDefinitionOperators,
  validateBoardDocument,
  validateCrossFilterSelection,
  makeFilterState,
  queryFiltersForComposition,
  validateFilterRuntimeState,
  type BoardDocumentV1,
  type BoardValidationCatalog,
  type ComparisonDefinition,
  type FilterDefinition,
} from "../../../../packages/core/src/index.js";

type MutableBoard = { -readonly [K in keyof BoardDocumentV1]: BoardDocumentV1[K] };

function baseDocument(): MutableBoard {
  const empty = createEmptyBoardDocument({
    id: "filter-model-board",
    title: "Filter model",
    createdAt: 1_700_000_000_000,
  });
  return {
    ...empty,
    datasets: [
      {
        id: "ds-a",
        label: "A",
        fields: [
          { id: "subject", type: "string", role: "dimension" },
          { id: "score", type: "number", role: "measure", unit: "points" },
          { id: "when", type: "datetime", role: "dimension", timezone: "UTC" },
        ],
      },
      {
        id: "ds-b",
        label: "B",
        fields: [
          { id: "subject", type: "string", role: "dimension" },
          { id: "score", type: "number", role: "measure", unit: "points" },
          { id: "when", type: "datetime", role: "dimension", timezone: "UTC" },
        ],
      },
      {
        id: "ds-c",
        label: "C",
        fields: [
          { id: "subject", type: "string", role: "dimension" },
          { id: "score", type: "number", role: "measure", unit: "percent" },
        ],
      },
      {
        id: "ds-d",
        label: "D",
        fields: [
          { id: "label", type: "string", role: "dimension" },
          { id: "score", type: "number", role: "measure", unit: "points" },
        ],
      },
    ],
    filterGroups: [
      { id: "group-b", label: "B group" },
      { id: "group-a", label: "A group" },
    ],
    blocks: [
      {
        id: "chart-a",
        type: "chart",
        title: "A chart",
        groupId: "group-a",
        bindings: [
          {
            id: "a-x",
            role: "dimension",
            axis: "x",
            field: { datasetId: "ds-a", fieldId: "subject" },
          },
          {
            id: "a-y",
            role: "measure",
            axis: "y",
            field: { datasetId: "ds-a", fieldId: "score" },
            aggregation: { type: "average" },
          },
        ],
        config: { visualization: "bar" },
      },
      {
        id: "table-b",
        type: "table",
        title: "B table",
        groupId: "group-b",
        bindings: [
          {
            id: "b-x",
            role: "dimension",
            field: { datasetId: "ds-b", fieldId: "subject" },
          },
          {
            id: "b-y",
            role: "measure",
            field: { datasetId: "ds-b", fieldId: "score" },
            aggregation: { type: "sum" },
          },
        ],
        config: { columns: ["b-x", "b-y"] },
      },
      {
        id: "table-c",
        type: "table",
        title: "C table",
        bindings: [
          {
            id: "c-x",
            role: "dimension",
            field: { datasetId: "ds-c", fieldId: "subject" },
          },
        ],
        config: { columns: ["c-x"] },
      },
      {
        id: "table-d",
        type: "table",
        title: "D table",
        bindings: [
          {
            id: "d-x",
            role: "dimension",
            field: { datasetId: "ds-d", fieldId: "label" },
          },
        ],
        config: { columns: ["d-x"] },
      },
      {
        id: "text-a",
        type: "text",
        title: "Note",
        config: { text: "No data" },
      },
      {
        id: "filter-block",
        type: "filter",
        title: "Filters",
        config: { filterIds: ["filter-board"] },
      },
    ],
    filters: [],
    layout: empty.layout,
  };
}

function boardFilter(overrides: Partial<FilterDefinition> = {}): FilterDefinition {
  return {
    id: "filter-board",
    label: "Subject",
    field: { datasetId: "ds-a", fieldId: "subject" },
    operator: "in",
    defaultValue: ["math", "science"],
    viewerEditable: true,
    target: { kind: "board" },
    ...overrides,
  };
}

describe("T09 filter composition", () => {
  it("orders board, group, block and cross filters deterministically", () => {
    const document = baseDocument();
    document.filters = [
      {
        id: "block-filter",
        field: { datasetId: "ds-b", fieldId: "subject" },
        operator: "equals",
        defaultValue: "math",
        target: { kind: "block", blockId: "table-b" },
      },
      {
        id: "group-b-second",
        field: { datasetId: "ds-b", fieldId: "subject" },
        operator: "equals",
        defaultValue: "science",
        target: { kind: "group", groupId: "group-b" },
      },
      boardFilter({
        mappings: [
          {
            source: { datasetId: "ds-a", fieldId: "subject" },
            target: { datasetId: "ds-b", fieldId: "subject" },
          },
        ],
      }),
      {
        id: "group-a-first",
        field: { datasetId: "ds-a", fieldId: "subject" },
        operator: "equals",
        defaultValue: "math",
        target: { kind: "group", groupId: "group-a" },
      },
      {
        id: "group-b-first",
        field: { datasetId: "ds-b", fieldId: "subject" },
        operator: "notEquals",
        defaultValue: "history",
        target: { kind: "group", groupId: "group-b" },
      },
    ];
    expect(filterCompositionOrder(document).map((filter) => filter.id)).toEqual([
      "filter-board",
      "group-b-second",
      "group-b-first",
      "group-a-first",
      "block-filter",
    ]);
    const state = makeFilterState([], []);
    const composition = composeBlockFilters(document, document.blocks[1]!, state);
    expect(composition.ok).toBe(true);
    if (!composition.ok) {
      throw new Error("composition failed");
    }
    expect(composition.value.filters.map((filter) => filter.filterId)).toEqual([
      "filter-board",
      "group-b-second",
      "group-b-first",
      "block-filter",
    ]);
  });

  it("requires explicit dataset-qualified mappings and rejects incompatible units", () => {
    const document = baseDocument();
    document.filters = [boardFilter()];
    const unmapped = composeBlockFilters(document, document.blocks[1]!, makeFilterState([], []));
    expect(unmapped.ok).toBe(false);
    if (!unmapped.ok) {
      expect(unmapped.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
        DIAGNOSTIC_CODES.FILTER_TARGET_UNMAPPED,
      );
    }
    document.filters = [
      boardFilter({
        mappings: [
          {
            source: { datasetId: "ds-a", fieldId: "subject" },
            target: { datasetId: "ds-b", fieldId: "subject" },
          },
          {
            source: { datasetId: "ds-a", fieldId: "subject" },
            target: { datasetId: "ds-c", fieldId: "subject" },
          },
        ],
      }),
    ];
    const mapped = composeBlockFilters(document, document.blocks[1]!, makeFilterState([], []));
    expect(mapped.ok).toBe(true);
    if (mapped.ok) {
      expect(queryFiltersForComposition(mapped.value)[0]).toMatchObject({
        fieldId: "subject",
        operator: "in",
        value: ["math", "science"],
      });
    }
    document.filters = [
      boardFilter({
        field: { datasetId: "ds-a", fieldId: "score" },
        operator: "greaterThan",
        defaultValue: 5,
        mappings: [
          {
            source: { datasetId: "ds-a", fieldId: "score" },
            target: { datasetId: "ds-c", fieldId: "score" },
          },
        ],
      }),
    ];
    const incompatible = composeBlockFilters(
      document,
      document.blocks[2]!,
      makeFilterState([], []),
    );
    expect(incompatible.ok).toBe(false);
    if (!incompatible.ok) {
      expect(incompatible.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
        DIAGNOSTIC_CODES.FILTER_TARGET_INCOMPATIBLE,
      );
    }
  });

  it("intersects equivalent filters and reports contradictory combinations", () => {
    const document = baseDocument();
    document.filters = [
      boardFilter({ id: "f1", operator: "in", defaultValue: ["math", "science"] }),
      boardFilter({ id: "f2", operator: "in", defaultValue: ["science", "history"] }),
    ];
    const compatible = composeBlockFilters(document, document.blocks[0]!, makeFilterState([], []));
    expect(compatible.ok).toBe(true);
    if (compatible.ok) {
      expect(compatible.value.conflicts).toHaveLength(0);
      expect(queryFiltersForComposition(compatible.value)).toHaveLength(2);
    }
    document.filters = [
      boardFilter({ id: "f1", operator: "equals", defaultValue: "math" }),
      boardFilter({ id: "f2", operator: "notEquals", defaultValue: "math" }),
    ];
    const conflict = composeBlockFilters(document, document.blocks[0]!, makeFilterState([], []));
    expect(conflict.ok).toBe(true);
    if (conflict.ok) {
      expect(conflict.value.conflicts).toHaveLength(1);
      expect(conflict.value.diagnostics[0]?.code).toBe(DIAGNOSTIC_CODES.FILTER_CONFLICT);
      expect(
        validateFilterRuntimeState(document, makeFilterState([], [])).filter(
          (diagnostic) =>
            diagnostic.code === DIAGNOSTIC_CODES.FILTER_CONFLICT ||
            diagnostic.code === DIAGNOSTIC_CODES.FILTER_STATE_INVALID,
        ),
      ).toHaveLength(0);
    }
    document.filters = [
      {
        id: "set-a",
        field: { datasetId: "ds-a", fieldId: "score" },
        operator: "in",
        defaultValue: [1, 2],
        target: { kind: "block", blockId: "chart-a" },
      },
      {
        id: "set-b",
        field: { datasetId: "ds-a", fieldId: "score" },
        operator: "notIn",
        defaultValue: [1],
        target: { kind: "block", blockId: "chart-a" },
      },
    ];
    const partial = composeBlockFilters(document, document.blocks[0]!, makeFilterState([], []));
    expect(partial.ok).toBe(true);
    if (partial.ok) {
      expect(partial.value.conflicts).toHaveLength(0);
    }
    document.filters = [
      {
        id: "range",
        field: { datasetId: "ds-a", fieldId: "score" },
        operator: "between",
        defaultValue: [1, 3],
        target: { kind: "block", blockId: "chart-a" },
      },
      {
        id: "minimum",
        field: { datasetId: "ds-a", fieldId: "score" },
        operator: "greaterThan",
        defaultValue: 5,
        target: { kind: "block", blockId: "chart-a" },
      },
    ];
    const rangeConflict = composeBlockFilters(
      document,
      document.blocks[0]!,
      makeFilterState([], []),
    );
    expect(rangeConflict.ok).toBe(true);
    if (rangeConflict.ok) {
      expect(rangeConflict.value.conflicts).toHaveLength(1);
    }
    document.filters = [
      boardFilter({ id: "null", operator: "isNull", defaultValue: undefined }),
      boardFilter({ id: "not-a", operator: "notEquals", defaultValue: "math" }),
    ];
    const nullConflict = composeBlockFilters(
      document,
      document.blocks[0]!,
      makeFilterState([], []),
    );
    expect(nullConflict.ok).toBe(true);
    if (nullConflict.ok) {
      expect(nullConflict.value.conflicts).toHaveLength(1);
    }
  });

  it("applies date ranges with declared timezone and half-open boundaries", () => {
    const document = baseDocument();
    document.filters = [
      {
        id: "when-filter",
        field: { datasetId: "ds-a", fieldId: "when" },
        operator: "between",
        defaultValue: ["2026-03-08T00:00:00Z", "2026-03-09T00:00:00Z"],
        temporal: { timezone: "UTC", bounds: "half-open" },
        target: { kind: "board" },
      },
    ];
    const composition = composeBlockFilters(document, document.blocks[0]!, makeFilterState([], []));
    expect(composition.ok).toBe(true);
    if (composition.ok) {
      expect(queryFiltersForComposition(composition.value)[0]).toEqual({
        id: "when-filter",
        fieldId: "when",
        operator: "between",
        value: ["2026-03-08T00:00:00Z", "2026-03-09T00:00:00Z"],
        timezone: "UTC",
        bounds: "half-open",
      });
    }
  });

  it("uses the same explicit mapping model for cross-filter compatibility", () => {
    const document = baseDocument();
    const mapped = makeFilterState(
      [],
      [
        {
          id: "selection-a",
          sourceBlockId: "chart-a",
          field: { datasetId: "ds-a", fieldId: "subject" },
          operator: "equals",
          value: "math",
          mappings: [
            {
              source: { datasetId: "ds-a", fieldId: "subject" },
              target: { datasetId: "ds-b", fieldId: "subject" },
            },
          ],
        },
      ],
    );
    const statusB = crossFilterTargetStatus(document, document.blocks[1]!, mapped);
    expect(statusB.compatible).toBe(true);
    const statusC = crossFilterTargetStatus(document, document.blocks[2]!, mapped);
    expect(statusC.compatible).toBe(false);
    expect(statusC.reason).toBe("unmapped");
    const statusD = crossFilterTargetStatus(document, document.blocks[3]!, mapped);
    expect(statusD.compatible).toBe(false);
    expect(statusD.reason).toBe("unmapped");
    const composition = composeBlockFilters(document, document.blocks[1]!, mapped);
    expect(composition.ok).toBe(true);
    if (composition.ok) {
      expect(composition.value.filters.at(-1)?.source).toBe("cross");
      expect(queryFiltersForComposition(composition.value).at(-1)?.fieldId).toBe("subject");
    }
    const multipleSources = makeFilterState(
      [],
      [
        {
          id: "selection-a",
          sourceBlockId: "chart-a",
          field: { datasetId: "ds-a", fieldId: "subject" },
          operator: "equals",
          value: "math",
          mappings: [
            {
              source: { datasetId: "ds-a", fieldId: "subject" },
              target: { datasetId: "ds-c", fieldId: "subject" },
            },
          ],
        },
        {
          id: "selection-b",
          sourceBlockId: "table-b",
          field: { datasetId: "ds-b", fieldId: "subject" },
          operator: "equals",
          value: "math",
          mappings: [
            {
              source: { datasetId: "ds-b", fieldId: "subject" },
              target: { datasetId: "ds-c", fieldId: "subject" },
            },
          ],
        },
      ],
    );
    expect(crossFilterTargetStatus(document, document.blocks[2]!, multipleSources).compatible).toBe(
      true,
    );
    const multipleComposition = composeBlockFilters(document, document.blocks[2]!, multipleSources);
    expect(multipleComposition.ok).toBe(true);
    if (multipleComposition.ok) {
      expect(
        multipleComposition.value.filters.filter((filter) => filter.source === "cross"),
      ).toHaveLength(2);
    }
    const sourceComposition = composeBlockFilters(document, document.blocks[0]!, mapped);
    expect(sourceComposition.ok).toBe(true);
    if (sourceComposition.ok) {
      expect(sourceComposition.value.filters.some((filter) => filter.source === "cross")).toBe(
        false,
      );
    }
  });

  it("validates cross-filter provider operator capabilities and disables unsupported targets", () => {
    const document = baseDocument();
    const catalog: BoardValidationCatalog = {
      datasets: {
        "ds-a": {
          fields: {
            subject: { type: "string", operators: ["equals"] },
            score: { type: "number", operators: ["equals"] },
          },
        },
        "ds-b": {
          fields: {
            subject: { type: "string", operators: ["in"] },
            score: { type: "number", operators: ["equals"] },
          },
        },
      },
    };
    const selection = {
      sourceBlockId: "chart-a",
      field: { datasetId: "ds-a", fieldId: "subject" },
      operator: "equals" as const,
      value: "math",
      mappings: [
        {
          source: { datasetId: "ds-a", fieldId: "subject" },
          target: { datasetId: "ds-b", fieldId: "subject" },
        },
      ],
    };
    expect(validateCrossFilterSelection(document, selection, catalog).ok).toBe(true);
    const state = makeFilterState([], [{ id: "selection", ...selection }]);
    const status = crossFilterTargetStatus(document, document.blocks[1]!, state, catalog);
    expect(status.compatible).toBe(false);
    expect(status.reason).toBe("unsupported-operator");
    const composition = composeBlockFilters(document, document.blocks[1]!, state, { catalog });
    expect(composition.ok).toBe(true);
    if (composition.ok) {
      expect(composition.value.filters.some((filter) => filter.source === "cross")).toBe(false);
      expect(composition.value.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
        DIAGNOSTIC_CODES.CROSS_FILTER_INCOMPATIBLE,
      );
    }
    const rejected = validateCrossFilterSelection(
      document,
      {
        ...selection,
        field: { datasetId: "ds-a", fieldId: "score" },
        operator: "greaterThan",
        value: 1,
      },
      catalog,
    );
    expect(rejected.ok).toBe(false);
  });

  it("validates timezone conversion for every filter target and comparison side", () => {
    const document = baseDocument();
    const catalog = {
      datasets: Object.fromEntries(
        document.datasets.map((dataset) => [
          dataset.id,
          {
            fields: Object.fromEntries(
              (dataset.fields ?? []).map((field) => [
                field.id,
                {
                  type: field.type,
                  role: field.role,
                  ...(field.unit === undefined ? {} : { unit: field.unit }),
                  ...(field.timezone === undefined ? {} : { timezone: field.timezone }),
                },
              ]),
            ),
            capabilities: {
              timezoneConversion: dataset.id === "ds-a",
            },
          },
        ]),
      ),
    } as BoardValidationCatalog;
    const filter: FilterDefinition = {
      id: "window",
      field: { datasetId: "ds-a", fieldId: "when" },
      operator: "between",
      defaultValue: ["2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z"],
      temporal: { timezone: "America/New_York", bounds: "inclusive" },
      mappings: [
        {
          source: { datasetId: "ds-a", fieldId: "when" },
          target: { datasetId: "ds-b", fieldId: "when" },
        },
      ],
      target: { kind: "block", blockId: "table-b" },
    };
    document.filters = [filter];
    const rejected = validateBoardDocument(document, { catalog });
    expect(rejected.valid).toBe(false);
    expect(rejected.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      DIAGNOSTIC_CODES.FILTER_TARGET_INCOMPATIBLE,
    );
    const composition = composeBlockFilters(
      document,
      document.blocks[1]!,
      makeFilterState([], []),
      { catalog },
    );
    expect(composition.ok).toBe(false);
    if (!composition.ok) {
      expect(composition.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
        DIAGNOSTIC_CODES.FILTER_TARGET_INCOMPATIBLE,
      );
    }
    document.filters = [];
    const targetSelection = makeFilterState(
      [],
      [
        {
          id: "when-selection",
          sourceBlockId: "chart-a",
          field: { datasetId: "ds-a", fieldId: "when" },
          operator: "equals",
          value: "2026-01-01T00:00:00Z",
          temporal: { timezone: "America/New_York", bounds: "inclusive" },
          mappings: [
            {
              source: { datasetId: "ds-a", fieldId: "when" },
              target: { datasetId: "ds-b", fieldId: "when" },
            },
          ],
        },
      ],
    );
    const status = crossFilterTargetStatus(document, document.blocks[1]!, targetSelection, catalog);
    expect(status.compatible).toBe(false);
    expect(status.reason).toBe("timezone-conversion");
    const crossComposition = composeBlockFilters(document, document.blocks[1]!, targetSelection, {
      catalog,
    });
    expect(crossComposition.ok).toBe(true);
    if (crossComposition.ok) {
      expect(crossComposition.value.filters.some((entry) => entry.source === "cross")).toBe(false);
    }

    document.filters = [
      {
        ...filter,
        mappings: undefined,
        target: { kind: "block", blockId: "chart-a" },
      },
    ];
    document.comparisons = [
      {
        id: "comparison-time",
        label: "Time comparison",
        displayMode: "overlay",
        deltaMode: "absolute",
        base: { datasetId: "ds-a" },
        reference: { datasetId: "ds-b" },
        mapping: [
          {
            primary: { datasetId: "ds-a", fieldId: "when" },
            reference: { datasetId: "ds-b", fieldId: "when" },
            role: "dimension",
          },
          {
            primary: { datasetId: "ds-a", fieldId: "score" },
            reference: { datasetId: "ds-b", fieldId: "score" },
            role: "measure",
          },
        ],
        alignment: { keys: ["when"] },
      },
    ];
    document.blocks = document.blocks.map((block) =>
      block.id === "chart-a"
        ? { ...block, config: { ...block.config, comparisonId: "comparison-time" } }
        : block,
    );
    const sides = composeComparisonFilterSides(
      document,
      document.blocks[0]!,
      makeFilterState([], []),
      { catalog },
    );
    expect(sides.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      DIAGNOSTIC_CODES.FILTER_TARGET_INCOMPATIBLE,
    );
  });

  it("applies comparison-side mappings symmetrically and rejects a missing side", () => {
    const document = baseDocument();
    const comparison: ComparisonDefinition = {
      id: "comparison-a-b",
      label: "A vs B",
      displayMode: "overlay",
      deltaMode: "absolute",
      base: { datasetId: "ds-a" },
      reference: { datasetId: "ds-b" },
      mapping: [
        {
          primary: { datasetId: "ds-a", fieldId: "subject" },
          reference: { datasetId: "ds-b", fieldId: "subject" },
          role: "dimension",
        },
        {
          primary: { datasetId: "ds-a", fieldId: "score" },
          reference: { datasetId: "ds-b", fieldId: "score" },
          role: "measure",
        },
      ],
      alignment: { keys: ["subject"] },
    };
    document.comparisons = [comparison];
    document.blocks = document.blocks.map((block) =>
      block.id === "chart-a"
        ? { ...block, config: { ...block.config, comparisonId: comparison.id } }
        : block,
    );
    document.filters = [boardFilter()];
    const sides = composeComparisonFilterSides(
      document,
      document.blocks[0]!,
      makeFilterState([], []),
    );
    expect(sides.diagnostics).toHaveLength(0);
    expect(sides.primary[0]?.targetField).toEqual({ datasetId: "ds-a", fieldId: "subject" });
    expect(sides.reference[0]?.targetField).toEqual({ datasetId: "ds-b", fieldId: "subject" });

    document.comparisons = [
      {
        ...comparison,
        mapping: [
          {
            primary: { datasetId: "ds-a", fieldId: "score" },
            reference: { datasetId: "ds-b", fieldId: "score" },
            role: "measure",
          },
        ],
      },
    ];
    document.filters = [
      boardFilter({
        mappings: [
          {
            source: { datasetId: "ds-a", fieldId: "subject" },
            target: { datasetId: "ds-b", fieldId: "subject" },
          },
        ],
      }),
    ];
    const viaFilterMapping = composeComparisonFilterSides(
      document,
      document.blocks[0]!,
      makeFilterState([], []),
    );
    expect(viaFilterMapping.diagnostics).toHaveLength(0);
    expect(viaFilterMapping.reference[0]?.targetField).toEqual({
      datasetId: "ds-b",
      fieldId: "subject",
    });

    document.filters = [boardFilter()];
    const rejected = composeComparisonFilterSides(
      document,
      document.blocks[0]!,
      makeFilterState([], []),
    );
    expect(rejected.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      DIAGNOSTIC_CODES.FILTER_TARGET_UNMAPPED,
    );
  });

  it("rejects invalid serialized active values without changing the document", () => {
    const document = baseDocument();
    document.filters = [boardFilter()];
    const invalid = validateFilterRuntimeState(
      document,
      makeFilterState([{ filterId: "filter-board", value: 42 }], []),
    );
    expect(invalid.map((diagnostic) => diagnostic.code)).toContain(
      DIAGNOSTIC_CODES.FILTER_STATE_INVALID,
    );
  });

  it("rejects scalar operator arrays and revalidates cross selections against changed schemas", () => {
    const document = baseDocument();
    document.filters = [
      boardFilter({
        id: "equals",
        field: { datasetId: "ds-a", fieldId: "score" },
        operator: "equals",
        defaultValue: 1,
      }),
    ];
    const scalarArray = validateFilterRuntimeState(
      document,
      makeFilterState([{ filterId: "equals", value: [1] }], []),
    );
    expect(scalarArray.map((diagnostic) => diagnostic.code)).toContain(
      DIAGNOSTIC_CODES.FILTER_STATE_INVALID,
    );
    const changed = baseDocument();
    const dataset = changed.datasets[0]! as unknown as { fields: unknown[] };
    dataset.fields =
      changed.datasets[0]!.fields?.map((field) =>
        field.id === "subject" ? { ...field, type: "number" as const } : field,
      ) ?? [];
    const cross = makeFilterState(
      [],
      [
        {
          id: "selection",
          sourceBlockId: "chart-a",
          field: { datasetId: "ds-a", fieldId: "subject" },
          operator: "equals",
          value: "math",
        },
      ],
    );
    const revalidated = validateFilterRuntimeState(changed, cross);
    expect(revalidated.map((diagnostic) => diagnostic.code)).toContain(
      DIAGNOSTIC_CODES.FILTER_STATE_INVALID,
    );
  });

  it("requires temporal windows only for temporal operators and validates timezones", () => {
    const document = baseDocument();
    const numeric = validateCrossFilterSelection(document, {
      sourceBlockId: "chart-a",
      field: { datasetId: "ds-a", fieldId: "score" },
      operator: "between",
      value: [1, 2],
    });
    expect(numeric.ok).toBe(true);
    const numericWindow = validateCrossFilterSelection(document, {
      sourceBlockId: "chart-a",
      field: { datasetId: "ds-a", fieldId: "score" },
      operator: "between",
      value: [1, 2],
      temporal: { timezone: "UTC", bounds: "inclusive" },
    });
    expect(numericWindow.ok).toBe(false);
    const missingWindow = validateCrossFilterSelection(document, {
      sourceBlockId: "chart-a",
      field: { datasetId: "ds-a", fieldId: "when" },
      operator: "before",
      value: "2026-01-01T00:00:00Z",
    });
    expect(missingWindow.ok).toBe(false);
    const invalidTimezone = validateCrossFilterSelection(document, {
      sourceBlockId: "chart-a",
      field: { datasetId: "ds-a", fieldId: "when" },
      operator: "before",
      value: "2026-01-01T00:00:00Z",
      temporal: { timezone: "Not/AZone", bounds: "inclusive" },
    });
    expect(invalidTimezone.ok).toBe(false);
    const validWindow = validateCrossFilterSelection(document, {
      sourceBlockId: "chart-a",
      field: { datasetId: "ds-a", fieldId: "when" },
      operator: "between",
      value: ["2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z"],
      temporal: { timezone: "UTC", bounds: "half-open" },
    });
    expect(validWindow.ok).toBe(true);
  });

  it("restricts filter-definition operators by mapped targets and comparison sides", () => {
    const document = baseDocument();
    const catalog: BoardValidationCatalog = {
      datasets: {
        "ds-a": {
          fields: {
            score: {
              type: "number",
              operators: ["equals", "greaterThan", "between"],
            },
          },
        },
        "ds-b": {
          fields: {
            score: { type: "number", operators: ["equals"] },
          },
        },
      },
    };
    const filter: FilterDefinition = {
      id: "mapped",
      field: { datasetId: "ds-a", fieldId: "score" },
      operator: "equals",
      defaultValue: 1,
      mappings: [
        {
          source: { datasetId: "ds-a", fieldId: "score" },
          target: { datasetId: "ds-b", fieldId: "score" },
        },
      ],
      target: { kind: "block", blockId: "table-b" },
    };
    document.filters = [filter];
    expect(filterDefinitionOperators(document, filter, catalog)).toEqual(["equals"]);

    document.comparisons = [
      {
        id: "comparison-operator",
        label: "Operator comparison",
        displayMode: "overlay",
        deltaMode: "absolute",
        base: { datasetId: "ds-a" },
        reference: { datasetId: "ds-b" },
        mapping: [
          {
            primary: { datasetId: "ds-a", fieldId: "score" },
            reference: { datasetId: "ds-b", fieldId: "score" },
            role: "measure",
          },
        ],
        alignment: { keys: ["score"] },
      },
    ];
    document.blocks = document.blocks.map((block) =>
      block.id === "chart-a"
        ? { ...block, config: { ...block.config, comparisonId: "comparison-operator" } }
        : block,
    );
    const comparisonFilter: FilterDefinition = {
      ...filter,
      mappings: undefined,
      target: { kind: "block", blockId: "chart-a" },
    };
    expect(filterDefinitionOperators(document, comparisonFilter, catalog)).toEqual(["equals"]);
  });
});
