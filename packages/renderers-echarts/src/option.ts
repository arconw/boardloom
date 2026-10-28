import { formatValueParts, type ChartModel, type RendererMessages } from "@boardloom/core";
import type { FormatterProvider } from "@boardloom/core";
import type { EChartsCoreOption } from "echarts/core";

interface TooltipParams {
  readonly name?: string;
  readonly value?: number | readonly (number | string)[] | null;
  readonly percent?: number;
  readonly seriesName?: string;
  readonly data?: unknown;
}

function seriesLabel(model: ChartModel, index: number): string {
  const series = model.series[index];
  if (!series || series.label === null) {
    return model.spec.y.label;
  }
  return series.label;
}

function formatMeasure(
  value: number,
  model: ChartModel,
  formatters: FormatterProvider,
  messages: RendererMessages,
): string {
  const parts = formatValueParts(value, model.spec.y, formatters, messages);
  return parts.text ?? messages.text("chart.missing");
}

function zeroLabel(messages: RendererMessages): string {
  return messages.text("chart.baseline.zero");
}

function formatPercent(percent: number, formatters: FormatterProvider): string {
  try {
    return formatters.formatNumber(percent / 100, {
      style: "percent",
      maximumFractionDigits: 1,
    });
  } catch {
    return `${String(percent)}%`;
  }
}

function axisName(fieldLabel: string, unitText: string): string {
  return unitText === "" ? fieldLabel : `${fieldLabel} (${unitText})`;
}

function axisLabelFormatter(
  model: ChartModel,
  formatters: FormatterProvider,
  messages: RendererMessages,
): (value: number) => string {
  return (value: number) => formatMeasure(value, model, formatters, messages);
}

function tooltipValueFormatter(
  model: ChartModel,
  formatters: FormatterProvider,
  messages: RendererMessages,
): (value: unknown) => string {
  return (value: unknown) => {
    if (typeof value === "number" && Number.isFinite(value)) {
      return formatMeasure(value, model, formatters, messages);
    }
    return messages.text("chart.missing");
  };
}

function donutOption(
  model: ChartModel,
  formatters: FormatterProvider,
  messages: RendererMessages,
  colors: {
    readonly text: string;
    readonly muted: string;
    readonly surface: string;
    readonly palette: readonly string[];
  },
): EChartsCoreOption {
  const values = model.values[0] ?? [];
  const data = model.categories
    .map((category, index) => ({
      name: category.label ?? messages.text("chart.missing"),
      value: values[index] ?? null,
    }))
    .filter((entry) => entry.value !== null && Number.isFinite(entry.value));
  const option = {
    animation: false,
    color: [...colors.palette],
    textStyle: { color: colors.text, fontFamily: "inherit" },
    tooltip: {
      trigger: "item",
      confine: true,
      renderMode: "richText",
      textStyle: { color: colors.text },
      formatter: (params: TooltipParams) => {
        const name = params.name ?? messages.text("chart.missing");
        const value = typeof params.value === "number" ? params.value : null;
        const formatted =
          value === null
            ? messages.text("chart.missing")
            : formatMeasure(value, model, formatters, messages);
        const percent =
          typeof params.percent === "number"
            ? ` (${formatPercent(params.percent, formatters)})`
            : "";
        return `${name}: ${formatted}${percent}`;
      },
    },
    legend: {
      type: "scroll",
      bottom: 0,
      textStyle: { color: colors.muted },
      pageTextStyle: { color: colors.muted },
      data: data.map((entry) => entry.name),
    },
    series: [
      {
        type: "pie",
        radius: ["55%", "80%"],
        center: ["50%", "46%"],
        avoidLabelOverlap: true,
        selectedMode: false,
        itemStyle: {
          borderColor: colors.surface,
          borderWidth: 2,
        },
        label: {
          color: colors.text,
          formatter: (params: TooltipParams) => {
            const name = params.name ?? messages.text("chart.missing");
            const value = typeof params.value === "number" ? params.value : null;
            const formatted =
              value === null
                ? messages.text("chart.missing")
                : formatMeasure(value, model, formatters, messages);
            const percent =
              typeof params.percent === "number"
                ? ` (${formatPercent(params.percent, formatters)})`
                : "";
            return `${name}: ${formatted}${percent}`;
          },
        },
        labelLine: { lineStyle: { color: colors.muted } },
        data,
      },
    ],
  };
  return option as unknown as EChartsCoreOption;
}

function cartesianOption(
  model: ChartModel,
  formatters: FormatterProvider,
  messages: RendererMessages,
  colors: {
    readonly text: string;
    readonly muted: string;
    readonly border: string;
    readonly grid: string;
    readonly axis: string;
    readonly palette: readonly string[];
  },
): EChartsCoreOption {
  const visualization = model.spec.visualization;
  const isScatter = visualization === "scatter";
  const numericLine = visualization === "line" && model.spec.x.type === "number";
  const showLegend = model.seriesCount > 1;
  const xLabels = model.categories.map(
    (category, index) => category.label ?? `${messages.text("chart.missing")} ${String(index + 1)}`,
  );
  const valueFormatter = axisLabelFormatter(model, formatters, messages);
  const yAxis: Record<string, unknown> = {
    type: "value",
    name: axisName(model.spec.yAxis.label ?? model.spec.y.label, model.unitText),
    nameTextStyle: { color: colors.muted },
    axisLabel: { color: colors.muted, formatter: valueFormatter },
    axisLine: { show: true, lineStyle: { color: colors.axis } },
    splitLine: { lineStyle: { color: colors.grid } },
    ...(isScatter
      ? {
          scale: true,
          ...((model.spec.yAxis.min ?? model.yDomainMin) === null
            ? {}
            : { min: model.spec.yAxis.min ?? model.yDomainMin }),
          ...((model.spec.yAxis.max ?? model.yDomainMax) === null
            ? {}
            : { max: model.spec.yAxis.max ?? model.yDomainMax }),
        }
      : {
          scale: false,
          ...((model.spec.yAxis.min ?? model.domainMin) === null
            ? {}
            : { min: model.spec.yAxis.min ?? model.domainMin }),
          ...((model.spec.yAxis.max ?? model.domainMax) === null
            ? {}
            : { max: model.spec.yAxis.max ?? model.domainMax }),
        }),
  };
  const valueXAxis = isScatter || numericLine;
  const xAxis: Record<string, unknown> = valueXAxis
    ? {
        type: "value",
        name: axisName(model.spec.xAxis.label ?? model.spec.x.label, model.xUnitText),
        nameTextStyle: { color: colors.muted },
        axisLabel: {
          color: colors.muted,
          formatter: (value: number) => {
            const parts = formatValueParts(value, model.spec.x, formatters, messages);
            return parts.text ?? messages.text("chart.missing");
          },
        },
        axisLine: { show: true, lineStyle: { color: colors.axis } },
        splitLine: { lineStyle: { color: colors.grid } },
        scale: true,
        ...((model.spec.xAxis.min ?? model.xDomainMin) === null
          ? {}
          : { min: model.spec.xAxis.min ?? model.xDomainMin }),
        ...((model.spec.xAxis.max ?? model.xDomainMax) === null
          ? {}
          : { max: model.spec.xAxis.max ?? model.xDomainMax }),
      }
    : {
        type: "category",
        name: axisName(model.spec.xAxis.label ?? model.spec.x.label, model.xUnitText),
        nameTextStyle: { color: colors.muted },
        data: xLabels,
        axisLabel: {
          color: colors.muted,
          hideOverlap: true,
          ...(xLabels.length > 8 ? { rotate: 30 } : {}),
        },
        axisLine: { show: true, lineStyle: { color: colors.axis } },
        axisTick: { show: false },
      };

  const series = model.series.map((entry, index) => {
    const name = seriesLabel(model, index);
    if (isScatter) {
      const data = model.scatterPoints
        .filter((point) => point.seriesKey === entry.key)
        .filter((point) => point.x !== null && point.y !== null)
        .map((point) => [point.x, point.y]);
      return {
        name,
        type: "scatter",
        data,
        symbolSize: 8,
        emphasis: { focus: "series" },
      };
    }
    const data = numericLine
      ? model.categories
          .map((category, categoryIndexValue) => {
            const xValue = category.raw;
            return typeof xValue === "number"
              ? [xValue, model.values[index]?.[categoryIndexValue] ?? null]
              : null;
          })
          .filter((entry): entry is [number, number | null] => entry !== null)
      : (model.values[index] ?? []);
    if (visualization === "bar" || visualization === "stacked-bar") {
      const stacked = model.spec.stacked;
      return {
        name,
        type: "bar",
        data,
        barMaxWidth: 48,
        ...(stacked ? { stack: "total" } : {}),
        emphasis: { focus: "series" },
      };
    }
    const isArea = visualization === "area";
    const stacked = isArea && model.spec.stacked;
    return {
      name,
      type: "line",
      data,
      connectNulls: false,
      showSymbol: true,
      symbolSize: 6,
      ...(stacked ? { stack: "total" } : {}),
      ...(isArea
        ? {
            areaStyle: {
              origin: 0,
              opacity: 0.14,
            },
          }
        : {
            markLine:
              index === 0
                ? {
                    silent: true,
                    symbol: "none",
                    lineStyle: { color: colors.axis, width: 1, type: "solid" },
                    label: {
                      show: true,
                      position: "insideEndTop",
                      color: colors.muted,
                      formatter: zeroLabel(messages),
                    },
                    data: [{ yAxis: 0 }],
                  }
                : undefined,
          }),
      emphasis: { focus: "series" },
    };
  });

  const option = {
    animation: false,
    color: [...colors.palette],
    textStyle: { color: colors.text, fontFamily: "inherit" },
    grid: {
      left: 8,
      right: 16,
      top: showLegend ? 40 : 28,
      bottom: showLegend ? 48 : 28,
      containLabel: true,
    },
    tooltip: {
      trigger: isScatter ? "item" : "axis",
      confine: true,
      renderMode: "richText",
      textStyle: { color: colors.text },
      valueFormatter: tooltipValueFormatter(model, formatters, messages),
    },
    ...(showLegend
      ? {
          legend: {
            top: 0,
            type: "scroll",
            textStyle: { color: colors.muted },
            pageTextStyle: { color: colors.muted },
            data: model.series.map((_entry, index) => seriesLabel(model, index)),
          },
        }
      : {}),
    xAxis,
    yAxis,
    series,
  };
  return option as unknown as EChartsCoreOption;
}

export interface ChartOptionColors {
  readonly text: string;
  readonly muted: string;
  readonly border: string;
  readonly grid: string;
  readonly axis: string;
  readonly surface: string;
  readonly palette: readonly string[];
}

export function buildEChartsOption(
  model: ChartModel,
  formatters: FormatterProvider,
  messages: RendererMessages,
  colors: ChartOptionColors,
): EChartsCoreOption {
  if (model.spec.visualization === "donut") {
    return donutOption(model, formatters, messages, colors);
  }
  return cartesianOption(model, formatters, messages, colors);
}
