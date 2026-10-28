import type { ChartModel, RendererMessages } from "@boardloom/core";
import type { FormatterProvider } from "@boardloom/core";

export interface ChartSummary {
  readonly items: readonly string[];
  readonly text: string;
  readonly ariaLabel: string;
}

function seriesNames(model: ChartModel, messages: RendererMessages): string[] {
  return model.series.map(
    (series) =>
      series.label ?? (series.missing ? messages.text("chart.missing") : model.spec.y.label),
  );
}

export function buildChartSummary(
  model: ChartModel,
  messages: RendererMessages,
  formatters: FormatterProvider,
): ChartSummary {
  const items: string[] = [];
  const spec = model.spec;
  const title = spec.title ?? messages.text("chart.summary");

  if (model.empty) {
    items.push(messages.text("chart.summary.empty"));
    if (model.nullCount > 0) {
      items.push(messages.plural("chart.summary.missing", model.nullCount));
    }
  } else if (model.zeroTotal) {
    items.push(messages.text("chart.summary.zeroTotal"));
  } else {
    items.push(messages.plural("chart.summary.categories", model.categoryCount));
    const names = seriesNames(model, messages);
    if (model.seriesCount > 1 || (model.seriesCount === 1 && names.length > 0)) {
      items.push(
        messages.plural("chart.summary.series", model.seriesCount, {
          names: formatters.formatList(names, { type: "conjunction" }),
        }),
      );
    }
    items.push(messages.plural("chart.summary.points", model.pointCount));
    if (model.spec.aggregation === "average" && model.nonNullRowCount > 0) {
      items.push(messages.plural("chart.summary.denominator", model.nonNullRowCount));
    }
    if (model.nullCount > 0) {
      items.push(messages.plural("chart.summary.missing", model.nullCount));
    }
    if (model.unitText !== "") {
      items.push(messages.text("chart.summary.units", { units: model.unitText }));
    }
    if (model.baseline === "zero") {
      items.push(messages.text("chart.baseline.zero"));
    } else if (model.baseline === "padded") {
      items.push(messages.text("chart.baseline.padded"));
    }
    if (model.negativeCount > 0) {
      items.push(messages.text("chart.negative.diverging"));
    }
  }

  if (model.spec.kind === "chart" && model.spec.comparison) {
    items.push(messages.text("chart.reference"));
  }
  const text = items.join(". ");
  return Object.freeze({
    items: Object.freeze(items),
    text,
    ariaLabel:
      model.spec.title === null
        ? `${title}. ${text}`
        : `${messages.text("a11y.chartSummary", { title })}. ${text}`,
  });
}
