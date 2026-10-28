import type { JsonObject, JsonValue } from "./json.js";

export const BOARD_SCHEMA_VERSION = 1 as const;
export const BOARD_BREAKPOINTS = Object.freeze(["desktop", "tablet", "narrow"] as const);
export const BOARD_BLOCK_TYPES = Object.freeze([
  "chart",
  "metric",
  "table",
  "text",
  "filter",
] as const);
export const CHART_TYPES = Object.freeze([
  "line",
  "area",
  "bar",
  "stacked-bar",
  "scatter",
  "donut",
] as const);
export const FIELD_VALUE_TYPES = Object.freeze([
  "string",
  "number",
  "boolean",
  "date",
  "datetime",
] as const);
export const FIELD_ROLES = Object.freeze(["dimension", "measure"] as const);
export const BINDING_MODES = Object.freeze(["selectable", "fixed"] as const);
export const BINDING_AXES = Object.freeze(["x", "y", "none"] as const);
export const BUCKET_GRAINS = Object.freeze([
  "instant",
  "day",
  "week",
  "month",
  "quarter",
  "year",
] as const);
export const WEEK_STARTS = Object.freeze(["monday", "sunday"] as const);
export const BINDING_ROLES = Object.freeze([
  "dimension",
  "measure",
  "series",
  "group",
  "size",
  "color",
  "comparison",
  "label",
  "value",
  "column",
  "tooltip",
] as const);
export const AGGREGATION_TYPES = Object.freeze([
  "none",
  "count",
  "countDistinct",
  "sum",
  "average",
  "min",
  "max",
  "median",
  "mode",
] as const);
export const FILTER_OPERATORS = Object.freeze([
  "equals",
  "notEquals",
  "greaterThan",
  "greaterThanOrEqual",
  "lessThan",
  "lessThanOrEqual",
  "between",
  "in",
  "notIn",
  "contains",
  "isNull",
  "isNotNull",
  "before",
  "after",
  "onOrBefore",
  "onOrAfter",
  "isTrue",
  "isFalse",
] as const);
export const FILTER_TARGET_KINDS = Object.freeze(["board", "group", "block"] as const);
export const THEME_MODES = Object.freeze(["light", "dark", "system"] as const);
export const COMPARISON_DISPLAY_MODES = Object.freeze(["overlay", "side-by-side"] as const);
export const COMPARISON_DELTA_MODES = Object.freeze(["absolute", "percentage", "both"] as const);
export const COMPARISON_UNIT_POLICIES = Object.freeze(["identical", "explicit", "none"] as const);
export const FORMAT_STYLES = Object.freeze(["decimal", "percent", "currency", "compact"] as const);
export const DATE_STYLES = Object.freeze(["full", "long", "medium", "short"] as const);
export const TIME_STYLES = Object.freeze(["full", "long", "medium", "short"] as const);
export const LAYOUT_BOUNDS = Object.freeze(["inclusive", "exclusive", "half-open"] as const);

export type BoardSchemaVersion = typeof BOARD_SCHEMA_VERSION;
export type BoardBreakpoint = (typeof BOARD_BREAKPOINTS)[number];
export type BoardBlockType = (typeof BOARD_BLOCK_TYPES)[number];
export type ChartType = (typeof CHART_TYPES)[number];
export type FieldValueType = (typeof FIELD_VALUE_TYPES)[number];
export type FieldRole = (typeof FIELD_ROLES)[number];
export type BindingRole = (typeof BINDING_ROLES)[number];
export type BindingMode = (typeof BINDING_MODES)[number];
export type BindingAxis = (typeof BINDING_AXES)[number];
export type BucketGrain = (typeof BUCKET_GRAINS)[number];
export type WeekStart = (typeof WEEK_STARTS)[number];
export type AggregationType = (typeof AGGREGATION_TYPES)[number];
export type FilterOperator = (typeof FILTER_OPERATORS)[number];
export type FilterTargetKind = (typeof FILTER_TARGET_KINDS)[number];
export type ThemeMode = (typeof THEME_MODES)[number];
export type ComparisonDisplayMode = (typeof COMPARISON_DISPLAY_MODES)[number];
export type ComparisonDeltaMode = (typeof COMPARISON_DELTA_MODES)[number];
export type ComparisonUnitPolicyMode = (typeof COMPARISON_UNIT_POLICIES)[number];
export type FormatStyle = (typeof FORMAT_STYLES)[number];

export interface FieldReference {
  readonly datasetId: string;
  readonly fieldId: string;
}

export interface FieldDescriptor {
  readonly id: string;
  readonly type: FieldValueType;
  readonly role?: FieldRole;
  readonly unit?: string;
  readonly timezone?: string;
  readonly nullable?: boolean;
}

export interface DatasetReference {
  readonly id: string;
  readonly provider?: string;
  readonly label?: string;
  readonly fields?: readonly FieldDescriptor[];
}

export interface SliceReference {
  readonly id: string;
  readonly datasetId: string;
  readonly label?: string;
  readonly fieldIds?: readonly string[];
}

export interface AggregationDefinition {
  readonly type: AggregationType;
  readonly fieldId?: string;
}

export interface BindingFormat {
  readonly style?: FormatStyle;
  readonly unit?: string;
  readonly currency?: string;
  readonly precision?: number;
  readonly dateStyle?: (typeof DATE_STYLES)[number];
  readonly timeStyle?: (typeof TIME_STYLES)[number];
  readonly timezone?: string;
}

export interface TemporalBucket {
  readonly grain: BucketGrain;
  readonly timezone: string;
  readonly weekStartsOn?: WeekStart;
}

export interface BindingDefinition {
  readonly id: string;
  readonly role: BindingRole;
  readonly mode?: BindingMode;
  readonly axis?: BindingAxis;
  readonly bucket?: TemporalBucket;
  readonly field: FieldReference;
  readonly sliceId?: string;
  readonly aggregation?: AggregationDefinition;
  readonly format?: BindingFormat;
  readonly label?: string;
}

export interface ChartAxisConfig {
  readonly label?: string;
  readonly min?: number;
  readonly max?: number;
  readonly unit?: string;
}

export interface ChartConfig {
  readonly visualization: ChartType;
  readonly comparisonId?: string;
  readonly options?: {
    readonly stacked?: boolean;
    readonly legend?: "hidden" | "visible";
    readonly xAxis?: ChartAxisConfig;
    readonly yAxis?: ChartAxisConfig;
  };
}

export interface MetricConfig {
  readonly comparisonId?: string;
  readonly format?: BindingFormat;
}

export interface TableConfig {
  readonly pageSize?: number;
  readonly columns?: readonly string[];
  readonly sort?: {
    readonly bindingId: string;
    readonly direction: "ascending" | "descending";
  };
}

export interface TextConfig {
  readonly text: string;
}

export interface FilterBlockConfig {
  readonly filterIds: readonly string[];
}

export type BuiltInBlockConfig =
  ChartConfig | MetricConfig | TableConfig | TextConfig | FilterBlockConfig;

export interface BlockDefinition {
  readonly id: string;
  readonly type: BoardBlockType | string;
  readonly title?: string;
  readonly groupId?: string;
  readonly bindings?: readonly BindingDefinition[];
  readonly config: JsonObject;
}

export interface FilterGroupDefinition {
  readonly id: string;
  readonly label?: string;
  readonly blockIds?: readonly string[];
}

export type FilterTarget =
  | { readonly kind: "board" }
  | { readonly kind: "group"; readonly groupId: string }
  | { readonly kind: "block"; readonly blockId: string };

export interface FilterTemporalConfig {
  readonly timezone: string;
  readonly bounds: (typeof LAYOUT_BOUNDS)[number];
}

export interface FilterDefinition {
  readonly id: string;
  readonly label?: string;
  readonly description?: string;
  readonly field: FieldReference;
  readonly operator: FilterOperator;
  readonly defaultValue?: JsonValue;
  readonly viewerEditable?: boolean;
  readonly temporal?: FilterTemporalConfig;
  readonly target: FilterTarget;
}

export interface ComparisonInput {
  readonly datasetId: string;
  readonly sliceId?: string;
}

export interface ComparisonFieldMapping {
  readonly primary: FieldReference;
  readonly reference: FieldReference;
  readonly role: FieldRole;
}

export interface ComparisonUnitConversion {
  readonly from: string;
  readonly to: string;
  readonly factor: number;
  readonly offset?: number;
  readonly provider: string;
  readonly lossless?: boolean;
  readonly documentation?: string;
}

export interface TimeWindow {
  readonly timezone: string;
  readonly start: string;
  readonly end: string;
  readonly bounds: (typeof LAYOUT_BOUNDS)[number];
}

export interface ComparisonDefinition {
  readonly id: string;
  readonly label: string;
  readonly displayMode: ComparisonDisplayMode;
  readonly deltaMode: ComparisonDeltaMode;
  readonly base: ComparisonInput;
  readonly reference: ComparisonInput;
  readonly mapping: readonly ComparisonFieldMapping[];
  readonly alignment: {
    readonly keys: readonly string[];
    readonly collation?: string;
    readonly normalization?: string;
  };
  readonly windows?: {
    readonly primary?: TimeWindow;
    readonly reference?: TimeWindow;
  };
  readonly unitPolicy?: {
    readonly mode: ComparisonUnitPolicyMode;
    readonly conversions?: readonly ComparisonUnitConversion[];
  };
}

export interface LayoutPlacement {
  readonly blockId: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly minWidth?: number;
  readonly minHeight?: number;
}

export interface BreakpointLayout {
  readonly columns: number;
  readonly rowHeight?: number;
  readonly placements: readonly LayoutPlacement[];
}

export interface BoardLayout {
  readonly desktop: BreakpointLayout;
  readonly tablet?: BreakpointLayout;
  readonly narrow?: BreakpointLayout;
}

export interface BoardTheme {
  readonly mode: ThemeMode;
  readonly tokens?: Readonly<Record<string, string>>;
}

export interface BoardDocumentV1 {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly theme: BoardTheme;
  readonly datasets: readonly DatasetReference[];
  readonly slices: readonly SliceReference[];
  readonly blocks: readonly BlockDefinition[];
  readonly filterGroups?: readonly FilterGroupDefinition[];
  readonly filters: readonly FilterDefinition[];
  readonly comparisons?: readonly ComparisonDefinition[];
  readonly layout: BoardLayout;
  readonly extensions?: Readonly<Record<string, JsonValue>>;
}

export interface CreateEmptyBoardDocumentOptions {
  readonly id: string;
  readonly title: string;
  readonly createdAt: number;
  readonly updatedAt?: number;
  readonly description?: string;
  readonly theme?: BoardTheme;
}

export function createEmptyBoardDocument(
  options: CreateEmptyBoardDocumentOptions,
): BoardDocumentV1 {
  const layout: BoardLayout = {
    desktop: { columns: 12, rowHeight: 8, placements: [] },
    tablet: { columns: 8, rowHeight: 8, placements: [] },
    narrow: { columns: 4, rowHeight: 8, placements: [] },
  };
  return {
    schemaVersion: BOARD_SCHEMA_VERSION,
    id: options.id,
    title: options.title,
    ...(options.description === undefined ? {} : { description: options.description }),
    createdAt: options.createdAt,
    updatedAt: options.updatedAt ?? options.createdAt,
    theme: options.theme ?? { mode: "system" },
    datasets: [],
    slices: [],
    blocks: [],
    filterGroups: [],
    filters: [],
    comparisons: [],
    layout,
  };
}

export function isNamespacedExtensionKey(key: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_-]*(\.[A-Za-z][A-Za-z0-9_-]*)+$/.test(key);
}

export function isThemeTokenName(key: string): boolean {
  return /^(--)?[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/.test(key);
}
