import { describe, expect, it } from "vitest";
import {
  DIAGNOSTIC_CODES,
  createDiagnostic,
  createRuntime,
  defaultDocumentValidator,
  type BoardDocument,
  type Diagnostic,
  type DocumentValidation,
  type SpaceEvent,
} from "../../../../packages/core/src/index.js";
import { expectFailure, unwrap } from "../support/assertions.js";
import {
  FakeClock,
  createDeterministicIdFactory,
  createRecordingLogger,
  makeDocument,
} from "../support/fakes.js";

function createHarness(validator = defaultDocumentValidator) {
  const clock = new FakeClock();
  const runtime = createRuntime({
    clock,
    logger: createRecordingLogger(),
    idFactory: createDeterministicIdFactory("lease"),
    documentValidator: validator,
  });
  const space = unwrap(runtime.createSpace({ id: "lease-space", document: makeDocument("Base") }));
  const lease = unwrap(space.acquireEditorLease({ sessionId: "session-a" }));
  return { runtime, space, lease, clock };
}

describe("view-local modes and editor lease contract", () => {
  it("rejects viewer-bound authoring even while a sibling editor exists", () => {
    const { space, lease } = createHarness();
    const editor = unwrap(space.createView({ mode: "editor", lease }));
    const viewer = unwrap(space.createView({ mode: "viewer" }));

    expectFailure(
      viewer.commands.updateDraft(makeDocument("Viewer change")),
      DIAGNOSTIC_CODES.VIEWER_READ_ONLY,
    );
    expectFailure(viewer.commands.undo(), DIAGNOSTIC_CODES.VIEWER_READ_ONLY);
    expectFailure(viewer.commands.applyDraft(), DIAGNOSTIC_CODES.VIEWER_READ_ONLY);

    const updated = unwrap(editor.commands.updateDraft(makeDocument("Editor change")));
    expect(updated.dirty).toBe(true);
    expect(space.getSnapshot().draft?.document.title).toBe("Editor change");
  });

  it("enforces one editor lease and emits a rejection", () => {
    const { space } = createHarness();
    const events: SpaceEvent[] = [];
    space.subscribe((event) => events.push(event));

    expectFailure(
      space.acquireEditorLease({ sessionId: "session-b" }),
      DIAGNOSTIC_CODES.EDITOR_LEASE_CONFLICT,
    );
    const leaseEvent = events.find((event) => event.type === "editor:lease-changed");
    expect(leaseEvent?.type).toBe("editor:lease-changed");
    if (leaseEvent?.type === "editor:lease-changed") {
      expect(leaseEvent.status).toBe("rejected");
      expect(leaseEvent.sessionId).toBe("session-b");
      expect(leaseEvent.diagnostic?.code).toBe(DIAGNOSTIC_CODES.EDITOR_LEASE_CONFLICT);
    }
  });

  it("requires a lease for editor views and allows viewer-to-editor switching with one", () => {
    const { space, lease } = createHarness();
    expectFailure(space.createView({ mode: "editor" }), DIAGNOSTIC_CODES.EDITOR_LEASE_REQUIRED);

    const view = unwrap(space.createView({ mode: "viewer" }));
    expectFailure(view.setMode("editor"), DIAGNOSTIC_CODES.EDITOR_LEASE_REQUIRED);
    const events: SpaceEvent[] = [];
    space.subscribe((event) => events.push(event));
    const switched = unwrap(view.setMode("editor", { lease }));
    expect(switched.mode).toBe("editor");
    expect(switched.leaseId).toBe(lease.leaseId);
    expect(switched.sessionId).toBe("session-a");
    const modeEvent = events.find((event) => event.type === "mode:changed");
    expect(modeEvent?.type).toBe("mode:changed");
    if (modeEvent?.type === "mode:changed") {
      expect(modeEvent.from).toBe("viewer");
      expect(modeEvent.to).toBe("editor");
      expect(modeEvent.sessionId).toBe("session-a");
    }
  });

  it("preserves committed document, draft and history across mode switches", () => {
    const { space, lease } = createHarness();
    const view = unwrap(space.createView({ mode: "editor", lease }));
    unwrap(view.commands.updateDraft(makeDocument("Draft one")));
    unwrap(view.commands.updateDraft(makeDocument("Draft two")));
    const before = view.getSnapshot();
    expect(before.draft?.document.title).toBe("Draft two");
    expect(before.draft?.canUndo).toBe(true);

    unwrap(view.setMode("viewer"));
    const viewerSnapshot = view.getSnapshot();
    expect(viewerSnapshot.mode).toBe("viewer");
    expect(viewerSnapshot.draft).toEqual(before.draft);

    unwrap(view.setMode("editor"));
    const restored = view.getSnapshot();
    expect(restored.draft).toEqual(before.draft);
    expect(restored.committedRevision).toBe(1);
    expect(unwrap(view.commands.undo()).document.title).toBe("Draft one");
  });

  it("requires an explicit decision to release a dirty draft", () => {
    const { space, lease } = createHarness();
    unwrap(space.updateDraft(lease, makeDocument("Dirty")));

    expectFailure(space.releaseEditorLease(lease), DIAGNOSTIC_CODES.DRAFT_REQUIRES_DECISION);
    const preserved = space.getSnapshot();
    expect(preserved.editorLease?.leaseId).toBe(lease.leaseId);
    expect(preserved.draft?.document.title).toBe("Dirty");
    expect(preserved.committedDocument.title).toBe("Base");

    const released = unwrap(space.releaseEditorLease(lease, { decision: "cancel" }));
    expect(released.editorLease).toBeNull();
    expect(released.draft).toBeNull();
    expect(released.committedDocument.title).toBe("Base");
  });

  it("does not mutate a disposed snapshot when disposal interrupts an apply release", () => {
    const { space, lease, clock } = createHarness();
    unwrap(space.updateDraft(lease, makeDocument("Applied during release")));
    let disposedSnapshot: ReturnType<typeof space.getSnapshot> | null = null;
    space.subscribe((event) => {
      if (event.type === "document:changed") {
        unwrap(space.dispose());
        clock.advance(1_000);
        disposedSnapshot = space.getSnapshot();
      }
    });

    const released = unwrap(space.releaseEditorLease(lease, { decision: "apply" }));
    clock.advance(1_000);
    expect(disposedSnapshot).not.toBeNull();
    expect(space.getSnapshot()).toEqual(disposedSnapshot);
    expect(released).toEqual(disposedSnapshot);
    expect(released.committedDocument.title).toBe("Applied during release");
    expect(released.status).toBe("disposed");
  });

  it("does not mutate a disposed snapshot when disposal interrupts a cancel release", () => {
    const { space, lease, clock } = createHarness();
    unwrap(space.updateDraft(lease, makeDocument("Cancelled during release")));
    let disposedSnapshot: ReturnType<typeof space.getSnapshot> | null = null;
    space.subscribe((event) => {
      if (event.type === "draft:cancelled") {
        unwrap(space.dispose());
        clock.advance(1_000);
        disposedSnapshot = space.getSnapshot();
      }
    });

    const released = unwrap(space.releaseEditorLease(lease, { decision: "cancel" }));
    clock.advance(1_000);
    expect(disposedSnapshot).not.toBeNull();
    expect(space.getSnapshot()).toEqual(disposedSnapshot);
    expect(released).toEqual(disposedSnapshot);
    expect(released.committedDocument.title).toBe("Base");
    expect(released.status).toBe("disposed");
  });

  it("does not mutate the disposed snapshot on a dirty-release rejection", () => {
    const { space, lease, clock } = createHarness();
    unwrap(space.updateDraft(lease, makeDocument("Dirty rejection")));
    let atDisposed: ReturnType<typeof space.getSnapshot> | null = null;
    space.subscribe((event) => {
      if (event.type === "editor:lease-changed" && event.status === "rejected") {
        unwrap(space.dispose());
        clock.advance(1_000);
        atDisposed = space.getSnapshot();
      }
    });

    expectFailure(space.releaseEditorLease(lease), DIAGNOSTIC_CODES.DRAFT_REQUIRES_DECISION);
    expect(atDisposed).not.toBeNull();
    expect(space.getSnapshot()).toEqual(atDisposed);
  });

  it("does not mutate the disposed snapshot on an editor-lease conflict", () => {
    const { space, clock } = createHarness();
    let atDisposed: ReturnType<typeof space.getSnapshot> | null = null;
    space.subscribe((event) => {
      if (event.type === "editor:lease-changed" && event.status === "rejected") {
        unwrap(space.dispose());
        clock.advance(1_000);
        atDisposed = space.getSnapshot();
      }
    });

    expectFailure(
      space.acquireEditorLease({ sessionId: "conflict" }),
      DIAGNOSTIC_CODES.EDITOR_LEASE_CONFLICT,
    );
    expect(atDisposed).not.toBeNull();
    expect(space.getSnapshot()).toEqual(atDisposed);
  });

  it("does not clear diagnostics on a disposed snapshot after a diagnostics notification", () => {
    const warning = createDiagnostic(DIAGNOSTIC_CODES.DOCUMENT_INVALID, "/title", {
      severity: "warning",
      message: "legacy title",
    });
    const validator = (document: unknown): DocumentValidation => {
      const base = defaultDocumentValidator(document);
      if (!base.valid) {
        return base;
      }
      return { valid: true, diagnostics: Object.freeze([warning]) };
    };
    const clock = new FakeClock();
    const runtime = createRuntime({
      clock,
      logger: createRecordingLogger(),
      idFactory: createDeterministicIdFactory("diagnostics-disposal"),
      documentValidator: validator,
    });
    const space = unwrap(
      runtime.createSpace({ id: "diagnostics-disposal", document: makeDocument("Base") }),
    );
    expectFailure(
      space.loadDocument({ schemaVersion: 1, broken: Number.NaN } as never),
      DIAGNOSTIC_CODES.DOCUMENT_INVALID,
    );
    let atDisposed: ReturnType<typeof space.getSnapshot> | null = null;
    space.subscribe((event) => {
      if (event.type === "diagnostics:changed") {
        unwrap(space.dispose());
        clock.advance(1_000);
        atDisposed = space.getSnapshot();
      }
    });

    unwrap(space.loadDocument(makeDocument("Warned"), { source: "host" }));
    expect(atDisposed).not.toBeNull();
    expect(space.getSnapshot()).toEqual(atDisposed);

    const secondRuntime = createRuntime({
      clock: new FakeClock(),
      logger: createRecordingLogger(),
      idFactory: createDeterministicIdFactory("update-disposal"),
      documentValidator: validator,
    });
    const secondSpace = unwrap(
      secondRuntime.createSpace({
        id: "update-disposal",
        document: makeDocument("Base"),
      }),
    );
    const secondLease = unwrap(secondSpace.acquireEditorLease({ sessionId: "s" }));
    expectFailure(
      secondSpace.loadDocument({ schemaVersion: 1, broken: Number.NaN } as never),
      DIAGNOSTIC_CODES.DOCUMENT_INVALID,
    );
    let updateDisposedAt: ReturnType<typeof secondSpace.getSnapshot> | null = null;
    secondSpace.subscribe((event) => {
      if (event.type === "diagnostics:changed") {
        unwrap(secondSpace.dispose());
        clock.advance(1_000);
        updateDisposedAt = secondSpace.getSnapshot();
      }
    });
    unwrap(secondSpace.updateDraft(secondLease, makeDocument("Warned", 2)));
    expect(updateDisposedAt).not.toBeNull();
    expect(secondSpace.getSnapshot()).toEqual(updateDisposedAt);
  });

  it("keeps the disposed snapshot stable when a view detaches after apply or cancel release", () => {
    const { space, lease, clock } = createHarness();
    const editor = unwrap(space.createView({ mode: "editor", lease }));
    unwrap(editor.commands.updateDraft(makeDocument("View apply")));
    let applyDisposedAt: ReturnType<typeof space.getSnapshot> | null = null;
    space.subscribe((event) => {
      if (event.type === "document:changed") {
        unwrap(space.dispose());
        clock.advance(1_000);
        applyDisposedAt = space.getSnapshot();
      }
    });
    expect(unwrap(editor.dispose({ draftDecision: "apply" })).viewId).toBe(editor.viewId);
    expect(applyDisposedAt).not.toBeNull();
    expect(space.getSnapshot()).toEqual(applyDisposedAt);

    const cancelHarness = createHarness();
    const cancelView = unwrap(
      cancelHarness.space.createView({ mode: "editor", lease: cancelHarness.lease }),
    );
    unwrap(cancelView.commands.updateDraft(makeDocument("View cancel")));
    let cancelDisposedAt: ReturnType<typeof cancelHarness.space.getSnapshot> | null = null;
    cancelHarness.space.subscribe((event) => {
      if (event.type === "draft:cancelled") {
        unwrap(cancelHarness.space.dispose());
        cancelHarness.clock.advance(1_000);
        cancelDisposedAt = cancelHarness.space.getSnapshot();
      }
    });
    expect(unwrap(cancelView.dispose({ draftDecision: "cancel" })).viewId).toBe(cancelView.viewId);
    expect(cancelDisposedAt).not.toBeNull();
    expect(cancelHarness.space.getSnapshot()).toEqual(cancelDisposedAt);
  });

  it("applies a dirty draft when release explicitly decides to apply", () => {
    const { space, lease } = createHarness();
    unwrap(space.updateDraft(lease, makeDocument("Release apply", 2)));
    const released = unwrap(space.releaseEditorLease(lease, { decision: "apply" }));

    expect(released.committedDocument.title).toBe("Release apply");
    expect(released.committedRevision).toBe(2);
    expect(released.draft).toBeNull();
    expect(released.editorLease).toBeNull();
    expectFailure(
      space.updateDraft(lease, makeDocument("After release")),
      DIAGNOSTIC_CODES.EDITOR_LEASE_INVALID,
    );
  });

  it("rejects an invalid draft decision instead of silently discarding a dirty draft", () => {
    const { space, lease } = createHarness();
    unwrap(space.updateDraft(lease, makeDocument("Keep me")));

    expectFailure(
      space.releaseEditorLease(lease, { decision: "discard" as never }),
      DIAGNOSTIC_CODES.INVALID_ARGUMENT,
    );
    expect(space.getSnapshot().draft?.document.title).toBe("Keep me");
    expect(space.getSnapshot().editorLease?.leaseId).toBe(lease.leaseId);

    const view = unwrap(space.createView({ mode: "editor", lease }));
    expectFailure(
      view.dispose({ draftDecision: "discard" as never }),
      DIAGNOSTIC_CODES.INVALID_ARGUMENT,
    );
    expect(view.disposed).toBe(false);
    expect(space.getSnapshot().draft?.document.title).toBe("Keep me");
  });

  it("hands off a dirty lease and draft when a view is disposed with keep", () => {
    const { space, lease } = createHarness();
    const events: SpaceEvent[] = [];
    space.subscribe((event) => events.push(event));
    const editor = unwrap(space.createView({ mode: "editor", lease }));
    unwrap(editor.commands.updateDraft(makeDocument("Handoff draft")));
    const listenerCount = space.listenerCount;

    const disposal = unwrap(editor.dispose({ draftDecision: "keep" }));
    expect(disposal.retainedLease?.leaseId).toBe(lease.leaseId);
    expect(editor.disposed).toBe(true);
    expectFailure(
      editor.commands.updateDraft(makeDocument("After close")),
      DIAGNOSTIC_CODES.VIEW_DISPOSED,
    );
    expect(space.disposed).toBe(false);
    expect(space.listenerCount).toBe(listenerCount);
    expect(space.getSnapshot().editorLease?.leaseId).toBe(lease.leaseId);
    expect(space.getSnapshot().draft?.document.title).toBe("Handoff draft");

    const replacementViewer = unwrap(space.createView({ mode: "viewer", lease }));
    expectFailure(
      replacementViewer.commands.updateDraft(makeDocument("Viewer write")),
      DIAGNOSTIC_CODES.VIEWER_READ_ONLY,
    );

    const replacementEditor = unwrap(space.createView({ mode: "editor", lease }));
    expect(replacementEditor.getSnapshot().draft?.document.title).toBe("Handoff draft");
    unwrap(replacementEditor.commands.updateDraft(makeDocument("Continued draft", 2)));
    const released = unwrap(space.releaseEditorLease(lease, { decision: "apply" }));

    expect(released.committedDocument.title).toBe("Continued draft");
    expect(released.draft).toBeNull();
    expect(released.editorLease).toBeNull();
    expect(events.map((event) => event.type)).toContain("draft:applied");
    expect(events.map((event) => event.type)).toContain("editor:lease-changed");
    expect(space.listenerCount).toBe(listenerCount);
  });

  it("blocks reentrant authoring while an apply release is in progress", () => {
    const { space, lease } = createHarness();
    unwrap(space.updateDraft(lease, makeDocument("Applied")));
    let updateCode = "";
    let acquiredLeaseId = "";
    space.subscribe((event) => {
      if (event.type === "draft:applied") {
        const update = space.updateDraft(lease, makeDocument("Reentrant"));
        if (!update.ok) {
          updateCode = update.diagnostics[0]?.code ?? "";
        }
        const acquire = space.acquireEditorLease({ sessionId: "late-editor" });
        if (acquire.ok) {
          acquiredLeaseId = acquire.value.leaseId;
        }
      }
    });

    const released = unwrap(space.releaseEditorLease(lease, { decision: "apply" }));
    expect(updateCode).toBe(DIAGNOSTIC_CODES.EDITOR_LEASE_INVALID);
    expect(acquiredLeaseId).not.toBe("");
    expect(released.committedDocument.title).toBe("Applied");
    expect(released.editorLease?.leaseId).toBe(acquiredLeaseId);
    expect(released.draft).not.toBeNull();
  });

  it("blocks reentrant authoring while a cancel release is in progress", () => {
    const { space, lease } = createHarness();
    unwrap(space.updateDraft(lease, makeDocument("Discard me")));
    let updateCode = "";
    space.subscribe((event) => {
      if (event.type === "draft:cancelled") {
        const update = space.updateDraft(lease, makeDocument("Reentrant"));
        if (!update.ok) {
          updateCode = update.diagnostics[0]?.code ?? "";
        }
      }
    });

    const released = unwrap(space.releaseEditorLease(lease, { decision: "cancel" }));
    expect(updateCode).toBe(DIAGNOSTIC_CODES.EDITOR_LEASE_INVALID);
    expect(released.committedDocument.title).toBe("Base");
    expect(released.draft).toBeNull();
    expect(released.editorLease).toBeNull();
  });

  it("preserves the draft and rejects overwrite on revision conflict", () => {
    const { space, lease } = createHarness();
    const events: SpaceEvent[] = [];
    space.subscribe((event) => events.push(event));
    unwrap(space.updateDraft(lease, makeDocument("Mine")));
    unwrap(space.loadDocument(makeDocument("External"), { source: "host" }));

    expectFailure(space.applyDraft(lease), DIAGNOSTIC_CODES.REVISION_CONFLICT);
    const snapshot = space.getSnapshot();
    expect(snapshot.committedDocument.title).toBe("External");
    expect(snapshot.draft?.document.title).toBe("Mine");
    expect(snapshot.draft?.baseRevision).toBe(1);
    const conflict = events.find((event) => event.type === "draft:conflict");
    expect(conflict?.type).toBe("draft:conflict");
    if (conflict?.type === "draft:conflict") {
      expect(conflict.expectedRevision).toBe(1);
      expect(conflict.actualRevision).toBe(2);
    }
  });

  it("validates atomically before replacing the committed document", () => {
    let rejectInvalid = false;
    const validator = (document: unknown): DocumentValidation => {
      if (
        rejectInvalid &&
        typeof document === "object" &&
        document !== null &&
        (document as BoardDocument).title === "Invalid"
      ) {
        const diagnostic: Diagnostic = createDiagnostic(
          DIAGNOSTIC_CODES.DOCUMENT_INVALID,
          "/title",
          { message: "The title is not allowed." },
        );
        return { valid: false, diagnostics: Object.freeze([diagnostic]) };
      }
      return defaultDocumentValidator(document);
    };
    const { space, lease } = createHarness(validator);
    unwrap(space.updateDraft(lease, makeDocument("Invalid")));
    rejectInvalid = true;

    expectFailure(space.applyDraft(lease), DIAGNOSTIC_CODES.DRAFT_INVALID);
    const snapshot = space.getSnapshot();
    expect(snapshot.committedDocument.title).toBe("Base");
    expect(snapshot.committedRevision).toBe(1);
    expect(snapshot.draft?.document.title).toBe("Invalid");
  });

  it("rejects invalid draft updates without changing the draft", () => {
    const { space, lease } = createHarness();
    unwrap(space.updateDraft(lease, makeDocument("Valid")));
    const before = space.getSnapshot().draft;

    expectFailure(
      space.updateDraft(lease, { schemaVersion: 1, broken: Number.NaN } as never),
      DIAGNOSTIC_CODES.DRAFT_INVALID,
    );
    expect(space.getSnapshot().draft).toEqual(before);
    expect(space.getSnapshot().committedDocument.title).toBe("Base");
  });

  it("supports undo and redo with bounded draft revisions", () => {
    const { space, lease } = createHarness();
    unwrap(space.updateDraft(lease, makeDocument("One", 1)));
    unwrap(space.updateDraft(lease, makeDocument("Two", 2)));
    const beforeUndo = space.getSnapshot().draft;
    expect(beforeUndo?.canUndo).toBe(true);
    expect(beforeUndo?.canRedo).toBe(false);

    const undone = unwrap(space.undoDraft(lease));
    expect(undone.document.title).toBe("One");
    expect(undone.canUndo).toBe(true);
    expect(undone.canRedo).toBe(true);

    const redone = unwrap(space.redoDraft(lease));
    expect(redone.document.title).toBe("Two");
    expect(redone.canRedo).toBe(false);
    expect(redone.revision).toBeGreaterThan(beforeUndo?.revision ?? 0);
  });

  it("applies atomically and exposes the new committed snapshot", () => {
    const { space, lease } = createHarness();
    const events: SpaceEvent[] = [];
    space.subscribe((event) => events.push(event));
    unwrap(space.updateDraft(lease, makeDocument("Committed", 2)));
    const applied = unwrap(space.applyDraft(lease));

    expect(applied.committedRevision).toBe(2);
    expect(applied.committedDocument.title).toBe("Committed");
    expect(applied.draft?.dirty).toBe(false);
    expect(applied.draft?.canUndo).toBe(false);
    expect(applied.editorLease?.leaseId).toBe(lease.leaseId);
    expect(events.map((event) => event.type)).toEqual([
      "draft:changed",
      "document:changed",
      "draft:applied",
    ]);
    const released = unwrap(space.releaseEditorLease(lease));
    expect(released.draft).toBeNull();
  });

  it("releases a view without disposing its space and clears stale view leases", () => {
    const { runtime, space, lease } = createHarness();
    const editor = unwrap(space.createView({ mode: "editor", lease }));
    const viewer = unwrap(space.createView({ mode: "viewer" }));

    unwrap(space.releaseEditorLease(lease));
    expect(editor.getSnapshot().leaseId).toBeNull();
    expectFailure(
      editor.commands.updateDraft(makeDocument("After release")),
      DIAGNOSTIC_CODES.EDITOR_LEASE_REQUIRED,
    );

    unwrap(editor.dispose());
    expect(space.disposed).toBe(false);
    expect(space.viewCount).toBe(1);
    expect(viewer.getSnapshot().disposed).toBe(false);
    expect(runtime.getSpace("lease-space")).toBe(space);
  });

  it("requires a decision before disposing a view with a dirty draft", () => {
    const { space, lease } = createHarness();
    const view = unwrap(space.createView({ mode: "editor", lease }));
    unwrap(view.commands.updateDraft(makeDocument("Dirty view")));

    expectFailure(view.dispose(), DIAGNOSTIC_CODES.DRAFT_REQUIRES_DECISION);
    expect(view.disposed).toBe(false);
    expect(space.getSnapshot().draft?.dirty).toBe(true);

    unwrap(view.dispose({ draftDecision: "cancel" }));
    expect(view.disposed).toBe(true);
    expect(space.getSnapshot().draft).toBeNull();
    expect(space.getSnapshot().editorLease).toBeNull();
    expect(space.disposed).toBe(false);
  });
});
