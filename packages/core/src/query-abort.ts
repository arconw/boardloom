import type { QueryAbortSignal } from "./data-contract.js";

interface HostAbortController {
  readonly signal: QueryAbortSignal;
  abort(reason?: unknown): void;
}

type HostAbortControllerConstructor = new () => HostAbortController;

class FallbackAbortSignal implements QueryAbortSignal {
  private abortedFlag = false;
  private reasonValue: unknown;
  private readonly listeners = new Set<() => void>();

  get aborted(): boolean {
    return this.abortedFlag;
  }

  get reason(): unknown {
    return this.reasonValue;
  }

  addEventListener(_type: "abort", listener: () => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: "abort", listener: () => void): void {
    this.listeners.delete(listener);
  }

  cancel(reason?: unknown): void {
    if (this.abortedFlag) {
      return;
    }
    this.abortedFlag = true;
    this.reasonValue = reason;
    for (const listener of [...this.listeners]) {
      listener();
    }
    this.listeners.clear();
  }
}

export function createQueryAbortHandle(): {
  readonly signal: QueryAbortSignal;
  abort(reason?: unknown): void;
} {
  const Host = (globalThis as unknown as { AbortController?: HostAbortControllerConstructor })
    .AbortController;
  if (typeof Host === "function") {
    const controller = new Host();
    return Object.freeze({
      signal: controller.signal,
      abort: (reason?: unknown) => {
        if (!controller.signal.aborted) {
          controller.abort(reason);
        }
      },
    });
  }
  const signal = new FallbackAbortSignal();
  return Object.freeze({
    signal,
    abort: (reason?: unknown) => signal.cancel(reason),
  });
}
