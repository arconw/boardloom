import {
  AGGREGATION_TYPES,
  CHART_TYPES,
  type AggregationType,
  type BucketGrain,
  type ChartAxisConfig,
  type ChartType,
  type DATE_STYLES,
  type FieldRole,
  type FieldValueType,
  type FormatStyle,
  type TIME_STYLES,
  type ThemeMode,
} from "./board-schema.js";
import type {
  QueryCounts,
  QueryPhase,
  QueryResultField,
  QueryResultRow,
  TemporalRepresentation,
} from "./data-contract.js";
import {
  BoardloomError,
  DIAGNOSTIC_CODES,
  createDiagnostic,
  fail,
  ok,
  type Diagnostic,
  type Result,
} from "./diagnostics.js";
import type { FormatterProvider } from "./formatting.js";
import type { JsonValue } from "./json.js";
import type { BoardloomLocale, TextDirection } from "./locale.js";
import type { CategoryOrder, VisualizationKind } from "./field-matrix.js";

export const RENDERER_API_VERSION = 1 as const;

export type RendererKind = "chart" | "kpi" | "table";

export const RENDERER_KINDS: readonly RendererKind[] = Object.freeze(["chart", "kpi", "table"]);

export interface RendererField {
  readonly fieldId: string;
  readonly label: string;
  readonly type: FieldValueType;
  readonly role?: FieldRole | "temporal";
  readonly unit?: {
    readonly unit: string;
    readonly scale?: number;
    readonly label?: string;
  };
  readonly format?: {
    readonly style?: FormatStyle;
    readonly precision?: number;
    readonly currency?: string;
    readonly dateStyle?: (typeof DATE_STYLES)[number];
    readonly timeStyle?: (typeof TIME_STYLES)[number];
  };
  readonly timezone?: string;
  readonly temporalRepresentation?: TemporalRepresentation;
  readonly allowedValues?: readonly (string | number | boolean)[];
  readonly ordered?: boolean;
  readonly binned?: boolean;
  readonly bucket?: { readonly grain: BucketGrain };
}

export interface RendererAxis {
  readonly min?: number;
  readonly max?: number;
  readonly label?: string;
  readonly unit?: string;
}

export interface RendererSpecBase {
  readonly id: string;
  readonly title: string | null;
  readonly comparison: boolean;
}

export interface ChartRendererSpec extends RendererSpecBase {
  readonly kind: "chart";
  readonly visualization: ChartType;
  readonly x: RendererField;
  readonly y: RendererField;
  readonly series: RendererField | null;
  readonly aggregation: AggregationType;
  readonly stacked: boolean;
  readonly categoryOrder: CategoryOrder;
  readonly xAxis: RendererAxis;
  readonly yAxis: RendererAxis;
}

export interface KpiRendererSpec extends RendererSpecBase {
  readonly kind: "kpi";
  readonly y: RendererField;
  readonly aggregation: AggregationType;
}

export interface TableRendererSpec extends RendererSpecBase {
  readonly kind: "table";
  readonly columns: readonly RendererField[];
}

export type RendererSpec = ChartRendererSpec | KpiRendererSpec | TableRendererSpec;

export interface RendererCapabilities {
  readonly kinds: readonly RendererKind[];
  readonly visualizations: readonly ChartType[];
  readonly aggregation: readonly AggregationType[];
  readonly comparison: boolean;
  readonly series: boolean;
  readonly stacking: "required" | "supported" | "optional" | "rejected";
  readonly zeroBaseline: "required" | "visible" | "optional" | "none";
  readonly negativeValues: "supported" | "diverging" | "rejected";
  readonly accessibility: boolean;
}

export interface RendererColors {
  readonly text: string;
  readonly muted: string;
  readonly border: string;
  readonly grid: string;
  readonly axis: string;
  readonly surface: string;
  readonly palette: readonly string[];
}

export interface RendererTheme {
  readonly mode: Exclude<ThemeMode, "system">;
  readonly colors: RendererColors;
}

export interface RendererData {
  readonly fields: readonly QueryResultField[];
  readonly rows: readonly QueryResultRow[];
  readonly counts: QueryCounts;
  readonly phase: QueryPhase;
  readonly scopeText: string | null;
  readonly stale: boolean;
  readonly partial: boolean;
  readonly empty: boolean;
}

export interface RendererMessages {
  readonly locale: BoardloomLocale;
  readonly direction: TextDirection;
  has(key: string): boolean;
  text(key: string, params?: Readonly<Record<string, string | number | boolean | bigint>>): string;
  plural(
    key: string,
    count: number,
    params?: Readonly<Record<string, string | number | boolean | bigint>>,
  ): string;
}

export interface RendererInput<HostElement = unknown> {
  readonly host: HostElement;
  readonly spec: RendererSpec;
  readonly data: RendererData;
  readonly theme: RendererTheme;
  readonly locale: BoardloomLocale;
  readonly timezone: string;
  readonly direction: TextDirection;
  readonly formatters: FormatterProvider;
  readonly messages: RendererMessages;
}

export interface RendererHandle<HostElement = unknown> {
  readonly element?: HostElement;
  update(input: RendererInput<HostElement>): void;
  destroy(): void;
}

export interface RendererValidation {
  readonly ok: boolean;
  readonly diagnostics: readonly Diagnostic[];
}

export interface RendererDefinition<HostElement = unknown> {
  readonly id: string;
  readonly version: string;
  readonly apiVersion: number;
  readonly kind: RendererKind;
  readonly visualizations: readonly ChartType[];
  readonly capabilities: RendererCapabilities;
  validate(spec: RendererSpec): RendererValidation;
  mount(input: RendererInput<HostElement>): RendererHandle<HostElement>;
}

export interface RendererLookup {
  readonly id?: string;
  readonly kind: RendererKind;
  readonly visualization?: ChartType;
}

export interface RendererRegistry<HostElement = unknown> {
  has(id: string): boolean;
  get(id: string): RendererDefinition<HostElement> | undefined;
  list(): readonly RendererDefinition<HostElement>[];
  register(definition: RendererDefinition<HostElement>): Result<void>;
  resolve(lookup: RendererLookup): RendererDefinition<HostElement> | undefined;
}

const DEFAULT_LIGHT_PALETTE = Object.freeze([
  "#0f6b66",
  "#2f5fa8",
  "#9a5b00",
  "#a13d5c",
  "#6547a3",
  "#3f6b2a",
  "#7a4a2a",
  "#3f5a63",
]);

const DEFAULT_DARK_PALETTE = Object.freeze([
  "#5fd0c4",
  "#7aa7ef",
  "#e7b45f",
  "#ef8aa5",
  "#b9a1f2",
  "#8bcf73",
  "#d9a37a",
  "#9fc4cc",
]);

export const DEFAULT_RENDERER_COLORS: Readonly<Record<"light" | "dark", RendererColors>> =
  Object.freeze({
    light: Object.freeze({
      text: "#1c2422",
      muted: "#59645f",
      border: "#b9b1a3",
      grid: "#e3ddd2",
      axis: "#b9b1a3",
      surface: "#fffdf8",
      palette: DEFAULT_LIGHT_PALETTE,
    }),
    dark: Object.freeze({
      text: "#edf2ee",
      muted: "#a5b2ad",
      border: "#4b5b56",
      grid: "#2c3935",
      axis: "#5a6964",
      surface: "#18211f",
      palette: DEFAULT_DARK_PALETTE,
    }),
  });

function tokenValue(
  tokens: Readonly<Record<string, string>>,
  names: readonly string[],
): string | undefined {
  for (const name of names) {
    for (const candidate of [name, `--bl-${name}`, `--bl-color-${name}`]) {
      const value = tokens[candidate];
      if (typeof value === "string" && value.trim() !== "") {
        return value;
      }
    }
  }
  return undefined;
}

export function resolveRendererColors(
  mode: Exclude<ThemeMode, "system">,
  tokens: Readonly<Record<string, string>> = {},
): RendererColors {
  const defaults = DEFAULT_RENDERER_COLORS[mode];
  const palette = defaults.palette.map((fallback, index) => {
    const value = tokenValue(tokens, [`chart-series-${index + 1}`]);
    return value ?? fallback;
  });
  return Object.freeze({
    text: tokenValue(tokens, ["text", "color-text"]) ?? defaults.text,
    muted: tokenValue(tokens, ["text-muted", "color-text-muted"]) ?? defaults.muted,
    border: tokenValue(tokens, ["border", "color-border"]) ?? defaults.border,
    grid: tokenValue(tokens, ["chart-grid"]) ?? defaults.grid,
    axis: tokenValue(tokens, ["chart-axis"]) ?? defaults.axis,
    surface: tokenValue(tokens, ["surface", "color-surface"]) ?? defaults.surface,
    palette: Object.freeze(palette),
  });
}

function definitionDiagnostic(path: string, message: string, ids?: readonly string[]): Diagnostic {
  return createDiagnostic(DIAGNOSTIC_CODES.RENDERER_INVALID, path, {
    message,
    ...(ids === undefined ? {} : { relatedIds: ids }),
  });
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function visualizationKey(kind: RendererKind, visualization: ChartType | undefined): string {
  return `${kind}:${visualization ?? ""}`;
}

const STACKING_MODES = new Set(["required", "supported", "optional", "rejected"]);
const ZERO_BASELINE_MODES = new Set(["required", "visible", "optional", "none"]);
const NEGATIVE_MODES = new Set(["supported", "diverging", "rejected"]);

function capabilityDiagnostic(
  id: string,
  path: string,
  message: string,
  ids: readonly string[] = [id],
): Diagnostic {
  return createDiagnostic(DIAGNOSTIC_CODES.RENDERER_INVALID, path, {
    message,
    relatedIds: [...ids],
  });
}

function registrationCapabilityDiagnostics(
  definition: RendererDefinition<unknown>,
): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const capabilities = definition.capabilities;
  for (const kind of capabilities.kinds) {
    if (!RENDERER_KINDS.includes(kind)) {
      diagnostics.push(
        capabilityDiagnostic(
          definition.id,
          "renderer/capabilities/kinds",
          `Renderer ${definition.id} declares an unsupported kind.`,
        ),
      );
    }
  }
  if (!capabilities.kinds.includes(definition.kind)) {
    diagnostics.push(
      capabilityDiagnostic(
        definition.id,
        "renderer/capabilities/kinds",
        `Renderer ${definition.id} must include its own kind in its capabilities.`,
      ),
    );
  }
  for (const visualization of definition.visualizations) {
    if (!(CHART_TYPES as readonly string[]).includes(visualization)) {
      diagnostics.push(
        capabilityDiagnostic(
          definition.id,
          "renderer/visualizations",
          `Renderer ${definition.id} declares an unsupported visualization.`,
        ),
      );
    }
  }
  if (definition.kind === "chart") {
    const declared = new Set(definition.visualizations);
    if (
      capabilities.visualizations.length !== declared.size ||
      !capabilities.visualizations.every((visualization) => declared.has(visualization))
    ) {
      diagnostics.push(
        capabilityDiagnostic(
          definition.id,
          "renderer/capabilities/visualizations",
          `Renderer ${definition.id} capabilities must match its declared visualizations.`,
        ),
      );
    }
  } else if (capabilities.visualizations.length > 0) {
    diagnostics.push(
      capabilityDiagnostic(
        definition.id,
        "renderer/capabilities/visualizations",
        `Non-chart renderer ${definition.id} must not declare visualizations.`,
      ),
    );
  }
  for (const aggregation of capabilities.aggregation) {
    if (!(AGGREGATION_TYPES as readonly string[]).includes(aggregation)) {
      diagnostics.push(
        capabilityDiagnostic(
          definition.id,
          "renderer/capabilities/aggregation",
          `Renderer ${definition.id} declares an unsupported aggregation.`,
        ),
      );
    }
  }
  if (!STACKING_MODES.has(capabilities.stacking)) {
    diagnostics.push(
      capabilityDiagnostic(
        definition.id,
        "renderer/capabilities/stacking",
        `Renderer ${definition.id} declares an unsupported stacking policy.`,
      ),
    );
  }
  if (!ZERO_BASELINE_MODES.has(capabilities.zeroBaseline)) {
    diagnostics.push(
      capabilityDiagnostic(
        definition.id,
        "renderer/capabilities/zeroBaseline",
        `Renderer ${definition.id} declares an unsupported baseline policy.`,
      ),
    );
  }
  if (!NEGATIVE_MODES.has(capabilities.negativeValues)) {
    diagnostics.push(
      capabilityDiagnostic(
        definition.id,
        "renderer/capabilities/negativeValues",
        `Renderer ${definition.id} declares an unsupported negative-value policy.`,
      ),
    );
  }
  for (const key of ["comparison", "series", "accessibility"] as const) {
    if (typeof capabilities[key] !== "boolean") {
      diagnostics.push(
        capabilityDiagnostic(
          definition.id,
          `renderer/capabilities/${key}`,
          `Renderer ${definition.id} must declare ${key} as a boolean.`,
        ),
      );
    }
  }
  return Object.freeze(diagnostics);
}

function specCapabilityDiagnostics(
  definition: RendererDefinition<unknown>,
  spec: RendererSpec,
  input: RendererInput<unknown>,
): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const capabilities = definition.capabilities;
  const path = `renderer/${definition.id}/capabilities`;
  if (definition.kind !== spec.kind || !capabilities.kinds.includes(spec.kind)) {
    diagnostics.push(
      capabilityDiagnostic(
        definition.id,
        path,
        `Renderer ${definition.id} does not accept ${spec.kind} specs.`,
      ),
    );
    return Object.freeze(diagnostics);
  }
  if (spec.kind === "chart") {
    if (
      !definition.visualizations.includes(spec.visualization) ||
      !capabilities.visualizations.includes(spec.visualization)
    ) {
      diagnostics.push(
        capabilityDiagnostic(
          definition.id,
          path,
          `Renderer ${definition.id} does not declare ${spec.visualization}.`,
        ),
      );
    }
    if (spec.series !== null && !capabilities.series) {
      diagnostics.push(
        capabilityDiagnostic(
          definition.id,
          path,
          `Renderer ${definition.id} does not support a series field.`,
        ),
      );
    }
    if (spec.stacked && capabilities.stacking === "rejected") {
      diagnostics.push(
        capabilityDiagnostic(
          definition.id,
          path,
          `Renderer ${definition.id} does not support stacking.`,
        ),
      );
    }
    if (!spec.stacked && capabilities.stacking === "required") {
      diagnostics.push(
        capabilityDiagnostic(
          definition.id,
          path,
          `Renderer ${definition.id} requires stacked input.`,
        ),
      );
    }
    if (spec.aggregation !== "none" && !capabilities.aggregation.includes(spec.aggregation)) {
      diagnostics.push(
        capabilityDiagnostic(
          definition.id,
          path,
          `Renderer ${definition.id} does not support aggregation ${spec.aggregation}.`,
        ),
      );
    }
    if (
      (capabilities.zeroBaseline === "required" || capabilities.zeroBaseline === "visible") &&
      ((spec.yAxis.min !== undefined && spec.yAxis.min > 0) ||
        (spec.yAxis.max !== undefined && spec.yAxis.max < 0))
    ) {
      diagnostics.push(
        capabilityDiagnostic(
          definition.id,
          path,
          `Renderer ${definition.id} requires a visible zero baseline.`,
        ),
      );
    }
    if (capabilities.negativeValues === "rejected") {
      const yField = input.data.fields.find((field) => field.fieldId === spec.y.fieldId);
      const hasNegative = input.data.rows.some((row) => {
        const value = fieldValueOf(row, yField?.fieldId ?? spec.y.fieldId);
        return typeof value === "number" && value < 0;
      });
      if (hasNegative) {
        diagnostics.push(
          createDiagnostic(DIAGNOSTIC_CODES.RENDERER_DATA_INVALID, path, {
            message: `Renderer ${definition.id} rejects negative values.`,
            relatedIds: [definition.id],
          }),
        );
      }
    }
  } else if (spec.kind === "kpi") {
    if (spec.aggregation !== "none" && !capabilities.aggregation.includes(spec.aggregation)) {
      diagnostics.push(
        capabilityDiagnostic(
          definition.id,
          path,
          `Renderer ${definition.id} does not support aggregation ${spec.aggregation}.`,
        ),
      );
    }
    if (capabilities.negativeValues === "rejected") {
      const yField = input.data.fields.find((field) => field.fieldId === spec.y.fieldId);
      const hasNegative = input.data.rows.some((row) => {
        const value = fieldValueOf(row, yField?.fieldId ?? spec.y.fieldId);
        return typeof value === "number" && value < 0;
      });
      if (hasNegative) {
        diagnostics.push(
          createDiagnostic(DIAGNOSTIC_CODES.RENDERER_DATA_INVALID, path, {
            message: `Renderer ${definition.id} rejects negative values.`,
            relatedIds: [definition.id],
          }),
        );
      }
    }
  }
  if (spec.comparison && !capabilities.comparison) {
    diagnostics.push(
      capabilityDiagnostic(
        definition.id,
        path,
        `Renderer ${definition.id} does not support comparison input.`,
      ),
    );
  }
  return Object.freeze(diagnostics);
}

class RendererRegistryImpl<HostElement> implements RendererRegistry<HostElement> {
  private readonly definitions = new Map<string, RendererDefinition<HostElement>>();
  private readonly visualizations = new Map<string, RendererDefinition<HostElement>>();

  register(definition: RendererDefinition<HostElement>): Result<void> {
    if (typeof definition !== "object" || definition === null) {
      return fail([definitionDiagnostic("renderer", "A renderer definition must be an object.")]);
    }
    if (!isNonEmptyString(definition.id)) {
      return fail([definitionDiagnostic("renderer/id", "A renderer needs a stable ID.")]);
    }
    if (!isNonEmptyString(definition.version)) {
      return fail([definitionDiagnostic("renderer/version", "A renderer must declare a version.")]);
    }
    if (definition.apiVersion !== RENDERER_API_VERSION) {
      return fail([
        definitionDiagnostic(
          "renderer/apiVersion",
          `Renderer ${definition.id} targets API ${String(definition.apiVersion)}; this build supports ${RENDERER_API_VERSION}.`,
          [definition.id],
        ),
      ]);
    }
    if (!RENDERER_KINDS.includes(definition.kind)) {
      return fail([
        definitionDiagnostic("renderer/kind", "A renderer must declare a supported kind.", [
          definition.id,
        ]),
      ]);
    }
    if (typeof definition.mount !== "function" || typeof definition.validate !== "function") {
      return fail([
        definitionDiagnostic(
          "renderer/lifecycle",
          `Renderer ${definition.id} must provide validate and mount functions.`,
          [definition.id],
        ),
      ]);
    }
    if (!Array.isArray(definition.visualizations)) {
      return fail([
        definitionDiagnostic(
          "renderer/visualizations",
          `Renderer ${definition.id} must declare a visualizations array.`,
          [definition.id],
        ),
      ]);
    }
    const capabilities = definition.capabilities;
    if (
      typeof capabilities !== "object" ||
      capabilities === null ||
      !Array.isArray(capabilities.kinds) ||
      !Array.isArray(capabilities.visualizations) ||
      !Array.isArray(capabilities.aggregation)
    ) {
      return fail([
        definitionDiagnostic(
          "renderer/capabilities",
          `Renderer ${definition.id} must declare capabilities.`,
          [definition.id],
        ),
      ]);
    }
    const capabilityIssues = registrationCapabilityDiagnostics(
      definition as RendererDefinition<unknown>,
    );
    if (capabilityIssues.length > 0) {
      return fail([...capabilityIssues]);
    }
    if (this.definitions.has(definition.id)) {
      return fail([
        definitionDiagnostic("renderer/id", `Renderer ${definition.id} is already registered.`, [
          definition.id,
        ]),
      ]);
    }
    if (definition.kind !== "chart") {
      const kindKey = visualizationKey(definition.kind, undefined);
      if (this.visualizations.has(kindKey)) {
        return fail([
          definitionDiagnostic(
            "renderer/kind",
            `A ${definition.kind} renderer is already registered.`,
            [definition.id],
          ),
        ]);
      }
    }
    if (definition.kind === "chart") {
      if (definition.visualizations.length === 0) {
        return fail([
          definitionDiagnostic(
            "renderer/visualizations",
            `Chart renderer ${definition.id} must declare its visualizations.`,
            [definition.id],
          ),
        ]);
      }
      for (const visualization of definition.visualizations) {
        const key = visualizationKey("chart", visualization);
        if (this.visualizations.has(key)) {
          return fail([
            definitionDiagnostic(
              "renderer/visualizations",
              `A chart renderer is already registered for ${visualization}.`,
              [definition.id, visualization],
            ),
          ]);
        }
      }
    }
    const frozen = Object.freeze({
      ...definition,
      visualizations: Object.freeze([...definition.visualizations]),
      capabilities: Object.freeze({
        ...definition.capabilities,
        kinds: Object.freeze([...definition.capabilities.kinds]),
        visualizations: Object.freeze([...definition.capabilities.visualizations]),
        aggregation: Object.freeze([...definition.capabilities.aggregation]),
      }),
    });
    this.definitions.set(frozen.id, frozen);
    if (frozen.kind === "chart") {
      for (const visualization of frozen.visualizations) {
        this.visualizations.set(visualizationKey("chart", visualization), frozen);
      }
    } else {
      this.visualizations.set(visualizationKey(frozen.kind, undefined), frozen);
    }
    return ok(undefined);
  }

  has(id: string): boolean {
    return this.definitions.has(id);
  }

  get(id: string): RendererDefinition<HostElement> | undefined {
    return this.definitions.get(id);
  }

  list(): readonly RendererDefinition<HostElement>[] {
    return Object.freeze(
      [...this.definitions.values()].sort((left, right) =>
        left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
      ),
    );
  }

  resolve(lookup: RendererLookup): RendererDefinition<HostElement> | undefined {
    if (lookup.id !== undefined) {
      return this.definitions.get(lookup.id);
    }
    return this.visualizations.get(visualizationKey(lookup.kind, lookup.visualization));
  }
}

export function createRendererRegistry<HostElement = unknown>(
  definitions: readonly RendererDefinition<HostElement>[] = [],
): Result<RendererRegistry<HostElement>> {
  const registry = new RendererRegistryImpl<HostElement>();
  for (const definition of definitions) {
    const registered = registry.register(definition);
    if (!registered.ok) {
      return registered;
    }
  }
  return ok(registry);
}

export interface RendererRuntime<HostElement = unknown> {
  readonly handle: RendererHandle<HostElement> | null;
  readonly diagnostics: readonly Diagnostic[];
}

export function rendererFailure(error: unknown, path: string): Diagnostic {
  if (error instanceof BoardloomError) {
    return error.diagnostic;
  }
  return createDiagnostic(DIAGNOSTIC_CODES.RENDERER_FAILED, path, {
    message: error instanceof Error ? error.message : String(error),
  });
}

export function mountRenderer<HostElement>(
  definition: RendererDefinition<HostElement>,
  input: RendererInput<HostElement>,
): RendererRuntime<HostElement> {
  const capabilityIssues = specCapabilityDiagnostics(
    definition as RendererDefinition<unknown>,
    input.spec,
    input as RendererInput<unknown>,
  );
  if (capabilityIssues.length > 0) {
    return Object.freeze({
      handle: null,
      diagnostics: Object.freeze([...capabilityIssues]),
    });
  }
  let validation: RendererValidation;
  try {
    validation = definition.validate(input.spec);
  } catch (error) {
    return Object.freeze({
      handle: null,
      diagnostics: Object.freeze([rendererFailure(error, `renderer/${definition.id}/validate`)]),
    });
  }
  if (!validation.ok) {
    return Object.freeze({
      handle: null,
      diagnostics: Object.freeze([...validation.diagnostics]),
    });
  }
  try {
    return Object.freeze({
      handle: definition.mount(input),
      diagnostics: Object.freeze([]),
    });
  } catch (error) {
    return Object.freeze({
      handle: null,
      diagnostics: Object.freeze([rendererFailure(error, `renderer/${definition.id}/mount`)]),
    });
  }
}

export function updateRenderer<HostElement>(
  definition: RendererDefinition<HostElement>,
  handle: RendererHandle<HostElement>,
  input: RendererInput<HostElement>,
): readonly Diagnostic[] {
  const capabilityIssues = specCapabilityDiagnostics(
    definition as RendererDefinition<unknown>,
    input.spec,
    input as RendererInput<unknown>,
  );
  if (capabilityIssues.length > 0) {
    return Object.freeze([...capabilityIssues]);
  }
  try {
    const validation = definition.validate(input.spec);
    if (!validation.ok) {
      return Object.freeze([...validation.diagnostics]);
    }
    handle.update(input);
    return Object.freeze([]);
  } catch (error) {
    return Object.freeze([rendererFailure(error, `renderer/${definition.id}/update`)]);
  }
}

export function destroyRenderer<HostElement>(
  definition: RendererDefinition<HostElement>,
  handle: RendererHandle<HostElement>,
): readonly Diagnostic[] {
  try {
    handle.destroy();
    return Object.freeze([]);
  } catch (error) {
    return Object.freeze([rendererFailure(error, `renderer/${definition.id}/destroy`)]);
  }
}

export function emptyRendererData(): RendererData {
  return Object.freeze({
    fields: Object.freeze([]),
    rows: Object.freeze([]),
    counts: Object.freeze({
      returnedRows: 0,
      totalRows: null,
      filteredRows: 0,
      nullCounts: Object.freeze({}),
    }),
    phase: "empty" as QueryPhase,
    scopeText: null,
    stale: false,
    partial: false,
    empty: true,
  });
}

export function fieldValueOf(
  row: Readonly<Record<string, JsonValue>>,
  fieldId: string,
): JsonValue | undefined {
  return Object.prototype.hasOwnProperty.call(row, fieldId) ? row[fieldId] : undefined;
}

export function rendererAxisFromConfig(config: ChartAxisConfig | undefined): RendererAxis {
  if (!config) {
    return Object.freeze({});
  }
  return Object.freeze({
    ...(config.min === undefined ? {} : { min: config.min }),
    ...(config.max === undefined ? {} : { max: config.max }),
    ...(config.label === undefined ? {} : { label: config.label }),
    ...(config.unit === undefined ? {} : { unit: config.unit }),
  });
}

export type { VisualizationKind };
