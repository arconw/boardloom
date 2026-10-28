import { describe, expect, it } from "vitest";
import type { BoardDocumentV1 } from "../../../../packages/core/src/index.js";
import { createViewMessages } from "../../../../packages/view-dom/src/messages.js";
import {
  createBlockRegistry,
  type BlockSurfaceEnvironment,
} from "../../../../packages/view-dom/src/block-registry.js";
import { ViewerHost } from "../../../../packages/view-dom/src/viewer.js";
import { unwrap } from "../../core/support/assertions.js";
import {
  createMiniDocument,
  findByAttribute,
  findByClass,
  type MiniElement,
} from "../support/mini-dom.js";
import { createViewerRuntime, viewerFixtureDocument } from "../support/fixture.js";

function failureDocument(): BoardDocumentV1 {
  const base = viewerFixtureDocument();
  return {
    ...base,
    blocks: [
      {
        id: "good",
        type: "text",
        title: "Good",
        bindings: [],
        config: { text: "Good block" },
      },
      {
        id: "bad-initial",
        type: "text",
        title: "Initial failure",
        bindings: [],
        config: { text: "Initial failure block" },
      },
      {
        id: "bad-later",
        type: "text",
        title: "Later failure",
        bindings: [],
        config: { text: "Later failure block" },
      },
    ],
    filters: [],
    layout: {
      desktop: {
        columns: 3,
        rowHeight: 32,
        placements: [
          { blockId: "good", x: 0, y: 0, width: 1, height: 2 },
          { blockId: "bad-initial", x: 1, y: 0, width: 1, height: 2 },
          { blockId: "bad-later", x: 2, y: 0, width: 1, height: 2 },
        ],
      },
    },
  };
}

describe("T06 surface failure containment", () => {
  it("contains initial and subsequent surface update failures to the failing block", () => {
    const document = createMiniDocument();
    const target = document.createElement("div");
    target.clientWidth = 1440;
    document.body.append(target);
    const { runtime } = createViewerRuntime();
    const space = unwrap(runtime.createSpace({ document: failureDocument() }));
    const view = unwrap(space.createView({ mode: "viewer" }));
    let laterUpdates = 0;
    const registry = unwrap(
      createBlockRegistry([
        {
          type: "text",
          version: "1.0.0",
          createSurface(environment: BlockSurfaceEnvironment) {
            const element = environment.createElement("div", "custom-text-surface");
            return {
              element,
              update(next: BlockSurfaceEnvironment): void {
                if (next.block.id === "bad-initial") {
                  throw new Error("initial surface failure");
                }
                if (next.block.id === "bad-later") {
                  laterUpdates += 1;
                  if (laterUpdates > 1) {
                    throw new Error("later surface failure");
                  }
                }
                element.textContent = next.block.id;
              },
            };
          },
        },
      ]),
    );
    const messages = createViewMessages({ provider: space.getMessageProvider() });
    const host = new ViewerHost(
      target as unknown as HTMLElement,
      space,
      view,
      null,
      { ownsRuntime: false, ownsSpace: false, ownsView: false },
      registry,
      messages,
      {},
    );
    const root = host.element as unknown as MiniElement;
    expect(target.children).toHaveLength(1);
    expect(findByClass(root, "bl-block")).toHaveLength(3);
    expect(
      findByAttribute(root, "data-message-key", "diagnostic.BLOCK_SURFACE_FAILED"),
    ).toHaveLength(1);
    expect(findByClass(root, "custom-text-surface").map((element) => element.textContent)).toEqual([
      "good",
      "bad-later",
    ]);

    host.refresh();
    expect(
      findByAttribute(root, "data-message-key", "diagnostic.BLOCK_SURFACE_FAILED"),
    ).toHaveLength(2);
    expect(findByClass(root, "custom-text-surface").map((element) => element.textContent)).toEqual([
      "good",
    ]);
    unwrap(host.unmount());
    expect(target.children).toHaveLength(0);
    unwrap(view.dispose());
    unwrap(runtime.dispose());
  });
});
