// @vitest-environment happy-dom
import "@angular/compiler";
import { provideZonelessChangeDetection } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { BrowserTestingModule, platformBrowserTesting } from "@angular/platform-browser/testing";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ENGLISH_MESSAGES, createRuntime, type SpaceEvent } from "@boardloom/core";
import {
  REFERENCE_PLUGIN,
  type BlockTypeDefinition,
  type BoardViewHandle,
} from "@boardloom/view-dom";
import {
  BoardloomViewComponent,
  type BoardloomAdapterError,
  type BoardloomModeChange,
  type BoardloomViewReadyInfo,
} from "../../../../packages/angular/src/index.js";
import { angularExampleDocument, angularExampleProvider } from "../support/fixture.js";

beforeAll(() => {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
});

beforeEach(() => {
  TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
});

afterEach(() => {
  TestBed.resetTestingModule();
  document.body.replaceChildren();
});

interface Rendered {
  readonly fixture: ReturnType<typeof TestBed.createComponent<BoardloomViewComponent>>;
  readonly component: BoardloomViewComponent;
  readonly events: SpaceEvent[];
  readonly errors: BoardloomAdapterError[];
  readonly ready: BoardloomViewReadyInfo[];
  readonly modeChanges: BoardloomModeChange[];
  readonly disposed: BoardloomViewReadyInfo[];
  set(inputs: Record<string, unknown>): void;
  detect(): Promise<void>;
  destroy(): void;
}

async function createBoard(initial: Record<string, unknown>): Promise<Rendered> {
  const fixture = TestBed.createComponent(BoardloomViewComponent);
  const component = fixture.componentInstance;
  const events: SpaceEvent[] = [];
  const errors: BoardloomAdapterError[] = [];
  const ready: BoardloomViewReadyInfo[] = [];
  const modeChanges: BoardloomModeChange[] = [];
  const disposed: BoardloomViewReadyInfo[] = [];
  component.event.subscribe((event) => events.push(event));
  component.adapterError.subscribe((error) => errors.push(error));
  component.ready.subscribe((info) => ready.push(info));
  component.modeChange.subscribe((change) => modeChanges.push(change));
  component.disposed.subscribe((info) => disposed.push(info));
  const rendered: Rendered = {
    fixture,
    component,
    events,
    errors,
    ready,
    modeChanges,
    disposed,
    set(inputs) {
      for (const [key, value] of Object.entries(inputs)) {
        fixture.componentRef.setInput(key, value);
      }
    },
    async detect() {
      fixture.detectChanges();
      await Promise.resolve();
    },
    destroy() {
      fixture.destroy();
    },
  };
  rendered.set(initial);
  await rendered.detect();
  return rendered;
}

async function settle(milliseconds = 50): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function host(rendered: Rendered): HTMLElement {
  return rendered.fixture.nativeElement as HTMLElement;
}

function viewerRoot(element: HTMLElement): HTMLElement {
  const root = element.querySelector<HTMLElement>(".boardloom");
  if (root === null) {
    throw new Error("viewer root was not mounted");
  }
  return root;
}

function instanceId(rendered: Rendered): string | null {
  return viewerRoot(host(rendered)).getAttribute("data-boardloom-instance");
}

function modeButton(rendered: Rendered, mode: "viewer" | "editor"): HTMLButtonElement | null {
  return host(rendered).querySelector<HTMLButtonElement>(`button[data-mode="${mode}"]`);
}

function makeDirtyDraft(component: BoardloomViewComponent): BoardViewHandle {
  const handle = component.handle;
  if (handle === null) {
    throw new Error("the board is not mounted");
  }
  const lease = handle.space.acquireEditorLease({ sessionId: "angular-adapter-test" });
  if (!lease.ok) {
    throw new Error("editor lease was rejected");
  }
  const editor = handle.setMode("editor", { lease: lease.value });
  if (!editor.ok) {
    throw new Error("editor mode was rejected");
  }
  const committed = handle.space.getSnapshot().committedDocument;
  const update = handle.view.commands.updateDraft({
    ...committed,
    title: `${committed.title} draft`,
    updatedAt: 1_700_000_001_000,
  });
  if (!update.ok) {
    throw new Error("draft update was rejected");
  }
  return handle;
}

function churnedDefinitions() {
  const block = REFERENCE_PLUGIN.blockTypes[0];
  const renderer = REFERENCE_PLUGIN.renderers[0];
  if (block === undefined || renderer === undefined) {
    throw new Error("reference plugin definitions are missing");
  }
  return {
    blockTypes: [
      {
        ...block,
        createSurface: (environment: Parameters<typeof block.createSurface>[0]) =>
          block.createSurface(environment),
      },
    ],
    renderers: [
      {
        ...renderer,
        validate: (spec: Parameters<typeof renderer.validate>[0]) => renderer.validate(spec),
        mount: (input: Parameters<typeof renderer.mount>[0]) => renderer.mount(input),
      },
    ],
  };
}

function inlineBlockType(marker: string): BlockTypeDefinition {
  return {
    type: "angular.test-inline",
    version: "1.0.0",
    createSurface(environment) {
      const element = environment.dom.createElement("div");
      element.className = "test-inline-surface";
      element.textContent = marker;
      return {
        element,
        update() {
          element.textContent = marker;
        },
      };
    },
  };
}

function inlineBlockDocument() {
  const document = angularExampleDocument();
  const placement = { blockId: "inline-surface", x: 0, y: 12, width: 4, height: 2 };
  const desktop = document.layout.desktop;
  const tablet = document.layout.tablet ?? desktop;
  const narrow = document.layout.narrow ?? desktop;
  return {
    ...document,
    blocks: [
      ...document.blocks,
      {
        id: "inline-surface",
        type: "angular.test-inline",
        title: "Inline surface",
        bindings: [],
        config: {},
      },
    ],
    layout: {
      desktop: { ...desktop, placements: [...desktop.placements, placement] },
      tablet: { ...tablet, placements: [...tablet.placements, placement] },
      narrow: { ...narrow, placements: [...narrow.placements, placement] },
    },
  };
}

describe("T15 Angular adapter", () => {
  it("mounts the shared DOM runtime and forwards initial locale and timezone", async () => {
    const board = await createBoard({
      document: angularExampleDocument(),
      datasetProvider: angularExampleProvider(),
      locale: "de",
      timezone: "Europe/Berlin",
      className: "host-board",
    });
    const root = viewerRoot(host(board));
    expect(root.getAttribute("data-boardloom-locale")).toBe("de");
    expect(root.getAttribute("data-boardloom-timezone")).toBe("Europe/Berlin");
    expect(host(board).querySelectorAll(".boardloom")).toHaveLength(1);
    expect(host(board).getAttribute("data-boardloom-angular")).toBe("");
    expect(host(board).classList.contains("host-board")).toBe(true);
    expect(board.ready).toHaveLength(1);
    expect(board.component.isMounted).toBe(true);
    expect(modeButton(board, "viewer")?.textContent).toBe("Viewer");
    const handle = board.component.handle;
    board.destroy();
    expect(host(board).querySelectorAll(".boardloom")).toHaveLength(0);
    expect(handle?.disposed).toBe(true);
    expect(board.disposed).toHaveLength(1);
    expect(board.component.handle).toBeNull();
  });

  it("updates locale, timezone and host messages without recreating the board", async () => {
    const board = await createBoard({
      document: angularExampleDocument(),
      datasetProvider: angularExampleProvider(),
      locale: "en",
      timezone: "UTC",
    });
    await settle();
    const instance = instanceId(board);
    const filterChip = host(board).querySelector(".bl-filter-chip")?.textContent ?? "";
    const rows = host(board).querySelectorAll(".bl-table tbody tr").length;
    board.set({
      locale: "ja",
      timezone: "Asia/Tokyo",
      messages: { "mode.viewer": "Reader", "mode.editor": "Author" },
    });
    await board.detect();
    await settle();
    const root = viewerRoot(host(board));
    expect(root.getAttribute("data-boardloom-instance")).toBe(instance);
    expect(root.getAttribute("data-boardloom-locale")).toBe("ja");
    expect(root.getAttribute("data-boardloom-timezone")).toBe("Asia/Tokyo");
    expect(modeButton(board, "viewer")?.textContent).toBe("Reader");
    expect(modeButton(board, "editor")?.textContent).toBe("Author");
    expect(host(board).querySelector(".bl-filter-chip")?.textContent ?? "").toBe(filterChip);
    expect(host(board).querySelectorAll(".bl-table tbody tr").length).toBe(rows);
    expect(board.events.some((event) => event.type === "locale:changed")).toBe(true);
    expect(board.ready).toHaveLength(1);
    board.set({ messages: undefined });
    await board.detect();
    expect(modeButton(board, "viewer")?.textContent).toBe(ENGLISH_MESSAGES["mode.viewer"]);
    expect(instanceId(board)).toBe(instance);
    board.destroy();
  });

  it("switches mode through inputs without remounting and emits the mode output", async () => {
    const board = await createBoard({
      document: angularExampleDocument(),
      datasetProvider: angularExampleProvider(),
    });
    const instance = instanceId(board);
    const handle = board.component.handle;
    if (handle === null) {
      throw new Error("the board is not mounted");
    }
    const lease = handle.space.acquireEditorLease({ sessionId: "angular-mode-input" });
    expect(lease.ok).toBe(true);
    if (!lease.ok) {
      return;
    }
    board.set({ mode: "editor", lease: lease.value });
    await board.detect();
    expect(instanceId(board)).toBe(instance);
    expect(viewerRoot(host(board)).getAttribute("data-boardloom-mode")).toBe("editor");
    expect(board.modeChanges.at(-1)?.mode).toBe("editor");
    board.set({ mode: "viewer" });
    await board.detect();
    expect(instanceId(board)).toBe(instance);
    expect(viewerRoot(host(board)).getAttribute("data-boardloom-mode")).toBe("viewer");
    expect(board.modeChanges.at(-1)?.mode).toBe("viewer");
    board.destroy();
  });

  it("preserves a dirty draft, undo and editor mode across locale and timezone updates", async () => {
    const board = await createBoard({
      document: angularExampleDocument(),
      datasetProvider: angularExampleProvider(),
    });
    const handle = makeDirtyDraft(board.component);
    const space = handle.space;
    const instance = instanceId(board);
    const before = space.getSnapshot().draft;
    board.set({ locale: "fr", timezone: "Europe/Paris", draftDecision: "cancel" as const });
    await board.detect();
    const after = space.getSnapshot().draft;
    expect(instanceId(board)).toBe(instance);
    expect(viewerRoot(host(board)).getAttribute("data-boardloom-locale")).toBe("fr");
    expect(viewerRoot(host(board)).getAttribute("data-boardloom-timezone")).toBe("Europe/Paris");
    expect(handle.view.mode).toBe("editor");
    expect(after?.dirty).toBe(true);
    expect(after?.revision).toBe(before?.revision);
    expect(after?.canUndo).toBe(true);
    expect(after?.document.title).toContain("draft");
    board.destroy();
    expect(space.disposed).toBe(true);
  });

  it("does not remount for equal plain-data mount inputs", async () => {
    const provider = angularExampleProvider();
    const board = await createBoard({
      document: angularExampleDocument(),
      datasetProvider: provider,
      runtimeOptions: {},
    });
    const instance = instanceId(board);
    const handle = board.component.handle;
    board.set({ document: angularExampleDocument(), runtimeOptions: {} });
    await board.detect();
    board.set({ document: angularExampleDocument(), runtimeOptions: {} });
    await board.detect();
    expect(instanceId(board)).toBe(instance);
    expect(host(board).querySelectorAll(".boardloom")).toHaveLength(1);
    expect(board.component.handle).toBe(handle);
    expect(board.ready).toHaveLength(1);
    board.destroy();
  });

  it("recovers an update failure when the invalid presentation input is corrected", async () => {
    const board = await createBoard({
      document: angularExampleDocument(),
      datasetProvider: angularExampleProvider(),
      locale: "en",
      theme: "light",
    });
    board.set({ locale: "de", theme: "neon" });
    await board.detect();
    expect(viewerRoot(host(board)).getAttribute("data-boardloom-locale")).toBe("en");
    expect(viewerRoot(host(board)).getAttribute("data-boardloom-theme")).toBe("light");
    expect(board.errors.filter((error) => error.phase === "update")).toHaveLength(1);
    board.set({ locale: "de", theme: "dark" });
    await board.detect();
    expect(viewerRoot(host(board)).getAttribute("data-boardloom-locale")).toBe("de");
    expect(viewerRoot(host(board)).getAttribute("data-boardloom-theme")).toBe("dark");
    expect(board.errors.filter((error) => error.phase === "update")).toHaveLength(1);
    board.destroy();
  });

  it("retains an adapter-owned dirty draft and supports resolution", async () => {
    const board = await createBoard({
      document: angularExampleDocument(),
      datasetProvider: angularExampleProvider(),
    });
    const handle = makeDirtyDraft(board.component);
    const space = handle.space;
    board.destroy();
    expect(board.errors).toHaveLength(1);
    expect(board.errors[0]?.phase).toBe("dispose");
    expect(board.errors[0]?.diagnostics[0]?.code).toBe("DRAFT_REQUIRES_DECISION");
    const retained = board.errors[0]?.retained;
    expect(retained?.handle.disposed).toBe(false);
    expect(space.disposed).toBe(false);
    expect(host(board).querySelectorAll(".boardloom")).toHaveLength(0);
    const resolved = retained?.handle.dispose({ draftDecision: "cancel" });
    expect(resolved?.ok).toBe(true);
    expect(retained?.handle.disposed).toBe(true);
    expect(space.disposed).toBe(true);
  });

  it("applies a dirty owned draft when draftDecision is apply", async () => {
    const board = await createBoard({
      document: angularExampleDocument(),
      datasetProvider: angularExampleProvider(),
    });
    const handle = makeDirtyDraft(board.component);
    const space = handle.space;
    board.set({ draftDecision: "apply" as const });
    await board.detect();
    board.destroy();
    expect(space.disposed).toBe(true);
    expect(space.getSnapshot().committedDocument.title).toContain("draft");
  });

  it("disposes only owned spaces and leaves host spaces alive", async () => {
    const runtime = createRuntime({ datasetProvider: angularExampleProvider() });
    const created = runtime.createSpace({ document: angularExampleDocument() });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    const space = created.value;
    const board = await createBoard({ space });
    expect(host(board).querySelectorAll(".boardloom")).toHaveLength(1);
    board.destroy();
    expect(space.disposed).toBe(false);
    expect(space.getSnapshot().viewCount).toBe(0);
    expect(runtime.disposed).toBe(false);
    space.dispose();
    runtime.dispose();
  });

  it("reports mount failures without leaving a partial viewer", async () => {
    const board = await createBoard({});
    expect(board.errors.map((error) => error.phase)).toEqual(["mount"]);
    expect(host(board).querySelectorAll(".boardloom")).toHaveLength(0);
    board.destroy();
  });

  it("keeps one session while applying presentation inputs during function churn", async () => {
    const document = angularExampleDocument();
    const provider = angularExampleProvider();
    const board = await createBoard({
      document,
      datasetProvider: provider,
      locale: "en",
      timezone: "UTC",
      ...churnedDefinitions(),
    });
    const instance = instanceId(board);
    board.set({
      ...churnedDefinitions(),
      locale: "de",
      timezone: "Europe/Berlin",
      messages: { "mode.viewer": "Reader", "mode.editor": "Author" },
    });
    await board.detect();
    expect(instanceId(board)).toBe(instance);
    expect(viewerRoot(host(board)).getAttribute("data-boardloom-locale")).toBe("de");
    expect(viewerRoot(host(board)).getAttribute("data-boardloom-timezone")).toBe("Europe/Berlin");
    expect(modeButton(board, "viewer")?.textContent).toBe("Reader");
    expect(host(board).querySelectorAll(".boardloom")).toHaveLength(1);
    expect(board.errors).toHaveLength(1);
    expect(board.errors[0]?.phase).toBe("input");
    expect(board.errors[0]?.diagnostics[0]?.path).toBe("mountInputs");
    expect(board.errors[0]?.retained).toBeUndefined();
    board.destroy();
  });

  it("ignores later function-only swaps until a structural remount", async () => {
    const document = inlineBlockDocument();
    const provider = angularExampleProvider();
    const board = await createBoard({
      document,
      datasetProvider: provider,
      blockTypes: [inlineBlockType("first")],
    });
    const instance = instanceId(board);
    const surface = host(board).querySelector(".test-inline-surface");
    expect(surface?.textContent).toBe("first");
    board.set({ blockTypes: [inlineBlockType("second")] });
    await board.detect();
    expect(instanceId(board)).toBe(instance);
    expect(host(board).querySelector(".test-inline-surface")?.textContent).toBe("first");
    expect(board.errors).toHaveLength(1);
    expect(board.errors[0]?.phase).toBe("input");
    board.set({ blockTypes: [inlineBlockType("third")] });
    await board.detect();
    expect(instanceId(board)).toBe(instance);
    expect(host(board).querySelector(".test-inline-surface")?.textContent).toBe("first");
    expect(board.errors).toHaveLength(1);
    expect(host(board).querySelectorAll(".boardloom")).toHaveLength(1);
    board.destroy();
  });

  it("exposes the imperative handle for focus, export, modes and explicit disposal", async () => {
    const board = await createBoard({
      document: angularExampleDocument(),
      datasetProvider: angularExampleProvider(),
    });
    const component = board.component;
    expect(component.focus("content").ok).toBe(true);
    const exported = component.exportDocument();
    expect(exported.ok).toBe(true);
    if (exported.ok) {
      expect(exported.value.document.id).toBe("angular-example-board");
    }
    const handle = component.handle;
    if (handle === null) {
      throw new Error("the board is not mounted");
    }
    const lease = handle.space.acquireEditorLease({ sessionId: "angular-unit" });
    expect(lease.ok).toBe(true);
    if (!lease.ok) {
      return;
    }
    expect(component.setMode("editor", { lease: lease.value }).ok).toBe(true);
    expect(component.boardView.mode).toBe("editor");
    expect(component.boardSpace.id).toBe(handle.space.id);
    expect(component.boardElement).toBe(handle.element);
    expect(component.setMode("viewer").ok).toBe(true);
    expect(component.unmount({ draftDecision: "cancel" }).ok).toBe(true);
    expect(handle.disposed).toBe(true);
    expect(component.handle).toBeNull();
    expect(component.isMounted).toBe(false);
    expect(component.isDisposed).toBe(true);
    expect(() => component.boardSpace).toThrow();
    expect(component.unmount().ok).toBe(true);
    expect(board.disposed).toHaveLength(1);
    board.set({ locale: "fr" });
    await board.detect();
    expect(board.ready).toHaveLength(1);
    expect(host(board).querySelectorAll(".boardloom")).toHaveLength(0);
    expect(component.handle).toBeNull();
    expect(board.disposed).toHaveLength(1);
    board.destroy();
    expect(board.disposed).toHaveLength(1);
  });

  it("treats direct disposal of the exposed handle as a terminal session end", async () => {
    const board = await createBoard({
      document: angularExampleDocument(),
      datasetProvider: angularExampleProvider(),
    });
    const handle = board.component.handle;
    if (handle === null) {
      throw new Error("the board is not mounted");
    }
    expect(handle.dispose({ draftDecision: "cancel" }).ok).toBe(true);
    expect(handle.disposed).toBe(true);
    expect(board.component.handle).toBeNull();
    expect(board.component.isMounted).toBe(false);
    expect(board.component.isDisposed).toBe(true);
    expect(() => board.component.boardSpace).toThrow();
    expect(board.disposed).toHaveLength(1);
    board.set({ locale: "fr" });
    await board.detect();
    expect(board.disposed).toHaveLength(1);
    expect(board.ready).toHaveLength(1);
    expect(host(board).querySelectorAll(".boardloom")).toHaveLength(0);
    board.destroy();
    expect(board.disposed).toHaveLength(1);
  });

  it("ends the session when a host-owned space is disposed", async () => {
    const runtime = createRuntime({ datasetProvider: angularExampleProvider() });
    const created = runtime.createSpace({ document: angularExampleDocument() });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    const space = created.value;
    const board = await createBoard({ space });
    const handle = board.component.handle;
    if (handle === null) {
      throw new Error("the board is not mounted");
    }
    space.dispose();
    expect(board.disposed).toHaveLength(1);
    expect(handle.disposed).toBe(true);
    expect(board.component.handle).toBeNull();
    expect(host(board).querySelectorAll(".boardloom")).toHaveLength(0);
    board.set({ locale: "de" });
    await board.detect();
    expect(host(board).querySelectorAll(".boardloom")).toHaveLength(0);
    expect(board.disposed).toHaveLength(1);
    board.destroy();
    expect(board.disposed).toHaveLength(1);
    runtime.dispose();
  });

  it("ignores events and disposal from a retained session's space", async () => {
    const provider = angularExampleProvider();
    const board = await createBoard({
      document: angularExampleDocument(),
      datasetProvider: provider,
    });
    const first = makeDirtyDraft(board.component);
    const firstSpace = first.space;
    const firstInstance = instanceId(board);
    board.set({ document: angularExampleDocument("angular-example-board-variant") });
    await board.detect();
    const retained = board.errors.at(-1)?.retained;
    expect(retained).toBeDefined();
    expect(board.errors.at(-1)?.phase).toBe("dispose");
    const liveHandle = board.component.handle;
    if (liveHandle === null) {
      throw new Error("the live session was not mounted");
    }
    const liveInstance = instanceId(board);
    expect(liveInstance).not.toBe(firstInstance);
    const retainedSpaceId = firstSpace.id;
    const retainedEvents = board.events.filter((event) => event.spaceId === retainedSpaceId).length;
    firstSpace.setLocale({ locale: "de" });
    await settle();
    expect(board.events.filter((event) => event.spaceId === retainedSpaceId)).toHaveLength(
      retainedEvents,
    );
    firstSpace.dispose();
    expect(board.disposed).toHaveLength(0);
    expect(board.component.handle).toBe(liveHandle);
    expect(host(board).querySelectorAll(".boardloom")).toHaveLength(1);
    expect(instanceId(board)).toBe(liveInstance);
    board.set({ locale: "fr" });
    await board.detect();
    expect(viewerRoot(host(board)).getAttribute("data-boardloom-locale")).toBe("fr");
    expect(board.disposed).toHaveLength(0);
    board.destroy();
    expect(board.disposed).toHaveLength(1);
  });

  it("emits disposal after adapter-initiated teardown completes", async () => {
    const board = await createBoard({
      document: angularExampleDocument(),
      datasetProvider: angularExampleProvider(),
    });
    let rootsAtDispose = -1;
    board.component.disposed.subscribe(() => {
      rootsAtDispose = host(board).querySelectorAll(".boardloom").length;
    });
    expect(board.component.unmount({ draftDecision: "cancel" }).ok).toBe(true);
    expect(rootsAtDispose).toBe(0);
  });

  it("keeps imperative dispose idempotent after the session ends", async () => {
    const board = await createBoard({
      document: angularExampleDocument(),
      datasetProvider: angularExampleProvider(),
    });
    expect(board.component.dispose({ draftDecision: "cancel" }).ok).toBe(true);
    expect(board.disposed).toHaveLength(1);
    expect(board.component.dispose().ok).toBe(true);
    expect(board.component.dispose({ draftDecision: "cancel" }).ok).toBe(true);
    expect(board.disposed).toHaveLength(1);
    board.set({ locale: "de" });
    await board.detect();
    expect(host(board).querySelectorAll(".boardloom")).toHaveLength(0);
    expect(board.disposed).toHaveLength(1);
    board.destroy();
    expect(board.disposed).toHaveLength(1);
  });

  it("keeps a dirty owned session when imperative unmount has no decision", async () => {
    const board = await createBoard({
      document: angularExampleDocument(),
      datasetProvider: angularExampleProvider(),
    });
    const handle = makeDirtyDraft(board.component);
    expect(board.component.unmount().ok).toBe(false);
    expect(board.component.handle).toBe(handle);
    expect(board.disposed).toHaveLength(0);
    expect(handle.space.disposed).toBe(false);
    expect(board.component.unmount({ draftDecision: "cancel" }).ok).toBe(true);
    expect(board.component.handle).toBeNull();
    expect(board.disposed).toHaveLength(1);
    expect(handle.disposed).toBe(true);
    expect(handle.space.disposed).toBe(true);
    board.destroy();
    expect(board.disposed).toHaveLength(1);
  });

  it("keeps a host-owned editor lease and dirty draft on clean unmount by default", async () => {
    const runtime = createRuntime({ datasetProvider: angularExampleProvider() });
    const created = runtime.createSpace({ document: angularExampleDocument() });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    const space = created.value;
    const board = await createBoard({ space });
    makeDirtyDraft(board.component);
    const lease = space.getSnapshot().editorLease;
    board.destroy();
    expect(board.errors).toHaveLength(0);
    expect(space.disposed).toBe(false);
    const snapshot = space.getSnapshot();
    expect(snapshot.draft?.dirty).toBe(true);
    expect(snapshot.editorLease?.leaseId).toBe(lease?.leaseId);
    expect(snapshot.viewCount).toBe(0);
    if (lease !== null) {
      space.releaseEditorLease(lease, { decision: "cancel" });
    }
    space.dispose();
    runtime.dispose();
  });
});
