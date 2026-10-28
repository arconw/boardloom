import {
  BoardloomError,
  DIAGNOSTIC_CODES,
  THEME_MODES,
  canonicalJson,
  createDiagnostic,
  describeBindingSlots,
  fail,
  ok,
  resolveRendererColors,
  type AggregationType,
  type BindingSlot,
  type BindingSlotChange,
  type BindingSlotDescriptor,
  type BoardDocument,
  type BoardDocumentV1,
  type BlockDefinition,
  type BoardSpace,
  type BoardView,
  type BoardloomRuntime,
  type Diagnostic,
  type EditorLease,
  type FieldReference,
  type FormatterProvider,
  type MessageDictionary,
  type MessageProvider,
  type QueryState,
  type RendererRegistry,
  type RendererTheme,
  type Result,
  type SpaceEvent,
  type SpaceSnapshot,
  type ThemeMode,
  type ViewMode,
  type ViewSnapshot,
} from "@boardloom/core";
import {
  blockQueryId,
  deriveBlockQuery,
  querySpecSignature,
  type DerivedBlockQuery,
} from "./block-query.js";
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
import { activeFilterSummaries } from "./filter-summary.js";
import { createViewMessages, pluralKey, type ViewMessages } from "./messages.js";
import { realtimeText } from "./realtime.js";
import { renderDiagnosticList, renderErrorState } from "./states.js";
import { themeTokenProperty } from "./theme-tokens.js";
import type { BoardViewHandle, FocusTarget, UpdateBoardViewOptions } from "./types.js";

let instanceSequence = 0;
let blockSequence = 0;

const QUERY_BLOCK_TYPES = new Set(["metric", "table", "chart"]);
const FILTER_CONTEXT_BLOCK_TYPES = new Set(["metric", "table", "chart", "filter"]);

function filterContextSignature(document: BoardDocumentV1): string {
  return canonicalJson({
    filters: document.filters,
    filterGroups: document.filterGroups ?? [],
    blocks: document.blocks.map((block) => ({
      id: block.id,
      title: block.title,
      groupId: block.groupId,
    })),
  } as never);
}

function blockContextSignature(block: BlockDefinition, document: BoardDocumentV1): string {
  if (block.type === "text") {
    return "";
  }
  if (FILTER_CONTEXT_BLOCK_TYPES.has(String(block.type))) {
    return filterContextSignature(document);
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
  lastBlockSignature: string | null;
  lastQueryState: QueryState | null;
  lastQueryErrorSignature: string | null;
  lastPlanSignature: string | null;
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
  private readonly blockElements = new Map<string, MountedBlock>();
  private appliedThemeTokens = new Set<string>();
  private messagesValue: ViewMessages;
  private messagesLocale: string;
  private messageProvider: MessageProvider;
  private messageOverrides: MessageDictionary | undefined;
  private actionDiagnostics: readonly Diagnostic[] = Object.freeze([]);
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
      this.setMode("editor");
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
    this.diagnosticsDetails = createElement(this.doc, "details", "bl-diagnostics");
    this.diagnosticsSummary = createElement(this.doc, "summary", "bl-diagnostics__summary");
    this.diagnosticsPanel = createElement(this.doc, "div", "bl-diagnostics__panel");
    this.diagnosticsDetails.append(this.diagnosticsSummary, this.diagnosticsPanel);
    this.statusbar.append(this.status, this.lastUpdate, this.diagnosticsDetails);
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

    this.inspector = createElement(this.doc, "aside", "bl-inspector");
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
    this.inspector.append(this.inspectorHeading, this.inspectorBody);
    this.root.append(this.inspector);

    this.body = createElement(this.doc, "div", "bl-body");
    this.body.id = bodyId;
    this.body.setAttribute("role", "region");
    this.body.setAttribute("tabindex", "-1");
    this.body.setAttribute("aria-label", this.messagesValue.text("a11y.boardRegion"));
    this.body.setAttribute("data-message-key", "a11y.boardRegion");
    this.grid = createElement(this.doc, "div", "bl-board-grid");
    this.body.append(this.grid);
    this.root.append(this.body);

    this.liveRegion = createElement(this.doc, "div", "bl-live");
    this.liveRegion.setAttribute("role", "status");
    this.liveRegion.setAttribute("aria-live", "polite");
    this.liveRegion.setAttribute("aria-atomic", "true");
    setKeyedLabel(this.liveRegion, "a11y.liveRegion", this.messagesValue.text("a11y.liveRegion"));
    this.root.append(this.liveRegion);

    try {
      this.root.addEventListener("click", this.onClick);
      this.root.addEventListener("change", this.onChange);
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

  setMode(mode: ViewMode, options: { readonly lease?: EditorLease } = {}): Result<ViewSnapshot> {
    if (!this.publicOperationLive()) {
      return fail([createDiagnostic(DIAGNOSTIC_CODES.VIEW_DISPOSED, "view")]);
    }
    const changed = this.viewValue.setMode(mode, options);
    if (!this.ensureLive()) {
      return fail([createDiagnostic(DIAGNOSTIC_CODES.VIEW_DISPOSED, "view")]);
    }
    if (changed.ok) {
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
    const catalog = this.spaceValue.getValidationCatalog();
    const configurable = document.blocks.filter(
      (block) => block.type === "chart" || block.type === "metric",
    );
    if (configurable.length === 0) {
      const empty = createElement(this.doc, "p", "bl-inspector__empty");
      setKeyedText(
        empty,
        "editor.inspector.empty",
        this.messagesValue.text("editor.inspector.empty"),
      );
      this.inspectorBody.append(empty);
      return;
    }
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
    }
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
    const committedDocument = snapshot.committedDocument as unknown as BoardDocumentV1;
    const draftDocument = snapshot.draft?.document as unknown as BoardDocumentV1 | undefined;
    const document =
      this.viewValue.mode === "editor" ? (draftDocument ?? committedDocument) : committedDocument;
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

    const realtime = realtimeText(this.config.realtime, messages);
    setKeyedText(this.status, realtime.key, realtime.text);
    this.status.setAttribute("data-status", this.config.realtime?.status ?? "historical");
    if (
      this.config.realtime?.lastUpdate !== undefined &&
      Number.isFinite(this.config.realtime.lastUpdate)
    ) {
      this.lastUpdate.removeAttribute("hidden");
      setKeyedText(
        this.lastUpdate,
        "viewer.realtime.lastUpdate",
        messages.text("viewer.realtime.lastUpdate", {
          time: formatTimestamp(formatters, this.config.realtime.lastUpdate, snapshot.timezone),
        }),
        ["time"],
      );
    } else {
      this.lastUpdate.setAttribute("hidden", "");
      this.lastUpdate.textContent = "";
    }

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
    const filters = activeFilterSummaries(document, messages);
    if (filters.length === 0) {
      const none = createElement(this.doc, "p", "bl-filters__none");
      setKeyedText(none, "viewer.filters.none", messages.text("viewer.filters.none"));
      this.filterChips.append(none);
    } else {
      for (const filter of filters) {
        const chip = createElement(this.doc, "span", "bl-filter-chip");
        const origin = createElement(this.doc, "span", "bl-filter-chip__origin");
        setKeyedText(origin, filter.originKey, filter.originText);
        const label = createElement(this.doc, "span", "bl-filter-chip__label");
        setHostText(label, filter.label);
        const value = createElement(this.doc, "span", "bl-filter-chip__value");
        setHostText(value, filter.value);
        chip.append(origin, label, value);
        this.filterChips.append(chip);
      }
    }

    this.renderInspector(document);
    this.renderBlocks(document, snapshot, formatters);
    this.restoreBindingFocus(bindingFocus);
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
      this.updateMountedBlock(mounted, block, document, snapshot, formatters);
      if (!this.ensureLive()) {
        return;
      }
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
    element.append(header, body);
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
      lastBlockSignature: null,
      lastQueryState: null,
      lastQueryErrorSignature: null,
      lastPlanSignature: null,
      lastContextSignature: null,
      lastMessages: null,
      lastLocale: null,
      lastTimezone: null,
    };
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
      mounted.queryError = null;
      mounted.queryPlan = null;
      const environment = this.createEnvironment(
        block,
        null,
        null,
        null,
        snapshot,
        formatters,
        document,
      );
      this.updateSurface(mounted, environment);
      return;
    }
    const derived = deriveBlockQuery(document as unknown as BoardDocument, block);
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
      const set = this.spaceValue.setQuery(queryId, derived.value.spec);
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
    if (
      mounted.lastBlockSignature === blockSignature &&
      mounted.lastQueryState === environment.query &&
      mounted.lastQueryErrorSignature === errorSignature &&
      mounted.lastPlanSignature === planSignature &&
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

  private createEnvironment(
    block: BoardDocumentV1["blocks"][number],
    query: QueryState | null,
    queryError: readonly Diagnostic[] | null,
    queryPlan: DerivedBlockQuery | null,
    snapshot: SpaceSnapshot,
    formatters: FormatterProvider,
    document: BoardDocumentV1,
  ): BlockSurfaceEnvironment {
    return {
      document: document as unknown as BoardDocument,
      dom: this.doc,
      block,
      query,
      queryError,
      queryPlan,
      contextSignature: blockContextSignature(block, document),
      messages: this.messagesValue,
      formatters,
      locale: snapshot.locale,
      timezone: snapshot.timezone,
      theme: this.rendererTheme(document),
      renderers: this.rendererRegistry,
      getDatasetDescriptor: (datasetId) => this.spaceValue.getDatasetDescriptor(datasetId),
      createElement: (tag, className) => createElement(this.doc, tag, className),
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

  private removeMountedBlock(mounted: MountedBlock): void {
    this.removeBlockQuery(mounted);
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
        void 0;
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
    for (const mounted of this.blockElements.values()) {
      this.removeBlockQuery(mounted);
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
