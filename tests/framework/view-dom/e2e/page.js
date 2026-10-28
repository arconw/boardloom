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
    must(handle.setMode("viewer"));
    await wait(10);
    result.checks.modeAfterReturn = element.getAttribute("data-boardloom-mode");

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
        thirdHandle.element.querySelector('[data-block-id="filter-block"] .bl-filter-chip')
          ?.textContent ?? "",
      scopeText: thirdHandle.element.querySelector(".bl-state__scope")?.textContent ?? "",
    };

    const sibling = must(space.createView({ mode: "viewer" }));
    must(handle.unmount());
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
