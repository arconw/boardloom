import {
  createLocalDatasetProvider,
  type BoardDocumentV1,
  type DatasetDescriptor,
  type DatasetProvider,
  type JsonValue,
} from "../../../../packages/core/src/index.js";

const descriptor: DatasetDescriptor = {
  id: "angular-revenue",
  label: "Synthetic Angular revenue",
  version: "2026.1",
  timezone: "UTC",
  temporalRepresentation: "iso8601-offset",
  fields: [
    {
      id: "team",
      key: "team",
      label: "Team",
      type: "string",
      role: "dimension",
      nullable: false,
      allowedValues: ["North", "South", "East", "West"],
    },
    {
      id: "revenue",
      key: "revenue",
      label: "Revenue",
      type: "number",
      role: "measure",
      nullable: true,
      unit: { unit: "points", label: "points" },
    },
    {
      id: "closed_at",
      key: "closed_at",
      label: "Closed",
      type: "datetime",
      role: "temporal",
      nullable: false,
      timezone: "UTC",
      temporalRepresentation: "iso8601-offset",
    },
  ],
  slices: [
    {
      id: "all-revenue",
      datasetId: "angular-revenue",
      label: "All revenue",
      fieldIds: ["team", "revenue", "closed_at"],
      supportedOperations: ["project", "filter", "group", "aggregate", "order", "limit"],
    },
  ],
  capabilities: {
    grouping: true,
    aggregations: ["count", "countDistinct", "sum", "average", "min", "max"],
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
      "contains",
      "isNull",
      "isNotNull",
      "before",
      "after",
      "onOrBefore",
      "onOrAfter",
    ],
    timeWindow: true,
    timezoneConversion: true,
    local: true,
    pushdownFilters: true,
    serverPaging: false,
    realtime: false,
    comparison: false,
    maxResultSize: null,
  },
};

const rows: readonly Readonly<Record<string, JsonValue>>[] = Object.freeze([
  Object.freeze({ team: "North", revenue: 1250, closed_at: "2026-01-15T09:30:00Z" }),
  Object.freeze({ team: "South", revenue: 980, closed_at: "2026-02-03T18:45:00Z" }),
  Object.freeze({ team: "East", revenue: 760, closed_at: "2026-03-08T11:20:00Z" }),
  Object.freeze({ team: "West", revenue: 1420, closed_at: "2026-01-29T06:10:00Z" }),
]);

export function angularExampleProvider(): DatasetProvider {
  const created = createLocalDatasetProvider({
    providerId: "angular-example",
    datasets: [{ descriptor, rows }],
  });
  if (!created.ok) {
    throw new Error(created.diagnostics.map((diagnostic) => diagnostic.code).join(", "));
  }
  return created.value;
}

export function angularExampleDocument(id = "angular-example-board"): BoardDocumentV1 {
  const createdAt = 1_700_000_000_000;
  return {
    schemaVersion: 1,
    id,
    title: "Revenue overview",
    description: "Synthetic Boardloom Angular example data. No real records.",
    createdAt,
    updatedAt: createdAt + 60_000,
    theme: { mode: "light" },
    datasets: [
      {
        id: "angular-revenue",
        provider: "angular-example",
        label: "Synthetic Angular revenue",
        fields: [
          { id: "team", type: "string", role: "dimension" },
          { id: "revenue", type: "number", role: "measure", unit: "points" },
          { id: "closed_at", type: "datetime", role: "dimension", timezone: "UTC" },
        ],
      },
    ],
    slices: [
      {
        id: "all-revenue",
        datasetId: "angular-revenue",
        label: "All revenue",
        fieldIds: ["team", "revenue", "closed_at"],
      },
    ],
    filterGroups: [],
    blocks: [
      {
        id: "note",
        type: "text",
        title: "About this example",
        bindings: [],
        config: {
          text: "Synthetic revenue data rendered by @boardloom/angular from the built package.",
        },
      },
      {
        id: "metric",
        type: "metric",
        title: "Average revenue",
        bindings: [
          {
            id: "metric-revenue",
            role: "measure",
            axis: "y",
            field: { datasetId: "angular-revenue", fieldId: "revenue" },
            sliceId: "all-revenue",
            aggregation: { type: "average" },
          },
        ],
        config: { format: { precision: 1 } },
      },
      {
        id: "table",
        type: "table",
        title: "Revenue by team",
        bindings: [
          {
            id: "table-team",
            role: "dimension",
            field: { datasetId: "angular-revenue", fieldId: "team" },
            sliceId: "all-revenue",
          },
          {
            id: "table-revenue",
            role: "measure",
            field: { datasetId: "angular-revenue", fieldId: "revenue" },
            sliceId: "all-revenue",
            aggregation: { type: "sum" },
          },
          {
            id: "table-closed",
            role: "dimension",
            field: { datasetId: "angular-revenue", fieldId: "closed_at" },
            sliceId: "all-revenue",
          },
        ],
        config: { columns: ["table-team", "table-revenue", "table-closed"] },
      },
      {
        id: "filters",
        type: "filter",
        title: "Filters",
        bindings: [],
        config: { filterIds: ["filter-team"] },
      },
    ],
    filters: [
      {
        id: "filter-team",
        label: "Team",
        field: { datasetId: "angular-revenue", fieldId: "team" },
        operator: "in",
        defaultValue: ["North", "South"],
        viewerEditable: true,
        target: { kind: "board" },
      },
    ],
    comparisons: [],
    layout: {
      desktop: {
        columns: 12,
        placements: [
          { blockId: "note", x: 0, y: 0, width: 4, height: 2 },
          { blockId: "metric", x: 4, y: 0, width: 4, height: 2 },
          { blockId: "filters", x: 8, y: 0, width: 4, height: 4 },
          { blockId: "table", x: 0, y: 2, width: 8, height: 5 },
        ],
      },
      tablet: {
        columns: 8,
        placements: [
          { blockId: "note", x: 0, y: 0, width: 4, height: 2 },
          { blockId: "metric", x: 4, y: 0, width: 4, height: 2 },
          { blockId: "table", x: 0, y: 2, width: 8, height: 5 },
          { blockId: "filters", x: 0, y: 7, width: 8, height: 3 },
        ],
      },
      narrow: {
        columns: 4,
        placements: [
          { blockId: "note", x: 0, y: 0, width: 4, height: 2 },
          { blockId: "metric", x: 0, y: 2, width: 4, height: 2 },
          { blockId: "table", x: 0, y: 4, width: 4, height: 5 },
          { blockId: "filters", x: 0, y: 9, width: 4, height: 3 },
        ],
      },
    },
    extensions: {},
  };
}
