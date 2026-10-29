import {
  ENGLISH_MESSAGES,
  canonicalJson,
  createBoardValidationCatalog,
  createLocalDatasetProvider,
  createRuntime,
  validateBoardDocument,
} from "@boardloom/core";
import { mountBoardWorkspace } from "/build/view-dom/dist/index.js";

const result = { checks: {}, errors: [] };

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

function descriptor() {
  return {
    id: "editor-data",
    label: "Synthetic editor data",
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
        unit: { unit: "points" },
      },
    ],
    slices: [
      {
        id: "all-results",
        datasetId: "editor-data",
        label: "All results",
        fieldIds: ["school_id", "subject", "score"],
        supportedOperations: ["project", "filter", "group", "aggregate", "order", "limit"],
      },
    ],
    capabilities: {
      grouping: true,
      aggregations: ["count", "countDistinct", "sum", "average", "min", "max", "median", "mode"],
      filterOperators: ["equals", "notEquals", "in", "notIn", "isNull", "isNotNull"],
      timeWindow: false,
      timezoneConversion: false,
      local: true,
      pushdownFilters: true,
      serverPaging: false,
      realtime: false,
      comparison: false,
      maxResultSize: null,
    },
  };
}

function fixture() {
  const rows = [
    { school_id: "north", subject: "math", score: 10 },
    { school_id: "north", subject: "reading", score: 6 },
    { school_id: "south", subject: "math", score: 4 },
    { school_id: "south", subject: "reading", score: 8 },
    { school_id: "east", subject: "math", score: 2 },
  ];
  const document = {
    schemaVersion: 1,
    id: "editor-e2e-board",
    title: "Editor E2E",
    description: "Synthetic editor fixture.",
    createdAt: 1700000000000,
    updatedAt: 1700000060000,
    theme: {
      mode: "light",
      tokens: {
        accent: "#111111",
        success: "#00aa00",
        "ext.brand-extra": "#123456",
      },
    },
    datasets: [
      {
        id: "editor-data",
        provider: "editor-e2e",
        fields: [
          { id: "school_id", type: "string", role: "dimension" },
          { id: "subject", type: "string", role: "dimension" },
          { id: "score", type: "number", role: "measure", unit: "points" },
        ],
      },
    ],
    slices: [
      {
        id: "all-results",
        datasetId: "editor-data",
        fieldIds: ["school_id", "subject", "score"],
      },
    ],
    filterGroups: [],
    blocks: [
      {
        id: "chart",
        type: "chart",
        title: "Scores",
        bindings: [
          {
            id: "chart-school",
            role: "dimension",
            axis: "x",
            field: { datasetId: "editor-data", fieldId: "school_id" },
            sliceId: "all-results",
          },
          {
            id: "chart-score",
            role: "measure",
            axis: "y",
            field: { datasetId: "editor-data", fieldId: "score" },
            sliceId: "all-results",
            aggregation: { type: "average" },
          },
        ],
        config: { visualization: "bar" },
      },
      {
        id: "metric",
        type: "metric",
        title: "Average",
        bindings: [
          {
            id: "metric-score",
            role: "measure",
            axis: "y",
            mode: "fixed",
            field: { datasetId: "editor-data", fieldId: "score" },
            sliceId: "all-results",
            aggregation: { type: "average" },
          },
        ],
        config: {},
      },
      {
        id: "note",
        type: "text",
        title: "Note",
        bindings: [],
        config: { text: "Synthetic editor fixture." },
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
        field: { datasetId: "editor-data", fieldId: "school_id" },
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
        rowHeight: 8,
        placements: [
          { blockId: "chart", x: 0, y: 0, width: 6, height: 4 },
          { blockId: "metric", x: 6, y: 0, width: 6, height: 2 },
          { blockId: "note", x: 6, y: 2, width: 6, height: 2 },
          { blockId: "filter-block", x: 0, y: 4, width: 12, height: 2 },
        ],
      },
      tablet: {
        columns: 8,
        rowHeight: 8,
        placements: [
          { blockId: "chart", x: 0, y: 0, width: 8, height: 4 },
          { blockId: "metric", x: 0, y: 4, width: 8, height: 2 },
          { blockId: "note", x: 0, y: 6, width: 8, height: 2 },
          { blockId: "filter-block", x: 0, y: 8, width: 8, height: 2 },
        ],
      },
      narrow: {
        columns: 4,
        rowHeight: 8,
        placements: [
          { blockId: "chart", x: 0, y: 0, width: 4, height: 4 },
          { blockId: "metric", x: 0, y: 4, width: 4, height: 2 },
          { blockId: "note", x: 0, y: 6, width: 4, height: 2 },
          { blockId: "filter-block", x: 0, y: 8, width: 4, height: 2 },
        ],
      },
    },
  };
  return { descriptor: descriptor(), rows, document };
}

async function importText(input, text, name) {
  const file = new File([text], name, { type: "application/json" });
  const transfer = new DataTransfer();
  transfer.items.add(file);
  Object.defineProperty(input, "files", { value: transfer.files, configurable: true });
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await wait(120);
}

async function run() {
  try {
    const fixtureData = fixture();
    const provider = must(
      createLocalDatasetProvider({
        providerId: "editor-e2e",
        datasets: [{ descriptor: fixtureData.descriptor, rows: fixtureData.rows }],
      }),
    );
    const runtime = createRuntime({
      datasetProvider: provider,
      validationCatalog: createBoardValidationCatalog([fixtureData.descriptor]),
    });
    const root = document.getElementById("root");
    const workspace = must(
      mountBoardWorkspace(root, {
        runtime,
        document: fixtureData.document,
      }),
    );
    await wait(120);
    const sourceSpace = workspace.activeSpace;
    const sourceEntry = must({ ok: true, value: workspace.getEntry(sourceSpace.id) });
    const sourceHost = sourceEntry.host;
    let element = sourceHost.element;
    result.checks.initial = {
      mode: element.getAttribute("data-boardloom-mode"),
      blocks: element.querySelectorAll(".bl-block").length,
      entries: workspace.entries.length,
      dirtyBarHidden: element.querySelector(".bl-draft-bar")?.hasAttribute("hidden") ?? null,
    };

    element.querySelector('[data-mode="editor"]').click();
    await wait(120);
    element = sourceHost.element;
    const lease = sourceSpace.getSnapshot().editorLease;
    result.checks.editorOpened = {
      mode: element.getAttribute("data-boardloom-mode"),
      lease: lease !== null,
      libraryItems: element.querySelectorAll("[data-editor-add]").length,
      libraryVisible: !element.querySelector(".bl-library")?.hasAttribute("hidden"),
      draftBarVisible: !element.querySelector(".bl-draft-bar")?.hasAttribute("hidden"),
    };
    check("lease acquired", result.checks.editorOpened.lease);
    check("library entries", result.checks.editorOpened.libraryItems >= 5);

    for (const type of ["chart", "metric", "table", "text", "filter"]) {
      const button = element.querySelector(`[data-editor-add="${type}"]`);
      check(`library ${type}`, button !== null && button !== undefined);
      button?.click();
      await wait(60);
    }
    const addedDraft = sourceSpace.getSnapshot().draft;
    result.checks.blockCrud = {
      blocks: addedDraft?.document.blocks.length ?? 0,
      valid: addedDraft ? validateBoardDocument(addedDraft.document).valid : false,
      placements: addedDraft?.document.layout.desktop.placements.length ?? 0,
      selected: element.querySelectorAll('[data-editor-selected="true"]').length,
    };
    check("all block types added", result.checks.blockCrud.blocks === 9);
    check("added layout valid", result.checks.blockCrud.valid);

    const chartBlock = element.querySelector('[data-block-id="chart"]');
    chartBlock.focus();
    chartBlock.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await wait(60);
    result.checks.keyboardSelect = {
      selected: chartBlock.getAttribute("data-editor-selected"),
      activeBlock: document.activeElement?.getAttribute("data-block-id") ?? null,
      toolbarVisible:
        getComputedStyle(chartBlock.querySelector(".bl-block-actions")).display !== "none",
    };
    chartBlock.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await wait(40);
    if (chartBlock.getAttribute("data-editor-selected") === "true") {
      chartBlock.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await wait(40);
    }
    const escapeDeselected = chartBlock.getAttribute("data-editor-selected") !== "true";
    chartBlock.focus();
    chartBlock.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await wait(60);
    const keyboardHint = element.querySelector(".bl-keyboard-hint")?.textContent ?? "";
    result.checks.keyboardSemantics = {
      escapeDeselected,
      hint: keyboardHint,
      mentionsDeleteUndo: keyboardHint.includes("Delete") && keyboardHint.includes("undoable"),
      reselected: chartBlock.getAttribute("data-editor-selected") === "true",
    };
    const keyboardBreakpoint = element.getAttribute("data-boardloom-breakpoint");
    const layoutOf = (document) =>
      (document.layout[keyboardBreakpoint] ?? document.layout.desktop).placements;
    const beforeMove = sourceSpace
      .getSnapshot()
      .draft?.document.layout[keyboardBreakpoint]?.placements.find(
        (entry) => entry.blockId === "chart",
      );
    const keyboardTarget = chartBlock;
    keyboardTarget.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: window.innerWidth < 768 ? "ArrowDown" : "ArrowRight",
        bubbles: true,
      }),
    );
    await wait(40);
    const afterMove = sourceSpace
      .getSnapshot()
      .draft?.document.layout[keyboardBreakpoint]?.placements.find(
        (entry) => entry.blockId === "chart",
      );
    chartBlock.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", shiftKey: true, bubbles: true }),
    );
    await wait(40);
    const afterResize = sourceSpace
      .getSnapshot()
      .draft?.document.layout[keyboardBreakpoint]?.placements.find(
        (entry) => entry.blockId === "chart",
      );
    result.checks.keyboardLayout = {
      moved:
        beforeMove && afterMove
          ? afterMove.x !== beforeMove.x || afterMove.y !== beforeMove.y
          : false,
      resized: afterMove && afterResize ? afterResize.height !== afterMove.height : false,
      valid: validateBoardDocument(sourceSpace.getSnapshot().draft.document).valid,
      beforeX: beforeMove?.x ?? null,
      beforeY: beforeMove?.y ?? null,
      afterX: afterMove?.x ?? null,
      afterY: afterMove?.y ?? null,
      afterHeight: afterResize?.height ?? null,
      notice: element.querySelector(".bl-editor-notice")?.textContent ?? "",
      activeLayout: layoutOf(sourceSpace.getSnapshot().draft.document).slice(0, 3),
    };
    check("keyboard moved block", result.checks.keyboardLayout.moved);
    check("keyboard resized block", result.checks.keyboardLayout.resized);
    check("keyboard selected block", result.checks.keyboardSelect.selected === "true");

    const noteBlock = element.querySelector('[data-block-id="note"]');
    noteBlock.click();
    await wait(60);
    const textArea = element.querySelector('[data-editor-text="true"]');
    textArea.focus();
    textArea.value = "Edited text";
    textArea.dispatchEvent(new Event("change", { bubbles: true }));
    await wait(60);
    result.checks.textEditing = {
      text: sourceSpace.getSnapshot().draft?.document.blocks.find((block) => block.id === "note")
        ?.config.text,
      focusPreserved:
        document.activeElement?.getAttribute("data-editor-text") === "true" &&
        document.activeElement?.value === "Edited text",
      undoAvailable: sourceSpace.getSnapshot().draft?.canUndo ?? false,
    };
    check("text block content edited", result.checks.textEditing.text === "Edited text");
    check("text editing focus preserved", result.checks.textEditing.focusPreserved === true);

    const layoutButton = element.querySelector(
      '.bl-inspector [data-block-action="right"][data-block-target="note"]',
    );
    layoutButton.focus();
    layoutButton.click();
    await wait(60);
    result.checks.layoutFocus = {
      action: document.activeElement?.getAttribute("data-block-action") ?? null,
      target: document.activeElement?.getAttribute("data-block-target") ?? null,
      selected: element
        .querySelector('[data-block-id="note"]')
        ?.getAttribute("data-editor-selected"),
    };
    check(
      "layout action preserves focus and selection",
      result.checks.layoutFocus.action === "right" &&
        result.checks.layoutFocus.target === "note" &&
        result.checks.layoutFocus.selected === "true",
    );

    const undo = element.querySelector('[data-draft-action="undo"]');
    const redo = element.querySelector('[data-draft-action="redo"]');
    const revisionBeforeUndo = sourceSpace.getSnapshot().draft.revision;
    undo.click();
    await wait(40);
    const afterUndo = sourceSpace.getSnapshot().draft;
    redo.click();
    await wait(40);
    const afterRedo = sourceSpace.getSnapshot().draft;
    result.checks.undoRedo = {
      undoChanged: afterUndo.canRedo,
      redoChanged: afterRedo.canUndo,
      canRedoAfterUndo: afterUndo.canRedo,
      revisionBeforeUndo,
      revisionAfterUndo: afterUndo.revision,
    };
    check("undo changed revision", result.checks.undoRedo.undoChanged);
    check("redo changed revision", result.checks.undoRedo.redoChanged);

    sourceHost.setMode("viewer");
    await wait(60);
    const viewerMode = sourceHost.element.getAttribute("data-boardloom-mode");
    const draftAcrossViewer = sourceSpace.getSnapshot().draft;
    sourceHost.setMode("editor");
    await wait(60);
    result.checks.modeSwitch = {
      viewerMode,
      draftPreserved:
        draftAcrossViewer !== null &&
        sourceSpace.getSnapshot().draft?.revision === draftAcrossViewer.revision,
      committedBlocks: sourceSpace.getSnapshot().committedDocument.blocks.length,
    };
    check("draft survives mode switch", result.checks.modeSwitch.draftPreserved);

    const discard = element.querySelector('[data-draft-action="discard"]');
    discard.click();
    await wait(40);
    const confirm = element.querySelector('[data-confirm-action="confirm"]');
    result.checks.discard = { confirmation: confirm !== null && confirm !== undefined };
    confirm?.click();
    await wait(60);
    result.checks.discard.clean = sourceSpace.getSnapshot().draft.dirty === false;
    result.checks.discard.blocks = sourceSpace.getSnapshot().draft.document.blocks.length;
    check("discard restored blocks", result.checks.discard.blocks === 4);

    must(sourceHost.view.commands.updateBlock("chart", { title: "Applied title" }));
    await wait(40);
    element.querySelector('[data-draft-action="apply"]').click();
    await wait(80);
    result.checks.apply = {
      committedTitle: sourceSpace
        .getSnapshot()
        .committedDocument.blocks.find((block) => block.id === "chart")?.title,
      draftDirty: sourceSpace.getSnapshot().draft.dirty,
      revision: sourceSpace.getSnapshot().committedRevision,
    };
    check("apply committed title", result.checks.apply.committedTitle === "Applied title");

    const themeMode = element.querySelector('[data-theme-control="mode"]');
    const themeAccent = element.querySelector('[data-theme-token="accent"]');
    themeMode.value = "dark";
    themeMode.dispatchEvent(new Event("change", { bubbles: true }));
    await wait(60);
    const refreshedAccent = element.querySelector('[data-theme-token="accent"]');
    refreshedAccent.focus();
    refreshedAccent.value = "#3366cc";
    refreshedAccent.dispatchEvent(new Event("change", { bubbles: true }));
    await wait(60);
    const themeFocus = {
      themeToken: document.activeElement?.getAttribute("data-theme-token") ?? null,
      value: document.activeElement?.value ?? null,
    };
    result.checks.theme = {
      mode: sourceSpace.getSnapshot().draft?.document.theme.mode,
      accent: sourceSpace.getSnapshot().draft?.document.theme.tokens?.accent ?? null,
      success: sourceSpace.getSnapshot().draft?.document.theme.tokens?.success ?? null,
      extra: sourceSpace.getSnapshot().draft?.document.theme.tokens?.["ext.brand-extra"] ?? null,
      rendered: element.getAttribute("data-boardloom-theme"),
      tokenRows: element.querySelectorAll("[data-theme-remove-token]").length,
      themeFocus,
    };
    check(
      "theme draft edited",
      result.checks.theme.mode === "dark" &&
        result.checks.theme.accent === "#3366cc" &&
        result.checks.theme.success === "#00aa00" &&
        result.checks.theme.extra === "#123456",
    );
    element.querySelector('[data-theme-remove-token="success"]')?.click();
    await wait(60);
    result.checks.themeRemoval = {
      success: sourceSpace.getSnapshot().draft?.document.theme.tokens?.success ?? null,
      accent: sourceSpace.getSnapshot().draft?.document.theme.tokens?.accent ?? null,
      extra: sourceSpace.getSnapshot().draft?.document.theme.tokens?.["ext.brand-extra"] ?? null,
    };
    check(
      "theme token removal preserves others",
      result.checks.themeRemoval.success === null &&
        result.checks.themeRemoval.accent === "#3366cc" &&
        result.checks.themeRemoval.extra === "#123456",
    );
    const invalidTokenName = element.querySelector('[data-theme-control="token-name"]');
    const invalidTokenValue = element.querySelector('[data-theme-control="token-value"]');
    invalidTokenName.value = "bad token";
    invalidTokenValue.value = "#ffffff";
    element.querySelector('[data-theme-action="apply"]')?.click();
    await wait(60);
    result.checks.invalidTheme = {
      notice: element.querySelector(".bl-editor-notice")?.textContent ?? "",
      mode: sourceSpace.getSnapshot().draft?.document.theme.mode,
      accent: sourceSpace.getSnapshot().draft?.document.theme.tokens?.accent ?? null,
      extra: sourceSpace.getSnapshot().draft?.document.theme.tokens?.["ext.brand-extra"] ?? null,
    };
    check(
      "invalid theme token rejected",
      result.checks.invalidTheme.notice !== "" &&
        result.checks.invalidTheme.mode === "dark" &&
        result.checks.invalidTheme.accent === "#3366cc" &&
        result.checks.invalidTheme.extra === "#123456",
    );
    const protoName = element.querySelector('[data-theme-control="token-name"]');
    const protoValue = element.querySelector('[data-theme-control="token-value"]');
    protoName.value = "__proto__";
    protoValue.value = "#ffffff";
    element.querySelector('[data-theme-action="apply"]')?.click();
    await wait(60);
    const protoTokens = sourceSpace.getSnapshot().draft?.document.theme.tokens ?? {};
    result.checks.protoTheme = {
      notice: element.querySelector(".bl-editor-notice")?.textContent ?? "",
      hasProto: Object.hasOwn(protoTokens, "__proto__"),
      extra: protoTokens["ext.brand-extra"] ?? null,
    };
    check(
      "proto token name is rejected instead of disappearing",
      result.checks.protoTheme.notice !== "" &&
        result.checks.protoTheme.hasProto === false &&
        result.checks.protoTheme.extra === "#123456",
    );
    element.querySelector('[data-draft-action="discard"]').click();
    await wait(40);
    element.querySelector('[data-confirm-action="confirm"]')?.click();
    await wait(60);

    must(sourceHost.view.commands.updateBlock("chart", { title: "Conflict draft" }));
    const hostChanged = JSON.parse(JSON.stringify(fixtureData.document));
    hostChanged.title = "Host changed";
    must(sourceSpace.loadDocument(hostChanged, { source: "host" }));
    await wait(60);
    element.querySelector('[data-draft-action="apply"]').click();
    await wait(80);
    result.checks.conflict = {
      draftTitle: sourceSpace
        .getSnapshot()
        .draft?.document.blocks.find((block) => block.id === "chart")?.title,
      committedTitle: sourceSpace
        .getSnapshot()
        .committedDocument.blocks.find((block) => block.id === "chart")?.title,
      hostTitle: sourceSpace.getSnapshot().committedDocument.title,
      notice: element.querySelector(".bl-editor-notice")?.textContent ?? "",
    };
    check(
      "revision conflict preserved draft",
      result.checks.conflict.draftTitle === "Conflict draft",
    );
    check(
      "revision conflict did not overwrite",
      result.checks.conflict.committedTitle === "Scores" &&
        result.checks.conflict.hostTitle === "Host changed",
    );
    element.querySelector('[data-draft-action="discard"]').click();
    await wait(40);
    element.querySelector('[data-confirm-action="confirm"]')?.click();
    await wait(60);

    const secondLease = sourceSpace.acquireEditorLease({ sessionId: "second-editor" });
    result.checks.secondLease = {
      ok: secondLease.ok,
      code: secondLease.ok ? null : secondLease.diagnostics[0]?.code,
      currentLease: sourceSpace.getSnapshot().editorLease?.sessionId,
    };
    check("second lease rejected", secondLease.ok === false);

    must(sourceHost.view.commands.updateBlock("note", { title: "Source draft" }));
    must(sourceSpace.setFilterValue("filter-school", ["north"]));
    await wait(80);
    const exportButton = element.querySelector("[data-editor-export]");
    exportButton.click();
    await wait(80);
    result.checks.dirtyExport = {
      buttonText: exportButton.textContent,
      notice: element.querySelector(".bl-editor-notice")?.textContent ?? "",
      draftTitle: sourceSpace
        .getSnapshot()
        .draft?.document.blocks.find((block) => block.id === "note")?.title,
    };
    check(
      "dirty export is labelled and discloses committed-only output",
      result.checks.dirtyExport.buttonText === "Export committed board" &&
        String(result.checks.dirtyExport.notice).includes("not included") &&
        result.checks.dirtyExport.draftTitle === "Source draft",
    );
    const sourceRevision = sourceSpace.getSnapshot().draft.revision;
    const sourceCanUndo = sourceSpace.getSnapshot().draft.canUndo;
    const sourceFilters = canonicalJson(sourceSpace.getFilterState());
    const sourceQueries = sourceSpace.getQueryStates().length;
    const exported = must(sourceHost.exportDocument());
    const importPayload = exported.canonical;
    const importInput = element.querySelector('[data-editor-import-input="true"]');
    await importText(importInput, importPayload, "new-board.json");
    result.checks.importNewSpace = {
      entries: workspace.entries.length,
      activeChanged: workspace.activeSpace.id !== sourceSpace.id,
      sourceDraftTitle: sourceSpace
        .getSnapshot()
        .draft?.document.blocks.find((block) => block.id === "note")?.title,
      sourceRevision: sourceSpace.getSnapshot().draft?.revision,
      sourceCanUndo: sourceSpace.getSnapshot().draft?.canUndo,
      sourceFilters: canonicalJson(sourceSpace.getFilterState()),
      sourceQueries: sourceSpace.getQueryStates().length,
      sourceStatus: sourceSpace.getSnapshot().status,
      sourceDisposed: sourceSpace.disposed,
    };
    check(
      "import created and activated a new space",
      result.checks.importNewSpace.entries === 2 && result.checks.importNewSpace.activeChanged,
    );
    check(
      "import preserved source draft",
      result.checks.importNewSpace.sourceDraftTitle === "Source draft",
    );
    check(
      "import preserved source undo and revision",
      result.checks.importNewSpace.sourceCanUndo === true &&
        result.checks.importNewSpace.sourceRevision === sourceRevision,
    );
    check(
      "import preserved source filters",
      result.checks.importNewSpace.sourceFilters === sourceFilters,
    );
    check(
      "import preserved source queries",
      result.checks.importNewSpace.sourceQueries === sourceQueries,
    );
    check("source space remains alive", result.checks.importNewSpace.sourceDisposed === false);

    const sourceEntryTab = workspace.entries[0].tab;
    const importedEntry = workspace.entries[1];
    result.checks.importTabs = {
      focused: document.activeElement === importedEntry.tab,
      marker: importedEntry.tab.getAttribute("data-imported"),
      markerText: importedEntry.tab.querySelector(".bl-workspace__tab-imported")?.textContent ?? "",
      importedTitle: importedEntry.tab.querySelector(".bl-workspace__tab-label")?.textContent ?? "",
    };
    check("import focuses the new tab", result.checks.importTabs.focused);
    check("import marks the new tab", result.checks.importTabs.marker === "true");
    check(
      "imported tab is labelled",
      String(result.checks.importTabs.markerText).trim() !== "" &&
        String(result.checks.importTabs.importedTitle) === "Host changed",
    );
    importedEntry.tab.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
    );
    await wait(60);
    const tabKeyboardSource = {
      active: workspace.activeSpace.id,
      focused: document.activeElement === sourceEntryTab,
    };
    sourceEntryTab.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
    await wait(60);
    result.checks.tabKeyboard = {
      source: tabKeyboardSource,
      imported:
        workspace.activeSpace.id === importedEntry.space.id &&
        document.activeElement === importedEntry.tab,
    };
    check(
      "tab keyboard navigates and focuses",
      tabKeyboardSource.active === sourceSpace.id &&
        tabKeyboardSource.focused &&
        result.checks.tabKeyboard.imported,
    );
    const renamedSource = JSON.parse(JSON.stringify(sourceSpace.getSnapshot().committedDocument));
    renamedSource.title = "Renamed source";
    must(sourceSpace.loadDocument(renamedSource, { source: "host" }));
    await wait(80);
    result.checks.tabTitleSync =
      sourceEntryTab.querySelector(".bl-workspace__tab-label")?.textContent ?? "";
    check(
      "tab title follows host document changes",
      result.checks.tabTitleSync === "Renamed source",
    );

    const activeBeforeInvalid = workspace.activeSpace.id;
    const focusBeforeInvalid = document.activeElement;
    const invalidInput = element.querySelector('[data-editor-import-input="true"]');
    await importText(invalidInput, "{not valid json", "invalid.json");
    result.checks.invalidImport = {
      entries: workspace.entries.length,
      active: workspace.activeSpace.id,
      focus: document.activeElement === focusBeforeInvalid,
      draftTitle: sourceSpace
        .getSnapshot()
        .draft?.document.blocks.find((block) => block.id === "note")?.title,
      notice: element.querySelector(".bl-editor-notice")?.textContent ?? "",
    };
    check(
      "invalid import changed no space",
      result.checks.invalidImport.entries === 2 &&
        result.checks.invalidImport.active === activeBeforeInvalid,
    );
    check(
      "invalid import preserved source draft",
      result.checks.invalidImport.draftTitle === "Source draft",
    );

    must(sourceHost.setMode("viewer"));
    await wait(60);
    const activeEntry = workspace.getEntry(workspace.activeSpace.id);
    const activeExport = must(activeEntry.host.exportDocument());
    result.checks.exportViewer = {
      sourceMode: sourceHost.element.getAttribute("data-boardloom-mode"),
      exportedId: JSON.parse(activeExport.canonical).id,
      exportedTitle: JSON.parse(activeExport.canonical).title,
      exportedBlocks: JSON.parse(activeExport.canonical).blocks.length,
      viewerBlocks: activeEntry.host.element.querySelectorAll(".bl-block").length,
    };
    check(
      "export round-trips structure",
      result.checks.exportViewer.exportedBlocks === result.checks.exportViewer.viewerBlocks,
    );

    if (window.innerWidth < 768) {
      must(workspace.activateSpace(sourceSpace.id));
      sourceHost.setMode("editor");
      await wait(80);
      const sourceElement = sourceHost.element;
      const library = sourceElement.querySelector(".bl-library");
      const inspector = sourceElement.querySelector(".bl-inspector");
      const libraryToggleButton = sourceElement.querySelector('[data-editor-drawer="library"]');
      const inspectorToggleButton = sourceElement.querySelector('[data-editor-drawer="inspector"]');
      const hiddenInitially =
        getComputedStyle(library).display === "none" &&
        getComputedStyle(inspector).display === "none";
      libraryToggleButton.click();
      await wait(60);
      const libraryOpen = getComputedStyle(library).display !== "none";
      const libraryFocus = sourceElement.contains(document.activeElement);
      const scrim = sourceElement.querySelector(".bl-drawer-scrim");
      const scrimVisible = !scrim.hasAttribute("hidden");
      (document.activeElement || libraryToggleButton).dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      await wait(60);
      const closedByEscape = getComputedStyle(library).display === "none";
      const focusReturned = document.activeElement === libraryToggleButton;
      inspectorToggleButton.click();
      await wait(60);
      const inspectorOpen =
        getComputedStyle(inspector).display !== "none" &&
        getComputedStyle(library).display === "none";
      const modal = inspector.getAttribute("aria-modal") === "true";
      const canvas = sourceElement.querySelector(".bl-canvas");
      const draftBar = sourceElement.querySelector(".bl-draft-bar");
      const sheetApply = sourceElement.querySelector(
        '.bl-inspector__draft [data-draft-action="apply"]',
      );
      const sheetDiscard = sourceElement.querySelector(
        '.bl-inspector__draft [data-draft-action="discard"]',
      );
      const backgroundInert = canvas.hasAttribute("inert") && draftBar.hasAttribute("inert");
      const visibleFocusable = [
        ...inspector.querySelectorAll(
          "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])",
        ),
      ].filter(
        (element) =>
          !element.hasAttribute("hidden") &&
          !element.hasAttribute("inert") &&
          element.closest("[hidden], [inert]") === null &&
          element.getClientRects().length > 0,
      );
      const firstVisible = visibleFocusable[0];
      const lastVisible = visibleFocusable[visibleFocusable.length - 1];
      lastVisible.focus();
      lastVisible.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
      await wait(40);
      const tabForwardWrapped = document.activeElement === firstVisible;
      firstVisible.focus();
      firstVisible.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }),
      );
      await wait(40);
      const tabBackwardWrapped = document.activeElement === lastVisible;
      sheetDiscard?.click();
      await wait(60);
      const confirmation = sourceElement.querySelector(".bl-confirm:not([hidden])");
      const confirmationInSheet = confirmation !== null && inspector.contains(confirmation);
      const visibleWithConfirmation = [
        ...inspector.querySelectorAll(
          "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])",
        ),
      ].filter(
        (element) =>
          !element.hasAttribute("hidden") &&
          !element.hasAttribute("inert") &&
          element.closest("[hidden], [inert]") === null &&
          element.getClientRects().length > 0,
      );
      const firstWithConfirmation = visibleWithConfirmation[0];
      const lastWithConfirmation = visibleWithConfirmation[visibleWithConfirmation.length - 1];
      lastWithConfirmation.focus();
      lastWithConfirmation.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
      );
      await wait(40);
      const confirmationForward = document.activeElement === firstWithConfirmation;
      firstWithConfirmation.focus();
      firstWithConfirmation.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }),
      );
      await wait(40);
      const confirmationBackward = document.activeElement === lastWithConfirmation;
      sourceElement.querySelector('[data-confirm-action="cancel"]')?.click();
      await wait(60);
      const overflow = sourceElement.scrollWidth <= window.innerWidth + 1;
      result.checks.responsive = {
        hiddenInitially,
        libraryOpen,
        scrimVisible,
        inspectorOpen,
        libraryFocus,
        closedByEscape,
        focusReturned,
        modal,
        backgroundInert,
        sheetActions: sheetApply !== null && sheetDiscard !== null,
        tabForwardWrapped,
        tabBackwardWrapped,
        confirmationInSheet,
        confirmationTabWrapped: confirmationForward && confirmationBackward,
        overflow,
        width: window.innerWidth,
        breakpoint: sourceElement.getAttribute("data-boardloom-breakpoint"),
        libraryDisplay: getComputedStyle(library).display,
        inspectorDisplay: getComputedStyle(inspector).display,
        libraryOpenAttr: library.getAttribute("data-open"),
        inspectorOpenAttr: inspector.getAttribute("data-open"),
      };
      check("narrow drawers hidden initially", hiddenInitially);
      check("narrow library drawer opens", libraryOpen);
      check("narrow drawer receives focus", libraryFocus);
      check("Escape closes drawer and returns focus", closedByEscape && focusReturned);
      check("narrow inspector drawer opens", inspectorOpen);
      check("narrow inspector is modal", modal);
      check("narrow modal makes the background inert", backgroundInert);
      check("narrow modal exposes draft actions", sheetApply !== null && sheetDiscard !== null);
      check(
        "narrow modal traps Tab in both directions with confirmation hidden",
        tabForwardWrapped && tabBackwardWrapped,
      );
      check("narrow confirmation stays inside the sheet", confirmationInSheet);
      check(
        "narrow modal traps Tab with the confirmation visible",
        confirmationForward && confirmationBackward,
      );
      check("narrow editor avoids page overflow", overflow);
    }

    const reentrantRuntime = createRuntime({
      datasetProvider: provider,
      validationCatalog: createBoardValidationCatalog([fixtureData.descriptor]),
    });
    let reentrantFirstId = "";
    let reentrantSecondId = "";
    let reentrantArmed = false;
    let reentrantLoadOk = null;
    const reentrantEvents = [];
    const reentrantTarget = document.createElement("div");
    document.body.append(reentrantTarget);
    const reentrantWorkspace = must(
      mountBoardWorkspace(reentrantTarget, {
        runtime: reentrantRuntime,
        document: fixtureData.document,
        onEvent: (spaceEvent) => {
          reentrantEvents.push(spaceEvent.type);
          if (
            reentrantArmed &&
            spaceEvent.type === "document:changed" &&
            spaceEvent.spaceId === reentrantFirstId
          ) {
            reentrantArmed = false;
            const secondSpace = reentrantRuntime.getSpace(reentrantSecondId);
            if (secondSpace !== undefined) {
              const newer = JSON.parse(JSON.stringify(secondSpace.getSnapshot().committedDocument));
              newer.title = "Reentrant newer";
              reentrantLoadOk = secondSpace.loadDocument(newer, { source: "reentrant" }).ok;
            }
          }
        },
      }),
    );
    await wait(120);
    reentrantFirstId = reentrantWorkspace.entries[0].space.id;
    const reentrantFirstSpace = reentrantWorkspace.entries[0].space;
    const reentrantSecondImport = must(
      reentrantWorkspace.importDocument(must(reentrantFirstSpace.exportDocument()).canonical),
    );
    reentrantSecondId = reentrantSecondImport.space.id;
    const reentrantFirstLease = must(
      reentrantFirstSpace.acquireEditorLease({ sessionId: "reentrant-first" }),
    );
    const reentrantFirstView = must(
      reentrantFirstSpace.createView({ mode: "editor", lease: reentrantFirstLease }),
    );
    must(reentrantFirstView.commands.updateBlock("chart", { title: "Draft A" }));
    const reentrantSecondLease = must(
      reentrantSecondImport.space.acquireEditorLease({ sessionId: "reentrant-second" }),
    );
    const reentrantSecondView = must(
      reentrantSecondImport.space.createView({ mode: "editor", lease: reentrantSecondLease }),
    );
    must(reentrantSecondView.commands.updateBlock("chart", { title: "Draft B" }));
    reentrantEvents.length = 0;
    reentrantArmed = true;
    const reentrantDispose = reentrantWorkspace.dispose({ draftDecision: "apply" });
    result.checks.reentrantMultiSpace = {
      disposed: reentrantDispose.ok,
      workspaceDisposed: reentrantWorkspace.disposed,
      firstCommittedTitle: reentrantFirstSpace
        .getSnapshot()
        .committedDocument.blocks.find((block) => block.id === "chart")?.title,
      secondCommittedTitle: reentrantSecondImport.space
        .getSnapshot()
        .committedDocument.blocks.find((block) => block.id === "chart")?.title,
      reentrantLoadOk,
      normalEventsSuppressed: !reentrantEvents.includes("document:changed"),
      eventsAfterDecision: reentrantEvents.length,
      eventTypes: [...new Set(reentrantEvents)],
    };
    check(
      "reentrant multi-space apply completes without partial failure",
      result.checks.reentrantMultiSpace.disposed === true &&
        result.checks.reentrantMultiSpace.workspaceDisposed === true &&
        result.checks.reentrantMultiSpace.firstCommittedTitle === "Draft A" &&
        result.checks.reentrantMultiSpace.secondCommittedTitle === "Draft B" &&
        result.checks.reentrantMultiSpace.reentrantLoadOk !== true &&
        result.checks.reentrantMultiSpace.normalEventsSuppressed === true &&
        result.checks.reentrantMultiSpace.eventsAfterDecision === 0,
    );
    reentrantRuntime.dispose();

    const reentrantDraftRuntime = createRuntime({
      datasetProvider: provider,
      validationCatalog: createBoardValidationCatalog([fixtureData.descriptor]),
    });
    const reentrantDraftTarget = document.createElement("div");
    document.body.append(reentrantDraftTarget);
    const reentrantDraftWorkspace = must(
      mountBoardWorkspace(reentrantDraftTarget, {
        runtime: reentrantDraftRuntime,
        document: fixtureData.document,
      }),
    );
    await wait(120);
    const reentrantDraftSpace = reentrantDraftWorkspace.entries[0].space;
    const reentrantDraftLease = must(
      reentrantDraftSpace.acquireEditorLease({ sessionId: "reentrant-draft" }),
    );
    const reentrantDraftView = must(
      reentrantDraftSpace.createView({ mode: "editor", lease: reentrantDraftLease }),
    );
    must(reentrantDraftView.commands.updateBlock("chart", { title: "Original dirty" }));
    let injectedDraft = false;
    const reentrantDraftSubscription = reentrantDraftSpace.subscribe((spaceEvent) => {
      if (spaceEvent.type === "document:changed" && !injectedDraft) {
        injectedDraft = true;
        const newLease = reentrantDraftSpace.acquireEditorLease({
          sessionId: "reentrant-new-draft",
        });
        if (newLease.ok) {
          const newView = reentrantDraftSpace.createView({
            mode: "editor",
            lease: newLease.value,
          });
          if (newView.ok) {
            newView.value.commands.updateBlock("chart", { title: "Reentrant new draft" });
          }
        }
      }
    });
    const reentrantDraftDispose = reentrantDraftWorkspace.dispose({ draftDecision: "apply" });
    const reentrantDraftSnapshot = reentrantDraftSpace.getSnapshot();
    result.checks.reentrantDraft = {
      disposed: reentrantDraftDispose.ok,
      reentered: injectedDraft,
      workspaceDisposed: reentrantDraftWorkspace.disposed,
      spaceDisposed: reentrantDraftSpace.disposed,
      committedTitle: reentrantDraftSnapshot.committedDocument.blocks.find(
        (block) => block.id === "chart",
      )?.title,
      draftTitle:
        reentrantDraftSnapshot.draft?.document.blocks.find((block) => block.id === "chart")
          ?.title ?? null,
      hasLease: reentrantDraftSnapshot.editorLease !== null,
    };
    check(
      "direct observer cannot create a new draft during release",
      result.checks.reentrantDraft.disposed === true &&
        result.checks.reentrantDraft.reentered === false &&
        result.checks.reentrantDraft.workspaceDisposed === true &&
        result.checks.reentrantDraft.spaceDisposed === true &&
        result.checks.reentrantDraft.committedTitle === "Original dirty" &&
        result.checks.reentrantDraft.draftTitle === null &&
        result.checks.reentrantDraft.hasLease === false,
    );
    reentrantDraftSubscription();
    if (!reentrantDraftSpace.disposed) {
      reentrantDraftSpace.dispose();
    }
    reentrantDraftRuntime.dispose();

    async function directReentryScenario(kind, decision) {
      const runtime = createRuntime({
        datasetProvider: provider,
        validationCatalog: createBoardValidationCatalog([fixtureData.descriptor]),
      });
      const target = document.createElement("div");
      document.body.append(target);
      const workspace = must(
        mountBoardWorkspace(target, { runtime, document: fixtureData.document }),
      );
      await wait(120);
      const firstSpace = workspace.entries[0].space;
      const secondImport = must(
        workspace.importDocument(must(firstSpace.exportDocument()).canonical),
      );
      const secondSpace = secondImport.space;
      const firstLease = must(firstSpace.acquireEditorLease({ sessionId: `direct-${kind}-first` }));
      const firstView = must(firstSpace.createView({ mode: "editor", lease: firstLease }));
      must(firstView.commands.updateBlock("chart", { title: "Direct A" }));
      const secondLease = must(
        secondSpace.acquireEditorLease({ sessionId: `direct-${kind}-second` }),
      );
      const secondView = must(secondSpace.createView({ mode: "editor", lease: secondLease }));
      must(secondView.commands.updateBlock("chart", { title: "Direct B" }));
      let reentered = false;
      const unsubscribe = firstSpace.subscribe((spaceEvent) => {
        if (reentered) {
          return;
        }
        if (kind === "apply" && spaceEvent.type === "document:changed") {
          reentered = true;
          const newer = JSON.parse(JSON.stringify(secondSpace.getSnapshot().committedDocument));
          newer.title = "Direct newer";
          secondSpace.loadDocument(newer, { source: "direct-reentry" });
        }
        if (kind === "cancel" && spaceEvent.type === "draft:cancelled") {
          reentered = true;
          secondView.commands.updateBlock("chart", { title: "Direct cancel edit" });
        }
      });
      const disposal = workspace.dispose({ draftDecision: decision });
      const checks = {
        kind,
        disposed: disposal.ok,
        workspaceDisposed: workspace.disposed,
        reentered,
        firstCommittedTitle: firstSpace
          .getSnapshot()
          .committedDocument.blocks.find((block) => block.id === "chart")?.title,
        secondCommittedTitle: secondSpace
          .getSnapshot()
          .committedDocument.blocks.find((block) => block.id === "chart")?.title,
        firstDisposed: firstSpace.disposed,
        secondDisposed: secondSpace.disposed,
      };
      unsubscribe();
      runtime.dispose();
      return checks;
    }

    const directApply = await directReentryScenario("apply", "apply");
    const directCancel = await directReentryScenario("cancel", "cancel");
    result.checks.directReentry = { apply: directApply, cancel: directCancel };
    check(
      "direct-subscriber apply reentry cannot split decisions",
      directApply.disposed === true &&
        directApply.workspaceDisposed === true &&
        directApply.reentered === false &&
        directApply.firstCommittedTitle === "Direct A" &&
        directApply.secondCommittedTitle === "Direct B" &&
        directApply.firstDisposed === true &&
        directApply.secondDisposed === true,
    );
    check(
      "direct-subscriber cancel reentry cannot discard a later draft",
      directCancel.disposed === true &&
        directCancel.workspaceDisposed === true &&
        directCancel.reentered === false &&
        directCancel.firstCommittedTitle === "Scores" &&
        directCancel.secondCommittedTitle === "Scores" &&
        directCancel.firstDisposed === true &&
        directCancel.secondDisposed === true,
    );

    const orderingRuntime = createRuntime({
      datasetProvider: provider,
      validationCatalog: createBoardValidationCatalog([fixtureData.descriptor]),
    });
    const orderingSpace = must(orderingRuntime.createSpace({ document: fixtureData.document }));
    const orderingLease = must(orderingSpace.acquireEditorLease({ sessionId: "ordering" }));
    const orderingView = must(orderingSpace.createView({ mode: "editor", lease: orderingLease }));
    must(orderingView.commands.updateBlock("chart", { title: "Ordering dirty" }));
    const orderingTarget = document.createElement("div");
    document.body.append(orderingTarget);
    let orderingArmed = false;
    let orderingReentered = false;
    const orderingEvents = [];
    const orderingWorkspace = must(
      mountBoardWorkspace(orderingTarget, {
        space: orderingSpace,
        onEvent: (spaceEvent) => {
          orderingEvents.push({ type: spaceEvent.type, sequence: spaceEvent.sequence });
          if (orderingArmed && !orderingReentered && spaceEvent.type === "document:changed") {
            orderingReentered = true;
            const newer = JSON.parse(JSON.stringify(orderingSpace.getSnapshot().committedDocument));
            newer.title = "After ordering apply";
            orderingSpace.loadDocument(newer, { source: "ordering-reentry" });
          }
        },
      }),
    );
    await wait(120);
    orderingArmed = true;
    orderingEvents.length = 0;
    const orderingDispose = orderingWorkspace.dispose({ draftDecision: "apply" });
    result.checks.eventOrdering = {
      disposed: orderingDispose.ok,
      workspaceDisposed: orderingWorkspace.disposed,
      sourceAlive: orderingSpace.disposed === false,
      reentered: orderingReentered,
      types: orderingEvents.map((entry) => entry.type),
      ordered: orderingEvents.every(
        (entry, index) => index === 0 || entry.sequence > orderingEvents[index - 1].sequence,
      ),
      sawApplyBeforeReload:
        orderingEvents.findIndex((entry) => entry.type === "document:changed") >= 0 &&
        orderingEvents.findIndex((entry) => entry.type === "space:loaded") >
          orderingEvents.findIndex((entry) => entry.type === "document:changed"),
      committedTitle: orderingSpace.getSnapshot().committedDocument.title,
    };
    check(
      "external host events remain ordered under reentry and precede view disposal",
      result.checks.eventOrdering.disposed === true &&
        result.checks.eventOrdering.workspaceDisposed === true &&
        result.checks.eventOrdering.sourceAlive === true &&
        result.checks.eventOrdering.reentered === true &&
        result.checks.eventOrdering.ordered === true &&
        result.checks.eventOrdering.sawApplyBeforeReload === true &&
        result.checks.eventOrdering.committedTitle === "After ordering apply",
    );
    orderingRuntime.dispose();

    const terminalRuntime = createRuntime({
      datasetProvider: provider,
      validationCatalog: createBoardValidationCatalog([fixtureData.descriptor]),
    });
    const terminalTarget = document.createElement("div");
    document.body.append(terminalTarget);
    const terminalWorkspace = must(
      mountBoardWorkspace(terminalTarget, {
        runtime: terminalRuntime,
        document: fixtureData.document,
      }),
    );
    await wait(120);
    const terminalFirstSpace = terminalWorkspace.entries[0].space;
    const terminalSecondImport = must(
      terminalWorkspace.importDocument(must(terminalFirstSpace.exportDocument()).canonical),
    );
    const terminalSecondSpace = terminalSecondImport.space;
    const terminalFirstLease = must(
      terminalFirstSpace.acquireEditorLease({ sessionId: "terminal-first" }),
    );
    const terminalFirstView = must(
      terminalFirstSpace.createView({ mode: "editor", lease: terminalFirstLease }),
    );
    must(terminalFirstView.commands.updateBlock("chart", { title: "Terminal A" }));
    const terminalSecondLease = must(
      terminalSecondSpace.acquireEditorLease({ sessionId: "terminal-second" }),
    );
    const terminalSecondView = must(
      terminalSecondSpace.createView({ mode: "editor", lease: terminalSecondLease }),
    );
    must(terminalSecondView.commands.updateBlock("chart", { title: "Terminal B" }));
    let terminalListenerRan = false;
    let terminalDraftCreated = false;
    const terminalUnsubscribe = terminalFirstSpace.subscribe((spaceEvent) => {
      if (spaceEvent.type !== "space:disposed") {
        return;
      }
      terminalListenerRan = true;
      if (terminalSecondSpace.disposed) {
        return;
      }
      const newLease = terminalSecondSpace.acquireEditorLease({
        sessionId: "terminal-new-draft",
      });
      if (newLease.ok) {
        const newView = terminalSecondSpace.createView({
          mode: "editor",
          lease: newLease.value,
        });
        if (newView.ok) {
          terminalDraftCreated = newView.value.commands.updateBlock("chart", {
            title: "Terminal new draft",
          }).ok;
        }
      }
    });
    const terminalDispose = terminalWorkspace.dispose({ draftDecision: "cancel" });
    result.checks.terminalReentry = {
      disposed: terminalDispose.ok,
      workspaceDisposed: terminalWorkspace.disposed,
      listenerRan: terminalListenerRan,
      draftCreated: terminalDraftCreated,
      firstDisposed: terminalFirstSpace.disposed,
      secondDisposed: terminalSecondSpace.disposed,
      firstCommittedTitle: terminalFirstSpace
        .getSnapshot()
        .committedDocument.blocks.find((block) => block.id === "chart")?.title,
      secondCommittedTitle: terminalSecondSpace
        .getSnapshot()
        .committedDocument.blocks.find((block) => block.id === "chart")?.title,
    };
    check(
      "terminal delivery is deferred until all owned spaces are disposed",
      result.checks.terminalReentry.disposed === true &&
        result.checks.terminalReentry.workspaceDisposed === true &&
        result.checks.terminalReentry.listenerRan === true &&
        result.checks.terminalReentry.draftCreated === false &&
        result.checks.terminalReentry.firstDisposed === true &&
        result.checks.terminalReentry.secondDisposed === true &&
        result.checks.terminalReentry.firstCommittedTitle === "Scores" &&
        result.checks.terminalReentry.secondCommittedTitle === "Scores",
    );
    terminalUnsubscribe();
    terminalRuntime.dispose();

    async function cleanLeaseDispose(decision) {
      const runtime = createRuntime({
        datasetProvider: provider,
        validationCatalog: createBoardValidationCatalog([fixtureData.descriptor]),
      });
      const target = document.createElement("div");
      document.body.append(target);
      const workspace = must(
        mountBoardWorkspace(target, { runtime, document: fixtureData.document }),
      );
      await wait(120);
      const space = workspace.entries[0].space;
      const lease = must(space.acquireEditorLease({ sessionId: `clean-${decision ?? "none"}` }));
      must(space.createView({ mode: "editor", lease }));
      const disposal =
        decision === undefined
          ? workspace.dispose()
          : workspace.dispose({ draftDecision: decision });
      const checks = {
        decision: decision ?? "none",
        disposed: disposal.ok,
        code: disposal.ok ? null : (disposal.diagnostics[0]?.code ?? null),
        workspaceDisposed: workspace.disposed,
        spaceDisposed: space.disposed,
      };
      if (!space.disposed) {
        space.dispose();
      }
      runtime.dispose();
      return checks;
    }

    const cleanNone = await cleanLeaseDispose(undefined);
    const cleanApply = await cleanLeaseDispose("apply");
    const cleanCancel = await cleanLeaseDispose("cancel");
    result.checks.cleanLeaseDispose = { none: cleanNone, apply: cleanApply, cancel: cleanCancel };
    check(
      "workspace disposal releases a clean editor lease without a draft decision",
      cleanNone.disposed === true &&
        cleanApply.disposed === true &&
        cleanCancel.disposed === true &&
        cleanNone.workspaceDisposed === true &&
        cleanApply.workspaceDisposed === true &&
        cleanCancel.workspaceDisposed === true &&
        cleanNone.spaceDisposed === true &&
        cleanApply.spaceDisposed === true &&
        cleanCancel.spaceDisposed === true,
    );

    const hostDisposedRuntime = createRuntime({
      datasetProvider: provider,
      validationCatalog: createBoardValidationCatalog([fixtureData.descriptor]),
    });
    const hostDisposedSpace = must(
      hostDisposedRuntime.createSpace({ document: fixtureData.document }),
    );
    const hostDisposedTarget = document.createElement("div");
    document.body.append(hostDisposedTarget);
    const hostDisposedWorkspace = must(
      mountBoardWorkspace(hostDisposedTarget, { space: hostDisposedSpace }),
    );
    await wait(120);
    must(hostDisposedSpace.dispose());
    await wait(120);
    const hostDisposedResult = hostDisposedWorkspace.dispose();
    result.checks.hostDisposedSpace = {
      disposed: hostDisposedResult.ok,
      code: hostDisposedResult.ok ? null : (hostDisposedResult.diagnostics[0]?.code ?? null),
      workspaceDisposed: hostDisposedWorkspace.disposed,
      entries: hostDisposedWorkspace.entries.length,
      rootRemoved: hostDisposedTarget.children.length === 0,
    };
    check(
      "workspace disposal drops a host-disposed external space",
      result.checks.hostDisposedSpace.disposed === true &&
        result.checks.hostDisposedSpace.workspaceDisposed === true &&
        result.checks.hostDisposedSpace.entries === 0 &&
        result.checks.hostDisposedSpace.rootRemoved === true,
    );
    hostDisposedRuntime.dispose();

    const lateImportRuntime = createRuntime({
      datasetProvider: provider,
      validationCatalog: createBoardValidationCatalog([fixtureData.descriptor]),
    });
    const lateImportTarget = document.createElement("div");
    document.body.append(lateImportTarget);
    const lateImportWorkspace = must(
      mountBoardWorkspace(lateImportTarget, {
        runtime: lateImportRuntime,
        document: fixtureData.document,
      }),
    );
    await wait(120);
    const lateImportEntry = lateImportWorkspace.entries[0];
    const lateImportElement = lateImportEntry.host.element;
    lateImportElement.querySelector('[data-mode="editor"]').click();
    await wait(120);
    const lateImportInput = lateImportElement.querySelector('[data-editor-import-input="true"]');
    const latePayload = must(lateImportEntry.space.exportDocument()).canonical;
    let resolveLateRead = null;
    const lateRead = new Promise((resolve) => {
      resolveLateRead = resolve;
    });
    const lateFile = { name: "late-board.json", text: () => lateRead };
    Object.defineProperty(lateImportInput, "files", {
      value: [lateFile],
      configurable: true,
    });
    lateImportInput.dispatchEvent(new Event("change", { bubbles: true }));
    await wait(30);
    const entriesBeforeLate = lateImportWorkspace.entries.length;
    lateImportEntry.host.unmount();
    resolveLateRead(latePayload);
    await wait(120);
    result.checks.lateImport = {
      entriesBefore: entriesBeforeLate,
      entriesAfter: lateImportWorkspace.entries.length,
      activeUnchanged: lateImportWorkspace.activeSpace.id === lateImportEntry.space.id,
    };
    check(
      "late import continuation does not activate after unmount",
      result.checks.lateImport.entriesAfter === entriesBeforeLate &&
        result.checks.lateImport.activeUnchanged === true,
    );
    lateImportWorkspace.dispose({ draftDecision: "cancel" });
    lateImportRuntime.dispose();

    const hostErrorRuntime = createRuntime({
      datasetProvider: provider,
      validationCatalog: createBoardValidationCatalog([fixtureData.descriptor]),
    });
    const hostErrorSpace = must(hostErrorRuntime.createSpace({ document: fixtureData.document }));
    const hostErrorTarget = document.createElement("div");
    document.body.append(hostErrorTarget);
    let hostErrorArmed = false;
    let hostErrorCalls = 0;
    const hostErrorWorkspace = must(
      mountBoardWorkspace(hostErrorTarget, {
        space: hostErrorSpace,
        onEvent: () => {
          if (hostErrorArmed) {
            hostErrorCalls += 1;
            throw new Error("host callback failure");
          }
        },
      }),
    );
    await wait(120);
    hostErrorArmed = true;
    must(hostErrorSpace.loadDocument({ ...fixtureData.document, title: "Host error event" }));
    await wait(80);
    result.checks.hostCallbackError = {
      calls: hostErrorCalls,
      message: hostErrorWorkspace.element.querySelector(":scope > .bl-live")?.textContent ?? "",
    };
    check(
      "host event callback failures are surfaced",
      result.checks.hostCallbackError.message === "A host event callback failed",
    );
    hostErrorWorkspace.dispose({ draftDecision: "cancel" });
    hostErrorRuntime.dispose();

    const partialRuntime = createRuntime({
      datasetProvider: provider,
      validationCatalog: createBoardValidationCatalog([fixtureData.descriptor]),
    });
    const partialTarget = document.createElement("div");
    document.body.append(partialTarget);
    const partialWorkspace = must(
      mountBoardWorkspace(partialTarget, {
        runtime: partialRuntime,
        document: fixtureData.document,
      }),
    );
    await wait(120);
    const partialSpace = partialWorkspace.entries[0].space;
    const partialLease = must(partialSpace.acquireEditorLease({ sessionId: "partial-failure" }));
    const partialView = must(partialSpace.createView({ mode: "editor", lease: partialLease }));
    must(partialView.commands.updateBlock("chart", { title: "Partial dirty" }));
    const partialEntry = partialWorkspace.entries[0];
    const originalDispose = partialEntry.host.dispose;
    partialEntry.host.dispose = () => ({
      ok: false,
      diagnostics: [
        {
          code: "VIEW_DISPOSED",
          path: "host",
          message: "forced disposal failure",
          severity: "error",
        },
      ],
    });
    const partialResult = partialWorkspace.dispose({ draftDecision: "apply" });
    const partialDiagnostic = partialResult.ok
      ? null
      : partialResult.diagnostics.find((diagnostic) => diagnostic.code === "DISPOSAL_PARTIAL");
    result.checks.partialDisposal = {
      failed: partialResult.ok === false,
      code: partialDiagnostic?.code ?? null,
      relatedIds: partialDiagnostic?.relatedIds ?? [],
      expectedId: partialSpace.id,
      workspaceDisposed: partialWorkspace.disposed,
    };
    check(
      "partial disposal reports the affected space ids",
      result.checks.partialDisposal.failed === true &&
        result.checks.partialDisposal.code === "DISPOSAL_PARTIAL" &&
        result.checks.partialDisposal.relatedIds.includes(partialSpace.id) &&
        result.checks.partialDisposal.workspaceDisposed === false,
    );
    partialEntry.host.dispose = originalDispose;
    const partialCleanup = partialWorkspace.dispose({ draftDecision: "cancel" });
    if (!partialCleanup.ok) {
      partialSpace.dispose();
    }
    partialRuntime.dispose();

    const dropRuntime = createRuntime({
      datasetProvider: provider,
      validationCatalog: createBoardValidationCatalog([fixtureData.descriptor]),
    });
    const dropExternalSpace = must(dropRuntime.createSpace({ document: fixtureData.document }));
    const dropTarget = document.createElement("div");
    document.body.append(dropTarget);
    const dropWorkspace = must(mountBoardWorkspace(dropTarget, { space: dropExternalSpace }));
    await wait(120);
    const dropImported = must(
      dropWorkspace.importDocument(must(dropExternalSpace.exportDocument()).canonical),
    );
    must(dropWorkspace.activateSpace(dropExternalSpace.id));
    await wait(60);
    must(dropExternalSpace.dispose());
    await wait(120);
    const dropSurvivorEntry = dropWorkspace.entries.find(
      (entry) => entry.space.id === dropImported.space.id,
    );
    const originalSurvivorDispose = dropSurvivorEntry.host.dispose;
    dropSurvivorEntry.host.dispose = () => ({
      ok: false,
      diagnostics: [
        {
          code: "VIEW_DISPOSED",
          path: "host",
          message: "forced survivor disposal failure",
          severity: "error",
        },
      ],
    });
    const dropResult = dropWorkspace.dispose();
    result.checks.droppedActiveEntry = {
      failed: dropResult.ok === false,
      active: dropWorkspace.activeSpace.id,
      survivor: dropImported.space.id,
      panelVisible: !dropSurvivorEntry.panel.hasAttribute("hidden"),
      tabSelected: dropSurvivorEntry.tab.getAttribute("aria-selected"),
      oldTabConnected: dropWorkspace.element.contains(
        dropWorkspace.entries.find((entry) => entry.space.id === dropExternalSpace.id)?.tab ??
          document.createElement("span"),
      ),
    };
    check(
      "dropping the active disposed entry activates the survivor",
      result.checks.droppedActiveEntry.failed === true &&
        result.checks.droppedActiveEntry.active === result.checks.droppedActiveEntry.survivor &&
        result.checks.droppedActiveEntry.panelVisible === true &&
        result.checks.droppedActiveEntry.tabSelected === "true" &&
        result.checks.droppedActiveEntry.oldTabConnected === false,
    );
    dropSurvivorEntry.host.dispose = originalSurvivorDispose;
    const dropCleanup = dropWorkspace.dispose();
    if (!dropCleanup.ok) {
      dropImported.space.dispose();
    }
    dropRuntime.dispose();

    const missingKeys = [];
    for (const node of document.querySelectorAll("[data-message-key]")) {
      const key = node.getAttribute("data-message-key");
      if (key && !node.hasAttribute("data-host-content")) {
        if (typeof ENGLISH_MESSAGES[key] !== "string") {
          missingKeys.push(key);
        }
      }
    }
    result.checks.missingKeys = [...new Set(missingKeys)];

    const conflictSpace = workspace.entries[1]?.space ?? null;
    if (conflictSpace !== null) {
      const conflictLease = must(
        conflictSpace.acquireEditorLease({ sessionId: "imported-conflict" }),
      );
      const conflictView = must(conflictSpace.createView({ mode: "editor", lease: conflictLease }));
      must(conflictView.commands.updateBlock("chart", { title: "Imported conflict draft" }));
      const newerImported = JSON.parse(
        JSON.stringify(conflictSpace.getSnapshot().committedDocument),
      );
      newerImported.title = "Newer imported board";
      must(conflictSpace.loadDocument(newerImported, { source: "host" }));
      const conflictDispose = workspace.dispose({ draftDecision: "apply" });
      result.checks.disposalValidation = {
        failed: conflictDispose.ok === false,
        code: conflictDispose.ok ? null : (conflictDispose.diagnostics[0]?.code ?? null),
        workspaceDisposed: workspace.disposed,
        entries: workspace.entries.length,
        importedDraftTitle: conflictSpace
          .getSnapshot()
          .draft?.document.blocks.find((block) => block.id === "chart")?.title,
        sourceDraftTitle: sourceSpace
          .getSnapshot()
          .draft?.document.blocks.find((block) => block.id === "note")?.title,
      };
      check(
        "rejected disposal leaves entries and drafts intact",
        result.checks.disposalValidation.failed === true &&
          result.checks.disposalValidation.code === "REVISION_CONFLICT" &&
          result.checks.disposalValidation.workspaceDisposed === false &&
          result.checks.disposalValidation.entries === 2 &&
          result.checks.disposalValidation.importedDraftTitle === "Imported conflict draft" &&
          result.checks.disposalValidation.sourceDraftTitle === "Source draft",
      );
      must(conflictSpace.releaseEditorLease(conflictLease, { decision: "cancel" }));
    }

    const importedSpace = workspace.entries[1]?.space ?? null;
    const failedDispose = workspace.dispose();
    result.checks.workspaceDispose = {
      firstFailed: failedDispose.ok === false,
      code: failedDispose.ok ? null : failedDispose.diagnostics[0]?.code,
      disposed: workspace.disposed,
      entries: workspace.entries.length,
      sourceDraft: sourceSpace
        .getSnapshot()
        .draft?.document.blocks.find((block) => block.id === "note")?.title,
    };
    check(
      "workspace disposal rejects a dirty draft without a decision",
      result.checks.workspaceDispose.firstFailed === true &&
        result.checks.workspaceDispose.code === "DRAFT_REQUIRES_DECISION" &&
        result.checks.workspaceDispose.disposed === false &&
        result.checks.workspaceDispose.entries === 2,
    );
    const finishedDispose = workspace.dispose({ draftDecision: "cancel" });
    result.checks.workspaceDispose = {
      ...result.checks.workspaceDispose,
      finished: finishedDispose.ok,
      finishedDisposed: workspace.disposed,
      sourceDisposed: sourceSpace.disposed,
      importedDisposed: importedSpace?.disposed ?? null,
    };
    check(
      "workspace disposal applies an explicit decision and disposes owned spaces",
      finishedDispose.ok === true &&
        workspace.disposed === true &&
        sourceSpace.disposed === true &&
        importedSpace?.disposed === true,
    );

    const externalRuntime = createRuntime({
      datasetProvider: provider,
      validationCatalog: createBoardValidationCatalog([fixtureData.descriptor]),
    });
    const externalSpace = must(externalRuntime.createSpace({ document: fixtureData.document }));
    const externalLease = must(externalSpace.acquireEditorLease({ sessionId: "external-sibling" }));
    const externalSiblingView = must(
      externalSpace.createView({ mode: "editor", lease: externalLease }),
    );
    must(externalSiblingView.commands.updateBlock("chart", { title: "Sibling dirty" }));
    const externalTarget = document.createElement("div");
    document.body.append(externalTarget);
    const externalWorkspace = must(mountBoardWorkspace(externalTarget, { space: externalSpace }));
    await wait(120);
    const externalExport = must(externalSpace.exportDocument());
    const externalImport = externalWorkspace.importDocument(externalExport.canonical);
    const externalImportedSpace = externalImport.ok ? externalImport.value.space : null;
    const externalExplicitImport = externalWorkspace.importDocument(externalExport.canonical, {
      sourceSpaceId: externalSpace.id,
    });
    const externalExplicitSpace = externalExplicitImport.ok
      ? externalExplicitImport.value.space
      : null;
    result.checks.externalImport = {
      ok: externalImport.ok,
      explicitOk: externalExplicitImport.ok,
      explicitCode: externalExplicitImport.ok
        ? null
        : (externalExplicitImport.diagnostics[0]?.code ?? null),
      entries: externalWorkspace.entries.length,
      activeIsNew: externalExplicitImport.ok
        ? externalWorkspace.activeSpace.id !== externalSpace.id
        : false,
      sourceAlive: externalSpace.disposed === false,
      sourceDraftTitle: externalSpace
        .getSnapshot()
        .draft?.document.blocks.find((block) => block.id === "chart")?.title,
    };
    check(
      "external source space import creates new boards",
      result.checks.externalImport.ok === true &&
        result.checks.externalImport.explicitOk === true &&
        result.checks.externalImport.entries === 3 &&
        result.checks.externalImport.activeIsNew === true &&
        result.checks.externalImport.sourceAlive === true,
    );
    const externalDispose = externalWorkspace.dispose({ draftDecision: "apply" });
    const externalAfter = externalSpace.getSnapshot();
    result.checks.externalImport = {
      ...result.checks.externalImport,
      disposed: externalDispose.ok,
      sourceStillAlive: externalSpace.disposed === false,
      importedDisposed: externalImportedSpace?.disposed ?? null,
      explicitDisposed: externalExplicitSpace?.disposed ?? null,
      committedTitle: externalAfter.committedDocument.blocks.find((block) => block.id === "chart")
        ?.title,
      leaseReleased: externalAfter.editorLease === null,
    };
    check(
      "workspace applies a sibling-held dirty lease and disposes only owned spaces",
      externalDispose.ok === true &&
        externalSpace.disposed === false &&
        externalImportedSpace?.disposed === true &&
        externalExplicitSpace?.disposed === true &&
        result.checks.externalImport.committedTitle === "Sibling dirty" &&
        result.checks.externalImport.leaseReleased === true,
    );
    externalRuntime.dispose();

    async function siblingDisposal(decision) {
      const runtime = createRuntime({
        datasetProvider: provider,
        validationCatalog: createBoardValidationCatalog([fixtureData.descriptor]),
      });
      const space = must(runtime.createSpace({ document: fixtureData.document }));
      const lease = must(space.acquireEditorLease({ sessionId: `sibling-${decision}` }));
      const sibling = must(space.createView({ mode: "editor", lease }));
      must(sibling.commands.updateBlock("chart", { title: `Sibling ${decision}` }));
      const target = document.createElement("div");
      document.body.append(target);
      const workspace = must(mountBoardWorkspace(target, { space }));
      await wait(120);
      const disposal = workspace.dispose({ draftDecision: decision });
      const snapshot = space.getSnapshot();
      const checks = {
        decision,
        disposed: disposal.ok,
        workspaceDisposed: workspace.disposed,
        sourceAlive: space.disposed === false,
        committedTitle: snapshot.committedDocument.blocks.find((block) => block.id === "chart")
          ?.title,
        draftTitle: snapshot.draft?.document.blocks.find((block) => block.id === "chart")?.title,
        draftDirty: snapshot.draft?.dirty ?? false,
        hasLease: snapshot.editorLease !== null,
        code: disposal.ok ? null : (disposal.diagnostics[0]?.code ?? null),
      };
      if (!space.disposed) {
        space.dispose();
      }
      runtime.dispose();
      return checks;
    }

    const cancelSibling = await siblingDisposal("cancel");
    const keepSibling = await siblingDisposal("keep");
    result.checks.siblingDisposal = { cancel: cancelSibling, keep: keepSibling };
    check(
      "workspace cancels a sibling-held dirty lease without changing committed content",
      cancelSibling.disposed === true &&
        cancelSibling.sourceAlive === true &&
        cancelSibling.committedTitle === "Scores" &&
        cancelSibling.draftDirty === false &&
        cancelSibling.hasLease === false,
    );
    check(
      "workspace keep decision preserves an external sibling draft and lease",
      keepSibling.disposed === true &&
        keepSibling.sourceAlive === true &&
        keepSibling.draftTitle === "Sibling keep" &&
        keepSibling.draftDirty === true &&
        keepSibling.hasLease === true,
    );

    runtime.dispose();
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

void run();
