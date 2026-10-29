import { describe, expect, it } from "vitest";
import {
  BLOCK_EXTENSION_API_VERSION,
  RENDERER_API_VERSION,
  createRuntime,
  type BoardDocumentV1,
  type JsonValue,
  type RendererDefinition,
} from "../../../../packages/core/src/index.js";
import {
  REFERENCE_BLOCK_TYPE,
  REFERENCE_RENDERER_ID,
  createReferencePlugin,
} from "../../../../packages/view-dom/src/reference-plugin.js";
import { mountBoardView } from "../../../../packages/view-dom/src/mount.js";
import {
  createBoardloomExtensions,
  type BoardloomExtensions,
} from "../../../../packages/view-dom/src/extensions.js";
import { createViewMessages } from "../../../../packages/view-dom/src/messages.js";
import { ViewerHost } from "../../../../packages/view-dom/src/viewer.js";
import { unwrap } from "../../core/support/assertions.js";
import {
  createMiniDocument,
  findByAttribute,
  findByClass,
  type MiniElement,
} from "../support/mini-dom.js";
import { createViewerProvider, viewerFixtureDocument } from "../support/fixture.js";

const REFERENCE_PLUGIN_BLOCK = createReferencePlugin().blockTypes[0]!;
const REFERENCE_PLUGIN_RENDERER = createReferencePlugin().renderers.find(
  (definition) => definition.id === REFERENCE_RENDERER_ID,
)!;

function pluginDocument(values: JsonValue): BoardDocumentV1 {
  const base = viewerFixtureDocument();
  return {
    ...base,
    blocks: [
      {
        id: "plugin-good",
        type: REFERENCE_BLOCK_TYPE,
        title: "Plugin good",
        bindings: [],
        config: { title: "Good plugin", values: [3, 6, 9] },
      },
      {
        id: "plugin-bad",
        type: REFERENCE_BLOCK_TYPE,
        title: "Plugin bad",
        bindings: [],
        config: { title: "Bad plugin", values },
      },
      {
        id: "note",
        type: "text",
        title: "Note",
        bindings: [],
        config: { text: "Surviving text block" },
      },
    ],
    filters: [],
    layout: {
      desktop: {
        columns: 12,
        rowHeight: 32,
        placements: [
          { blockId: "plugin-good", x: 0, y: 0, width: 4, height: 3 },
          { blockId: "plugin-bad", x: 4, y: 0, width: 4, height: 3 },
          { blockId: "note", x: 8, y: 0, width: 4, height: 1 },
        ],
      },
    },
  };
}

function mountPluginHost(
  values: JsonValue,
  accent?: string,
  sharedDocument?: ReturnType<typeof createMiniDocument>,
): {
  readonly host: ViewerHost;
  readonly runtime: ReturnType<typeof createRuntime>;
  readonly extensions: BoardloomExtensions;
  readonly document: ReturnType<typeof createMiniDocument>;
} {
  const document = sharedDocument ?? createMiniDocument();
  const target = document.createElement("div");
  target.clientWidth = 1440;
  document.body.append(target);
  const plugin = accent === undefined ? createReferencePlugin() : createReferencePlugin({ accent });
  const extensions = unwrap(createBoardloomExtensions(plugin));
  const runtime = createRuntime({
    datasetProvider: createViewerProvider(),
    blockTypes: [REFERENCE_BLOCK_TYPE],
    extensions: extensions.core,
  });
  const space = unwrap(
    runtime.createSpace({
      document: pluginDocument(values),
      extensionSelection: { themes: ["reference.theme"] },
    }),
  );
  const view = unwrap(space.createView({ mode: "viewer" }));
  const host = new ViewerHost(
    target as unknown as HTMLElement,
    space,
    view,
    runtime,
    { ownsRuntime: false, ownsSpace: false, ownsView: false },
    extensions.blocks,
    extensions.renderers,
    createViewMessages({ provider: space.getMessageProvider() }),
    { ownedExtensions: extensions },
  );
  return { host, runtime, extensions, document };
}

describe("T13 plugin lifecycle and containment", () => {
  it("renders the reference block, contains a malformed block, and disposes styles", () => {
    const mounted = mountPluginHost("not-an-array");
    const root = mounted.host.element as unknown as MiniElement;
    expect(findByClass(root, "bl-block")).toHaveLength(3);
    expect(findByClass(root, "plugin-reference")).toHaveLength(2);
    expect(findByClass(root, "plugin-reference-bars")).toHaveLength(1);
    const badBlock = findByAttribute(root, "data-block-id", "plugin-bad")[0];
    expect(badBlock).toBeDefined();
    expect(findByClass(badBlock as MiniElement, "bl-state--error")).toHaveLength(1);
    expect(root.textContent).toContain("Surviving text block");
    expect(root.textContent).toContain("Good plugin");

    const styles = mounted.document.body.children.filter(
      (element) => element.getAttribute("data-boardloom-plugin-styles") === "true",
    );
    expect(styles).toHaveLength(1);
    const scope = mounted.host.element.getAttribute("data-boardloom-scope");
    expect(scope).not.toBeNull();
    expect(styles[0]?.textContent).toContain(`[data-boardloom-scope="${scope}"]`);
    expect(styles[0]?.textContent).toContain("plugin-reference-bars__fill");

    unwrap(mounted.host.unmount());
    expect(root.parentNode).toBeNull();
    expect(
      mounted.document.body.children.filter(
        (element) => element.getAttribute("data-boardloom-plugin-styles") === "true",
      ),
    ).toHaveLength(0);
    expect(mounted.extensions.disposed).toBe(true);
    unwrap(mounted.runtime.dispose());
  });

  it("keeps two plugin instances on separate style scopes and theme tokens", () => {
    const first = mountPluginHost([1, 2, 3], "#aa0000");
    const second = mountPluginHost([4, 5, 6], "#0000aa", first.document);
    const firstRoot = first.host.element as unknown as MiniElement;
    const secondRoot = second.host.element as unknown as MiniElement;
    const firstScope = firstRoot.getAttribute("data-boardloom-scope");
    const secondScope = secondRoot.getAttribute("data-boardloom-scope");
    expect(firstScope).not.toBe(secondScope);
    const styles = first.document.body.children.filter(
      (element) => element.getAttribute("data-boardloom-plugin-styles") === "true",
    );
    expect(styles).toHaveLength(2);
    const firstStyle = styles.find(
      (element) => element.getAttribute("data-boardloom-scope") === firstScope,
    );
    const secondStyle = styles.find(
      (element) => element.getAttribute("data-boardloom-scope") === secondScope,
    );
    expect(firstStyle?.textContent).toContain("#aa0000");
    expect(firstStyle?.textContent).not.toContain("#0000aa");
    expect(secondStyle?.textContent).toContain("#0000aa");
    expect(secondStyle?.textContent).not.toContain("#aa0000");
    expect(firstRoot.style.getPropertyValue("--bl-ext-reference-accent")).toBe("#aa0000");
    expect(secondRoot.style.getPropertyValue("--bl-ext-reference-accent")).toBe("#0000aa");
    unwrap(first.host.unmount());
    unwrap(second.host.unmount());
    unwrap(first.runtime.dispose());
    unwrap(second.runtime.dispose());
  });

  it("contains a throwing custom renderer to its chart block", async () => {
    const document = createMiniDocument();
    const target = document.createElement("div");
    target.clientWidth = 1440;
    document.body.append(target);
    const base = viewerFixtureDocument();
    const chartBlock = base.blocks.find((block) => block.type === "chart");
    expect(chartBlock).toBeDefined();
    if (chartBlock === undefined) {
      return;
    }
    const board: BoardDocumentV1 = {
      ...base,
      blocks: [
        chartBlock,
        {
          id: "note",
          type: "text",
          title: "Note",
          bindings: [],
          config: { text: "Renderer failure must not affect this block" },
        },
      ],
      filters: [],
      layout: {
        desktop: {
          columns: 12,
          rowHeight: 32,
          placements: [
            { blockId: chartBlock.id, x: 0, y: 0, width: 6, height: 4 },
            { blockId: "note", x: 6, y: 0, width: 6, height: 2 },
          ],
        },
      },
    };
    const broken: RendererDefinition<HTMLElement> = {
      id: "plugin.broken-renderer",
      version: "1.0.0",
      apiVersion: RENDERER_API_VERSION,
      kind: "chart",
      visualizations: ["bar"],
      capabilities: {
        kinds: ["chart"],
        visualizations: ["bar"],
        aggregation: ["average"],
        comparison: false,
        series: false,
        stacking: "rejected",
        zeroBaseline: "visible",
        negativeValues: "supported",
        accessibility: true,
      },
      validate: () => ({ ok: true, diagnostics: [] }),
      mount: () => {
        throw new Error("custom renderer exploded");
      },
    };
    const extensions = unwrap(createBoardloomExtensions({ renderers: [broken] }));
    const runtime = createRuntime({ datasetProvider: createViewerProvider() });
    const space = unwrap(runtime.createSpace({ document: board }));
    const view = unwrap(space.createView({ mode: "viewer" }));
    const host = new ViewerHost(
      target as unknown as HTMLElement,
      space,
      view,
      runtime,
      { ownsRuntime: false, ownsSpace: false, ownsView: false },
      extensions.blocks,
      extensions.renderers,
      createViewMessages({ provider: space.getMessageProvider() }),
      { ownedExtensions: extensions },
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    const root = host.element as unknown as MiniElement;
    expect(findByClass(root, "bl-block")).toHaveLength(2);
    expect(root.textContent).toContain("Renderer failure must not affect this block");
    const chart = findByAttribute(root, "data-block-id", chartBlock.id)[0];
    expect(chart).toBeDefined();
    expect(findByClass(chart as MiniElement, "bl-state--error").length).toBeGreaterThan(0);
    unwrap(host.unmount());
    unwrap(runtime.dispose());
  });
  it("contains a malformed block surface at the public mount boundary", () => {
    const document = createMiniDocument();
    const target = document.createElement("div");
    target.clientWidth = 1440;
    document.body.append(target);
    const malformed = {
      type: "plugin.null-surface",
      version: "1.0.0",
      apiVersion: BLOCK_EXTENSION_API_VERSION,
      createSurface: () => undefined as never,
    };
    const extensions = unwrap(createBoardloomExtensions({ blockTypes: [malformed] }));
    const board: BoardDocumentV1 = {
      schemaVersion: 1,
      id: "malformed-surface-board",
      title: "Malformed surface board",
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_060_000,
      theme: { mode: "light" },
      datasets: [],
      slices: [],
      filterGroups: [],
      filters: [],
      comparisons: [],
      blocks: [
        {
          id: "bad-surface",
          type: "plugin.null-surface",
          title: "Bad surface",
          bindings: [],
          config: {},
        },
        {
          id: "note",
          type: "text",
          title: "Note",
          bindings: [],
          config: { text: "Sibling survives malformed surface" },
        },
      ],
      layout: {
        desktop: {
          columns: 12,
          rowHeight: 32,
          placements: [
            { blockId: "bad-surface", x: 0, y: 0, width: 6, height: 3 },
            { blockId: "note", x: 6, y: 0, width: 6, height: 2 },
          ],
        },
      },
    };
    const mounted = unwrap(
      mountBoardView(target as unknown as HTMLElement, {
        document: board,
        extensions,
      }),
    );
    const root = mounted.element as unknown as MiniElement;
    expect(findByClass(root, "bl-block")).toHaveLength(2);
    expect(root.textContent).toContain("Sibling survives malformed surface");
    const bad = findByAttribute(root, "data-block-id", "bad-surface")[0];
    expect(bad).toBeDefined();
    expect(findByClass(bad as MiniElement, "bl-state--error").length).toBeGreaterThan(0);
    unwrap(mounted.unmount());
    unwrap(mounted.dispose());
    unwrap(extensions.dispose());
  });

  it("rejects conflicting definitions supplied to a host-owned extension registry", () => {
    const document = createMiniDocument();
    const target = document.createElement("div");
    target.clientWidth = 1440;
    document.body.append(target);
    const extensions = unwrap(createBoardloomExtensions(createReferencePlugin()));
    const newBlock = {
      ...REFERENCE_PLUGIN_BLOCK,
      type: "plugin.new-before-conflict",
    };
    const conflictingBlock = {
      ...REFERENCE_PLUGIN_BLOCK,
      version: "2.0.0",
    };
    const blockResult = mountBoardView(target as unknown as HTMLElement, {
      document: pluginDocument([1, 2, 3]),
      extensions,
      blockTypes: [newBlock, conflictingBlock],
    });
    expect(blockResult.ok).toBe(false);
    if (!blockResult.ok) {
      expect(blockResult.diagnostics[0]?.code).toBe("EXTENSION_DUPLICATE");
    }
    expect(extensions.blocks.has("plugin.new-before-conflict")).toBe(false);

    const newRenderer = {
      ...REFERENCE_PLUGIN_RENDERER,
      id: "plugin.new-renderer-before-conflict",
    };
    const conflictingRenderer = {
      ...REFERENCE_PLUGIN_RENDERER,
      version: "2.0.0",
    };
    const rendererResult = mountBoardView(target as unknown as HTMLElement, {
      document: pluginDocument([1, 2, 3]),
      extensions,
      renderers: [newRenderer, conflictingRenderer],
    });
    expect(rendererResult.ok).toBe(false);
    if (!rendererResult.ok) {
      expect(rendererResult.diagnostics[0]?.code).toBe("EXTENSION_DUPLICATE");
    }
    expect(extensions.renderers.has("plugin.new-renderer-before-conflict")).toBe(false);

    const crossBlock = {
      ...REFERENCE_PLUGIN_BLOCK,
      type: "plugin.cross-stage-block",
    };
    const crossBlockResult = mountBoardView(target as unknown as HTMLElement, {
      document: pluginDocument([1, 2, 3]),
      extensions,
      blockTypes: [crossBlock],
      renderers: [conflictingRenderer],
    });
    expect(crossBlockResult.ok).toBe(false);
    if (!crossBlockResult.ok) {
      expect(crossBlockResult.diagnostics[0]?.code).toBe("EXTENSION_DUPLICATE");
    }
    expect(extensions.blocks.has("plugin.cross-stage-block")).toBe(false);

    const crossRenderer = {
      ...REFERENCE_PLUGIN_RENDERER,
      id: "plugin.cross-stage-renderer",
    };
    const crossRendererResult = mountBoardView(target as unknown as HTMLElement, {
      document: pluginDocument([1, 2, 3]),
      extensions,
      blockTypes: [conflictingBlock],
      renderers: [crossRenderer],
    });
    expect(crossRendererResult.ok).toBe(false);
    if (!crossRendererResult.ok) {
      expect(crossRendererResult.diagnostics[0]?.code).toBe("EXTENSION_DUPLICATE");
    }
    expect(extensions.renderers.has("plugin.cross-stage-renderer")).toBe(false);
    unwrap(extensions.dispose());
  });
  it("removes installed plugin styles when viewer construction fails", () => {
    const document = createMiniDocument();
    const target = document.createElement("div");
    target.clientWidth = 1440;
    document.body.append(target);
    const extensions = unwrap(createBoardloomExtensions(createReferencePlugin()));
    const runtime = createRuntime({
      datasetProvider: createViewerProvider(),
      blockTypes: [REFERENCE_BLOCK_TYPE],
    });
    const space = unwrap(runtime.createSpace({ document: pluginDocument([1, 2, 3]) }));
    const view = unwrap(space.createView({ mode: "viewer" }));
    (space as unknown as { subscribe: () => never }).subscribe = () => {
      throw new Error("subscription failed");
    };
    expect(
      () =>
        new ViewerHost(
          target as unknown as HTMLElement,
          space,
          view,
          runtime,
          { ownsRuntime: false, ownsSpace: false, ownsView: false },
          extensions.blocks,
          extensions.renderers,
          createViewMessages({ provider: space.getMessageProvider() }),
          { ownedExtensions: extensions },
        ),
    ).toThrow();
    expect(
      document.body.children.filter(
        (element) => element.getAttribute("data-boardloom-plugin-styles") === "true",
      ),
    ).toHaveLength(0);
    unwrap(space.dispose());
    unwrap(runtime.dispose());
  });
});
