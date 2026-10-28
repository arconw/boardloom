import type { BoardView } from "@boardloom/core";

const MOUNT_CLAIM = Symbol.for("boardloom.view.mount-claim");

type ClaimableView = BoardView & { readonly [MOUNT_CLAIM]?: boolean };

export function claimMountedView(view: BoardView): boolean {
  const claimable = view as ClaimableView;
  if (claimable[MOUNT_CLAIM] === true) {
    return false;
  }
  try {
    Object.defineProperty(claimable, MOUNT_CLAIM, {
      value: true,
      configurable: true,
      enumerable: false,
      writable: false,
    });
    return true;
  } catch {
    return false;
  }
}

export function releaseMountedView(view: BoardView): void {
  Reflect.deleteProperty(view as ClaimableView, MOUNT_CLAIM);
}

export function isMountedView(view: BoardView): boolean {
  return (view as ClaimableView)[MOUNT_CLAIM] === true;
}
