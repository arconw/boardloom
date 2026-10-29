import { describe, expect, it } from "vitest";
import {
  BUILT_IN_DICTIONARIES,
  ENGLISH_MESSAGES,
  createLocalDatasetProvider,
  createRuntime,
  type BoardDocument,
  type BoardSpace,
  type BoardView,
  type DatasetProvider,
  type DatasetQueryResult,
} from "../../../../packages/core/src/index.js";
import { mountBoardView } from "../../../../packages/view-dom/src/index.js";
import type { BoardViewHandle } from "../../../../packages/view-dom/src/types.js";
import { expectFailure, unwrap } from "../../core/support/assertions.js";
import {
  ASSESSMENT_DESCRIPTOR,
  ASSESSMENT_ROWS,
  cloneAssessmentDescriptor,
} from "../../core/fixtures/assessment-fixture.js";
import {
  createMiniDocument,
  findByAttribute,
  findByClass,
  findByTag,
  type MiniDocument,
  type MiniElement,
} from "../support/mini-dom.js";
import {
  createViewerProvider,
  createViewerRuntime,
  viewerFixtureDocument,
} from "../support/fixture.js";

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

function rootOf(handle: { readonly element: HTMLElement }): MiniElement {
  return handle.element as unknown as MiniElement;
}

function proxiedSpace(space: BoardSpace, overrides: Record<string, unknown>): BoardSpace {
  return new Proxy(space, {
    get(target, property) {
      if (typeof property === "string" && Object.hasOwn(overrides, property)) {
        return overrides[property];
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function wrapView(view: BoardView): BoardView {
  return {
    get viewId() {
      return view.viewId;
    },
    get spaceId() {
      return view.spaceId;
    },
    get mode() {
      return view.mode;
    },
    get disposed() {
      return view.disposed;
    },
    commands: view.commands,
    getSnapshot: () => view.getSnapshot(),
    setMode: (mode, options) => view.setMode(mode, options),
    dispose: (options) => view.dispose(options),
  };
}

function createTarget(document: MiniDocument, width = 1280): MiniElement {
  const target = document.createElement("div");
  target.clientWidth = width;
  document.body.append(target);
  return target;
}

function mountFixture(
  options: {
    readonly width?: number;
    readonly provider?: DatasetProvider;
    readonly document?: BoardDocument;
  } = {},
) {
  const document = createMiniDocument();
  const target = createTarget(document, options.width ?? 1280);
  const { runtime } = createViewerRuntime(options.provider ?? createViewerProvider());
  const space = unwrap(
    runtime.createSpace({ document: options.document ?? viewerFixtureDocument() }),
  );
  const handle = unwrap(
    mountBoardView(target as unknown as HTMLElement, {
      space,
      theme: "light",
      realtime: { status: "live" },
      provenance: "Synthetic fixture",
    }),
  );
  return { document, target, runtime, space, handle };
}

function textByKey(root: MiniElement, key: string): string {
  const element = findByAttribute(root, "data-message-key", key)[0];
  return element?.textContent ?? "";
}

describe("T06 viewer lifecycle and ownership", () => {
  it("mounts, updates and unmounts one view without disposing an external space", async () => {
    const { target, runtime, space, handle } = mountFixture();
    await flush();
    expect(target.children).toHaveLength(1);
    expect(handle.mounted).toBe(true);
    expect(space.disposed).toBe(false);
    expect(space.viewCount).toBe(1);
    expect(space.listenerCount).toBeGreaterThan(0);
    expect(space.getQueryStates()).toHaveLength(3);
    expect(findByClass(rootOf(handle), "bl-block")).toHaveLength(5);

    const sibling = unwrap(space.createView({ mode: "viewer" }));
    expect(space.viewCount).toBe(2);
    const result = handle.unmount();
    expect(result.ok).toBe(true);
    expect(target.children).toHaveLength(0);
    expect(handle.mounted).toBe(false);
    expect(space.disposed).toBe(false);
    expect(space.viewCount).toBe(1);
    expect(sibling.disposed).toBe(false);
    expect(space.getQueryStates()).toEqual([]);
    expect(runtime.getSpace(space.id)).toBe(space);
    unwrap(runtime.dispose());
  });

  it("renders the shell landmarks, title metadata and stable message keys", async () => {
    const { handle } = mountFixture();
    await flush();
    const root = rootOf(handle);
    expect(root.getAttribute("data-boardloom-theme")).toBe("light");
    expect(root.style.getPropertyValue("--bl-color-accent")).toBe("#3366cc");
    expect(root.style.getPropertyValue("--bl-font-sans")).toBe("serif");
    expect(findByTag(root, "header")[0]?.getAttribute("role")).toBe("banner");
    const skip = findByClass(root, "bl-skip-link")[0];
    expect(skip?.getAttribute("href")).toBe(`#${findByClass(root, "bl-body")[0]?.id}`);
    expect(findByClass(root, "bl-body")[0]?.getAttribute("role")).toBe("region");
    expect(findByClass(root, "bl-body")[0]?.getAttribute("tabindex")).toBe("-1");
    expect(findByClass(root, "bl-status")[0]?.getAttribute("role")).toBe("status");
    expect(findByClass(root, "bl-modes")[0]?.getAttribute("role")).toBe("group");
    expect(findByClass(root, "bl-title")[0]?.textContent).toBe("Assessment overview");
    expect(textByKey(root, "viewer.meta.updated")).toContain("Updated");
    expect(textByKey(root, "viewer.meta.timezone")).toContain("UTC");
    for (const element of findByAttribute(root, "data-message-key")) {
      const key = element.getAttribute("data-message-key");
      if (key !== null) {
        expect(ENGLISH_MESSAGES[key], key).toBeTypeOf("string");
      }
    }
    for (const button of findByTag(root, "button")) {
      expect(button.getAttribute("data-message-key")).not.toBeNull();
    }
    unwrap(handle.unmount());
  });

  it("selects the desktop, tablet and narrow layout from the instance width", async () => {
    for (const [width, breakpoint] of [
      [1440, "desktop"],
      [900, "tablet"],
      [360, "narrow"],
    ] as const) {
      const mounted = mountFixture({ width });
      await flush();
      expect(rootOf(mounted.handle).getAttribute("data-boardloom-breakpoint")).toBe(breakpoint);
      unwrap(mounted.handle.unmount());
      unwrap(mounted.runtime.dispose());
    }
  });

  it("renders settled metric, table and chart data surfaces with accessible tables", async () => {
    const { handle } = mountFixture();
    await flush();
    const root = rootOf(handle);
    const metric = findByClass(root, "bl-metric__value")[0];
    expect(metric?.textContent).not.toBe("");
    expect(metric?.textContent).not.toContain("Not available");
    const tableRegions = findByClass(root, "bl-table-region");
    expect(tableRegions.length).toBeGreaterThanOrEqual(2);
    for (const region of tableRegions) {
      expect(region.getAttribute("role")).toBe("region");
      expect(region.getAttribute("tabindex")).toBe("0");
      expect(region.getAttribute("aria-labelledby")).not.toBeNull();
    }
    expect(findByTag(root, "th").length).toBeGreaterThan(0);
    unwrap(handle.unmount());
  });

  it("keeps multiple instances isolated in theme, direction and lifecycle", async () => {
    const first = mountFixture();
    const secondDocument = createMiniDocument();
    const secondTarget = createTarget(secondDocument, 900);
    const { runtime: secondRuntime } = createViewerRuntime();
    const secondSpace = unwrap(
      secondRuntime.createSpace({ document: viewerFixtureDocument(), locale: "ar" }),
    );
    const secondHandle = unwrap(
      mountBoardView(secondTarget as unknown as HTMLElement, {
        space: secondSpace,
        theme: "dark",
        realtime: { status: "historical" },
      }),
    );
    await flush();
    expect(rootOf(first.handle).getAttribute("data-boardloom-theme")).toBe("light");
    expect(rootOf(first.handle).getAttribute("dir")).toBe("ltr");
    expect(rootOf(secondHandle).getAttribute("data-boardloom-theme")).toBe("dark");
    expect(rootOf(secondHandle).getAttribute("dir")).toBe("rtl");
    expect(rootOf(secondHandle).getAttribute("lang")).toBe("ar");
    unwrap(first.handle.unmount());
    expect(secondHandle.mounted).toBe(true);
    expect(secondTarget.children).toHaveLength(1);
    expect(secondSpace.disposed).toBe(false);
    unwrap(secondHandle.unmount());
    unwrap(secondRuntime.dispose());
    unwrap(first.runtime.dispose());
  });
});

describe("T06 view-local modes and sibling views", () => {
  it("switches one view mode without recreating the DOM or disturbing a sibling", async () => {
    const { runtime, space, handle } = mountFixture();
    const sibling = unwrap(space.createView({ mode: "viewer" }));
    const lease = unwrap(space.acquireEditorLease({ sessionId: "viewer-test" }));
    const root = rootOf(handle);
    const switched = handle.setMode("editor", { lease });
    expect(switched.ok).toBe(true);
    await flush();
    expect(rootOf(handle)).toBe(root);
    expect(root.getAttribute("data-boardloom-mode")).toBe("editor");
    expect(space.getSnapshot().views.find((view) => view.viewId === handle.view.viewId)?.mode).toBe(
      "editor",
    );
    expect(sibling.mode).toBe("viewer");
    expect(sibling.disposed).toBe(false);
    unwrap(handle.setMode("viewer"));
    await flush();
    expect(root.getAttribute("data-boardloom-mode")).toBe("viewer");
    unwrap(runtime.dispose());
  });

  it("keeps the mounted viewer intact when a sibling view is disposed", async () => {
    const { runtime, space, handle } = mountFixture();
    await flush();
    const sibling = unwrap(space.createView({ mode: "viewer" }));
    const root = rootOf(handle);
    unwrap(sibling.dispose());
    await flush();
    expect(sibling.disposed).toBe(true);
    expect(handle.mounted).toBe(true);
    expect(rootOf(handle)).toBe(root);
    expect(findByClass(root, "bl-title")[0]?.textContent).toBe("Assessment overview");
    expect(space.getSnapshot().viewCount).toBe(1);
    expect(space.getQueryStates()).toHaveLength(3);
    unwrap(handle.unmount());
    unwrap(runtime.dispose());
  });

  it("applies host message overrides without changing board or query state", async () => {
    const document = createMiniDocument();
    const target = createTarget(document);
    const { runtime } = createViewerRuntime();
    const space = unwrap(runtime.createSpace({ document: viewerFixtureDocument() }));
    const handle = unwrap(
      mountBoardView(target as unknown as HTMLElement, {
        space,
        messages: {
          "mode.viewer": "See board",
          "state.empty.title": "Nothing in this scope",
        },
      }),
    );
    await flush();
    const before = space.getSnapshot();
    const firstBlock = findByClass(rootOf(handle), "bl-block")[0];
    expect(findByTag(rootOf(handle), "button")[0]?.textContent).toBe("See board");
    unwrap(handle.update({ locale: "de" }));
    await flush();
    expect(findByTag(rootOf(handle), "button")[0]?.textContent).toBe("See board");
    expect(findByClass(rootOf(handle), "bl-block")[0]).toBe(firstBlock);
    expect(space.getSnapshot().committedRevision).toBe(before.committedRevision);
    expect(space.getQueryStates()).toHaveLength(3);
    unwrap(handle.unmount());
    unwrap(runtime.dispose());
  });

  it("rejects an unsupported theme value before touching the space", async () => {
    const document = createMiniDocument();
    const target = createTarget(document);
    const { runtime } = createViewerRuntime();
    const space = unwrap(runtime.createSpace({ document: viewerFixtureDocument() }));
    const result = mountBoardView(target as unknown as HTMLElement, {
      space,
      theme: "sepia" as never,
    });
    expectFailure(result, "INVALID_ARGUMENT");
    expect(space.viewCount).toBe(0);
    expect(space.disposed).toBe(false);
    unwrap(runtime.dispose());
  });

  it("rejects viewer-bound authoring while a sibling editor exists", async () => {
    const { runtime, space, handle } = mountFixture();
    const lease = unwrap(space.acquireEditorLease({ sessionId: "editor-session" }));
    const editor = unwrap(space.createView({ mode: "editor", lease }));
    const result = handle.view.commands.updateDraft(viewerFixtureDocument());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]?.code).toBe("VIEWER_READ_ONLY");
    }
    expect(editor.mode).toBe("editor");
    expect(handle.view.mode).toBe("viewer");
    unwrap(editor.dispose({ draftDecision: "cancel" }));
    unwrap(runtime.dispose());
  });

  it("preserves locale, timezone and draft state while updating the shell", async () => {
    const { runtime, space, handle } = mountFixture();
    await flush();
    const before = space.getSnapshot();
    const revision = before.committedRevision;
    const lease = unwrap(space.acquireEditorLease({ sessionId: "locale-session" }));
    const editor = unwrap(space.createView({ mode: "editor", lease }));
    const draft = { ...viewerFixtureDocument(), title: "Draft title" };
    unwrap(editor.commands.updateDraft(draft));
    const handleWithEditor = unwrap(
      mountBoardView(createTarget(createMiniDocument()) as unknown as HTMLElement, {
        space,
        view: editor,
        theme: "light",
      }),
    );
    await flush();
    const queryKeys = space.getQueryStates().map((query) => query.queryKey);
    const updated = handleWithEditor.update({
      locale: "de",
      timezone: "Europe/Berlin",
    });
    expect(updated.ok).toBe(true);
    await flush();
    const after = space.getSnapshot();
    expect(after.locale).toBe("de");
    expect(after.timezone).toBe("Europe/Berlin");
    expect(after.committedRevision).toBe(revision);
    expect(after.committedDocument.title).toBe("Assessment overview");
    expect(after.draft?.dirty).toBe(true);
    expect(after.draft?.document.title).toBe("Draft title");
    expect(rootOf(handleWithEditor).getAttribute("lang")).toBe("de");
    expect(rootOf(handleWithEditor).getAttribute("dir")).toBe("ltr");
    expect(space.getQueryStates().map((query) => query.queryKey)).toEqual(queryKeys);
    unwrap(handleWithEditor.unmount());
    expect(editor.disposed).toBe(false);
    unwrap(editor.dispose({ draftDecision: "cancel" }));
    unwrap(handle.unmount());
    unwrap(runtime.dispose());
  });
});

describe("T06 state coverage and cleanup", () => {
  it("shows a real loading state only while an async provider is pending", async () => {
    const local = createViewerProvider();
    const deferred: DatasetProvider = {
      providerId: local.providerId,
      listDatasetIds: () => local.listDatasetIds(),
      getDatasetDescriptor: (datasetId) => local.getDatasetDescriptor(datasetId),
      query: (request, context): Promise<DatasetQueryResult> =>
        new Promise((resolve) => {
          setTimeout(() => resolve(local.query(request, context) as DatasetQueryResult), 0);
        }),
    };
    const { handle } = mountFixture({ provider: deferred });
    expect(findByAttribute(rootOf(handle), "data-state", "loading").length).toBeGreaterThan(0);
    for (const details of findByClass(rootOf(handle), "bl-chart-data")) {
      expect(details.hasAttribute("hidden")).toBe(true);
    }
    await flush();
    expect(findByAttribute(rootOf(handle), "data-state", "loading")).toHaveLength(0);
    expect(findByAttribute(rootOf(handle), "data-state", "settled").length).toBeGreaterThan(0);
    for (const details of findByClass(rootOf(handle), "bl-chart-data")) {
      expect(details.hasAttribute("hidden")).toBe(false);
    }
    unwrap(handle.unmount());
  });

  it("distinguishes empty, error and stale query states", async () => {
    const empty = mountFixture({ provider: createViewerProvider([]) });
    await flush();
    expect(findByAttribute(rootOf(empty.handle), "data-state", "empty").length).toBeGreaterThan(0);
    expect(textByKey(rootOf(empty.handle), "state.empty.title")).toBe("No data for this scope");
    unwrap(empty.handle.unmount());
    unwrap(empty.runtime.dispose());

    const errorDocument = viewerFixtureDocument();
    const errorDataset = errorDocument.datasets[0];
    if (errorDataset) {
      (errorDataset.fields as Array<{ id: string; type: string; role: string }>).push({
        id: "missing_field",
        type: "number",
        role: "measure",
      });
    }
    const metric = errorDocument.blocks.find((block) => block.id === "block-metric");
    if (metric) {
      (metric.bindings?.[0]?.field as { fieldId: string }).fieldId = "missing_field";
    }
    const chart = errorDocument.blocks.find((block) => block.id === "block-chart");
    for (const binding of chart?.bindings ?? []) {
      if (binding.role === "measure") {
        (binding.field as { fieldId: string }).fieldId = "missing_field";
      }
    }
    const errorTarget = createTarget(createMiniDocument());
    const { runtime: errorRuntime } = createViewerRuntime(undefined, {
      withCatalog: false,
    });
    const errorSpace = unwrap(errorRuntime.createSpace({ document: errorDocument }));
    const errorHandle = unwrap(
      mountBoardView(errorTarget as unknown as HTMLElement, { space: errorSpace }),
    );
    await flush();
    expect(findByAttribute(rootOf(errorHandle), "data-state", "error").length).toBeGreaterThan(0);
    expect(
      findByAttribute(rootOf(errorHandle), "data-message-key", "diagnostic.INVALID_REFERENCE")
        .length,
    ).toBeGreaterThan(0);
    for (const details of findByClass(rootOf(errorHandle), "bl-chart-data")) {
      expect(details.hasAttribute("hidden")).toBe(true);
    }
    unwrap(errorHandle.unmount());
    unwrap(errorRuntime.dispose());

    const stale = mountFixture();
    await flush();
    const [query] = stale.space.getQueryStates();
    if (query) {
      unwrap(stale.space.invalidateQuery(query.queryId, "test-stale"));
    }
    await flush();
    expect(findByAttribute(rootOf(stale.handle), "data-state", "stale").length).toBeGreaterThan(0);
    expect(textByKey(rootOf(stale.handle), "state.stale.title")).toBe("Data may be out of date");
    unwrap(stale.handle.unmount());
    unwrap(stale.runtime.dispose());
  });

  it("renders partial and cancelled results distinctly", async () => {
    const truncated = unwrap(
      createLocalDatasetProvider({
        providerId: "viewer-fixture",
        datasets: [
          {
            descriptor: cloneAssessmentDescriptor({
              capabilities: {
                ...ASSESSMENT_DESCRIPTOR.capabilities,
                maxResultSize: 1,
              },
            }),
            rows: ASSESSMENT_ROWS,
          },
        ],
      }),
    );
    const partial = mountFixture({ provider: truncated });
    await flush();
    expect(findByAttribute(rootOf(partial.handle), "data-state", "partial").length).toBeGreaterThan(
      0,
    );
    expect(textByKey(rootOf(partial.handle), "state.partial.title")).toBe("Partial result");
    unwrap(partial.handle.unmount());
    unwrap(partial.runtime.dispose());

    const never: DatasetProvider = {
      providerId: "viewer-fixture-never",
      listDatasetIds: () => ["assessment-results"],
      getDatasetDescriptor: () => ASSESSMENT_DESCRIPTOR,
      query: () => new Promise<DatasetQueryResult>(() => undefined),
    };
    const pending = mountFixture({ provider: never });
    const firstQuery = pending.space.getQueryStates()[0];
    if (firstQuery) {
      unwrap(pending.space.cancelQuery(firstQuery.queryId, "test-cancel"));
    }
    await flush();
    expect(
      findByAttribute(rootOf(pending.handle), "data-state", "cancelled").length,
    ).toBeGreaterThan(0);
    expect(textByKey(rootOf(pending.handle), "state.cancelled.title")).toBe("Update cancelled");
    expect(textByKey(rootOf(pending.handle), "state.cancelled.body")).toBe(
      "No result was applied for this update",
    );
    for (const details of findByClass(rootOf(pending.handle), "bl-chart-data")) {
      expect(details.hasAttribute("hidden")).toBe(true);
    }
    unwrap(pending.handle.unmount());
    unwrap(pending.runtime.dispose());
  });

  it("keeps cancellation copy truthful after a settled result is superseded", async () => {
    const local = createViewerProvider();
    let pending = false;
    const provider: DatasetProvider = {
      providerId: local.providerId,
      listDatasetIds: () => local.listDatasetIds(),
      getDatasetDescriptor: (datasetId) => local.getDatasetDescriptor(datasetId),
      query: (request, context): DatasetQueryResult | Promise<DatasetQueryResult> => {
        if (pending) {
          return new Promise<DatasetQueryResult>(() => undefined);
        }
        return local.query(request, context) as DatasetQueryResult;
      },
    };
    const mounted = mountFixture({ provider });
    await flush();
    const query = mounted.space.getQueryStates()[0];
    expect(query?.phase).toBe("settled");
    if (!query) {
      return;
    }
    pending = true;
    unwrap(mounted.space.refreshQuery(query.queryId));
    unwrap(mounted.space.cancelQuery(query.queryId, "test-after-settled"));
    await flush();
    expect(textByKey(rootOf(mounted.handle), "state.cancelled.title")).toBe("Update cancelled");
    expect(textByKey(rootOf(mounted.handle), "state.cancelled.body")).toBe(
      "No result was applied for this update",
    );
    unwrap(mounted.handle.unmount());
    unwrap(mounted.runtime.dispose());
  });

  it("releases DOM listeners, query slots, observers and the view on unmount", async () => {
    const { document, runtime, space, handle } = mountFixture();
    await flush();
    const root = rootOf(handle);
    expect(root.listenerCount).toBeGreaterThan(0);
    expect(document.resizeObservers[0]?.targetCount).toBe(1);
    unwrap(handle.unmount());
    expect(root.listenerCount).toBe(0);
    expect(document.resizeObservers[0]?.targetCount).toBe(0);
    expect(space.viewCount).toBe(0);
    expect(space.getQueryStates()).toEqual([]);
    expect(space.disposed).toBe(false);
    unwrap(handle.unmount());
    unwrap(handle.dispose());
    unwrap(runtime.dispose());
  });
});

describe("T06 review-round regression coverage", () => {
  it("applies mount-time locale and timezone to an external space before first render", async () => {
    const { runtime } = createViewerRuntime();
    const space = unwrap(runtime.createSpace({ document: viewerFixtureDocument() }));
    const target = createTarget(createMiniDocument());
    const revision = space.getSnapshot().committedRevision;
    const handle = unwrap(
      mountBoardView(target as unknown as HTMLElement, {
        space,
        locale: "ar",
        timezone: "Asia/Riyadh",
      }),
    );
    await flush();
    const snapshot = space.getSnapshot();
    expect(snapshot.locale).toBe("ar");
    expect(snapshot.timezone).toBe("Asia/Riyadh");
    expect(snapshot.committedRevision).toBe(revision);
    expect(rootOf(handle).getAttribute("lang")).toBe("ar");
    expect(rootOf(handle).getAttribute("dir")).toBe("rtl");
    expect(rootOf(handle).getAttribute("data-boardloom-timezone")).toBe("Asia/Riyadh");
    unwrap(handle.unmount());
    unwrap(runtime.dispose());
  });

  it("applies successive messages-only updates without losing board or query state", async () => {
    const { runtime } = createViewerRuntime();
    const space = unwrap(runtime.createSpace({ document: viewerFixtureDocument() }));
    const target = createTarget(createMiniDocument());
    const handle = unwrap(
      mountBoardView(target as unknown as HTMLElement, {
        space,
        messages: { "mode.viewer": "First board label" },
      }),
    );
    await flush();
    const revision = space.getSnapshot().committedRevision;
    const block = findByClass(rootOf(handle), "bl-block")[0];
    expect(findByTag(rootOf(handle), "button")[0]?.textContent).toBe("First board label");
    expect(handle.update({ messages: { "mode.viewer": "Second board label" } }).ok).toBe(true);
    await flush();
    expect(findByTag(rootOf(handle), "button")[0]?.textContent).toBe("Second board label");
    expect(handle.update({ messages: { "mode.viewer": "Third board label" } }).ok).toBe(true);
    await flush();
    expect(findByTag(rootOf(handle), "button")[0]?.textContent).toBe("Third board label");
    expect(findByClass(rootOf(handle), "bl-block")[0]).toBe(block);
    expect(space.getSnapshot().committedRevision).toBe(revision);
    expect(space.getQueryStates()).toHaveLength(3);
    unwrap(handle.unmount());
    unwrap(runtime.dispose());
  });

  it("refreshes accessible region names and filter headings on dictionary updates", async () => {
    const first = {
      "a11y.boardRegion": "Board region one",
      "a11y.filterRegion": "Filter region one",
      "a11y.liveRegion": "Live region one",
      "viewer.filters.active": "Active filters one",
    };
    const second = {
      "a11y.boardRegion": "Board region two",
      "a11y.filterRegion": "Filter region two",
      "a11y.liveRegion": "Live region two",
      "viewer.filters.active": "Active filters two",
    };
    const document = createMiniDocument();
    const target = createTarget(document);
    const { runtime } = createViewerRuntime();
    const space = unwrap(runtime.createSpace({ document: viewerFixtureDocument() }));
    const handle = unwrap(
      mountBoardView(target as unknown as HTMLElement, { space, messages: first }),
    );
    await flush();
    const root = rootOf(handle);
    expect(findByClass(root, "bl-body")[0]?.getAttribute("aria-label")).toBe("Board region one");
    expect(findByClass(root, "bl-filters")[0]?.getAttribute("aria-label")).toBe(
      "Filter region one",
    );
    expect(findByClass(root, "bl-live")[0]?.getAttribute("aria-label")).toBe("Live region one");
    for (const heading of findByClass(root, "bl-overline")) {
      expect(heading.textContent).toBe("Active filters one");
    }
    expect(handle.update({ messages: second }).ok).toBe(true);
    await flush();
    expect(findByClass(root, "bl-body")[0]?.getAttribute("aria-label")).toBe("Board region two");
    expect(findByClass(root, "bl-filters")[0]?.getAttribute("aria-label")).toBe(
      "Filter region two",
    );
    expect(findByClass(root, "bl-live")[0]?.getAttribute("aria-label")).toBe("Live region two");
    for (const heading of findByClass(root, "bl-overline")) {
      expect(heading.textContent).toBe("Active filters two");
    }
    unwrap(handle.unmount());
    unwrap(runtime.dispose());
  });

  it("refreshes accessible names and headings on a locale change with host dictionaries", async () => {
    const runtime = createRuntime({
      datasetProvider: createViewerProvider(),
      messageDictionaries: {
        ar: {
          "a11y.boardRegion": "Board region ar",
          "a11y.filterRegion": "Filter region ar",
          "a11y.liveRegion": "Live region ar",
          "viewer.filters.active": "Active filters ar",
          "a11y.tableRegion": "Data table ar",
        },
      },
    });
    const space = unwrap(runtime.createSpace({ document: viewerFixtureDocument() }));
    const target = createTarget(createMiniDocument());
    const handle = unwrap(mountBoardView(target as unknown as HTMLElement, { space }));
    await flush();
    unwrap(handle.update({ locale: "ar" }));
    await flush();
    const root = rootOf(handle);
    expect(root.getAttribute("dir")).toBe("rtl");
    expect(findByClass(root, "bl-body")[0]?.getAttribute("aria-label")).toBe("Board region ar");
    expect(findByClass(root, "bl-filters")[0]?.getAttribute("aria-label")).toBe("Filter region ar");
    expect(findByClass(root, "bl-live")[0]?.getAttribute("aria-label")).toBe("Live region ar");
    for (const heading of findByClass(root, "bl-overline")) {
      expect(heading.textContent).toBe("Active filters ar");
    }
    unwrap(handle.unmount());
    unwrap(runtime.dispose());
  });

  it("announces localized diagnostic keys instead of raw diagnostic prose", async () => {
    const target = createTarget(createMiniDocument());
    const { runtime } = createViewerRuntime();
    const space = unwrap(runtime.createSpace({ document: viewerFixtureDocument() }));
    const handle = unwrap(
      mountBoardView(target as unknown as HTMLElement, {
        space,
        messages: { "diagnostic.EDITOR_LEASE_REQUIRED": "Lease required now" },
      }),
    );
    const failed = handle.setMode("editor");
    expect(failed.ok).toBe(false);
    const live = findByClass(rootOf(handle), "bl-live")[0];
    expect(live?.textContent).toBe("Lease required now");
    expect(live?.getAttribute("data-announcement-key")).toBe("diagnostic.EDITOR_LEASE_REQUIRED");
    unwrap(handle.unmount());
    unwrap(runtime.dispose());
  });

  it("hides chart data disclosures outside settled data states", async () => {
    const empty = mountFixture({ provider: createViewerProvider([]) });
    await flush();
    for (const details of findByClass(rootOf(empty.handle), "bl-chart-data")) {
      expect(details.hasAttribute("hidden")).toBe(true);
    }
    unwrap(empty.handle.unmount());
    unwrap(empty.runtime.dispose());

    const local = createViewerProvider();
    const deferred: DatasetProvider = {
      providerId: local.providerId,
      listDatasetIds: () => local.listDatasetIds(),
      getDatasetDescriptor: (datasetId) => local.getDatasetDescriptor(datasetId),
      query: () => new Promise<DatasetQueryResult>(() => undefined),
    };
    const pending = mountFixture({ provider: deferred });
    for (const details of findByClass(rootOf(pending.handle), "bl-chart-data")) {
      expect(details.hasAttribute("hidden")).toBe(true);
    }
    unwrap(pending.handle.unmount());
    unwrap(pending.runtime.dispose());
  });

  it("provides a localized fallback name for untitled table regions", async () => {
    const document = JSON.parse(JSON.stringify(viewerFixtureDocument())) as Record<string, unknown>;
    const blocks = document.blocks as Array<{ title?: string }>;
    for (const block of blocks) {
      delete block.title;
    }
    const target = createTarget(createMiniDocument());
    const { runtime } = createViewerRuntime();
    const space = unwrap(runtime.createSpace({ document }));
    const handle = unwrap(mountBoardView(target as unknown as HTMLElement, { space }));
    await flush();
    const captions = findByTag(rootOf(handle), "caption");
    expect(captions.length).toBe(2);
    for (const caption of captions) {
      expect(caption.textContent).toBe("Data table");
      expect(caption.getAttribute("data-message-key")).toBe("a11y.tableRegion");
    }
    for (const region of findByClass(rootOf(handle), "bl-table-region")) {
      expect(region.getAttribute("aria-labelledby")).not.toBeNull();
    }
    unwrap(handle.unmount());
    unwrap(runtime.dispose());
  });

  it("reconciles filter surfaces and empty scope text after committed document changes", async () => {
    const mounted = mountFixture({ provider: createViewerProvider([]) });
    await flush();
    const root = rootOf(mounted.handle);
    const initialScope = findByClass(root, "bl-state__scope")[0]?.textContent;
    expect(initialScope).toBe("School: north, south");

    const document = JSON.parse(JSON.stringify(viewerFixtureDocument())) as {
      filters: Array<Record<string, unknown>>;
      blocks: Array<{ id: string; config: Record<string, unknown> }>;
    };
    const schoolFilter = document.filters.find((filter) => filter.id === "filter-school");
    if (schoolFilter) {
      schoolFilter.label = "Campus";
      schoolFilter.defaultValue = ["east"];
    }
    document.filters.push({
      id: "filter-subject",
      label: "Subject",
      field: { datasetId: "assessment-results", fieldId: "subject" },
      operator: "equals",
      defaultValue: "math",
      target: { kind: "board" },
    });
    const filterBlock = document.blocks.find((block) => block.id === "block-filter");
    if (filterBlock) {
      filterBlock.config = { filterIds: ["filter-school", "filter-subject"] };
    }
    unwrap(mounted.space.loadDocument(document));
    await flush();
    expect(findByClass(root, "bl-state__scope")[0]?.textContent).toBe(
      "Campus: east; Subject: math",
    );
    const chipTexts = findByClass(root, "bl-filter-chip").map((chip) => chip.textContent);
    expect(chipTexts).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Campus"),
        expect.stringContaining("Subject"),
      ]),
    );

    const withoutSchool = JSON.parse(JSON.stringify(document)) as {
      filters: Array<Record<string, unknown>>;
      blocks: Array<{ id: string; config: Record<string, unknown> }>;
    };
    withoutSchool.filters = withoutSchool.filters.filter((filter) => filter.id !== "filter-school");
    const withoutSchoolBlock = withoutSchool.blocks.find((block) => block.id === "block-filter");
    if (withoutSchoolBlock) {
      withoutSchoolBlock.config = { filterIds: ["filter-subject"] };
    }
    unwrap(mounted.space.loadDocument(withoutSchool));
    await flush();
    expect(findByClass(root, "bl-state__scope")[0]?.textContent).toBe("Subject: math");
    expect(
      findByClass(root, "bl-filter-chip").some((chip) => chip.textContent?.includes("Campus")),
    ).toBe(false);
    unwrap(mounted.handle.unmount());
    unwrap(mounted.runtime.dispose());
  });

  it("preserves focused table region and scroll on theme and locale updates", async () => {
    const mounted = mountFixture();
    await flush();
    const region = findByClass(rootOf(mounted.handle), "bl-table-region")[0];
    expect(region).toBeDefined();
    if (!region) {
      return;
    }
    region.scrollTop = 42;
    region.scrollLeft = 7;
    region.focus();
    expect(mounted.document.activeElement).toBe(region);
    unwrap(mounted.handle.update({ theme: "dark" }));
    await flush();
    expect(findByClass(rootOf(mounted.handle), "bl-table-region")[0]).toBe(region);
    expect(mounted.document.activeElement).toBe(region);
    expect(region.scrollTop).toBe(42);
    unwrap(mounted.handle.update({ locale: "de" }));
    await flush();
    const updated = findByClass(rootOf(mounted.handle), "bl-table-region")[0];
    expect(updated).not.toBe(region);
    expect(mounted.document.activeElement).toBe(updated);
    expect(updated?.scrollTop).toBe(42);
    expect(updated?.scrollLeft).toBe(7);
    unwrap(mounted.handle.unmount());
    unwrap(mounted.runtime.dispose());
  });

  it("keeps numeric values and units in a stable order under Arabic RTL", async () => {
    const mounted = mountFixture();
    await flush();
    unwrap(mounted.handle.update({ locale: "ar" }));
    await flush();
    const root = rootOf(mounted.handle);
    expect(root.getAttribute("dir")).toBe("rtl");
    const metricNumeric = findByClass(root, "bl-numeric")[0];
    expect(metricNumeric?.getAttribute("dir")).toBe("ltr");
    const numericRuns = findByAttribute(root, "dir", "ltr");
    expect(numericRuns.length).toBeGreaterThan(1);
    unwrap(mounted.handle.unmount());
    unwrap(mounted.runtime.dispose());
  });

  it("rejects a second mount of the same live view and keeps query ownership independent", async () => {
    const { runtime } = createViewerRuntime();
    const space = unwrap(runtime.createSpace({ document: viewerFixtureDocument() }));
    const view = unwrap(space.createView({ mode: "viewer" }));
    const firstTarget = createTarget(createMiniDocument());
    const secondTarget = createTarget(createMiniDocument());
    const first = unwrap(mountBoardView(firstTarget as unknown as HTMLElement, { space, view }));
    const second = mountBoardView(secondTarget as unknown as HTMLElement, { space, view });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.diagnostics[0]?.code).toBe("INVALID_ARGUMENT");
    }
    expect(secondTarget.children).toHaveLength(0);
    expect(space.getQueryStates()).toHaveLength(3);
    unwrap(first.unmount());
    expect(space.getQueryStates()).toEqual([]);
    unwrap(view.dispose());
    unwrap(runtime.dispose());
  });

  it("cleans up mounted resources when the exposed core view is disposed directly", async () => {
    const { runtime } = createViewerRuntime();
    const space = unwrap(runtime.createSpace({ document: viewerFixtureDocument() }));
    const view = unwrap(space.createView({ mode: "viewer" }));
    const target = createTarget(createMiniDocument());
    const handle = unwrap(mountBoardView(target as unknown as HTMLElement, { space, view }));
    await flush();
    const listenersBefore = space.listenerCount;
    expect(handle.mounted).toBe(true);
    unwrap(view.dispose());
    expect(handle.mounted).toBe(false);
    expect(target.children).toHaveLength(0);
    expect(space.disposed).toBe(false);
    expect(space.getQueryStates()).toEqual([]);
    expect(space.listenerCount).toBeLessThan(listenersBefore);
    expect(handle.update().ok).toBe(false);
    unwrap(runtime.dispose());
  });

  it("cleans up partial mounts when subscription or formatter access fails", async () => {
    const { runtime } = createViewerRuntime();
    const space = unwrap(runtime.createSpace({ document: viewerFixtureDocument() }));
    const baselineListeners = space.listenerCount;

    const subscribeFailure = proxiedSpace(space, {
      subscribe: () => {
        throw new Error("synthetic subscribe failure");
      },
    });
    const firstTarget = createTarget(createMiniDocument());
    const first = mountBoardView(firstTarget as unknown as HTMLElement, {
      space: subscribeFailure,
    });
    expect(first.ok).toBe(false);
    expect(firstTarget.children).toHaveLength(0);
    expect(space.listenerCount).toBe(baselineListeners);
    expect(space.viewCount).toBe(0);
    expect(space.disposed).toBe(false);

    const formatterFailure = proxiedSpace(space, {
      getFormatters: () => {
        throw new Error("synthetic formatter failure");
      },
    });
    const secondTarget = createTarget(createMiniDocument());
    const second = mountBoardView(secondTarget as unknown as HTMLElement, {
      space: formatterFailure,
    });
    expect(second.ok).toBe(false);
    expect(secondTarget.children).toHaveLength(0);
    expect(space.listenerCount).toBe(baselineListeners);
    expect(space.viewCount).toBe(0);
    expect(space.disposed).toBe(false);

    const thirdTarget = createTarget(createMiniDocument());
    const localeFailure = mountBoardView(thirdTarget as unknown as HTMLElement, {
      space,
      locale: "ar",
      messages: { "mode.viewer": 1 } as never,
    });
    expect(localeFailure.ok).toBe(false);
    expect(thirdTarget.children).toHaveLength(0);
    expect(space.getSnapshot().locale).toBe("en");

    const fourthTarget = createTarget(createMiniDocument());
    const futureDictionaryFailure = mountBoardView(fourthTarget as unknown as HTMLElement, {
      space,
      locale: "de",
      messageDictionaries: { de: { "mode.viewer": 42 } } as never,
    });
    expect(futureDictionaryFailure.ok).toBe(false);
    expect(fourthTarget.children).toHaveLength(0);
    expect(space.getSnapshot().locale).toBe("en");

    const fifthTarget = createTarget(createMiniDocument());
    const fifth = unwrap(
      mountBoardView(fifthTarget as unknown as HTMLElement, { space, locale: "en" }),
    );
    const failedFutureDictionary = fifth.update({
      locale: "de",
      messageDictionaries: { de: { "mode.viewer": 42 } } as never,
    });
    expect(failedFutureDictionary.ok).toBe(false);
    expect(space.getSnapshot().locale).toBe("en");
    expect(rootOf(fifth).getAttribute("lang")).toBe("en");
    expect(rootOf(fifth).getAttribute("data-boardloom-instance")).toBe(fifth.element.id);
    unwrap(fifth.unmount());

    let reads = 0;
    const accessorDictionary = {
      get "mode.viewer"() {
        reads += 1;
        return "Accessor";
      },
    };
    const accessorFailure = mountBoardView(
      createTarget(createMiniDocument()) as unknown as HTMLElement,
      {
        space,
        messageDictionaries: { de: accessorDictionary } as never,
      },
    );
    expect(accessorFailure.ok).toBe(false);
    expect(reads).toBe(0);
    const arrayFailure = mountBoardView(
      createTarget(createMiniDocument()) as unknown as HTMLElement,
      {
        space,
        messageDictionaries: { de: ["Mode"] } as never,
      },
    );
    expect(arrayFailure.ok).toBe(false);
    expect(space.getSnapshot().locale).toBe("en");

    const diagnosticsTarget = createTarget(createMiniDocument());
    const diagnosticsHandle = unwrap(
      mountBoardView(diagnosticsTarget as unknown as HTMLElement, {
        space,
        messageDictionaries: { en: { "host.custom": "Custom view copy" } },
      }),
    );
    expect(
      diagnosticsHandle.messageDiagnostics.some(
        (diagnostic) => diagnostic.code === "MESSAGE_UNKNOWN_KEY",
      ),
    ).toBe(true);
    unwrap(diagnosticsHandle.unmount());
    unwrap(runtime.dispose());
  });

  it("validates runtime-option dictionaries when view-level dictionaries are also supplied", async () => {
    const invalidCases: readonly unknown[] = [
      { de: { "mode.viewer": 42 } },
      { sv: { "mode.viewer": "Mode" } },
      { de: ["Mode"] },
    ];
    for (const invalid of invalidCases) {
      const target = createTarget(createMiniDocument());
      const mounted = mountBoardView(target as unknown as HTMLElement, {
        document: viewerFixtureDocument(),
        runtimeOptions: {
          messageDictionaries: invalid as never,
        },
        messageDictionaries: { en: { "host.custom": "Custom" } },
      });
      expect(mounted.ok).toBe(false);
      expect(target.children).toHaveLength(0);
    }
    let reads = 0;
    const accessor = {
      get "mode.viewer"() {
        reads += 1;
        return "Accessor";
      },
    };
    const target = createTarget(createMiniDocument());
    const mounted = mountBoardView(target as unknown as HTMLElement, {
      document: viewerFixtureDocument(),
      runtimeOptions: { messageDictionaries: { de: accessor } as never },
      messageDictionaries: { en: { "host.custom": "Custom" } },
    });
    expect(mounted.ok).toBe(false);
    expect(reads).toBe(0);
    expect(target.children).toHaveLength(0);
  });

  it("fails and cleans up when onEvent disposes the view during initial rendering", async () => {
    const { runtime } = createViewerRuntime();
    const space = unwrap(runtime.createSpace({ document: viewerFixtureDocument() }));
    const view = unwrap(space.createView({ mode: "viewer" }));
    const document = createMiniDocument();
    const target = createTarget(document);
    const baselineListeners = space.listenerCount;
    const result = mountBoardView(target as unknown as HTMLElement, {
      space,
      view,
      onEvent: (event) => {
        if (event.type === "query:started") {
          view.dispose();
        }
      },
    });
    expect(result.ok).toBe(false);
    expect(view.disposed).toBe(true);
    expect(target.children).toHaveLength(0);
    expect(space.disposed).toBe(false);
    expect(space.getQueryStates()).toEqual([]);
    expect(space.listenerCount).toBe(baselineListeners);
    expect(document.resizeObservers[0]?.targetCount ?? 0).toBe(0);
    unwrap(runtime.dispose());
  });

  it("fails and cleans up when onEvent disposes the space during initial rendering", async () => {
    const { runtime } = createViewerRuntime();
    const space = unwrap(runtime.createSpace({ document: viewerFixtureDocument() }));
    const target = createTarget(createMiniDocument());
    const result = mountBoardView(target as unknown as HTMLElement, {
      space,
      onEvent: (event) => {
        if (event.type === "query:started") {
          space.dispose();
        }
      },
    });
    expect(result.ok).toBe(false);
    expect(target.children).toHaveLength(0);
    expect(space.disposed).toBe(true);
    expect(space.getQueryStates()).toEqual([]);
    unwrap(runtime.dispose());
  });

  it("observes a dispose callback captured before mounting", async () => {
    const { runtime } = createViewerRuntime();
    const space = unwrap(runtime.createSpace({ document: viewerFixtureDocument() }));
    const view = unwrap(space.createView({ mode: "viewer" }));
    const cachedDispose = view.dispose.bind(view);
    const target = createTarget(createMiniDocument());
    const handle = unwrap(mountBoardView(target as unknown as HTMLElement, { space, view }));
    await flush();
    expect(handle.mounted).toBe(true);
    unwrap(cachedDispose());
    expect(handle.mounted).toBe(false);
    expect(view.disposed).toBe(true);
    expect(target.children).toHaveLength(0);
    expect(space.disposed).toBe(false);
    expect(space.getQueryStates()).toEqual([]);
    expect(handle.update().ok).toBe(false);
    unwrap(runtime.dispose());
  });

  it("stops a later document-driven render immediately after reentrant view disposal", async () => {
    const { runtime } = createViewerRuntime();
    const space = unwrap(runtime.createSpace({ document: viewerFixtureDocument() }));
    const view = unwrap(space.createView({ mode: "viewer" }));
    const documentTarget = createMiniDocument();
    const target = createTarget(documentTarget);
    const baselineListeners = space.listenerCount;
    let armed = false;
    const handle = unwrap(
      mountBoardView(target as unknown as HTMLElement, {
        space,
        view,
        onEvent: (event) => {
          if (armed && event.type === "query:started") {
            view.dispose();
          }
        },
      }),
    );
    await flush();
    const mountedListeners = space.listenerCount;
    expect(mountedListeners).toBeGreaterThan(baselineListeners);
    armed = true;
    const document = JSON.parse(JSON.stringify(viewerFixtureDocument())) as {
      filters: Array<Record<string, unknown>>;
    };
    const filter = document.filters.find((entry) => entry.id === "filter-school");
    if (filter) {
      filter.defaultValue = ["east"];
    }
    unwrap(space.loadDocument(document));
    await flush();
    expect(handle.mounted).toBe(false);
    expect(view.disposed).toBe(true);
    expect(target.children).toHaveLength(0);
    expect(space.disposed).toBe(false);
    expect(space.getQueryStates()).toEqual([]);
    unwrap(runtime.dispose());
  });

  it("announces failed combined updates through the new locale, timezone and dictionary", async () => {
    const runtime = createRuntime({
      datasetProvider: createViewerProvider(),
      messageDictionaries: {
        ar: {
          "diagnostic.EDITOR_LEASE_REQUIRED": "Lease required in Arabic context",
        },
      },
    });
    const space = unwrap(runtime.createSpace({ document: viewerFixtureDocument() }));
    const target = createTarget(createMiniDocument());
    const handle = unwrap(mountBoardView(target as unknown as HTMLElement, { space }));
    await flush();
    const revision = space.getSnapshot().committedRevision;
    const failed = handle.update({
      locale: "ar",
      timezone: "Asia/Riyadh",
      mode: "editor",
    });
    expect(failed.ok).toBe(false);
    const snapshot = space.getSnapshot();
    expect(snapshot.locale).toBe("ar");
    expect(snapshot.timezone).toBe("Asia/Riyadh");
    expect(snapshot.committedRevision).toBe(revision);
    expect(handle.view.mode).toBe("viewer");
    expect(rootOf(handle).getAttribute("lang")).toBe("ar");
    expect(rootOf(handle).getAttribute("dir")).toBe("rtl");
    expect(rootOf(handle).getAttribute("data-boardloom-timezone")).toBe("Asia/Riyadh");
    const live = findByClass(rootOf(handle), "bl-live")[0];
    expect(live?.textContent).toBe("Lease required in Arabic context");
    expect(live?.getAttribute("data-announcement-key")).toBe("diagnostic.EDITOR_LEASE_REQUIRED");

    const failedAgain = handle.update({
      messages: { "diagnostic.EDITOR_LEASE_REQUIRED": "Updated lease failure" },
      mode: "editor",
    });
    expect(failedAgain.ok).toBe(false);
    expect(findByClass(rootOf(handle), "bl-live")[0]?.textContent).toBe("Updated lease failure");
    expect(space.getSnapshot().committedRevision).toBe(revision);
    unwrap(handle.unmount());
    unwrap(runtime.dispose());
  });

  it("localizes the editor notice for a rejected mode change in a complete locale", async () => {
    const { runtime } = createViewerRuntime();
    const space = unwrap(runtime.createSpace({ document: viewerFixtureDocument() }));
    const target = createTarget(createMiniDocument());
    const handle = unwrap(mountBoardView(target as unknown as HTMLElement, { space }));
    await flush();
    const failed = handle.update({ locale: "ja", mode: "editor" });
    expect(failed.ok).toBe(false);
    const notice = findByClass(rootOf(handle), "bl-editor-notice")[0];
    expect(notice?.textContent).toBe(BUILT_IN_DICTIONARIES.ja["diagnostic.EDITOR_LEASE_REQUIRED"]);
    expect(notice?.textContent).not.toBe(ENGLISH_MESSAGES["diagnostic.EDITOR_LEASE_REQUIRED"]);
    unwrap(handle.unmount());
    unwrap(runtime.dispose());
  });

  it("rolls back a deferred external mount after a refresh formatter throw", async () => {
    const { runtime } = createViewerRuntime();
    const space = unwrap(runtime.createSpace({ document: viewerFixtureDocument() }));
    const lease = unwrap(space.acquireEditorLease({ sessionId: "refresh-throw" }));
    const view = unwrap(space.createView({ mode: "viewer" }));
    const baselineListeners = space.listenerCount;
    let formatterCalls = 0;
    const failing = proxiedSpace(space, {
      getFormatters: () => {
        formatterCalls += 1;
        if (formatterCalls > 1) {
          throw new Error("synthetic refresh formatter failure");
        }
        return space.getFormatters();
      },
    });
    const target = createTarget(createMiniDocument());
    const result = mountBoardView(target as unknown as HTMLElement, {
      space: failing,
      view,
      mode: "editor",
      lease,
    });
    expect(result.ok).toBe(false);
    expect(view.mode).toBe("viewer");
    expect(view.getSnapshot().sessionId).toBeNull();
    expect(target.children).toHaveLength(0);
    expect(space.getQueryStates()).toEqual([]);
    expect(space.listenerCount).toBe(baselineListeners);
    expect(space.disposed).toBe(false);
    expect(space.getSnapshot().editorLease?.leaseId).toBe(lease.leaseId);

    const retry = unwrap(mountBoardView(target as unknown as HTMLElement, { space, view }));
    await flush();
    expect(retry.mounted).toBe(true);
    unwrap(retry.unmount());
    unwrap(view.dispose());
    unwrap(runtime.dispose());
  });

  it("reports an explicit diagnostic when external view restoration itself fails", async () => {
    const { runtime } = createViewerRuntime();
    const space = unwrap(runtime.createSpace({ document: viewerFixtureDocument() }));
    const lease = unwrap(space.acquireEditorLease({ sessionId: "restore-failure" }));
    const view = unwrap(space.createView({ mode: "editor", lease }));
    let formatterCalls = 0;
    const failing = proxiedSpace(space, {
      getFormatters: () => {
        formatterCalls += 1;
        if (formatterCalls > 1) {
          throw new Error("synthetic refresh formatter failure");
        }
        return space.getFormatters();
      },
    });
    const target = createTarget(createMiniDocument());
    const result = mountBoardView(target as unknown as HTMLElement, {
      space: failing,
      view,
      mode: "viewer",
      onEvent: (event) => {
        if (event.type === "mode:changed") {
          space.releaseEditorLease(lease, { decision: "cancel" });
        }
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
        "VIEW_SESSION_RESTORE_FAILED",
      );
    }
    expect(target.children).toHaveLength(0);
    expect(space.disposed).toBe(false);
    expect(space.getQueryStates()).toEqual([]);
    unwrap(view.dispose());
    unwrap(runtime.dispose());
  });

  it("rejects unsupported external view wrappers before changing mode or session", async () => {
    const editorCase = createViewerRuntime();
    const editorSpace = unwrap(
      editorCase.runtime.createSpace({ document: viewerFixtureDocument() }),
    );
    const editorLease = unwrap(editorSpace.acquireEditorLease({ sessionId: "wrapper-editor" }));
    const editorView = unwrap(editorSpace.createView({ mode: "editor", lease: editorLease }));
    const editorWrapper = wrapView(editorView);
    const editorTarget = createTarget(createMiniDocument());
    const editorResult = mountBoardView(editorTarget as unknown as HTMLElement, {
      space: editorSpace,
      view: editorWrapper,
      mode: "viewer",
    });
    expect(editorResult.ok).toBe(false);
    if (!editorResult.ok) {
      expect(editorResult.diagnostics[0]?.code).toBe("VIEW_SESSION_RESTORE_FAILED");
    }
    expect(editorView.mode).toBe("editor");
    expect(editorView.getSnapshot().leaseId).toBe(editorLease.leaseId);
    expect(editorSpace.getSnapshot().editorLease?.leaseId).toBe(editorLease.leaseId);
    expect(editorTarget.children).toHaveLength(0);
    const editorRetry = unwrap(
      mountBoardView(editorTarget as unknown as HTMLElement, {
        space: editorSpace,
        view: editorWrapper,
      }),
    );
    await flush();
    expect(editorRetry.mounted).toBe(true);
    unwrap(editorRetry.unmount());
    unwrap(editorView.dispose({ draftDecision: "cancel" }));
    unwrap(editorCase.runtime.dispose());

    const viewerCase = createViewerRuntime();
    const viewerSpace = unwrap(
      viewerCase.runtime.createSpace({ document: viewerFixtureDocument() }),
    );
    const viewerLease = unwrap(viewerSpace.acquireEditorLease({ sessionId: "wrapper-viewer" }));
    const viewerView = unwrap(viewerSpace.createView({ mode: "viewer", lease: viewerLease }));
    const viewerWrapper = wrapView(viewerView);
    const viewerTarget = createTarget(createMiniDocument());
    const viewerResult = mountBoardView(viewerTarget as unknown as HTMLElement, {
      space: viewerSpace,
      view: viewerWrapper,
      mode: "editor",
      lease: viewerLease,
    });
    expect(viewerResult.ok).toBe(false);
    if (!viewerResult.ok) {
      expect(viewerResult.diagnostics[0]?.code).toBe("VIEW_SESSION_RESTORE_FAILED");
    }
    expect(viewerView.mode).toBe("viewer");
    expect(viewerView.getSnapshot().leaseId).toBe(viewerLease.leaseId);
    expect(viewerSpace.getSnapshot().editorLease?.leaseId).toBe(viewerLease.leaseId);
    expect(viewerTarget.children).toHaveLength(0);
    unwrap(viewerView.dispose());
    unwrap(viewerCase.runtime.dispose());
  });

  it("rolls back a deferred external mount when a supplied view setMode throws", async () => {
    const { runtime } = createViewerRuntime();
    const space = unwrap(runtime.createSpace({ document: viewerFixtureDocument() }));
    const lease = unwrap(space.acquireEditorLease({ sessionId: "setmode-throw" }));
    const view = unwrap(space.createView({ mode: "viewer" }));
    const failingView = new Proxy(view, {
      get(target, property) {
        if (property === "setMode") {
          return (mode: string, options?: { readonly lease?: unknown }) => {
            if (mode === "editor") {
              throw new Error("synthetic setMode failure");
            }
            return target.setMode(mode as "viewer", options as never);
          };
        }
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const target = createTarget(createMiniDocument());
    const result = mountBoardView(target as unknown as HTMLElement, {
      space,
      view: failingView,
      mode: "editor",
      lease,
    });
    expect(result.ok).toBe(false);
    expect(view.mode).toBe("viewer");
    expect(view.getSnapshot().sessionId).toBeNull();
    expect(target.children).toHaveLength(0);
    expect(space.getQueryStates()).toEqual([]);

    const retry = unwrap(
      mountBoardView(target as unknown as HTMLElement, { space, view: failingView }),
    );
    await flush();
    expect(retry.mounted).toBe(true);
    unwrap(retry.unmount());
    unwrap(view.dispose());
    unwrap(runtime.dispose());
  });

  it("rejects public operations re-entering from a disposal callback during unmount", async () => {
    for (const withLease of [false, true]) {
      const { runtime } = createViewerRuntime();
      const space = unwrap(runtime.createSpace({ document: viewerFixtureDocument() }));
      const lease = withLease
        ? unwrap(space.acquireEditorLease({ sessionId: "unmount-reentry" }))
        : null;
      const target = createTarget(createMiniDocument());
      let handleRef: BoardViewHandle | null = null;
      let entered = false;
      const calls: {
        update?: ReturnType<BoardViewHandle["update"]>;
        setMode?: ReturnType<BoardViewHandle["setMode"]>;
        focus?: ReturnType<BoardViewHandle["focus"]>;
        unmount?: ReturnType<BoardViewHandle["unmount"]>;
      } = {};
      const handle = unwrap(
        mountBoardView(target as unknown as HTMLElement, {
          space,
          ...(lease === null ? {} : { mode: "editor" as const, lease }),
          onEvent: (event) => {
            if (event.type === "view:disposed" && !entered) {
              entered = true;
              if (handleRef !== null) {
                calls.update = handleRef.update({ theme: "dark" });
                handleRef.refresh();
                calls.setMode = handleRef.setMode("viewer");
                calls.focus = handleRef.focus();
                calls.unmount = handleRef.unmount();
              }
            }
          },
        }),
      );
      handleRef = handle;
      await flush();
      unwrap(handle.unmount());
      expect(entered).toBe(true);
      expect(calls.update?.ok).toBe(false);
      expect(calls.setMode?.ok).toBe(false);
      expect(calls.focus?.ok).toBe(false);
      expect(calls.unmount?.ok).toBe(true);
      expect(target.children).toHaveLength(0);
      expect(space.viewCount).toBe(0);
      expect(space.getQueryStates()).toEqual([]);
      expect(space.getSnapshot().editorLease).toBeNull();
      unwrap(runtime.dispose());
    }
  });

  it("preserves an external view mode and session when an earlier mount step fails", async () => {
    const { runtime } = createViewerRuntime();
    const space = unwrap(runtime.createSpace({ document: viewerFixtureDocument() }));
    const lease = unwrap(space.acquireEditorLease({ sessionId: "mode-preserve" }));
    const view = unwrap(space.createView({ mode: "viewer" }));
    const target = createTarget(createMiniDocument());

    const invalidMessages = mountBoardView(target as unknown as HTMLElement, {
      space,
      view,
      mode: "editor",
      lease,
      messages: { "mode.viewer": 1 } as never,
    });
    expect(invalidMessages.ok).toBe(false);
    expect(view.mode).toBe("viewer");
    expect(view.getSnapshot().sessionId).toBeNull();
    expect(target.children).toHaveLength(0);

    const invalidRegistry = mountBoardView(target as unknown as HTMLElement, {
      space,
      view,
      mode: "editor",
      lease,
      blockTypes: [
        {
          type: "text",
          version: "1.0.0",
          createSurface: () => {
            throw new Error("must not run");
          },
        },
      ],
    });
    expect(invalidRegistry.ok).toBe(false);
    expect(view.mode).toBe("viewer");
    expect(view.getSnapshot().sessionId).toBeNull();
    expect(target.children).toHaveLength(0);

    const formatterFailure = proxiedSpace(space, {
      getFormatters: () => {
        throw new Error("synthetic formatter failure");
      },
    });
    const constructorFailure = mountBoardView(target as unknown as HTMLElement, {
      space: formatterFailure,
      view,
      mode: "editor",
      lease,
    });
    expect(constructorFailure.ok).toBe(false);
    expect(view.mode).toBe("viewer");
    expect(view.getSnapshot().sessionId).toBeNull();
    expect(target.children).toHaveLength(0);

    const modeFailure = mountBoardView(target as unknown as HTMLElement, {
      space,
      view,
      mode: "editor",
    });
    expect(modeFailure.ok).toBe(false);
    expect(view.mode).toBe("viewer");
    expect(view.getSnapshot().sessionId).toBeNull();
    expect(target.children).toHaveLength(0);

    const mounted = unwrap(mountBoardView(target as unknown as HTMLElement, { space, view }));
    await flush();
    expect(mounted.view.mode).toBe("viewer");
    unwrap(mounted.unmount());
    unwrap(view.dispose());
    unwrap(runtime.dispose());
  });

  it("honors vertical placement and row spans in the grid contract", async () => {
    const mounted = mountFixture();
    await flush();
    const blocks = findByClass(rootOf(mounted.handle), "bl-block");
    for (const block of blocks) {
      expect(block.style.getPropertyValue("--bl-placement-y")).not.toBe("");
      expect(block.style.getPropertyValue("--bl-placement-height")).not.toBe("");
    }
    expect(
      findByClass(rootOf(mounted.handle), "bl-board-grid")[0]?.style.getPropertyValue(
        "--bl-grid-row-unit",
      ),
    ).not.toBe("");
    unwrap(mounted.handle.unmount());
    unwrap(mounted.runtime.dispose());
  });

  describe("T08 label binding query coherence", () => {
    it("keeps an ignored chart label out of grouping and chart data rows", async () => {
      const base = viewerFixtureDocument();
      const labelled = {
        ...base,
        blocks: base.blocks.map((block) =>
          block.id === "block-chart"
            ? {
                ...block,
                bindings: [
                  {
                    id: "chart-label",
                    role: "label" as const,
                    field: { datasetId: "assessment-results", fieldId: "subject" },
                    sliceId: "all-results",
                  },
                  ...(block.bindings ?? []),
                ],
              }
            : block,
        ),
      } as unknown as BoardDocument;
      const mounted = mountFixture({ document: labelled });
      await flush();
      const chartBlock = findByAttribute(rootOf(mounted.handle), "data-block-id", "block-chart")[0];
      expect(chartBlock).toBeDefined();
      if (chartBlock === undefined) {
        return;
      }
      const chartRows = findByTag(chartBlock, "tr").length - 1;
      expect(chartRows).toBe(2);
      expect(
        findByAttribute(chartBlock, "data-severity", "error").filter((element) =>
          element.textContent?.includes("RENDERER_DUPLICATE_POINT"),
        ),
      ).toHaveLength(0);
      expect(
        findByAttribute(rootOf(mounted.handle), "data-severity", "error").some((element) =>
          element.textContent?.includes("RENDERER_DUPLICATE_POINT"),
        ),
      ).toBe(false);
      unwrap(mounted.handle.unmount());
      unwrap(mounted.runtime.dispose());
    });
  });
});
