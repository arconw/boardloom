import {
  BOARD_BLOCK_TYPES,
  BoardloomError,
  COMPARISON_DELTA_MODES,
  COMPARISON_DISPLAY_MODES,
  DIAGNOSTIC_CODES,
  THEME_MODES,
  canonicalJson,
  createDiagnostic,
  crossFilterTargetStatus,
  describeBindingSlots,
  fail,
  fieldCompatibilityReason,
  documentField,
  filterDefinitionOperators,
  filterOperatorsForField,
  ok,
  resolveRendererColors,
  selectChartBindings,
  type AggregationType,
  type BindingDefinition,
  type BindingSlot,
  type BindingSlotChange,
  type BindingSlotDescriptor,
  type BoardBreakpoint,
  type BoardDocument,
  type BoardDocumentV1,
  type BlockDefinition,
  type BoardSerialization,
  type BoardSpace,
  type BoardView,
  type BoardloomRuntime,
  type ComparisonDefinition,
  type ComparisonDeltaMode,
  type ComparisonDisplayMode,
  type ComparisonFieldMapping,
  type ComparisonInput,
  type Diagnostic,
  type EditorLease,
  type FieldDescriptor,
  type FieldReference,
  type FieldValueType,
  type FilterDefinition,
  type FilterOperator,
  type FilterRuntimeState,
  type FilterTarget,
  type FormatterProvider,
  type JsonObject,
  type JsonValue,
  type MessageDictionary,
  type MessageProvider,
  type QueryState,
  type RealtimeStatus,
  type RealtimeSubscriptionState,
  type RendererRegistry,
  type RendererTheme,
  type Result,
  type SpaceEvent,
  type SpaceSnapshot,
  type ThemeMode,
  type TimeWindow,
  type ViewMode,
  type ViewSnapshot,
} from "@boardloom/core";
import {
  blockQueryId,
  deriveBlockQuery,
  querySpecSignature,
  type DerivedBlockQuery,
} from "./block-query.js";
import {
  comparisonQueryIds,
  computeComparisonView,
  deriveComparisonQuery,
  type ComparisonQueryIds,
  type ComparisonViewState,
} from "./comparison-query.js";
import type {
  BlockSurface,
  BlockSurfaceEnvironment,
  BlockRegistry,
  BlockTypeDefinition,
} from "./block-registry.js";
import {
  clearElement,
  createElement,
  descendantsByClass,
  elementContains,
  setHostText,
  setKeyedLabel,
  setKeyedText,
} from "./dom.js";
import { releaseMountedView } from "./mount-registry.js";
import { activeFilterChipSummaries, crossFilterSummaries } from "./filter-summary.js";
import { createViewMessages, pluralKey, type ViewMessages } from "./messages.js";
import { realtimeText, type BoardloomRealtimeStatus } from "./realtime.js";
import { renderDiagnosticList, renderErrorState } from "./states.js";
import { themeTokenProperty } from "./theme-tokens.js";
import type { BoardViewHandle, FocusTarget, UpdateBoardViewOptions } from "./types.js";

let instanceSequence = 0;
let blockSequence = 0;

const QUERY_BLOCK_TYPES = new Set(["metric", "table", "chart"]);
const FILTER_CONTEXT_BLOCK_TYPES = new Set(["metric", "table", "chart", "filter"]);

function filterContextSignature(document: BoardDocumentV1, state: FilterRuntimeState): string {
  return canonicalJson({
    filters: document.filters,
    filterGroups: document.filterGroups ?? [],
    filterState: state,
    blocks: document.blocks.map((block) => ({
      id: block.id,
      title: block.title,
      groupId: block.groupId,
    })),
  } as never);
}

function blockContextSignature(
  block: BlockDefinition,
  document: BoardDocumentV1,
  state: FilterRuntimeState,
): string {
  if (block.type === "text") {
    return "";
  }
  if (FILTER_CONTEXT_BLOCK_TYPES.has(String(block.type))) {
    return filterContextSignature(document, state);
  }
  return canonicalJson(document as never);
}

interface MountedBlock {
  readonly id: string;
  type: string;
  readonly element: HTMLElement;
  readonly header: HTMLElement;
  readonly heading: HTMLElement;
  readonly body: HTMLElement;
  surface: BlockSurface;
  queryId: string | null;
  signature: string | null;
  queryError: readonly Diagnostic[] | null;
  queryPlan: DerivedBlockQuery | null;
  comparisonQueryIds: ComparisonQueryIds | null;
  comparisonSignature: string | null;
  comparisonState: ComparisonViewState | null;
  comparisonError: readonly Diagnostic[] | null;
  lastBlockSignature: string | null;
  lastQueryState: QueryState | null;
  lastQueryErrorSignature: string | null;
  lastPlanSignature: string | null;
  lastComparisonSignature: string | null;
  lastContextSignature: string | null;
  lastMessages: ViewMessages | null;
  lastLocale: string | null;
  lastTimezone: string | null;
}

interface BlockInteractionState {
  readonly tableScroll: ReadonlyArray<{ readonly top: number; readonly left: number }>;
  readonly focus:
    { readonly kind: "table"; readonly index: number } | { readonly kind: "summary" } | null;
}

interface ViewerConfig {
  theme?: ThemeMode;
  messages?: MessageDictionary;
  realtime?: import("./realtime.js").BoardloomRealtimeStatus;
  provenance?: string;
  onEvent?: (event: SpaceEvent) => void;
  onImportDocument?: (input: string, fileName: string) => Result<{ readonly spaceId: string }>;
  onExport?: (kind: "ui" | "host", serialization: BoardSerialization) => void;
}

type EditorConfirmation = "discard" | "release" | null;

function setHidden(element: Element, hidden: boolean): void {
  if (hidden) {
    element.setAttribute("hidden", "");
  } else {
    element.removeAttribute("hidden");
  }
}

function setDisabled(element: Element, disabled: boolean): void {
  if (disabled) {
    element.setAttribute("disabled", "");
  } else {
    element.removeAttribute("disabled");
  }
}

function editorLibraryGroup(type: string): string {
  if (type === "chart") {
    return "chart";
  }
  if (type === "metric") {
    return "metric";
  }
  if (type === "table") {
    return "table";
  }
  if (type === "text") {
    return "text";
  }
  if (type === "filter") {
    return "filter";
  }
  return "extensions";
}

function editorLibraryLabel(messages: ViewMessages, type: string): string {
  const key = `editor.library.${type}.name`;
  if (messages.has(key)) {
    return messages.text(key);
  }
  return type;
}

function editorLibraryIcon(type: string): string {
  if (type === "chart") {
    return "▥";
  }
  if (type === "metric") {
    return "◎";
  }
  if (type === "table") {
    return "▤";
  }
  if (type === "text") {
    return "¶";
  }
  if (type === "filter") {
    return "⏷";
  }
  return "◇";
}

function allDescendants(root: Element): HTMLElement[] {
  const output: HTMLElement[] = [];
  const visit = (element: Element): void => {
    for (const child of element.children) {
      output.push(child as HTMLElement);
      visit(child);
    }
  };
  visit(root);
  return output;
}

interface InspectorFocusState {
  readonly tagName: string;
  readonly attributes: readonly (readonly [string, string])[];
  readonly filterId: string | null;
  readonly comparisonId: string | null;
  readonly hasValue: boolean;
  readonly value: string;
  readonly selectionStart: number | null;
  readonly selectionEnd: number | null;
}

function closestAttribute(start: EventTarget | null, attribute: string): HTMLElement | null {
  let current = start as
    | (EventTarget & {
        getAttribute?: (name: string) => string | null;
        parentNode?: unknown;
        disabled?: boolean;
      })
    | null;
  while (current !== null && typeof current.getAttribute === "function") {
    if (current.getAttribute(attribute) !== null) {
      return current as unknown as HTMLElement;
    }
    current = (current.parentNode ?? null) as typeof current;
  }
  return null;
}

function closestBlockId(start: EventTarget | null): string | null {
  return closestAttribute(start, "data-block-id")?.getAttribute("data-block-id") ?? null;
}

export function failureFrom(error: unknown, path: string): readonly Diagnostic[] {
  if (error instanceof BoardloomError) {
    return Object.freeze([error.diagnostic]);
  }
  return Object.freeze([
    createDiagnostic(DIAGNOSTIC_CODES.INVALID_ARGUMENT, path, {
      message: error instanceof Error ? error.message : String(error),
    }),
  ]);
}

export let filterSequence = 0;
let comparisonSequence = 0;

function filterOperatorLabelKey(operator: FilterOperator): string {
  return `filter.operator.${operator}`;
}

function filterDefaultFor(
  type: FieldValueType,
  operator: FilterOperator,
  field: { readonly timezone?: string } | undefined,
): {
  readonly defaultValue?: unknown;
  readonly temporal?: { readonly timezone: string; readonly bounds: "inclusive" };
} {
  if (
    operator === "isNull" ||
    operator === "isNotNull" ||
    operator === "isTrue" ||
    operator === "isFalse"
  ) {
    return {};
  }
  if (operator === "between") {
    if (type === "date") {
      return {
        defaultValue: ["2026-01-01", "2026-12-31"],
        temporal: { timezone: field?.timezone ?? "UTC", bounds: "inclusive" as const },
      };
    }
    if (type === "datetime") {
      return {
        defaultValue: ["2026-01-01T00:00:00Z", "2026-01-01T23:59:59Z"],
        temporal: { timezone: field?.timezone ?? "UTC", bounds: "inclusive" as const },
      };
    }
    return { defaultValue: type === "number" ? [0, 0] : ["", ""] };
  }
  if (operator === "in" || operator === "notIn") {
    return { defaultValue: [] };
  }
  if (type === "number") {
    return { defaultValue: 0 };
  }
  if (type === "boolean") {
    return { defaultValue: true };
  }
  if (type === "date") {
    return {
      defaultValue: "2026-01-01",
      temporal: { timezone: field?.timezone ?? "UTC", bounds: "inclusive" },
    };
  }
  if (type === "datetime") {
    return {
      defaultValue: "2026-01-01T00:00:00Z",
      ...(operator === "before" ||
      operator === "after" ||
      operator === "onOrBefore" ||
      operator === "onOrAfter"
        ? { temporal: { timezone: field?.timezone ?? "UTC", bounds: "inclusive" as const } }
        : {}),
    };
  }
  return { defaultValue: "" };
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): T {
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    if (value[key] !== undefined) {
      output[key] = value[key];
    }
  }
  return output as T;
}

function filterInputText(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry)).join(", ");
  }
  return String(value);
}

function parseFilterInput(text: string, type: FieldValueType, operator: FilterOperator): unknown {
  const scalar = (entry: string): unknown => {
    if (type === "number") {
      return Number(entry);
    }
    if (type === "boolean") {
      return entry === "true";
    }
    return entry;
  };
  if (operator === "between" || operator === "in" || operator === "notIn") {
    return text
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry, index) => entry !== "" || operator === "between" || index === 0)
      .map(scalar);
  }
  return scalar(text);
}

export function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === "string" && (THEME_MODES as readonly string[]).includes(value);
}

function parseBindingFieldValue(value: string): FieldReference | null {
  if (value === "") {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === "string" &&
      typeof parsed[1] === "string"
    ) {
      return Object.freeze({ datasetId: parsed[0], fieldId: parsed[1] });
    }
  } catch {
    return null;
  }
  return null;
}

function bindingFieldValue(field: FieldReference | null): string {
  return field === null ? "" : JSON.stringify([field.datasetId, field.fieldId]);
}

function bindingSlotLabelKey(blockType: string, slot: BindingSlot): string {
  if (slot === "x") {
    return "chart.axis.x";
  }
  if (slot === "y") {
    return blockType === "metric" ? "editor.properties.measure" : "chart.axis.y";
  }
  if (slot === "series") {
    return "chart.series";
  }
  return "editor.properties.groupBy";
}

function aggregationMessageKey(type: string): string {
  return `aggregation.${type}`;
}

function documentTheme(document: BoardDocumentV1): ThemeMode {
  const theme = document.theme;
  return theme && isThemeMode(theme.mode) ? theme.mode : "system";
}

function breakpointFor(width: number): "desktop" | "tablet" | "narrow" {
  if (width >= 1280) {
    return "desktop";
  }
  if (width >= 768) {
    return "tablet";
  }
  return "narrow";
}

function resolveLayout(
  document: BoardDocumentV1,
  breakpoint: "desktop" | "tablet" | "narrow",
): BoardDocumentV1["layout"]["desktop"] {
  if (breakpoint === "narrow") {
    return document.layout.narrow ?? document.layout.tablet ?? document.layout.desktop;
  }
  if (breakpoint === "tablet") {
    return document.layout.tablet ?? document.layout.desktop;
  }
  return document.layout.desktop;
}

function dedupeDiagnostics(diagnostics: readonly Diagnostic[]): readonly Diagnostic[] {
  const seen = new Set<string>();
  const output: Diagnostic[] = [];
  for (const diagnostic of diagnostics) {
    const key = [diagnostic.code, diagnostic.path, diagnostic.message, diagnostic.severity].join(
      "\u0000",
    );
    if (!seen.has(key)) {
      seen.add(key);
      output.push(diagnostic);
    }
  }
  return Object.freeze(output);
}

function formatTimestamp(
  formatters: FormatterProvider,
  timestamp: number,
  timezone: string,
): string {
  try {
    return formatters.formatDate(timestamp, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: timezone,
    });
  } catch {
    return String(timestamp);
  }
}

function createUnknownSurface(doc: Document, message: string): BlockSurface {
  const element = doc.createElement("div");
  return {
    element,
    update(environment: BlockSurfaceEnvironment): void {
      clearElement(element);
      renderErrorState(element, environment.messages, [
        createDiagnostic(DIAGNOSTIC_CODES.UNKNOWN_BLOCK_TYPE, "block/type", {
          message,
        }),
      ]);
    },
  };
}

function createSurfaceFailureSurface(
  doc: Document,
  message: string,
  diagnostics?: readonly Diagnostic[],
): BlockSurface {
  const element = doc.createElement("div");
  return {
    element,
    update(environment: BlockSurfaceEnvironment): void {
      clearElement(element);
      renderErrorState(
        element,
        environment.messages,
        diagnostics ?? [
          createDiagnostic(DIAGNOSTIC_CODES.BLOCK_SURFACE_FAILED, "block/surface", { message }),
        ],
      );
    },
  };
}

export class ViewerHost implements BoardViewHandle {
  private readonly target: HTMLElement;
  private readonly doc: Document;
  private readonly spaceValue: BoardSpace;
  private readonly viewValue: BoardView;
  private readonly runtimeValue: BoardloomRuntime | null;
  private readonly ownsRuntime: boolean;
  private readonly ownsSpace: boolean;
  private readonly ownsView: boolean;
  private readonly registry: BlockRegistry;
  private readonly rendererRegistry: RendererRegistry<HTMLElement>;
  private readonly config: ViewerConfig;
  private readonly root: HTMLElement;
  private readonly skipLink: HTMLAnchorElement;
  private readonly header: HTMLElement;
  private readonly hostLabel: HTMLElement;
  private readonly title: HTMLElement;
  private readonly description: HTMLElement;
  private readonly metaUpdated: HTMLElement;
  private readonly metaTimezone: HTMLElement;
  private readonly modeNavigation: HTMLElement;
  private readonly viewerModeButton: HTMLButtonElement;
  private readonly editorModeButton: HTMLButtonElement;
  private readonly statusbar: HTMLElement;
  private readonly status: HTMLElement;
  private readonly lastUpdate: HTMLElement;
  private readonly realtimeBuffered: HTMLElement;
  private readonly realtimeSimulated: HTMLElement;
  private readonly realtimeControls: HTMLElement;
  private readonly realtimePause: HTMLButtonElement;
  private readonly realtimeResync: HTMLButtonElement;
  private readonly diagnosticsDetails: HTMLDetailsElement;
  private readonly diagnosticsSummary: HTMLElement;
  private readonly diagnosticsPanel: HTMLElement;
  private readonly filterSection: HTMLElement;
  private readonly filterHeading: HTMLElement;
  private readonly filterChips: HTMLElement;
  private readonly inspector: HTMLElement;
  private readonly inspectorHeading: HTMLElement;
  private readonly inspectorBody: HTMLElement;
  private readonly body: HTMLElement;
  private readonly grid: HTMLElement;
  private readonly liveRegion: HTMLElement;
  private readonly editorLayout: HTMLElement;
  private readonly library: HTMLElement;
  private readonly libraryHeading: HTMLElement;
  private readonly librarySearch: HTMLInputElement;
  private readonly libraryList: HTMLElement;
  private readonly canvas: HTMLElement;
  private readonly canvasHeading: HTMLElement;
  private readonly canvasTools: HTMLElement;
  private readonly importButton: HTMLButtonElement;
  private readonly importInput: HTMLInputElement;
  private readonly exportButton: HTMLButtonElement;
  private readonly libraryToggle: HTMLButtonElement;
  private readonly inspectorToggle: HTMLButtonElement;
  private readonly drawerScrim: HTMLElement;
  private readonly draftBar: HTMLElement;
  private readonly draftStatus: HTMLElement;
  private readonly draftDetail: HTMLElement;
  private readonly undoButton: HTMLButtonElement;
  private readonly redoButton: HTMLButtonElement;
  private readonly applyButton: HTMLButtonElement;
  private readonly discardButton: HTMLButtonElement;
  private readonly previewButton: HTMLButtonElement;
  private readonly releaseButton: HTMLButtonElement;
  private readonly editorNotice: HTMLElement;
  private readonly confirmation: HTMLElement;
  private readonly confirmationText: HTMLElement;
  private readonly confirmationCancel: HTMLButtonElement;
  private readonly confirmationApply: HTMLButtonElement;
  private selectedBlockId: string | null = null;
  private selectedBreakpoint: BoardBreakpoint = "desktop";
  private themeModeSelect: HTMLSelectElement | null = null;
  private readonly themeTokenInputs = new Map<string, HTMLInputElement>();
  private themeTokenNameInput: HTMLInputElement | null = null;
  private themeTokenValueInput: HTMLInputElement | null = null;
  private readonly pendingRemovedThemeTokens = new Set<string>();
  private readonly inspectorDraftFooter: HTMLElement;
  private readonly sheetDraftStatus: HTMLElement;
  private readonly sheetApplyButton: HTMLButtonElement;
  private readonly sheetDiscardButton: HTMLButtonElement;
  private pendingConfirmation: EditorConfirmation = null;
  private libraryOpen = false;
  private inspectorOpen = false;
  private drawerTrigger: HTMLElement | null = null;
  private pendingActionFocus: {
    readonly action: string;
    readonly target: string;
    readonly breakpoint: string;
  } | null = null;
  private exportNoticeKey: string | null = null;
  private readonly blockElements = new Map<string, MountedBlock>();
  private appliedThemeTokens = new Set<string>();
  private messagesValue: ViewMessages;
  private messagesLocale: string;
  private messageProvider: MessageProvider;
  private messageOverrides: MessageDictionary | undefined;
  private actionDiagnostics: readonly Diagnostic[] = Object.freeze([]);
  private readonly pendingFilters = new Map<string, FilterDefinition>();
  private unsubscribeSpace: (() => void) | null;
  private resizeObserver: ResizeObserver | null = null;
  private mountedFlag = true;
  private disposedFlag = false;
  private renderScheduled = false;
  private unmounting = false;
  private readonly onClick = (event: Event): void => {
    if (this.disposedFlag || !this.mountedFlag) {
      return;
    }
    if (event.target === this.viewerModeButton) {
      this.setMode("viewer");
      return;
    }
    if (event.target === this.editorModeButton) {
      this.requestEditorMode();
      return;
    }
    const addType = closestAttribute(event.target, "data-editor-add")?.getAttribute(
      "data-editor-add",
    );
    if (addType !== null && addType !== undefined) {
      this.addEditorBlock(addType);
      return;
    }
    const draftAction = closestAttribute(event.target, "data-draft-action")?.getAttribute(
      "data-draft-action",
    );
    if (draftAction !== null && draftAction !== undefined) {
      this.handleDraftAction(draftAction);
      return;
    }
    const confirmAction = closestAttribute(event.target, "data-confirm-action")?.getAttribute(
      "data-confirm-action",
    );
    if (confirmAction !== null && confirmAction !== undefined) {
      this.handleConfirmation(confirmAction);
      return;
    }
    const drawer = closestAttribute(event.target, "data-editor-drawer")?.getAttribute(
      "data-editor-drawer",
    );
    if (drawer === "library" || drawer === "inspector") {
      this.setDrawer(drawer, !(drawer === "library" ? this.libraryOpen : this.inspectorOpen));
      return;
    }
    if (closestAttribute(event.target, "data-editor-scrim") !== null) {
      this.setDrawer(null, false);
      return;
    }
    if (closestAttribute(event.target, "data-editor-import") !== null) {
      this.importInput.click();
      return;
    }
    if (closestAttribute(event.target, "data-editor-export") !== null) {
      this.exportEditorDocument();
      return;
    }
    const removeToken = closestAttribute(event.target, "data-theme-remove-token")?.getAttribute(
      "data-theme-remove-token",
    );
    if (removeToken !== null && removeToken !== undefined) {
      this.pendingRemovedThemeTokens.add(removeToken);
      this.applyThemeEditor();
      return;
    }
    const themeAction = closestAttribute(event.target, "data-theme-action")?.getAttribute(
      "data-theme-action",
    );
    if (themeAction !== null && themeAction !== undefined) {
      this.applyThemeEditor();
      return;
    }
    const blockActionElement = closestAttribute(event.target, "data-block-action");
    const blockAction = blockActionElement?.getAttribute("data-block-action") ?? null;
    if (blockAction !== null && blockActionElement !== null) {
      const actionBlock =
        blockActionElement.getAttribute("data-block-target") ?? closestBlockId(blockActionElement);
      if (actionBlock !== null) {
        this.applyBlockAction(actionBlock, blockAction, blockActionElement);
      }
      return;
    }
    if (closestAttribute(event.target, "data-editor-reset") !== null) {
      const resetBlockId = this.selectedBlockId;
      if (resetBlockId !== null) {
        this.runViewCommand(() => this.viewValue.commands.resetBlock(resetBlockId));
      }
      return;
    }
    const selectedBlock = closestBlockId(event.target);
    if (selectedBlock !== null && this.viewValue.mode === "editor") {
      this.selectEditorBlock(selectedBlock);
      return;
    }
    const target = event.target as
      | (EventTarget & {
          getAttribute?: (name: string) => string | null;
        })
      | null;
    if (target === null || typeof target.getAttribute !== "function") {
      return;
    }
    const resetId = target.getAttribute("data-filter-reset");
    if (resetId !== null) {
      const result = this.applyFilterOperation("reset", () => this.spaceValue.resetFilter(resetId));
      if (result.ok) {
        this.scheduleRender();
      }
      return;
    }
    if (target.getAttribute("data-filter-reset-all") === "true") {
      const result = this.applyFilterOperation("reset", () => this.spaceValue.resetAllFilters());
      if (result.ok) {
        this.scheduleRender();
      }
      return;
    }
    if (target.getAttribute("data-filter-reset-all-locked") === "true") {
      const result = this.applyFilterOperation("reset", () =>
        this.spaceValue.resetAllFilters({ allowLocked: true }),
      );
      if (result.ok) {
        this.scheduleRender();
      }
      return;
    }
    const resetScope = target.getAttribute("data-filter-reset-scope");
    if (resetScope === "board" || resetScope === "group" || resetScope === "block") {
      const scopeId = target.getAttribute("data-filter-scope-id") ?? "";
      const result = this.applyFilterOperation("reset", () =>
        this.spaceValue.resetFilterScope(resetScope, scopeId === "" ? undefined : scopeId, {
          allowLocked: true,
        }),
      );
      if (result.ok) {
        this.scheduleRender();
      }
      return;
    }
    const applyFilter = target.getAttribute("data-filter-apply");
    if (applyFilter !== null) {
      this.submitPendingFilter(applyFilter);
      return;
    }
    const discardFilter = target.getAttribute("data-filter-discard");
    if (discardFilter !== null) {
      this.pendingFilters.delete(discardFilter);
      this.resetManagerDiagnostics();
      this.scheduleRender();
      return;
    }
    if (target.getAttribute("data-filter-action") === "add") {
      this.addFilterDefinition();
      return;
    }
    if (target.getAttribute("data-comparison-action") === "add") {
      this.addComparisonDefinition();
      return;
    }
    const removeComparison = target.getAttribute("data-comparison-remove");
    if (removeComparison !== null) {
      this.removeComparisonDefinition(removeComparison);
      return;
    }
    const windowApply = target.getAttribute("data-comparison-window-apply");
    if (windowApply !== null) {
      const side = target.getAttribute("data-comparison-side");
      if (side === "primary" || side === "reference") {
        this.applyComparisonWindow(windowApply, side);
      }
      return;
    }
    const windowClear = target.getAttribute("data-comparison-window-clear");
    if (windowClear !== null) {
      const side = target.getAttribute("data-comparison-side");
      if (side === "primary" || side === "reference") {
        this.applyComparisonWindow(windowClear, side, true);
      }
      return;
    }
    if (target.getAttribute("data-cross-clear") === "true") {
      const result = this.applyFilterOperation("cross-filter", () =>
        this.spaceValue.clearCrossFilters(),
      );
      if (result.ok) {
        this.scheduleRender();
      }
    }
  };

  private readonly onKeyDown = (event: Event): void => {
    if (this.disposedFlag || !this.mountedFlag || this.viewValue.mode !== "editor") {
      return;
    }
    const keyboard = event as Event & {
      readonly key?: string;
      readonly shiftKey?: boolean;
      readonly ctrlKey?: boolean;
      readonly metaKey?: boolean;
      preventDefault?: () => void;
    };
    const target = event.target as
      | (EventTarget & {
          getAttribute?: (name: string) => string | null;
          tagName?: string;
        })
      | null;
    const tagName = (target?.tagName ?? "").toUpperCase();
    const formControl =
      tagName === "INPUT" ||
      tagName === "SELECT" ||
      tagName === "TEXTAREA" ||
      tagName === "BUTTON" ||
      tagName === "A";
    if ((keyboard.ctrlKey === true || keyboard.metaKey === true) && keyboard.key === "z") {
      this.handleDraftAction(keyboard.shiftKey === true ? "redo" : "undo");
      keyboard.preventDefault?.();
      return;
    }
    if ((keyboard.ctrlKey === true || keyboard.metaKey === true) && keyboard.key === "y") {
      this.handleDraftAction("redo");
      keyboard.preventDefault?.();
      return;
    }
    if (keyboard.key === "Escape") {
      if (this.libraryOpen || this.inspectorOpen || this.pendingConfirmation !== null) {
        this.pendingConfirmation = null;
        this.setDrawer(null, false);
        this.scheduleRender();
      } else {
        this.selectEditorBlock(null);
      }
      return;
    }
    if (
      keyboard.key === "Tab" &&
      this.root.getAttribute("data-boardloom-breakpoint") === "narrow" &&
      (this.libraryOpen || this.inspectorOpen)
    ) {
      const panel = this.inspectorOpen ? this.inspector : this.library;
      const focusable = [
        ...panel.querySelectorAll<HTMLElement>(
          "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])",
        ),
      ].filter((element) => {
        if (
          element.hasAttribute("hidden") ||
          element.hasAttribute("disabled") ||
          element.hasAttribute("inert")
        ) {
          return false;
        }
        if (element.closest("[hidden], [inert]") !== null) {
          return false;
        }
        return element.getClientRects().length > 0;
      });
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (first !== undefined && last !== undefined) {
        const outside = target === null || !elementContains(panel, target as Node | null);
        if (keyboard.shiftKey === true && (target === first || outside)) {
          last.focus();
          keyboard.preventDefault?.();
          return;
        }
        if (keyboard.shiftKey !== true && (target === last || outside)) {
          first.focus();
          keyboard.preventDefault?.();
          return;
        }
      }
    }
    if (formControl) {
      return;
    }
    const blockId = this.selectedBlockId;
    const focusedBlock = closestBlockId(target);
    if (
      focusedBlock !== null &&
      focusedBlock !== blockId &&
      (keyboard.key === "Enter" || keyboard.key === " " || keyboard.key === "Space")
    ) {
      this.selectEditorBlock(focusedBlock);
      keyboard.preventDefault?.();
      return;
    }
    if (blockId === null) {
      return;
    }
    if (keyboard.key === "Enter") {
      this.handleDraftAction("apply");
      keyboard.preventDefault?.();
      return;
    }
    if (keyboard.key === "Delete" || keyboard.key === "Backspace") {
      this.runViewCommand(() => this.viewValue.commands.deleteBlock(blockId));
      this.selectEditorBlock(null);
      keyboard.preventDefault?.();
      return;
    }
    const direction =
      keyboard.key === "ArrowUp"
        ? { dx: 0, dy: -1 }
        : keyboard.key === "ArrowDown"
          ? { dx: 0, dy: 1 }
          : keyboard.key === "ArrowLeft"
            ? { dx: -1, dy: 0 }
            : keyboard.key === "ArrowRight"
              ? { dx: 1, dy: 0 }
              : null;
    if (direction === null) {
      return;
    }
    keyboard.preventDefault?.();
    if (keyboard.shiftKey === true) {
      this.runViewCommand(() =>
        this.viewValue.commands.resizeBlock(blockId, {
          breakpoint: this.selectedBreakpoint,
          dw: direction.dx,
          dh: direction.dy,
        }),
      );
      return;
    }
    this.runViewCommand(() =>
      this.viewValue.commands.moveBlock(blockId, {
        breakpoint: this.selectedBreakpoint,
        ...direction,
      }),
    );
  };

  private readonly onInput = (event: Event): void => {
    if (this.disposedFlag || !this.mountedFlag) {
      return;
    }
    const target = event.target as
      (EventTarget & { getAttribute?: (name: string) => string | null }) | null;
    if (target === null || typeof target.getAttribute !== "function") {
      return;
    }
    if (target.getAttribute("data-editor-library-search") === "true") {
      this.scheduleRender();
    }
  };

  private readonly onChange = (event: Event): void => {
    if (!this.publicOperationLive() || this.viewValue.mode !== "editor") {
      return;
    }
    const target = event.target as
      | (EventTarget & {
          readonly value?: string;
          getAttribute?: (name: string) => string | null;
        })
      | null;
    if (target === null || typeof target.getAttribute !== "function") {
      return;
    }
    if (target.getAttribute("data-editor-import-input") === "true") {
      void this.importSelectedFile();
      return;
    }
    if (target.getAttribute("data-editor-title") === "true") {
      const blockId = this.selectedBlockId;
      const value = typeof target.value === "string" ? target.value : "";
      if (blockId !== null) {
        this.runViewCommand(() => this.viewValue.commands.updateBlock(blockId, { title: value }));
      }
      return;
    }
    if (target.getAttribute("data-editor-text") === "true") {
      const blockId =
        (target.getAttribute as (name: string) => string | null).call(
          target,
          "data-block-target",
        ) ?? this.selectedBlockId;
      const value = typeof target.value === "string" ? target.value : "";
      if (blockId !== null) {
        this.runViewCommand(() => this.viewValue.commands.updateBlock(blockId, { text: value }));
      }
      return;
    }
    if (target.getAttribute("data-editor-config") === "true") {
      const blockId =
        (target.getAttribute as (name: string) => string | null).call(
          target,
          "data-block-target",
        ) ?? this.selectedBlockId;
      const value = typeof target.value === "string" ? target.value : "";
      let parsed: unknown;
      try {
        parsed = JSON.parse(value);
      } catch {
        this.actionDiagnostics = [
          createDiagnostic(DIAGNOSTIC_CODES.INVALID_ARGUMENT, "config", {
            message: this.messagesValue.text("editor.properties.config.invalidJson"),
          }),
        ];
        this.announceDiagnostics(this.actionDiagnostics);
        this.renderNow();
        return;
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        this.actionDiagnostics = [
          createDiagnostic(DIAGNOSTIC_CODES.INVALID_ARGUMENT, "config", {
            message: this.messagesValue.text("editor.properties.config.invalidObject"),
          }),
        ];
        this.announceDiagnostics(this.actionDiagnostics);
        this.renderNow();
        return;
      }
      if (blockId !== null) {
        this.runViewCommand(() =>
          this.viewValue.commands.updateBlock(blockId, {
            config: parsed as JsonObject,
          }),
        );
      }
      return;
    }
    if (target.getAttribute("data-theme-control") !== null) {
      this.applyThemeEditor();
      return;
    }
    const comparisonControl = target.getAttribute("data-comparison-control");
    if (comparisonControl !== null) {
      this.applyComparisonManagerChange(
        comparisonControl,
        target as typeof target & { readonly checked?: boolean },
      );
      return;
    }
    const filterControl = target.getAttribute("data-filter-control");
    if (filterControl !== null) {
      let row:
        | (EventTarget & { getAttribute?: (name: string) => string | null; parentNode?: unknown })
        | null = target;
      while (
        row !== null &&
        typeof row.getAttribute === "function" &&
        row.getAttribute("data-filter-id") === null
      ) {
        row = (row.parentNode ?? null) as typeof row;
      }
      const filterId =
        row !== null && typeof row.getAttribute === "function"
          ? row.getAttribute("data-filter-id")
          : null;
      if (filterId !== null) {
        this.applyFilterManagerChange(filterId, filterControl, target);
      }
      return;
    }
    const blockId = target.getAttribute("data-binding-block");
    const slot = target.getAttribute("data-binding-slot");
    const control = target.getAttribute("data-binding-control");
    if (blockId === null || slot === null || control === null) {
      return;
    }
    const value = typeof target.value === "string" ? target.value : "";
    if (control === "field") {
      const field = parseBindingFieldValue(value);
      this.applyBindingSelection({
        blockId,
        slot: slot as BindingSlot,
        field,
      });
      return;
    }
    if (control === "aggregation") {
      const field = parseBindingFieldValue(target.getAttribute("data-binding-field") ?? "");
      this.applyBindingSelection({
        blockId,
        slot: slot as BindingSlot,
        field,
        aggregation: value as AggregationType,
      });
    }
  };

  constructor(
    target: HTMLElement,
    space: BoardSpace,
    view: BoardView,
    runtime: BoardloomRuntime | null,
    ownership: {
      readonly ownsRuntime: boolean;
      readonly ownsSpace: boolean;
      readonly ownsView: boolean;
    },
    registry: BlockRegistry,
    rendererRegistry: RendererRegistry<HTMLElement>,
    messages: ViewMessages,
    config: ViewerConfig,
  ) {
    this.target = target;
    this.doc = target.ownerDocument;
    this.spaceValue = space;
    this.viewValue = view;
    this.runtimeValue = runtime;
    this.ownsRuntime = ownership.ownsRuntime;
    this.ownsSpace = ownership.ownsSpace;
    this.ownsView = ownership.ownsView;
    this.registry = registry;
    this.rendererRegistry = rendererRegistry;
    this.messagesValue = messages;
    this.messagesLocale = messages.locale;
    this.messageProvider = space.getMessageProvider();
    this.messageOverrides = config.messages;
    this.config = config;
    this.unsubscribeSpace = null;

    const instanceId = `bl-instance-${++instanceSequence}`;
    const titleId = `${instanceId}-title`;
    const bodyId = `${instanceId}-body`;
    this.root = createElement(this.doc, "div", "boardloom bl-viewer");
    this.root.id = instanceId;
    this.root.setAttribute("data-boardloom-instance", instanceId);
    this.skipLink = createElement(this.doc, "a", "bl-skip-link");
    this.skipLink.setAttribute("href", `#${bodyId}`);
    this.header = createElement(this.doc, "header", "bl-header");
    this.header.setAttribute("role", "banner");
    const identity = createElement(this.doc, "div", "bl-identity");
    this.hostLabel = createElement(this.doc, "p", "bl-host");
    this.title = createElement(this.doc, "h1", "bl-title");
    this.title.id = titleId;
    this.title.setAttribute("tabindex", "-1");
    this.description = createElement(this.doc, "p", "bl-description");
    const meta = createElement(this.doc, "p", "bl-meta");
    this.metaUpdated = createElement(this.doc, "span", "bl-meta__item");
    this.metaTimezone = createElement(this.doc, "span", "bl-meta__item");
    meta.append(this.metaUpdated, this.metaTimezone);
    identity.append(this.hostLabel, this.title, this.description, meta);
    const toolbar = createElement(this.doc, "div", "bl-toolbar");
    this.modeNavigation = createElement(this.doc, "div", "bl-modes");
    this.modeNavigation.setAttribute("role", "group");
    setKeyedLabel(
      this.modeNavigation,
      "a11y.modeNavigation",
      this.messagesValue.text("a11y.modeNavigation"),
    );
    this.viewerModeButton = createElement(this.doc, "button", "bl-mode");
    this.viewerModeButton.setAttribute("type", "button");
    this.viewerModeButton.setAttribute("data-mode", "viewer");
    this.editorModeButton = createElement(this.doc, "button", "bl-mode");
    this.editorModeButton.setAttribute("type", "button");
    this.editorModeButton.setAttribute("data-mode", "editor");
    this.modeNavigation.append(this.viewerModeButton, this.editorModeButton);
    toolbar.append(this.modeNavigation);
    this.header.append(identity, toolbar);
    this.root.append(this.skipLink, this.header);

    this.statusbar = createElement(this.doc, "div", "bl-statusbar");
    this.status = createElement(this.doc, "span", "bl-status");
    this.status.setAttribute("role", "status");
    this.status.setAttribute("aria-live", "polite");
    this.lastUpdate = createElement(this.doc, "span", "bl-statusbar__meta");
    this.realtimeBuffered = createElement(this.doc, "span", "bl-statusbar__meta");
    this.realtimeSimulated = createElement(this.doc, "span", "bl-statusbar__simulated");
    this.realtimeControls = createElement(this.doc, "div", "bl-realtime-controls");
    this.realtimeControls.setAttribute("role", "group");
    this.realtimePause = createElement(this.doc, "button", "bl-realtime-control");
    this.realtimePause.setAttribute("type", "button");
    this.realtimePause.setAttribute("data-realtime-action", "pause");
    this.realtimeResync = createElement(this.doc, "button", "bl-realtime-control");
    this.realtimeResync.setAttribute("type", "button");
    this.realtimeResync.setAttribute("data-realtime-action", "resync");
    this.realtimeControls.append(this.realtimePause, this.realtimeResync);
    this.realtimePause.addEventListener("click", () => this.toggleRealtimePause());
    this.realtimeResync.addEventListener("click", () => this.requestRealtimeResync());
    this.diagnosticsDetails = createElement(this.doc, "details", "bl-diagnostics");
    this.diagnosticsSummary = createElement(this.doc, "summary", "bl-diagnostics__summary");
    this.diagnosticsPanel = createElement(this.doc, "div", "bl-diagnostics__panel");
    this.diagnosticsDetails.append(this.diagnosticsSummary, this.diagnosticsPanel);
    this.statusbar.append(
      this.status,
      this.lastUpdate,
      this.realtimeBuffered,
      this.realtimeSimulated,
      this.realtimeControls,
      this.diagnosticsDetails,
    );
    this.root.append(this.statusbar);

    this.filterSection = createElement(this.doc, "section", "bl-filters");
    this.filterSection.setAttribute("aria-label", this.messagesValue.text("a11y.filterRegion"));
    this.filterSection.setAttribute("data-message-key", "a11y.filterRegion");
    this.filterHeading = createElement(this.doc, "p", "bl-overline");
    setKeyedText(
      this.filterHeading,
      "viewer.filters.active",
      this.messagesValue.text("viewer.filters.active"),
    );
    this.filterChips = createElement(this.doc, "div", "bl-filter-chips");
    this.filterSection.append(this.filterHeading, this.filterChips);
    this.root.append(this.filterSection);

    this.libraryToggle = createElement(this.doc, "button", "bl-drawer-toggle");
    this.libraryToggle.setAttribute("type", "button");
    this.libraryToggle.setAttribute("data-editor-drawer", "library");
    this.libraryToggle.setAttribute("aria-controls", `${instanceId}-library`);
    this.libraryToggle.setAttribute("aria-expanded", "false");
    this.inspectorToggle = createElement(this.doc, "button", "bl-drawer-toggle");
    this.inspectorToggle.setAttribute("type", "button");
    this.inspectorToggle.setAttribute("data-editor-drawer", "inspector");
    this.inspectorToggle.setAttribute("aria-controls", `${instanceId}-inspector`);
    this.inspectorToggle.setAttribute("aria-expanded", "false");
    this.modeNavigation.append(this.libraryToggle, this.inspectorToggle);
    this.draftBar = createElement(this.doc, "div", "bl-draft-bar");
    this.draftBar.setAttribute("role", "region");
    this.draftBar.setAttribute("data-message-key", "draft.dirty");
    this.draftStatus = createElement(this.doc, "span", "bl-draft-status");
    this.draftDetail = createElement(this.doc, "span", "bl-draft-detail");
    const draftActions = createElement(this.doc, "div", "bl-draft-actions");
    this.undoButton = createElement(this.doc, "button", "bl-button bl-button--sm");
    this.undoButton.setAttribute("type", "button");
    this.undoButton.setAttribute("data-draft-action", "undo");
    this.redoButton = createElement(this.doc, "button", "bl-button bl-button--sm");
    this.redoButton.setAttribute("type", "button");
    this.redoButton.setAttribute("data-draft-action", "redo");
    this.applyButton = createElement(this.doc, "button", "bl-button bl-button--primary");
    this.applyButton.setAttribute("type", "button");
    this.applyButton.setAttribute("data-draft-action", "apply");
    this.discardButton = createElement(this.doc, "button", "bl-button bl-button--ghost");
    this.discardButton.setAttribute("type", "button");
    this.discardButton.setAttribute("data-draft-action", "discard");
    this.previewButton = createElement(this.doc, "button", "bl-button bl-button--sm");
    this.previewButton.setAttribute("type", "button");
    this.previewButton.setAttribute("data-draft-action", "preview");
    this.releaseButton = createElement(this.doc, "button", "bl-button bl-button--sm");
    this.releaseButton.setAttribute("type", "button");
    this.releaseButton.setAttribute("data-draft-action", "release");
    draftActions.append(
      this.undoButton,
      this.redoButton,
      this.previewButton,
      this.discardButton,
      this.applyButton,
      this.releaseButton,
    );
    this.editorNotice = createElement(this.doc, "p", "bl-editor-notice");
    this.editorNotice.setAttribute("role", "status");
    this.editorNotice.setAttribute("aria-live", "polite");
    this.editorNotice.setAttribute("hidden", "");
    this.confirmation = createElement(this.doc, "div", "bl-confirm");
    this.confirmation.setAttribute("role", "alertdialog");
    this.confirmation.setAttribute("aria-modal", "true");
    this.confirmation.setAttribute("hidden", "");
    this.confirmationText = createElement(this.doc, "p", "bl-confirm__text");
    this.confirmationCancel = createElement(this.doc, "button", "bl-button bl-button--ghost");
    this.confirmationCancel.setAttribute("type", "button");
    this.confirmationCancel.setAttribute("data-confirm-action", "cancel");
    this.confirmationApply = createElement(this.doc, "button", "bl-button bl-button--danger");
    this.confirmationApply.setAttribute("type", "button");
    this.confirmationApply.setAttribute("data-confirm-action", "confirm");
    this.confirmation.append(
      this.confirmationText,
      this.confirmationCancel,
      this.confirmationApply,
    );
    this.draftBar.append(
      this.draftStatus,
      this.draftDetail,
      draftActions,
      this.editorNotice,
      this.confirmation,
    );
    this.root.insertBefore(this.draftBar, this.statusbar);

    this.library = createElement(this.doc, "aside", "bl-library");
    this.library.id = `${instanceId}-library`;
    this.library.setAttribute("role", "region");
    this.library.setAttribute("aria-labelledby", `${instanceId}-library-title`);
    this.libraryHeading = createElement(this.doc, "h2", "bl-library__title");
    this.libraryHeading.id = `${instanceId}-library-title`;
    setKeyedText(this.libraryHeading, "editor.library", this.messagesValue.text("editor.library"));
    const librarySearchField = createElement(this.doc, "div", "bl-library__search");
    const searchLabel = createElement(this.doc, "label", "bl-visually-hidden");
    searchLabel.setAttribute("for", `${instanceId}-library-search`);
    setKeyedText(
      searchLabel,
      "editor.library.search",
      this.messagesValue.text("editor.library.search"),
    );
    this.librarySearch = createElement(this.doc, "input", "bl-input");
    this.librarySearch.type = "search";
    this.librarySearch.id = `${instanceId}-library-search`;
    this.librarySearch.setAttribute("data-editor-library-search", "true");
    this.librarySearch.setAttribute(
      "placeholder",
      this.messagesValue.text("editor.library.search"),
    );
    this.librarySearch.setAttribute("aria-label", this.messagesValue.text("editor.library.search"));
    this.librarySearch.setAttribute("data-message-key", "editor.library.search");
    librarySearchField.append(searchLabel, this.librarySearch);
    this.libraryList = createElement(this.doc, "div", "bl-library__list");
    this.library.append(this.libraryHeading, librarySearchField, this.libraryList);

    this.canvas = createElement(this.doc, "section", "bl-canvas");
    this.canvas.setAttribute("aria-labelledby", `${instanceId}-canvas-title`);
    const canvasHead = createElement(this.doc, "div", "bl-canvas__head");
    const canvasIdentity = createElement(this.doc, "div", "bl-canvas__identity");
    this.canvasHeading = createElement(this.doc, "h2", "bl-canvas__title");
    this.canvasHeading.id = `${instanceId}-canvas-title`;
    setKeyedText(this.canvasHeading, "editor.canvas", this.messagesValue.text("editor.canvas"));
    canvasIdentity.append(this.canvasHeading);
    this.canvasTools = createElement(this.doc, "div", "bl-canvas__tools");
    this.canvasTools.setAttribute("role", "group");
    setKeyedLabel(this.canvasTools, "editor.panels", this.messagesValue.text("editor.panels"));
    this.importButton = createElement(this.doc, "button", "bl-button bl-button--sm");
    this.importButton.setAttribute("type", "button");
    this.importButton.setAttribute("data-editor-import", "true");
    this.importButton.setAttribute("hidden", "");
    this.importInput = createElement(this.doc, "input", "bl-visually-hidden");
    this.importInput.type = "file";
    this.importInput.accept = "application/json,.json";
    this.importInput.setAttribute("data-editor-import-input", "true");
    this.importInput.setAttribute("hidden", "");
    this.exportButton = createElement(this.doc, "button", "bl-button bl-button--sm");
    this.exportButton.setAttribute("type", "button");
    this.exportButton.setAttribute("data-editor-export", "true");
    this.canvasTools.append(this.importButton, this.importInput, this.exportButton);
    canvasHead.append(canvasIdentity, this.canvasTools);
    this.canvas.append(canvasHead);

    this.inspector = createElement(this.doc, "aside", "bl-inspector");
    this.inspector.id = `${instanceId}-inspector`;
    this.inspector.setAttribute("role", "region");
    this.inspector.setAttribute("aria-labelledby", `${instanceId}-inspector-title`);
    this.inspector.setAttribute("data-message-key", "a11y.inspectorRegion");
    this.inspectorHeading = createElement(this.doc, "h2", "bl-inspector__title");
    this.inspectorHeading.id = `${instanceId}-inspector-title`;
    setKeyedText(
      this.inspectorHeading,
      "editor.inspector",
      this.messagesValue.text("editor.inspector"),
    );
    this.inspectorBody = createElement(this.doc, "div", "bl-inspector__body");
    this.inspectorDraftFooter = createElement(this.doc, "div", "bl-inspector__draft");
    this.sheetDraftStatus = createElement(this.doc, "p", "bl-inspector__draft-status");
    const sheetActions = createElement(this.doc, "div", "bl-inspector__draft-actions");
    this.sheetDiscardButton = createElement(this.doc, "button", "bl-button bl-button--ghost");
    this.sheetDiscardButton.setAttribute("type", "button");
    this.sheetDiscardButton.setAttribute("data-draft-action", "discard");
    this.sheetApplyButton = createElement(this.doc, "button", "bl-button bl-button--primary");
    this.sheetApplyButton.setAttribute("type", "button");
    this.sheetApplyButton.setAttribute("data-draft-action", "apply");
    sheetActions.append(this.sheetDiscardButton, this.sheetApplyButton);
    this.inspectorDraftFooter.append(this.sheetDraftStatus, sheetActions);
    setHidden(this.inspectorDraftFooter, true);
    this.inspector.append(this.inspectorHeading, this.inspectorBody, this.inspectorDraftFooter);

    this.body = createElement(this.doc, "div", "bl-body");
    this.body.id = bodyId;
    this.body.setAttribute("role", "region");
    this.body.setAttribute("tabindex", "-1");
    this.body.setAttribute("aria-label", this.messagesValue.text("a11y.boardRegion"));
    this.body.setAttribute("data-message-key", "a11y.boardRegion");
    this.grid = createElement(this.doc, "div", "bl-board-grid");
    this.body.append(this.grid);
    this.canvas.append(this.body);

    this.drawerScrim = createElement(this.doc, "div", "bl-drawer-scrim");
    this.drawerScrim.setAttribute("hidden", "");
    this.drawerScrim.setAttribute("data-editor-scrim", "true");
    this.editorLayout = createElement(this.doc, "div", "bl-editor-layout");
    this.editorLayout.append(this.library, this.canvas, this.inspector);
    this.root.append(this.editorLayout, this.drawerScrim);

    this.liveRegion = createElement(this.doc, "div", "bl-live");
    this.liveRegion.setAttribute("role", "status");
    this.liveRegion.setAttribute("aria-live", "polite");
    this.liveRegion.setAttribute("aria-atomic", "true");
    setKeyedLabel(this.liveRegion, "a11y.liveRegion", this.messagesValue.text("a11y.liveRegion"));
    this.root.append(this.liveRegion);

    try {
      this.root.addEventListener("click", this.onClick);
      this.root.addEventListener("change", this.onChange);
      this.root.addEventListener("input", this.onInput);
      this.root.addEventListener("keydown", this.onKeyDown);
      this.target.append(this.root);
      this.unsubscribeSpace = space.subscribe((event) => this.handleEvent(event));
      const viewWindow = this.doc.defaultView as
        (Window & { readonly ResizeObserver?: typeof ResizeObserver }) | null;
      const ResizeObserverConstructor = viewWindow?.ResizeObserver;
      if (typeof ResizeObserverConstructor === "function") {
        this.resizeObserver = new ResizeObserverConstructor(() => this.scheduleRender());
        this.resizeObserver.observe(this.target);
      }
      this.renderNow();
      if (!this.ensureLive()) {
        throw new BoardloomError(
          createDiagnostic(
            this.spaceValue.disposed
              ? DIAGNOSTIC_CODES.SPACE_DISPOSED
              : DIAGNOSTIC_CODES.VIEW_DISPOSED,
            "view",
          ),
        );
      }
    } catch (error) {
      this.teardown(false);
      throw error;
    }
  }

  get space(): BoardSpace {
    return this.spaceValue;
  }

  get view(): BoardView {
    return this.viewValue;
  }

  get element(): HTMLElement {
    return this.root;
  }

  get mounted(): boolean {
    return this.mountedFlag;
  }

  get disposed(): boolean {
    return this.disposedFlag;
  }

  update(options: UpdateBoardViewOptions = {}): Result<void> {
    if (!this.publicOperationLive()) {
      return fail([createDiagnostic(DIAGNOSTIC_CODES.VIEW_DISPOSED, "view")]);
    }
    if (options.theme !== undefined && !isThemeMode(options.theme)) {
      return fail([
        createDiagnostic(DIAGNOSTIC_CODES.INVALID_ARGUMENT, "theme", {
          message: "A theme must be light, dark or system.",
        }),
      ]);
    }
    if (options.messages !== undefined) {
      try {
        createViewMessages({
          provider: this.spaceValue.getMessageProvider(),
          overrides: options.messages,
        });
      } catch (error) {
        return fail(failureFrom(error, "messages"));
      }
    }
    const snapshot = this.safeSnapshot();
    if (snapshot === null) {
      return fail([createDiagnostic(DIAGNOSTIC_CODES.SPACE_DISPOSED, "space")]);
    }
    if (options.locale !== undefined || options.timezone !== undefined) {
      const locale = options.locale ?? snapshot.locale;
      const timezone = options.timezone ?? snapshot.timezone;
      if (locale !== snapshot.locale || timezone !== snapshot.timezone) {
        const updated = this.spaceValue.setLocale({ locale, timezone });
        if (!updated.ok) {
          return updated;
        }
        if (!this.ensureLive()) {
          return fail([createDiagnostic(DIAGNOSTIC_CODES.VIEW_DISPOSED, "view")]);
        }
      }
    }
    if (options.theme !== undefined) {
      this.config.theme = options.theme;
    }
    if (options.messages !== undefined) {
      this.config.messages = options.messages;
    }
    if (options.realtime !== undefined) {
      this.config.realtime = options.realtime;
    }
    if (options.provenance !== undefined) {
      this.config.provenance = options.provenance;
    }
    if (options.onEvent !== undefined) {
      this.config.onEvent = options.onEvent;
    }
    if (options.mode !== undefined || options.lease !== undefined) {
      const mode: ViewMode = options.mode ?? this.viewValue.mode;
      const changed = this.viewValue.setMode(
        mode,
        options.lease === undefined ? {} : { lease: options.lease },
      );
      if (!changed.ok) {
        if (!this.ensureLive()) {
          return fail([createDiagnostic(DIAGNOSTIC_CODES.VIEW_DISPOSED, "view")]);
        }
        const refreshed = this.safeSnapshot();
        if (refreshed !== null) {
          this.ensureMessages(refreshed);
        }
        this.actionDiagnostics = changed.diagnostics;
        this.announceDiagnostics(changed.diagnostics);
        this.renderNow();
        if (!this.publicOperationLive()) {
          return fail([createDiagnostic(DIAGNOSTIC_CODES.VIEW_DISPOSED, "view")]);
        }
        return changed;
      }
      if (!this.ensureLive()) {
        return fail([createDiagnostic(DIAGNOSTIC_CODES.VIEW_DISPOSED, "view")]);
      }
    }
    this.actionDiagnostics = Object.freeze([]);
    this.renderNow();
    if (!this.publicOperationLive()) {
      return fail([createDiagnostic(DIAGNOSTIC_CODES.VIEW_DISPOSED, "view")]);
    }
    return ok(undefined);
  }

  private requestEditorMode(): void {
    if (!this.publicOperationLive()) {
      return;
    }
    const current = this.viewValue.getSnapshot();
    if (current.leaseId !== null) {
      this.setMode("editor");
      return;
    }
    const acquired = this.spaceValue.acquireEditorLease({
      sessionId: this.viewValue.viewId,
    });
    if (!acquired.ok) {
      this.actionDiagnostics = acquired.diagnostics;
      this.announceDiagnostics(acquired.diagnostics);
      this.renderNow();
      return;
    }
    this.setMode("editor", { lease: acquired.value });
  }

  setMode(mode: ViewMode, options: { readonly lease?: EditorLease } = {}): Result<ViewSnapshot> {
    if (!this.publicOperationLive()) {
      return fail([createDiagnostic(DIAGNOSTIC_CODES.VIEW_DISPOSED, "view")]);
    }
    const changed = this.viewValue.setMode(mode, options);
    if (!this.ensureLive()) {
      return fail([createDiagnostic(DIAGNOSTIC_CODES.VIEW_DISPOSED, "view")]);
    }
    if (changed.ok) {
      if (mode !== "editor") {
        this.pendingFilters.clear();
      }
      this.actionDiagnostics = Object.freeze([]);
      this.scheduleRender();
    } else {
      this.actionDiagnostics = changed.diagnostics;
      this.announceDiagnostics(changed.diagnostics);
      this.renderNow();
      if (!this.publicOperationLive()) {
        return fail([createDiagnostic(DIAGNOSTIC_CODES.VIEW_DISPOSED, "view")]);
      }
    }
    return changed;
  }

  private applyBindingSelection(change: BindingSlotChange): void {
    const result = this.viewValue.commands.updateBinding(change);
    if (result.ok) {
      this.actionDiagnostics = Object.freeze([]);
      this.scheduleRender();
      return;
    }
    this.actionDiagnostics = result.diagnostics;
    this.announceDiagnostics(result.diagnostics);
    this.renderNow();
  }

  private captureBindingFocus(): {
    readonly blockId: string;
    readonly slot: string;
    readonly control: string;
  } | null {
    const active = this.doc.activeElement;
    if (active === null) {
      return null;
    }
    const blockId = active.getAttribute("data-binding-block");
    const slot = active.getAttribute("data-binding-slot");
    const control = active.getAttribute("data-binding-control");
    return blockId !== null && slot !== null && control !== null
      ? Object.freeze({ blockId, slot, control })
      : null;
  }

  private restoreBindingFocus(
    focus: {
      readonly blockId: string;
      readonly slot: string;
      readonly control: string;
    } | null,
  ): void {
    if (focus === null) {
      return;
    }
    for (const element of descendantsByClass(this.inspectorBody, "bl-binding-control")) {
      if (
        element.getAttribute("data-binding-block") === focus.blockId &&
        element.getAttribute("data-binding-slot") === focus.slot &&
        element.getAttribute("data-binding-control") === focus.control
      ) {
        element.focus();
        return;
      }
    }
  }

  private captureInspectorFocus(): InspectorFocusState | null {
    const active = this.doc.activeElement as HTMLElement | null;
    if (active === null || !elementContains(this.inspectorBody, active)) {
      return null;
    }
    const attributeNames = [
      "id",
      "data-editor-title",
      "data-editor-text",
      "data-editor-config",
      "data-theme-control",
      "data-theme-token",
      "data-filter-control",
      "data-binding-block",
      "data-binding-slot",
      "data-binding-control",
      "data-block-action",
      "data-block-target",
      "data-block-breakpoint",
      "data-comparison-control",
      "data-comparison-window-input",
      "data-comparison-window-apply",
      "data-comparison-window-clear",
      "data-comparison-remove",
      "data-filter-action",
    ];
    const attributes: Array<readonly [string, string]> = [];
    for (const name of attributeNames) {
      const value = active.getAttribute(name);
      if (value !== null) {
        attributes.push(Object.freeze([name, value] as const));
      }
    }
    const tagName = active.tagName;
    const valueControl = tagName === "INPUT" || tagName === "SELECT" || tagName === "TEXTAREA";
    const value = valueControl ? String((active as HTMLInputElement).value ?? "") : "";
    const selectionStart =
      tagName === "INPUT" || tagName === "TEXTAREA"
        ? typeof (active as HTMLInputElement).selectionStart === "number"
          ? (active as HTMLInputElement).selectionStart
          : null
        : null;
    const selectionEnd =
      tagName === "INPUT" || tagName === "TEXTAREA"
        ? typeof (active as HTMLInputElement).selectionEnd === "number"
          ? (active as HTMLInputElement).selectionEnd
          : null
        : null;
    return Object.freeze({
      tagName,
      attributes: Object.freeze(attributes),
      filterId: closestAttribute(active, "data-filter-id")?.getAttribute("data-filter-id") ?? null,
      comparisonId:
        closestAttribute(active, "data-comparison-id")?.getAttribute("data-comparison-id") ?? null,
      hasValue: valueControl,
      value,
      selectionStart,
      selectionEnd,
    });
  }

  private restoreInspectorFocus(state: InspectorFocusState | null): void {
    if (state === null) {
      return;
    }
    const match = allDescendants(this.inspectorBody).find((candidate) => {
      if (candidate.tagName !== state.tagName) {
        return false;
      }
      if (!state.attributes.every(([name, value]) => candidate.getAttribute(name) === value)) {
        return false;
      }
      if (
        state.filterId !== null &&
        closestAttribute(candidate, "data-filter-id")?.getAttribute("data-filter-id") !==
          state.filterId
      ) {
        return false;
      }
      if (
        state.comparisonId !== null &&
        closestAttribute(candidate, "data-comparison-id")?.getAttribute("data-comparison-id") !==
          state.comparisonId
      ) {
        return false;
      }
      return true;
    });
    if (match === undefined) {
      return;
    }
    if (state.hasValue) {
      try {
        (match as HTMLInputElement).value = state.value;
      } catch {
        void 0;
      }
    }
    try {
      match.focus();
      if (state.selectionStart !== null && state.selectionEnd !== null) {
        const control = match as HTMLInputElement & {
          setSelectionRange?: (start: number, end: number) => void;
        };
        control.setSelectionRange?.(state.selectionStart, state.selectionEnd);
      }
    } catch {
      void 0;
    }
  }

  private setModalBackgroundInert(inert: boolean): void {
    for (const element of [
      this.header,
      this.statusbar,
      this.filterSection,
      this.library,
      this.canvas,
      this.draftBar,
    ]) {
      if (inert) {
        element.setAttribute("inert", "");
      } else {
        element.removeAttribute("inert");
      }
    }
  }

  private renderInspector(document: BoardDocumentV1): void {
    const editorMode =
      this.viewValue.mode === "editor" && this.viewValue.getSnapshot().leaseId !== null;
    if (!editorMode) {
      this.inspector.setAttribute("hidden", "");
      clearElement(this.inspectorBody);
      return;
    }
    this.inspector.removeAttribute("hidden");
    setKeyedLabel(
      this.inspector,
      "a11y.inspectorRegion",
      this.messagesValue.text("a11y.inspectorRegion"),
    );
    setKeyedText(
      this.inspectorHeading,
      "editor.inspector",
      this.messagesValue.text("editor.inspector"),
    );
    clearElement(this.inspectorBody);
    this.renderSelectedBlock(document, this.messagesValue);
    this.inspectorBody.append(this.createThemeEditor(document, this.messagesValue));
    const catalog = this.spaceValue.getValidationCatalog();
    const configurable = document.blocks.filter(
      (block) => block.type === "chart" || block.type === "metric",
    );
    let hasContent = true;
    for (const block of configurable) {
      const described = describeBindingSlots(
        document,
        block.id,
        catalog === undefined ? {} : { catalog },
      );
      if (!described.ok) {
        continue;
      }
      const group = createElement(this.doc, "fieldset", "bl-binding-group");
      const legend = createElement(this.doc, "legend", "bl-binding-group__title");
      setHostText(legend, block.title ?? block.id);
      group.append(legend);
      for (const slot of described.value) {
        group.append(this.createBindingRow(block, slot));
      }
      this.inspectorBody.append(group);
      hasContent = true;
    }
    const manager = this.createFilterManager(document);
    if (manager !== null) {
      this.inspectorBody.append(manager);
      hasContent = true;
    }
    const comparisons = this.createComparisonManager(document);
    if (comparisons !== null) {
      this.inspectorBody.append(comparisons);
      hasContent = true;
    }
    if (!hasContent) {
      const empty = createElement(this.doc, "p", "bl-inspector__empty");
      setKeyedText(
        empty,
        "editor.inspector.empty",
        this.messagesValue.text("editor.inspector.empty"),
      );
      this.inspectorBody.append(empty);
    }
  }

  private comparisonInputs(document: BoardDocumentV1): readonly {
    readonly value: string;
    readonly label: string;
    readonly input: ComparisonInput;
  }[] {
    const entries: { value: string; label: string; input: ComparisonInput }[] = [];
    for (const dataset of document.datasets) {
      const datasetLabel = dataset.label ?? dataset.id;
      const slices = document.slices.filter((slice) => slice.datasetId === dataset.id);
      if (slices.length === 0) {
        entries.push({
          value: `${dataset.id}|`,
          label: datasetLabel,
          input: { datasetId: dataset.id },
        });
        continue;
      }
      for (const slice of slices) {
        entries.push({
          value: `${dataset.id}|${slice.id}`,
          label: `${datasetLabel} / ${slice.label ?? slice.id}`,
          input: { datasetId: dataset.id, sliceId: slice.id },
        });
      }
    }
    return Object.freeze(entries);
  }

  private parseComparisonInput(value: string, document: BoardDocumentV1): ComparisonInput | null {
    const separator = value.indexOf("|");
    if (separator < 0) {
      return null;
    }
    const datasetId = value.slice(0, separator);
    const sliceId = value.slice(separator + 1);
    if (datasetId === "" || !document.datasets.some((dataset) => dataset.id === datasetId)) {
      return null;
    }
    if (sliceId === "") {
      return { datasetId };
    }
    if (!document.slices.some((slice) => slice.datasetId === datasetId && slice.id === sliceId)) {
      return null;
    }
    return { datasetId, sliceId };
  }

  private comparisonInputValue(input: ComparisonInput): string {
    return `${input.datasetId}|${input.sliceId ?? ""}`;
  }

  private comparisonFields(
    document: BoardDocumentV1,
    input: ComparisonInput,
  ): readonly FieldDescriptor[] {
    return document.datasets.find((dataset) => dataset.id === input.datasetId)?.fields ?? [];
  }

  private comparisonUnitsDiffer(
    document: BoardDocumentV1,
    comparison: ComparisonDefinition,
  ): boolean {
    if (
      comparison.unitPolicy?.mode === "explicit" &&
      (comparison.unitPolicy.conversions?.length ?? 0) > 0
    ) {
      return false;
    }
    const primary = this.comparisonFields(document, comparison.base);
    const reference = this.comparisonFields(document, comparison.reference);
    return comparison.mapping
      .filter((entry) => entry.role === "measure")
      .some((entry) => {
        const left = primary.find((field) => field.id === entry.primary.fieldId);
        const right = reference.find((field) => field.id === entry.reference.fieldId);
        return (left?.unit ?? null) !== (right?.unit ?? null);
      });
  }

  private comparisonMapping(
    document: BoardDocumentV1,
    base: ComparisonInput,
    reference: ComparisonInput,
    preferredAlignment: readonly string[],
    existing?: readonly ComparisonFieldMapping[],
  ): {
    readonly mapping: readonly ComparisonFieldMapping[];
    readonly alignmentKeys: readonly string[];
    readonly unitsCompatible: boolean;
  } | null {
    const primaryFields = this.comparisonFields(document, base);
    const referenceFields = this.comparisonFields(document, reference);
    const used = new Set<string>();
    const mapping: ComparisonFieldMapping[] = [];
    const category = (field: FieldDescriptor): "dimension" | "measure" =>
      field.role === "measure" ? "measure" : "dimension";
    for (const field of primaryFields) {
      const role = category(field);
      const previous =
        existing === undefined
          ? undefined
          : existing.find((entry) => entry.primary.fieldId === field.id);
      const candidates = referenceFields.filter((entry) => !used.has(entry.id));
      const target =
        (previous === undefined
          ? undefined
          : candidates.find(
              (entry) =>
                entry.id === previous.reference.fieldId &&
                entry.type === field.type &&
                category(entry) === role,
            )) ??
        candidates.find((entry) => entry.id === field.id && entry.type === field.type) ??
        candidates.find((entry) => entry.type === field.type && category(entry) === role);
      if (target === undefined) {
        continue;
      }
      used.add(target.id);
      mapping.push({
        primary: { datasetId: base.datasetId, fieldId: field.id },
        reference: { datasetId: reference.datasetId, fieldId: target.id },
        role,
      });
    }
    const dimensionMappings = mapping.filter((entry) => entry.role === "dimension");
    const measureMappings = mapping.filter((entry) => entry.role === "measure");
    if (dimensionMappings.length === 0 || measureMappings.length === 0) {
      return null;
    }
    const preferredKeys = preferredAlignment.filter((fieldId) =>
      dimensionMappings.some((entry) => entry.primary.fieldId === fieldId),
    );
    const alignmentKeys =
      preferredKeys.length > 0
        ? [...new Set(preferredKeys)]
        : [dimensionMappings[0]?.primary.fieldId ?? ""].filter((value) => value !== "");
    const unitsCompatible = measureMappings.every((entry) => {
      const primary = primaryFields.find((field) => field.id === entry.primary.fieldId);
      const target = referenceFields.find((field) => field.id === entry.reference.fieldId);
      return (primary?.unit ?? null) === (target?.unit ?? null);
    });
    return {
      mapping: Object.freeze(mapping),
      alignmentKeys: Object.freeze(alignmentKeys),
      unitsCompatible,
    };
  }

  private createComparisonManager(document: BoardDocumentV1): HTMLElement | null {
    const messages = this.messagesValue;
    const comparisons = document.comparisons ?? [];
    if (document.datasets.length === 0) {
      return null;
    }
    const group = createElement(this.doc, "fieldset", "bl-comparison-manager");
    const legend = createElement(this.doc, "legend", "bl-comparison-manager__title");
    setKeyedText(legend, "editor.comparison.title", messages.text("editor.comparison.title"));
    group.append(legend);
    const actions = createElement(this.doc, "div", "bl-comparison-manager__actions");
    const add = createElement(this.doc, "button", "bl-comparison-manager__add");
    add.setAttribute("type", "button");
    add.setAttribute("data-comparison-action", "add");
    setKeyedText(add, "editor.comparison.add", messages.text("editor.comparison.add"));
    actions.append(add);
    group.append(actions);
    const inputs = this.comparisonInputs(document);
    if (inputs.length < 2) {
      const empty = createElement(this.doc, "p", "bl-comparison-manager__empty");
      setKeyedText(
        empty,
        "editor.comparison.noFields",
        messages.text("editor.comparison.noFields"),
      );
      group.append(empty);
      return group;
    }
    if (comparisons.length === 0) {
      const empty = createElement(this.doc, "p", "bl-comparison-manager__empty");
      setKeyedText(
        empty,
        "editor.comparison.noComparisons",
        messages.text("editor.comparison.noComparisons"),
      );
      group.append(empty);
      return group;
    }
    for (const comparison of comparisons) {
      group.append(this.createComparisonRow(document, comparison, inputs));
    }
    return group;
  }

  private createComparisonRow(
    document: BoardDocumentV1,
    comparison: ComparisonDefinition,
    inputs: readonly {
      readonly value: string;
      readonly label: string;
      readonly input: ComparisonInput;
    }[],
  ): HTMLElement {
    const messages = this.messagesValue;
    const row = createElement(this.doc, "div", "bl-comparison-row");
    row.setAttribute("data-comparison-id", comparison.id);
    const heading = createElement(this.doc, "div", "bl-comparison-row__head");
    const title = createElement(this.doc, "span", "bl-comparison-row__title");
    setHostText(title, comparison.label);
    const remove = createElement(this.doc, "button", "bl-comparison-row__remove");
    remove.setAttribute("type", "button");
    remove.setAttribute("data-comparison-remove", comparison.id);
    setKeyedText(remove, "editor.comparison.remove", messages.text("editor.comparison.remove"));
    heading.append(title, remove);
    row.append(heading);

    const labeled = (
      key: string,
      control: HTMLElement,
      labelText = messages.text(key),
    ): HTMLElement => {
      const item = createElement(this.doc, "div", "bl-comparison-field");
      const label = createElement(this.doc, "label", "bl-comparison-field__label");
      setKeyedText(label, key, labelText);
      if ("id" in control && typeof control.id === "string") {
        label.setAttribute("for", control.id);
      }
      item.append(label, control);
      return item;
    };

    const display = createElement(this.doc, "select", "bl-comparison-control");
    display.id = `${this.root.id}-comparison-${comparison.id}-display`.replace(
      /[^A-Za-z0-9_-]/g,
      "-",
    );
    display.setAttribute("data-comparison-control", "displayMode");
    display.setAttribute("data-comparison-id", comparison.id);
    display.setAttribute("aria-label", messages.text("editor.comparison.display"));
    for (const mode of COMPARISON_DISPLAY_MODES) {
      const option = createElement(this.doc, "option");
      option.value = mode;
      const modeKey = mode === "side-by-side" ? "sideBySide" : mode;
      option.textContent = messages.has(`editor.comparison.display.${modeKey}`)
        ? messages.text(`editor.comparison.display.${modeKey}`)
        : mode;
      display.append(option);
    }
    display.value = comparison.displayMode;

    const delta = createElement(this.doc, "select", "bl-comparison-control");
    delta.id = `${this.root.id}-comparison-${comparison.id}-delta`.replace(/[^A-Za-z0-9_-]/g, "-");
    delta.setAttribute("data-comparison-control", "deltaMode");
    delta.setAttribute("data-comparison-id", comparison.id);
    delta.setAttribute("aria-label", messages.text("editor.comparison.delta"));
    for (const mode of COMPARISON_DELTA_MODES) {
      const option = createElement(this.doc, "option");
      option.value = mode;
      option.textContent = messages.has(`editor.comparison.delta.${mode}`)
        ? messages.text(`editor.comparison.delta.${mode}`)
        : mode;
      delta.append(option);
    }
    delta.value = comparison.deltaMode;

    const base = createElement(this.doc, "select", "bl-comparison-control");
    base.id = `${this.root.id}-comparison-${comparison.id}-base`.replace(/[^A-Za-z0-9_-]/g, "-");
    base.setAttribute("data-comparison-control", "base");
    base.setAttribute("data-comparison-id", comparison.id);
    base.setAttribute("aria-label", messages.text("editor.comparison.base"));
    for (const entry of inputs) {
      const option = createElement(this.doc, "option");
      option.value = entry.value;
      option.textContent = entry.label;
      base.append(option);
    }
    base.value = this.comparisonInputValue(comparison.base);

    const reference = createElement(this.doc, "select", "bl-comparison-control");
    reference.id = `${this.root.id}-comparison-${comparison.id}-reference`.replace(
      /[^A-Za-z0-9_-]/g,
      "-",
    );
    reference.setAttribute("data-comparison-control", "reference");
    reference.setAttribute("data-comparison-id", comparison.id);
    reference.setAttribute("aria-label", messages.text("editor.comparison.referenceInput"));
    for (const entry of inputs) {
      const option = createElement(this.doc, "option");
      option.value = entry.value;
      option.textContent = entry.label;
      reference.append(option);
    }
    reference.value = this.comparisonInputValue(comparison.reference);

    const inputsRow = createElement(this.doc, "div", "bl-comparison-row__inputs");
    inputsRow.append(
      labeled("editor.comparison.base", base),
      labeled("editor.comparison.referenceInput", reference),
      labeled("editor.comparison.display", display),
      labeled("editor.comparison.delta", delta),
    );
    row.append(inputsRow);

    const alignment = createElement(this.doc, "div", "bl-comparison-alignment");
    const alignmentTitle = createElement(this.doc, "span", "bl-comparison-alignment__title");
    setKeyedText(
      alignmentTitle,
      "editor.comparison.alignment",
      messages.text("editor.comparison.alignment"),
    );
    alignment.append(alignmentTitle);
    const dimensionMappings = comparison.mapping.filter((entry) => entry.role === "dimension");
    for (const entry of dimensionMappings) {
      const item = createElement(this.doc, "label", "bl-comparison-alignment__item");
      const input = createElement(this.doc, "input", "bl-comparison-control");
      input.setAttribute("type", "checkbox");
      input.setAttribute("data-comparison-control", "alignment");
      input.setAttribute("data-comparison-id", comparison.id);
      input.setAttribute("data-comparison-field", entry.primary.fieldId);
      (input as unknown as { checked: boolean }).checked = comparison.alignment.keys.includes(
        entry.primary.fieldId,
      );
      const text = createElement(this.doc, "span");
      setHostText(text, entry.primary.fieldId);
      item.append(input, text);
      alignment.append(item);
    }
    row.append(alignment);

    const mappingList = createElement(this.doc, "div", "bl-comparison-mapping");
    comparison.mapping.forEach((entry, index) => {
      const item = createElement(this.doc, "div", "bl-comparison-mapping__row");
      const primary = createElement(this.doc, "span", "bl-comparison-mapping__primary");
      setHostText(primary, `${entry.role}: ${entry.primary.fieldId}`);
      const select = createElement(this.doc, "select", "bl-comparison-control");
      select.setAttribute("data-comparison-control", "mapping");
      select.setAttribute("data-comparison-id", comparison.id);
      select.setAttribute("data-comparison-index", String(index));
      select.setAttribute("aria-label", messages.text("editor.comparison.mapping"));
      const primaryField = this.comparisonFields(document, comparison.base).find(
        (field) => field.id === entry.primary.fieldId,
      );
      for (const field of this.comparisonFields(document, comparison.reference)) {
        if (primaryField !== undefined && field.type !== primaryField.type) {
          continue;
        }
        const option = createElement(this.doc, "option");
        option.value = field.id;
        option.textContent = field.id;
        select.append(option);
      }
      select.value = entry.reference.fieldId;
      item.append(primary, select);
      mappingList.append(item);
    });
    row.append(mappingList);

    const policy = createElement(this.doc, "p", "bl-comparison-policy");
    policy.setAttribute("data-comparison-unit-policy", comparison.unitPolicy?.mode ?? "identical");
    setHostText(
      policy,
      `${messages.text("editor.comparison.unitPolicy")}: ${
        comparison.unitPolicy?.mode ?? "identical"
      }`,
    );
    row.append(policy);

    const attach = createElement(this.doc, "select", "bl-comparison-control");
    attach.setAttribute("data-comparison-control", "attach");
    attach.setAttribute("data-comparison-id", comparison.id);
    attach.setAttribute("aria-label", messages.text("editor.comparison.attach"));
    const none = createElement(this.doc, "option");
    none.value = "";
    none.textContent = messages.text("editor.comparison.none");
    attach.append(none);
    for (const block of document.blocks.filter(
      (entry) => entry.type === "chart" || entry.type === "metric" || entry.type === "table",
    )) {
      const option = createElement(this.doc, "option");
      option.value = block.id;
      option.textContent = block.title ?? block.id;
      attach.append(option);
    }
    const attached = document.blocks.find((block) => {
      const configured = block.config.comparisonId;
      return typeof configured === "string" && configured === comparison.id;
    });
    attach.value = attached?.id ?? "";
    row.append(labeled("editor.comparison.attach", attach));

    for (const side of ["primary", "reference"] as const) {
      row.append(this.createComparisonWindow(comparison, side));
    }
    return row;
  }

  private createComparisonWindow(
    comparison: ComparisonDefinition,
    side: "primary" | "reference",
  ): HTMLElement {
    const messages = this.messagesValue;
    const windowValue =
      side === "primary" ? comparison.windows?.primary : comparison.windows?.reference;
    const group = createElement(this.doc, "div", "bl-comparison-window");
    group.setAttribute("data-comparison-id", comparison.id);
    group.setAttribute("data-comparison-side", side);
    const title = createElement(this.doc, "span", "bl-comparison-window__title");
    const titleKey =
      side === "primary" ? "editor.comparison.windowPrimary" : "editor.comparison.windowReference";
    setKeyedText(title, titleKey, messages.text(titleKey));
    group.append(title);
    const inputs: HTMLElement[] = [];
    for (const [field, labelKey, value, placeholder] of [
      ["timezone", "editor.comparison.windowTimezone", windowValue?.timezone, "UTC"],
      ["start", "editor.comparison.windowStart", windowValue?.start, "YYYY-MM-DD"],
      ["end", "editor.comparison.windowEnd", windowValue?.end, "YYYY-MM-DD"],
    ] as const) {
      const input = createElement(this.doc, "input", "bl-comparison-control");
      input.setAttribute("type", "text");
      input.setAttribute("data-comparison-window-input", field);
      input.setAttribute("aria-label", messages.text(labelKey));
      input.setAttribute("placeholder", placeholder);
      input.value = value ?? "";
      group.append(input);
      inputs.push(input);
    }
    const bounds = createElement(this.doc, "select", "bl-comparison-control");
    bounds.setAttribute("data-comparison-window-input", "bounds");
    bounds.setAttribute("aria-label", messages.text("editor.comparison.windowBounds"));
    for (const value of ["inclusive", "exclusive", "half-open"]) {
      const option = createElement(this.doc, "option");
      option.value = value;
      option.textContent = value;
      bounds.append(option);
    }
    bounds.value = windowValue?.bounds ?? "inclusive";
    group.append(bounds);
    const apply = createElement(this.doc, "button", "bl-comparison-window__apply");
    apply.setAttribute("type", "button");
    apply.setAttribute("data-comparison-window-apply", comparison.id);
    apply.setAttribute("data-comparison-side", side);
    setKeyedText(
      apply,
      "editor.comparison.windowApply",
      messages.text("editor.comparison.windowApply"),
    );
    group.append(apply);
    if (windowValue !== undefined) {
      const clear = createElement(this.doc, "button", "bl-comparison-window__clear");
      clear.setAttribute("type", "button");
      clear.setAttribute("data-comparison-window-clear", comparison.id);
      clear.setAttribute("data-comparison-side", side);
      setKeyedText(
        clear,
        "editor.comparison.windowClear",
        messages.text("editor.comparison.windowClear"),
      );
      group.append(clear);
    }
    return group;
  }

  private applyComparisonManagerChange(
    control: string,
    target: EventTarget & {
      readonly value?: string;
      readonly checked?: boolean;
      getAttribute?: (name: string) => string | null;
    },
  ): void {
    if (target.getAttribute === undefined) {
      return;
    }
    const comparisonId = target.getAttribute("data-comparison-id");
    if (comparisonId === null) {
      return;
    }
    const snapshot = this.safeSnapshot();
    if (snapshot === null) {
      return;
    }
    const document = (snapshot.draft?.document ??
      snapshot.committedDocument) as unknown as BoardDocumentV1;
    const current = document.comparisons?.find((entry) => entry.id === comparisonId);
    if (current === undefined) {
      return;
    }
    const value = typeof target.value === "string" ? target.value : "";
    if (control === "attach") {
      const next = {
        ...document,
        blocks: document.blocks.map((block) => {
          const configured = block.config.comparisonId;
          if (block.id === value) {
            return { ...block, config: { ...block.config, comparisonId } };
          }
          if (typeof configured === "string" && configured === comparisonId) {
            const { comparisonId: _removed, ...config } = block.config;
            void _removed;
            return { ...block, config };
          }
          return block;
        }),
      } as BoardDocumentV1;
      const diagnostics = this.comparisonPlanDiagnostics(next, comparisonId);
      if (diagnostics.length > 0) {
        this.setComparisonDiagnostics(diagnostics);
        return;
      }
      this.updateFilterDocument(() => next);
      return;
    }
    if (control === "displayMode") {
      if (!(COMPARISON_DISPLAY_MODES as readonly string[]).includes(value)) {
        return;
      }
      const unitsDiffer = this.comparisonUnitsDiffer(document, current);
      this.updateComparisonDefinition(comparisonId, (comparison) => ({
        ...comparison,
        displayMode: value as ComparisonDisplayMode,
        ...(value === "side-by-side" && unitsDiffer ? { deltaMode: "none" as const } : {}),
      }));
      return;
    }
    if (control === "deltaMode") {
      if (!(COMPARISON_DELTA_MODES as readonly string[]).includes(value)) {
        return;
      }
      const unitsDiffer = this.comparisonUnitsDiffer(document, current);
      this.updateComparisonDefinition(comparisonId, (comparison) => ({
        ...comparison,
        deltaMode: value as ComparisonDeltaMode,
        ...(value === "none" && unitsDiffer ? { displayMode: "side-by-side" as const } : {}),
      }));
      return;
    }
    if (control === "base" || control === "reference") {
      const input = this.parseComparisonInput(value, document);
      if (input === null) {
        return;
      }
      const base = control === "base" ? input : current.base;
      const reference = control === "reference" ? input : current.reference;
      if (base.datasetId === reference.datasetId && base.sliceId === reference.sliceId) {
        this.setComparisonDiagnostics([
          createDiagnostic(
            DIAGNOSTIC_CODES.INCOMPATIBLE_COMPARISON,
            `comparisons/${comparisonId}`,
            { message: "A comparison needs two distinct inputs.", relatedIds: [comparisonId] },
          ),
        ]);
        return;
      }
      const preferred = document.blocks
        .flatMap((block) => block.bindings ?? [])
        .filter((binding) => binding.field.datasetId === base.datasetId)
        .map((binding) => binding.field.fieldId);
      const rebuilt = this.comparisonMapping(document, base, reference, preferred, current.mapping);
      if (rebuilt === null) {
        this.setComparisonDiagnostics([
          createDiagnostic(
            DIAGNOSTIC_CODES.INCOMPATIBLE_COMPARISON,
            `comparisons/${comparisonId}/mapping`,
            {
              message: "The selected inputs do not share compatible dimension and measure fields.",
              relatedIds: [comparisonId],
            },
          ),
        ]);
        return;
      }
      const rawUnitAlternative =
        current.displayMode === "side-by-side" && current.deltaMode === "none";
      if (!rebuilt.unitsCompatible && !rawUnitAlternative) {
        this.setComparisonDiagnostics([
          createDiagnostic(
            DIAGNOSTIC_CODES.INCOMPATIBLE_COMPARISON,
            `comparisons/${comparisonId}/unitPolicy`,
            {
              message: "The selected inputs use incompatible measure units.",
              relatedIds: [comparisonId],
              hint: "Choose side-by-side display with deltas disabled, or declare a documented explicit conversion.",
            },
          ),
        ]);
        return;
      }
      this.updateComparisonDefinition(comparisonId, () => ({
        ...current,
        base,
        reference,
        mapping: rebuilt.mapping,
        alignment: { ...current.alignment, keys: rebuilt.alignmentKeys },
        unitPolicy: { mode: "identical" },
      }));
      return;
    }
    if (control === "alignment") {
      const fieldId = target.getAttribute("data-comparison-field");
      if (fieldId === null) {
        return;
      }
      const keys =
        target.checked === true
          ? [...current.alignment.keys, fieldId].filter(
              (entry, index, list) => list.indexOf(entry) === index,
            )
          : current.alignment.keys.filter((entry) => entry !== fieldId);
      if (keys.length === 0) {
        return;
      }
      this.updateComparisonDefinition(comparisonId, (comparison) => ({
        ...comparison,
        alignment: { ...comparison.alignment, keys },
      }));
      return;
    }
    if (control === "mapping") {
      const index = Number(target.getAttribute("data-comparison-index"));
      if (!Number.isInteger(index) || index < 0) {
        return;
      }
      const mapping = current.mapping.map((entry, entryIndex) =>
        entryIndex === index
          ? {
              ...entry,
              reference: {
                datasetId: current.reference.datasetId,
                fieldId: value,
              },
            }
          : entry,
      );
      this.updateComparisonDefinition(comparisonId, (comparison) => ({
        ...comparison,
        mapping,
      }));
    }
  }

  private setComparisonDiagnostics(diagnostics: readonly Diagnostic[]): void {
    this.actionDiagnostics = Object.freeze([...diagnostics]);
    this.announceDiagnostics(diagnostics);
    this.renderNow();
  }

  private updateComparisonDefinition(
    comparisonId: string,
    mutate: (comparison: ComparisonDefinition) => ComparisonDefinition,
  ): void {
    const snapshot = this.safeSnapshot();
    if (snapshot === null) {
      return;
    }
    const document = (snapshot.draft?.document ??
      snapshot.committedDocument) as unknown as BoardDocumentV1;
    const current = document.comparisons?.find((comparison) => comparison.id === comparisonId);
    if (current === undefined) {
      return;
    }
    const next = {
      ...document,
      comparisons: (document.comparisons ?? []).map((comparison) =>
        comparison.id === comparisonId ? mutate(comparison) : comparison,
      ),
    } as BoardDocumentV1;
    const diagnostics = this.comparisonPlanDiagnostics(next, comparisonId);
    if (diagnostics.length > 0) {
      this.setComparisonDiagnostics(diagnostics);
      return;
    }
    this.updateFilterDocument(() => next);
  }

  private comparisonPlanDiagnostics(
    document: BoardDocumentV1,
    comparisonId?: string,
  ): readonly Diagnostic[] {
    const snapshot = this.safeSnapshot();
    if (snapshot === null) {
      return Object.freeze([]);
    }
    const catalog = this.spaceValue.getValidationCatalog();
    const diagnostics: Diagnostic[] = [];
    for (const block of document.blocks) {
      const configured = block.config.comparisonId;
      if (typeof configured !== "string") {
        continue;
      }
      if (comparisonId !== undefined && configured !== comparisonId) {
        continue;
      }
      const derived = deriveComparisonQuery(document, block, {
        filterState: snapshot.filterState,
        ...(catalog === undefined ? {} : { catalog }),
        getDatasetDescriptor: (datasetId) => this.spaceValue.getDatasetDescriptor(datasetId),
      });
      if (!derived.ok) {
        diagnostics.push(...derived.diagnostics.filter((entry) => entry.severity === "error"));
      }
    }
    return Object.freeze(diagnostics);
  }

  private applyComparisonWindow(
    comparisonId: string,
    side: "primary" | "reference",
    clear = false,
  ): void {
    const snapshot = this.safeSnapshot();
    if (snapshot === null) {
      return;
    }
    const document = (snapshot.draft?.document ??
      snapshot.committedDocument) as unknown as BoardDocumentV1;
    const comparison = document.comparisons?.find((entry) => entry.id === comparisonId);
    if (comparison === undefined) {
      return;
    }
    const element = [...descendantsByClass(this.inspectorBody, "bl-comparison-window")].find(
      (entry) =>
        entry.getAttribute("data-comparison-id") === comparisonId &&
        entry.getAttribute("data-comparison-side") === side,
    );
    if (element === undefined) {
      return;
    }
    const withoutWindow = (current: ComparisonDefinition): ComparisonDefinition => {
      const { [side]: _removed, ...remaining } = current.windows ?? {};
      void _removed;
      if (Object.keys(remaining).length === 0) {
        const { windows: _discarded, ...rest } = current;
        void _discarded;
        return rest;
      }
      return { ...current, windows: remaining };
    };
    if (clear) {
      this.updateComparisonDefinition(comparisonId, withoutWindow);
      return;
    }
    const read = (key: string): string => {
      const input = element.querySelector(`[data-comparison-window-input="${key}"]`);
      if (input === null) {
        return "";
      }
      return typeof (input as HTMLInputElement).value === "string"
        ? (input as HTMLInputElement).value.trim()
        : "";
    };
    const timezone = read("timezone");
    const start = read("start");
    const end = read("end");
    const boundsValue = read("bounds") || "inclusive";
    if (timezone === "" && start === "" && end === "") {
      this.updateComparisonDefinition(comparisonId, withoutWindow);
      return;
    }
    if (timezone === "" || start === "" || end === "") {
      this.setComparisonDiagnostics([
        createDiagnostic(
          DIAGNOSTIC_CODES.INVALID_PROPERTY_TYPE,
          `comparisons/${comparisonId}/windows/${side}`,
          { message: "A comparison window requires a timezone, start and end." },
        ),
      ]);
      return;
    }
    if (boundsValue !== "inclusive" && boundsValue !== "exclusive" && boundsValue !== "half-open") {
      return;
    }
    const windowValue: TimeWindow = {
      timezone,
      start,
      end,
      bounds: boundsValue,
    };
    this.updateComparisonDefinition(comparisonId, (current) => ({
      ...current,
      windows: {
        ...current.windows,
        [side]: windowValue,
      },
    }));
  }

  private addComparisonDefinition(): void {
    const snapshot = this.safeSnapshot();
    if (snapshot === null) {
      return;
    }
    const document = (snapshot.draft?.document ??
      snapshot.committedDocument) as unknown as BoardDocumentV1;
    const targetBlock = document.blocks.find(
      (block) =>
        (block.type === "chart" || block.type === "metric" || block.type === "table") &&
        typeof block.config.comparisonId !== "string" &&
        (block.bindings ?? []).length > 0,
    );
    if (targetBlock === undefined) {
      this.setComparisonDiagnostics([
        createDiagnostic(
          DIAGNOSTIC_CODES.INCOMPATIBLE_COMPARISON,
          "blocks/pending/config/comparisonId",
          { message: "Add a data block with bindings before creating a comparison." },
        ),
      ]);
      return;
    }
    const firstBinding = (targetBlock.bindings ?? [])[0];
    if (firstBinding === undefined) {
      return;
    }
    const base: ComparisonInput = {
      datasetId: firstBinding.field.datasetId,
      ...(firstBinding.sliceId === undefined ? {} : { sliceId: firstBinding.sliceId }),
    };
    const chartSelection =
      targetBlock.type === "chart" ? selectChartBindings(targetBlock.bindings ?? [], null) : null;
    const preferred =
      targetBlock.type === "chart"
        ? [chartSelection?.x, chartSelection?.series]
            .filter(
              (binding): binding is BindingDefinition => binding !== null && binding !== undefined,
            )
            .map((binding) => binding.field.fieldId)
        : targetBlock.type === "table"
          ? (targetBlock.bindings ?? [])
              .filter((binding) => binding.role !== "measure" && binding.axis !== "y")
              .filter((binding) => binding.field.datasetId === base.datasetId)
              .map((binding) => binding.field.fieldId)
          : [];
    const candidates = this.comparisonInputs(document)
      .filter(
        (entry) => entry.input.datasetId !== base.datasetId || entry.input.sliceId !== base.sliceId,
      )
      .map((entry) => ({
        entry,
        mapping: this.comparisonMapping(document, base, entry.input, preferred),
      }))
      .filter(
        (entry): entry is typeof entry & { mapping: NonNullable<typeof entry.mapping> } =>
          entry.mapping !== null,
      )
      .sort((left, right) => {
        if (left.mapping.unitsCompatible !== right.mapping.unitsCompatible) {
          return left.mapping.unitsCompatible ? -1 : 1;
        }
        return right.mapping.mapping.length - left.mapping.mapping.length;
      });
    const chosen = candidates[0];
    if (chosen === undefined) {
      this.setComparisonDiagnostics([
        createDiagnostic(DIAGNOSTIC_CODES.INCOMPATIBLE_COMPARISON, "comparisons/pending/mapping", {
          message:
            "No other dataset or slice has compatible dimension and measure fields for an explicit mapping.",
        }),
      ]);
      return;
    }
    const existing = new Set([...(document.comparisons ?? []).map((comparison) => comparison.id)]);
    let id = `comparison-${++comparisonSequence}`;
    while (existing.has(id)) {
      id = `comparison-${++comparisonSequence}`;
    }
    const comparison: ComparisonDefinition = {
      id,
      label: chosen.entry.label,
      displayMode: chosen.mapping.unitsCompatible ? "overlay" : "side-by-side",
      deltaMode: chosen.mapping.unitsCompatible ? "both" : "none",
      base,
      reference: chosen.entry.input,
      mapping: chosen.mapping.mapping,
      alignment: {
        keys: chosen.mapping.alignmentKeys,
        collation: "unicode",
        normalization: "none",
      },
      unitPolicy: { mode: "identical" },
    };
    const next = {
      ...document,
      comparisons: [...(document.comparisons ?? []), comparison],
      blocks: document.blocks.map((block) =>
        block.id === targetBlock.id
          ? { ...block, config: { ...block.config, comparisonId: id } }
          : block,
      ),
    } as BoardDocumentV1;
    const diagnostics = this.comparisonPlanDiagnostics(next, id);
    if (diagnostics.length > 0) {
      this.setComparisonDiagnostics(diagnostics);
      return;
    }
    this.updateFilterDocument(() => next);
  }

  private removeComparisonDefinition(comparisonId: string): void {
    this.updateFilterDocument(
      (document) =>
        ({
          ...document,
          comparisons: (document.comparisons ?? []).filter(
            (comparison) => comparison.id !== comparisonId,
          ),
          blocks: document.blocks.map((block) => {
            const configured = block.config.comparisonId;
            if (typeof configured === "string" && configured === comparisonId) {
              const { comparisonId: _removed, ...config } = block.config;
              void _removed;
              return { ...block, config };
            }
            return block;
          }),
        }) as BoardDocumentV1,
    );
  }

  private createFilterManager(document: BoardDocumentV1): HTMLElement | null {
    const messages = this.messagesValue;
    const fields: Array<{
      readonly datasetId: string;
      readonly fieldId: string;
      readonly label: string;
      readonly type: FieldValueType;
      readonly timezone?: string;
    }> = [];
    for (const dataset of document.datasets) {
      for (const field of dataset.fields ?? []) {
        fields.push({
          datasetId: dataset.id,
          fieldId: field.id,
          label: field.id,
          type: field.type,
          ...(field.timezone === undefined ? {} : { timezone: field.timezone }),
        });
      }
    }
    if (document.datasets.length === 0) {
      return null;
    }
    const group = createElement(this.doc, "fieldset", "bl-filter-manager");
    const legend = createElement(this.doc, "legend", "bl-filter-manager__title");
    setKeyedText(legend, "editor.filters.manage", messages.text("editor.filters.manage"));
    group.append(legend);
    const actions = createElement(this.doc, "div", "bl-filter-manager__actions");
    const add = createElement(this.doc, "button", "bl-filter-manager__add");
    add.setAttribute("type", "button");
    add.setAttribute("data-filter-action", "add");
    setKeyedText(add, "editor.filters.add", messages.text("editor.filters.add"));
    if (fields.length === 0) {
      add.disabled = true;
      add.setAttribute("disabled", "");
      add.setAttribute("aria-disabled", "true");
    }
    actions.append(add);
    const resetAll = createElement(this.doc, "button", "bl-filter-manager__reset");
    resetAll.setAttribute("type", "button");
    resetAll.setAttribute("data-filter-reset-all-locked", "true");
    setKeyedText(resetAll, "viewer.filters.reset", messages.text("viewer.filters.reset"));
    actions.append(resetAll);
    group.append(actions);
    if (fields.length === 0) {
      const none = createElement(this.doc, "p", "bl-filter-manager__empty");
      setKeyedText(none, "editor.filters.noFields", messages.text("editor.filters.noFields"));
      group.append(none);
    }
    const groupOptions = (document.filterGroups ?? []).map((entry) => ({
      id: entry.id,
      label: entry.label ?? entry.id,
    }));
    const blockOptions = document.blocks
      .filter(
        (block) => block.type === "chart" || block.type === "metric" || block.type === "table",
      )
      .map((block) => ({ id: block.id, label: block.title ?? block.id }));
    const filterIds = [
      ...document.filters.map((filter) => filter.id),
      ...[...this.pendingFilters.keys()].filter(
        (id) => !document.filters.some((filter) => filter.id === id),
      ),
    ];
    for (const filterId of filterIds) {
      const filter =
        this.pendingFilters.get(filterId) ??
        document.filters.find((entry) => entry.id === filterId);
      if (filter === undefined) {
        continue;
      }
      group.append(
        this.createFilterManagerRow(document, filter, fields, groupOptions, blockOptions),
      );
    }
    return group;
  }

  private createFilterManagerRow(
    document: BoardDocumentV1,
    filter: FilterDefinition,
    fields: readonly {
      readonly datasetId: string;
      readonly fieldId: string;
      readonly label: string;
      readonly type: FieldValueType;
      readonly timezone?: string;
    }[],
    groups: readonly { readonly id: string; readonly label: string }[],
    blocks: readonly { readonly id: string; readonly label: string }[],
  ): HTMLElement {
    const messages = this.messagesValue;
    const row = createElement(this.doc, "div", "bl-filter-row");
    row.setAttribute("data-filter-id", filter.id);
    row.setAttribute("data-filter-scope", filter.target.kind);
    const makeLabel = (key: string, text: string, control: HTMLElement): HTMLElement => {
      const label = createElement(this.doc, "label", "bl-filter-row__label");
      label.setAttribute("for", control.id);
      setKeyedText(label, key, text);
      return label;
    };
    const fieldSelect = createElement(this.doc, "select", "bl-filter-control");
    fieldSelect.id = `${this.root.id}-filter-${filter.id}-field`.replace(/[^A-Za-z0-9_-]/g, "-");
    fieldSelect.setAttribute("data-filter-control", "field");
    for (const field of fields) {
      const option = createElement(this.doc, "option");
      option.value = JSON.stringify([field.datasetId, field.fieldId]);
      option.textContent = `${field.datasetId}: ${field.fieldId}`;
      fieldSelect.append(option);
    }
    fieldSelect.value = JSON.stringify([filter.field.datasetId, filter.field.fieldId]);
    row.append(makeLabel("filter.field", messages.text("filter.field"), fieldSelect), fieldSelect);
    const descriptor = fields.find(
      (entry) =>
        entry.datasetId === filter.field.datasetId && entry.fieldId === filter.field.fieldId,
    );
    const operatorSelect = createElement(this.doc, "select", "bl-filter-control");
    operatorSelect.id = `${this.root.id}-filter-${filter.id}-operator`.replace(
      /[^A-Za-z0-9_-]/g,
      "-",
    );
    operatorSelect.setAttribute("data-filter-control", "operator");
    const operators =
      descriptor === undefined
        ? []
        : filterDefinitionOperators(document, filter, this.spaceValue.getValidationCatalog());
    for (const operator of operators) {
      const option = createElement(this.doc, "option");
      option.value = operator;
      option.textContent = messages.text(filterOperatorLabelKey(operator));
      operatorSelect.append(option);
    }
    operatorSelect.value = filter.operator;
    row.append(
      makeLabel(
        "editor.filters.operator",
        messages.text("editor.filters.operator"),
        operatorSelect,
      ),
      operatorSelect,
    );
    const parameterless =
      filter.operator === "isNull" ||
      filter.operator === "isNotNull" ||
      filter.operator === "isTrue" ||
      filter.operator === "isFalse";
    if (!parameterless) {
      const valueInput = createElement(this.doc, "input", "bl-filter-control");
      valueInput.id = `${this.root.id}-filter-${filter.id}-default`.replace(/[^A-Za-z0-9_-]/g, "-");
      valueInput.setAttribute("data-filter-control", "default");
      valueInput.setAttribute("type", "text");
      valueInput.value = filterInputText(filter.defaultValue);
      row.append(
        makeLabel("filter.defaultValue", messages.text("filter.defaultValue"), valueInput),
        valueInput,
      );
    }
    const targetSelect = createElement(this.doc, "select", "bl-filter-control");
    targetSelect.id = `${this.root.id}-filter-${filter.id}-target`.replace(/[^A-Za-z0-9_-]/g, "-");
    targetSelect.setAttribute("data-filter-control", "target");
    const boardOption = createElement(this.doc, "option");
    boardOption.value = "board";
    boardOption.textContent = messages.text("filter.scope.board");
    targetSelect.append(boardOption);
    for (const groupOption of groups) {
      const option = createElement(this.doc, "option");
      option.value = `group:${groupOption.id}`;
      option.textContent = `${messages.text("filter.scope.group")}: ${groupOption.label}`;
      targetSelect.append(option);
    }
    for (const blockOption of blocks) {
      const option = createElement(this.doc, "option");
      option.value = `block:${blockOption.id}`;
      option.textContent = `${messages.text("filter.scope.block")}: ${blockOption.label}`;
      targetSelect.append(option);
    }
    targetSelect.value =
      filter.target.kind === "board"
        ? "board"
        : filter.target.kind === "group"
          ? `group:${filter.target.groupId}`
          : `block:${filter.target.blockId}`;
    row.append(
      makeLabel("editor.filters.target", messages.text("editor.filters.target"), targetSelect),
      targetSelect,
    );
    const editable = createElement(this.doc, "input", "bl-filter-control");
    editable.id = `${this.root.id}-filter-${filter.id}-editable`.replace(/[^A-Za-z0-9_-]/g, "-");
    editable.setAttribute("data-filter-control", "viewerEditable");
    editable.setAttribute("type", "checkbox");
    (editable as unknown as { checked: boolean }).checked = filter.viewerEditable === true;
    row.append(
      makeLabel(
        "editor.filters.viewerEditable",
        messages.text("editor.filters.viewerEditable"),
        editable,
      ),
      editable,
    );
    for (const dataset of document.datasets) {
      if (dataset.id === filter.field.datasetId) {
        continue;
      }
      const mapping = createElement(this.doc, "select", "bl-filter-control");
      mapping.id = `${this.root.id}-filter-${filter.id}-mapping-${dataset.id}`.replace(
        /[^A-Za-z0-9_-]/g,
        "-",
      );
      mapping.setAttribute("data-filter-control", "mapping");
      mapping.setAttribute("data-filter-dataset", dataset.id);
      const none = createElement(this.doc, "option");
      none.value = "";
      none.textContent = messages.text("editor.binding.none");
      mapping.append(none);
      for (const field of dataset.fields ?? []) {
        const option = createElement(this.doc, "option");
        option.value = field.id;
        option.textContent = field.id;
        mapping.append(option);
      }
      const current = filter.mappings?.find(
        (entry) =>
          entry.source.datasetId === filter.field.datasetId &&
          entry.source.fieldId === filter.field.fieldId &&
          entry.target.datasetId === dataset.id,
      );
      mapping.value = current?.target.fieldId ?? "";
      row.append(
        makeLabel(
          "editor.filters.mapping",
          messages.text("editor.filters.mapping", { dataset: dataset.id }),
          mapping,
        ),
        mapping,
      );
    }
    const resetScope = createElement(this.doc, "button", "bl-filter-row__reset");
    resetScope.setAttribute("type", "button");
    resetScope.setAttribute("data-filter-reset-scope", filter.target.kind);
    resetScope.setAttribute(
      "data-filter-scope-id",
      filter.target.kind === "group"
        ? filter.target.groupId
        : filter.target.kind === "block"
          ? filter.target.blockId
          : "",
    );
    setKeyedText(
      resetScope,
      "viewer.filters.resetScope",
      messages.text("viewer.filters.resetScope"),
    );
    const reset = createElement(this.doc, "button", "bl-filter-row__reset");
    reset.setAttribute("type", "button");
    reset.setAttribute("data-filter-reset", filter.id);
    setKeyedText(reset, "viewer.filters.reset", messages.text("viewer.filters.reset"));
    row.append(resetScope, reset);
    if (this.pendingFilters.has(filter.id)) {
      row.setAttribute("data-filter-pending", "true");
      const apply = createElement(this.doc, "button", "bl-filter-row__apply");
      apply.setAttribute("type", "button");
      apply.setAttribute("data-filter-apply", filter.id);
      setKeyedText(apply, "common.apply", messages.text("common.apply"));
      const discard = createElement(this.doc, "button", "bl-filter-row__discard");
      discard.setAttribute("type", "button");
      discard.setAttribute("data-filter-discard", filter.id);
      setKeyedText(discard, "common.cancel", messages.text("common.cancel"));
      row.append(apply, discard);
    }
    return row;
  }

  private filterById(document: BoardDocumentV1, filterId: string): FilterDefinition | undefined {
    return (
      this.pendingFilters.get(filterId) ?? document.filters.find((entry) => entry.id === filterId)
    );
  }

  private withResolvedOperator(
    document: BoardDocumentV1,
    filter: FilterDefinition,
  ): FilterDefinition {
    const operators = filterDefinitionOperators(
      document,
      filter,
      this.spaceValue.getValidationCatalog(),
    );
    if (operators.length === 0 || operators.includes(filter.operator)) {
      return filter;
    }
    const operator = operators[0] as FilterOperator;
    const descriptor = documentField(document, filter.field);
    const defaults = filterDefaultFor(descriptor?.type ?? "string", operator, descriptor);
    return withoutUndefined({
      ...filter,
      operator,
      defaultValue: "defaultValue" in defaults ? (defaults.defaultValue as never) : undefined,
      temporal: "temporal" in defaults ? defaults.temporal : undefined,
    });
  }

  private proposedFieldChange(
    document: BoardDocumentV1,
    filter: FilterDefinition,
    field: FieldReference,
  ): FilterDefinition {
    const descriptor = documentField(document, field);
    const mappings = (filter.mappings ?? [])
      .filter((mapping) => {
        const target = documentField(document, mapping.target);
        return target !== undefined && fieldCompatibilityReason(descriptor, target) === null;
      })
      .map((mapping) => ({
        source: { ...field },
        target: { ...mapping.target },
      }));
    const base = withoutUndefined({
      ...filter,
      field,
      mappings: mappings.length === 0 ? undefined : mappings,
      defaultValue: undefined,
      temporal: undefined,
    });
    const operators = filterDefinitionOperators(
      document,
      base,
      this.spaceValue.getValidationCatalog(),
    );
    const fallback = filterOperatorsForField(
      document,
      field,
      this.spaceValue.getValidationCatalog(),
    );
    const operator = operators[0] ?? fallback[0] ?? filter.operator;
    const defaults = filterDefaultFor(descriptor?.type ?? "string", operator, descriptor);
    return withoutUndefined({
      ...base,
      operator,
      defaultValue: "defaultValue" in defaults ? (defaults.defaultValue as never) : undefined,
      temporal: "temporal" in defaults ? defaults.temporal : undefined,
    });
  }

  private mappingChange(
    filter: FilterDefinition,
    datasetId: string,
    fieldId: string,
  ): FilterDefinition {
    const mappings = (filter.mappings ?? []).filter(
      (mapping) => mapping.target.datasetId !== datasetId,
    );
    if (fieldId !== "") {
      mappings.push({
        source: { ...filter.field },
        target: { datasetId, fieldId },
      });
    }
    return withoutUndefined({
      ...filter,
      mappings: mappings.length === 0 ? undefined : mappings,
    });
  }

  private targetChange(filter: FilterDefinition, value: string): FilterDefinition | null {
    let target: FilterTarget;
    if (value === "board") {
      target = { kind: "board" };
    } else if (value.startsWith("group:")) {
      target = { kind: "group", groupId: value.slice("group:".length) };
    } else if (value.startsWith("block:")) {
      target = { kind: "block", blockId: value.slice("block:".length) };
    } else {
      return null;
    }
    return { ...filter, target };
  }

  private resetManagerDiagnostics(): void {
    this.actionDiagnostics = Object.freeze([]);
    const snapshot = this.safeSnapshot();
    if (snapshot?.draft !== null && snapshot?.draft !== undefined) {
      this.viewValue.commands.updateDraft(snapshot.draft.document);
    }
  }

  private submitPendingFilter(filterId: string): void {
    const pending = this.pendingFilters.get(filterId);
    if (pending === undefined) {
      return;
    }
    const updated = this.updateFilterDocument((document) => {
      const exists = document.filters.some((entry) => entry.id === filterId);
      if (exists) {
        return {
          ...document,
          filters: document.filters.map((entry) => (entry.id === filterId ? pending : entry)),
        } as BoardDocumentV1;
      }
      return {
        ...document,
        filters: [...document.filters, pending],
        blocks: document.blocks.map((block) => {
          if (block.type !== "filter") {
            return block;
          }
          const config = block.config as { readonly filterIds?: readonly string[] };
          const filterIds = Array.isArray(config.filterIds)
            ? [...config.filterIds, filterId]
            : [filterId];
          return { ...block, config: { ...block.config, filterIds } };
        }),
      } as BoardDocumentV1;
    });
    if (updated) {
      this.pendingFilters.delete(filterId);
    }
  }

  private applyFilterManagerChange(
    filterId: string,
    control: string,
    target: EventTarget & {
      readonly value?: string;
      readonly checked?: boolean;
      getAttribute?: (name: string) => string | null;
    },
  ): void {
    const value = typeof target.value === "string" ? target.value : "";
    const checked = target.checked === true;
    const datasetId = target.getAttribute?.("data-filter-dataset") ?? null;
    const snapshot = this.safeSnapshot();
    if (snapshot === null) {
      return;
    }
    const document = (snapshot.draft?.document ??
      snapshot.committedDocument) as unknown as BoardDocumentV1;
    const current = this.filterById(document, filterId);
    if (current === undefined) {
      return;
    }
    const pending = this.pendingFilters.has(filterId);
    const setPending = (filter: FilterDefinition): void => {
      this.pendingFilters.set(filterId, this.withResolvedOperator(document, filter));
      this.resetManagerDiagnostics();
      this.scheduleRender();
    };
    if (control === "field") {
      const field = parseBindingFieldValue(value);
      if (field === null) {
        return;
      }
      setPending(this.proposedFieldChange(document, current, field));
      return;
    }
    if (control === "target") {
      const changed = this.targetChange(current, value);
      if (changed === null) {
        return;
      }
      setPending(changed);
      return;
    }
    if (control === "mapping") {
      if (datasetId === null) {
        return;
      }
      setPending(this.mappingChange(current, datasetId, value));
      return;
    }
    if (control === "viewerEditable") {
      if (pending) {
        setPending({ ...current, viewerEditable: checked });
        return;
      }
      this.updateFilterDocument(
        (draft) =>
          ({
            ...draft,
            filters: draft.filters.map((entry) =>
              entry.id === filterId ? { ...entry, viewerEditable: checked } : entry,
            ),
          }) as BoardDocumentV1,
      );
      return;
    }
    const descriptor = documentField(document, current.field);
    if (control === "operator") {
      const operator = value as FilterOperator;
      const defaults = filterDefaultFor(descriptor?.type ?? "string", operator, descriptor);
      const changed = withoutUndefined({
        ...current,
        operator,
        defaultValue: "defaultValue" in defaults ? (defaults.defaultValue as never) : undefined,
        temporal: "temporal" in defaults ? defaults.temporal : undefined,
      });
      if (pending) {
        setPending(changed);
        return;
      }
      this.updateFilterDocument(
        (draft) =>
          ({
            ...draft,
            filters: draft.filters.map((entry) => (entry.id === filterId ? changed : entry)),
          }) as BoardDocumentV1,
      );
      return;
    }
    if (control === "default") {
      const parsed = parseFilterInput(value, descriptor?.type ?? "string", current.operator);
      const changed = withoutUndefined({
        ...current,
        defaultValue: parsed as never,
      });
      if (pending) {
        setPending(changed);
        return;
      }
      this.updateFilterDocument(
        (draft) =>
          ({
            ...draft,
            filters: draft.filters.map((entry) => (entry.id === filterId ? changed : entry)),
          }) as BoardDocumentV1,
      );
    }
  }

  private addFilterDefinition(): void {
    const snapshot = this.safeSnapshot();
    if (snapshot === null) {
      return;
    }
    const document = (snapshot.draft?.document ??
      snapshot.committedDocument) as unknown as BoardDocumentV1;
    const dataBlocks = document.blocks.filter(
      (block) => block.type === "chart" || block.type === "metric" || block.type === "table",
    );
    let selected: {
      readonly datasetId: string;
      readonly field: NonNullable<(typeof document.datasets)[number]["fields"]>[number];
    } | null = null;
    let target: FilterTarget = { kind: "board" };
    for (const block of dataBlocks) {
      for (const binding of block.bindings ?? []) {
        const field = documentField(document, binding.field);
        if (field !== undefined) {
          selected = { datasetId: binding.field.datasetId, field };
          target = { kind: "block", blockId: block.id };
          break;
        }
      }
      if (selected !== null) {
        break;
      }
    }
    if (selected === null) {
      for (const dataset of document.datasets) {
        const field = dataset.fields?.[0];
        if (field !== undefined) {
          selected = { datasetId: dataset.id, field };
          break;
        }
      }
    }
    if (selected === null) {
      return;
    }
    const existing = new Set([
      ...document.filters.map((filter) => filter.id),
      ...this.pendingFilters.keys(),
    ]);
    let id = `filter-${++filterSequence}`;
    while (existing.has(id)) {
      id = `filter-${++filterSequence}`;
    }
    const operators = filterOperatorsForField(
      document,
      { datasetId: selected.datasetId, fieldId: selected.field.id },
      this.spaceValue.getValidationCatalog(),
    );
    const operator = operators[0] ?? "equals";
    const defaults = filterDefaultFor(selected.field.type, operator, selected.field);
    let filter: FilterDefinition = {
      id,
      label: selected.field.id,
      field: { datasetId: selected.datasetId, fieldId: selected.field.id },
      operator,
      ...("defaultValue" in defaults ? { defaultValue: defaults.defaultValue as never } : {}),
      ...("temporal" in defaults ? { temporal: defaults.temporal } : {}),
      viewerEditable: true,
      target,
    };
    const resolvedOperators = filterDefinitionOperators(
      document,
      filter,
      this.spaceValue.getValidationCatalog(),
    );
    const resolvedOperator = resolvedOperators[0] ?? operator;
    if (resolvedOperator !== operator) {
      const resolvedDefaults = filterDefaultFor(
        selected.field.type,
        resolvedOperator,
        selected.field,
      );
      filter = withoutUndefined({
        ...filter,
        operator: resolvedOperator,
        defaultValue:
          "defaultValue" in resolvedDefaults ? (resolvedDefaults.defaultValue as never) : undefined,
        temporal: "temporal" in resolvedDefaults ? resolvedDefaults.temporal : undefined,
      });
    }
    this.pendingFilters.set(id, filter);
    this.resetManagerDiagnostics();
    this.scheduleRender();
  }

  private updateFilterDocument(
    mutate: (document: BoardDocumentV1) => BoardDocumentV1 | null,
  ): boolean {
    const snapshot = this.safeSnapshot();
    if (snapshot === null) {
      return false;
    }
    const source = (snapshot.draft?.document ??
      snapshot.committedDocument) as unknown as BoardDocumentV1;
    const copy = JSON.parse(JSON.stringify(source)) as BoardDocumentV1;
    const next = mutate(copy);
    if (next === null) {
      return false;
    }
    const result = this.viewValue.commands.updateDraft(next);
    if (result.ok) {
      this.actionDiagnostics = Object.freeze([]);
      this.scheduleRender();
      return true;
    }
    this.actionDiagnostics = result.diagnostics;
    this.announceDiagnostics(result.diagnostics);
    this.renderNow();
    return false;
  }

  private createBindingRow(
    block: BoardDocumentV1["blocks"][number],
    slot: BindingSlotDescriptor,
  ): HTMLElement {
    const messages = this.messagesValue;
    const row = createElement(this.doc, "div", "bl-binding-row");
    row.setAttribute("data-binding-block", block.id);
    row.setAttribute("data-binding-slot", slot.slot);
    const labelKey = bindingSlotLabelKey(String(block.type), slot.slot);
    const labelText = messages.text(labelKey);
    const label = createElement(this.doc, "label", "bl-binding-row__label");
    const fieldId = `${this.root.id}-binding-${block.id}-${slot.slot}`.replace(
      /[^A-Za-z0-9_-]/g,
      "-",
    );
    label.setAttribute("for", fieldId);
    setKeyedText(label, labelKey, labelText);
    const field = createElement(this.doc, "select", "bl-binding-control");
    field.id = fieldId;
    field.setAttribute("data-binding-block", block.id);
    field.setAttribute("data-binding-slot", slot.slot);
    field.setAttribute("data-binding-control", "field");
    field.setAttribute("data-binding-mode", slot.locked ? "fixed" : "selectable");
    field.setAttribute("aria-label", labelText);
    if (slot.optional) {
      const none = createElement(this.doc, "option");
      none.value = "";
      none.textContent = messages.text("editor.binding.none");
      none.setAttribute("data-binding-option", "none");
      field.append(none);
    }
    for (const option of slot.fields) {
      const element = createElement(this.doc, "option");
      element.value = bindingFieldValue({
        datasetId: option.datasetId,
        fieldId: option.fieldId,
      });
      element.textContent = option.label ?? option.fieldId;
      element.setAttribute("data-field-id", option.fieldId);
      element.setAttribute("data-option-enabled", String(option.enabled));
      if (!option.enabled) {
        element.disabled = true;
        element.setAttribute("disabled", "");
        if (option.reason !== null) {
          element.setAttribute("data-reason-code", option.reason.code);
          const reasonKey = `diagnostic.${option.reason.code}`;
          element.title = messages.has(reasonKey)
            ? messages.text(reasonKey)
            : option.reason.message;
        }
      }
      field.append(element);
    }
    field.value = bindingFieldValue(slot.selectedField);
    if (slot.locked) {
      field.disabled = true;
      field.setAttribute("disabled", "");
      field.setAttribute("aria-disabled", "true");
    }
    row.append(label, field);

    const mode = createElement(this.doc, "span", "bl-binding-mode");
    const modeKey = slot.locked ? "editor.block.locked" : "editor.block.selectable";
    mode.setAttribute("data-binding-mode", slot.mode);
    setKeyedText(mode, modeKey, messages.text(modeKey));
    row.append(mode);

    if (slot.locked) {
      const hint = createElement(this.doc, "p", "bl-binding-hint");
      setKeyedText(hint, "editor.binding.lockedHint", messages.text("editor.binding.lockedHint"));
      row.append(hint);
    }

    if (slot.slot === "y" && slot.aggregations.length > 0) {
      const aggregationLabel = createElement(this.doc, "label", "bl-binding-row__label");
      const aggregationId = `${fieldId}-aggregation`;
      aggregationLabel.setAttribute("for", aggregationId);
      setKeyedText(
        aggregationLabel,
        "editor.properties.aggregation",
        messages.text("editor.properties.aggregation"),
      );
      const aggregation = createElement(this.doc, "select", "bl-binding-control");
      aggregation.id = aggregationId;
      aggregation.setAttribute("data-binding-block", block.id);
      aggregation.setAttribute("data-binding-slot", slot.slot);
      aggregation.setAttribute("data-binding-control", "aggregation");
      aggregation.setAttribute("data-binding-field", bindingFieldValue(slot.selectedField));
      aggregation.setAttribute("data-binding-mode", slot.locked ? "fixed" : "selectable");
      aggregation.setAttribute("aria-label", messages.text("editor.properties.aggregation"));
      for (const option of slot.aggregations) {
        const element = createElement(this.doc, "option");
        element.value = option.type;
        element.textContent = messages.text(aggregationMessageKey(option.type));
        element.setAttribute("data-aggregation", option.type);
        element.setAttribute("data-option-enabled", String(option.enabled));
        if (!option.enabled) {
          element.disabled = true;
          element.setAttribute("disabled", "");
          if (option.reason !== null) {
            element.setAttribute("data-reason-code", option.reason.code);
            const reasonKey = `diagnostic.${option.reason.code}`;
            element.title = messages.has(reasonKey)
              ? messages.text(reasonKey)
              : option.reason.message;
          }
        }
        aggregation.append(element);
      }
      aggregation.value = slot.selectedAggregation ?? "none";
      if (slot.locked || slot.selectedField === null) {
        aggregation.disabled = true;
        aggregation.setAttribute("disabled", "");
        aggregation.setAttribute("aria-disabled", "true");
      }
      row.append(aggregationLabel, aggregation);
    }
    return row;
  }

  exportDocument(): Result<BoardSerialization> {
    if (!this.publicOperationLive()) {
      return fail([createDiagnostic(DIAGNOSTIC_CODES.VIEW_DISPOSED, "view")]);
    }
    const exported = this.spaceValue.exportDocument();
    if (!exported.ok) {
      this.actionDiagnostics = exported.diagnostics;
      this.announceDiagnostics(exported.diagnostics);
      this.renderNow();
      return exported;
    }
    this.actionDiagnostics = Object.freeze([]);
    this.config.onExport?.("host", exported.value);
    return exported;
  }

  refresh(): void {
    if (!this.publicOperationLive()) {
      return;
    }
    for (const block of this.blockElements.values()) {
      block.signature = null;
      block.queryError = null;
      block.lastBlockSignature = null;
      block.lastMessages = null;
      block.lastContextSignature = null;
      block.lastQueryErrorSignature = null;
    }
    this.actionDiagnostics = Object.freeze([]);
    this.renderNow();
  }

  focus(target: FocusTarget = "content"): Result<void> {
    if (!this.publicOperationLive()) {
      return fail([createDiagnostic(DIAGNOSTIC_CODES.VIEW_DISPOSED, "view")]);
    }
    const element = target === "title" ? this.title : this.body;
    element.focus();
    return ok(undefined);
  }

  unmount(options: { readonly draftDecision?: "apply" | "cancel" | "keep" } = {}): Result<void> {
    if (!this.mountedFlag || this.disposedFlag || this.unmounting) {
      return ok(undefined);
    }
    if (!this.ensureLive()) {
      return ok(undefined);
    }
    this.unmounting = true;
    try {
      if (this.ownsView) {
        const disposedView = this.viewValue.dispose(
          options.draftDecision === undefined ? {} : { draftDecision: options.draftDecision },
        );
        if (!disposedView.ok) {
          return fail(disposedView.diagnostics);
        }
      }
      this.teardown(true);
      return ok(undefined);
    } finally {
      this.unmounting = false;
    }
  }

  dispose(options: { readonly draftDecision?: "apply" | "cancel" | "keep" } = {}): Result<void> {
    return this.unmount(options);
  }

  private ensureLive(): boolean {
    if (this.disposedFlag || !this.mountedFlag) {
      return false;
    }
    if (this.unmounting) {
      return true;
    }
    if (this.viewValue.disposed) {
      this.teardown(this.ownsSpace);
      return false;
    }
    if (this.spaceValue.disposed) {
      this.teardown(false);
      return false;
    }
    return true;
  }

  private publicOperationLive(): boolean {
    if (this.unmounting) {
      return false;
    }
    return this.ensureLive();
  }

  private safeSnapshot(): SpaceSnapshot | null {
    if (this.spaceValue.disposed) {
      return null;
    }
    try {
      return this.spaceValue.getSnapshot();
    } catch {
      return null;
    }
  }

  private ensureMessages(snapshot: SpaceSnapshot): void {
    const provider = this.spaceValue.getMessageProvider();
    if (
      this.messagesValue.locale === snapshot.locale &&
      this.messagesLocale === snapshot.locale &&
      this.messageProvider === provider &&
      this.messageOverrides === this.config.messages
    ) {
      return;
    }
    this.messagesValue = createViewMessages({
      provider,
      ...(this.config.messages === undefined ? {} : { overrides: this.config.messages }),
    });
    this.messagesLocale = this.messagesValue.locale;
    this.messageProvider = provider;
    this.messageOverrides = this.config.messages;
  }

  private deriveRealtimeStatus(): BoardloomRealtimeStatus | null {
    const states: readonly RealtimeSubscriptionState[] = this.spaceValue.disposed
      ? []
      : this.spaceValue.getRealtimeStates();
    if (states.length === 0) {
      return null;
    }
    const info = this.spaceValue.getRealtimeInfo();
    const priority: readonly RealtimeStatus[] = [
      "error",
      "degraded",
      "reconnecting",
      "resyncing",
      "connecting",
      "paused",
      "live",
      "closed",
    ];
    let status: RealtimeStatus = "closed";
    for (const candidate of priority) {
      if (states.some((state) => state.status === candidate)) {
        status = candidate;
        break;
      }
    }
    const bufferedMessages = states.reduce((total, state) => total + state.bufferedMessages, 0);
    const bufferedBytes = states.reduce((total, state) => total + state.bufferedBytes, 0);
    const attempts = states
      .map((state) => state.attempt)
      .filter((attempt) => Number.isInteger(attempt) && attempt > 0);
    const lastUpdate = states.reduce<number | null>((latest, state) => {
      if (state.lastUpdate === null) {
        return latest;
      }
      return latest === null ? state.lastUpdate : Math.max(latest, state.lastUpdate);
    }, null);
    return Object.freeze({
      status,
      ...(attempts.length === 0 ? {} : { attempt: Math.max(...attempts) }),
      maxAttempts: Math.max(...states.map((state) => state.maxAttempts)),
      ...(lastUpdate === null ? {} : { lastUpdate }),
      bufferedMessages,
      bufferedBytes,
      simulated: info?.simulated === true || states.some((state) => state.simulated),
      queryCount: states.length,
    });
  }

  private renderRealtimeStatus(
    snapshot: SpaceSnapshot,
    messages: ViewMessages,
    formatters: FormatterProvider,
  ): void {
    const states = this.spaceValue.disposed ? [] : this.spaceValue.getRealtimeStates();
    const realtimeInfo = this.spaceValue.getRealtimeInfo();
    const status = this.config.realtime ?? this.deriveRealtimeStatus();
    const derived: BoardloomRealtimeStatus = status ?? { status: "historical" };
    const realtime = realtimeText(derived, messages);
    setKeyedText(this.status, realtime.key, realtime.text);
    this.status.setAttribute("data-status", derived.status);
    this.status.setAttribute("aria-label", messages.text("a11y.realtimeStatus"));
    this.status.setAttribute("data-message-key", "a11y.realtimeStatus");
    const simulated = derived.simulated === true || realtimeInfo?.simulated === true;
    if (realtimeInfo === null) {
      this.root.setAttribute("data-boardloom-realtime", "none");
    } else {
      this.root.setAttribute(
        "data-boardloom-realtime",
        realtimeInfo.simulated ? "simulated" : "websocket",
      );
    }
    this.root.setAttribute("data-boardloom-realtime-status", derived.status);
    if (derived.lastUpdate !== undefined && Number.isFinite(derived.lastUpdate)) {
      this.lastUpdate.removeAttribute("hidden");
      setKeyedText(
        this.lastUpdate,
        "viewer.realtime.lastUpdate",
        messages.text("viewer.realtime.lastUpdate", {
          time: formatTimestamp(formatters, derived.lastUpdate, snapshot.timezone),
        }),
        ["time"],
      );
    } else {
      this.lastUpdate.setAttribute("hidden", "");
      this.lastUpdate.textContent = "";
    }
    if ((derived.bufferedMessages ?? 0) > 0) {
      this.realtimeBuffered.removeAttribute("hidden");
      setKeyedText(
        this.realtimeBuffered,
        "viewer.realtime.buffered",
        messages.text("viewer.realtime.buffered", {
          count: derived.bufferedMessages ?? 0,
        }),
        ["count"],
      );
    } else {
      this.realtimeBuffered.setAttribute("hidden", "");
      this.realtimeBuffered.textContent = "";
    }
    if (simulated) {
      this.realtimeSimulated.removeAttribute("hidden");
      setKeyedText(
        this.realtimeSimulated,
        "viewer.realtime.simulated",
        messages.text("viewer.realtime.simulated"),
      );
      this.realtimeSimulated.setAttribute(
        "title",
        messages.text("viewer.realtime.simulatedNotice"),
      );
    } else {
      this.realtimeSimulated.setAttribute("hidden", "");
      this.realtimeSimulated.textContent = "";
      this.realtimeSimulated.removeAttribute("title");
    }
    const available = realtimeInfo !== null && states.length > 0;
    this.realtimeControls.setAttribute("aria-label", messages.text("a11y.realtimeControls"));
    this.realtimeControls.setAttribute("data-message-key", "a11y.realtimeControls");
    const paused = derived.status === "paused";
    const pauseKey = paused ? "viewer.realtime.resume" : "viewer.realtime.pause";
    const pauseA11y = paused ? "a11y.realtimeResume" : "a11y.realtimePause";
    setKeyedText(this.realtimePause, pauseKey, messages.text(pauseKey));
    this.realtimePause.setAttribute("aria-label", messages.text(pauseA11y));
    this.realtimePause.setAttribute("data-paused", String(paused));
    setKeyedText(
      this.realtimeResync,
      "viewer.realtime.resync",
      messages.text("viewer.realtime.resync"),
    );
    this.realtimeResync.setAttribute("aria-label", messages.text("a11y.realtimeResync"));
    if (available) {
      this.realtimeControls.removeAttribute("hidden");
      this.realtimePause.removeAttribute("disabled");
      this.realtimeResync.removeAttribute("disabled");
    } else {
      this.realtimeControls.setAttribute("hidden", "");
      this.realtimePause.setAttribute("disabled", "");
      this.realtimeResync.setAttribute("disabled", "");
    }
  }

  private toggleRealtimePause(): void {
    if (this.disposedFlag || !this.mountedFlag) {
      return;
    }
    const states = this.spaceValue.disposed ? [] : this.spaceValue.getRealtimeStates();
    const paused = states.length > 0 && states.every((state) => state.status === "paused");
    const result = paused ? this.spaceValue.resumeRealtime() : this.spaceValue.pauseRealtime();
    if (!result.ok) {
      this.actionDiagnostics = result.diagnostics;
      this.announceDiagnostics(result.diagnostics);
    }
    this.scheduleRender();
  }

  private requestRealtimeResync(): void {
    if (this.disposedFlag || !this.mountedFlag) {
      return;
    }
    const result = this.spaceValue.resyncRealtime(undefined, "viewer-request");
    if (!result.ok) {
      this.actionDiagnostics = result.diagnostics;
      this.announceDiagnostics(result.diagnostics);
    }
    this.scheduleRender();
  }

  private runViewCommand(operation: () => Result<unknown>): void {
    if (!this.publicOperationLive()) {
      return;
    }
    this.exportNoticeKey = null;
    const result = operation();
    if (!this.ensureLive()) {
      return;
    }
    if (result.ok) {
      this.actionDiagnostics = Object.freeze([]);
      this.scheduleRender();
      return;
    }
    this.actionDiagnostics = result.diagnostics;
    this.announceDiagnostics(result.diagnostics);
    this.renderNow();
  }

  private activeEditorLease(): EditorLease | null {
    const view = this.viewValue.getSnapshot();
    if (view.leaseId === null) {
      return null;
    }
    const space = this.safeSnapshot();
    const lease = space?.editorLease ?? null;
    return lease !== null && lease.leaseId === view.leaseId ? lease : null;
  }

  private handleDraftAction(action: string): void {
    this.exportNoticeKey = null;
    if (action === "undo") {
      this.runViewCommand(() => this.viewValue.commands.undo());
      return;
    }
    if (action === "redo") {
      this.runViewCommand(() => this.viewValue.commands.redo());
      return;
    }
    if (action === "preview") {
      this.setMode("viewer");
      return;
    }
    if (action === "apply") {
      const result = this.viewValue.commands.applyDraft();
      if (result.ok) {
        this.actionDiagnostics = Object.freeze([]);
        this.announceKey("editor.draft.applied");
        this.scheduleRender();
        return;
      }
      this.actionDiagnostics = result.diagnostics;
      this.announceDiagnostics(result.diagnostics);
      this.renderNow();
      return;
    }
    const snapshot = this.safeSnapshot();
    const draft = snapshot?.draft ?? null;
    if (action === "discard") {
      if (draft !== null && draft.dirty) {
        this.requestConfirmation("discard");
      }
      return;
    }
    if (action === "release") {
      if (draft !== null && draft.dirty) {
        this.requestConfirmation("release");
        return;
      }
      this.releaseEditorLease("cancel");
    }
  }

  private requestConfirmation(kind: EditorConfirmation): void {
    this.pendingConfirmation = kind;
    this.scheduleRender();
  }

  private handleConfirmation(action: string): void {
    if (action === "cancel") {
      this.pendingConfirmation = null;
      this.scheduleRender();
      return;
    }
    const pending = this.pendingConfirmation;
    this.pendingConfirmation = null;
    if (pending === "discard") {
      this.runViewCommand(() => this.viewValue.commands.cancelDraft());
      return;
    }
    if (pending === "release") {
      this.releaseEditorLease("cancel");
      return;
    }
    this.scheduleRender();
  }

  private releaseEditorLease(decision: "apply" | "cancel"): void {
    const lease = this.activeEditorLease();
    if (lease === null) {
      this.setMode("viewer");
      return;
    }
    const result = this.spaceValue.releaseEditorLease(lease, { decision });
    if (result.ok) {
      this.actionDiagnostics = Object.freeze([]);
      this.viewValue.setMode("viewer");
      this.selectedBlockId = null;
      this.announceKey(decision === "apply" ? "editor.draft.applied" : "editor.draft.cancelled");
      this.scheduleRender();
      return;
    }
    this.actionDiagnostics = result.diagnostics;
    this.announceDiagnostics(result.diagnostics);
    this.renderNow();
  }

  private addEditorBlock(type: string): void {
    const result = this.viewValue.commands.addBlock(type);
    if (!result.ok) {
      this.actionDiagnostics = result.diagnostics;
      this.announceDiagnostics(result.diagnostics);
      this.renderNow();
      return;
    }
    this.actionDiagnostics = Object.freeze([]);
    const blocks = result.value.document.blocks as unknown as
      readonly { readonly id: string }[] | undefined;
    const added = blocks?.at(-1);
    this.selectedBlockId = added === undefined ? this.selectedBlockId : added.id;
    this.scheduleRender();
  }

  private selectEditorBlock(blockId: string | null): void {
    this.selectedBlockId = blockId;
    if (
      blockId !== null &&
      this.root.getAttribute("data-boardloom-breakpoint") === "narrow" &&
      this.viewValue.mode === "editor"
    ) {
      this.setDrawer("inspector", true);
    }
    this.scheduleRender();
  }

  private applyBlockAction(blockId: string, action: string, element: HTMLElement): void {
    const breakpoint =
      (element.getAttribute("data-block-breakpoint") as BoardBreakpoint | null) ??
      this.selectedBreakpoint;
    if (action === "select") {
      this.selectEditorBlock(blockId);
      return;
    }
    if (action === "duplicate") {
      this.runViewCommand(() => this.viewValue.commands.duplicateBlock(blockId));
      return;
    }
    if (action === "delete") {
      this.runViewCommand(() => this.viewValue.commands.deleteBlock(blockId));
      if (this.selectedBlockId === blockId) {
        this.selectedBlockId = null;
      }
      return;
    }
    const rememberFocus = (): void => {
      this.pendingActionFocus = Object.freeze({
        action,
        target: blockId,
        breakpoint,
      });
    };
    if (action === "earlier" || action === "later") {
      rememberFocus();
      this.runViewCommand(() => this.viewValue.commands.reorderBlock(blockId, action));
      return;
    }
    if (action === "reset") {
      rememberFocus();
      this.runViewCommand(() => this.viewValue.commands.resetBlock(blockId));
      return;
    }
    const moves: Record<string, { readonly dx?: number; readonly dy?: number }> = {
      up: { dy: -1 },
      down: { dy: 1 },
      left: { dx: -1 },
      right: { dx: 1 },
    };
    const move = Object.hasOwn(moves, action) ? moves[action] : undefined;
    if (move !== undefined) {
      rememberFocus();
      this.runViewCommand(() =>
        this.viewValue.commands.moveBlock(blockId, { breakpoint, ...move }),
      );
      return;
    }
    const resizes: Record<string, { readonly dw?: number; readonly dh?: number }> = {
      wider: { dw: 1 },
      narrower: { dw: -1 },
      taller: { dh: 1 },
      shorter: { dh: -1 },
    };
    const resize = Object.hasOwn(resizes, action) ? resizes[action] : undefined;
    if (resize !== undefined) {
      rememberFocus();
      this.runViewCommand(() =>
        this.viewValue.commands.resizeBlock(blockId, { breakpoint, ...resize }),
      );
    }
  }

  private setDrawer(which: "library" | "inspector" | null, open: boolean): void {
    if (which === "library") {
      this.libraryOpen = open;
      if (open) {
        this.inspectorOpen = false;
        this.drawerTrigger = this.libraryToggle;
      }
    } else if (which === "inspector") {
      this.inspectorOpen = open;
      if (open) {
        this.libraryOpen = false;
        this.drawerTrigger = this.inspectorToggle;
      }
    } else {
      this.libraryOpen = false;
      this.inspectorOpen = false;
    }
    this.scheduleRender();
    if (open) {
      queueMicrotask(() => {
        if (this.disposedFlag || !this.mountedFlag) {
          return;
        }
        const panel = which === "inspector" ? this.inspector : this.library;
        const focusable = panel.querySelector<HTMLElement>(
          "button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])",
        );
        focusable?.focus();
      });
    } else if (which === null) {
      this.restoreDrawerFocus();
    }
  }

  private restoreDrawerFocus(): void {
    const trigger = this.drawerTrigger;
    this.drawerTrigger = null;
    if (trigger !== null) {
      trigger.focus();
    }
  }

  private applyThemeEditor(): void {
    const mode = this.themeModeSelect?.value;
    if (mode !== "light" && mode !== "dark" && mode !== "system") {
      return;
    }
    const tokens = Object.create(null) as Record<string, string>;
    for (const [name, input] of this.themeTokenInputs) {
      if (!this.pendingRemovedThemeTokens.has(name)) {
        tokens[name] = input.value;
      }
    }
    const customName = this.themeTokenNameInput?.value.trim() ?? "";
    const customValue = this.themeTokenValueInput?.value ?? "";
    if (customName !== "") {
      tokens[customName] = customValue;
    }
    const result = this.viewValue.commands.setTheme({
      mode,
      tokens,
      removeTokens: [...this.pendingRemovedThemeTokens],
    });
    if (result.ok) {
      this.pendingRemovedThemeTokens.clear();
      this.actionDiagnostics = Object.freeze([]);
      this.scheduleRender();
      return;
    }
    this.actionDiagnostics = result.diagnostics;
    this.announceDiagnostics(result.diagnostics);
    this.renderNow();
  }

  private exportEditorDocument(): void {
    const dirty = this.safeSnapshot()?.draft?.dirty ?? false;
    const exported = this.spaceValue.exportDocument();
    if (!exported.ok) {
      this.actionDiagnostics = exported.diagnostics;
      this.announceDiagnostics(exported.diagnostics);
      this.renderNow();
      return;
    }
    this.actionDiagnostics = Object.freeze([]);
    this.exportNoticeKey = dirty ? "editor.export.draftExcluded" : null;
    this.announceKey(dirty ? "editor.export.draftExcluded" : "editor.export.done");
    this.config.onExport?.("ui", exported.value);
    const viewWindow = this.doc.defaultView as
      | (Window & {
          readonly URL?: {
            createObjectURL?: (blob: Blob) => string;
            revokeObjectURL?: (url: string) => void;
          };
        })
      | null;
    const urlApi = viewWindow?.URL;
    if (
      typeof urlApi?.createObjectURL === "function" &&
      typeof urlApi.revokeObjectURL === "function" &&
      typeof Blob === "function"
    ) {
      const blob = new Blob([exported.value.canonical], { type: "application/json" });
      const url = urlApi.createObjectURL(blob);
      const link = createElement(this.doc, "a", "bl-visually-hidden");
      link.href = url;
      link.download = `${String(exported.value.document.id)}.json`;
      this.root.append(link);
      link.click();
      link.remove();
      urlApi.revokeObjectURL(url);
    }
    this.scheduleRender();
  }

  private async importSelectedFile(): Promise<void> {
    const importer = this.config.onImportDocument;
    if (importer === undefined) {
      return;
    }
    const files = this.importInput.files;
    const file = files?.[0];
    if (file === undefined) {
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch (error) {
      if (!this.publicOperationLive()) {
        return;
      }
      this.actionDiagnostics = failureFrom(error, "import");
      this.announceDiagnostics(this.actionDiagnostics);
      this.renderNow();
      return;
    }
    if (!this.publicOperationLive()) {
      return;
    }
    const result = importer(text, file.name);
    this.importInput.value = "";
    if (!result.ok) {
      this.actionDiagnostics = result.diagnostics;
      this.announceDiagnostics(result.diagnostics);
      this.renderNow();
      return;
    }
    this.actionDiagnostics = Object.freeze([]);
    this.scheduleRender();
  }

  private announceKey(key: string): void {
    if (!this.messagesValue.has(key)) {
      return;
    }
    this.liveRegion.textContent = this.messagesValue.text(key);
    this.liveRegion.setAttribute("data-announcement-key", key);
    this.liveRegion.removeAttribute("data-severity");
  }

  private renderEditorShell(snapshot: SpaceSnapshot, messages: ViewMessages): void {
    const editorMode = this.viewValue.mode === "editor" && this.activeEditorLease() !== null;
    setHidden(this.draftBar, !editorMode);
    this.draftBar.setAttribute("data-editor-mode", String(editorMode));
    setHidden(this.library, !editorMode);
    setHidden(this.inspector, !editorMode);
    setHidden(this.libraryToggle, !editorMode);
    setHidden(this.inspectorToggle, !editorMode);
    setHidden(this.exportButton, false);
    setHidden(this.importButton, this.config.onImportDocument === undefined);
    setKeyedText(this.importButton, "editor.import", messages.text("editor.import"));
    setKeyedText(
      this.exportButton,
      "editor.exportCommitted",
      messages.text("editor.exportCommitted"),
    );
    setKeyedText(this.libraryToggle, "editor.library", messages.text("editor.library"));
    setKeyedText(this.inspectorToggle, "editor.inspector", messages.text("editor.inspector"));
    setKeyedLabel(this.library, "a11y.libraryRegion", messages.text("a11y.libraryRegion"));
    setKeyedLabel(this.inspector, "a11y.inspectorRegion", messages.text("a11y.inspectorRegion"));
    setKeyedLabel(this.canvasTools, "editor.panels", messages.text("editor.panels"));
    this.root.setAttribute("data-library-open", String(this.libraryOpen));
    this.root.setAttribute("data-inspector-open", String(this.inspectorOpen));
    this.libraryToggle.setAttribute("aria-expanded", String(this.libraryOpen));
    this.inspectorToggle.setAttribute("aria-expanded", String(this.inspectorOpen));
    this.library.setAttribute("data-open", String(this.libraryOpen));
    this.inspector.setAttribute("data-open", String(this.inspectorOpen));
    const narrow = this.root.getAttribute("data-boardloom-breakpoint") === "narrow";
    const inspectorModal = narrow && editorMode && this.inspectorOpen;
    if (inspectorModal) {
      this.inspector.setAttribute("role", "dialog");
      this.inspector.setAttribute("aria-modal", "true");
    } else {
      this.inspector.setAttribute("role", "region");
      this.inspector.removeAttribute("aria-modal");
    }
    const scrimVisible = narrow && (this.libraryOpen || this.inspectorOpen);
    setHidden(this.drawerScrim, !scrimVisible);
    setHidden(this.inspectorDraftFooter, !inspectorModal);
    setHidden(this.inspector, !editorMode);
    this.setModalBackgroundInert(inspectorModal);
    if (inspectorModal) {
      this.inspectorDraftFooter.append(this.confirmation);
    } else {
      this.draftBar.append(this.confirmation);
    }
    if (!editorMode) {
      this.libraryOpen = false;
      this.inspectorOpen = false;
    }
    this.renderDraftBar(snapshot, messages);
    this.renderLibrary(messages);
  }

  private renderDraftBar(snapshot: SpaceSnapshot, messages: ViewMessages): void {
    const draft = snapshot.draft;
    const dirty = draft?.dirty ?? false;
    const lease = this.activeEditorLease();
    const statusKey = dirty ? "draft.dirty" : "draft.clean";
    setKeyedText(this.draftStatus, statusKey, messages.text(statusKey));
    this.draftStatus.setAttribute("data-dirty", String(dirty));
    this.draftBar.setAttribute("data-dirty", String(dirty));
    const edits = draft?.revision ?? 0;
    const detailText = messages.plural("editor.draft.edits", edits);
    setKeyedText(this.draftDetail, pluralKey(messages, "editor.draft.edits", edits), detailText, [
      "count",
    ]);
    this.draftDetail.setAttribute("data-revision", draft === null ? "0" : String(draft.revision));
    setKeyedText(this.undoButton, "common.undo", messages.text("common.undo"));
    setKeyedText(this.redoButton, "common.redo", messages.text("common.redo"));
    setKeyedText(this.applyButton, "common.apply", messages.text("common.apply"));
    setKeyedText(this.discardButton, "editor.draft.discard", messages.text("editor.draft.discard"));
    setKeyedText(
      this.previewButton,
      "editor.previewAsViewer",
      messages.text("editor.previewAsViewer"),
    );
    setKeyedText(this.releaseButton, "editor.lease.release", messages.text("editor.lease.release"));
    setKeyedText(this.sheetApplyButton, "common.apply", messages.text("common.apply"));
    setKeyedText(
      this.sheetDiscardButton,
      "editor.draft.discard",
      messages.text("editor.draft.discard"),
    );
    setKeyedText(this.sheetDraftStatus, statusKey, messages.text(statusKey));
    setDisabled(this.sheetApplyButton, draft === null);
    setDisabled(this.sheetDiscardButton, !dirty);
    this.sheetDraftStatus.setAttribute("data-dirty", String(dirty));
    setDisabled(this.undoButton, !(draft?.canUndo ?? false));
    setDisabled(this.redoButton, !(draft?.canRedo ?? false));
    setDisabled(this.applyButton, draft === null);
    setDisabled(this.discardButton, !dirty);
    setDisabled(this.previewButton, lease === null);
    setDisabled(this.releaseButton, lease === null);
    this.draftBar.setAttribute("data-lease", lease === null ? "none" : "held");
    setKeyedText(this.confirmationCancel, "common.cancel", messages.text("common.cancel"));
    setKeyedText(
      this.confirmationApply,
      "editor.draft.confirmApply",
      messages.text("editor.draft.confirmApply"),
    );
    const confirmationVisible = this.pendingConfirmation !== null;
    setHidden(this.confirmation, !confirmationVisible);
    if (confirmationVisible) {
      const key =
        this.pendingConfirmation === "release"
          ? "editor.draft.confirmRelease"
          : "editor.draft.confirmDiscard";
      setKeyedText(this.confirmationText, key, messages.text(key));
    }
    const notice =
      this.actionDiagnostics[0]?.message ??
      (this.exportNoticeKey === null ? "" : messages.text(this.exportNoticeKey));
    if (notice === "") {
      setHidden(this.editorNotice, true);
      this.editorNotice.textContent = "";
      this.editorNotice.removeAttribute("data-message-key");
    } else {
      setHidden(this.editorNotice, false);
      this.editorNotice.textContent = notice;
      if (this.actionDiagnostics[0] === undefined && this.exportNoticeKey !== null) {
        this.editorNotice.setAttribute("data-message-key", this.exportNoticeKey);
      } else {
        this.editorNotice.removeAttribute("data-message-key");
      }
    }
  }

  private renderLibrary(messages: ViewMessages): void {
    const query = this.librarySearch.value.trim().toLowerCase();
    clearElement(this.libraryList);
    const definitions = this.registry.list();
    const groups = new Map<string, BlockTypeDefinition[]>();
    for (const definition of definitions) {
      const group = editorLibraryGroup(definition.type);
      const entries = groups.get(group) ?? [];
      entries.push(definition);
      groups.set(group, entries);
    }
    let shown = 0;
    for (const [group, entries] of groups) {
      const groupEntries = entries.filter((definition) => {
        const label = editorLibraryLabel(messages, definition.type);
        return query === "" || label.toLowerCase().includes(query);
      });
      if (groupEntries.length === 0) {
        continue;
      }
      const section = createElement(this.doc, "section", "bl-library__group");
      const heading = createElement(this.doc, "h3", "bl-library__group-title");
      const groupKey = `editor.library.${group}`;
      setKeyedText(heading, groupKey, messages.has(groupKey) ? messages.text(groupKey) : group);
      section.append(heading);
      for (const definition of groupEntries) {
        const label = editorLibraryLabel(messages, definition.type);
        const button = createElement(this.doc, "button", "bl-library__item");
        button.setAttribute("type", "button");
        button.setAttribute("data-editor-add", definition.type);
        const labelKey = `editor.library.${definition.type}.name`;
        if (messages.has(labelKey)) {
          setKeyedText(button, labelKey, label);
        } else {
          setHostText(button, label);
          button.setAttribute("data-message-key", "editor.library.add");
        }
        const icon = createElement(this.doc, "span", "bl-library__icon");
        icon.setAttribute("aria-hidden", "true");
        icon.textContent = editorLibraryIcon(definition.type);
        const text = createElement(this.doc, "span", "bl-library__label");
        text.textContent = label;
        button.append(icon, text);
        section.append(button);
        shown += 1;
      }
      this.libraryList.append(section);
    }
    if (shown === 0) {
      const none = createElement(this.doc, "p", "bl-library__empty");
      setKeyedText(none, "editor.library.noResults", messages.text("editor.library.noResults"));
      this.libraryList.append(none);
    }
  }

  private renderSelectedBlock(document: BoardDocumentV1, messages: ViewMessages): void {
    const block = document.blocks.find((entry) => entry.id === this.selectedBlockId);
    if (block === undefined) {
      const empty = createElement(this.doc, "p", "bl-inspector__empty");
      setKeyedText(empty, "editor.inspector.empty", messages.text("editor.inspector.empty"));
      this.inspectorBody.append(empty);
      return;
    }
    const section = createElement(this.doc, "section", "bl-inspector-section");
    const heading = createElement(this.doc, "h3", "bl-inspector-section__title");
    setHostText(heading, block.title ?? block.id);
    const titleField = createElement(this.doc, "div", "bl-field");
    const titleLabel = createElement(this.doc, "label", "bl-label");
    const inputId = `${this.root.id}-block-title`;
    titleLabel.setAttribute("for", inputId);
    setKeyedText(titleLabel, "editor.properties.title", messages.text("editor.properties.title"));
    const titleInput = createElement(this.doc, "input", "bl-input");
    titleInput.id = inputId;
    titleInput.value = block.title ?? "";
    titleInput.setAttribute("data-editor-title", "true");
    titleInput.setAttribute("data-block-target", block.id);
    titleField.append(titleLabel, titleInput);
    const meta = createElement(this.doc, "p", "bl-inspector__meta");
    setHostText(meta, `${block.type} · ${block.id}`);
    const contentFields: HTMLElement[] = [];
    if (block.type === "text") {
      const textField = createElement(this.doc, "div", "bl-field");
      const textLabel = createElement(this.doc, "label", "bl-label");
      const textId = `${this.root.id}-block-text`;
      textLabel.setAttribute("for", textId);
      setKeyedText(textLabel, "editor.properties.text", messages.text("editor.properties.text"));
      const textArea = createElement(this.doc, "textarea", "bl-textarea");
      textArea.id = textId;
      textArea.value = typeof block.config.text === "string" ? block.config.text : "";
      textArea.setAttribute("data-editor-text", "true");
      textArea.setAttribute("data-block-target", block.id);
      textField.append(textLabel, textArea);
      contentFields.push(textField);
    }
    const builtIn = (BOARD_BLOCK_TYPES as readonly string[]).includes(block.type);
    if (!builtIn) {
      const configField = createElement(this.doc, "div", "bl-field");
      const configLabel = createElement(this.doc, "label", "bl-label");
      const configId = `${this.root.id}-block-config`;
      configLabel.setAttribute("for", configId);
      setKeyedText(
        configLabel,
        "editor.properties.config",
        messages.text("editor.properties.config"),
      );
      const configArea = createElement(this.doc, "textarea", "bl-textarea");
      configArea.id = configId;
      configArea.value = JSON.stringify(block.config, null, 2);
      configArea.setAttribute("data-editor-config", "true");
      configArea.setAttribute("data-block-target", block.id);
      configField.append(configLabel, configArea);
      contentFields.push(configField);
    }
    const actions = createElement(this.doc, "div", "bl-inspector__actions");
    for (const [action, key] of [
      ["duplicate", "editor.block.duplicate"],
      ["earlier", "editor.block.moveEarlier"],
      ["later", "editor.block.moveLater"],
      ["delete", "editor.block.delete"],
    ] as const) {
      const button = createElement(this.doc, "button", "bl-button bl-button--sm");
      button.setAttribute("type", "button");
      button.setAttribute("data-block-action", action);
      button.setAttribute("data-block-target", block.id);
      setKeyedText(button, key, messages.text(key));
      actions.append(button);
    }
    const reset = createElement(this.doc, "button", "bl-button bl-button--danger bl-button--sm");
    reset.setAttribute("type", "button");
    reset.setAttribute("data-editor-reset", "true");
    setKeyedText(reset, "editor.block.resetDefaults", messages.text("editor.block.resetDefaults"));
    section.append(heading, titleField, ...contentFields, meta, actions, reset);
    this.inspectorBody.append(section);
    this.inspectorBody.append(this.createLayoutSection(block, document, messages));
  }

  private createLayoutSection(
    block: BlockDefinition,
    document: BoardDocumentV1,
    messages: ViewMessages,
  ): HTMLElement {
    const section = createElement(this.doc, "section", "bl-inspector-section");
    const heading = createElement(this.doc, "h3", "bl-inspector-section__title");
    setKeyedText(heading, "editor.inspector.layout", messages.text("editor.inspector.layout"));
    const placement = document.layout[this.selectedBreakpoint]?.placements.find(
      (entry) => entry.blockId === block.id,
    );
    const summary = createElement(this.doc, "p", "bl-inspector__meta");
    summary.textContent =
      placement === undefined
        ? messages.text("editor.block.keyboardHintShort")
        : `x ${placement.x} · y ${placement.y} · ${placement.width} × ${placement.height}`;
    const pad = createElement(this.doc, "div", "bl-keyboard-pad");
    pad.setAttribute("role", "group");
    setKeyedLabel(pad, "editor.block.move", messages.text("editor.block.move"));
    const moveSymbols: Record<string, string> = { up: "↑", left: "←", down: "↓", right: "→" };
    for (const [action, key] of [
      ["up", "editor.block.moveUp"],
      ["left", "editor.block.moveLeft"],
      ["down", "editor.block.moveDown"],
      ["right", "editor.block.moveRight"],
    ] as const) {
      const button = createElement(this.doc, "button", "bl-keyboard-pad__button");
      button.setAttribute("type", "button");
      button.setAttribute("data-block-action", action);
      button.setAttribute("data-block-target", block.id);
      button.setAttribute("data-block-breakpoint", this.selectedBreakpoint);
      setKeyedLabel(button, key, messages.text(key));
      button.textContent = moveSymbols[action] ?? action;
      pad.append(button);
    }
    const resize = createElement(this.doc, "div", "bl-resize-actions");
    for (const [action, key] of [
      ["narrower", "editor.block.narrower"],
      ["wider", "editor.block.wider"],
      ["shorter", "editor.block.shorter"],
      ["taller", "editor.block.taller"],
    ] as const) {
      const button = createElement(this.doc, "button", "bl-button bl-button--sm");
      button.setAttribute("type", "button");
      button.setAttribute("data-block-action", action);
      button.setAttribute("data-block-target", block.id);
      button.setAttribute("data-block-breakpoint", this.selectedBreakpoint);
      setKeyedText(button, key, messages.text(key));
      resize.append(button);
    }
    const hint = createElement(this.doc, "p", "bl-keyboard-hint");
    setKeyedText(
      hint,
      "editor.block.keyboardHintShort",
      messages.text("editor.block.keyboardHintShort"),
    );
    section.append(heading, summary, pad, resize, hint);
    return section;
  }

  private createThemeEditor(document: BoardDocumentV1, messages: ViewMessages): HTMLElement {
    const section = createElement(this.doc, "section", "bl-inspector-section bl-theme-editor");
    const heading = createElement(this.doc, "h3", "bl-inspector-section__title");
    setKeyedText(heading, "editor.theme", messages.text("editor.theme"));
    const modeField = createElement(this.doc, "div", "bl-field");
    const modeLabel = createElement(this.doc, "label", "bl-label");
    modeLabel.setAttribute("for", `${this.root.id}-theme-mode`);
    setKeyedText(modeLabel, "editor.theme.mode", messages.text("editor.theme.mode"));
    const modeSelect = createElement(this.doc, "select", "bl-select");
    modeSelect.id = `${this.root.id}-theme-mode`;
    modeSelect.setAttribute("data-theme-control", "mode");
    for (const mode of THEME_MODES) {
      const option = createElement(this.doc, "option");
      option.value = mode;
      setKeyedText(option, `theme.${mode}`, messages.text(`theme.${mode}`));
      modeSelect.append(option);
    }
    modeSelect.value = document.theme.mode;
    this.themeModeSelect = modeSelect;
    modeField.append(modeLabel, modeSelect);
    this.themeTokenInputs.clear();
    const tokenControls: HTMLElement[] = [];
    const tokens = document.theme.tokens ?? {};
    for (const name of Object.getOwnPropertyNames(tokens).sort()) {
      const row = createElement(this.doc, "div", "bl-theme-token");
      const id = `${this.root.id}-theme-${name}`.replace(/[^A-Za-z0-9_-]/g, "-");
      const label = createElement(this.doc, "label", "bl-label");
      label.setAttribute("for", id);
      setHostText(label, name);
      const input = createElement(this.doc, "input", "bl-input");
      input.id = id;
      input.value = tokens[name] ?? "";
      input.setAttribute("data-theme-control", "token");
      input.setAttribute("data-theme-token", name);
      this.themeTokenInputs.set(name, input);
      const remove = createElement(this.doc, "button", "bl-icon-button");
      remove.setAttribute("type", "button");
      remove.setAttribute("data-theme-remove-token", name);
      setKeyedLabel(
        remove,
        "editor.theme.removeToken",
        messages.text("editor.theme.removeToken", { token: name }),
      );
      remove.textContent = "×";
      row.append(label, input, remove);
      tokenControls.push(row);
    }
    if (tokenControls.length === 0) {
      const empty = createElement(this.doc, "p", "bl-inspector__meta");
      setKeyedText(empty, "editor.theme.noTokens", messages.text("editor.theme.noTokens"));
      tokenControls.push(empty);
    }
    const customField = createElement(this.doc, "div", "bl-field bl-field--inline");
    const customName = createElement(this.doc, "input", "bl-input");
    customName.setAttribute("data-theme-control", "token-name");
    customName.setAttribute("placeholder", messages.text("editor.theme.tokenName"));
    customName.setAttribute("aria-label", messages.text("editor.theme.tokenName"));
    setKeyedText(customName, "editor.theme.tokenName", messages.text("editor.theme.tokenName"));
    const customValue = createElement(this.doc, "input", "bl-input");
    customValue.setAttribute("data-theme-control", "token-value");
    customValue.setAttribute("placeholder", messages.text("editor.theme.tokenValue"));
    customValue.setAttribute("aria-label", messages.text("editor.theme.tokenValue"));
    setKeyedText(customValue, "editor.theme.tokenValue", messages.text("editor.theme.tokenValue"));
    this.themeTokenNameInput = customName;
    this.themeTokenValueInput = customValue;
    customField.append(customName, customValue);
    const apply = createElement(this.doc, "button", "bl-button bl-button--sm");
    apply.setAttribute("type", "button");
    apply.setAttribute("data-theme-action", "apply");
    setKeyedText(apply, "editor.theme.apply", messages.text("editor.theme.apply"));
    section.append(heading, modeField, ...tokenControls, customField, apply);
    return section;
  }

  private renderNow(): void {
    this.renderScheduled = false;
    if (!this.ensureLive()) {
      return;
    }
    const snapshot = this.safeSnapshot();
    if (snapshot === null) {
      this.teardown(false);
      return;
    }
    this.ensureMessages(snapshot);
    if (!this.ensureLive()) {
      return;
    }
    const messages = this.messagesValue;
    const width = this.target.clientWidth > 0 ? this.target.clientWidth : 1280;
    this.selectedBreakpoint = breakpointFor(width);
    const committedDocument = snapshot.committedDocument as unknown as BoardDocumentV1;
    const draftDocument = snapshot.draft?.document as unknown as BoardDocumentV1 | undefined;
    const document =
      this.viewValue.mode === "editor" ? (draftDocument ?? committedDocument) : committedDocument;
    const inspectorFocus = this.captureInspectorFocus();
    const bindingFocus = this.captureBindingFocus();
    const formatters = this.spaceValue.getFormatters();
    if (!this.ensureLive()) {
      return;
    }
    const theme = this.config.theme ?? documentTheme(document);
    this.root.setAttribute("data-boardloom-theme", theme);
    this.root.setAttribute("lang", snapshot.locale);
    this.root.setAttribute("dir", messages.direction);
    this.root.setAttribute("data-boardloom-mode", this.viewValue.mode);
    this.root.setAttribute("data-boardloom-locale", snapshot.locale);
    this.root.setAttribute("data-boardloom-timezone", snapshot.timezone);
    setKeyedLabel(this.body, "a11y.boardRegion", messages.text("a11y.boardRegion"));
    setKeyedLabel(this.filterSection, "a11y.filterRegion", messages.text("a11y.filterRegion"));
    setKeyedLabel(this.liveRegion, "a11y.liveRegion", messages.text("a11y.liveRegion"));
    setKeyedText(
      this.filterHeading,
      "viewer.filters.active",
      messages.text("viewer.filters.active"),
    );
    this.applyDocumentThemeTokens(document);

    setKeyedText(this.skipLink, "a11y.skipToContent", messages.text("a11y.skipToContent"));
    const titleText =
      typeof document.title === "string" && document.title.trim() !== ""
        ? document.title
        : messages.text("board.untitled");
    if (typeof document.title === "string" && document.title.trim() !== "") {
      setHostText(this.title, titleText);
    } else {
      setKeyedText(this.title, "board.untitled", titleText);
    }
    const description = typeof document.description === "string" ? document.description.trim() : "";
    if (description === "") {
      this.description.setAttribute("hidden", "");
      this.description.textContent = "";
    } else {
      this.description.removeAttribute("hidden");
      setHostText(this.description, description);
    }
    const provenance =
      typeof this.config.provenance === "string" ? this.config.provenance.trim() : "";
    if (provenance === "") {
      this.hostLabel.setAttribute("hidden", "");
      this.hostLabel.textContent = "";
    } else {
      this.hostLabel.removeAttribute("hidden");
      setHostText(this.hostLabel, provenance);
    }
    const updatedText = formatTimestamp(formatters, document.updatedAt, snapshot.timezone);
    setKeyedText(
      this.metaUpdated,
      "viewer.meta.updated",
      messages.text("viewer.meta.updated", { time: updatedText }),
      ["time"],
    );
    setKeyedText(
      this.metaTimezone,
      "viewer.meta.timezone",
      messages.text("viewer.meta.timezone", { timezone: snapshot.timezone }),
      ["timezone"],
    );
    setKeyedLabel(this.modeNavigation, "a11y.modeNavigation", messages.text("a11y.modeNavigation"));
    for (const [button, mode, key] of [
      [this.viewerModeButton, "viewer", "mode.viewer"],
      [this.editorModeButton, "editor", "mode.editor"],
    ] as const) {
      setKeyedText(button, key, messages.text(key));
      button.setAttribute("aria-pressed", String(this.viewValue.mode === mode));
      button.setAttribute("data-active", String(this.viewValue.mode === mode));
    }

    this.renderRealtimeStatus(snapshot, messages, formatters);

    const diagnostics = dedupeDiagnostics([...snapshot.diagnostics, ...this.actionDiagnostics]);
    if (diagnostics.length === 0) {
      setKeyedText(
        this.diagnosticsSummary,
        "viewer.diagnostics.none",
        messages.text("viewer.diagnostics.none"),
      );
    } else {
      setKeyedText(
        this.diagnosticsSummary,
        pluralKey(messages, "viewer.diagnostics.summary", diagnostics.length),
        messages.plural("viewer.diagnostics.summary", diagnostics.length),
        ["count"],
      );
    }
    renderDiagnosticList(this.diagnosticsPanel, messages, diagnostics);

    clearElement(this.filterChips);
    const state = snapshot.filterState;
    const filters = activeFilterChipSummaries(document, messages, state);
    const selections = crossFilterSummaries(document, messages, state);
    if (filters.length === 0 && selections.length === 0) {
      const none = createElement(this.doc, "p", "bl-filters__none");
      setKeyedText(none, "viewer.filters.none", messages.text("viewer.filters.none"));
      this.filterChips.append(none);
    } else {
      for (const filter of filters) {
        const chip = createElement(this.doc, "span", "bl-filter-chip");
        chip.setAttribute("data-filter-chip", filter.id);
        chip.setAttribute("data-filter-active", String(filter.active));
        const origin = createElement(this.doc, "span", "bl-filter-chip__origin");
        setKeyedText(origin, filter.originKey, filter.originText);
        const label = createElement(this.doc, "span", "bl-filter-chip__label");
        setHostText(label, filter.label);
        const value = createElement(this.doc, "span", "bl-filter-chip__value");
        setHostText(value, filter.value);
        chip.append(origin, label, value);
        if (filter.editable) {
          const reset = createElement(this.doc, "button", "bl-filter-chip__action");
          reset.setAttribute("type", "button");
          reset.setAttribute("data-filter-reset", filter.id);
          reset.setAttribute(
            "aria-label",
            messages.text("viewer.filters.resetNamed", { name: filter.label }),
          );
          setKeyedText(reset, "common.reset", messages.text("common.reset"));
          chip.append(reset);
        }
        this.filterChips.append(chip);
      }
      for (const selection of selections) {
        const chip = createElement(this.doc, "span", "bl-filter-chip bl-filter-chip--selection");
        chip.setAttribute("data-cross-chip", selection.id);
        chip.setAttribute("data-cross-source", selection.sourceBlockId);
        const origin = createElement(this.doc, "span", "bl-filter-chip__origin");
        setKeyedText(origin, selection.originKey, selection.originText);
        const label = createElement(this.doc, "span", "bl-filter-chip__label");
        setHostText(label, selection.label);
        const value = createElement(this.doc, "span", "bl-filter-chip__value");
        setHostText(value, selection.value);
        const clear = createElement(this.doc, "button", "bl-filter-chip__action");
        clear.setAttribute("type", "button");
        clear.setAttribute("data-cross-clear", "true");
        clear.setAttribute("aria-label", messages.text("viewer.filters.clearSelection"));
        setKeyedText(clear, "common.close", messages.text("common.close"));
        chip.append(origin, label, value, clear);
        this.filterChips.append(chip);
      }
      if (filters.some((filter) => filter.active && filter.editable)) {
        const resetAll = createElement(this.doc, "button", "bl-filters__reset");
        resetAll.setAttribute("type", "button");
        resetAll.setAttribute("data-filter-reset-all", "true");
        setKeyedText(resetAll, "viewer.filters.reset", messages.text("viewer.filters.reset"));
        this.filterChips.append(resetAll);
      }
    }

    this.renderInspector(document);
    this.renderBlocks(document, snapshot, formatters);
    this.renderEditorShell(snapshot, messages);
    this.restoreBindingFocus(bindingFocus);
    this.restoreInspectorFocus(inspectorFocus);
    this.restoreActionFocus();
  }

  private restoreActionFocus(): void {
    const pending = this.pendingActionFocus;
    if (pending === null) {
      return;
    }
    this.pendingActionFocus = null;
    const match = allDescendants(this.inspectorBody).find(
      (element) =>
        element.getAttribute("data-block-action") === pending.action &&
        element.getAttribute("data-block-target") === pending.target &&
        element.getAttribute("data-block-breakpoint") === pending.breakpoint,
    );
    match?.focus();
  }

  private applyDocumentThemeTokens(document: BoardDocumentV1): void {
    const tokens = document.theme?.tokens;
    const next = new Set<string>();
    if (tokens !== undefined) {
      for (const name of Object.getOwnPropertyNames(tokens)) {
        const value = tokens[name];
        if (typeof value !== "string") {
          continue;
        }
        const property = themeTokenProperty(name);
        this.root.style.setProperty(property, value);
        next.add(property);
      }
    }
    for (const property of this.appliedThemeTokens) {
      if (!next.has(property)) {
        this.root.style.removeProperty(property);
      }
    }
    this.appliedThemeTokens = next;
  }

  private renderBlocks(
    document: BoardDocumentV1,
    snapshot: SpaceSnapshot,
    formatters: FormatterProvider,
  ): void {
    const width = this.target.clientWidth > 0 ? this.target.clientWidth : 1280;
    const breakpoint = breakpointFor(width);
    const layout = resolveLayout(document, breakpoint);
    const columns = Math.max(1, layout.columns);
    const rowHeight =
      typeof layout.rowHeight === "number" && Number.isFinite(layout.rowHeight)
        ? Math.max(32, layout.rowHeight)
        : 32;
    this.root.setAttribute("data-boardloom-breakpoint", breakpoint);
    this.grid.style.setProperty("--bl-grid-columns", String(columns));
    this.grid.style.setProperty("--bl-grid-row-unit", `${rowHeight}px`);
    if (
      this.selectedBlockId !== null &&
      !document.blocks.some((block) => block.id === this.selectedBlockId)
    ) {
      this.selectedBlockId = null;
    }
    const placements = new Map(
      layout.placements.map((placement) => [placement.blockId, placement] as const),
    );
    const desired: HTMLElement[] = [];
    const seen = new Set<string>();
    let index = 0;
    for (const block of document.blocks) {
      if (!this.ensureLive()) {
        return;
      }
      seen.add(block.id);
      let mounted = this.blockElements.get(block.id);
      if (mounted !== undefined && mounted.type !== block.type) {
        this.removeMountedBlock(mounted);
        mounted = undefined;
      }
      if (mounted === undefined) {
        mounted = this.createMountedBlock(block, document, snapshot, formatters);
        this.blockElements.set(block.id, mounted);
      }
      if (!this.ensureLive()) {
        return;
      }
      const placement = placements.get(block.id);
      const x = Math.max(0, Math.min(placement?.x ?? 0, columns - 1));
      const widthValue = Math.max(1, Math.min(placement?.width ?? columns, columns - x));
      const heightValue = Math.max(1, placement?.height ?? 4);
      const y = Math.max(0, placement?.y ?? index * 4);
      mounted.element.style.setProperty("--bl-placement-x", String(x));
      mounted.element.style.setProperty("--bl-placement-y", String(y));
      mounted.element.style.setProperty("--bl-placement-width", String(widthValue));
      mounted.element.style.setProperty("--bl-placement-height", String(heightValue));
      const titleText = typeof block.title === "string" ? block.title.trim() : "";
      if (titleText === "") {
        mounted.header.setAttribute("hidden", "");
        mounted.element.removeAttribute("aria-labelledby");
        mounted.heading.textContent = "";
      } else {
        mounted.header.removeAttribute("hidden");
        mounted.element.setAttribute("aria-labelledby", mounted.heading.id);
        setHostText(mounted.heading, titleText);
      }
      const editable = this.viewValue.mode === "editor" && this.activeEditorLease() !== null;
      const selected = editable && this.selectedBlockId === block.id;
      mounted.element.setAttribute("data-editor-selected", String(selected));
      mounted.element.setAttribute("aria-selected", String(selected));
      mounted.element.setAttribute("tabindex", editable ? "0" : "-1");
      if (editable && selected) {
        setKeyedLabel(
          mounted.element,
          "editor.block.selected",
          `${this.messagesValue.text("editor.block.selected")}: ${block.title ?? block.id}`,
        );
      } else if (editable) {
        setKeyedLabel(
          mounted.element,
          "editor.block.selectable",
          this.messagesValue.text("editor.block.selectable"),
        );
      } else {
        mounted.element.removeAttribute("aria-label");
        mounted.element.removeAttribute("data-message-key");
      }
      this.updateMountedBlock(mounted, block, document, snapshot, formatters);
      if (!this.ensureLive()) {
        return;
      }
      this.updateCrossFilterNote(mounted, block, document, snapshot);
      desired.push(mounted.element);
      index += 1;
    }
    if (!this.ensureLive()) {
      return;
    }
    for (const [id, mounted] of [...this.blockElements]) {
      if (!seen.has(id)) {
        this.removeMountedBlock(mounted);
        this.blockElements.delete(id);
      }
    }
    let gridIndex = 0;
    for (const element of desired) {
      const current = this.grid.children[gridIndex] ?? null;
      if (current !== element) {
        this.grid.insertBefore(element, current);
      }
      gridIndex += 1;
    }
    while (this.grid.children.length > desired.length) {
      const last = this.grid.children[this.grid.children.length - 1];
      last?.remove();
    }
  }

  private updateCrossFilterNote(
    mounted: MountedBlock,
    block: BlockDefinition,
    document: BoardDocumentV1,
    snapshot: SpaceSnapshot,
  ): void {
    const existing = descendantsByClass(mounted.header, "bl-block__filter-note")[0] ?? null;
    const hasSelection = snapshot.filterState.crossFilters.length > 0;
    const dataBlock = block.type === "chart" || block.type === "metric" || block.type === "table";
    if (!hasSelection || !dataBlock) {
      existing?.remove();
      mounted.element.removeAttribute("data-cross-filter");
      return;
    }
    const catalog = this.spaceValue.getValidationCatalog();
    const status = crossFilterTargetStatus(document, block, snapshot.filterState, catalog);
    if (status.compatible) {
      existing?.remove();
      const applied = snapshot.filterState.crossFilters.some(
        (selection) => selection.sourceBlockId !== block.id,
      );
      mounted.element.setAttribute("data-cross-filter", applied ? "included" : "source");
      return;
    }
    const note = existing ?? createElement(this.doc, "p", "bl-block__filter-note");
    note.setAttribute("role", "status");
    note.setAttribute("data-reason", status.reason ?? "incompatible");
    const reasonName = (status.reason ?? "field-unverified").replace(
      /-([a-z])/g,
      (_match, letter: string) => letter.toUpperCase(),
    );
    const reasonKey = `viewer.filters.reason.${reasonName}`;
    const reasonText = this.messagesValue.has(reasonKey)
      ? this.messagesValue.text(reasonKey)
      : (status.reason ?? "field-unverified");
    const targetText = this.messagesValue.text("viewer.filters.incompatibleTarget");
    setKeyedText(note, "viewer.filters.incompatibleTarget", `${targetText} (${reasonText})`);
    note.title = `${targetText} (${reasonText})`;
    if (existing === null) {
      mounted.header.append(note);
    }
    mounted.element.setAttribute("data-cross-filter", "disabled");
    mounted.element.setAttribute("data-cross-filter-reason", status.reason ?? "incompatible");
  }

  private createBlockToolbar(blockId: string): HTMLElement {
    const messages = this.messagesValue;
    const toolbar = createElement(this.doc, "div", "bl-block-actions");
    toolbar.setAttribute("role", "toolbar");
    setKeyedLabel(toolbar, "editor.block.settings", messages.text("editor.block.settings"));
    const icons: Record<string, string> = {
      duplicate: "⧉",
      up: "↑",
      down: "↓",
      left: "←",
      right: "→",
      wider: "⇔",
      narrower: "↔",
      taller: "⇕",
      shorter: "↕",
      earlier: "⇤",
      later: "⇥",
      delete: "⌫",
    };
    for (const [action, key] of [
      ["duplicate", "editor.block.duplicate"],
      ["up", "editor.block.moveUp"],
      ["down", "editor.block.moveDown"],
      ["left", "editor.block.moveLeft"],
      ["right", "editor.block.moveRight"],
      ["wider", "editor.block.wider"],
      ["narrower", "editor.block.narrower"],
      ["taller", "editor.block.taller"],
      ["shorter", "editor.block.shorter"],
      ["earlier", "editor.block.moveEarlier"],
      ["later", "editor.block.moveLater"],
      ["delete", "editor.block.delete"],
    ] as const) {
      const button = createElement(this.doc, "button", "bl-icon-button");
      button.setAttribute("type", "button");
      button.setAttribute("data-block-action", action);
      button.setAttribute("data-block-target", blockId);
      setKeyedLabel(button, key, messages.text(key));
      button.textContent = Object.hasOwn(icons, action) ? (icons[action] ?? action) : action;
      toolbar.append(button);
    }
    return toolbar;
  }

  private createMountedBlock(
    block: BlockDefinition,
    document: BoardDocumentV1,
    snapshot: SpaceSnapshot,
    formatters: FormatterProvider,
  ): MountedBlock {
    const element = createElement(this.doc, "section", "bl-block");
    element.setAttribute("data-block-id", block.id);
    element.setAttribute("data-block-type", String(block.type));
    const header = createElement(this.doc, "header", "bl-block__head");
    const heading = createElement(this.doc, "h2", "bl-block__title");
    heading.id = `${this.root.id}-block-${++blockSequence}-title`;
    header.append(heading);
    const body = createElement(this.doc, "div", "bl-block__body");
    body.setAttribute("tabindex", "-1");
    const actions = this.createBlockToolbar(block.id);
    element.append(actions, header, body);
    const definition: BlockTypeDefinition | undefined = this.registry.get(block.type);
    const environment = this.createEnvironment(
      block,
      null,
      null,
      null,
      snapshot,
      formatters,
      document,
    );
    let surface: BlockSurface;
    try {
      surface =
        definition === undefined
          ? createUnknownSurface(
              this.doc,
              `The block type ${String(block.type)} is not registered in this viewer.`,
            )
          : definition.createSurface(environment);
    } catch (error) {
      surface = createSurfaceFailureSurface(
        this.doc,
        error instanceof Error ? error.message : String(error),
      );
    }
    body.append(surface.element);
    return {
      id: block.id,
      type: String(block.type),
      element,
      header,
      heading,
      body,
      surface,
      queryId: null,
      signature: null,
      queryError: null,
      queryPlan: null,
      comparisonQueryIds: null,
      comparisonSignature: null,
      comparisonState: null,
      comparisonError: null,
      lastBlockSignature: null,
      lastQueryState: null,
      lastQueryErrorSignature: null,
      lastPlanSignature: null,
      lastComparisonSignature: null,
      lastContextSignature: null,
      lastMessages: null,
      lastLocale: null,
      lastTimezone: null,
    };
  }

  private liveQueryOptions(datasetId: string): { readonly live: true } | undefined {
    if (this.spaceValue.disposed || this.spaceValue.getRealtimeInfo() === null) {
      return undefined;
    }
    const descriptor = this.spaceValue.getDatasetDescriptor(datasetId);
    if (descriptor === undefined || descriptor.capabilities.realtime !== true) {
      return undefined;
    }
    return { live: true };
  }

  private updateMountedBlock(
    mounted: MountedBlock,
    block: BoardDocumentV1["blocks"][number],
    document: BoardDocumentV1,
    snapshot: SpaceSnapshot,
    formatters: FormatterProvider,
  ): void {
    if (!this.ensureLive()) {
      return;
    }
    if (!QUERY_BLOCK_TYPES.has(String(block.type))) {
      this.removeBlockQuery(mounted);
      this.removeComparisonQueries(mounted);
      mounted.queryError = null;
      mounted.queryPlan = null;
      mounted.comparisonState = null;
      mounted.comparisonError = null;
      const environment = this.createEnvironment(
        block,
        null,
        null,
        null,
        snapshot,
        formatters,
        document,
        null,
      );
      this.updateSurface(mounted, environment);
      return;
    }
    const comparisonId = block.config.comparisonId;
    if (typeof comparisonId === "string" && comparisonId.trim() !== "") {
      this.updateComparisonBlock(mounted, block, document, snapshot, formatters);
      return;
    }
    this.removeComparisonQueries(mounted);
    mounted.comparisonState = null;
    mounted.comparisonError = null;
    const derived = deriveBlockQuery(document as unknown as BoardDocument, block, {
      filterState: snapshot.filterState,
      ...(this.spaceValue.getValidationCatalog() === undefined
        ? {}
        : { catalog: this.spaceValue.getValidationCatalog() }),
    });
    if (!derived.ok) {
      this.removeBlockQuery(mounted);
      mounted.queryError = derived.diagnostics;
      mounted.queryPlan = null;
      const environment = this.createEnvironment(
        block,
        null,
        mounted.queryError,
        null,
        snapshot,
        formatters,
        document,
        null,
      );
      this.updateSurface(mounted, environment);
      return;
    }
    const queryId = blockQueryId(this.viewValue.viewId, block.id);
    if (mounted.queryId !== queryId) {
      this.removeBlockQuery(mounted);
      mounted.queryId = queryId;
      mounted.signature = null;
    }
    const signature = querySpecSignature(derived.value.spec);
    if (mounted.signature !== signature) {
      const live = this.liveQueryOptions(derived.value.spec.datasetId);
      const set = this.spaceValue.setQuery(queryId, derived.value.spec, live);
      if (!this.ensureLive()) {
        return;
      }
      mounted.signature = signature;
      if (!set.ok) {
        mounted.queryError = set.diagnostics;
        if (!this.spaceValue.disposed) {
          this.spaceValue.removeQuery(queryId);
        }
      } else {
        mounted.queryError = null;
      }
    }
    mounted.queryPlan = derived.value;
    if (!this.ensureLive()) {
      return;
    }
    const query: QueryState | null = this.spaceValue.disposed
      ? null
      : (this.spaceValue.getQueryState(queryId) ?? null);
    const environment = this.createEnvironment(
      block,
      query,
      mounted.queryError,
      mounted.queryPlan,
      snapshot,
      formatters,
      document,
      null,
    );
    this.updateSurface(mounted, environment);
  }

  private updateComparisonBlock(
    mounted: MountedBlock,
    block: BlockDefinition,
    document: BoardDocumentV1,
    snapshot: SpaceSnapshot,
    formatters: FormatterProvider,
  ): void {
    if (mounted.queryId !== null) {
      this.removeBlockQuery(mounted);
    }
    const catalog = this.spaceValue.getValidationCatalog();
    const derived = deriveComparisonQuery(document, block, {
      filterState: snapshot.filterState,
      ...(catalog === undefined ? {} : { catalog }),
      getDatasetDescriptor: (datasetId) => this.spaceValue.getDatasetDescriptor(datasetId),
    });
    if (!derived.ok) {
      this.removeComparisonQueries(mounted);
      mounted.comparisonSignature = null;
      mounted.comparisonState = null;
      mounted.comparisonError = derived.diagnostics;
      const environment = this.createEnvironment(
        block,
        null,
        derived.diagnostics,
        null,
        snapshot,
        formatters,
        document,
        null,
      );
      this.updateSurface(mounted, environment);
      return;
    }
    const plan = derived.value.plan;
    const ids = comparisonQueryIds(this.viewValue.viewId, block.id);
    if (mounted.comparisonQueryIds === null) {
      mounted.comparisonQueryIds = ids;
      mounted.comparisonSignature = null;
    }
    const signature = canonicalJson({
      primary: plan.primary.request,
      reference: plan.reference.request,
    } as never);
    let registrationError: readonly Diagnostic[] | null = null;
    if (mounted.comparisonSignature !== signature) {
      const primarySet = this.spaceValue.setQuery(
        ids.primary,
        plan.primary.request,
        this.liveQueryOptions(plan.primary.request.datasetId),
      );
      if (!this.ensureLive()) {
        return;
      }
      const referenceSet = this.spaceValue.setQuery(
        ids.reference,
        plan.reference.request,
        this.liveQueryOptions(plan.reference.request.datasetId),
      );
      if (!this.ensureLive()) {
        return;
      }
      const errors: Diagnostic[] = [];
      if (!primarySet.ok) {
        errors.push(...primarySet.diagnostics);
      }
      if (!referenceSet.ok) {
        errors.push(...referenceSet.diagnostics);
      }
      if (errors.length > 0) {
        if (!this.spaceValue.disposed) {
          this.spaceValue.removeQuery(ids.primary);
          this.spaceValue.removeQuery(ids.reference);
        }
        registrationError = Object.freeze(errors);
        mounted.comparisonSignature = null;
      } else {
        mounted.comparisonSignature = signature;
      }
    }
    const primaryState = this.spaceValue.disposed
      ? null
      : (this.spaceValue.getQueryState(ids.primary) ?? null);
    const referenceState = this.spaceValue.disposed
      ? null
      : (this.spaceValue.getQueryState(ids.reference) ?? null);
    let comparisonState: ComparisonViewState | null = null;
    let comparisonError = registrationError;
    if (registrationError === null && primaryState !== null && referenceState !== null) {
      const computed = computeComparisonView(plan, primaryState, referenceState);
      if (computed.ok) {
        comparisonState = computed.value;
      } else {
        comparisonError = computed.diagnostics;
      }
    }
    mounted.comparisonState = comparisonState;
    mounted.comparisonError = comparisonError;
    mounted.queryError = comparisonError;
    const environmentQuery =
      primaryState === null
        ? null
        : Object.freeze({
            ...primaryState,
            phase: comparisonState?.phase ?? ("loading" as const),
          });
    const environment = this.createEnvironment(
      block,
      environmentQuery,
      comparisonError,
      null,
      snapshot,
      formatters,
      document,
      comparisonState,
    );
    this.updateSurface(mounted, environment);
  }

  private updateSurface(mounted: MountedBlock, environment: BlockSurfaceEnvironment): void {
    if (!this.ensureLive()) {
      return;
    }
    const blockSignature = canonicalJson(environment.block as never);
    const planSignature =
      environment.queryPlan === null ? null : querySpecSignature(environment.queryPlan.spec);
    const errorSignature =
      environment.queryError === null ? null : canonicalJson(environment.queryError as never);
    const comparisonSignature = environment.comparison?.signature ?? null;
    const queryIdentityMatches =
      environment.comparison != null || mounted.lastQueryState === environment.query;
    if (
      mounted.lastBlockSignature === blockSignature &&
      queryIdentityMatches &&
      mounted.lastQueryErrorSignature === errorSignature &&
      mounted.lastPlanSignature === planSignature &&
      mounted.lastComparisonSignature === comparisonSignature &&
      mounted.lastContextSignature === environment.contextSignature &&
      mounted.lastMessages === environment.messages &&
      mounted.lastLocale === environment.locale &&
      mounted.lastTimezone === environment.timezone
    ) {
      return;
    }
    const interaction = this.captureInteraction(mounted.element);
    try {
      mounted.surface.update(environment);
    } catch (error) {
      this.replaceSurfaceFailure(mounted, environment, error);
    }
    if (!this.ensureLive()) {
      return;
    }
    this.restoreInteraction(mounted.element, interaction);
    mounted.lastBlockSignature = blockSignature;
    mounted.lastQueryState = environment.query;
    mounted.lastQueryErrorSignature = errorSignature;
    mounted.lastPlanSignature = planSignature;
    mounted.lastComparisonSignature = comparisonSignature;
    mounted.lastContextSignature = environment.contextSignature;
    mounted.lastMessages = environment.messages;
    mounted.lastLocale = environment.locale;
    mounted.lastTimezone = environment.timezone;
  }

  private replaceSurfaceFailure(
    mounted: MountedBlock,
    environment: BlockSurfaceEnvironment,
    error: unknown,
  ): void {
    try {
      mounted.surface.destroy?.();
    } catch {
      void 0;
    }
    mounted.surface.element.remove();
    const message = error instanceof Error ? error.message : String(error);
    const diagnostics =
      error instanceof BoardloomError ? Object.freeze([error.diagnostic]) : undefined;
    const fallback = createSurfaceFailureSurface(this.doc, message, diagnostics);
    mounted.body.append(fallback.element);
    mounted.surface = fallback;
    try {
      fallback.update(environment);
    } catch {
      clearElement(fallback.element);
      renderErrorState(fallback.element, environment.messages, [
        createDiagnostic(DIAGNOSTIC_CODES.BLOCK_SURFACE_FAILED, "block/surface", { message }),
      ]);
    }
  }

  private captureInteraction(element: HTMLElement): BlockInteractionState {
    const tableRegions = descendantsByClass(element, "bl-table-region");
    const active = this.doc.activeElement;
    const tableIndex = tableRegions.findIndex((region) => elementContains(region, active));
    const summary = descendantsByClass(element, "bl-chart-data__summary").find((candidate) =>
      elementContains(candidate, active),
    );
    return Object.freeze({
      tableScroll: Object.freeze(
        tableRegions.map((region) =>
          Object.freeze({ top: region.scrollTop, left: region.scrollLeft }),
        ),
      ),
      focus:
        tableIndex >= 0
          ? Object.freeze({ kind: "table" as const, index: tableIndex })
          : summary !== undefined
            ? Object.freeze({ kind: "summary" as const })
            : null,
    });
  }

  private restoreInteraction(element: HTMLElement, interaction: BlockInteractionState): void {
    const tableRegions = descendantsByClass(element, "bl-table-region");
    interaction.tableScroll.forEach((scroll, index) => {
      const region = tableRegions[index];
      if (region !== undefined) {
        region.scrollTop = scroll.top;
        region.scrollLeft = scroll.left;
      }
    });
    if (interaction.focus === null) {
      return;
    }
    if (interaction.focus.kind === "table") {
      const region = tableRegions[interaction.focus.index] ?? tableRegions[0];
      if (region !== undefined) {
        region.focus();
      } else {
        const body = descendantsByClass(element, "bl-block__body")[0];
        body?.focus();
      }
      return;
    }
    const summary = descendantsByClass(element, "bl-chart-data__summary")[0];
    summary?.focus();
  }

  private rendererTheme(document: BoardDocumentV1): RendererTheme {
    const configured = this.config.theme ?? documentTheme(document);
    let mode: "light" | "dark";
    if (configured === "dark") {
      mode = "dark";
    } else if (configured === "light") {
      mode = "light";
    } else {
      const viewWindow = this.doc.defaultView as
        | (Window & { readonly matchMedia?: (query: string) => { readonly matches: boolean } })
        | null;
      mode =
        typeof viewWindow?.matchMedia === "function" &&
        viewWindow.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";
    }
    const tokens = document.theme?.tokens ?? {};
    return Object.freeze({
      mode,
      colors: resolveRendererColors(mode, tokens),
    });
  }

  private applyFilterValue(filterId: string, value: JsonValue): Result<FilterRuntimeState> {
    return this.applyFilterOperation("value", () =>
      this.spaceValue.setFilterValue(filterId, value),
    );
  }

  private applyFilterOperation(
    reason: "value" | "reset" | "cross-filter",
    operation: () => Result<FilterRuntimeState>,
  ): Result<FilterRuntimeState> {
    if (!this.publicOperationLive()) {
      return fail([createDiagnostic(DIAGNOSTIC_CODES.VIEW_DISPOSED, "view")]);
    }
    const result = operation();
    if (!this.ensureLive()) {
      return fail([createDiagnostic(DIAGNOSTIC_CODES.VIEW_DISPOSED, "view")]);
    }
    if (result.ok) {
      this.actionDiagnostics = Object.freeze([]);
      this.announceFilterChange(reason);
      this.scheduleRender();
    } else {
      this.actionDiagnostics = result.diagnostics;
      this.announceDiagnostics(result.diagnostics);
      this.renderNow();
    }
    return result;
  }

  private announceFilterChange(reason: "value" | "reset" | "cross-filter"): void {
    const key =
      reason === "cross-filter"
        ? "viewer.filters.crossFilter"
        : reason === "reset"
          ? "viewer.filters.reset"
          : "viewer.filters.active";
    if (this.messagesValue.has(key)) {
      this.liveRegion.textContent = this.messagesValue.text(key);
      this.liveRegion.setAttribute("data-announcement-key", key);
    }
    this.liveRegion.removeAttribute("data-severity");
  }

  private createEnvironment(
    block: BoardDocumentV1["blocks"][number],
    query: QueryState | null,
    queryError: readonly Diagnostic[] | null,
    queryPlan: DerivedBlockQuery | null,
    snapshot: SpaceSnapshot,
    formatters: FormatterProvider,
    document: BoardDocumentV1,
    comparison: ComparisonViewState | null = null,
  ): BlockSurfaceEnvironment {
    return {
      document: document as unknown as BoardDocument,
      dom: this.doc,
      block,
      query,
      queryError,
      queryPlan,
      comparison,
      filterState: snapshot.filterState,
      contextSignature: blockContextSignature(block, document, snapshot.filterState),
      messages: this.messagesValue,
      formatters,
      locale: snapshot.locale,
      timezone: snapshot.timezone,
      theme: this.rendererTheme(document),
      renderers: this.rendererRegistry,
      getDatasetDescriptor: (datasetId) => this.spaceValue.getDatasetDescriptor(datasetId),
      createElement: (tag, className) => createElement(this.doc, tag, className),
      applyFilterValue: (filterId, value) => this.applyFilterValue(filterId, value),
      resetFilterValue: (filterId) =>
        this.applyFilterOperation("reset", () => this.spaceValue.resetFilter(filterId)),
      toggleCrossFilter: (selection) =>
        this.applyFilterOperation("cross-filter", () =>
          this.spaceValue.setCrossFilter(selection, { toggle: true }),
        ),
      clearCrossFilters: () =>
        this.applyFilterOperation("cross-filter", () => this.spaceValue.clearCrossFilters()),
    };
  }

  private removeBlockQuery(mounted: MountedBlock): void {
    if (mounted.queryId === null) {
      return;
    }
    if (!this.spaceValue.disposed) {
      this.spaceValue.removeQuery(mounted.queryId);
    }
    mounted.queryId = null;
    mounted.signature = null;
  }

  private removeComparisonQueries(mounted: MountedBlock): void {
    if (mounted.comparisonQueryIds === null) {
      return;
    }
    if (!this.spaceValue.disposed) {
      this.spaceValue.removeQuery(mounted.comparisonQueryIds.primary);
      this.spaceValue.removeQuery(mounted.comparisonQueryIds.reference);
    }
    mounted.comparisonQueryIds = null;
    mounted.comparisonSignature = null;
  }

  private removeMountedBlock(mounted: MountedBlock): void {
    this.removeBlockQuery(mounted);
    this.removeComparisonQueries(mounted);
    if (mounted.surface.destroy !== undefined) {
      try {
        mounted.surface.destroy();
      } catch {
        void 0;
      }
    }
    mounted.element.remove();
  }

  private handleEvent(event: SpaceEvent): void {
    if (this.disposedFlag || !this.mountedFlag) {
      return;
    }
    if (this.config.onEvent !== undefined) {
      try {
        this.config.onEvent(event);
      } catch {
        this.actionDiagnostics = Object.freeze([
          createDiagnostic(DIAGNOSTIC_CODES.INVALID_ARGUMENT, "onEvent", {
            message: this.messagesValue.text("viewer.hostCallbackError"),
          }),
        ]);
        this.announceDiagnostics(this.actionDiagnostics);
      }
    }
    if (!this.ensureLive()) {
      return;
    }
    if (event.type === "view:disposed" && event.viewId === this.viewValue.viewId) {
      if (!this.unmounting) {
        this.teardown(this.ownsSpace);
      }
      return;
    }
    if (event.type === "space:disposed") {
      this.teardown(false);
      return;
    }
    if (
      event.type === "document:changed" ||
      event.type === "draft:cancelled" ||
      event.type === "draft:applied"
    ) {
      this.pendingFilters.clear();
    }
    this.scheduleRender();
  }

  private scheduleRender(): void {
    if (this.renderScheduled || this.disposedFlag || !this.mountedFlag) {
      return;
    }
    this.renderScheduled = true;
    queueMicrotask(() => {
      if (this.disposedFlag || !this.mountedFlag) {
        return;
      }
      this.renderNow();
    });
  }

  private announceDiagnostics(diagnostics: readonly Diagnostic[]): void {
    const first = diagnostics[0];
    if (first === undefined) {
      return;
    }
    const key = `diagnostic.${first.code}`;
    if (this.messagesValue.has(key)) {
      this.liveRegion.textContent = this.messagesValue.text(key);
      this.liveRegion.setAttribute("data-announcement-key", key);
    } else {
      this.liveRegion.textContent = first.message;
      this.liveRegion.removeAttribute("data-announcement-key");
    }
    this.liveRegion.setAttribute("data-severity", first.severity);
  }

  private teardown(disposeSpace: boolean): void {
    if (this.disposedFlag) {
      return;
    }
    this.mountedFlag = false;
    this.disposedFlag = true;
    if (this.unsubscribeSpace !== null) {
      this.unsubscribeSpace();
      this.unsubscribeSpace = null;
    }
    if (this.resizeObserver !== null) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    this.root.removeEventListener("click", this.onClick);
    this.root.removeEventListener("change", this.onChange);
    this.root.removeEventListener("input", this.onInput);
    this.root.removeEventListener("keydown", this.onKeyDown);
    for (const mounted of this.blockElements.values()) {
      this.removeBlockQuery(mounted);
      this.removeComparisonQueries(mounted);
      if (mounted.surface.destroy !== undefined) {
        try {
          mounted.surface.destroy();
        } catch {
          void 0;
        }
      }
    }
    this.blockElements.clear();
    releaseMountedView(this.viewValue);
    this.root.remove();
    if (disposeSpace && this.ownsSpace && !this.spaceValue.disposed) {
      this.spaceValue.dispose();
    }
    if (this.ownsRuntime && this.runtimeValue !== null) {
      this.runtimeValue.dispose();
    }
  }
}
