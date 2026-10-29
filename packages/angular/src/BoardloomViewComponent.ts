import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  HostBinding,
  Input,
  NgZone,
  Output,
  inject,
  type AfterViewInit,
  type OnChanges,
  type OnDestroy,
} from "@angular/core";
import {
  DIAGNOSTIC_CODES,
  createDiagnostic,
  fail,
  ok,
  type BoardSerialization,
  type BoardSpace,
  type BoardView,
  type EditorLease,
  type Result,
  type SpaceEvent,
  type ViewMode,
  type ViewSnapshot,
} from "@boardloom/core";
import {
  mountBoardView,
  type BoardViewHandle,
  type FocusTarget,
  type MountBoardViewOptions,
  type UpdateBoardViewOptions,
} from "@boardloom/view-dom";
import type {
  AppliedUpdateState,
  BoardloomAdapterError,
  BoardloomAdapterPhase,
  BoardloomAngularInputs,
  BoardloomDraftDecision,
  BoardloomExportListener,
  BoardloomModeChange,
  BoardloomRetainedSession,
  BoardloomViewReadyInfo,
} from "./types.js";

interface MountInputs {
  readonly space: BoardloomAngularInputs["space"];
  readonly runtime: BoardloomAngularInputs["runtime"];
  readonly runtimeOptions: BoardloomAngularInputs["runtimeOptions"];
  readonly document: BoardloomAngularInputs["document"];
  readonly datasetProvider: BoardloomAngularInputs["datasetProvider"];
  readonly view: BoardloomAngularInputs["view"];
  readonly blockTypes: BoardloomAngularInputs["blockTypes"];
  readonly renderers: BoardloomAngularInputs["renderers"];
  readonly extensions: BoardloomAngularInputs["extensions"];
  readonly extensionSelection: BoardloomAngularInputs["extensionSelection"];
  readonly importPresence: boolean;
}

function unavailable(): Result<never> {
  return fail([
    createDiagnostic(DIAGNOSTIC_CODES.INVALID_ARGUMENT, "handle", {
      message: "The Boardloom view is not mounted.",
    }),
  ]);
}

function requireHandle(handle: BoardViewHandle | null): BoardViewHandle {
  if (handle === null) {
    throw new Error("The Boardloom view is not mounted.");
  }
  return handle;
}

function readyInfo(handle: BoardViewHandle): BoardloomViewReadyInfo {
  return Object.freeze({
    spaceId: handle.space.id,
    viewId: handle.view.viewId,
    element: handle.element,
  });
}

function updateStateOf(inputs: BoardloomAngularInputs): AppliedUpdateState {
  return Object.freeze({
    locale: inputs.locale,
    timezone: inputs.timezone,
    theme: inputs.theme,
    messages: inputs.messages,
    realtime: inputs.realtime,
    provenance: inputs.provenance,
    mode: inputs.mode,
    lease: inputs.lease,
  });
}

function sameUpdateState(left: AppliedUpdateState, right: AppliedUpdateState): boolean {
  return (
    left.locale === right.locale &&
    left.timezone === right.timezone &&
    left.theme === right.theme &&
    left.messages === right.messages &&
    left.realtime === right.realtime &&
    left.provenance === right.provenance &&
    left.mode === right.mode &&
    (left.lease?.leaseId ?? null) === (right.lease?.leaseId ?? null)
  );
}

function captureMountInputs(inputs: BoardloomAngularInputs): MountInputs {
  return Object.freeze({
    space: inputs.space,
    runtime: inputs.runtime,
    runtimeOptions: inputs.runtimeOptions,
    document: inputs.document,
    datasetProvider: inputs.datasetProvider,
    view: inputs.view,
    blockTypes: inputs.blockTypes,
    renderers: inputs.renderers,
    extensions: inputs.extensions,
    extensionSelection: inputs.extensionSelection,
    importPresence: inputs.importDocument !== undefined,
  });
}

function samePlainValue(
  left: unknown,
  right: unknown,
  seen = new WeakMap<object, WeakSet<object>>(),
): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") {
    return false;
  }
  const leftArray = Array.isArray(left);
  const rightArray = Array.isArray(right);
  if (leftArray !== rightArray) {
    return false;
  }
  if (!leftArray) {
    if (
      Object.getPrototypeOf(left) !== Object.prototype ||
      Object.getPrototypeOf(right) !== Object.prototype
    ) {
      return false;
    }
  }
  let seenRight = seen.get(left);
  if (seenRight?.has(right)) {
    return true;
  }
  if (seenRight === undefined) {
    seenRight = new WeakSet<object>();
    seen.set(left, seenRight);
  }
  seenRight.add(right);
  if (leftArray && rightArray) {
    if (left.length !== right.length) {
      return false;
    }
    for (let index = 0; index < left.length; index += 1) {
      if (!samePlainValue(left[index], right[index], seen)) {
        return false;
      }
    }
    return true;
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  for (const key of leftKeys) {
    if (!Object.hasOwn(rightRecord, key)) {
      return false;
    }
    if (!samePlainValue(leftRecord[key], rightRecord[key], seen)) {
      return false;
    }
  }
  return true;
}

function sameSignatureValue(
  left: unknown,
  right: unknown,
  seen = new WeakMap<object, WeakSet<object>>(),
): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (typeof left === "function" && typeof right === "function") {
    return true;
  }
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") {
    return false;
  }
  const leftArray = Array.isArray(left);
  const rightArray = Array.isArray(right);
  if (leftArray !== rightArray) {
    return false;
  }
  if (!leftArray) {
    if (
      Object.getPrototypeOf(left) !== Object.prototype ||
      Object.getPrototypeOf(right) !== Object.prototype
    ) {
      return false;
    }
  }
  let seenRight = seen.get(left);
  if (seenRight?.has(right)) {
    return true;
  }
  if (seenRight === undefined) {
    seenRight = new WeakSet<object>();
    seen.set(left, seenRight);
  }
  seenRight.add(right);
  if (leftArray && rightArray) {
    if (left.length !== right.length) {
      return false;
    }
    for (let index = 0; index < left.length; index += 1) {
      if (!sameSignatureValue(left[index], right[index], seen)) {
        return false;
      }
    }
    return true;
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  for (const key of leftKeys) {
    if (!Object.hasOwn(rightRecord, key)) {
      return false;
    }
    if (!sameSignatureValue(leftRecord[key], rightRecord[key], seen)) {
      return false;
    }
  }
  return true;
}

function sameMountSignature(left: MountInputs | null, right: MountInputs | null): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  return (
    left.space === right.space &&
    left.runtime === right.runtime &&
    left.datasetProvider === right.datasetProvider &&
    left.view === right.view &&
    left.extensions === right.extensions &&
    left.importPresence === right.importPresence &&
    sameSignatureValue(left.runtimeOptions, right.runtimeOptions) &&
    sameSignatureValue(left.document, right.document) &&
    sameSignatureValue(left.blockTypes, right.blockTypes) &&
    sameSignatureValue(left.renderers, right.renderers) &&
    sameSignatureValue(left.extensionSelection, right.extensionSelection)
  );
}

function sameMountInputs(left: MountInputs | null, right: MountInputs | null): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  return (
    left.space === right.space &&
    left.runtime === right.runtime &&
    left.datasetProvider === right.datasetProvider &&
    left.view === right.view &&
    left.extensions === right.extensions &&
    left.importPresence === right.importPresence &&
    samePlainValue(left.runtimeOptions, right.runtimeOptions) &&
    samePlainValue(left.document, right.document) &&
    samePlainValue(left.blockTypes, right.blockTypes) &&
    samePlainValue(left.renderers, right.renderers) &&
    samePlainValue(left.extensionSelection, right.extensionSelection)
  );
}

function buildUpdateOptions(
  inputs: BoardloomAngularInputs,
  applied: AppliedUpdateState,
): UpdateBoardViewOptions | null {
  const options: {
    locale?: string;
    timezone?: string;
    theme?: NonNullable<BoardloomAngularInputs["theme"]>;
    messages?: NonNullable<BoardloomAngularInputs["messages"]>;
    realtime?: NonNullable<BoardloomAngularInputs["realtime"]>;
    provenance?: string;
    mode?: ViewMode;
    lease?: EditorLease;
  } = {};
  let changed = false;
  if (inputs.locale !== undefined && inputs.locale !== applied.locale) {
    options.locale = inputs.locale;
    changed = true;
  }
  if (inputs.timezone !== undefined && inputs.timezone !== applied.timezone) {
    options.timezone = inputs.timezone;
    changed = true;
  }
  if (inputs.theme !== undefined && inputs.theme !== applied.theme) {
    options.theme = inputs.theme;
    changed = true;
  }
  if (inputs.messages !== applied.messages) {
    options.messages = inputs.messages ?? {};
    changed = true;
  }
  if (inputs.realtime !== undefined && inputs.realtime !== applied.realtime) {
    options.realtime = inputs.realtime;
    changed = true;
  }
  if (inputs.provenance !== undefined && inputs.provenance !== applied.provenance) {
    options.provenance = inputs.provenance;
    changed = true;
  }
  if (inputs.mode !== undefined && inputs.mode !== applied.mode) {
    options.mode = inputs.mode;
    changed = true;
  }
  if (
    inputs.lease !== undefined &&
    (inputs.lease.leaseId ?? null) !== (applied.lease?.leaseId ?? null)
  ) {
    options.lease = inputs.lease;
    changed = true;
  }
  return changed ? options : null;
}

function hasDirtyDraft(handle: BoardViewHandle): boolean {
  try {
    return handle.space.getSnapshot().draft?.dirty === true;
  } catch {
    return false;
  }
}

@Component({
  selector: "boardloom-view",
  standalone: true,
  template: "",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { "data-boardloom-angular": "" },
})
export class BoardloomViewComponent
  implements OnChanges, AfterViewInit, OnDestroy, BoardloomAngularInputs
{
  @Input() space?: BoardSpace;
  @Input() runtime?: BoardloomAngularInputs["runtime"];
  @Input() runtimeOptions?: BoardloomAngularInputs["runtimeOptions"];
  @Input() document?: unknown;
  @Input() datasetProvider?: BoardloomAngularInputs["datasetProvider"];
  @Input() view?: BoardView;
  @Input() mode?: ViewMode;
  @Input() lease?: EditorLease;
  @Input() locale?: string;
  @Input() timezone?: string;
  @Input() theme?: BoardloomAngularInputs["theme"];
  @Input() messages?: BoardloomAngularInputs["messages"];
  @Input() realtime?: BoardloomAngularInputs["realtime"];
  @Input() provenance?: string;
  @Input() blockTypes?: BoardloomAngularInputs["blockTypes"];
  @Input() renderers?: BoardloomAngularInputs["renderers"];
  @Input() extensions?: BoardloomAngularInputs["extensions"];
  @Input() extensionSelection?: BoardloomAngularInputs["extensionSelection"];
  @Input() draftDecision?: BoardloomDraftDecision;
  @Input() className?: string;
  @Input() importDocument?: BoardloomAngularInputs["importDocument"];

  @Output() readonly event = new EventEmitter<SpaceEvent>();
  @Output() readonly modeChange = new EventEmitter<BoardloomModeChange>();
  @Output() readonly ready = new EventEmitter<BoardloomViewReadyInfo>();
  @Output() readonly disposed = new EventEmitter<BoardloomViewReadyInfo>();
  @Output() readonly adapterError = new EventEmitter<BoardloomAdapterError>();
  @Output() readonly documentExport = new EventEmitter<{
    readonly kind: "ui" | "host";
    readonly serialization: BoardSerialization;
  }>();

  @HostBinding("class")
  get hostClass(): string | null {
    return this.className ?? null;
  }

  private readonly handleRef = { current: null as BoardViewHandle | null };
  private readonly appliedRef = { current: null as AppliedUpdateState | null };
  private failedAttempt: AppliedUpdateState | null = null;
  private mountedInputs: MountInputs | null = null;
  private failedMount: MountInputs | null = null;
  private unstableInputs: MountInputs | null = null;
  private ownedSpace = false;
  private viewInitialized = false;
  private destroyed = false;
  private sessionEnded = false;
  private explicitDisposalInFlight = false;
  private reconcileScheduled = false;

  private readonly exportListener: BoardloomExportListener = (kind, serialization) => {
    this.zone.run(() => {
      this.documentExport.emit({ kind, serialization });
    });
  };

  private readonly eventListener = (event: SpaceEvent): void => {
    this.zone.run(() => {
      const handle = this.handleRef.current;
      if (handle === null || event.spaceId !== handle.space.id) {
        return;
      }
      const matchesView = !("viewId" in event) || event.viewId === handle.view.viewId;
      if (matchesView) {
        this.event.emit(event);
      }
      if (event.type === "view:disposed" && event.viewId === handle.view.viewId) {
        if (!this.explicitDisposalInFlight) {
          this.finishImperativeDisposal(handle, readyInfo(handle));
        }
        return;
      }
      if (event.type === "space:disposed") {
        if (!this.explicitDisposalInFlight) {
          this.finishImperativeDisposal(handle, readyInfo(handle));
        }
        return;
      }
      if (event.type === "mode:changed" && matchesView) {
        this.modeChange.emit({ mode: event.to, event });
      }
    });
  };

  private readonly importListener = (
    input: string,
    fileName: string,
  ): Result<{ readonly spaceId: string }> => {
    const importer = this.importDocument;
    if (importer === undefined) {
      return fail([
        createDiagnostic(DIAGNOSTIC_CODES.INVALID_ARGUMENT, "importDocument", {
          message: "The host did not provide an import handler.",
        }),
      ]);
    }
    return importer(input, fileName);
  };

  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly zone = inject(NgZone);

  ngOnChanges(): void {
    if (!this.viewInitialized) {
      return;
    }
    this.scheduleReconcile();
  }

  ngAfterViewInit(): void {
    if (this.viewInitialized) {
      return;
    }
    this.viewInitialized = true;
    this.scheduleReconcile();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.zone.runOutsideAngular(() => {
      this.disposeCurrent();
    });
  }

  private scheduleReconcile(): void {
    if (this.reconcileScheduled || this.destroyed) {
      return;
    }
    this.reconcileScheduled = true;
    queueMicrotask(() => {
      this.reconcileScheduled = false;
      if (this.destroyed) {
        return;
      }
      this.zone.runOutsideAngular(() => {
        this.reconcile();
      });
    });
  }

  get handle(): BoardViewHandle | null {
    const handle = this.handleRef.current;
    return handle !== null && !handle.disposed ? handle : null;
  }

  get boardSpace(): BoardSpace {
    return requireHandle(this.handle).space;
  }

  get boardView(): BoardView {
    return requireHandle(this.handle).view;
  }

  get boardElement(): HTMLElement {
    return requireHandle(this.handle).element;
  }

  get isMounted(): boolean {
    return this.handle?.mounted ?? false;
  }

  get isDisposed(): boolean {
    return this.handle?.disposed ?? true;
  }

  update(options: UpdateBoardViewOptions = {}): Result<void> {
    return this.handle?.update(options) ?? unavailable();
  }

  setMode(mode: ViewMode, options: { readonly lease?: EditorLease } = {}): Result<ViewSnapshot> {
    return this.handle?.setMode(mode, options) ?? unavailable();
  }

  refresh(): void {
    this.handle?.refresh();
  }

  exportDocument(): Result<BoardSerialization> {
    return this.handle?.exportDocument() ?? unavailable();
  }

  focus(target: FocusTarget = "content"): Result<void> {
    return this.handle?.focus(target) ?? unavailable();
  }

  unmount(options: { readonly draftDecision?: BoardloomDraftDecision } = {}): Result<void> {
    const raw = this.handleRef.current;
    if (raw !== null && raw.disposed) {
      const info = readyInfo(raw);
      this.finishImperativeDisposal(raw, info);
      return ok(undefined);
    }
    const handle = this.handle;
    if (handle === null) {
      return this.sessionEnded ? ok(undefined) : unavailable();
    }
    const info = readyInfo(handle);
    const result = this.runExplicitDisposal(() => handle.unmount(options));
    if (result.ok) {
      this.finishImperativeDisposal(handle, info);
    }
    return result;
  }

  dispose(options: { readonly draftDecision?: BoardloomDraftDecision } = {}): Result<void> {
    const raw = this.handleRef.current;
    if (raw !== null && raw.disposed) {
      const info = readyInfo(raw);
      this.finishImperativeDisposal(raw, info);
      return ok(undefined);
    }
    const handle = this.handle;
    if (handle === null) {
      return this.sessionEnded ? ok(undefined) : unavailable();
    }
    const info = readyInfo(handle);
    const result = this.runExplicitDisposal(() => handle.dispose(options));
    if (result.ok) {
      this.finishImperativeDisposal(handle, info);
    }
    return result;
  }

  private inputs(): BoardloomAngularInputs {
    return {
      space: this.space,
      runtime: this.runtime,
      runtimeOptions: this.runtimeOptions,
      document: this.document,
      datasetProvider: this.datasetProvider,
      view: this.view,
      mode: this.mode,
      lease: this.lease,
      locale: this.locale,
      timezone: this.timezone,
      theme: this.theme,
      messages: this.messages,
      realtime: this.realtime,
      provenance: this.provenance,
      blockTypes: this.blockTypes,
      renderers: this.renderers,
      extensions: this.extensions,
      extensionSelection: this.extensionSelection,
      draftDecision: this.draftDecision,
      className: this.className,
      importDocument: this.importDocument,
    };
  }

  private reportError(
    phase: BoardloomAdapterPhase,
    diagnostics: BoardloomAdapterError["diagnostics"],
    retained?: BoardloomRetainedSession,
  ): void {
    this.zone.run(() => {
      this.adapterError.emit({
        phase,
        diagnostics,
        ...(retained === undefined ? {} : { retained }),
      });
    });
  }

  private retain(handle: BoardViewHandle, diagnostics: BoardloomAdapterError["diagnostics"]): void {
    const retained = Object.freeze({
      handle,
      spaceId: handle.space.id,
      viewId: handle.view.viewId,
    });
    try {
      handle.element.remove();
    } catch {
      void 0;
    }
    this.reportError("dispose", diagnostics, retained);
  }

  private runExplicitDisposal<T>(operation: () => Result<T>): Result<T> {
    this.explicitDisposalInFlight = true;
    try {
      return operation();
    } finally {
      this.explicitDisposalInFlight = false;
    }
  }

  private finishImperativeDisposal(handle: BoardViewHandle, info: BoardloomViewReadyInfo): void {
    if (this.handleRef.current !== handle) {
      return;
    }
    this.handleRef.current = null;
    this.appliedRef.current = null;
    this.failedAttempt = null;
    this.mountedInputs = null;
    this.failedMount = null;
    this.unstableInputs = null;
    this.ownedSpace = false;
    this.sessionEnded = true;
    this.zone.run(() => {
      this.disposed.emit(info);
    });
  }

  private disposeCurrent(): void {
    const handle = this.handleRef.current;
    if (handle === null) {
      return;
    }
    const info = readyInfo(handle);
    if (handle.disposed) {
      this.finishImperativeDisposal(handle, info);
      return;
    }
    const ownedSpace = this.ownedSpace;
    this.handleRef.current = null;
    this.appliedRef.current = null;
    this.failedAttempt = null;
    this.mountedInputs = null;
    this.ownedSpace = false;
    const decision = this.draftDecision;
    if (ownedSpace && hasDirtyDraft(handle) && decision !== "apply" && decision !== "cancel") {
      this.retain(handle, [
        createDiagnostic(DIAGNOSTIC_CODES.DRAFT_REQUIRES_DECISION, `spaces/${handle.space.id}`, {
          message:
            "An adapter-owned board still has a dirty draft. Supply draftDecision apply or cancel, or resolve the retained handle.",
        }),
      ]);
      return;
    }
    try {
      const disposed = handle.dispose({ draftDecision: decision ?? "keep" });
      if (!disposed.ok) {
        this.retain(handle, disposed.diagnostics);
        return;
      }
    } catch (error) {
      this.retain(handle, [
        createDiagnostic(DIAGNOSTIC_CODES.INVALID_ARGUMENT, "dispose", {
          message: error instanceof Error ? error.message : String(error),
        }),
      ]);
      return;
    }
    if (this.destroyed) {
      this.sessionEnded = true;
    }
    this.zone.run(() => {
      this.disposed.emit(info);
    });
  }

  private buildMountOptions(inputs: BoardloomAngularInputs): MountBoardViewOptions {
    return {
      ...(inputs.space === undefined ? {} : { space: inputs.space }),
      ...(inputs.runtime === undefined ? {} : { runtime: inputs.runtime }),
      ...(inputs.runtimeOptions === undefined ? {} : { runtimeOptions: inputs.runtimeOptions }),
      ...(inputs.document === undefined ? {} : { document: inputs.document }),
      ...(inputs.datasetProvider === undefined ? {} : { datasetProvider: inputs.datasetProvider }),
      ...(inputs.view === undefined ? {} : { view: inputs.view }),
      ...(inputs.mode === undefined ? {} : { mode: inputs.mode }),
      ...(inputs.lease === undefined ? {} : { lease: inputs.lease }),
      ...(inputs.locale === undefined ? {} : { locale: inputs.locale }),
      ...(inputs.timezone === undefined ? {} : { timezone: inputs.timezone }),
      ...(inputs.theme === undefined ? {} : { theme: inputs.theme }),
      ...(inputs.messages === undefined ? {} : { messages: inputs.messages }),
      ...(inputs.realtime === undefined ? {} : { realtime: inputs.realtime }),
      ...(inputs.provenance === undefined ? {} : { provenance: inputs.provenance }),
      ...(inputs.blockTypes === undefined ? {} : { blockTypes: inputs.blockTypes }),
      ...(inputs.renderers === undefined ? {} : { renderers: inputs.renderers }),
      ...(inputs.extensions === undefined ? {} : { extensions: inputs.extensions }),
      ...(inputs.extensionSelection === undefined
        ? {}
        : { extensionSelection: inputs.extensionSelection }),
      onEvent: this.eventListener,
      onExport: this.exportListener,
      ...(inputs.importDocument === undefined ? {} : { onImportDocument: this.importListener }),
    };
  }

  private reconcile(): void {
    if (this.destroyed) {
      return;
    }
    const raw = this.handleRef.current;
    if (raw !== null && raw.disposed) {
      const info = readyInfo(raw);
      this.finishImperativeDisposal(raw, info);
    }
    if (this.sessionEnded) {
      return;
    }
    const target = this.elementRef.nativeElement;
    const inputs = this.inputs();
    const mountInputs = captureMountInputs(inputs);
    if (this.handleRef.current !== null) {
      if (sameMountInputs(mountInputs, this.mountedInputs)) {
        this.unstableInputs = null;
        this.applyUpdate(inputs);
        return;
      }
      if (sameMountSignature(mountInputs, this.mountedInputs)) {
        if (this.unstableInputs === null || !sameMountSignature(mountInputs, this.unstableInputs)) {
          this.unstableInputs = mountInputs;
          this.reportError("input", [
            createDiagnostic(DIAGNOSTIC_CODES.INVALID_ARGUMENT, "mountInputs", {
              message:
                "Function-bearing mount inputs must keep stable references; the existing session was kept.",
            }),
          ]);
        }
        this.applyUpdate(inputs);
        return;
      }
      this.unstableInputs = null;
    } else if (this.failedMount !== null && sameMountSignature(mountInputs, this.failedMount)) {
      return;
    }
    this.disposeCurrent();
    const mounted = mountBoardView(target, this.buildMountOptions(inputs));
    if (!mounted.ok) {
      this.failedMount = mountInputs;
      this.reportError("mount", mounted.diagnostics);
      return;
    }
    const handle = mounted.value;
    this.handleRef.current = handle;
    this.appliedRef.current = updateStateOf(inputs);
    this.failedAttempt = null;
    this.mountedInputs = mountInputs;
    this.failedMount = null;
    this.ownedSpace = inputs.space === undefined;
    this.sessionEnded = false;
    this.zone.run(() => {
      this.ready.emit(readyInfo(handle));
    });
  }

  private applyUpdate(inputs: BoardloomAngularInputs): void {
    const handle = this.handle;
    const applied = this.appliedRef.current;
    if (handle === null || applied === null || handle.disposed) {
      return;
    }
    const current = updateStateOf(inputs);
    if (this.failedAttempt !== null && sameUpdateState(current, this.failedAttempt)) {
      return;
    }
    const options = buildUpdateOptions(inputs, applied);
    if (options === null) {
      return;
    }
    const updated = handle.update(options);
    if (updated.ok) {
      this.appliedRef.current = current;
      this.failedAttempt = null;
      return;
    }
    this.failedAttempt = current;
    this.reportError("update", updated.diagnostics);
  }
}
