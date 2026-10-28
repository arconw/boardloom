# Boardloom design system

Status: T05 reference specification. The token layer in `packages/view-dom/styles.css` is the executable source. The static mocks under `docs/design/references/` are design references, not production UI.

## 1. Direction

Boardloom presents analytical work as a studio, not a control panel. The viewer gives the board title, provenance and filter scope a compact header, keeps filters in one quiet strip, and leaves most of the visual field to charts and tables. The editor adds authoring tools at the edges: a block library on one side and a property inspector on the other, with the canvas still dominant.

The light theme uses warm paper neutrals. The dark theme uses deep ink with a green-blue cast. Petrol/teal is the primary accent for action, selection and live state. Amber is reserved for caution, focus and small emphasis. Chart series carry the strongest color, supported by pattern, marker and direct labels so color is never the only encoding.

Deliberate exclusions:

- No decorative gradients, glass effects or glow.
- No oversized KPI cards or repeated saturated panels.
- No shadow used where a border or tonal surface is sufficient.
- No forced product marketing inside an embedded Boardloom view.
- No global host-page reset, font override or document-direction change.

## 2. Scope and theming

### 2.1 Scoped root contract

The host mounts Boardloom into an element carrying the `boardloom` class. The theme value is `light`, `dark` or `system`:

```html
<div class="boardloom" data-boardloom-theme="system"></div>
```

The token stylesheet is wrapped in `@layer boardloom`. Host CSS that is not in a cascade layer overrides the defaults, so a host can restyle a single instance by setting tokens on the scoped root or on a nested theme wrapper.

Multiple instances may use different themes at the same time. Styles and tokens are never declared on `:root`, `html` or `body`. The host document's direction is never changed; Arabic RTL is applied only to the scoped Boardloom root.

### 2.2 Theme precedence

1. Explicit `data-boardloom-theme="light"` or `"dark"` sets `color-scheme` for that instance.
2. `data-boardloom-theme="system"` follows the operating-system preference through `color-scheme: light dark`.
3. With no theme attribute, light is the deterministic default.
4. Host token overrides on the scoped root win over the layered defaults.
5. The persisted board document stores `theme.mode` and the optional validated `theme.tokens` overrides accepted by the board schema. Runtime `light`, `dark` and `system` selection applies that document theme inside the scoped root. Host CSS token overrides remain presentation-only and are not silently written into the document. Unknown or invalid document tokens are rejected by validation rather than treated as a different theme.

### 2.3 Token implementation

The token layer pairs `light-dark()` color values with `color-scheme`. This keeps semantic tokens single-source, allows multiple instances to use different themes and follows the current stable browser baseline. A host that intentionally supports an older engine supplies explicit token overrides instead of assuming compatibility.

The reduced-motion media query collapses duration tokens and overrides scoped animation and transition timing. Components must use the duration tokens and must not add their own unguarded animation.

## 3. Color tokens

### 3.1 Semantic roles

| Token                           | Role                                              | Light     | Dark      |
| ------------------------------- | ------------------------------------------------- | --------- | --------- |
| `--bl-color-canvas`             | Application background behind surfaces            | `#f4f0e8` | `#111816` |
| `--bl-color-canvas-deep`        | Document page / recessed frame                    | `#ebe5da` | `#0b100f` |
| `--bl-color-surface`            | Default panel and block surface                   | `#fffdf8` | `#18211f` |
| `--bl-color-surface-raised`     | Popover, dialog, selected panel                   | `#ffffff` | `#1f2a27` |
| `--bl-color-surface-sunken`     | Inset well, table header, disabled region         | `#ece7dc` | `#0d1312` |
| `--bl-color-surface-overlay`    | Drawer and modal surface                          | `#fffdf8` | `#202b28` |
| `--bl-color-field`              | Editable field background                         | `#fffdf8` | `#141d1b` |
| `--bl-color-field-disabled`     | Read-only or disabled field                       | `#f0ece3` | `#1a2421` |
| `--bl-color-text`               | Primary text                                      | `#1c2422` | `#edf2ee` |
| `--bl-color-text-muted`         | Secondary labels and metadata                     | `#59645f` | `#a5b2ad` |
| `--bl-color-text-faint`         | Tertiary annotations, still AA for body text      | `#65706b` | `#8a9994` |
| `--bl-color-text-inverse`       | Text on a dark or inverse block                   | `#f7f4ee` | `#111816` |
| `--bl-color-text-on-accent`     | Text on accent fills                              | `#ffffff` | `#0d1715` |
| `--bl-color-border-subtle`      | Decorative divider only                           | `#ded8cc` | `#2d3a36` |
| `--bl-color-border`             | Decorative outline and grid boundary              | `#b9b1a3` | `#4b5b56` |
| `--bl-color-border-strong`      | Required control boundary and focus-adjacent edge | `#8a8174` | `#6f7e79` |
| `--bl-color-accent`             | Primary action, link, active selection            | `#0d6964` | `#5fd0c4` |
| `--bl-color-accent-hover`       | Hover state for accent                            | `#0a5753` | `#7bdcd2` |
| `--bl-color-accent-active`      | Pressed state for accent                          | `#08443f` | `#96e7de` |
| `--bl-color-accent-soft`        | Selected row or accent-tinted surface             | `#dcefeb` | `#173d38` |
| `--bl-color-accent-soft-text`   | Text on accent-soft                               | `#0a5753` | `#9ee8df` |
| `--bl-color-focus`              | Focus ring and keyboard emphasis                  | `#8a4b00` | `#f4c15e` |
| `--bl-color-selection`          | Text selection and chart selection band           | `#d7ece8` | `#234842` |
| `--bl-color-selection-text`     | Text on selection                                 | `#1c2422` | `#edf2ee` |
| `--bl-color-backdrop`           | Dialog and drawer scrim                           | 48% ink   | 62% ink   |
| `--bl-color-success`            | Positive status text and icon                     | `#1d6a44` | `#8fdfac` |
| `--bl-color-success-surface`    | Positive status surface                           | `#e6f3eb` | `#163327` |
| `--bl-color-warning`            | Warning text and icon                             | `#7a4b00` | `#f0c06a` |
| `--bl-color-warning-surface`    | Warning surface                                   | `#fff3d9` | `#3a2a10` |
| `--bl-color-danger`             | Error and destructive action                      | `#9f2b2b` | `#f3a19a` |
| `--bl-color-danger-surface`     | Error surface                                     | `#fbeceb` | `#3b1d1d` |
| `--bl-color-info`               | Informational status                              | `#23578f` | `#9ec5ff` |
| `--bl-color-info-surface`       | Informational surface                             | `#e8f0fa` | `#172b45` |
| `--bl-color-skeleton`           | Loading placeholder base                          | `#e5dfd3` | `#24302c` |
| `--bl-color-skeleton-highlight` | Loading placeholder highlight                     | `#f3eee5` | `#2f3d38` |

### 3.2 Contrast evidence

Ratios are calculated with the WCAG 2.2 relative-luminance formula and rounded to two decimals. Text pairs target at least 4.5:1; essential non-text boundaries and focus indicators target at least 3:1.

| Pair                            | Light ratio | Dark ratio | Requirement |
| ------------------------------- | ----------- | ---------- | ----------- |
| Text on canvas                  | 13.95:1     | 15.90:1    | 4.5:1       |
| Text on surface                 | 15.59:1     | 14.53:1    | 4.5:1       |
| Muted text on surface           | 6.05:1      | 7.50:1     | 4.5:1       |
| Faint text on surface           | 5.06:1      | 5.54:1     | 4.5:1       |
| Accent on surface               | 6.41:1      | 8.86:1     | 4.5:1       |
| On-accent text                  | 6.52:1      | 9.83:1     | 4.5:1       |
| Accent-soft text on accent-soft | 7.03:1      | 8.55:1     | 4.5:1       |
| Selection text on selection     | 12.87:1     | 8.92:1     | 4.5:1       |
| Focus on canvas                 | 5.98:1      | 10.84:1    | 3:1         |
| Strong border on surface        | 3.77:1      | 3.87:1     | 3:1         |
| Success on success surface      | 5.75:1      | 8.67:1     | 4.5:1       |
| Warning on warning surface      | 6.73:1      | 8.20:1     | 4.5:1       |
| Danger on danger surface        | 6.41:1      | 7.52:1     | 4.5:1       |
| Info on info surface            | 6.45:1      | 8.10:1     | 4.5:1       |

`--bl-color-border-subtle` and `--bl-color-border` are decorative. They are not used as the only boundary of an interactive control. Editable fields, checkboxes, switches, segmented controls and focus rings use `--bl-color-border-strong` or `--bl-color-focus`.

## 4. Chart palette

### 4.1 Series colors

| Token                 | Light     | Dark      | Non-color encoding          |
| --------------------- | --------- | --------- | --------------------------- |
| `--bl-chart-series-1` | `#0f6b66` | `#5fd0c4` | Solid 2 px, direct label    |
| `--bl-chart-series-2` | `#2f5fa8` | `#7aa7ef` | Solid 2 px, circular marker |
| `--bl-chart-series-3` | `#9a5b00` | `#e7b45f` | Dashed 6 4                  |
| `--bl-chart-series-4` | `#a13d5c` | `#ef8aa5` | Dotted 2 3                  |
| `--bl-chart-series-5` | `#6547a3` | `#b9a1f2` | Long dash 10 4              |
| `--bl-chart-series-6` | `#3f6b2a` | `#8bcf73` | Dash-dot 8 3 2 3            |
| `--bl-chart-series-7` | `#7a4a2a` | `#d9a37a` | Solid 3 px, square marker   |
| `--bl-chart-series-8` | `#3f5a63` | `#9fc4cc` | Dashed 2 6                  |

Every series color is at least 3:1 against its default surface: 5.34:1 to 7.27:1 in light and 6.74:1 to 8.86:1 in dark. Chart legends repeat the series name, pattern swatch and marker; the data table provides the same values in text.

### 4.2 Chart support tokens

| Token                     | Purpose                                                     |
| ------------------------- | ----------------------------------------------------------- |
| `--bl-chart-grid`         | Non-essential grid lines; never the only carrier of a value |
| `--bl-chart-axis`         | Axis baseline and tick marks                                |
| `--bl-chart-threshold`    | Target or threshold rule; paired with a text label          |
| `--bl-chart-reference`    | Comparison reference line; always dashed and labeled        |
| `--bl-chart-selection`    | Selected series or cross-filter band                        |
| `--bl-chart-null`         | Null or unavailable mark; always paired with text           |
| `--bl-chart-band`         | Confidence or range band fill                               |
| `--bl-chart-fill-opacity` | Area fill opacity, default `0.14`                           |

The palette is checked for hue and luminance separation, not only hue. Where a chart uses more than four series, the legend and data alternative become the primary identification; series pattern and direct labels are required. Status and selection never rely on color alone: every state has an icon or shape and a text label.

## 5. Typography

### 5.1 Families

| Token               | Stack                                                                                         | Use                                        |
| ------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `--bl-font-sans`    | Aptos, Segoe UI, Noto Sans and script-specific Noto families, system-ui, sans-serif           | UI, labels, tables, controls               |
| `--bl-font-display` | Iowan Old Style, Palatino, Noto Serif and script-specific Noto serif families, Georgia, serif | Board titles and the largest headings only |
| `--bl-font-mono`    | SFMono-Regular, Cascadia Code, Roboto Mono, Noto Sans Mono, ui-monospace                      | Diagnostic paths, keys and code            |

No remote font request is required. The stacks include Arabic, Devanagari and CJK fallbacks. If a platform lacks a named family, the next family in the stack is used. The system fallback is always present. Numeric table and chart values use tabular figures through `--bl-font-variant-numeric`.

### 5.2 Scale

| Token                | Size               | Line height | Typical use                               |
| -------------------- | ------------------ | ----------- | ----------------------------------------- |
| `--bl-font-size-xs`  | 0.75 rem / 12 px   | 1.5         | Chips, annotation, table meta             |
| `--bl-font-size-sm`  | 0.8125 rem / 13 px | 1.5         | Dense controls and table cells            |
| `--bl-font-size-md`  | 0.875 rem / 14 px  | 1.5         | Default body and control text             |
| `--bl-font-size-lg`  | 1 rem / 16 px      | 1.5         | Emphasized body and form section titles   |
| `--bl-font-size-xl`  | 1.125 rem / 18 px  | 1.3         | Block title                               |
| `--bl-font-size-2xl` | 1.375 rem / 22 px  | 1.3         | Board title on narrow screens             |
| `--bl-font-size-3xl` | 1.75 rem / 28 px   | 1.15        | Board title on desktop                    |
| `--bl-font-size-4xl` | 2.25 rem / 36 px   | 1.15        | Reference cover and documentation display |

Weights are `400`, `500`, `600` and `700`. Board titles use the display family at weight 600 with tight tracking. Overline labels use sans at weight 600, uppercase only for Latin-friendly short labels, with `--bl-letter-spacing-caps`; localized labels are never uppercased by CSS. Body copy never uses letter spacing below zero.

Line heights are `1.15`, `1.3`, `1.5` and `1.6` through `--bl-line-height-*`. CJK and Arabic copy keeps at least 1.5 for body text. Text is never smaller than 12 CSS px in the reference compositions.

## 6. Spacing, radii and elevation

### 6.1 Spacing

The scale is a 4 px rhythm: `0`, `4`, `8`, `12`, `16`, `20`, `24`, `28`, `32`, `40`, `48`, `56`, `64`, `80`, `96` px, exposed as `--bl-space-0` through `--bl-space-24`.

| Token           | px  | Common use                   |
| --------------- | --- | ---------------------------- |
| `--bl-space-1`  | 4   | Icon gap, chip inset         |
| `--bl-space-2`  | 8   | Compact control gap          |
| `--bl-space-3`  | 12  | Field inner spacing          |
| `--bl-space-4`  | 16  | Default component gap        |
| `--bl-space-5`  | 20  | Panel padding on narrow      |
| `--bl-space-6`  | 24  | Panel padding, page gutter   |
| `--bl-space-8`  | 32  | Section separation           |
| `--bl-space-10` | 40  | Canvas breathing room        |
| `--bl-space-12` | 48  | Major composition separation |
| `--bl-space-16` | 64  | Reference cover spacing      |

### 6.2 Radii

| Token              | Value   | Use                               |
| ------------------ | ------- | --------------------------------- |
| `--bl-radius-none` | 0       | Table cells and flush split panes |
| `--bl-radius-xs`   | 2 px    | Checkbox, tiny swatch             |
| `--bl-radius-sm`   | 4 px    | Inputs, buttons, chips            |
| `--bl-radius-md`   | 6 px    | Panels and blocks                 |
| `--bl-radius-lg`   | 8 px    | Drawers, popovers                 |
| `--bl-radius-xl`   | 12 px   | Reference artboard only           |
| `--bl-radius-full` | 9999 px | Status pills and avatars          |

### 6.3 Elevation

| Token              | Use                                                            |
| ------------------ | -------------------------------------------------------------- |
| `--bl-elevation-0` | Flat canvas, panel and table                                   |
| `--bl-elevation-1` | Sticky toolbar or selected block when a border is insufficient |
| `--bl-elevation-2` | Popover, menu, inspector drawer on narrow                      |
| `--bl-elevation-3` | Modal dialog                                                   |

Elevation is never used to compensate for weak layout. Blocks use a border on a tonal canvas. The dark theme keeps shadows subtle so surfaces remain distinguishable without glow. The elevation tokens are complete shadow geometries whose color component is theme-dependent; they are valid `box-shadow` values rather than `light-dark()` wrappers around whole shadow lists.

## 7. Motion and focus

| Token                          | Value                          | Use                        |
| ------------------------------ | ------------------------------ | -------------------------- |
| `--bl-motion-duration-instant` | 0 ms                           | Immediate state swap       |
| `--bl-motion-duration-fast`    | 100 ms                         | Hover and press feedback   |
| `--bl-motion-duration-base`    | 160 ms                         | Drawer slide, popover fade |
| `--bl-motion-duration-slow`    | 240 ms                         | Inspector reveal           |
| `--bl-motion-duration-slower`  | 320 ms                         | Dialog entrance            |
| `--bl-motion-ease-standard`    | cubic-bezier(0.2, 0.8, 0.2, 1) | Default                    |
| `--bl-motion-ease-enter`       | cubic-bezier(0, 0.7, 0.2, 1)   | Entering overlay           |
| `--bl-motion-ease-exit`        | cubic-bezier(0.4, 0, 1, 1)     | Leaving overlay            |

Motion conveys spatial relationship only: a drawer enters from its logical edge, a popover appears near its trigger, and a selected block gains a visible outline. Chart animation is optional and limited to an initial transition of at most 300 ms. Reduced motion collapses every duration token and removes animation and smooth scrolling inside the Boardloom root. A host or user can stop chart animation; the final data state is shown immediately.

Focus tokens are `--bl-focus-width: 2px`, `--bl-focus-offset: 2px`, `--bl-focus-radius: 4px` and `--bl-color-focus`. The focus ring is never removed. It uses a minimum 3:1 contrast against the adjacent canvas or surface and is not obscured by sticky headers, drawers or chart overlays.

## 8. Sizing and layout

| Token                     | Value   | Use                                 |
| ------------------------- | ------- | ----------------------------------- |
| `--bl-control-height-sm`  | 28 px   | Dense table toolbar                 |
| `--bl-control-height-md`  | 36 px   | Default button and field            |
| `--bl-control-height-lg`  | 40 px   | Narrow-screen primary action        |
| `--bl-target-min`         | 24 px   | Minimum interactive target          |
| `--bl-icon-sm`            | 16 px   | Inline icon                         |
| `--bl-icon-md`            | 20 px   | Toolbar icon                        |
| `--bl-icon-lg`            | 24 px   | Drawer close and primary navigation |
| `--bl-layout-content-max` | 1600 px | Wide viewer canvas                  |
| `--bl-layout-gutter`      | 24 px   | Page gutter above narrow            |
| `--bl-layout-grid-gap`    | 16 px   | Board grid gap                      |
| `--bl-layout-block-gap`   | 20 px   | Vertical block rhythm               |

Breakpoints are literal media or container thresholds because CSS custom properties cannot be used in media queries:

| Range   | Width             | Columns | Behavior                                                         |
| ------- | ----------------- | ------- | ---------------------------------------------------------------- |
| Desktop | 1280 px and above | 12      | Inspector docked, filter strip inline                            |
| Tablet  | 768 to 1279 px    | 8       | Inspector can dock or become a side sheet                        |
| Narrow  | below 768 px      | 4       | Filters, library and inspector become drawers or stacked regions |
| Minimum | 320 px            | 4       | Single-column blocks, no page-level horizontal overflow          |

At 320 px the page gutter is 16 px, block padding 16 px, and the board header wraps into identity, mode and action rows. Charts reflow to the available width and expose their data table instead of requiring horizontal chart scrolling. Tables may scroll inside their own container, with a visible scroll affordance and keyboard access; the page itself must not scroll horizontally.

At 200 percent zoom a 1440 px desktop viewport becomes 720 CSS px, and a 1280 px viewport becomes 640 CSS px. Both are below the 768 px narrow threshold, so both use the narrow composition: filters become a summary and drawer, blocks stack, and the library and inspector become bottom or side drawers rather than a docked inspector. No function is removed at either width.

## 9. Components

### 9.1 Buttons and icon buttons

- Primary: accent fill, on-accent text, radius-sm, height 36 px, horizontal padding 16 px.
- Secondary: surface fill, strong border, text color.
- Ghost: transparent fill, text color, visible hover surface.
- Destructive: danger text on surface for a reversible action; danger fill only for a confirmed destructive dialog action.
- Icon button: at least 24 by 24 px target, 16 to 20 px icon, accessible name, visible focus. The icon is never the only label for an unfamiliar action; a tooltip and accessible description are provided.
- Disabled: reduced contrast is allowed only for inactive content, with an accessible reason. Disabled controls are removed from the tab order; if the reason matters, use read-only instead and keep it focusable.

### 9.2 Fields, selects and comboboxes

Editable fields use the field surface, a strong border and a 36 px default height. Labels sit above the field and are always present, not placeholder-only. Help text and error text are connected with `aria-describedby`. Errors use a danger icon, text and border, not only a red border. Read-only fields use the disabled surface but retain readable text and remain focusable when their value must be copied.

Comboboxes and menus follow the ARIA combobox or menu pattern, support arrow keys, Home/End, type-ahead where useful, Escape to dismiss and focus return to the trigger. Multi-select values render as chips with a visible remove action and an accessible name.

### 9.3 Checkboxes, switches and segmented controls

Checkboxes use a square control with a check mark, not color alone. Switches are reserved for immediately applied binary settings; a draft setting uses a checkbox or segmented control. Segmented controls use a visible selected state with text, an inset border and `aria-pressed` or a radio-group pattern. Selected state is never conveyed only by accent fill.

### 9.4 Tabs, popovers, dialogs and drawers

Tabs use `tablist`, `tab` and `tabpanel` relationships with roving focus and arrow-key navigation. The static reference mocks show the visual selected state with ordinary pressed buttons rather than claiming incomplete tab semantics; the real implementation must supply the full relationship. Popovers are anchored to their trigger, close on Escape and return focus. Dialogs are modal only when the task requires blocking; they trap focus, label the dialog, close on Escape and return focus to the invoking control. Drawers follow the same focus contract for the keyboard. On narrow screens the inspector drawer is non-modal when it can remain open beside the chart, and modal when it covers the canvas.

### 9.5 Tables

Tables use a real table element or a complete ARIA grid only when virtualization requires it. Header cells are associated with columns; row selection uses a checkbox with an accessible row name. Sorting state is announced and shown with an icon plus text. Numeric cells align to the inline end with tabular figures. Missing values show an explicit dash with an accessible "not available" label, never a fabricated zero. A virtualized table retains focus, announces row position and exposes a data alternative.

### 9.6 Chips, badges and filter origin

Chips use a compact surface, a strong border and a 24 px minimum height. A removable chip contains a visible label and an icon button with a name such as "Remove filter: Term". Filter origin is written as scope plus source: "Board", "Group: Middle school" or "Block: Algebra". Origin chips are not color-coded by scope alone; the scope word is visible. A chip that is inherited or not removable has a read-only treatment and an explanation.

Badges combine text, an icon or shape and a semantic surface. Loading, empty, stale, partial, error and plugin failure have distinct words. Live status uses a dot plus the word "Live" or "Reconnecting"; the dot is not the only signal.

### 9.7 Toolbars

The viewer toolbar holds mode, board actions and a calm overflow menu. The editor toolbar holds draft state, undo/redo, apply and cancel. Toolbars wrap at narrow widths; primary actions stay reachable without horizontal scrolling. Toolbars never hide the board title.

## 10. Viewer composition

### 10.1 Desktop

The viewer is a single column with three zones:

1. **Board header.** A compact overline identifies the host and provenance. The board title uses the display family. A metadata line names the synthetic fixture, update time, display timezone and realtime or historical status. The mode segmented control sits at the inline end with calm secondary actions.
2. **Filter strip.** One row of active filter chips with origin scope. Each chip has a visible label and a remove action where permitted. A "Filters" button opens the full filter panel, a reset action restores declared defaults and a count is announced. The strip wraps rather than scrolls horizontally.
3. **Canvas.** A 12-column grid with a compact metric strip, primary chart, secondary chart or table, and an insight or comparison panel. Blocks have a visible title, unit, scope line, and actions on hover or focus. The canvas has generous negative space; there is no outer card around the whole board.

The desktop viewer does not use a permanent right rail. Diagnostics and data warnings appear as a compact status row above the canvas, with a link to the diagnostics panel. A selected block gets a visible outline and a focus-within treatment, not a heavy shadow.

### 10.2 Narrow

Below 768 px the header becomes three rows if needed: identity, title and status; then mode and actions. The filter strip becomes a "Filters (3)" button with a summary of the active scope. The filter panel opens as a full-height sheet from the inline end or bottom, closes on Escape and returns focus to the filter button.

Blocks stack in one column. The metric strip becomes a two-column grid at 390 px and a single column at 320 px. Chart height reduces but axes, legend and data table access remain. The chart's data table is available from a "View data table" disclosure rather than requiring horizontal chart panning. Tables scroll inside their own region with sticky headers where useful. No page-level horizontal overflow is permitted.

### 10.3 Theme parity

Light and dark share the same hierarchy, spacing and state placement. Dark surfaces are not simply inverted: text, borders, status surfaces and chart series are retuned for equivalent contrast. Selection and focus remain visible on both themes. The mocks show the same board composition in both themes so parity can be compared directly.

## 11. Editor composition

### 11.1 Desktop

The editor uses three regions:

1. **Block library.** A left rail with search, categories for chart, metric, table, text and filter blocks, and short descriptions. Items are buttons with a visible add action; dragging is an enhancement, not the only path.
2. **Canvas.** The same analytical canvas as the viewer, with a compact editor toolbar above it. The selected block has a visible outline, a drag handle and a resize handle. A keyboard move/resize control bar is available whenever a block is selected. Grid guides appear only while a layout operation is active.
3. **Inspector.** A right panel with tabs for properties, layout and data. It shows the selected block name, binding roles, aggregation, formatting, units, fixed/selectable mode, filters, comparison and reset. Changes belong to the draft; the inspector shows whether the draft is dirty.

The draft bar is persistent: "Unsaved changes" with Apply and Discard. Apply is primary; Discard is secondary and opens a confirmation if more than one change is pending. Undo and redo are in the editor toolbar with keyboard shortcuts. The canvas never shrinks below a workable width on desktop; the inspector can collapse to a rail.

Filter manager and comparison builder open from the inspector or the canvas toolbar. They are panels, not separate pages. A filter scope change shows affected blocks and rejects invalid targets atomically. A comparison panel shows primary and reference sources, field mapping, alignment, unit policy and delta mode, and marks unavailable deltas explicitly.

### 11.2 Narrow

At narrow widths the library and inspector become a bottom drawer with two tabs: Blocks and Inspect. The canvas remains primary and vertically scrollable. Selecting a block opens Inspect; adding a block opens Blocks. The drawer can be dismissed to return to the canvas without losing focus context. When the drawer is non-modal, the draft status and Apply/Discard stay in the visible draft bar. When the inspector is modal at 320 px, the inert background is not operable and the same draft status and Apply/Discard move into a sticky footer inside the sheet, so the actions remain reachable and Escape still returns focus to the Inspect trigger. The layout keyboard controls use large, labeled buttons, not only drag gestures.

The 320 px editor keeps the board identity and mode control visible. It does not show a permanent side rail. The block library is a full-width drawer, and the inspector fields are single-column. Apply and Discard remain reachable with a thumb and by keyboard.

### 11.3 Draft and selection semantics

The editor always shows a draft status. A clean draft says "No unsaved changes"; a dirty draft says "Unsaved changes". Apply validates against the current revision and reports a revision conflict without overwriting newer committed work. Discard asks for confirmation when the draft is non-empty. Switching to viewer preserves the draft and shows the committed document. Focus returns to the previously focused control after apply, cancel or panel close wherever the control still exists.

## 12. State direction

Every state is communicated with words, shape or icon, and color. The state gallery shows the following compositions:

| State              | Direction                                                                                                   |
| ------------------ | ----------------------------------------------------------------------------------------------------------- |
| Loading            | Calm skeleton with a visible loading label, no fake values, polite live announcement                        |
| Empty              | Explicit "No data for this scope", filter summary, reset action and no fabricated axes or zeros             |
| Error              | Block-level error with a stable diagnostic code, path, retry and recovery; other blocks remain usable       |
| Stale              | Last valid data remains visible with a clear "Data may be out of date" marker and refresh action            |
| Partial            | Result completeness statement, returned and total counts, affected scope and a warnings link                |
| Diagnostics        | Panel grouped by severity with path, code, affected block and actions; no raw payloads or secrets           |
| Filter origin      | Board, group and block scope shown in words, removable where permitted and announced on removal             |
| Comparison         | Primary and reference labels, mapping, absolute and percentage delta; unavailable reasons never become zero |
| Realtime reconnect | Status strip with attempt, resync state, pause/resume and visible stale data policy                         |
| Plugin error       | Contained to the block, plugin identity, error code, disable/remove action, sibling blocks unaffected       |

## 13. Copy, localization and RTL direction

All product copy comes from stable message keys. The reference mocks annotate framework-owned controls, status, filter labels and origins, table column headers, chart affordances and ARIA names with `data-message-key` attributes and a key map. Keys follow the existing core namespaces (`common.`, `mode.`, `draft.`, `status.`, `a11y.`, `diagnostic.`) and add viewer, editor, chart, state and table namespaces. No new UI may hard-code an English string outside the message dictionaries.

Annotation scope is explicit. Host-supplied board titles, block titles, dataset and series labels, narrative copy and table cell values carry `data-host-content`; documentation commentary is excluded by the page's reference kind. The design test fails when a product reference leaves a button, input, select, label, disclosure summary or column header without a key. This keeps the mock review useful without pretending that synthetic fixture prose is framework copy.

Localized copy can expand by 30 to 50 percent. Layouts use logical properties, flexible wrapping and a 12/8/4 grid rather than fixed English widths. Arabic sets `dir="rtl"` only on the scoped Boardloom root. Focus order follows DOM order, icons mirror only when direction-bearing, numeric chart axes keep correct data direction, and data formatting follows the selected locale rather than the UI direction. See `LOCALIZATION.md`.

## 14. Implementation boundaries

T05 delivers the design basis and the scoped token layer. T06 and later tasks implement the real DOM runtime, components and charts. The mocks are static, deliberately labeled references. They may not be copied into public README/docs as product screenshots, and they cannot satisfy a UI acceptance check that requires the real viewer or editor.
