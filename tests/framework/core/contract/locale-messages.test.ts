import { describe, expect, it } from "vitest";
import {
  DIAGNOSTIC_CODES,
  BoardloomError,
  createIntlFormatterProvider,
  createRuntime,
  type FormatterProvider,
  type LocaleConfig,
  type SpaceEvent,
} from "../../../../packages/core/src/index.js";
import { expectFailure, unwrap } from "../support/assertions.js";
import {
  FakeClock,
  createDeterministicIdFactory,
  createRecordingLogger,
  makeDocument,
} from "../support/fakes.js";

describe("locale, timezone and provider contract", () => {
  it("changes locale and timezone without losing document, draft or undo history", () => {
    const runtime = createRuntime({
      clock: new FakeClock(),
      logger: createRecordingLogger(),
      idFactory: createDeterministicIdFactory("locale"),
    });
    const space = unwrap(
      runtime.createSpace({ id: "locale-space", document: makeDocument("Localized") }),
    );
    const lease = unwrap(space.acquireEditorLease({ sessionId: "locale-host" }));
    unwrap(space.updateDraft(lease, makeDocument("Draft one")));
    unwrap(space.updateDraft(lease, makeDocument("Draft two")));
    const before = space.getSnapshot();
    const events: SpaceEvent[] = [];
    space.subscribe((event) => events.push(event));

    const changed = unwrap(space.setLocale({ locale: "ru", timezone: "Europe/Moscow" }));
    expect(changed.locale).toBe("ru");
    expect(changed.timezone).toBe("Europe/Moscow");
    expect(changed.committedDocument).toEqual(before.committedDocument);
    expect(changed.committedRevision).toBe(before.committedRevision);
    expect(changed.draft).toEqual(before.draft);
    expect(changed.draft?.canUndo).toBe(true);
    expect(space.getFormatters().locale).toBe("ru");
    expect(space.getFormatters().timezone).toBe("Europe/Moscow");
    expect(space.getMessageProvider().locale).toBe("ru");
    expect(space.getMessageProvider().format("common.apply").usedFallback).toBe(true);

    const localeEvent = events.find((event) => event.type === "locale:changed");
    expect(localeEvent?.type).toBe("locale:changed");
    if (localeEvent?.type === "locale:changed") {
      expect(localeEvent.fromLocale).toBe("en");
      expect(localeEvent.fromTimezone).toBe("UTC");
      expect(localeEvent.locale).toBe("ru");
      expect(localeEvent.timezone).toBe("Europe/Moscow");
    }
    unwrap(space.releaseEditorLease(lease, { decision: "cancel" }));
  });

  it("honors per-space locale and timezone overrides over runtime defaults", () => {
    const runtime = createRuntime({
      clock: new FakeClock(),
      logger: createRecordingLogger(),
      idFactory: createDeterministicIdFactory("space-locale"),
      locale: "fr",
      timezone: "Europe/Paris",
    });
    const full = unwrap(
      runtime.createSpace({
        id: "space-locale-full",
        document: makeDocument("Full"),
        locale: "ru",
        timezone: "Europe/Moscow",
      }),
    );
    expect(full.getSnapshot().locale).toBe("ru");
    expect(full.getSnapshot().timezone).toBe("Europe/Moscow");
    expect(full.getFormatters().locale).toBe("ru");
    expect(full.getFormatters().timezone).toBe("Europe/Moscow");
    expect(full.getMessageProvider().locale).toBe("ru");

    const partial = unwrap(
      runtime.createSpace({
        id: "space-locale-partial",
        document: makeDocument("Partial"),
        timezone: "Asia/Tokyo",
      }),
    );
    expect(partial.getSnapshot().locale).toBe("fr");
    expect(partial.getSnapshot().timezone).toBe("Asia/Tokyo");

    expectFailure(
      runtime.createSpace({
        id: "space-locale-invalid",
        document: makeDocument("Invalid"),
        locale: "sv",
      }),
      DIAGNOSTIC_CODES.INVALID_LOCALE,
    );
    expectFailure(
      runtime.createSpace({
        id: "space-timezone-invalid",
        document: makeDocument("Invalid"),
        timezone: "Not/AZone",
      }),
      DIAGNOSTIC_CODES.INVALID_TIMEZONE,
    );
    expect(runtime.spaceCount).toBe(2);
  });

  it("rejects invalid locale and timezone values without changing state", () => {
    const runtime = createRuntime({
      clock: new FakeClock(),
      logger: createRecordingLogger(),
      idFactory: createDeterministicIdFactory("locale-invalid"),
    });
    const space = unwrap(
      runtime.createSpace({ id: "locale-invalid", document: makeDocument("Stable") }),
    );
    const before = space.getSnapshot();

    expectFailure(space.setLocale({ locale: "sv" }), DIAGNOSTIC_CODES.INVALID_LOCALE);
    expectFailure(space.setLocale({ timezone: "Not/AZone" }), DIAGNOSTIC_CODES.INVALID_TIMEZONE);
    const after = space.getSnapshot();
    expect(after.locale).toBe(before.locale);
    expect(after.timezone).toBe(before.timezone);
    expect(after.committedDocument).toEqual(before.committedDocument);
    expect(after.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      DIAGNOSTIC_CODES.INVALID_TIMEZONE,
    );
  });

  it("supports injected formatter providers and host message overrides", () => {
    const formatterFactory = (config: LocaleConfig): FormatterProvider => {
      const base = createIntlFormatterProvider(config);
      return Object.freeze({
        ...base,
        formatNumber: (value: number, options = {}) =>
          `formatted:${base.formatNumber(value, options)}`,
      });
    };
    const runtime = createRuntime({
      clock: new FakeClock(),
      logger: createRecordingLogger(),
      idFactory: createDeterministicIdFactory("custom"),
      formatterFactory,
      messageDictionaries: {
        ru: {
          "common.apply": "Primenit",
          "diagnostic.SPACE_DISPOSED": "Prostranstvo zakryto.",
        },
      },
    });
    const space = unwrap(
      runtime.createSpace({ id: "custom-providers", document: makeDocument("Custom") }),
    );

    expect(space.getFormatters().formatNumber(12.5)).toBe("formatted:12.5");
    expect(space.getMessageProvider().format("common.apply").text).toBe("Apply");

    unwrap(space.setLocale({ locale: "ru", timezone: "UTC" }));
    expect(space.getFormatters().formatNumber(12.5)).toBe("formatted:12,5");
    expect(space.getMessageProvider().format("common.apply").text).toBe("Primenit");
    expect(space.getMessageProvider().format("diagnostic.SPACE_DISPOSED").text).toBe(
      "Prostranstvo zakryto.",
    );
    expect(space.getMessageProvider().format("common.cancel").text).toBe("Cancel");
  });

  it("keeps timezone formatting explicit and independent from the UI language", () => {
    const formatter = createIntlFormatterProvider({ locale: "ru", timezone: "UTC" });
    const options: Intl.DateTimeFormatOptions = {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    };
    expect(formatter.formatDate("2024-01-01T00:00:00Z", options)).toBe("01.01.2024");
    expect(
      formatter.formatDate("2024-01-01T00:00:00Z", { ...options, timeZone: "Pacific/Honolulu" }),
    ).toBe("31.12.2023");
    expect(() => formatter.formatNumber(Number.POSITIVE_INFINITY)).toThrow(BoardloomError);
  });
});
