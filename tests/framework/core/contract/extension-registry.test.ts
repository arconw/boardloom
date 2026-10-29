import { describe, expect, it } from "vitest";
import {
  DIAGNOSTIC_CODES,
  EXTENSION_API_VERSION,
  createEmptyBoardDocument,
  createExtensionRegistry,
  createIntlFormatterProvider,
  createLocalDatasetProvider,
  createRuntime,
  createSimulatedRealtimeTransport,
  registerLocaleDictionary,
  type DatasetProvider,
  type ExtensionRegistryEvent,
  type FormatterDefinition,
  type MessageDictionaryDefinition,
  type QueryAdapterDefinition,
  type RealtimeAdapterDefinition,
  type ThemeExtensionDefinition,
} from "../../../../packages/core/src/index.js";
import { ASSESSMENT_DESCRIPTOR, ASSESSMENT_ROWS } from "../fixtures/assessment-fixture.js";
import { expectFailure, unwrap } from "../support/assertions.js";
import { createDeterministicIdFactory, makeDocument } from "../support/fakes.js";

function provider(): DatasetProvider {
  return unwrap(
    createLocalDatasetProvider({
      providerId: "extension-provider",
      datasets: [{ descriptor: ASSESSMENT_DESCRIPTOR, rows: ASSESSMENT_ROWS }],
    }),
  );
}

function queryAdapter(id = "test.query"): QueryAdapterDefinition {
  return {
    id,
    version: "1.0.0",
    apiVersion: EXTENSION_API_VERSION,
    capabilities: ["query", "grouping"],
    create: () => provider(),
  };
}

function realtimeAdapter(id = "test.realtime"): RealtimeAdapterDefinition {
  return {
    id,
    version: "1.0.0",
    apiVersion: EXTENSION_API_VERSION,
    create: () => createSimulatedRealtimeTransport({ transportId: `${id}-transport` }),
  };
}

function formatter(id = "test.formatter"): FormatterDefinition {
  return {
    id,
    version: "1.0.0",
    apiVersion: EXTENSION_API_VERSION,
    create: (config) => createIntlFormatterProvider(config),
  };
}

function dictionary(id = "test.messages.en"): MessageDictionaryDefinition {
  return {
    id,
    version: "1.0.0",
    apiVersion: EXTENSION_API_VERSION,
    locale: "en",
    dictionary: { "test.message": "Extension message" },
  };
}

function theme(id = "test.theme"): ThemeExtensionDefinition {
  return {
    id,
    version: "1.0.0",
    apiVersion: EXTENSION_API_VERSION,
    tokens: { "ext.test-accent": "#123456" },
  };
}

describe("T13 extension registry contract", () => {
  it("registers all headless extension categories with version metadata", () => {
    const registry = createExtensionRegistry();
    expect(unwrap(registry.register("queryAdapter", queryAdapter())).version).toBe("1.0.0");
    expect(unwrap(registry.register("realtimeAdapter", realtimeAdapter())).id).toBe(
      "test.realtime",
    );
    expect(unwrap(registry.register("formatter", formatter())).id).toBe("test.formatter");
    expect(unwrap(registry.register("messageDictionary", dictionary())).id).toBe(
      "test.messages.en",
    );
    expect(unwrap(registry.register("theme", theme())).id).toBe("test.theme");

    expect(registry.has("queryAdapter", "test.query")).toBe(true);
    expect(registry.has("queryAdapter", "constructor")).toBe(false);
    expect(registry.list("theme").map((definition) => definition.id)).toEqual(["test.theme"]);
    expect(registry.list()).toHaveLength(5);
  });

  it("rejects duplicate IDs by default and replaces only with an explicit override", () => {
    const registry = createExtensionRegistry();
    unwrap(registry.register("queryAdapter", queryAdapter()));
    expectFailure(
      registry.register("queryAdapter", queryAdapter()),
      DIAGNOSTIC_CODES.EXTENSION_DUPLICATE,
    );
    const replaced = unwrap(
      registry.register(
        "queryAdapter",
        { ...queryAdapter(), version: "1.1.0" },
        { override: true },
      ),
    );
    expect(replaced.replaced).toBe(true);
    expect(registry.get("queryAdapter", "test.query")?.version).toBe("1.1.0");
  });

  it("rejects incompatible APIs, malformed schemas and unsafe theme tokens", () => {
    const registry = createExtensionRegistry();
    expectFailure(
      registry.register("queryAdapter", {
        ...queryAdapter(),
        apiVersion: EXTENSION_API_VERSION + 1,
      }),
      DIAGNOSTIC_CODES.EXTENSION_INCOMPATIBLE_API,
    );
    expectFailure(
      registry.register("queryAdapter", { ...queryAdapter(), version: "1.0" }),
      DIAGNOSTIC_CODES.EXTENSION_INVALID,
    );
    expectFailure(
      registry.register("formatter", {
        ...formatter(),
        create: "not a function" as never,
      }),
      DIAGNOSTIC_CODES.EXTENSION_INVALID,
    );
    expectFailure(
      registry.register("messageDictionary", {
        ...dictionary(),
        dictionary: { bad: 1 } as never,
      }),
      DIAGNOSTIC_CODES.EXTENSION_INVALID,
    );
    expectFailure(
      registry.register("theme", {
        ...theme(),
        tokens: { "not-namespaced-token": "#123456" } as never,
      }),
      DIAGNOSTIC_CODES.EXTENSION_INVALID,
    );
    expectFailure(
      registry.register("theme", {
        ...theme(),
        tokens: { "ext.test-accent": "url(https://example.invalid/a.png)" } as never,
      }),
      DIAGNOSTIC_CODES.EXTENSION_INVALID,
    );
  });

  it("emits registration and error events without throwing from listeners", () => {
    const events: ExtensionRegistryEvent[] = [];
    const registry = createExtensionRegistry({
      onEvent: (event) => {
        events.push(event);
        throw new Error("listener failure must be contained");
      },
    });
    unwrap(registry.register("theme", theme()));
    expectFailure(registry.register("theme", theme()), DIAGNOSTIC_CODES.EXTENSION_DUPLICATE);
    expect(events.map((event) => event.type)).toEqual(["extension:registered", "extension:error"]);
  });

  it("creates per-space instances and disposes them deterministically", () => {
    let providerDisposals = 0;
    let transportDisposals = 0;
    let formatterDisposals = 0;
    const registry = createExtensionRegistry();
    unwrap(
      registry.register("queryAdapter", {
        ...queryAdapter(),
        dispose: () => {
          providerDisposals += 1;
        },
      }),
    );
    unwrap(
      registry.register("realtimeAdapter", {
        ...realtimeAdapter(),
        dispose: () => {
          transportDisposals += 1;
        },
      }),
    );
    unwrap(
      registry.register("formatter", {
        ...formatter(),
        dispose: () => {
          formatterDisposals += 1;
        },
      }),
    );
    unwrap(registry.register("messageDictionary", dictionary()));
    unwrap(registry.register("theme", theme()));
    const session = unwrap(
      registry.createSession(
        {
          queryAdapter: "test.query",
          realtimeAdapter: "test.realtime",
          formatter: "test.formatter",
          messageDictionaries: ["test.messages.en"],
          themes: ["test.theme"],
        },
        { spaceId: "space-a", locale: "en", timezone: "UTC" },
      ),
    );
    expect(session.queryProvider?.providerId).toBe("extension-provider");
    expect(session.realtimeTransport?.transportId).toBe("test.realtime-transport");
    expect(session.messageDictionaries.en?.["test.message"]).toBe("Extension message");
    expect(session.themeTokens["ext.test-accent"]).toBe("#123456");
    expect(unwrap(session.createFormatter({ locale: "en", timezone: "UTC" })).locale).toBe("en");

    expect(session.dispose()).toEqual([]);
    expect(session.dispose()).toEqual([]);
    expect(providerDisposals).toBe(1);
    expect(transportDisposals).toBe(1);
    expect(formatterDisposals).toBe(1);
  });

  it("contains factory failures and continues disposing other extensions", () => {
    const registry = createExtensionRegistry();
    unwrap(
      registry.register("queryAdapter", {
        ...queryAdapter("bad.query"),
        create: () => {
          throw new Error("provider exploded");
        },
      }),
    );
    unwrap(registry.register("realtimeAdapter", realtimeAdapter()));
    expectFailure(
      registry.createSession(
        { queryAdapter: "bad.query", realtimeAdapter: "test.realtime" },
        { spaceId: "space-bad", locale: "en", timezone: "UTC" },
      ),
      DIAGNOSTIC_CODES.EXTENSION_FAILED,
    );

    let disposed = false;
    unwrap(
      registry.register("formatter", {
        ...formatter(),
        dispose: () => {
          disposed = true;
          throw new Error("dispose exploded");
        },
      }),
    );
    const session = unwrap(
      registry.createSession(
        { formatter: "test.formatter" },
        { spaceId: "space-dispose", locale: "en", timezone: "UTC" },
      ),
    );
    unwrap(session.createFormatter({ locale: "en", timezone: "UTC" }));
    const diagnostics = session.dispose();
    expect(disposed).toBe(true);
    expect(diagnostics[0]?.code).toBe(DIAGNOSTIC_CODES.EXTENSION_DISPOSAL_FAILED);
  });

  it("isolates a broken adapter to one space and exposes extension events", () => {
    const registry = createExtensionRegistry();
    const runtime = createRuntime({
      extensions: registry,
      idFactory: createDeterministicIdFactory("ext"),
      blockTypes: ["plugin.sample"],
    });
    const events: string[] = [];
    runtime.subscribe((event) => {
      if (event.type === "extension:registered" || event.type === "extension:error") {
        events.push(`${event.type}:${event.id}`);
      }
    });
    expect(registry.listenerCount).toBe(1);
    unwrap(
      registry.register("queryAdapter", {
        ...queryAdapter("broken.query"),
        create: () => {
          throw new Error("broken adapter");
        },
      }),
    );
    unwrap(registry.register("queryAdapter", queryAdapter("good.query")));
    const broken = runtime.createSpace({
      id: "broken-space",
      document: makeDocument("Broken"),
      extensionSelection: { queryAdapter: "broken.query" },
    });
    expect(broken.ok).toBe(false);
    if (!broken.ok) {
      expect(broken.diagnostics[0]?.code).toBe(DIAGNOSTIC_CODES.EXTENSION_FAILED);
    }
    const good = unwrap(
      runtime.createSpace({
        id: "good-space",
        document: makeDocument("Good"),
        extensionSelection: { queryAdapter: "good.query" },
      }),
    );
    expect(good.getDatasetDescriptor(ASSESSMENT_DESCRIPTOR.id)?.id).toBe(ASSESSMENT_DESCRIPTOR.id);
    expect(runtime.spaceCount).toBe(1);
    expect(events.filter((event) => event === "extension:registered:good.query")).toHaveLength(1);
    expect(events.filter((event) => event === "extension:registered:broken.query")).toHaveLength(1);
    expect(events.some((event) => event.startsWith("extension:error:"))).toBe(true);
    unwrap(good.dispose());
    unwrap(runtime.dispose());
    expect(registry.listenerCount).toBe(0);
    expect(registry.disposed).toBe(false);
  });

  it("rejects selection IDs that are not registered", () => {
    const registry = createExtensionRegistry();
    const session = registry.createSession(
      { queryAdapter: "missing.query" },
      { spaceId: "space", locale: "en", timezone: "UTC" },
    );
    expectFailure(session, DIAGNOSTIC_CODES.EXTENSION_INVALID);
  });
  it("wires extension formatter, dictionaries, themes and per-space disposal into a runtime", () => {
    let disposals = 0;
    const registry = createExtensionRegistry();
    unwrap(
      registry.register("queryAdapter", {
        ...queryAdapter(),
        dispose: () => {
          disposals += 1;
        },
      }),
    );
    unwrap(registry.register("formatter", formatter()));
    unwrap(registry.register("messageDictionary", dictionary()));
    unwrap(registry.register("theme", theme()));
    const runtime = createRuntime({
      extensions: registry,
      blockTypes: ["plugin.sample"],
      idFactory: createDeterministicIdFactory("ext-space"),
    });
    const document = {
      ...createEmptyBoardDocument({
        id: "plugin-board",
        title: "Plugin board",
        createdAt: 1_700_000_000_000,
      }),
      blocks: [
        {
          id: "custom-block",
          type: "plugin.sample",
          title: "Custom",
          bindings: [],
          config: { text: "plugin" },
        },
      ],
      layout: {
        desktop: {
          columns: 12,
          rowHeight: 8,
          placements: [{ blockId: "custom-block", x: 0, y: 0, width: 4, height: 2 }],
        },
      },
    };
    const first = unwrap(
      runtime.createSpace({
        id: "space-one",
        document,
        extensionSelection: {
          queryAdapter: "test.query",
          formatter: "test.formatter",
          messageDictionaries: ["test.messages.en"],
          themes: ["test.theme"],
        },
      }),
    );
    const second = unwrap(
      runtime.createSpace({
        id: "space-two",
        document,
        extensionSelection: { queryAdapter: "test.query" },
      }),
    );
    expect(first.getFormatters().locale).toBe("en");
    expect(first.getMessageProvider().format("test.message").text).toBe("Extension message");
    expect(first.getExtensionThemeTokens()["ext.test-accent"]).toBe("#123456");
    expect(second.getExtensionThemeTokens()).toEqual({});
    unwrap(first.dispose());
    expect(disposals).toBe(1);
    expect(second.disposed).toBe(false);
    unwrap(second.dispose());
    expect(disposals).toBe(2);
    unwrap(runtime.dispose());

    const rejected = createRuntime().createSpace({
      document,
    });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.diagnostics.some((item) => item.code === "UNKNOWN_BLOCK_TYPE")).toBe(true);
    }
  });
  it("provides the locale-override registration hook for host dictionaries", () => {
    const registry = createExtensionRegistry();
    const registered = unwrap(
      registerLocaleDictionary(registry, "ru", { "test.override": "Host override" }),
    );
    expect(registered.id).toBe("locale.ru");
    expect(registry.has("messageDictionary", "locale.ru")).toBe(true);
    expect(registry.resolveMessageDictionaries(["locale.ru"]).ru?.["test.override"]).toBe(
      "Host override",
    );
    expect(() =>
      registerLocaleDictionary(registry, "ru", { "test.override": "Again" }),
    ).not.toThrow();
    expect(registerLocaleDictionary(registry, "ru", { "test.override": "Again" }).ok).toBe(false);
    expect(
      registerLocaleDictionary(registry, "ru", { "test.override": "Again" }, { override: true }).ok,
    ).toBe(true);
  });
  it("merges overlapping theme packs with last-selected-wins precedence", () => {
    const registry = createExtensionRegistry();
    unwrap(
      registry.register("theme", {
        id: "theme.first",
        version: "1.0.0",
        apiVersion: EXTENSION_API_VERSION,
        tokens: { "ext.shared": "#111111", "ext.first": "#222222" },
      }),
    );
    unwrap(
      registry.register("theme", {
        id: "theme.second",
        version: "1.0.0",
        apiVersion: EXTENSION_API_VERSION,
        tokens: { "ext.shared": "#333333" },
      }),
    );
    const session = unwrap(
      registry.createSession(
        { themes: ["theme.first", "theme.second"] },
        { spaceId: "theme-space", locale: "en", timezone: "UTC" },
      ),
    );
    expect(session.themeTokens["ext.shared"]).toBe("#333333");
    expect(session.themeTokens["ext.first"]).toBe("#222222");
    const runtime = createRuntime({ extensions: registry });
    const space = unwrap(
      runtime.createSpace({
        id: "theme-space",
        document: makeDocument("Theme"),
        extensionSelection: { themes: ["theme.first", "theme.second"] },
      }),
    );
    expect(space.getExtensionThemeTokens()["ext.shared"]).toBe("#333333");
    unwrap(space.dispose());
    unwrap(runtime.dispose());
  });

  it("disposes query, realtime and formatter candidates rejected after creation", () => {
    let queryDisposals = 0;
    let realtimeDisposals = 0;
    let formatterDisposals = 0;
    const registry = createExtensionRegistry();
    unwrap(
      registry.register("queryAdapter", {
        ...queryAdapter("bad-shape.query"),
        create: () => ({ providerId: "bad-shape" }) as never,
        dispose: () => {
          queryDisposals += 1;
        },
      }),
    );
    unwrap(
      registry.register("realtimeAdapter", {
        ...realtimeAdapter("bad-shape.realtime"),
        create: () => ({}) as never,
        dispose: () => {
          realtimeDisposals += 1;
        },
      }),
    );
    unwrap(
      registry.register("formatter", {
        ...formatter("bad-shape.formatter"),
        create: () => ({}) as never,
        dispose: () => {
          formatterDisposals += 1;
        },
      }),
    );
    expectFailure(
      registry.createSession(
        { queryAdapter: "bad-shape.query" },
        { spaceId: "rejected-query", locale: "en", timezone: "UTC" },
      ),
      DIAGNOSTIC_CODES.QUERY_PROVIDER_INVALID,
    );
    expectQueryDisposalsOne(queryDisposals);
    expectFailure(
      registry.createSession(
        { realtimeAdapter: "bad-shape.realtime" },
        { spaceId: "rejected-realtime", locale: "en", timezone: "UTC" },
      ),
      DIAGNOSTIC_CODES.EXTENSION_INVALID,
    );
    expect(realtimeDisposals).toBe(1);
    const session = unwrap(
      registry.createSession(
        { formatter: "bad-shape.formatter" },
        { spaceId: "rejected-formatter", locale: "en", timezone: "UTC" },
      ),
    );
    expectFailure(
      session.createFormatter({ locale: "en", timezone: "UTC" }),
      DIAGNOSTIC_CODES.EXTENSION_FAILED,
    );
    expect(formatterDisposals).toBe(1);
  });

  it("freezes registry event envelopes before delivering them to observers", () => {
    const registry = createExtensionRegistry();
    const observed: string[] = [];
    registry.subscribe((event) => {
      expect(Object.isFrozen(event)).toBe(true);
      expect(() => {
        (event as unknown as { id: string }).id = "mutated";
      }).toThrow();
      observed.push(event.id);
    });
    registry.subscribe((event) => {
      observed.push(event.id);
    });
    unwrap(registry.register("theme", theme("frozen.theme")));
    expect(observed).toEqual(["frozen.theme", "frozen.theme"]);
  });

  it("releases superseded formatter instances on locale changes", () => {
    let disposals = 0;
    const registry = createExtensionRegistry();
    unwrap(
      registry.register("formatter", {
        ...formatter("locale.formatter"),
        dispose: () => {
          disposals += 1;
        },
      }),
    );
    const runtime = createRuntime({ extensions: registry });
    const space = unwrap(
      runtime.createSpace({
        id: "locale-space",
        document: makeDocument("Locale"),
        extensionSelection: { formatter: "locale.formatter" },
      }),
    );
    unwrap(space.setLocale({ timezone: "Europe/Berlin" }));
    unwrap(space.setLocale({ locale: "ru" }));
    unwrap(space.setLocale({ locale: "en" }));
    expect(disposals).toBe(3);
    unwrap(space.dispose());
    expect(disposals).toBe(4);
    unwrap(runtime.dispose());
  });
  it("does not call dispose hooks when a factory returns no instance", () => {
    const calls: unknown[] = [];
    const registry = createExtensionRegistry();
    unwrap(
      registry.register("queryAdapter", {
        ...queryAdapter("empty.query"),
        create: () => undefined as never,
        dispose: (value) => {
          calls.push(value);
        },
      }),
    );
    unwrap(
      registry.register("realtimeAdapter", {
        ...realtimeAdapter("empty.realtime"),
        create: () => undefined as never,
        dispose: (value) => {
          calls.push(value);
        },
      }),
    );
    unwrap(
      registry.register("formatter", {
        ...formatter("empty.formatter"),
        create: () => undefined as never,
        dispose: (value) => {
          calls.push(value);
        },
      }),
    );
    expectFailure(
      registry.createSession(
        { queryAdapter: "empty.query" },
        { spaceId: "empty-query", locale: "en", timezone: "UTC" },
      ),
      DIAGNOSTIC_CODES.QUERY_PROVIDER_INVALID,
    );
    expectFailure(
      registry.createSession(
        { realtimeAdapter: "empty.realtime" },
        { spaceId: "empty-realtime", locale: "en", timezone: "UTC" },
      ),
      DIAGNOSTIC_CODES.EXTENSION_INVALID,
    );
    const session = unwrap(
      registry.createSession(
        { formatter: "empty.formatter" },
        { spaceId: "empty-formatter", locale: "en", timezone: "UTC" },
      ),
    );
    expectFailure(
      session.createFormatter({ locale: "en", timezone: "UTC" }),
      DIAGNOSTIC_CODES.EXTENSION_FAILED,
    );
    expect(calls).toEqual([]);
  });
});

function expectQueryDisposalsOne(value: number): void {
  expect(value).toBe(1);
}
