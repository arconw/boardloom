export type TimerHandle = unknown;

export interface Clock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
}

interface TimerHost {
  setTimeout?: (callback: () => void, delayMs?: number) => TimerHandle;
  clearTimeout?: (handle: TimerHandle) => void;
}

export function createSystemClock(): Clock {
  const timers = globalThis as unknown as TimerHost;
  if (typeof timers.setTimeout !== "function" || typeof timers.clearTimeout !== "function") {
    throw new Error("The host environment does not provide timer functions.");
  }
  const setTimer = timers.setTimeout.bind(globalThis);
  const clearTimer = timers.clearTimeout.bind(globalThis);

  return Object.freeze({
    now: () => Date.now(),
    setTimeout: (callback: () => void, delayMs: number) => setTimer(callback, delayMs),
    clearTimeout: (handle: TimerHandle) => clearTimer(handle),
  });
}
