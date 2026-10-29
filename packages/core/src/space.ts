import type { BoardValidationCatalog } from "./board-validation.js";
import type { BoardDocumentV1 } from "./board-schema.js";
import { createEffectiveValidationCatalog } from "./dataset-catalog.js";
import {
  assertFixedBindingsPreserved,
  setBindingSlot,
  type BindingSlotChange,
} from "./binding-model.js";
import type { DatasetDescriptor, DatasetProvider, QuerySpec, QueryState } from "./data-contract.js";
import type { RealtimeSubscriptionState, RealtimeTransportInfo } from "./realtime-contract.js";
import type { Clock } from "./clock.js";
import {
  documentSchemaVersion,
  isBlockingValidation,
  snapshotDocument,
  validationWarnings,
  type BoardDocument,
  type DocumentValidator,
} from "./document.js";
import {
  BoardloomError,
  DIAGNOSTIC_CODES,
  createDiagnostic,
  fail,
  ok,
  type Diagnostic,
  type Result,
} from "./diagnostics.js";
import type { SpaceEvent, SpaceEventInput, Unsubscribe } from "./events.js";
import { EventBus } from "./events.js";
import type { BoardSerialization, BoardSerializationOptions } from "./document-io.js";
import { serializeBoardDocument } from "./document-io.js";
import {
  createQueryController,
  type QueryController,
  type QuerySetOptions,
} from "./query-controller.js";
import type { FormatterProvider } from "./formatting.js";
import type { IdFactory } from "./ids.js";
import { deepFreeze, jsonEqual, type JsonValue } from "./json.js";
import {
  createEmptyFilterRuntimeState,
  crossFilterTargetIds,
  filterStateWithActiveValue,
  filterStateWithCrossFilter,
  filterStateWithoutActiveValues,
  filterStateWithoutCrossFilter,
  makeFilterState,
  parseFilterRuntimeState,
  pruneFilterState,
  validateCrossFilterSelection,
  validateFilterRuntimeState,
  valueMatchesType,
  valueShapeMatchesOperator,
  type CrossFilterSelection,
  type CrossFilterSelectionInput,
  type FilterRuntimeState,
} from "./filter-model.js";
import type { Logger } from "./logger.js";
import { resolveLocaleConfig, type LocaleConfig, type LocaleConfigInput } from "./locale.js";
import {
  createMessageProvider,
  formatEnglishMessage,
  type MessageDictionaries,
  type MessageProvider,
} from "./messages.js";
import type { ExtensionSession } from "./extensions.js";
import type { BoardMigrationReport } from "./migrations.js";
import type {
  AcquireEditorLeaseOptions,
  CreateSpaceOptions,
  CreateViewOptions,
  DraftSnapshot,
  EditorLease,
  ReleaseEditorLeaseOptions,
  SpaceSnapshot,
  SpaceStatus,
  SpaceSummary,
  ViewMode,
  ViewState,
} from "./types.js";
import { ViewImpl, createView, type BoardView, type ViewHost } from "./view.js";

interface DraftHistoryEntry {
  document: BoardDocument;
  allowedRemovedBlockIds: Set<string>;
}

interface DraftState {
  document: BoardDocument;
  baseRevision: number;
  revision: number;
  undo: DraftHistoryEntry[];
  redo: DraftHistoryEntry[];
  allowedRemovedBlockIds: Set<string>;
}

export interface DraftUpdateOptions {
  readonly allowRemovedBlockIds?: readonly string[];
}

interface CommittedDraftState {
  readonly document: BoardDocument;
  readonly revision: number;
}

export interface SpaceDependencies {
  readonly idFactory: IdFactory;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly documentValidator: DocumentValidator;
  readonly validationCatalog?: BoardValidationCatalog;
  readonly formatterFactory: (config: LocaleConfig) => FormatterProvider;
  readonly messageDictionaries: MessageDictionaries;
  readonly historyLimit: number;
  readonly forwardEvent: (event: SpaceEvent) => void;
  readonly onDisposed: (spaceId: string, lifetimeId: string) => void;
  readonly onTerminalDelivered: (spaceId: string, lifetimeId: string) => void;
}

function reportMessageDiagnostics(
  logger: SpaceDependencies["logger"],
  diagnostics: readonly Diagnostic[],
): void {
  for (const diagnostic of diagnostics) {
    logger.warn("Boardloom message dictionary warning", {
      code: diagnostic.code,
      path: diagnostic.path,
    });
  }
}

export interface SpaceInitOptions extends CreateSpaceOptions {
  readonly localeConfig: LocaleConfig;
  readonly warnings?: readonly Diagnostic[];
  readonly extensionSession?: ExtensionSession;
}

export interface SpaceImportMetadata {
  readonly sourceSpaceId?: string;
  readonly documentId: string;
  readonly schemaVersion: number;
  readonly migration: BoardMigrationReport | null;
  readonly warnings: readonly Diagnostic[];
}

export interface EventBatchHandle {
  flush(): void;
  discard(): void;
}

export interface BoardSpace {
  readonly id: string;
  readonly lifetimeId: string;
  readonly disposed: boolean;
  readonly listenerCount: number;
  readonly taskCount: number;
  readonly viewCount: number;
  getSnapshot(): SpaceSnapshot;
  exportDocument(options?: BoardSerializationOptions): Result<BoardSerialization>;
  loadDocument(document: unknown, options?: { readonly source?: string }): Result<SpaceSnapshot>;
  setLocale(config: LocaleConfigInput): Result<SpaceSnapshot>;
  getFormatters(): FormatterProvider;
  getMessageProvider(): MessageProvider;
  getExtensionThemeTokens(): Readonly<Record<string, string>>;
  getFilterState(): FilterRuntimeState;
  setFilterValue(
    filterId: string,
    value: JsonValue,
    options?: { readonly allowLocked?: boolean },
  ): Result<FilterRuntimeState>;
  setFilterRuntimeState(value: unknown): Result<FilterRuntimeState>;
  resetFilter(
    filterId: string,
    options?: { readonly allowLocked?: boolean },
  ): Result<FilterRuntimeState>;
  resetFilterScope(
    target: "board" | "group" | "block",
    id?: string,
    options?: { readonly allowLocked?: boolean },
  ): Result<FilterRuntimeState>;
  resetAllFilters(options?: { readonly allowLocked?: boolean }): Result<FilterRuntimeState>;
  setCrossFilter(
    selection: CrossFilterSelectionInput | null,
    options?: { readonly toggle?: boolean },
  ): Result<FilterRuntimeState>;
  setCrossFilters(selections: readonly CrossFilterSelectionInput[]): Result<FilterRuntimeState>;
  clearCrossFilters(): Result<FilterRuntimeState>;
  getDatasetDescriptor(datasetId: string): DatasetDescriptor | undefined;
  getValidationCatalog(): BoardValidationCatalog | undefined;
  setQuery(queryId: string, spec: QuerySpec, options?: QuerySetOptions): Result<QueryState>;
  refreshQuery(queryId: string): Result<QueryState>;
  invalidateQuery(queryId: string, reason?: string): Result<QueryState>;
  cancelQuery(queryId: string, reason?: string): Result<QueryState>;
  removeQuery(queryId: string): Result<void>;
  getQueryState(queryId: string): QueryState | undefined;
  getQueryStates(): readonly QueryState[];
  getRealtimeInfo(): RealtimeTransportInfo | null;
  getRealtimeState(queryId: string): RealtimeSubscriptionState | undefined;
  getRealtimeStates(): readonly RealtimeSubscriptionState[];
  pauseRealtime(queryId?: string): Result<readonly RealtimeSubscriptionState[]>;
  resumeRealtime(queryId?: string): Result<readonly RealtimeSubscriptionState[]>;
  resyncRealtime(queryId?: string, reason?: string): Result<readonly RealtimeSubscriptionState[]>;
  closeRealtime(queryId?: string, reason?: string): Result<readonly RealtimeSubscriptionState[]>;
  pause(): Result<SpaceSnapshot>;
  resume(): Result<SpaceSnapshot>;
  createView(options?: CreateViewOptions): Result<BoardView>;
  acquireEditorLease(options?: AcquireEditorLeaseOptions): Result<EditorLease>;
  releaseEditorLease(
    lease: EditorLease,
    options?: ReleaseEditorLeaseOptions,
  ): Result<SpaceSnapshot>;
  updateDraft(
    lease: EditorLease,
    document: unknown,
    options?: DraftUpdateOptions,
  ): Result<DraftSnapshot>;
  updateBinding(lease: EditorLease, change: BindingSlotChange): Result<DraftSnapshot>;
  undoDraft(lease: EditorLease): Result<DraftSnapshot>;
  redoDraft(lease: EditorLease): Result<DraftSnapshot>;
  applyDraft(lease: EditorLease): Result<SpaceSnapshot>;
  cancelDraft(lease: EditorLease): Result<SpaceSnapshot>;
  schedule(callback: () => void, delayMs: number): Result<Unsubscribe>;
  subscribe(listener: (event: SpaceEvent) => void): Unsubscribe;
  beginEventBatch(): EventBatchHandle;
  dispose(): Result<void>;
}

const EMPTY_DIAGNOSTICS: readonly Diagnostic[] = Object.freeze([]);

function diagnosticsEqual(left: readonly Diagnostic[], right: readonly Diagnostic[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((diagnostic, index) => {
    const other = right[index];
    return (
      other !== undefined &&
      diagnostic.code === other.code &&
      diagnostic.path === other.path &&
      diagnostic.message === other.message &&
      diagnostic.severity === other.severity
    );
  });
}

class SpaceImpl implements BoardSpace {
  readonly id: string;
  readonly lifetimeId: string;
  private readonly deps: SpaceDependencies;
  private readonly events: EventBus<SpaceEvent>;
  private readonly queryController: QueryController;
  private readonly datasetProvider: DatasetProvider | null;
  private readonly extensionSession: ExtensionSession | null;
  private readonly viewHost: ViewHost;
  private readonly views = new Map<string, ViewImpl>();
  private readonly tasks = new Map<string, unknown>();
  private readonly createdAt: number;
  private updatedAt: number;
  private committedDocument: BoardDocument;
  private committedRevision = 1;
  private draft: DraftState | null = null;
  private lease: EditorLease | null = null;
  private localeConfig: LocaleConfig;
  private formatters: FormatterProvider;
  private messages: MessageProvider;
  private diagnostics: readonly Diagnostic[] = EMPTY_DIAGNOSTICS;
  private filterRuntimeState: FilterRuntimeState = createEmptyFilterRuntimeState();
  private validationDiagnostics: readonly Diagnostic[] = EMPTY_DIAGNOSTICS;
  private status: SpaceStatus = "active";
  private sequence = 0;
  private disposedFlag = false;
  private disposing = false;
  private leaseReleaseInProgress = false;

  constructor(options: SpaceInitOptions, deps: SpaceDependencies) {
    this.id = options.id ?? deps.idFactory.createId("space");
    this.lifetimeId = deps.idFactory.createId("lifetime");
    this.deps = deps;
    this.localeConfig = options.localeConfig;
    this.formatters = deps.formatterFactory(options.localeConfig);
    this.messages = createMessageProvider({
      locale: options.localeConfig.locale,
      dictionaries: deps.messageDictionaries,
    });
    reportMessageDiagnostics(deps.logger, this.messages.diagnostics);
    this.committedDocument = snapshotDocument(options.document as BoardDocument);
    this.validationDiagnostics = deepFreeze([...(options.warnings ?? [])]);
    this.createdAt = deps.clock.now();
    this.updatedAt = this.createdAt;
    this.events = new EventBus<SpaceEvent>((error) => {
      deps.logger.error("Boardloom event listener failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
    this.events.subscribeInternal((event) => {
      deps.forwardEvent(event);
    });
    this.datasetProvider = options.datasetProvider ?? null;
    this.extensionSession = options.extensionSession ?? null;
    this.queryController = createQueryController({
      ...(options.datasetProvider === undefined ? {} : { provider: options.datasetProvider }),
      ...(options.realtime === undefined ? {} : { realtime: options.realtime }),
      idFactory: deps.idFactory,
      clock: deps.clock,
      emit: (event) => {
        this.updatedAt = this.deps.clock.now();
        this.emit(event);
      },
      emitRealtime: (event) => {
        this.updatedAt = this.deps.clock.now();
        this.emit(event);
      },
      isActive: () => !this.disposedFlag && !this.disposing,
    });
    this.viewHost = {
      spaceId: this.id,
      createId: (namespace) => deps.idFactory.createId(namespace),
      getState: () => this.getViewState(),
      getLease: (leaseId) => this.getActiveLease(leaseId),
      updateDraft: (lease, document) => this.updateDraft(lease, document),
      updateDraftWithOptions: (lease, document, options) =>
        this.updateDraft(lease, document, options),
      updateBinding: (lease, change) => this.updateBinding(lease, change),
      undoDraft: (lease) => this.undoDraft(lease),
      redoDraft: (lease) => this.redoDraft(lease),
      applyDraft: (lease) => this.applyDraft(lease),
      cancelDraft: (lease) => this.cancelDraft(lease),
      releaseLease: (lease, decision) => this.releaseEditorLease(lease, { decision }),
      emitModeChanged: (viewId, sessionId, from, to) => {
        this.updatedAt = this.deps.clock.now();
        this.emit({ type: "mode:changed", viewId, sessionId, from, to });
      },
      detachView: (viewId) => {
        const removed = this.views.delete(viewId);
        if (removed && !this.disposedFlag && !this.disposing) {
          this.updatedAt = this.deps.clock.now();
          this.emit({ type: "view:disposed", viewId });
        }
      },
    };
  }

  get disposed(): boolean {
    return this.disposedFlag;
  }

  get listenerCount(): number {
    return this.events.listenerCount;
  }

  get taskCount(): number {
    return this.tasks.size;
  }

  get viewCount(): number {
    return this.views.size;
  }

  start(importMetadata?: SpaceImportMetadata): void {
    const initialWarnings = this.validationDiagnostics;
    const initialSchemaVersion = documentSchemaVersion(this.committedDocument);
    this.emit({ type: "space:created" });
    if (importMetadata) {
      if (importMetadata.migration?.migrated) {
        this.emit({ type: "document:migrated", report: importMetadata.migration });
      }
      this.emit({
        type: "space:imported",
        documentId: importMetadata.documentId,
        ...(importMetadata.sourceSpaceId === undefined
          ? {}
          : { sourceSpaceId: importMetadata.sourceSpaceId }),
        schemaVersion: importMetadata.schemaVersion,
        migration: importMetadata.migration,
        warnings: importMetadata.warnings,
      });
      this.emitLoaded(importMetadata.warnings, importMetadata.schemaVersion);
      return;
    }
    this.emitLoaded(initialWarnings, initialSchemaVersion);
  }

  getFormatters(): FormatterProvider {
    return this.formatters;
  }

  getDatasetDescriptor(datasetId: string): DatasetDescriptor | undefined {
    if (this.disposedFlag || this.disposing || this.datasetProvider === null) {
      return undefined;
    }
    try {
      return this.datasetProvider.getDatasetDescriptor(datasetId);
    } catch {
      return undefined;
    }
  }

  getMessageProvider(): MessageProvider {
    return this.messages;
  }

  getExtensionThemeTokens(): Readonly<Record<string, string>> {
    return this.extensionSession?.themeTokens ?? Object.freeze({});
  }

  getFilterState(): FilterRuntimeState {
    return this.filterRuntimeState;
  }

  private filterDiagnostics(state: FilterRuntimeState): readonly Diagnostic[] {
    const catalog = this.bindingValidationCatalog();
    const committedDocument = this.committedDocument as unknown as BoardDocumentV1;
    const committed = validateFilterRuntimeState(
      committedDocument,
      pruneFilterState(committedDocument, state),
      catalog,
    );
    if (this.draft === null || jsonEqual(this.draft.document, this.committedDocument)) {
      return committed;
    }
    const draftDocument = this.draft.document as unknown as BoardDocumentV1;
    return Object.freeze([
      ...committed,
      ...validateFilterRuntimeState(draftDocument, pruneFilterState(draftDocument, state), catalog),
    ]);
  }

  private acceptFilterState(
    state: FilterRuntimeState,
    reason: "value" | "reset" | "cross-filter" | "document",
  ): Result<FilterRuntimeState> {
    const diagnostics = this.filterDiagnostics(state);
    if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
      this.emit({ type: "filter:rejected", reason, diagnostics });
      return fail(diagnostics);
    }
    const previous = this.filterRuntimeState;
    if (jsonEqual(state as never, previous as never)) {
      return ok(previous);
    }
    const document = (this.draft?.document ?? this.committedDocument) as unknown as BoardDocumentV1;
    const catalog = this.bindingValidationCatalog();
    const previousActive = new Map(
      previous.activeValues.map((entry) => [entry.filterId, entry.value] as const),
    );
    const nextActive = new Map(
      state.activeValues.map((entry) => [entry.filterId, entry.value] as const),
    );
    const previousCross = new Map(previous.crossFilters.map((entry) => [entry.id, entry] as const));
    const nextCross = new Map(state.crossFilters.map((entry) => [entry.id, entry] as const));
    this.filterRuntimeState = state;
    this.updatedAt = this.deps.clock.now();
    for (const filter of document.filters) {
      const before = previousActive.get(filter.id);
      const after = nextActive.get(filter.id);
      if (jsonEqual(before as never, after as never)) {
        continue;
      }
      const value = after === undefined ? filter.defaultValue : after;
      this.emit({
        type: "filter:changed",
        filterId: filter.id,
        scope: Object.freeze({ ...filter.target }),
        ...(value === undefined ? {} : { value }),
        active: after !== undefined,
        reason: reason === "cross-filter" ? "document" : reason,
        diagnostics,
      });
    }
    for (const [id, selection] of previousCross) {
      if (nextCross.has(id)) {
        continue;
      }
      this.emit({
        type: "crossfilter:changed",
        sourceBlockId: selection.sourceBlockId,
        targetIds: crossFilterTargetIds(document, selection, catalog),
        selectionId: id,
        cleared: true,
      });
    }
    for (const [id, selection] of nextCross) {
      const before = previousCross.get(id);
      if (before !== undefined && jsonEqual(before as never, selection as never)) {
        continue;
      }
      this.emit({
        type: "crossfilter:changed",
        sourceBlockId: selection.sourceBlockId,
        targetIds: crossFilterTargetIds(document, selection, catalog),
        selectionId: id,
        cleared: false,
      });
    }
    return ok(state);
  }

  setFilterValue(
    filterId: string,
    value: JsonValue,
    options: { readonly allowLocked?: boolean } = {},
  ): Result<FilterRuntimeState> {
    const blocked = this.assertActive();
    if (blocked) {
      return blocked;
    }
    const document = (this.draft?.document ?? this.committedDocument) as unknown as BoardDocumentV1;
    const filter = document.filters.find((entry) => entry.id === filterId);
    if (filter === undefined) {
      return this.failWith([
        createDiagnostic(DIAGNOSTIC_CODES.INVALID_REFERENCE, `filters/${filterId}`, {
          relatedIds: [filterId],
        }),
      ]);
    }
    if (filter.viewerEditable !== true && options.allowLocked !== true) {
      return this.failWith([
        createDiagnostic(DIAGNOSTIC_CODES.VIEWER_READ_ONLY, `filters/${filterId}`, {
          message: formatEnglishMessage("diagnostic.detail.filter.notEditable", {
            filter: filterId,
          }),
          detailKey: "diagnostic.detail.filter.notEditable",
          detailParams: { filter: filterId },
          relatedIds: [filterId],
        }),
      ]);
    }
    const descriptor = document.datasets
      .find((entry) => entry.id === filter.field.datasetId)
      ?.fields?.find((entry) => entry.id === filter.field.fieldId);
    if (
      filter.operator === "isNull" ||
      filter.operator === "isNotNull" ||
      filter.operator === "isTrue" ||
      filter.operator === "isFalse" ||
      !valueShapeMatchesOperator(filter.operator, value) ||
      (descriptor !== undefined && !valueMatchesType(value, descriptor.type))
    ) {
      return this.failWith([
        createDiagnostic(
          DIAGNOSTIC_CODES.FILTER_STATE_INVALID,
          `filterState/activeValues/${filterId}`,
          {
            message: formatEnglishMessage("diagnostic.detail.filter.invalidValue", {
              filter: filterId,
            }),
            detailKey: "diagnostic.detail.filter.invalidValue",
            detailParams: { filter: filterId },
            relatedIds: [filterId],
          },
        ),
      ]);
    }
    const candidate = filterStateWithActiveValue(this.filterRuntimeState, filterId, value);
    return this.acceptFilterState(candidate, "value");
  }

  setFilterRuntimeState(value: unknown): Result<FilterRuntimeState> {
    const blocked = this.assertActive();
    if (blocked) {
      return blocked;
    }
    const parsed = parseFilterRuntimeState(value);
    if (!parsed.ok) {
      return parsed;
    }
    const document = this.committedDocument as unknown as BoardDocumentV1;
    const pruned = pruneFilterState(document, parsed.value);
    for (const selection of pruned.crossFilters) {
      const validated = validateCrossFilterSelection(
        document,
        selection,
        this.bindingValidationCatalog(),
      );
      if (!validated.ok) {
        return validated;
      }
    }
    return this.acceptFilterState(pruned, "document");
  }

  resetFilter(
    filterId: string,
    options: { readonly allowLocked?: boolean } = {},
  ): Result<FilterRuntimeState> {
    const blocked = this.assertActive();
    if (blocked) {
      return blocked;
    }
    const document = (this.draft?.document ?? this.committedDocument) as unknown as BoardDocumentV1;
    const filter = document.filters.find((entry) => entry.id === filterId);
    if (filter === undefined) {
      return this.failWith([
        createDiagnostic(DIAGNOSTIC_CODES.INVALID_REFERENCE, `filters/${filterId}`, {
          relatedIds: [filterId],
        }),
      ]);
    }
    if (filter.viewerEditable !== true && options.allowLocked !== true) {
      return this.failWith([
        createDiagnostic(DIAGNOSTIC_CODES.VIEWER_READ_ONLY, `filters/${filterId}`, {
          message: formatEnglishMessage("diagnostic.detail.filter.notEditable", {
            filter: filterId,
          }),
          detailKey: "diagnostic.detail.filter.notEditable",
          detailParams: { filter: filterId },
          relatedIds: [filterId],
        }),
      ]);
    }
    return this.acceptFilterState(
      filterStateWithoutActiveValues(this.filterRuntimeState, new Set([filterId])),
      "reset",
    );
  }

  resetFilterScope(
    target: "board" | "group" | "block",
    id?: string,
    options: { readonly allowLocked?: boolean } = {},
  ): Result<FilterRuntimeState> {
    const blocked = this.assertActive();
    if (blocked) {
      return blocked;
    }
    const document = (this.draft?.document ?? this.committedDocument) as unknown as BoardDocumentV1;
    const ids = new Set<string>();
    for (const filter of document.filters) {
      const matches =
        target === "board"
          ? filter.target.kind === "board"
          : target === "group"
            ? filter.target.kind === "group" && filter.target.groupId === id
            : filter.target.kind === "block" && filter.target.blockId === id;
      if (!matches) {
        continue;
      }
      if (filter.viewerEditable !== true && options.allowLocked !== true) {
        continue;
      }
      ids.add(filter.id);
    }
    if (ids.size === 0) {
      return ok(this.filterRuntimeState);
    }
    return this.acceptFilterState(
      filterStateWithoutActiveValues(this.filterRuntimeState, ids),
      "reset",
    );
  }

  resetAllFilters(options: { readonly allowLocked?: boolean } = {}): Result<FilterRuntimeState> {
    const blocked = this.assertActive();
    if (blocked) {
      return blocked;
    }
    const document = (this.draft?.document ?? this.committedDocument) as unknown as BoardDocumentV1;
    const ids = new Set(
      document.filters
        .filter((filter) => filter.viewerEditable === true || options.allowLocked === true)
        .map((filter) => filter.id),
    );
    return this.acceptFilterState(
      filterStateWithoutActiveValues(this.filterRuntimeState, ids),
      "reset",
    );
  }

  setCrossFilter(
    selection: CrossFilterSelectionInput | null,
    options: { readonly toggle?: boolean } = {},
  ): Result<FilterRuntimeState> {
    const blocked = this.assertActive();
    if (blocked) {
      return blocked;
    }
    if (selection === null) {
      return this.clearCrossFilters();
    }
    const document = (this.draft?.document ?? this.committedDocument) as unknown as BoardDocumentV1;
    const validated = validateCrossFilterSelection(
      document,
      selection,
      this.bindingValidationCatalog(),
    );
    if (!validated.ok) {
      return validated;
    }
    if (options.toggle === true) {
      const sameField = this.filterRuntimeState.crossFilters.filter(
        (candidate) =>
          candidate.sourceBlockId === validated.value.sourceBlockId &&
          candidate.field.datasetId === validated.value.field.datasetId &&
          candidate.field.fieldId === validated.value.field.fieldId &&
          candidate.operator === validated.value.operator,
      );
      const exact = sameField.find((candidate) =>
        jsonEqual(candidate.value, validated.value.value),
      );
      if (exact !== undefined) {
        return this.acceptFilterState(
          filterStateWithoutCrossFilter(this.filterRuntimeState, exact.id),
          "cross-filter",
        );
      }
      const withoutField = this.filterRuntimeState.crossFilters.filter(
        (candidate) => !sameField.includes(candidate),
      );
      return this.acceptFilterState(
        makeFilterState(this.filterRuntimeState.activeValues, [...withoutField, validated.value]),
        "cross-filter",
      );
    }
    return this.acceptFilterState(
      filterStateWithCrossFilter(this.filterRuntimeState, validated.value),
      "cross-filter",
    );
  }

  setCrossFilters(selections: readonly CrossFilterSelectionInput[]): Result<FilterRuntimeState> {
    const blocked = this.assertActive();
    if (blocked) {
      return blocked;
    }
    const document = (this.draft?.document ?? this.committedDocument) as unknown as BoardDocumentV1;
    const validated: CrossFilterSelection[] = [];
    for (const selection of selections) {
      const result = validateCrossFilterSelection(
        document,
        selection,
        this.bindingValidationCatalog(),
      );
      if (!result.ok) {
        return result;
      }
      validated.push(result.value);
    }
    return this.acceptFilterState(
      makeFilterState(this.filterRuntimeState.activeValues, validated),
      "cross-filter",
    );
  }

  clearCrossFilters(): Result<FilterRuntimeState> {
    const blocked = this.assertActive();
    if (blocked) {
      return blocked;
    }
    return this.acceptFilterState(
      makeFilterState(this.filterRuntimeState.activeValues, []),
      "cross-filter",
    );
  }

  getValidationCatalog(): BoardValidationCatalog | undefined {
    if (this.disposedFlag || this.disposing) {
      return undefined;
    }
    return this.bindingValidationCatalog();
  }

  getSnapshot(): SpaceSnapshot {
    const draft = this.draft ? this.createDraftSnapshot(this.draft) : null;
    const queries = this.queryController.listQueryStates();
    return deepFreeze({
      spaceId: this.id,
      lifetimeId: this.lifetimeId,
      status: this.status,
      committedDocument: this.committedDocument,
      committedRevision: this.committedRevision,
      draft,
      editorLease: this.lease,
      locale: this.localeConfig.locale,
      timezone: this.localeConfig.timezone,
      diagnostics: this.combinedDiagnostics(),
      filterState: this.filterRuntimeState,
      queries,
      queryCount: queries.length,
      views: Object.freeze([...this.views.values()].map((view) => view.describe())),
      viewCount: this.views.size,
      listenerCount: this.events.listenerCount,
      taskCount: this.tasks.size,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      sequence: this.sequence,
    });
  }

  summary(): SpaceSummary {
    return Object.freeze({
      spaceId: this.id,
      lifetimeId: this.lifetimeId,
      status: this.status,
      committedRevision: this.committedRevision,
      viewCount: this.views.size,
    });
  }

  exportDocument(options: BoardSerializationOptions = {}): Result<BoardSerialization> {
    const blocked = this.assertActive();
    if (blocked) {
      return blocked;
    }
    const serialized = serializeBoardDocument(this.committedDocument, {
      ...options,
      ...(options.catalog === undefined && this.deps.validationCatalog !== undefined
        ? { catalog: this.deps.validationCatalog }
        : {}),
    });
    if (!serialized.ok) {
      return serialized;
    }
    this.updatedAt = this.deps.clock.now();
    this.emit({
      type: "document:exported",
      document: serialized.value.document,
      schemaVersion: serialized.value.schemaVersion,
    });
    return serialized;
  }

  loadDocument(
    document: unknown,
    options: { readonly source?: string } = {},
  ): Result<SpaceSnapshot> {
    const blocked = this.assertActive();
    if (blocked) {
      return blocked;
    }
    const validation = this.deps.documentValidator(document);
    if (isBlockingValidation(validation)) {
      return this.failDocument(validation.diagnostics, "load");
    }
    const fixedChanges = assertFixedBindingsPreserved(
      this.committedDocument,
      document as BoardDocument,
    );
    if (fixedChanges.length > 0) {
      return this.failDocument(fixedChanges, "load");
    }
    const filterDiagnostics = validateFilterRuntimeState(
      document as BoardDocumentV1,
      this.filterRuntimeState,
      this.bindingValidationCatalog(),
    );
    if (filterDiagnostics.some((diagnostic) => diagnostic.severity === "error")) {
      return this.failDocument(filterDiagnostics, "load");
    }
    const warnings = validationWarnings(validation);
    const previousDiagnostics = this.combinedDiagnostics();
    const previousDocument = this.committedDocument as unknown as BoardDocumentV1;
    const loadedDocument = snapshotDocument(document as BoardDocument);
    const loadedSchemaVersion = documentSchemaVersion(loadedDocument);
    this.committedDocument = loadedDocument;
    this.filterRuntimeState = pruneFilterState(
      loadedDocument as unknown as BoardDocumentV1,
      this.filterRuntimeState,
    );
    this.committedRevision += 1;
    this.setDiagnosticsState(warnings);
    this.enqueueDiagnosticsChange(previousDiagnostics);
    this.enqueueComparisonChanges(
      previousDocument,
      loadedDocument as unknown as BoardDocumentV1,
      "document",
    );
    this.enqueue({
      type: "document:changed",
      document: loadedDocument,
      source: options.source ?? "host",
    });
    this.enqueue({
      type: "space:loaded",
      schemaVersion: loadedSchemaVersion,
      warnings,
    });
    this.flushEvents();
    return ok(this.getSnapshot());
  }

  setLocale(config: LocaleConfigInput): Result<SpaceSnapshot> {
    const blocked = this.assertActive();
    if (blocked) {
      return blocked;
    }
    const resolved = resolveLocaleConfig(config, this.localeConfig);
    if (!resolved.ok) {
      return this.failWith(resolved.diagnostics);
    }
    const next = resolved.value;
    if (next.locale === this.localeConfig.locale && next.timezone === this.localeConfig.timezone) {
      return ok(this.getSnapshot());
    }

    let formatters: FormatterProvider;
    let messages: MessageProvider;
    try {
      formatters = this.deps.formatterFactory(next);
      messages = createMessageProvider({
        locale: next.locale,
        dictionaries: this.deps.messageDictionaries,
      });
    } catch (error) {
      if (error instanceof BoardloomError) {
        return this.failWith([error.diagnostic]);
      }
      return this.failWith([
        createDiagnostic(DIAGNOSTIC_CODES.FORMATTER_INIT_FAILED, "locale", {
          message: error instanceof Error ? error.message : String(error),
        }),
      ]);
    }

    const previous = this.localeConfig;
    const previousFormatters = this.formatters;
    this.localeConfig = next;
    this.formatters = formatters;
    const formatterDiagnostics = this.extensionSession?.releaseFormatter(previousFormatters) ?? [];
    for (const diagnostic of formatterDiagnostics) {
      this.deps.logger.error("Boardloom formatter disposal failed", {
        code: diagnostic.code,
        path: diagnostic.path,
      });
    }
    this.messages = messages;
    reportMessageDiagnostics(this.deps.logger, messages.diagnostics);
    this.updatedAt = this.deps.clock.now();
    this.clearDiagnostics();
    this.emit({
      type: "locale:changed",
      locale: next.locale,
      timezone: next.timezone,
      fromLocale: previous.locale,
      fromTimezone: previous.timezone,
    });
    return ok(this.getSnapshot());
  }

  setQuery(queryId: string, spec: QuerySpec, options: QuerySetOptions = {}): Result<QueryState> {
    const blocked = this.assertActive();
    if (blocked) {
      return blocked;
    }
    this.updatedAt = this.deps.clock.now();
    return this.queryController.setQuery(queryId, spec, options);
  }

  refreshQuery(queryId: string): Result<QueryState> {
    const blocked = this.assertActive();
    if (blocked) {
      return blocked;
    }
    this.updatedAt = this.deps.clock.now();
    return this.queryController.refreshQuery(queryId);
  }

  invalidateQuery(queryId: string, reason?: string): Result<QueryState> {
    const blocked = this.assertActive();
    if (blocked) {
      return blocked;
    }
    this.updatedAt = this.deps.clock.now();
    return this.queryController.invalidateQuery(queryId, reason);
  }

  cancelQuery(queryId: string, reason?: string): Result<QueryState> {
    const blocked = this.assertActive();
    if (blocked) {
      return blocked;
    }
    this.updatedAt = this.deps.clock.now();
    return this.queryController.cancelQuery(queryId, reason);
  }

  removeQuery(queryId: string): Result<void> {
    const blocked = this.assertActive();
    if (blocked) {
      return blocked;
    }
    this.updatedAt = this.deps.clock.now();
    return this.queryController.removeQuery(queryId);
  }

  getQueryState(queryId: string): QueryState | undefined {
    return this.queryController.getQueryState(queryId);
  }

  getQueryStates(): readonly QueryState[] {
    return this.queryController.listQueryStates();
  }

  getRealtimeInfo(): RealtimeTransportInfo | null {
    return this.queryController.getRealtimeInfo();
  }

  getRealtimeState(queryId: string): RealtimeSubscriptionState | undefined {
    return this.queryController.getRealtimeState(queryId);
  }

  getRealtimeStates(): readonly RealtimeSubscriptionState[] {
    return this.queryController.listRealtimeStates();
  }

  pauseRealtime(queryId?: string): Result<readonly RealtimeSubscriptionState[]> {
    return this.queryController.pauseRealtime(queryId);
  }

  resumeRealtime(queryId?: string): Result<readonly RealtimeSubscriptionState[]> {
    return this.queryController.resumeRealtime(queryId);
  }

  resyncRealtime(queryId?: string, reason?: string): Result<readonly RealtimeSubscriptionState[]> {
    return this.queryController.resyncRealtime(queryId, reason);
  }

  closeRealtime(queryId?: string, reason?: string): Result<readonly RealtimeSubscriptionState[]> {
    return this.queryController.closeRealtime(queryId, reason);
  }

  pause(): Result<SpaceSnapshot> {
    const blocked = this.assertActive();
    if (blocked) {
      return blocked;
    }
    if (this.status === "paused") {
      return ok(this.getSnapshot());
    }
    this.status = "paused";
    this.queryController.pauseRealtime();
    this.updatedAt = this.deps.clock.now();
    return ok(this.getSnapshot());
  }

  resume(): Result<SpaceSnapshot> {
    const blocked = this.assertActive();
    if (blocked) {
      return blocked;
    }
    if (this.status === "active") {
      return ok(this.getSnapshot());
    }
    this.status = "active";
    this.queryController.resumeRealtime();
    this.updatedAt = this.deps.clock.now();
    return ok(this.getSnapshot());
  }

  createView(options: CreateViewOptions = {}): Result<BoardView> {
    const blocked = this.assertActive();
    if (blocked) {
      return blocked;
    }
    const mode: ViewMode = options.mode ?? "viewer";
    if (mode !== "viewer" && mode !== "editor") {
      return this.failWith([
        createDiagnostic(DIAGNOSTIC_CODES.INVALID_ARGUMENT, "mode", {
          message: "A view mode must be viewer or editor.",
        }),
      ]);
    }
    let lease: EditorLease | null = null;
    if (options.lease) {
      lease = this.getActiveLease(options.lease.leaseId);
      if (!lease) {
        return this.failWith([createDiagnostic(DIAGNOSTIC_CODES.EDITOR_LEASE_INVALID, "lease")]);
      }
    }
    if (mode === "editor" && !lease) {
      return this.failWith([
        createDiagnostic(DIAGNOSTIC_CODES.EDITOR_LEASE_REQUIRED, "lease", {
          message: "Editor views require an active editor lease.",
        }),
      ]);
    }
    const view = createView(this.viewHost, { mode, lease: lease ?? undefined });
    this.views.set(view.viewId, view as ViewImpl);
    this.updatedAt = this.deps.clock.now();
    return ok(view);
  }

  acquireEditorLease(options: AcquireEditorLeaseOptions = {}): Result<EditorLease> {
    const blocked = this.assertActive();
    if (blocked) {
      return blocked;
    }
    if (this.leaseReleaseInProgress) {
      return fail([
        createDiagnostic(DIAGNOSTIC_CODES.EDITOR_LEASE_CONFLICT, "lease", {
          message: "A lease release is in progress; wait for it to complete.",
        }),
      ]);
    }
    if (this.lease) {
      const sessionId = options.sessionId ?? this.lease.sessionId;
      const diagnostic = createDiagnostic(DIAGNOSTIC_CODES.EDITOR_LEASE_CONFLICT, "lease", {
        relatedIds: [this.lease.leaseId],
      });
      this.setDiagnostics([diagnostic]);
      this.emit({
        type: "editor:lease-changed",
        sessionId,
        status: "rejected",
        diagnostic,
      });
      return fail([diagnostic]);
    }
    if (
      options.sessionId !== undefined &&
      (typeof options.sessionId !== "string" || options.sessionId.trim() === "")
    ) {
      return this.failWith([
        createDiagnostic(DIAGNOSTIC_CODES.INVALID_ARGUMENT, "sessionId", {
          message: "The editor session ID must be a non-empty string.",
        }),
      ]);
    }

    if (!this.draft) {
      this.draft = this.createDraft(this.committedDocument, this.committedRevision);
    }
    const lease: EditorLease = Object.freeze({
      leaseId: this.deps.idFactory.createId("lease"),
      spaceId: this.id,
      sessionId: options.sessionId ?? this.deps.idFactory.createId("session"),
      acquiredAt: this.deps.clock.now(),
    });
    this.lease = lease;
    this.updatedAt = this.deps.clock.now();
    this.clearDiagnostics();
    this.emit({
      type: "editor:lease-changed",
      sessionId: lease.sessionId,
      status: "acquired",
    });
    return ok(lease);
  }

  releaseEditorLease(
    lease: EditorLease,
    options: ReleaseEditorLeaseOptions = {},
  ): Result<SpaceSnapshot> {
    const blocked = this.assertActive();
    if (blocked) {
      return blocked;
    }
    const releasing = this.assertNotReleasing();
    if (releasing) {
      return releasing;
    }
    if (
      options.decision !== undefined &&
      options.decision !== "apply" &&
      options.decision !== "cancel"
    ) {
      return this.failWith([
        createDiagnostic(DIAGNOSTIC_CODES.INVALID_ARGUMENT, "decision", {
          message: "A draft decision must be apply or cancel.",
        }),
      ]);
    }
    const active = this.requireLease(lease);
    if (!active.ok) {
      const diagnostic = active.diagnostics[0];
      if (diagnostic) {
        this.emit({
          type: "editor:lease-changed",
          sessionId: lease.sessionId,
          status: "rejected",
          diagnostic,
        });
      }
      return active;
    }
    if (this.isDraftDirty() && options.decision === undefined) {
      const diagnostic = createDiagnostic(DIAGNOSTIC_CODES.DRAFT_REQUIRES_DECISION, "draft");
      this.setDiagnostics([diagnostic]);
      this.emit({
        type: "editor:lease-changed",
        sessionId: active.value.sessionId,
        status: "rejected",
        diagnostic,
      });
      return fail([diagnostic]);
    }

    if (options.decision === "apply") {
      const prepared = this.prepareDraftApply();
      if (!prepared.ok) {
        return prepared;
      }
      const previousDiagnostics = this.combinedDiagnostics();
      this.beginLeaseRelease(active.value);
      const committed = this.commitDraftState(prepared.value);
      this.completeLeaseReleaseState();
      this.publishDiagnosticsChange(previousDiagnostics);
      if (committed) {
        this.emitDraftCommitted(committed);
      }
      this.emitLeaseReleased(active.value);
      if (!committed) {
        return fail([createDiagnostic(DIAGNOSTIC_CODES.EDITOR_LEASE_REQUIRED, "draft")]);
      }
      return ok(this.getSnapshot());
    }

    if (options.decision === "cancel") {
      const previousDiagnostics = this.combinedDiagnostics();
      const revision = this.committedRevision;
      this.beginLeaseRelease(active.value);
      this.resetDraftStateFromCommitted();
      this.completeLeaseReleaseState();
      this.publishDiagnosticsChange(previousDiagnostics);
      this.emitDraftCancelled(revision);
      this.emitLeaseReleased(active.value);
      return ok(this.getSnapshot());
    }

    const previousDiagnostics = this.combinedDiagnostics();
    this.beginLeaseRelease(active.value);
    this.completeLeaseReleaseState();
    this.publishDiagnosticsChange(previousDiagnostics);
    this.emitLeaseReleased(active.value);
    return ok(this.getSnapshot());
  }

  updateDraft(
    lease: EditorLease,
    document: unknown,
    options: DraftUpdateOptions = {},
  ): Result<DraftSnapshot> {
    const blocked = this.assertActive();
    if (blocked) {
      return blocked;
    }
    const releasing = this.assertNotReleasing();
    if (releasing) {
      return releasing;
    }
    const active = this.requireLease(lease);
    if (!active.ok) {
      return active;
    }
    const draft = this.draft;
    if (!draft) {
      return this.failWith([createDiagnostic(DIAGNOSTIC_CODES.EDITOR_LEASE_REQUIRED, "draft")]);
    }
    const validation = this.deps.documentValidator(document);
    if (isBlockingValidation(validation)) {
      return this.failDocument(
        [createDiagnostic(DIAGNOSTIC_CODES.DRAFT_INVALID, "draft"), ...validation.diagnostics],
        "draft",
      );
    }
    const allowedRemovedBlockIds = new Set(draft.allowedRemovedBlockIds);
    if (options.allowRemovedBlockIds !== undefined) {
      for (const blockId of options.allowRemovedBlockIds) {
        if (typeof blockId === "string" && blockId.trim() !== "") {
          allowedRemovedBlockIds.add(blockId);
        }
      }
    }
    const fixedChanges = assertFixedBindingsPreserved(
      this.committedDocument,
      document as BoardDocument,
      { allowRemovedBlockIds: [...allowedRemovedBlockIds] },
    );
    if (fixedChanges.length > 0) {
      return this.failDocument(
        [createDiagnostic(DIAGNOSTIC_CODES.DRAFT_INVALID, "draft"), ...fixedChanges],
        "draft",
      );
    }
    const filterDiagnostics = validateFilterRuntimeState(
      document as BoardDocumentV1,
      this.filterRuntimeState,
      this.bindingValidationCatalog(),
    );
    if (filterDiagnostics.some((diagnostic) => diagnostic.severity === "error")) {
      return this.failDocument(
        [createDiagnostic(DIAGNOSTIC_CODES.DRAFT_INVALID, "draft"), ...filterDiagnostics],
        "draft",
      );
    }
    const warnings = validationWarnings(validation);
    const next = snapshotDocument(document as BoardDocument);
    const nextBlockIds = new Set(
      ((next as unknown as BoardDocumentV1).blocks ?? []).map((block) => block.id),
    );
    for (const blockId of allowedRemovedBlockIds) {
      if (nextBlockIds.has(blockId)) {
        allowedRemovedBlockIds.delete(blockId);
      }
    }
    if (jsonEqual(next, draft.document)) {
      const previousDiagnostics = this.combinedDiagnostics();
      this.setDiagnosticsState(warnings);
      this.publishDiagnosticsChange(previousDiagnostics);
      return ok(this.createDraftSnapshot(draft));
    }

    if (this.deps.historyLimit > 0) {
      draft.undo.push({
        document: draft.document,
        allowedRemovedBlockIds: new Set(draft.allowedRemovedBlockIds),
      });
      if (draft.undo.length > this.deps.historyLimit) {
        draft.undo.shift();
      }
    }
    draft.redo = [];
    const previousDocument = draft.document;
    draft.document = next;
    draft.allowedRemovedBlockIds = allowedRemovedBlockIds;
    draft.revision += 1;
    this.updatedAt = this.deps.clock.now();
    const changed = this.draftEventData(draft);
    const previousDiagnostics = this.combinedDiagnostics();
    this.setDiagnosticsState(warnings);
    this.enqueueDiagnosticsChange(previousDiagnostics);
    this.enqueueComparisonChanges(
      previousDocument as unknown as BoardDocumentV1,
      next as unknown as BoardDocumentV1,
      "draft",
    );
    this.enqueue({
      type: "draft:changed",
      revision: changed.revision,
      canUndo: changed.canUndo,
      canRedo: changed.canRedo,
    });
    this.flushEvents();
    return ok(this.createDraftSnapshot(draft));
  }

  updateBinding(lease: EditorLease, change: BindingSlotChange): Result<DraftSnapshot> {
    const blocked = this.assertActive();
    if (blocked) {
      return blocked;
    }
    const releasing = this.assertNotReleasing();
    if (releasing) {
      return releasing;
    }
    const active = this.requireLease(lease);
    if (!active.ok) {
      return active;
    }
    const source = this.draft?.document ?? this.committedDocument;
    const catalog = this.bindingValidationCatalog();
    const applied = setBindingSlot(
      source as unknown as BoardDocumentV1,
      change,
      catalog === undefined ? {} : { catalog },
    );
    if (!applied.ok) {
      return this.failWith(applied.diagnostics);
    }
    return this.updateDraft(lease, applied.value.document);
  }

  undoDraft(lease: EditorLease): Result<DraftSnapshot> {
    const blocked = this.assertActive();
    if (blocked) {
      return blocked;
    }
    const releasing = this.assertNotReleasing();
    if (releasing) {
      return releasing;
    }
    const active = this.requireLease(lease);
    if (!active.ok) {
      return active;
    }
    const draft = this.draft;
    if (!draft || draft.undo.length === 0) {
      return this.failWith([createDiagnostic(DIAGNOSTIC_CODES.DRAFT_HISTORY_EMPTY, "draft")]);
    }
    const previous = draft.undo.pop();
    if (!previous) {
      return this.failWith([createDiagnostic(DIAGNOSTIC_CODES.DRAFT_HISTORY_EMPTY, "draft")]);
    }
    const previousDocument = draft.document;
    const nextDocument = previous.document;
    draft.redo.push({
      document: draft.document,
      allowedRemovedBlockIds: new Set(draft.allowedRemovedBlockIds),
    });
    if (draft.redo.length > this.deps.historyLimit) {
      draft.redo.shift();
    }
    draft.document = nextDocument;
    draft.allowedRemovedBlockIds = new Set(previous.allowedRemovedBlockIds);
    draft.revision += 1;
    this.updatedAt = this.deps.clock.now();
    const changed = this.draftEventData(draft);
    const previousDiagnostics = this.combinedDiagnostics();
    this.diagnostics = EMPTY_DIAGNOSTICS;
    this.enqueueDiagnosticsChange(previousDiagnostics);
    this.enqueueComparisonChanges(
      previousDocument as unknown as BoardDocumentV1,
      nextDocument as unknown as BoardDocumentV1,
      "draft",
    );
    this.enqueue({
      type: "draft:changed",
      revision: changed.revision,
      canUndo: changed.canUndo,
      canRedo: changed.canRedo,
    });
    this.flushEvents();
    return ok(this.createDraftSnapshot(draft));
  }

  redoDraft(lease: EditorLease): Result<DraftSnapshot> {
    const blocked = this.assertActive();
    if (blocked) {
      return blocked;
    }
    const releasing = this.assertNotReleasing();
    if (releasing) {
      return releasing;
    }
    const active = this.requireLease(lease);
    if (!active.ok) {
      return active;
    }
    const draft = this.draft;
    if (!draft || draft.redo.length === 0) {
      return this.failWith([createDiagnostic(DIAGNOSTIC_CODES.DRAFT_HISTORY_EMPTY, "draft")]);
    }
    const next = draft.redo.pop();
    if (!next) {
      return this.failWith([createDiagnostic(DIAGNOSTIC_CODES.DRAFT_HISTORY_EMPTY, "draft")]);
    }
    const previousDocument = draft.document;
    const nextDocument = next.document;
    draft.undo.push({
      document: draft.document,
      allowedRemovedBlockIds: new Set(draft.allowedRemovedBlockIds),
    });
    if (draft.undo.length > this.deps.historyLimit) {
      draft.undo.shift();
    }
    draft.document = nextDocument;
    draft.allowedRemovedBlockIds = new Set(next.allowedRemovedBlockIds);
    draft.revision += 1;
    this.updatedAt = this.deps.clock.now();
    const changed = this.draftEventData(draft);
    const previousDiagnostics = this.combinedDiagnostics();
    this.diagnostics = EMPTY_DIAGNOSTICS;
    this.enqueueDiagnosticsChange(previousDiagnostics);
    this.enqueueComparisonChanges(
      previousDocument as unknown as BoardDocumentV1,
      nextDocument as unknown as BoardDocumentV1,
      "draft",
    );
    this.enqueue({
      type: "draft:changed",
      revision: changed.revision,
      canUndo: changed.canUndo,
      canRedo: changed.canRedo,
    });
    this.flushEvents();
    return ok(this.createDraftSnapshot(draft));
  }

  applyDraft(lease: EditorLease): Result<SpaceSnapshot> {
    const blocked = this.assertActive();
    if (blocked) {
      return blocked;
    }
    const releasing = this.assertNotReleasing();
    if (releasing) {
      return releasing;
    }
    const active = this.requireLease(lease);
    if (!active.ok) {
      return active;
    }
    const prepared = this.prepareDraftApply();
    if (!prepared.ok) {
      return prepared;
    }
    const previousDiagnostics = this.combinedDiagnostics();
    const committed = this.commitDraftState(prepared.value);
    if (!committed) {
      return fail([createDiagnostic(DIAGNOSTIC_CODES.EDITOR_LEASE_REQUIRED, "draft")]);
    }
    this.publishDiagnosticsChange(previousDiagnostics);
    this.emitDraftCommitted(committed);
    return ok(this.getSnapshot());
  }

  cancelDraft(lease: EditorLease): Result<SpaceSnapshot> {
    const blocked = this.assertActive();
    if (blocked) {
      return blocked;
    }
    const releasing = this.assertNotReleasing();
    if (releasing) {
      return releasing;
    }
    const active = this.requireLease(lease);
    if (!active.ok) {
      return active;
    }
    if (!this.draft) {
      return this.failWith([createDiagnostic(DIAGNOSTIC_CODES.EDITOR_LEASE_REQUIRED, "draft")]);
    }
    const previousDiagnostics = this.combinedDiagnostics();
    const revision = this.committedRevision;
    this.resetDraftStateFromCommitted();
    this.publishDiagnosticsChange(previousDiagnostics);
    this.emitDraftCancelled(revision);
    return ok(this.getSnapshot());
  }

  schedule(callback: () => void, delayMs: number): Result<Unsubscribe> {
    const blocked = this.assertActive();
    if (blocked) {
      return blocked;
    }
    if (typeof callback !== "function" || !Number.isFinite(delayMs) || delayMs < 0) {
      return this.failWith([
        createDiagnostic(DIAGNOSTIC_CODES.INVALID_ARGUMENT, "schedule", {
          message: "A scheduled task requires a callback and a finite non-negative delay.",
        }),
      ]);
    }
    const taskId = this.deps.idFactory.createId("task");
    const handle = this.deps.clock.setTimeout(() => {
      this.tasks.delete(taskId);
      if (this.disposedFlag || this.disposing) {
        return;
      }
      try {
        callback();
      } catch (error) {
        this.deps.logger.error("Boardloom scheduled task failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }, delayMs);
    this.tasks.set(taskId, handle);

    return ok(() => {
      const activeHandle = this.tasks.get(taskId);
      if (activeHandle === undefined) {
        return;
      }
      this.tasks.delete(taskId);
      this.deps.clock.clearTimeout(activeHandle);
    });
  }

  subscribe(listener: (event: SpaceEvent) => void): Unsubscribe {
    if (this.disposedFlag || this.disposing) {
      return () => undefined;
    }
    return this.events.subscribe(listener);
  }

  beginEventBatch(): EventBatchHandle {
    if (this.disposedFlag || this.disposing) {
      return Object.freeze({
        flush: () => undefined,
        discard: () => undefined,
      });
    }
    this.events.suspend();
    let finished = false;
    return Object.freeze({
      flush: () => {
        if (finished) {
          return;
        }
        finished = true;
        this.events.resume(true);
      },
      discard: () => {
        if (finished) {
          return;
        }
        finished = true;
        this.events.removeQueued(() => true);
        this.events.resume(true);
      },
    });
  }

  dispose(): Result<void> {
    if (this.disposedFlag || this.disposing) {
      return ok(undefined);
    }
    this.disposing = true;
    this.queryController.dispose();
    this.events.beginShutdown();

    for (const handle of this.tasks.values()) {
      this.deps.clock.clearTimeout(handle);
    }
    this.tasks.clear();

    for (const view of this.views.values()) {
      view.markDisposed();
    }
    this.views.clear();

    this.draft = null;
    this.lease = null;
    this.status = "disposed";
    this.updatedAt = this.deps.clock.now();
    this.disposedFlag = true;
    const extensionDiagnostics = this.extensionSession?.dispose() ?? [];
    for (const diagnostic of extensionDiagnostics) {
      this.deps.logger.error("Boardloom extension disposal failed", {
        code: diagnostic.code,
        path: diagnostic.path,
      });
    }
    this.deps.onDisposed(this.id, this.lifetimeId);
    this.emitTerminal({ type: "space:disposed" });
    this.events.finishShutdown();
    return extensionDiagnostics.length === 0 ? ok(undefined) : fail(extensionDiagnostics);
  }

  private bindingValidationCatalog(): BoardValidationCatalog | undefined {
    if (this.datasetProvider === null) {
      return this.deps.validationCatalog;
    }
    try {
      const descriptors: DatasetDescriptor[] = [];
      for (const datasetId of this.datasetProvider.listDatasetIds()) {
        const descriptor = this.datasetProvider.getDatasetDescriptor(datasetId);
        if (descriptor !== undefined) {
          descriptors.push(descriptor);
        }
      }
      return descriptors.length === 0
        ? this.deps.validationCatalog
        : createEffectiveValidationCatalog(this.deps.validationCatalog, descriptors);
    } catch {
      return this.deps.validationCatalog;
    }
  }

  private createDraft(document: BoardDocument, baseRevision: number): DraftState {
    return {
      document,
      baseRevision,
      revision: 0,
      undo: [],
      redo: [],
      allowedRemovedBlockIds: new Set<string>(),
    };
  }

  private createDraftSnapshot(draft: DraftState): DraftSnapshot {
    return Object.freeze({
      revision: draft.revision,
      baseRevision: draft.baseRevision,
      document: draft.document,
      dirty: !jsonEqual(draft.document, this.committedDocument),
      canUndo: draft.undo.length > 0,
      canRedo: draft.redo.length > 0,
    });
  }

  private getViewState(): ViewState {
    return Object.freeze({
      committedRevision: this.committedRevision,
      draft: this.draft ? this.createDraftSnapshot(this.draft) : null,
      locale: this.localeConfig.locale,
      timezone: this.localeConfig.timezone,
    });
  }

  private draftEventData(draft: DraftState): {
    readonly revision: number;
    readonly canUndo: boolean;
    readonly canRedo: boolean;
  } {
    return Object.freeze({
      revision: draft.revision,
      canUndo: draft.undo.length > 0,
      canRedo: draft.redo.length > 0,
    });
  }

  private emitLoaded(
    warnings: readonly Diagnostic[] = this.validationDiagnostics,
    schemaVersion: number | null = documentSchemaVersion(this.committedDocument),
  ): void {
    this.emit({
      type: "space:loaded",
      schemaVersion,
      warnings,
    });
  }

  private emit(input: SpaceEventInput): void {
    if (this.disposedFlag || this.disposing) {
      return;
    }
    this.events.emit(this.createEvent(input));
  }

  private enqueue(input: SpaceEventInput): void {
    if (this.disposedFlag || this.disposing) {
      return;
    }
    this.events.enqueue(this.createEvent(input));
  }

  private flushEvents(): void {
    this.events.flush();
  }

  private emitTerminal(input: SpaceEventInput): void {
    this.events.emitFinal(this.createEvent(input), () => {
      this.deps.onTerminalDelivered(this.id, this.lifetimeId);
    });
  }

  private createEvent(input: SpaceEventInput): SpaceEvent {
    this.sequence += 1;
    return deepFreeze({
      ...input,
      spaceId: this.id,
      lifetimeId: this.lifetimeId,
      sequence: this.sequence,
      timestamp: this.deps.clock.now(),
    }) as SpaceEvent;
  }

  private combinedDiagnostics(): readonly Diagnostic[] {
    if (this.validationDiagnostics.length === 0) {
      return this.diagnostics;
    }
    if (this.diagnostics.length === 0) {
      return this.validationDiagnostics;
    }
    return Object.freeze([...this.validationDiagnostics, ...this.diagnostics]);
  }

  private diagnosticsChangeInput(previous: readonly Diagnostic[]): SpaceEventInput | null {
    const next = this.combinedDiagnostics();
    if (diagnosticsEqual(previous, next)) {
      return null;
    }
    this.updatedAt = this.deps.clock.now();
    return { type: "diagnostics:changed", diagnostics: next };
  }

  private publishDiagnosticsChange(previous: readonly Diagnostic[]): void {
    const input = this.diagnosticsChangeInput(previous);
    if (input !== null) {
      this.emit(input);
    }
  }

  private enqueueDiagnosticsChange(previous: readonly Diagnostic[]): void {
    const input = this.diagnosticsChangeInput(previous);
    if (input !== null) {
      this.enqueue(input);
    }
  }

  private setDiagnostics(diagnostics: readonly Diagnostic[]): void {
    const previous = this.combinedDiagnostics();
    this.diagnostics = deepFreeze([...diagnostics]);
    this.publishDiagnosticsChange(previous);
  }

  private setDiagnosticsState(warnings: readonly Diagnostic[]): void {
    this.validationDiagnostics = deepFreeze([...warnings]);
    this.diagnostics = EMPTY_DIAGNOSTICS;
    this.updatedAt = this.deps.clock.now();
  }

  private clearDiagnostics(): void {
    if (this.diagnostics.length === 0) {
      return;
    }
    const previous = this.combinedDiagnostics();
    this.diagnostics = EMPTY_DIAGNOSTICS;
    this.publishDiagnosticsChange(previous);
  }

  private prepareDraftApply(): Result<readonly Diagnostic[]> {
    const draft = this.draft;
    if (!draft) {
      return this.failWith([createDiagnostic(DIAGNOSTIC_CODES.EDITOR_LEASE_REQUIRED, "draft")]);
    }
    const validation = this.deps.documentValidator(draft.document);
    if (isBlockingValidation(validation)) {
      return this.failDocument(
        [createDiagnostic(DIAGNOSTIC_CODES.DRAFT_INVALID, "draft"), ...validation.diagnostics],
        "apply",
      );
    }
    const fixedChanges = assertFixedBindingsPreserved(this.committedDocument, draft.document, {
      allowRemovedBlockIds: [...draft.allowedRemovedBlockIds],
    });
    if (fixedChanges.length > 0) {
      return this.failDocument(
        [createDiagnostic(DIAGNOSTIC_CODES.DRAFT_INVALID, "draft"), ...fixedChanges],
        "apply",
      );
    }
    const filterDiagnostics = validateFilterRuntimeState(
      draft.document as unknown as BoardDocumentV1,
      this.filterRuntimeState,
      this.bindingValidationCatalog(),
    );
    if (filterDiagnostics.some((diagnostic) => diagnostic.severity === "error")) {
      return this.failDocument(
        [createDiagnostic(DIAGNOSTIC_CODES.DRAFT_INVALID, "draft"), ...filterDiagnostics],
        "apply",
      );
    }
    if (draft.baseRevision !== this.committedRevision) {
      const expectedRevision = draft.baseRevision;
      const actualRevision = this.committedRevision;
      const conflict = createDiagnostic(DIAGNOSTIC_CODES.REVISION_CONFLICT, "draft/baseRevision", {
        message: `The committed revision is ${actualRevision}, but the draft is based on ${expectedRevision}.`,
      });
      const conflicts = Object.freeze([conflict]);
      this.failWith(conflicts);
      this.emit({
        type: "draft:conflict",
        expectedRevision,
        actualRevision,
        diagnostics: conflicts,
      });
      return fail(conflicts);
    }
    return ok(validationWarnings(validation));
  }

  private commitDraftState(warnings: readonly Diagnostic[]): CommittedDraftState | null {
    const draft = this.draft;
    if (!draft) {
      return null;
    }
    this.committedDocument = draft.document;
    this.committedRevision += 1;
    this.filterRuntimeState = pruneFilterState(
      this.committedDocument as unknown as BoardDocumentV1,
      this.filterRuntimeState,
    );
    this.draft = this.createDraft(this.committedDocument, this.committedRevision);
    this.updatedAt = this.deps.clock.now();
    this.validationDiagnostics = deepFreeze([...warnings]);
    this.diagnostics = EMPTY_DIAGNOSTICS;
    return Object.freeze({
      document: this.committedDocument,
      revision: this.committedRevision,
    });
  }

  private resetDraftStateFromCommitted(): void {
    const validation = this.deps.documentValidator(this.committedDocument);
    const warnings = isBlockingValidation(validation)
      ? EMPTY_DIAGNOSTICS
      : validationWarnings(validation);
    this.filterRuntimeState = pruneFilterState(
      this.committedDocument as unknown as BoardDocumentV1,
      this.filterRuntimeState,
    );
    this.draft = this.createDraft(this.committedDocument, this.committedRevision);
    this.updatedAt = this.deps.clock.now();
    this.validationDiagnostics = deepFreeze([...warnings]);
    this.diagnostics = EMPTY_DIAGNOSTICS;
  }

  private beginLeaseRelease(lease: EditorLease): void {
    this.leaseReleaseInProgress = true;
    this.lease = null;
    for (const view of this.views.values()) {
      view.clearLease(lease.leaseId);
    }
  }

  private completeLeaseReleaseState(): void {
    this.draft = null;
    this.leaseReleaseInProgress = false;
    this.updatedAt = this.deps.clock.now();
    this.diagnostics = EMPTY_DIAGNOSTICS;
  }

  private comparisonChangeInputs(
    previous: BoardDocumentV1,
    next: BoardDocumentV1,
    reason: "draft" | "document",
  ): readonly SpaceEventInput[] {
    const before = new Map(
      (previous.comparisons ?? []).map((comparison) => [comparison.id, comparison] as const),
    );
    const after = new Map(
      (next.comparisons ?? []).map((comparison) => [comparison.id, comparison] as const),
    );
    const inputs: SpaceEventInput[] = [];
    for (const [comparisonId, comparison] of after) {
      const existing = before.get(comparisonId);
      if (existing !== undefined && jsonEqual(existing as never, comparison as never)) {
        continue;
      }
      inputs.push({
        type: "comparison:changed",
        comparisonId,
        label: comparison.label,
        active: true,
        reason,
      });
    }
    for (const comparisonId of before.keys()) {
      if (after.has(comparisonId)) {
        continue;
      }
      inputs.push({
        type: "comparison:changed",
        comparisonId,
        active: false,
        reason,
      });
    }
    return inputs;
  }

  private enqueueComparisonChanges(
    previous: BoardDocumentV1,
    next: BoardDocumentV1,
    reason: "draft" | "document",
  ): void {
    for (const input of this.comparisonChangeInputs(previous, next, reason)) {
      this.enqueue(input);
    }
  }

  private emitDraftCommitted(committed: CommittedDraftState): void {
    this.emit({
      type: "document:changed",
      document: committed.document,
      source: "draft",
    });
    this.emit({
      type: "draft:applied",
      revision: committed.revision,
      document: committed.document,
    });
  }

  private emitDraftCancelled(revision: number): void {
    this.emit({ type: "draft:cancelled", revision });
  }

  private emitLeaseReleased(lease: EditorLease): void {
    this.emit({
      type: "editor:lease-changed",
      sessionId: lease.sessionId,
      status: "released",
    });
  }

  private failDocument(
    diagnostics: readonly Diagnostic[],
    source: "load" | "draft" | "apply",
  ): Result<never> {
    const rejected = deepFreeze([...diagnostics]);
    this.setDiagnostics(rejected);
    this.emit({
      type: "document:invalid",
      source,
      diagnostics: rejected,
    });
    return fail(rejected);
  }

  private failWith(diagnostics: readonly Diagnostic[]): Result<never> {
    this.setDiagnostics(diagnostics);
    return fail(diagnostics);
  }

  private assertActive(): Result<never> | null {
    if (this.disposedFlag || this.disposing) {
      return fail([createDiagnostic(DIAGNOSTIC_CODES.SPACE_DISPOSED, "space")]);
    }
    return null;
  }

  private assertNotReleasing(): Result<never> | null {
    if (this.leaseReleaseInProgress) {
      return fail([
        createDiagnostic(DIAGNOSTIC_CODES.EDITOR_LEASE_INVALID, "lease", {
          message: "The editor lease is being released; authoring is temporarily unavailable.",
        }),
      ]);
    }
    return null;
  }

  private getActiveLease(leaseId: string): EditorLease | null {
    return this.lease && this.lease.leaseId === leaseId ? this.lease : null;
  }

  private requireLease(lease: EditorLease): Result<EditorLease> {
    const active = this.getActiveLease(lease.leaseId);
    if (!active || active.spaceId !== this.id || lease.spaceId !== this.id) {
      return this.failWith([createDiagnostic(DIAGNOSTIC_CODES.EDITOR_LEASE_INVALID, "lease")]);
    }
    return ok(active);
  }

  private isDraftDirty(): boolean {
    return this.draft !== null && !jsonEqual(this.draft.document, this.committedDocument);
  }
}

export function createSpace(options: SpaceInitOptions, deps: SpaceDependencies): SpaceImpl {
  return new SpaceImpl(options, deps);
}

export { SpaceImpl };
