import type {
  BoardSerialization,
  BoardSpace,
  BoardView,
  BoardloomRuntime,
  DatasetProvider,
  Diagnostic,
  EditorLease,
  ExtensionSelection,
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

export interface BoardloomModeChange {
  readonly mode: ViewMode;
  readonly event: Extract<SpaceEvent, { type: "mode:changed" }>;
}

export interface BoardloomAngularInputs {
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
  readonly extensions?: BoardloomExtensions;
  readonly extensionSelection?: ExtensionSelection;
  readonly draftDecision?: BoardloomDraftDecision;
  readonly className?: string;
  readonly importDocument?: (
    input: string,
    fileName: string,
  ) => Result<{ readonly spaceId: string }>;
}

export interface AppliedUpdateState {
  readonly locale: string | undefined;
  readonly timezone: string | undefined;
  readonly theme: ThemeMode | undefined;
  readonly messages: MessageDictionary | undefined;
  readonly realtime: BoardloomRealtimeStatus | undefined;
  readonly provenance: string | undefined;
  readonly mode: ViewMode | undefined;
  readonly lease: EditorLease | undefined;
}

export type BoardloomExportListener = (
  kind: "ui" | "host",
  serialization: BoardSerialization,
) => void;
