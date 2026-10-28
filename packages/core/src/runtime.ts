import { createSystemClock, type Clock } from "./clock.js";
import {
  defaultDocumentValidator,
  isBlockingValidation,
  validationWarnings,
  type DocumentValidator,
} from "./document.js";
import {
  BoardloomError,
  DIAGNOSTIC_CODES,
  createDiagnostic,
  fail,
  ok,
  type Result,
} from "./diagnostics.js";
import type { SpaceEvent, Unsubscribe } from "./events.js";
import { EventBus } from "./events.js";
import { createIntlFormatterProvider, type FormatterProvider } from "./formatting.js";
import { createSequentialIdFactory, type IdFactory } from "./ids.js";
import { noopLogger, type Logger } from "./logger.js";
import {
  DEFAULT_LOCALE_CONFIG,
  resolveLocaleConfig,
  type BoardloomLocale,
  type LocaleConfig,
} from "./locale.js";
import { normalizeMessageDictionary, type MessageDictionary } from "./messages.js";
import { createSpace, type BoardSpace, type SpaceDependencies, type SpaceImpl } from "./space.js";
import type { CreateSpaceOptions, SpaceSummary } from "./types.js";

export interface RuntimeOptions {
  readonly clock?: Clock;
  readonly idFactory?: IdFactory;
  readonly logger?: Logger;
  readonly documentValidator?: DocumentValidator;
  readonly formatterFactory?: (config: LocaleConfig) => FormatterProvider;
  readonly messageDictionaries?: Readonly<Partial<Record<BoardloomLocale, MessageDictionary>>>;
  readonly historyLimit?: number;
  readonly locale?: string;
  readonly timezone?: string;
}

export interface BoardloomRuntime {
  readonly runtimeId: string;
  readonly disposed: boolean;
  readonly spaceCount: number;
  readonly listenerCount: number;
  createSpace(options: CreateSpaceOptions): Result<BoardSpace>;
  getSpace(spaceId: string): BoardSpace | undefined;
  listSpaces(): readonly SpaceSummary[];
  subscribe(listener: (event: SpaceEvent) => void): Unsubscribe;
  dispose(): Result<void>;
}

class RuntimeImpl implements BoardloomRuntime {
  readonly runtimeId: string;
  private readonly clock: Clock;
  private readonly idFactory: IdFactory;
  private readonly logger: Logger;
  private readonly documentValidator: DocumentValidator;
  private readonly formatterFactory: (config: LocaleConfig) => FormatterProvider;
  private readonly messageDictionaries: Readonly<
    Partial<Record<BoardloomLocale, MessageDictionary>>
  >;
  private readonly historyLimit: number;
  private readonly localeInput: { readonly locale?: string; readonly timezone?: string };
  private readonly spaces = new Map<string, SpaceImpl>();
  private readonly pendingTerminals = new Map<string, { spaceId: string; remaining: number }>();
  private readonly events: EventBus<SpaceEvent>;
  private disposedFlag = false;
  private disposing = false;
  private shuttingDown = false;

  constructor(options: RuntimeOptions = {}) {
    this.clock = options.clock ?? createSystemClock();
    this.idFactory = options.idFactory ?? createSequentialIdFactory({ clock: this.clock });
    this.logger = options.logger ?? noopLogger;
    this.documentValidator = options.documentValidator ?? defaultDocumentValidator;
    this.formatterFactory = options.formatterFactory ?? createIntlFormatterProvider;
    const dictionaries: Partial<Record<BoardloomLocale, MessageDictionary>> = {};
    for (const [locale, dictionary] of Object.entries(options.messageDictionaries ?? {})) {
      if (dictionary !== undefined) {
        dictionaries[locale as BoardloomLocale] = normalizeMessageDictionary(dictionary, locale);
      }
    }
    this.messageDictionaries = Object.freeze(dictionaries);
    const requestedLimit = options.historyLimit ?? 100;
    this.historyLimit =
      Number.isFinite(requestedLimit) && requestedLimit >= 0 ? Math.floor(requestedLimit) : 100;
    this.localeInput = Object.freeze({
      locale: options.locale,
      timezone: options.timezone,
    });
    this.runtimeId = this.idFactory.createId("runtime");
    this.events = new EventBus<SpaceEvent>((error) => {
      this.logger.error("Boardloom runtime listener failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  get disposed(): boolean {
    return this.disposedFlag;
  }

  get spaceCount(): number {
    return this.spaces.size;
  }

  get listenerCount(): number {
    return this.events.listenerCount;
  }

  createSpace(options: CreateSpaceOptions): Result<BoardSpace> {
    if (this.disposedFlag || this.disposing) {
      return fail([createDiagnostic(DIAGNOSTIC_CODES.RUNTIME_DISPOSED, "runtime")]);
    }

    const runtimeLocale = resolveLocaleConfig(this.localeInput, DEFAULT_LOCALE_CONFIG);
    if (!runtimeLocale.ok) {
      return runtimeLocale;
    }
    const localeResult = resolveLocaleConfig(
      { locale: options.locale, timezone: options.timezone },
      runtimeLocale.value,
    );
    if (!localeResult.ok) {
      return localeResult;
    }

    const validation = this.documentValidator(options.document);
    if (isBlockingValidation(validation)) {
      return fail(validation.diagnostics);
    }
    const warnings = validationWarnings(validation);

    if (options.id !== undefined && (typeof options.id !== "string" || options.id.trim() === "")) {
      return fail([
        createDiagnostic(DIAGNOSTIC_CODES.INVALID_ARGUMENT, "id", {
          message: "The space ID must be a non-empty string.",
        }),
      ]);
    }
    const spaceId = options.id ?? this.idFactory.createId("space");
    if (this.spaces.has(spaceId)) {
      return fail([
        createDiagnostic(DIAGNOSTIC_CODES.SPACE_ALREADY_EXISTS, "id", {
          relatedIds: [spaceId],
        }),
      ]);
    }

    const dependencies: SpaceDependencies = {
      idFactory: this.idFactory,
      clock: this.clock,
      logger: this.logger,
      documentValidator: this.documentValidator,
      formatterFactory: this.formatterFactory,
      messageDictionaries: this.messageDictionaries,
      historyLimit: this.historyLimit,
      forwardEvent: (event) => {
        if (event.type === "space:disposed") {
          const afterDelivered = () => {
            this.markTerminalDelivered(event.spaceId, event.lifetimeId);
          };
          if (this.shuttingDown) {
            this.events.emitFinal(event, afterDelivered);
          } else {
            this.events.emitTerminal(event, afterDelivered);
          }
          return;
        }
        if (!this.shuttingDown) {
          this.events.emit(event);
        }
      },
      onDisposed: (disposedSpaceId, disposedLifetimeId) => {
        this.pendingTerminals.set(disposedLifetimeId, {
          spaceId: disposedSpaceId,
          remaining: 2,
        });
        this.events.removeQueued((event) => event.lifetimeId === disposedLifetimeId);
        this.events.abortActiveMatching((event) => event.lifetimeId === disposedLifetimeId);
      },
      onTerminalDelivered: (disposedSpaceId, disposedLifetimeId) => {
        this.markTerminalDelivered(disposedSpaceId, disposedLifetimeId);
      },
    };

    let space: SpaceImpl;
    try {
      space = createSpace(
        {
          ...options,
          id: spaceId,
          localeConfig: localeResult.value,
          warnings,
        },
        dependencies,
      );
    } catch (error) {
      if (error instanceof BoardloomError) {
        return fail([error.diagnostic]);
      }
      return fail([
        createDiagnostic(DIAGNOSTIC_CODES.FORMATTER_INIT_FAILED, "options", {
          message: error instanceof Error ? error.message : String(error),
        }),
      ]);
    }

    this.spaces.set(spaceId, space);
    space.start();
    return ok(space);
  }

  getSpace(spaceId: string): BoardSpace | undefined {
    return this.spaces.get(spaceId);
  }

  listSpaces(): readonly SpaceSummary[] {
    return Object.freeze(
      [...this.spaces.values()]
        .map((space) => space.summary())
        .sort((left, right) =>
          left.spaceId < right.spaceId ? -1 : left.spaceId > right.spaceId ? 1 : 0,
        ),
    );
  }

  subscribe(listener: (event: SpaceEvent) => void): Unsubscribe {
    if (this.disposedFlag) {
      return () => undefined;
    }
    return this.events.subscribe(listener);
  }

  dispose(): Result<void> {
    if (this.disposedFlag || this.disposing) {
      return ok(undefined);
    }
    this.disposing = true;
    this.shuttingDown = true;
    this.disposedFlag = true;
    this.events.beginShutdown();
    for (const space of [...this.spaces.values()]) {
      space.dispose();
    }
    this.spaces.clear();
    this.pendingTerminals.clear();
    this.events.finishShutdownDeferred();
    this.disposing = false;
    return ok(undefined);
  }

  private markTerminalDelivered(spaceId: string, lifetimeId: string): void {
    const pending = this.pendingTerminals.get(lifetimeId);
    if (!pending) {
      return;
    }
    pending.remaining -= 1;
    if (pending.remaining > 0) {
      return;
    }
    this.pendingTerminals.delete(lifetimeId);
    const current = this.spaces.get(spaceId);
    if (current?.lifetimeId === lifetimeId) {
      this.spaces.delete(spaceId);
    }
  }
}

export function createRuntime(options: RuntimeOptions = {}): BoardloomRuntime {
  return new RuntimeImpl(options);
}
