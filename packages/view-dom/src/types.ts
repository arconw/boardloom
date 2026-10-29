import type {
  BoardSpace,
  BoardView,
  BoardloomRuntime,
  DatasetProvider,
  EditorLease,
  BoardSerialization,
  Diagnostic,
  MessageDictionaries,
  MessageDictionary,
  RendererDefinition,
  ExtensionSelection,
  Result,
  RuntimeOptions,
  SpaceEvent,
  ThemeMode,
  ViewMode,
  ViewSnapshot,
} from "@boardloom/core";
import type { BoardloomExtensions } from "./extensions.js";
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
  readonly messageDictionaries?: MessageDictionaries;
  readonly realtime?: BoardloomRealtimeStatus;
  readonly provenance?: string;
  readonly blockTypes?: readonly BlockTypeDefinition[];
  readonly renderers?: readonly RendererDefinition<HTMLElement>[];
  readonly extensions?: BoardloomExtensions;
  readonly extensionSelection?: ExtensionSelection;
  readonly onEvent?: (event: SpaceEvent) => void;
  readonly onImportDocument?: (
    input: string,
    fileName: string,
  ) => Result<{ readonly spaceId: string }>;
  readonly onExport?: (kind: "ui" | "host", serialization: BoardSerialization) => void;
}

export interface UpdateBoardViewOptions {
  readonly locale?: string;
  readonly timezone?: string;
  readonly theme?: ThemeMode;
  readonly messages?: MessageDictionary;
  readonly messageDictionaries?: MessageDictionaries;
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
  readonly messageDiagnostics: readonly Diagnostic[];
  readonly mounted: boolean;
  readonly disposed: boolean;
  update(options?: UpdateBoardViewOptions): Result<void>;
  setMode(mode: ViewMode, options?: { readonly lease?: EditorLease }): Result<ViewSnapshot>;
  refresh(): void;
  exportDocument(): Result<BoardSerialization>;
  focus(target?: FocusTarget): Result<void>;
  unmount(options?: { readonly draftDecision?: "apply" | "cancel" | "keep" }): Result<void>;
  dispose(options?: { readonly draftDecision?: "apply" | "cancel" | "keep" }): Result<void>;
}
