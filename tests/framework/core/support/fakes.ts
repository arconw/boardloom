import {
  createEmptyBoardDocument,
  type BoardDocument,
  type Clock,
  type IdFactory,
  type LogContext,
  type Logger,
  type TimerHandle,
} from "../../../../packages/core/src/index.js";

export class FakeClock implements Clock {
  private currentTime: number;
  private nextHandle = 1;
  private readonly timers = new Map<number, { due: number; callback: () => void }>();

  constructor(startTime = 1_700_000_000_000) {
    this.currentTime = startTime;
  }

  now(): number {
    return this.currentTime;
  }

  setTimeout(callback: () => void, delayMs: number): TimerHandle {
    const handle = this.nextHandle;
    this.nextHandle += 1;
    this.timers.set(handle, { due: this.currentTime + delayMs, callback });
    return handle;
  }

  clearTimeout(handle: TimerHandle): void {
    if (typeof handle === "number") {
      this.timers.delete(handle);
    }
  }

  get activeTimerCount(): number {
    return this.timers.size;
  }

  advance(milliseconds: number): void {
    const target = this.currentTime + milliseconds;
    while (true) {
      const next = [...this.timers.entries()]
        .filter(([, timer]) => timer.due <= target)
        .sort((left, right) => left[1].due - right[1].due)[0];
      if (!next) {
        break;
      }
      const [handle, timer] = next;
      this.timers.delete(handle);
      this.currentTime = timer.due;
      timer.callback();
    }
    this.currentTime = target;
  }
}

export function createDeterministicIdFactory(prefix = "test"): IdFactory {
  let counter = 0;
  return Object.freeze({
    createId(namespace: string): string {
      counter += 1;
      return `${prefix}-${namespace}-${counter}`;
    },
  });
}

export interface RecordedLog {
  readonly level: "debug" | "info" | "warn" | "error";
  readonly message: string;
  readonly context?: LogContext;
}

export interface RecordingLogger extends Logger {
  readonly entries: readonly RecordedLog[];
  readonly errors: readonly RecordedLog[];
}

export function createRecordingLogger(): RecordingLogger {
  const entries: RecordedLog[] = [];
  function record(level: RecordedLog["level"], message: string, context?: LogContext): void {
    entries.push(Object.freeze({ level, message, ...(context === undefined ? {} : { context }) }));
  }
  const logger = {
    debug: (message: string, context?: LogContext) => record("debug", message, context),
    info: (message: string, context?: LogContext) => record("info", message, context),
    warn: (message: string, context?: LogContext) => record("warn", message, context),
    error: (message: string, context?: LogContext) => record("error", message, context),
    get entries() {
      return Object.freeze([...entries]);
    },
    get errors() {
      return Object.freeze(entries.filter((entry) => entry.level === "error"));
    },
  };
  return logger;
}

export function makeDocument(title: string, revision = 1): BoardDocument {
  const createdAt = 1_700_000_000_000;
  return createEmptyBoardDocument({
    id: `board-${title}`,
    title,
    createdAt,
    updatedAt: createdAt + revision,
  }) as unknown as BoardDocument;
}

export function collectTypes(events: readonly { readonly type: string }[]): readonly string[] {
  return events.map((event) => event.type);
}
