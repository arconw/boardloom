import { describe, expect, it } from "vitest";
import {
  DIAGNOSTIC_CODES,
  buildQueryPlan,
  type BoardDocument,
  type BindingDefinition,
  type BlockDefinition,
} from "../../../../packages/core/src/index.js";
import {
  blockQueryId,
  deriveBlockQuery,
  querySpecSignature,
} from "../../../../packages/view-dom/src/block-query.js";
import { expectFailure, unwrap } from "../../core/support/assertions.js";
import { ASSESSMENT_DESCRIPTOR } from "../../core/fixtures/assessment-fixture.js";
import { viewerFixtureDocument } from "../support/fixture.js";

function block(document: ReturnType<typeof viewerFixtureDocument>, id: string): BlockDefinition {
  const found = document.blocks.find((candidate) => candidate.id === id);
  if (!found) {
    throw new Error(`missing fixture block ${id}`);
  }
  return found;
}

function documentValue(): BoardDocument {
  return viewerFixtureDocument() as unknown as BoardDocument;
}

describe("T06 block query derivation", () => {
  it("derives a metric aggregate and applies declared board filter defaults", () => {
    const derived = unwrap(
      deriveBlockQuery(documentValue(), block(viewerFixtureDocument(), "block-metric")),
    );
    expect(derived.valueBindingId).toBe("metric-score");
    expect(derived.spec).toEqual({
      datasetId: "assessment-results",
      sliceId: "all-results",
      filters: [
        {
          id: "filter-school",
          fieldId: "school_id",
          operator: "in",
          value: ["north", "south"],
        },
      ],
      aggregations: [{ output: "metric-score", type: "average", fieldId: "score" }],
    });
  });

  it("applies active filter values and cross-filter selections in deterministic order", () => {
    const document = viewerFixtureDocument();
    const derived = unwrap(
      deriveBlockQuery(documentValue(), block(document, "block-table"), {
        filterState: {
          activeValues: [{ filterId: "filter-school", value: ["north"] }],
          crossFilters: [
            {
              id: "selection",
              sourceBlockId: "block-chart",
              field: { datasetId: "assessment-results", fieldId: "subject" },
              operator: "equals",
              value: "math",
            },
          ],
        },
      }),
    );
    expect(derived.spec.filters).toEqual([
      {
        id: "filter-school",
        fieldId: "school_id",
        operator: "in",
        value: ["north"],
      },
      {
        id: "selection",
        fieldId: "subject",
        operator: "equals",
        value: "math",
      },
    ]);
    expect(derived.filterConflicts).toEqual([]);
  });

  it("derives grouped table and chart queries with stable aggregation outputs", () => {
    const document = viewerFixtureDocument();
    const table = unwrap(deriveBlockQuery(documentValue(), block(document, "block-table")));
    expect(table.spec.groupBy).toEqual([{ fieldId: "school_id" }]);
    expect(table.spec.aggregations).toEqual([
      { output: "table-score", type: "average", fieldId: "score" },
    ]);
    const chart = unwrap(deriveBlockQuery(documentValue(), block(document, "block-chart")));
    expect(chart.spec.groupBy).toEqual([{ fieldId: "school_id" }]);
    expect(chart.spec.aggregations).toEqual([
      { output: "chart-score", type: "average", fieldId: "score" },
    ]);
  });

  it("keeps a chart label binding that the selector ignores out of query grouping", () => {
    const document = viewerFixtureDocument();
    const chart = block(document, "block-chart");
    const labelBinding: BindingDefinition = {
      id: "chart-label",
      role: "label",
      field: { datasetId: "assessment-results", fieldId: "subject" },
      sliceId: "all-results",
    };
    const withLabel: BlockDefinition = {
      ...chart,
      bindings: [labelBinding, ...(chart.bindings ?? [])],
    };
    const derived = unwrap(deriveBlockQuery(documentValue(), withLabel));
    expect(derived.spec.groupBy).toEqual([{ fieldId: "school_id" }]);
    expect(derived.spec.groupBy?.some((group) => group.fieldId === "subject")).toBe(false);
    expect(derived.spec.aggregations).toEqual([
      { output: "chart-score", type: "average", fieldId: "score" },
    ]);
  });

  it("carries a distinct series selection through query planning", () => {
    const document = viewerFixtureDocument();
    const chart = block(document, "block-chart");
    const withSeries: BlockDefinition = {
      ...chart,
      bindings: [
        ...(chart.bindings ?? []),
        {
          id: "chart-series",
          role: "series",
          field: { datasetId: "assessment-results", fieldId: "subject" },
          sliceId: "all-results",
        },
      ],
    };
    const derived = unwrap(deriveBlockQuery(documentValue(), withSeries));
    expect(derived.spec.groupBy).toEqual([{ fieldId: "school_id" }, { fieldId: "subject" }]);
    expect(buildQueryPlan(ASSESSMENT_DESCRIPTOR, derived.spec).ok).toBe(true);

    const duplicateGrouped: BlockDefinition = {
      ...chart,
      bindings: [
        ...(chart.bindings ?? []),
        {
          id: "chart-series",
          role: "series",
          field: { datasetId: "assessment-results", fieldId: "school_id" },
          sliceId: "all-results",
        },
      ],
    };
    const duplicate = unwrap(deriveBlockQuery(documentValue(), duplicateGrouped));
    expectFailure(
      buildQueryPlan(ASSESSMENT_DESCRIPTOR, duplicate.spec),
      DIAGNOSTIC_CODES.DUPLICATE_ID,
    );
  });

  it("keeps canonical signatures stable for equivalent query specs", () => {
    const document = viewerFixtureDocument();
    const first = unwrap(deriveBlockQuery(documentValue(), block(document, "block-table")));
    const reordered = {
      ...first.spec,
      aggregations: [
        {
          fieldId: "score",
          type: "average" as const,
          output: "table-score",
        },
      ],
      groupBy: [{ fieldId: "school_id" }],
    };
    expect(querySpecSignature(first.spec)).toBe(querySpecSignature(reordered));
    expect(blockQueryId("view-1", "block-table")).toBe("view:view-1:block:block-table");
  });

  it("rejects non-data blocks and mixed datasets instead of inventing a query", () => {
    const document = viewerFixtureDocument();
    expectFailure(
      deriveBlockQuery(documentValue(), block(document, "block-note")),
      DIAGNOSTIC_CODES.INVALID_REFERENCE,
    );
    const metric = block(document, "block-metric");
    const first = metric.bindings?.[0] as BindingDefinition;
    const mixed: BlockDefinition = {
      ...metric,
      bindings: [
        first,
        {
          ...first,
          id: "metric-second",
          field: { datasetId: "other-dataset", fieldId: "score" },
        },
      ],
    };
    expectFailure(deriveBlockQuery(documentValue(), mixed), DIAGNOSTIC_CODES.INVALID_REFERENCE);
  });

  it("rejects a metric without an aggregating measure", () => {
    const document = viewerFixtureDocument();
    const metric = block(document, "block-metric");
    const invalid: BlockDefinition = {
      ...metric,
      bindings: [{ ...(metric.bindings?.[0] as BindingDefinition), aggregation: { type: "none" } }],
    };
    expectFailure(deriveBlockQuery(documentValue(), invalid), DIAGNOSTIC_CODES.INVALID_REFERENCE);
  });
});
