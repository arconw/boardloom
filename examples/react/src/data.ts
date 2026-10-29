import {
  createLocalDatasetProvider,
  type BoardDocumentV1,
  type DatasetDescriptor,
  type DatasetProvider,
  type JsonValue,
} from "@boardloom/core";

const descriptor: DatasetDescriptor = {
  id: "revenue-results",
  label: "Synthetic revenue results",
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
      id: "quarter",
      key: "quarter",
      label: "Quarter",
      type: "string",
      role: "dimension",
      nullable: false,
      allowedValues: ["Q1", "Q2"],
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
      datasetId: "revenue-results",
      label: "All revenue",
      fieldIds: ["team", "quarter", "revenue", "closed_at"],
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
  Object.freeze({
    team: "North",
    quarter: "Q1",
    revenue: 1250,
    closed_at: "2026-01-15T09:30:00Z",
  }),
  Object.freeze({
    team: "North",
    quarter: "Q2",
    revenue: 1380,
    closed_at: "2026-04-12T14:00:00Z",
  }),
  Object.freeze({
    team: "South",
    quarter: "Q1",
    revenue: 980,
    closed_at: "2026-02-03T18:45:00Z",
  }),
  Object.freeze({
    team: "South",
    quarter: "Q2",
    revenue: 1120,
    closed_at: "2026-05-21T07:15:00Z",
  }),
  Object.freeze({
    team: "East",
    quarter: "Q1",
    revenue: 760,
    closed_at: "2026-03-08T11:20:00Z",
  }),
  Object.freeze({
    team: "East",
    quarter: "Q2",
    revenue: 890,
    closed_at: "2026-06-30T22:05:00Z",
  }),
  Object.freeze({
    team: "West",
    quarter: "Q1",
    revenue: 1420,
    closed_at: "2026-01-29T06:10:00Z",
  }),
  Object.freeze({
    team: "West",
    quarter: "Q2",
    revenue: 1610,
    closed_at: "2026-04-27T16:55:00Z",
  }),
]);

export function createExampleProvider(): DatasetProvider {
  const created = createLocalDatasetProvider({
    providerId: "react-example",
    datasets: [{ descriptor, rows }],
  });
  if (!created.ok) {
    throw new Error(created.diagnostics.map((diagnostic) => diagnostic.code).join(", "));
  }
  return created.value;
}

export function createExampleDocument(variant = false): BoardDocumentV1 {
  const createdAt = 1_700_000_000_000;
  return {
    schemaVersion: 1,
    id: variant ? "react-example-board-variant" : "react-example-board",
    title: variant ? "Revenue overview (variant)" : "Revenue overview",
    description: "Synthetic Boardloom React example data. No real records.",
    createdAt,
    updatedAt: createdAt + 60_000,
    theme: { mode: "light" },
    datasets: [
      {
        id: "revenue-results",
        provider: "react-example",
        label: "Synthetic revenue results",
        fields: [
          { id: "team", type: "string", role: "dimension" },
          { id: "quarter", type: "string", role: "dimension" },
          { id: "revenue", type: "number", role: "measure", unit: "points" },
          { id: "closed_at", type: "datetime", role: "dimension", timezone: "UTC" },
        ],
      },
    ],
    slices: [
      {
        id: "all-revenue",
        datasetId: "revenue-results",
        label: "All revenue",
        fieldIds: ["team", "quarter", "revenue", "closed_at"],
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
          text: "Synthetic revenue data rendered by @boardloom/react from the built package.",
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
            field: { datasetId: "revenue-results", fieldId: "revenue" },
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
            field: { datasetId: "revenue-results", fieldId: "team" },
            sliceId: "all-revenue",
          },
          {
            id: "table-revenue",
            role: "measure",
            field: { datasetId: "revenue-results", fieldId: "revenue" },
            sliceId: "all-revenue",
            aggregation: { type: "sum" },
          },
          {
            id: "table-closed",
            role: "dimension",
            field: { datasetId: "revenue-results", fieldId: "closed_at" },
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
        field: { datasetId: "revenue-results", fieldId: "team" },
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
