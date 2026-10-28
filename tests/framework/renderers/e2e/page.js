import {
  ENGLISH_MESSAGES,
  createBoardValidationCatalog,
  createLocalDatasetProvider,
  createRuntime,
} from "@boardloom/core";
import { mountBoardView } from "@boardloom/view-dom";
import { CHART_RENDERERS } from "./renderers.js";

const result = {
  checks: {},
  errors: [],
};

function must(value) {
  if (!value || value.ok !== true) {
    const diagnostics = value && value.diagnostics ? value.diagnostics : [];
    throw new Error(diagnostics.map((item) => item.code).join(", ") || "operation failed");
  }
  return value.value;
}

function check(name, condition, detail) {
  if (!condition) {
    result.errors.push(detail === undefined ? name : `${name}: ${detail}`);
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const DATASET_ID = "gallery-data";
const SLICE_ID = "all-gallery";

const descriptor = {
  id: DATASET_ID,
  label: "Synthetic gallery data",
  version: "2026.1",
  timezone: "UTC",
  temporalRepresentation: "iso8601-offset",
  fields: [
    {
      id: "month",
      key: "month",
      label: "Month",
      type: "date",
      role: "temporal",
      nullable: false,
      timezone: "UTC",
      temporalRepresentation: "iso8601-offset",
    },
    {
      id: "segment",
      key: "segment",
      label: "Segment",
      type: "string",
      role: "dimension",
      nullable: false,
    },
    {
      id: "region",
      key: "region",
      label: "Region",
      type: "string",
      role: "dimension",
      nullable: false,
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
      id: "positive",
      key: "positive",
      label: "Positive revenue",
      type: "number",
      role: "measure",
      nullable: false,
      unit: { unit: "points", label: "points" },
    },
    {
      id: "units",
      key: "units",
      label: "Units",
      type: "number",
      role: "measure",
      nullable: false,
      unit: { unit: "points", label: "points" },
    },
    {
      id: "timestamp",
      key: "timestamp",
      label: "Timestamp",
      type: "datetime",
      role: "temporal",
      nullable: false,
      timezone: "UTC",
      temporalRepresentation: "iso8601-offset",
    },
    {
      id: "percent",
      key: "percent",
      label: "Percent",
      type: "number",
      role: "measure",
      nullable: false,
      unit: { unit: "percent", scale: 1, label: "%" },
    },
    {
      id: "xnum",
      key: "xnum",
      label: "X measure",
      type: "number",
      role: "dimension",
      nullable: true,
    },
    {
      id: "ynum",
      key: "ynum",
      label: "Y measure",
      type: "number",
      role: "measure",
      nullable: false,
    },
  ],
  slices: [
    {
      id: SLICE_ID,
      datasetId: DATASET_ID,
      label: "All gallery data",
      fieldIds: [
        "month",
        "segment",
        "region",
        "revenue",
        "positive",
        "units",
        "timestamp",
        "percent",
        "xnum",
        "ynum",
      ],
      supportedOperations: ["project", "filter", "group", "aggregate", "order", "limit"],
    },
  ],
  capabilities: {
    grouping: true,
    aggregations: ["count", "countDistinct", "sum", "average", "min", "max", "median", "mode"],
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

const monthValues = ["2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01"];
const segments = ["Alpha", "Beta", "Gamma", "Delta"];
const regions = ["North", "South"];
const baseRevenue = { Alpha: 12, Beta: -7, Gamma: 5, Delta: 0 };

function galleryRows() {
  const rows = [];
  for (const [monthIndex, month] of monthValues.entries()) {
    for (const segment of segments) {
      for (const region of regions) {
        const regionFactor = region === "North" ? 1 : 2;
        const revenue = baseRevenue[segment] + regionFactor + monthIndex;
        const isNull = segment === "Alpha" && region === "North" && monthIndex === 1;
        const isMissingX = segment === "Beta" && region === "North" && monthIndex === 0;
        rows.push({
          month,
          segment,
          region,
          revenue: isNull ? null : revenue,
          positive: Math.max(revenue, 0),
          units: 4 + monthIndex + regionFactor,
          timestamp: monthIndex === 0 ? "2025-12-31T20:00:00Z" : `${month}T12:00:00Z`,
          percent: 74,
          xnum: isMissingX ? null : monthIndex + 1 + regionFactor / 10,
          ynum: Math.max(revenue, 0) * 2 + monthIndex,
        });
      }
    }
  }
  return rows;
}

function documentFields() {
  return [
    { id: "month", type: "date", role: "dimension", timezone: "UTC" },
    {
      id: "segment",
      type: "string",
      role: "dimension",
      allowedValues: ["Delta", "Beta", "Alpha", "Gamma"],
    },
    { id: "region", type: "string", role: "dimension" },
    { id: "revenue", type: "number", role: "measure", unit: "points" },
    { id: "positive", type: "number", role: "measure", unit: "points" },
    { id: "units", type: "number", role: "measure", unit: "points" },
    { id: "timestamp", type: "datetime", role: "dimension", timezone: "UTC" },
    { id: "percent", type: "number", role: "measure", unit: "percent" },
    { id: "xnum", type: "number", role: "dimension" },
    { id: "ynum", type: "number", role: "measure" },
  ];
}

function field(fieldId) {
  return { datasetId: DATASET_ID, fieldId };
}

function binding(id, role, fieldId, extra = {}) {
  return { id, role, field: field(fieldId), sliceId: SLICE_ID, ...extra };
}

function chartBlock(id, title, visualization, bindings, options = {}) {
  return {
    id,
    type: "chart",
    title,
    bindings,
    config: { visualization, ...(Object.keys(options).length === 0 ? {} : { options }) },
  };
}

function galleryDocument() {
  const createdAt = 1_700_000_000_000;
  return {
    schemaVersion: 1,
    id: "gallery-board",
    title: "Renderer gallery",
    description: "Synthetic renderer cases for null, zero, negative and empty data.",
    createdAt,
    updatedAt: createdAt + 60_000,
    theme: { mode: "light" },
    datasets: [
      {
        id: DATASET_ID,
        provider: "gallery-e2e",
        label: "Synthetic gallery data",
        fields: documentFields(),
      },
    ],
    slices: [
      {
        id: SLICE_ID,
        datasetId: DATASET_ID,
        label: "All gallery data",
        fieldIds: [
          "month",
          "segment",
          "region",
          "revenue",
          "positive",
          "units",
          "timestamp",
          "percent",
          "xnum",
          "ynum",
        ],
      },
    ],
    filterGroups: [],
    blocks: [
      chartBlock(
        "line",
        "Line",
        "line",
        [
          binding("line-month", "dimension", "month", { axis: "x" }),
          binding("line-revenue", "measure", "revenue", {
            axis: "y",
            format: { precision: 0 },
            aggregation: { type: "average" },
          }),
          binding("line-region", "series", "region"),
        ],
        { categoryOrder: "ascending" },
      ),
      chartBlock(
        "area",
        "Area",
        "area",
        [
          binding("area-month", "dimension", "month", { axis: "x" }),
          binding("area-units", "measure", "units", {
            axis: "y",
            aggregation: { type: "average" },
          }),
          binding("area-region", "series", "region"),
        ],
        { categoryOrder: "ascending" },
      ),
      chartBlock(
        "bar",
        "Bar",
        "bar",
        [
          binding("bar-segment", "dimension", "segment", { axis: "x" }),
          binding("bar-revenue", "measure", "revenue", {
            axis: "y",
            aggregation: { type: "sum" },
          }),
          binding("bar-region", "series", "region"),
        ],
        { categoryOrder: "descending" },
      ),
      chartBlock(
        "stacked",
        "Stacked bar",
        "stacked-bar",
        [
          binding("stacked-segment", "dimension", "segment", { axis: "x" }),
          binding("stacked-positive", "measure", "positive", {
            axis: "y",
            aggregation: { type: "sum" },
          }),
          binding("stacked-region", "series", "region"),
        ],
        { stacked: true },
      ),
      chartBlock(
        "scatter",
        "Scatter",
        "scatter",
        [
          binding("scatter-x", "measure", "xnum", { axis: "x" }),
          binding("scatter-y", "measure", "ynum", { axis: "y" }),
          binding("scatter-region", "series", "region"),
        ],
        { xAxis: { min: 0, max: 10 }, yAxis: { min: 0, max: 60 } },
      ),
      chartBlock(
        "donut",
        "Donut",
        "donut",
        [
          binding("donut-segment", "dimension", "segment", { axis: "x" }),
          binding("donut-positive", "measure", "positive", {
            axis: "y",
            aggregation: { type: "sum" },
          }),
        ],
        { categoryOrder: "declared" },
      ),
      {
        id: "metric",
        type: "metric",
        title: "Average revenue",
        bindings: [
          binding("metric-revenue", "measure", "revenue", {
            axis: "y",
            label: "Average revenue",
            aggregation: { type: "average" },
          }),
        ],
        config: { format: { precision: 1 } },
      },
      {
        id: "table",
        type: "table",
        title: "Segment table",
        bindings: [
          binding("table-segment", "dimension", "segment", { label: "Segment" }),
          binding("table-revenue", "measure", "revenue", {
            label: "Revenue",
            aggregation: { type: "sum" },
          }),
          binding("table-positive", "measure", "positive", {
            label: "Positive revenue",
            aggregation: { type: "sum" },
          }),
        ],
        config: {
          columns: ["table-positive", "table-segment", "table-revenue"],
        },
      },
      {
        id: "timezone-table",
        type: "table",
        title: "Timezone table",
        bindings: [
          binding("tz-timestamp", "dimension", "timestamp", {
            format: { timezone: "Asia/Tokyo", dateStyle: "medium", timeStyle: "short" },
          }),
          binding("tz-revenue", "measure", "revenue", {
            aggregation: { type: "sum" },
          }),
        ],
        config: { columns: ["tz-timestamp", "tz-revenue"] },
      },
    ],
    filters: [],
    comparisons: [],
    layout: {
      desktop: {
        columns: 12,
        rowHeight: 32,
        placements: [
          { blockId: "line", x: 0, y: 0, width: 4, height: 6 },
          { blockId: "area", x: 4, y: 0, width: 4, height: 6 },
          { blockId: "bar", x: 8, y: 0, width: 4, height: 6 },
          { blockId: "stacked", x: 0, y: 6, width: 4, height: 6 },
          { blockId: "scatter", x: 4, y: 6, width: 4, height: 6 },
          { blockId: "donut", x: 8, y: 6, width: 4, height: 6 },
          { blockId: "metric", x: 0, y: 12, width: 4, height: 3 },
          { blockId: "table", x: 4, y: 12, width: 8, height: 4 },
          { blockId: "timezone-table", x: 0, y: 16, width: 12, height: 4 },
        ],
      },
    },
    extensions: {},
  };
}

function invalidDocument() {
  const base = galleryDocument();
  return {
    ...base,
    id: "invalid-board",
    title: "Invalid stacked bar",
    blocks: [
      chartBlock(
        "invalid-stacked",
        "Stacked bar with negative values",
        "stacked-bar",
        [
          binding("invalid-segment", "dimension", "segment", { axis: "x" }),
          binding("invalid-revenue", "measure", "revenue", {
            axis: "y",
            aggregation: { type: "sum" },
          }),
          binding("invalid-region", "series", "region"),
        ],
        { stacked: true },
      ),
    ],
    layout: {
      desktop: {
        columns: 12,
        rowHeight: 32,
        placements: [{ blockId: "invalid-stacked", x: 0, y: 0, width: 12, height: 8 }],
      },
    },
  };
}

function emptyDocument() {
  const base = galleryDocument();
  return {
    ...base,
    id: "empty-board",
    title: "Empty gallery",
    blocks: [
      chartBlock("empty-bar", "Empty bar", "bar", [
        binding("empty-segment", "dimension", "segment", { axis: "x" }),
        binding("empty-revenue", "measure", "revenue", {
          axis: "y",
          aggregation: { type: "sum" },
        }),
      ]),
    ],
    layout: {
      desktop: {
        columns: 12,
        rowHeight: 32,
        placements: [{ blockId: "empty-bar", x: 0, y: 0, width: 12, height: 8 }],
      },
    },
  };
}

function edgeDocument() {
  const base = galleryDocument();
  return {
    ...base,
    id: "edge-board",
    title: "Edge cases",
    blocks: [
      chartBlock(
        "numeric-line",
        "Numeric line",
        "line",
        [
          binding("numeric-line-x", "dimension", "xnum", { axis: "x" }),
          binding("numeric-line-y", "measure", "revenue", {
            axis: "y",
            aggregation: { type: "average" },
          }),
        ],
        { categoryOrder: "ascending" },
      ),
      chartBlock(
        "grouped",
        "Grouped negative bars",
        "stacked-bar",
        [
          binding("grouped-segment", "dimension", "segment", { axis: "x" }),
          binding("grouped-revenue", "measure", "revenue", {
            axis: "y",
            aggregation: { type: "sum" },
          }),
          binding("grouped-region", "series", "region"),
        ],
        { stacked: false },
      ),
      {
        id: "percent-binding",
        type: "metric",
        title: "Percent binding override",
        bindings: [
          binding("percent-binding-value", "measure", "percent", {
            axis: "y",
            aggregation: { type: "average" },
            format: { unit: "percent" },
          }),
        ],
        config: {},
      },
      {
        id: "percent-config",
        type: "metric",
        title: "Percent config override",
        bindings: [
          binding("percent-config-value", "measure", "percent", {
            axis: "y",
            aggregation: { type: "average" },
          }),
        ],
        config: { format: { unit: "percent" } },
      },
    ],
    layout: {
      desktop: {
        columns: 12,
        rowHeight: 32,
        placements: [
          { blockId: "numeric-line", x: 0, y: 0, width: 6, height: 6 },
          { blockId: "grouped", x: 6, y: 0, width: 6, height: 6 },
          { blockId: "percent-binding", x: 0, y: 6, width: 6, height: 3 },
          { blockId: "percent-config", x: 6, y: 6, width: 6, height: 3 },
        ],
      },
    },
  };
}

function customDocument() {
  const base = galleryDocument();
  const line = base.blocks.find((block) => block.id === "line");
  return {
    ...base,
    id: "custom-board",
    title: "Custom renderer",
    blocks: [line],
    layout: {
      desktop: {
        columns: 12,
        rowHeight: 32,
        placements: [{ blockId: "line", x: 0, y: 0, width: 12, height: 8 }],
      },
    },
  };
}

function createProvider(rows) {
  return must(
    createLocalDatasetProvider({
      providerId: "gallery-e2e",
      datasets: [{ descriptor, rows }],
    }),
  );
}

function mount(targetId, documentValue, rows, renderers) {
  const runtime = createRuntime({
    datasetProvider: createProvider(rows),
    validationCatalog: createBoardValidationCatalog([descriptor]),
  });
  const space = must(runtime.createSpace({ document: documentValue }));
  const handle = must(
    mountBoardView(document.getElementById(targetId), {
      space,
      theme: "light",
      ...(renderers === undefined ? {} : { renderers }),
    }),
  );
  return { handle, space, runtime };
}

function dispose(instance) {
  instance.handle.unmount();
  if (!instance.space.disposed) {
    instance.space.dispose();
  }
  if (!instance.runtime.disposed) {
    instance.runtime.dispose();
  }
}

function customRenderer() {
  return {
    id: "test.custom-line",
    version: "1.0.0",
    apiVersion: 1,
    kind: "chart",
    visualizations: ["line"],
    capabilities: {
      kinds: ["chart"],
      visualizations: ["line"],
      aggregation: ["average"],
      comparison: false,
      series: true,
      stacking: "rejected",
      zeroBaseline: "visible",
      negativeValues: "supported",
      accessibility: true,
    },
    validate() {
      return { ok: true, diagnostics: [] };
    },
    mount(input) {
      const element = document.createElement("div");
      element.className = "custom-renderer";
      input.host.append(element);
      window.__custom = { updates: 0, destroyed: 0 };
      const update = (next) => {
        window.__custom.updates += 1;
        element.textContent = `custom renderer: ${next.data.rows.length} rows`;
      };
      update(input);
      return {
        update,
        destroy() {
          window.__custom.destroyed = 1;
          element.remove();
        },
      };
    },
  };
}

function missingMessageKeys(element) {
  const missing = [];
  for (const node of element.querySelectorAll("[data-message-key]")) {
    const key = node.getAttribute("data-message-key");
    if (key && ENGLISH_MESSAGES[key] === undefined) {
      missing.push(key);
    }
  }
  return missing;
}

async function run() {
  try {
    const instances = [];
    const gallery = mount("gallery", galleryDocument(), galleryRows(), CHART_RENDERERS);
    instances.push(gallery);
    const invalid = mount("invalid", invalidDocument(), galleryRows(), CHART_RENDERERS);
    instances.push(invalid);
    const empty = mount("empty", emptyDocument(), [], CHART_RENDERERS);
    instances.push(empty);
    const custom = mount("custom", customDocument(), galleryRows(), [
      ...CHART_RENDERERS.filter((renderer) => !renderer.visualizations.includes("line")),
      customRenderer(),
    ]);
    instances.push(custom);
    const edges = mount("edges", edgeDocument(), galleryRows(), CHART_RENDERERS);
    instances.push(edges);
    await wait(500);

    const element = gallery.handle.element;
    const chartWrappers = element.querySelectorAll(".bl-chart-renderer");
    result.checks.blocks = element.querySelectorAll(".bl-block").length;
    result.checks.charts = chartWrappers.length;
    result.checks.canvases = element.querySelectorAll("canvas").length;
    result.checks.chartTables = element.querySelectorAll(".bl-chart-data__table table").length;
    result.checks.plotImages = element.querySelectorAll('.bl-chart-plot[role="img"]').length;
    result.checks.chartSummaries = [...element.querySelectorAll(".bl-chart-summary")].filter(
      (summary) => (summary.textContent ?? "").trim() !== "",
    ).length;
    result.checks.chartCaptions = element.querySelectorAll(
      ".bl-chart-data__table table caption",
    ).length;
    result.checks.chartColumnHeaders = element.querySelectorAll(
      ".bl-chart-data__table th[scope='col']",
    ).length;
    result.checks.chartRowHeaders = element.querySelectorAll(
      ".bl-chart-data__table th[scope='row']",
    ).length;
    result.checks.kpiRole = element.querySelector(".bl-metric")?.getAttribute("role");
    result.checks.kpiAria = element.querySelector(".bl-metric")?.getAttribute("aria-label");
    const tableBlock = element.querySelector('[data-block-id="table"]');
    result.checks.tableRegionRole = tableBlock
      ?.querySelector(".bl-table-region")
      ?.getAttribute("role");
    result.checks.tableRegionTabIndex = tableBlock
      ?.querySelector(".bl-table-region")
      ?.getAttribute("tabindex");
    result.checks.tableCaption = tableBlock?.querySelector(".bl-table__caption")?.textContent ?? "";
    result.checks.metricValue = element.querySelector(".bl-metric__value")?.textContent ?? "";
    result.checks.metricLabel = element.querySelector(".bl-metric")?.getAttribute("aria-label");
    result.checks.tableBlockHeaders = [
      ...(tableBlock?.querySelectorAll(".bl-table thead th") ?? []),
    ].map((header) => header.textContent);
    const timezoneTable = element.querySelector('[data-block-id="timezone-table"]');
    result.checks.timezoneCell =
      timezoneTable?.querySelector(".bl-table tbody tr th, .bl-table tbody tr td")?.textContent ??
      "";
    result.checks.captionIdsUnique = (() => {
      const ids = [...element.querySelectorAll(".bl-table__caption")].map((caption) => caption.id);
      return ids.length > 0 && new Set(ids).size === ids.length;
    })();
    result.checks.tableRows = element.querySelectorAll(".bl-table tbody tr").length;
    result.checks.tableHeaders = [...element.querySelectorAll(".bl-table thead th")].map(
      (header) => header.textContent,
    );
    result.checks.tableRegions = element.querySelectorAll(".bl-table-region").length;
    result.checks.missingKeys = missingMessageKeys(element);

    const wrappersByBlock = new Map();
    for (const block of element.querySelectorAll("[data-block-id]")) {
      wrappersByBlock.set(block.getAttribute("data-block-id"), block);
    }
    const line = wrappersByBlock.get("line");
    const scatter = wrappersByBlock.get("scatter");
    const bar = wrappersByBlock.get("bar");
    result.checks.lineState = line?.querySelector(".bl-chart-renderer")?.getAttribute("data-state");
    result.checks.lineNulls = Number(
      line?.querySelector(".bl-chart-renderer")?.getAttribute("data-null-count"),
    );
    result.checks.barNegatives = Number(
      bar?.querySelector(".bl-chart-renderer")?.getAttribute("data-negative-count"),
    );
    result.checks.scatterBaseline = scatter
      ?.querySelector(".bl-chart-renderer")
      ?.getAttribute("data-baseline");
    result.checks.scatterNulls = Number(
      scatter?.querySelector(".bl-chart-renderer")?.getAttribute("data-null-count"),
    );
    result.checks.scatterPointCount = Number(
      scatter?.querySelector(".bl-chart-renderer")?.getAttribute("data-point-count"),
    );
    result.checks.scatterXAxisMin = Number(
      scatter?.querySelector(".bl-chart-renderer")?.getAttribute("data-x-axis-min"),
    );
    result.checks.scatterXAxisMax = Number(
      scatter?.querySelector(".bl-chart-renderer")?.getAttribute("data-x-axis-max"),
    );
    result.checks.scatterYAxisMin = Number(
      scatter?.querySelector(".bl-chart-renderer")?.getAttribute("data-y-axis-min"),
    );
    result.checks.scatterYAxisMax = Number(
      scatter?.querySelector(".bl-chart-renderer")?.getAttribute("data-y-axis-max"),
    );
    result.checks.scatterSummary = scatter?.querySelector(".bl-chart-summary")?.textContent ?? "";
    result.checks.donutState = wrappersByBlock
      .get("donut")
      ?.querySelector(".bl-chart-renderer")
      ?.getAttribute("data-state");
    result.checks.donutCategories = wrappersByBlock
      .get("donut")
      ?.querySelector(".bl-chart-renderer")
      ?.getAttribute("data-categories");
    result.checks.lineAria = line?.querySelector(".bl-chart-plot")?.getAttribute("aria-label");
    result.checks.lineHasZeroBaseline = String(
      line?.querySelector(".bl-chart-renderer")?.getAttribute("data-baseline"),
    ).includes("zero");

    const summary = element.querySelector(".bl-chart-data__summary");
    summary?.focus();
    result.checks.summaryFocusable = document.activeElement === summary;
    result.checks.detailsOpen = element.querySelector(".bl-chart-data")?.open === true;
    result.checks.chartTableFirstRow =
      element.querySelector(".bl-chart-data__table tbody tr")?.textContent ?? "";
    result.checks.lineAltValue =
      line?.querySelector(".bl-chart-data__table tbody tr td:last-child")?.textContent ?? "";

    const invalidElement = invalid.handle.element;
    result.checks.invalidErrors = invalidElement.querySelectorAll(".bl-state--error").length;
    result.checks.invalidText = invalidElement.textContent ?? "";
    result.checks.invalidCanvases = invalidElement.querySelectorAll("canvas").length;
    result.checks.invalidHasDiagnostic = (invalidElement.textContent ?? "").includes(
      "RENDERER_DATA_INVALID",
    );
    result.checks.invalidAlertRoles = invalidElement.querySelectorAll('[role="alert"]').length;

    const emptyElement = empty.handle.element;
    result.checks.emptyStates = emptyElement.querySelectorAll(".bl-state--empty").length;
    result.checks.emptyCanvases = emptyElement.querySelectorAll("canvas").length;

    const edgesElement = edges.handle.element;
    const numericLine = edgesElement.querySelector('[data-block-id="numeric-line"]');
    const grouped = edgesElement.querySelector('[data-block-id="grouped"]');
    result.checks.edgeCharts = edgesElement.querySelectorAll(".bl-chart-renderer").length;
    result.checks.edgeCanvases = edgesElement.querySelectorAll("canvas").length;
    result.checks.numericLineState = numericLine
      ?.querySelector(".bl-chart-renderer")
      ?.getAttribute("data-state");
    result.checks.numericLineNulls = Number(
      numericLine?.querySelector(".bl-chart-renderer")?.getAttribute("data-null-count"),
    );
    result.checks.numericLinePoints = Number(
      numericLine?.querySelector(".bl-chart-renderer")?.getAttribute("data-point-count"),
    );
    result.checks.numericLineSummary =
      numericLine?.querySelector(".bl-chart-summary")?.textContent ?? "";
    result.checks.groupedState = grouped
      ?.querySelector(".bl-chart-renderer")
      ?.getAttribute("data-state");
    result.checks.groupedNegatives = Number(
      grouped?.querySelector(".bl-chart-renderer")?.getAttribute("data-negative-count"),
    );
    result.checks.groupedErrors = grouped?.querySelectorAll(".bl-state--error").length ?? 0;
    result.checks.percentBindingValue =
      edgesElement.querySelector('[data-block-id="percent-binding"] .bl-metric__value')
        ?.textContent ?? "";
    result.checks.percentConfigValue =
      edgesElement.querySelector('[data-block-id="percent-config"] .bl-metric__value')
        ?.textContent ?? "";

    const customElement = custom.handle.element;
    result.checks.customRendered = customElement.querySelectorAll(".custom-renderer").length;
    result.checks.customText = customElement.querySelector(".custom-renderer")?.textContent ?? "";
    result.checks.customUpdates = window.__custom?.updates ?? 0;
    result.checks.customCanvases = customElement.querySelectorAll("canvas").length;
    custom.handle.unmount();
    result.checks.customDestroyed = window.__custom?.destroyed ?? 0;
    custom.space.dispose();
    custom.runtime.dispose();
    instances.splice(instances.indexOf(custom), 1);

    const focusRegion = tableBlock?.querySelector(".bl-table-region");
    focusRegion?.focus();
    gallery.handle.update({ theme: "dark" });
    await wait(300);
    result.checks.tableFocusPreserved =
      document.activeElement !== null &&
      document.activeElement.classList.contains("bl-table-region");
    result.checks.scrollWidth = document.documentElement.scrollWidth;
    result.checks.innerWidth = window.innerWidth;
    result.checks.noHorizontalOverflow = document.documentElement.scrollWidth <= window.innerWidth;

    for (const instance of instances) {
      dispose(instance);
    }
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
  }
  document.getElementById("result").textContent = JSON.stringify(result);
}

void run();
