import {
  createRuntime,
  type BoardSpace,
  type SpaceEvent,
} from "../../../../packages/core/src/index.js";
import { unwrap } from "./assertions.js";
import {
  FakeClock,
  createDeterministicIdFactory,
  createRecordingLogger,
  makeDocument,
} from "./fakes.js";

export interface StressOptions {
  readonly cycles: number;
  readonly spacesPerCycle: number;
}

export interface StressReport {
  readonly createdSpaces: number;
  readonly disposedSpaces: number;
  readonly maxLiveSpaces: number;
  readonly maxSpaceListeners: number;
  readonly maxScheduledTasks: number;
  readonly maxViews: number;
  readonly leakedListeners: number;
  readonly leakedTasks: number;
  readonly leakedViews: number;
  readonly leakedTimerCallbacks: number;
  readonly crossSpaceEvents: number;
  readonly postDisposeEvents: number;
  readonly snapshotMismatches: number;
  readonly runtimeSpacesAfterDispose: number;
}

export function runSpaceLifecycleStress(options: StressOptions): StressReport {
  const clock = new FakeClock();
  const logger = createRecordingLogger();
  const runtime = createRuntime({
    clock,
    logger,
    idFactory: createDeterministicIdFactory("stress"),
    historyLimit: 10,
  });

  const disposedSpaces = new Set<string>();
  const allSpaces: BoardSpace[] = [];
  let crossSpaceEvents = 0;
  let postDisposeEvents = 0;
  let createdSpaces = 0;
  let disposedCount = 0;
  let maxLiveSpaces = 0;
  let maxSpaceListeners = 0;
  let maxScheduledTasks = 0;
  let maxViews = 0;
  let leakedTimerCallbacks = 0;
  let snapshotMismatches = 0;

  runtime.subscribe((event: SpaceEvent) => {
    if (disposedSpaces.has(event.spaceId)) {
      postDisposeEvents += 1;
    }
    if (event.type === "space:disposed") {
      disposedSpaces.add(event.spaceId);
      disposedCount += 1;
    }
  });

  for (let cycle = 0; cycle < options.cycles; cycle += 1) {
    const live: BoardSpace[] = [];
    for (let index = 0; index < options.spacesPerCycle; index += 1) {
      const spaceId = `stress-${cycle}-${index}`;
      const expectedTitle = `Board ${cycle}/${index}`;
      const space = unwrap(
        runtime.createSpace({ id: spaceId, document: makeDocument(expectedTitle) }),
      );
      createdSpaces += 1;
      live.push(space);
      allSpaces.push(space);
      maxLiveSpaces = Math.max(maxLiveSpaces, runtime.spaceCount);

      const localEvents: SpaceEvent[] = [];
      space.subscribe((event) => {
        localEvents.push(event);
        if (event.spaceId !== spaceId) {
          crossSpaceEvents += 1;
        }
      });
      maxSpaceListeners = Math.max(maxSpaceListeners, space.listenerCount);

      unwrap(
        space.schedule(() => {
          if (disposedSpaces.has(spaceId)) {
            leakedTimerCallbacks += 1;
          }
        }, 10_000),
      );
      maxScheduledTasks = Math.max(maxScheduledTasks, space.taskCount);

      const viewer = unwrap(space.createView({ mode: "viewer" }));
      const lease = unwrap(space.acquireEditorLease({ sessionId: `session-${spaceId}` }));
      const editor = unwrap(space.createView({ mode: "editor", lease }));
      maxViews = Math.max(maxViews, space.viewCount);

      unwrap(editor.commands.updateDraft(makeDocument(`${expectedTitle} draft`, 2)));
      unwrap(editor.commands.undo());
      unwrap(editor.commands.redo());
      unwrap(space.setLocale({ locale: index % 2 === 0 ? "ar" : "de", timezone: "UTC" }));
      unwrap(space.pause());
      unwrap(space.resume());

      if (index % 3 === 0) {
        unwrap(editor.commands.applyDraft());
        unwrap(editor.dispose());
      } else {
        unwrap(editor.dispose({ draftDecision: "cancel" }));
      }
      unwrap(viewer.dispose());

      if (space.getSnapshot().viewCount !== 0) {
        snapshotMismatches += 1;
      }
      if (space.getSnapshot().status === "disposed") {
        snapshotMismatches += 1;
      }
      const expectedCommittedTitle = index % 3 === 0 ? `${expectedTitle} draft` : expectedTitle;
      if (space.getSnapshot().committedDocument.title !== expectedCommittedTitle) {
        snapshotMismatches += 1;
      }
    }

    for (const space of live) {
      if (!space.disposed) {
        unwrap(space.dispose());
      }
    }
  }

  clock.advance(60_000);

  let leakedListeners = 0;
  let leakedTasks = 0;
  let leakedViews = 0;
  for (const space of allSpaces) {
    leakedListeners += space.listenerCount;
    leakedTasks += space.taskCount;
    leakedViews += space.viewCount;
  }

  const runtimeSpacesAfterDispose = runtime.spaceCount;
  unwrap(runtime.dispose());

  return Object.freeze({
    createdSpaces,
    disposedSpaces: disposedCount,
    maxLiveSpaces,
    maxSpaceListeners,
    maxScheduledTasks,
    maxViews,
    leakedListeners,
    leakedTasks,
    leakedViews,
    leakedTimerCallbacks,
    crossSpaceEvents,
    postDisposeEvents,
    snapshotMismatches,
    runtimeSpacesAfterDispose,
  });
}
