import { isAllowedThemeTokenName, validateThemeTokenValue } from "./board-schema.js";
import type { DatasetProvider } from "./data-contract.js";
import { validateDatasetProviderContract } from "./data-contract.js";
import {
  DIAGNOSTIC_CODES,
  createDiagnostic,
  fail,
  ok,
  type Diagnostic,
  type Result,
} from "./diagnostics.js";
import type { FormatterProvider } from "./formatting.js";
import { isBoardloomLocale, type BoardloomLocale, type LocaleConfig } from "./locale.js";
import { normalizeMessageDictionary, type MessageDictionary } from "./messages.js";
import type { RealtimeTransport } from "./realtime-contract.js";
import { validateExtensionStyles } from "./extension-style.js";

export const EXTENSION_API_VERSION = 1 as const;
export const BLOCK_EXTENSION_API_VERSION = 1 as const;
export const RENDERER_EXTENSION_API_VERSION = 1 as const;

export const EXTENSION_KINDS = Object.freeze([
  "block",
  "renderer",
  "queryAdapter",
  "realtimeAdapter",
  "formatter",
  "messageDictionary",
  "theme",
] as const);

export type ExtensionKind = (typeof EXTENSION_KINDS)[number];

export const CORE_EXTENSION_KINDS = Object.freeze([
  "queryAdapter",
  "realtimeAdapter",
  "formatter",
  "messageDictionary",
  "theme",
] as const);

export type CoreExtensionKind = (typeof CORE_EXTENSION_KINDS)[number];

export interface ExtensionApiRange {
  readonly min: number;
  readonly max: number;
}

export interface ExtensionMetadata {
  readonly id: string;
  readonly version: string;
  readonly apiVersion: number;
  readonly apiCompatibility?: ExtensionApiRange;
  readonly capabilities?: readonly string[];
}

export interface ExtensionFactoryContext {
  readonly spaceId: string;
  readonly locale: BoardloomLocale;
  readonly timezone: string;
}

export interface QueryAdapterDefinition extends ExtensionMetadata {
  readonly create: (context: ExtensionFactoryContext) => DatasetProvider;
  readonly dispose?: (provider: DatasetProvider) => void;
}

export interface RealtimeAdapterDefinition extends ExtensionMetadata {
  readonly create: (context: ExtensionFactoryContext) => RealtimeTransport;
  readonly dispose?: (transport: RealtimeTransport) => void;
}

export interface FormatterDefinition extends ExtensionMetadata {
  readonly create: (config: LocaleConfig) => FormatterProvider;
  readonly dispose?: (provider: FormatterProvider) => void;
}

export interface MessageDictionaryDefinition extends ExtensionMetadata {
  readonly locale: BoardloomLocale;
  readonly dictionary: MessageDictionary;
}

export interface ThemeExtensionDefinition extends ExtensionMetadata {
  readonly tokens: Readonly<Record<string, string>>;
}

export interface ExtensionSelection {
  readonly queryAdapter?: string;
  readonly realtimeAdapter?: string;
  readonly formatter?: string;
  readonly messageDictionaries?: readonly string[];
  readonly themes?: readonly string[];
}

export interface ExtensionRegistration {
  readonly kind: CoreExtensionKind;
  readonly id: string;
  readonly version: string;
  readonly replaced: boolean;
}

export type ExtensionRegistryEvent =
  | {
      readonly type: "extension:registered";
      readonly kind: CoreExtensionKind;
      readonly id: string;
      readonly version: string;
      readonly replaced: boolean;
    }
  | {
      readonly type: "extension:error";
      readonly kind: CoreExtensionKind;
      readonly id: string;
      readonly diagnostics: readonly Diagnostic[];
    };

export interface ExtensionRegistryOptions {
  readonly onEvent?: (event: ExtensionRegistryEvent) => void;
}

export interface ExtensionSession {
  readonly spaceId: string;
  readonly queryProvider: DatasetProvider | null;
  readonly realtimeTransport: RealtimeTransport | null;
  readonly messageDictionaries: Readonly<Partial<Record<BoardloomLocale, MessageDictionary>>>;
  readonly themeTokens: Readonly<Record<string, string>>;
  readonly diagnostics: readonly Diagnostic[];
  createFormatter(config: LocaleConfig): Result<FormatterProvider>;
  releaseFormatter(provider: FormatterProvider): readonly Diagnostic[];
  dispose(): readonly Diagnostic[];
}

export interface ExtensionDefinitionMap {
  readonly queryAdapter: QueryAdapterDefinition;
  readonly realtimeAdapter: RealtimeAdapterDefinition;
  readonly formatter: FormatterDefinition;
  readonly messageDictionary: MessageDictionaryDefinition;
  readonly theme: ThemeExtensionDefinition;
}

export type CoreExtensionDefinition = ExtensionDefinitionMap[CoreExtensionKind];

export interface ExtensionRegistry {
  readonly disposed: boolean;
  readonly listenerCount: number;
  subscribe(listener: (event: ExtensionRegistryEvent) => void): () => void;
  register<K extends CoreExtensionKind>(
    kind: K,
    definition: ExtensionDefinitionMap[K],
    options?: { readonly override?: boolean },
  ): Result<ExtensionRegistration>;
  get<K extends CoreExtensionKind>(kind: K, id: string): ExtensionDefinitionMap[K] | undefined;
  has(kind: CoreExtensionKind, id: string): boolean;
  list(kind: CoreExtensionKind): readonly CoreExtensionDefinition[];
  list(): readonly CoreExtensionDefinition[];
  resolveMessageDictionaries(
    ids?: readonly string[],
  ): Readonly<Partial<Record<BoardloomLocale, MessageDictionary>>>;
  resolveThemeTokens(ids?: readonly string[]): Readonly<Record<string, string>>;
  createSession(
    selection: ExtensionSelection,
    context: ExtensionFactoryContext,
  ): Result<ExtensionSession>;
  dispose(): Result<void>;
}

interface TrackedInstance {
  readonly kind: "queryAdapter" | "realtimeAdapter" | "formatter";
  readonly definition: QueryAdapterDefinition | RealtimeAdapterDefinition | FormatterDefinition;
  readonly instance: DatasetProvider | RealtimeTransport | FormatterProvider;
}

const SEMANTIC_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function ownValue(value: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(value, key) ? value[key] : undefined;
}

function extensionDiagnostic(
  code: string,
  path: string,
  message?: string,
  relatedIds?: readonly string[],
): Diagnostic {
  return createDiagnostic(code, path, {
    ...(message === undefined ? {} : { message }),
    ...(relatedIds === undefined ? {} : { relatedIds }),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const entry = ownValue(value, key);
  return typeof entry === "string" && entry.trim() !== "" ? entry : undefined;
}

function apiCompatible(definition: ExtensionMetadata): boolean {
  if (!Number.isInteger(definition.apiVersion) || definition.apiVersion < 1) {
    return false;
  }
  const range = definition.apiCompatibility;
  if (range === undefined) {
    return definition.apiVersion === EXTENSION_API_VERSION;
  }
  return (
    Number.isInteger(range.min) &&
    Number.isInteger(range.max) &&
    range.min <= range.max &&
    definition.apiVersion >= range.min &&
    definition.apiVersion <= range.max &&
    EXTENSION_API_VERSION >= range.min &&
    EXTENSION_API_VERSION <= range.max
  );
}

function metadataDiagnostics(
  definition: unknown,
  path: string,
): { readonly diagnostics: readonly Diagnostic[]; readonly id: string } {
  const diagnostics: Diagnostic[] = [];
  if (!isRecord(definition)) {
    return {
      diagnostics: Object.freeze([
        extensionDiagnostic(
          DIAGNOSTIC_CODES.EXTENSION_INVALID,
          path,
          "An extension definition must be an object.",
        ),
      ]),
      id: "",
    };
  }
  const id = readString(definition, "id");
  if (id === undefined) {
    diagnostics.push(
      extensionDiagnostic(
        DIAGNOSTIC_CODES.EXTENSION_INVALID,
        `${path}/id`,
        "An extension needs a stable ID.",
      ),
    );
  }
  const version = readString(definition, "version");
  if (version === undefined || !SEMANTIC_VERSION.test(version)) {
    diagnostics.push(
      extensionDiagnostic(
        DIAGNOSTIC_CODES.EXTENSION_INVALID,
        `${path}/version`,
        "An extension version must be a semantic version.",
      ),
    );
  }
  const apiVersion = ownValue(definition, "apiVersion");
  if (typeof apiVersion !== "number" || !Number.isInteger(apiVersion) || apiVersion < 1) {
    diagnostics.push(
      extensionDiagnostic(
        DIAGNOSTIC_CODES.EXTENSION_INVALID,
        `${path}/apiVersion`,
        "An extension must declare a positive integer API version.",
      ),
    );
  } else {
    const compatibility = ownValue(definition, "apiCompatibility");
    if (compatibility !== undefined) {
      if (
        !isRecord(compatibility) ||
        typeof ownValue(compatibility, "min") !== "number" ||
        typeof ownValue(compatibility, "max") !== "number" ||
        !Number.isInteger(ownValue(compatibility, "min")) ||
        !Number.isInteger(ownValue(compatibility, "max"))
      ) {
        diagnostics.push(
          extensionDiagnostic(
            DIAGNOSTIC_CODES.EXTENSION_INVALID,
            `${path}/apiCompatibility`,
            "An API compatibility range must declare integer min and max bounds.",
          ),
        );
      } else if (!apiCompatible(definition as unknown as ExtensionMetadata)) {
        diagnostics.push(
          extensionDiagnostic(
            DIAGNOSTIC_CODES.EXTENSION_INCOMPATIBLE_API,
            `${path}/apiVersion`,
            `The extension targets API ${String(apiVersion)} outside the supported compatibility range.`,
            [id ?? ""],
          ),
        );
      }
    } else if (apiVersion !== EXTENSION_API_VERSION) {
      diagnostics.push(
        extensionDiagnostic(
          DIAGNOSTIC_CODES.EXTENSION_INCOMPATIBLE_API,
          `${path}/apiVersion`,
          `The extension targets API ${String(apiVersion)}; this build supports ${EXTENSION_API_VERSION}.`,
          [id ?? ""],
        ),
      );
    }
  }
  const capabilities = ownValue(definition, "capabilities");
  if (capabilities !== undefined) {
    if (!Array.isArray(capabilities) || !capabilities.every((entry) => typeof entry === "string")) {
      diagnostics.push(
        extensionDiagnostic(
          DIAGNOSTIC_CODES.EXTENSION_INVALID,
          `${path}/capabilities`,
          "Extension capabilities must be an array of strings.",
        ),
      );
    }
  }
  return { diagnostics: Object.freeze(diagnostics), id: id ?? "" };
}

function themeDiagnostics(
  definition: ThemeExtensionDefinition,
  path: string,
): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const tokens = ownValue(definition as unknown as Record<string, unknown>, "tokens");
  if (!isRecord(tokens)) {
    diagnostics.push(
      extensionDiagnostic(
        DIAGNOSTIC_CODES.EXTENSION_INVALID,
        `${path}/tokens`,
        "A theme extension must declare a token record.",
      ),
    );
    return Object.freeze(diagnostics);
  }
  for (const name of Object.getOwnPropertyNames(tokens)) {
    const value = ownValue(tokens, name);
    if (!isAllowedThemeTokenName(name)) {
      diagnostics.push(
        extensionDiagnostic(
          DIAGNOSTIC_CODES.EXTENSION_INVALID,
          `${path}/tokens/${name}`,
          `The theme token ${name} must use a documented token name or an ext.<name> namespace.`,
          [name],
        ),
      );
      continue;
    }
    if (typeof value !== "string") {
      diagnostics.push(
        extensionDiagnostic(
          DIAGNOSTIC_CODES.EXTENSION_INVALID,
          `${path}/tokens/${name}`,
          "Theme token values must be strings.",
        ),
      );
      continue;
    }
    const reason = validateThemeTokenValue(name, value);
    if (reason !== null) {
      diagnostics.push(
        extensionDiagnostic(DIAGNOSTIC_CODES.EXTENSION_INVALID, `${path}/tokens/${name}`, reason),
      );
    }
  }
  return Object.freeze(diagnostics);
}

function messageDictionaryDiagnostics(
  definition: MessageDictionaryDefinition,
  path: string,
): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const locale = ownValue(definition as unknown as Record<string, unknown>, "locale");
  if (typeof locale !== "string" || !isBoardloomLocale(locale)) {
    diagnostics.push(
      extensionDiagnostic(
        DIAGNOSTIC_CODES.EXTENSION_INVALID,
        `${path}/locale`,
        "A message-dictionary extension must target a built-in locale.",
      ),
    );
  }
  const dictionary = ownValue(definition as unknown as Record<string, unknown>, "dictionary");
  if (!isRecord(dictionary)) {
    diagnostics.push(
      extensionDiagnostic(
        DIAGNOSTIC_CODES.EXTENSION_INVALID,
        `${path}/dictionary`,
        "A message-dictionary extension must declare a dictionary object.",
      ),
    );
  }
  return Object.freeze(diagnostics);
}

function definitionDiagnostics(
  kind: CoreExtensionKind,
  definition: unknown,
  path: string,
): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [...metadataDiagnostics(definition, path).diagnostics];
  if (diagnostics.length > 0) {
    return Object.freeze(diagnostics);
  }
  const record = definition as unknown as Record<string, unknown>;
  if (kind === "queryAdapter" || kind === "realtimeAdapter" || kind === "formatter") {
    if (typeof ownValue(record, "create") !== "function") {
      diagnostics.push(
        extensionDiagnostic(
          DIAGNOSTIC_CODES.EXTENSION_INVALID,
          `${path}/create`,
          `A ${kind} extension must provide a create function.`,
        ),
      );
    }
  }
  if (kind === "messageDictionary") {
    const locale = ownValue(record, "locale");
    if (typeof locale === "string" && isBoardloomLocale(locale)) {
      try {
        normalizeMessageDictionary(ownValue(record, "dictionary") as MessageDictionary, locale);
      } catch (error) {
        diagnostics.push(
          extensionDiagnostic(
            DIAGNOSTIC_CODES.EXTENSION_INVALID,
            `${path}/dictionary`,
            error instanceof Error ? error.message : String(error),
          ),
        );
      }
    }
    diagnostics.push(
      ...messageDictionaryDiagnostics(definition as MessageDictionaryDefinition, path),
    );
  }
  if (kind === "theme") {
    diagnostics.push(...themeDiagnostics(definition as ThemeExtensionDefinition, path));
  }
  return Object.freeze(diagnostics);
}

function freezeDefinition<K extends CoreExtensionKind>(
  kind: K,
  definition: ExtensionDefinitionMap[K],
): ExtensionDefinitionMap[K] {
  if (kind === "messageDictionary") {
    const value = definition as MessageDictionaryDefinition;
    return Object.freeze({
      ...value,
      dictionary: normalizeMessageDictionary(value.dictionary, value.locale),
    }) as ExtensionDefinitionMap[K];
  }
  if (kind === "theme") {
    const value = definition as ThemeExtensionDefinition;
    const tokens: Record<string, string> = {};
    for (const name of Object.getOwnPropertyNames(value.tokens)) {
      const entry = ownValue(value.tokens as unknown as Record<string, unknown>, name);
      if (typeof entry === "string") {
        Object.defineProperty(tokens, name, {
          value: entry,
          enumerable: true,
          configurable: false,
          writable: false,
        });
      }
    }
    return Object.freeze({
      ...value,
      tokens: Object.freeze(tokens),
    }) as unknown as ExtensionDefinitionMap[K];
  }
  return Object.freeze({
    ...definition,
    ...(definition.capabilities === undefined
      ? {}
      : { capabilities: Object.freeze([...definition.capabilities]) }),
    ...(definition.apiCompatibility === undefined
      ? {}
      : { apiCompatibility: Object.freeze({ ...definition.apiCompatibility }) }),
  }) as unknown as ExtensionDefinitionMap[K];
}

function setOwn<T>(record: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(record, key, {
    value,
    enumerable: true,
    configurable: false,
    writable: false,
  });
}

function sessionFailure(
  path: string,
  message: string,
  ids?: readonly string[],
  code: string = DIAGNOSTIC_CODES.EXTENSION_FAILED,
): readonly Diagnostic[] {
  return Object.freeze([extensionDiagnostic(code, path, message, ids)]);
}

function disposeCandidate(
  kind: "queryAdapter" | "realtimeAdapter" | "formatter",
  definition: QueryAdapterDefinition | RealtimeAdapterDefinition | FormatterDefinition,
  instance: DatasetProvider | RealtimeTransport | FormatterProvider,
  diagnostics: Diagnostic[],
): void {
  if (typeof instance !== "object" || instance === null) {
    return;
  }
  const dispose = definition.dispose;
  if (typeof dispose !== "function") {
    return;
  }
  try {
    (dispose as (value: never) => void)(instance as never);
  } catch (error) {
    diagnostics.push(
      extensionDiagnostic(
        DIAGNOSTIC_CODES.EXTENSION_DISPOSAL_FAILED,
        `extensions/${kind}/${definition.id}`,
        error instanceof Error ? error.message : String(error),
        [definition.id],
      ),
    );
  }
}

class ExtensionSessionImpl implements ExtensionSession {
  readonly spaceId: string;
  readonly queryProvider: DatasetProvider | null;
  readonly realtimeTransport: RealtimeTransport | null;
  readonly messageDictionaries: Readonly<Partial<Record<BoardloomLocale, MessageDictionary>>>;
  readonly themeTokens: Readonly<Record<string, string>>;
  readonly diagnostics: readonly Diagnostic[];
  private readonly formatterDefinition: FormatterDefinition | null;
  private readonly tracked: TrackedInstance[] = [];
  private disposed = false;

  constructor(options: {
    readonly spaceId: string;
    readonly queryProvider: DatasetProvider | null;
    readonly queryDefinition: QueryAdapterDefinition | null;
    readonly realtimeTransport: RealtimeTransport | null;
    readonly realtimeDefinition: RealtimeAdapterDefinition | null;
    readonly formatterDefinition: FormatterDefinition | null;
    readonly locale: LocaleConfig;
    readonly messageDictionaries: Readonly<Partial<Record<BoardloomLocale, MessageDictionary>>>;
    readonly themeTokens: Readonly<Record<string, string>>;
    readonly diagnostics: readonly Diagnostic[];
  }) {
    this.spaceId = options.spaceId;
    this.queryProvider = options.queryProvider;
    this.realtimeTransport = options.realtimeTransport;
    this.messageDictionaries = options.messageDictionaries;
    this.themeTokens = options.themeTokens;
    this.diagnostics = options.diagnostics;
    this.formatterDefinition = options.formatterDefinition;
    if (options.queryProvider !== null && options.queryDefinition !== null) {
      this.tracked.push({
        kind: "queryAdapter",
        definition: options.queryDefinition,
        instance: options.queryProvider,
      });
    }
    if (options.realtimeTransport !== null && options.realtimeDefinition !== null) {
      this.tracked.push({
        kind: "realtimeAdapter",
        definition: options.realtimeDefinition,
        instance: options.realtimeTransport,
      });
    }
  }

  createFormatter(config: LocaleConfig): Result<FormatterProvider> {
    if (this.disposed) {
      return fail(
        sessionFailure(
          "extensions/formatter",
          "The extension session has already been disposed.",
          undefined,
          DIAGNOSTIC_CODES.EXTENSION_INVALID,
        ),
      );
    }
    if (this.formatterDefinition === null) {
      return fail(
        sessionFailure(
          "extensions/formatter",
          "No formatter extension is selected.",
          undefined,
          DIAGNOSTIC_CODES.EXTENSION_INVALID,
        ),
      );
    }
    let provider: FormatterProvider | null = null;
    try {
      provider = this.formatterDefinition.create(config);
      if (typeof provider !== "object" || provider === null) {
        throw new Error("The formatter extension did not return a provider object.");
      }
      for (const method of [
        "formatNumber",
        "formatDate",
        "formatDuration",
        "formatRelativeTime",
        "formatList",
        "selectPlural",
      ] as const) {
        if (typeof provider[method] !== "function") {
          throw new Error(`The formatter extension is missing ${method}.`);
        }
      }
      this.tracked.push({
        kind: "formatter",
        definition: this.formatterDefinition,
        instance: provider,
      });
      return ok(provider);
    } catch (error) {
      const diagnostics = [
        ...sessionFailure(
          `extensions/formatter/${this.formatterDefinition.id}`,
          error instanceof Error ? error.message : String(error),
          [this.formatterDefinition.id],
        ),
      ];
      if (provider !== null) {
        disposeCandidate("formatter", this.formatterDefinition, provider, diagnostics);
      }
      return fail(diagnostics);
    }
  }

  releaseFormatter(provider: FormatterProvider): readonly Diagnostic[] {
    const index = this.tracked.findIndex(
      (entry) => entry.kind === "formatter" && entry.instance === provider,
    );
    if (index < 0) {
      return Object.freeze([]);
    }
    const entry = this.tracked[index];
    this.tracked.splice(index, 1);
    if (entry === undefined) {
      return Object.freeze([]);
    }
    const diagnostics: Diagnostic[] = [];
    disposeCandidate("formatter", entry.definition, entry.instance, diagnostics);
    return Object.freeze(diagnostics);
  }

  dispose(): readonly Diagnostic[] {
    if (this.disposed) {
      return Object.freeze([]);
    }
    this.disposed = true;
    const diagnostics: Diagnostic[] = [];
    for (const entry of [...this.tracked].reverse()) {
      const dispose = entry.definition.dispose;
      if (typeof dispose !== "function") {
        continue;
      }
      try {
        (dispose as (instance: never) => void)(entry.instance as never);
      } catch (error) {
        diagnostics.push(
          extensionDiagnostic(
            DIAGNOSTIC_CODES.EXTENSION_DISPOSAL_FAILED,
            `extensions/${entry.kind}/${entry.definition.id}`,
            error instanceof Error ? error.message : String(error),
            [entry.definition.id],
          ),
        );
      }
    }
    this.tracked.length = 0;
    return Object.freeze(diagnostics);
  }
}

class ExtensionRegistryImpl implements ExtensionRegistry {
  private readonly records = new Map<CoreExtensionKind, Map<string, CoreExtensionDefinition>>();
  private readonly onEvent: ((event: ExtensionRegistryEvent) => void) | undefined;
  private readonly listeners = new Set<(event: ExtensionRegistryEvent) => void>();
  private disposedFlag = false;

  constructor(options: ExtensionRegistryOptions = {}) {
    this.onEvent = options.onEvent;
    for (const kind of CORE_EXTENSION_KINDS) {
      this.records.set(kind, new Map());
    }
  }

  get disposed(): boolean {
    return this.disposedFlag;
  }

  get listenerCount(): number {
    return this.listeners.size;
  }

  subscribe(listener: (event: ExtensionRegistryEvent) => void): () => void {
    if (this.disposedFlag) {
      return () => undefined;
    }
    this.listeners.add(listener);
    let active = true;
    return () => {
      if (!active) {
        return;
      }
      active = false;
      this.listeners.delete(listener);
    };
  }

  private emit(event: ExtensionRegistryEvent): void {
    const frozen = Object.freeze(
      event.type === "extension:error"
        ? { ...event, diagnostics: Object.freeze([...event.diagnostics]) }
        : { ...event },
    ) as ExtensionRegistryEvent;
    for (const listener of [...this.listeners]) {
      try {
        listener(frozen);
      } catch {
        void 0;
      }
    }
    if (this.onEvent === undefined) {
      return;
    }
    try {
      this.onEvent(frozen);
    } catch {
      void 0;
    }
  }

  register<K extends CoreExtensionKind>(
    kind: K,
    definition: ExtensionDefinitionMap[K],
    options: { readonly override?: boolean } = {},
  ): Result<ExtensionRegistration> {
    if (this.disposedFlag) {
      return fail(
        sessionFailure(
          "extensions",
          "The extension registry has been disposed.",
          undefined,
          DIAGNOSTIC_CODES.EXTENSION_INVALID,
        ),
      );
    }
    if (!CORE_EXTENSION_KINDS.includes(kind)) {
      return fail(
        sessionFailure(
          "extensions/kind",
          `The extension kind ${String(kind)} is not supported by the core registry.`,
          undefined,
          DIAGNOSTIC_CODES.EXTENSION_INVALID,
        ),
      );
    }
    const path = `extensions/${kind}`;
    const diagnostics = definitionDiagnostics(kind, definition, path);
    if (diagnostics.length > 0) {
      this.emit({
        type: "extension:error",
        kind,
        id: readString(definition, "id") ?? "",
        diagnostics,
      });
      return fail(diagnostics);
    }
    const record = definition as ExtensionMetadata;
    const definitions = this.records.get(kind);
    if (definitions === undefined) {
      return fail(
        sessionFailure(
          path,
          "The extension registry is not initialized for this kind.",
          undefined,
          DIAGNOSTIC_CODES.EXTENSION_INVALID,
        ),
      );
    }
    const existing = definitions.get(record.id);
    if (existing !== undefined && options.override !== true) {
      const duplicate = Object.freeze([
        extensionDiagnostic(
          DIAGNOSTIC_CODES.EXTENSION_DUPLICATE,
          `${path}/id`,
          `An extension with ID ${record.id} is already registered.`,
          [record.id],
        ),
      ]);
      this.emit({ type: "extension:error", kind, id: record.id, diagnostics: duplicate });
      return fail(duplicate);
    }
    const frozen = freezeDefinition(kind, definition);
    definitions.set(record.id, frozen);
    const registration: ExtensionRegistration = Object.freeze({
      kind,
      id: record.id,
      version: record.version,
      replaced: existing !== undefined,
    });
    this.emit({
      type: "extension:registered",
      kind,
      id: record.id,
      version: record.version,
      replaced: registration.replaced,
    });
    return ok(registration);
  }

  get<K extends CoreExtensionKind>(kind: K, id: string): ExtensionDefinitionMap[K] | undefined {
    const definitions = this.records.get(kind);
    if (definitions === undefined) {
      return undefined;
    }
    return definitions.get(id) as ExtensionDefinitionMap[K] | undefined;
  }

  has(kind: CoreExtensionKind, id: string): boolean {
    return this.records.get(kind)?.has(id) ?? false;
  }

  list(kind?: CoreExtensionKind): readonly CoreExtensionDefinition[] {
    if (kind !== undefined) {
      const definitions = this.records.get(kind);
      return Object.freeze(
        definitions === undefined
          ? []
          : [...definitions.values()].sort((left, right) =>
              left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
            ),
      );
    }
    const all: CoreExtensionDefinition[] = [];
    for (const kind of CORE_EXTENSION_KINDS) {
      all.push(...this.list(kind));
    }
    return Object.freeze(all);
  }

  resolveMessageDictionaries(
    ids?: readonly string[],
  ): Readonly<Partial<Record<BoardloomLocale, MessageDictionary>>> {
    const selected = new Map<string, MessageDictionaryDefinition>();
    if (ids === undefined) {
      for (const definition of this.list("messageDictionary")) {
        selected.set(
          (definition as MessageDictionaryDefinition).locale,
          definition as MessageDictionaryDefinition,
        );
      }
    } else {
      for (const id of ids) {
        const definition = this.get("messageDictionary", id) as
          MessageDictionaryDefinition | undefined;
        if (definition !== undefined) {
          selected.set(definition.locale, definition);
        }
      }
    }
    const dictionaries: Partial<Record<BoardloomLocale, MessageDictionary>> = {};
    for (const [locale, definition] of selected) {
      setOwn(dictionaries, locale, definition.dictionary);
    }
    return Object.freeze(dictionaries);
  }

  resolveThemeTokens(ids?: readonly string[]): Readonly<Record<string, string>> {
    const definitions =
      ids === undefined
        ? (this.list("theme") as readonly ThemeExtensionDefinition[])
        : ids
            .map((id) => this.get("theme", id) as ThemeExtensionDefinition | undefined)
            .filter(
              (definition): definition is ThemeExtensionDefinition => definition !== undefined,
            );
    const tokens: Record<string, string> = Object.create(null) as Record<string, string>;
    for (const definition of definitions) {
      for (const name of Object.getOwnPropertyNames(definition.tokens)) {
        const value = ownValue(definition.tokens as unknown as Record<string, unknown>, name);
        if (typeof value === "string") {
          tokens[name] = value;
        }
      }
    }
    return Object.freeze(tokens);
  }

  createSession(
    selection: ExtensionSelection,
    context: ExtensionFactoryContext,
  ): Result<ExtensionSession> {
    if (this.disposedFlag) {
      return fail(
        sessionFailure(
          "extensions",
          "The extension registry has been disposed.",
          undefined,
          DIAGNOSTIC_CODES.EXTENSION_INVALID,
        ),
      );
    }
    const diagnostics: Diagnostic[] = [];
    let queryDefinition: QueryAdapterDefinition | null = null;
    let realtimeDefinition: RealtimeAdapterDefinition | null = null;
    let formatterDefinition: FormatterDefinition | null = null;
    let queryProvider: DatasetProvider | null = null;
    let realtimeTransport: RealtimeTransport | null = null;
    if (selection.queryAdapter !== undefined) {
      queryDefinition = this.get("queryAdapter", selection.queryAdapter) ?? null;
      if (queryDefinition === null) {
        diagnostics.push(
          extensionDiagnostic(
            DIAGNOSTIC_CODES.EXTENSION_INVALID,
            "extensions/queryAdapter",
            `The query adapter ${selection.queryAdapter} is not registered.`,
            [selection.queryAdapter],
          ),
        );
      }
    }
    if (selection.realtimeAdapter !== undefined) {
      realtimeDefinition = this.get("realtimeAdapter", selection.realtimeAdapter) ?? null;
      if (realtimeDefinition === null) {
        diagnostics.push(
          extensionDiagnostic(
            DIAGNOSTIC_CODES.EXTENSION_INVALID,
            "extensions/realtimeAdapter",
            `The realtime adapter ${selection.realtimeAdapter} is not registered.`,
            [selection.realtimeAdapter],
          ),
        );
      }
    }
    if (selection.formatter !== undefined) {
      formatterDefinition = this.get("formatter", selection.formatter) ?? null;
      if (formatterDefinition === null) {
        diagnostics.push(
          extensionDiagnostic(
            DIAGNOSTIC_CODES.EXTENSION_INVALID,
            "extensions/formatter",
            `The formatter ${selection.formatter} is not registered.`,
            [selection.formatter],
          ),
        );
      }
    }
    for (const id of selection.messageDictionaries ?? []) {
      if (!this.has("messageDictionary", id)) {
        diagnostics.push(
          extensionDiagnostic(
            DIAGNOSTIC_CODES.EXTENSION_INVALID,
            "extensions/messageDictionaries",
            `The message dictionary ${id} is not registered.`,
            [id],
          ),
        );
      }
    }
    for (const id of selection.themes ?? []) {
      if (!this.has("theme", id)) {
        diagnostics.push(
          extensionDiagnostic(
            DIAGNOSTIC_CODES.EXTENSION_INVALID,
            "extensions/themes",
            `The theme extension ${id} is not registered.`,
            [id],
          ),
        );
      }
    }
    if (diagnostics.length > 0) {
      return fail(diagnostics);
    }
    if (queryDefinition !== null) {
      let candidate: DatasetProvider | null = null;
      try {
        candidate = queryDefinition.create(context);
        const validation = validateDatasetProviderContract(candidate);
        if (!validation.valid) {
          diagnostics.push(...validation.diagnostics);
          disposeCandidate("queryAdapter", queryDefinition, candidate, diagnostics);
          candidate = null;
        } else {
          queryProvider = candidate;
        }
      } catch (error) {
        if (candidate !== null) {
          disposeCandidate("queryAdapter", queryDefinition, candidate, diagnostics);
        }
        diagnostics.push(
          ...sessionFailure(
            `extensions/queryAdapter/${queryDefinition.id}`,
            error instanceof Error ? error.message : String(error),
            [queryDefinition.id],
          ),
        );
      }
    }
    if (diagnostics.length === 0 && realtimeDefinition !== null) {
      let candidate: RealtimeTransport | null = null;
      try {
        candidate = realtimeDefinition.create(context);
        if (
          typeof candidate !== "object" ||
          candidate === null ||
          typeof candidate.transportId !== "string" ||
          typeof candidate.simulated !== "boolean" ||
          typeof candidate.subscribe !== "function"
        ) {
          if (candidate !== null) {
            disposeCandidate("realtimeAdapter", realtimeDefinition, candidate, diagnostics);
          }
          diagnostics.push(
            ...sessionFailure(
              `extensions/realtimeAdapter/${realtimeDefinition.id}`,
              "The realtime adapter did not return a transport that satisfies the realtime contract.",
              [realtimeDefinition.id],
              DIAGNOSTIC_CODES.EXTENSION_INVALID,
            ),
          );
        } else {
          realtimeTransport = candidate;
        }
      } catch (error) {
        if (candidate !== null) {
          disposeCandidate("realtimeAdapter", realtimeDefinition, candidate, diagnostics);
        }
        diagnostics.push(
          ...sessionFailure(
            `extensions/realtimeAdapter/${realtimeDefinition.id}`,
            error instanceof Error ? error.message : String(error),
            [realtimeDefinition.id],
          ),
        );
      }
    }
    if (diagnostics.length > 0) {
      if (queryProvider !== null && queryDefinition !== null) {
        disposeCandidate("queryAdapter", queryDefinition, queryProvider, diagnostics);
      }
      if (realtimeTransport !== null && realtimeDefinition !== null) {
        disposeCandidate("realtimeAdapter", realtimeDefinition, realtimeTransport, diagnostics);
      }
      return fail(diagnostics);
    }
    let messageDictionaries: Readonly<Partial<Record<BoardloomLocale, MessageDictionary>>>;
    let themeTokens: Readonly<Record<string, string>>;
    try {
      messageDictionaries =
        selection.messageDictionaries === undefined
          ? Object.freeze({})
          : this.resolveMessageDictionaries(selection.messageDictionaries);
      themeTokens =
        selection.themes === undefined
          ? Object.freeze({})
          : this.resolveThemeTokens(selection.themes);
    } catch (error) {
      if (queryProvider !== null && queryDefinition !== null) {
        disposeCandidate("queryAdapter", queryDefinition, queryProvider, diagnostics);
      }
      if (realtimeTransport !== null && realtimeDefinition !== null) {
        disposeCandidate("realtimeAdapter", realtimeDefinition, realtimeTransport, diagnostics);
      }
      return fail([
        ...diagnostics,
        ...sessionFailure(
          "extensions/selection",
          error instanceof Error ? error.message : String(error),
        ),
      ]);
    }
    return ok(
      new ExtensionSessionImpl({
        spaceId: context.spaceId,
        queryProvider,
        queryDefinition,
        realtimeTransport,
        realtimeDefinition,
        formatterDefinition,
        locale: Object.freeze({ locale: context.locale, timezone: context.timezone }),
        messageDictionaries,
        themeTokens,
        diagnostics: Object.freeze(diagnostics),
      }),
    );
  }

  dispose(): Result<void> {
    if (this.disposedFlag) {
      return ok(undefined);
    }
    this.disposedFlag = true;
    this.listeners.clear();
    for (const definitions of this.records.values()) {
      definitions.clear();
    }
    return ok(undefined);
  }
}

export function createExtensionRegistry(options: ExtensionRegistryOptions = {}): ExtensionRegistry {
  return new ExtensionRegistryImpl(options);
}

export interface LocaleDictionaryRegistrationOptions {
  readonly id?: string;
  readonly version?: string;
  readonly override?: boolean;
}

export function registerLocaleDictionary(
  registry: ExtensionRegistry,
  locale: BoardloomLocale,
  dictionary: MessageDictionary,
  options: LocaleDictionaryRegistrationOptions = {},
): Result<ExtensionRegistration> {
  return registry.register(
    "messageDictionary",
    {
      id: options.id ?? `locale.${locale}`,
      version: options.version ?? "1.0.0",
      apiVersion: EXTENSION_API_VERSION,
      locale,
      dictionary,
    },
    options.override === undefined ? {} : { override: options.override },
  );
}

export function isValidExtensionApi(definition: ExtensionMetadata): boolean {
  return apiCompatible(definition);
}

export function extensionStyleDiagnostics(css: unknown, path?: string): readonly Diagnostic[] {
  return validateExtensionStyles(css, path);
}
