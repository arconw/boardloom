# Boardloom design references

Status: T05 design package, proposed for independent design review. These are reference mocks and specifications, not a production viewer or editor. No live Boardloom UI is claimed here.

This directory is the agreed documentation location for the design basis used by the viewer, editor, states and localization work that follows. The executable token source is `packages/view-dom/styles.css`; the documents and static mocks here explain and exercise that source.

## What is included

| Path                             | Purpose                                                                                                            |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `DESIGN_SYSTEM.md`               | Token specification, themes, components, viewer/editor composition and state direction                             |
| `ACCESSIBILITY.md`               | Keyboard and focus specification, landmarks, live regions, contrast, reflow, reduced motion and chart alternatives |
| `LOCALIZATION.md`                | Stable message-key rules, locale expansion, Arabic RTL and scoped direction annotations                            |
| `VISUAL_ACCEPTANCE.md`           | Acceptance checklist, measurement method and traceability to requirements and later UI tasks                       |
| `message-keys.json`              | Machine-readable catalog of copy keys used by the references and required from the first UI implementation         |
| `references/index.html`          | Index of static reference compositions                                                                             |
| `references/viewer-desktop.html` | Viewer composition at desktop width in light and dark themes                                                       |
| `references/viewer-narrow.html`  | Viewer at 320, 390 and tablet widths, including filter drawer behavior                                             |
| `references/editor-desktop.html` | Editor with block library, canvas and property inspector in light and dark themes                                  |
| `references/editor-narrow.html`  | Editor with bottom drawer, block library and inspector behavior at narrow widths                                   |
| `references/states.html`         | Required state gallery, including diagnostics, filter origin, comparison, reconnect and plugin failure             |
| `references/boards.html`         | Assessment, commercial and operational boards sharing one visual language                                          |
| `references/localization.html`   | Locale expansion, long copy, CJK samples and scoped Arabic RTL                                                     |
| `references/accessibility.html`  | Annotated focus order, landmarks, live regions and keyboard alternatives                                           |
| `references/reference.css`       | Reference-only presentation styles; never shipped as production UI                                                 |

## Visual direction

Boardloom is an analytical studio rather than a generic dashboard. The composition gives a compact board identity and mode toolbar, an unobtrusive filter strip and a spacious canvas the visual priority. The editor adds a block library and a precise property inspector while preserving the canvas rather than turning it into a settings page.

The character is warm and editorial in light mode and deep and quiet in dark mode. A petrol/teal accent marks primary action, selection and live state. Amber is restrained emphasis and focus. Vivid color is reserved for data series, selection and status. Surfaces use typography, spacing, alignment and borders for hierarchy; gradients, repeated saturated panels, oversized empty metric cards and indiscriminate shadows are deliberately absent.

Boardloom branding appears in these documentation references and later belongs in the demo. The framework shell itself must accept host identity and must not impose marketing chrome.

## How to review the mocks

1. Open `references/index.html` in a current stable browser from the repository checkout.
2. Use the reference navigation to open each composition.
3. Each page carries a visible "Design reference - not production UI" label and identifies its theme, width and synthetic fixture.
4. The mocks are static HTML and CSS. Buttons and fields illustrate composition, states and accessibility; they are not wired to a runtime.
5. Reference pages import the packaged token stylesheet through `reference.css`. The token layer is real design-system work; the surrounding component styles are reference-only.
6. The required design walkthrough video is recorded by the independent reviewer. It must show viewer, editor, states and narrow layouts, identify the mocks as references and must not present them as live UI.

The fixtures are deterministic synthetic examples with visible provenance. They do not contain real schools, companies, people, credentials, backend calls or private data.

Framework controls, status, filter labels and origins, table column headers, chart affordances and ARIA names carry a `data-message-key` annotation, including the localized Arabic samples. Host fixture titles, block titles, series labels and table values carry `data-host-content`; the accessibility page and this index are marked as documentation/annotation pages. The design test enforces the framework-control portion of that distinction.

## Theme and scope contract

- The scoped root is `.boardloom` with a `data-boardloom-theme` value of `light`, `dark` or `system`.
- Tokens use the `--bl-` prefix and are declared inside the `boardloom` cascade layer.
- Tokens cover color, typography, spacing, radii, elevation, motion, focus, control sizing, layout and chart palette.
- Host overrides are applied to the scoped root or a descendant theme wrapper. Unlayered host CSS wins over the layered defaults.
- Theme and style declarations are scoped to Boardloom. There is no host-page reset, font replacement, body direction change or global marketing chrome.
- The current token stylesheet uses `light-dark()` together with `color-scheme`, supported by the current stable browser baseline. Explicit light and dark modes override system preference. If a host intentionally supports an older engine, it supplies explicit token overrides rather than assuming this package's compatibility.

## Review and approval

`VISUAL_ACCEPTANCE.md` is the checklist later screenshots and video must satisfy. Approval of this design package means the direction, tokens, compositions, states, accessibility annotations, message-key approach and acceptance criteria are accepted as the basis for T06 and later UI work. It does not mean any production UI exists or that T06 has passed.

Known limitations are recorded in the acceptance document and the implementer handoff. Product screenshots in public documentation must later come from the real Boardloom UI, not from these reference mocks.
