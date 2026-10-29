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

const REFERENCE_MESSAGES = Object.freeze({
  "editor.library.plugin.reference-tile.name": "Reference tile",
  "plugin.reference.title": "Reference tile",
  "plugin.reference.caption": "Values rendered by the reference plugin renderer.",
  "plugin.reference.invalidValues": "Plugin values must be an array of finite numbers.",
  "plugin.reference.unsupported": "The reference plugin renderer is not registered.",
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
        label: "Value",
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
        const built = referenceData(values, title);
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
    messageDictionaries: Object.freeze([
      Object.freeze({
        id: "reference.messages.en",
        version: "1.0.0",
        apiVersion: EXTENSION_API_VERSION,
        locale: "en" as const,
        dictionary: REFERENCE_MESSAGES,
      }),
    ]),
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
