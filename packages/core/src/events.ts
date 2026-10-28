import type { BoardDocument } from "./document.js";
import type { Diagnostic } from "./diagnostics.js";
import type { BoardloomLocale } from "./locale.js";
import type { ViewMode } from "./types.js";

export type Unsubscribe = () => void;

interface BaseSpaceEvent {
  readonly spaceId: string;
  readonly lifetimeId: string;
  readonly sequence: number;
  readonly timestamp: number;
}

export interface SpaceCreatedEvent extends BaseSpaceEvent {
  readonly type: "space:created";
}

export interface SpaceLoadedEvent extends BaseSpaceEvent {
  readonly type: "space:loaded";
  readonly schemaVersion: number | null;
  readonly warnings: readonly Diagnostic[];
}

export interface SpaceDisposedEvent extends BaseSpaceEvent {
  readonly type: "space:disposed";
}

export interface ModeChangedEvent extends BaseSpaceEvent {
  readonly type: "mode:changed";
  readonly viewId: string;
  readonly sessionId: string | null;
  readonly from: ViewMode;
  readonly to: ViewMode;
}

export interface DraftChangedEvent extends BaseSpaceEvent {
  readonly type: "draft:changed";
  readonly revision: number;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

export interface DraftAppliedEvent extends BaseSpaceEvent {
  readonly type: "draft:applied";
  readonly revision: number;
  readonly document: BoardDocument;
}

export interface DraftCancelledEvent extends BaseSpaceEvent {
  readonly type: "draft:cancelled";
  readonly revision: number;
}

export interface DraftConflictEvent extends BaseSpaceEvent {
  readonly type: "draft:conflict";
  readonly expectedRevision: number;
  readonly actualRevision: number;
  readonly diagnostics: readonly Diagnostic[];
}

export interface EditorLeaseChangedEvent extends BaseSpaceEvent {
  readonly type: "editor:lease-changed";
  readonly sessionId: string;
  readonly status: "acquired" | "released" | "rejected";
  readonly diagnostic?: Diagnostic;
}

export interface DocumentChangedEvent extends BaseSpaceEvent {
  readonly type: "document:changed";
  readonly document: BoardDocument;
  readonly source: string;
}

export interface LocaleChangedEvent extends BaseSpaceEvent {
  readonly type: "locale:changed";
  readonly locale: BoardloomLocale;
  readonly timezone: string;
  readonly fromLocale: BoardloomLocale;
  readonly fromTimezone: string;
}

export interface DiagnosticsChangedEvent extends BaseSpaceEvent {
  readonly type: "diagnostics:changed";
  readonly diagnostics: readonly Diagnostic[];
}

export type SpaceEvent =
  | SpaceCreatedEvent
  | SpaceLoadedEvent
  | SpaceDisposedEvent
  | ModeChangedEvent
  | DraftChangedEvent
  | DraftAppliedEvent
  | DraftCancelledEvent
  | DraftConflictEvent
  | EditorLeaseChangedEvent
  | DocumentChangedEvent
  | LocaleChangedEvent
  | DiagnosticsChangedEvent;

export type SpaceEventType = SpaceEvent["type"];
export type SpaceEventListener = (event: SpaceEvent) => void;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type SpaceEventInput = DistributiveOmit<
  SpaceEvent,
  "spaceId" | "lifetimeId" | "sequence" | "timestamp"
>;

interface QueuedEvent<T> {
  readonly value: T;
  readonly terminal: boolean;
  readonly final: boolean;
  readonly afterDelivered?: () => void;
}

export class EventBus<T> {
  private readonly listeners = new Set<(value: T) => void>();
  private readonly internalListeners = new Set<(value: T) => void>();
  private readonly queue: QueuedEvent<T>[] = [];
  private dispatching = false;
  private shutdown = false;
  private abortCurrent = false;
  private clearFinalPending = false;
  private finalTargets: Array<(value: T) => void> = [];
  private hasActive = false;
  private activeValue: T | undefined;
  private activeTerminal = false;

  constructor(private readonly onListenerError: (error: unknown) => void) {}

  get listenerCount(): number {
    return this.listeners.size;
  }

  subscribe(listener: (value: T) => void): Unsubscribe {
    if (this.shutdown) {
      return () => undefined;
    }
    this.listeners.add(listener);
    let active = true;
    return () => {
      if (!active) {
        return;
      }
      active = false;
      this.listeners.delete(listener);
    };
  }

  subscribeInternal(listener: (value: T) => void): Unsubscribe {
    if (this.shutdown) {
      return () => undefined;
    }
    this.internalListeners.add(listener);
    let active = true;
    return () => {
      if (!active) {
        return;
      }
      active = false;
      this.internalListeners.delete(listener);
    };
  }

  emit(value: T): void {
    if (this.shutdown) {
      return;
    }
    this.queue.push(Object.freeze({ value, terminal: false, final: false }));
    this.drain();
  }

  emitTerminal(value: T, afterDelivered?: () => void): void {
    if (this.shutdown) {
      this.emitFinal(value, afterDelivered);
      return;
    }
    this.queue.push(
      Object.freeze({
        value,
        terminal: true,
        final: false,
        ...(afterDelivered === undefined ? {} : { afterDelivered }),
      }),
    );
    this.drain();
  }

  emitFinal(value: T, afterDelivered?: () => void): void {
    if (!this.shutdown) {
      this.beginShutdown();
    }
    this.queue.push(
      Object.freeze({
        value,
        terminal: true,
        final: true,
        ...(afterDelivered === undefined ? {} : { afterDelivered }),
      }),
    );
    this.drain();
  }

  beginShutdown(): void {
    if (this.shutdown) {
      return;
    }
    this.shutdown = true;
    for (let index = this.queue.length - 1; index >= 0; index -= 1) {
      const entry = this.queue[index];
      if (entry && !entry.final && !entry.terminal) {
        this.queue.splice(index, 1);
      }
    }
    this.finalTargets = [...this.internalListeners, ...this.listeners];
    this.listeners.clear();
    this.internalListeners.clear();
    this.abortCurrent = true;
  }

  finishShutdown(): void {
    if (this.dispatching) {
      this.clearFinalPending = true;
      return;
    }
    this.finalTargets = [];
  }

  removeQueued(predicate: (value: T) => boolean): void {
    for (let index = this.queue.length - 1; index >= 0; index -= 1) {
      const entry = this.queue[index];
      if (entry && !entry.terminal && predicate(entry.value)) {
        this.queue.splice(index, 1);
      }
    }
  }

  abortActiveMatching(predicate: (value: T) => boolean): void {
    if (
      this.dispatching &&
      this.hasActive &&
      !this.activeTerminal &&
      this.activeValue !== undefined &&
      predicate(this.activeValue)
    ) {
      this.abortCurrent = true;
    }
  }

  finishShutdownDeferred(): void {
    if (!this.dispatching) {
      this.finalTargets = [];
      return;
    }
    void Promise.resolve().then(() => {
      this.finalTargets = [];
      this.clearFinalPending = false;
    });
  }

  private drain(): void {
    if (this.dispatching) {
      return;
    }
    this.dispatching = true;
    try {
      while (this.queue.length > 0) {
        const entry = this.queue.shift() as QueuedEvent<T>;
        this.abortCurrent = false;
        this.hasActive = true;
        this.activeValue = entry.value;
        this.activeTerminal = entry.terminal;
        const targets = this.shutdown
          ? this.finalTargets
          : [...this.internalListeners, ...this.listeners];
        try {
          for (const listener of targets) {
            try {
              listener(entry.value);
            } catch (error) {
              this.onListenerError(error);
            }
            if (this.abortCurrent && !entry.terminal) {
              break;
            }
          }
        } finally {
          if (entry.afterDelivered) {
            entry.afterDelivered();
          }
        }
      }
    } finally {
      this.dispatching = false;
      this.abortCurrent = false;
      this.hasActive = false;
      this.activeValue = undefined;
      this.activeTerminal = false;
      if (this.clearFinalPending) {
        this.clearFinalPending = false;
        this.finalTargets = [];
      }
    }
  }

  clear(): void {
    this.listeners.clear();
    this.internalListeners.clear();
    if (!this.dispatching) {
      this.finalTargets = [];
    } else {
      this.clearFinalPending = true;
    }
  }
}
