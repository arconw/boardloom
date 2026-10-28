import { describe, expect, it } from "vitest";
import {
  DEFAULT_RENDERER_COLORS,
  buildKpiRendererSpec,
  buildTableRendererSpec,
  createIntlFormatterProvider,
  emptyRendererData,
  mountRenderer,
  type QueryResultField,
  type QueryResultRow,
  type RendererInput,
  type RendererSpec,
} from "../../../../packages/core/src/index.js";
import { BUILT_IN_RENDERERS } from "../../../../packages/view-dom/src/built-in-renderers.js";
import {
  createMiniDocument,
  findByAttribute,
  findByClass,
  type MiniElement,
} from "../support/mini-dom.js";

const formatters = createIntlFormatterProvider({ locale: "en", timezone: "UTC" });

function messages() {
  const values: Record<string, string> = {
    "chart.missing": "Not available",
    "a11y.tableRegion": "Data table",
    "table.missing.one": "{count} missing cell",
    "table.missing.other": "{count} missing cells",
  };
  return {
    locale: "en" as const,
    direction: "ltr" as const,
    has: (key: string) => Object.hasOwn(values, key),
    text: (key: string, params?: Record<string, string | number | boolean | bigint>) =>
      Object.entries(params ?? {}).reduce(
        (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
        values[key] ?? key,
      ),
    plural: (key: string, count: number) => {
      const category = count === 1 ? "one" : "other";
      return (values[`${key}.${category}`] ?? key).replaceAll("{count}", String(count));
    },
  };
}

const fields: readonly QueryResultField[] = [
  { fieldId: "category", type: "string", role: "dimension" },
  { fieldId: "value", type: "number", role: "measure", unit: { unit: "points" } },
];

function input(
  doc: ReturnType<typeof createMiniDocument>,
  spec: RendererSpec,
  rows: readonly QueryResultRow[],
): RendererInput<HTMLElement> {
  return {
    host: doc.createElement("div") as unknown as HTMLElement,
    spec,
    data: { ...emptyRendererData(), fields, rows, phase: "settled", empty: rows.length === 0 },
    theme: { mode: "light", colors: DEFAULT_RENDERER_COLORS.light },
    locale: "en",
    timezone: "UTC",
    direction: "ltr",
    formatters,
    messages: messages(),
  };
}

function mini(element: HTMLElement): MiniElement {
  return element as unknown as MiniElement;
}

function definition(kind: "kpi" | "table") {
  const found = BUILT_IN_RENDERERS.find((entry) => entry.kind === kind);
  if (!found) {
    throw new Error(`missing ${kind} renderer`);
  }
  return found;
}

describe("T07 built-in KPI and table renderers", () => {
  it("renders a KPI with unit, accessible label and missing state distinct from zero", () => {
    const doc = createMiniDocument();
    const built = buildKpiRendererSpec({
      id: "block-kpi",
      title: "Average",
      y: {
        fieldId: "value",
        label: "Average score",
        type: "number",
        role: "measure",
        unit: { unit: "points" },
      },
      aggregation: "average",
    });
    expect(built.ok).toBe(true);
    if (!built.ok) {
      return;
    }

    const zeroHost = doc.createElement("div") as unknown as HTMLElement;
    const zero = mountRenderer(definition("kpi"), {
      ...input(doc, built.value, [{ value: 0 }]),
      host: zeroHost,
    });
    expect(zero.handle).not.toBeNull();
    const zeroRoot = mini(zeroHost);
    expect(findByClass(zeroRoot, "bl-metric__value")[0]?.textContent).toContain("0");
    expect(findByClass(zeroRoot, "bl-numeric")[0]?.getAttribute("dir")).toBe("ltr");
    expect(findByClass(zeroRoot, "bl-metric")[0]?.getAttribute("aria-label")).toBe(
      "Average score: 0 points",
    );

    const missingHost = doc.createElement("div") as unknown as HTMLElement;
    const missing = mountRenderer(definition("kpi"), {
      ...input(doc, built.value, [{ value: null }]),
      host: missingHost,
    });
    expect(missing.handle).not.toBeNull();
    const missingRoot = mini(missingHost);
    expect(findByClass(missingRoot, "bl-metric")[0]?.getAttribute("data-state")).toBe("missing");
    expect(findByAttribute(missingRoot, "data-message-key", "chart.missing")).toHaveLength(1);
    expect(findByClass(missingRoot, "bl-metric")[0]?.getAttribute("aria-label")).toContain(
      "Not available",
    );
  });

  it("uses unique accessible caption IDs across table instances", () => {
    const doc = createMiniDocument();
    const built = buildTableRendererSpec({
      id: "table-one",
      title: "First table",
      columns: [
        { fieldId: "category", label: "Category", type: "string", role: "dimension" },
        { fieldId: "value", label: "Value", type: "number", role: "measure" },
      ],
    });
    expect(built.ok).toBe(true);
    if (!built.ok) {
      return;
    }
    const firstHost = doc.createElement("div") as unknown as HTMLElement;
    const secondHost = doc.createElement("div") as unknown as HTMLElement;
    mountRenderer(definition("table"), {
      ...input(doc, built.value, [{ category: "A", value: 1 }]),
      host: firstHost,
    });
    mountRenderer(definition("table"), {
      ...input(doc, built.value, [{ category: "B", value: 2 }]),
      host: secondHost,
    });
    const ids = [
      ...findByClass(mini(firstHost), "bl-table__caption"),
      ...findByClass(mini(secondHost), "bl-table__caption"),
    ].map((caption) => caption.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it("renders an accessible table with units, row headers and missing-cell disclosure", () => {
    const doc = createMiniDocument();
    const built = buildTableRendererSpec({
      id: "block-table",
      title: "Scores",
      columns: [
        { fieldId: "category", label: "Category", type: "string", role: "dimension" },
        {
          fieldId: "value",
          label: "Score",
          type: "number",
          role: "measure",
          unit: { unit: "points" },
        },
      ],
    });
    expect(built.ok).toBe(true);
    if (!built.ok) {
      return;
    }
    const host = doc.createElement("div") as unknown as HTMLElement;
    const mounted = mountRenderer(definition("table"), {
      ...input(doc, built.value, [
        { category: "A", value: 12 },
        { category: "B", value: null },
      ]),
      host,
    });
    expect(mounted.handle).not.toBeNull();
    const root = mini(host);
    const region = findByClass(root, "bl-table-region")[0];
    expect(region?.getAttribute("role")).toBe("region");
    expect(region?.getAttribute("tabindex")).toBe("0");
    expect(findByClass(root, "bl-table__caption")[0]?.textContent).toBe("Scores");
    expect(findByAttribute(root, "scope", "col")[1]?.textContent).toBe("Score (points)");
    expect(findByAttribute(root, "scope", "row")[0]?.textContent).toBe("A");
    expect(findByAttribute(root, "data-message-key", "chart.missing")).toHaveLength(1);
    expect(findByClass(root, "bl-table-missing")[0]?.textContent).toBe("1 missing cell");
  });
});
