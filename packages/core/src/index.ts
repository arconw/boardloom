export {
  BoardloomError,
  DIAGNOSTIC_CODES,
  DIAGNOSTIC_MESSAGES,
  createDiagnostic,
  fail,
  hasError,
  ok,
} from "./diagnostics.js";
export type {
  Diagnostic,
  DiagnosticCode,
  DiagnosticOptions,
  DiagnosticSeverity,
  OperationFailure,
  OperationSuccess,
  Result,
} from "./diagnostics.js";

export { createSystemClock } from "./clock.js";
export type { Clock, TimerHandle } from "./clock.js";

export { createSequentialIdFactory } from "./ids.js";
export type { IdFactory, SequentialIdFactoryOptions } from "./ids.js";

export { noopLogger } from "./logger.js";
export type { LogContext, Logger } from "./logger.js";

export {
  DEFAULT_LOCALE,
  DEFAULT_LOCALE_CONFIG,
  DEFAULT_TIMEZONE,
  LOCALE_METADATA,
  SUPPORTED_LOCALES,
  isBoardloomLocale,
  isValidTimeZone,
  resolveLocaleConfig,
} from "./locale.js";
export type {
  BoardloomLocale,
  LocaleConfig,
  LocaleConfigInput,
  LocaleMetadata,
  TextDirection,
} from "./locale.js";

export { ENGLISH_MESSAGES, createMessageProvider } from "./messages.js";
export type {
  MessageDictionary,
  MessageFormatResult,
  MessageParam,
  MessageParams,
  MessageProvider,
  MessageProviderOptions,
} from "./messages.js";

export { createIntlFormatterProvider } from "./formatting.js";
export type {
  DurationFormatOptions,
  FormatterProvider,
  NumberFormatOptions,
} from "./formatting.js";

export {
  canonicalJson,
  cloneJson,
  deepFreeze,
  freezeJson,
  isJsonValue,
  isPlainObject,
  jsonByteLength,
  jsonEqual,
  utf8ByteLength,
  validateJsonValue,
} from "./json.js";
export type {
  JsonObject,
  JsonPrimitive,
  JsonValidationIssue,
  JsonValidationLimits,
  JsonValidationResult,
  JsonValue,
} from "./json.js";

export { defaultDocumentValidator, documentSchemaVersion, snapshotDocument } from "./document.js";
export type { BoardDocument, DocumentValidation, DocumentValidator } from "./document.js";

export {
  AGGREGATION_TYPES,
  BINDING_AXES,
  BINDING_MODES,
  BINDING_ROLES,
  BOARD_BLOCK_TYPES,
  BOARD_BREAKPOINTS,
  BOARD_SCHEMA_VERSION,
  BUCKET_GRAINS,
  CHART_TYPES,
  COMPARISON_DELTA_MODES,
  COMPARISON_DISPLAY_MODES,
  COMPARISON_UNIT_POLICIES,
  DATE_STYLES,
  FIELD_ROLES,
  FIELD_VALUE_TYPES,
  FILTER_OPERATORS,
  FILTER_TARGET_KINDS,
  FORMAT_STYLES,
  LAYOUT_BOUNDS,
  THEME_MODES,
  TIME_STYLES,
  WEEK_STARTS,
  createEmptyBoardDocument,
  isNamespacedExtensionKey,
  isThemeTokenName,
} from "./board-schema.js";
export type {
  AggregationDefinition,
  AggregationType,
  BindingDefinition,
  BindingAxis,
  BindingFormat,
  BindingMode,
  BindingRole,
  BlockDefinition,
  BoardBlockType,
  BoardBreakpoint,
  BoardDocumentV1,
  BoardLayout,
  BoardSchemaVersion,
  BoardTheme,
  BreakpointLayout,
  BucketGrain,
  BuiltInBlockConfig,
  ChartAxisConfig,
  ChartConfig,
  ChartType,
  ComparisonDefinition,
  ComparisonDeltaMode,
  ComparisonDisplayMode,
  ComparisonFieldMapping,
  ComparisonInput,
  ComparisonUnitConversion,
  ComparisonUnitPolicyMode,
  CreateEmptyBoardDocumentOptions,
  DatasetReference,
  FieldDescriptor,
  FieldReference,
  FieldRole,
  FieldValueType,
  FilterBlockConfig,
  FilterDefinition,
  FilterGroupDefinition,
  FilterOperator,
  FilterTarget,
  FilterTargetKind,
  FilterTemporalConfig,
  FormatStyle,
  LayoutPlacement,
  MetricConfig,
  SliceReference,
  TableConfig,
  TemporalBucket,
  TextConfig,
  ThemeMode,
  TimeWindow,
  WeekStart,
} from "./board-schema.js";

export { validateBoardDocument } from "./board-validation.js";
export type {
  BoardDocumentValidation,
  BoardValidationCatalog,
  BoardValidationOptions,
  ProviderDatasetDescriptor,
  ProviderFieldDescriptor,
} from "./board-validation.js";

export {
  DEFAULT_MAX_IMPORT_ARRAY_LENGTH,
  DEFAULT_MAX_IMPORT_BYTES,
  DEFAULT_MAX_IMPORT_DEPTH,
  DEFAULT_MAX_IMPORT_NODES,
  DEFAULT_MAX_IMPORT_OBJECT_KEYS,
  DEFAULT_MAX_IMPORT_STRING_LENGTH,
  exportBoardDocument,
  parseBoardDocument,
  serializeBoardDocument,
} from "./document-io.js";
export type {
  BoardDocumentParseOptions,
  BoardSerialization,
  BoardSerializationOptions,
  PreparedBoardDocument,
} from "./document-io.js";

export {
  BOARD_MIGRATION_CHAIN,
  SYNTHETIC_V0_TO_V1_MIGRATION,
  migrateBoardDocument,
} from "./migrations.js";
export type {
  BoardMigrationOptions,
  BoardMigrationOutcome,
  BoardMigrationReport,
  BoardMigrationStepDefinition,
  BoardMigrationStepOutcome,
  BoardMigrationStepReport,
  MigrationContext,
} from "./migrations.js";

export type {
  DocumentExportedEvent,
  DocumentInvalidEvent,
  DocumentMigratedEvent,
  ImportFailedEvent,
  SpaceEvent,
  SpaceEventInput,
  SpaceEventListener,
  SpaceEventType,
  SpaceImportedEvent,
  Unsubscribe,
} from "./events.js";

export type {
  AcquireEditorLeaseOptions,
  CreateSpaceOptions,
  CreateViewOptions,
  DisposeViewOptions,
  DraftDecision,
  DraftResolution,
  DraftSnapshot,
  EditorLease,
  ReleaseEditorLeaseOptions,
  SpaceSnapshot,
  SpaceStatus,
  SpaceSummary,
  ViewMode,
  ViewSnapshot,
  ViewState,
  ViewDisposalResult,
  ViewSummary,
} from "./types.js";

export type { BoardView, ViewCommands } from "./view.js";
export type { BoardSpace } from "./space.js";

export { createRuntime } from "./runtime.js";
export type {
  BoardloomRuntime,
  ImportedDocument,
  ImportDocumentOptions,
  RuntimeOptions,
} from "./runtime.js";
