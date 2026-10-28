import {
  DIAGNOSTIC_CODES,
  createDiagnostic,
  createRendererRegistry,
  createRuntime,
  fail,
  ok,
  restoreViewSession,
  type BoardSpace,
  type BoardView,
  type BoardloomRuntime,
  type Diagnostic,
  type EditorLease,
  type Result,
  type ViewMode,
} from "@boardloom/core";
import { BUILT_IN_BLOCK_TYPES } from "./built-in-blocks.js";
import { BUILT_IN_RENDERERS } from "./built-in-renderers.js";
import { createBlockRegistry } from "./block-registry.js";
import { createViewMessages, type ViewMessages } from "./messages.js";
import { claimMountedView, isMountedView, releaseMountedView } from "./mount-registry.js";
import type { MountBoardViewOptions, BoardViewHandle } from "./types.js";
import { ViewerHost, failureFrom, isThemeMode } from "./viewer.js";

interface ResolvedSpace {
  readonly space: BoardSpace;
  readonly runtime: BoardloomRuntime | null;
  readonly ownsRuntime: boolean;
  readonly ownsSpace: boolean;
}

function cleanup(
  space: BoardSpace | null,
  view: BoardView | null,
  runtime: BoardloomRuntime | null,
  ownership: {
    readonly ownsSpace: boolean;
    readonly ownsView: boolean;
    readonly ownsRuntime: boolean;
  },
): void {
  if (ownership.ownsView && view !== null && !view.disposed) {
    view.dispose();
  }
  if (ownership.ownsSpace && space !== null && !space.disposed) {
    space.dispose();
  }
  if (ownership.ownsRuntime && runtime !== null) {
    runtime.dispose();
  }
}

function resolveSpace(options: MountBoardViewOptions): Result<ResolvedSpace> {
  if (options.space !== undefined) {
    if (options.space.disposed) {
      return fail([createDiagnostic(DIAGNOSTIC_CODES.SPACE_DISPOSED, "space")]);
    }
    if (options.locale !== undefined || options.timezone !== undefined) {
      const localized = options.space.setLocale({
        ...(options.locale === undefined ? {} : { locale: options.locale }),
        ...(options.timezone === undefined ? {} : { timezone: options.timezone }),
      });
      if (!localized.ok) {
        return localized;
      }
    }
    return ok(
      Object.freeze({
        space: options.space,
        runtime: null,
        ownsRuntime: false,
        ownsSpace: false,
      }),
    );
  }
  let runtime: BoardloomRuntime;
  try {
    runtime = options.runtime ?? createRuntime(options.runtimeOptions);
  } catch (error) {
    return fail(failureFrom(error, "runtime"));
  }
  const ownsRuntime = options.runtime === undefined;
  if (options.document === undefined) {
    if (ownsRuntime) {
      runtime.dispose();
    }
    return fail([
      createDiagnostic(DIAGNOSTIC_CODES.INVALID_ARGUMENT, "document", {
        message: "Mounting without a space requires a board document.",
      }),
    ]);
  }
  const created = runtime.createSpace({
    document: options.document,
    ...(options.locale === undefined ? {} : { locale: options.locale }),
    ...(options.timezone === undefined ? {} : { timezone: options.timezone }),
    ...(options.datasetProvider === undefined ? {} : { datasetProvider: options.datasetProvider }),
  });
  if (!created.ok) {
    if (ownsRuntime) {
      runtime.dispose();
    }
    return created;
  }
  return ok(
    Object.freeze({
      space: created.value,
      runtime,
      ownsRuntime,
      ownsSpace: true,
    }),
  );
}

function resolveView(
  options: MountBoardViewOptions,
  space: BoardSpace,
): Result<{ readonly view: BoardView; readonly ownsView: boolean }> {
  if (options.view !== undefined) {
    if (options.view.disposed) {
      return fail([createDiagnostic(DIAGNOSTIC_CODES.VIEW_DISPOSED, "view")]);
    }
    if (isMountedView(options.view)) {
      return fail([
        createDiagnostic(DIAGNOSTIC_CODES.INVALID_ARGUMENT, "view", {
          message: "The view is already mounted by another viewer handle.",
        }),
      ]);
    }
    if (options.view.spaceId !== space.id) {
      return fail([
        createDiagnostic(DIAGNOSTIC_CODES.INVALID_ARGUMENT, "view/spaceId", {
          message: "The view belongs to a different space.",
          relatedIds: [options.view.spaceId],
        }),
      ]);
    }
    return ok({ view: options.view, ownsView: false });
  }
  const created = space.createView({
    mode: options.mode ?? "viewer",
    ...(options.lease === undefined ? {} : { lease: options.lease }),
  });
  if (!created.ok) {
    return created;
  }
  return ok({ view: created.value, ownsView: true });
}

function buildMessages(
  space: BoardSpace,
  overrides: MountBoardViewOptions["messages"],
): Result<ViewMessages> {
  try {
    return ok(
      createViewMessages({
        provider: space.getMessageProvider(),
        ...(overrides === undefined ? {} : { overrides }),
      }),
    );
  } catch (error) {
    return fail(failureFrom(error, "messages"));
  }
}

function registryFailure(diagnostics: readonly Diagnostic[]): Result<never> {
  return fail(diagnostics);
}

interface ExternalViewSession {
  readonly mode: ViewMode;
  readonly lease: EditorLease | null;
}

function captureExternalViewSession(view: BoardView, space: BoardSpace): ExternalViewSession {
  const snapshot = view.getSnapshot();
  let lease: EditorLease | null = null;
  if (snapshot.leaseId !== null) {
    const spaceSnapshot = space.getSnapshot();
    if (spaceSnapshot.editorLease?.leaseId === snapshot.leaseId) {
      lease = spaceSnapshot.editorLease;
    }
  }
  return Object.freeze({ mode: snapshot.mode, lease });
}

function restoreExternalView(view: BoardView, session: ExternalViewSession): Result<void> {
  try {
    if (view.disposed) {
      return fail([
        createDiagnostic(DIAGNOSTIC_CODES.VIEW_SESSION_RESTORE_FAILED, "view", {
          relatedIds: [view.viewId],
        }),
      ]);
    }
    const restored = restoreViewSession(view, session.mode, session.lease);
    if (restored.ok) {
      return ok(undefined);
    }
    if (session.mode === "viewer") {
      view.setMode("viewer");
    }
    const snapshot = view.getSnapshot();
    const leaseId = snapshot.leaseId ?? null;
    if (snapshot.mode === session.mode && leaseId === (session.lease?.leaseId ?? null)) {
      return ok(undefined);
    }
    return fail([
      createDiagnostic(DIAGNOSTIC_CODES.VIEW_SESSION_RESTORE_FAILED, "view", {
        relatedIds: [view.viewId],
      }),
    ]);
  } catch (error) {
    return fail([
      createDiagnostic(DIAGNOSTIC_CODES.VIEW_SESSION_RESTORE_FAILED, "view", {
        message: error instanceof Error ? error.message : String(error),
        relatedIds: [view.viewId],
      }),
    ]);
  }
}

export function mountBoardView(
  target: HTMLElement,
  options: MountBoardViewOptions = {},
): Result<BoardViewHandle> {
  if (
    target === null ||
    typeof target !== "object" ||
    typeof target.append !== "function" ||
    typeof target.addEventListener !== "function" ||
    target.ownerDocument === undefined
  ) {
    return fail([
      createDiagnostic(DIAGNOSTIC_CODES.INVALID_ARGUMENT, "target", {
        message: "A DOM element target is required.",
      }),
    ]);
  }
  if (options.theme !== undefined && !isThemeMode(options.theme)) {
    return fail([
      createDiagnostic(DIAGNOSTIC_CODES.INVALID_ARGUMENT, "theme", {
        message: "A theme must be light, dark or system.",
      }),
    ]);
  }
  let externalLocaleBefore: ReturnType<BoardSpace["getSnapshot"]> | null = null;
  if (
    options.space !== undefined &&
    (options.locale !== undefined || options.timezone !== undefined)
  ) {
    try {
      externalLocaleBefore = options.space.getSnapshot();
    } catch {
      externalLocaleBefore = null;
    }
  }
  const rollbackExternalLocale = (): void => {
    if (externalLocaleBefore === null || options.space === undefined || options.space.disposed) {
      return;
    }
    options.space.setLocale({
      locale: externalLocaleBefore.locale,
      timezone: externalLocaleBefore.timezone,
    });
  };
  const resolved = resolveSpace(options);
  if (!resolved.ok) {
    return resolved;
  }
  const space = resolved.value.space;
  const viewResult = resolveView(options, space);
  if (!viewResult.ok) {
    cleanup(space, null, resolved.value.runtime, {
      ownsSpace: resolved.value.ownsSpace,
      ownsView: false,
      ownsRuntime: resolved.value.ownsRuntime,
    });
    rollbackExternalLocale();
    return viewResult;
  }
  const view = viewResult.value.view;
  const ownership = {
    ownsSpace: resolved.value.ownsSpace,
    ownsView: viewResult.value.ownsView,
    ownsRuntime: resolved.value.ownsRuntime,
  };
  let expectedExternalSession: ExternalViewSession | null = null;
  if (
    !ownership.ownsView &&
    options.view !== undefined &&
    (options.mode !== undefined || options.lease !== undefined)
  ) {
    try {
      expectedExternalSession = captureExternalViewSession(options.view, space);
    } catch (error) {
      cleanup(space, view, resolved.value.runtime, ownership);
      rollbackExternalLocale();
      return fail([
        createDiagnostic(DIAGNOSTIC_CODES.VIEW_SESSION_RESTORE_FAILED, "view", {
          message: error instanceof Error ? error.message : String(error),
          relatedIds: [options.view.viewId],
        }),
      ]);
    }
    const supported = restoreViewSession(
      options.view,
      expectedExternalSession.mode,
      expectedExternalSession.lease,
    );
    if (!supported.ok) {
      cleanup(space, view, resolved.value.runtime, ownership);
      rollbackExternalLocale();
      return fail([
        createDiagnostic(DIAGNOSTIC_CODES.VIEW_SESSION_RESTORE_FAILED, "view", {
          message:
            "The supplied external view does not support restoring its mode and session after a failed mount.",
          relatedIds: [options.view.viewId],
        }),
      ]);
    }
  }
  const messages = buildMessages(space, options.messages);
  if (!messages.ok) {
    cleanup(space, view, resolved.value.runtime, ownership);
    rollbackExternalLocale();
    return messages;
  }
  const registryDefinitions = [...BUILT_IN_BLOCK_TYPES, ...(options.blockTypes ?? [])];
  const registry = createBlockRegistry(registryDefinitions);
  if (!registry.ok) {
    cleanup(space, view, resolved.value.runtime, ownership);
    rollbackExternalLocale();
    return registryFailure(registry.diagnostics);
  }
  const renderers = createRendererRegistry([...BUILT_IN_RENDERERS, ...(options.renderers ?? [])]);
  if (!renderers.ok) {
    cleanup(space, view, resolved.value.runtime, ownership);
    rollbackExternalLocale();
    return registryFailure(renderers.diagnostics);
  }
  if (!claimMountedView(view)) {
    cleanup(space, view, resolved.value.runtime, ownership);
    rollbackExternalLocale();
    return fail([
      createDiagnostic(DIAGNOSTIC_CODES.INVALID_ARGUMENT, "view", {
        message: "The view is already mounted by another viewer handle.",
      }),
    ]);
  }
  if (view.disposed || space.disposed) {
    releaseMountedView(view);
    cleanup(space, view, resolved.value.runtime, ownership);
    rollbackExternalLocale();
    return fail([
      createDiagnostic(
        space.disposed ? DIAGNOSTIC_CODES.SPACE_DISPOSED : DIAGNOSTIC_CODES.VIEW_DISPOSED,
        space.disposed ? "space" : "view",
      ),
    ]);
  }
  const config = {
    ...(options.theme === undefined ? {} : { theme: options.theme }),
    ...(options.messages === undefined ? {} : { messages: options.messages }),
    ...(options.realtime === undefined ? {} : { realtime: options.realtime }),
    ...(options.provenance === undefined ? {} : { provenance: options.provenance }),
    ...(options.onEvent === undefined ? {} : { onEvent: options.onEvent }),
  };
  let host: ViewerHost;
  try {
    host = new ViewerHost(
      target,
      space,
      view,
      resolved.value.runtime,
      ownership,
      registry.value,
      renderers.value,
      messages.value,
      config,
    );
  } catch (error) {
    releaseMountedView(view);
    cleanup(space, view, resolved.value.runtime, ownership);
    rollbackExternalLocale();
    return fail(failureFrom(error, "viewer"));
  }
  if (!ownership.ownsView && (options.mode !== undefined || options.lease !== undefined)) {
    let deferredFailure: Result<never> | null = null;
    try {
      const changed = host.setMode(
        options.mode ?? view.mode,
        options.lease === undefined ? {} : { lease: options.lease },
      );
      if (!changed.ok) {
        deferredFailure = changed;
      } else {
        host.refresh();
        if (!host.mounted || view.disposed || space.disposed) {
          deferredFailure = fail([
            createDiagnostic(
              space.disposed ? DIAGNOSTIC_CODES.SPACE_DISPOSED : DIAGNOSTIC_CODES.VIEW_DISPOSED,
              space.disposed ? "space" : "view",
            ),
          ]);
        }
      }
    } catch (error) {
      deferredFailure = fail(failureFrom(error, "viewer"));
    }
    if (deferredFailure !== null) {
      try {
        host.unmount();
      } catch {
        void 0;
      }
      releaseMountedView(view);
      const restoration =
        expectedExternalSession === null
          ? ok(undefined)
          : restoreExternalView(view, expectedExternalSession);
      cleanup(space, view, resolved.value.runtime, ownership);
      rollbackExternalLocale();
      if (!restoration.ok && !deferredFailure.ok) {
        return fail([...deferredFailure.diagnostics, ...restoration.diagnostics]);
      }
      return deferredFailure;
    }
  }
  return ok(host);
}
