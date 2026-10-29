import {
  DIAGNOSTIC_CODES,
  createDiagnostic,
  fail,
  ok,
  type BoardSerialization,
  type BoardView,
  type EditorLease,
  type MessageDictionary,
  type Result,
  type SpaceEvent,
  type ThemeMode,
  type ViewMode,
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
  BoardloomDraftDecision,
  BoardloomRetainedSession,
  BoardloomViewHandle,
  BoardloomViewProps,
  BoardloomViewReadyInfo,
} from "./types.js";

export interface BoardloomSessionCallbacks {
  readonly onEvent?: (event: SpaceEvent) => void;
  readonly onModeChange?: (
    mode: ViewMode,
    event: Extract<SpaceEvent, { type: "mode:changed" }>,
  ) => void;
  readonly onImportDocument?: (
    input: string,
    fileName: string,
  ) => Result<{ readonly spaceId: string }> | undefined;
  readonly onExport?: (kind: "ui" | "host", serialization: BoardSerialization) => void;
  readonly onReady?: (info: BoardloomViewReadyInfo) => void;
  readonly onDispose?: (info: BoardloomViewReadyInfo) => void;
  readonly onError?: (error: BoardloomAdapterError) => void;
  readonly onHandle?: (handle: BoardViewHandle | null) => void;
  readonly draftDecision: () => BoardloomDraftDecision | undefined;
}

interface MountInputs {
  readonly space: BoardloomViewProps["space"];
  readonly runtime: BoardloomViewProps["runtime"];
  readonly runtimeOptions: BoardloomViewProps["runtimeOptions"];
  readonly document: BoardloomViewProps["document"];
  readonly datasetProvider: BoardloomViewProps["datasetProvider"];
  readonly view: BoardloomViewProps["view"];
  readonly blockTypes: BoardloomViewProps["blockTypes"];
  readonly renderers: BoardloomViewProps["renderers"];
  readonly extensions: BoardloomViewProps["extensions"];
  readonly extensionSelection: BoardloomViewProps["extensionSelection"];
  readonly importPresence: boolean;
}

function unavailable(): Result<never> {
  return fail([
    createDiagnostic(DIAGNOSTIC_CODES.INVALID_ARGUMENT, "handle", {
      message: "The Boardloom view is not mounted.",
    }),
  ]);
}

function readyInfo(handle: BoardViewHandle): BoardloomViewReadyInfo {
  return Object.freeze({
    spaceId: handle.space.id,
    viewId: handle.view.viewId,
    element: handle.element,
  });
}

function updateStateOf(props: BoardloomViewProps): AppliedUpdateState {
  return Object.freeze({
    locale: props.locale,
    timezone: props.timezone,
    theme: props.theme,
    messages: props.messages,
    messageDictionaries: props.messageDictionaries,
    realtime: props.realtime,
    provenance: props.provenance,
    mode: props.mode,
    lease: props.lease,
  });
}

function sameUpdateState(left: AppliedUpdateState, right: AppliedUpdateState): boolean {
  return (
    left.locale === right.locale &&
    left.timezone === right.timezone &&
    left.theme === right.theme &&
    left.messages === right.messages &&
    left.messageDictionaries === right.messageDictionaries &&
    left.realtime === right.realtime &&
    left.provenance === right.provenance &&
    left.mode === right.mode &&
    (left.lease?.leaseId ?? null) === (right.lease?.leaseId ?? null)
  );
}

function captureMountInputs(props: BoardloomViewProps): MountInputs {
  return Object.freeze({
    space: props.space,
    runtime: props.runtime,
    runtimeOptions: props.runtimeOptions,
    document: props.document,
    datasetProvider: props.datasetProvider,
    view: props.view,
    blockTypes: props.blockTypes,
    renderers: props.renderers,
    extensions: props.extensions,
    extensionSelection: props.extensionSelection,
    importPresence: props.onImportDocument !== undefined,
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

function hasDirtyDraft(handle: BoardViewHandle): boolean {
  try {
    return handle.space.getSnapshot().draft?.dirty === true;
  } catch {
    return false;
  }
}

function buildUpdateOptions(
  props: BoardloomViewProps,
  applied: AppliedUpdateState,
): UpdateBoardViewOptions | null {
  const options: {
    locale?: string;
    timezone?: string;
    theme?: ThemeMode;
    messages?: MessageDictionary;
    messageDictionaries?: NonNullable<BoardloomViewProps["messageDictionaries"]>;
    realtime?: NonNullable<BoardloomViewProps["realtime"]>;
    provenance?: string;
    mode?: ViewMode;
    lease?: EditorLease;
  } = {};
  let changed = false;
  if (props.locale !== undefined && props.locale !== applied.locale) {
    options.locale = props.locale;
    changed = true;
  }
  if (props.timezone !== undefined && props.timezone !== applied.timezone) {
    options.timezone = props.timezone;
    changed = true;
  }
  if (props.theme !== undefined && props.theme !== applied.theme) {
    options.theme = props.theme;
    changed = true;
  }
  if (props.messages !== applied.messages) {
    options.messages = props.messages ?? {};
    changed = true;
  }
  if (props.messageDictionaries !== applied.messageDictionaries) {
    options.messageDictionaries = props.messageDictionaries ?? {};
    changed = true;
  }
  if (props.realtime !== undefined && props.realtime !== applied.realtime) {
    options.realtime = props.realtime;
    changed = true;
  }
  if (props.provenance !== undefined && props.provenance !== applied.provenance) {
    options.provenance = props.provenance;
    changed = true;
  }
  if (props.mode !== undefined && props.mode !== applied.mode) {
    options.mode = props.mode;
    changed = true;
  }
  if (
    props.lease !== undefined &&
    (props.lease.leaseId ?? null) !== (applied.lease?.leaseId ?? null)
  ) {
    options.lease = props.lease;
    changed = true;
  }
  return changed ? options : null;
}

export class BoardloomSession {
  private readonly callbacks: BoardloomSessionCallbacks;
  private handleValue: BoardViewHandle | null = null;
  private applied: AppliedUpdateState | null = null;
  private failedAttempt: AppliedUpdateState | null = null;
  private mountedInputs: MountInputs | null = null;
  private failedMount: MountInputs | null = null;
  private unstableInputs: MountInputs | null = null;
  private exposedHandle: BoardloomViewHandle | null = null;
  private ownedSpace = false;
  private sessionEnded = false;
  private imperativeDisposalInFlight = false;

  constructor(callbacks: BoardloomSessionCallbacks) {
    this.callbacks = callbacks;
  }

  get handle(): BoardloomViewHandle | null {
    return this.exposedHandle;
  }

  sync(props: BoardloomViewProps, target: HTMLElement): void {
    if (this.sessionEnded) {
      return;
    }
    const inputs = captureMountInputs(props);
    if (this.handleValue !== null) {
      if (sameMountInputs(inputs, this.mountedInputs)) {
        this.unstableInputs = null;
        this.applyUpdate(props);
        return;
      }
      if (sameMountSignature(inputs, this.mountedInputs)) {
        if (this.unstableInputs === null || !sameMountSignature(inputs, this.unstableInputs)) {
          this.unstableInputs = inputs;
          this.reportError("input", [
            createDiagnostic(DIAGNOSTIC_CODES.INVALID_ARGUMENT, "mountInputs", {
              message:
                "Function-bearing mount inputs must keep stable references; the existing session was kept.",
            }),
          ]);
        }
        this.applyUpdate(props);
        return;
      }
      this.unstableInputs = null;
      this.disposeCurrent();
    } else if (this.failedMount !== null && sameMountSignature(inputs, this.failedMount)) {
      return;
    }
    this.mount(props, inputs, target);
  }

  dispose(): void {
    this.disposeCurrent();
  }

  private mount(props: BoardloomViewProps, inputs: MountInputs, target: HTMLElement): void {
    const mounted = mountBoardView(target, this.buildMountOptions(props));
    if (!mounted.ok) {
      this.failedMount = inputs;
      this.reportError("mount", mounted.diagnostics);
      return;
    }
    const handle = mounted.value;
    this.handleValue = handle;
    this.exposedHandle = this.expose(handle);
    this.applied = updateStateOf(props);
    this.failedAttempt = null;
    this.mountedInputs = inputs;
    this.failedMount = null;
    this.ownedSpace = props.space === undefined;
    this.sessionEnded = false;
    this.callbacks.onHandle?.(this.exposedHandle);
    this.callbacks.onReady?.(readyInfo(handle));
  }

  private buildMountOptions(props: BoardloomViewProps): MountBoardViewOptions {
    return {
      ...(props.space === undefined ? {} : { space: props.space }),
      ...(props.runtime === undefined ? {} : { runtime: props.runtime }),
      ...(props.runtimeOptions === undefined ? {} : { runtimeOptions: props.runtimeOptions }),
      ...(props.document === undefined ? {} : { document: props.document }),
      ...(props.datasetProvider === undefined ? {} : { datasetProvider: props.datasetProvider }),
      ...(props.view === undefined ? {} : { view: props.view }),
      ...(props.mode === undefined ? {} : { mode: props.mode }),
      ...(props.lease === undefined ? {} : { lease: props.lease }),
      ...(props.locale === undefined ? {} : { locale: props.locale }),
      ...(props.timezone === undefined ? {} : { timezone: props.timezone }),
      ...(props.theme === undefined ? {} : { theme: props.theme }),
      ...(props.messages === undefined ? {} : { messages: props.messages }),
      ...(props.messageDictionaries === undefined
        ? {}
        : { messageDictionaries: props.messageDictionaries }),
      ...(props.realtime === undefined ? {} : { realtime: props.realtime }),
      ...(props.provenance === undefined ? {} : { provenance: props.provenance }),
      ...(props.blockTypes === undefined ? {} : { blockTypes: props.blockTypes }),
      ...(props.renderers === undefined ? {} : { renderers: props.renderers }),
      ...(props.extensions === undefined ? {} : { extensions: props.extensions }),
      ...(props.extensionSelection === undefined
        ? {}
        : { extensionSelection: props.extensionSelection }),
      onEvent: (event) => this.dispatchEvent(event),
      onExport: (kind, serialization) => this.callbacks.onExport?.(kind, serialization),
      ...(props.onImportDocument === undefined
        ? {}
        : {
            onImportDocument: (input: string, fileName: string) => {
              const imported = this.callbacks.onImportDocument?.(input, fileName);
              if (imported !== undefined) {
                return imported;
              }
              return fail([
                createDiagnostic(DIAGNOSTIC_CODES.INVALID_ARGUMENT, "onImportDocument", {
                  message: "The host did not provide an import handler.",
                }),
              ]);
            },
          }),
    };
  }

  private dispatchEvent(event: SpaceEvent): void {
    const handle = this.handleValue;
    if (handle === null || event.spaceId !== handle.space.id) {
      return;
    }
    const matchesView = !("viewId" in event) || event.viewId === handle.view.viewId;
    if (matchesView) {
      this.callbacks.onEvent?.(event);
    }
    if (event.type === "view:disposed" && event.viewId === handle.view.viewId) {
      if (!this.imperativeDisposalInFlight) {
        this.finish(handle);
      }
      return;
    }
    if (event.type === "space:disposed") {
      if (!this.imperativeDisposalInFlight) {
        this.finish(handle);
      }
      return;
    }
    if (event.type === "mode:changed" && matchesView) {
      this.callbacks.onModeChange?.(
        event.to,
        event as Extract<SpaceEvent, { type: "mode:changed" }>,
      );
    }
  }

  private applyUpdate(props: BoardloomViewProps): void {
    const handle = this.handleValue;
    const applied = this.applied;
    if (handle === null || applied === null || handle.disposed) {
      return;
    }
    const current = updateStateOf(props);
    if (this.failedAttempt !== null && sameUpdateState(current, this.failedAttempt)) {
      return;
    }
    const options = buildUpdateOptions(props, applied);
    if (options === null) {
      return;
    }
    const updated = handle.update(options);
    if (updated.ok) {
      this.applied = current;
      this.failedAttempt = null;
      return;
    }
    this.failedAttempt = current;
    this.reportError("update", updated.diagnostics);
  }

  private disposeCurrent(): void {
    const handle = this.handleValue;
    if (handle === null) {
      return;
    }
    const info = readyInfo(handle);
    const ownedSpace = this.ownedSpace;
    this.handleValue = null;
    this.exposedHandle = null;
    this.applied = null;
    this.failedAttempt = null;
    this.mountedInputs = null;
    this.ownedSpace = false;
    const decision = this.callbacks.draftDecision();
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
    this.callbacks.onHandle?.(null);
    this.callbacks.onDispose?.(info);
  }

  private finish(handle: BoardViewHandle): void {
    if (this.handleValue !== handle) {
      return;
    }
    const info = readyInfo(handle);
    this.handleValue = null;
    this.exposedHandle = null;
    this.applied = null;
    this.failedAttempt = null;
    this.mountedInputs = null;
    this.failedMount = null;
    this.unstableInputs = null;
    this.ownedSpace = false;
    this.sessionEnded = true;
    this.callbacks.onHandle?.(null);
    this.callbacks.onDispose?.(info);
  }

  private expose(raw: BoardViewHandle): BoardloomViewHandle {
    const active = (): boolean => this.handleValue === raw;
    const ended = (): boolean => this.sessionEnded;
    const requireActive = (): BoardViewHandle => {
      if (!active()) {
        throw new Error("The Boardloom view is not mounted.");
      }
      return raw;
    };
    const finish = (): void => {
      this.finish(raw);
    };
    const runDisposal = (operation: () => Result<void>): Result<void> => {
      this.imperativeDisposalInFlight = true;
      try {
        return operation();
      } finally {
        this.imperativeDisposalInFlight = false;
      }
    };
    const exposed: BoardloomViewHandle = {
      get space() {
        return requireActive().space;
      },
      get view(): BoardView {
        return requireActive().view;
      },
      get element(): HTMLElement {
        return requireActive().element;
      },
      get messageDiagnostics() {
        return active() ? raw.messageDiagnostics : Object.freeze([]);
      },
      get mounted(): boolean {
        return active() && raw.mounted;
      },
      get disposed(): boolean {
        return !active() || raw.disposed;
      },
      update(options: UpdateBoardViewOptions = {}) {
        return active() ? raw.update(options) : unavailable();
      },
      setMode(mode: ViewMode, options: { readonly lease?: EditorLease } = {}) {
        return active() ? raw.setMode(mode, options) : unavailable();
      },
      refresh(): void {
        if (active()) {
          raw.refresh();
        }
      },
      exportDocument() {
        return active() ? raw.exportDocument() : unavailable();
      },
      focus(target: FocusTarget = "content") {
        return active() ? raw.focus(target) : unavailable();
      },
      unmount(options: { readonly draftDecision?: BoardloomDraftDecision } = {}) {
        if (!active()) {
          return ended() ? ok(undefined) : unavailable();
        }
        const result = runDisposal(() => raw.unmount(options));
        if (result.ok) {
          finish();
        }
        return result;
      },
      dispose(options: { readonly draftDecision?: BoardloomDraftDecision } = {}) {
        if (!active()) {
          return ended() ? ok(undefined) : unavailable();
        }
        const result = runDisposal(() => raw.dispose(options));
        if (result.ok) {
          finish();
        }
        return result;
      },
    };
    return Object.freeze(exposed);
  }

  private retain(handle: BoardViewHandle, diagnostics: BoardloomAdapterError["diagnostics"]): void {
    const retained: BoardloomRetainedSession = Object.freeze({
      handle,
      spaceId: handle.space.id,
      viewId: handle.view.viewId,
    });
    try {
      handle.element.remove();
    } catch {
      void 0;
    }
    this.callbacks.onHandle?.(null);
    this.reportError("dispose", diagnostics, retained);
  }

  private reportError(
    phase: BoardloomAdapterPhase,
    diagnostics: BoardloomAdapterError["diagnostics"],
    retained?: BoardloomRetainedSession,
  ): void {
    this.callbacks.onError?.({
      phase,
      diagnostics,
      ...(retained === undefined ? {} : { retained }),
    });
  }
}
