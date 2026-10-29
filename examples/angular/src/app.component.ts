import { ChangeDetectionStrategy, Component, computed, signal, viewChild } from "@angular/core";
import type {
  Diagnostic,
  EditorLease,
  MessageDictionary,
  SpaceEvent,
  ViewMode,
} from "@boardloom/core";
import {
  BoardloomViewComponent,
  type BoardloomAdapterError,
  type BoardloomModeChange,
  type BoardloomRetainedSession,
  type BoardloomViewReadyInfo,
} from "@boardloom/angular";
import { createExampleDocument, createExampleProvider } from "./data.js";

const LOCALES = ["en", "ru", "es", "fr", "de", "pt-BR", "zh-CN", "ja", "ko", "ar", "hi"] as const;

const TIMEZONES = [
  "UTC",
  "Europe/Berlin",
  "Europe/London",
  "America/New_York",
  "Asia/Tokyo",
  "Asia/Kolkata",
  "Australia/Sydney",
] as const;

interface InstanceInfo {
  readonly spaceId: string;
  readonly viewId: string;
}

function describeDiagnostics(diagnostics: readonly Diagnostic[]): string {
  return diagnostics.map((diagnostic) => `${diagnostic.code} ${diagnostic.path}`).join(", ");
}

@Component({
  selector: "boardloom-angular-example",
  standalone: true,
  imports: [BoardloomViewComponent],
  templateUrl: "./app.component.html",
  styleUrl: "./app.component.css",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent {
  readonly locales = LOCALES;
  readonly timezones = TIMEZONES;
  readonly locale = signal<string>("en");
  readonly timezone = signal<string>("UTC");
  readonly overrideMessages = signal(false);
  readonly variant = signal(false);
  readonly mounted = signal(true);
  readonly viewMode = signal<ViewMode>("viewer");
  readonly lease = signal<EditorLease | undefined>(undefined);
  readonly events = signal<readonly string[]>([]);
  readonly lastEvent = signal("none");
  readonly readyCount = signal(0);
  readonly disposedCount = signal(0);
  readonly retainedSessions = signal<readonly BoardloomRetainedSession[]>([]);
  readonly instance = signal<InstanceInfo | null>(null);
  readonly action = signal("idle");
  readonly exported = signal("");
  readonly provider = createExampleProvider();
  readonly boardDocument = computed(() => createExampleDocument(this.variant()));
  readonly messages = computed<MessageDictionary | undefined>(() =>
    this.overrideMessages()
      ? {
          "mode.viewer": "Reader",
          "mode.editor": "Author",
        }
      : undefined,
  );
  readonly activeCount = computed(() =>
    Math.max(0, this.readyCount() - this.disposedCount() - this.retainedSessions().length),
  );
  readonly board = viewChild<BoardloomViewComponent>("board");

  recordEvent(event: SpaceEvent): void {
    this.lastEvent.set(event.type);
    this.events.update((current) => [event.type, ...current].slice(0, 8));
  }

  onModeChange(change: BoardloomModeChange): void {
    this.viewMode.set(change.mode);
    this.action.set(`mode output: ${change.mode}`);
  }

  onReady(info: BoardloomViewReadyInfo): void {
    this.readyCount.update((current) => current + 1);
    this.instance.set({ spaceId: info.spaceId, viewId: info.viewId });
  }

  onDisposed(): void {
    this.disposedCount.update((current) => current + 1);
    this.instance.set(null);
  }

  onAdapterError(error: BoardloomAdapterError): void {
    const retained = error.retained;
    if (retained !== undefined) {
      this.retainedSessions.update((current) =>
        current.some((entry) => entry.viewId === retained.viewId)
          ? current
          : [...current, retained],
      );
      this.instance.set(null);
    }
    if (error.phase === "mount") {
      this.mounted.set(false);
    }
    this.action.set(`${error.phase}: ${describeDiagnostics(error.diagnostics)}`);
  }

  onDocumentExport(payload: {
    readonly kind: "ui" | "host";
    readonly serialization: unknown;
  }): void {
    this.action.set(`host export output (${payload.kind})`);
    this.exported.set(JSON.stringify(payload.serialization).slice(0, 480));
  }

  setLocale(event: Event): void {
    this.locale.set((event.target as HTMLSelectElement).value);
  }

  setTimezone(event: Event): void {
    this.timezone.set((event.target as HTMLSelectElement).value);
  }

  setOverrideMessages(event: Event): void {
    this.overrideMessages.set((event.target as HTMLInputElement).checked);
  }

  setVariant(event: Event): void {
    this.variant.set((event.target as HTMLInputElement).checked);
    this.lease.set(undefined);
    this.viewMode.set("viewer");
  }

  switchToEditor(): void {
    const handle = this.board()?.handle;
    if (handle === undefined || handle === null) {
      return;
    }
    let lease = handle.space.getSnapshot().editorLease;
    if (lease === null) {
      const acquired = handle.space.acquireEditorLease({ sessionId: "angular-example-host" });
      if (!acquired.ok) {
        this.action.set(`editor lease: ${describeDiagnostics(acquired.diagnostics)}`);
        return;
      }
      lease = acquired.value;
    }
    this.lease.set(lease);
    this.viewMode.set("editor");
    this.action.set("host switched to editor");
  }

  switchToViewer(): void {
    if (this.board()?.handle === undefined || this.board()?.handle === null) {
      return;
    }
    this.lease.set(undefined);
    this.viewMode.set("viewer");
    this.action.set("host switched to viewer");
  }

  focusContent(): void {
    const handle = this.board()?.handle;
    if (handle === undefined || handle === null) {
      return;
    }
    const focused = handle.focus("content");
    this.action.set(
      focused.ok ? "focused board content" : `focus: ${describeDiagnostics(focused.diagnostics)}`,
    );
  }

  exportDocument(): void {
    const handle = this.board()?.handle;
    if (handle === undefined || handle === null) {
      return;
    }
    const result = handle.exportDocument();
    if (!result.ok) {
      this.action.set(`export: ${describeDiagnostics(result.diagnostics)}`);
      return;
    }
    this.action.set("exported committed document");
    this.exported.set(JSON.stringify(result.value).slice(0, 480));
  }

  toggleMount(): void {
    if (this.mounted()) {
      this.lease.set(undefined);
      this.viewMode.set("viewer");
    }
    this.mounted.update((current) => !current);
  }

  resolveRetained(session: BoardloomRetainedSession, decision: "apply" | "cancel"): void {
    const result = session.handle.dispose({ draftDecision: decision });
    if (!result.ok) {
      this.action.set(`retained ${decision}: ${describeDiagnostics(result.diagnostics)}`);
      return;
    }
    this.retainedSessions.update((current) =>
      current.filter((entry) => entry.viewId !== session.viewId),
    );
    this.disposedCount.update((current) => current + 1);
    this.action.set(decision === "apply" ? "retained draft applied" : "retained draft discarded");
  }
}
