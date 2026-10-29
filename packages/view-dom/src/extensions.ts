import {
  createExtensionRegistry,
  createRendererRegistry,
  fail,
  ok,
  type CoreExtensionDefinition,
  type Diagnostic,
  type ExtensionRegistry,
  type ExtensionRegistryEvent,
  type ExtensionSelection,
  type ExtensionSession,
  type FormatterDefinition,
  type MessageDictionaryDefinition,
  type QueryAdapterDefinition,
  type RealtimeAdapterDefinition,
  type Result,
  type ThemeExtensionDefinition,
} from "@boardloom/core";
import { BUILT_IN_BLOCK_TYPES } from "./built-in-blocks.js";
import { BUILT_IN_RENDERERS } from "./built-in-renderers.js";
import {
  createBlockRegistry,
  type BlockRegistry,
  type BlockTypeDefinition,
} from "./block-registry.js";
import type { RendererDefinition, RendererRegistry } from "@boardloom/core";

export interface BoardloomExtensionDefinitions {
  readonly includeBuiltIns?: boolean;
  readonly blockTypes?: readonly BlockTypeDefinition[];
  readonly renderers?: readonly RendererDefinition<HTMLElement>[];
  readonly queryAdapters?: readonly QueryAdapterDefinition[];
  readonly realtimeAdapters?: readonly RealtimeAdapterDefinition[];
  readonly formatters?: readonly FormatterDefinition[];
  readonly messageDictionaries?: readonly MessageDictionaryDefinition[];
  readonly themes?: readonly ThemeExtensionDefinition[];
}

export interface BoardloomExtensionSummary {
  readonly kind: string;
  readonly id: string;
  readonly version: string;
}

export interface BoardloomExtensions {
  readonly disposed: boolean;
  readonly core: ExtensionRegistry;
  readonly blocks: BlockRegistry;
  readonly renderers: RendererRegistry<HTMLElement>;
  readonly diagnostics: readonly Diagnostic[];
  list(): readonly BoardloomExtensionSummary[];
  createSession(
    selection: ExtensionSelection,
    context: Parameters<ExtensionRegistry["createSession"]>[1],
  ): Result<ExtensionSession>;
  subscribe(listener: (event: ExtensionRegistryEvent) => void): () => void;
  dispose(): Result<void>;
}

function coreDefinitionGroups(
  definitions: BoardloomExtensionDefinitions,
): ReadonlyArray<readonly [string, readonly CoreExtensionDefinition[]]> {
  return [
    ["queryAdapter", definitions.queryAdapters ?? []],
    ["realtimeAdapter", definitions.realtimeAdapters ?? []],
    ["formatter", definitions.formatters ?? []],
    ["messageDictionary", definitions.messageDictionaries ?? []],
    ["theme", definitions.themes ?? []],
  ] as const;
}

class BoardloomExtensionsImpl implements BoardloomExtensions {
  readonly core: ExtensionRegistry;
  readonly blocks: BlockRegistry;
  readonly renderers: RendererRegistry<HTMLElement>;
  readonly diagnostics: readonly Diagnostic[];
  private disposedFlag = false;
  private readonly blockDefinitions: readonly BlockTypeDefinition[];
  private readonly rendererDefinitions: readonly RendererDefinition<HTMLElement>[];
  private readonly summaries: readonly BoardloomExtensionSummary[];

  constructor(options: {
    readonly core: ExtensionRegistry;
    readonly blocks: BlockRegistry;
    readonly renderers: RendererRegistry<HTMLElement>;
    readonly diagnostics: readonly Diagnostic[];
    readonly blockDefinitions: readonly BlockTypeDefinition[];
    readonly rendererDefinitions: readonly RendererDefinition<HTMLElement>[];
    readonly summaries: readonly BoardloomExtensionSummary[];
  }) {
    this.core = options.core;
    this.blocks = options.blocks;
    this.renderers = options.renderers;
    this.diagnostics = options.diagnostics;
    this.blockDefinitions = options.blockDefinitions;
    this.rendererDefinitions = options.rendererDefinitions;
    this.summaries = options.summaries;
  }

  get disposed(): boolean {
    return this.disposedFlag;
  }

  list(): readonly BoardloomExtensionSummary[] {
    return this.summaries;
  }

  createSession(
    selection: ExtensionSelection,
    context: Parameters<ExtensionRegistry["createSession"]>[1],
  ): Result<ExtensionSession> {
    return this.core.createSession(selection, context);
  }

  subscribe(listener: (event: ExtensionRegistryEvent) => void): () => void {
    return this.core.subscribe(listener);
  }

  dispose(): Result<void> {
    if (this.disposedFlag) {
      return ok(undefined);
    }
    this.disposedFlag = true;
    const diagnostics: Diagnostic[] = [];
    const disposeDefinitions = [...this.blockDefinitions, ...this.rendererDefinitions].sort(
      (left, right) => {
        const leftId = "type" in left ? left.type : left.id;
        const rightId = "type" in right ? right.type : right.id;
        return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
      },
    );
    for (const definition of disposeDefinitions) {
      const dispose = definition.dispose;
      if (typeof dispose !== "function") {
        continue;
      }
      try {
        dispose.call(definition);
      } catch (error) {
        diagnostics.push({
          code: "EXTENSION_DISPOSAL_FAILED",
          path: `extensions/${"type" in definition ? "block" : "renderer"}/${"type" in definition ? definition.type : definition.id}`,
          message: error instanceof Error ? error.message : String(error),
          severity: "error",
        });
      }
    }
    const coreDisposed = this.core.dispose();
    if (!coreDisposed.ok) {
      diagnostics.push(...coreDisposed.diagnostics);
    }
    return diagnostics.length === 0 ? ok(undefined) : fail(diagnostics);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function blockTypeDiagnostics(definitions: readonly BlockTypeDefinition[]): readonly Diagnostic[] {
  const seen = new Map<string, BlockTypeDefinition>();
  const diagnostics: Diagnostic[] = [];
  for (const candidate of definitions) {
    if (
      !isRecord(candidate) ||
      typeof candidate.type !== "string" ||
      candidate.type.trim() === ""
    ) {
      diagnostics.push({
        code: "EXTENSION_INVALID",
        path: "extensions/block",
        message: "A block extension definition must be an object with a stable type ID.",
        severity: "error",
      });
      continue;
    }
    const definition = candidate as unknown as BlockTypeDefinition;
    const existing = seen.get(definition.type);
    if (existing !== undefined) {
      diagnostics.push({
        code: "EXTENSION_DUPLICATE",
        path: `extensions/block/${definition.type}`,
        message: `The block type ${definition.type} is already registered.`,
        severity: "error",
        relatedIds: [definition.type],
      });
      continue;
    }
    seen.set(definition.type, definition);
  }
  return Object.freeze(diagnostics);
}

function rendererDiagnostics(
  definitions: readonly RendererDefinition<HTMLElement>[],
): readonly Diagnostic[] {
  const seen = new Map<string, RendererDefinition<HTMLElement>>();
  const diagnostics: Diagnostic[] = [];
  for (const candidate of definitions) {
    if (!isRecord(candidate) || typeof candidate.id !== "string" || candidate.id.trim() === "") {
      diagnostics.push({
        code: "EXTENSION_INVALID",
        path: "extensions/renderer",
        message: "A renderer extension definition must be an object with a stable ID.",
        severity: "error",
      });
      continue;
    }
    const definition = candidate as unknown as RendererDefinition<HTMLElement>;
    const existing = seen.get(definition.id);
    if (existing !== undefined) {
      diagnostics.push({
        code: "EXTENSION_DUPLICATE",
        path: `extensions/renderer/${definition.id}`,
        message: `The renderer ${definition.id} is already registered.`,
        severity: "error",
        relatedIds: [definition.id],
      });
      continue;
    }
    seen.set(definition.id, definition);
  }
  return Object.freeze(diagnostics);
}

export function createBoardloomExtensions(
  options: BoardloomExtensionDefinitions = {},
): Result<BoardloomExtensions> {
  const includeBuiltIns = options.includeBuiltIns !== false;
  const blockDefinitions = Object.freeze([
    ...(includeBuiltIns ? BUILT_IN_BLOCK_TYPES : []),
    ...(options.blockTypes ?? []),
  ]);
  const rendererDefinitions = Object.freeze([
    ...(includeBuiltIns ? BUILT_IN_RENDERERS : []),
    ...(options.renderers ?? []),
  ]);
  const duplicateDiagnostics = Object.freeze([
    ...blockTypeDiagnostics(blockDefinitions),
    ...rendererDiagnostics(rendererDefinitions),
  ]);
  if (duplicateDiagnostics.length > 0) {
    return fail(duplicateDiagnostics);
  }
  const blocks = createBlockRegistry(blockDefinitions);
  if (!blocks.ok) {
    return blocks;
  }
  const renderers = createRendererRegistry(rendererDefinitions);
  if (!renderers.ok) {
    return renderers;
  }
  const core = createExtensionRegistry();
  for (const [kind, definitions] of coreDefinitionGroups(options)) {
    for (const definition of definitions) {
      const registered = core.register(kind as never, definition as never);
      if (!registered.ok) {
        core.dispose();
        return registered;
      }
    }
  }
  const summaries: readonly BoardloomExtensionSummary[] = Object.freeze([
    ...blockDefinitions.map((definition) => ({
      kind: "block",
      id: definition.type,
      version: definition.version,
    })),
    ...rendererDefinitions.map((definition) => ({
      kind: "renderer",
      id: definition.id,
      version: definition.version,
    })),
    ...coreDefinitionGroups(options).flatMap(([kind, definitions]) =>
      definitions.map((definition) => ({
        kind,
        id: definition.id,
        version: definition.version,
      })),
    ),
  ]);
  return ok(
    new BoardloomExtensionsImpl({
      core,
      blocks: blocks.value,
      renderers: renderers.value,
      diagnostics: Object.freeze([]),
      blockDefinitions,
      rendererDefinitions,
      summaries,
    }),
  );
}
