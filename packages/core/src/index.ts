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
  jsonEqual,
  validateJsonValue,
} from "./json.js";
export type {
  JsonObject,
  JsonPrimitive,
  JsonValidationIssue,
  JsonValidationResult,
  JsonValue,
} from "./json.js";

export { defaultDocumentValidator, documentSchemaVersion, snapshotDocument } from "./document.js";
export type { BoardDocument, DocumentValidation, DocumentValidator } from "./document.js";

export type {
  SpaceEvent,
  SpaceEventInput,
  SpaceEventListener,
  SpaceEventType,
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
export type { BoardloomRuntime, RuntimeOptions } from "./runtime.js";
