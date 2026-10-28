import { describe, expect, it } from "vitest";
import {
  bucketTemporalValue,
  compareTemporalValues,
  temporalInstant,
  withinTemporalWindow,
  zonedDateStartInstant,
} from "../../../../packages/core/src/index.js";

describe("timezone-aware temporal helpers", () => {
  it("resolves date-only values against the explicit timezone", () => {
    expect(zonedDateStartInstant("2026-10-01", "Asia/Tokyo")).toBe(
      Date.parse("2026-09-30T15:00:00Z"),
    );
    expect(zonedDateStartInstant("2026-11-01", "America/New_York")).toBe(
      Date.parse("2026-11-01T04:00:00Z"),
    );
    expect(zonedDateStartInstant("not-a-date", "UTC")).toBeNull();
    expect(zonedDateStartInstant("2026-10-01", "Not/AZone")).toBeNull();
  });

  it("rejects skipped civil dates and chooses the earliest repeated date start", () => {
    expect(zonedDateStartInstant("2011-12-30", "Pacific/Apia")).toBeNull();
    expect(zonedDateStartInstant("2016-11-06", "America/Havana")).toBe(
      Date.parse("2016-11-06T04:00:00Z"),
    );
    expect(zonedDateStartInstant("2018-11-04", "America/Sao_Paulo")).toBe(
      Date.parse("2018-11-04T03:00:00Z"),
    );
    expect(
      bucketTemporalValue("2016-11-06", "date", "America/Havana", "iso8601-offset", "day"),
    ).toBe("2016-11-06");
  });

  it("parses offset datetimes and epoch representations explicitly", () => {
    expect(temporalInstant("2026-10-02T23:30:00-05:00", "datetime", "UTC", "iso8601-offset")).toBe(
      Date.parse("2026-10-03T04:30:00Z"),
    );
    expect(temporalInstant("2026-10-02T23:30:00", "datetime", "UTC", "iso8601-offset")).toBeNull();
    const milliseconds = Date.parse("2026-10-01T00:00:00Z");
    expect(temporalInstant(milliseconds, "datetime", "UTC", "epoch-milliseconds")).toBe(
      milliseconds,
    );
    expect(temporalInstant(milliseconds / 1000, "datetime", "UTC", "epoch-seconds")).toBe(
      milliseconds,
    );
    expect(temporalInstant(Number.NaN, "datetime", "UTC", "epoch-milliseconds")).toBeNull();
  });

  it("buckets instant, day, week, month, quarter and year values", () => {
    expect(
      bucketTemporalValue(
        "2026-09-30T23:30:00Z",
        "datetime",
        "Asia/Tokyo",
        "iso8601-offset",
        "day",
      ),
    ).toBe("2026-10-01");
    expect(
      bucketTemporalValue("2026-10-01", "date", "UTC", "iso8601-offset", "week", "monday"),
    ).toBe("2026-09-28");
    expect(
      bucketTemporalValue("2026-10-01", "date", "UTC", "iso8601-offset", "week", "sunday"),
    ).toBe("2026-09-27");
    expect(bucketTemporalValue("2026-10-15", "date", "UTC", "iso8601-offset", "month")).toBe(
      "2026-10-01",
    );
    expect(bucketTemporalValue("2026-11-20", "date", "UTC", "iso8601-offset", "quarter")).toBe(
      "2026-10-01",
    );
    expect(bucketTemporalValue("2026-11-20", "date", "UTC", "iso8601-offset", "year")).toBe(
      "2026-01-01",
    );
    expect(
      bucketTemporalValue(
        Date.parse("2026-10-01T00:00:00Z"),
        "datetime",
        "UTC",
        "epoch-milliseconds",
        "day",
      ),
    ).toBe("2026-10-01");
    expect(bucketTemporalValue("2026-10-01", "date", "UTC", "iso8601-offset", "instant")).toBe(
      "2026-10-01",
    );
    expect(bucketTemporalValue("bad", "date", "UTC", "iso8601-offset", "day")).toBeNull();
  });

  it("compares temporal values and applies explicit window boundaries", () => {
    expect(
      compareTemporalValues("2026-10-01", "2026-10-01", "date", "Asia/Tokyo", "iso8601-offset"),
    ).toBe(0);
    expect(
      compareTemporalValues("2026-10-02", "2026-10-01", "date", "Asia/Tokyo", "iso8601-offset"),
    ).toBe(1);

    const value = "2026-10-01T12:00:00Z";
    const start = "2026-10-01T00:00:00Z";
    const end = "2026-10-02T00:00:00Z";
    expect(
      withinTemporalWindow(value, start, end, "datetime", "UTC", "iso8601-offset", "inclusive"),
    ).toBe(true);
    expect(
      withinTemporalWindow(value, start, end, "datetime", "UTC", "iso8601-offset", "half-open"),
    ).toBe(true);
    expect(
      withinTemporalWindow(value, start, end, "datetime", "UTC", "iso8601-offset", "exclusive"),
    ).toBe(true);
    expect(
      withinTemporalWindow(start, start, end, "datetime", "UTC", "iso8601-offset", "inclusive"),
    ).toBe(true);
    expect(
      withinTemporalWindow(start, start, end, "datetime", "UTC", "iso8601-offset", "exclusive"),
    ).toBe(false);
    expect(
      withinTemporalWindow(end, start, end, "datetime", "UTC", "iso8601-offset", "half-open"),
    ).toBe(false);
    expect(
      withinTemporalWindow(null, start, end, "datetime", "UTC", "iso8601-offset", "inclusive"),
    ).toBe(false);
  });
});
