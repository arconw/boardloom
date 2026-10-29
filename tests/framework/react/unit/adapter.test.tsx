// @vitest-environment happy-dom
import { StrictMode, act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ENGLISH_MESSAGES, type BoardDocumentV1, type SpaceEvent } from "@boardloom/core";
import {
  BoardloomView,
  type BoardloomAdapterError,
  type BoardloomDraftDecision,
  type BoardloomViewHandle,
  type BoardloomViewProps,
} from "../../../../packages/react/src/index.js";
import {
  REFERENCE_PLUGIN,
  type BlockTypeDefinition,
} from "../../../../packages/view-dom/src/index.js";
import { createViewerRuntime } from "../../view-dom/support/fixture.js";
import {
  reactComparisonDocument,
  reactComparisonProvider,
  reactExampleDocument,
  reactExampleProvider,
} from "../support/fixture.js";

type ContainerProps = NonNullable<BoardloomViewProps["containerProps"]>;
const validContainer: ContainerProps = { id: "board-host" };
// @ts-expect-error children-bearing container content conflicts with the runtime root
const invalidContainer: ContainerProps = { dangerouslySetInnerHTML: { __html: "<span />" } };
void validContainer;
void invalidContainer;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

interface Rendered {
  readonly container: HTMLDivElement;
  readonly root: Root;
  readonly ref: { current: BoardloomViewHandle | null };
  rerender(props: BoardloomViewProps): void;
  unmount(): void;
}

function renderBoard(props: BoardloomViewProps, strict = false): Rendered {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const ref = createRef<BoardloomViewHandle>();
  const element = strict ? (
    <StrictMode>
      <BoardloomView ref={ref} {...props} />
    </StrictMode>
  ) : (
    <BoardloomView ref={ref} {...props} />
  );
  act(() => {
    root.render(element);
  });
  return {
    container,
    root,
    ref,
    rerender(next) {
      act(() => {
        root.render(
          strict ? (
            <StrictMode>
              <BoardloomView ref={ref} {...next} />
            </StrictMode>
          ) : (
            <BoardloomView ref={ref} {...next} />
          ),
        );
      });
    },
    unmount() {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

function viewerRoot(container: HTMLElement): HTMLElement {
  const root = container.querySelector<HTMLElement>(".boardloom");
  if (root === null) {
    throw new Error("viewer root was not mounted");
  }
  return root;
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

function makeDirtyDraft(handle: BoardloomViewHandle): void {
  const lease = handle.space.acquireEditorLease({ sessionId: "react-adapter-test" });
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
    type: "react.test-inline",
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

function inlineBlockDocument(): BoardDocumentV1 {
  const document = reactExampleDocument();
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
        type: "react.test-inline",
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

function modeButton(container: HTMLElement, mode: "viewer" | "editor"): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(`button[data-mode="${mode}"]`);
  if (button === null) {
    throw new Error(`mode button ${mode} was not rendered`);
  }
  return button;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("T14 React adapter", () => {
  it("mounts the shared DOM runtime and forwards initial locale and timezone", () => {
    const document = reactExampleDocument();
    const provider = reactExampleProvider();
    const rendered = renderBoard({
      document,
      datasetProvider: provider,
      locale: "de",
      timezone: "Europe/Berlin",
    });
    const root = viewerRoot(rendered.container);
    expect(root.getAttribute("data-boardloom-timezone")).toBe("Europe/Berlin");
    expect(root.getAttribute("data-boardloom-locale")).toBe("de");
    expect(rendered.container.querySelectorAll(".boardloom")).toHaveLength(1);
    expect(modeButton(rendered.container, "viewer").textContent).toBe("Viewer");
    const handle = rendered.ref.current;
    expect(handle?.mounted).toBe(true);
    expect(handle?.view.spaceId).toBe(handle?.space.id);
    rendered.unmount();
    expect(rendered.container.querySelectorAll(".boardloom")).toHaveLength(0);
    expect(handle?.disposed).toBe(true);
    expect(rendered.ref.current).toBeNull();
  });

  it("keeps a single instance under StrictMode and cleans up every cycle", () => {
    const document = reactExampleDocument();
    const provider = reactExampleProvider();
    let ready = 0;
    let disposed = 0;
    const rendered = renderBoard(
      {
        document,
        datasetProvider: provider,
        onReady: () => {
          ready += 1;
        },
        onDispose: () => {
          disposed += 1;
        },
      },
      true,
    );
    expect(rendered.container.querySelectorAll(".boardloom")).toHaveLength(1);
    const instance = viewerRoot(rendered.container).getAttribute("data-boardloom-instance");
    expect(instance).not.toBeNull();
    expect(ready).toBeGreaterThan(0);
    expect(ready - disposed).toBe(1);
    rendered.rerender({
      document,
      datasetProvider: provider,
      locale: "fr",
      onReady: () => {
        ready += 1;
      },
      onDispose: () => {
        disposed += 1;
      },
    });
    expect(rendered.container.querySelectorAll(".boardloom")).toHaveLength(1);
    expect(viewerRoot(rendered.container).getAttribute("data-boardloom-instance")).toBe(instance);
    rendered.unmount();
    expect(rendered.container.querySelectorAll(".boardloom")).toHaveLength(0);
    expect(ready).toBe(disposed);
  });

  it("updates locale, timezone and host messages without recreating the board", () => {
    const document = reactExampleDocument();
    const provider = reactExampleProvider();
    const events: SpaceEvent[] = [];
    const rendered = renderBoard({
      document,
      datasetProvider: provider,
      locale: "en",
      timezone: "UTC",
      onEvent: (event) => events.push(event),
    });
    const instance = viewerRoot(rendered.container).getAttribute("data-boardloom-instance");
    const filterChip = rendered.container.querySelector(".bl-filter-chip")?.textContent ?? "";
    expect(filterChip).toContain("north, south");
    rendered.rerender({
      document,
      datasetProvider: provider,
      locale: "ja",
      timezone: "Asia/Tokyo",
      messages: { "mode.viewer": "Reader", "mode.editor": "Author" },
      onEvent: (event) => events.push(event),
    });
    const root = viewerRoot(rendered.container);
    expect(root.getAttribute("data-boardloom-instance")).toBe(instance);
    expect(root.getAttribute("data-boardloom-timezone")).toBe("Asia/Tokyo");
    expect(root.getAttribute("data-boardloom-locale")).toBe("ja");
    expect(modeButton(rendered.container, "viewer").textContent).toBe("Reader");
    expect(modeButton(rendered.container, "editor").textContent).toBe("Author");
    expect(rendered.container.querySelector(".bl-filter-chip")?.textContent ?? "").toContain(
      "north, south",
    );
    expect(events.some((event) => event.type === "locale:changed")).toBe(true);
    rendered.rerender({
      document,
      datasetProvider: provider,
      locale: "ja",
      timezone: "Asia/Tokyo",
      messages: undefined,
      onEvent: (event) => events.push(event),
    });
    expect(root.getAttribute("data-boardloom-instance")).toBe(instance);
    expect(modeButton(rendered.container, "viewer").textContent).toBe(
      ENGLISH_MESSAGES["mode.viewer"],
    );
    rendered.unmount();
  });

  it("applies mode and lease props without recreating the board", () => {
    const document = reactExampleDocument();
    const provider = reactExampleProvider();
    const rendered = renderBoard({ document, datasetProvider: provider });
    const handle = rendered.ref.current;
    expect(handle).not.toBeNull();
    if (handle === null) {
      return;
    }
    const instance = viewerRoot(rendered.container).getAttribute("data-boardloom-instance");
    const lease = handle.space.acquireEditorLease({ sessionId: "react-mode-prop" });
    expect(lease.ok).toBe(true);
    if (!lease.ok) {
      return;
    }
    rendered.rerender({ document, datasetProvider: provider, mode: "editor", lease: lease.value });
    expect(viewerRoot(rendered.container).getAttribute("data-boardloom-instance")).toBe(instance);
    expect(viewerRoot(rendered.container).getAttribute("data-boardloom-mode")).toBe("editor");
    rendered.rerender({ document, datasetProvider: provider, mode: "viewer", lease: lease.value });
    expect(viewerRoot(rendered.container).getAttribute("data-boardloom-instance")).toBe(instance);
    expect(viewerRoot(rendered.container).getAttribute("data-boardloom-mode")).toBe("viewer");
    rendered.unmount();
  });

  it("forwards changing event callbacks without remounting", () => {
    const document = reactExampleDocument();
    const provider = reactExampleProvider();
    const first: SpaceEvent[] = [];
    const second: SpaceEvent[] = [];
    const rendered = renderBoard({
      document,
      datasetProvider: provider,
      onEvent: (event) => first.push(event),
    });
    const instance = viewerRoot(rendered.container).getAttribute("data-boardloom-instance");
    rendered.rerender({
      document,
      datasetProvider: provider,
      locale: "es",
      onEvent: (event) => second.push(event),
    });
    expect(viewerRoot(rendered.container).getAttribute("data-boardloom-instance")).toBe(instance);
    expect(second.some((event) => event.type === "locale:changed")).toBe(true);
    expect(first.some((event) => event.type === "locale:changed")).toBe(false);
    rendered.unmount();
  });

  it("exposes an imperative handle for mode, focus, export and disposal", () => {
    const document = reactExampleDocument();
    const provider = reactExampleProvider();
    const rendered = renderBoard({ document, datasetProvider: provider });
    const handle = rendered.ref.current;
    expect(handle).not.toBeNull();
    if (handle === null) {
      return;
    }
    act(() => {
      expect(handle.focus("content").ok).toBe(true);
    });
    const exported = handle.exportDocument();
    expect(exported.ok).toBe(true);
    if (exported.ok) {
      expect(exported.value.document.id).toBe("react-adapter-board");
    }
    const lease = handle.space.acquireEditorLease({ sessionId: "react-unit" });
    expect(lease.ok).toBe(true);
    if (!lease.ok) {
      return;
    }
    act(() => {
      expect(handle.setMode("editor", { lease: lease.value }).ok).toBe(true);
    });
    expect(handle.view.mode).toBe("editor");
    act(() => {
      expect(handle.setMode("viewer").ok).toBe(true);
    });
    expect(handle.view.mode).toBe("viewer");
    act(() => {
      expect(handle.unmount({ draftDecision: "cancel" }).ok).toBe(true);
    });
    expect(handle.disposed).toBe(true);
    rendered.unmount();
  });

  it("ends the imperative session and keeps repeated cleanup idempotent", () => {
    const document = reactExampleDocument();
    const provider = reactExampleProvider();
    let disposed = 0;
    const rendered = renderBoard({
      document,
      datasetProvider: provider,
      onDispose: () => {
        disposed += 1;
      },
    });
    const handle = rendered.ref.current;
    expect(handle).not.toBeNull();
    if (handle === null) {
      return;
    }
    act(() => {
      expect(handle.unmount({ draftDecision: "cancel" }).ok).toBe(true);
    });
    expect(handle.disposed).toBe(true);
    expect(handle.mounted).toBe(false);
    expect(() => handle.space).toThrow();
    expect(disposed).toBe(1);
    expect(rendered.container.querySelectorAll(".boardloom")).toHaveLength(0);
    act(() => {
      expect(handle.unmount().ok).toBe(true);
    });
    expect(disposed).toBe(1);
    rendered.rerender({
      document,
      datasetProvider: provider,
      locale: "fr",
      onDispose: () => {
        disposed += 1;
      },
    });
    expect(rendered.container.querySelectorAll(".boardloom")).toHaveLength(0);
    expect(handle.mounted).toBe(false);
    expect(disposed).toBe(1);
    rendered.unmount();
    expect(disposed).toBe(1);
  });

  it("keeps imperative dispose terminal and idempotent", () => {
    const document = reactExampleDocument();
    const provider = reactExampleProvider();
    let disposed = 0;
    const rendered = renderBoard({
      document,
      datasetProvider: provider,
      onDispose: () => {
        disposed += 1;
      },
    });
    const handle = rendered.ref.current;
    if (handle === null) {
      throw new Error("the board is not mounted");
    }
    act(() => {
      expect(handle.dispose({ draftDecision: "cancel" }).ok).toBe(true);
    });
    expect(handle.disposed).toBe(true);
    expect(disposed).toBe(1);
    act(() => {
      expect(handle.dispose().ok).toBe(true);
      expect(handle.unmount().ok).toBe(true);
    });
    expect(disposed).toBe(1);
    rendered.rerender({
      document,
      datasetProvider: provider,
      locale: "de",
      onDispose: () => {
        disposed += 1;
      },
    });
    expect(rendered.container.querySelectorAll(".boardloom")).toHaveLength(0);
    expect(disposed).toBe(1);
    rendered.unmount();
    expect(disposed).toBe(1);
  });

  it("disposes only owned spaces and leaves host spaces alive", () => {
    const document = reactExampleDocument();
    const { runtime } = createViewerRuntime();
    const created = runtime.createSpace({ document });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    const rendered = renderBoard({ space: created.value });
    expect(rendered.container.querySelectorAll(".boardloom")).toHaveLength(1);
    rendered.unmount();
    expect(created.value.disposed).toBe(false);
    expect(runtime.disposed).toBe(false);
    created.value.dispose();
    runtime.dispose();
  });

  it("ends the session when a host-owned space is disposed", () => {
    const document = reactExampleDocument();
    const { runtime } = createViewerRuntime();
    const created = runtime.createSpace({ document });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    const space = created.value;
    let disposed = 0;
    const rendered = renderBoard({
      space,
      onDispose: () => {
        disposed += 1;
      },
    });
    const handle = rendered.ref.current;
    if (handle === null) {
      throw new Error("the board is not mounted");
    }
    act(() => {
      space.dispose();
    });
    expect(disposed).toBe(1);
    expect(handle.disposed).toBe(true);
    expect(handle.mounted).toBe(false);
    expect(rendered.container.querySelectorAll(".boardloom")).toHaveLength(0);
    rendered.rerender({
      space,
      locale: "de",
      onDispose: () => {
        disposed += 1;
      },
    });
    expect(rendered.container.querySelectorAll(".boardloom")).toHaveLength(0);
    expect(disposed).toBe(1);
    rendered.unmount();
    expect(disposed).toBe(1);
    runtime.dispose();
  });

  it("reports mount failures without leaving a partial viewer", () => {
    const errors: string[] = [];
    const rendered = renderBoard({
      onError: (error) => errors.push(error.phase),
    });
    expect(errors).toEqual(["mount"]);
    expect(rendered.container.querySelectorAll(".boardloom")).toHaveLength(0);
    rendered.unmount();
  });
  it("does not remount for inline plain-data mount inputs with equal content", () => {
    const provider = reactExampleProvider();
    const rendered = renderBoard({
      document: reactExampleDocument(),
      datasetProvider: provider,
      runtimeOptions: {},
    });
    const instance = viewerRoot(rendered.container).getAttribute("data-boardloom-instance");
    const handle = rendered.ref.current;
    rendered.rerender({
      document: reactExampleDocument(),
      datasetProvider: provider,
      runtimeOptions: {},
    });
    expect(viewerRoot(rendered.container).getAttribute("data-boardloom-instance")).toBe(instance);
    expect(rendered.container.querySelectorAll(".boardloom")).toHaveLength(1);
    expect(rendered.ref.current).toBe(handle);
    rendered.unmount();
  });

  it("recovers props-driven editor mode when the missing lease arrives", () => {
    const document = reactExampleDocument();
    const provider = reactExampleProvider();
    const errors: BoardloomAdapterError[] = [];
    const rendered = renderBoard({
      document,
      datasetProvider: provider,
      onError: (error) => errors.push(error),
    });
    const handle = rendered.ref.current;
    expect(handle).not.toBeNull();
    if (handle === null) {
      return;
    }
    rendered.rerender({
      document,
      datasetProvider: provider,
      mode: "editor",
      onError: (error) => errors.push(error),
    });
    expect(viewerRoot(rendered.container).getAttribute("data-boardloom-mode")).toBe("viewer");
    expect(errors.filter((error) => error.phase === "update")).toHaveLength(1);
    const lease = handle.space.acquireEditorLease({ sessionId: "react-mode-recovery" });
    expect(lease.ok).toBe(true);
    if (!lease.ok) {
      return;
    }
    rendered.rerender({
      document,
      datasetProvider: provider,
      mode: "editor",
      lease: lease.value,
      onError: (error) => errors.push(error),
    });
    expect(viewerRoot(rendered.container).getAttribute("data-boardloom-mode")).toBe("editor");
    expect(errors.filter((error) => error.phase === "update")).toHaveLength(1);
    rendered.rerender({
      document,
      datasetProvider: provider,
      mode: "viewer",
      lease: lease.value,
      draftDecision: "cancel",
      onError: (error) => errors.push(error),
    });
    rendered.unmount();
  });

  it("applies a valid sibling locale after the invalid theme is corrected", () => {
    const document = reactExampleDocument();
    const provider = reactExampleProvider();
    const errors: BoardloomAdapterError[] = [];
    const rendered = renderBoard({
      document,
      datasetProvider: provider,
      locale: "en",
      theme: "light",
      onError: (error) => errors.push(error),
    });
    rendered.rerender({
      document,
      datasetProvider: provider,
      locale: "de",
      theme: "neon" as unknown as BoardloomViewProps["theme"],
      onError: (error) => errors.push(error),
    });
    expect(viewerRoot(rendered.container).getAttribute("data-boardloom-locale")).toBe("en");
    expect(viewerRoot(rendered.container).getAttribute("data-boardloom-theme")).toBe("light");
    expect(errors.filter((error) => error.phase === "update")).toHaveLength(1);
    rendered.rerender({
      document,
      datasetProvider: provider,
      locale: "de",
      theme: "dark",
      onError: (error) => errors.push(error),
    });
    expect(viewerRoot(rendered.container).getAttribute("data-boardloom-locale")).toBe("de");
    expect(viewerRoot(rendered.container).getAttribute("data-boardloom-theme")).toBe("dark");
    expect(errors.filter((error) => error.phase === "update")).toHaveLength(1);
    rendered.unmount();
  });

  it("preserves a dirty draft, undo and editor mode across locale and timezone updates", () => {
    const document = reactExampleDocument();
    const provider = reactExampleProvider();
    const rendered = renderBoard({ document, datasetProvider: provider });
    const handle = rendered.ref.current;
    expect(handle).not.toBeNull();
    if (handle === null) {
      return;
    }
    makeDirtyDraft(handle);
    const space = handle.space;
    const instance = viewerRoot(rendered.container).getAttribute("data-boardloom-instance");
    const before = space.getSnapshot().draft;
    expect(before?.dirty).toBe(true);
    expect(before?.canUndo).toBe(true);
    rendered.rerender({
      document,
      datasetProvider: provider,
      locale: "fr",
      timezone: "Europe/Paris",
      draftDecision: "cancel",
    });
    const after = space.getSnapshot().draft;
    expect(viewerRoot(rendered.container).getAttribute("data-boardloom-instance")).toBe(instance);
    expect(viewerRoot(rendered.container).getAttribute("data-boardloom-locale")).toBe("fr");
    expect(viewerRoot(rendered.container).getAttribute("data-boardloom-timezone")).toBe(
      "Europe/Paris",
    );
    expect(handle.view.mode).toBe("editor");
    expect(after?.dirty).toBe(true);
    expect(after?.revision).toBe(before?.revision);
    expect(after?.canUndo).toBe(true);
    expect(after?.document.title).toContain("draft");
    rendered.unmount();
    expect(space.disposed).toBe(true);
  });

  it("preserves comparison results and realtime status across presentation updates", async () => {
    const document = reactComparisonDocument();
    const provider = reactComparisonProvider();
    const realtime = { status: "live" as const };
    const rendered = renderBoard({ document, datasetProvider: provider, realtime });
    await flush();
    const instance = viewerRoot(rendered.container).getAttribute("data-boardloom-instance");
    const comparisonTable = rendered.container.querySelector(".bl-comparison-table");
    const comparisonRows = rendered.container
      .querySelector("[data-comparison-rows]")
      ?.getAttribute("data-comparison-rows");
    expect(comparisonTable).not.toBeNull();
    expect(comparisonRows).not.toBeNull();
    const tableText = comparisonTable?.textContent ?? "";
    expect(viewerRoot(rendered.container).getAttribute("data-boardloom-realtime-status")).toBe(
      "live",
    );
    rendered.rerender({
      document,
      datasetProvider: provider,
      locale: "ja",
      timezone: "Asia/Tokyo",
      realtime,
    });
    await flush();
    expect(viewerRoot(rendered.container).getAttribute("data-boardloom-instance")).toBe(instance);
    expect(rendered.container.querySelector(".bl-comparison-table")?.textContent ?? "").toBe(
      tableText,
    );
    expect(
      rendered.container
        .querySelector("[data-comparison-rows]")
        ?.getAttribute("data-comparison-rows"),
    ).toBe(comparisonRows);
    expect(viewerRoot(rendered.container).getAttribute("data-boardloom-realtime-status")).toBe(
      "live",
    );
    rendered.unmount();
  });

  it("retains an adapter-owned dirty draft and reports DRAFT_REQUIRES_DECISION on unmount", () => {
    const document = reactExampleDocument();
    const provider = reactExampleProvider();
    const errors: BoardloomAdapterError[] = [];
    const rendered = renderBoard({
      document,
      datasetProvider: provider,
      onError: (error) => errors.push(error),
    });
    const handle = rendered.ref.current;
    expect(handle).not.toBeNull();
    if (handle === null) {
      return;
    }
    const space = handle.space;
    makeDirtyDraft(handle);
    rendered.unmount();
    expect(errors).toHaveLength(1);
    expect(errors[0]?.phase).toBe("dispose");
    expect(errors[0]?.diagnostics[0]?.code).toBe("DRAFT_REQUIRES_DECISION");
    const retained = errors[0]?.retained;
    expect(retained).toBeDefined();
    expect(retained?.handle.disposed).toBe(false);
    expect(space.disposed).toBe(false);
    expect(space.listenerCount).toBeGreaterThan(0);
    expect(rendered.container.querySelectorAll(".boardloom")).toHaveLength(0);
    const resolved = retained?.handle.dispose({ draftDecision: "cancel" });
    expect(resolved?.ok).toBe(true);
    expect(retained?.handle.disposed).toBe(true);
    expect(space.disposed).toBe(true);
    expect(space.listenerCount).toBe(0);
  });

  it("applies a dirty owned draft when draftDecision is apply", () => {
    const document = reactExampleDocument();
    const provider = reactExampleProvider();
    const rendered = renderBoard({ document, datasetProvider: provider });
    const handle = rendered.ref.current;
    expect(handle).not.toBeNull();
    if (handle === null) {
      return;
    }
    const space = handle.space;
    makeDirtyDraft(handle);
    rendered.rerender({ document, datasetProvider: provider, draftDecision: "apply" });
    rendered.unmount();
    expect(space.disposed).toBe(true);
    expect(space.getSnapshot().committedDocument.title).toContain("draft");
  });

  it("retains a session when explicit disposal fails so the host can retry", () => {
    const document = reactExampleDocument();
    const provider = reactExampleProvider();
    const errors: BoardloomAdapterError[] = [];
    const rendered = renderBoard({
      document,
      datasetProvider: provider,
      onError: (error) => errors.push(error),
    });
    const handle = rendered.ref.current;
    expect(handle).not.toBeNull();
    if (handle === null) {
      return;
    }
    const space = handle.space;
    rendered.rerender({
      document,
      datasetProvider: provider,
      draftDecision: "bogus" as BoardloomDraftDecision,
      onError: (error) => errors.push(error),
    });
    rendered.unmount();
    expect(errors).toHaveLength(1);
    expect(errors[0]?.phase).toBe("dispose");
    const retained = errors[0]?.retained;
    expect(retained).toBeDefined();
    expect(retained?.handle.disposed).toBe(false);
    expect(space.disposed).toBe(false);
    expect(space.listenerCount).toBeGreaterThan(0);
    const resolved = retained?.handle.dispose({ draftDecision: "cancel" });
    expect(resolved?.ok).toBe(true);
    expect(retained?.handle.disposed).toBe(true);
    expect(space.disposed).toBe(true);
    expect(space.listenerCount).toBe(0);
  });

  it("retains a dirty owned session across a document-change remount", () => {
    const firstDocument = reactExampleDocument();
    const provider = reactExampleProvider();
    const errors: BoardloomAdapterError[] = [];
    const rendered = renderBoard({
      document: firstDocument,
      datasetProvider: provider,
      onError: (error) => errors.push(error),
    });
    const handle = rendered.ref.current;
    expect(handle).not.toBeNull();
    if (handle === null) {
      return;
    }
    const space = handle.space;
    makeDirtyDraft(handle);
    const firstInstance = viewerRoot(rendered.container).getAttribute("data-boardloom-instance");
    const secondDocument = {
      ...reactExampleDocument(),
      id: "react-adapter-board-variant",
      title: "Assessment overview variant",
    };
    rendered.rerender({
      document: secondDocument,
      datasetProvider: provider,
      onError: (error) => errors.push(error),
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]?.diagnostics[0]?.code).toBe("DRAFT_REQUIRES_DECISION");
    expect(rendered.container.querySelectorAll(".boardloom")).toHaveLength(1);
    expect(viewerRoot(rendered.container).getAttribute("data-boardloom-instance")).not.toBe(
      firstInstance,
    );
    const retained = errors[0]?.retained;
    expect(retained?.handle.disposed).toBe(false);
    expect(space.disposed).toBe(false);
    const resolved = retained?.handle.dispose({ draftDecision: "cancel" });
    expect(resolved?.ok).toBe(true);
    expect(retained?.handle.disposed).toBe(true);
    expect(space.disposed).toBe(true);
    rendered.unmount();
  });
  it("ignores events and disposal from a retained session's space", () => {
    const firstDocument = reactExampleDocument();
    const provider = reactExampleProvider();
    const errors: BoardloomAdapterError[] = [];
    const events: SpaceEvent[] = [];
    let disposed = 0;
    const rendered = renderBoard({
      document: firstDocument,
      datasetProvider: provider,
      onEvent: (event) => events.push(event),
      onDispose: () => {
        disposed += 1;
      },
      onError: (error) => errors.push(error),
    });
    const handle = rendered.ref.current;
    if (handle === null) {
      throw new Error("the board is not mounted");
    }
    const firstSpace = handle.space;
    makeDirtyDraft(handle);
    const secondDocument = {
      ...reactExampleDocument(),
      id: "react-adapter-board-variant",
      title: "Assessment overview variant",
    };
    rendered.rerender({
      document: secondDocument,
      datasetProvider: provider,
      onEvent: (event) => events.push(event),
      onDispose: () => {
        disposed += 1;
      },
      onError: (error) => errors.push(error),
    });
    const retained = errors[0]?.retained;
    expect(retained).toBeDefined();
    const liveHandle = rendered.ref.current;
    expect(liveHandle?.mounted).toBe(true);
    const liveInstance = viewerRoot(rendered.container).getAttribute("data-boardloom-instance");
    const retainedSpaceId = firstSpace.id;
    const retainedEvents = events.filter((event) => event.spaceId === retainedSpaceId).length;
    firstSpace.setLocale({ locale: "de" });
    expect(events.filter((event) => event.spaceId === retainedSpaceId)).toHaveLength(
      retainedEvents,
    );
    firstSpace.dispose();
    expect(disposed).toBe(0);
    expect(rendered.ref.current?.mounted).toBe(true);
    expect(rendered.container.querySelectorAll(".boardloom")).toHaveLength(1);
    expect(viewerRoot(rendered.container).getAttribute("data-boardloom-instance")).toBe(
      liveInstance,
    );
    rendered.rerender({
      document: secondDocument,
      datasetProvider: provider,
      locale: "fr",
      onEvent: (event) => events.push(event),
      onDispose: () => {
        disposed += 1;
      },
      onError: (error) => errors.push(error),
    });
    expect(viewerRoot(rendered.container).getAttribute("data-boardloom-locale")).toBe("fr");
    expect(viewerRoot(rendered.container).getAttribute("data-boardloom-instance")).toBe(
      liveInstance,
    );
    expect(disposed).toBe(0);
    rendered.unmount();
    expect(disposed).toBe(1);
  });

  it("emits onDispose after adapter-initiated teardown completes", () => {
    const observed = { roots: -1, container: null as HTMLElement | null };
    const rendered = renderBoard({
      document: reactExampleDocument(),
      datasetProvider: reactExampleProvider(),
      onDispose: () => {
        observed.roots = observed.container?.querySelectorAll(".boardloom").length ?? -1;
      },
    });
    observed.container = rendered.container;
    const handle = rendered.ref.current;
    if (handle === null) {
      throw new Error("the board is not mounted");
    }
    act(() => {
      expect(handle.unmount({ draftDecision: "cancel" }).ok).toBe(true);
    });
    expect(observed.roots).toBe(0);
    rendered.unmount();
  });

  it("keeps one session when function-bearing definitions are recreated inline", () => {
    const document = reactExampleDocument();
    const provider = reactExampleProvider();
    const errors: BoardloomAdapterError[] = [];
    const first = churnedDefinitions();
    const rendered = renderBoard({
      document,
      datasetProvider: provider,
      ...first,
      onError: (error) => errors.push(error),
    });
    const handle = rendered.ref.current;
    expect(handle).not.toBeNull();
    if (handle === null) {
      return;
    }
    const instance = viewerRoot(rendered.container).getAttribute("data-boardloom-instance");
    const second = churnedDefinitions();
    rendered.rerender({
      document,
      datasetProvider: provider,
      locale: "de",
      timezone: "Europe/Berlin",
      messages: { "mode.viewer": "Reader", "mode.editor": "Author" },
      ...second,
      onError: (error) => errors.push(error),
    });
    expect(viewerRoot(rendered.container).getAttribute("data-boardloom-instance")).toBe(instance);
    expect(viewerRoot(rendered.container).getAttribute("data-boardloom-locale")).toBe("de");
    expect(viewerRoot(rendered.container).getAttribute("data-boardloom-timezone")).toBe(
      "Europe/Berlin",
    );
    expect(modeButton(rendered.container, "viewer").textContent).toBe("Reader");
    expect(rendered.container.querySelectorAll(".boardloom")).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.phase).toBe("input");
    expect(errors[0]?.diagnostics[0]?.path).toBe("mountInputs");
    expect(errors[0]?.retained).toBeUndefined();
    makeDirtyDraft(handle);
    const space = handle.space;
    const before = space.getSnapshot().draft;
    const third = churnedDefinitions();
    rendered.rerender({
      document,
      datasetProvider: provider,
      locale: "de",
      timezone: "Europe/Berlin",
      messages: { "mode.viewer": "Reader", "mode.editor": "Author" },
      ...third,
      onError: (error) => errors.push(error),
    });
    expect(viewerRoot(rendered.container).getAttribute("data-boardloom-instance")).toBe(instance);
    expect(space.getSnapshot().draft?.revision).toBe(before?.revision);
    expect(space.getSnapshot().draft?.dirty).toBe(true);
    expect(rendered.container.querySelectorAll(".boardloom")).toHaveLength(1);
    expect(errors).toHaveLength(1);
    rendered.rerender({
      document,
      datasetProvider: provider,
      ...third,
      draftDecision: "cancel",
      onError: (error) => errors.push(error),
    });
    rendered.unmount();
    expect(space.disposed).toBe(true);
  });

  it("keeps a host-owned editor lease on clean unmount by default", () => {
    const document = reactExampleDocument();
    const { runtime } = createViewerRuntime();
    const created = runtime.createSpace({ document });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    const space = created.value;
    const errors: BoardloomAdapterError[] = [];
    const rendered = renderBoard({ space, onError: (error) => errors.push(error) });
    const handle = rendered.ref.current;
    expect(handle).not.toBeNull();
    if (handle === null) {
      return;
    }
    const lease = space.acquireEditorLease({ sessionId: "external-clean" });
    expect(lease.ok).toBe(true);
    if (!lease.ok) {
      return;
    }
    expect(handle.setMode("editor", { lease: lease.value }).ok).toBe(true);
    rendered.unmount();
    expect(errors).toHaveLength(0);
    expect(space.disposed).toBe(false);
    const snapshot = space.getSnapshot();
    expect(snapshot.editorLease?.leaseId).toBe(lease.value.leaseId);
    expect(snapshot.viewCount).toBe(0);
    space.releaseEditorLease(lease.value, { decision: "cancel" });
    space.dispose();
    runtime.dispose();
  });

  it("keeps a host-owned dirty draft and lease on unmount by default", () => {
    const document = reactExampleDocument();
    const { runtime } = createViewerRuntime();
    const created = runtime.createSpace({ document });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    const space = created.value;
    const errors: BoardloomAdapterError[] = [];
    const rendered = renderBoard({ space, onError: (error) => errors.push(error) });
    const handle = rendered.ref.current;
    expect(handle).not.toBeNull();
    if (handle === null) {
      return;
    }
    makeDirtyDraft(handle);
    const lease = space.getSnapshot().editorLease;
    expect(lease).not.toBeNull();
    rendered.unmount();
    expect(errors).toHaveLength(0);
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
  it("ignores later function-only swaps until a structural remount", () => {
    const document = inlineBlockDocument();
    const provider = reactExampleProvider();
    const errors: BoardloomAdapterError[] = [];
    const rendered = renderBoard({
      document,
      datasetProvider: provider,
      blockTypes: [inlineBlockType("first")],
      onError: (error) => errors.push(error),
    });
    const instance = viewerRoot(rendered.container).getAttribute("data-boardloom-instance");
    const surface = rendered.container.querySelector(".test-inline-surface");
    expect(surface).not.toBeNull();
    expect(surface?.textContent).toBe("first");
    rendered.rerender({
      document,
      datasetProvider: provider,
      blockTypes: [inlineBlockType("second")],
      onError: (error) => errors.push(error),
    });
    expect(viewerRoot(rendered.container).getAttribute("data-boardloom-instance")).toBe(instance);
    expect(rendered.container.querySelector(".test-inline-surface")?.textContent).toBe("first");
    expect(errors).toHaveLength(1);
    expect(errors[0]?.phase).toBe("input");
    rendered.rerender({
      document,
      datasetProvider: provider,
      blockTypes: [inlineBlockType("third")],
      onError: (error) => errors.push(error),
    });
    expect(viewerRoot(rendered.container).getAttribute("data-boardloom-instance")).toBe(instance);
    expect(rendered.container.querySelector(".test-inline-surface")?.textContent).toBe("first");
    expect(errors).toHaveLength(1);
    expect(rendered.container.querySelectorAll(".boardloom")).toHaveLength(1);
    rendered.unmount();
  });
});
