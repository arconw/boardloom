// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { ENGLISH_MESSAGES, type SpaceEvent } from "@boardloom/core";
import type { BoardViewHandle } from "@boardloom/view-dom";
import {
  BoardloomSession,
  type BoardloomSessionCallbacks,
} from "../../../../packages/svelte/src/session.js";
import type {
  BoardloomAdapterError,
  BoardloomRetainedSession,
  BoardloomViewProps,
  BoardloomViewReadyInfo,
} from "../../../../packages/svelte/src/types.js";
import {
  createViewerProvider,
  createViewerRuntime,
  viewerFixtureDocument,
} from "../../view-dom/support/fixture.js";

interface Harness {
  readonly container: HTMLDivElement;
  readonly session: BoardloomSession;
  readonly events: SpaceEvent[];
  readonly errors: BoardloomAdapterError[];
  readonly ready: BoardloomViewReadyInfo[];
  readonly disposed: BoardloomViewReadyInfo[];
  readonly modeChanges: string[];
  readonly handles: Array<BoardViewHandle | null>;
  readonly retained: BoardloomRetainedSession[];
  sync(props: BoardloomViewProps): void;
}

function createHarness(
  decision: () => "apply" | "cancel" | "keep" | undefined = () => undefined,
): Harness {
  const container = document.createElement("div");
  document.body.append(container);
  const events: SpaceEvent[] = [];
  const errors: BoardloomAdapterError[] = [];
  const ready: BoardloomViewReadyInfo[] = [];
  const disposed: BoardloomViewReadyInfo[] = [];
  const modeChanges: string[] = [];
  const handles: Array<BoardViewHandle | null> = [];
  const callbacks: BoardloomSessionCallbacks = {
    onEvent: (event) => events.push(event),
    onModeChange: (mode) => modeChanges.push(mode),
    onExport: () => void 0,
    onReady: (info) => ready.push(info),
    onDispose: (info) => disposed.push(info),
    onError: (error) => errors.push(error),
    onHandle: (handle) => handles.push(handle),
    draftDecision: decision,
  };
  const session = new BoardloomSession(callbacks);
  const harness: Harness = {
    container,
    session,
    events,
    errors,
    ready,
    disposed,
    modeChanges,
    handles,
    get retained() {
      return errors
        .map((error) => error.retained)
        .filter((entry): entry is BoardloomRetainedSession => entry !== undefined);
    },
    sync(props) {
      session.sync(props, container);
    },
  };
  return harness;
}

function viewerRoot(container: HTMLElement): HTMLElement {
  const root = container.querySelector<HTMLElement>(".boardloom");
  if (root === null) {
    throw new Error("the viewer root was not mounted");
  }
  return root;
}

function instanceOf(container: HTMLElement): string | null {
  return viewerRoot(container).getAttribute("data-boardloom-instance");
}

function modeButton(container: HTMLElement, mode: "viewer" | "editor"): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(`button[data-mode="${mode}"]`);
  if (button === null) {
    throw new Error(`mode button ${mode} was not rendered`);
  }
  return button;
}

async function settle(milliseconds = 40): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function makeDirtyDraft(handle: BoardViewHandle): void {
  const lease = handle.space.acquireEditorLease({ sessionId: "svelte-session-test" });
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
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("T16 Svelte session", () => {
  it("mounts the shared DOM runtime once and forwards locale and timezone", async () => {
    const harness = createHarness();
    const boardDocument = viewerFixtureDocument();
    const provider = createViewerProvider();
    harness.sync({
      document: boardDocument,
      datasetProvider: provider,
      locale: "de",
      timezone: "Europe/Berlin",
    });
    await settle();
    expect(harness.container.querySelectorAll(".boardloom")).toHaveLength(1);
    expect(viewerRoot(harness.container).getAttribute("data-boardloom-locale")).toBe("de");
    expect(viewerRoot(harness.container).getAttribute("data-boardloom-timezone")).toBe(
      "Europe/Berlin",
    );
    expect(modeButton(harness.container, "viewer").textContent).toBe("Viewer");
    expect(harness.ready).toHaveLength(1);
    expect(harness.session.handle).not.toBeNull();
    harness.sync({
      document: boardDocument,
      datasetProvider: provider,
      locale: "de",
      timezone: "Europe/Berlin",
    });
    harness.sync({
      document: boardDocument,
      datasetProvider: provider,
      locale: "de",
      timezone: "Europe/Berlin",
    });
    expect(harness.container.querySelectorAll(".boardloom")).toHaveLength(1);
    expect(harness.ready).toHaveLength(1);
    expect(harness.handles.filter((handle) => handle !== null)).toHaveLength(1);
    harness.session.dispose();
    expect(harness.container.querySelectorAll(".boardloom")).toHaveLength(0);
    expect(harness.disposed).toHaveLength(1);
    expect(harness.session.handle).toBeNull();
  });

  it("updates presentation props without destroying state", async () => {
    const harness = createHarness();
    const boardDocument = viewerFixtureDocument();
    const provider = createViewerProvider();
    harness.sync({
      document: boardDocument,
      datasetProvider: provider,
      locale: "en",
      timezone: "UTC",
    });
    await settle();
    const instance = instanceOf(harness.container);
    const chip = harness.container.querySelector(".bl-filter-chip")?.textContent ?? "";
    const rows = harness.container.querySelectorAll(".bl-table tbody tr").length;
    expect(chip).toContain("north, south");
    expect(rows).toBeGreaterThan(0);
    harness.sync({
      document: boardDocument,
      datasetProvider: provider,
      locale: "ja",
      timezone: "Asia/Tokyo",
      messages: { "mode.viewer": "Reader", "mode.editor": "Author" },
    });
    await settle();
    expect(instanceOf(harness.container)).toBe(instance);
    expect(viewerRoot(harness.container).getAttribute("data-boardloom-locale")).toBe("ja");
    expect(viewerRoot(harness.container).getAttribute("data-boardloom-timezone")).toBe(
      "Asia/Tokyo",
    );
    expect(modeButton(harness.container, "viewer").textContent).toBe("Reader");
    expect(modeButton(harness.container, "editor").textContent).toBe("Author");
    expect(harness.container.querySelector(".bl-filter-chip")?.textContent ?? "").toBe(chip);
    expect(harness.container.querySelectorAll(".bl-table tbody tr").length).toBe(rows);
    expect(harness.events.some((event) => event.type === "locale:changed")).toBe(true);
    harness.sync({
      document: boardDocument,
      datasetProvider: provider,
      locale: "ja",
      timezone: "Asia/Tokyo",
    });
    await settle();
    expect(instanceOf(harness.container)).toBe(instance);
    expect(modeButton(harness.container, "viewer").textContent).toBe(
      ENGLISH_MESSAGES["mode.viewer"],
    );
    expect(harness.session.handle).not.toBeNull();
    harness.session.dispose();
  });

  it("applies mode and lease updates without recreating the board", async () => {
    const harness = createHarness();
    const boardDocument = viewerFixtureDocument();
    const provider = createViewerProvider();
    harness.sync({ document: boardDocument, datasetProvider: provider });
    await settle();
    const handle = harness.session.handle;
    if (handle === null) {
      throw new Error("the board was not mounted");
    }
    const instance = instanceOf(harness.container);
    const lease = handle.space.acquireEditorLease({ sessionId: "svelte-mode-prop" });
    expect(lease.ok).toBe(true);
    if (!lease.ok) {
      return;
    }
    harness.sync({
      document: boardDocument,
      datasetProvider: provider,
      mode: "editor",
      lease: lease.value,
    });
    await settle();
    expect(instanceOf(harness.container)).toBe(instance);
    expect(viewerRoot(harness.container).getAttribute("data-boardloom-mode")).toBe("editor");
    harness.sync({
      document: boardDocument,
      datasetProvider: provider,
      mode: "viewer",
      lease: lease.value,
    });
    await settle();
    expect(instanceOf(harness.container)).toBe(instance);
    expect(viewerRoot(harness.container).getAttribute("data-boardloom-mode")).toBe("viewer");
    harness.session.dispose();
  });

  it("keeps the session and forwards presentation updates during function-only churn", async () => {
    const harness = createHarness();
    const boardDocument = viewerFixtureDocument();
    const provider = createViewerProvider();
    const blockTypes = [
      {
        type: "svelte.test-inline",
        version: "1.0.0",
        createSurface: () => {
          const element = document.createElement("div");
          return { element, update() {} };
        },
      },
    ];
    harness.sync({ document: boardDocument, datasetProvider: provider, blockTypes });
    await settle();
    const instance = instanceOf(harness.container);
    const chip = harness.container.querySelector(".bl-filter-chip")?.textContent ?? "";
    const rows = harness.container.querySelectorAll(".bl-table tbody tr").length;
    const churned = blockTypes.map((definition) => ({
      ...definition,
      createSurface: () => definition.createSurface(),
    }));
    harness.sync({
      document: boardDocument,
      datasetProvider: provider,
      blockTypes: churned,
      locale: "de",
      timezone: "Europe/Berlin",
      messages: { "mode.viewer": "Reader", "mode.editor": "Author" },
    });
    await settle();
    expect(instanceOf(harness.container)).toBe(instance);
    expect(harness.ready).toHaveLength(1);
    expect(viewerRoot(harness.container).getAttribute("data-boardloom-locale")).toBe("de");
    expect(viewerRoot(harness.container).getAttribute("data-boardloom-timezone")).toBe(
      "Europe/Berlin",
    );
    expect(modeButton(harness.container, "viewer").textContent).toBe("Reader");
    expect(modeButton(harness.container, "editor").textContent).toBe("Author");
    expect(harness.container.querySelector(".bl-filter-chip")?.textContent ?? "").toBe(chip);
    expect(harness.container.querySelectorAll(".bl-table tbody tr").length).toBe(rows);
    expect(harness.errors.filter((error) => error.phase === "input")).toHaveLength(1);
    const churnedAgain = blockTypes.map((definition) => ({
      ...definition,
      createSurface: () => definition.createSurface(),
    }));
    harness.sync({
      document: boardDocument,
      datasetProvider: provider,
      blockTypes: churnedAgain,
      locale: "ja",
      timezone: "Asia/Tokyo",
    });
    await settle();
    expect(instanceOf(harness.container)).toBe(instance);
    expect(viewerRoot(harness.container).getAttribute("data-boardloom-locale")).toBe("ja");
    expect(viewerRoot(harness.container).getAttribute("data-boardloom-timezone")).toBe(
      "Asia/Tokyo",
    );
    expect(modeButton(harness.container, "viewer").textContent).toBe(
      ENGLISH_MESSAGES["mode.viewer"],
    );
    expect(harness.errors.filter((error) => error.phase === "input")).toHaveLength(1);
    harness.session.dispose();
  });

  it("remounts when the document inputs change and reports failed mounts once", async () => {
    const harness = createHarness();
    const boardDocument = viewerFixtureDocument();
    const provider = createViewerProvider();
    harness.sync({ document: boardDocument, datasetProvider: provider });
    await settle();
    const first = instanceOf(harness.container);
    const variant = { ...boardDocument, id: "svelte-variant-board", title: "Variant board" };
    harness.sync({ document: variant, datasetProvider: provider });
    await settle();
    expect(harness.container.querySelectorAll(".boardloom")).toHaveLength(1);
    expect(instanceOf(harness.container)).not.toBe(first);
    expect(harness.ready).toHaveLength(2);
    expect(harness.disposed).toHaveLength(1);
    harness.session.dispose();

    const failing = createHarness();
    failing.sync({ document: { invalid: true }, datasetProvider: provider });
    failing.sync({ document: { invalid: true }, datasetProvider: provider });
    expect(failing.container.querySelectorAll(".boardloom")).toHaveLength(0);
    expect(failing.errors.filter((error) => error.phase === "mount")).toHaveLength(1);
  });

  it("disposes only owned spaces and lets host-owned spaces outlive the session", async () => {
    const boardDocument = viewerFixtureDocument();
    const { runtime } = createViewerRuntime();
    const created = runtime.createSpace({ document: boardDocument });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    const harness = createHarness();
    harness.sync({ space: created.value });
    await settle();
    expect(harness.container.querySelectorAll(".boardloom")).toHaveLength(1);
    harness.session.dispose();
    expect(created.value.disposed).toBe(false);
    expect(runtime.disposed).toBe(false);
    created.value.dispose();
    runtime.dispose();
  });

  it("retains a dirty owned draft until the host decides", async () => {
    const harness = createHarness();
    const boardDocument = viewerFixtureDocument();
    const provider = createViewerProvider();
    harness.sync({ document: boardDocument, datasetProvider: provider });
    await settle();
    const handle = harness.session.handle;
    if (handle === null) {
      throw new Error("the board was not mounted");
    }
    const viewId = handle.view.viewId;
    makeDirtyDraft(handle);
    harness.session.dispose();
    expect(harness.container.querySelectorAll(".boardloom")).toHaveLength(0);
    expect(harness.session.handle).toBeNull();
    const retained = harness.retained[0];
    expect(retained?.viewId).toBe(viewId);
    expect(harness.disposed).toHaveLength(0);
    const resolved = retained?.handle.dispose({ draftDecision: "cancel" });
    expect(resolved?.ok).toBe(true);
    expect(retained?.handle.disposed).toBe(true);
  });

  it("reconciles a raw handle unmount for an adapter-owned space", async () => {
    const harness = createHarness();
    const boardDocument = viewerFixtureDocument();
    const provider = createViewerProvider();
    harness.sync({ document: boardDocument, datasetProvider: provider });
    await settle();
    const handle = harness.session.handle;
    if (handle === null) {
      throw new Error("the board was not mounted");
    }
    const result = handle.unmount({ draftDecision: "cancel" });
    expect(result.ok).toBe(true);
    expect(harness.disposed).toHaveLength(1);
    expect(harness.session.handle).toBeNull();
    expect(harness.container.querySelectorAll(".boardloom")).toHaveLength(0);
    expect(handle.disposed).toBe(true);
    expect(handle.unmount().ok).toBe(true);
  });

  it("reconciles a raw handle unmount for a host-owned external view", async () => {
    const boardDocument = viewerFixtureDocument();
    const { runtime } = createViewerRuntime();
    const created = runtime.createSpace({ document: boardDocument });
    if (!created.ok) {
      throw new Error("the space was rejected");
    }
    const createdView = created.value.createView({ mode: "viewer" });
    if (!createdView.ok) {
      throw new Error("the external view was rejected");
    }
    const harness = createHarness();
    harness.sync({ space: created.value, view: createdView.value });
    await settle();
    const handle = harness.session.handle;
    if (handle === null) {
      throw new Error("the board was not mounted");
    }
    expect(harness.disposed).toHaveLength(0);
    const result = handle.unmount();
    expect(result.ok).toBe(true);
    expect(harness.disposed).toHaveLength(1);
    expect(harness.session.handle).toBeNull();
    expect(harness.container.querySelectorAll(".boardloom")).toHaveLength(0);
    expect(created.value.disposed).toBe(false);
    expect(createdView.value.disposed).toBe(false);
    expect(handle.disposed).toBe(true);
    expect(handle.mounted).toBe(false);
    expect(() => handle.space).toThrow();
    expect(handle.unmount().ok).toBe(true);
    expect(handle.dispose().ok).toBe(true);
    harness.sync({ space: created.value, view: createdView.value, locale: "de" });
    expect(harness.container.querySelectorAll(".boardloom")).toHaveLength(0);
    created.value.dispose();
    runtime.dispose();
  });

  it("ends the session when a host-owned space is disposed", async () => {
    const boardDocument = viewerFixtureDocument();
    const { runtime } = createViewerRuntime();
    const created = runtime.createSpace({ document: boardDocument });
    if (!created.ok) {
      throw new Error("the space was rejected");
    }
    const harness = createHarness();
    harness.sync({ space: created.value });
    await settle();
    created.value.dispose();
    expect(harness.disposed).toHaveLength(1);
    expect(harness.session.handle).toBeNull();
    expect(harness.container.querySelectorAll(".boardloom")).toHaveLength(0);
    runtime.dispose();
  });
});
