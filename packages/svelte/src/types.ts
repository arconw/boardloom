import type { HTMLAttributes } from "svelte/elements";
import type {
  BoardSerialization,
  BoardSpace,
  BoardView,
  BoardloomRuntime,
  DatasetProvider,
  Diagnostic,
  EditorLease,
  ExtensionSelection,
  MessageDictionaries,
  MessageDictionary,
  RendererDefinition,
  Result,
  RuntimeOptions,
  SpaceEvent,
  ThemeMode,
  ViewMode,
} from "@boardloom/core";
import type {
  BlockTypeDefinition,
  BoardloomExtensions,
  BoardloomRealtimeStatus,
  BoardViewHandle,
} from "@boardloom/view-dom";

export type BoardloomDraftDecision = "apply" | "cancel" | "keep";

export type BoardloomAdapterPhase = "mount" | "update" | "dispose" | "input";

export interface BoardloomRetainedSession {
  readonly handle: BoardViewHandle;
  readonly spaceId: string;
  readonly viewId: string;
}

export interface BoardloomAdapterError {
  readonly phase: BoardloomAdapterPhase;
  readonly diagnostics: readonly Diagnostic[];
  readonly retained?: BoardloomRetainedSession;
}

export interface BoardloomViewReadyInfo {
  readonly spaceId: string;
  readonly viewId: string;
  readonly element: HTMLElement;
}

export interface BoardloomViewProps {
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
  readonly draftDecision?: BoardloomDraftDecision;
  readonly handle?: BoardloomViewHandle | null;
  readonly class?: string;
  readonly style?: string;
  readonly containerProps?: Omit<HTMLAttributes<HTMLDivElement>, "children">;
  readonly onEvent?: (event: SpaceEvent) => void;
  readonly onModeChange?: (
    mode: ViewMode,
    event: Extract<SpaceEvent, { type: "mode:changed" }>,
  ) => void;
  readonly onImportDocument?: (
    input: string,
    fileName: string,
  ) => Result<{ readonly spaceId: string }>;
  readonly onExport?: (kind: "ui" | "host", serialization: BoardSerialization) => void;
  readonly onReady?: (info: BoardloomViewReadyInfo) => void;
  readonly onDispose?: (info: BoardloomViewReadyInfo) => void;
  readonly onError?: (error: BoardloomAdapterError) => void;
}

export type BoardloomViewHandle = BoardViewHandle;

export interface AppliedUpdateState {
  readonly locale: string | undefined;
  readonly timezone: string | undefined;
  readonly theme: ThemeMode | undefined;
  readonly messages: MessageDictionary | undefined;
  readonly messageDictionaries: MessageDictionaries | undefined;
  readonly realtime: BoardloomRealtimeStatus | undefined;
  readonly provenance: string | undefined;
  readonly mode: ViewMode | undefined;
  readonly lease: EditorLease | undefined;
}
