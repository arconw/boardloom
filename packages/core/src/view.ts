import type { BindingSlotChange } from "./binding-model.js";
import type { BoardDocumentV1 } from "./board-schema.js";
import {
  editorAddBlock,
  editorDeleteBlock,
  editorDuplicateBlock,
  editorMoveBlock,
  editorReorderBlock,
  editorResetBlock,
  editorResizeBlock,
  editorSetTheme,
  editorUpdateBlock,
  type EditorAddBlockOptions,
  type EditorBlockPatch,
  type EditorMoveBlockChange,
  type EditorOperationContext,
  type EditorReorderDirection,
  type EditorResizeBlockChange,
  type EditorThemeInput,
} from "./editor-model.js";
import { DIAGNOSTIC_CODES, createDiagnostic, fail, ok, type Result } from "./diagnostics.js";
import type {
  CreateViewOptions,
  DisposeViewOptions,
  DraftSnapshot,
  EditorLease,
  SpaceSnapshot,
  ViewDisposalResult,
  ViewMode,
  ViewSnapshot,
  ViewState,
  ViewSummary,
} from "./types.js";

export interface ViewCommands {
  updateDraft(document: unknown): Result<DraftSnapshot>;
  updateBinding(change: BindingSlotChange): Result<DraftSnapshot>;
  addBlock(type: string, options?: EditorAddBlockOptions): Result<DraftSnapshot>;
  deleteBlock(blockId: string): Result<DraftSnapshot>;
  duplicateBlock(blockId: string): Result<DraftSnapshot>;
  moveBlock(blockId: string, change: EditorMoveBlockChange): Result<DraftSnapshot>;
  resizeBlock(blockId: string, change: EditorResizeBlockChange): Result<DraftSnapshot>;
  reorderBlock(blockId: string, direction: EditorReorderDirection): Result<DraftSnapshot>;
  updateBlock(blockId: string, patch: EditorBlockPatch): Result<DraftSnapshot>;
  resetBlock(blockId: string): Result<DraftSnapshot>;
  setTheme(theme: EditorThemeInput): Result<DraftSnapshot>;
  undo(): Result<DraftSnapshot>;
  redo(): Result<DraftSnapshot>;
  applyDraft(): Result<SpaceSnapshot>;
  cancelDraft(): Result<SpaceSnapshot>;
}

export interface BoardView {
  readonly viewId: string;
  readonly spaceId: string;
  readonly mode: ViewMode;
  readonly disposed: boolean;
  readonly commands: ViewCommands;
  getSnapshot(): ViewSnapshot;
  setMode(mode: ViewMode, options?: { readonly lease?: EditorLease }): Result<ViewSnapshot>;
  dispose(options?: DisposeViewOptions): Result<ViewDisposalResult>;
}

export interface ViewHost {
  readonly spaceId: string;
  createId(namespace: string): string;
  getState(): ViewState;
  getLease(leaseId: string): EditorLease | null;
  updateDraft(lease: EditorLease, document: unknown): Result<DraftSnapshot>;
  updateDraftWithOptions(
    lease: EditorLease,
    document: unknown,
    options: { readonly allowRemovedBlockIds?: readonly string[] },
  ): Result<DraftSnapshot>;
  updateBinding(lease: EditorLease, change: BindingSlotChange): Result<DraftSnapshot>;
  undoDraft(lease: EditorLease): Result<DraftSnapshot>;
  redoDraft(lease: EditorLease): Result<DraftSnapshot>;
  applyDraft(lease: EditorLease): Result<SpaceSnapshot>;
  cancelDraft(lease: EditorLease): Result<SpaceSnapshot>;
  releaseLease(lease: EditorLease, decision?: "apply" | "cancel"): Result<SpaceSnapshot>;
  emitModeChanged(viewId: string, sessionId: string | null, from: ViewMode, to: ViewMode): void;
  detachView(viewId: string): void;
}

function viewDisposedFailure(): Result<never> {
  return fail([createDiagnostic(DIAGNOSTIC_CODES.VIEW_DISPOSED, "view")]);
}

export class ViewImpl implements BoardView {
  readonly viewId: string;
  private currentMode: ViewMode;
  private lease: EditorLease | null;
  private disposedFlag = false;

  constructor(
    private readonly host: ViewHost,
    options: CreateViewOptions,
  ) {
    this.viewId = host.createId("view");
    this.currentMode = options.mode ?? "viewer";
    this.lease = options.lease ?? null;
  }

  get spaceId(): string {
    return this.host.spaceId;
  }

  get mode(): ViewMode {
    return this.currentMode;
  }

  get disposed(): boolean {
    return this.disposedFlag;
  }

  get commands(): ViewCommands {
    return Object.freeze({
      updateDraft: (document: unknown): Result<DraftSnapshot> => {
        const context = this.authoringContext();
        return context.ok ? this.host.updateDraft(context.value, document) : context;
      },
      updateBinding: (change: BindingSlotChange): Result<DraftSnapshot> => {
        const context = this.authoringContext();
        return context.ok ? this.host.updateBinding(context.value, change) : context;
      },
      addBlock: (type: string, options: EditorAddBlockOptions = {}): Result<DraftSnapshot> =>
        this.applyDocumentOperation((document, operation) =>
          editorAddBlock(document, type, options, operation),
        ),
      deleteBlock: (blockId: string): Result<DraftSnapshot> =>
        this.applyDocumentOperation(
          (document) => editorDeleteBlock(document, blockId),
          (lease, next) =>
            this.host.updateDraftWithOptions(lease, next, {
              allowRemovedBlockIds: [blockId],
            }),
        ),
      duplicateBlock: (blockId: string): Result<DraftSnapshot> =>
        this.applyDocumentOperation((document, operation) =>
          editorDuplicateBlock(document, blockId, operation),
        ),
      moveBlock: (blockId: string, change: EditorMoveBlockChange): Result<DraftSnapshot> =>
        this.applyDocumentOperation((document) => editorMoveBlock(document, blockId, change)),
      resizeBlock: (blockId: string, change: EditorResizeBlockChange): Result<DraftSnapshot> =>
        this.applyDocumentOperation((document) => editorResizeBlock(document, blockId, change)),
      reorderBlock: (blockId: string, direction: EditorReorderDirection): Result<DraftSnapshot> =>
        this.applyDocumentOperation((document) => editorReorderBlock(document, blockId, direction)),
      updateBlock: (blockId: string, patch: EditorBlockPatch): Result<DraftSnapshot> =>
        this.applyDocumentOperation((document) => editorUpdateBlock(document, blockId, patch)),
      resetBlock: (blockId: string): Result<DraftSnapshot> =>
        this.applyDocumentOperation((document, operation) =>
          editorResetBlock(document, blockId, operation),
        ),
      setTheme: (theme: EditorThemeInput): Result<DraftSnapshot> =>
        this.applyDocumentOperation((document) => editorSetTheme(document, theme)),
      undo: (): Result<DraftSnapshot> => {
        const context = this.authoringContext();
        return context.ok ? this.host.undoDraft(context.value) : context;
      },
      redo: (): Result<DraftSnapshot> => {
        const context = this.authoringContext();
        return context.ok ? this.host.redoDraft(context.value) : context;
      },
      applyDraft: (): Result<SpaceSnapshot> => {
        const context = this.authoringContext();
        return context.ok ? this.host.applyDraft(context.value) : context;
      },
      cancelDraft: (): Result<SpaceSnapshot> => {
        const context = this.authoringContext();
        return context.ok ? this.host.cancelDraft(context.value) : context;
      },
    });
  }

  getSnapshot(): ViewSnapshot {
    const state = this.host.getState();
    return Object.freeze({
      viewId: this.viewId,
      spaceId: this.host.spaceId,
      mode: this.currentMode,
      sessionId: this.lease?.sessionId ?? null,
      leaseId: this.lease?.leaseId ?? null,
      disposed: this.disposedFlag,
      committedRevision: state.committedRevision,
      draft: state.draft,
      locale: state.locale,
      timezone: state.timezone,
    });
  }

  describe(): ViewSummary {
    return Object.freeze({
      viewId: this.viewId,
      mode: this.currentMode,
      sessionId: this.lease?.sessionId ?? null,
      leaseId: this.lease?.leaseId ?? null,
      disposed: this.disposedFlag,
    });
  }

  setMode(mode: ViewMode, options: { readonly lease?: EditorLease } = {}): Result<ViewSnapshot> {
    if (this.disposedFlag) {
      return viewDisposedFailure();
    }
    if (mode !== "viewer" && mode !== "editor") {
      return fail([
        createDiagnostic(DIAGNOSTIC_CODES.INVALID_ARGUMENT, "mode", {
          message: "A view mode must be viewer or editor.",
        }),
      ]);
    }
    if (mode === this.currentMode) {
      return ok(this.getSnapshot());
    }

    if (mode === "editor") {
      const candidate = options.lease ?? this.lease;
      if (!candidate) {
        return fail([
          createDiagnostic(DIAGNOSTIC_CODES.EDITOR_LEASE_REQUIRED, "lease", {
            message: "Editor mode requires an active editor lease.",
          }),
        ]);
      }
      const active = this.host.getLease(candidate.leaseId);
      if (!active || active.spaceId !== this.host.spaceId) {
        return fail([
          createDiagnostic(DIAGNOSTIC_CODES.EDITOR_LEASE_INVALID, "lease", {
            message: "The supplied editor lease is not active for this space.",
          }),
        ]);
      }
      this.lease = active;
    }

    const previous = this.currentMode;
    this.currentMode = mode;
    this.host.emitModeChanged(this.viewId, this.lease?.sessionId ?? null, previous, mode);
    return ok(this.getSnapshot());
  }

  dispose(options: DisposeViewOptions = {}): Result<ViewDisposalResult> {
    if (this.disposedFlag) {
      return ok(Object.freeze({ viewId: this.viewId, retainedLease: null }));
    }
    if (
      options.draftDecision !== undefined &&
      options.draftDecision !== "apply" &&
      options.draftDecision !== "cancel" &&
      options.draftDecision !== "keep"
    ) {
      return fail([
        createDiagnostic(DIAGNOSTIC_CODES.INVALID_ARGUMENT, "draftDecision", {
          message: "A draft decision must be apply, cancel or keep.",
        }),
      ]);
    }

    let retainedLease: EditorLease | null = null;
    if (this.lease) {
      if (options.draftDecision === "keep") {
        retainedLease = this.host.getLease(this.lease.leaseId);
      } else {
        const released = this.host.releaseLease(this.lease, options.draftDecision);
        if (!released.ok) {
          return fail(released.diagnostics);
        }
      }
      this.lease = null;
    }

    this.disposedFlag = true;
    this.host.detachView(this.viewId);
    return ok(Object.freeze({ viewId: this.viewId, retainedLease }));
  }

  restoreSession(mode: ViewMode, lease: EditorLease | null): Result<ViewSnapshot> {
    if (this.disposedFlag) {
      return viewDisposedFailure();
    }
    if (mode !== "viewer" && mode !== "editor") {
      return fail([
        createDiagnostic(DIAGNOSTIC_CODES.INVALID_ARGUMENT, "mode", {
          message: "A view mode must be viewer or editor.",
        }),
      ]);
    }
    if (mode === "editor" && lease === null) {
      return fail([createDiagnostic(DIAGNOSTIC_CODES.EDITOR_LEASE_REQUIRED, "lease")]);
    }
    let active: EditorLease | null = null;
    if (lease !== null) {
      active = this.host.getLease(lease.leaseId);
      if (!active || active.spaceId !== this.host.spaceId) {
        return fail([createDiagnostic(DIAGNOSTIC_CODES.EDITOR_LEASE_INVALID, "lease")]);
      }
    }
    const previous = this.currentMode;
    this.currentMode = mode;
    this.lease = active;
    if (previous !== mode) {
      this.host.emitModeChanged(this.viewId, this.lease?.sessionId ?? null, previous, mode);
    }
    return ok(this.getSnapshot());
  }

  markDisposed(): void {
    this.disposedFlag = true;
    this.lease = null;
  }

  clearLease(leaseId: string): void {
    if (this.lease?.leaseId === leaseId) {
      this.lease = null;
    }
  }

  private applyDocumentOperation(
    operation: (
      document: BoardDocumentV1,
      context: EditorOperationContext,
    ) => Result<BoardDocumentV1>,
    commit?: (lease: EditorLease, document: BoardDocumentV1) => Result<DraftSnapshot>,
  ): Result<DraftSnapshot> {
    const context = this.authoringContext();
    if (!context.ok) {
      return context;
    }
    const draft = this.host.getState().draft;
    if (!draft) {
      return fail([createDiagnostic(DIAGNOSTIC_CODES.EDITOR_LEASE_REQUIRED, "draft")]);
    }
    const next = operation(draft.document as unknown as BoardDocumentV1, {
      idFactory: { createId: (namespace) => this.host.createId(namespace) },
    });
    if (!next.ok) {
      return next;
    }
    return commit === undefined
      ? this.host.updateDraft(context.value, next.value)
      : commit(context.value, next.value);
  }

  private authoringContext(): Result<EditorLease> {
    if (this.disposedFlag) {
      return viewDisposedFailure();
    }
    if (this.currentMode !== "editor") {
      return fail([
        createDiagnostic(DIAGNOSTIC_CODES.VIEWER_READ_ONLY, "mode", {
          message: "A viewer-bound view cannot change the board structure or configuration.",
        }),
      ]);
    }
    if (!this.lease) {
      return fail([
        createDiagnostic(DIAGNOSTIC_CODES.EDITOR_LEASE_REQUIRED, "lease", {
          message: "Editor mode requires an active editor lease.",
        }),
      ]);
    }
    const active = this.host.getLease(this.lease.leaseId);
    if (!active) {
      return fail([
        createDiagnostic(DIAGNOSTIC_CODES.EDITOR_LEASE_INVALID, "lease", {
          message: "The editor lease is no longer active for this space.",
        }),
      ]);
    }
    return ok(active);
  }
}

export function createView(host: ViewHost, options: CreateViewOptions = {}): BoardView {
  return new ViewImpl(host, options);
}

export function restoreViewSession(
  view: BoardView,
  mode: ViewMode,
  lease: EditorLease | null,
): Result<ViewSnapshot> {
  if (!(view instanceof ViewImpl)) {
    return fail([
      createDiagnostic(DIAGNOSTIC_CODES.INVALID_ARGUMENT, "view", {
        message: "The view does not support session restoration.",
      }),
    ]);
  }
  return view.restoreSession(mode, lease);
}
