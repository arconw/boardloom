const COLOR_TOKENS = new Set([
  "canvas",
  "canvas-deep",
  "surface",
  "surface-raised",
  "surface-sunken",
  "surface-overlay",
  "field",
  "field-disabled",
  "text",
  "text-muted",
  "text-faint",
  "text-inverse",
  "text-on-accent",
  "border-subtle",
  "border",
  "border-strong",
  "accent",
  "accent-hover",
  "accent-active",
  "accent-soft",
  "accent-soft-text",
  "focus",
  "selection",
  "selection-text",
  "backdrop",
  "success",
  "success-surface",
  "warning",
  "warning-surface",
  "danger",
  "danger-surface",
  "info",
  "info-surface",
  "skeleton",
  "skeleton-highlight",
]);

export function themeTokenProperty(name: string): string {
  if (name.startsWith("--")) {
    return name;
  }
  if (name.startsWith("bl-")) {
    return `--${name}`;
  }
  if (COLOR_TOKENS.has(name)) {
    return `--bl-color-${name}`;
  }
  return `--bl-${name}`;
}
