import { describe, expect, it } from "vitest";
import {
  BUILT_IN_DICTIONARIES,
  EXTENSION_API_VERSION,
  SUPPORTED_LOCALES,
  createExtensionRegistry,
  createIntlFormatterProvider,
  createRuntime,
  exportBoardDocument,
  type BoardloomLocale,
  type MessageDictionaryDefinition,
} from "../../../../packages/core/src/index.js";
import { expectFailure, unwrap } from "../../core/support/assertions.js";
import {
  FakeClock,
  createDeterministicIdFactory,
  createRecordingLogger,
  makeDocument,
} from "../../core/support/fakes.js";

function runtime() {
  return createRuntime({
    clock: new FakeClock(),
    logger: createRecordingLogger(),
    idFactory: createDeterministicIdFactory("t17"),
  });
}

describe("T17 locale switching contract", () => {
  it("switches every built-in locale without losing draft, undo or committed content", () => {
    const instance = runtime();
    const space = unwrap(
      instance.createSpace({ id: "t17-switch", document: makeDocument("Stable board") }),
    );
    const lease = unwrap(space.acquireEditorLease({ sessionId: "t17-editor" }));
    unwrap(space.updateDraft(lease, makeDocument("Draft one")));
    unwrap(space.updateDraft(lease, makeDocument("Draft two")));
    const before = space.getSnapshot();

    for (const locale of SUPPORTED_LOCALES) {
      const changed = unwrap(space.setLocale({ locale, timezone: "UTC" }));
      expect(changed.locale).toBe(locale);
      expect(changed.committedDocument).toEqual(before.committedDocument);
      expect(changed.committedRevision).toBe(before.committedRevision);
      expect(changed.draft?.document).toEqual(before.draft?.document);
      expect(changed.draft?.canUndo).toBe(true);
      expect(space.getFormatters().locale).toBe(locale);
      expect(space.getMessageProvider().locale).toBe(locale);
      expect(space.getMessageProvider().format("mode.viewer").text).toBe(
        BUILT_IN_DICTIONARIES[locale]["mode.viewer"],
      );
      expect(space.getMessageProvider().format("mode.viewer").usedFallback).toBe(false);
    }

    unwrap(space.releaseEditorLease(lease, { decision: "cancel" }));
    instance.dispose();
  });

  it("keeps display timezone independent from UI language", () => {
    const options: Intl.DateTimeFormatOptions = {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    };
    const instant = "2024-01-01T00:30:00Z";
    const results = new Map<BoardloomLocale, string>();
    for (const locale of SUPPORTED_LOCALES) {
      const formatter = createIntlFormatterProvider({ locale, timezone: "America/New_York" });
      results.set(locale, formatter.formatDate(instant, options));
      expect(formatter.timezone).toBe("America/New_York");
      expect(formatter.formatDate(instant, { ...options, timeZone: "Asia/Tokyo" })).not.toBe(
        results.get(locale),
      );
    }
    expect(results.get("en")).not.toBe(results.get("ja"));
    expect(results.get("ru")).not.toBe(results.get("ar"));
  });

  it("formats numbers, units and durations with the selected locale", () => {
    const english = createIntlFormatterProvider({ locale: "en", timezone: "UTC" });
    const russian = createIntlFormatterProvider({ locale: "ru", timezone: "UTC" });
    expect(english.formatNumber(1234.5)).toBe("1,234.5");
    expect(russian.formatNumber(1234.5)).toContain("1");
    expect(english.formatUnit(12, "kilometer")).toContain("km");
    expect(russian.formatUnit(12, "kilometer")).not.toBe(english.formatUnit(12, "kilometer"));
    expect(english.formatDuration(120_000, { unit: "minute" })).toBe("2");
    expect(russian.formatDuration(120_000, { unit: "minute" })).toBe("2");
  });

  it("merges host and extension dictionaries per key with host precedence", () => {
    const registry = createExtensionRegistry();
    const extension: MessageDictionaryDefinition = {
      id: "test.messages.en",
      version: "1.0.0",
      apiVersion: EXTENSION_API_VERSION,
      locale: "en",
      dictionary: { "plugin.copy": "Extension copy", "shared.copy": "Extension shared" },
    };
    unwrap(registry.register("messageDictionary", extension));
    unwrap(
      registry.register("messageDictionary", {
        id: "test.messages.en.second",
        version: "1.0.0",
        apiVersion: EXTENSION_API_VERSION,
        locale: "en",
        dictionary: { "plugin.later": "Later extension copy", "shared.copy": "Extension later" },
      }),
    );
    const instance = createRuntime({
      clock: new FakeClock(),
      logger: createRecordingLogger(),
      idFactory: createDeterministicIdFactory("merge"),
      extensions: registry,
      messageDictionaries: {
        en: { "host.copy": "Host copy", "shared.copy": "Host shared" },
      },
    });
    const space = unwrap(
      instance.createSpace({
        id: "t17-merge",
        document: makeDocument("Merge"),
        extensionSelection: {
          messageDictionaries: ["test.messages.en", "test.messages.en.second"],
        },
      }),
    );
    const provider = space.getMessageProvider();
    expect(provider.format("host.copy").text).toBe("Host copy");
    expect(provider.format("plugin.copy").text).toBe("Extension copy");
    expect(provider.format("plugin.later").text).toBe("Later extension copy");
    expect(provider.format("shared.copy").text).toBe("Host shared");
    expect(provider.format("shared.copy").usedFallback).toBe(false);
    instance.dispose();
  });

  it("rejects inherited duration unit names without a non-finite value diagnostic", () => {
    const formatter = createIntlFormatterProvider({ locale: "en", timezone: "UTC" });
    let diagnostic: { readonly code?: string; readonly path?: string } | null = null;
    try {
      formatter.formatDuration(1000, { unit: "constructor" as never });
    } catch (error) {
      diagnostic =
        (error as { readonly diagnostic?: { code?: string; path?: string } }).diagnostic ?? null;
    }
    expect(diagnostic?.code).toBe("FORMAT_INVALID_VALUE");
    expect(diagnostic?.path).toBe("options/unit");
  });

  it("keeps exported documents locale-neutral", () => {
    const instance = runtime();
    const space = unwrap(
      instance.createSpace({ id: "t17-export", document: makeDocument("Neutral") }),
    );
    unwrap(space.setLocale({ locale: "ar", timezone: "Asia/Riyadh" }));
    const serialized = unwrap(exportBoardDocument(space.getSnapshot().committedDocument));
    expect(serialized.canonical).not.toContain("Asia/Riyadh");
    const parsed = JSON.parse(serialized.canonical) as Record<string, unknown>;
    expect(Object.hasOwn(parsed, "locale")).toBe(false);
    expect(Object.hasOwn(parsed, "timezone")).toBe(false);
    instance.dispose();
  });

  it("reports unknown host keys through the runtime logger", () => {
    const logger = createRecordingLogger();
    const instance = createRuntime({
      clock: new FakeClock(),
      logger,
      idFactory: createDeterministicIdFactory("unknown-key"),
      messageDictionaries: { en: { "host.custom": "Custom" } },
    });
    const space = unwrap(
      instance.createSpace({ id: "t17-unknown", document: makeDocument("Unknown") }),
    );
    expect(space.getMessageProvider().diagnostics[0]?.code).toBe("MESSAGE_UNKNOWN_KEY");
    expect(
      logger.entries.some(
        (entry) =>
          entry.level === "warn" &&
          entry.context?.code === "MESSAGE_UNKNOWN_KEY" &&
          String(entry.context?.path).includes("host.custom"),
      ),
    ).toBe(true);
    instance.dispose();
  });

  it("rejects unsupported locales without changing state", () => {
    const instance = runtime();
    const space = unwrap(instance.createSpace({ id: "t17-invalid", document: makeDocument("X") }));
    const before = space.getSnapshot();
    expectFailure(space.setLocale({ locale: "sv" }), "INVALID_LOCALE");
    expect(space.getSnapshot().locale).toBe(before.locale);
    expect(space.getSnapshot().committedDocument).toEqual(before.committedDocument);
    instance.dispose();
  });
});
