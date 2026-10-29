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
  type EditorLease,
  type Result,
  type ViewMode,
} from "@boardloom/core";
import { createBlockRegistry, type BlockTypeDefinition } from "./block-registry.js";
import { createBoardloomExtensions, type BoardloomExtensions } from "./extensions.js";
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

function sameBlockDefinition(left: BlockTypeDefinition, right: BlockTypeDefinition): boolean {
  return (
    left.type === right.type &&
    left.version === right.version &&
    left.apiVersion === right.apiVersion &&
    left.styles === right.styles &&
    left.createSurface === right.createSurface
  );
}

function sameRendererDefinition(
  left: import("@boardloom/core").RendererDefinition<HTMLElement>,
  right: import("@boardloom/core").RendererDefinition<HTMLElement>,
): boolean {
  return (
    left.id === right.id &&
    left.version === right.version &&
    left.apiVersion === right.apiVersion &&
    left.kind === right.kind &&
    left.styles === right.styles &&
    left.explicitOnly === right.explicitOnly &&
    left.mount === right.mount &&
    left.validate === right.validate &&
    JSON.stringify(left.visualizations) === JSON.stringify(right.visualizations) &&
    JSON.stringify(left.capabilities) === JSON.stringify(right.capabilities)
  );
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

function resolveSpace(
  options: MountBoardViewOptions,
  extensions: BoardloomExtensions | null,
): Result<ResolvedSpace> {
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
    const runtimeOptions = options.runtimeOptions;
    runtime =
      options.runtime ??
      createRuntime({
        ...runtimeOptions,
        ...(runtimeOptions?.extensions === undefined && extensions !== null
          ? { extensions: extensions.core }
          : {}),
        blockTypes: [
          ...(runtimeOptions?.blockTypes ?? []),
          ...(options.blockTypes ?? []).map((definition) => definition.type),
        ],
      });
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
    ...(options.extensionSelection === undefined
      ? {}
      : { extensionSelection: options.extensionSelection }),
    blockTypes: [
      ...(options.blockTypes ?? []).map((definition) => definition.type),
      ...(extensions?.blocks.list().map((definition) => definition.type) ?? []),
    ],
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
  let extensions: BoardloomExtensions;
  let ownsExtensions = false;
  if (options.extensions !== undefined) {
    if (options.extensions.disposed) {
      return fail([
        createDiagnostic(DIAGNOSTIC_CODES.EXTENSION_INVALID, "extensions", {
          message: "The supplied extension registry has already been disposed.",
        }),
      ]);
    }
    extensions = options.extensions;
    const pendingBlocks = new Map<string, BlockTypeDefinition>();
    for (const definition of options.blockTypes ?? []) {
      const existing = extensions.blocks.get(definition.type);
      if (existing !== undefined && !sameBlockDefinition(existing, definition)) {
        return fail([
          createDiagnostic(
            DIAGNOSTIC_CODES.EXTENSION_DUPLICATE,
            `extensions/block/${definition.type}`,
            {
              message: `The block type ${definition.type} is already registered with a different definition.`,
              relatedIds: [definition.type],
            },
          ),
        ]);
      }
      const pending = pendingBlocks.get(definition.type);
      if (pending !== undefined && !sameBlockDefinition(pending, definition)) {
        return fail([
          createDiagnostic(
            DIAGNOSTIC_CODES.EXTENSION_DUPLICATE,
            `extensions/block/${definition.type}`,
            {
              message: `The block type ${definition.type} is supplied with conflicting definitions.`,
              relatedIds: [definition.type],
            },
          ),
        ]);
      }
      pendingBlocks.set(definition.type, definition);
    }
    const newBlocks = [...pendingBlocks.values()].filter(
      (definition) => !extensions.blocks.has(definition.type),
    );
    const blockProbe = createBlockRegistry([...extensions.blocks.list(), ...newBlocks]);
    if (!blockProbe.ok) {
      return blockProbe;
    }

    const pendingRenderers = new Map<
      string,
      import("@boardloom/core").RendererDefinition<HTMLElement>
    >();
    for (const definition of options.renderers ?? []) {
      const existing = extensions.renderers.get(definition.id);
      if (existing !== undefined && !sameRendererDefinition(existing, definition)) {
        return fail([
          createDiagnostic(
            DIAGNOSTIC_CODES.EXTENSION_DUPLICATE,
            `extensions/renderer/${definition.id}`,
            {
              message: `The renderer ${definition.id} is already registered with a different definition.`,
              relatedIds: [definition.id],
            },
          ),
        ]);
      }
      const pending = pendingRenderers.get(definition.id);
      if (pending !== undefined && !sameRendererDefinition(pending, definition)) {
        return fail([
          createDiagnostic(
            DIAGNOSTIC_CODES.EXTENSION_DUPLICATE,
            `extensions/renderer/${definition.id}`,
            {
              message: `The renderer ${definition.id} is supplied with conflicting definitions.`,
              relatedIds: [definition.id],
            },
          ),
        ]);
      }
      pendingRenderers.set(definition.id, definition);
    }
    const newRenderers = [...pendingRenderers.values()].filter(
      (definition) => !extensions.renderers.has(definition.id),
    );
    const rendererProbe = createRendererRegistry([...extensions.renderers.list(), ...newRenderers]);
    if (!rendererProbe.ok) {
      return rendererProbe;
    }
    for (const definition of newBlocks) {
      const registered = extensions.blocks.register(definition);
      if (!registered.ok) {
        return registered;
      }
    }
    for (const definition of newRenderers) {
      const registered = extensions.renderers.register(definition);
      if (!registered.ok) {
        return registered;
      }
    }
  } else {
    const created = createBoardloomExtensions({
      ...(options.blockTypes === undefined ? {} : { blockTypes: options.blockTypes }),
      ...(options.renderers === undefined ? {} : { renderers: options.renderers }),
    });
    if (!created.ok) {
      return created;
    }
    extensions = created.value;
    ownsExtensions = true;
  }
  const cleanupAndDispose = (
    spaceToClean: BoardSpace | null,
    viewToClean: BoardView | null,
    runtimeToClean: BoardloomRuntime | null,
    ownershipToClean: {
      readonly ownsSpace: boolean;
      readonly ownsView: boolean;
      readonly ownsRuntime: boolean;
    },
  ): void => {
    cleanup(spaceToClean, viewToClean, runtimeToClean, ownershipToClean);
    if (ownsExtensions) {
      extensions.dispose();
    }
  };

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
  const resolved = resolveSpace(options, extensions);
  if (!resolved.ok) {
    return resolved;
  }
  const space = resolved.value.space;
  const viewResult = resolveView(options, space);
  if (!viewResult.ok) {
    cleanupAndDispose(space, null, resolved.value.runtime, {
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
      cleanupAndDispose(space, view, resolved.value.runtime, ownership);
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
      cleanupAndDispose(space, view, resolved.value.runtime, ownership);
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
    cleanupAndDispose(space, view, resolved.value.runtime, ownership);
    rollbackExternalLocale();
    return messages;
  }
  if (!claimMountedView(view)) {
    cleanupAndDispose(space, view, resolved.value.runtime, ownership);
    rollbackExternalLocale();
    return fail([
      createDiagnostic(DIAGNOSTIC_CODES.INVALID_ARGUMENT, "view", {
        message: "The view is already mounted by another viewer handle.",
      }),
    ]);
  }
  if (view.disposed || space.disposed) {
    releaseMountedView(view);
    cleanupAndDispose(space, view, resolved.value.runtime, ownership);
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
    ...(options.onImportDocument === undefined
      ? {}
      : { onImportDocument: options.onImportDocument }),
    ...(options.onExport === undefined ? {} : { onExport: options.onExport }),
    ...(ownsExtensions ? { ownedExtensions: extensions } : {}),
  };
  let host: ViewerHost;
  try {
    host = new ViewerHost(
      target,
      space,
      view,
      resolved.value.runtime,
      ownership,
      extensions.blocks,
      extensions.renderers,
      messages.value,
      config,
    );
  } catch (error) {
    releaseMountedView(view);
    cleanupAndDispose(space, view, resolved.value.runtime, ownership);
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
      cleanupAndDispose(space, view, resolved.value.runtime, ownership);
      rollbackExternalLocale();
      if (!restoration.ok && !deferredFailure.ok) {
        return fail([...deferredFailure.diagnostics, ...restoration.diagnostics]);
      }
      return deferredFailure;
    }
  }
  return ok(host);
}
