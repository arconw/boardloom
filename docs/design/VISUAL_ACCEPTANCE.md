# Boardloom visual acceptance checklist

Status: T05 reference acceptance criteria, proposed for independent review. No production viewer or editor is claimed. Later UI screenshots and video must satisfy this checklist against the real built Boardloom artifact.

## 1. How to use this checklist

- T05 approval applies to the reference direction, tokens, compositions, states, accessibility annotations, message-key approach and the criteria in this document.
- T06, T12, T17, T18 and T20 use the same checklist against real UI. A passing T05 does not pass those tasks.
- Each item names the evidence that satisfies it at design time and the real-UI check that later replaces or confirms it.
- A deviation is acceptable only when it is recorded with the affected item, rationale and approval. A mock is never accepted as proof that a production UI exists.

## 2. Design reference integrity

| ID    | Requirement                                                                                    | T05 evidence                                                 | Later UI check                                                                         |
| ----- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| VA-01 | Every reference composition is visibly labeled as a design reference and not production UI.    | Banner on each page under `docs/design/references/`          | Real UI screenshots carry the real build identity and are never mixed with mock assets |
| VA-02 | Reference data is deterministic, synthetic and provenance-labelled.                            | Fixture lines in viewer, editor and board mocks              | Demo and screenshots use synthetic fixtures with visible provenance                    |
| VA-03 | The reference mocks do not use a screenshot image as a substitute for live controls or charts. | HTML/SVG compositions with semantic controls and data tables | Real UI is interactive and keyboard operable                                           |
| VA-04 | The design package does not claim runtime behavior that exists only in mocks.                  | README, design system and mock labels                        | Task handoff and review report distinguish design evidence from runtime evidence       |
| VA-05 | Public design assets are intentionally selected and excluded from local review evidence.       | `docs/design/` plus local `.evidence/` policy                | Raw recordings and review screenshots remain under `.evidence/`                        |

## 3. Tokens and themes

| ID    | Requirement                                                                                       | T05 evidence                                                                | Later UI check                                                           |
| ----- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| VA-06 | Color, typography, spacing, radii, elevation, motion, focus and chart palette tokens are defined. | `packages/view-dom/styles.css` and `DESIGN_SYSTEM.md`                       | Computed styles confirm the tokens drive the real UI                     |
| VA-07 | Light, dark and system direction is specified and semantically equivalent.                        | Theme tables, paired mocks and `data-boardloom-theme` contract              | Viewer and editor render both themes; system follows OS preference       |
| VA-08 | Text and non-text contrast meets AA where required.                                               | Ratios in `DESIGN_SYSTEM.md`, checked by `tests/framework/design.test.ts`   | Rendered contrast audit includes overlays, selected rows and focus       |
| VA-09 | Styles and tokens are scoped to the Boardloom root and multiple instances do not collide.         | `.boardloom` scope, cascade layer and no `:root`/`html`/`body` declarations | Two instances with different themes render together without host leakage |
| VA-10 | Host overrides are possible without editing package source.                                       | Theme and override contract                                                 | Host token override test and custom theme pack                           |
| VA-11 | No decorative gradients, indiscriminate shadows or forced marketing chrome.                       | Reference compositions and direction rules                                  | Visual review of real viewer/editor                                      |
| VA-12 | Boardloom branding is optional outside demo and documentation.                                    | Reference banner separates product reference from board chrome              | Embedded viewer uses host identity without forced branding               |

## 4. Viewer composition

| ID    | Requirement                                                                                      | T05 evidence                                 | Later UI check                                             |
| ----- | ------------------------------------------------------------------------------------------------ | -------------------------------------------- | ---------------------------------------------------------- |
| VA-13 | Desktop viewer has compact board identity, mode toolbar, quiet filter strip and spacious canvas. | `references/viewer-desktop.html`             | Real viewer at 1280 px and 1440 px                         |
| VA-14 | Viewer light and dark have the same hierarchy and equivalent contrast.                           | Paired desktop viewer artboards              | Real theme switch with no layout shift                     |
| VA-15 | Board title, provenance, update time, timezone and status are visible without crowding.          | Desktop and narrow viewer mocks              | Real metadata from the host and runtime                    |
| VA-16 | Active filters show scope and origin in words; removable filters expose a labeled action.        | Filter strip in viewer and state gallery     | Real filter changes, origin chips and reset                |
| VA-17 | Charts and tables have readable titles, units, axes, legends and text alternatives.              | Chart mocks with summaries and data tables   | Real chart renderer and accessible data alternative        |
| VA-18 | Empty, loading, error, stale, partial and diagnostics states do not fabricate data or axes.      | `references/states.html`                     | Real state transitions under provider and query conditions |
| VA-19 | A selected block is clearly indicated without relying on color alone.                            | Viewer selected block and editor outline     | Keyboard and pointer selection states                      |
| VA-20 | Multiple boards share one visual language without identical composition.                         | Assessment, commercial and operational mocks | Demo boards with real supported features                   |

## 5. Editor composition

| ID    | Requirement                                                                                                                          | T05 evidence                                  | Later UI check                                           |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- | -------------------------------------------------------- |
| VA-21 | Editor desktop includes a block library, a dominant canvas and a precise property inspector.                                         | `references/editor-desktop.html`              | Real editor at desktop width                             |
| VA-22 | Editor light and dark keep the canvas as the priority; the inspector does not become the page.                                       | Paired editor artboards                       | Real theme switch and inspector resize                   |
| VA-23 | Selected block exposes properties, layout and data controls, binding mode and reset.                                                 | Inspector mocks                               | Real inspector with core validation                      |
| VA-24 | Draft state is visible and dirty drafts expose Apply and Discard without silent loss.                                                | Draft bar and discard confirmation annotation | Real draft, apply, cancel and conflict flows             |
| VA-25 | Move and resize have a keyboard alternative with visible controls and instructions.                                                  | Keyboard layout panel in editor mock          | Real keyboard-only move/resize and focus behavior        |
| VA-26 | Filter manager and comparison builder are available without leaving the board.                                                       | Editor inspector and state gallery            | Real filter and comparison configuration flows           |
| VA-27 | Editor narrow uses a bottom drawer or stacked region; canvas remains usable at 320 px and modal draft actions stay inside the sheet. | `references/editor-narrow.html`               | Real narrow editor, drawer focus and sticky draft footer |
| VA-28 | Undo, redo, duplicate, delete and reset-to-defaults are discoverable and keyboard reachable.                                         | Toolbar and block action menu direction       | Real editor command paths                                |

## 6. Narrow and zoom behavior

| ID    | Requirement                                                                        | T05 evidence                                       | Later UI check                                           |
| ----- | ---------------------------------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------- |
| VA-29 | Viewer and editor are usable at 320 CSS px without page-level horizontal overflow. | 320 px artboards in viewer and editor narrow mocks | Browser reflow check at 320 by 800                       |
| VA-30 | Tablet behavior is specified for 768 to 1279 px.                                   | Tablet artboard and breakpoint table               | Real layout at tablet widths                             |
| VA-31 | 200 percent zoom at 1280 and 1440 px preserves function in the narrow composition. | Reflow plan in `ACCESSIBILITY.md`                  | Browser zoom checks at 640 and 720 CSS px                |
| VA-32 | Tables scroll only inside their own labelled region, not the page.                 | Narrow table treatment                             | Real table keyboard and scroll behavior                  |
| VA-33 | Filters, library and inspector move to drawers or stacked regions as specified.    | Narrow viewer/editor mocks                         | Real drawer opening, focus trap, Escape and focus return |
| VA-34 | No function depends on hover or pointer precision.                                 | State and accessibility annotations                | Keyboard and touch checks                                |

## 7. State gallery

| ID    | Requirement                                                                              | T05 evidence             | Later UI check                                            |
| ----- | ---------------------------------------------------------------------------------------- | ------------------------ | --------------------------------------------------------- |
| VA-35 | Loading state uses a labeled skeleton without fake values.                               | `references/states.html` | Real query loading state                                  |
| VA-36 | Empty state distinguishes no data from zero and names the active scope.                  | State gallery            | Real empty result with filter summary                     |
| VA-37 | Error state is block-contained, names a stable code/path and offers recovery.            | State gallery            | Real provider or renderer failure                         |
| VA-38 | Stale state preserves the last valid data with a clear warning and refresh path.         | State gallery            | Real stale result, reconnect and resync                   |
| VA-39 | Partial state discloses returned and total counts and does not imply completeness.       | State gallery            | Real truncated or partial provider result                 |
| VA-40 | Diagnostics state groups severity, path, code and affected block without raw payloads.   | State gallery            | Real diagnostics panel                                    |
| VA-41 | Filter origin state shows board, group and block scope and handles removal.              | State gallery and viewer | Real filter manager and chips                             |
| VA-42 | Comparison state labels primary and reference and shows unavailable deltas with reasons. | State gallery            | Real comparison with zero, null and missing-pair fixtures |
| VA-43 | Realtime reconnect state shows attempt, stale policy and pause/resume.                   | State gallery            | Real reconnect, resync and pause/resume                   |
| VA-44 | Plugin error is contained to one block and offers disable or remove.                     | State gallery            | Real extension registration/render failure                |

## 8. Accessibility

| ID    | Requirement                                                                                  | T05 evidence                                        | Later UI check                                     |
| ----- | -------------------------------------------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------- |
| VA-45 | Focus order, landmarks, labels, live regions and keyboard alternatives are annotated.        | `ACCESSIBILITY.md`, `references/accessibility.html` | Manual screen-reader and keyboard run              |
| VA-46 | Every core flow has a keyboard path with cancellation and focus return.                      | Keyboard path table                                 | Keyboard-only end-to-end run                       |
| VA-47 | Focus ring has 3:1 contrast, is not removed and is not obscured.                             | Focus token and mocks                               | Rendered focus audit at edges and in drawers       |
| VA-48 | Icon-only controls have accessible names and target size at least 24 by 24 px.               | Component specification and annotations             | Target size and name audit                         |
| VA-49 | Dialog and drawer focus is trapped where modal, closes on Escape and returns to the invoker. | Accessibility contract                              | Real filter, comparison and discard dialogs        |
| VA-50 | Charts expose a text alternative and accessible data table with units and missing counts.    | Chart summaries and tables                          | Real chart accessibility tree and table navigation |
| VA-51 | Status announcements are polite or assertive as specified and not excessive.                 | Live-region table                                   | Screen-reader observation                          |
| VA-52 | Color is never the only carrier of series, status, selection or error.                       | Patterns, labels and icons in mocks                 | Visual and color-vision check of real UI           |
| VA-53 | Reduced motion is honored and animation can be stopped.                                      | Reduced-motion tokens and plan                      | OS preference and animation-control test           |
| VA-54 | Automated checks target zero critical and zero serious axe findings, with a manual audit.    | Verification plan                                   | T18 real browser audit with recorded results       |

## 9. Localization and RTL

| ID    | Requirement                                                                                                                                          | T05 evidence                                                                                                | Later UI check                                                    |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| VA-55 | Framework control, status, filter, table-header and ARIA copy is annotated with stable keys in every locale; host fixture copy is marked separately. | `message-keys.json`, `data-message-key`, `data-host-content` and all-language accessible-name coverage test | Key extraction, no hard-coded control copy, host-data distinction |
| VA-56 | Key parity covers UI, ARIA, status, errors, diagnostics, editor, filters, comparison and realtime.                                                   | Catalog namespaces and T17 plan                                                                             | Complete eleven-locale key parity check                           |
| VA-57 | Layout tolerates 30 to 50 percent copy expansion without clipping or lost function.                                                                  | `references/localization.html`                                                                              | Locale-specific long-copy screenshots                             |
| VA-58 | CJK rendering and line breaking are shown; Devanagari is planned but not shown at T05.                                                               | CJK samples and font-stack plan; Hindi remains unverified                                                   | Real CJK and Hindi browser checks                                 |
| VA-59 | Arabic RTL is scoped to the Boardloom root and does not change the host page.                                                                        | Scoped RTL annotation and sample                                                                            | Real RTL instance inside an LTR host page                         |
| VA-60 | Focus order, drawers, icons, numeric bidi, chart axes and data tables remain usable in RTL.                                                          | RTL annotations                                                                                             | Real RTL viewer/editor keyboard and screen-reader run             |
| VA-61 | Locale switching preserves board, draft, filters, comparison, realtime state and focus.                                                              | State-preservation contract                                                                                 | Real locale switching in viewer and editor                        |
| VA-62 | No professional translation certification is claimed.                                                                                                | README and localization limitation                                                                          | T17 review limitation recorded                                    |

## 10. Traceability to the task and acceptance criteria

| Requirement / AC                             | Covered by                                                                             |
| -------------------------------------------- | -------------------------------------------------------------------------------------- |
| FR-111 tokens and scoped styles              | VA-06, VA-09, VA-10; `packages/view-dom/styles.css`; `DESIGN_SYSTEM.md`                |
| FR-120 design system and themes              | VA-06 to VA-28; viewer, editor and boards references                                   |
| FR-121 accessibility                         | VA-45 to VA-61; `ACCESSIBILITY.md`                                                     |
| FR-122 reference mocks and visual acceptance | VA-01 to VA-05, all checklist sections                                                 |
| NFR-002 WCAG 2.2 AA                          | VA-08, VA-45 to VA-54; contrast table and manual plan                                  |
| AC-122                                       | Complete T05 design package and this checklist                                         |
| AC-111 contribution                          | Token documentation, cascade layer and scoped-root contract                            |
| AC-120 contribution                          | Theme, typography, spacing, state and viewer/editor compositions                       |
| AC-121 contribution                          | Keyboard, focus, labels, reduced motion, contrast, chart alternatives and reflow plans |
| AC-150 contribution                          | Stable message-key catalog, locale scope and RTL annotations                           |

## 11. Sign-off record

| Role         | Scope                                                                                 | Verdict          | Date       | Evidence            |
| ------------ | ------------------------------------------------------------------------------------- | ---------------- | ---------- | ------------------- |
| Implementer  | Design package and token layer                                                        | Ready for review | 2026-10-28 | Local handoff       |
| OC reviewer  | Design, accessibility, tokens, RTL, mock-to-checklist traceability, walkthrough video | Pending          |            | Local review report |
| CDX reviewer | Architecture, token scope, specification coherence, mock-to-acceptance traceability   | Pending          |            | Local review report |

A deviation from any checked item must be recorded as a numbered deviation with the affected ID, reason and approver. The list is append-only for the task; a later accepted direction cannot silently erase an earlier rejection.
