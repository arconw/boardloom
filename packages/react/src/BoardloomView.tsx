import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  type CSSProperties,
  type ReactElement,
} from "react";
import {
  DIAGNOSTIC_CODES,
  createDiagnostic,
  fail,
  ok,
  type BoardloomRuntime,
  type BoardSerialization,
  type BoardSpace,
  type BoardView,
  type DatasetProvider,
  type EditorLease,
  type ExtensionSelection,
  type RendererDefinition,
  type Result,
  type RuntimeOptions,
  type SpaceEvent,
  type ViewMode,
  type ViewSnapshot,
} from "@boardloom/core";
import {
  mountBoardView,
  type BlockTypeDefinition,
  type BoardloomExtensions,
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

interface StableCallbacks {
  readonly onEvent: (event: SpaceEvent) => void;
  readonly onExport: (kind: "ui" | "host", serialization: BoardSerialization) => void;
  readonly onImportDocument: (
    input: string,
    fileName: string,
  ) => Result<{ readonly spaceId: string }>;
}

interface MountInputs {
  readonly space: BoardSpace | undefined;
  readonly runtime: BoardloomRuntime | undefined;
  readonly runtimeOptions: RuntimeOptions | undefined;
  readonly document: unknown;
  readonly datasetProvider: DatasetProvider | undefined;
  readonly view: BoardView | undefined;
  readonly blockTypes: readonly BlockTypeDefinition[] | undefined;
  readonly renderers: readonly RendererDefinition<HTMLElement>[] | undefined;
  readonly extensions: BoardloomExtensions | undefined;
  readonly extensionSelection: ExtensionSelection | undefined;
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

function updateStateOf(props: BoardloomViewProps): AppliedUpdateState {
  return Object.freeze({
    locale: props.locale,
    timezone: props.timezone,
    theme: props.theme,
    messages: props.messages,
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

function buildMountOptions(
  props: BoardloomViewProps,
  callbacks: StableCallbacks,
): MountBoardViewOptions {
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
    ...(props.realtime === undefined ? {} : { realtime: props.realtime }),
    ...(props.provenance === undefined ? {} : { provenance: props.provenance }),
    ...(props.blockTypes === undefined ? {} : { blockTypes: props.blockTypes }),
    ...(props.renderers === undefined ? {} : { renderers: props.renderers }),
    ...(props.extensions === undefined ? {} : { extensions: props.extensions }),
    ...(props.extensionSelection === undefined
      ? {}
      : { extensionSelection: props.extensionSelection }),
    onEvent: callbacks.onEvent,
    onExport: callbacks.onExport,
    ...(props.onImportDocument === undefined
      ? {}
      : { onImportDocument: callbacks.onImportDocument }),
  };
}

function buildUpdateOptions(
  props: BoardloomViewProps,
  applied: AppliedUpdateState,
): UpdateBoardViewOptions | null {
  const options: {
    locale?: string;
    timezone?: string;
    theme?: NonNullable<BoardloomViewProps["theme"]>;
    messages?: NonNullable<BoardloomViewProps["messages"]>;
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

function hasDirtyDraft(handle: BoardViewHandle): boolean {
  try {
    return handle.space.getSnapshot().draft?.dirty === true;
  } catch {
    return false;
  }
}

function useStableCallbacks(
  latest: { readonly current: BoardloomViewProps },
  handle: { readonly current: BoardViewHandle | null },
  finish: {
    readonly current: ((handle: BoardViewHandle, info: BoardloomViewReadyInfo) => void) | null;
  },
  explicitDisposalInFlight: { readonly current: boolean },
): StableCallbacks {
  return useMemo<StableCallbacks>(() => {
    const onEvent = (event: SpaceEvent): void => {
      const current = handle.current;
      if (current === null || event.spaceId !== current.space.id) {
        return;
      }
      const matchesView = !("viewId" in event) || event.viewId === current.view.viewId;
      if (matchesView) {
        latest.current.onEvent?.(event);
      }
      if (event.type === "view:disposed" && event.viewId === current.view.viewId) {
        if (!explicitDisposalInFlight.current) {
          finish.current?.(current, readyInfo(current));
        }
        return;
      }
      if (event.type === "space:disposed") {
        if (!explicitDisposalInFlight.current) {
          finish.current?.(current, readyInfo(current));
        }
        return;
      }
      if (event.type === "mode:changed" && matchesView) {
        latest.current.onModeChange?.(
          event.to,
          event as Extract<SpaceEvent, { type: "mode:changed" }>,
        );
      }
    };
    const onExport = (kind: "ui" | "host", serialization: BoardSerialization): void => {
      latest.current.onExport?.(kind, serialization);
    };
    const onImportDocument = (
      input: string,
      fileName: string,
    ): Result<{ readonly spaceId: string }> => {
      const importer = latest.current.onImportDocument;
      if (importer === undefined) {
        return fail([
          createDiagnostic(DIAGNOSTIC_CODES.INVALID_ARGUMENT, "onImportDocument", {
            message: "The host did not provide an import handler.",
          }),
        ]);
      }
      return importer(input, fileName);
    };
    return Object.freeze({ onEvent, onExport, onImportDocument });
  }, [handle, latest]);
}

export const BoardloomView = forwardRef<BoardloomViewHandle, BoardloomViewProps>(
  function BoardloomView(props, ref): ReactElement {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const handleRef = useRef<BoardViewHandle | null>(null);
    const appliedRef = useRef<AppliedUpdateState | null>(null);
    const failedAttemptRef = useRef<AppliedUpdateState | null>(null);
    const mountedInputsRef = useRef<MountInputs | null>(null);
    const failedMountRef = useRef<MountInputs | null>(null);
    const unstableInputsRef = useRef<MountInputs | null>(null);
    const ownedSpaceRef = useRef(false);
    const sessionEndedRef = useRef(false);
    const latestRef = useRef<BoardloomViewProps>(props);
    const finishRef = useRef<
      ((handle: BoardViewHandle, info: BoardloomViewReadyInfo) => void) | null
    >(null);
    const explicitDisposalInFlightRef = useRef(false);
    const callbacks = useStableCallbacks(
      latestRef,
      handleRef,
      finishRef,
      explicitDisposalInFlightRef,
    );

    const reportError = (
      phase: BoardloomAdapterPhase,
      diagnostics: BoardloomAdapterError["diagnostics"],
      retained?: BoardloomRetainedSession,
    ): void => {
      latestRef.current.onError?.({
        phase,
        diagnostics,
        ...(retained === undefined ? {} : { retained }),
      });
    };

    const retain = (
      handle: BoardViewHandle,
      diagnostics: BoardloomAdapterError["diagnostics"],
    ): void => {
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
      reportError("dispose", diagnostics, retained);
    };

    const disposeCurrent = (): void => {
      const handle = handleRef.current;
      if (handle === null) {
        return;
      }
      const info = readyInfo(handle);
      const ownedSpace = ownedSpaceRef.current;
      handleRef.current = null;
      appliedRef.current = null;
      failedAttemptRef.current = null;
      mountedInputsRef.current = null;
      ownedSpaceRef.current = false;
      const decision = latestRef.current.draftDecision;
      if (ownedSpace && hasDirtyDraft(handle) && decision !== "apply" && decision !== "cancel") {
        retain(handle, [
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
          retain(handle, disposed.diagnostics);
          return;
        }
      } catch (error) {
        retain(handle, [
          createDiagnostic(DIAGNOSTIC_CODES.INVALID_ARGUMENT, "dispose", {
            message: error instanceof Error ? error.message : String(error),
          }),
        ]);
        return;
      }
      latestRef.current.onDispose?.(info);
    };

    useEffect(() => {
      latestRef.current = props;
    });

    useEffect(() => {
      if (sessionEndedRef.current) {
        return;
      }
      const target = containerRef.current;
      if (target === null) {
        return;
      }
      const inputs = captureMountInputs(latestRef.current);
      if (handleRef.current !== null) {
        if (sameMountInputs(inputs, mountedInputsRef.current)) {
          unstableInputsRef.current = null;
          return;
        }
        if (sameMountSignature(inputs, mountedInputsRef.current)) {
          if (
            unstableInputsRef.current === null ||
            !sameMountSignature(inputs, unstableInputsRef.current)
          ) {
            unstableInputsRef.current = inputs;
            reportError("input", [
              createDiagnostic(DIAGNOSTIC_CODES.INVALID_ARGUMENT, "mountInputs", {
                message:
                  "Function-bearing mount inputs must keep stable references; the existing session was kept.",
              }),
            ]);
          }
          return;
        }
        unstableInputsRef.current = null;
      } else if (
        failedMountRef.current !== null &&
        sameMountSignature(inputs, failedMountRef.current)
      ) {
        return;
      }
      disposeCurrent();
      const mounted = mountBoardView(target, buildMountOptions(latestRef.current, callbacks));
      if (!mounted.ok) {
        failedMountRef.current = inputs;
        reportError("mount", mounted.diagnostics);
        return;
      }
      const handle = mounted.value;
      handleRef.current = handle;
      appliedRef.current = updateStateOf(latestRef.current);
      failedAttemptRef.current = null;
      mountedInputsRef.current = inputs;
      failedMountRef.current = null;
      ownedSpaceRef.current = latestRef.current.space === undefined;
      sessionEndedRef.current = false;
      latestRef.current.onReady?.(readyInfo(handle));
    });

    useEffect(() => {
      return () => {
        disposeCurrent();
      };
    }, []);

    useEffect(() => {
      const handle = handleRef.current;
      const applied = appliedRef.current;
      if (handle === null || applied === null || handle.disposed) {
        return;
      }
      const current = updateStateOf(latestRef.current);
      if (failedAttemptRef.current !== null && sameUpdateState(current, failedAttemptRef.current)) {
        return;
      }
      const options = buildUpdateOptions(latestRef.current, applied);
      if (options === null) {
        return;
      }
      const updated = handle.update(options);
      if (updated.ok) {
        appliedRef.current = current;
        failedAttemptRef.current = null;
        return;
      }
      failedAttemptRef.current = current;
      reportError("update", updated.diagnostics);
    });

    const finishImperativeDisposal = (
      handle: BoardViewHandle,
      info: BoardloomViewReadyInfo,
    ): void => {
      if (handleRef.current !== handle) {
        return;
      }
      handleRef.current = null;
      appliedRef.current = null;
      failedAttemptRef.current = null;
      mountedInputsRef.current = null;
      failedMountRef.current = null;
      unstableInputsRef.current = null;
      ownedSpaceRef.current = false;
      sessionEndedRef.current = true;
      latestRef.current.onDispose?.(info);
    };
    finishRef.current = finishImperativeDisposal;

    const api = useMemo<BoardloomViewHandle>(() => {
      const current = (): BoardViewHandle => requireHandle(handleRef.current);
      return {
        get space(): BoardSpace {
          return current().space;
        },
        get view(): BoardView {
          return current().view;
        },
        get element(): HTMLElement {
          return current().element;
        },
        get mounted(): boolean {
          return handleRef.current?.mounted ?? false;
        },
        get disposed(): boolean {
          return handleRef.current?.disposed ?? true;
        },
        update(options: UpdateBoardViewOptions = {}): Result<void> {
          return handleRef.current?.update(options) ?? unavailable();
        },
        setMode(
          mode: ViewMode,
          options: { readonly lease?: EditorLease } = {},
        ): Result<ViewSnapshot> {
          return handleRef.current?.setMode(mode, options) ?? unavailable();
        },
        refresh(): void {
          handleRef.current?.refresh();
        },
        exportDocument(): Result<BoardSerialization> {
          return handleRef.current?.exportDocument() ?? unavailable();
        },
        focus(target: FocusTarget = "content"): Result<void> {
          return handleRef.current?.focus(target) ?? unavailable();
        },
        unmount(options: { readonly draftDecision?: BoardloomDraftDecision } = {}): Result<void> {
          const handle = handleRef.current;
          if (handle === null) {
            return sessionEndedRef.current ? ok(undefined) : unavailable();
          }
          const info = readyInfo(handle);
          explicitDisposalInFlightRef.current = true;
          let result: Result<void>;
          try {
            result = handle.unmount(options);
          } finally {
            explicitDisposalInFlightRef.current = false;
          }
          if (result.ok) {
            finishImperativeDisposal(handle, info);
          }
          return result;
        },
        dispose(options: { readonly draftDecision?: BoardloomDraftDecision } = {}): Result<void> {
          const handle = handleRef.current;
          if (handle === null) {
            return sessionEndedRef.current ? ok(undefined) : unavailable();
          }
          const info = readyInfo(handle);
          explicitDisposalInFlightRef.current = true;
          let result: Result<void>;
          try {
            result = handle.dispose(options);
          } finally {
            explicitDisposalInFlightRef.current = false;
          }
          if (result.ok) {
            finishImperativeDisposal(handle, info);
          }
          return result;
        },
      };
    }, []);
    useImperativeHandle(ref, () => api, [api]);

    const containerClassName =
      [props.containerProps?.className, props.className].filter(Boolean).join(" ") || undefined;
    const containerStyle: CSSProperties | undefined =
      props.containerProps?.style === undefined && props.style === undefined
        ? undefined
        : { ...props.containerProps?.style, ...props.style };

    return (
      <div
        {...props.containerProps}
        ref={containerRef}
        className={containerClassName}
        style={containerStyle}
        data-boardloom-react=""
      />
    );
  },
);
