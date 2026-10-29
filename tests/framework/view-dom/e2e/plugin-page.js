import { createRuntime } from "@boardloom/core";
import {
  REFERENCE_BLOCK_TYPE,
  createBoardloomExtensions,
  createReferencePlugin,
  mountBoardView,
} from "/build/view-dom/dist/index.js";

const result = { checks: {}, errors: [] };

function must(value) {
  if (!value || value.ok !== true) {
    const diagnostics = value && value.diagnostics ? value.diagnostics : [];
    throw new Error(
      diagnostics.map((item) => `${item.code} ${item.path}`).join(", ") || "operation failed",
    );
  }
  return value.value;
}

function check(name, condition, detail) {
  if (!condition) {
    result.errors.push(detail === undefined ? name : `${name}: ${detail}`);
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function boardDocument() {
  return {
    schemaVersion: 1,
    id: "plugin-e2e-board",
    title: "Plugin extension board",
    createdAt: 1700000000000,
    updatedAt: 1700000060000,
    theme: { mode: "light" },
    datasets: [],
    slices: [],
    filterGroups: [],
    filters: [],
    comparisons: [],
    blocks: [
      {
        id: "plugin-good",
        type: REFERENCE_BLOCK_TYPE,
        title: "Reference plugin",
        bindings: [],
        config: { title: "Registered plugin block", values: [3, 7, 5] },
      },
      {
        id: "plugin-bad",
        type: REFERENCE_BLOCK_TYPE,
        title: "Broken plugin",
        bindings: [],
        config: { title: "Broken plugin block", values: "invalid" },
      },
      {
        id: "note",
        type: "text",
        title: "Note",
        bindings: [],
        config: { text: "Host text block survives plugin failures." },
      },
    ],
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

async function mountInstance(targetId, accent, extensionSelection) {
  const target = document.getElementById(targetId);
  const plugin = createReferencePlugin({ accent });
  const extensions = must(createBoardloomExtensions(plugin));
  const runtime = createRuntime({
    extensions: extensions.core,
    blockTypes: [REFERENCE_BLOCK_TYPE],
  });
  const space = must(
    runtime.createSpace({
      document: boardDocument(),
      extensionSelection,
    }),
  );
  const handle = must(mountBoardView(target, { runtime, space, extensions }));
  await wait(80);
  return { target, plugin, extensions, runtime, space, handle };
}

async function main() {
  const first = await mountInstance("first", "#aa0000", {
    themes: ["reference.theme"],
  });
  const second = await mountInstance("second", "#0000aa", {});
  const firstElement = first.handle.element;
  const secondElement = second.handle.element;

  result.checks.registered = {
    block: first.extensions.blocks.has(REFERENCE_BLOCK_TYPE),
    renderer: first.extensions.renderers.has("boardloom.reference.bars"),
    formatter: first.extensions.core.has("formatter", "reference.formatter"),
    dictionary: first.extensions.core.has("messageDictionary", "reference.messages.en"),
    theme: first.extensions.core.has("theme", "reference.theme"),
  };
  check(
    "all extension categories registered",
    Object.values(result.checks.registered).every((value) => value === true),
  );

  const goodBlock = firstElement.querySelector('[data-block-id="plugin-good"]');
  const badBlock = firstElement.querySelector('[data-block-id="plugin-bad"]');
  result.checks.customBlock = {
    blocks: firstElement.querySelectorAll(".plugin-reference").length,
    bars: goodBlock ? goodBlock.querySelectorAll(".plugin-reference-bars__row").length : 0,
    renderer: goodBlock ? goodBlock.querySelector("[data-renderer-id]") !== null : false,
    error: badBlock ? badBlock.querySelector(".bl-state--error") !== null : false,
    survivingText: firstElement.textContent.includes("Host text block survives plugin failures."),
  };
  check("custom block rendered", result.checks.customBlock.blocks === 2);
  check("custom renderer rendered bars", result.checks.customBlock.bars === 3);
  check("custom block error contained", result.checks.customBlock.error);
  check("sibling block survived", result.checks.customBlock.survivingText);

  const firstFill = firstElement.querySelector(".plugin-reference-bars__fill");
  const secondFill = secondElement.querySelector(".plugin-reference-bars__fill");
  const firstColor = firstFill ? getComputedStyle(firstFill).backgroundColor : "";
  const secondColor = secondFill ? getComputedStyle(secondFill).backgroundColor : "";
  const hostProbe = document.getElementById("host-probe");
  const hostColor = getComputedStyle(hostProbe).borderTopColor;
  result.checks.styleScopes = {
    firstScope: firstElement.getAttribute("data-boardloom-scope"),
    secondScope: secondElement.getAttribute("data-boardloom-scope"),
    firstColor,
    secondColor,
    hostColor,
    firstStyleTag: firstElement
      ? document.querySelector(
          `style[data-boardloom-plugin-styles][data-boardloom-scope="${firstElement.getAttribute("data-boardloom-scope")}"]`,
        ) !== null
      : false,
  };
  check(
    "two instances use distinct scopes",
    result.checks.styleScopes.firstScope !== result.checks.styleScopes.secondScope,
  );
  check(
    "plugin styles do not collide across instances",
    firstColor === "rgb(170, 0, 0)" && secondColor === "rgb(0, 0, 170)",
    `${firstColor} / ${secondColor}`,
  );
  check(
    "plugin styles do not leak to host page",
    hostColor !== firstColor && hostColor !== secondColor,
    hostColor,
  );

  const lease = must(first.space.acquireEditorLease({ sessionId: "plugin-e2e" }));
  must(first.handle.setMode("editor", { lease }));
  await wait(120);
  const libraryButton = firstElement.querySelector(`[data-editor-add="${REFERENCE_BLOCK_TYPE}"]`);
  result.checks.library = {
    present: libraryButton !== null,
    label: libraryButton ? libraryButton.textContent : "",
  };
  check("plugin block appears in editor library", result.checks.library.present);
  libraryButton?.click();
  await wait(80);
  const addButton = firstElement.querySelector('[data-draft-action="apply"]');
  addButton?.click();
  await wait(120);
  const committed = first.space.getSnapshot().committedDocument;
  const added = committed.blocks.filter((block) => block.type === REFERENCE_BLOCK_TYPE);
  result.checks.addedBlock = {
    count: added.length,
    revision: first.space.getSnapshot().committedRevision,
    rendered: firstElement.querySelectorAll('[data-block-type="' + REFERENCE_BLOCK_TYPE + '"]')
      .length,
  };
  check("plugin block added through editor", result.checks.addedBlock.count === 3);
  check("added plugin block rendered", result.checks.addedBlock.rendered >= 3);

  const scope = firstElement.getAttribute("data-boardloom-scope");
  result.checks.beforeDispose = {
    style:
      document.querySelector(
        `style[data-boardloom-plugin-styles][data-boardloom-scope="${scope}"]`,
      ) !== null,
  };
  must(first.handle.unmount());
  must(first.handle.dispose());
  must(first.space.dispose());
  must(first.extensions.dispose());
  must(first.runtime.dispose());
  await wait(30);
  result.checks.disposed = {
    styleRemoved:
      document.querySelector(
        `style[data-boardloom-plugin-styles][data-boardloom-scope="${scope}"]`,
      ) === null,
    elementRemoved: document.getElementById("first").children.length === 0,
    extensionsDisposed: first.extensions.disposed,
  };
  check("plugin styles removed on dispose", result.checks.disposed.styleRemoved);
  check("viewer DOM removed on dispose", result.checks.disposed.elementRemoved);
  check("extension registry disposed", result.checks.disposed.extensionsDisposed);

  must(second.handle.unmount());
  must(second.space.dispose());
  must(second.extensions.dispose());
  must(second.runtime.dispose());
}

main()
  .then(() => {
    document.getElementById("result").textContent = JSON.stringify(result);
  })
  .catch((error) => {
    result.errors.push(error instanceof Error ? error.message : String(error));
    document.getElementById("result").textContent = JSON.stringify(result);
  });
