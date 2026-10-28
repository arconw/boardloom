export { mountBoardView } from "./mount.js";
export {
  createBlockRegistry,
  type BlockRegistry,
  type BlockSurface,
  type BlockSurfaceEnvironment,
  type BlockTypeDefinition,
} from "./block-registry.js";
export { BUILT_IN_BLOCK_TYPES } from "./built-in-blocks.js";
export { createViewMessages, type ViewMessages } from "./messages.js";
export {
  realtimeLabel,
  realtimeText,
  type BoardloomRealtimeStatus,
  type RealtimeLabel,
  type RealtimeStatus,
} from "./realtime.js";
export type {
  BoardViewHandle,
  FocusTarget,
  MountBoardViewOptions,
  UpdateBoardViewOptions,
} from "./types.js";
