import {
  BLOCK_EXTENSION_API_VERSION,
  DIAGNOSTIC_CODES,
  createDiagnostic,
  fail,
  ok,
  type BoardDocument,
  type BoardloomLocale,
  type DatasetDescriptor,
  type BlockDefinition,
  type Diagnostic,
  type FormatterProvider,
  type QueryState,
  type RendererRegistry,
  type RendererTheme,
  type CrossFilterSelectionInput,
  type FilterRuntimeState,
  type JsonValue,
  type Result,
  validateExtensionStyles,
} from "@boardloom/core";
import type { DerivedBlockQuery } from "./block-query.js";
import type { ComparisonViewState } from "./comparison-query.js";
import type { ViewMessages } from "./messages.js";

export interface BlockSurfaceEnvironment {
  readonly document: BoardDocument;
  readonly dom: Document;
  readonly block: BlockDefinition;
  readonly query: QueryState | null;
  readonly queryError: readonly Diagnostic[] | null;
  readonly queryPlan: DerivedBlockQuery | null;
  readonly comparison?: ComparisonViewState | null;
  readonly filterState: FilterRuntimeState;
  readonly contextSignature: string;
  readonly messages: ViewMessages;
  readonly formatters: FormatterProvider;
  readonly locale: BoardloomLocale;
  readonly timezone: string;
  readonly theme: RendererTheme;
  readonly renderers: RendererRegistry<HTMLElement>;
  getDatasetDescriptor(datasetId: string): DatasetDescriptor | undefined;
  createElement<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className?: string,
  ): HTMLElementTagNameMap[K];
  applyFilterValue(filterId: string, value: JsonValue): Result<FilterRuntimeState>;
  resetFilterValue(filterId: string): Result<FilterRuntimeState>;
  toggleCrossFilter(selection: CrossFilterSelectionInput): Result<FilterRuntimeState>;
  clearCrossFilters(): Result<FilterRuntimeState>;
}

export interface BlockSurface {
  readonly element: HTMLElement;
  update(environment: BlockSurfaceEnvironment): void;
  destroy?(): void;
}

export interface BlockTypeDefinition {
  readonly type: string;
  readonly version: string;
  readonly apiVersion?: number;
  readonly styles?: string;
  createSurface(environment: BlockSurfaceEnvironment): BlockSurface;
  dispose?(): void;
}

export interface BlockRegistry {
  register(definition: BlockTypeDefinition): Result<void>;
  has(type: string): boolean;
  get(type: string): BlockTypeDefinition | undefined;
  list(): readonly BlockTypeDefinition[];
}

const SEMANTIC_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function definitionDiagnostic(path: string, message: string): Diagnostic {
  return createDiagnostic(DIAGNOSTIC_CODES.INVALID_ARGUMENT, path, { message });
}

function extensionDiagnostic(code: string, path: string, message: string): Diagnostic {
  return createDiagnostic(code, path, { message });
}

class BlockRegistryImpl implements BlockRegistry {
  private readonly definitions = new Map<string, BlockTypeDefinition>();

  register(definition: BlockTypeDefinition): Result<void> {
    if (
      typeof definition !== "object" ||
      definition === null ||
      typeof definition.type !== "string" ||
      definition.type.trim() === ""
    ) {
      return fail([definitionDiagnostic("blockType/type", "A block type must have a stable ID.")]);
    }
    if (typeof definition.version !== "string" || !SEMANTIC_VERSION.test(definition.version)) {
      return fail([
        extensionDiagnostic(
          DIAGNOSTIC_CODES.EXTENSION_INVALID,
          "blockType/version",
          "A block type must declare a semantic version.",
        ),
      ]);
    }
    if (
      definition.apiVersion !== undefined &&
      definition.apiVersion !== BLOCK_EXTENSION_API_VERSION
    ) {
      return fail([
        extensionDiagnostic(
          DIAGNOSTIC_CODES.EXTENSION_INCOMPATIBLE_API,
          "blockType/apiVersion",
          `The block type ${definition.type} targets API ${String(definition.apiVersion)}; this build supports ${BLOCK_EXTENSION_API_VERSION}.`,
        ),
      ]);
    }
    if (definition.styles !== undefined) {
      const styleDiagnostics = validateExtensionStyles(
        definition.styles,
        `blockType/${definition.type}/styles`,
      );
      if (styleDiagnostics.length > 0) {
        return fail([...styleDiagnostics]);
      }
    }
    if (typeof definition.createSurface !== "function") {
      return fail([
        definitionDiagnostic(
          "blockType/createSurface",
          "A block type must provide a surface factory.",
        ),
      ]);
    }
    if (this.definitions.has(definition.type)) {
      return fail([
        createDiagnostic(DIAGNOSTIC_CODES.INVALID_ARGUMENT, "blockType/type", {
          message: `The block type ${definition.type} is already registered.`,
          relatedIds: [definition.type],
        }),
      ]);
    }
    this.definitions.set(definition.type, Object.freeze(definition));
    return ok(undefined);
  }

  has(type: string): boolean {
    return this.definitions.has(type);
  }

  get(type: string): BlockTypeDefinition | undefined {
    return this.definitions.get(type);
  }

  list(): readonly BlockTypeDefinition[] {
    return Object.freeze(
      [...this.definitions.values()].sort((left, right) =>
        left.type < right.type ? -1 : left.type > right.type ? 1 : 0,
      ),
    );
  }
}

export function createBlockRegistry(
  definitions: readonly BlockTypeDefinition[] = [],
): Result<BlockRegistry> {
  const registry = new BlockRegistryImpl();
  for (const definition of definitions) {
    const registered = registry.register(definition);
    if (!registered.ok) {
      return registered;
    }
  }
  return ok(registry);
}
