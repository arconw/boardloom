import type { DatasetProvider, QueryState } from "./data-contract.js";
import type { BoardDocument } from "./document.js";
import type { Diagnostic } from "./diagnostics.js";
import type { BoardloomLocale } from "./locale.js";
import type { FilterRuntimeState } from "./filter-model.js";

export type ViewMode = "viewer" | "editor";
export type SpaceStatus = "active" | "paused" | "disposed";
export type DraftResolution = "apply" | "cancel";
export type DraftDecision = DraftResolution | "keep";

export interface EditorLease {
  readonly leaseId: string;
  readonly spaceId: string;
  readonly sessionId: string;
  readonly acquiredAt: number;
}

export interface DraftSnapshot {
  readonly revision: number;
  readonly baseRevision: number;
  readonly document: BoardDocument;
  readonly dirty: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

export interface ViewSummary {
  readonly viewId: string;
  readonly mode: ViewMode;
  readonly sessionId: string | null;
  readonly leaseId: string | null;
  readonly disposed: boolean;
}

export interface SpaceSnapshot {
  readonly spaceId: string;
  readonly lifetimeId: string;
  readonly status: SpaceStatus;
  readonly committedDocument: BoardDocument;
  readonly committedRevision: number;
  readonly draft: DraftSnapshot | null;
  readonly editorLease: EditorLease | null;
  readonly locale: BoardloomLocale;
  readonly timezone: string;
  readonly diagnostics: readonly Diagnostic[];
  readonly filterState: FilterRuntimeState;
  readonly queries: readonly QueryState[];
  readonly queryCount: number;
  readonly views: readonly ViewSummary[];
  readonly viewCount: number;
  readonly listenerCount: number;
  readonly taskCount: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly sequence: number;
}

export interface ViewState {
  readonly committedRevision: number;
  readonly draft: DraftSnapshot | null;
  readonly locale: BoardloomLocale;
  readonly timezone: string;
}

export interface ViewSnapshot {
  readonly viewId: string;
  readonly spaceId: string;
  readonly mode: ViewMode;
  readonly sessionId: string | null;
  readonly leaseId: string | null;
  readonly disposed: boolean;
  readonly committedRevision: number;
  readonly draft: DraftSnapshot | null;
  readonly locale: BoardloomLocale;
  readonly timezone: string;
}

export interface SpaceSummary {
  readonly spaceId: string;
  readonly lifetimeId: string;
  readonly status: SpaceStatus;
  readonly committedRevision: number;
  readonly viewCount: number;
}

export interface CreateSpaceOptions {
  readonly id?: string;
  readonly document: unknown;
  readonly locale?: string;
  readonly timezone?: string;
  readonly datasetProvider?: DatasetProvider;
}

export interface CreateViewOptions {
  readonly mode?: ViewMode;
  readonly lease?: EditorLease;
}

export interface ReleaseEditorLeaseOptions {
  readonly decision?: DraftResolution;
}

export interface DisposeViewOptions {
  readonly draftDecision?: DraftDecision;
}

export interface ViewDisposalResult {
  readonly viewId: string;
  readonly retainedLease: EditorLease | null;
}

export interface AcquireEditorLeaseOptions {
  readonly sessionId?: string;
}
