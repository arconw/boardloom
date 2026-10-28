import type {
  BoardSpace,
  BoardView,
  BoardloomRuntime,
  DatasetProvider,
  EditorLease,
  MessageDictionary,
  RendererDefinition,
  Result,
  RuntimeOptions,
  SpaceEvent,
  ThemeMode,
  ViewMode,
  ViewSnapshot,
} from "@boardloom/core";
import type { BlockTypeDefinition } from "./block-registry.js";
import type { BoardloomRealtimeStatus } from "./realtime.js";

export interface MountBoardViewOptions {
  readonly space?: BoardSpace;
  readonly runtime?: BoardloomRuntime;
  readonly runtimeOptions?: RuntimeOptions;
  readonly document?: unknown;
  readonly datasetProvider?: DatasetProvider;
  readonly view?: BoardView;
  readonly mode?: ViewMode;
  readonly lease?: EditorLease;
  readonly locale?: string;
  readonly timezone?: string;
  readonly theme?: ThemeMode;
  readonly messages?: MessageDictionary;
  readonly realtime?: BoardloomRealtimeStatus;
  readonly provenance?: string;
  readonly blockTypes?: readonly BlockTypeDefinition[];
  readonly renderers?: readonly RendererDefinition<HTMLElement>[];
  readonly onEvent?: (event: SpaceEvent) => void;
}

export interface UpdateBoardViewOptions {
  readonly locale?: string;
  readonly timezone?: string;
  readonly theme?: ThemeMode;
  readonly messages?: MessageDictionary;
  readonly realtime?: BoardloomRealtimeStatus;
  readonly provenance?: string;
  readonly mode?: ViewMode;
  readonly lease?: EditorLease;
  readonly onEvent?: (event: SpaceEvent) => void;
}

export type FocusTarget = "title" | "content";

export interface BoardViewHandle {
  readonly space: BoardSpace;
  readonly view: BoardView;
  readonly element: HTMLElement;
  readonly mounted: boolean;
  readonly disposed: boolean;
  update(options?: UpdateBoardViewOptions): Result<void>;
  setMode(mode: ViewMode, options?: { readonly lease?: EditorLease }): Result<ViewSnapshot>;
  refresh(): void;
  focus(target?: FocusTarget): Result<void>;
  unmount(options?: { readonly draftDecision?: "apply" | "cancel" | "keep" }): Result<void>;
  dispose(options?: { readonly draftDecision?: "apply" | "cancel" | "keep" }): Result<void>;
}
