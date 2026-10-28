import { describe, expect, it } from "vitest";
import {
  composeBlockFilters,
  createBoardValidationCatalog,
  createEmptyBoardDocument,
  createLocalDatasetProvider,
  createRuntime,
  queryFiltersForComposition,
  type BoardDocumentV1,
  type DatasetDescriptor,
  type QueryState,
} from "../../../../packages/core/src/index.js";
import { unwrap } from "../support/assertions.js";
import { FakeClock, createDeterministicIdFactory } from "../support/fakes.js";

const DESCRIPTOR: DatasetDescriptor = {
  id: "temporal-data",
  label: "Temporal data",
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
      id: "when",
      key: "when",
      label: "When",
      type: "datetime",
      role: "temporal",
      nullable: false,
      timezone: "UTC",
      temporalRepresentation: "iso8601-offset",
    },
  ],
  slices: [
    {
      id: "all",
      datasetId: "temporal-data",
      label: "All",
      fieldIds: ["school", "when"],
      supportedOperations: ["project", "filter", "order"],
    },
  ],
  capabilities: {
    grouping: false,
    aggregations: [],
    filterOperators: ["between", "before", "after", "onOrBefore", "onOrAfter"],
    timeWindow: false,
    timezoneConversion: false,
    local: true,
    pushdownFilters: true,
    serverPaging: false,
    realtime: false,
    comparison: false,
    maxResultSize: null,
  },
};

const ROWS = [
  { school: "before", when: "2026-03-07T23:59:59Z" },
  { school: "start", when: "2026-03-08T00:00:00Z" },
  { school: "end", when: "2026-03-08T23:59:59Z" },
  { school: "after", when: "2026-03-09T00:00:00Z" },
];

function documentValue(): BoardDocumentV1 {
  const empty = createEmptyBoardDocument({
    id: "temporal-board",
    title: "Temporal filters",
    createdAt: 1_700_000_000_000,
  });
  return {
    ...empty,
    datasets: [
      {
        id: "temporal-data",
        label: "Temporal data",
        fields: [
          { id: "school", type: "string", role: "dimension" },
          { id: "when", type: "datetime", role: "dimension", timezone: "UTC" },
        ],
      },
    ],
    blocks: [
      {
        id: "table",
        type: "table",
        title: "Rows",
        bindings: [
          { id: "x", role: "dimension", field: { datasetId: "temporal-data", fieldId: "school" } },
          { id: "y", role: "dimension", field: { datasetId: "temporal-data", fieldId: "when" } },
        ],
        config: { columns: ["x", "y"] },
      },
    ],
    filters: [
      {
        id: "window",
        field: { datasetId: "temporal-data", fieldId: "when" },
        operator: "between",
        defaultValue: ["2026-03-08T00:00:00Z", "2026-03-09T00:00:00Z"],
        viewerEditable: true,
        temporal: { timezone: "UTC", bounds: "half-open" },
        target: { kind: "block", blockId: "table" },
      },
    ],
    layout: {
      desktop: {
        columns: 12,
        placements: [{ blockId: "table", x: 0, y: 0, width: 12, height: 4 }],
      },
      tablet: {
        columns: 8,
        placements: [{ blockId: "table", x: 0, y: 0, width: 8, height: 4 }],
      },
      narrow: {
        columns: 4,
        placements: [{ blockId: "table", x: 0, y: 0, width: 4, height: 4 }],
      },
    },
  };
}

function schools(state: QueryState | undefined): string[] {
  if (state === undefined) {
    return [];
  }
  return state.rows.map((row) => String(row.school));
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("T09 filter query boundaries", () => {
  it("honours half-open date boundaries through the local provider", async () => {
    const provider = unwrap(
      createLocalDatasetProvider({ datasets: [{ descriptor: DESCRIPTOR, rows: ROWS }] }),
    );
    const runtime = createRuntime({
      datasetProvider: provider,
      clock: new FakeClock(),
      idFactory: createDeterministicIdFactory("temporal"),
    });
    const space = unwrap(runtime.createSpace({ document: documentValue() }));
    const document = space.getSnapshot().committedDocument as unknown as BoardDocumentV1;
    const composition = composeBlockFilters(document, document.blocks[0]!, space.getFilterState());
    expect(composition.ok).toBe(true);
    if (!composition.ok) {
      throw new Error("composition failed");
    }
    unwrap(
      space.setQuery("q", {
        datasetId: "temporal-data",
        fields: ["school", "when"],
        filters: queryFiltersForComposition(composition.value),
      }),
    );
    await flush();
    expect(schools(space.getQueryState("q"))).toEqual(["start", "end"]);

    unwrap(space.setFilterValue("window", ["2026-03-08T00:00:00Z", "2026-03-08T23:59:59Z"]));
    const narrower = composeBlockFilters(document, document.blocks[0]!, space.getFilterState());
    expect(narrower.ok).toBe(true);
    if (narrower.ok) {
      unwrap(
        space.setQuery("q", {
          datasetId: "temporal-data",
          fields: ["school", "when"],
          filters: queryFiltersForComposition(narrower.value),
        }),
      );
      await flush();
      expect(schools(space.getQueryState("q"))).toEqual(["start"]);
    }
    unwrap(space.dispose());
    unwrap(runtime.dispose());
  });

  it("includes the end boundary when the filter declares inclusive bounds", async () => {
    const provider = unwrap(
      createLocalDatasetProvider({ datasets: [{ descriptor: DESCRIPTOR, rows: ROWS }] }),
    );
    const runtime = createRuntime({
      datasetProvider: provider,
      clock: new FakeClock(),
      idFactory: createDeterministicIdFactory("temporal"),
    });
    const source = documentValue();
    const document = {
      ...source,
      filters: source.filters.map((filter) => ({
        ...filter,
        temporal: { timezone: "UTC", bounds: "inclusive" },
      })),
    } as BoardDocumentV1;
    const space = unwrap(runtime.createSpace({ document }));
    const current = space.getSnapshot().committedDocument as unknown as BoardDocumentV1;
    const composition = composeBlockFilters(current, current.blocks[0]!, space.getFilterState());
    expect(composition.ok).toBe(true);
    if (composition.ok) {
      unwrap(
        space.setQuery("q", {
          datasetId: "temporal-data",
          fields: ["school", "when"],
          filters: queryFiltersForComposition(composition.value),
        }),
      );
      await flush();
      expect(schools(space.getQueryState("q"))).toEqual(["start", "end", "after"]);
    }
    unwrap(space.dispose());
    unwrap(runtime.dispose());
  });

  it("executes boolean isTrue and isFalse predicates without fabricated null matches", async () => {
    const descriptor: DatasetDescriptor = {
      ...DESCRIPTOR,
      fields: [
        ...DESCRIPTOR.fields,
        {
          id: "passed",
          key: "passed",
          label: "Passed",
          type: "boolean",
          role: "dimension",
          nullable: true,
        },
      ],
      capabilities: {
        ...DESCRIPTOR.capabilities,
        filterOperators: [
          ...DESCRIPTOR.capabilities.filterOperators,
          "isTrue",
          "isFalse",
          "isNull",
        ],
      },
    };
    const rows = ROWS.map((row, index) => ({
      ...row,
      passed: index === 1 || index === 3 ? true : index === 2 ? false : null,
    }));
    const provider = unwrap(createLocalDatasetProvider({ datasets: [{ descriptor, rows }] }));
    const runtime = createRuntime({
      datasetProvider: provider,
      validationCatalog: createBoardValidationCatalog([descriptor]),
      clock: new FakeClock(),
      idFactory: createDeterministicIdFactory("boolean"),
    });
    const document = documentValue();
    (document.datasets[0]!.fields as unknown as unknown[]).push({
      id: "passed",
      type: "boolean",
      role: "dimension",
    });
    const space = unwrap(runtime.createSpace({ document }));
    unwrap(
      space.setQuery("true", {
        datasetId: "temporal-data",
        fields: ["school", "passed"],
        filters: [{ fieldId: "passed", operator: "isTrue" }],
      }),
    );
    await flush();
    expect(schools(space.getQueryState("true"))).toEqual(["start", "after"]);
    unwrap(
      space.setQuery("false", {
        datasetId: "temporal-data",
        fields: ["school", "passed"],
        filters: [{ fieldId: "passed", operator: "isFalse" }],
      }),
    );
    await flush();
    expect(schools(space.getQueryState("false"))).toEqual(["end"]);
    unwrap(space.dispose());
    unwrap(runtime.dispose());
  });
});
