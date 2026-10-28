import {
  ENGLISH_MESSAGES,
  createBoardValidationCatalog,
  createLocalDatasetProvider,
  createRuntime,
} from "@boardloom/core";
import { mountBoardView } from "/build/view-dom/dist/index.js";

const result = {
  checks: {},
  errors: [],
};

function must(value) {
  if (!value || value.ok !== true) {
    const diagnostics = value && value.diagnostics ? value.diagnostics : [];
    throw new Error(
      diagnostics.map((item) => `${item.code} ${item.path}`).join(", ") || "operation failed",
    );
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

function buildFixture() {
  const descriptor = {
    id: "viewer-data",
    label: "Synthetic viewer data",
    version: "2026.1",
    timezone: "UTC",
    temporalRepresentation: "iso8601-offset",
    fields: [
      {
        id: "school_id",
        key: "school_id",
        label: "School",
        type: "string",
        role: "dimension",
        nullable: false,
      },
      {
        id: "subject",
        key: "subject",
        label: "Subject",
        type: "string",
        role: "dimension",
        nullable: false,
      },
      {
        id: "score",
        key: "score",
        label: "Score",
        type: "number",
        role: "measure",
        nullable: true,
        unit: { unit: "points", label: "points" },
      },
      {
        id: "submitted_at",
        key: "submitted_at",
        label: "Submitted",
        type: "datetime",
        role: "temporal",
        nullable: false,
        timezone: "UTC",
        temporalRepresentation: "iso8601-offset",
      },
    ],
    slices: [
      {
        id: "all-results",
        datasetId: "viewer-data",
        label: "All results",
        fieldIds: ["school_id", "subject", "score", "submitted_at"],
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
  const rows = [
    { school_id: "north", subject: "math", score: 10, submitted_at: "2026-10-01T10:00:00Z" },
    { school_id: "north", subject: "reading", score: 6, submitted_at: "2026-10-02T10:00:00Z" },
    { school_id: "south", subject: "math", score: 4, submitted_at: "2026-10-03T10:00:00Z" },
    { school_id: "south", subject: "reading", score: 8, submitted_at: "2026-10-04T10:00:00Z" },
    { school_id: "east", subject: "math", score: 2, submitted_at: "2026-10-05T10:00:00Z" },
    { school_id: "east", subject: "science", score: null, submitted_at: "2026-10-06T10:00:00Z" },
  ];
  const document = {
    schemaVersion: 1,
    id: "viewer-e2e-board",
    title: "Assessment overview",
    description: "Synthetic viewer fixture.",
    createdAt: 1700000000000,
    updatedAt: 1700000060000,
    theme: { mode: "light" },
    datasets: [
      {
        id: "viewer-data",
        provider: "viewer-e2e",
        label: "Synthetic viewer data",
        fields: descriptor.fields.map((field) => ({
          id: field.id,
          type: field.type,
          role: field.role === "temporal" ? "dimension" : field.role,
          ...(field.unit === undefined ? {} : { unit: field.unit.unit }),
        })),
      },
    ],
    slices: [
      {
        id: "all-results",
        datasetId: "viewer-data",
        label: "All results",
        fieldIds: ["school_id", "subject", "score", "submitted_at"],
      },
    ],
    filterGroups: [],
    blocks: [
      {
        id: "note",
        type: "text",
        title: "Note",
        bindings: [],
        config: { text: "Synthetic viewer fixture." },
      },
      {
        id: "metric",
        type: "metric",
        title: "Average score",
        bindings: [
          {
            id: "metric-score",
            role: "measure",
            axis: "y",
            mode: "fixed",
            field: { datasetId: "viewer-data", fieldId: "score" },
            sliceId: "all-results",
            aggregation: { type: "average" },
          },
        ],
        config: { format: { precision: 1 } },
      },
      {
        id: "table",
        type: "table",
        title: "Scores by school",
        bindings: [
          {
            id: "table-school",
            role: "dimension",
            field: { datasetId: "viewer-data", fieldId: "school_id" },
            sliceId: "all-results",
          },
          {
            id: "table-score",
            role: "measure",
            field: { datasetId: "viewer-data", fieldId: "score" },
            sliceId: "all-results",
            aggregation: { type: "average" },
          },
        ],
        config: { columns: ["table-school", "table-score"] },
      },
      {
        id: "chart",
        type: "chart",
        title: "Scores by school",
        bindings: [
          {
            id: "chart-school",
            role: "dimension",
            axis: "x",
            field: { datasetId: "viewer-data", fieldId: "school_id" },
            sliceId: "all-results",
          },
          {
            id: "chart-score",
            role: "measure",
            axis: "y",
            field: { datasetId: "viewer-data", fieldId: "score" },
            sliceId: "all-results",
            aggregation: { type: "average" },
          },
        ],
        config: { visualization: "bar" },
      },
      {
        id: "filter-block",
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
        field: { datasetId: "viewer-data", fieldId: "school_id" },
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
          { blockId: "note", x: 0, y: 0, width: 4, height: 2 },
          { blockId: "metric", x: 4, y: 0, width: 4, height: 2 },
          { blockId: "chart", x: 8, y: 0, width: 4, height: 4 },
          { blockId: "table", x: 0, y: 4, width: 8, height: 4 },
          { blockId: "filter-block", x: 8, y: 4, width: 4, height: 2 },
        ],
      },
      tablet: {
        columns: 8,
        placements: [
          { blockId: "note", x: 0, y: 0, width: 4, height: 2 },
          { blockId: "metric", x: 4, y: 0, width: 4, height: 2 },
          { blockId: "chart", x: 0, y: 2, width: 8, height: 4 },
          { blockId: "table", x: 0, y: 6, width: 8, height: 4 },
          { blockId: "filter-block", x: 0, y: 10, width: 8, height: 2 },
        ],
      },
      narrow: {
        columns: 4,
        placements: [
          { blockId: "note", x: 0, y: 0, width: 4, height: 2 },
          { blockId: "metric", x: 0, y: 2, width: 4, height: 2 },
          { blockId: "chart", x: 0, y: 4, width: 4, height: 4 },
          { blockId: "table", x: 0, y: 8, width: 4, height: 4 },
          { blockId: "filter-block", x: 0, y: 12, width: 4, height: 2 },
        ],
      },
    },
    extensions: {},
  };
  return { descriptor, rows, document };
}

async function run() {
  try {
    const fixture = buildFixture();
    const provider = must(
      createLocalDatasetProvider({
        providerId: "viewer-e2e",
        datasets: [{ descriptor: fixture.descriptor, rows: fixture.rows }],
      }),
    );
    const runtime = createRuntime({
      datasetProvider: provider,
      validationCatalog: createBoardValidationCatalog([fixture.descriptor]),
    });
    const space = must(runtime.createSpace({ document: fixture.document }));
    const target = document.getElementById("instance");
    const handle = must(
      mountBoardView(target, {
        space,
        theme: "light",
        realtime: { status: "live" },
        provenance: "Synthetic fixture",
      }),
    );
    await wait(40);

    const element = handle.element;
    const bodyBackground = getComputedStyle(document.body).backgroundColor;
    const lightBackground = getComputedStyle(element).backgroundColor;
    result.checks.blocks = element.querySelectorAll(".bl-block").length;
    result.checks.settled = element.querySelectorAll("[data-state='settled']").length;
    result.checks.loading = element.querySelectorAll("[data-state='loading']").length;
    result.checks.lightBackground = lightBackground;
    result.checks.bodyBackground = bodyBackground;
    result.checks.bodyBackgroundBefore = bodyBackground;
    result.checks.metricValue = element.querySelector(".bl-metric__value")?.textContent ?? "";
    result.checks.tableRows = element.querySelectorAll("tbody tr").length;
    result.checks.tableRegions = element.querySelectorAll(".bl-table-region").length;
    const tableBlock = element.querySelector('[data-block-id="table"]');
    result.checks.gridRowStart = tableBlock ? getComputedStyle(tableBlock).gridRowStart : null;
    result.checks.gridRowEnd = tableBlock ? getComputedStyle(tableBlock).gridRowEnd : null;
    result.checks.dirBefore = element.getAttribute("dir");
    result.checks.hostDirBefore = document.documentElement.getAttribute("dir");
    result.checks.skipTarget = element.querySelector(".bl-skip-link")?.getAttribute("href");
    result.checks.bodyId = element.querySelector(".bl-body")?.id ?? "";
    result.checks.headerRole = element.querySelector("header")?.getAttribute("role");
    result.checks.bodyRole = element.querySelector(".bl-body")?.getAttribute("role");
    result.checks.statusRole = element.querySelector(".bl-status")?.getAttribute("role");
    result.checks.modeGroupRole = element.querySelector(".bl-modes")?.getAttribute("role");
    result.checks.innerWidth = window.innerWidth;
    result.checks.scrollWidth = document.documentElement.scrollWidth;
    result.checks.breakpoint = element.getAttribute("data-boardloom-breakpoint");
    const missingKeys = [];
    for (const keyed of element.querySelectorAll("[data-message-key]")) {
      const key = keyed.getAttribute("data-message-key");
      if (typeof ENGLISH_MESSAGES[key] !== "string") {
        missingKeys.push(key);
      }
    }
    result.checks.missingKeys = missingKeys;

    const filterItem = element.querySelector(
      '[data-block-id="filter-block"] .bl-filter-item[data-filter-id="filter-school"]',
    );
    const filterValueControl = filterItem?.querySelector('[data-filter-control="value"]');
    const chipBefore = element.querySelector(
      '[data-filter-chip="filter-school"] .bl-filter-chip__value',
    );
    result.checks.filterUi = {
      item: filterItem !== null && filterItem !== undefined,
      control: filterValueControl !== null && filterValueControl !== undefined,
      chip: chipBefore?.textContent ?? null,
      resetButtons: element.querySelectorAll('[data-filter-reset="filter-school"]').length,
    };
    if (filterValueControl) {
      filterValueControl.value = "east";
      filterValueControl.dispatchEvent(new Event("change", { bubbles: true }));
      await wait(40);
    }
    result.checks.filterActive = {
      state: space.getFilterState().activeValues,
      chip:
        element.querySelector('[data-filter-chip="filter-school"] .bl-filter-chip__value')
          ?.textContent ?? null,
      tableRows: element.querySelectorAll('[data-block-id="table"] tbody tr').length,
      metric: element.querySelector(".bl-metric__value")?.textContent ?? "",
    };
    const chipReset = element.querySelector('.bl-filter-chip [data-filter-reset="filter-school"]');
    if (chipReset) {
      chipReset.click();
      await wait(40);
    }
    result.checks.filterReset = {
      state: space.getFilterState().activeValues,
      chip:
        element.querySelector('[data-filter-chip="filter-school"] .bl-filter-chip__value')
          ?.textContent ?? null,
    };
    const filterResetButton = element.querySelector(
      '.bl-filter-chip [data-filter-reset="filter-school"]',
    );
    result.checks.filterA11y = {
      controlLabel:
        element
          .querySelector('[data-block-id="filter-block"] [data-filter-control="value"]')
          ?.getAttribute("aria-label") ?? null,
      resetLabel: filterResetButton?.getAttribute("aria-label") ?? null,
      resetKey: filterResetButton?.getAttribute("data-message-key") ?? null,
      liveKey: element.querySelector(".bl-live")?.getAttribute("data-announcement-key") ?? null,
      crossPressed:
        element
          .querySelector('[data-block-id="chart"] .bl-cross-select')
          ?.getAttribute("aria-pressed") ?? null,
      crossLabel:
        element
          .querySelector('[data-block-id="chart"] .bl-cross-select')
          ?.getAttribute("aria-label") ?? null,
      minTarget:
        filterResetButton === null
          ? null
          : getComputedStyle(filterResetButton).minBlockSize ||
            getComputedStyle(filterResetButton).minHeight,
    };
    const crossButton = element.querySelector('[data-block-id="chart"] .bl-cross-select');
    if (crossButton) {
      crossButton.click();
      await wait(40);
    }
    result.checks.crossFilterOn = {
      selections: space.getFilterState().crossFilters.length,
      chips: element.querySelectorAll(".bl-filter-chip--selection").length,
      pressed:
        element
          .querySelector('[data-block-id="chart"] .bl-cross-select')
          ?.getAttribute("aria-pressed") ?? null,
      label:
        element
          .querySelector('[data-block-id="chart"] .bl-cross-select')
          ?.getAttribute("aria-label") ?? null,
      chipText: element.querySelector(".bl-filter-chip--selection")?.textContent ?? null,
    };
    const crossOff = element.querySelector('[data-block-id="chart"] .bl-cross-select');
    if (crossOff) {
      crossOff.click();
      await wait(40);
    }
    result.checks.crossFilterOff = {
      selections: space.getFilterState().crossFilters.length,
      chips: element.querySelectorAll(".bl-filter-chip--selection").length,
    };

    must(
      handle.update({
        messages: {
          "a11y.boardRegion": "Board region e2e",
          "a11y.filterRegion": "Filter region e2e",
          "a11y.liveRegion": "Live region e2e",
          "viewer.filters.active": "Active filters e2e",
        },
      }),
    );
    await wait(10);
    result.checks.messageBoardName = element.querySelector(".bl-body")?.getAttribute("aria-label");
    result.checks.messageFilterName = element
      .querySelector(".bl-filters")
      ?.getAttribute("aria-label");
    result.checks.messageLiveName = element.querySelector(".bl-live")?.getAttribute("aria-label");
    result.checks.messageFilterHeadings = Array.from(element.querySelectorAll(".bl-overline")).map(
      (heading) => heading.textContent,
    );

    const revisionBefore = space.getSnapshot().committedRevision;
    const queryCountBefore = space.getQueryStates().length;
    must(handle.update({ locale: "ar", theme: "dark", provenance: "Synthetic fixture" }));
    await wait(20);
    const darkBackground = getComputedStyle(element).backgroundColor;
    result.checks.darkBackground = darkBackground;
    result.checks.dirAfter = element.getAttribute("dir");
    result.checks.langAfter = element.getAttribute("lang");
    result.checks.hostDirAfter = document.documentElement.getAttribute("dir");
    result.checks.bodyBackgroundAfter = getComputedStyle(document.body).backgroundColor;
    result.checks.revisionPreserved = space.getSnapshot().committedRevision === revisionBefore;
    result.checks.queryCountPreserved = space.getQueryStates().length === queryCountBefore;
    result.checks.themeChanged =
      lightBackground !== darkBackground &&
      result.checks.bodyBackground === result.checks.bodyBackgroundAfter;
    result.checks.metricDir = element
      .querySelector(".bl-metric__value .bl-numeric")
      ?.getAttribute("dir");
    result.checks.numericDirCount = element.querySelectorAll('[dir="ltr"]').length;
    const metricLabel = element.querySelector(".bl-metric__label");
    const metricValue = element.querySelector(".bl-metric__value");
    result.checks.metricAlignment = {
      label: metricLabel ? getComputedStyle(metricLabel).textAlign : null,
      value: metricValue ? getComputedStyle(metricValue).textAlign : null,
    };
    const tableAlignmentBlock = element.querySelector('[data-block-id="table"]');
    const scoreHeader = tableAlignmentBlock?.querySelectorAll('th[scope="col"]')[1];
    const scoreCell = tableAlignmentBlock?.querySelector("td .bl-numeric")?.parentElement;
    result.checks.tableAlignment = {
      header: scoreHeader ? getComputedStyle(scoreHeader).textAlign : null,
      value: scoreCell ? getComputedStyle(scoreCell).textAlign : null,
      headerDirection: scoreHeader ? getComputedStyle(scoreHeader).direction : null,
      valueDirection: scoreCell ? getComputedStyle(scoreCell).direction : null,
    };

    const lease = must(space.acquireEditorLease({ sessionId: "e2e-session" }));
    must(handle.setMode("editor", { lease }));
    await wait(10);
    result.checks.modeAfterSwitch = element.getAttribute("data-boardloom-mode");
    expectMode(handle.view.mode, "editor");

    function bindingControl(blockId, slot, control) {
      return element.querySelector(
        `.bl-binding-control[data-binding-block="${blockId}"][data-binding-slot="${slot}"][data-binding-control="${control}"]`,
      );
    }
    function optionState(select, attribute, value) {
      const option = Array.from(select?.options ?? []).find(
        (candidate) => candidate.getAttribute(attribute) === value,
      );
      return option ? !option.disabled : null;
    }

    const inspector = element.querySelector(".bl-inspector");
    const manager = inspector?.querySelector(".bl-filter-manager");
    const managerRow = inspector?.querySelector('.bl-filter-row[data-filter-id="filter-school"]');
    const managerDefault = managerRow?.querySelector('[data-filter-control="default"]');
    if (managerDefault) {
      managerDefault.value = "west";
      managerDefault.dispatchEvent(new Event("change", { bubbles: true }));
      await wait(40);
    }
    const managerDraftFilter = space
      .getSnapshot()
      .draft?.document.filters.find((entry) => entry.id === "filter-school");
    const managerAdd = inspector?.querySelector('[data-filter-action="add"]');
    const managerRowsBefore = inspector?.querySelectorAll(".bl-filter-row").length ?? 0;
    if (managerAdd) {
      managerAdd.click();
      await wait(40);
    }
    const pendingFilter = inspector?.querySelector('.bl-filter-row[data-filter-pending="true"]');
    const pendingFilterId = pendingFilter?.getAttribute("data-filter-id");
    if (pendingFilterId) {
      inspector?.querySelector(`[data-filter-apply="${pendingFilterId}"]`)?.click();
      await wait(40);
    }
    result.checks.filterManager = {
      present: manager !== null && manager !== undefined,
      rowsBefore: managerRowsBefore,
      rowsAfter: inspector?.querySelectorAll(".bl-filter-row").length ?? 0,
      defaultAfter: managerDraftFilter?.defaultValue ?? null,
      filtersInDraft: space.getSnapshot().draft?.document.filters.length ?? 0,
      addPresent: managerAdd !== null && managerAdd !== undefined,
    };
    const chartX = bindingControl("chart", "x", "field");
    const chartY = bindingControl("chart", "y", "field");
    const chartSeries = bindingControl("chart", "series", "field");
    const chartGroup = bindingControl("chart", "group", "field");
    const chartAggregation = bindingControl("chart", "y", "aggregation");
    const metricY = bindingControl("metric", "y", "field");
    const metricAggregation = bindingControl("metric", "y", "aggregation");
    result.checks.bindingInspector = {
      hidden: inspector ? inspector.hasAttribute("hidden") : null,
      slots: [chartX, chartY, chartSeries, chartGroup].every(Boolean),
      sumEnabled: optionState(chartAggregation, "data-aggregation", "sum"),
      countEnabled: optionState(chartAggregation, "data-aggregation", "count"),
      medianEnabled: optionState(chartAggregation, "data-aggregation", "median"),
      stringMeasureEnabled: optionState(chartY, "data-field-id", "school_id"),
      numericMeasureEnabled: optionState(chartY, "data-field-id", "score"),
      metricLocked: metricY?.hasAttribute("disabled") ?? null,
      metricAggregationLocked: metricAggregation?.hasAttribute("disabled") ?? null,
      metricMode: metricY?.getAttribute("data-binding-mode") ?? null,
      lockText: inspector?.textContent ?? "",
    };

    if (chartAggregation) {
      chartAggregation.value = "sum";
      chartAggregation.dispatchEvent(new Event("change", { bubbles: true }));
      await wait(30);
    }
    const chartSeriesAfterRender = bindingControl("chart", "series", "field");
    if (chartSeriesAfterRender) {
      const seriesValue = Array.from(chartSeriesAfterRender.options).find(
        (option) => option.getAttribute("data-field-id") === "subject",
      )?.value;
      if (seriesValue !== undefined) {
        chartSeriesAfterRender.value = seriesValue;
        chartSeriesAfterRender.dispatchEvent(new Event("change", { bubbles: true }));
        await wait(30);
      }
    }
    const draftDocument = space.getSnapshot().draft?.document;
    const draftChart = draftDocument?.blocks.find((block) => block.id === "chart");
    const draftMeasure = draftChart?.bindings.find((entry) => entry.id === "chart-score");
    const draftSeries = draftChart?.bindings.find((entry) => entry.role === "series");
    const invalidAggregation = space.updateBinding(lease, {
      blockId: "chart",
      slot: "y",
      field: { datasetId: "viewer-data", fieldId: "score" },
      aggregation: "median",
    });
    const lockedMetric = space.updateBinding(lease, {
      blockId: "metric",
      slot: "y",
      field: { datasetId: "viewer-data", fieldId: "score" },
      aggregation: "sum",
    });
    result.checks.bindingDraft = {
      aggregation: draftMeasure?.aggregation?.type ?? null,
      seriesRole: draftSeries?.role ?? null,
      seriesField: draftSeries?.field?.fieldId ?? null,
      committedAggregation:
        space
          .getSnapshot()
          .committedDocument.blocks.find((block) => block.id === "chart")
          ?.bindings.find((entry) => entry.id === "chart-score")?.aggregation?.type ?? null,
    };
    result.checks.bindingRejections = {
      invalidAggregation: invalidAggregation.ok
        ? null
        : (invalidAggregation.diagnostics[0]?.code ?? null),
      fixedBinding: lockedMetric.ok ? null : (lockedMetric.diagnostics[0]?.code ?? null),
    };

    must(handle.setMode("viewer"));
    await wait(10);
    result.checks.modeAfterReturn = element.getAttribute("data-boardloom-mode");
    result.checks.inspectorAfterReturn = element
      .querySelector(".bl-inspector")
      ?.hasAttribute("hidden");

    const secondTarget = document.getElementById("second");
    const secondRuntime = createRuntime({
      datasetProvider: provider,
      validationCatalog: createBoardValidationCatalog([fixture.descriptor]),
    });
    const secondSpace = must(
      secondRuntime.createSpace({ document: fixture.document, locale: "en" }),
    );
    const secondHandle = must(
      mountBoardView(secondTarget, {
        space: secondSpace,
        theme: "light",
        realtime: { status: "historical" },
      }),
    );
    await wait(30);
    result.checks.multi = {
      firstTheme: element.getAttribute("data-boardloom-theme"),
      secondTheme: secondHandle.element.getAttribute("data-boardloom-theme"),
      firstDir: element.getAttribute("dir"),
      secondDir: secondHandle.element.getAttribute("dir"),
      secondBlocks: secondHandle.element.querySelectorAll(".bl-block").length,
    };

    const thirdTarget = document.getElementById("third");
    const emptyProvider = must(
      createLocalDatasetProvider({
        providerId: "viewer-e2e-empty",
        datasets: [{ descriptor: fixture.descriptor, rows: [] }],
      }),
    );
    const thirdRuntime = createRuntime({
      datasetProvider: emptyProvider,
      validationCatalog: createBoardValidationCatalog([fixture.descriptor]),
    });
    const thirdSpace = must(thirdRuntime.createSpace({ document: fixture.document }));
    const thirdHandle = must(
      mountBoardView(thirdTarget, {
        space: thirdSpace,
        theme: "light",
        realtime: { status: "historical" },
      }),
    );
    await wait(30);
    const thirdChart = thirdHandle.element.querySelector(".bl-chart-data");
    result.checks.embeddedNarrow = {
      breakpoint: thirdHandle.element.getAttribute("data-boardloom-breakpoint"),
      headerDirection: getComputedStyle(thirdHandle.element.querySelector(".bl-header"))
        .flexDirection,
      viewerGap: getComputedStyle(thirdHandle.element).rowGap,
      chartDisplay: thirdChart ? getComputedStyle(thirdChart).display : null,
      chartRects: thirdChart ? thirdChart.getClientRects().length : null,
      blocks: thirdHandle.element.querySelectorAll(".bl-block").length,
    };

    const otherDescriptor = {
      ...fixture.descriptor,
      id: "viewer-other",
      label: "Synthetic other dataset",
      slices: fixture.descriptor.slices.map((slice) => ({
        ...slice,
        datasetId: "viewer-other",
      })),
    };
    const multiDocument = JSON.parse(JSON.stringify(fixture.document));
    multiDocument.datasets.push({
      id: "viewer-other",
      provider: "viewer-e2e",
      label: "Synthetic other dataset",
      fields: otherDescriptor.fields.map((field) => ({
        id: field.id,
        type: field.type,
        role: field.role === "temporal" ? "dimension" : field.role,
        ...(field.unit === undefined ? {} : { unit: field.unit.unit }),
      })),
    });
    multiDocument.filters[0].mappings = [
      {
        source: { datasetId: "viewer-data", fieldId: "school_id" },
        target: { datasetId: "viewer-other", fieldId: "school_id" },
      },
    ];
    multiDocument.blocks.push({
      id: "table-other",
      type: "table",
      title: "Other scores",
      bindings: [
        {
          id: "other-school",
          role: "dimension",
          field: { datasetId: "viewer-other", fieldId: "school_id" },
        },
        {
          id: "other-score",
          role: "measure",
          field: { datasetId: "viewer-other", fieldId: "score" },
          aggregation: { type: "average" },
        },
      ],
      config: { columns: ["other-school", "other-score"] },
    });
    multiDocument.layout.desktop.placements.push({
      blockId: "table-other",
      x: 0,
      y: 8,
      width: 8,
      height: 4,
    });
    multiDocument.layout.tablet.placements.push({
      blockId: "table-other",
      x: 0,
      y: 14,
      width: 8,
      height: 4,
    });
    multiDocument.layout.narrow.placements.push({
      blockId: "table-other",
      x: 0,
      y: 16,
      width: 4,
      height: 4,
    });
    const multiProvider = must(
      createLocalDatasetProvider({
        providerId: "viewer-e2e-multi",
        datasets: [
          { descriptor: fixture.descriptor, rows: fixture.rows },
          { descriptor: otherDescriptor, rows: fixture.rows },
        ],
      }),
    );
    const multiRuntime = createRuntime({
      datasetProvider: multiProvider,
      validationCatalog: createBoardValidationCatalog([fixture.descriptor, otherDescriptor]),
    });
    const multiCreated = multiRuntime.createSpace({ document: multiDocument, locale: "en" });
    if (!multiCreated.ok) {
      result.errors.push(
        `multi-create: ${multiCreated.diagnostics.map((item) => `${item.code} ${item.path}`).join(", ")}`,
      );
      throw new Error("multi space creation failed");
    }
    const multiSpace = multiCreated.value;
    const fourthTarget = document.getElementById("fourth");
    const multiHandle = must(
      mountBoardView(fourthTarget, {
        space: multiSpace,
        theme: "light",
        realtime: { status: "historical" },
      }),
    );
    await wait(40);
    must(
      multiSpace.setCrossFilter(
        {
          sourceBlockId: "chart",
          field: { datasetId: "viewer-data", fieldId: "school_id" },
          operator: "equals",
          value: "north",
        },
        { toggle: true },
      ),
    );
    await wait(40);
    result.checks.multiDatasetUnmapped = {
      note:
        multiHandle.element.querySelector('[data-block-id="table-other"] .bl-block__filter-note')
          ?.textContent ?? null,
      disabled:
        multiHandle.element
          .querySelector('[data-block-id="table-other"]')
          ?.getAttribute("data-cross-filter") ?? null,
    };
    must(multiSpace.clearCrossFilters());
    must(
      multiSpace.setCrossFilter(
        {
          sourceBlockId: "chart",
          field: { datasetId: "viewer-data", fieldId: "school_id" },
          operator: "equals",
          value: "north",
          mappings: [
            {
              source: { datasetId: "viewer-data", fieldId: "school_id" },
              target: { datasetId: "viewer-other", fieldId: "school_id" },
            },
          ],
        },
        { toggle: true },
      ),
    );
    await wait(40);
    result.checks.multiDatasetMapped = {
      note:
        multiHandle.element.querySelector('[data-block-id="table-other"] .bl-block__filter-note')
          ?.textContent ?? null,
      included:
        multiHandle.element
          .querySelector('[data-block-id="table-other"]')
          ?.getAttribute("data-cross-filter") ?? null,
      otherRows: multiHandle.element.querySelectorAll('[data-block-id="table-other"] tbody tr')
        .length,
    };
    must(multiHandle.unmount());

    const comparisonFields = [
      {
        id: "subject",
        key: "subject",
        label: "Subject",
        type: "string",
        role: "dimension",
        nullable: false,
      },
      {
        id: "score",
        key: "score",
        label: "Score",
        type: "number",
        role: "measure",
        nullable: true,
        unit: { unit: "points" },
      },
    ];
    const comparisonDescriptor = (id, unit = "points") => ({
      id,
      label: id,
      version: "2026.1",
      timezone: "UTC",
      temporalRepresentation: "iso8601-offset",
      fields: comparisonFields.map((field) =>
        field.role === "measure" ? { ...field, unit: { unit } } : { ...field },
      ),
      slices: [
        {
          id: `slice-${id}`,
          datasetId: id,
          fieldIds: ["subject", "score"],
          supportedOperations: ["filter", "group", "aggregate"],
        },
      ],
      capabilities: {
        grouping: true,
        aggregations: ["average", "sum", "count"],
        filterOperators: ["equals"],
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
    const comparisonCurrentRows = [
      { subject: "math", score: 5 },
      { subject: "negative", score: 10 },
      { subject: "zero-ref", score: 10 },
      { subject: "both-zero", score: 0 },
      { subject: "null-primary", score: null },
      { subject: "primary-only", score: 7 },
    ];
    const comparisonReferenceRows = [
      { subject: "math", score: 2 },
      { subject: "negative", score: -5 },
      { subject: "zero-ref", score: 0 },
      { subject: "both-zero", score: 0 },
      { subject: "null-primary", score: 5 },
      { subject: "reference-only", score: 6 },
    ];
    const comparisonDocument = {
      schemaVersion: 1,
      id: "comparison-e2e-board",
      title: "Comparison E2E",
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
      theme: { mode: "light" },
      datasets: [
        {
          id: "cmp-current",
          provider: "comparison-e2e",
          label: "Current",
          fields: [
            { id: "subject", type: "string", role: "dimension" },
            { id: "score", type: "number", role: "measure", unit: "points" },
          ],
        },
        {
          id: "cmp-previous",
          provider: "comparison-e2e",
          label: "Previous",
          fields: [
            { id: "subject", type: "string", role: "dimension" },
            { id: "score", type: "number", role: "measure", unit: "points" },
          ],
        },
        {
          id: "cmp-percent",
          provider: "comparison-e2e",
          label: "Percent",
          fields: [
            { id: "subject", type: "string", role: "dimension" },
            { id: "score", type: "number", role: "measure", unit: "percent" },
          ],
        },
      ],
      slices: [
        {
          id: "slice-cmp-current",
          datasetId: "cmp-current",
          fieldIds: ["subject", "score"],
        },
        {
          id: "slice-cmp-previous",
          datasetId: "cmp-previous",
          fieldIds: ["subject", "score"],
        },
        {
          id: "slice-cmp-percent",
          datasetId: "cmp-percent",
          fieldIds: ["subject", "score"],
        },
      ],
      blocks: [
        {
          id: "comparison-table",
          type: "table",
          title: "Comparison by subject",
          bindings: [
            {
              id: "comparison-subject",
              role: "dimension",
              field: { datasetId: "cmp-current", fieldId: "subject" },
              sliceId: "slice-cmp-current",
            },
            {
              id: "comparison-score",
              role: "measure",
              field: { datasetId: "cmp-current", fieldId: "score" },
              sliceId: "slice-cmp-current",
              aggregation: { type: "average" },
            },
          ],
          config: { comparisonId: "comparison-e2e" },
        },
      ],
      filters: [],
      comparisons: [
        {
          id: "comparison-e2e",
          label: "Previous term",
          displayMode: "overlay",
          deltaMode: "both",
          base: { datasetId: "cmp-current", sliceId: "slice-cmp-current" },
          reference: { datasetId: "cmp-previous", sliceId: "slice-cmp-previous" },
          mapping: [
            {
              primary: { datasetId: "cmp-current", fieldId: "subject" },
              reference: { datasetId: "cmp-previous", fieldId: "subject" },
              role: "dimension",
            },
            {
              primary: { datasetId: "cmp-current", fieldId: "score" },
              reference: { datasetId: "cmp-previous", fieldId: "score" },
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
          placements: [{ blockId: "comparison-table", x: 0, y: 0, width: 12, height: 8 }],
        },
      },
      extensions: {},
    };
    const comparisonDatasets = [
      comparisonDescriptor("cmp-current"),
      comparisonDescriptor("cmp-previous"),
      comparisonDescriptor("cmp-percent", "percent"),
    ];
    const comparisonProvider = must(
      createLocalDatasetProvider({
        providerId: "comparison-e2e",
        datasets: [
          { descriptor: comparisonDatasets[0], rows: comparisonCurrentRows },
          { descriptor: comparisonDatasets[1], rows: comparisonReferenceRows },
          { descriptor: comparisonDatasets[2], rows: comparisonReferenceRows },
        ],
      }),
    );
    const comparisonRuntime = createRuntime({
      datasetProvider: comparisonProvider,
      validationCatalog: createBoardValidationCatalog(comparisonDatasets),
    });
    const comparisonSpace = must(
      comparisonRuntime.createSpace({ document: comparisonDocument, locale: "en" }),
    );
    const comparisonTarget = document.getElementById("comparison");
    const comparisonHandle = must(
      mountBoardView(comparisonTarget, {
        space: comparisonSpace,
        theme: "light",
        realtime: { status: "historical" },
      }),
    );
    await wait(40);
    const comparisonElement = comparisonHandle.element;
    const comparisonZero = comparisonElement.querySelector(
      'td[data-delta="percentage"][data-reason="ZERO_REFERENCE"]',
    );
    const comparisonMissing = comparisonElement.querySelector(
      '[data-comparison-status="primary-only"]',
    );
    const comparisonSummary = comparisonElement.querySelector(".bl-comparison-summary");
    const comparisonLease = must(
      comparisonSpace.acquireEditorLease({ sessionId: "comparison-e2e" }),
    );
    must(comparisonHandle.setMode("editor", { lease: comparisonLease }));
    await wait(20);
    const comparisonDisplay = comparisonElement.querySelector(
      '[data-comparison-control="displayMode"]',
    );
    if (comparisonDisplay) {
      comparisonDisplay.value = "side-by-side";
      comparisonDisplay.dispatchEvent(new Event("change", { bubbles: true }));
      await wait(40);
    }
    const comparisonReference = comparisonElement.querySelector(
      '[data-comparison-control="reference"]',
    );
    if (comparisonReference) {
      comparisonReference.value = "cmp-percent|slice-cmp-percent";
      comparisonReference.dispatchEvent(new Event("change", { bubbles: true }));
      await wait(40);
    }
    const comparisonDraft = comparisonSpace.getSnapshot().draft?.document;
    result.checks.comparison = {
      rows: comparisonElement.querySelectorAll(".bl-comparison-table tbody tr").length,
      zeroReason: comparisonZero?.getAttribute("data-reason") ?? null,
      zeroText: comparisonZero?.textContent ?? null,
      primaryOnly: comparisonMissing?.getAttribute("data-comparison-status") ?? null,
      summary: comparisonSummary?.textContent ?? null,
      sideBySide: comparisonElement.querySelectorAll('[data-comparison-mode="side-by-side"]')
        .length,
      rejectionCodes: Array.from(comparisonElement.querySelectorAll(".bl-diagnostic__code")).map(
        (element) => element.textContent,
      ),
      draftReference: comparisonDraft?.comparisons?.[0]?.reference?.datasetId ?? null,
      percentageCells: comparisonElement.querySelectorAll(
        '.bl-comparison-table td[data-delta="percentage"]',
      ).length,
    };
    must(comparisonSpace.cancelDraft(comparisonLease));
    must(comparisonHandle.unmount({ draftDecision: "cancel" }));
    comparisonRuntime.dispose();

    const changedDocument = JSON.parse(JSON.stringify(fixture.document));
    const changedFilter = changedDocument.filters.find((filter) => filter.id === "filter-school");
    if (changedFilter) {
      changedFilter.label = "Campus";
      changedFilter.defaultValue = ["east"];
    }
    must(thirdSpace.loadDocument(changedDocument));
    await wait(20);
    result.checks.filterDocumentUpdate = {
      chipText:
        thirdHandle.element.querySelector('[data-block-id="filter-block"] .bl-filter-item')
          ?.textContent ?? "",
      scopeText: thirdHandle.element.querySelector(".bl-state__scope")?.textContent ?? "",
    };

    const sibling = must(space.createView({ mode: "viewer" }));
    must(handle.unmount({ draftDecision: "cancel" }));
    result.checks.unmounted = target.children.length === 0;
    result.checks.spaceAlive = space.disposed === false;
    result.checks.siblingAlive = sibling.disposed === false;
    result.checks.viewCountAfterUnmount = space.viewCount;
    result.checks.queriesAfterUnmount = space.getQueryStates().length;
    result.checks.secondStillMounted = secondTarget.children.length === 1;

    const remounted = must(
      mountBoardView(target, {
        space,
        theme: "light",
        realtime: { status: "live" },
      }),
    );
    await wait(30);
    result.checks.remountedBlocks = remounted.element.querySelectorAll(".bl-block").length;
    must(remounted.unmount());
    must(secondHandle.unmount());
    must(thirdHandle.unmount());

    runtime.dispose();
    secondRuntime.dispose();
    thirdRuntime.dispose();
    multiRuntime.dispose();
    result.checks.complete = true;
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
  }
  const output = document.getElementById("result");
  if (output) {
    output.textContent = JSON.stringify(result);
  }
  document.body.setAttribute("data-ready", "true");
}

function expectMode(actual, expected) {
  if (actual !== expected) {
    result.errors.push(`mode expected ${expected} but received ${actual}`);
  }
}

void run();
