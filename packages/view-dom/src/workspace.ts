import {
  DIAGNOSTIC_CODES,
  createDiagnostic,
  createRuntime,
  fail,
  ok,
  validateBoardDocument,
  validateFilterRuntimeState,
  type BoardDocumentV1,
  type BoardloomRuntime,
  type BoardSerialization,
  type BoardSpace,
  type Diagnostic,
  type EditorLease,
  type EventBatchHandle,
  type ImportDocumentOptions,
  type MessageDictionary,
  type RendererDefinition,
  type Result,
  type RuntimeOptions,
  type SpaceEvent,
  type ThemeMode,
} from "@boardloom/core";
import { createViewMessages } from "./messages.js";
import { mountBoardView } from "./mount.js";
import type { BlockTypeDefinition } from "./block-registry.js";
import type { BoardViewHandle } from "./types.js";

export interface MountBoardWorkspaceOptions {
  readonly runtime?: BoardloomRuntime;
  readonly runtimeOptions?: RuntimeOptions;
  readonly space?: BoardSpace;
  readonly document?: unknown;
  readonly datasetProvider?: import("@boardloom/core").DatasetProvider;
  readonly locale?: string;
  readonly timezone?: string;
  readonly theme?: ThemeMode;
  readonly messages?: MessageDictionary;
  readonly provenance?: string;
  readonly blockTypes?: readonly BlockTypeDefinition[];
  readonly renderers?: readonly RendererDefinition<HTMLElement>[];
  readonly onEvent?: (event: SpaceEvent) => void;
}

export interface WorkspaceEntry {
  readonly space: BoardSpace;
  readonly host: BoardViewHandle;
  readonly panel: HTMLElement;
  readonly tab: HTMLButtonElement;
  readonly sourceSpaceId: string | null;
  readonly owned: boolean;
}

export interface BoardWorkspaceHandle {
  readonly runtime: BoardloomRuntime;
  readonly element: HTMLElement;
  readonly activeSpace: BoardSpace;
  readonly entries: readonly WorkspaceEntry[];
  readonly disposed: boolean;
  importDocument(input: unknown, options?: ImportDocumentOptions): Result<WorkspaceEntry>;
  activateSpace(spaceId: string): Result<void>;
  getEntry(spaceId: string): WorkspaceEntry | undefined;
  exportActiveDocument(): Result<BoardSerialization>;
  dispose(options?: { readonly draftDecision?: "apply" | "cancel" | "keep" }): Result<void>;
}

interface WorkspaceState {
  readonly runtime: BoardloomRuntime;
  readonly ownsRuntime: boolean;
  readonly root: HTMLElement;
  readonly stage: HTMLElement;
  readonly tablist: HTMLElement;
  readonly live: HTMLElement;
  readonly entries: WorkspaceEntry[];
  readonly options: MountBoardWorkspaceOptions;
  readonly importLabel: string;
  readonly hostErrorMessage: string;
  readonly activateErrorMessage: string;
  active: WorkspaceEntry | null;
  disposed: boolean;
  readonly onEvent: ((event: SpaceEvent) => void) | undefined;
}

type TabKeyEvent = Event & {
  readonly key?: string;
};

let workspaceSequence = 0;

function documentTitle(space: BoardSpace): string {
  const document = space.getSnapshot().committedDocument;
  const title = document.title;
  return typeof title === "string" && title.trim() !== "" ? title : space.id;
}

function createWorkspaceElements(
  target: HTMLElement,
  boardsLabel: string,
): {
  readonly root: HTMLElement;
  readonly tablist: HTMLElement;
  readonly stage: HTMLElement;
  readonly live: HTMLElement;
} {
  const doc = target.ownerDocument;
  const root = doc.createElement("div");
  root.className = "boardloom bl-workspace";
  root.id = `bl-workspace-${++workspaceSequence}`;
  const header = doc.createElement("header");
  header.className = "bl-workspace__header";
  header.setAttribute("role", "banner");
  const heading = doc.createElement("p");
  heading.className = "bl-overline";
  heading.textContent = boardsLabel;
  const tablist = doc.createElement("div");
  tablist.className = "bl-workspace__tabs";
  tablist.setAttribute("role", "tablist");
  tablist.setAttribute("aria-label", boardsLabel);
  header.append(heading, tablist);
  const stage = doc.createElement("div");
  stage.className = "bl-workspace__stage";
  const live = doc.createElement("div");
  live.className = "bl-live";
  live.setAttribute("role", "status");
  live.setAttribute("aria-live", "polite");
  live.setAttribute("aria-atomic", "true");
  live.setAttribute("aria-label", boardsLabel);
  root.append(header, stage, live);
  target.append(root);
  return { root, tablist, stage, live };
}

function diagnosticList(error: unknown, path: string): readonly Diagnostic[] {
  if (
    typeof error === "object" &&
    error !== null &&
    "diagnostics" in error &&
    Array.isArray((error as { diagnostics?: unknown }).diagnostics)
  ) {
    return (error as { diagnostics: Diagnostic[] }).diagnostics;
  }
  return [
    createDiagnostic(DIAGNOSTIC_CODES.INVALID_ARGUMENT, path, {
      message: error instanceof Error ? error.message : String(error),
    }),
  ];
}

function syncWorkspaceTab(entry: WorkspaceEntry): void {
  const label = entry.tab.querySelector<HTMLElement>(".bl-workspace__tab-label");
  if (label !== null) {
    label.textContent = documentTitle(entry.space);
  }
}

function syncWorkspaceTabs(state: WorkspaceState): void {
  for (const entry of state.entries) {
    syncWorkspaceTab(entry);
  }
}

function dropWorkspaceEntry(state: WorkspaceState, entry: WorkspaceEntry): void {
  entry.tab.remove();
  entry.panel.remove();
  const index = state.entries.indexOf(entry);
  if (index >= 0) {
    state.entries.splice(index, 1);
  }
  if (state.active === entry) {
    const next = state.entries[0];
    if (next === undefined) {
      state.active = null;
    } else if (!activateEntry(state, next.space.id).ok) {
      state.active = null;
    }
  }
}

function announce(state: WorkspaceState, message: string): void {
  state.live.textContent = message;
}

function deliverHostEvent(state: WorkspaceState, event: SpaceEvent): void {
  if (state.onEvent === undefined) {
    return;
  }
  try {
    state.onEvent(event);
  } catch {
    announce(state, state.hostErrorMessage);
  }
}

function announceWithMessages(
  messages: ReturnType<typeof createViewMessages>,
  state: WorkspaceState,
  key: string,
): void {
  if (messages.has(key)) {
    announce(state, messages.text(key));
  }
}

function spaceMessages(
  state: WorkspaceState,
  space: BoardSpace,
): ReturnType<typeof createViewMessages> {
  return createViewMessages({
    provider: space.getMessageProvider(),
    ...(state.options.messages === undefined ? {} : { overrides: state.options.messages }),
  });
}

function mountEntry(
  state: WorkspaceState,
  space: BoardSpace,
  sourceSpaceId: string | null,
  owned: boolean,
): Result<WorkspaceEntry> {
  const doc = state.root.ownerDocument;
  const panel = doc.createElement("div");
  panel.className = "bl-workspace__panel";
  panel.id = `${state.root.id}-panel-${space.id}`.replace(/[^A-Za-z0-9_-]/g, "-");
  panel.setAttribute("role", "region");
  panel.setAttribute("data-space-id", space.id);
  panel.setAttribute("hidden", "");
  const tab = doc.createElement("button");
  tab.className = "bl-workspace__tab";
  tab.setAttribute("type", "button");
  tab.setAttribute("role", "tab");
  tab.setAttribute("aria-selected", "false");
  tab.setAttribute("aria-controls", panel.id);
  tab.setAttribute("data-space-id", space.id);
  const label = doc.createElement("span");
  label.className = "bl-workspace__tab-label";
  label.textContent = documentTitle(space);
  tab.append(label);
  if (sourceSpaceId !== null) {
    tab.setAttribute("data-imported", "true");
    const marker = doc.createElement("span");
    marker.className = "bl-workspace__tab-imported";
    marker.textContent = state.importLabel;
    tab.append(marker);
  }
  state.tablist.append(tab);
  state.stage.append(panel);
  const mountOptions = {
    runtime: state.runtime,
    space,
    ...(state.options.locale === undefined ? {} : { locale: state.options.locale }),
    ...(state.options.timezone === undefined ? {} : { timezone: state.options.timezone }),
    ...(state.options.theme === undefined ? {} : { theme: state.options.theme }),
    ...(state.options.messages === undefined ? {} : { messages: state.options.messages }),
    ...(state.options.provenance === undefined ? {} : { provenance: state.options.provenance }),
    ...(state.options.blockTypes === undefined ? {} : { blockTypes: state.options.blockTypes }),
    ...(state.options.renderers === undefined ? {} : { renderers: state.options.renderers }),
    onEvent: (event: SpaceEvent) => {
      deliverHostEvent(state, event);
      syncWorkspaceTabs(state);
    },
    onImportDocument: (input: string) => {
      const imported = importIntoWorkspace(state, input, space.id);
      return imported.ok ? ok({ spaceId: imported.value.space.id }) : fail(imported.diagnostics);
    },
  } as const;
  const host = mountBoardView(panel, mountOptions);
  if (!host.ok) {
    panel.remove();
    tab.remove();
    return host;
  }
  const entry: WorkspaceEntry = {
    space,
    host: host.value,
    panel,
    tab,
    sourceSpaceId,
    owned,
  };
  state.entries.push(entry);
  tab.addEventListener("click", () => {
    const activated = activateEntry(state, space.id);
    if (!activated.ok) {
      announce(state, activated.diagnostics[0]?.message ?? state.activateErrorMessage);
    }
  });
  tab.addEventListener("keydown", (event) => handleTabKey(state, event, space.id));
  return ok(entry);
}

function handleTabKey(state: WorkspaceState, event: TabKeyEvent, spaceId: string): void {
  const index = state.entries.findIndex((entry) => entry.space.id === spaceId);
  if (index < 0) {
    return;
  }
  if (event.key === "Enter" || event.key === " " || event.key === "Space") {
    event.preventDefault?.();
    activateEntry(state, spaceId);
    return;
  }
  let targetIndex: number | null = null;
  if (event.key === "ArrowRight") {
    targetIndex = (index + 1) % state.entries.length;
  } else if (event.key === "ArrowLeft") {
    targetIndex = (index - 1 + state.entries.length) % state.entries.length;
  } else if (event.key === "Home") {
    targetIndex = 0;
  } else if (event.key === "End") {
    targetIndex = state.entries.length - 1;
  }
  if (targetIndex === null) {
    return;
  }
  const target = state.entries[targetIndex];
  if (target === undefined) {
    return;
  }
  event.preventDefault?.();
  const activated = activateEntry(state, target.space.id);
  if (activated.ok) {
    target.tab.focus();
  }
}

function activateEntry(state: WorkspaceState, spaceId: string): Result<void> {
  const entry = state.entries.find((candidate) => candidate.space.id === spaceId);
  if (entry === undefined) {
    return fail([
      createDiagnostic(DIAGNOSTIC_CODES.SPACE_NOT_FOUND, "spaceId", {
        relatedIds: [spaceId],
      }),
    ]);
  }
  for (const candidate of state.entries) {
    const selected = candidate.space.id === spaceId;
    if (selected) {
      candidate.panel.removeAttribute("hidden");
    } else {
      candidate.panel.setAttribute("hidden", "");
    }
    candidate.tab.setAttribute("aria-selected", String(selected));
    candidate.tab.setAttribute("tabindex", selected ? "0" : "-1");
    if (selected) {
      candidate.tab.setAttribute("aria-current", "page");
    } else {
      candidate.tab.removeAttribute("aria-current");
    }
    syncWorkspaceTab(candidate);
  }
  state.active = entry;
  return ok(undefined);
}

function importOptionsForSource(
  state: WorkspaceState,
  sourceSpaceId: string | null,
  base: ImportDocumentOptions = {},
): ImportDocumentOptions {
  const sourceEntry =
    sourceSpaceId === null
      ? null
      : (state.entries.find((entry) => entry.space.id === sourceSpaceId) ?? null);
  const runtimeOwnsSource =
    sourceSpaceId !== null && state.runtime.getSpace(sourceSpaceId) !== undefined;
  const catalog =
    base.catalog ?? (sourceEntry === null ? undefined : sourceEntry.space.getValidationCatalog());
  const options = { ...base };
  if (!runtimeOwnsSource) {
    delete (options as { sourceSpaceId?: string }).sourceSpaceId;
  }
  return {
    ...options,
    ...(runtimeOwnsSource && sourceSpaceId !== null ? { sourceSpaceId } : {}),
    ...(state.options.locale === undefined ? {} : { locale: state.options.locale }),
    ...(state.options.timezone === undefined ? {} : { timezone: state.options.timezone }),
    ...(state.options.datasetProvider === undefined
      ? {}
      : { datasetProvider: state.options.datasetProvider }),
    ...(catalog === undefined ? {} : { catalog }),
  };
}

function importIntoWorkspace(
  state: WorkspaceState,
  input: unknown,
  sourceSpaceId: string | null,
): Result<WorkspaceEntry> {
  if (state.disposed || state.runtime.disposed) {
    return fail([createDiagnostic(DIAGNOSTIC_CODES.RUNTIME_DISPOSED, "runtime")]);
  }
  const imported = state.runtime.importDocument(
    input,
    importOptionsForSource(state, sourceSpaceId),
  );
  if (!imported.ok) {
    return imported;
  }
  const mounted = mountEntry(state, imported.value.space, sourceSpaceId, true);
  if (!mounted.ok) {
    if (!imported.value.space.disposed) {
      imported.value.space.dispose();
    }
    return mounted;
  }
  const activated = activateEntry(state, imported.value.space.id);
  if (!activated.ok) {
    return activated;
  }
  mounted.value.tab.focus();
  announceWithMessages(spaceMessages(state, imported.value.space), state, "editor.import.opened");
  return mounted;
}

export function mountBoardWorkspace(
  target: HTMLElement,
  options: MountBoardWorkspaceOptions = {},
): Result<BoardWorkspaceHandle> {
  if (target === null || typeof target !== "object" || typeof target.append !== "function") {
    return fail([
      createDiagnostic(DIAGNOSTIC_CODES.INVALID_ARGUMENT, "target", {
        message: "A DOM element target is required.",
      }),
    ]);
  }
  let runtime: BoardloomRuntime;
  let ownsRuntime = false;
  if (options.runtime !== undefined) {
    runtime = options.runtime;
  } else {
    try {
      runtime = createRuntime(options.runtimeOptions);
      ownsRuntime = true;
    } catch (error) {
      return fail(diagnosticList(error, "runtime"));
    }
  }
  let space = options.space;
  const initialOwned = space === undefined;
  if (space === undefined) {
    if (options.document === undefined) {
      if (ownsRuntime) {
        runtime.dispose();
      }
      return fail([
        createDiagnostic(DIAGNOSTIC_CODES.INVALID_ARGUMENT, "document", {
          message: "A workspace requires a board document or an existing space.",
        }),
      ]);
    }
    const created = runtime.createSpace({
      document: options.document,
      ...(options.locale === undefined ? {} : { locale: options.locale }),
      ...(options.timezone === undefined ? {} : { timezone: options.timezone }),
      ...(options.datasetProvider === undefined
        ? {}
        : { datasetProvider: options.datasetProvider }),
    });
    if (!created.ok) {
      if (ownsRuntime) {
        runtime.dispose();
      }
      return created;
    }
    space = created.value;
  }
  const initialMessages = createViewMessages({
    provider: space.getMessageProvider(),
    ...(options.messages === undefined ? {} : { overrides: options.messages }),
  });
  const boardsLabel = initialMessages.text("workspace.boards");
  const importLabel = initialMessages.text("workspace.imported");
  const hostErrorMessage = initialMessages.text("workspace.hostError");
  const activateErrorMessage = initialMessages.text("workspace.activateFailed");
  const elements = createWorkspaceElements(target, boardsLabel);
  const state: WorkspaceState = {
    runtime,
    ownsRuntime,
    root: elements.root,
    tablist: elements.tablist,
    stage: elements.stage,
    live: elements.live,
    entries: [],
    options,
    importLabel,
    hostErrorMessage,
    activateErrorMessage,
    active: null,
    disposed: false,
    onEvent: options.onEvent,
  };
  const mounted = mountEntry(state, space, null, initialOwned);
  if (!mounted.ok) {
    elements.root.remove();
    if (initialOwned && !space.disposed) {
      space.dispose();
    }
    if (ownsRuntime) {
      runtime.dispose();
    }
    return mounted;
  }
  const activated = activateEntry(state, space.id);
  if (!activated.ok) {
    elements.root.remove();
    if (initialOwned && !space.disposed) {
      space.dispose();
    }
    if (ownsRuntime) {
      runtime.dispose();
    }
    return activated;
  }
  const handle: BoardWorkspaceHandle = {
    runtime,
    get element() {
      return state.root;
    },
    get activeSpace() {
      return state.active?.space ?? space;
    },
    get entries() {
      return Object.freeze([...state.entries]);
    },
    get disposed() {
      return state.disposed;
    },
    importDocument(input: unknown, importOptions: ImportDocumentOptions = {}) {
      if (state.disposed) {
        return fail([createDiagnostic(DIAGNOSTIC_CODES.RUNTIME_DISPOSED, "runtime")]);
      }
      const sourceSpaceId = importOptions.sourceSpaceId ?? state.active?.space.id ?? null;
      const imported = state.runtime.importDocument(
        input,
        importOptionsForSource(state, sourceSpaceId, importOptions),
      );
      if (!imported.ok) {
        return imported;
      }
      const entry = mountEntry(state, imported.value.space, sourceSpaceId, true);
      if (!entry.ok) {
        if (!imported.value.space.disposed) {
          imported.value.space.dispose();
        }
        return entry;
      }
      const selected = activateEntry(state, imported.value.space.id);
      if (!selected.ok) {
        return selected;
      }
      entry.value.tab.focus();
      announceWithMessages(
        spaceMessages(state, imported.value.space),
        state,
        "editor.import.opened",
      );
      return entry;
    },
    activateSpace(spaceId: string) {
      return activateEntry(state, spaceId);
    },
    getEntry(spaceId: string) {
      return state.entries.find((entry) => entry.space.id === spaceId);
    },
    exportActiveDocument() {
      const entry = state.active;
      if (entry === null) {
        return fail([createDiagnostic(DIAGNOSTIC_CODES.SPACE_NOT_FOUND, "spaceId")]);
      }
      return entry.host.exportDocument();
    },
    dispose(disposeOptions: { readonly draftDecision?: "apply" | "cancel" | "keep" } = {}) {
      if (state.disposed) {
        return ok(undefined);
      }
      for (const entry of [...state.entries]) {
        if (entry.space.disposed) {
          dropWorkspaceEntry(state, entry);
        }
      }
      if (state.entries.length === 0) {
        state.disposed = true;
        state.root.remove();
        if (ownsRuntime) {
          runtime.dispose();
        }
        return ok(undefined);
      }
      const decision = disposeOptions.draftDecision;
      const failures: Diagnostic[] = [];
      const affectedSpaceIds = new Set<string>();
      const addPartialDiagnostic = (): void => {
        if (affectedSpaceIds.size === 0) {
          return;
        }
        failures.push(
          createDiagnostic(DIAGNOSTIC_CODES.DISPOSAL_PARTIAL, "disposal", {
            relatedIds: [...affectedSpaceIds],
          }),
        );
      };
      const expectedRevisions = new Map<string, number>();
      const pendingDecisions: Array<{
        readonly entry: WorkspaceEntry;
        readonly lease: EditorLease;
        readonly resolution: "apply" | "cancel";
      }> = [];
      for (const entry of state.entries) {
        const snapshot = entry.space.getSnapshot();
        expectedRevisions.set(entry.space.id, snapshot.committedRevision);
        const draft = snapshot.draft;
        if (draft === null || !draft.dirty) {
          if (snapshot.editorLease !== null) {
            pendingDecisions.push({
              entry,
              lease: snapshot.editorLease,
              resolution: "cancel",
            });
          }
          continue;
        }
        if (decision === undefined) {
          failures.push(
            createDiagnostic(DIAGNOSTIC_CODES.DRAFT_REQUIRES_DECISION, `spaces/${entry.space.id}`),
          );
          continue;
        }
        if (decision === "keep") {
          if (entry.owned) {
            failures.push(
              createDiagnostic(
                DIAGNOSTIC_CODES.DRAFT_REQUIRES_DECISION,
                `spaces/${entry.space.id}`,
                {
                  message:
                    "A workspace-owned space cannot be disposed while keeping a dirty draft.",
                },
              ),
            );
          }
          continue;
        }
        if (snapshot.editorLease === null) {
          failures.push(
            createDiagnostic(DIAGNOSTIC_CODES.EDITOR_LEASE_REQUIRED, `spaces/${entry.space.id}`),
          );
          continue;
        }
        if (decision === "apply") {
          if (draft.baseRevision !== snapshot.committedRevision) {
            failures.push(
              createDiagnostic(DIAGNOSTIC_CODES.REVISION_CONFLICT, `spaces/${entry.space.id}`),
            );
            continue;
          }
          const catalog = entry.space.getValidationCatalog();
          const validation = validateBoardDocument(
            draft.document,
            catalog === undefined ? {} : { catalog },
          );
          const validationErrors = validation.diagnostics.filter(
            (diagnostic) => diagnostic.severity === "error",
          );
          if (validationErrors.length > 0) {
            failures.push(
              createDiagnostic(DIAGNOSTIC_CODES.DRAFT_INVALID, `spaces/${entry.space.id}/draft`),
              ...validationErrors,
            );
            continue;
          }
          const filterDiagnostics = validateFilterRuntimeState(
            draft.document as unknown as BoardDocumentV1,
            snapshot.filterState,
            catalog,
          );
          const filterErrors = filterDiagnostics.filter(
            (diagnostic) => diagnostic.severity === "error",
          );
          if (filterErrors.length > 0) {
            failures.push(
              createDiagnostic(DIAGNOSTIC_CODES.DRAFT_INVALID, `spaces/${entry.space.id}/filters`),
              ...filterErrors,
            );
            continue;
          }
          expectedRevisions.set(entry.space.id, snapshot.committedRevision + 1);
        }
        pendingDecisions.push({
          entry,
          lease: snapshot.editorLease,
          resolution: decision === "apply" ? "apply" : "cancel",
        });
      }
      if (failures.length > 0) {
        return fail(failures);
      }
      const batches = new Map<string, EventBatchHandle>();
      for (const entry of state.entries) {
        batches.set(entry.space.id, entry.space.beginEventBatch());
      }
      const flushBatches = (): void => {
        for (const batch of batches.values()) {
          batch.flush();
        }
      };
      for (const pending of pendingDecisions) {
        const released = pending.entry.space.releaseEditorLease(pending.lease, {
          decision: pending.resolution,
        });
        if (!released.ok) {
          failures.push(...released.diagnostics);
          break;
        }
        affectedSpaceIds.add(pending.entry.space.id);
      }
      if (failures.length > 0) {
        addPartialDiagnostic();
        flushBatches();
        return fail(failures);
      }
      for (const entry of state.entries) {
        const snapshot = entry.space.getSnapshot();
        if (entry.space.disposed) {
          failures.push(
            createDiagnostic(DIAGNOSTIC_CODES.SPACE_DISPOSED, `spaces/${entry.space.id}`),
          );
          continue;
        }
        if (snapshot.committedRevision !== expectedRevisions.get(entry.space.id)) {
          failures.push(
            createDiagnostic(DIAGNOSTIC_CODES.REVISION_CONFLICT, `spaces/${entry.space.id}`),
          );
          continue;
        }
        if (snapshot.draft?.dirty === true && (decision !== "keep" || entry.owned)) {
          failures.push(
            createDiagnostic(DIAGNOSTIC_CODES.DRAFT_REQUIRES_DECISION, `spaces/${entry.space.id}`),
          );
          continue;
        }
        if (snapshot.editorLease !== null && (decision !== "keep" || entry.owned)) {
          failures.push(
            createDiagnostic(DIAGNOSTIC_CODES.DRAFT_REQUIRES_DECISION, `spaces/${entry.space.id}`),
          );
        }
      }
      if (failures.length > 0) {
        addPartialDiagnostic();
        flushBatches();
        return fail(failures);
      }
      for (const entry of state.entries) {
        if (!entry.owned) {
          continue;
        }
        const disposed = entry.host.dispose({ draftDecision: "keep" });
        if (!disposed.ok) {
          failures.push(...disposed.diagnostics);
        } else {
          affectedSpaceIds.add(entry.space.id);
        }
      }
      if (failures.length > 0) {
        addPartialDiagnostic();
        flushBatches();
        return fail(failures);
      }
      for (const entry of state.entries) {
        if (entry.owned && !entry.space.disposed) {
          const disposed = entry.space.dispose();
          if (!disposed.ok) {
            failures.push(...disposed.diagnostics);
          } else {
            affectedSpaceIds.add(entry.space.id);
          }
        }
      }
      if (failures.length > 0) {
        addPartialDiagnostic();
        flushBatches();
        return fail(failures);
      }
      for (const entry of state.entries) {
        if (!entry.owned) {
          batches.get(entry.space.id)?.flush();
        }
      }
      for (const entry of state.entries) {
        if (entry.owned) {
          batches.get(entry.space.id)?.discard();
          continue;
        }
        const disposed = entry.host.dispose({ draftDecision: "keep" });
        if (!disposed.ok) {
          failures.push(...disposed.diagnostics);
        } else {
          affectedSpaceIds.add(entry.space.id);
        }
      }
      if (failures.length > 0) {
        addPartialDiagnostic();
        return fail(failures);
      }
      state.disposed = true;
      state.entries.length = 0;
      state.root.remove();
      if (ownsRuntime) {
        runtime.dispose();
      }
      return ok(undefined);
    },
  };
  return ok(handle);
}
