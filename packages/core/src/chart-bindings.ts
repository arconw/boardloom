import type { ChartType } from "./board-schema.js";

export interface ChartBindingLike {
  readonly role?: string | null;
  readonly axis?: string | null;
}

export interface ChartBindingSelection<T extends ChartBindingLike> {
  readonly x: T | null;
  readonly y: T | null;
  readonly series: T | null;
  readonly seriesCandidates: readonly T[];
}

function isMeasure(binding: ChartBindingLike): boolean {
  return binding.role === "measure" || binding.role === "value" || binding.axis === "y";
}

function isDimension(binding: ChartBindingLike): boolean {
  return (
    binding.role === "dimension" ||
    binding.role === "series" ||
    binding.role === "group" ||
    binding.role === "label" ||
    binding.axis === "x"
  );
}

function isSeriesCandidate(binding: ChartBindingLike): boolean {
  return (
    binding.role === "dimension" ||
    binding.role === "series" ||
    binding.role === "group" ||
    binding.axis === "x"
  );
}

export function selectChartBindings<T extends ChartBindingLike>(
  bindings: readonly T[],
  visualization: ChartType | null,
): ChartBindingSelection<T> {
  const measures = bindings.filter(isMeasure);
  if (visualization === "scatter") {
    const x = measures.find((binding) => binding.axis === "x") ?? measures[0] ?? null;
    const y =
      measures.find((binding) => binding.axis === "y" && binding !== x) ??
      measures.find((binding) => binding !== x) ??
      null;
    const series =
      bindings.find((binding) => binding.role === "series" || binding.role === "group") ?? null;
    return {
      x,
      y,
      series,
      seriesCandidates: series === null ? Object.freeze([]) : Object.freeze([series]),
    };
  }
  const dimensions = bindings.filter(isDimension);
  const x =
    dimensions.find((binding) => binding.axis === "x") ??
    dimensions.find((binding) => binding.role === "dimension") ??
    dimensions[0] ??
    null;
  const y = measures.find((binding) => binding !== x) ?? null;
  const seriesCandidates = bindings.filter(
    (binding) => binding !== x && binding !== y && isSeriesCandidate(binding),
  );
  return {
    x,
    y,
    series: seriesCandidates[0] ?? null,
    seriesCandidates: Object.freeze(seriesCandidates),
  };
}
