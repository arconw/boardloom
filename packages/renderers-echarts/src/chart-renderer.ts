import {
  BoardloomError,
  DIAGNOSTIC_CODES,
  RENDERER_API_VERSION,
  VISUALIZATION_MATRIX,
  buildChartModel,
  createDiagnostic,
  validateChartRendererSpec,
  type ChartRendererSpec,
  type Diagnostic,
  type RendererCapabilities,
  type RendererDefinition,
  type RendererHandle,
  type RendererInput,
  type RendererSpec,
  type RendererValidation,
} from "@boardloom/core";
import type { ChartType } from "@boardloom/core";
import { echarts } from "./echarts.js";
import type { EChartsType } from "./echarts.js";
import { buildEChartsOption } from "./option.js";
import { buildChartSummary } from "./summary.js";

function capabilitiesFor(visualization: ChartType): RendererCapabilities {
  const entry = VISUALIZATION_MATRIX[visualization];
  return Object.freeze({
    kinds: Object.freeze(["chart"] as const),
    visualizations: Object.freeze([visualization]),
    aggregation:
      entry.aggregation === "none" ||
      entry.aggregation === "declared" ||
      entry.aggregation === "raw-or-grouped"
        ? Object.freeze([])
        : Object.freeze([...entry.aggregation]),
    comparison: entry.comparison !== "none",
    series: entry.series !== "none",
    stacking: entry.stacking === "required" ? "supported" : entry.stacking,
    zeroBaseline: entry.zeroBaseline,
    negativeValues: visualization === "stacked-bar" ? "supported" : entry.negativeValues,
    accessibility: true,
  });
}

function errorDiagnostic(
  spec: ChartRendererSpec,
  model: ReturnType<typeof buildChartModel>,
): Diagnostic | null {
  const failure = model.diagnostics.find((diagnostic) => diagnostic.severity === "error");
  if (failure) {
    return failure;
  }
  if (model.blocked) {
    return createDiagnostic(DIAGNOSTIC_CODES.RENDERER_DATA_INVALID, `chart/${spec.id}/data`, {
      message: "The chart policy rejected this data shape; no geometry is produced.",
    });
  }
  return null;
}

function createChartRenderer(visualization: ChartType): RendererDefinition<HTMLElement> {
  const rendererId = `boardloom.chart.${visualization}`;

  return Object.freeze({
    id: rendererId,
    version: "1.0.0",
    apiVersion: RENDERER_API_VERSION,
    kind: "chart",
    visualizations: Object.freeze([visualization]),
    capabilities: capabilitiesFor(visualization),
    validate(spec: RendererSpec): RendererValidation {
      if (spec.kind !== "chart") {
        return Object.freeze({
          ok: false,
          diagnostics: Object.freeze([
            createDiagnostic(DIAGNOSTIC_CODES.RENDERER_INCOMPATIBLE, `renderer/${rendererId}`, {
              message: `Renderer ${rendererId} only accepts chart specs.`,
            }),
          ]),
        });
      }
      if (spec.visualization !== visualization) {
        return Object.freeze({
          ok: false,
          diagnostics: Object.freeze([
            createDiagnostic(DIAGNOSTIC_CODES.RENDERER_INCOMPATIBLE, `renderer/${rendererId}`, {
              message: `Renderer ${rendererId} does not render ${spec.visualization}.`,
            }),
          ]),
        });
      }
      return validateChartRendererSpec(spec);
    },
    mount(input: RendererInput<HTMLElement>): RendererHandle<HTMLElement> {
      const doc = input.host.ownerDocument;
      const wrapper = doc.createElement("div");
      wrapper.className = "bl-chart-renderer";
      wrapper.setAttribute("data-renderer-id", rendererId);
      const summary = doc.createElement("p");
      summary.className = "bl-chart-summary";
      summary.setAttribute("data-message-key", "chart.summary");
      const plot = doc.createElement("div");
      plot.className = "bl-chart-plot";
      plot.setAttribute("role", "img");
      const empty = doc.createElement("p");
      empty.className = "bl-chart-empty-state";
      empty.setAttribute("role", "status");
      empty.setAttribute("hidden", "");
      wrapper.append(summary, plot, empty);
      input.host.append(wrapper);

      let chart: EChartsType | null = null;
      let resizeObserver: ResizeObserver | null = null;

      const ensureChart = (): EChartsType => {
        if (chart !== null) {
          return chart;
        }
        const width = plot.clientWidth > 0 ? plot.clientWidth : 640;
        const height = plot.clientHeight > 0 ? plot.clientHeight : 320;
        chart = echarts.init(plot, undefined, {
          renderer: "canvas",
          width,
          height,
        });
        const viewWindow = doc.defaultView as
          (Window & { readonly ResizeObserver?: typeof ResizeObserver }) | null;
        const ResizeObserverConstructor = viewWindow?.ResizeObserver;
        if (typeof ResizeObserverConstructor === "function") {
          resizeObserver = new ResizeObserverConstructor(() => {
            chart?.resize();
          });
          resizeObserver.observe(plot);
        }
        return chart;
      };

      const update = (next: RendererInput<HTMLElement>): void => {
        if (next.spec.kind !== "chart") {
          throw new BoardloomError(
            createDiagnostic(DIAGNOSTIC_CODES.RENDERER_INCOMPATIBLE, `renderer/${rendererId}`, {
              message: `Renderer ${rendererId} only accepts chart specs.`,
            }),
          );
        }
        const model = buildChartModel(next.spec, next.data, next.formatters, next.messages);
        const failure = errorDiagnostic(next.spec, model);
        if (failure) {
          throw new BoardloomError(failure);
        }
        const summaryText = buildChartSummary(model, next.messages, next.formatters);
        summary.textContent = summaryText.text;
        summary.setAttribute("data-message-key", "chart.summary");
        plot.setAttribute("aria-label", summaryText.ariaLabel);
        wrapper.setAttribute("data-state", model.empty || model.zeroTotal ? "empty" : "settled");
        wrapper.setAttribute("data-baseline", model.baseline);
        wrapper.setAttribute(
          "data-categories",
          model.categories.map((category) => category.label ?? "").join("|"),
        );
        wrapper.setAttribute("data-negative-count", String(model.negativeCount));
        wrapper.setAttribute("data-null-count", String(model.nullCount));
        wrapper.setAttribute("data-point-count", String(model.pointCount));

        if (model.empty || model.zeroTotal) {
          plot.setAttribute("hidden", "");
          empty.removeAttribute("hidden");
          empty.textContent = model.zeroTotal
            ? next.messages.text("chart.summary.zeroTotal")
            : next.messages.text("chart.summary.empty");
          empty.setAttribute(
            "data-message-key",
            model.zeroTotal ? "chart.summary.zeroTotal" : "chart.summary.empty",
          );
          chart?.clear();
          return;
        }

        plot.removeAttribute("hidden");
        empty.setAttribute("hidden", "");
        empty.textContent = "";
        const option = buildEChartsOption(model, next.formatters, next.messages, {
          ...next.theme.colors,
        });
        const optionRecord = option as Record<string, unknown>;
        const optionXAxis = optionRecord.xAxis as Record<string, unknown> | undefined;
        const optionYAxis = optionRecord.yAxis as Record<string, unknown> | undefined;
        for (const [axisNameValue, axisValue] of [
          ["x", optionXAxis],
          ["y", optionYAxis],
        ] as const) {
          for (const bound of ["min", "max"] as const) {
            const attribute = `data-${axisNameValue}-axis-${bound}`;
            const value = axisValue?.[bound];
            if (typeof value === "number" && Number.isFinite(value)) {
              wrapper.setAttribute(attribute, String(value));
            } else {
              wrapper.removeAttribute(attribute);
            }
          }
        }
        const instance = ensureChart();
        instance.setOption(option, true);
        instance.resize();
      };

      update(input);

      return Object.freeze({
        element: wrapper,
        update,
        destroy(): void {
          resizeObserver?.disconnect();
          resizeObserver = null;
          chart?.dispose();
          chart = null;
          wrapper.remove();
        },
      });
    },
  });
}

export const CHART_RENDERERS: readonly RendererDefinition<HTMLElement>[] = Object.freeze([
  createChartRenderer("line"),
  createChartRenderer("area"),
  createChartRenderer("bar"),
  createChartRenderer("stacked-bar"),
  createChartRenderer("scatter"),
  createChartRenderer("donut"),
]);

export function createEChartsRenderers(): readonly RendererDefinition<HTMLElement>[] {
  return CHART_RENDERERS;
}
