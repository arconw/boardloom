import {
  createBoardValidationCatalog,
  createLocalDatasetProvider,
  createRuntime,
  type BoardDocumentV1,
  type BoardloomRuntime,
  type DatasetProvider,
  type JsonValue,
} from "../../../../packages/core/src/index.js";
import { ASSESSMENT_DESCRIPTOR, ASSESSMENT_ROWS } from "../../core/fixtures/assessment-fixture.js";
import { unwrap } from "../../core/support/assertions.js";
import {
  FakeClock,
  createDeterministicIdFactory,
  createRecordingLogger,
} from "../../core/support/fakes.js";

export function viewerFixtureDocument(): BoardDocumentV1 {
  const createdAt = 1_700_000_000_000;
  return {
    schemaVersion: 1,
    id: "viewer-fixture-board",
    title: "Assessment overview",
    description: "Synthetic viewer fixture.",
    createdAt,
    updatedAt: createdAt + 60_000,
    theme: { mode: "light", tokens: { accent: "#3366cc", "font-sans": "serif" } },
    datasets: [
      {
        id: "assessment-results",
        provider: "viewer-fixture",
        label: "Assessment results",
        fields: [
          { id: "school_id", type: "string", role: "dimension" },
          { id: "subject", type: "string", role: "dimension" },
          { id: "score", type: "number", role: "measure", unit: "points" },
        ],
      },
    ],
    slices: [
      {
        id: "all-results",
        datasetId: "assessment-results",
        label: "All results",
        fieldIds: ["school_id", "subject", "score"],
      },
    ],
    filterGroups: [],
    blocks: [
      {
        id: "block-note",
        type: "text",
        title: "Note",
        bindings: [],
        config: { text: "Synthetic viewer fixture." },
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
        id: "block-chart",
        type: "chart",
        title: "Scores by school",
        bindings: [
          {
            id: "chart-school",
            role: "dimension",
            axis: "x",
            field: { datasetId: "assessment-results", fieldId: "school_id" },
            sliceId: "all-results",
          },
          {
            id: "chart-score",
            role: "measure",
            axis: "y",
            field: { datasetId: "assessment-results", fieldId: "score" },
            sliceId: "all-results",
            aggregation: { type: "average" },
          },
        ],
        config: { visualization: "bar" },
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
          { blockId: "block-chart", x: 8, y: 0, width: 4, height: 4 },
          { blockId: "block-table", x: 0, y: 4, width: 8, height: 4 },
          { blockId: "block-filter", x: 8, y: 4, width: 4, height: 2 },
        ],
      },
      tablet: {
        columns: 8,
        placements: [
          { blockId: "block-note", x: 0, y: 0, width: 4, height: 2 },
          { blockId: "block-metric", x: 4, y: 0, width: 4, height: 2 },
          { blockId: "block-chart", x: 0, y: 2, width: 8, height: 4 },
          { blockId: "block-table", x: 0, y: 6, width: 8, height: 4 },
          { blockId: "block-filter", x: 0, y: 10, width: 8, height: 2 },
        ],
      },
      narrow: {
        columns: 4,
        placements: [
          { blockId: "block-note", x: 0, y: 0, width: 4, height: 2 },
          { blockId: "block-metric", x: 0, y: 2, width: 4, height: 2 },
          { blockId: "block-chart", x: 0, y: 4, width: 4, height: 4 },
          { blockId: "block-table", x: 0, y: 8, width: 4, height: 4 },
          { blockId: "block-filter", x: 0, y: 12, width: 4, height: 2 },
        ],
      },
    },
    extensions: {},
  };
}

export function viewerFixtureRows(): readonly Readonly<Record<string, JsonValue>>[] {
  return ASSESSMENT_ROWS;
}

export function createViewerProvider(
  rows: readonly Readonly<Record<string, JsonValue>>[] = viewerFixtureRows(),
): DatasetProvider {
  return unwrap(
    createLocalDatasetProvider({
      providerId: "viewer-fixture",
      datasets: [{ descriptor: ASSESSMENT_DESCRIPTOR, rows }],
    }),
  );
}

export function createViewerRuntime(
  provider: DatasetProvider = createViewerProvider(),
  options: { readonly withCatalog?: boolean } = {},
): {
  readonly runtime: BoardloomRuntime;
  readonly clock: FakeClock;
} {
  const clock = new FakeClock();
  const runtime = createRuntime({
    clock,
    logger: createRecordingLogger(),
    idFactory: createDeterministicIdFactory("viewer"),
    datasetProvider: provider,
    ...(options.withCatalog === false
      ? {}
      : { validationCatalog: createBoardValidationCatalog([ASSESSMENT_DESCRIPTOR]) }),
  });
  return { runtime, clock };
}
