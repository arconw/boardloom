import {
  BLOCK_EXTENSION_API_VERSION,
  DIAGNOSTIC_CODES,
  EXTENSION_API_VERSION,
  RENDERER_API_VERSION,
  createDiagnostic,
  createIntlFormatterProvider,
  destroyRenderer,
  fieldValueOf,
  mountRenderer,
  type ChartRendererSpec,
  type FormatterDefinition,
  type MessageDictionaryDefinition,
  type QueryCounts,
  type RendererData,
  type RendererDefinition,
  type RendererHandle,
  type RendererInput,
  type RendererSpec,
  type RendererValidation,
  type ThemeExtensionDefinition,
  type LocaleConfig,
  type BoardloomLocale,
} from "@boardloom/core";
import type {
  BlockSurface,
  BlockSurfaceEnvironment,
  BlockTypeDefinition,
} from "./block-registry.js";
import { clearElement, createElement, setHostText } from "./dom.js";
import { renderErrorState } from "./states.js";

export const REFERENCE_BLOCK_TYPE = "plugin.reference-tile";
export const REFERENCE_RENDERER_ID = "boardloom.reference.bars";

export interface ReferencePluginOptions {
  readonly accent?: string;
  readonly idPrefix?: string;
}

export interface ReferencePlugin {
  readonly blockTypes: readonly BlockTypeDefinition[];
  readonly renderers: readonly RendererDefinition<HTMLElement>[];
  readonly formatters: readonly FormatterDefinition[];
  readonly messageDictionaries: readonly MessageDictionaryDefinition[];
  readonly themes: readonly ThemeExtensionDefinition[];
}

const DEFAULT_ACCENT = "#0d6964";
const ACCENT_PATTERN = /^#[0-9a-fA-F]{3,8}$/;

function referenceStyle(accent: string): string {
  return [
    `.plugin-reference { border-color: ${accent}; }`,
    `.plugin-reference__title { color: ${accent}; }`,
    `.plugin-reference-bars { display: grid; gap: 0.5rem; }`,
    `.plugin-reference-bars__row { display: grid; grid-template-columns: minmax(5rem, 1fr) minmax(4rem, 2fr) auto; align-items: center; gap: 0.5rem; }`,
    `.plugin-reference-bars__track { display: block; min-height: 0.75rem; border-radius: 999px; background: color-mix(in srgb, ${accent} 16%, transparent); overflow: hidden; }`,
    `.plugin-reference-bars__fill { display: block; min-height: 0.75rem; background: var(--bl-ext-reference-accent, ${accent}); }`,
  ].join("\n");
}

const REFERENCE_DICTIONARIES: Readonly<Record<BoardloomLocale, Readonly<Record<string, string>>>> =
  Object.freeze({
    en: Object.freeze({
      "plugin.reference.tileName": "Reference tile",
      "plugin.reference.title": "Reference tile",
      "plugin.reference.caption": "Values rendered by the reference plugin renderer.",
      "plugin.reference.invalidValues": "Plugin values must be an array of finite numbers.",
      "plugin.reference.unsupported": "The reference plugin renderer is not registered.",
    }),
    ru: Object.freeze({
      "plugin.reference.tileName":
        "\u0421\u043f\u0440\u0430\u0432\u043e\u0447\u043d\u0430\u044f \u043f\u043b\u0438\u0442\u043a\u0430",
      "plugin.reference.title":
        "\u0421\u043f\u0440\u0430\u0432\u043e\u0447\u043d\u0430\u044f \u043f\u043b\u0438\u0442\u043a\u0430",
      "plugin.reference.caption":
        "\u0417\u043d\u0430\u0447\u0435\u043d\u0438\u044f, \u043e\u0442\u043e\u0431\u0440\u0430\u0436\u0430\u0435\u043c\u044b\u0435 \u044d\u0442\u0430\u043b\u043e\u043d\u043d\u044b\u043c \u043c\u043e\u0434\u0443\u043b\u0435\u043c \u0432\u0438\u0437\u0443\u0430\u043b\u0438\u0437\u0430\u0446\u0438\u0438 \u043f\u043b\u0430\u0433\u0438\u043d\u0430.",
      "plugin.reference.invalidValues":
        "\u0417\u043d\u0430\u0447\u0435\u043d\u0438\u044f \u043f\u043b\u0430\u0433\u0438\u043d\u0430 \u0434\u043e\u043b\u0436\u043d\u044b \u0431\u044b\u0442\u044c \u043c\u0430\u0441\u0441\u0438\u0432\u043e\u043c \u043a\u043e\u043d\u0435\u0447\u043d\u044b\u0445 \u0447\u0438\u0441\u0435\u043b.",
      "plugin.reference.unsupported":
        "\u042d\u0442\u0430\u043b\u043e\u043d\u043d\u044b\u0439 \u043f\u043b\u0430\u0433\u0438\u043d \u0440\u0435\u043d\u0434\u0435\u0440\u0438\u043d\u0433\u0430 \u043d\u0435 \u0437\u0430\u0440\u0435\u0433\u0438\u0441\u0442\u0440\u0438\u0440\u043e\u0432\u0430\u043d.",
    }),
    es: Object.freeze({
      "plugin.reference.tileName": "Azulejo de referencia",
      "plugin.reference.title": "Azulejo de referencia",
      "plugin.reference.caption":
        "Valores representados por el renderizador del complemento de referencia.",
      "plugin.reference.invalidValues":
        "Los valores de los complementos deben ser una matriz de n\u00fameros finitos.",
      "plugin.reference.unsupported":
        "El renderizador del complemento de referencia no est\u00e1 registrado.",
    }),
    fr: Object.freeze({
      "plugin.reference.tileName": "Tuile de r\u00e9f\u00e9rence",
      "plugin.reference.title": "Tuile de r\u00e9f\u00e9rence",
      "plugin.reference.caption":
        "Valeurs rendues par le moteur de rendu du plugin de r\u00e9f\u00e9rence.",
      "plugin.reference.invalidValues":
        "Les valeurs du plugin doivent \u00eatre un tableau de nombres finis.",
      "plugin.reference.unsupported":
        "Le moteur de rendu du plugin de r\u00e9f\u00e9rence n'est pas enregistr\u00e9.",
    }),
    de: Object.freeze({
      "plugin.reference.tileName": "Referenzkachel",
      "plugin.reference.title": "Referenzkachel",
      "plugin.reference.caption": "Vom Referenz-Plugin-Renderer gerenderte Werte.",
      "plugin.reference.invalidValues": "Plugin-Werte m\u00fcssen ein Array endlicher Zahlen sein.",
      "plugin.reference.unsupported": "Der Referenz-Plugin-Renderer ist nicht registriert.",
    }),
    "pt-BR": Object.freeze({
      "plugin.reference.tileName": "Bloco de refer\u00eancia",
      "plugin.reference.title": "Bloco de refer\u00eancia",
      "plugin.reference.caption":
        "Valores renderizados pelo renderizador do plugin de refer\u00eancia.",
      "plugin.reference.invalidValues":
        "Os valores do plug-in devem ser uma matriz de n\u00fameros finitos.",
      "plugin.reference.unsupported":
        "O renderizador do plugin de refer\u00eancia n\u00e3o est\u00e1 registrado.",
    }),
    "zh-CN": Object.freeze({
      "plugin.reference.tileName": "\u53c2\u8003\u74f7\u7816",
      "plugin.reference.title": "\u53c2\u8003\u74f7\u7816",
      "plugin.reference.caption":
        "\u7531\u53c2\u8003\u63d2\u4ef6\u6e32\u67d3\u5668\u6e32\u67d3\u7684\u503c\u3002",
      "plugin.reference.invalidValues":
        "\u63d2\u4ef6\u503c\u5fc5\u987b\u662f\u6709\u9650\u6570\u5b57\u7684\u6570\u7ec4\u3002",
      "plugin.reference.unsupported":
        "\u53c2\u8003\u63d2\u4ef6\u6e32\u67d3\u5668\u672a\u6ce8\u518c\u3002",
    }),
    ja: Object.freeze({
      "plugin.reference.tileName": "\u53c2\u7167\u30bf\u30a4\u30eb",
      "plugin.reference.title": "\u53c2\u7167\u30bf\u30a4\u30eb",
      "plugin.reference.caption":
        "\u53c2\u7167\u30d7\u30e9\u30b0\u30a4\u30f3 \u30ec\u30f3\u30c0\u30e9\u30fc\u306b\u3088\u3063\u3066\u30ec\u30f3\u30c0\u30ea\u30f3\u30b0\u3055\u308c\u305f\u5024\u3002",
      "plugin.reference.invalidValues":
        "\u30d7\u30e9\u30b0\u30a4\u30f3\u306e\u5024\u306f\u6709\u9650\u6570\u306e\u914d\u5217\u3067\u3042\u308b\u5fc5\u8981\u304c\u3042\u308a\u307e\u3059\u3002",
      "plugin.reference.unsupported":
        "\u53c2\u7167\u30d7\u30e9\u30b0\u30a4\u30f3 \u30ec\u30f3\u30c0\u30e9\u30fc\u304c\u767b\u9332\u3055\u308c\u3066\u3044\u307e\u305b\u3093\u3002",
    }),
    ko: Object.freeze({
      "plugin.reference.tileName": "\ucc38\uc870 \ud0c0\uc77c",
      "plugin.reference.title": "\ucc38\uc870 \ud0c0\uc77c",
      "plugin.reference.caption":
        "\ucc38\uc870 \ud50c\ub7ec\uadf8\uc778 \ub80c\ub354\ub7ec\uc5d0 \uc758\ud574 \ub80c\ub354\ub9c1\ub41c \uac12\uc785\ub2c8\ub2e4.",
      "plugin.reference.invalidValues":
        "\ud50c\ub7ec\uadf8\uc778 \uac12\uc740 \uc720\ud55c\ud55c \uc22b\uc790\uc758 \ubc30\uc5f4\uc774\uc5b4\uc57c \ud569\ub2c8\ub2e4.",
      "plugin.reference.unsupported":
        "\ucc38\uc870 \ud50c\ub7ec\uadf8\uc778 \ub80c\ub354\ub7ec\uac00 \ub4f1\ub85d\ub418\uc9c0 \uc54a\uc558\uc2b5\ub2c8\ub2e4.",
    }),
    ar: Object.freeze({
      "plugin.reference.tileName":
        "\u0627\u0644\u0628\u0644\u0627\u0637 \u0627\u0644\u0645\u0631\u062c\u0639\u064a",
      "plugin.reference.title":
        "\u0627\u0644\u0628\u0644\u0627\u0637 \u0627\u0644\u0645\u0631\u062c\u0639\u064a",
      "plugin.reference.caption":
        "\u0627\u0644\u0642\u064a\u0645 \u0627\u0644\u0645\u0642\u062f\u0645\u0629 \u0628\u0648\u0627\u0633\u0637\u0629 \u0639\u0627\u0631\u0636 \u0627\u0644\u0628\u0631\u0646\u0627\u0645\u062c \u0627\u0644\u0645\u0633\u0627\u0639\u062f \u0627\u0644\u0645\u0631\u062c\u0639\u064a.",
      "plugin.reference.invalidValues":
        "\u064a\u062c\u0628 \u0623\u0646 \u062a\u0643\u0648\u0646 \u0642\u064a\u0645 \u0627\u0644\u0628\u0631\u0646\u0627\u0645\u062c \u0627\u0644\u0645\u0633\u0627\u0639\u062f \u0639\u0628\u0627\u0631\u0629 \u0639\u0646 \u0645\u062c\u0645\u0648\u0639\u0629 \u0645\u0646 \u0627\u0644\u0623\u0631\u0642\u0627\u0645 \u0627\u0644\u0645\u062d\u062f\u0648\u062f\u0629.",
      "plugin.reference.unsupported":
        "\u0644\u0645 \u064a\u062a\u0645 \u062a\u0633\u062c\u064a\u0644 \u0639\u0627\u0631\u0636 \u0627\u0644\u0628\u0631\u0646\u0627\u0645\u062c \u0627\u0644\u0645\u0633\u0627\u0639\u062f \u0627\u0644\u0645\u0631\u062c\u0639\u064a.",
    }),
    hi: Object.freeze({
      "plugin.reference.tileName": "\u0938\u0902\u0926\u0930\u094d\u092d \u091f\u093e\u0907\u0932",
      "plugin.reference.title": "\u0938\u0902\u0926\u0930\u094d\u092d \u091f\u093e\u0907\u0932",
      "plugin.reference.caption":
        "\u0938\u0902\u0926\u0930\u094d\u092d \u092a\u094d\u0932\u0917\u0907\u0928 \u0930\u0947\u0902\u0921\u0930\u0930 \u0926\u094d\u0935\u093e\u0930\u093e \u092a\u094d\u0930\u0926\u093e\u0928 \u0915\u093f\u090f \u0917\u090f \u092e\u093e\u0928\u0964",
      "plugin.reference.invalidValues":
        "\u092a\u094d\u0932\u0917\u0907\u0928 \u092e\u093e\u0928 \u092a\u0930\u093f\u092e\u093f\u0924 \u0938\u0902\u0916\u094d\u092f\u093e\u0913\u0902 \u0915\u0940 \u090f\u0915 \u0938\u0930\u0923\u0940 \u0939\u094b\u0928\u0940 \u091a\u093e\u0939\u093f\u090f\u0964",
      "plugin.reference.unsupported":
        "\u0938\u0902\u0926\u0930\u094d\u092d \u092a\u094d\u0932\u0917\u0907\u0928 \u0930\u0947\u0902\u0921\u0930\u0930 \u092a\u0902\u091c\u0940\u0915\u0943\u0924 \u0928\u0939\u0940\u0902 \u0939\u0948\u0964",
    }),
  });

function valueList(value: unknown): number[] | null {
  if (value === undefined) {
    return [4, 9, 6, 12];
  }
  if (!Array.isArray(value) || value.length > 64) {
    return null;
  }
  const numbers: number[] = [];
  for (const entry of value) {
    if (typeof entry !== "number" || !Number.isFinite(entry)) {
      return null;
    }
    numbers.push(entry);
  }
  return numbers;
}

function stringConfig(environment: BlockSurfaceEnvironment, key: string): string | undefined {
  const config = environment.block.config;
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    return undefined;
  }
  const value = Object.hasOwn(config, key) ? (config as Record<string, unknown>)[key] : undefined;
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function referenceData(
  values: readonly number[],
  title: string,
  valueLabel: string,
): { readonly data: RendererData; readonly spec: ChartRendererSpec } {
  const rows = values.map((value, index) =>
    Object.freeze({
      category: `${index + 1}`,
      value,
    }),
  );
  const counts: QueryCounts = Object.freeze({
    returnedRows: rows.length,
    totalRows: rows.length,
    filteredRows: rows.length,
    nullCounts: Object.freeze({}),
  });
  return {
    data: Object.freeze({
      fields: Object.freeze([
        Object.freeze({
          fieldId: "category",
          type: "string" as const,
          role: "dimension" as const,
        }),
        Object.freeze({
          fieldId: "value",
          type: "number" as const,
          role: "measure" as const,
        }),
      ]),
      rows: Object.freeze(rows),
      counts,
      phase: "settled" as const,
      scopeText: null,
      stale: false,
      partial: false,
      empty: rows.length === 0,
    }),
    spec: Object.freeze({
      id: "plugin.reference",
      kind: "chart" as const,
      title,
      comparison: false,
      visualization: "bar" as const,
      x: Object.freeze({
        fieldId: "category",
        label: title,
        type: "string" as const,
        role: "dimension" as const,
        ordered: true,
      }),
      y: Object.freeze({
        fieldId: "value",
        label: valueLabel,
        type: "number" as const,
        role: "measure" as const,
      }),
      series: null,
      aggregation: "none" as const,
      stacked: false,
      categoryOrder: "data" as const,
      xAxis: Object.freeze({}),
      yAxis: Object.freeze({ min: 0 }),
    }),
  };
}

function createReferenceRenderer(): RendererDefinition<HTMLElement> {
  return Object.freeze({
    id: REFERENCE_RENDERER_ID,
    version: "1.0.0",
    apiVersion: RENDERER_API_VERSION,
    kind: "chart" as const,
    explicitOnly: true,
    visualizations: Object.freeze(["bar"] as const),
    capabilities: Object.freeze({
      kinds: Object.freeze(["chart"] as const),
      visualizations: Object.freeze(["bar"] as const),
      aggregation: Object.freeze(["none"] as const),
      comparison: false,
      series: false,
      stacking: "rejected" as const,
      zeroBaseline: "visible" as const,
      negativeValues: "supported" as const,
      accessibility: true,
    }),
    validate(spec: RendererSpec): RendererValidation {
      if (spec.kind !== "chart" || spec.visualization !== "bar") {
        return Object.freeze({
          ok: false,
          diagnostics: Object.freeze([
            createDiagnostic(
              DIAGNOSTIC_CODES.RENDERER_INCOMPATIBLE,
              "renderer/boardloom.reference.bars",
              { message: "The reference renderer only accepts bar chart specs." },
            ),
          ]),
        });
      }
      if (spec.y.type !== "number") {
        return Object.freeze({
          ok: false,
          diagnostics: Object.freeze([
            createDiagnostic(
              DIAGNOSTIC_CODES.RENDERER_INCOMPATIBLE,
              "renderer/boardloom.reference.bars/y",
              { message: "The reference renderer requires a numeric value field." },
            ),
          ]),
        });
      }
      return Object.freeze({ ok: true, diagnostics: Object.freeze([]) });
    },
    mount(input: RendererInput<HTMLElement>): RendererHandle<HTMLElement> {
      const document = input.host.ownerDocument;
      let wrapper: HTMLElement | null = null;
      const update = (next: RendererInput<HTMLElement>): void => {
        if (next.spec.kind !== "chart") {
          throw new Error("The reference renderer received a non-chart spec.");
        }
        const spec = next.spec;
        const rows = next.data.rows;
        let maximum = 0;
        for (const row of rows) {
          const value = fieldValueOf(row, spec.y.fieldId);
          if (typeof value === "number" && Number.isFinite(value)) {
            maximum = Math.max(maximum, Math.abs(value));
          }
        }
        wrapper?.remove();
        const root = document.createElement("div");
        root.className = "plugin-reference-bars";
        root.setAttribute("data-renderer-id", REFERENCE_RENDERER_ID);
        root.setAttribute("role", "group");
        root.setAttribute("aria-label", spec.title ?? spec.y.label);
        const list = document.createElement("ol");
        list.className = "plugin-reference-bars__list";
        list.setAttribute("role", "list");
        rows.forEach((row, index) => {
          const raw = fieldValueOf(row, spec.y.fieldId);
          const value = typeof raw === "number" && Number.isFinite(raw) ? raw : null;
          const item = document.createElement("li");
          item.className = "plugin-reference-bars__row";
          item.setAttribute("role", "listitem");
          const label = document.createElement("span");
          label.className = "plugin-reference-bars__label";
          label.textContent =
            typeof row[spec.x.fieldId] === "string" ? String(row[spec.x.fieldId]) : `${index + 1}`;
          const track = document.createElement("span");
          track.className = "plugin-reference-bars__track";
          track.setAttribute("aria-hidden", "true");
          const fill = document.createElement("span");
          fill.className = "plugin-reference-bars__fill";
          fill.style.setProperty(
            "width",
            value === null || maximum === 0
              ? "0%"
              : `${Math.round((Math.abs(value) / maximum) * 100)}%`,
          );
          track.append(fill);
          const amount = document.createElement("span");
          amount.className = "plugin-reference-bars__value";
          amount.textContent =
            value === null
              ? next.messages.text("chart.missing")
              : next.formatters.formatNumber(value);
          item.append(label, track, amount);
          list.append(item);
        });
        root.append(list);
        next.host.append(root);
        wrapper = root;
      };
      update(input);
      return Object.freeze({
        update,
        destroy(): void {
          wrapper?.remove();
          wrapper = null;
        },
      });
    },
  });
}

function createReferenceBlock(accent: string): BlockTypeDefinition {
  return Object.freeze({
    type: REFERENCE_BLOCK_TYPE,
    version: "1.0.0",
    apiVersion: BLOCK_EXTENSION_API_VERSION,
    styles: referenceStyle(accent),
    createSurface(environment: BlockSurfaceEnvironment): BlockSurface {
      const element = createElement(environment.dom, "section", "plugin-reference");
      element.setAttribute("data-plugin-type", REFERENCE_BLOCK_TYPE);
      const heading = createElement(environment.dom, "h3", "plugin-reference__title");
      const body = createElement(environment.dom, "div", "plugin-reference__body");
      element.append(heading, body);
      let handle: RendererHandle<HTMLElement> | null = null;
      let definition: RendererDefinition<HTMLElement> | null = null;

      const disposeHandle = (): void => {
        if (handle !== null && definition !== null) {
          destroyRenderer(definition, handle);
        }
        handle = null;
      };

      const update = (next: BlockSurfaceEnvironment): void => {
        const title = stringConfig(next, "title") ?? next.messages.text("plugin.reference.title");
        const caption =
          stringConfig(next, "caption") ?? next.messages.text("plugin.reference.caption");
        setHostText(heading, title);
        const config = next.block.config as Record<string, unknown>;
        const values = valueList(Object.hasOwn(config, "values") ? config.values : undefined);
        const target = next.renderers.get(REFERENCE_RENDERER_ID);
        if (values === null || target === undefined) {
          disposeHandle();
          clearElement(body);
          const diagnostics =
            values === null
              ? [
                  createDiagnostic(
                    DIAGNOSTIC_CODES.INVALID_ARGUMENT,
                    `blocks/${next.block.id}/config/values`,
                    {
                      message: next.messages.text("plugin.reference.invalidValues"),
                      relatedIds: [next.block.id],
                    },
                  ),
                ]
              : [
                  createDiagnostic(
                    DIAGNOSTIC_CODES.RENDERER_UNSUPPORTED,
                    `blocks/${next.block.id}/renderer`,
                    {
                      message: next.messages.text("plugin.reference.unsupported"),
                      relatedIds: [REFERENCE_RENDERER_ID],
                    },
                  ),
                ];
          renderErrorState(body, next.messages, diagnostics);
          element.setAttribute("data-state", "error");
          return;
        }
        const built = referenceData(values, title, next.messages.text("editor.properties.measure"));
        const captionElement = createElement(next.dom, "p", "plugin-reference__caption");
        setHostText(captionElement, caption);
        disposeHandle();
        clearElement(body);
        body.append(captionElement);
        definition = target;
        const mounted = mountRenderer(target, {
          host: body,
          spec: built.spec,
          data: built.data,
          theme: next.theme,
          locale: next.locale,
          timezone: next.timezone,
          direction: next.messages.direction,
          formatters: next.formatters,
          messages: next.messages,
        });
        if (mounted.handle === null) {
          definition = null;
          renderErrorState(body, next.messages, mounted.diagnostics);
          element.setAttribute("data-state", "error");
          return;
        }
        handle = mounted.handle;
        element.setAttribute("data-state", next.query?.phase ?? "settled");
      };
      update(environment);
      return Object.freeze({
        element,
        update,
        destroy(): void {
          disposeHandle();
        },
      });
    },
  });
}

function createReferenceFormatter(): FormatterDefinition {
  return Object.freeze({
    id: "reference.formatter",
    version: "1.0.0",
    apiVersion: EXTENSION_API_VERSION,
    capabilities: Object.freeze(["formatting", "locale", "unit"]),
    create(config: LocaleConfig) {
      const base = createIntlFormatterProvider(config);
      return Object.freeze({
        ...base,
        formatNumber(value: number, options = {}) {
          return base.formatNumber(value, {
            maximumFractionDigits: 2,
            ...options,
          });
        },
      });
    },
  });
}

export function createReferencePlugin(options: ReferencePluginOptions = {}): ReferencePlugin {
  const accent =
    typeof options.accent === "string" && ACCENT_PATTERN.test(options.accent)
      ? options.accent
      : DEFAULT_ACCENT;
  const prefix =
    typeof options.idPrefix === "string" && /^[a-z][a-z0-9-]*$/.test(options.idPrefix)
      ? options.idPrefix
      : "reference";
  return Object.freeze({
    blockTypes: Object.freeze([createReferenceBlock(accent)]),
    renderers: Object.freeze([createReferenceRenderer()]),
    formatters: Object.freeze([createReferenceFormatter()]),
    messageDictionaries: Object.freeze(
      (Object.keys(REFERENCE_DICTIONARIES) as BoardloomLocale[]).map((locale) =>
        Object.freeze({
          id: `reference.messages.${locale}`,
          version: "1.0.0",
          apiVersion: EXTENSION_API_VERSION,
          locale,
          dictionary: REFERENCE_DICTIONARIES[locale],
        }),
      ),
    ),
    themes: Object.freeze([
      Object.freeze({
        id: `${prefix}.theme`,
        version: "1.0.0",
        apiVersion: EXTENSION_API_VERSION,
        tokens: Object.freeze({
          "ext.reference-accent": accent,
        }),
      }),
    ]),
  });
}

export const REFERENCE_PLUGIN: ReferencePlugin = createReferencePlugin();
