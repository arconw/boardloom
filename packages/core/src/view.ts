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

  markDisposed(): void {
    this.disposedFlag = true;
    this.lease = null;
  }

  clearLease(leaseId: string): void {
    if (this.lease?.leaseId === leaseId) {
      this.lease = null;
    }
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
