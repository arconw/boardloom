import type { BoardDocumentV1, DatasetProvider } from "../../../../packages/core/src/index.js";
import { createLocalDatasetProvider } from "../../../../packages/core/src/index.js";
import { createViewerProvider } from "../../view-dom/support/fixture.js";

export function reactExampleDocument(): BoardDocumentV1 {
  const createdAt = 1_700_000_000_000;
  return {
    schemaVersion: 1,
    id: "react-adapter-board",
    title: "Assessment overview",
    description: "Synthetic React adapter fixture.",
    createdAt,
    updatedAt: createdAt + 60_000,
    theme: { mode: "light" },
    datasets: [
      {
        id: "assessment-results",
        provider: "viewer-fixture",
        label: "Assessment results",
        fields: [
          { id: "school_id", type: "string", role: "dimension" },
          { id: "subject", type: "string", role: "dimension" },
          { id: "score", type: "number", role: "measure", unit: "points" },
          { id: "submitted_at", type: "datetime", role: "dimension" },
        ],
      },
    ],
    slices: [
      {
        id: "all-results",
        datasetId: "assessment-results",
        label: "All results",
        fieldIds: ["school_id", "subject", "score", "submitted_at"],
      },
    ],
    filterGroups: [],
    blocks: [
      {
        id: "block-note",
        type: "text",
        title: "Note",
        bindings: [],
        config: { text: "Synthetic React adapter fixture." },
      },
      {
        id: "block-metric",
        type: "metric",
        title: "Average score",
        bindings: [
          {
            id: "metric-score",
            role: "measure",
            axis: "y",
            field: { datasetId: "assessment-results", fieldId: "score" },
            sliceId: "all-results",
            aggregation: { type: "average" },
          },
        ],
        config: { format: { precision: 1 } },
      },
      {
        id: "block-table",
        type: "table",
        title: "Scores by school",
        bindings: [
          {
            id: "table-school",
            role: "dimension",
            field: { datasetId: "assessment-results", fieldId: "school_id" },
            sliceId: "all-results",
          },
          {
            id: "table-score",
            role: "measure",
            field: { datasetId: "assessment-results", fieldId: "score" },
            sliceId: "all-results",
            aggregation: { type: "average" },
          },
        ],
        config: { columns: ["table-school", "table-score"] },
      },
      {
        id: "block-filter",
        type: "filter",
        title: "Filters",
        bindings: [],
        config: { filterIds: ["filter-school"] },
      },
    ],
    filters: [
      {
        id: "filter-school",
        label: "School",
        field: { datasetId: "assessment-results", fieldId: "school_id" },
        operator: "in",
        defaultValue: ["north", "south"],
        viewerEditable: true,
        target: { kind: "board" },
      },
    ],
    comparisons: [],
    layout: {
      desktop: {
        columns: 12,
        placements: [
          { blockId: "block-note", x: 0, y: 0, width: 4, height: 2 },
          { blockId: "block-metric", x: 4, y: 0, width: 4, height: 2 },
          { blockId: "block-table", x: 0, y: 2, width: 8, height: 4 },
          { blockId: "block-filter", x: 8, y: 2, width: 4, height: 4 },
        ],
      },
      tablet: {
        columns: 8,
        placements: [
          { blockId: "block-note", x: 0, y: 0, width: 4, height: 2 },
          { blockId: "block-metric", x: 4, y: 0, width: 4, height: 2 },
          { blockId: "block-table", x: 0, y: 4, width: 8, height: 4 },
          { blockId: "block-filter", x: 0, y: 8, width: 8, height: 4 },
        ],
      },
      narrow: {
        columns: 4,
        placements: [
          { blockId: "block-note", x: 0, y: 0, width: 4, height: 2 },
          { blockId: "block-metric", x: 0, y: 2, width: 4, height: 2 },
          { blockId: "block-table", x: 0, y: 4, width: 4, height: 4 },
          { blockId: "block-filter", x: 0, y: 8, width: 4, height: 4 },
        ],
      },
    },
    extensions: {},
  };
}

export function reactExampleProvider(): DatasetProvider {
  return createViewerProvider();
}

export function reactComparisonDocument(): BoardDocumentV1 {
  const createdAt = 1_700_000_000_000;
  return {
    schemaVersion: 1,
    id: "react-adapter-comparison-board",
    title: "Comparison board",
    description: "Synthetic comparison fixture for the React adapter.",
    createdAt,
    updatedAt: createdAt + 60_000,
    theme: { mode: "light" },
    datasets: [
      {
        id: "current",
        provider: "react-comparison",
        label: "Current term",
        fields: [
          { id: "subject", type: "string", role: "dimension" },
          { id: "score", type: "number", role: "measure", unit: "points" },
        ],
      },
      {
        id: "previous",
        provider: "react-comparison",
        label: "Previous term",
        fields: [
          { id: "subject", type: "string", role: "dimension" },
          { id: "score", type: "number", role: "measure", unit: "points" },
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
    ],
    filterGroups: [],
    blocks: [
      {
        id: "comparison-table",
        type: "table",
        title: "Scores",
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
            axis: "y",
            field: { datasetId: "current", fieldId: "score" },
            sliceId: "term-current",
            aggregation: { type: "average" },
          },
        ],
        config: { comparisonId: "comparison" },
      },
    ],
    filters: [],
    comparisons: [
      {
        id: "comparison",
        label: "Previous term",
        displayMode: "overlay",
        deltaMode: "both",
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
        ],
        alignment: { keys: ["subject"], collation: "unicode", normalization: "none" },
        unitPolicy: { mode: "identical" },
      },
    ],
    layout: {
      desktop: {
        columns: 12,
        placements: [{ blockId: "comparison-table", x: 0, y: 0, width: 12, height: 6 }],
      },
      tablet: {
        columns: 8,
        placements: [{ blockId: "comparison-table", x: 0, y: 0, width: 8, height: 6 }],
      },
      narrow: {
        columns: 4,
        placements: [{ blockId: "comparison-table", x: 0, y: 0, width: 4, height: 6 }],
      },
    },
    extensions: {},
  };
}

export function reactComparisonProvider(): DatasetProvider {
  const descriptor = (id: string) => ({
    id,
    label: id === "current" ? "Current term" : "Previous term",
    version: "2026.1",
    timezone: "UTC",
    temporalRepresentation: "iso8601-offset" as const,
    fields: [
      {
        id: "subject",
        key: "subject",
        label: "Subject",
        type: "string" as const,
        role: "dimension" as const,
        nullable: false,
      },
      {
        id: "score",
        key: "score",
        label: "Score",
        type: "number" as const,
        role: "measure" as const,
        nullable: true,
        unit: { unit: "points", label: "points" },
      },
    ],
    slices: [
      {
        id: `term-${id}`,
        datasetId: id,
        label: id,
        fieldIds: ["subject", "score"],
        supportedOperations: ["filter", "group", "aggregate"] as const,
      },
    ],
    capabilities: {
      grouping: true,
      aggregations: ["average", "sum", "count"] as const,
      filterOperators: ["equals"] as const,
      timeWindow: false,
      timezoneConversion: false,
      local: true,
      pushdownFilters: true,
      serverPaging: false,
      realtime: false,
      comparison: true,
      maxResultSize: null,
    },
  });
  const currentRows = [
    { subject: "Math", score: 10 },
    { subject: "Reading", score: 8 },
  ];
  const previousRows = [
    { subject: "Math", score: 8 },
    { subject: "Reading", score: 6 },
  ];
  const created = createLocalDatasetProvider({
    providerId: "react-comparison",
    datasets: [
      { descriptor: descriptor("current"), rows: currentRows },
      { descriptor: descriptor("previous"), rows: previousRows },
    ],
  });
  if (!created.ok) {
    throw new Error(created.diagnostics.map((diagnostic) => diagnostic.code).join(", "));
  }
  return created.value;
}
