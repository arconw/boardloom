import {
  formatValueParts,
  type FormatterProvider,
  type JsonValue,
  type QueryResultField,
  type RendererField,
  type RendererMessages,
} from "@boardloom/core";

export function formatFieldValue(
  value: JsonValue,
  field: QueryResultField,
  formatters: FormatterProvider,
  messages?: RendererMessages,
): string | null {
  return formatValueParts(
    value,
    {
      type: field.type,
      ...(field.unit === undefined ? {} : { unit: field.unit }),
      ...(field.timezone === undefined ? {} : { timezone: field.timezone }),
      ...(field.temporalRepresentation === undefined
        ? {}
        : { temporalRepresentation: field.temporalRepresentation }),
    },
    formatters,
    messages,
  ).text;
}

export function formatRendererFieldValue(
  value: JsonValue,
  field: QueryResultField,
  specField: RendererField | undefined,
  formatters: FormatterProvider,
  messages?: RendererMessages,
): string | null {
  if (specField === undefined) {
    return formatFieldValue(value, field, formatters, messages);
  }
  return formatValueParts(value, specField, formatters, messages).text;
}
