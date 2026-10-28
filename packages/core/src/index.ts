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
  DATA_CONSUMING_BLOCK_TYPES,
  EMPTY_FILTER_STATE,
  activeValueFor,
  blockDatasetIds,
  cloneFilterState,
  composeBlockFilters,
  composeComparisonFilterSides,
  createEmptyFilterRuntimeState,
  crossFilterKey,
  crossFilterSelectionEquals,
  crossFilterTargetIds,
  crossFilterTargetStatus,
  documentField,
  effectiveFilterValue,
  fieldCompatibilityReason,
  fieldReferenceEquals,
  filterCompositionOrder,
  filterFieldKey,
  filterStateWithActiveValue,
  filterStateWithCrossFilter,
  filterStateWithoutActiveValues,
  filterStateWithoutCrossFilter,
  filterTargetsBlock,
  filterDefinitionOperators,
  filterOperatorsForField,
  filtersForBlockScope,
  isDataConsumingBlock,
  isFilterOperator,
  makeFilterState,
  mappingForDataset,
  parseFilterRuntimeState,
  pruneFilterState,
  queryFiltersForComposition,
  validateCrossFilterSelection,
  validateFilterRuntimeState,
  valueMatchesType,
} from "./filter-model.js";
export type {
  BlockFilterComposition,
  ComparisonFilterSides,
  CrossFilterSelection,
  CrossFilterSelectionInput,
  CrossFilterTargetStatus,
  EffectiveFilter,
  FilterActiveValue,
  FilterConflict,
  FilterOrigin,
  FilterRuntimeState,
} from "./filter-model.js";

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
  FilterFieldMapping,
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
export { FILTER_OPERATORS_BY_FIELD_TYPE } from "./board-validation-filter.js";
export type {
  BoardDocumentValidation,
  BoardValidationCatalog,
  BoardValidationOptions,
  ProviderDatasetCapabilities,
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

export {
  COMPARISON_DELTA_REASONS,
  COMPARISON_ROW_STATUSES,
  absoluteDelta,
  alignComparisonResults,
  buildComparisonPlan,
  comparisonDeltaIsAvailable,
  comparisonRowMeasure,
  percentageDelta,
} from "./comparison-model.js";
export type {
  BuildComparisonPlanOptions,
  ComparisonAlignmentKey,
  ComparisonConversionResolution,
  ComparisonCounts,
  ComparisonDelta,
  ComparisonDeltaReason,
  ComparisonMeasurePlan,
  ComparisonMeasureRow,
  ComparisonOperand,
  ComparisonPlan,
  ComparisonResult,
  ComparisonRow,
  ComparisonRows,
  ComparisonRowStatus,
} from "./comparison-model.js";

export {
  DATA_CONTRACT_VERSION,
  DATA_FIELD_ROLES,
  QUERY_AGGREGATION_TYPES,
  QUERY_OPERATIONS,
  QUERY_PHASES,
  TEMPORAL_REPRESENTATIONS,
  describeDataContract,
  emptyQueryCounts,
  isTemporalField,
  isTemporalValue,
  validateDatasetDescriptor,
  validateDatasetProviderContract,
} from "./data-contract.js";
export type {
  DataFieldDescriptor,
  DataFieldFormat,
  DataFieldRole,
  DatasetCapabilities,
  DatasetDescriptor,
  DatasetDescriptorValidation,
  DatasetProvider,
  DatasetProviderContext,
  DatasetQueryResult,
  DatasetSliceDescriptor,
  DataUnitDescriptor,
  DataValueRange,
  QueryAbortSignal,
  QueryAggregation,
  QueryAggregationType,
  QueryComparisonInput,
  QueryCounts,
  QueryFailure,
  QueryFieldReference,
  QueryFilter,
  QueryGrouping,
  QueryOperation,
  QueryOrder,
  QueryPhase,
  QueryRequest,
  QueryResultField,
  QueryResultRow,
  QuerySpec,
  QueryState,
  QuerySuccess,
  QueryTimeWindow,
  TemporalRepresentation,
} from "./data-contract.js";

export {
  CATEGORY_ORDERS,
  FIELD_CLASSES,
  VISUALIZATION_KINDS,
  VISUALIZATION_MATRIX,
  classifyField,
  describeVisualizationMatrix,
  isCategoryOrder,
  isVisualizationKind,
  validateVisualizationMatrix,
} from "./field-matrix.js";
export type {
  CategoryOrder,
  FieldClass,
  MatrixAggregationRule,
  MatrixFieldInput,
  MatrixInput,
  MatrixValidation,
  VisualizationKind,
  VisualizationMatrixEntry,
} from "./field-matrix.js";

export {
  BINDING_SLOTS,
  assertFixedBindingsPreserved,
  describeBindingSlots,
  setBindingSlot,
} from "./binding-model.js";
export type {
  AppliedBindingSlot,
  BindingSlot,
  BindingSlotAggregationOption,
  BindingSlotChange,
  BindingSlotDescriptionOptions,
  BindingSlotDescriptor,
  BindingSlotFieldOption,
  FixedBindingPreservationOptions,
} from "./binding-model.js";

export { formatValueParts, formatValueText, unitTextOf } from "./value-format.js";
export type { FormattedValue, ValueFieldSpec, ValueMessages } from "./value-format.js";

export {
  DEFAULT_RENDERER_COLORS,
  RENDERER_API_VERSION,
  RENDERER_KINDS,
  createRendererRegistry,
  destroyRenderer,
  emptyRendererData,
  fieldValueOf,
  mountRenderer,
  rendererAxisFromConfig,
  rendererFailure,
  resolveRendererColors,
  updateRenderer,
} from "./renderer-contract.js";
export type {
  ChartRendererSpec,
  KpiRendererSpec,
  RendererAxis,
  RendererCapabilities,
  RendererColors,
  RendererData,
  RendererDefinition,
  RendererField,
  RendererHandle,
  RendererInput,
  RendererKind,
  RendererLookup,
  RendererMessages,
  RendererRegistry,
  RendererRuntime,
  RendererSpec,
  RendererSpecBase,
  RendererTheme,
  RendererValidation,
  TableRendererSpec,
} from "./renderer-contract.js";

export {
  buildChartRendererSpec,
  buildKpiRendererSpec,
  buildTableRendererSpec,
  validateChartRendererSpec,
} from "./renderer-spec.js";
export type { ChartSpecInput, KpiSpecInput, TableSpecInput } from "./renderer-spec.js";

export {
  buildChartModel,
  buildKpiModel,
  buildTableModel,
  chartModelDiagnostics,
} from "./chart-model.js";
export type {
  ChartModel,
  ChartModelCategory,
  ChartModelSeries,
  KpiModel,
  ScatterModelPoint,
  TableModel,
  TableModelCell,
  TableModelColumn,
  TableModelRow,
} from "./chart-model.js";

export {
  bucketTemporalValue,
  compareTemporalValues,
  temporalInstant,
  withinTemporalWindow,
  zonedDateStartInstant,
} from "./temporal.js";

export {
  createBoardValidationCatalog,
  createEffectiveValidationCatalog,
  createProviderCapabilitiesCatalog,
} from "./dataset-catalog.js";

export { selectChartBindings } from "./chart-bindings.js";
export type { ChartBindingLike, ChartBindingSelection } from "./chart-bindings.js";

export { buildQueryPlan, deriveQueryResultFields, queryFilterKey } from "./query-planning.js";
export type { BuildQueryPlanOptions, CanonicalQueryKey, QueryPlan } from "./query-planning.js";

export { createQueryController } from "./query-controller.js";
export type { QueryController, QueryControllerOptions } from "./query-controller.js";

export { createLocalDatasetProvider } from "./query-local.js";
export type { LocalDatasetProviderOptions, LocalDatasetSource } from "./query-local.js";

export { createAsyncDatasetProvider } from "./query-async.js";
export type {
  AsyncDatasetProviderOptions,
  AsyncDatasetQueryApplied,
  AsyncDatasetQueryInput,
  AsyncDatasetQueryOutput,
} from "./query-async.js";

export type {
  ComparisonChangedEvent,
  CrossFilterChangedEvent,
  DocumentExportedEvent,
  DocumentInvalidEvent,
  FilterChangedEvent,
  FilterRejectedEvent,
  DocumentMigratedEvent,
  ImportFailedEvent,
  QueryCancelledEvent,
  QueryEvent,
  QueryEventInput,
  QueryFailedEvent,
  QueryInvalidatedEvent,
  QuerySettledEvent,
  QueryStartedEvent,
  QueryStaleEvent,
  SpaceEvent,
  SpaceEventInput,
  SpaceEventListener,
  SpaceEventType,
  SpaceImportedEvent,
  Unsubscribe,
  ViewDisposedEvent,
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

export { restoreViewSession } from "./view.js";
export type { BoardView, ViewCommands } from "./view.js";
export type { BoardSpace } from "./space.js";

export { createRuntime } from "./runtime.js";
export type {
  BoardloomRuntime,
  ImportedDocument,
  ImportDocumentOptions,
  RuntimeOptions,
} from "./runtime.js";
