import type { Clock } from "./clock.js";

export interface IdFactory {
  createId(namespace: string): string;
}

export interface SequentialIdFactoryOptions {
  readonly prefix?: string;
  readonly clock?: Clock;
}

export function createSequentialIdFactory(options: SequentialIdFactoryOptions = {}): IdFactory {
  const prefix = options.prefix ?? "boardloom";
  const clock = options.clock;
  let counter = 0;

  return Object.freeze({
    createId(namespace: string): string {
      counter += 1;
      const stamp = clock ? `-${clock.now().toString(36)}` : "";
      return `${prefix}-${namespace}${stamp}-${counter.toString(36)}`;
    },
  });
}
