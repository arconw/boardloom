import { createSystemClock, type Clock } from "./clock.js";
import { isBlockingValidation, validationWarnings, type DocumentValidator } from "./document.js";
import { assertFixedBindingsPreserved } from "./binding-model.js";
import {
  createEffectiveValidationCatalog,
  createProviderCapabilitiesCatalog,
} from "./dataset-catalog.js";
import { validateBoardDocument, type BoardValidationCatalog } from "./board-validation.js";
import {
  BoardloomError,
  DIAGNOSTIC_CODES,
  createDiagnostic,
  fail,
  hasError,
  ok,
  type Diagnostic,
  type Result,
} from "./diagnostics.js";
import type { DatasetDescriptor, DatasetProvider } from "./data-contract.js";
import type { BoardDocumentParseOptions } from "./document-io.js";
import { parseBoardDocument } from "./document-io.js";
import type { BoardDocument } from "./document.js";
import type { SpaceEvent, Unsubscribe } from "./events.js";
import { EventBus } from "./events.js";
import { createIntlFormatterProvider, type FormatterProvider } from "./formatting.js";
import { createSequentialIdFactory, type IdFactory } from "./ids.js";
import { deepFreeze } from "./json.js";
import type { BoardMigrationReport } from "./migrations.js";
import { noopLogger, type Logger } from "./logger.js";
import {
  DEFAULT_LOCALE_CONFIG,
  resolveLocaleConfig,
  type BoardloomLocale,
  type LocaleConfig,
} from "./locale.js";
import { normalizeMessageDictionary, type MessageDictionary } from "./messages.js";
import {
  createSpace,
  type BoardSpace,
  type SpaceDependencies,
  type SpaceImpl,
  type SpaceImportMetadata,
} from "./space.js";
import type { CreateSpaceOptions, SpaceSummary } from "./types.js";

export interface RuntimeOptions {
  readonly clock?: Clock;
  readonly idFactory?: IdFactory;
  readonly logger?: Logger;
  readonly documentValidator?: DocumentValidator;
  readonly validationCatalog?: BoardValidationCatalog;
  readonly formatterFactory?: (config: LocaleConfig) => FormatterProvider;
  readonly messageDictionaries?: Readonly<Partial<Record<BoardloomLocale, MessageDictionary>>>;
  readonly historyLimit?: number;
  readonly locale?: string;
  readonly timezone?: string;
  readonly datasetProvider?: DatasetProvider;
}

export interface ImportDocumentOptions extends Omit<
  BoardDocumentParseOptions,
  "idFactory" | "clock" | "targetVersion"
> {
  readonly sourceSpaceId?: string;
  readonly locale?: string;
  readonly timezone?: string;
  readonly datasetProvider?: DatasetProvider;
}

export interface ImportedDocument {
  readonly space: BoardSpace;
  readonly document: BoardDocument;
  readonly schemaVersion: number;
  readonly migration: BoardMigrationReport | null;
  readonly diagnostics: readonly Diagnostic[];
  readonly warnings: readonly Diagnostic[];
}

export interface BoardloomRuntime {
  readonly runtimeId: string;
  readonly disposed: boolean;
  readonly spaceCount: number;
  readonly listenerCount: number;
  createSpace(options: CreateSpaceOptions): Result<BoardSpace>;
  importDocument(input: unknown, options?: ImportDocumentOptions): Result<ImportedDocument>;
  getSpace(spaceId: string): BoardSpace | undefined;
  listSpaces(): readonly SpaceSummary[];
  subscribe(listener: (event: SpaceEvent) => void): Unsubscribe;
  dispose(): Result<void>;
}

function diagnosticKey(diagnostic: Diagnostic): string {
  return [
    diagnostic.code,
    diagnostic.path,
    diagnostic.message,
    diagnostic.severity,
    diagnostic.hint ?? "",
    diagnostic.source ?? "",
    (diagnostic.relatedIds ?? []).join("\u0000"),
  ].join("\u0000");
}

function dedupeDiagnostics(diagnostics: readonly Diagnostic[]): readonly Diagnostic[] {
  const seen = new Set<string>();
  const unique: Diagnostic[] = [];
  for (const diagnostic of diagnostics) {
    const key = diagnosticKey(diagnostic);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(diagnostic);
  }
  return Object.freeze(unique);
}

class RuntimeImpl implements BoardloomRuntime {
  readonly runtimeId: string;
  private readonly clock: Clock;
  private readonly idFactory: IdFactory;
  private readonly logger: Logger;
  private readonly customDocumentValidator?: DocumentValidator;
  private readonly validationCatalog?: BoardValidationCatalog;
  private readonly formatterFactory: (config: LocaleConfig) => FormatterProvider;
  private readonly messageDictionaries: Readonly<
    Partial<Record<BoardloomLocale, MessageDictionary>>
  >;
  private readonly historyLimit: number;
  private readonly datasetProvider?: DatasetProvider;
  private readonly localeInput: { readonly locale?: string; readonly timezone?: string };
  private readonly spaces = new Map<string, SpaceImpl>();
  private readonly spaceProviders = new Map<string, DatasetProvider>();
  private readonly pendingTerminals = new Map<string, { spaceId: string; remaining: number }>();
  private readonly events: EventBus<SpaceEvent>;
  private disposedFlag = false;
  private disposing = false;
  private shuttingDown = false;
  private importEventSequence = 0;

  constructor(options: RuntimeOptions = {}) {
    this.clock = options.clock ?? createSystemClock();
    this.idFactory = options.idFactory ?? createSequentialIdFactory({ clock: this.clock });
    this.logger = options.logger ?? noopLogger;
    this.customDocumentValidator = options.documentValidator;
    this.validationCatalog = options.validationCatalog;
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
    this.datasetProvider = options.datasetProvider;
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

  private createDocumentValidator(catalog?: BoardValidationCatalog): DocumentValidator {
    const baseline: DocumentValidator = (document) => {
      const validation = validateBoardDocument(document, catalog === undefined ? {} : { catalog });
      return Object.freeze({
        valid: validation.valid,
        diagnostics: validation.diagnostics,
      });
    };
    if (!this.customDocumentValidator) {
      return baseline;
    }
    const custom = this.customDocumentValidator;
    return (document) => {
      const diagnostics: Diagnostic[] = [];
      for (const validator of [baseline, custom]) {
        const result = validator(document);
        diagnostics.push(...result.diagnostics);
        if (!result.valid || hasError(result.diagnostics)) {
          return Object.freeze({
            valid: false,
            diagnostics: dedupeDiagnostics(diagnostics),
          });
        }
      }
      return Object.freeze({
        valid: true,
        diagnostics: dedupeDiagnostics(diagnostics),
      });
    };
  }

  createSpace(options: CreateSpaceOptions): Result<BoardSpace> {
    return this.createSpaceInternal(options);
  }

  importDocument(input: unknown, options: ImportDocumentOptions = {}): Result<ImportedDocument> {
    if (this.disposedFlag || this.disposing) {
      return fail([createDiagnostic(DIAGNOSTIC_CODES.RUNTIME_DISPOSED, "runtime")]);
    }

    const sourceSpace = options.sourceSpaceId ? this.spaces.get(options.sourceSpaceId) : undefined;
    if (options.sourceSpaceId !== undefined) {
      if (!sourceSpace) {
        const diagnostic = createDiagnostic(DIAGNOSTIC_CODES.SPACE_NOT_FOUND, "sourceSpaceId", {
          relatedIds: [options.sourceSpaceId],
        });
        this.emitImportFailure([diagnostic], options.sourceSpaceId);
        return fail([diagnostic]);
      }
      if (sourceSpace.disposed) {
        const diagnostic = createDiagnostic(DIAGNOSTIC_CODES.SPACE_DISPOSED, "sourceSpaceId", {
          relatedIds: [options.sourceSpaceId],
        });
        this.emitImportFailure([diagnostic], options.sourceSpaceId);
        return fail([diagnostic]);
      }
    }

    const sourceProvider =
      options.sourceSpaceId === undefined
        ? undefined
        : this.spaceProviders.get(options.sourceSpaceId);
    const effectiveImportProvider =
      options.datasetProvider ?? sourceProvider ?? this.datasetProvider;

    const effectiveCatalog = this.effectiveValidationCatalog(
      options.catalog ?? this.validationCatalog,
      effectiveImportProvider,
    );
    const prepared = parseBoardDocument(input, {
      ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }),
      ...(options.maxDepth === undefined ? {} : { maxDepth: options.maxDepth }),
      ...(options.maxNodes === undefined ? {} : { maxNodes: options.maxNodes }),
      ...(options.maxArrayLength === undefined ? {} : { maxArrayLength: options.maxArrayLength }),
      ...(options.maxObjectKeys === undefined ? {} : { maxObjectKeys: options.maxObjectKeys }),
      ...(options.maxStringLength === undefined
        ? {}
        : { maxStringLength: options.maxStringLength }),
      ...(options.allowMigration === undefined ? {} : { allowMigration: options.allowMigration }),
      ...(options.migrationChain === undefined ? {} : { migrationChain: options.migrationChain }),
      ...(effectiveCatalog === undefined ? {} : { catalog: effectiveCatalog }),
      idFactory: this.idFactory,
      clock: this.clock,
    });
    if (!prepared.ok) {
      this.emitImportFailure(prepared.diagnostics, options.sourceSpaceId);
      return fail(prepared.diagnostics);
    }
    if (sourceSpace !== undefined) {
      const fixedChanges = assertFixedBindingsPreserved(
        sourceSpace.getSnapshot().committedDocument,
        prepared.value.document,
        { allowDifferentDocument: true },
      );
      if (fixedChanges.length > 0) {
        this.emitImportFailure(fixedChanges, options.sourceSpaceId);
        return fail(fixedChanges);
      }
    }

    let spaceId = this.idFactory.createId("space");
    let attempts = 0;
    while ((spaceId === options.sourceSpaceId || this.spaces.has(spaceId)) && attempts < 32) {
      spaceId = this.idFactory.createId("space");
      attempts += 1;
    }
    if (spaceId === options.sourceSpaceId || this.spaces.has(spaceId)) {
      const diagnostic = createDiagnostic(DIAGNOSTIC_CODES.INVALID_ARGUMENT, "sourceSpaceId", {
        message: "A fresh runtime space ID could not be allocated for the imported document.",
      });
      this.emitImportFailure([diagnostic], options.sourceSpaceId);
      return fail([diagnostic]);
    }

    const importedDocumentId = prepared.value.document.id;
    const importMetadata: SpaceImportMetadata = Object.freeze({
      ...(options.sourceSpaceId === undefined ? {} : { sourceSpaceId: options.sourceSpaceId }),
      documentId: typeof importedDocumentId === "string" ? importedDocumentId : "",
      schemaVersion: prepared.value.schemaVersion,
      migration: prepared.value.migration,
      warnings: prepared.value.warnings,
    });
    const created = this.createSpaceInternal(
      {
        id: spaceId,
        document: prepared.value.document,
        ...(options.locale === undefined ? {} : { locale: options.locale }),
        ...(options.timezone === undefined ? {} : { timezone: options.timezone }),
        ...(effectiveImportProvider === undefined
          ? {}
          : { datasetProvider: effectiveImportProvider }),
      },
      importMetadata,
      prepared.value.warnings,
      effectiveCatalog,
    );
    if (!created.ok) {
      this.emitImportFailure(created.diagnostics, options.sourceSpaceId);
      return fail(created.diagnostics);
    }

    return ok(
      Object.freeze({
        space: created.value,
        document: prepared.value.document,
        schemaVersion: prepared.value.schemaVersion,
        migration: prepared.value.migration,
        diagnostics: prepared.value.diagnostics,
        warnings: prepared.value.warnings,
      }),
    );
  }

  private providerDescriptors(provider: DatasetProvider | undefined): readonly DatasetDescriptor[] {
    if (provider === undefined) {
      return Object.freeze([]);
    }
    try {
      const descriptors: DatasetDescriptor[] = [];
      for (const datasetId of provider.listDatasetIds()) {
        const descriptor = provider.getDatasetDescriptor(datasetId);
        if (descriptor !== undefined) {
          descriptors.push(descriptor);
        }
      }
      return Object.freeze(descriptors);
    } catch {
      return Object.freeze([]);
    }
  }

  private effectiveValidationCatalog(
    catalog: BoardValidationCatalog | undefined,
    provider: DatasetProvider | undefined,
  ): BoardValidationCatalog | undefined {
    const descriptors = this.providerDescriptors(provider);
    if (catalog === undefined) {
      return createProviderCapabilitiesCatalog(descriptors);
    }
    return createEffectiveValidationCatalog(catalog, descriptors);
  }

  private createSpaceInternal(
    options: CreateSpaceOptions,
    importMetadata?: SpaceImportMetadata,
    importWarnings: readonly Diagnostic[] = [],
    catalogOverride?: BoardValidationCatalog,
  ): Result<BoardSpace> {
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

    const effectiveProvider = options.datasetProvider ?? this.datasetProvider;
    const validationCatalog = this.effectiveValidationCatalog(
      catalogOverride ?? this.validationCatalog,
      effectiveProvider,
    );
    const documentValidator = this.createDocumentValidator(validationCatalog);
    const validation = documentValidator(options.document);
    if (isBlockingValidation(validation)) {
      return fail(validation.diagnostics);
    }
    const warnings = dedupeDiagnostics([...importWarnings, ...validationWarnings(validation)]);

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
      documentValidator,
      ...(validationCatalog === undefined ? {} : { validationCatalog }),
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
          ...(effectiveProvider === undefined ? {} : { datasetProvider: effectiveProvider }),
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
    if (effectiveProvider === undefined) {
      this.spaceProviders.delete(spaceId);
    } else {
      this.spaceProviders.set(spaceId, effectiveProvider);
    }
    space.start(importMetadata);
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
    this.spaceProviders.clear();
    this.pendingTerminals.clear();
    this.events.finishShutdownDeferred();
    this.disposing = false;
    return ok(undefined);
  }

  private emitImportFailure(diagnostics: readonly Diagnostic[], sourceSpaceId?: string): void {
    if (this.disposedFlag || this.disposing || this.shuttingDown) {
      return;
    }
    this.importEventSequence += 1;
    this.events.emit(
      deepFreeze({
        type: "import:failed",
        scope: "runtime",
        runtimeId: this.runtimeId,
        spaceId: "",
        lifetimeId: "",
        sequence: this.importEventSequence,
        timestamp: this.clock.now(),
        ...(sourceSpaceId === undefined ? {} : { sourceSpaceId }),
        diagnostics: Object.freeze([...diagnostics]),
      }),
    );
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
      this.spaceProviders.delete(spaceId);
    }
  }
}

export function createRuntime(options: RuntimeOptions = {}): BoardloomRuntime {
  return new RuntimeImpl(options);
}
