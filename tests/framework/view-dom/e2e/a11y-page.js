import {
  createBoardValidationCatalog,
  createLocalDatasetProvider,
  createRuntime,
} from "@boardloom/core";
import { mountBoardView } from "/build/view-dom/dist/index.js";
import { CHART_RENDERERS } from "./renderers.js";

const result = { checks: {}, errors: [] };

function must(value, label) {
  if (!value || value.ok !== true) {
    const diagnostics = value && value.diagnostics ? value.diagnostics : [];
    throw new Error(
      `${label}: ${diagnostics.map((item) => `${item.code} ${item.path}`).join(", ") || "operation failed"}`,
    );
  }
  return value.value;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function parseColor(value) {
  const text = String(value).trim();
  const hex = text.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (hex !== null) {
    const digits =
      hex[1].length === 3
        ? hex[1]
            .split("")
            .map((digit) => digit + digit)
            .join("")
        : hex[1];
    return {
      r: Number.parseInt(digits.slice(0, 2), 16),
      g: Number.parseInt(digits.slice(2, 4), 16),
      b: Number.parseInt(digits.slice(4, 6), 16),
      a: 1,
    };
  }
  const match = text.match(/rgba?\(([^)]+)\)/);
  if (!match) {
    return null;
  }
  const parts = match[1].split(",").map((part) => Number.parseFloat(part.trim()));
  if (parts.length < 3 || parts.some((part) => !Number.isFinite(part))) {
    return null;
  }
  return {
    r: parts[0],
    g: parts[1],
    b: parts[2],
    a: parts.length >= 4 ? parts[3] : 1,
  };
}

function luminance(color) {
  const channels = [color.r, color.g, color.b].map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(first, second) {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function effectiveBackground(element) {
  let current = element;
  while (current !== null) {
    const color = parseColor(getComputedStyle(current).backgroundColor);
    if (color !== null && color.a > 0) {
      return color;
    }
    current = current.parentElement;
  }
  return { r: 255, g: 255, b: 255, a: 1 };
}

function colorPair(selector, context, theme) {
  const element = context.querySelector(selector);
  if (element === null) {
    return { selector, theme, missing: true };
  }
  const style = getComputedStyle(element);
  const foreground = parseColor(style.color);
  const background = effectiveBackground(element);
  if (foreground === null) {
    return { selector, theme, missing: true };
  }
  return {
    selector,
    theme,
    foreground: style.color,
    background: `rgb(${background.r}, ${background.g}, ${background.b})`,
    ratio: Number(contrast(foreground, background).toFixed(2)),
  };
}

async function settle(context) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (context.querySelector('.bl-state--loading, [data-state="loading"]') === null) {
      return;
    }
    await wait(20);
  }
}

function normalizeViolations(violations) {
  return violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.length,
    targets: violation.nodes.slice(0, 4).map((node) => node.target),
    details: violation.nodes.slice(0, 2).map((node) => ({
      html: node.html,
      summary: node.failureSummary,
      data: node.any?.map((check) => check.message).slice(0, 2) ?? [],
    })),
  }));
}

function criticalSerious(violations) {
  return violations.filter(
    (violation) => violation.impact === "critical" || violation.impact === "serious",
  );
}

function flushStyles(context) {
  const root = context.querySelector(".boardloom") ?? context;
  root.getBoundingClientRect();
  root.setAttribute("data-audit-flush", "1");
  void getComputedStyle(root).color;
  root.removeAttribute("data-audit-flush");
  const sample = context.querySelector(".bl-title, .bl-block__title, button");
  if (sample !== null) {
    void getComputedStyle(sample).color;
    void getComputedStyle(root).backgroundColor;
  }
}

function targetElement(context, node) {
  for (const selector of node.target) {
    try {
      const element = context.querySelector(selector);
      if (element !== null) {
        return element;
      }
    } catch {
      void 0;
    }
  }
  return null;
}

function isDecorativeTarget(context, node) {
  const element = targetElement(context, node);
  return element !== null && element.closest('[aria-hidden="true"]') !== null;
}

function isExplicitlyListedContrastTarget(context, node) {
  const element = targetElement(context, node);
  if (element === null) {
    return false;
  }
  return (
    element.matches(".bl-inspector__title") || element.closest(".bl-inspector__title") !== null
  );
}

function normalizeIncomplete(incomplete, context) {
  return incomplete.map((entry) => {
    const decorative = entry.nodes.every((node) => isDecorativeTarget(context, node));
    const explicitlyListed = entry.nodes.every((node) =>
      isExplicitlyListedContrastTarget(context, node),
    );
    return {
      id: entry.id,
      impact: entry.impact,
      nodes: entry.nodes.length,
      targets: entry.nodes.slice(0, 4).map((node) => node.target),
      decorative,
      explicitlyListed,
      reviewed: entry.id === "color-contrast" && (decorative || explicitlyListed),
      details: entry.nodes.slice(0, 2).map((node) => ({
        html: node.html,
        summary: node.failureSummary,
      })),
    };
  });
}

async function audit(context, name) {
  flushStyles(context);
  await wait(20);
  const axeResult = await window.axe.run(context);
  const violations = normalizeViolations(axeResult.violations);
  const blocking = criticalSerious(axeResult.violations);
  if (blocking.length > 0) {
    result.errors.push(
      `${name}: ${blocking.map((violation) => `${violation.id}(${violation.impact})`).join(", ")}`,
    );
  }
  const incomplete = normalizeIncomplete(axeResult.incomplete, context);
  const seriousIncomplete = incomplete.filter(
    (entry) =>
      (entry.impact === "critical" || entry.impact === "serious") && entry.reviewed !== true,
  );
  if (seriousIncomplete.length > 0) {
    result.errors.push(
      `${name} incomplete: ${seriousIncomplete
        .map(
          (entry) =>
            `${entry.id}(${entry.impact}) ${entry.targets
              .map((target) => target.join(" "))
              .join("; ")}`,
        )
        .join(" | ")}`,
    );
  }
  return {
    name,
    violations,
    criticalSerious: violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious",
    ).length,
    incomplete,
    seriousIncomplete: seriousIncomplete.length,
  };
}

function reflowReport(context, name) {
  const root = context.querySelector(".boardloom");
  if (root === null) {
    return { name, missing: true };
  }
  const overflow = [];
  for (const element of root.querySelectorAll(
    ".bl-block, .bl-canvas, .bl-editor-layout, .bl-header, .bl-statusbar, .bl-filters, .bl-chart-plot-container, .bl-table-region",
  )) {
    const rect = element.getBoundingClientRect();
    if (rect.width > 0 && (rect.left < -1 || rect.right > window.innerWidth + 1)) {
      overflow.push({
        className: element.className,
        left: Math.round(rect.left),
        right: Math.round(rect.right),
      });
    }
  }
  const grid = root.querySelector(".bl-board-grid");
  const columns =
    grid === null ? null : getComputedStyle(grid).getPropertyValue("--bl-grid-columns").trim();
  return {
    name,
    viewport: window.innerWidth,
    gridColumns: columns,
    blockCount: root.querySelectorAll(".bl-block").length,
    documentScrollWidth: document.documentElement.scrollWidth,
    documentClientWidth: document.documentElement.clientWidth,
    rootScrollWidth: root.scrollWidth,
    rootClientWidth: root.clientWidth,
    breakpoint: root.getAttribute("data-boardloom-breakpoint"),
    overflow,
    noPageOverflow:
      document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    noRootOverflow: root.scrollWidth <= root.clientWidth + 1,
    noBlockOverflow: overflow.length === 0,
  };
}

function targetSizeReport(context) {
  const violations = [];
  for (const element of context.querySelectorAll("button, input, select, summary, a[href]")) {
    if (element.closest("[hidden], [inert], .bl-skip-link, .bl-visually-hidden") !== null) {
      continue;
    }
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      continue;
    }
    if (rect.width < 24 || rect.height < 24) {
      violations.push({
        className: element.className,
        tag: element.tagName,
        type: element.getAttribute("type"),
        id: element.id,
        label: element.getAttribute("aria-label"),
        text: (element.textContent ?? "").trim().slice(0, 40),
        width: Number(rect.width.toFixed(1)),
        height: Number(rect.height.toFixed(1)),
      });
    }
  }
  return violations;
}

function chartAlternativeReport(context) {
  const details = [...context.querySelectorAll(".bl-chart-data")];
  return details.map((element) => {
    const summary = element.querySelector(".bl-chart-data__summary");
    const region = element.querySelector(".bl-table-region");
    const caption = element.querySelector("caption");
    const plot = element.closest(".bl-chart-surface")?.querySelector('[role="img"]');
    return {
      hasSummary: summary !== null && (summary.textContent ?? "").trim() !== "",
      detailsOpen: element.hasAttribute("open"),
      regionRole: region?.getAttribute("role") ?? null,
      regionTabIndex: region?.getAttribute("tabindex") ?? null,
      caption: (caption?.textContent ?? "").trim(),
      columnHeaders: element.querySelectorAll('th[scope="col"]').length,
      rowHeaders: element.querySelectorAll('th[scope="row"]').length,
      plotLabel: plot?.getAttribute("aria-label") ?? null,
    };
  });
}

function focusRingReport(context, theme) {
  const button = context.querySelector(".bl-mode");
  if (button === null) {
    return { theme, missing: true };
  }
  button.focus();
  const style = getComputedStyle(button);
  const root = context.querySelector(".boardloom");
  const focusToken =
    root === null ? "" : getComputedStyle(root).getPropertyValue("--bl-color-focus").trim();
  const focusVisible = button.matches(":focus-visible");
  const outline = parseColor(focusVisible ? style.outlineColor : focusToken);
  const background = effectiveBackground(button.parentElement ?? button);
  return {
    theme,
    focusVisible,
    outlineColor: focusVisible ? style.outlineColor : focusToken,
    outlineWidth: style.outlineWidth,
    focusToken,
    ratio: outline === null ? null : Number(contrast(outline, background).toFixed(2)),
  };
}

function durationMilliseconds(value) {
  const numeric = Number.parseFloat(String(value));
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return String(value).includes("ms") ? numeric : numeric * 1000;
}

function motionReport(context) {
  const root = context.querySelector(".boardloom");
  const style = root === null ? null : getComputedStyle(root);
  const animated = [];
  if (root !== null) {
    for (const element of root.querySelectorAll("*")) {
      const computed = getComputedStyle(element);
      const duration = computed.animationDuration;
      const transition = computed.transitionDuration;
      if (durationMilliseconds(duration) > 0.011) {
        animated.push({ className: element.className, duration });
      }
      if (durationMilliseconds(transition) > 0.011) {
        animated.push({ className: element.className, transition });
      }
    }
  }
  let scopedTransition = null;
  let scopedAnimation = null;
  if (root !== null) {
    const probe = document.createElement("div");
    probe.style.transition = "opacity 2s linear";
    probe.style.animation = "bl-audit-probe 2s linear";
    probe.setAttribute("aria-hidden", "true");
    root.append(probe);
    const probeStyle = getComputedStyle(probe);
    scopedTransition = probeStyle.transitionDuration;
    scopedAnimation = probeStyle.animationName;
    probe.remove();
  }
  return {
    prefersReducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    scopedTransition,
    scopedAnimation,
    durations: {
      instant: style?.getPropertyValue("--bl-motion-duration-instant").trim() ?? null,
      fast: style?.getPropertyValue("--bl-motion-duration-fast").trim() ?? null,
      base: style?.getPropertyValue("--bl-motion-duration-base").trim() ?? null,
      slow: style?.getPropertyValue("--bl-motion-duration-slow").trim() ?? null,
      slower: style?.getPropertyValue("--bl-motion-duration-slower").trim() ?? null,
    },
    animated: animated.slice(0, 10),
  };
}

function dispatchKey(element, key, options = {}) {
  element.dispatchEvent(
    new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      shiftKey: options.shiftKey === true,
      ctrlKey: options.ctrlKey === true,
      metaKey: options.metaKey === true,
    }),
  );
}

function firstBlockPlacement(context, blockId) {
  const block = context.querySelector(`[data-block-id="${blockId}"]`);
  if (block === null) {
    return null;
  }
  return {
    x: block.style.getPropertyValue("--bl-placement-x"),
    y: block.style.getPropertyValue("--bl-placement-y"),
    width: block.style.getPropertyValue("--bl-placement-width"),
    height: block.style.getPropertyValue("--bl-placement-height"),
  };
}

const datasetId = "a11y-data";
const sliceId = "all-results";
const descriptor = {
  id: datasetId,
  label: "Synthetic accessibility data",
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
      allowedValues: ["north", "south", "east"],
    },
    {
      id: "subject",
      key: "subject",
      label: "Subject",
      type: "string",
      role: "dimension",
      nullable: false,
      allowedValues: ["math", "reading", "science"],
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
      label: "Submitted at",
      type: "datetime",
      role: "temporal",
      nullable: false,
      timezone: "UTC",
      temporalRepresentation: "iso8601-offset",
    },
  ],
  slices: [
    {
      id: sliceId,
      datasetId,
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
  { school_id: "north", subject: "math", submitted_at: "2026-09-30T23:30:00Z", score: 10 },
  { school_id: "north", subject: "math", submitted_at: "2026-10-01T00:30:00Z", score: 0 },
  { school_id: "south", subject: "reading", submitted_at: "2026-10-01T12:00:00Z", score: 7.5 },
  { school_id: "south", subject: "reading", submitted_at: "2026-10-02T01:00:00Z", score: null },
  { school_id: "east", subject: "science", submitted_at: "2026-10-02T15:00:00Z", score: 5 },
];

const boardDocument = {
  schemaVersion: 1,
  id: "a11y-audit-board",
  title: "Accessibility audit board",
  description: "Synthetic accessibility fixture.",
  createdAt: 1700000000000,
  updatedAt: 1700000060000,
  theme: { mode: "light", tokens: {} },
  datasets: [
    {
      id: datasetId,
      provider: "a11y-fixture",
      label: "Accessibility data",
      fields: [
        { id: "school_id", type: "string", role: "dimension" },
        { id: "subject", type: "string", role: "dimension" },
        { id: "score", type: "number", role: "measure", unit: "points" },
      ],
    },
  ],
  slices: [
    {
      id: sliceId,
      datasetId,
      label: "All results",
      fieldIds: ["school_id", "subject", "score"],
    },
  ],
  filterGroups: [],
  blocks: [
    {
      id: "note",
      type: "text",
      title: "Audit note",
      bindings: [],
      config: { text: "Synthetic accessibility data." },
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
          field: { datasetId, fieldId: "score" },
          sliceId,
          aggregation: { type: "average" },
        },
      ],
      config: { format: { precision: 1 } },
    },
    {
      id: "table",
      type: "table",
      title: "Scores table",
      bindings: [
        {
          id: "table-school",
          role: "dimension",
          field: { datasetId, fieldId: "school_id" },
          sliceId,
        },
        {
          id: "table-score",
          role: "measure",
          field: { datasetId, fieldId: "score" },
          sliceId,
          aggregation: { type: "average" },
        },
      ],
      config: { columns: ["table-school", "table-score"] },
    },
    {
      id: "chart",
      type: "chart",
      title: "Scores chart",
      bindings: [
        {
          id: "chart-school",
          role: "dimension",
          axis: "x",
          field: { datasetId, fieldId: "school_id" },
          sliceId,
        },
        {
          id: "chart-score",
          role: "measure",
          axis: "y",
          field: { datasetId, fieldId: "score" },
          sliceId,
          aggregation: { type: "average" },
        },
      ],
      config: { visualization: "bar" },
    },
    {
      id: "filters",
      type: "filter",
      title: "Board filters",
      bindings: [],
      config: { filterIds: ["filter-school"] },
    },
  ],
  filters: [
    {
      id: "filter-school",
      label: "School",
      field: { datasetId, fieldId: "school_id" },
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
        { blockId: "filters", x: 8, y: 4, width: 4, height: 2 },
      ],
    },
    tablet: {
      columns: 8,
      placements: [
        { blockId: "note", x: 0, y: 0, width: 4, height: 2 },
        { blockId: "metric", x: 4, y: 0, width: 4, height: 2 },
        { blockId: "chart", x: 0, y: 2, width: 8, height: 4 },
        { blockId: "table", x: 0, y: 6, width: 8, height: 4 },
        { blockId: "filters", x: 0, y: 10, width: 8, height: 2 },
      ],
    },
    narrow: {
      columns: 4,
      placements: [
        { blockId: "note", x: 0, y: 0, width: 4, height: 2 },
        { blockId: "metric", x: 0, y: 2, width: 4, height: 2 },
        { blockId: "chart", x: 0, y: 4, width: 4, height: 4 },
        { blockId: "table", x: 0, y: 8, width: 4, height: 4 },
        { blockId: "filters", x: 0, y: 12, width: 4, height: 2 },
      ],
    },
  },
  extensions: {},
};

async function runVisual(scenario) {
  const theme = scenario.includes("dark") ? "dark" : "light";
  const mode = scenario.includes("editor") ? "editor" : "viewer";
  const target = document.getElementById("audit-root");
  const provider = must(
    createLocalDatasetProvider({
      providerId: "a11y-visual-fixture",
      datasets: [{ descriptor, rows }],
    }),
    "visual provider",
  );
  const mounted = mountBoardView(target, {
    document: boardDocument,
    datasetProvider: provider,
    theme,
    renderers: CHART_RENDERERS,
    provenance: "Synthetic accessibility fixture",
  });
  const handle = must(mounted, "visual mount");
  await settle(target);
  await wait(250);
  if (mode === "editor") {
    const lease = must(
      handle.space.acquireEditorLease({ sessionId: "a11y-visual" }),
      "visual lease",
    );
    must(handle.setMode("editor", { lease }), "visual editor mode");
    await wait(150);
    if (!scenario.includes("narrow")) {
      const note = target.querySelector('[data-block-id="note"]');
      note?.focus();
      if (note !== null) {
        dispatchKey(note, "Enter");
      }
      await wait(150);
    }
  }
  document.body.setAttribute("data-visual", scenario);
  document.title = `Boardloom ${scenario}`;
}

async function auditDarkEditor(handle, target) {
  const lease = must(
    handle.space.acquireEditorLease({ sessionId: "a11y-dark-editor" }),
    "dark editor lease",
  );
  must(handle.setMode("editor", { lease }), "dark editor mode");
  await wait(160);
  const note = target.querySelector('[data-block-id="note"]');
  note?.focus();
  if (note !== null) {
    dispatchKey(note, "Enter");
  }
  await wait(80);
  return {
    audit: await audit(target, "editor-dark"),
    contrast: [
      colorPair(".bl-inspector__title", target, "dark"),
      colorPair(".bl-keyboard-pad__button", target, "dark"),
      colorPair(".bl-block__title", target, "dark"),
    ],
  };
}

async function runDarkOnly() {
  const target = document.getElementById("audit-root");
  const provider = must(
    createLocalDatasetProvider({
      providerId: "a11y-dark-fixture",
      datasets: [{ descriptor, rows }],
    }),
    "dark provider",
  );
  const mounted = mountBoardView(target, {
    document: boardDocument,
    datasetProvider: provider,
    theme: "dark",
    renderers: CHART_RENDERERS,
    provenance: "Synthetic audit fixture",
  });
  const handle = must(mounted, "dark mount");
  await settle(target);
  await wait(200);
  result.checks.viewerDark = await audit(target, "viewer-dark");
  result.checks.contrastDark = [
    colorPair(".bl-title", target, "dark"),
    colorPair(".bl-host", target, "dark"),
    colorPair(".bl-block__title", target, "dark"),
    colorPair(".bl-table td", target, "dark"),
    colorPair('.bl-mode[data-active="true"]', target, "dark"),
  ];
  result.checks.focusDark = focusRingReport(target, "dark");
  result.checks.motion = motionReport(target);
  const editorDark = await auditDarkEditor(handle, target);
  result.checks.editorDark = editorDark.audit;
  result.checks.editorContrastDark = editorDark.contrast;
  must(handle.unmount({ draftDecision: "cancel" }), "dark unmount");
}

async function run() {
  const params = new URLSearchParams(window.location.search);
  const visual = params.get("visual");
  if (visual !== null && visual !== "") {
    await runVisual(visual);
    document.body.setAttribute("data-ready", "true");
    return;
  }
  if (params.get("theme") === "dark") {
    await runDarkOnly();
    document.body.setAttribute("data-ready", "true");
    return;
  }
  const provider = createLocalDatasetProvider({
    providerId: "a11y-fixture",
    datasets: [{ descriptor, rows }],
  });
  const runtime = createRuntime({
    datasetProvider: must(provider, "provider"),
    validationCatalog: createBoardValidationCatalog([descriptor]),
  });
  const target = document.getElementById("audit-root");
  const mounted = mountBoardView(target, {
    runtime,
    document: boardDocument,
    theme: "light",
    renderers: CHART_RENDERERS,
    provenance: "Synthetic audit fixture",
  });
  const handle = must(mounted, "mount");
  await settle(target);
  await wait(120);

  result.checks.viewerLight = await audit(target, "viewer-light");
  result.checks.contrastLight = [
    colorPair(".bl-title", target, "light"),
    colorPair(".bl-host", target, "light"),
    colorPair(".bl-block__title", target, "light"),
    colorPair(".bl-table td", target, "light"),
    colorPair('.bl-mode[data-active="true"]', target, "light"),
  ];
  result.checks.focusLight = focusRingReport(target, "light");
  result.checks.chartAlternatives = chartAlternativeReport(target);
  result.checks.liveRegions = {
    live: {
      role: target.querySelector(".bl-live")?.getAttribute("role") ?? null,
      ariaLive: target.querySelector(".bl-live")?.getAttribute("aria-live") ?? null,
      ariaAtomic: target.querySelector(".bl-live")?.getAttribute("aria-atomic") ?? null,
      presentAtMount: target.querySelector(".bl-live") !== null,
    },
    status: {
      role: target.querySelector(".bl-status")?.getAttribute("role") ?? null,
      ariaLive: target.querySelector(".bl-status")?.getAttribute("aria-live") ?? null,
    },
  };
  result.checks.targetSizes = targetSizeReport(target);
  result.checks.reflow = reflowReport(target, "viewer-light");
  result.checks.motion = motionReport(target);

  if (result.checks.motion.prefersReducedMotion) {
    const lease = must(
      handle.space.acquireEditorLease({ sessionId: "a11y-reduced-editor" }),
      "reduced editor lease",
    );
    must(handle.setMode("editor", { lease }), "reduced editor mode");
    await wait(160);
    const note = target.querySelector('[data-block-id="note"]');
    note?.focus();
    if (note !== null) {
      dispatchKey(note, "Enter");
    }
    await wait(80);
    result.checks.editorReduced = await audit(target, "editor-light-reduced");
    result.checks.editorContrastReduced = [
      colorPair(".bl-inspector__title", target, "light"),
      colorPair(".bl-keyboard-pad__button", target, "light"),
      colorPair(".bl-block__title", target, "light"),
    ];
    must(handle.unmount({ draftDecision: "cancel" }), "reduced-motion unmount");
    runtime.dispose();
    return;
  }

  const firstBackground = getComputedStyle(target.querySelector(".boardloom")).backgroundColor;
  target.setAttribute("hidden", "");
  await wait(40);
  const secondTarget = document.getElementById("audit-second");
  const secondMounted = mountBoardView(secondTarget, {
    document: boardDocument,
    datasetProvider: must(provider, "second provider"),
    theme: "dark",
    renderers: CHART_RENDERERS,
    provenance: "Synthetic audit fixture",
  });
  const secondHandle = must(secondMounted, "second mount");
  await settle(secondTarget);
  await wait(120);
  result.checks.viewerDark = await audit(secondTarget, "viewer-dark");
  result.checks.contrastDark = [
    colorPair(".bl-title", secondTarget, "dark"),
    colorPair(".bl-host", secondTarget, "dark"),
    colorPair(".bl-block__title", secondTarget, "dark"),
    colorPair(".bl-table td", secondTarget, "dark"),
    colorPair('.bl-mode[data-active="true"]', secondTarget, "dark"),
  ];
  result.checks.focusDark = focusRingReport(secondTarget, "dark");
  target.removeAttribute("hidden");
  await settle(target);
  await wait(120);
  result.checks.multiInstance = {
    firstBackground,
    secondBackground: getComputedStyle(secondTarget.querySelector(".boardloom")).backgroundColor,
    firstTheme: target.querySelector(".boardloom")?.getAttribute("data-boardloom-theme"),
    secondTheme: secondTarget.querySelector(".boardloom")?.getAttribute("data-boardloom-theme"),
    hostBackground: getComputedStyle(document.body).backgroundColor,
    firstInstanceId: target.querySelector(".boardloom")?.getAttribute("data-boardloom-instance"),
    secondInstanceId: secondTarget
      .querySelector(".boardloom")
      ?.getAttribute("data-boardloom-instance"),
  };
  const editorDark = await auditDarkEditor(secondHandle, secondTarget);
  result.checks.editorDark = editorDark.audit;
  result.checks.editorContrastDark = editorDark.contrast;
  must(secondHandle.unmount({ draftDecision: "cancel" }), "second unmount");

  const lease = must(handle.space.acquireEditorLease({ sessionId: "a11y-editor" }), "lease");
  must(handle.setMode("editor", { lease }), "editor mode");
  await wait(160);
  result.checks.editor = await audit(target, "editor");
  result.checks.editorReflow = reflowReport(target, "editor");
  result.checks.editorTargetSizes = targetSizeReport(target);

  const block = target.querySelector('[data-block-id="note"]');
  block.focus();
  dispatchKey(block, "Enter");
  await wait(60);
  result.checks.editorContrast = [
    colorPair(".bl-inspector__title", target, "light"),
    colorPair(".bl-keyboard-pad__button", target, "light"),
    colorPair(".bl-block__title", target, "light"),
  ];
  const beforeMove = firstBlockPlacement(target, "note");
  dispatchKey(block, "ArrowRight");
  await wait(40);
  const afterMove = firstBlockPlacement(target, "note");
  dispatchKey(block, "ArrowDown", { shiftKey: true });
  await wait(40);
  const afterResize = firstBlockPlacement(target, "note");
  result.checks.keyboardLayout = {
    selected: block.getAttribute("data-editor-selected"),
    current: block.getAttribute("aria-current"),
    beforeMove,
    afterMove,
    afterResize,
  };
  dispatchKey(block, "Escape");
  await wait(40);
  result.checks.keyboardEscape = {
    selected: block.getAttribute("data-editor-selected"),
    current: block.getAttribute("aria-current"),
  };

  const narrow =
    target.querySelector(".boardloom")?.getAttribute("data-boardloom-breakpoint") === "narrow";
  if (narrow) {
    const libraryToggle = target.querySelector('[data-editor-drawer="library"]');
    libraryToggle.click();
    await wait(160);
    const library = target.querySelector(".bl-library");
    result.checks.libraryDrawer = {
      audit: await audit(target, "editor-library-drawer"),
      role: library?.getAttribute("role"),
      ariaModal: library?.getAttribute("aria-modal"),
      focusInside: library !== null && library.contains(document.activeElement),
      backgroundInert: target.querySelector(".bl-canvas")?.hasAttribute("inert") ?? false,
    };
    dispatchKey(document.activeElement ?? libraryToggle, "Escape");
    await wait(80);
    result.checks.libraryDrawerReturn = {
      focusedTrigger: document.activeElement === libraryToggle,
      inertCleared: !(target.querySelector(".bl-canvas")?.hasAttribute("inert") ?? false),
    };

    const inspectorToggle = target.querySelector('[data-editor-drawer="inspector"]');
    inspectorToggle.click();
    await wait(160);
    const inspector = target.querySelector(".bl-inspector");
    const focusable = [
      ...inspector.querySelectorAll(
        "button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])",
      ),
    ].filter((element) => element.getClientRects().length > 0);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    last?.focus();
    dispatchKey(last, "Tab");
    const wrappedForward = document.activeElement === first;
    first?.focus();
    dispatchKey(first, "Tab", { shiftKey: true });
    const wrappedBackward = document.activeElement === last;
    result.checks.inspectorDrawer = {
      audit: await audit(target, "editor-inspector-drawer"),
      role: inspector?.getAttribute("role"),
      ariaModal: inspector?.getAttribute("aria-modal"),
      focusInside: inspector !== null && inspector.contains(document.activeElement),
      backgroundInert: target.querySelector(".bl-draft-bar")?.hasAttribute("inert") ?? false,
      wrappedForward,
      wrappedBackward,
    };
    const sheetDiscard = target.querySelector(
      '.bl-inspector__draft [data-draft-action="discard"]:not([disabled])',
    );
    sheetDiscard?.focus();
    sheetDiscard?.click();
    await wait(160);
    const sheetConfirmation = target.querySelector(".bl-confirm");
    const sheetConfirm = sheetConfirmation?.querySelector('[data-confirm-action="confirm"]');
    sheetConfirm?.click();
    await wait(180);
    const sheetFocus = document.activeElement;
    result.checks.inspectorSheetDiscardFocus = {
      inspectorOpen:
        target.querySelector(".boardloom")?.getAttribute("data-inspector-open") === "true",
      focusedTag: sheetFocus?.tagName ?? null,
      focusedClass: sheetFocus?.className ?? null,
      insideInspector: inspector !== null && inspector.contains(sheetFocus),
      notBody: sheetFocus !== document.body && sheetFocus !== null,
      visible: sheetFocus !== null && sheetFocus.getClientRects().length > 0,
      disabled:
        sheetFocus?.hasAttribute?.("disabled") === true ||
        sheetFocus?.getAttribute?.("aria-disabled") === "true",
      confirmationHidden: sheetConfirmation?.hasAttribute("hidden") ?? null,
    };
    dispatchKey(document.activeElement ?? inspectorToggle, "Escape");
    await wait(80);
    result.checks.inspectorDrawerReturn = {
      focusedTrigger: document.activeElement === inspectorToggle,
    };
  }

  const libraryWasOpen =
    target.querySelector(".boardloom")?.getAttribute("data-library-open") === "true";
  if (!libraryWasOpen) {
    target.querySelector('[data-editor-drawer="library"]')?.click();
    await wait(120);
  }
  const addButtons = [...target.querySelectorAll("[data-editor-add]")];
  const add = addButtons[0];
  const addType = add?.getAttribute("data-editor-add") ?? null;
  add?.focus();
  add?.click();
  await wait(160);
  const libraryAfterAdd = target.querySelector(".bl-library");
  const addFocused = document.activeElement;
  result.checks.addBlockFocus = {
    type: addType,
    libraryOpen: target.querySelector(".boardloom")?.getAttribute("data-library-open") === "true",
    focusedTag: addFocused?.tagName ?? null,
    focusedClass: addFocused?.className ?? null,
    focusedAddType: addFocused?.getAttribute?.("data-editor-add") ?? null,
    insideLibrary: libraryAfterAdd !== null && libraryAfterAdd.contains(addFocused),
    notBody: addFocused !== document.body && addFocused !== null,
  };
  if (target.querySelector(".boardloom")?.getAttribute("data-boardloom-breakpoint") === "narrow") {
    const libraryToggle = target.querySelector('[data-editor-drawer="library"]');
    document.body.setAttribute("tabindex", "-1");
    document.body.focus();
    dispatchKey(document.body, "Escape");
    await wait(160);
    result.checks.addBlockEscapeFromBody = {
      libraryOpenAfter:
        target.querySelector(".boardloom")?.getAttribute("data-library-open") === "true",
      focusReturned: document.activeElement === libraryToggle,
      activeTag: document.activeElement?.tagName ?? null,
      activeClass: document.activeElement?.className ?? null,
    };
  } else if (target.querySelector(".boardloom")?.getAttribute("data-library-open") === "true") {
    target.querySelector('[data-editor-drawer="library"]')?.click();
    await wait(120);
  }

  const discard = target.querySelector(
    '.bl-draft-bar [data-draft-action="discard"]:not([disabled])',
  );
  discard?.focus();
  discard?.click();
  await wait(160);
  const confirmation = target.querySelector(".bl-confirm");
  const confirmationButtons = [...confirmation.querySelectorAll("button:not([disabled])")];
  const cancel = confirmationButtons[0];
  const confirm = confirmationButtons[confirmationButtons.length - 1];
  const confirmationFocusEntered = confirmation.contains(document.activeElement);
  cancel?.focus();
  dispatchKey(cancel, "Tab", { shiftKey: true });
  const confirmationWrappedBackward = document.activeElement === confirm;
  confirm?.focus();
  dispatchKey(confirm, "Tab");
  const confirmationWrappedForward = document.activeElement === cancel;
  result.checks.confirmationDialog = {
    audit: await audit(target, "confirmation-dialog"),
    visible: !confirmation.hasAttribute("hidden"),
    labelledBy: confirmation.getAttribute("aria-labelledby"),
    focusEntered: confirmationFocusEntered,
    wrappedForward: confirmationWrappedForward,
    wrappedBackward: confirmationWrappedBackward,
    backgroundInert:
      (target.querySelector(".bl-header")?.closest("[inert]") ?? null) !== null &&
      (target.querySelector(".bl-canvas")?.closest("[inert]") ?? null) !== null,
  };

  const guardTarget = document.getElementById("audit-second");
  const guardMounted = mountBoardView(guardTarget, {
    document: boardDocument,
    datasetProvider: must(provider, "guard provider"),
    theme: "light",
    renderers: CHART_RENDERERS,
    provenance: "Synthetic audit fixture",
  });
  const guardHandle = must(guardMounted, "guard mount");
  await settle(guardTarget);
  await wait(80);
  const guardButton = guardTarget.querySelector(".bl-mode");
  guardButton?.focus();
  dispatchKey(guardButton ?? guardTarget, "Escape");
  await wait(80);
  result.checks.crossInstanceEscape = {
    confirmationStillOpen: !confirmation.hasAttribute("hidden"),
    focusStayedInGuard: guardTarget.contains(document.activeElement),
  };
  must(guardHandle.unmount(), "guard unmount");

  dispatchKey(cancel ?? confirmation, "Escape");
  await wait(120);
  result.checks.confirmationReturn = {
    focusedTrigger: document.activeElement === discard,
    hidden: confirmation.hasAttribute("hidden"),
  };

  discard?.focus();
  discard?.click();
  await wait(160);
  const confirmButton = target.querySelector('.bl-confirm [data-confirm-action="confirm"]');
  confirmButton?.click();
  await wait(180);
  const discardFocus = document.activeElement;
  result.checks.discardConfirmFocus = {
    mode: target.querySelector(".boardloom")?.getAttribute("data-boardloom-mode") ?? null,
    focusedTag: discardFocus?.tagName ?? null,
    focusedClass: discardFocus?.className ?? null,
    notBody: discardFocus !== document.body && discardFocus !== null,
    visible: discardFocus !== null && discardFocus.getClientRects().length > 0,
    disabled:
      discardFocus?.hasAttribute?.("disabled") === true ||
      discardFocus?.getAttribute?.("aria-disabled") === "true",
    confirmationHidden: confirmation.hasAttribute("hidden"),
  };

  const addAgain = target.querySelector("[data-editor-add]");
  addAgain?.click();
  await wait(140);
  const release = target.querySelector(
    '.bl-draft-bar [data-draft-action="release"]:not([disabled])',
  );
  release?.focus();
  release?.click();
  await wait(140);
  const releaseConfirm = target.querySelector('.bl-confirm [data-confirm-action="confirm"]');
  releaseConfirm?.click();
  await wait(180);
  const releaseFocus = document.activeElement;
  result.checks.releaseConfirmFocus = {
    mode: target.querySelector(".boardloom")?.getAttribute("data-boardloom-mode") ?? null,
    focusedTag: releaseFocus?.tagName ?? null,
    focusedClass: releaseFocus?.className ?? null,
    notBody: releaseFocus !== document.body && releaseFocus !== null,
    visible: releaseFocus !== null && releaseFocus.getClientRects().length > 0,
    disabled:
      releaseFocus?.hasAttribute?.("disabled") === true ||
      releaseFocus?.getAttribute?.("aria-disabled") === "true",
  };

  const chipReset = target.querySelector(".bl-filters [data-filter-reset]");
  const chipResetId = chipReset?.getAttribute("data-filter-reset") ?? null;
  chipReset?.focus();
  chipReset?.click();
  await wait(160);
  const resetFocus = document.activeElement;
  const filterHeading = target.querySelector(".bl-filters .bl-overline");
  const resetAfter = [...target.querySelectorAll(".bl-filters [data-filter-reset]")].find(
    (element) => element.getAttribute("data-filter-reset") === chipResetId,
  );
  result.checks.filterResetFocus = {
    filterId: chipResetId,
    focusedTag: resetFocus?.tagName ?? null,
    focusedClass: resetFocus?.className ?? null,
    notBody: resetFocus !== document.body && resetFocus !== null,
    sameReset: resetFocus === resetAfter,
    filterHeading: resetFocus === filterHeading,
    visible: resetFocus !== null && resetFocus.getClientRects().length > 0,
  };

  const summary = target.querySelector(".bl-chart-data__summary");
  const details = target.querySelector(".bl-chart-data");
  const wasOpen = details?.hasAttribute("open") ?? false;
  summary?.click();
  await wait(40);
  result.checks.chartDisclosure = {
    wasOpen,
    nowOpen: details?.hasAttribute("open") ?? false,
    summaryFocusable: summary?.tabIndex === 0,
  };

  const skip = target.querySelector(".bl-skip-link");
  const skipTargetId = skip?.getAttribute("href")?.replace("#", "") ?? "";
  const skipTarget = skipTargetId === "" ? null : document.getElementById(skipTargetId);
  skip?.focus();
  result.checks.skipLink = {
    firstFocusable: target.querySelector("a, button, input, select, textarea") === skip,
    href: skip?.getAttribute("href") ?? null,
    targetExists: skipTarget !== null,
    targetTabIndex: skipTarget?.getAttribute("tabindex") ?? null,
  };

  must(handle.unmount({ draftDecision: "cancel" }), "unmount");
  runtime.dispose();
}

function finish() {
  const output = document.getElementById("result");
  if (output) {
    output.textContent = JSON.stringify(result);
  }
  document.body.setAttribute("data-ready", "true");
}

run()
  .then(finish)
  .catch((error) => {
    result.errors.push(
      error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error),
    );
    finish();
  });
