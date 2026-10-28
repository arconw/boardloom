import {
  DIAGNOSTIC_CODES,
  alignComparisonResults,
  buildComparisonPlan,
  createDiagnostic,
  fail,
  hasError,
  ok,
  type BoardDocumentV1,
  type BlockDefinition,
  type ComparisonPlan,
  type ComparisonResult,
  type DatasetDescriptor,
  type Diagnostic,
  type FilterRuntimeState,
  type QueryState,
  type Result,
  canonicalJson,
} from "@boardloom/core";
import type { BoardValidationCatalog } from "@boardloom/core";

export interface DerivedComparisonQuery {
  readonly comparisonId: string;
  readonly plan: ComparisonPlan;
}

export interface DeriveComparisonQueryOptions {
  readonly filterState?: FilterRuntimeState;
  readonly catalog?: BoardValidationCatalog;
  getDatasetDescriptor(datasetId: string): DatasetDescriptor | undefined;
}

export interface ComparisonQueryIds {
  readonly primary: string;
  readonly reference: string;
}

export interface ComparisonViewState {
  readonly plan: ComparisonPlan;
  readonly primary: QueryState | null;
  readonly reference: QueryState | null;
  readonly result: ComparisonResult | null;
  readonly diagnostics: readonly Diagnostic[];
  readonly phase: "loading" | "settled" | "empty" | "partial" | "error" | "stale";
  readonly signature: string;
}

function viewSignature(
  plan: ComparisonPlan,
  primary: QueryState | null,
  reference: QueryState | null,
  result: ComparisonResult | null,
): string {
  return canonicalJson({
    comparisonId: plan.comparisonId,
    blockId: plan.blockId,
    displayMode: plan.displayMode,
    deltaMode: plan.deltaMode,
    measures: plan.measures,
    primary: plan.primary.request,
    reference: plan.reference.request,
    primaryState:
      primary === null
        ? null
        : [primary.phase, primary.requestToken, primary.updatedAt, primary.rows.length],
    referenceState:
      reference === null
        ? null
        : [reference.phase, reference.requestToken, reference.updatedAt, reference.rows.length],
    result:
      result === null
        ? null
        : {
            counts: result.counts,
            rows: result.rows.map((row) => [row.keyText, row.status, row.measures]),
          },
  } as never);
}

function comparisonIdOf(block: BlockDefinition): string | null {
  const value = block.config.comparisonId;
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

export function deriveComparisonQuery(
  document: BoardDocumentV1,
  block: BlockDefinition,
  options: DeriveComparisonQueryOptions,
): Result<DerivedComparisonQuery> {
  const comparisonId = comparisonIdOf(block);
  if (comparisonId === null) {
    return fail([
      createDiagnostic(
        DIAGNOSTIC_CODES.INVALID_REFERENCE,
        `blocks/${block.id}/config/comparisonId`,
        {
          message: "The block does not reference a comparison.",
          relatedIds: [block.id],
        },
      ),
    ]);
  }
  const comparison = document.comparisons?.find((entry) => entry.id === comparisonId);
  if (comparison === undefined) {
    return fail([
      createDiagnostic(DIAGNOSTIC_CODES.INVALID_REFERENCE, `comparisons/${comparisonId}`, {
        message: "The referenced comparison does not exist.",
        relatedIds: [comparisonId],
      }),
    ]);
  }
  const descriptors: Record<string, DatasetDescriptor> = Object.create(null) as Record<
    string,
    DatasetDescriptor
  >;
  for (const datasetId of [comparison.base.datasetId, comparison.reference.datasetId]) {
    const descriptor = options.getDatasetDescriptor(datasetId);
    if (descriptor !== undefined) {
      descriptors[datasetId] = descriptor;
    }
  }
  const plan = buildComparisonPlan(document, comparisonId, block.id, {
    descriptors,
    ...(options.catalog === undefined ? {} : { catalog: options.catalog }),
    ...(options.filterState === undefined ? {} : { filterState: options.filterState }),
  });
  return plan.ok ? ok({ comparisonId, plan: plan.value }) : plan;
}

export function comparisonQueryIds(viewId: string, blockId: string): ComparisonQueryIds {
  return Object.freeze({
    primary: `view:${viewId}:block:${blockId}:primary`,
    reference: `view:${viewId}:block:${blockId}:reference`,
  });
}

function stateReady(state: QueryState): boolean {
  return (
    state.phase === "settled" ||
    state.phase === "empty" ||
    state.phase === "partial" ||
    state.phase === "stale"
  );
}

function mergedPhase(primary: QueryState, reference: QueryState): ComparisonViewState["phase"] {
  if (primary.phase === "error" || reference.phase === "error") {
    return "error";
  }
  if (primary.phase === "stale" || reference.phase === "stale") {
    return "stale";
  }
  if (primary.phase === "partial" || reference.phase === "partial") {
    return "partial";
  }
  if (primary.phase === "empty" && reference.phase === "empty") {
    return "empty";
  }
  if (stateReady(primary) && stateReady(reference)) {
    return primary.rows.length === 0 && reference.rows.length === 0 ? "empty" : "settled";
  }
  return "loading";
}

export function computeComparisonView(
  plan: ComparisonPlan,
  primary: QueryState | null,
  reference: QueryState | null,
): Result<ComparisonViewState> {
  if (primary === null || reference === null) {
    return fail([
      createDiagnostic(DIAGNOSTIC_CODES.QUERY_NOT_FOUND, `comparisons/${plan.comparisonId}`, {
        message: "Both comparison sides require query state.",
        relatedIds: [plan.comparisonId],
      }),
    ]);
  }
  const errors = [
    ...primary.diagnostics.filter((entry) => entry.severity === "error"),
    ...reference.diagnostics.filter((entry) => entry.severity === "error"),
  ];
  if (primary.phase === "error" || reference.phase === "error") {
    return fail(errors.length > 0 ? errors : []);
  }
  const phase = mergedPhase(primary, reference);
  if (!stateReady(primary) || !stateReady(reference)) {
    return ok({
      plan,
      primary,
      reference,
      result: null,
      diagnostics: Object.freeze([]),
      phase,
      signature: viewSignature(plan, primary, reference, null),
    });
  }
  const aligned = alignComparisonResults(plan, primary, reference);
  if (!aligned.ok) {
    return aligned;
  }
  return ok({
    plan,
    primary,
    reference,
    result: aligned.value,
    diagnostics: aligned.value.diagnostics,
    phase,
    signature: viewSignature(plan, primary, reference, aligned.value),
  });
}

export function comparisonViewHasErrors(view: ComparisonViewState): boolean {
  return view.phase === "error" || hasError(view.diagnostics);
}
